import { IncomingMessage } from "./whatsappTypes";

export interface FriendlyTimeInfo {
  timeStr: string;       // e.g. "10:45 AM"
  dayStr: string;        // e.g. "Aaj", "Kal", "Budhwar"
  dateStr: string;       // e.g. "1 Oct 2026"
  formattedBadge: string; // e.g. "Aaj subah, 10:45 AM"
}

export class BaileysLiveStore {
  // Max messages retained in RAM per individual chat/group
  private static readonly MAX_MESSAGES_PER_CHAT = 100;

  // Key: normalized JID or phone number -> list of messages (newest last)
  private chatMessages = new Map<string, IncomingMessage[]>();

  /**
   * Converts a millisecond timestamp to Indian Standard Time (IST) friendly human format.
   */
  public formatFriendlyIST(timestampMs: number): FriendlyTimeInfo {
    const ts = timestampMs > 1e11 ? timestampMs : timestampMs * 1000;
    const date = new Date(ts);

    // Current IST Date
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const msgIST = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    const timeStr = msgIST.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const dateStr = msgIST.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // Difference in calendar days
    const startOfToday = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate()).getTime();
    const startOfMsg = new Date(msgIST.getFullYear(), msgIST.getMonth(), msgIST.getDate()).getTime();
    const dayDiff = Math.round((startOfToday - startOfMsg) / (24 * 60 * 60 * 1000));

    const hours = msgIST.getHours();
    const partOfDay =
      hours >= 4 && hours < 12
        ? "subah"
        : hours >= 12 && hours < 17
          ? "dopahar"
          : hours >= 17 && hours < 21
            ? "shaam"
            : "raat";

    let dayStr = "";
    let formattedBadge = "";

    if (dayDiff === 0) {
      dayStr = "Aaj";
      formattedBadge = `Aaj ${partOfDay}, ${timeStr}`;
    } else if (dayDiff === 1) {
      dayStr = "Kal";
      formattedBadge = `Kal ${partOfDay}, ${timeStr}`;
    } else if (dayDiff > 1 && dayDiff < 7) {
      const dayName = msgIST.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" });
      dayStr = dayName;
      formattedBadge = `${dayName} (${msgIST.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}), ${timeStr}`;
    } else {
      dayStr = dateStr;
      formattedBadge = `${dateStr}, ${timeStr}`;
    }

    return { timeStr, dayStr, dateStr, formattedBadge };
  }

  /**
   * Normalizes a phone or JID string for dictionary indexing.
   */
  public normalizeKey(jidOrPhone: string): string {
    const raw = (jidOrPhone || "").trim().toLowerCase();
    if (!raw) return "";
    if (raw.endsWith("@g.us")) return raw;
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 10) {
      return digits.slice(-10); // match by last 10 digits
    }
    return raw.replace(/@.*$/, "");
  }

  /**
   * Records an incoming message into the active Baileys live memory store.
   */
  public recordIncoming(msg: IncomingMessage) {
    if (!msg || !msg.text) return;

    const keysToUpdate = new Set<string>();
    if (msg.replyJid) keysToUpdate.add(this.normalizeKey(msg.replyJid));
    if (msg.senderPhone) keysToUpdate.add(this.normalizeKey(msg.senderPhone));
    if (msg.groupId) keysToUpdate.add(this.normalizeKey(msg.groupId));

    // Enrich message with friendly IST time info
    const timeInfo = this.formatFriendlyIST(msg.timestamp);
    msg.dateStr = timeInfo.formattedBadge;

    for (const key of keysToUpdate) {
      if (!key) continue;
      if (!this.chatMessages.has(key)) {
        this.chatMessages.set(key, []);
      }
      const list = this.chatMessages.get(key)!;
      // Deduplicate by message ID
      if (!list.some((m) => m.id === msg.id)) {
        list.push(msg);
        if (list.length > BaileysLiveStore.MAX_MESSAGES_PER_CHAT) {
          list.shift(); // keep sliding window of max 100 messages
        }
      }
    }
  }

  /**
   * Records an outgoing message sent by Boss (DK) or Friday bot into the live store.
   */
  public recordOutgoing(
    remoteJid: string,
    text: string,
    senderName = "Aap (DK)",
    isBotReply = false,
    messageId?: string
  ) {
    if (!remoteJid || !text) return;
    const ts = Date.now();
    const timeInfo = this.formatFriendlyIST(ts);

    const outgoingMsg: IncomingMessage = {
      id: messageId || `out_${ts}_${Math.random().toString(36).slice(2, 6)}`,
      senderPhone: "me",
      senderName,
      senderDisplayName: senderName,
      replyJid: remoteJid,
      groupId: remoteJid.endsWith("@g.us") ? remoteJid : null,
      groupName: null,
      isGroup: remoteJid.endsWith("@g.us"),
      isUnknownContact: false,
      text,
      timestamp: ts,
      dateStr: timeInfo.formattedBadge,
      isRead: true,
      botReply: isBotReply ? text : undefined,
    };

    const keys = new Set<string>();
    const norm = this.normalizeKey(remoteJid);
    if (norm) keys.add(norm);
    const digits = remoteJid.replace(/\D/g, "");
    if (digits.length >= 10) keys.add(digits.slice(-10));

    for (const key of keys) {
      if (!key) continue;
      if (!this.chatMessages.has(key)) {
        this.chatMessages.set(key, []);
      }
      const list = this.chatMessages.get(key)!;
      if (!list.some((m) => m.id === outgoingMsg.id)) {
        list.push(outgoingMsg);
        if (list.length > BaileysLiveStore.MAX_MESSAGES_PER_CHAT) {
          list.shift();
        }
      }
    }
  }

  /**
   * Retrieves the live conversation history directly from Baileys RAM store.
   * Returns chronologically sorted messages (oldest first).
   * Returns null if no live history exists for this JID/phone.
   */
  public getLiveMessages(jidOrPhone: string, limit = 5): IncomingMessage[] | null {
    const normKey = this.normalizeKey(jidOrPhone);
    let messages = normKey && this.chatMessages.has(normKey) ? this.chatMessages.get(normKey)! : null;

    // Fallback search across chats if key wasn't an exact match (e.g. searching by name or partial phone)
    if (!messages || messages.length === 0) {
      const q = (jidOrPhone || "").toLowerCase().trim();
      if (q && q.length >= 2) {
        for (const [key, list] of this.chatMessages.entries()) {
          const sample = list[list.length - 1];
          if (
            key.includes(q) ||
            sample?.senderName?.toLowerCase().includes(q) ||
            sample?.senderDisplayName?.toLowerCase().includes(q) ||
            sample?.senderPhone?.includes(q) ||
            sample?.replyJid?.toLowerCase().includes(q)
          ) {
            messages = list;
            break;
          }
        }
      }
    }

    if (!messages || messages.length === 0) {
      return null;
    }

    const count = Math.max(1, Math.min(limit, 100));
    // Slice latest 'count' messages and sort chronologically
    return messages
      .slice(-count)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * Retrieves live messages for a specific group by group JID or group name.
   */
  public getLiveGroupMessages(groupJidOrName: string, limit = 25): { groupName: string; messages: IncomingMessage[] } | null {
    const q = (groupJidOrName || "").toLowerCase().trim();
    if (!q) return null;

    let targetGroupMessages: IncomingMessage[] | null = null;
    let foundGroupName = "";

    // 1. Direct key match (e.g. "123456@g.us")
    if (this.chatMessages.has(q)) {
      targetGroupMessages = this.chatMessages.get(q)!;
      foundGroupName = targetGroupMessages[0]?.groupName || q;
    } else {
      // 2. Search across group chats by name or ID
      for (const [key, list] of this.chatMessages.entries()) {
        if (!key.endsWith("@g.us")) continue;
        const top = list[list.length - 1];
        if (
          key.includes(q) ||
          top?.groupName?.toLowerCase().includes(q) ||
          top?.groupId?.toLowerCase().includes(q)
        ) {
          targetGroupMessages = list;
          foundGroupName = top?.groupName || key;
          break;
        }
      }
    }

    if (!targetGroupMessages || targetGroupMessages.length === 0) {
      return null;
    }

    const count = Math.max(1, Math.min(limit, 100));
    const sorted = targetGroupMessages
      .slice(-count)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return {
      groupName: foundGroupName,
      messages: sorted,
    };
  }

  /**
   * Searches live messages across all buffered conversations matching a query.
   */
  public searchLiveMessages(query: string, limit = 20): IncomingMessage[] {
    const q = (query || "").toLowerCase().trim();
    if (!q) return [];

    const matched: IncomingMessage[] = [];
    const seenIds = new Set<string>();

    for (const list of this.chatMessages.values()) {
      for (const m of list) {
        if (seenIds.has(m.id)) continue;
        const textBlob = `${m.text} ${m.senderName} ${m.senderPhone} ${m.groupName || ""}`.toLowerCase();
        if (textBlob.includes(q)) {
          seenIds.add(m.id);
          matched.push(m);
        }
      }
    }

    return matched
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }

  /**
   * Returns all active conversations currently in live Baileys memory.
   */
  public getAllActiveConversations(limitPerChat = 5): { key: string; displayName: string; isGroup: boolean; messages: IncomingMessage[] }[] {
    const conversations: { key: string; displayName: string; isGroup: boolean; messages: IncomingMessage[] }[] = [];
    const seenChats = new Set<string>();

    for (const [key, list] of this.chatMessages.entries()) {
      if (list.length === 0) continue;
      const lastMsg = list[list.length - 1];
      const chatIdentifier = lastMsg.groupId || lastMsg.replyJid || key;
      if (seenChats.has(chatIdentifier)) continue;
      seenChats.add(chatIdentifier);

      const displayName = lastMsg.isGroup
        ? (lastMsg.groupName || "WhatsApp Group")
        : (lastMsg.senderPhone === "me" ? "Direct Chat" : lastMsg.senderName || lastMsg.senderPhone);

      conversations.push({
        key: chatIdentifier,
        displayName,
        isGroup: lastMsg.isGroup,
        messages: list.slice(-limitPerChat).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
      });
    }

    return conversations;
  }

  /**
   * Checks if live Baileys memory has recent messages for this conversation.
   */
  public hasLiveMessages(jidOrPhone: string): boolean {
    const normKey = this.normalizeKey(jidOrPhone);
    return !!normKey && (this.chatMessages.get(normKey)?.length || 0) > 0;
  }

  /**
   * Returns the count of conversations currently buffered in Baileys RAM.
   */
  public getStats(): { activeChats: number; totalBufferedMessages: number } {
    let totalBufferedMessages = 0;
    const seenMsgIds = new Set<string>();
    for (const list of this.chatMessages.values()) {
      for (const m of list) {
        if (!seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id);
          totalBufferedMessages++;
        }
      }
    }
    return {
      activeChats: this.chatMessages.size,
      totalBufferedMessages,
    };
  }
}

export const baileysLiveStore = new BaileysLiveStore();
