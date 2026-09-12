import { db } from "../firebaseAdmin";
import { IncomingMessage } from "./whatsappTypes";

const inboxCol = () => db.collection("whatsapp_inbox");

export class WhatsAppHistoryEngine {
  private messageCache: IncomingMessage[] = []; // RAM — max 500, newest first
  private isWarmedUp = false;
  private warmUpPromise: Promise<void> | null = null;

  constructor() {
    this.warmUpCacheFromFirestore().catch(() => {});
  }

  /**
   * Preloads latest messages from Firestore so that server restarts retain active memory.
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
          }
          this.messageCache.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          if (this.messageCache.length > 500) {
            this.messageCache = this.messageCache.slice(0, 500);
          }
          console.log(`[WhatsAppHistory] 🔥 Cache warmed up with ${fetched.length} persistent messages from Firestore.`);
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
    if (!this.messageCache.some((m) => m.id === msg.id)) {
      this.messageCache.unshift(msg);
      if (this.messageCache.length > 500) {
        this.messageCache = this.messageCache.slice(0, 500);
      }
    }
  }

  /**
   * Returns recent messages from a specific group in chronological order
   */
  public getRecentGroupMessages(groupJid: string, limit: number = 25): IncomingMessage[] {
    const cleanJid = (groupJid || "").trim();
    return this.messageCache
      .filter((m) => m.isGroup && (m.groupId === cleanJid || m.replyJid === cleanJid))
      .slice(0, limit)
      .reverse();
  }

  /**
   * Retrieves persistent conversation context between Boss (DK) and Friday.
   * If cache is cold or insufficient, queries Firestore for historical turns.
   */
  public async getRecentBossContext(replyJid = "", limit = 15): Promise<IncomingMessage[]> {
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
   * Retrieves persistent conversation context for a specific contact phone or JID.
   */
  public async getRecentContactContext(senderPhone: string, limit = 8): Promise<IncomingMessage[]> {
    await this.warmUpCacheFromFirestore();
    const clean = (senderPhone || "").replace(/\D/g, "");

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
          .limit(limit * 2)
          .get();
        if (!snap.empty) {
          const docs = snap.docs.map((d) => d.data() as IncomingMessage);
          for (const d of docs) {
            if (isContactMatch(d) && !matched.some((m) => m.id === d.id)) {
              matched.push(d);
            }
          }
        }
      } catch {}
    }

    return matched
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-limit);
  }

  /**
   * Formats a list of messages into a clean chronological context string.
   */
  public formatConversationTranscript(messages: IncomingMessage[]): string {
    if (!messages || messages.length === 0) return "";
    return messages
      .map((m) => {
        const sender = m.senderPhone === "bot" || m.senderName.toLowerCase().includes("friday")
          ? "Friday (You)"
          : (m.senderName.includes("Boss") || m.senderName.includes("DK") || m.senderPhone === "me" ? "Boss (DK)" : m.senderName);
        return `• [${m.dateStr || "Recent"}] ${sender}: "${m.text}"`;
      })
      .join("\n");
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

  public parseDateFilter(dateFilter?: string): { startTs: number; endTs: number } {
    const now = Date.now();
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const endOfDay = (d: Date) => startOfDay(d) + 86400000 - 1;
    const atHour = (d: Date, hour: number, minute = 0) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0).getTime();

    if (!dateFilter) return { startTs: now - 48 * 60 * 60 * 1000, endTs: now };

    const f = dateFilter.toLowerCase().trim();
    const today = new Date();

    if (f === "aaj" || f === "today") {
      return { startTs: startOfDay(today), endTs: endOfDay(today) };
    }
    if (f === "kal" || f === "yesterday") {
      const d = new Date(today); d.setDate(today.getDate() - 1);
      return { startTs: startOfDay(d), endTs: endOfDay(d) };
    }

    const dinMatch = f.match(/(\d+)\s*(?:din|days?)\s*(?:pehle|ago)/);
    if (dinMatch) {
      const daysAgo = parseInt(dinMatch[1]);
      const d = new Date(today); d.setDate(today.getDate() - daysAgo);
      return { startTs: startOfDay(d), endTs: endOfDay(d) };
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

      if (isMorning) return { startTs: atHour(baseDay, 5), endTs: atHour(baseDay, 12) };
      if (isAfternoon) return { startTs: atHour(baseDay, 12), endTs: atHour(baseDay, 17) };
      if (isEvening) return { startTs: atHour(baseDay, 17), endTs: atHour(baseDay, 21) };
      if (isNight) return { startTs: atHour(baseDay, 21), endTs: endOfDay(baseDay) };
    }

    if (f.includes("week") || f.includes("hafte")) {
      return { startTs: now - 7 * 86400000, endTs: now };
    }
    if (f.includes("month") || f.includes("mahine")) {
      return { startTs: now - 30 * 86400000, endTs: now };
    }

    if (/last|latest|abhi|recent/.test(f)) {
      return { startTs: 0, endTs: now };
    }

    return { startTs: 0, endTs: now };
  }

  public async getMessages(params: {
    messageType?: "personal" | "group" | "all";
    senderName?: string;
    groupName?: string;
    dateFilter?: string;
    limit?: number;
  } = {}): Promise<IncomingMessage[]> {
    const effectiveDateFilter = params.dateFilter || (params.senderName || params.groupName ? "all" : undefined);
    const { startTs, endTs } = params.dateFilter
      ? this.parseDateFilter(params.dateFilter)
      : (effectiveDateFilter === "all" ? { startTs: 0, endTs: Date.now() } : this.parseDateFilter(undefined));

    const isHistoricalQuery = !!params.dateFilter || !!params.senderName || !!params.groupName;

    let messages: IncomingMessage[];

    if (isHistoricalQuery) {
      messages = await this.fetchFromFirestore(startTs, endTs);
    } else {
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      messages = this.messageCache.filter((m) => m.timestamp >= cutoff);
      if (messages.length === 0) {
        messages = await this.fetchFromFirestore(cutoff, Date.now());
      }
    }

    const type = params.messageType || "all";
    if (type === "personal") messages = messages.filter((m) => !m.isGroup);
    if (type === "group") messages = messages.filter((m) => m.isGroup);

    if (params.senderName) {
      const q = params.senderName.toLowerCase();
      messages = messages.filter(
        (m) =>
          m.senderName.toLowerCase().includes(q) ||
          m.senderDisplayName.toLowerCase().includes(q)
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
        const who = m.senderPhone === "me" ? "👤 Aap (Sent)" : `📩 ${m.senderName} (+${m.senderPhone})`;
        summary += `${i + 1}. *${who}* [📅 ${m.dateStr}]\n   • _"${m.text.slice(0, 160)}"_\n\n`;
      });

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

  public async getConversationSummaryAndHistory(
    targetQuery?: string,
    limit = 30,
    daysBack = 7
  ): Promise<{ success: boolean; summary: string; count: number; unreadCount?: number }> {
    const rawQ = (targetQuery || "").toLowerCase().trim();
    const startTs = Date.now() - daysBack * 86400000;

    let docs: IncomingMessage[] = [];
    try {
      const snap = await inboxCol().where("timestamp", ">=", startTs).orderBy("timestamp", "desc").limit(200).get();
      docs = snap.docs.map((d) => d.data() as IncomingMessage);
    } catch {
      docs = this.messageCache.filter((m) => m.timestamp >= startTs);
    }

    if (docs.length === 0 && this.messageCache.length > 0) {
      docs = this.messageCache.filter((m) => m.timestamp >= startTs);
    }

    if (docs.length === 0) {
      return {
        success: true,
        count: 0,
        summary: `Boss, pichle ${daysBack} dino me WhatsApp par koi incoming/outgoing message nahi mila.`,
      };
    }

    const isUnknownSearch =
      rawQ.includes("unknown") ||
      rawQ.includes("anpadh") ||
      rawQ.includes("stranger") ||
      rawQ.includes("naye number") ||
      rawQ.includes("anjaan");

    let targetContactPhone = "";
    let targetContactName = "";

    const nameMatch = rawQ.match(/(?:kya\s+)?([a-zA-Z0-9\u0900-\u097F\s\-_\.]+?)\s*(?:ne\s*msg|ne\s*message|se\s*kya|ka\s*msg|ka\s*message|se\s*baat|ne\s*kya|group|grup)/i);
    const candidateName = nameMatch ? nameMatch[1].trim() : rawQ;

    const isGroupQuery =
      rawQ.includes("group") ||
      rawQ.includes("grup") ||
      docs.some((m) => m.isGroup && (m.groupName?.toLowerCase().includes(candidateName.toLowerCase()) || m.groupId?.toLowerCase().includes(candidateName.toLowerCase())));

    if (isGroupQuery) {
      return await this.getGroupMessagesWithSummary(candidateName, limit, daysBack);
    }

    if (!isUnknownSearch && candidateName && candidateName !== "all" && candidateName !== "sab" && candidateName !== "kisi" && !candidateName.includes("kisi ne")) {
      const { contactsService } = await import("../contactsService");
      const contact = await contactsService.findContact(candidateName);
      if (contact && contact.id !== "owner_default" && contact.id !== "temp") {
        targetContactPhone = contact.phone;
        targetContactName = contact.name;
      } else if (candidateName.length >= 2 && !["kisi", "kya", "msg", "message", "whatsapp", "batao", "bheja", "hua"].includes(candidateName)) {
        targetContactName = candidateName;
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
          summary: `Boss, pichle ${daysBack} dino me kisi bhi unknown number ne message nahi kiya hai! Sab clean hai. ✅`,
        };
      }
      return {
        success: true,
        count: 0,
        summary: `Boss, "${targetContactName || targetQuery || "contact"}" se pichle ${daysBack} dino me koi message nahi aaya hai.`,
      };
    }

    const grouped = new Map<string, IncomingMessage[]>();
    for (const msg of filtered) {
      const key = msg.senderPhone === "me" ? msg.replyJid : msg.senderPhone || msg.senderName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(msg);
    }

    let card = `📱 *WhatsApp Conversation Breakdown (Pichle ${daysBack} din, ${filtered.length} messages found):*\n\n`;

    for (const [key, msgs] of grouped.entries()) {
      const sorted = msgs.sort((a, b) => a.timestamp - b.timestamp);
      const top = sorted[0];
      const displayName = top.senderPhone === "me" ? "Direct Chat" : top.senderName;
      const displayPhone = top.senderPhone === "me" ? "" : `(+${top.senderPhone})`;
      const statusTag = top.isUnknownContact ? " [⚠️ UNKNOWN NUMBER]" : " [👤 SAVED CONTACT]";

      card += `━━━━━━━━━━━━━━━━━━━━━\n`;
      card += `👤 *${displayName}* ${displayPhone}${statusTag}\n`;
      card += `📅 _Last Active: ${sorted[sorted.length - 1].dateStr}_\n\n`;

      sorted.slice(-6).forEach((m) => {
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

    return {
      success: true,
      count: filtered.length,
      summary: card.trim(),
    };
  }

  /**
   * Retrieves messages and executive summary for a specific WhatsApp group
   */
  public async getGroupMessagesWithSummary(
    groupNameQuery?: string,
    limit = 20,
    daysBack = 7
  ): Promise<{ success: boolean; count: number; groupName: string; summary: string; messages: any[] }> {
    const rawQ = (groupNameQuery || "").toLowerCase().trim();
    const cleanQ = rawQ.replace(/group|grup|ka|ki|ke|last|msg|message|messages|batao|bataiye|chahiye/gi, "").trim();
    const startTs = Date.now() - daysBack * 86400000;

    let docs: IncomingMessage[] = [];
    try {
      const snap = await inboxCol().where("timestamp", ">=", startTs).where("isGroup", "==", true).orderBy("timestamp", "desc").limit(200).get();
      docs = snap.docs.map((d) => d.data() as IncomingMessage);
    } catch {
      docs = this.messageCache.filter((m) => m.isGroup && m.timestamp >= startTs);
    }

    if (docs.length === 0 && this.messageCache.length > 0) {
      docs = this.messageCache.filter((m) => m.isGroup && m.timestamp >= startTs);
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
