import { db } from "../firebaseAdmin";
import { IncomingMessage } from "./whatsappTypes";
import { baileysLiveStore } from "./baileysLiveStore";

const inboxCol = () => db.collection("whatsapp_inbox");

export class WhatsAppHistoryEngine {
  private messageCache: IncomingMessage[] = []; // RAM — max 500, newest first
  private isWarmedUp = false;
  private warmUpPromise: Promise<void> | null = null;

  // Live Baileys WASocket — injected from whatsappBotService on connection
  private waSocket: any = null;

  /**
   * Called by whatsappBotService once the Baileys socket is connected.
   * Gives this engine direct access to WhatsApp's live message store.
   */
  public setSocket(sock: any): void {
    this.waSocket = sock;
    console.log("[WhatsAppHistory] ✅ Live Baileys socket registered. Direct WA fetch enabled.");
  }

  /**
   * Fetches messages DIRECTLY from WhatsApp servers using the live Baileys socket.
   * This is the most reliable source — works even if Firestore/RAM missed messages.
   *
   * @param jid   Full WhatsApp JID (e.g. "919XXXXXXXXX@s.whatsapp.net")
   * @param count Number of messages to fetch (default 20)
   * @param beforeTimestampMs Fetch messages before this time (default = now)
   */
  public async fetchChatHistoryFromWA(
    jid: string,
    count = 20,
    beforeTimestampMs?: number
  ): Promise<IncomingMessage[]> {
    if (!this.waSocket || !jid) return [];

    try {
      // Baileys fetchMessages signature: fetchMessages(jid, count, cursor?)
      const cursor = beforeTimestampMs
        ? { before: { id: "0", fromMe: false } } // Baileys cursor stub
        : undefined;

      // Try sock.fetchMessages first (Baileys v6+ API)
      if (typeof this.waSocket.fetchMessages === "function") {
        const rawMsgs: any[] = await this.waSocket.fetchMessages(jid, count);
        if (rawMsgs && rawMsgs.length > 0) {
          return this._parseBaileysRawMessages(rawMsgs, jid);
        }
      }

      // Fallback: try sock.chatHistory / loadMessages (older Baileys builds)
      if (typeof this.waSocket.loadMessages === "function") {
        const rawMsgs: any[] = await this.waSocket.loadMessages(jid, count);
        if (rawMsgs && rawMsgs.length > 0) {
          return this._parseBaileysRawMessages(rawMsgs, jid);
        }
      }

      console.log("[WhatsAppHistory] ⚠️ Socket available but fetchMessages/loadMessages not supported on this Baileys build.");
      return [];
    } catch (err: any) {
      console.warn("[WhatsAppHistory] WA live fetch failed (non-fatal):", err?.message || err);
      return [];
    }
  }

  /**
   * Converts raw Baileys WAMessage objects into our IncomingMessage schema.
   */
  private _parseBaileysRawMessages(rawMsgs: any[], defaultJid: string): IncomingMessage[] {
    const results: IncomingMessage[] = [];

    for (const raw of rawMsgs) {
      try {
        const key = raw.key || {};
        const msgContent = raw.message || {};
        const tsSeconds = raw.messageTimestamp
          ? (typeof raw.messageTimestamp === "object" ? raw.messageTimestamp.low : raw.messageTimestamp)
          : 0;
        const tsMs = tsSeconds > 1e9 ? tsSeconds * 1000 : tsSeconds;

        const text =
          msgContent.conversation ||
          msgContent.extendedTextMessage?.text ||
          msgContent.imageMessage?.caption ||
          msgContent.videoMessage?.caption ||
          (msgContent.audioMessage ? "[Voice Note]" : "") ||
          "";

        if (!text) continue;

        const fromMe = key.fromMe || false;
        const remoteJid = key.remoteJid || defaultJid;
        const pushName = raw.pushName || (fromMe ? "Boss (DK)" : "Contact");

        const timeInfo = baileysLiveStore.formatFriendlyIST(tsMs);

        const parsed: IncomingMessage = {
          id: key.id || `wa_${tsMs}_${Math.random().toString(36).slice(2, 6)}`,
          senderPhone: fromMe ? "me" : remoteJid.split("@")[0],
          senderName: fromMe ? "Boss (DK)" : pushName,
          senderDisplayName: pushName,
          replyJid: remoteJid,
          groupId: remoteJid.endsWith("@g.us") ? remoteJid : null,
          groupName: null,
          isGroup: remoteJid.endsWith("@g.us"),
          isUnknownContact: false,
          text,
          timestamp: tsMs,
          dateStr: timeInfo.formattedBadge,
          isRead: true,
          botReply: fromMe ? text : undefined,
        };

        results.push(parsed);

        // Also register into Baileys Live Store RAM so future calls are instant
        if (fromMe) {
          baileysLiveStore.recordOutgoing(remoteJid, text, "Boss (DK)", false, parsed.id);
        } else {
          baileysLiveStore.recordIncoming(parsed);
        }
      } catch {
        // skip malformed message
      }
    }

    return results.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  constructor() {
    this.warmUpCacheFromFirestore().catch(() => {});
  }

  /**
   * Preloads latest messages from Firestore so that server restarts retain active memory.
   * Also primes the Baileys live store so in-memory queries are instant right upon launch.
   */
  public async warmUpCacheFromFirestore(limit = 150): Promise<void> {
    if (this.isWarmedUp) return;
    if (this.warmUpPromise) return this.warmUpPromise;

    this.warmUpPromise = (async () => {
      try {
        const snap = await inboxCol().orderBy("timestamp", "desc").limit(limit).get();
        if (!snap.empty) {
          const fetched = snap.docs.map((d) => d.data() as IncomingMessage);
          for (const msg of fetched) {
            if (!this.messageCache.some((m) => m.id === msg.id)) {
              this.messageCache.push(msg);
            }
            // Prime Baileys Live Store as well
            if (msg.senderPhone === "me" || msg.senderPhone === "bot") {
              baileysLiveStore.recordOutgoing(
                msg.replyJid || "",
                msg.text,
                msg.senderName,
                msg.senderPhone === "bot",
                msg.id
              );
            } else {
              baileysLiveStore.recordIncoming(msg);
            }
          }
          this.messageCache.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          if (this.messageCache.length > 500) {
            this.messageCache = this.messageCache.slice(0, 500);
          }
          console.log(`[WhatsAppHistory] 🔥 Cache & BaileysLiveStore warmed up with ${fetched.length} messages from Firestore.`);
        }
        this.isWarmedUp = true;
      } catch (err) {
        console.warn("[WhatsAppHistory] Failed to warm up cache from Firestore:", err);
      } finally {
        this.warmUpPromise = null;
      }
    })();

    return this.warmUpPromise;
  }

  public recordIncomingMessage(msg: IncomingMessage) {
    baileysLiveStore.recordIncoming(msg);
    if (!this.messageCache.some((m) => m.id === msg.id)) {
      this.messageCache.unshift(msg);
      if (this.messageCache.length > 500) {
        this.messageCache = this.messageCache.slice(0, 500);
      }
    }
  }

  public getCachedMessages(): IncomingMessage[] {
    return this.messageCache;
  }

  public findCachedMessage(predicate: (m: IncomingMessage) => boolean): IncomingMessage | undefined {
    return this.messageCache.find(predicate);
  }

  public unshiftMessage(msg: IncomingMessage) {
    if (msg.senderPhone === "me" || msg.senderPhone === "bot") {
      baileysLiveStore.recordOutgoing(
        msg.replyJid || "",
        msg.text,
        msg.senderName,
        msg.senderPhone === "bot",
        msg.id
      );
    } else {
      baileysLiveStore.recordIncoming(msg);
    }

    if (!this.messageCache.some((m) => m.id === msg.id)) {
      this.messageCache.unshift(msg);
      if (this.messageCache.length > 500) {
        this.messageCache = this.messageCache.slice(0, 500);
      }
    }
  }

  /**
   * Returns recent messages from a specific group in chronological order.
   * Checks Baileys Live Store first, falls back to memory cache.
   */
  public getRecentGroupMessages(groupJid: string, limit: number = 25): IncomingMessage[] {
    const liveGroup = baileysLiveStore.getLiveGroupMessages(groupJid, limit);
    if (liveGroup && liveGroup.messages.length > 0) {
      return liveGroup.messages;
    }
    const cleanJid = (groupJid || "").trim();
    return this.messageCache
      .filter((m) => m.isGroup && (m.groupId === cleanJid || m.replyJid === cleanJid))
      .slice(0, limit)
      .reverse();
  }

  /**
   * Retrieves persistent conversation context between Boss (DK) and Friday.
   * Checks Baileys Live Store first for zero-latency direct retrieval, then falls back to Firestore.
   */
  public async getRecentBossContext(replyJid = "", limit = 15): Promise<IncomingMessage[]> {
    const liveMsgs = baileysLiveStore.getLiveMessages("me", limit);
    if (liveMsgs && liveMsgs.length >= 3) {
      return liveMsgs;
    }

    await this.warmUpCacheFromFirestore();

    const isBossMatch = (m: IncomingMessage) => {
      if (m.isGroup) return false;
      if (m.text.startsWith("[Reaction:") || /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(m.text.trim())) return false;
      const sName = (m.senderName || "").toLowerCase();
      const sPhone = (m.senderPhone || "").toLowerCase();
      const isBossSender = sName.includes("boss") || sName.includes("dk") || sPhone === "me";
      const isBotSender = sName.includes("friday") || sPhone === "bot";
      const isTargetJid = !!(replyJid && (m.replyJid === replyJid || m.senderPhone === replyJid.split("@")[0]));
      return isBossSender || isBotSender || isTargetJid;
    };

    let matched = this.messageCache.filter(isBossMatch);

    if (matched.length < limit) {
      try {
        const snap = await inboxCol()
          .where("isGroup", "==", false)
          .orderBy("timestamp", "desc")
          .limit(limit * 2)
          .get();
        if (!snap.empty) {
          const docs = snap.docs.map((d) => d.data() as IncomingMessage);
          for (const d of docs) {
            if (isBossMatch(d) && !matched.some((m) => m.id === d.id)) {
              matched.push(d);
            }
          }
        }
      } catch (err) {
        // Fallback: continue with memory cache
      }
    }

    return matched
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-limit);
  }

  /**
   * Retrieves conversation history for a specific contact.
   *
   * 3-Layer Priority Fallback:
   *   Layer 1 — Baileys RAM (baileysLiveStore): Zero-latency, instant if server is running
   *   Layer 2 — Baileys Live WA Fetch (sock.fetchMessages): Direct from WhatsApp servers, never misses a message
   *   Layer 3 — Firestore (whatsapp_inbox): Persistent DB fallback
   */
  public async getRecentContactContext(senderPhone: string, limit = 8): Promise<IncomingMessage[]> {
    // ── Layer 1: Baileys RAM Store ────────────────────────────────────────────
    const liveMsgs = baileysLiveStore.getLiveMessages(senderPhone, limit);
    if (liveMsgs && liveMsgs.length >= Math.min(limit, 3)) {
      console.log(`[WhatsAppHistory] ✅ Layer 1 (RAM): Found ${liveMsgs.length} msgs for ${senderPhone}`);
      return liveMsgs;
    }

    // ── Layer 2: Baileys Live Socket — fetch directly from WhatsApp ───────────
    const clean = (senderPhone || "").replace(/\D/g, "");
    if (clean.length >= 10 && this.waSocket) {
      try {
        // Build a valid WhatsApp JID from the phone number
        const jid = clean.startsWith("91") ? `${clean}@s.whatsapp.net` : `91${clean.slice(-10)}@s.whatsapp.net`;
        const waMsgs = await this.fetchChatHistoryFromWA(jid, Math.max(limit * 2, 20));
        if (waMsgs && waMsgs.length > 0) {
          console.log(`[WhatsAppHistory] ✅ Layer 2 (WA Live): Fetched ${waMsgs.length} msgs for ${jid}`);
          return waMsgs.slice(-limit);
        }
      } catch (liveErr: any) {
        console.warn("[WhatsAppHistory] Layer 2 WA fetch failed, falling to Firestore:", liveErr?.message);
      }
    }

    // ── Layer 3: Firestore ────────────────────────────────────────────────────
    await this.warmUpCacheFromFirestore();

    const isContactMatch = (m: IncomingMessage) => {
      if (m.isGroup) return false;
      if (m.text.startsWith("[Reaction:")) return false;
      const mPhone = (m.senderPhone || "").replace(/\D/g, "");
      const mJid = (m.replyJid || "").replace(/\D/g, "");
      return (clean && (mPhone === clean || mJid.includes(clean))) || (m.senderPhone === "bot" && mJid.includes(clean));
    };

    let matched = this.messageCache.filter(isContactMatch);

    if (matched.length < limit && clean) {
      try {
        const snap = await inboxCol()
          .where("isGroup", "==", false)
          .orderBy("timestamp", "desc")
          .limit(limit * 3)
          .get();
        if (!snap.empty) {
          const docs = snap.docs.map((d) => d.data() as IncomingMessage);
          for (const d of docs) {
            if (isContactMatch(d) && !matched.some((m) => m.id === d.id)) {
              matched.push(d);
            }
          }
        }
        console.log(`[WhatsAppHistory] ✅ Layer 3 (Firestore): Found ${matched.length} msgs for ${senderPhone}`);
      } catch {}
    }

    return matched
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-limit);
  }

  /**
   * Formats a list of messages into a clean day-grouped chronological transcript.
   * Format:
   *   📋 *Rohit ke Last 5 Messages*
   *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   *           *Sunday, 28 Sep*
   *
   *   Rohit — "msg" (10:45 AM)
   *
   *   Aap — "msg" (10:47 AM)
   */
  public formatConversationTranscript(
    messages: IncomingMessage[],
    contactDisplayName = "",
    title = ""
  ): string {
    if (!messages || messages.length === 0) return "";

    const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    const heading = title || (contactDisplayName ? `${contactDisplayName} ke Last ${sorted.length} Messages` : `Last ${sorted.length} Messages`);

    let out = `📋 *${heading}*\n${divider}\n`;

    let lastDayKey = "";

    for (const m of sorted) {
      const ts = m.timestamp || Date.now();
      const msgDate = new Date(ts > 1e11 ? ts : ts * 1000);
      const istStr = msgDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istStr);

      // Day separator
      const dayKey = istDate.toDateString();
      if (dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        const dayLabel = istDate.toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "short",
        });
        out += `\n          *${dayLabel}*\n`;
      }

      // Time label
      const timeLabel = istDate.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // Sender label
      const isMe = m.senderPhone === "me" || m.senderPhone === "bot" ||
        m.senderName.toLowerCase().includes("friday") ||
        m.senderName.includes("DK") ||
        m.senderName.includes("Boss");
      const senderLabel = isMe ? "Aap" : (contactDisplayName || m.senderName);

      out += `\n${senderLabel} — _"${m.text.replace(/\n/g, " ")}"_ (${timeLabel})\n`;
    }

    return out.trim();
  }

  /**
   * Cleans an IncomingMessage (or nested object) so it can be safely written to Firestore.
   * Firestore rejects JavaScript objects with custom prototypes (e.g. Baileys Proto Message instances),
   * Buffers, functions, symbols, or undefined properties.
   */
  public sanitizeForFirestore(data: any): any {
    if (data === null || data === undefined) return null;
    if (typeof data !== "object") return data;
    if (data instanceof Date) return data;
    if (Array.isArray(data)) {
      return data
        .map((item) => this.sanitizeForFirestore(item))
        .filter((item) => item !== undefined);
    }
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (key === "rawQuotedMessage" || key === "rawMessage" || key === "message") {
        continue;
      }
      if (val === undefined || typeof val === "function" || typeof val === "symbol") {
        continue;
      }
      if (Buffer.isBuffer(val) || (typeof Uint8Array !== "undefined" && val instanceof Uint8Array)) {
        continue;
      }
      if (val !== null && typeof val === "object") {
        clean[key] = this.sanitizeForFirestore(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }

  public async saveToFirestore(msg: IncomingMessage): Promise<void> {
    try {
      if (!msg || !msg.id) return;
      const cleanDoc = this.sanitizeForFirestore(msg);
      await inboxCol().doc(msg.id).set(cleanDoc);
    } catch (e) {
      console.error("[WhatsAppHistory] Failed to save message to Firestore:", e);
    }
  }

  public async updateBotReply(msgId: string, replyText: string): Promise<void> {
    try {
      await inboxCol().doc(msgId).update({ botReply: replyText });
    } catch {}
  }

  public async fetchFromFirestore(startTs: number, endTs: number): Promise<IncomingMessage[]> {
    try {
      const snap = await inboxCol()
        .where("timestamp", ">=", startTs)
        .where("timestamp", "<=", endTs)
        .orderBy("timestamp", "desc")
        .limit(50)
        .get();
      return snap.docs.map((d) => d.data() as IncomingMessage);
    } catch (e) {
      try {
        const snap = await inboxCol().orderBy("timestamp", "desc").limit(50).get();
        return snap.docs
          .map((d) => d.data() as IncomingMessage)
          .filter((m) => m.timestamp >= startTs && m.timestamp <= endTs);
      } catch (err2) {
        console.error("[WhatsAppHistory] Failed to fetch from Firestore:", err2);
        return this.messageCache.filter(
          (m) => m.timestamp >= startTs && m.timestamp <= endTs
        );
      }
    }
  }

  public parseDateFilter(dateFilter?: string): { startTs: number; endTs: number; dateLabel?: string } {
    const now = Date.now();
    if (!dateFilter) return { startTs: now - 48 * 60 * 60 * 1000, endTs: now, dateLabel: "Recent" };

    const f = dateFilter.toLowerCase().trim();

    if (/\b(aaj|ajj|aj|today)\b/i.test(f)) {
      const bounds = baileysLiveStore.getISTDayBounds(0);
      return { startTs: bounds.startTs, endTs: bounds.endTs, dateLabel: "Aaj" };
    }
    if (/\b(kal|yesterday)\b/i.test(f)) {
      const bounds = baileysLiveStore.getISTDayBounds(1);
      return { startTs: bounds.startTs, endTs: bounds.endTs, dateLabel: "Kal" };
    }
    if (/\b(parso)\b/i.test(f)) {
      const bounds = baileysLiveStore.getISTDayBounds(2);
      return { startTs: bounds.startTs, endTs: bounds.endTs, dateLabel: "Parso" };
    }

    const today = new Date();
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const endOfDay = (d: Date) => startOfDay(d) + 86400000 - 1;
    const atHour = (d: Date, hour: number, minute = 0) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0).getTime();

    const dinMatch = f.match(/(\d+)\s*(?:din|days?)\s*(?:pehle|ago)/);
    if (dinMatch) {
      const daysAgo = parseInt(dinMatch[1]);
      const d = new Date(today); d.setDate(today.getDate() - daysAgo);
      return { startTs: startOfDay(d), endTs: endOfDay(d), dateLabel: `${daysAgo} din pehle` };
    }

    const isMorning = /subah|morning/.test(f);
    const isAfternoon = /dopahar|afternoon/.test(f);
    const isEvening = /shaam|evening/.test(f);
    const isNight = /raat|night/.test(f);

    if (isMorning || isAfternoon || isEvening || isNight) {
      const baseDay = new Date(today);
      if (f.includes("kal")) {
        baseDay.setDate(today.getDate() - 1);
      } else {
        const dayOffsetMatch = f.match(/(\d+)\s*(?:din|days?)\s*(?:pehle|ago)/);
        if (dayOffsetMatch) baseDay.setDate(today.getDate() - parseInt(dayOffsetMatch[1]));
      }

      if (isMorning) return { startTs: atHour(baseDay, 5), endTs: atHour(baseDay, 12), dateLabel: "Subah" };
      if (isAfternoon) return { startTs: atHour(baseDay, 12), endTs: atHour(baseDay, 17), dateLabel: "Dopahar" };
      if (isEvening) return { startTs: atHour(baseDay, 17), endTs: atHour(baseDay, 21), dateLabel: "Shaam" };
      if (isNight) return { startTs: atHour(baseDay, 21), endTs: endOfDay(baseDay), dateLabel: "Raat" };
    }

    if (f.includes("week") || f.includes("hafte")) {
      return { startTs: now - 7 * 86400000, endTs: now, dateLabel: "Pichla Hafta" };
    }
    if (f.includes("month") || f.includes("mahine")) {
      return { startTs: now - 30 * 86400000, endTs: now, dateLabel: "Pichla Mahina" };
    }

    if (/last|latest|abhi|recent/.test(f)) {
      return { startTs: 0, endTs: now, dateLabel: "Recent" };
    }

    return { startTs: 0, endTs: now, dateLabel: "All" };
  }

  public async getMessages(params: {
    messageType?: "personal" | "group" | "all";
    senderName?: string;
    groupName?: string;
    dateFilter?: string;
    limit?: number;
  } = {}): Promise<IncomingMessage[]> {
    const { startTs, endTs } = this.parseDateFilter(params.dateFilter);
    const limit = params.limit || 20;

    // ── 1. CHECK BAILEYS LIVE STORE FIRST ──
    if (params.senderName) {
      const live = baileysLiveStore.getLiveMessagesDetailed(params.senderName, limit, { startTs, endTs });
      if (live && live.filteredMessages.length > 0) {
        return live.filteredMessages;
      }
    } else if (params.groupName) {
      const liveGroup = baileysLiveStore.getLiveGroupMessages(params.groupName, limit);
      if (liveGroup && liveGroup.messages.length > 0) {
        const filtered = liveGroup.messages.filter((m) => m.timestamp >= startTs && m.timestamp <= endTs);
        if (filtered.length > 0) return filtered;
      }
    }

    // ── 2. FALLBACK TO MEMORY CACHE & FIRESTORE ──
    let messages: IncomingMessage[] = this.messageCache.filter(
      (m) => m.timestamp >= startTs && m.timestamp <= endTs
    );

    if (messages.length === 0) {
      messages = await this.fetchFromFirestore(startTs, endTs);
    }

    const type = params.messageType || "all";
    if (type === "personal") messages = messages.filter((m) => !m.isGroup);
    if (type === "group") messages = messages.filter((m) => m.isGroup);

    if (params.senderName) {
      const q = params.senderName.toLowerCase();
      messages = messages.filter(
        (m) =>
          m.senderName.toLowerCase().includes(q) ||
          m.senderDisplayName.toLowerCase().includes(q) ||
          m.senderPhone.includes(q)
      );
    }

    if (params.groupName) {
      const q = params.groupName.toLowerCase();
      messages = messages.filter((m) => m.groupName?.toLowerCase().includes(q));
    }

    const defaultLimit = type === "group" ? 5 : 10;
    return messages.slice(0, params.limit || defaultLimit);
  }

  public async searchWhatsAppHistory(
    query: string,
    options?: { contact?: string; daysBack?: number; limit?: number }
  ): Promise<{ success: boolean; count: number; results: IncomingMessage[]; summary: string }> {
    const days = options?.daysBack || 30;
    const startTs = Date.now() - days * 86400000;
    const limit = options?.limit || 20;
    const qLower = (query || "").toLowerCase().trim();
    const contactLower = (options?.contact || "").toLowerCase().trim();

    // ── 1. BAILEYS LIVE SEARCH FIRST ──
    const liveMatches = baileysLiveStore.searchLiveMessages(contactLower || qLower, limit);
    if (liveMatches.length > 0) {
      let filtered = liveMatches;
      if (contactLower && qLower && contactLower !== qLower) {
        filtered = filtered.filter((m) => m.text.toLowerCase().includes(qLower));
      }
      if (filtered.length > 0) {
        let summary = `⚡💬 *WhatsApp Live Search (Baileys Store, ${filtered.length} found):*\n\n`;
        filtered.forEach((m, i) => {
          const who = m.senderPhone === "me" ? "👤 Aap (DK)" : `📩 ${m.senderName} (+${m.senderPhone})`;
          summary += `${i + 1}. *${who}* [📅 ${m.dateStr || "Abhi"}]\n   • _"${m.text.slice(0, 160)}"_\n\n`;
        });
        summary += `_⚡ Source: Real-time Baileys live memory_\n`;
        return {
          success: true,
          count: filtered.length,
          results: filtered,
          summary: summary.trim(),
        };
      }
    }

    // ── 2. FIRESTORE ARCHIVE SEARCH FALLBACK ──
    try {
      let docs: IncomingMessage[] = [];
      try {
        const snap = await inboxCol()
          .where("timestamp", ">=", startTs)
          .orderBy("timestamp", "desc")
          .limit(200)
          .get();
        docs = snap.docs.map((d) => d.data() as IncomingMessage);
      } catch {
        const fallbackSnap = await inboxCol().orderBy("timestamp", "desc").limit(200).get();
        docs = fallbackSnap.docs
          .map((d) => d.data() as IncomingMessage)
          .filter((m) => m.timestamp >= startTs);
      }

      if (docs.length === 0 && this.messageCache.length > 0) {
        docs = this.messageCache.filter((m) => m.timestamp >= startTs);
      }

      let filtered = docs;
      if (contactLower) {
        filtered = filtered.filter(
          (m) =>
            (m.senderName && m.senderName.toLowerCase().includes(contactLower)) ||
            (m.senderPhone && m.senderPhone.includes(contactLower)) ||
            (m.senderDisplayName && m.senderDisplayName.toLowerCase().includes(contactLower))
        );
      }

      if (qLower && qLower !== "all" && qLower !== "everything" && qLower !== "sab") {
        const tokens = qLower.split(/\s+/).filter(Boolean);
        filtered = filtered.filter((m) => {
          const textBlob = `${m.text} ${m.senderName} ${m.senderPhone} ${m.groupName || ""}`.toLowerCase();
          return tokens.some((t) => textBlob.includes(t));
        });
      }

      filtered = filtered.slice(0, limit);

      if (filtered.length === 0) {
        return {
          success: true,
          count: 0,
          results: [],
          summary: `Boss, pichle ${days} dino me "${query || options?.contact || "koi message"}" se match karta hua koi WhatsApp message nahi mila.`,
        };
      }

      let summary = `💬 *WhatsApp Messages History (Pichle ${days} din, ${filtered.length} found):*\n\n`;
      filtered.forEach((m, i) => {
        const who = m.senderPhone === "me" ? "👤 Aap (DK)" : `📩 ${m.senderName} (+${m.senderPhone})`;
        summary += `${i + 1}. *${who}* [📅 ${m.dateStr || "Recent"}]\n   • _"${m.text.slice(0, 160)}"_\n\n`;
      });
      summary += `_📁 Source: Firestore cloud archive_\n`;

      return {
        success: true,
        count: filtered.length,
        results: filtered,
        summary: summary.trim(),
      };
    } catch (err: any) {
      console.error("[WhatsAppHistory] searchWhatsAppHistory error:", err);
      return {
        success: false,
        count: 0,
        results: [],
        summary: `WhatsApp history search karte waqt error: ${err?.message || err}`,
      };
    }
  }

  /**
   * Retrieves conversation summary and history.
   * BAILEYS FIRST: In-memory live Baileys store delivers immediate results with exact date, day, and time.
   * FIRESTORE FALLBACK: Queries Firestore only when Baileys live memory does not have the target conversation.
   */
  public async getConversationSummaryAndHistory(
    targetQuery?: string,
    limit = 30,
    daysBack = 7
  ): Promise<{ success: boolean; summary: string; count: number; unreadCount?: number }> {
    const rawQ = (targetQuery || "").toLowerCase().trim();

    // ── 0. DATE INTENT PARSING ──
    const isTodayQuery = /\b(aaj|ajj|aj|today)\b/i.test(rawQ);
    const isYesterdayQuery = /\b(kal|yesterday)\b/i.test(rawQ);
    const isParsoQuery = /\b(parso)\b/i.test(rawQ);

    let dateRange: { startTs: number; endTs: number; dateLabel: string } | undefined = undefined;
    if (isTodayQuery) {
      dateRange = baileysLiveStore.getISTDayBounds(0);
    } else if (isYesterdayQuery) {
      dateRange = baileysLiveStore.getISTDayBounds(1);
    } else if (isParsoQuery) {
      dateRange = baileysLiveStore.getISTDayBounds(2);
    }

    const startTs = dateRange ? dateRange.startTs : Date.now() - daysBack * 86400000;
    const endTs = dateRange ? dateRange.endTs : Date.now();
    const dateBadge = dateRange ? dateRange.dateLabel : `Pichle ${daysBack} din`;

    const isUnknownSearch =
      rawQ.includes("unknown") ||
      rawQ.includes("anpadh") ||
      rawQ.includes("stranger") ||
      rawQ.includes("naye number") ||
      rawQ.includes("anjaan");

    const isAllSearch =
      !rawQ ||
      rawQ === "all" ||
      rawQ === "sab" ||
      rawQ === "sabka" ||
      rawQ === "all chats" ||
      rawQ === "kisi" ||
      rawQ === "everything";

    // ── 1. GROUP CHAT CHECK ──
    const isGroupQuery =
      rawQ.includes("group") ||
      rawQ.includes("grup");

    // Clean conversational stopwords from rawQ to isolate pure contact / group name
    const cleanCandidate = rawQ
      .replace(/\b(aaj|ajj|aj|today|kal|yesterday|parso)\b/gi, " ")
      .replace(/\b(msg|message|messages|chat|chats|baat|baatein|sms)\b/gi, " ")
      .replace(/\b(kya|kya kya|hai|h|tha|the|thi|batao|bataiye|dikhao|dekho|dekh|chahiye|sunao)\b/gi, " ")
      .replace(/\b(bheja|bheje|bheji|aaya|aaye|aayi|send|sent)\b/gi, " ")
      .replace(/\b(ke|ka|ki|ko|se|ne|me|par|kuch|koi|kisi)\b/gi, " ")
      .replace(/\b(group|grup|whatsapp|wa|watsapp|wtsapp)\b/gi, " ")
      .replace(/\b(last|recent|latest|purana|purane)\b/gi, " ")
      .replace(/\b(number|no)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const candidateName = cleanCandidate || rawQ;

    if (isGroupQuery && candidateName && !isAllSearch) {
      return await this.getGroupMessagesWithSummary(candidateName, limit, daysBack);
    }

    // ── 2. CONTACT RESOLUTION ──
    let targetContactPhone = "";
    let targetContactName = "";

    if (!isUnknownSearch && !isAllSearch && candidateName) {
      try {
        const { contactsService } = await import("../contactsService");
        const contact = await contactsService.findContact(candidateName);
        if (contact && contact.id !== "owner_default" && contact.id !== "temp") {
          targetContactPhone = contact.phone;
          targetContactName = contact.name;
        } else if (candidateName.length >= 2 && !["kisi", "kya", "msg", "message", "whatsapp", "batao", "bheja", "hua"].includes(candidateName)) {
          targetContactName = candidateName;
        }
      } catch {}
    }

    // ── 3. BAILEYS LIVE STORE (PRIMARY INSTANT RETRIEVAL) ──
    if (!isUnknownSearch) {
      if (isAllSearch) {
        const activeConvs = baileysLiveStore.getAllActiveConversations(Math.min(limit, 6));
        if (activeConvs.length > 0) {
          let card = `⚡ *WhatsApp Live Conversations (Baileys Store, ${activeConvs.length} active chats):*\n\n`;
          let totalCount = 0;
          for (const conv of activeConvs) {
            totalCount += conv.messages.length;
            const last = conv.messages[conv.messages.length - 1];
            const isGrp = conv.isGroup;
            const icon = isGrp ? "👥" : "👤";
            card += `━━━━━━━━━━━━━━━━━━━━━\n`;
            card += `${icon} *${conv.displayName}* ${isGrp ? "[Group]" : ""}\n`;
            card += `📅 _Last Active: ${last.dateStr || "Abhi"}_\n\n`;

            conv.messages.slice(-5).forEach((m) => {
              if (m.senderPhone === "me") {
                card += `  👤 *Aap (DK):* _"${m.text}"_\n`;
              } else {
                card += `  📩 *${m.senderName}:* _"${m.text}"_\n`;
                if (m.botReply) {
                  card += `  🤖 *Friday (Auto-Reply):* _"${m.botReply}"_\n`;
                }
              }
            });
            card += `\n`;
          }

          card += `\n_⚡ Source: Real-time Baileys in-memory live store_\n`;

          return {
            success: true,
            count: totalCount,
            summary: card.trim(),
          };
        }
      } else {
        // Specific contact search in Baileys Live Store
        const targetLookupKey = targetContactPhone || targetContactName || candidateName;
        const liveDetailed = baileysLiveStore.getLiveMessagesDetailed(targetLookupKey, limit, dateRange);

        if (liveDetailed) {
          const displayName = targetContactName || liveDetailed.matchedChatName || candidateName;
          const displayPhone = targetContactPhone || liveDetailed.matchedChatPhone || "";
          const phoneBadge = displayPhone && displayPhone !== "me" ? ` (+${displayPhone})` : "";

          // Case A: Filtered messages exist for requested date / today!
          if (liveDetailed.hasFilteredMessages) {
            const msgs = liveDetailed.filteredMessages;

            const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
            let card = `📋 *${displayName} ke Last ${msgs.length} Messages*\n${divider}\n`;

            let lastDayKey = "";
            for (const m of msgs) {
              const ts = m.timestamp || Date.now();
              const msgDate = new Date(ts > 1e11 ? ts : ts * 1000);
              const istStr = msgDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
              const istDate = new Date(istStr);

              const dayKey = istDate.toDateString();
              if (dayKey !== lastDayKey) {
                lastDayKey = dayKey;
                const dayLabel = istDate.toLocaleDateString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                });
                card += `\n          *${dayLabel}*\n`;
              }

              const timeLabel = istDate.toLocaleTimeString("en-IN", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              });

              const isMe = m.senderPhone === "me" || m.senderName.includes("DK") || m.senderName.includes("Boss");
              const senderLabel = isMe ? "Aap" : displayName;

              card += `\n${senderLabel} — _"${m.text.replace(/\n/g, " ")}"_ (${timeLabel})\n`;
            }

            // Pending questions block
            try {
              const { dailyUpdateService } = await import("../dailyUpdateService");
              const pendingQuestions = await dailyUpdateService.getQuestionsAwaitingDK();
              const relevant = pendingQuestions.filter(
                (q) =>
                  (targetContactPhone && q.senderPhone.includes(targetContactPhone)) ||
                  (displayName && q.senderName.toLowerCase().includes(displayName.toLowerCase()))
              );
              if (relevant.length > 0) {
                card += `\n${divider}\n`;
                card += `❓ *Pending Questions Awaiting DK Reply:*\n`;
                relevant.forEach((q) => {
                  card += `  • _"${q.question}"_ (Poocha: ${q.senderName})\n`;
                });
              }
            } catch {}

            card += `\n_⚡ Source: Real-time Baileys live memory_`;

            return {
              success: true,
              count: msgs.length,
              summary: card.trim(),
            };
          }

          // Case B: Contact is known in live memory, but sent 0 messages on the requested date (e.g. today)!
          if (dateRange) {
            let card = `Boss, *${displayName}*${phoneBadge} ka ${dateBadge.toLowerCase()} koi naya WhatsApp message nahi aaya hai. ✅\n\n`;
            if (liveDetailed.lastOlderMessage) {
              const older = liveDetailed.lastOlderMessage;
              const sender = older.senderPhone === "me" ? "Aap (DK)" : older.senderName;
              card += `📅 _Unka aakhiri message [${older.dateStr || "Pehle"}] ko aaya tha:_\n`;
              card += `  • *${sender}:* _"${older.text}"_\n`;
            }
            card += `\n_⚡ Checked via real-time Baileys live socket memory_\n`;

            return {
              success: true,
              count: 0,
              summary: card.trim(),
            };
          }
        }
      }
    }

    // ── 4. FIRESTORE FALLBACK (ARCHIVE QUERY) ──
    console.log(`[WhatsAppHistory] 🔄 Target "${candidateName || targetQuery}" not in live Baileys buffer. Falling back to Firestore archive...`);

    let docs: IncomingMessage[] = [];
    try {
      const snap = await inboxCol()
        .where("timestamp", ">=", startTs)
        .where("timestamp", "<=", endTs)
        .orderBy("timestamp", "desc")
        .limit(200)
        .get();
      docs = snap.docs.map((d) => d.data() as IncomingMessage);
    } catch {
      docs = this.messageCache.filter((m) => m.timestamp >= startTs && m.timestamp <= endTs);
    }

    if (docs.length === 0 && this.messageCache.length > 0) {
      docs = this.messageCache.filter((m) => m.timestamp >= startTs && m.timestamp <= endTs);
    }

    // Backfill fetched docs into Baileys Live Store for immediate warm caching
    for (const d of docs) {
      if (d.senderPhone === "me" || d.senderPhone === "bot") {
        baileysLiveStore.recordOutgoing(d.replyJid || "", d.text, d.senderName, d.senderPhone === "bot", d.id);
      } else {
        baileysLiveStore.recordIncoming(d);
      }
    }

    let filtered = docs.filter((m) => !m.isGroup);

    if (isUnknownSearch) {
      filtered = filtered.filter((m) => m.isUnknownContact || (m.senderPhone !== "me" && !m.senderName.includes("DK")));
    } else if (targetContactPhone || targetContactName) {
      const nameL = targetContactName.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          (targetContactPhone && (m.senderPhone.includes(targetContactPhone) || m.replyJid.includes(targetContactPhone))) ||
          (nameL && m.senderName.toLowerCase().includes(nameL)) ||
          (nameL && m.senderDisplayName.toLowerCase().includes(nameL)) ||
          (nameL && m.text.toLowerCase().includes(nameL))
      );
    }

    if (filtered.length === 0) {
      if (isUnknownSearch) {
        return {
          success: true,
          count: 0,
          summary: `Boss, ${dateBadge.toLowerCase()} kisi bhi unknown number ne message nahi kiya hai! Sab clean hai. ✅`,
        };
      }

      if (dateRange) {
        // Try finding their last older message from Firestore so user is not left in the dark
        try {
          const oldSnap = await inboxCol()
            .orderBy("timestamp", "desc")
            .limit(100)
            .get();
          const oldDocs = oldSnap.docs.map((d) => d.data() as IncomingMessage);
          const nameL = (targetContactName || candidateName).toLowerCase();
          const lastOld = oldDocs.find(
            (m) =>
              !m.isGroup &&
              ((targetContactPhone && (m.senderPhone.includes(targetContactPhone) || m.replyJid.includes(targetContactPhone))) ||
               (nameL && m.senderName.toLowerCase().includes(nameL)) ||
               (nameL && m.senderDisplayName.toLowerCase().includes(nameL)))
          );
          if (lastOld) {
            const sender = lastOld.senderPhone === "me" ? "Aap (DK)" : lastOld.senderName;
            return {
              success: true,
              count: 0,
              summary: `Boss, *${targetContactName || candidateName}* ka ${dateBadge.toLowerCase()} koi naya message nahi aaya hai. ✅\n\n📅 _Unka aakhiri message [${lastOld.dateStr || "Pehle"}] ko tha:_\n• *${sender}:* _"${lastOld.text}"_\n\n_📁 Source: Firestore cloud archive_`,
            };
          }
        } catch {}

        return {
          success: true,
          count: 0,
          summary: `Boss, *${targetContactName || candidateName}* ka ${dateBadge.toLowerCase()} koi WhatsApp message nahi mila. ✅`,
        };
      }

      return {
        success: true,
        count: 0,
        summary: `Boss, "${targetContactName || targetQuery || "contact"}" se ${dateBadge.toLowerCase()} koi message nahi mila.`,
      };
    }

    const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

    // Build the heading — use the main contact name if it's a single-contact result
    const mainContactName = targetContactName || candidateName || "Contact";
    let card = `📋 *${mainContactName} ke Last ${Math.min(filtered.length, limit)} Messages*\n${divider}\n`;

    // Group by conversation thread (contact phone → msgs)
    const grouped = new Map<string, IncomingMessage[]>();
    for (const msg of filtered) {
      const key = msg.senderPhone === "me" ? msg.replyJid : msg.senderPhone || msg.senderName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(msg);
    }

    for (const [key, msgs] of grouped.entries()) {
      const sorted = msgs.sort((a, b) => a.timestamp - b.timestamp);
      const top = sorted[0];
      const convName = top.senderPhone === "me" ? mainContactName : (top.senderName || mainContactName);

      // If multiple contacts, add a sub-header
      if (grouped.size > 1) {
        card += `\n━━━━━━━━━━━━━━━━━━━━━\n👤 *${convName}*\n`;
      }

      let lastDayKey = "";
      for (const m of sorted.slice(-limit)) {
        const ts = m.timestamp || Date.now();
        const msgDate = new Date(ts > 1e11 ? ts : ts * 1000);
        const istStr = msgDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        const istDate = new Date(istStr);

        const dayKey = istDate.toDateString();
        if (dayKey !== lastDayKey) {
          lastDayKey = dayKey;
          const dayLabel = istDate.toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            weekday: "long",
            day: "numeric",
            month: "short",
          });
          card += `\n          *${dayLabel}*\n`;
        }

        const timeLabel = istDate.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

        const isMe = m.senderPhone === "me" || m.senderPhone === "bot" ||
          m.senderName.includes("DK") || m.senderName.includes("Boss");
        const senderLabel = isMe ? "Aap" : convName;

        card += `\n${senderLabel} — _"${m.text.replace(/\n/g, " ")}"_ (${timeLabel})\n`;
      }
    }

    try {
      const { dailyUpdateService } = await import("../dailyUpdateService");
      const pendingQuestions = await dailyUpdateService.getQuestionsAwaitingDK();
      if (pendingQuestions.length > 0) {
        card += `━━━━━━━━━━━━━━━━━━━━━\n`;
        card += `❓ *Pending Questions Awaiting Your Reply (${pendingQuestions.length}):*\n`;
        pendingQuestions.forEach((q, idx) => {
          card += `  ${idx + 1}. *${q.senderName}* (+${q.senderPhone}): _"${q.question}"_\n`;
        });
        card += `\n_(Boss, aap inka jawab 'Name- <reply>' karke de sakte hain, main forward kar dungi!)_\n`;
      }
    } catch {}

    card += `\n_📁 Source: Firestore cloud archive_\n`;

    return {
      success: true,
      count: filtered.length,
      summary: card.trim(),
    };
  }

  /**
   * Retrieves messages and executive summary for a specific WhatsApp group.
   * BAILEYS FIRST: Checks live memory first, then falls back to Firestore archive.
   */
  public async getGroupMessagesWithSummary(
    groupNameQuery?: string,
    limit = 20,
    daysBack = 7
  ): Promise<{ success: boolean; count: number; groupName: string; summary: string; messages: any[] }> {
    const rawQ = (groupNameQuery || "").toLowerCase().trim();
    const cleanQ = rawQ.replace(/group|grup|ka|ki|ke|last|msg|message|messages|batao|bataiye|chahiye/gi, "").trim();

    // ── 1. BAILEYS LIVE GROUP FIRST ──
    const liveGroup = baileysLiveStore.getLiveGroupMessages(cleanQ || rawQ, limit);
    if (liveGroup && liveGroup.messages.length > 0) {
      const targetGroupName = liveGroup.groupName || groupNameQuery || "WhatsApp Group";
      let summaryCard = `⚡👥 *Group Conversation: ${targetGroupName}* (Live Baileys Store, ${liveGroup.messages.length} msgs):\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      liveGroup.messages.forEach((m, idx) => {
        const time = m.dateStr || "Recent";
        const sender = m.senderPhone === "me" ? "Aap (DK)" : m.senderName;
        summaryCard += `${idx + 1}. [${time}] *${sender}:* _"${m.text}"_\n`;
      });
      summaryCard += `\n_⚡ Source: Real-time Baileys live memory_\n`;

      return {
        success: true,
        count: liveGroup.messages.length,
        groupName: targetGroupName,
        summary: summaryCard.trim(),
        messages: liveGroup.messages.map((m) => ({ sender: m.senderName, text: m.text, time: m.dateStr, phone: m.senderPhone })),
      };
    }

    // ── 2. FIRESTORE ARCHIVE FALLBACK ──
    console.log(`[WhatsAppHistory] 🔄 Group "${groupNameQuery}" not in live Baileys buffer. Falling back to Firestore archive...`);
    const startTs = Date.now() - daysBack * 86400000;

    let docs: IncomingMessage[] = [];
    try {
      const snap = await inboxCol().orderBy("timestamp", "desc").limit(200).get();
      docs = snap.docs
        .map((d) => d.data() as IncomingMessage)
        .filter((m) => m.isGroup && m.timestamp >= startTs);
    } catch {
      docs = this.messageCache.filter((m) => m.isGroup && m.timestamp >= startTs);
    }

    if (docs.length === 0 && this.messageCache.length > 0) {
      docs = this.messageCache.filter((m) => m.isGroup && m.timestamp >= startTs);
    }

    // Backfill into Baileys Live Store
    for (const d of docs) {
      baileysLiveStore.recordIncoming(d);
    }

    let matching = docs;
    if (cleanQ) {
      matching = docs.filter(
        (m) =>
          (m.groupName && m.groupName.toLowerCase().includes(cleanQ)) ||
          (m.groupId && m.groupId.toLowerCase().includes(cleanQ))
      );
    }

    if (matching.length === 0) {
      const availableGroups = Array.from(new Set(this.messageCache.filter((m) => m.isGroup && m.groupName).map((m) => m.groupName!)));
      return {
        success: false,
        count: 0,
        groupName: groupNameQuery || "Group",
        summary: `Boss, "${groupNameQuery || "Group"}" se koi messages nahi mile.${availableGroups.length > 0 ? `\nAvailable active groups in memory: ${availableGroups.join(", ")}` : ""}`,
        messages: [],
      };
    }

    const targetGroupName = matching[0].groupName || "WhatsApp Group";
    const sorted = matching.sort((a, b) => a.timestamp - b.timestamp).slice(-limit);

    let summaryCard = `👥 *Group Conversation: ${targetGroupName}* (Pichle ${daysBack} din, ${matching.length} msgs recorded):\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    sorted.forEach((m, idx) => {
      const time = m.dateStr || "Recent";
      const sender = m.senderPhone === "me" ? "Aap (DK)" : m.senderName;
      summaryCard += `${idx + 1}. [${time}] *${sender}:* _"${m.text}"_\n`;
    });
    summaryCard += `\n_📁 Source: Firestore cloud archive_\n`;

    return {
      success: true,
      count: matching.length,
      groupName: targetGroupName,
      summary: summaryCard.trim(),
      messages: sorted.map((m) => ({ sender: m.senderName, text: m.text, time: m.dateStr, phone: m.senderPhone })),
    };
  }
}

export const whatsappHistoryEngine = new WhatsAppHistoryEngine();
