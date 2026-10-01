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
   * Calculates IST calendar start-of-day and end-of-day timestamps.
   */
  public getISTDayBounds(dateOffsetDays = 0): { startTs: number; endTs: number; dateLabel: string } {
    const now = new Date();
    // Format to IST string components
    const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    istDate.setDate(istDate.getDate() - dateOffsetDays);

    const startOfTargetDay = new Date(
      istDate.getFullYear(),
      istDate.getMonth(),
      istDate.getDate(),
      0,
      0,
      0,
      0
    );
    const endOfTargetDay = new Date(
      istDate.getFullYear(),
      istDate.getMonth(),
      istDate.getDate(),
      23,
      59,
      59,
      999
    );

    // Approximate UTC offset for IST (+5:30 = 330 minutes)
    // Using Date.UTC to get clean absolute epoch timestamps
    const dateLabel = dateOffsetDays === 0 ? "Aaj" : dateOffsetDays === 1 ? "Kal" : `${istDate.getDate()} ${istDate.toLocaleString("en-IN", { month: "short" })}`;

    return {
      startTs: startOfTargetDay.getTime(),
      endTs: endOfTargetDay.getTime(),
      dateLabel,
    };
  }

  /**
   * Retrieves the live conversation history directly from Baileys RAM store.
   * Searches accurately across ANY message in the conversation (not just the last turn),
   * ensuring contacts are found even if Boss sent the most recent reply.
   */
  public getLiveMessages(jidOrPhone: string, limit = 5, dateRange?: { startTs: number; endTs: number }): IncomingMessage[] | null {
    const detailed = this.getLiveMessagesDetailed(jidOrPhone, limit, dateRange);
    if (!detailed || detailed.filteredMessages.length === 0) {
      return null;
    }
    return detailed.filteredMessages;
  }

  /**
   * Retrieves detailed live chat status for a contact.
   * If a date range (e.g. today) is specified, returns filtered messages plus the last older message
   * so Friday can report accurately if no messages occurred today.
   */
  public getLiveMessagesDetailed(
    jidOrPhone: string,
    limit = 10,
    dateRange?: { startTs: number; endTs: number }
  ): {
    matchedChatName: string;
    matchedChatPhone: string;
    allMessages: IncomingMessage[];
    filteredMessages: IncomingMessage[];
    hasFilteredMessages: boolean;
    lastOlderMessage?: IncomingMessage;
  } | null {
    const normKey = this.normalizeKey(jidOrPhone);
    let messages = normKey && this.chatMessages.has(normKey) ? this.chatMessages.get(normKey)! : null;

    // Search across chats if key wasn't an exact match (e.g. searching by name or partial phone)
    if (!messages || messages.length === 0) {
      const q = (jidOrPhone || "").toLowerCase().trim();
      if (q && q.length >= 2) {
        for (const [key, list] of this.chatMessages.entries()) {
          const matched = list.some((m) => {
            const isMe = m.senderPhone === "me" || m.senderName.includes("DK") || m.senderName.includes("Boss");
            if (isMe) {
              return m.replyJid?.toLowerCase().includes(q) || key.includes(q);
            }
            return (
              key.includes(q) ||
              m.senderName?.toLowerCase().includes(q) ||
              m.senderDisplayName?.toLowerCase().includes(q) ||
              m.senderPhone?.includes(q) ||
              m.replyJid?.toLowerCase().includes(q)
            );
          });
          if (matched) {
            messages = list;
            break;
          }
        }
      }
    }

    if (!messages || messages.length === 0) {
      return null;
    }

    // Sort chronologically (oldest first)
    const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Determine contact name and phone
    const nonMeSample = sorted.find((m) => m.senderPhone !== "me" && !m.senderName.includes("DK"));
    const matchedChatName = nonMeSample?.senderName || nonMeSample?.senderDisplayName || sorted[sorted.length - 1]?.senderName || jidOrPhone;
    const matchedChatPhone = nonMeSample?.senderPhone || "";

    if (dateRange && (dateRange.startTs > 0 || dateRange.endTs > 0)) {
      const filtered = sorted.filter(
        (m) => m.timestamp >= dateRange.startTs && m.timestamp <= dateRange.endTs
      );
      const count = Math.max(1, Math.min(limit, 100));
      const older = sorted.filter((m) => m.timestamp < dateRange.startTs);
      const lastOlderMessage = older.length > 0 ? older[older.length - 1] : undefined;

      return {
        matchedChatName,
        matchedChatPhone,
        allMessages: sorted,
        filteredMessages: filtered.slice(-count),
        hasFilteredMessages: filtered.length > 0,
        lastOlderMessage,
      };
    }

    const count = Math.max(1, Math.min(limit, 100));
    const recent = sorted.slice(-count);

    return {
      matchedChatName,
      matchedChatPhone,
      allMessages: sorted,
      filteredMessages: recent,
      hasFilteredMessages: recent.length > 0,
      lastOlderMessage: sorted.length > count ? sorted[sorted.length - count - 1] : undefined,
    };
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
