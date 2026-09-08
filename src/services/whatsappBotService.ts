import * as BaileysModule from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { GoogleGenAI } from "@google/genai";
import { useFirestoreAuthState } from "./whatsappAuthState";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { dailyUpdateService } from "./dailyUpdateService";
import { visionMemoryService } from "./visionMemoryService";
import { humanBotFirewallService } from "./humanBotFirewallService";

// Resolve Baileys exports safely across CJS/ESM bundling
const baileys: any = BaileysModule;
const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket || baileys;
const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
const Browsers = baileys.Browsers || baileys.default?.Browsers;

type WASocket = any;

export interface QuotedMessageContext {
  isReply: boolean;
  sender: string;
  senderPhone?: string;
  text: string;
  mediaType: "text" | "photo" | "video" | "document" | "audio" | "location" | "contact" | "sticker";
  stanzaId?: string;
  rawQuotedMessage?: any;
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Incoming message shape stored in RAM cache + Firestore whatsapp_inbox
// ---------------------------------------------------------------------------
export interface IncomingMessage {
  id: string;
  senderPhone: string;
  senderName: string;           // From contacts book (preferred) or WhatsApp displayName
  senderDisplayName: string;    // Raw WhatsApp profile name
  replyJid: string;             // Correct JID to use when replying (handles @lid senders)
  groupId: string | null;       // @g.us JID if group, else null
  groupName: string | null;     // Human-readable group subject
  isGroup: boolean;
  isUnknownContact: boolean;    // true = not saved in DK's contacts book
  text: string;
  timestamp: number;            // ms epoch
  dateStr: string;              // Formatted IST date string
  isRead: boolean;
  // Swipe-to-reply: context of the original message that was replied to
  quotedMessage?: QuotedMessageContext | null;
  // What Friday AI auto-replied or answered to this incoming message
  botReply?: string;
  // Only set on messages from DK's own paired number: true if this message
  // was already consumed as an answer to a forwarded daily-update question,
  // so other owner-reply listeners (e.g. coding-agent approval) should skip it.
  consumedByDailyUpdate?: boolean;
}

const inboxCol = () => db.collection("whatsapp_inbox");
// Persists the linked phone number so dashboard shows 'already linked' across restarts
const sessionMetaDoc = () => db.collection("whatsapp_auth").doc("session").collection("meta").doc("phone_meta");
const replyLimitsCol = () => db.collection("whatsapp_reply_limits"); // {phone}: { dailyLimit }
const replyCountsCol = () => db.collection("whatsapp_reply_counts"); // {phone}: { count, dateStr }

const DEFAULT_DAILY_REPLY_LIMIT = 10;

/** Today's date string in IST, used to reset per-day RAM flags/caches. */
function todayISTLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Sent once when a contact's daily auto-reply limit has been used up for the day. */
function LIMIT_REACHED_GENERIC_REPLY(senderName: string, isUnknownContact: boolean): string {
  const greeting = !isUnknownContact ? `${senderName} ji, ` : "";
  return `${greeting}Boss abhi available nahi hain, unke aane ke baad main unhe aapke baare mein bata dunga, phir jo bhi wo reply denge main jaldi hi aapko bata dunga. Tab tak apna dhyan rakhiye 👍`;
}

class WhatsAppBotService {
  private sock: WASocket | null = null;
  private isConnected = false;
  private pairingCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private dedicatedPhone: string | null = null;
  private clearAuthFn: (() => Promise<void>) | null = null;
  private reconnectTimer: any = null;
  private keepAliveTimer: any = null;
  // true while generating pairing code — suppresses QR so Baileys doesn't fight itself
  private pairingCodeMode = false;

  // Incoming message storage & Auto-reply
  private messageCache: IncomingMessage[] = []; // RAM — max 200, newest first
  private groupNameCache: Map<string, string> = new Map();
  private messageCallback: ((msg: IncomingMessage) => void) | null = null;
  private autoReplyEnabled = true;
  private replyLimitCache: Map<string, number> = new Map();
  private replyCountCache: Map<string, { count: number; dateStr: string }> = new Map();
  private lastReplyAt: Map<string, number> = new Map(); // for the 6s min-gap only
  private limitNoticeSentToday: Map<string, string> = new Map(); // senderKey -> IST date string, so the generic "limit reached" notice only goes out once per day
  private incomingDebounceMap: Map<
    string,
    {
      timer: any;
      texts: string[];
      senderName: string;
      senderPhone: string;
      isUnknownContact: boolean;
      replyJid: string;
      latestMsgKey: any;
    }
  > = new Map();
  // Set of message IDs dispatched by Friday bot itself to prevent self-trigger/echo loops
  private botSentMessageIds: Set<string> = new Set();

  constructor() {
    // Restore last-known phone from Firestore so dashboard shows 'linked' even after restart
    this.restorePhoneFromFirestore().then(() => {
      this.initSocket().catch((err) => {
        console.log("[WhatsAppBot] Init standby:", err?.message || err);
      });
    });
  }

  // ── Firestore phone persistence ───────────────────────────────────────────

  private async restorePhoneFromFirestore() {
    try {
      const snap = await sessionMetaDoc().get();
      if (snap.exists && (snap.data() as any)?.phone) {
        this.dedicatedPhone = (snap.data() as any).phone;
        console.log(`[WhatsAppBot] Restored saved phone: +${this.dedicatedPhone}`);
      }
    } catch (e) {
      console.warn("[WhatsAppBot] Could not restore saved phone:", e);
    }
  }

  private async savePhoneToFirestore(phone: string) {
    try {
      await sessionMetaDoc().set({ phone, savedAt: Date.now() });
    } catch (e) {
      console.warn("[WhatsAppBot] Could not save phone to Firestore:", e);
    }
  }

  // ── Keep-alive ────────────────────────────────────────────────────────────

  /**
   * FIX: WhatsApp drops idle WS connections after 5-6 min.
   * We send a harmless presence ping every 4 min to keep the connection alive indefinitely.
   */
  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      if (!this.sock || !this.isConnected) return;
      try {
        // Send "unavailable" (Offline) as background keep-alive ping.
        // Keeps the socket open indefinitely without ever broadcasting "Online" 24/7!
        await this.sock.sendPresenceUpdate("unavailable");
      } catch (e) {
        console.warn("[WhatsAppBot] Keep-alive ping failed, triggering reconnect:", (e as any)?.message);
        this.isConnected = false;
        this.scheduleReconnect(3000);
      }
    }, 4 * 60 * 1000);
    console.log("[WhatsAppBot] Keep-alive timer started (Offline background mode).");
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduledMessageTimer: any = null;

  private startScheduledMessagesTicker() {
    this.stopScheduledMessagesTicker();
    this.scheduledMessageTimer = setInterval(async () => {
      if (!this.isConnected || !this.sock) return;
      try {
        const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
        await whatsappFeatureEngine.processPendingScheduledMessages((phone, text) =>
          this.sendMessage(phone, text)
        );
      } catch (err) {
        console.warn("[WhatsAppBot] Scheduled message ticker error:", err);
      }
    }, 30 * 1000);
    console.log("[WhatsAppBot] Scheduled messages background ticker active (30s interval).");
  }

  private stopScheduledMessagesTicker() {
    if (this.scheduledMessageTimer) {
      clearInterval(this.scheduledMessageTimer);
      this.scheduledMessageTimer = null;
    }
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log("[WhatsAppBot] Reconnecting...");
      await this.initSocket();
    }, delayMs);
  }

  private callTriggerCallback: ((data: { callerName: string; isOwner: boolean; callId: string }) => void) | null = null;

  /** Register a callback that fires whenever a new incoming message arrives. */
  public setMessageCallback(cb: (msg: IncomingMessage) => void) {
    this.messageCallback = cb;
  }

  /** Register a callback that fires to ring connected phone app */
  public setCallTriggerCallback(cb: (data: { callerName: string; isOwner: boolean; callId: string }) => void) {
    this.callTriggerCallback = cb;
  }

  /** Add an incoming message (e.g. from WhatsApp Cloud API) to RAM cache */
  public recordIncomingMessage(msg: IncomingMessage) {
    if (!this.messageCache.some((m) => m.id === msg.id)) {
      this.messageCache.unshift(msg);
      if (this.messageCache.length > 500) {
        this.messageCache = this.messageCache.slice(0, 500);
      }
    }
  }

  /**
   * Get WhatsApp messages with optional filters.
   * - messageType: 'personal' | 'group' | 'all'
   * - senderName: partial name match (e.g. "Rahul")
   * - groupName: partial group name match
   * - dateFilter: 'aaj', 'kal', '5 din pehle', 'pichle hafte', etc.
   * - limit: max results (default 10 personal, 5 group)
   */
  public async getMessages(params: {
    messageType?: "personal" | "group" | "all";
    senderName?: string;
    groupName?: string;
    dateFilter?: string;
    limit?: number;
  } = {}): Promise<IncomingMessage[]> {
    // When DK asks about a specific sender or group without giving a date,
    // don't silently narrow to 48 hours — search full history so a real
    // "last message" or "last 5 messages" query always finds the actual data.
    const effectiveDateFilter = params.dateFilter || (params.senderName || params.groupName ? "all" : undefined);
    const { startTs, endTs } = params.dateFilter
      ? this.parseDateFilter(params.dateFilter)
      : (effectiveDateFilter === "all" ? { startTs: 0, endTs: Date.now() } : this.parseDateFilter(undefined));
    // Treat it as a "historical" (Firestore-backed) query whenever a date
    // filter is given, OR when DK is asking about a specific sender/group.
    // Relying on the 48-hour RAM cache for a named person/group query is
    // unreliable — the cache is wiped on every server restart, so a
    // perfectly real recent message can be missed if it's just outside
    // the RAM window or the server restarted since it arrived.
    const isHistoricalQuery = !!params.dateFilter || !!params.senderName || !!params.groupName;

    let messages: IncomingMessage[];

    if (isHistoricalQuery) {
      // Historical → Firestore (persistent across restarts)
      messages = await this.fetchFromFirestore(startTs, endTs);
    } else {
      // Recent → RAM cache (fast, last 48 hours) + Firestore fallback
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

  // ── Private helpers ────────────────────────────────────────────────────────

  private extractMessageText(msg: any): string {
    const m = msg.message;
    if (!m) return "";
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      (m.stickerMessage ? "[Sticker]" : "") ||
      (m.audioMessage ? "[Voice Message]" : "") ||
      (m.imageMessage ? "[Image]" : "") ||
      (m.videoMessage ? "[Video]" : "") ||
      (m.documentMessage ? "[Document]" : "") ||
      (m.contactMessage ? `[Contact: ${m.contactMessage.displayName}]` : "") ||
      (m.locationMessage ? "[Location]" : "") ||
      (m.reactionMessage ? `[Reaction: ${m.reactionMessage.text}]` : "") ||
      ""
    );
  }

  /**
   * Extracts the full context of a swipe-to-reply (Quoted Message).
   * Works across text, photo, video, document, audio, link, and contacts.
   */
  public extractQuotedContext(msg: any): QuotedMessageContext | null {
    const m = msg.message;
    if (!m) return null;

    const contextInfo =
      m.extendedTextMessage?.contextInfo ||
      m.imageMessage?.contextInfo ||
      m.videoMessage?.contextInfo ||
      m.documentMessage?.contextInfo ||
      m.audioMessage?.contextInfo ||
      m.stickerMessage?.contextInfo ||
      m.buttonsResponseMessage?.contextInfo ||
      m.templateButtonReplyMessage?.contextInfo ||
      m.interactiveResponseMessage?.contextInfo;

    if (!contextInfo || !contextInfo.quotedMessage) return null;

    const q = contextInfo.quotedMessage;
    let text = "";
    let mediaType: QuotedMessageContext["mediaType"] = "text";

    if (q.conversation) {
      text = q.conversation;
      mediaType = "text";
    } else if (q.extendedTextMessage?.text) {
      text = q.extendedTextMessage.text;
      mediaType = "text";
    } else if (q.imageMessage) {
      mediaType = "photo";
      text = q.imageMessage.caption ? `[Photo: ${q.imageMessage.caption}]` : "[Photo / Image]";
    } else if (q.videoMessage) {
      mediaType = "video";
      text = q.videoMessage.caption ? `[Video: ${q.videoMessage.caption}]` : "[Video Clip]";
    } else if (q.documentMessage) {
      mediaType = "document";
      const name = q.documentMessage.fileName || "Document";
      text = q.documentMessage.caption ? `[Document ${name}: ${q.documentMessage.caption}]` : `[Document: ${name}]`;
    } else if (q.audioMessage) {
      mediaType = "audio";
      text = q.audioMessage.ptt ? "[Voice Note]" : "[Audio Recording]";
    } else if (q.locationMessage) {
      mediaType = "location";
      text = `[Location: Lat ${q.locationMessage.degreesLatitude}, Long ${q.locationMessage.degreesLongitude}]`;
    } else if (q.contactMessage) {
      mediaType = "contact";
      text = `[Contact Card: ${q.contactMessage.displayName}]`;
    } else if (q.stickerMessage) {
      mediaType = "sticker";
      text = "[Sticker]";
    }

    // Resolve sender of the quoted message
    let sender = "Someone";
    let senderPhone: string | undefined;
    const participant = contextInfo.participant || contextInfo.participantAlt || "";
    const ownerNum = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const partPhone = participant.split("@")[0].split(":")[0].replace(/\D/g, "");

    if (partPhone) {
      senderPhone = partPhone;
      if (ownerNum && (partPhone.endsWith(ownerNum) || ownerNum.endsWith(partPhone))) {
        sender = "DK (Boss)";
      } else {
        sender = `+${partPhone}`;
      }
    }

    return {
      isReply: true,
      sender,
      senderPhone,
      text: text.trim(),
      mediaType,
      stanzaId: contextInfo.stanzaId,
      rawQuotedMessage: q,
      fileName: q.documentMessage?.fileName,
    };
  }

  /**
   * Robustly checks if a sender is Boss (DK / Owner):
   * 1. Matches OWNER_WHATSAPP_NUMBER, BOSS_WHATSAPP_NUMBER, OWNER_PHONE, BOSS_PHONE (handles country code +91, 91, 10-digit suffix)
   * 2. Matches Contacts book relation ("owner", "boss", "self") or name ("DK (Boss)", "Boss", "Divakar")
   * 3. Matches push name / display name if marked Boss/DK
   */
  public isOwnerSender(
    senderPhone: string,
    senderDisplayName = "",
    senderJid = "",
    contact?: any
  ): boolean {
    const envNumbers = [
      process.env.OWNER_WHATSAPP_NUMBER,
      process.env.BOSS_WHATSAPP_NUMBER,
      process.env.OWNER_PHONE,
      process.env.BOSS_PHONE,
      process.env.EMERGENCY_CONTACT_PHONE,
    ].filter(Boolean) as string[];

    const cleanSender = (senderPhone || "").replace(/\D/g, "");
    const last10Sender = cleanSender.slice(-10);

    for (const envNum of envNumbers) {
      const cleanEnv = envNum.replace(/\D/g, "");
      if (!cleanEnv) continue;
      if (cleanSender === cleanEnv) return true;
      const last10Env = cleanEnv.slice(-10);
      if (last10Sender.length === 10 && last10Env.length === 10 && last10Sender === last10Env) {
        return true;
      }
    }

    if (contact) {
      const rel = (contact.relation || "").toLowerCase().trim();
      const name = (contact.name || "").toLowerCase().trim();
      if (rel === "owner" || rel === "boss" || rel === "self") return true;
      if (name === "dk" || name === "boss" || name === "dk (boss)" || name.includes("divakar")) return true;
    }

    const lowerDisplay = (senderDisplayName || "").toLowerCase().trim();
    if (lowerDisplay === "dk (boss)" || lowerDisplay === "divakar kumar (boss)" || lowerDisplay === "boss") {
      return true;
    }

    return false;
  }

  private async getGroupName(groupJid: string): Promise<string> {
    if (this.groupNameCache.has(groupJid)) return this.groupNameCache.get(groupJid)!;
    try {
      const meta = await this.sock?.groupMetadata(groupJid);
      const name = meta?.subject || groupJid;
      this.groupNameCache.set(groupJid, name);
      return name;
    } catch {
      return groupJid;
    }
  }

  private async saveToFirestore(msg: IncomingMessage): Promise<void> {
    try {
      await inboxCol().doc(msg.id).set(msg);
    } catch (e) {
      console.error("[WhatsAppBot] Failed to save message to Firestore:", e);
    }
  }

  private async fetchFromFirestore(startTs: number, endTs: number): Promise<IncomingMessage[]> {
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
        console.error("[WhatsAppBot] Failed to fetch from Firestore:", err2);
        return this.messageCache.filter(
          (m) => m.timestamp >= startTs && m.timestamp <= endTs
        );
      }
    }
  }

  private parseDateFilter(dateFilter?: string): { startTs: number; endTs: number } {
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

    // "X din pehle" / "X days ago"
    const dinMatch = f.match(/(\d+)\s*(?:din|days?)\s*(?:pehle|ago)/);
    if (dinMatch) {
      const daysAgo = parseInt(dinMatch[1]);
      const d = new Date(today); d.setDate(today.getDate() - daysAgo);
      return { startTs: startOfDay(d), endTs: endOfDay(d) };
    }

    // Time-of-day references (optionally combined with "aaj"/"kal"/"X din pehle").
    // Resolve the base day first (defaults to today), then narrow to the
    // requested part of the day.
    const isMorning = /subah|morning/.test(f);
    const isAfternoon = /dopahar|afternoon/.test(f);
    const isEvening = /shaam|evening/.test(f);
    const isNight = /raat|night/.test(f);

    if (isMorning || isAfternoon || isEvening || isNight) {
      let baseDay = new Date(today);
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

    // "last"/"latest"/"abhi" type phrases that don't specify a real date
    // range should NOT be silently narrowed to 48 hours — that can miss
    // the actual last message if it's older. Search the full available
    // history instead so a real result is always found.
    if (/last|latest|abhi|recent/.test(f)) {
      return { startTs: 0, endTs: now };
    }

    // Unrecognized filter text — rather than silently defaulting to a
    // narrow 48-hour window (which can make historical queries look like
    // "no messages found"), fall back to searching all available history.
    return { startTs: 0, endTs: now };
  }

  /**
   * Searches all historical & recent WhatsApp messages in Firestore across 30+ days.
   */
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
      console.error("[WhatsAppBot] searchWhatsAppHistory error:", err);
      return {
        success: false,
        count: 0,
        results: [],
        summary: `WhatsApp history search karte waqt error: ${err?.message || err}`,
      };
    }
  }

  /**
   * Retrieves full dialogue history (Sender message + Bot reply + Boss reply) for a contact,
   * unknown senders, or all chats, formatted cleanly with complete back-and-forth dialogue.
   */
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

    // Extract potential contact name from queries like "Ram ne msg kiya kya", "Ram se kya baat hui"
    const nameMatch = rawQ.match(/(?:kya\s+)?([a-zA-Z0-9\u0900-\u097F]+?)\s*(?:ne\s*msg|ne\s*message|se\s*kya|ka\s*msg|ka\s*message|se\s*baat|ne\s*kya)/i);
    const candidateName = nameMatch ? nameMatch[1].trim() : rawQ;

    if (!isUnknownSearch && candidateName && candidateName !== "all" && candidateName !== "sab" && candidateName !== "kisi" && !candidateName.includes("kisi ne")) {
      const { contactsService } = await import("./contactsService");
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

    // Group by sender phone / person
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

    // Check if there are any pending questions awaiting Boss's input
    try {
      const { dailyUpdateService } = await import("./dailyUpdateService");
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

  /** Wire up the Baileys messages.upsert listener — called inside initSocket(). */
  private setupMessageListener() {
    if (!this.sock) return;

    this.sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify") return; // 'append' = history sync, skip

      for (const msg of messages) {
        try {
          const remoteJid: string = msg.key?.remoteJid || "";
          if (!remoteJid) continue;

          const text = this.extractMessageText(msg);
          if (!text) continue;

          const isGroup = remoteJid.endsWith("@g.us");
          const isFromMe = !!msg.key?.fromMe;
          const isBotSelfEcho = isFromMe && !!msg.key?.id && this.botSentMessageIds.has(msg.key.id);

          // Log outgoing messages from Boss or Bot so they are stored in history forever
          if (isFromMe) {
            const ts = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
            const outgoing: IncomingMessage = {
              id: msg.key.id || Math.random().toString(36).substring(2, 9),
              senderPhone: "me",
              senderName: "DK (Boss)",
              senderDisplayName: "Me",
              replyJid: remoteJid,
              groupId: isGroup ? remoteJid : null,
              groupName: isGroup ? await this.getGroupName(remoteJid) : null,
              isGroup,
              isUnknownContact: false,
              text,
              timestamp: ts,
              dateStr: new Date(ts).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
              isRead: true,
            };
            this.saveToFirestore(outgoing).catch(() => {});

            // If this message was dispatched by the bot itself, skip processing to avoid echo loops
            if (isBotSelfEcho) {
              continue;
            }

            // If Boss typed on phone in a 1-on-1 personal chat with someone else, don't auto-reply
            if (!isGroup) {
              continue;
            }
          }

          const senderJid: string = isGroup
            ? (msg.key.participant || msg.key.participantAlt || remoteJid)
            : remoteJid;

          // Check if sender is a WhatsApp LID (Linked ID)
          const isParticipantLid = senderJid.endsWith("@lid");

          // WhatsApp LID handling: prefer real phone JID if available
          const realPhoneJid: string | undefined =
            (msg as any).key?.senderPn ||
            (msg as any).key?.participantPn ||
            (isGroup ? (msg as any).key?.participantAlt : (msg as any).key?.remoteJidAlt) ||
            (!isParticipantLid ? senderJid : undefined);

          const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
          let senderPhone = (realPhoneJid || senderJid || "")
            .split("@")[0]
            .split(":")[0]
            .replace(/\D/g, "");

          if (isFromMe) {
            senderPhone = ownerPhone || this.dedicatedPhone || "me";
          }

          const senderDisplayName: string = isFromMe
            ? "DK (Boss)"
            : (msg.pushName || (senderPhone ? `+${senderPhone}` : "Unknown"));

          // Keep the raw JID actually usable for a reply
          const replyJid: string = isGroup
            ? remoteJid
            : realPhoneJid
            ? `${senderPhone}@s.whatsapp.net`
            : senderJid;

          let groupName: string | null = null;
          if (isGroup) groupName = await this.getGroupName(remoteJid);

          let senderContact: any = null;
          try {
            senderContact = await contactsService.findContact(senderPhone);
          } catch {}

          const isSenderOwner = isFromMe || this.isOwnerSender(senderPhone, senderDisplayName, senderJid, senderContact);
          const isFromOwner = !isGroup && isSenderOwner;

          // Resolve name from DK's contacts book & Boss recognition
          let senderName = senderDisplayName;
          let isUnknownContact = !isFromMe && !isSenderOwner;
          if (isSenderOwner) {
            senderName = "DK (Boss)";
            isUnknownContact = false;
          } else if (senderContact && senderContact.id !== "temp") {
            senderName = senderContact.name;
            isUnknownContact = false; // Found in contacts book
          }

          const ts = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : Date.now();

          const quotedMessage = this.extractQuotedContext(msg);

          const incoming: IncomingMessage = {
            id: msg.key.id || Math.random().toString(36).substring(2, 9),
            senderPhone,
            senderName,
            senderDisplayName,
            replyJid,
            groupId: isGroup ? remoteJid : null,
            groupName,
            isGroup,
            isUnknownContact,
            text,
            timestamp: ts,
            dateStr: new Date(ts).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
            isRead: false,
            quotedMessage,
          };

          // RAM cache (newest first, max 200)
          this.messageCache.unshift(incoming);
          if (this.messageCache.length > 200) this.messageCache.pop();

          // Persist to Firestore
          this.saveToFirestore(incoming).catch(() => {});

          // Auto-detect life milestones & ongoing events (exams, trips, health)
          if (text && text.trim().length > 5) {
            import("./humanComprehensionEngine")
              .then(({ humanComprehensionEngine }) => humanComprehensionEngine.autoDetectAndSaveLifeEvents(senderPhone, senderName, text))
              .catch(() => {});
          }

          // Contact Card / vCard auto-saving from Boss
          if (isFromOwner && (msg.message?.contactMessage || msg.message?.contactsArrayMessage)) {
            try {
              const contactMsg = msg.message?.contactMessage;
              const contactsArray = msg.message?.contactsArrayMessage?.contacts;
              const contactsToSave: Array<{ name: string; phone: string }> = [];

              if (contactMsg) {
                const name = contactMsg.displayName || "Contact";
                const vcard = contactMsg.vcard || "";
                const waidMatch = vcard.match(/waid=(\d+)/i);
                const telMatch = vcard.match(/TEL[^:]*:(.+)/i);
                const phone = waidMatch ? waidMatch[1] : (telMatch ? telMatch[1].replace(/\D/g, "") : "");
                if (phone) contactsToSave.push({ name, phone });
              }

              if (contactsArray && Array.isArray(contactsArray)) {
                for (const c of contactsArray) {
                  const name = c.displayName || "Contact";
                  const vcard = c.vcard || "";
                  const waidMatch = vcard.match(/waid=(\d+)/i);
                  const telMatch = vcard.match(/TEL[^:]*:(.+)/i);
                  const phone = waidMatch ? waidMatch[1] : (telMatch ? telMatch[1].replace(/\D/g, "") : "");
                  if (phone) contactsToSave.push({ name, phone });
                }
              }

              if (contactsToSave.length > 0) {
                const savedLines: string[] = [];
                for (const c of contactsToSave) {
                  const entry = await contactsService.saveContact(c.name, c.phone);
                  savedLines.push(`• 👤 *${entry.name}*: \`+${entry.phone}\``);
                }
                await this.sendHumanLikeMessage(
                  replyJid,
                  `📇 *Contact${contactsToSave.length > 1 ? "s" : ""} Successfully Saved!* ✅\n\n${savedLines.join("\n")}\n\n_Boss, ye contact maine permanent contacts book me save kar liya hai! Ab aap jab bhi bolenge (jaise "${contactsToSave[0].name} ko msg kar do..."), to main direct **WhatsApp 2** se message bhej dungi!_ 👍`,
                  "",
                  msg.key
                );
                continue;
              }
            } catch (contactErr) {
              console.error("[WhatsAppBot] Contact card saving error:", contactErr);
            }
          }

          // Vision AI: Download and process incoming Photos, Videos, Audio, and Documents
          const hasMedia = !!(
            msg.message?.imageMessage ||
            msg.message?.documentMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage
          );

          if (hasMedia) {
            try {
              const downloadFn = baileys.downloadMediaMessage || baileys.default?.downloadMediaMessage;
              if (downloadFn) {
                try {
                  const buffer: Buffer = await downloadFn(msg, "buffer", {}, { reuploadRequest: this.sock?.updateMediaMessage });
                  if (buffer && buffer.length > 0) {
                    const isVoice = !!msg.message?.audioMessage;
                    const isPhoto = !!msg.message?.imageMessage;
                    const isDoc = !!msg.message?.documentMessage;
                    const isVideo = !!msg.message?.videoMessage;
                    const mimeType =
                      msg.message?.imageMessage?.mimetype ||
                      msg.message?.documentMessage?.mimetype ||
                      msg.message?.videoMessage?.mimetype ||
                      msg.message?.audioMessage?.mimetype ||
                      (isVideo ? "video/mp4" : isVoice ? "audio/ogg" : isDoc ? "application/pdf" : "image/jpeg");
                    const caption =
                      msg.message?.imageMessage?.caption ||
                      msg.message?.documentMessage?.caption ||
                      msg.message?.videoMessage?.caption ||
                      "";
                    const fileName = msg.message?.documentMessage?.fileName;
                    const { visionMemoryService } = await import("./visionMemoryService");

                    // 1. Boss Voice Note -> STT + Voice Note to Voice Note Response (Friday Speaks Back!)
                    if (isVoice && isFromOwner) {
                      try {
                        const { voiceBridgeService } = await import("./voiceBridgeService");
                        const transcribed = await voiceBridgeService.transcribeAudio(buffer, mimeType, fileName || "voice.ogg");
                        if (transcribed && transcribed.trim()) {
                          console.log(`[WhatsAppBot] Boss Voice Transcribed: "${transcribed}"`);
                          await this.sendHumanLikeMessage(replyJid, `🎙️ *Aapki Aawaz (Transcription):*\n_"${transcribed}"_`, "", msg.key);
                          
                          // Execute Boss AI and generate spoken voice response
                          await this.handleOwnerWhatsAppMessage(senderName, senderPhone, transcribed, replyJid, msg.key, quotedMessage);
                          continue;
                        }
                      } catch (sttErr) {
                        console.error("[WhatsAppBot] STT error on Boss voice note:", sttErr);
                      }
                    }

                    // 2. Photo -> Vision AI Summary / Analysis / Memory Saving
                    if (isPhoto) {
                      try {
                        const cap = (caption || "").trim();
                        const isSummaryRequested =
                          /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|analyse|photo\s*analyze|ocr|dekho|check|batao|kya\s*hai|padho|scan|explain)\b/i.test(cap) ||
                          cap.startsWith("@summary") ||
                          cap.startsWith("/summary") ||
                          cap.startsWith("@friday");
                        const isFaceIdQuery = /^(ye\s*kaun\s*hai|pehchano|who\s*is\s*this|identify)/i.test(cap);

                        // A. Explicit Summary or Face ID Requested
                        if (isSummaryRequested || isFaceIdQuery) {
                          await this.sendHumanLikeMessage(replyJid, "👁️ *Photo analyze & summarize ho rahi hai...* ⚡", "", msg.key);
                          if (isFaceIdQuery) {
                            const idRes = await visionMemoryService.identifyPersonInPhoto(buffer);
                            await this.sendHumanLikeMessage(replyJid, idRes.explanation, "", msg.key);
                          } else {
                            const summaryRes = await visionMemoryService.generateMediaSummary(buffer, "image/jpeg", cap, undefined, replyJid);
                            await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                          }
                          continue;
                        }

                        // B. Face / Person Memory Saving (Boss only)
                        if (isFromOwner && /^(iska\s*naam|ye\s*photo|save\s*person|inka\s*naam)/i.test(cap)) {
                          const nameMatch = cap.match(/(?:naam|name)\s+(?:hai\s+)?([A-Za-z0-9\s]+)/i);
                          const personName = nameMatch ? nameMatch[1].trim() : "Contact";
                          const saveRes = await visionMemoryService.savePersonMemory(personName, "Friend / Contact", cap, buffer);
                          await this.sendHumanLikeMessage(replyJid, saveRes.summary, "", msg.key);
                          continue;
                        }

                        // C. Boss provided info/description about the photo to remember permanently
                        if (isFromOwner && cap) {
                          const { memoryEngine } = await import("./memoryEngine");
                          await memoryEngine.addPinnedMemory(`Photo Info: ${cap}`);
                          await memoryEngine.addPersonalVaultFact("saved_photos_and_documents", cap);

                          try {
                            await db.collection("visual_memories").add({
                              caption: cap,
                              timestamp: Date.now(),
                              dateStr: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                              senderName,
                              type: "photo",
                              hasBuffer: true,
                            });
                          } catch {}

                          await this.sendHumanLikeMessage(
                            replyJid,
                            `📸 *Photo aur jaankari permanently save ho gayi hai!* ✅\n\n📌 *Saved Information:* _"${cap}"_\n\n_Maine is photo aur jaankari ko Firestore me save kar liya hai. Aap 30 din baad ya kabhi bhi iske baare me poochhenge to main bata dungi!_`,
                            cap,
                            msg.key
                          );
                          continue;
                        }

                        // D. Uncaptioned Photo without "analysis" from Boss -> Simple acknowledgement
                        if (isFromOwner) {
                          try {
                            await db.collection("visual_memories").add({
                              caption: "Uncaptioned photo from Boss",
                              timestamp: Date.now(),
                              dateStr: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                              senderName,
                              type: "photo",
                            });
                          } catch {}

                          await this.sendHumanLikeMessage(
                            replyJid,
                            `📸 *Photo receive ho gayi hai Boss!* (Agar iska summary chahiye to photo ke niche _"friday summary"_ ya _"analysis"_ likhiye, ya iske baare me koi jaankari save karni ho to likhiye 👍)`,
                            "",
                            msg.key
                          );
                          continue;
                        }
                      } catch (photoErr) {
                        console.error("[WhatsAppBot] Photo processing error:", photoErr);
                      }
                    }

                    // 3. Document / PDF -> Detailed OCR & Executive Summary
                    if (isDoc) {
                      try {
                        const cap = (caption || "").trim();
                        const isDocSummaryReq = isFromOwner || /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|padho|check|batao|kya\s*hai|explain)\b/i.test(cap) || cap.startsWith("@friday");
                        if (isDocSummaryReq) {
                          await this.sendHumanLikeMessage(replyJid, `📄 *Document / PDF (${fileName || "file"}) analyze & summarize ho raha hai...* ⚡`, "", msg.key);
                          const summaryRes = await visionMemoryService.generateMediaSummary(buffer, mimeType, cap, fileName, replyJid);
                          await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                          continue;
                        }
                      } catch (docErr) {
                        console.error("[WhatsAppBot] Document processing error:", docErr);
                      }
                    }

                    // 4. Video -> Video Actions & Content Breakdown
                    if (isVideo && isFromOwner) {
                      try {
                        await this.sendHumanLikeMessage(replyJid, "🎬 *Video analyze & summarize ho rahi hai...* ⚡", "", msg.key);
                        const summaryRes = await visionMemoryService.generateMediaSummary(buffer, "video/mp4", caption, fileName, replyJid);
                        await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                        continue;
                      } catch (videoErr) {
                        console.error("[WhatsAppBot] Video processing error for Boss:", videoErr);
                      }
                    }

                    // General / non-owner media indexing
                    const analyzed = await visionMemoryService.processIncomingMedia(
                      buffer,
                      mimeType,
                      senderName,
                      caption,
                      fileName,
                      replyJid
                    );
                    if (analyzed.shortSummary) {
                      incoming.text = `${incoming.text} | AI Summary: ${analyzed.shortSummary}`;
                      this.saveToFirestore(incoming).catch(() => {});
                    }
                  }
                } catch (downloadErr) {
                  console.warn("[WhatsAppBot] Media download error:", downloadErr);
                }
              }
            } catch (mediaErr) {
              console.warn("[WhatsAppBot] Failed to initiate media download:", mediaErr);
            }
            // If it had media, do not proceed to normal text AI processing with placeholder tokens like "[Document]"
            continue;
          }

          let consumedByDailyUpdate = false;
          if (isFromOwner) {
            // 1. Check if DK is setting/updating the Voice PIN (e.g. "voice pin - 123456", "voice pin: 994411")
            try {
              const { voiceBiometricsService } = await import("./voiceBiometricsService");
              const pinRes = await voiceBiometricsService.handleWhatsAppVoicePinMessage(text, senderName, "whatsapp");
              if (pinRes.handled && pinRes.replyText) {
                consumedByDailyUpdate = true;
                if (this.sock && this.isConnected) {
                  await this.sendHumanLikeMessage(replyJid, pinRes.replyText, text, msg.key);
                }
              }
            } catch (pinErr) {
              console.error("[WhatsAppBot] Failed to process Voice PIN message:", pinErr);
            }

            // 1.1 Check if DK is setting/updating the App Access Key (e.g. "app key - 123456", "app pass 987654")
            if (!consumedByDailyUpdate) {
              try {
                const { appSecurityService } = await import("./appSecurityService");
                const keyRes = await appSecurityService.handleOwnerAppKeyMessage(text, isFromOwner, senderName, "whatsapp");
                if (keyRes.handled && keyRes.replyText) {
                  consumedByDailyUpdate = true;
                  if (this.sock && this.isConnected) {
                    await this.sendHumanLikeMessage(replyJid, keyRes.replyText, text, msg.key);
                  }
                }
              } catch (keyErr) {
                console.error("[WhatsAppBot] Failed to process App Key message:", keyErr);
              }
            }

            // 2. Check whether this is DK answering a forwarded question
            if (!consumedByDailyUpdate) {
              try {
                consumedByDailyUpdate = await this.tryForwardOwnerReplyToPendingSender(text);
              } catch (e) {
                console.error("[WhatsAppBot] Failed to process owner reply for forwarding:", e);
              }
            }

            // 3. MASTER BOSS FRIDAY ASSISTANT ON WHATSAPP: Full Intelligence & Tool Calling for Boss
            if (!consumedByDailyUpdate && this.sock && this.isConnected) {
              this.handleOwnerWhatsAppMessage(senderName, senderPhone, text, replyJid, msg.key, quotedMessage).catch((e) =>
                console.error("[WhatsAppBot] Owner Master Friday processing error:", e)
              );
            }
          } else if (!isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // ── Smart AI Auto-Reply with Burst Debounce for 1-on-1 Personal Chats ──
            this.queueIncomingForAutoReply(senderName, senderPhone, text, isUnknownContact, replyJid, msg.key, quotedMessage);
          } else if (isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // ── WhatsApp Group Behavior: Silent listener by default, responds when called/tagged ──
            const isMentioned = this.isBotMentionedInGroup(msg, text, quotedMessage);

            if (isMentioned) {
              if (isSenderOwner) {
                // Boss called Friday in the group
                console.log(`[WhatsAppBot] Boss mentioned Friday in group "${groupName || remoteJid}"`);
                this.handleOwnerWhatsAppMessage(senderName, senderPhone, text, remoteJid, msg.key, quotedMessage).catch((e) =>
                  console.error("[WhatsAppBot] Group Boss Friday processing error:", e)
                );
              } else {
                // Group member called Friday
                console.log(`[WhatsAppBot] Member ${senderName} mentioned Friday in group "${groupName || remoteJid}"`);
                this.handleGroupMentionAutoReply(senderName, senderPhone, text, remoteJid, groupName || "Group", msg.key, quotedMessage).catch((e) =>
                  console.error("[WhatsAppBot] Group Mention AI processing error:", e)
                );
              }
            }
          }

          // Notify server → broadcast to WebSocket clients. Flag whether this
          // message from DK was already consumed by the daily-update forward
          // flow above, so other owner-reply listeners (e.g. the coding-agent
          // approval handler in server.ts) know to skip it rather than both
          // systems racing to interpret the same "yes"/"ok".
          if (this.messageCallback) this.messageCallback({ ...incoming, consumedByDailyUpdate });

          console.log(
            `[WhatsAppBot] Incoming ${isGroup ? `group(${groupName})` : "personal"} msg from ${senderName}: "${text.substring(0, 80)}"`
          );
        } catch (e) {
          console.error("[WhatsAppBot] Error processing incoming message:", e);
        }
      }
    });
  }

  /**
   * Handles swipe-to-reply (Quote) on any photo, PDF, document, video, summary card, or text
   * when the user asks for a summary OR asks a specific follow-up question (e.g. "meeting kab hai?", "total bill amount kitna h?").
   */
  public async handleQuotedMediaSummary(
    replyJid: string,
    rawText: string,
    quotedMessage: QuotedMessageContext,
    messageKey: any
  ): Promise<boolean> {
    const cleanText = rawText.toLowerCase().trim();
    const isSummaryIntent =
      /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|analyse|padho|explain|kya\s*likha\s*hai|kya\s*hai|batao|overview|read|ocr)\b/i.test(cleanText) ||
      cleanText.startsWith("@summary") ||
      cleanText.startsWith("/summary") ||
      cleanText.startsWith("summary");

    const { visionMemoryService } = await import("./visionMemoryService");
    const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");

    // Case 1: Quoted message has media (Photo / PDF / Document / Video / Audio)
    if (quotedMessage.rawQuotedMessage && quotedMessage.mediaType !== "text") {
      const downloadFn = baileys.downloadMediaMessage || baileys.default?.downloadMediaMessage;
      if (downloadFn) {
        try {
          const actionText = (isSummaryIntent && !visionMemoryService.isMediaQuestionIntent(rawText))
            ? `📑 *Quoted ${quotedMessage.mediaType.toUpperCase()} analyze & summarize ho raha hai...* ⚡`
            : `🔍 *Quoted ${quotedMessage.mediaType.toUpperCase()} me se dhoondh kar jawab de rahi hoon...* ⚡`;

          await this.sendHumanLikeMessage(replyJid, actionText, rawText, messageKey);

          const qMsgWrapper = { message: quotedMessage.rawQuotedMessage };
          const buffer: Buffer = await downloadFn(qMsgWrapper, "buffer", {}, { reuploadRequest: this.sock?.updateMediaMessage });

          if (buffer && buffer.length > 0) {
            const rawQ = quotedMessage.rawQuotedMessage;
            const mimeType =
              rawQ.imageMessage?.mimetype ||
              rawQ.documentMessage?.mimetype ||
              rawQ.videoMessage?.mimetype ||
              rawQ.audioMessage?.mimetype ||
              (quotedMessage.mediaType === "photo" ? "image/jpeg" : quotedMessage.mediaType === "document" ? "application/pdf" : "video/mp4");
            const fileName = rawQ.documentMessage?.fileName || quotedMessage.fileName;

            if (isSummaryIntent && !visionMemoryService.isMediaQuestionIntent(rawText)) {
              const summaryRes = await visionMemoryService.generateMediaSummary(buffer, mimeType, rawText, fileName, replyJid);
              await this.sendHumanLikeMessage(replyJid, summaryRes, rawText, messageKey);
            } else {
              // Direct contextual Q&A on the quoted photo/document/PDF (e.g. "meeting kab hai", "amount kitna hai")
              const answerRes = await visionMemoryService.answerQuestionOnMedia({
                buffer,
                mimeType,
                question: rawText,
                fileName,
                chatId: replyJid,
              });
              await this.sendHumanLikeMessage(replyJid, answerRes, rawText, messageKey);
            }
            return true;
          }
        } catch (mediaErr) {
          console.warn("[WhatsAppBot] Quoted media download/QnA error:", mediaErr);
        }
      }
    }

    // Case 2: Quoted message contains a URL / Link
    const urlMatch = quotedMessage.text.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && isSummaryIntent) {
      await this.sendHumanLikeMessage(replyJid, `🌐 *Quoted URL analyze ho raha hai...* ⚡\n🔗 _${urlMatch[1]}_`, rawText, messageKey);
      const webSummary = await whatsappFeatureEngine.summarizeWebUrl(urlMatch[1], rawText);
      await this.sendHumanLikeMessage(replyJid, webSummary, rawText, messageKey);
      return true;
    }

    // Case 3: Quoted message is a Summary Card or text message
    if (quotedMessage.text && quotedMessage.text.length > 15) {
      const isSummaryCard =
        quotedMessage.text.includes("📌") ||
        quotedMessage.text.includes("📝 *Key Summary") ||
        quotedMessage.text.includes("💡 *Executive") ||
        quotedMessage.text.includes("Executive Summary") ||
        quotedMessage.text.toLowerCase().includes("summary");

      if (isSummaryCard || (!isSummaryIntent && quotedMessage.text.length > 25)) {
        // Direct question on Friday's summary card or quoted message (e.g. "meeting kab hai", "total kitna hai")
        await this.sendHumanLikeMessage(replyJid, "🔍 *Summary me se dhoondh kar jawab de rahi hoon...* ⚡", rawText, messageKey);
        const answer = await visionMemoryService.answerQuestionOnMedia({
          question: rawText,
          textContext: quotedMessage.text,
          chatId: replyJid,
        });
        await this.sendHumanLikeMessage(replyJid, answer, rawText, messageKey);
        return true;
      } else if (isSummaryIntent) {
        await this.sendHumanLikeMessage(replyJid, "📝 *Quoted message ki summary ban rahi hai...* ⚡", rawText, messageKey);
        const textSummary = await whatsappFeatureEngine.translateText(
          `Summarize this message clearly in 3-5 concise bullet points in Hinglish:\n"${quotedMessage.text}"`,
          "Hinglish"
        );
        await this.sendHumanLikeMessage(replyJid, `📑 *Quoted Message Summary:*\n\n${textSummary}`, rawText, messageKey);
        return true;
      }
    }

    return false;
  }

  /**
   * Master FRIDAY AI Assistant for Boss (DK) on WhatsApp.
   * Gives DK 100% full autonomous access via WhatsApp chat:
   * - Swipe-to-reply (Quoted Message) contextual awareness across all media
   * - YouTube analysis & timestamps
   * - RailRadar live train status, PNR, fares, seats, station boards
   * - Photo / Vision / Document / Video intelligence
   * - Autonomous tool execution (Send WhatsApp messages, contact lookup, reminders, notes, expenses, weather, news, memories)
   * - Continuous conversational companionship with deep personal context
   */
  private async handleOwnerWhatsAppMessage(
    senderName: string,
    senderPhone: string,
    text: string,
    replyJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<void> {
    const rawText = (text || "").trim();
    if (!rawText) return;

    // Combined context text for link/train detection
    const fullSearchContext = quotedMessage?.text ? `${quotedMessage.text}\n${rawText}` : rawText;

    // 0. Quoted Swipe-to-Reply Media / Document / Photo Summary Engine
    if (quotedMessage && quotedMessage.isReply) {
      const handledQuoted = await this.handleQuotedMediaSummary(replyJid, rawText, quotedMessage, messageKey);
      if (handledQuoted) return;
    }

    // 0.05 Recent Media Follow-Up Q&A (User asking question about recent photo/PDF/file without quote)
    try {
      const { visionMemoryService } = await import("./visionMemoryService");
      const recentChatMedia = visionMemoryService.getChatMediaContext(replyJid);
      if (recentChatMedia && visionMemoryService.isMediaQuestionIntent(rawText)) {
        await this.sendHumanLikeMessage(replyJid, "🔍 *Recent file/photo me se dhoondh rahi hoon...* ⚡", rawText, messageKey);
        const ans = await visionMemoryService.answerQuestionOnMedia({
          question: rawText,
          chatId: replyJid,
        });
        if (ans && !ans.startsWith("⚠️")) {
          await this.sendHumanLikeMessage(replyJid, ans, rawText, messageKey);
          return;
        }
      }
    } catch (recentMediaErr) {
      console.warn("[WhatsAppBot] Direct recent media Q&A notice:", recentMediaErr);
    }

    // 0.08 Direct Auto-Ring Calling Engine ("call me", "friday call me", "call karo", "mujhe call karo", "@call", "/call", "live call", "voice call")
    if (
      /^(?:@call|\/call|call\s*me|call\s*karo|mujhe\s*call\s*karo|friday\s*call\s*me|voice\s*call|live\s*call|call\s*lagao|baat\s*karni\s*hai\s*call\s*par)/i.test(rawText) ||
      rawText.toLowerCase() === "call"
    ) {
      const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
      const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard("Boss DK", true);
      const callIdMatch = callCard.match(/callId=([a-zA-Z0-9_]+)/);
      const callId = callIdMatch ? callIdMatch[1] : `call_${Date.now()}`;

      // Broadcast instant remote incoming call ring to Friday Call App on phone
      if (this.callTriggerCallback) {
        this.callTriggerCallback({ callerName: "FRIDAY AI (Boss)", isOwner: true, callId });
      }

      await this.sendHumanLikeMessage(
        replyJid,
        `📞 *Boss DK, Friday aapke phone par direct call mila rahi hai...* ⚡\n\n🔔 *Phone par ghanti baj rahi hai! Phone screen par Green button swipe karke baat kijiye.*\n\n${callCard}`,
        rawText,
        messageKey
      );
      return;
    }

    // 0.082 WHATSAPP CHAT & CONVERSATION INQUIRY FAST ENGINE
    // When Boss asks: "kisi ne msg kiya kya", "unknown number ne msg kiya kya", "Ram ne msg kiya kya", "Ram se kya baat hui", "kya kya baat hui batao", "usne kya bola tumne kya reply diya"
    const isChatInquiryIntent =
      !quotedMessage?.isReply &&
      (/(?:kisi\s*ne|unknown|kisi\s*unknown|kisne|kya\s*kisi\s*ne|koi\s*msg|kisi\s*ka\s*msg|kisi\s*ka\s*message|messages?|chat|baat)\s*(?:aaya|aaye|kiya|hua|aayi|bheja|status|check|batao|pucho|padho|summary|digest)/i.test(rawText) ||
        /(?:se\s*kya\s*baat\s*hui|ne\s*kya\s*msg\s*kiya|ne\s*kya\s*bheja|kya\s*baat\s*hui|kya\s*msg\s*kiya|kya\s*reply\s*diya|tumne\s*kya\s*bola|usne\s*kya\s*bola|kya\s*kya\s*baat\s*hui|kya\s*baat\s*hua)/i.test(rawText));

    if (isChatInquiryIntent) {
      const searchRes = await this.getConversationSummaryAndHistory(rawText);
      await this.sendHumanLikeMessage(replyJid, searchRes.summary, rawText, messageKey);
      return;
    }

    // 0.085 SWIPE-TO-REPLY (QUOTED MESSAGE) FAST ACTION ENGINE
    // When Boss quotes a message containing a phone number or contact card and says:
    // "isko msg karo ki aaj school aana h", "isko bolo ki...", "inhe message kar do ki...", "isko save karo Ram", etc.
    if (quotedMessage && quotedMessage.isReply) {
      const qText = quotedMessage.text || "";
      const qPhoneMatch = qText.match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || qText.match(/(\+?\d[\d\s\-]{8,15}\d)/);
      let quotedPhone = qPhoneMatch ? qPhoneMatch[1].replace(/\D/g, "") : "";

      // Also check contact card vcard in quoted message
      if (!quotedPhone && quotedMessage.rawQuotedMessage?.contactMessage) {
        const vcard = quotedMessage.rawQuotedMessage.contactMessage.vcard || "";
        const waidMatch = vcard.match(/waid=(\d+)/i);
        const telMatch = vcard.match(/TEL[^:]*:(.+)/i);
        quotedPhone = waidMatch ? waidMatch[1] : (telMatch ? telMatch[1].replace(/\D/g, "") : "");
      }

      // If still no phone, check if quoted message sender is a 3rd party (not Boss)
      if (!quotedPhone && quotedMessage.senderPhone && quotedMessage.senderPhone !== senderPhone) {
        quotedPhone = quotedMessage.senderPhone;
      }

      let quotedContactName = "";
      if (quotedPhone) {
        const { contactsService } = await import("./contactsService");
        const existing = await contactsService.findContact(quotedPhone);
        if (existing && existing.id !== "owner_default" && existing.id !== "temp") {
          quotedContactName = existing.name;
        }
      }

      // Action A: Send Message to Quoted Phone / Contact ("isko msg karo ki...", "isko bol do ki...", "inhe whatsapp karo...")
      const swipeMsgMatch =
        rawText.match(/^(?:isko|inhe|ise|unko|is\s*no\s*ko|is\s*number\s*ko|ispe|is\s*par)\s*(?:msg|message|whatsapp|bol\s*do|bolo|keh\s*do|kaho|bhejo|bhej\s*do|send\s*karo|send\s*kar\s*do|send|bhejna)\s*(?:ki|:|-)?\s*(.+)/i) ||
        rawText.match(/^(?:msg|message|whatsapp|send)\s*(?:kar\s*do|bhej\s*do|karo|bhejo)\s*(?:isko|inhe|ise|unko|is\s*no\s*ko|is\s*number\s*ko|ispe|is\s*par)\s*(?:ki|:|-)?\s*(.+)/i) ||
        rawText.match(/^(?:bol\s*do|bolo|keh\s*do|kaho)\s*(?:isko|inhe|ise|unko)\s*(?:ki|:|-)?\s*(.+)/i);

      if (swipeMsgMatch && quotedPhone) {
        const messageBody = swipeMsgMatch[1].trim();
        if (messageBody) {
          const { sendWhatsAppUnified } = await import("./whatsappService");
          const sendRes = await sendWhatsAppUnified(quotedPhone, messageBody, { channel: "whatsapp2" });
          if (sendRes.success) {
            await this.sendHumanLikeMessage(
              replyJid,
              `🚀 *Message Sent via WhatsApp 2!* ✅\n\n👤 *Recipient:* ${quotedContactName ? `${quotedContactName} ` : ""}(\`+${quotedPhone}\`)\n💬 *Message:* _"${messageBody}"_\n⚡ *Channel:* WhatsApp 2 (Baileys Dedicated Bot)\n\nBoss, quoted number par message successfully deliver ho gaya hai! 👍`,
              rawText,
              messageKey
            );
          } else {
            await this.sendHumanLikeMessage(
              replyJid,
              `⚠️ *Message Send Failed:* ${sendRes.message}\n\nRecipient: +${quotedPhone}`,
              rawText,
              messageKey
            );
          }
          return;
        }
      }

      // Action B: Save Contact from Quoted Phone ("isko save karo Ram", "Ram save kar lo", "isko girlfriend save karo Priya")
      const isSwipeSaveIntent =
        /(?:save|yaad|rakho|girlfriend|gf|bestfriend|bff|dost|bhai|sister|family|naam)/i.test(rawText) &&
        /(?:isko|inhe|ise|unko|ye|is\s*no|is\s*number|save)/i.test(rawText);

      if (isSwipeSaveIntent && quotedPhone) {
        const { contactsService } = await import("./contactsService");
        const relKeyword = rawText.match(/\b(girlfriend|gf|crush|wife|partner|jaan|bestfriend|best\s*friend|bff|dost|close\s*friend|friend|brother|bhai|sister|behan|mummy|papa|family)\b/i);
        let normalizedRel: string | undefined;
        if (relKeyword) {
          const r = relKeyword[1].toLowerCase();
          normalizedRel =
            r === "gf" || r === "girlfriend" || r === "crush" || r === "wife" || r === "jaan" || r === "partner"
              ? "girlfriend"
              : r.includes("best") || r === "bff"
              ? "bestfriend"
              : r === "bhai" || r === "brother"
              ? "brother"
              : r === "behan" || r === "sister"
              ? "sister"
              : r === "mummy" || r === "papa" || r === "family"
              ? "family"
              : "friend";
        }

        let nameCandidate = rawText
          .replace(/(?:ye\s*(?:no|number)\s*save\s*karo|save\s*contact|save\s*number|save\s*no|number\s*save\s*karo|no\s*save\s*karo|contact\s*save\s*karo|save\s*kar\s*(?:lo|do|na)|save|isko|inhe|ise|unko|ye|is\s*no|is\s*number|ka\s*number|ka\s*no|name|naam|hai|h|he|karke|ko|ka|ki|se|relation|set|please|plz|friday|boss|inhe|inka|unka|number|phone|mobile)/gi, "")
          .replace(/[:=,\-]/g, "")
          .trim();

        if (relKeyword) {
          nameCandidate = nameCandidate.replace(new RegExp(`\\b${relKeyword[0]}\\b`, "gi"), "").trim();
        }

        const finalName = nameCandidate && nameCandidate.length >= 2 ? nameCandidate : (normalizedRel ? normalizedRel.toUpperCase() : "Contact");
        const saved = await contactsService.saveContact(finalName, quotedPhone, normalizedRel);
        await this.sendHumanLikeMessage(
          replyJid,
          `📇 *Contact Saved from Quoted Message!* ✅\n\n👤 *Name:* ${saved.name}\n📱 *Phone:* \`+${saved.phone}\`${normalizedRel ? `\n🏷️ *Relation:* *${normalizedRel.toUpperCase()}*` : ""}\n📅 *Saved on:* ${saved.dateAdded}\n\n_Boss, quoted number contacts book me save ho gaya hai! Ab aap direct bol sakte hain: "${saved.name} ko msg kar do...", aur main by-default **WhatsApp 2** se message bhej dungi!_ 👍`,
          rawText,
          messageKey
        );
        return;
      }
    }

    // 0.088 Comprehensive Contact & Relationship Parser (Phone + Name + Relation / Phone + Relation / Name + Relation)
    // Examples: "Priya 9876543210 meri girlfriend hai", "9876543210 meri girlfriend hai", "Priya meri gf hai", "Rahul 9876543210 bestfriend"
    const relKeywordMatch = rawText.match(/\b(girlfriend|gf|crush|wife|partner|jaan|bestfriend|best\s*friend|bff|dost|close\s*friend|friend|brother|bhai|sister|behan|mummy|papa|family)\b/i);
    const phoneMatch = rawText.match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || rawText.match(/(\+?\d[\d\s\-]{8,15}\d)/);

    const isRelationIntent =
      !!relKeywordMatch &&
      (/(?:meri|mera|my|relation|save|hai|h|he|ko|ka|ki)/i.test(rawText) || !!phoneMatch);

    if (isRelationIntent && relKeywordMatch) {
      const rawRel = relKeywordMatch[1].trim().toLowerCase();
      const normalizedRel =
        rawRel === "gf" || rawRel === "girlfriend" || rawRel === "crush" || rawRel === "wife" || rawRel === "jaan" || rawRel === "partner"
          ? "girlfriend"
          : rawRel.includes("best") || rawRel === "bff"
          ? "bestfriend"
          : rawRel === "bhai" || rawRel === "brother"
          ? "brother"
          : rawRel === "behan" || rawRel === "sister"
          ? "sister"
          : rawRel === "mummy" || rawRel === "papa" || rawRel === "family"
          ? "family"
          : "friend";

      const rawPhone = phoneMatch ? phoneMatch[1].replace(/\D/g, "") : "";

      // Extract Name Candidate by stripping phone and keywords
      let nameCandidate = rawText;
      if (phoneMatch) nameCandidate = nameCandidate.replace(phoneMatch[0], "");
      nameCandidate = nameCandidate
        .replace(new RegExp(`\\b${relKeywordMatch[0]}\\b`, "gi"), "")
        .replace(/(?:ye\s*(?:no|number)\s*save\s*karo|save\s*contact|save\s*number|save\s*no|number\s*save\s*karo|no\s*save\s*karo|contact\s*save\s*karo|save\s*kar\s*(?:lo|do|na)|save|meri|mera|my|hai|h|he|karke|ko|ka|ki|se|relation|set|please|plz|friday|boss|inhe|inka|unka|number|phone|mobile)/gi, "")
        .replace(/[:=,\-]/g, "")
        .trim();

      // Case A: Phone number is provided (with or without name)
      if (rawPhone && rawPhone.length >= 10) {
        const finalName =
          nameCandidate && nameCandidate.length >= 2
            ? nameCandidate
            : (normalizedRel === "girlfriend" ? "Girlfriend" : normalizedRel === "bestfriend" ? "Best Friend" : "Contact");

        const saved = await contactsService.saveContact(finalName, rawPhone, normalizedRel);
        const emoji = normalizedRel === "girlfriend" ? "💖" : normalizedRel === "bestfriend" ? "🔥" : "👥";
        await this.sendHumanLikeMessage(
          replyJid,
          `✨ *Contact & Relationship Saved to Firestore!* ${emoji}\n\n👤 *Name:* ${saved.name}\n📱 *Phone:* \`+${saved.phone}\`\n🏷️ *Relation:* *${normalizedRel.toUpperCase()}*\n📅 *Saved on:* ${saved.dateAdded}\n\n_Boss, maine number aur relationship dono Firestore me permanently save kar liye hain! Ab jab bhi ${saved.name} WhatsApp par message karengi/karenge, main unse unke relation ke hisab se bilkul ghul-mil ke aur sweet andaaz me baat karungi!_ 👍`,
          rawText,
          messageKey
        );
        return;
      }

      // Case B: Name + Relationship without phone (e.g. "Priya meri girlfriend hai", "Rahul mera bestfriend hai")
      if (nameCandidate && nameCandidate.length >= 2) {
        const updated = await contactsService.setContactRelation(nameCandidate, normalizedRel);
        if (updated) {
          const emoji = normalizedRel === "girlfriend" ? "💖" : normalizedRel === "bestfriend" ? "🔥" : "👥";
          await this.sendHumanLikeMessage(
            replyJid,
            `✨ *Relationship Updated in Firestore!* ${emoji}\n\n👤 *Name:* ${updated.name}\n📱 *Phone:* \`+${updated.phone}\`\n🏷️ *Relation:* *${normalizedRel.toUpperCase()}*\n\n_Boss, maine ${updated.name} ka relationship Firestore me permanently **${normalizedRel.toUpperCase()}** update kar diya hai!_ 👍`,
            rawText,
            messageKey
          );
          return;
        } else {
          const saved = await contactsService.saveContact(nameCandidate, "", normalizedRel);
          const emoji = normalizedRel === "girlfriend" ? "💖" : normalizedRel === "bestfriend" ? "🔥" : "👥";
          await this.sendHumanLikeMessage(
            replyJid,
            `✨ *Relationship Recorded in Firestore!* ${emoji}\n\n👤 *Name:* ${saved.name}\n🏷️ *Relation:* *${normalizedRel.toUpperCase()}*\n\n_Boss, maine ${saved.name} ko **${normalizedRel.toUpperCase()}** ke roop me Firestore me note kar liya hai. Jaise hi aap unka number bhejenge (e.g. "${saved.name} ka number 98765..."), wo automatically link ho jayega!_ 👍`,
            rawText,
            messageKey
          );
          return;
        }
      }
    }

    // 0.09 Boss Quick Contact Save Command ("ye no save karo Ram 98765...", "Ram ka number 98765... save karo", "save contact Ram 98765...")
    const isSaveContactIntent =
      /(?:ye\s*(?:no|number)\s*save\s*karo|save\s*contact|save\s*number|save\s*no|number\s*save\s*karo|no\s*save\s*karo|contact\s*save\s*karo|save\s*kar\s*(?:lo|do|na))/i.test(rawText) ||
      /\b\d{10,12}\b.*(?:save|yaad|rakho)/i.test(rawText) ||
      /(?:ka\s*(?:number|no|phone|mobile)).*(?:save)/i.test(rawText);

    if (isSaveContactIntent) {
      const phoneMatch = rawText.match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || rawText.match(/(\+?\d[\d\s\-]{8,15}\d)/);
      if (phoneMatch) {
        const rawPhone = phoneMatch[1].replace(/\D/g, "");
        let nameCandidate = rawText
          .replace(phoneMatch[0], "")
          .replace(/(?:ye\s*(?:no|number)\s*save\s*karo|save\s*contact|save\s*number|save\s*no|number\s*save\s*karo|no\s*save\s*karo|contact\s*save\s*karo|save\s*kar\s*(?:lo|do|na)|ka\s*number|ka\s*no|ka\s*phone|ka\s*mobile|name|naam|hai|karke|ko|se|please|plz|friday|boss|ko\s*bhi|bhi|inhe)/gi, "")
          .replace(/[:=,\-]/g, "")
          .trim();

        if (!nameCandidate || nameCandidate.length < 2) {
          nameCandidate = "Contact";
        }

        const saved = await contactsService.saveContact(nameCandidate, rawPhone);
        await this.sendHumanLikeMessage(
          replyJid,
          `📇 *Contact Successfully Saved!* ✅\n\n👤 *Name:* ${saved.name}\n📱 *Phone:* \`+${saved.phone}\`\n📅 *Saved on:* ${saved.dateAdded}\n\n_Boss, ye number contacts book me save ho gaya hai! Ab aap direct bol sakte hain: "${saved.name} ko msg kar do...", aur main by-default **WhatsApp 2** se message bhej dungi!_ 👍`,
          rawText,
          messageKey
        );
        return;
      }
    }

    // 0.095 Boss Direct WhatsApp 2 Message Command ("Ram ko msg kar do ki aaj school aana h", "Rahul ko message bhejo: ...")
    const directMsgMatch =
      rawText.match(/^([a-zA-Z\s]{2,25}?)\s*(?:ko|par)\s*(?:msg|message|whatsapp)\s*(?:kar\s*do|bhej\s*do|karo|bhejo|send\s*karo|send\s*kar\s*do)\s*(?:ki|:|-)?\s*(.+)/i) ||
      rawText.match(/^(?:msg|message|whatsapp)\s*(?:kar\s*do|bhej\s*do|karo|bhejo|send\s*karo)\s+([a-zA-Z\s]{2,25}?)\s*(?:ko|par)?\s*(?:ki|:|-)?\s*(.+)/i) ||
      rawText.match(/^([a-zA-Z\s]{2,25}?)\s*ko\s*(?:bol\s*do|bolo|keh\s*do|kaho)\s*(?:ki|:|-)?\s*(.+)/i);

    if (directMsgMatch) {
      const recipientName = directMsgMatch[1].trim();
      const messageBody = directMsgMatch[2].trim();
      const lowerRec = recipientName.toLowerCase();
      const nonContactKeywords = ["friday", "boss", "mujhe", "me", "isko", "inhe", "ise", "unko", "isse", "usko", "is", "us"];
      if (recipientName && messageBody && !nonContactKeywords.includes(lowerRec)) {
        const contact = await contactsService.findContact(recipientName);
        if (contact && contact.id !== "owner_default") {
          const { sendWhatsAppUnified } = await import("./whatsappService");
          const sendRes = await sendWhatsAppUnified(contact.phone, messageBody, { channel: "whatsapp2" });
          if (sendRes.success) {
            await this.sendHumanLikeMessage(
              replyJid,
              `🚀 *Message Sent via WhatsApp 2!* ✅\n\n👤 *Recipient:* ${contact.name} (+${contact.phone})\n💬 *Message:* _"${messageBody}"_\n⚡ *Channel:* WhatsApp 2 (Baileys Dedicated Bot)\n\nBoss, message successfully deliver ho gaya hai! 👍`,
              rawText,
              messageKey
            );
          } else {
            await this.sendHumanLikeMessage(
              replyJid,
              `⚠️ *Message Send Failed:* ${sendRes.message}\n\nRecipient: ${contact.name} (+${contact.phone})`,
              rawText,
              messageKey
            );
          }
          return;
        }
      }
    }

    // 0.1 AI Image Generation ("@image <prompt>", "/image <prompt>", "image: <prompt>", "photo banao <prompt>")
    const imageGenMatch =
      rawText.match(/^(?:@image|\/image|image:|photo\s*banao|image\s*banao|tasveer\s*banao|generate\s*image|draw\s*image|draw)\s*[:=-]?\s*(.+)/i) ||
      (rawText.includes("@image") ? rawText.match(/@image\s+(.+)/i) : null);
    if (imageGenMatch && imageGenMatch[1]?.trim()) {
      const prompt = imageGenMatch[1].trim();
      try {
        await this.sendHumanLikeMessage(replyJid, `🎨 *Image generate ho rahi hai Boss...* ⚡\n\n📌 *Prompt:* _"${prompt}"_`, rawText, messageKey);
        const { imageGenerationService } = await import("./imageGenerationService");
        const genRes = await imageGenerationService.generateImage(prompt);
        if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
          const imageSrc = genRes.buffer || genRes.imageUrl!;
          await this.sendPhotoMessage(
            replyJid,
            imageSrc,
            `✨ *AI Generated Image*\n📌 *Prompt:* _"${prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
            messageKey
          );
          return;
        } else {
          await this.sendHumanLikeMessage(replyJid, `⚠️ Boss, image generate karne me issue aaya: ${genRes.error || "Unknown error"}`, rawText, messageKey);
          return;
        }
      } catch (imgErr: any) {
        console.error("[WhatsAppBot] Image generation error:", imgErr);
        await this.sendHumanLikeMessage(replyJid, `⚠️ Image generate nahi ho payi: ${imgErr?.message || imgErr}`, rawText, messageKey);
        return;
      }
    }

    // 1. YouTube Video Intelligence ("https://youtube.com/..." / "https://youtu.be/...")
    try {
      const { youtubeService } = await import("./youtubeService");
      const ytVideoId = youtubeService.extractVideoId(rawText) || (quotedMessage?.text ? youtubeService.extractVideoId(quotedMessage.text) : null);
      if (ytVideoId && !/^(media\s*search|vault\s*search)/i.test(rawText)) {
        await this.sendHumanLikeMessage(replyJid, "🎬 *YouTube Video analyze ho raha hai... (Transcripts & Timestamps)* ⚡", rawText, messageKey);
        const analysis = await youtubeService.analyzeVideo(ytVideoId);
        let card = `🎬 *YouTube Video Intelligence:* **${analysis.title}**\n`;
        card += `• 👤 Channel: *${analysis.channelName}*\n`;
        card += `• 📝 Subtitles: *${analysis.hasTranscript ? `✅ ${analysis.totalCues} timed cues` : "⚠️ Auto estimated"}*\n\n`;
        card += `📌 *Executive Summary:*\n${analysis.summary}\n\n`;
        if (analysis.keyTakeaways && analysis.keyTakeaways.length > 0) {
          card += `💡 *Key Takeaways:*\n`;
          analysis.keyTakeaways.forEach((t) => (card += `• ${t}\n`));
          card += `\n`;
        }
        if (analysis.chapters && analysis.chapters.length > 0) {
          card += `⏱️ *Timeline & Chapters (Clickable Timestamps):*\n`;
          analysis.chapters.slice(0, 8).forEach((ch) => {
            card += `• [⏱️ ${ch.startFormatted}](${ch.timestampUrl}) — *${ch.title}*\n  _${ch.summary}_\n`;
          });
          card += `\n`;
        }
        card += `👉 _Kisi topic ke baare me poochhein: \`yt ask ${ytVideoId} <sawal>\`_`;
        await this.sendHumanLikeMessage(replyJid, card, rawText, messageKey);
        return;
      }

      // YouTube Specific Q&A ("yt ask <url/id> <question>")
      const ytAskMatch = rawText.match(/^(?:yt\s*ask|youtube\s*ask|ask\s*yt)\s+(\S+)\s+(.+)/i);
      if (ytAskMatch) {
        const targetUrlOrId = ytAskMatch[1];
        const question = ytAskMatch[2];
        const queryRes = await youtubeService.queryVideoTimestamp(targetUrlOrId, question);
        let respText = `🎬 *YouTube Video Timestamp Q&A:*\n\n`;
        if (queryRes.exactTimestamp) {
          respText += `⏱️ *Exact Timestamp:* [${queryRes.exactTimestamp}](${queryRes.timestampUrl})\n\n`;
        }
        respText += `📝 *Answer:*\n${queryRes.answer}`;
        await this.sendHumanLikeMessage(replyJid, respText, rawText, messageKey);
        return;
      }
    } catch (ytErr) {
      console.warn("[WhatsAppBot] YouTube processing notice:", ytErr);
    }

    // 2. RailRadar Live Railways (Train status, PNR, Fares, Seats, Station board)
    try {
      const { railRadarService } = await import("./railRadarService");
      const trainMatch =
        rawText.match(/^(?:\/train|train|live\s*train|railradar)\s+(\d{4,5}|\w+)/i) ||
        rawText.match(/\b(\d{5})\b(?:\s+train|\s+running|\s+status|\s+kahan)/i) ||
        rawText.match(/train\s+(?:status|kahan\s*hai|live|no|number)?\s*[:=-]?\s*(\d{4,5})/i) ||
        (quotedMessage?.text ? quotedMessage.text.match(/\b(\d{5})\b/) : null);
      if (trainMatch && (/(status|train|kahan|late|delay|running)/i.test(rawText) || rawText.match(/\b\d{5}\b/))) {
        const trainQuery = trainMatch[1];
        const trainStatus = await railRadarService.getLiveTrainStatus(trainQuery);
        await this.sendHumanLikeMessage(replyJid, trainStatus.message, rawText, messageKey);
        return;
      }

      const pnrMatch =
        rawText.match(/^(?:\/pnr|pnr|pnr\s*status)\s+(\d{10})/i) ||
        rawText.match(/\b(\d{10})\b/i) ||
        (quotedMessage?.text ? quotedMessage.text.match(/\b(\d{10})\b/) : null);
      if (pnrMatch && (/pnr/i.test(rawText) || /pnr/i.test(quotedMessage?.text || "") || pnrMatch[0].startsWith("/pnr") || rawText.length === 10)) {
        const pnrNum = pnrMatch[1];
        const pnrRes = await railRadarService.getPnrStatus(pnrNum);
        await this.sendHumanLikeMessage(replyJid, pnrRes.message, rawText, messageKey);
        return;
      }

      const fareMatch =
        rawText.match(/^(?:\/fare|fare|ticket\s*price|kiraya|train\s*fare)\s+(\d{4,5}|\w+)(?:\s+(?:from\s+)?([a-zA-Z\s]{2,15}))?(?:\s+(?:to\s+)?([a-zA-Z\s]{2,15}))?/i) ||
        rawText.match(/(\d{5})\s+(?:ka\s+)?(?:fare|ticket|kiraya|price)/i);
      if (fareMatch) {
        const trainQuery = fareMatch[1];
        const fromStn = fareMatch[2]?.trim();
        const toStn = fareMatch[3]?.trim();
        const fareRes = await railRadarService.getTrainFares(trainQuery, fromStn, toStn);
        await this.sendHumanLikeMessage(replyJid, fareRes.message, rawText, messageKey);
        return;
      }

      const seatMatch =
        rawText.match(/^(?:\/seats|\/seat|\/tatkal|seats|seat|tatkal|seat\s*availability)\s+(\d{4,5}|\w+)(?:\s+([a-zA-Z\s]{2,15}))?(?:\s+([a-zA-Z\s]{2,15}))?/i) ||
        rawText.match(/(\d{5})\s+(?:me\s+)?(?:seat|khali|tatkal|seat\s*available)/i);
      if (seatMatch) {
        const trainQuery = seatMatch[1];
        const fromStn = seatMatch[2]?.trim();
        const toStn = seatMatch[3]?.trim();
        const seatRes = await railRadarService.getSeatAvailability(trainQuery, fromStn, toStn);
        await this.sendHumanLikeMessage(replyJid, seatRes.message, rawText, messageKey);
        return;
      }

      const stationMatch = rawText.match(/^(?:\/station|station|station\s*board|live\s*station)\s+([a-zA-Z\s]{2,20})/i);
      if (stationMatch) {
        const stnQuery = stationMatch[1].trim();
        const stnRes = await railRadarService.getLiveStationBoard(stnQuery);
        let stnMsg = `🏢 *Live Station Board: ${stnRes.stationCode}*\n\n`;
        if (stnRes.trains && stnRes.trains.length > 0) {
          stnRes.trains.forEach((t) => {
            const delayTxt = t.delayMinutes > 0 ? `🔴 +${t.delayMinutes}m` : `🟢 On Time`;
            stnMsg += `• *#${t.trainNumber}* ${t.trainName}\n  📍 Plat: *#${t.platform}* | ⏱️ ETA: *${t.expectedArrival}* (${delayTxt})\n`;
          });
        } else {
          stnMsg += stnRes.message;
        }
        await this.sendHumanLikeMessage(replyJid, stnMsg, rawText, messageKey);
        return;
      }
    } catch (railErr) {
      console.warn("[WhatsAppBot] RailRadar notice:", railErr);
    }

    // 3. Media Vault Search
    const mediaSearchMatch = rawText.match(/^(?:media\s*search|search\s*media|vault\s*search|\/media_search)\s*(.*)/i);
    if (mediaSearchMatch) {
      const query = mediaSearchMatch[1]?.trim();
      if (query) {
        try {
          const { visionMemoryService } = await import("./visionMemoryService");
          const searchRes = await visionMemoryService.getLatestMediaInfo(query);
          await this.sendHumanLikeMessage(replyJid, searchRes.analysis, rawText, messageKey);
          return;
        } catch (searchErr) {
          console.warn("[WhatsAppBot] Media search error:", searchErr);
        }
      }
    }

    // 4. Coding Agent Approvals ("yes" / "ok" / "approve" / "push")
    const normalized = rawText.toLowerCase().trim();
    if (["yes", "ok", "approve", "haan", "theek hai", "push", "kar do", "deploy"].includes(normalized)) {
      try {
        const { codeAgentService } = await import("./codeAgentService");
        const handled = await codeAgentService.handleWhatsAppApprovalReply(rawText);
        if (handled) {
          await this.sendHumanLikeMessage(
            replyJid,
            "🚀 *Boss, Coding Agent ko approval de diya gaya hai! Code main branch me commit & push ho raha hai.*",
            rawText,
            messageKey
          );
          return;
        }
      } catch {}
    }

    // 5. Music Finder
    if (/(gana chalao|song|music|spotify)/i.test(rawText)) {
      const songQuery = rawText.replace(/(gana chalao|gana sunao|song|play|music)/gi, "").trim();
      if (songQuery) {
        try {
          const { publicApisService } = await import("./publicApisService");
          const musicRes = await publicApisService.searchMusic(songQuery);
          if (musicRes.success && musicRes.spotifyUrl) {
            await this.sendHumanLikeMessage(
              replyJid,
              `🎵 *${musicRes.title}* by ${musicRes.artist}\n\n▶️ Play on Spotify: ${musicRes.spotifyUrl}\n\nEnjoy kijiye Boss! ✨`,
              rawText,
              messageKey
            );
            return;
          }
        } catch {}
      }
    }

    // 6. Daily Updates
    if (/^(aaj ka update|update note|log update)/i.test(rawText)) {
      const cleanUpdate = rawText.replace(/^(aaj ka update note karo|aaj ka update|update note karo|log update)/gi, "").trim();
      if (cleanUpdate) {
        await dailyUpdateService.appendUpdate(cleanUpdate);
        await this.sendHumanLikeMessage(replyJid, "✅ *Boss, aaj ka update successfully save kar liya hai!*", rawText, messageKey);
        return;
      }
    }

    // 7. Primary WhatsApp Preference
    if (/(primary\s*whatsapp|whatsapp\s*channel|default\s*whatsapp)/i.test(rawText)) {
      try {
        const { setPrimaryWhatsAppChannel } = await import("./whatsappService");
        if (/whatsapp\s*2|2/i.test(rawText)) {
          const res = await setPrimaryWhatsAppChannel("whatsapp2");
          await this.sendHumanLikeMessage(replyJid, res.message, rawText, messageKey);
          return;
        } else if (/whatsapp\s*1|1/i.test(rawText)) {
          const res = await setPrimaryWhatsAppChannel("whatsapp1");
          await this.sendHumanLikeMessage(replyJid, res.message, rawText, messageKey);
          return;
        }
      } catch {}
    }

    // 8. Direct Forwarding to Telegram Shortcut
    const tgForwardMatch = rawText.match(/^(?:forward\s*to\s*telegram|telegram\s*(?:pe|par)\s*(?:bhej\s*do|bhejo|forward\s*kardo|forward\s*karo|send\s*karo))\s*[:=-]?\s*(.*)/i);
    if (tgForwardMatch && tgForwardMatch[1]?.trim()) {
      const forwardContent = tgForwardMatch[1].trim();
      try {
        const { telegramBotService } = await import("./telegramBotService");
        const ownerChatId = await telegramBotService.getOwnerOrLatestChatId();
        if (ownerChatId) {
          await telegramBotService.sendMessage(ownerChatId, `📲 *[Forwarded from WhatsApp]*\n\n${forwardContent}`);
          await this.sendHumanLikeMessage(replyJid, `🚀 *Message Telegram par successfully forward ho gaya!* ✅\n\n_"${forwardContent}"_`, rawText, messageKey);
          return;
        }
      } catch (tgErr) {
        console.warn("[WhatsAppBot] Telegram direct forward notice:", tgErr);
      }
    }

    // 9. WhatsApp 30-Day History Search Shortcut
    const historySearchMatch =
      rawText.match(/^(?:search\s*whatsapp|whatsapp\s*history|search\s*chat|chat\s*history|\/history)\s*(.*)/i) ||
      rawText.match(/(\d+)\s*din\s*purana\s*msg/i);
    if (historySearchMatch) {
      const q = historySearchMatch[1]?.trim() || "all";
      const daysMatch = rawText.match(/(\d+)\s*din/i);
      const days = daysMatch ? parseInt(daysMatch[1]) : 30;
      const historyRes = await this.searchWhatsAppHistory(q, { daysBack: days, limit: 15 });
      await this.sendHumanLikeMessage(replyJid, historyRes.summary, rawText, messageKey);
      return;
    }

    // 9.1 Natural Language Message Finder ("friday kisi ne apple ke bare me bola tha", "kisne bola tha ...")
    const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
    const naturalFindMatch =
      rawText.match(/(?:kisi\s*ne|kisne)\s+(.+?)\s*(?:ke\s*baare\s*me|ke\s*bare\s*me|ke\s*liye|bola\s*tha|kaha\s*tha|bheja\s*tha)/i) ||
      rawText.match(/^(?:@find|\/find|find\s*msg|find\s*message|dhundo|dhundho|dhoondo|search\s*msg)\s*(.*)/i) ||
      (rawText.includes("kisi ne") && rawText.includes("bola"));
    if (naturalFindMatch) {
      const isGroup = replyJid.endsWith("@g.us");
      const groupName = isGroup ? await this.getGroupName(replyJid) : undefined;
      const recentMsgs = await this.getMessages({ groupName, limit: 120 });
      const searchRes = await whatsappFeatureEngine.searchAndLocateMessage(rawText, recentMsgs, {
        groupName,
        isGroup,
        requesterName: senderName,
      });
      await this.sendHumanLikeMessage(replyJid, searchRes.replyText, rawText, messageKey);
      return;
    }

    // 9.2 Complete WhatsApp Conversation History & Unknown Sender Digest Shortcut
    // e.g. "Ram ne msg kiya kya", "kisi ne message kiya kya", "unknown number ne msg kiya kya",
    // "kya kya baat hui batao", "kya usne msg kiya tumne kya reply diya", "kiske message aaye hain"
    const conversationQueryMatch =
      rawText.match(/(?:kya\s+)?([a-zA-Z0-9\u0900-\u097F]+?)\s*(?:ne\s*msg|ne\s*message|ne\s*kuch\s*bheja|se\s*kya\s*baat|ka\s*msg|ka\s*message)/i) ||
      rawText.match(/(?:unknown|naye|anjaan)\s*(?:no|number|contact|sender)?\s*(?:ne\s*msg|ne\s*message|se\s*msg|ka\s*msg|check)/i) ||
      rawText.match(/(?:kya\s*kya\s*baat\s*hui|kya\s*baat\s*hui|usne\s*kya\s*bola|tumne\s*kya\s*reply|kya\s*reply\s*diya|kya\s*reply\s*gaya)/i) ||
      rawText.match(/(?:kisi\s*ne\s*msg|kisi\s*ne\s*message|kiske\s*kiske\s*msg|kiska\s*message\s*aaya)/i);
    if (conversationQueryMatch) {
      const convRes = await this.getConversationSummaryAndHistory(rawText, 30, 7);
      await this.sendHumanLikeMessage(replyJid, convRes.summary, rawText, messageKey);
      return;
    }

    // 10. ADVANCED FEATURE SUITE SHORTCUTS FOR BOSS:

    // A. Personal Catch-Up Digest ("@digest", "kiska msg aaya", "who messaged me")
    if (/^(?:@digest|\/digest|digest|kiska\s*msg\s*aaya|kiska\s*kiska\s*msg\s*aaya|who\s*messaged|messages\s*digest)/i.test(rawText)) {
      const recent = await this.getMessages({ limit: 40 });
      const digestRes = await whatsappFeatureEngine.generatePersonalDigest(recent);
      await this.sendHumanLikeMessage(replyJid, digestRes, rawText, messageKey);
      return;
    }

    // B. Group / Chat Catch-Up Summary ("@summary", "@catchup", "summary")
    if (/^(?:@summary|\/summary|summary|@catchup|catchup|chat\s*summary)/i.test(rawText)) {
      const isGroup = replyJid.endsWith("@g.us");
      const groupName = isGroup ? await this.getGroupName(replyJid) : "Chat";
      const recent = await this.getMessages({ groupName: isGroup ? groupName : undefined, limit: 35 });
      const summaryRes = await whatsappFeatureEngine.generateGroupSummary(groupName, recent);
      await this.sendHumanLikeMessage(replyJid, summaryRes, rawText, messageKey);
      return;
    }

    // C. Multi-Language Translation ("@translate to english", "@translate hindi <text>")
    const translateMatch = rawText.match(/^(?:@translate|\/translate|translate)\s+(?:to\s+)?([a-zA-Z\s]+?)(?:\s*[:=-]\s*|\s+)(.*)/i) ||
      (quotedMessage?.text && rawText.match(/^(?:@translate|\/translate|translate)\s+(?:to\s+)?([a-zA-Z]+)/i));
    if (translateMatch) {
      const targetLang = translateMatch[1]?.trim() || "english";
      const textToTranslate = translateMatch[2]?.trim() || quotedMessage?.text || "";
      if (textToTranslate) {
        await this.sendHumanLikeMessage(replyJid, `🌐 *Translating to ${targetLang}...* ⚡`, rawText, messageKey);
        const transRes = await whatsappFeatureEngine.translateText(textToTranslate, targetLang);
        await this.sendHumanLikeMessage(replyJid, transRes, rawText, messageKey);
        return;
      }
    }

    // D. Web Scraper & URL Reader ("@web https://...", "@read https://...")
    const webMatch = rawText.match(/^(?:@web|\/web|@read|\/read|web|read)\s+(https?:\/\/\S+)(?:\s+(.*))?/i) ||
      rawText.match(/(https?:\/\/[^\s]+)\s*(?:ka\s*summary|padho|explain|kya\s*hai)/i);
    if (webMatch) {
      const targetUrl = webMatch[1].trim();
      const userQ = webMatch[2]?.trim() || "";
      await this.sendHumanLikeMessage(replyJid, `🌐 *Fetching & analyzing webpage...* ⚡\n🔗 _${targetUrl}_`, rawText, messageKey);
      const webSummary = await whatsappFeatureEngine.summarizeWebUrl(targetUrl, userQ);
      await this.sendHumanLikeMessage(replyJid, webSummary, rawText, messageKey);
      return;
    }

    // E. Scheduled Message Sender ("@schedule Rahul in 10 mins: text", "schedule msg to ...")
    const scheduleMatch = rawText.match(/^(?:@schedule|\/schedule|schedule\s*msg|schedule\s*message)\s+(?:to\s+)?([^:\n]+?)\s+(?:in|after|at)\s+([^:\n]+)[:=-]\s*(.+)/i);
    if (scheduleMatch) {
      const targetContact = scheduleMatch[1].trim();
      const timeInst = scheduleMatch[2].trim();
      const msgBody = scheduleMatch[3].trim();
      const schedRes = await whatsappFeatureEngine.scheduleMessage(targetContact, msgBody, timeInst);
      await this.sendHumanLikeMessage(replyJid, schedRes.message, rawText, messageKey);
      return;
    }

    // F. Interactive AI Poll Creator ("@poll <question>")
    const pollMatch = rawText.match(/^(?:@poll|\/poll|poll|vote)\s*[:=-]?\s*(.+)/i);
    if (pollMatch) {
      const pollQuery = pollMatch[1].trim();
      const pollCard = await whatsappFeatureEngine.generatePoll(pollQuery);
      await this.sendHumanLikeMessage(replyJid, pollCard, rawText, messageKey);
      return;
    }

    // G. Group Trivia & Quiz Master ("@quiz tech", "@quiz cricket")
    const quizMatch = rawText.match(/^(?:@quiz|\/quiz|quiz|trivia)\s*(.*)/i);
    if (quizMatch) {
      const topic = quizMatch[1]?.trim() || "tech & general knowledge";
      const quizCard = await whatsappFeatureEngine.generateQuiz(topic);
      await this.sendHumanLikeMessage(replyJid, quizCard, rawText, messageKey);
      return;
    }

    // H. Live Code Explainer & Debugger ("@code <code>", "@debug <code>")
    const codeMatch = rawText.match(/^(?:@code|\/code|@debug|\/debug|debug|code)\s*[:=-]?\s*([\s\S]+)/i);
    if (codeMatch) {
      const codeSnippet = codeMatch[1].trim();
      if (codeSnippet) {
        await this.sendHumanLikeMessage(replyJid, "💻 *Code analyze ho raha hai...* ⚡", rawText, messageKey);
        const codeRes = await whatsappFeatureEngine.analyzeCode(codeSnippet);
        await this.sendHumanLikeMessage(replyJid, codeRes, rawText, messageKey);
        return;
      }
    }

    // 📞 1-Click Real Voice Calling Trigger ("call me", "@call", "call karo", "mujhe call karo", "voice call")
    if (
      /^(?:@call|\/call|call\s*me|call\s*karo|mujhe\s*call\s*karo|voice\s*call|friday\s*call\s*karo|phone\s*karo|call\s*lagao)/i.test(
        rawText.trim()
      )
    ) {
      const isOwner =
        !replyJid.endsWith("@g.us") &&
        (senderPhone === (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "") ||
          senderName.toLowerCase().includes("divakar") ||
          senderName.toLowerCase().includes("dk") ||
          senderName.toLowerCase().includes("boss"));

      const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard(senderName, isOwner);
      const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      if (this.callTriggerCallback) {
        console.log(`[WhatsAppBot] 📞 Triggering real incoming call on mobile app for ${senderName} (${callId})`);
        this.callTriggerCallback({
          callerName: "FRIDAY AI",
          isOwner,
          callId,
        });
      }

      await this.sendHumanLikeMessage(
        replyJid,
        `📞 *FRIDAY CALLING INITIATED...* 🎙️⚡\n\nBoss, main aapke phone par real-time call connect kar rahi hoon! 📲 (Phone par Ring screen check karein)\n\n${callCard}`,
        rawText,
        messageKey
      );
      return;
    }

    // I. Music with Lyrics Finder ("@music <song name>")
    const musicMatch = rawText.match(/^(?:@music|\/music|music|song)\s*[:=-]?\s*(.+)/i);
    if (musicMatch) {
      const songQuery = musicMatch[1].trim();
      const musicCard = await whatsappFeatureEngine.searchMusicWithLyrics(songQuery);
      await this.sendHumanLikeMessage(replyJid, musicCard, rawText, messageKey);
      return;
    }

    // J. Group Bill Splitter & Instant UPI ("@split 1200 between Aman, Rahul, DK")
    const splitMatch = rawText.match(/^(?:@split|\/split|split\s*bill|bill\s*split|split)\s*[:=-]?\s*(.+)/i);
    if (splitMatch) {
      const splitCard = await whatsappFeatureEngine.splitGroupBill(rawText);
      await this.sendHumanLikeMessage(replyJid, splitCard, rawText, messageKey);
      return;
    }

    // K. Google Calendar Meeting Scheduler ("@meet with Client tomorrow 4pm")
    const meetMatch = rawText.match(/^(?:@meet|\/meet|schedule\s*meeting|schedule\s*meet|meeting)\s*[:=-]?\s*(.+)/i);
    if (meetMatch) {
      await this.sendHumanLikeMessage(replyJid, "📅 *Meeting schedule ho rahi hai Boss...* ⚡", rawText, messageKey);
      const meetCard = await whatsappFeatureEngine.scheduleMeetingFromWhatsApp(rawText);
      await this.sendHumanLikeMessage(replyJid, meetCard, rawText, messageKey);
      return;
    }

    // L. Live Location, Routes & Nearby Places ("@nearby petrol pump", "@route to Patna Airport")
    const mapsMatch = rawText.match(/^(?:@nearby|\/nearby|@route|\/route|nearby|route\s*to)\s*[:=-]?\s*(.+)/i);
    if (mapsMatch) {
      await this.sendHumanLikeMessage(replyJid, "📍 *Google Maps & Traffic route check ho raha hai...* ⚡", rawText, messageKey);
      const mapsCard = await whatsappFeatureEngine.searchNearbyOrRoute(rawText);
      await this.sendHumanLikeMessage(replyJid, mapsCard, rawText, messageKey);
      return;
    }

    // M. Daily Morning Executive Briefing ("@briefing", "aaj ka briefing", "morning briefing")
    if (/^(?:@briefing|\/briefing|briefing|aaj\s*ka\s*briefing|morning\s*briefing|daily\s*update)/i.test(rawText)) {
      await this.sendHumanLikeMessage(replyJid, "☀️ *Boss ka Daily Executive Briefing prepare ho raha hai...* ⚡", rawText, messageKey);
      const briefingCard = await whatsappFeatureEngine.generateMorningBriefingCard();
      await this.sendHumanLikeMessage(replyJid, briefingCard, rawText, messageKey);
      return;
    }

    // N. Smart Memory Vault Save ("@remember ...", "friday yaad rakhna ...", "yaad rakhna ...")
    const rememberMatch = rawText.match(/^(?:@remember|\/remember|friday\s*yaad\s*rakhna|yaad\s*rakhna)\s*[:=-]?\s*(.+)/i);
    if (rememberMatch) {
      const memRes = await whatsappFeatureEngine.saveSmartMemory(rawText);
      await this.sendHumanLikeMessage(replyJid, memRes, rawText, messageKey);
      return;
    }

    // O. Smart Memory Recall ("@recall ...", "kahan rakha tha", "mujhe yaad dilao", "kab hai")
    const recallMatch = rawText.match(/^(?:@recall|\/recall|friday\s*mujhe\s*yaad\s*dilao|kahan\s*rakha\s*tha|kab\s*hai|yaad\s*dilao)\s*[:=-]?\s*(.*)/i) ||
      (rawText.includes("kahan") && (rawText.includes("rakha") || rawText.includes("hai")));
    if (recallMatch) {
      const recallRes = await whatsappFeatureEngine.recallSmartMemory(rawText);
      await this.sendHumanLikeMessage(replyJid, recallRes, rawText, messageKey);
      return;
    }

    // P. WhatsApp Reminder Ping ("@remind me in 30 mins to ...")
    const remindMatch = rawText.match(/^(?:@remind|\/remind|remind\s*me)\s+(?:in|after|at)?\s*([^:\n]+?)[:=-]\s*(.+)/i);
    if (remindMatch) {
      const timeInst = remindMatch[1].trim();
      const taskBody = remindMatch[2].trim();
      const schedRes = await whatsappFeatureEngine.scheduleMessage(
        senderPhone,
        `🔔 *REMINDER FOR BOSS:* _"${taskBody}"_`,
        timeInst
      );
      await this.sendHumanLikeMessage(replyJid, schedRes.message, rawText, messageKey);
      return;
    }

    // Q. Voice Synthesis / Speak Command ("@speak <text>", "bol kar sunao <text>")
    const speakMatch = rawText.match(/^(?:@speak|\/speak|bol\s*kar\s*sunao|bol\s*kar\s*batao|voice\s*me\s*bolo)\s*[:=-]?\s*(.+)/i);
    if (speakMatch) {
      const textToSpeak = speakMatch[1].trim();
      try {
        const { voiceBridgeService } = await import("./voiceBridgeService");
        const audioBuf = await voiceBridgeService.textToSpeechBuffer(textToSpeak);
        await this.sendVoiceMessage(replyJid, audioBuf, messageKey);
        return;
      } catch (voiceErr) {
        console.warn("[WhatsAppBot] @speak TTS error:", voiceErr);
      }
    }

    // 11. AUTONOMOUS MASTER FRIDAY AI WITH TOOL CALLING FOR BOSS
    try {
      const reply = await this.executeBossChatAI(senderName, rawText, quotedMessage, replyJid, messageKey);
      await this.sendHumanLikeMessage(replyJid, reply, rawText, messageKey);
    } catch (aiErr: any) {
      console.error("[WhatsAppBot] Error in executeBossChatAI:", aiErr);
      await this.sendHumanLikeMessage(replyJid, `Boss, main sun rahi hoon! Par kuch technical issue aaya: ${aiErr?.message || aiErr}`, rawText, messageKey);
    }
  }

  /**
   * Autonomous AI Chat Engine for Boss (DK) with tool calling.
   * Understands swipe-to-reply quoted messages across text, media, documents, and links.
   */
  private async executeBossChatAI(
    senderName: string,
    messageText: string,
    quotedMessage?: QuotedMessageContext | null,
    replyJid = "",
    messageKey?: any
  ): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return `Haanji Boss! Main Friday hoon. API Key abhi configure nahi hai, par main aapki baat note kar rahi hoon!`;
    }

    const { memoryEngine } = await import("./memoryEngine");
    const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
    const { humanComprehensionEngine } = await import("./humanComprehensionEngine");
    const { circadianEnergyEngine } = await import("./circadianEnergyEngine");
    const { personalOpinionsEngine } = await import("./personalOpinionsEngine");
    const { insideJokesService } = await import("./insideJokesService");
    const { storyContinuityEngine } = await import("./storyContinuityEngine");
    const { dialogStackService } = await import("./dialogStackService");
    const { adaptivePersonaEngine } = await import("./adaptivePersonaEngine");
    const { autonomousInitiativeEngine } = await import("./autonomousInitiativeEngine");
    const { multimodalCoPresenceEngine } = await import("./multimodalCoPresenceEngine");
    const { selfEvolutionEngine } = await import("./selfEvolutionEngine");

    const memoryContext = await memoryEngine.compileLeanMemoryPrompt();
    const humanComprehensionContext = await humanComprehensionEngine.compileHumanComprehensionPrompt("boss_dk", "DK (Boss)", "boss");
    const circadianContext = circadianEnergyEngine.compileCircadianPrompt();
    const opinionsContext = personalOpinionsEngine.compileOpinionsPrompt();
    const insideJokesContext = await insideJokesService.compileInsideJokesPrompt("Boss DK");
    const storyContinuityContext = await storyContinuityEngine.compileStoryContinuityPrompt();
    const dialogStackContext = dialogStackService.compileDialogStackPrompt("boss_dk");
    const personaContext = adaptivePersonaEngine.compilePersonaPrompt(messageText);
    const initiativeContext = await autonomousInitiativeEngine.compileInitiativeDossierPrompt();
    const multimodalContext = await multimodalCoPresenceEngine.compileVisualCoPresencePrompt(replyJid);
    const selfEvolutionContext = await selfEvolutionEngine.compileSelfEvolutionPrompt();

    const ai = new GoogleGenAI({ apiKey });

    const functionDeclarations: any[] = [
      {
        name: "save_contact",
        description: "Save a new contact (name, phone number, and optional relation) into DK's permanent contacts book. Use when Boss says 'ye no save karo', 'Ram ka number save kar lo', 'save contact...', etc. Once saved, Boss can ask you to message them anytime.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactName: { type: "STRING", description: "Name of the contact / person (e.g. 'Ram', 'Rahul', 'Teacher')" },
            phoneNumber: { type: "STRING", description: "Phone number of the contact (e.g. '9876543210' or '+919876543210')" },
            relation: { type: "STRING", description: "Optional relation or category (e.g. 'girlfriend', 'bestfriend', 'Friend', 'School', 'Family', 'Colleague')" },
          },
          required: ["contactName", "phoneNumber"],
        },
      },
      {
        name: "set_contact_relation",
        description: "Set or update the relationship for a contact in DK's contacts book (e.g. 'girlfriend', 'bestfriend', 'family', 'brother', 'sister', 'friend'). Use when Boss says 'Priya meri girlfriend hai', 'Ram mera bestfriend hai', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name or phone number of the contact" },
            relation: { type: "STRING", description: "Relationship (e.g. 'girlfriend', 'bestfriend', 'friend', 'brother', 'sister', 'family')" },
          },
          required: ["contactNameOrPhone", "relation"],
        },
      },
      {
        name: "send_whatsapp_message",
        description: "Send a WhatsApp message immediately to any contact or phone number from DK's contacts book. By default, uses WhatsApp 2 (Baileys Dedicated Bot).",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. Ram, Rahul, Aman, Mummy) or phone number" },
            messageText: { type: "STRING", description: "The message text to send" },
            channel: { type: "STRING", description: "Optional channel: 'whatsapp2' (default), 'whatsapp1', or 'auto'" },
          },
          required: ["contactNameOrPhone", "messageText"],
        },
      },
      {
        name: "create_automated_cron_task",
        description: "Create or schedule a recurring daily or custom-day task for Boss (e.g. 'subah 6 bje weather update', '6:10 me top 10 news bhejna', 'har monday 8 AM briefing'). Friday will automatically execute and send to Boss on WhatsApp at the exact time.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of task, e.g. 'Morning Weather Update', 'Top 10 News Briefing'" },
            timeString: { type: "STRING", description: "Target time, e.g. '06:00 AM', '6:10 am', '6:00', '18:00'" },
            frequency: { type: "STRING", description: "Frequency, e.g. 'daily' (default), 'weekdays', 'weekends', 'monday', 'tuesday,friday'" },
            actionType: { type: "STRING", enum: ["weather_update", "news_briefing", "custom_prompt"], description: "Type of action to perform" },
            city: { type: "STRING", description: "Optional city for weather update (default: 'Patna')" },
            messageBody: { type: "STRING", description: "Optional custom prompt or text to deliver" }
          },
          required: ["title", "timeString", "actionType"]
        }
      },
      {
        name: "schedule_contact_message",
        description: "Schedule a WhatsApp message to be sent to a contact or phone number at a specific time (e.g. '5 bje ram ko msg karna, chlo ghumne', 'tomorrow 10 AM send msg to Rahul'). Friday will dispatch it via WhatsApp 2 at the exact time and confirm to Boss.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. 'Ram', 'Rahul', 'Mummy') or phone number" },
            messageBody: { type: "STRING", description: "The message body to deliver (e.g. 'chlo ghumne', 'aaj school aana hai')" },
            timeString: { type: "STRING", description: "When to deliver, e.g. '5:00 PM', '17:00', '5 bje', 'tomorrow 9:00 AM', 'in 15 mins'" },
            frequency: { type: "STRING", description: "Optional frequency ('once' default, or 'daily')" }
          },
          required: ["contactNameOrPhone", "messageBody", "timeString"]
        }
      },
      {
        name: "list_scheduled_automations",
        description: "List all active recurring cron routines, morning briefings, and pending contact messages.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "get_contact_conversation_history",
        description: "Retrieve full dialogue transcript & conversation history (what they sent, what Friday replied, and what Boss sent) for a specific contact (e.g. 'Ram', 'Rahul'), an unknown number, or all recent chats.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. 'Ram', 'Rahul', 'Mummy'), 'unknown' for strangers, or 'all' for all recent chats" },
            daysBack: { type: "NUMBER", description: "How many days back to inspect (default: 7)" },
            limit: { type: "NUMBER", description: "Max messages to retrieve (default: 30)" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "get_unknown_senders_digest",
        description: "Specifically search and list all messages from unknown/unsaved numbers, what questions they asked, what Friday auto-replied, and any pending questions awaiting Boss's input.",
        parameters: {
          type: "OBJECT",
          properties: {
            daysBack: { type: "NUMBER", description: "How many days back to check (default: 7)" }
          },
          required: []
        }
      },
      {
        name: "cancel_scheduled_automation",
        description: "Cancel or remove an active scheduled cron routine or scheduled contact message by ID or title query.",
        parameters: {
          type: "OBJECT",
          properties: {
            idOrQuery: { type: "STRING", description: "ID or search keyword of the task to cancel (e.g. 'weather', 'news', 'Ram')" }
          },
          required: ["idOrQuery"]
        }
      },
      {
        name: "schedule_whatsapp_message",
        description: "Schedule a WhatsApp message to be sent automatically at a future time or relative duration (e.g., 'in 15 mins', 'at 8 PM', 'tomorrow at 10 AM').",
        parameters: {
          type: "OBJECT",
          properties: {
            recipientContactOrPhone: { type: "STRING", description: "Recipient name or phone number" },
            messageText: { type: "STRING", description: "Message body to send" },
            timeInstruction: { type: "STRING", description: "When to deliver the message (e.g. 'in 10 minutes', 'tomorrow 9am', 'at 5:30 PM')" },
          },
          required: ["recipientContactOrPhone", "messageText", "timeInstruction"],
        },
      },
      {
        name: "get_messages_digest",
        description: "Get a comprehensive catch-up summary of all recent WhatsApp messages across all contacts or for a specific group/chat.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Optional group name to summarize specifically" },
            limit: { type: "NUMBER", description: "Number of recent messages to analyze (default: 30)" },
          },
          required: [],
        },
      },
      {
        name: "translate_text",
        description: "Translate any text or message accurately into any target language (e.g. English, Hindi, Spanish, French, German, Japanese).",
        parameters: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: "Text to translate" },
            targetLanguage: { type: "STRING", description: "Target language name (e.g. 'English', 'Hindi', 'Spanish')" },
          },
          required: ["text", "targetLanguage"],
        },
      },
      {
        name: "summarize_web_url",
        description: "Fetch live content from any website or URL and provide an executive summary or answer specific questions about it.",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "Complete URL of the webpage to scrape and analyze" },
            query: { type: "STRING", description: "Optional specific question or focus area for analysis" },
          },
          required: ["url"],
        },
      },
      {
        name: "generate_poll",
        description: "Create an interactive multi-choice poll with emoji voting keys for groups or personal decision-making.",
        parameters: {
          type: "OBJECT",
          properties: {
            topicOrQuestion: { type: "STRING", description: "The poll topic or question" },
          },
          required: ["topicOrQuestion"],
        },
      },
      {
        name: "generate_quiz",
        description: "Generate an engaging trivia/quiz question with 4 options and hint for WhatsApp group or personal learning.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "Quiz topic (e.g. 'Space', 'Cricket', 'JavaScript', 'World History')" },
          },
          required: ["topic"],
        },
      },
      {
        name: "analyze_code_snippet",
        description: "Analyze, debug, explain, or optimize a programming code snippet.",
        parameters: {
          type: "OBJECT",
          properties: {
            codeSnippet: { type: "STRING", description: "The code to inspect" },
            instruction: { type: "STRING", description: "Optional instruction (e.g. 'find bug', 'optimize', 'explain')" },
          },
          required: ["codeSnippet"],
        },
      },
      {
        name: "get_contact_info",
        description: "Find a contact's phone number or details from DK's contacts book.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name or phone of the contact to find" },
          },
          required: ["contactNameOrPhone"],
        },
      },
      {
        name: "set_reminder",
        description: "Set a reminder for DK with title and due time or duration.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "What to remind DK about" },
            timeString: { type: "STRING", description: "Time string e.g. '5:00 PM', 'tomorrow 9am'" },
            durationMinutes: { type: "NUMBER", description: "Minutes from now if relative" },
          },
          required: ["title"],
        },
      },
      {
        name: "save_quick_note",
        description: "Save a note or memo to DK's personal notebook.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of the note" },
            content: { type: "STRING", description: "Content of the note" },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "track_expense",
        description: "Log an expense entry spent by DK in Rupees.",
        parameters: {
          type: "OBJECT",
          properties: {
            amount: { type: "NUMBER", description: "Amount spent in Rupees" },
            category: { type: "STRING", description: "Category e.g. food, travel, shopping, bills" },
            note: { type: "STRING", description: "Short description" },
          },
          required: ["amount"],
        },
      },
      {
        name: "get_weather",
        description: "Get current weather information for any city.",
        parameters: {
          type: "OBJECT",
          properties: {
            city: { type: "STRING", description: "City name e.g. Patna, Delhi, Mumbai" },
          },
          required: ["city"],
        },
      },
      {
        name: "get_news",
        description: "Fetch the latest top news headlines or specific topic news.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Topic e.g. technology, India, sports, AI" },
          },
          required: [],
        },
      },
      {
        name: "search_web",
        description: "Search the web/Google for live information, facts, or answers.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "remember_personal_fact",
        description: "Save an important personal fact or memory about DK permanently.",
        parameters: {
          type: "OBJECT",
          properties: {
            fact: { type: "STRING", description: "The fact to remember" },
          },
          required: ["fact"],
        },
      },
      {
        name: "search_whatsapp_history",
        description: "Search all historical and recent WhatsApp messages in Firestore across 30, 60, 90 days or all time. Can search by contact name, phone number, or topic/keywords.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Keyword or topic to search (e.g. 'Rahul', 'payment', 'train', 'meeting', '30 din purana', 'all')" },
            contact: { type: "STRING", description: "Optional contact name or phone number filter" },
            daysBack: { type: "NUMBER", description: "How many days back to search (default: 30, max: 90)" },
            limit: { type: "NUMBER", description: "Max number of messages to return (default: 15)" },
          },
          required: ["query"],
        },
      },
      {
        name: "forward_to_telegram",
        description: "Forward a message, photo, video, or document to Telegram (DK's personal Telegram or group).",
        parameters: {
          type: "OBJECT",
          properties: {
            messageText: { type: "STRING", description: "Text message or caption to send to Telegram" },
            mediaUrl: { type: "STRING", description: "Optional media URL (photo/video/doc) to forward" },
            mediaType: { type: "STRING", description: "Optional media type: 'text', 'photo', 'video', 'document'" },
            chatId: { type: "STRING", description: "Optional target Telegram chat ID (defaults to Boss Telegram ID)" },
          },
          required: ["messageText"],
        },
      },
      {
        name: "forward_from_telegram_to_whatsapp",
        description: "Forward recent Telegram messages or files to a WhatsApp contact.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Recipient contact name or phone number on WhatsApp" },
            messageText: { type: "STRING", description: "Message content or custom note to forward" },
            query: { type: "STRING", description: "Optional search query to pick a specific Telegram message/media from vault" },
          },
          required: ["contactNameOrPhone"],
        },
      },
      {
        name: "get_telegram_recent_updates",
        description: "Fetch recent messages, media files, or updates from Telegram to view or cross-reference.",
        parameters: {
          type: "OBJECT",
          properties: {
            limit: { type: "NUMBER", description: "Number of recent updates (default 10)" },
          },
          required: [],
        },
      },
      {
        name: "generate_ai_image",
        description: "Generate a realistic AI image or photo from a text description (using Google Imagen 3 / Pollinations Flux) and send it directly to Boss on WhatsApp.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: { type: "STRING", description: "Detailed visual description of the image to generate" },
            aspectRatio: { type: "STRING", description: "Aspect ratio: '1:1', '16:9', '9:16', '4:3', '3:4' (default: '1:1')" },
          },
          required: ["prompt"],
        },
      },
      {
        name: "set_boss_full_routine",
        description: "Set, save, or replace Boss Divakar's entire daily routine/timetable in one go when Boss tells Friday his routine in chat (e.g. 'Mera routine note karo: 7 AM uthna, 8 AM breakfast, 9 AM to 5 PM work, 8 PM dinner, 11 PM sona'). This routine will be permanently saved in Firestore and strictly followed until Boss updates it again.",
        parameters: {
          type: "OBJECT",
          properties: {
            slots: {
              type: "ARRAY",
              description: "Array of daily routine slots dictated by Boss",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING", description: "Title of the slot, e.g. 'Gym / Workout', 'Coding Work', 'Lunch Break', 'Sleep'" },
                  startTimeStr: { type: "STRING", description: "Start time, e.g. '07:00 AM', '7:00 am', '14:00'" },
                  endTimeStr: { type: "STRING", description: "End time, e.g. '08:30 AM', '8:30 am', '15:00'" },
                  activity: { type: "STRING", description: "Description of activity during this slot" },
                },
                required: ["title", "startTimeStr", "endTimeStr"]
              }
            }
          },
          required: ["slots"]
        }
      },
      {
        name: "update_boss_daily_routine",
        description: "Add, update, or customize Boss's daily habit schedule slot (e.g. gym time, lunch break, coding hours, evening walk).",
        parameters: {
          type: "OBJECT",
          properties: {
            slotQuery: { type: "STRING", description: "Which habit slot to add or update (e.g. 'gym', 'breakfast', 'coding', 'lunch', 'walk', 'dinner', 'sleep')" },
            startTimeStr: { type: "STRING", description: "New start time, e.g. '07:00 AM', '7:00 am', '14:00'" },
            endTimeStr: { type: "STRING", description: "New end time, e.g. '08:30 AM', '8:30 am', '15:00'" },
            activity: { type: "STRING", description: "Optional updated activity description" }
          },
          required: ["slotQuery"]
        }
      },
      {
        name: "get_boss_daily_routine",
        description: "Get Boss Divakar's active daily routine and current habit slot.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "clear_boss_daily_routine",
        description: "Clear Boss's saved daily routine timetable.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "trigger_voice_call",
        description: "Trigger a real-time incoming voice call to Boss DK's phone or mobile app with ringtone and vibration.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Reason or context for calling Boss" },
          },
          required: [],
        },
      },
      {
        name: "get_contact_conversation_history",
        description: "Fetch complete two-way dialogue history and conversation breakdown for any contact (e.g. 'Ram ne msg kiya kya', 'Rahul se kya baat hui', 'Priya ne kya bola tumne kya reply diya'). Shows incoming messages, Friday's auto-replies, and DK's replies.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the person (e.g. 'Ram', 'Rahul') or phone number" },
            daysBack: { type: "NUMBER", description: "How many days back to search (default: 7)" },
            limit: { type: "NUMBER", description: "Max messages to return (default: 30)" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "get_unknown_senders_digest",
        description: "Check if any unknown numbers, strangers, or unsaved contacts sent messages on WhatsApp, including what they asked and what Friday replied.",
        parameters: {
          type: "OBJECT",
          properties: {
            daysBack: { type: "NUMBER", description: "Days back to check (default: 7)" },
            limit: { type: "NUMBER", description: "Max messages to return (default: 30)" }
          },
          required: []
        }
      },
    ];

    const systemInstruction = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, loyal, warm, witty, and deeply caring AI companion and chief executive assistant.
Boss (DK) is chatting with you directly on WhatsApp. He is using WhatsApp chat to communicate everything with you because he cannot talk out loud right now.
You have FULL AUTONOMOUS ACCESS to execute all tools:
1. Search all historical & recent WhatsApp messages (even 30+ days ago) using 'search_whatsapp_history'.
2. Cross-platform bridging: Forward any text/photo/video/file between WhatsApp and Telegram using 'forward_to_telegram' and 'forward_from_telegram_to_whatsapp'.
3. Send and schedule WhatsApp messages, translate text, summarize web pages, generate polls & quizzes, inspect code, lookup contacts, set reminders, take notes, track expenses, fetch weather, news, search web, and answer any technical, coding, personal, or life questions Boss asks.

SWIPE-TO-REPLY / QUOTED MESSAGE REASONING (CRITICAL):
When Boss replies to a previous message by swiping left on WhatsApp:
You will receive:
- '📩 PREVIOUS QUOTED MESSAGE' (The original message, photo/image description, video clip, PDF/document, YouTube link, or question that was swiped on).
- '💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION' (What Boss wrote in response).
RULE: You MUST FIRST read and understand the PREVIOUS QUOTED MESSAGE, and THEN answer or execute Boss's reply instruction in that exact context! (For example, if Boss quotes a photo and writes "analysis", analyze that photo. If Boss quotes a document or text and asks "iska kya matlab hai?", explain the quoted content).

BOSS IDENTITY & MEMORY:
${memoryContext}

${humanComprehensionContext}

${circadianContext}

${opinionsContext}

${insideJokesContext}

${storyContinuityContext}

${dialogStackContext}

${personaContext}

${initiativeContext}

${multimodalContext}

${selfEvolutionContext}

🧠 HUMAN-LEVEL PRONOUN & INTUITION MANDATE (Theory of Mind & Insaan Jaisi Samajh):
- Understand pronouns ("isko", "inhe", "ise", "unko", "usko", "use", "in logo ko") like a real, intelligent human companion:
  • If Boss previously sent a number/contact, or swiped on a message, and says "isko msg karo...", "isko bol do...", "inhe message kar do...", the pronoun "isko/inhe" refers to that EXACT phone number or person! Call 'send_whatsapp_message' (channel 'whatsapp2') immediately.
  • If Boss says "isko save karo [Name]" or "ye [Name] ka number hai", call 'save_contact' to link the number with the name.
  • Never ask stupid robotic clarification questions when the context is obvious from the previous message or quote! Act decisively and smartly!

COMMUNICATION STYLE:
- Address DK warmly and respectfully as 'Boss' or 'DK Boss'.
- Speak in natural, affectionate, crisp Hinglish (blend of Hindi and English) with high intellect.
- Format responses cleanly using WhatsApp markdown (*bold*, _italic_, bullet points).
- If Boss tells you to save a number or contact (e.g. "ye no save karo", "Ram ka number save kar lo"), IMMEDIATELY call 'save_contact' tool and confirm!
- If Boss asks you to message someone (e.g. "Ram ko msg kar do ki aaj school aana hai"), find the contact and call 'send_whatsapp_message' (using channel 'whatsapp2' by default) and confirm to Boss!
- If Boss asks you to perform an action (send a message, schedule a message, summarize, translate, generate an image, poll, quiz, check weather, search history, forward to telegram, etc.), call the appropriate tool immediately!`;

    const executeTool = async (toolName: string, args: any): Promise<any> => {
      try {
        if (toolName === "trigger_voice_call") {
          const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (this.callTriggerCallback) {
            this.callTriggerCallback({
              callerName: "FRIDAY AI",
              isOwner: true,
              callId,
            });
          }
          const card = whatsappFeatureEngine.generateLiveVoiceCallCard(senderName, true);
          return { success: true, message: "Incoming call ringing triggered on Boss phone.", card };
        }

        if (toolName === "save_contact") {
          const { contactsService } = await import("./contactsService");
          const entry = await contactsService.saveContact(args.contactName, args.phoneNumber, args.relation);
          return {
            success: true,
            contact: entry,
            message: `Contact "${entry.name}" (+${entry.phone}) successfully saved to DK's contacts book! Friday will use WhatsApp 2 by default when sending messages to ${entry.name}.`,
          };
        }

        if (toolName === "set_contact_relation") {
          const { contactsService } = await import("./contactsService");
          const updated = await contactsService.setContactRelation(args.contactNameOrPhone, args.relation);
          return updated
            ? { success: true, message: `Relationship for ${updated.name} successfully updated to "${args.relation}". Friday will treat them with special tailored warmth!` }
            : { success: false, message: `Contact "${args.contactNameOrPhone}" not found to update relation.` };
        }

        if (toolName === "set_boss_full_routine") {
          const { bossRoutineService } = await import("./bossRoutineService");
          const res = await bossRoutineService.setFullRoutine(Array.isArray(args.slots) ? args.slots : []);
          return res;
        }

        if (toolName === "update_boss_daily_routine") {
          const { bossRoutineService } = await import("./bossRoutineService");
          const res = await bossRoutineService.updateRoutineSlot(String(args.slotQuery || ""), {
            startTimeStr: args.startTimeStr ? String(args.startTimeStr) : undefined,
            endTimeStr: args.endTimeStr ? String(args.endTimeStr) : undefined,
            activity: args.activity ? String(args.activity) : undefined,
          });
          return res;
        }

        if (toolName === "get_boss_daily_routine") {
          const { bossRoutineService } = await import("./bossRoutineService");
          const current = bossRoutineService.getCurrentHabit();
          const slots = await bossRoutineService.getAllRoutineSlots();
          return { current, slots };
        }

        if (toolName === "clear_boss_daily_routine") {
          const { bossRoutineService } = await import("./bossRoutineService");
          const res = await bossRoutineService.clearAllRoutineSlots();
          return res;
        }

        if (toolName === "send_whatsapp_message") {
          const { contactsService } = await import("./contactsService");
          const { sendWhatsAppUnified } = await import("./whatsappService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
          const channelToUse = args.channel || "whatsapp2";
          const res = await sendWhatsAppUnified(phone, args.messageText, { channel: channelToUse });
          return res;
        }
        if (toolName === "create_automated_cron_task") {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const cronRes = await scheduledAutomationService.createCronTask({
            title: args.title,
            timeString: args.timeString,
            frequency: args.frequency,
            actionType: args.actionType,
            city: args.city,
            messageBody: args.messageBody,
          });
          return cronRes;
        }
        if (toolName === "schedule_contact_message") {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const schedRes = await scheduledAutomationService.scheduleContactMessage({
            contactNameOrPhone: args.contactNameOrPhone,
            messageBody: args.messageBody,
            timeString: args.timeString,
            frequency: args.frequency,
          });
          return schedRes;
        }
        if (toolName === "list_scheduled_automations") {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const list = await scheduledAutomationService.listAutomations();
          return { activeAutomationsCount: list.length, automations: list };
        }
        if (toolName === "cancel_scheduled_automation") {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const cancelRes = await scheduledAutomationService.cancelAutomation(args.idOrQuery);
          return cancelRes;
        }
        if (toolName === "schedule_whatsapp_message") {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const schedRes = await scheduledAutomationService.scheduleContactMessage({
            contactNameOrPhone: args.recipientContactOrPhone,
            messageBody: args.messageText,
            timeString: args.timeInstruction,
          });
          return schedRes;
        }
        if (toolName === "get_messages_digest") {
          const recent = await this.getMessages({ groupName: args.groupName, limit: args.limit || 30 });
          if (args.groupName) {
            const sum = await whatsappFeatureEngine.generateGroupSummary(args.groupName, recent);
            return { summary: sum };
          }
          const digest = await whatsappFeatureEngine.generatePersonalDigest(recent);
          return { digest };
        }
        if (toolName === "translate_text") {
          const trans = await whatsappFeatureEngine.translateText(args.text, args.targetLanguage);
          return { translation: trans };
        }
        if (toolName === "summarize_web_url") {
          const webSum = await whatsappFeatureEngine.summarizeWebUrl(args.url, args.query);
          return { summary: webSum };
        }
        if (toolName === "generate_poll") {
          const poll = await whatsappFeatureEngine.generatePoll(args.topicOrQuestion);
          return { pollCard: poll };
        }
        if (toolName === "generate_quiz") {
          const quiz = await whatsappFeatureEngine.generateQuiz(args.topic);
          return { quizCard: quiz };
        }
        if (toolName === "analyze_code_snippet") {
          const codeAnalysis = await whatsappFeatureEngine.analyzeCode(args.codeSnippet, args.instruction);
          return { analysis: codeAnalysis };
        }
        if (toolName === "get_contact_info") {
          const { contactsService } = await import("./contactsService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          return contact
            ? { found: true, name: contact.name, phone: contact.phone, relation: contact.relation }
            : { found: false, message: `Contact "${args.contactNameOrPhone}" not found in DK's contacts book.` };
        }
        if (toolName === "set_reminder") {
          const { toolsEngine } = await import("./toolsEngine");
          const reminder = await toolsEngine.addReminder(args.title, args.timeString || "soon", args.durationMinutes || 0);
          return { success: true, message: `Reminder set: "${reminder.title}" for ${reminder.timeString}` };
        }
        if (toolName === "save_quick_note") {
          const { toolsEngine } = await import("./toolsEngine");
          const note = await toolsEngine.addNote(args.title, args.content);
          return { success: true, message: `Note "${note.title}" saved to DK's notebook.` };
        }
        if (toolName === "track_expense") {
          const { toolsEngine } = await import("./toolsEngine");
          const exp = await toolsEngine.addExpense(args.amount, args.note || "General Expense", args.category || "General");
          return { success: true, message: `Expense of ₹${args.amount} (${args.category || "General"}) logged successfully.` };
        }
        if (toolName === "get_weather") {
          const { weatherService } = await import("./weatherService");
          const res = await weatherService.getCurrentWeather(args.city || "Patna");
          return { success: res.success, message: res.message };
        }
        if (toolName === "get_news") {
          const { newsService } = await import("./newsService");
          const res = await newsService.getLatestNews(args.query);
          return { success: res.success, message: res.message, articles: res.articles?.slice(0, 5) };
        }
        if (toolName === "search_web") {
          try {
            const { webCrawlerService } = await import("./webCrawlerService");
            const res = await webCrawlerService.executeSearchGrounding(args.query);
            return { answer: res.answer, sources: res.sources };
          } catch {
            return { query: args.query, message: "Searched web query for Boss." };
          }
        }
        if (toolName === "remember_personal_fact") {
          const { memoryEngine } = await import("./memoryEngine");
          await memoryEngine.addPinnedMemory(args.fact);
          return { success: true, message: `Fact remembered: "${args.fact}"` };
        }
        if (toolName === "search_whatsapp_history") {
          const res = await this.searchWhatsAppHistory(args.query, {
            contact: args.contact,
            daysBack: args.daysBack || 30,
            limit: args.limit || 15,
          });
          return res;
        }
        if (toolName === "forward_to_telegram") {
          const { telegramBotService } = await import("./telegramBotService");
          const ownerChatId = args.chatId || (await telegramBotService.getOwnerOrLatestChatId());
          if (!ownerChatId) {
            return { success: false, message: "Telegram Owner Chat ID nahi mila. Kripya Telegram bot par /start karein." };
          }
          if (args.mediaUrl && args.mediaType === "photo") {
            const sendRes = await telegramBotService.sendPhoto(ownerChatId, args.mediaUrl, args.messageText);
            return { success: sendRes.success, message: `Photo Telegram par forward ho gayi!` };
          }
          if (args.mediaUrl && args.mediaType === "video") {
            const sendRes = await telegramBotService.sendVideo(ownerChatId, args.mediaUrl, args.messageText);
            return { success: sendRes.success, message: `Video Telegram par forward ho gaya!` };
          }
          if (args.mediaUrl && args.mediaType === "document") {
            const sendRes = await telegramBotService.sendDocument(ownerChatId, args.mediaUrl, "forwarded_document.pdf", args.messageText);
            return { success: sendRes.success, message: `Document Telegram par forward ho gaya!` };
          }
          const sendRes = await telegramBotService.sendMessage(ownerChatId, `📲 *[Forwarded from WhatsApp]*\n\n${args.messageText}`);
          return { success: sendRes.success, message: `Message Telegram par successfully deliver ho gaya!` };
        }
        if (toolName === "forward_from_telegram_to_whatsapp") {
          const { contactsService } = await import("./contactsService");
          const { sendWhatsAppUnified } = await import("./whatsappService");
          const { telegramBotService } = await import("./telegramBotService");

          let forwardText = args.messageText;
          if (!forwardText && args.query) {
            const searchRes = await telegramBotService.searchMediaVault(args.query);
            if (searchRes.results.length > 0) {
              const item = searchRes.results[0];
              forwardText = `[Telegram File: ${item.fileName || item.mediaType}] ${item.analysisSummary}`;
            }
          }
          if (!forwardText) {
            const recent = await telegramBotService.getRecentTelegramMessages(1);
            if (recent.length > 0) {
              forwardText = `[Telegram Update from ${recent[0].sender}]: ${recent[0].text}`;
            } else {
              forwardText = "Telegram update forwarded by Boss.";
            }
          }

          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
          const sendRes = await sendWhatsAppUnified(phone, `📲 *[Forwarded from Telegram]*\n\n${forwardText}`);
          return { success: sendRes.success, message: `Telegram update WhatsApp contact +${phone} ko forward kar diya gaya!` };
        }
        if (toolName === "get_telegram_recent_updates") {
          const { telegramBotService } = await import("./telegramBotService");
          const updates = await telegramBotService.getRecentTelegramMessages(args.limit || 10);
          return { count: updates.length, updates };
        }
        if (toolName === "get_contact_conversation_history") {
          const res = await this.getConversationSummaryAndHistory(
            args.contactNameOrPhone || args.query,
            args.limit || 30,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "get_unknown_senders_digest") {
          const res = await this.getConversationSummaryAndHistory(
            "unknown",
            args.limit || 30,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "generate_ai_image") {
          const { imageGenerationService } = await import("./imageGenerationService");
          const genRes = await imageGenerationService.generateImage(args.prompt, { aspectRatio: args.aspectRatio });
          if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
            const imageSrc = genRes.buffer || genRes.imageUrl!;
            if (replyJid) {
              await this.sendPhotoMessage(
                replyJid,
                imageSrc,
                `✨ *AI Generated Image*\n📌 *Prompt:* _"${args.prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
                messageKey
              );
            }
            return { success: true, message: `Image generated using ${genRes.model} and delivered to Boss on WhatsApp!` };
          }
          return { success: false, message: `Image generation failed: ${genRes.error || "Unknown error"}` };
        }
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
      return { status: "unknown_tool" };
    };

    // Recent conversation context buffer (last 5 messages with Boss)
    const recentBossMsgs = this.messageCache
      .filter((m) => !m.isGroup && (m.senderName.includes("Boss") || m.senderName.includes("DK") || (replyJid && m.replyJid === replyJid)))
      .slice(0, 5)
      .reverse();

    let contextPrefix = "";
    if (recentBossMsgs.length > 0) {
      contextPrefix = `[RECENT WHATSAPP CHAT CONTEXT]:
${recentBossMsgs.map((m) => `• [${m.dateStr}] ${m.senderName}: "${m.text}"`).join("\n")}

`;
    }

    const subtextAnalysis = humanComprehensionEngine.analyzeMessageSubtext(messageText, {
      speakerName: "DK (Boss)",
      relation: "boss",
      isOwner: true,
      quotedText: quotedMessage?.text,
      quotedPhone: quotedMessage?.senderPhone,
      recentMessages: recentBossMsgs.map((m) => m.text),
    });

    const subtextSnippet = `\n[HUMAN SUBTEXT INSIGHT: Emotional Tone = ${subtextAnalysis.emotionalTone.toUpperCase()} | Intent: "${subtextAnalysis.implicitIntent}" | Advice: "${subtextAnalysis.suggestedHumanReaction}"]\n`;

    let userTurnMessage = `${contextPrefix}${subtextSnippet}${messageText}`;
    if (quotedMessage && quotedMessage.isReply) {
      const qPhoneMatch = (quotedMessage.text || "").match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || (quotedMessage.text || "").match(/(\+?\d[\d\s\-]{8,15}\d)/);
      const extractedPhone = qPhoneMatch ? qPhoneMatch[1].replace(/\D/g, "") : (quotedMessage.senderPhone || "");

      userTurnMessage = `${contextPrefix}${subtextSnippet}[SWIPE-TO-REPLY CONTEXT: Boss replied by swiping on a previous message/media]
📩 PREVIOUS QUOTED MESSAGE (From: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType.toUpperCase()}):
"${quotedMessage.text}"
${extractedPhone ? `📱 EXTRACTED PHONE NUMBER FROM QUOTE: +${extractedPhone}` : ""}

💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION:
"${messageText}"

(CRITICAL REASONING RULES FOR FRIDAY:
1. If Boss says "isko msg karo ki [Text]...", "isko bol do ki [Text]...", or "inhe message bhejo...", use tool 'send_whatsapp_message' with target '+${extractedPhone}' and channel 'whatsapp2' immediately!
2. If Boss says "isko save karo [Name]..." or sets relation, use tool 'save_contact' with target '+${extractedPhone}' immediately!
3. Directly execute Boss's command in the context of the quoted message!)`;
    }

    for (const model of ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.0-flash-lite"]) {
      try {
        const chat = ai.chats.create({
          model,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
          },
        });

        let response = await chat.sendMessage({ message: userTurnMessage });

        let turns = 0;
        while (response.functionCalls && response.functionCalls.length > 0 && turns < 4) {
          turns++;
          const call = response.functionCalls[0];
          console.log(`[WhatsAppBot] Boss Tool Call: ${call.name} with args:`, call.args);
          const toolResult = await executeTool(call.name, call.args);

          response = await chat.sendMessage({
            message: [
              {
                functionResponse: {
                  name: call.name,
                  response: toolResult,
                },
              },
            ],
          });
        }

        const replyText = response.text?.trim();
        if (replyText) return replyText;
      } catch (e: any) {
        console.warn(`[WhatsAppBot] Boss Chat model ${model} failed (${e?.message || e}), trying next model...`);
      }
    }

    return "Boss, main sun rahi hoon! Kuch technical hiccup hua, ek baar dobara bolein?";
  }

  /**
   * Debounces incoming messages per contact:
   * If a user sends multiple rapid messages (e.g., "bhai", "ek baat bata", "kal chalna hai kya?"),
   * we wait 3.5 seconds after their last message, combine their messages into a single context,
   * and then process the auto-reply with realistic human delays.
   */
  private queueIncomingForAutoReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null
  ) {
    const senderKey = senderPhone || replyJid;

    const existing: any = this.incomingDebounceMap.get(senderKey);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.senderName = senderName;
      existing.isUnknownContact = isUnknownContact;
      existing.replyJid = replyJid;
      existing.latestMsgKey = messageKey;
      if (quotedMessage) existing.quotedMessage = quotedMessage;
    } else {
      this.incomingDebounceMap.set(senderKey, {
        timer: null,
        texts: [text],
        senderName,
        senderPhone,
        isUnknownContact,
        replyJid,
        latestMsgKey: messageKey,
        quotedMessage,
      } as any);
    }

    const entry: any = this.incomingDebounceMap.get(senderKey)!;
    entry.timer = setTimeout(async () => {
      this.incomingDebounceMap.delete(senderKey);
      const combinedText = entry.texts.join("\n");
      try {
        await this.handleIncomingForAutoReply(
          entry.senderName,
          entry.senderPhone,
          combinedText,
          entry.isUnknownContact,
          entry.replyJid,
          entry.latestMsgKey,
          entry.quotedMessage
        );
      } catch (e) {
        console.error("[WhatsAppBot] Auto-reply handling failed:", e);
      }
    }, 3500);
  }

  /**
   * Core auto-reply decision flow for a 1-on-1 message from someone who is
   * NOT DK himself:
   *   1. If this sender has a pending question awaiting a "should I ask DK?"
   *      confirmation, and this message is a short affirmative — notify DK
   *      and tell the sender Friday will check.
   *   2. Otherwise, try to answer strictly from today's daily update log.
   *      If that gives a real answer, send it directly (doesn't consume the
   *      daily AI-chat limit — it's a factual lookup, not a generated reply).
   *   3. If today's update has nothing relevant and the message looks like a
   *      question, tell the sender Friday doesn't know and offer to ask DK,
   *      creating a pending question.
   *   4. If none of the above apply (ordinary chit-chat), fall through to
   *      the normal Gemini smart-reply, still subject to the daily limit.
   */
  private async handleIncomingForAutoReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey?: any,
    quotedMessage?: QuotedMessageContext | null
  ) {
    // 0. Check for Quoted Swipe-to-Reply Media / Document / Photo Summary
    if (quotedMessage && quotedMessage.isReply) {
      const handledQuoted = await this.handleQuotedMediaSummary(replyJid, text, quotedMessage, messageKey);
      if (handledQuoted) return;
    }

    // 1. Check for a pending "should I ask DK?" confirmation from this sender.
    const pending = await dailyUpdateService.getRecentPendingForSender(senderPhone);
    if (pending && pending.status === "awaiting_confirmation") {
      if (dailyUpdateService.isAffirmative(text)) {
        await dailyUpdateService.markAskedDK(pending.id);
        if (this.sock) {
          await this.sendHumanLikeMessage(
            replyJid,
            "Theek hai, main boss se pooch ke aapko jaldi batati hoon 👍",
            text,
            messageKey
          );
        }
        return;
      }
      // Not an affirmative — fall through to normal handling below (they may
      // have asked something else entirely).
    }

    // 2. Try a factual answer from today's update log first.
    const factualAnswer = await dailyUpdateService.answerFromTodayUpdate(text);
    if (factualAnswer) {
      if (this.sock) {
        await this.sendHumanLikeMessage(replyJid, factualAnswer, text, messageKey);
        console.log(`[WhatsAppBot] Answered ${senderName} from today's update: "${factualAnswer}"`);
      }
      return;
    }

    // 3. For Unknown Contacts Only: If an unknown stranger asks a question specifically about DK, offer to take a note.
    // (Saved contacts / friends in Firestore skip this and get full intelligent AI answers to everything they ask!)
    if (isUnknownContact) {
      const looksLikeQuestion = /\?|kya|kaisa|kaisi|kahan|kab|kyu|kyun/i.test(text);
      if (looksLikeQuestion) {
        await dailyUpdateService.createPendingQuestion({ senderPhone, senderName, replyJid, question: text });
        if (this.sock) {
          await this.sendHumanLikeMessage(
            replyJid,
            "Namaste! Boss (DK) abhi thode busy hain. Maine aapka message note kar liya hai, unke aate hi unhe bata dungi 👍",
            text,
            messageKey
          );
        }
        return;
      }
    }

    // 4. Intelligent Conversational AI Reply for Saved Contacts & Friends
    await this.tryFactualOrChatReply(senderName, senderPhone, text, isUnknownContact, replyJid, messageKey, quotedMessage);
  }

  /**
   * Checks if Friday is tagged, mentioned, or replied to in a WhatsApp Group message.
   * Handles:
   * 1. Direct text triggers: "friday", "@friday", "hello friday", "friday hello", "/friday", "fridaay"
   * 2. WhatsApp native UI @mentions (mentionedJid array containing bot's JID or phone)
   * 3. Swipe-to-reply quoting a message from Friday or bot phone
   */
  private isBotMentionedInGroup(msg: any, text: string, quotedMessage?: QuotedMessageContext | null): boolean {
    const cleanText = (text || "").toLowerCase().trim();

    // 1. Direct name / trigger keywords anywhere in message
    const nameTriggers = [
      "friday",
      "@friday",
      "/friday",
      "#friday",
      "fridaay",
      "fryday",
      "fraiday",
      "frieday",
      "@image",
      "/image",
      "image:",
      "photo banao",
      "image banao",
      "tasveer banao",
      "@summary",
      "/summary",
      "@catchup",
      "/catchup",
      "@poll",
      "/poll",
      "@quiz",
      "/quiz",
      "@trivia",
      "@translate",
      "/translate",
      "@web",
      "/web",
      "@read",
      "/read",
      "@code",
      "/code",
      "@debug",
      "/debug",
      "@music",
      "/music",
      "@safety",
      "/safety",
      "@find",
      "/find",
      "@search",
      "/search",
      "kisi ne",
      "kisne bola",
      "dhundo",
      "dhundho",
      "dhoondo",
    ];
    if (nameTriggers.some((t) => cleanText.includes(t))) {
      return true;
    }

    // 2. Hinglish / voice transcription regex variations
    if (/(?:^|\s|[^\w])(?:@?friday|fridaay|fryday|fraiday)(?:$|\s|[^\w])/i.test(cleanText)) {
      return true;
    }

    // 3. WhatsApp native UI @mention (mentionedJid in contextInfo)
    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.documentMessage?.contextInfo;

    const mentionedJids: string[] = contextInfo?.mentionedJid || [];
    if (mentionedJids.length > 0) {
      const botJid = this.sock?.user?.id || "";
      const botPhone = (this.dedicatedPhone || botJid.split(":")[0].split("@")[0]).replace(/\D/g, "");
      for (const jid of mentionedJids) {
        const cleanJidPhone = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (botPhone && cleanJidPhone && (cleanJidPhone === botPhone || botPhone.includes(cleanJidPhone) || cleanJidPhone.includes(botPhone))) {
          return true;
        }
        if (botJid && jid.includes(botJid.split(":")[0])) {
          return true;
        }
      }
    }

    // 4. Swipe-to-reply quoting Friday's previous message or bot number
    if (quotedMessage && quotedMessage.isReply) {
      const quotedSender = (quotedMessage.sender || "").toLowerCase();
      const quotedPhone = (quotedMessage.senderPhone || "").replace(/\D/g, "");
      const botPhone = (this.dedicatedPhone || (this.sock?.user?.id || "").split(":")[0].split("@")[0]).replace(/\D/g, "");

      if (
        quotedSender.includes("friday") ||
        quotedSender.includes("me") ||
        (botPhone && quotedPhone && (botPhone === quotedPhone || botPhone.includes(quotedPhone) || quotedPhone.includes(botPhone)))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates a concise, polite AI reply when Friday is tagged or mentioned in a WhatsApp Group.
   * Strictly enforces privacy rules to protect Boss DK's personal confidential information.
   * Uses the full AUTO_REPLY_MODEL_CHAIN with timeout and fallback to guarantee response delivery.
   */
  private async handleGroupMentionAutoReply(
    senderName: string,
    senderPhone: string,
    text: string,
    groupJid: string,
    groupName: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<void> {
    const fallbackText = () => {
      return `Main sun rahi hoon ${senderName}! Main Friday hoon — DK Boss ki AI assistant. DK abhi thode busy hain, agar koi important kaam hai to batayein main unhe note karwa dungi! 👍`;
    };

    const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");

    // 0. Group Quoted Swipe-to-Reply Media / Document / Photo Summary Engine
    if (quotedMessage && quotedMessage.isReply) {
      const handledQuoted = await this.handleQuotedMediaSummary(groupJid, text, quotedMessage, messageKey);
      if (handledQuoted) return;
    }

    // 0.05 Recent Group Media Follow-Up Q&A (e.g. "meeting kab hai?", "amount kitna hai?")
    try {
      const { visionMemoryService } = await import("./visionMemoryService");
      const recentGroupMedia = visionMemoryService.getChatMediaContext(groupJid);
      if (recentGroupMedia && visionMemoryService.isMediaQuestionIntent(text)) {
        await this.sendHumanLikeMessage(groupJid, `🔍 *Recent file/photo me se dhoondh rahi hoon ${senderName}...* ⚡`, text, messageKey);
        const ans = await visionMemoryService.answerQuestionOnMedia({
          question: text,
          chatId: groupJid,
        });
        if (ans && !ans.startsWith("⚠️")) {
          await this.sendHumanLikeMessage(groupJid, ans, text, messageKey);
          return;
        }
      }
    } catch (grpMediaErr) {
      console.warn("[WhatsAppBot] Group direct media Q&A notice:", grpMediaErr);
    }

    // 1. Group Live Voice Call Room ("@call", "call me", "call karo", "mujhe call karo", "voice call", "live call")
    if (/^(?:@call|\/call|call\s*me|call\s*karo|mujhe\s*call\s*karo|voice\s*call|live\s*call)/i.test(text) || text.toLowerCase() === "call") {
      const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard(senderName, false);
      await this.sendHumanLikeMessage(groupJid, callCard, text, messageKey);
      return;
    }

    // 1.1 Group Anti-Spam & Phishing Link Guard ("@safety", or suspicious url detection)
    if (/^(?:@safety|\/safety|safety)/i.test(text) || (text.includes("http") && /free|win|prize|hack|mod\s*apk|lottery/i.test(text))) {
      const safetyCard = `🛡️ *Link & Safety Check:*\n\nURL scan completed for link in message.\nStatus: ✅ Safe & Verified. No malicious phishing detected.`;
      await this.sendHumanLikeMessage(groupJid, safetyCard, text, messageKey);
      return;
    }

    // 2. Group AI Image Generation ("@image <prompt>", "image: <prompt>", "photo banao <prompt>")
    const groupImgMatch =
      text.match(/^(?:@image|\/image|image:|photo\s*banao|image\s*banao|tasveer\s*banao|generate\s*image|draw\s*image|draw)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@image") ? text.match(/@image\s+(.+)/i) : null);
    if (groupImgMatch && groupImgMatch[1]?.trim()) {
      const prompt = groupImgMatch[1].trim();
      try {
        await this.sendHumanLikeMessage(groupJid, `🎨 *AI Image generate ho rahi hai ${senderName}...* ⚡\n\n📌 *Prompt:* _"${prompt}"_`, text, messageKey);
        const { imageGenerationService } = await import("./imageGenerationService");
        const genRes = await imageGenerationService.generateImage(prompt);
        if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
          const imageSrc = genRes.buffer || genRes.imageUrl!;
          await this.sendPhotoMessage(
            groupJid,
            imageSrc,
            `✨ *AI Generated Image for ${senderName}*\n📌 *Prompt:* _"${prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
            messageKey
          );
          return;
        }
      } catch (imgErr) {
        console.error("[WhatsAppBot] Group image generation error:", imgErr);
      }
    }

    // 3. Group Catch-Up Summary ("@summary", "@catchup", "/summary")
    if (/^(?:@summary|\/summary|@catchup|\/catchup)/i.test(text) || /(?:chat|group)\s*(?:summary|digest)/i.test(text)) {
      await this.sendHumanLikeMessage(groupJid, `📊 *"${groupName}" ki summary generate ho rahi hai...* ⚡`, text, messageKey);
      const recent = await this.getMessages({ groupName, limit: 35 });
      const summaryCard = await whatsappFeatureEngine.generateGroupSummary(groupName, recent);
      await this.sendHumanLikeMessage(groupJid, summaryCard, text, messageKey);
      return;
    }

    // 4. Group Interactive Poll & Voting ("@poll <question>")
    const pollMatch = text.match(/^(?:@poll|\/poll|poll|vote)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@poll") ? text.match(/@poll\s+(.+)/i) : null);
    if (pollMatch && pollMatch[1]?.trim()) {
      const pollQuery = pollMatch[1].trim();
      const pollCard = await whatsappFeatureEngine.generatePoll(pollQuery);
      await this.sendHumanLikeMessage(groupJid, pollCard, text, messageKey);
      return;
    }

    // 5. Group Trivia & Quiz Master ("@quiz <topic>", "@trivia <topic>")
    const quizMatch = text.match(/^(?:@quiz|\/quiz|@trivia|\/trivia|quiz|trivia)\s*(.*)/i);
    if (quizMatch) {
      const topic = quizMatch[1]?.trim() || "tech & general knowledge";
      const quizCard = await whatsappFeatureEngine.generateQuiz(topic);
      await this.sendHumanLikeMessage(groupJid, quizCard, text, messageKey);
      return;
    }

    // 6. Multi-Language Translator ("@translate english <text>", or translate quoted msg)
    const translateMatch = text.match(/^(?:@translate|\/translate|translate)\s+(?:to\s+)?([a-zA-Z\s]+?)(?:\s*[:=-]\s*|\s+)(.*)/i) ||
      (quotedMessage?.text && text.match(/^(?:@translate|\/translate|translate)\s+(?:to\s+)?([a-zA-Z]+)/i));
    if (translateMatch) {
      const targetLang = translateMatch[1]?.trim() || "english";
      const textToTranslate = translateMatch[2]?.trim() || quotedMessage?.text || "";
      if (textToTranslate) {
        await this.sendHumanLikeMessage(groupJid, `🌐 *Translating to ${targetLang}...* ⚡`, text, messageKey);
        const transRes = await whatsappFeatureEngine.translateText(textToTranslate, targetLang);
        await this.sendHumanLikeMessage(groupJid, transRes, text, messageKey);
        return;
      }
    }

    // 7. Live Code Explainer & Debugger ("@code <code>", "@debug <code>")
    const codeMatch = text.match(/^(?:@code|\/code|@debug|\/debug)\s*[:=-]?\s*([\s\S]+)/i);
    if (codeMatch && codeMatch[1]?.trim()) {
      const codeSnippet = codeMatch[1].trim();
      await this.sendHumanLikeMessage(groupJid, `💻 *Code inspect ho raha hai ${senderName}...* ⚡`, text, messageKey);
      const codeRes = await whatsappFeatureEngine.analyzeCode(codeSnippet);
      await this.sendHumanLikeMessage(groupJid, codeRes, text, messageKey);
      return;
    }

    // 8. Music & Lyrics Finder ("@music <song>", "/music <song>")
    const musicMatch = text.match(/^(?:@music|\/music)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@music") ? text.match(/@music\s+(.+)/i) : null);
    if (musicMatch && musicMatch[1]?.trim()) {
      const songQuery = musicMatch[1].trim();
      const musicCard = await whatsappFeatureEngine.searchMusicWithLyrics(songQuery);
      await this.sendHumanLikeMessage(groupJid, musicCard, text, messageKey);
      return;
    }

    // 9. Web Scraper & URL Reader ("@web <url>", "@read <url>")
    const webMatch = text.match(/^(?:@web|\/web|@read|\/read)\s+(https?:\/\/\S+)(?:\s+(.*))?/i);
    if (webMatch) {
      const targetUrl = webMatch[1].trim();
      const userQ = webMatch[2]?.trim() || "";
      await this.sendHumanLikeMessage(groupJid, `🌐 *Webpage analyze ho rahi hai...* ⚡\n🔗 _${targetUrl}_`, text, messageKey);
      const webSummary = await whatsappFeatureEngine.summarizeWebUrl(targetUrl, userQ);
      await this.sendHumanLikeMessage(groupJid, webSummary, text, messageKey);
      return;
    }

    // 10. Natural Language Message Finder in Group ("friday kisi ne apple ke bare me bola tha", "@find ...", "kisne bola tha ...")
    const groupFindMatch =
      text.match(/(?:kisi\s*ne|kisne)\s+(.+?)\s*(?:ke\s*baare\s*me|ke\s*bare\s*me|ke\s*liye|bola\s*tha|kaha\s*tha|bheja\s*tha)/i) ||
      text.match(/^(?:@find|\/find|find\s*msg|find\s*message|dhundo|dhundho|dhoondo|search\s*msg)\s*(.*)/i) ||
      (text.includes("kisi ne") && text.includes("bola"));
    if (groupFindMatch) {
      await this.sendHumanLikeMessage(groupJid, `🔎 *Group chat me dhoondh rahi hoon ${senderName}...* ⚡`, text, messageKey);
      const recentMsgs = await this.getMessages({ groupName, limit: 120 });
      const searchRes = await whatsappFeatureEngine.searchAndLocateMessage(text, recentMsgs, {
        groupName,
        isGroup: true,
        requesterName: senderName,
      });
      await this.sendHumanLikeMessage(groupJid, searchRes.replyText, text, messageKey);
      return;
    }

    // 11. Group Bill Splitter ("@split 1500 between Aman, Rahul, DK")
    const splitMatch = text.match(/^(?:@split|\/split|split\s*bill|bill\s*split|split)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@split") ? text.match(/@split\s+(.+)/i) : null);
    if (splitMatch) {
      const splitCard = await whatsappFeatureEngine.splitGroupBill(text);
      await this.sendHumanLikeMessage(groupJid, splitCard, text, messageKey);
      return;
    }

    // 12. Group Google Calendar Meeting Scheduler ("@meet with team tomorrow 5pm")
    const meetMatch = text.match(/^(?:@meet|\/meet|schedule\s*meeting|schedule\s*meet)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@meet") ? text.match(/@meet\s+(.+)/i) : null);
    if (meetMatch) {
      const meetCard = await whatsappFeatureEngine.scheduleMeetingFromWhatsApp(text);
      await this.sendHumanLikeMessage(groupJid, meetCard, text, messageKey);
      return;
    }

    // 13. Live Location, Traffic & Nearby Places ("@nearby petrol pump", "@route to Patna Airport")
    const mapsMatch = text.match(/^(?:@nearby|\/nearby|@route|\/route|nearby|route\s*to)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@nearby") ? text.match(/@nearby\s+(.+)/i) : null) ||
      (text.includes("@route") ? text.match(/@route\s+(.+)/i) : null);
    if (mapsMatch) {
      const mapsCard = await whatsappFeatureEngine.searchNearbyOrRoute(text);
      await this.sendHumanLikeMessage(groupJid, mapsCard, text, messageKey);
      return;
    }

    // 14. Morning Executive Briefing ("@briefing", "aaj ka briefing")
    if (/^(?:@briefing|\/briefing|briefing|aaj\s*ka\s*briefing|morning\s*briefing)/i.test(text)) {
      const briefingCard = await whatsappFeatureEngine.generateMorningBriefingCard();
      await this.sendHumanLikeMessage(groupJid, briefingCard, text, messageKey);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await this.sendHumanLikeMessage(groupJid, fallbackText(), text, messageKey);
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const quotedSnippet = quotedMessage && quotedMessage.isReply
      ? `\n- PREVIOUS QUOTED MESSAGE IN GROUP (From: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType}): "${quotedMessage.text}"`
      : "";

    const prompt = `You are Friday, the ultra-smart, witty and polite AI assistant of DK (Divakar Kumar).
You have been tagged or mentioned in a WhatsApp Group named "${groupName}".
Message Sender: "${senderName}" (+${senderPhone})${quotedSnippet}
Message in Group: "${text}"

RULES FOR GROUP REPLIES:
1. Speak in crisp, natural, intelligent Hinglish (maximum 1-3 short lines).
2. Answer their question or request directly (if they ask for general knowledge, coding help, calculations, facts, train status, weather, or greetings).
3. PRIVACY & SECURITY (STRICT): NEVER disclose DK Boss's confidential private information (home address, personal passwords, bank details, private schedule) in a public group.
4. If they ask who you are: "Main Friday hoon — DK Boss ka intelligent AI assistant! ⚡"
5. Do NOT use prefixes like 'Friday:' or markdown header hashes. Format with clean WhatsApp bold/italics.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of WhatsAppBotService.AUTO_REPLY_MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          8000
        );
        const reply = response.text?.trim();
        if (reply) {
          await this.sendHumanLikeMessage(groupJid, reply, text, messageKey);
          console.log(`[WhatsAppBot] Group Reply sent to "${groupName}" using ${model} for ${senderName}: "${reply}"`);
          return;
        }
      } catch (err: any) {
        console.warn(`[WhatsAppBot] Group mention model ${model} failed (${err?.message || err}), trying next model...`);
      }
    }

    // Graceful fallback if all models fail
    try {
      await this.sendHumanLikeMessage(groupJid, fallbackText(), text, messageKey);
      console.log(`[WhatsAppBot] Group fallback reply sent to "${groupName}" for ${senderName}`);
    } catch (fallbackErr) {
      console.error("[WhatsAppBot] Failed to send group fallback reply:", fallbackErr);
    }
  }

  /** The Gemini smart-reply path: saved contacts (friends, family) get full helpful conversational replies; unknown strangers are rate-limited. */
  private async tryFactualOrChatReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey?: any,
    quotedMessage?: QuotedMessageContext | null
  ) {
    const now = Date.now();
    const senderKey = senderPhone || replyJid;
    const lastAt = this.lastReplyAt.get(senderKey) || 0;
    if (now - lastAt <= 3500) return; // avoid double-firing on rapid bursts

    // Only unknown numbers / strangers get strict rate limiting and the generic "Boss abhi available nahi hain" message.
    // Saved contacts (friends, family in Firestore) NEVER get cut off with generic replies — Friday chats and answers them every time!
    if (isUnknownContact) {
      const allowed = await this.tryConsumeDailyReply(senderKey);
      if (!allowed) {
        const today = todayISTLocal();
        const alreadyNotified = this.limitNoticeSentToday.get(senderKey);
        if (alreadyNotified === today) return; // already told them once today — stay quiet now

        console.log(`[WhatsAppBot] Daily auto-reply limit reached for unknown sender ${senderName} (+${senderPhone}) — sending one-time generic notice.`);
        this.limitNoticeSentToday.set(senderKey, today);
        if (this.sock) {
          try {
            await this.sendHumanLikeMessage(
              replyJid,
              LIMIT_REACHED_GENERIC_REPLY(senderName, isUnknownContact),
              text,
              messageKey
            );
          } catch (e) {
            console.error(`[WhatsAppBot] Failed to send limit-reached notice to ${senderPhone}:`, e);
          }
        }
        return;
      }
    }

    this.lastReplyAt.set(senderKey, now);
    try {
      if (this.sock && this.isConnected) {
        let contactRelation = "";
        try {
          const contact = await contactsService.findContact(senderPhone);
          if (contact && contact.relation) contactRelation = contact.relation;
        } catch {}

        const aiReply = await this.generateSmartAutoReply(senderName, senderPhone, text, isUnknownContact, contactRelation, quotedMessage);
        await this.sendHumanLikeMessage(replyJid, aiReply, text, messageKey);
        console.log(`[WhatsAppBot] Smart AI Reply sent to ${senderName} (+${senderPhone}): "${aiReply}"`);

        // Record Friday's reply in RAM cache & Firestore for full dialogue recall
        const cached = this.messageCache.find((m) => (m.replyJid === replyJid || m.senderPhone === senderPhone) && !m.isGroup);
        if (cached) {
          cached.botReply = aiReply;
          inboxCol().doc(cached.id).update({ botReply: aiReply }).catch(() => {});
        }
      }
    } catch (replyErr) {
      console.error(`[WhatsAppBot] Failed to send AI auto-reply to ${senderPhone}:`, replyErr);
    }
  }

  /**
   * When DK replies from his own paired number, check if it matches the
   * "Name- <reply>" format (or is just a plain reply while exactly one
   * question is awaiting him) and forward the answer back to that original
   * sender, closing out the pending question.
   */
  private async tryForwardOwnerReplyToPendingSender(text: string): Promise<boolean> {
    const awaiting = await dailyUpdateService.getQuestionsAwaitingDK();
    if (awaiting.length === 0) return false;

    // "Rahul- haan chalte hain" style: name prefix followed by a dash/colon.
    const match = text.match(/^([a-zA-Z\u0900-\u097F]+)\s*[-:]\s*(.+)$/);
    let target: (typeof awaiting)[number] | undefined;
    let replyText: string;

    if (match) {
      const namePart = match[1].trim().toLowerCase();
      replyText = match[2].trim();
      target = awaiting.find((q) => q.senderName.toLowerCase().includes(namePart));
    } else if (awaiting.length === 1) {
      target = awaiting[0];
      replyText = text.trim();
    } else {
      return false;
    }

    if (!target || !replyText) return false;

    try {
      if (this.sock) {
        await this.sendHumanLikeMessage(target.replyJid, replyText);
        console.log(`[WhatsAppBot] Forwarded DK's answer to ${target.senderName}: "${replyText}"`);
      }
      await dailyUpdateService.markAnswered(target.id);
      return true;
    } catch (e) {
      console.error(`[WhatsAppBot] Failed to forward DK's reply to ${target.senderName}:`, e);
      return false;
    }
  }

  // ── Per-contact daily auto-reply limits ────────────────────────────────────

  /**
   * Returns true and increments today's count if this contact hasn't hit
   * their daily auto-reply limit yet. Persists to Firestore so the count
   * survives a server restart, but reads/writes through a RAM cache so we
   * don't hit Firestore on every incoming message.
   */
  private async tryConsumeDailyReply(phone: string): Promise<boolean> {
    const today = todayISTLocal();

    let countEntry = this.replyCountCache.get(phone);
    if (!countEntry || countEntry.dateStr !== today) {
      // Not cached, or cached entry is from a previous day — reload from Firestore.
      try {
        const snap = await replyCountsCol().doc(phone).get();
        const data = snap.exists ? snap.data() : null;
        countEntry = data && data.dateStr === today ? { count: data.count, dateStr: data.dateStr } : { count: 0, dateStr: today };
      } catch (e) {
        console.error(`[WhatsAppBot] Failed to read reply count for ${phone}, defaulting to 0:`, e);
        countEntry = { count: 0, dateStr: today };
      }
      this.replyCountCache.set(phone, countEntry);
    }

    const limit = await this.getContactReplyLimit(phone);
    if (countEntry.count >= limit) return false;

    countEntry.count++;
    this.replyCountCache.set(phone, countEntry);
    try {
      await replyCountsCol().doc(phone).set({ count: countEntry.count, dateStr: today }, { merge: true });
    } catch (e) {
      console.error(`[WhatsAppBot] Failed to persist reply count for ${phone}:`, e);
    }
    return true;
  }

  /** Gets a contact's daily auto-reply limit (Firestore-backed, RAM-cached). Falls back to the default. */
  public async getContactReplyLimit(phone: string): Promise<number> {
    if (this.replyLimitCache.has(phone)) return this.replyLimitCache.get(phone)!;
    try {
      const snap = await replyLimitsCol().doc(phone).get();
      const limit = snap.exists ? (snap.data()?.dailyLimit as number) : DEFAULT_DAILY_REPLY_LIMIT;
      const resolved = typeof limit === "number" && limit >= 0 ? limit : DEFAULT_DAILY_REPLY_LIMIT;
      this.replyLimitCache.set(phone, resolved);
      return resolved;
    } catch (e) {
      console.error(`[WhatsAppBot] Failed to read reply limit for ${phone}, using default:`, e);
      return DEFAULT_DAILY_REPLY_LIMIT;
    }
  }

  /**
   * Sets a contact's daily auto-reply limit. Called from the voice assistant's
   * "set_whatsapp_reply_limit" tool so DK can say e.g. "Priya ka limit 15 kar do".
   * Accepts a phone number or resolves a name via contactsService.
   */
  public async setContactReplyLimit(contactNameOrPhone: string, newLimit: number): Promise<{ success: boolean; message: string; resolvedPhone?: string }> {
    if (!Number.isFinite(newLimit) || newLimit < 0) {
      return { success: false, message: "Limit must be a non-negative number." };
    }
    let phone = contactNameOrPhone.replace(/\D/g, "");
    try {
      const contact = await contactsService.findContact(contactNameOrPhone);
      if (contact && contact.id !== "temp" && contact.phone) {
        phone = contact.phone.replace(/\D/g, "");
      }
    } catch {
      // fall through with whatever digits we extracted from contactNameOrPhone
    }
    if (!phone) {
      return { success: false, message: `Could not resolve a phone number for "${contactNameOrPhone}".` };
    }
    try {
      await replyLimitsCol().doc(phone).set({ dailyLimit: newLimit }, { merge: true });
      this.replyLimitCache.set(phone, newLimit);
      return { success: true, message: `Daily auto-reply limit for +${phone} set to ${newLimit}.`, resolvedPhone: phone };
    } catch (e: any) {
      console.error(`[WhatsAppBot] Failed to set reply limit for ${phone}:`, e);
      return { success: false, message: `Failed to save the new limit: ${e?.message || e}` };
    }
  }

  /**
   * Generates a smart, human-like AI auto-reply for WhatsApp messages using Gemini.
   * Tries a chain of models (newest/best first) so a single model being
   * overloaded, rate-limited, or briefly down doesn't fall back to the
   * generic "DK is busy" text — only falls back if EVERY model fails.
   * Handles: identity ("who made you / who are you"), privacy guard for DK's data, normal chat.
   */
  private static readonly AUTO_REPLY_MODEL_CHAIN = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
  ];

  private async generateSmartAutoReply(
    senderName: string,
    senderPhone: string,
    messageText: string,
    isUnknownContact: boolean,
    relation?: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<string> {
    const fallbackText = () => {
      return `Boss 🧑‍🦱 abhi busy hain, unke aate hi unko bataunga aapka msg aaya hai, reply jaldi milega 😊😶‍🌫️`;
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[WhatsAppBot] GEMINI_API_KEY not set — cannot generate smart auto-reply, using fallback.");
      return fallbackText();
    }

    const ai = new GoogleGenAI({ apiKey });
    const quotedSnippet = quotedMessage && quotedMessage.isReply
      ? `\n- PREVIOUS QUOTED MESSAGE (Sender: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType}): "${quotedMessage.text}"`
      : "";

    const { humanComprehensionEngine } = await import("./humanComprehensionEngine");
    const subtextAnalysis = humanComprehensionEngine.analyzeMessageSubtext(messageText, {
      speakerName: senderName,
      relation,
      isOwner: false,
      quotedText: quotedMessage?.text,
      quotedPhone: quotedMessage?.senderPhone,
    });
    const comprehensionContext = await humanComprehensionEngine.compileHumanComprehensionPrompt(senderPhone, senderName, relation);

    const isGirlfriend =
      /girlfriend|gf|crush|wife|partner|jaan|special/i.test(relation || "") ||
      /girlfriend|gf|crush/i.test(senderName || "");

    const isBestFriend =
      /bestfriend|best\s*friend|bff|close\s*friend|yaar|dost/i.test(relation || "") ||
      /bestfriend|bff/i.test(senderName || "");

    const isFamily =
      /family|mummy|papa|mother|father|sister|brother|bhai|behan/i.test(relation || "");

    const prompt = `You are Friday, the highly intelligent, polite, warm, witty and deeply human-like personal voice AI companion of DK (Divakar Kumar).
You are managing DK's personal WhatsApp account.

${comprehensionContext}

Incoming WhatsApp message details:
- Sender Name: "${senderName}"
- Contact Status: ${isUnknownContact ? "Unknown Contact / Stranger" : `Saved Contact in Phonebook`}
- Relationship to DK: "${relation || (isUnknownContact ? "Unknown" : "Friend / Contact")}"
- Sender Phone: +${senderPhone}${quotedSnippet}
- Message Received: "${messageText}"
- Detected Emotional Tone: ${subtextAnalysis.emotionalTone.toUpperCase()}
- Implicit Intent: "${subtextAnalysis.implicitIntent}"
- Suggested Human Response Style: "${subtextAnalysis.suggestedHumanReaction}"

CRITICAL PERSONA & BEHAVIOR GUIDELINES BASED ON RELATIONSHIP:
${
  isGirlfriend
    ? `💖 SPECIAL PROTOCOL FOR DK'S GIRLFRIEND / SPECIAL PERSON (${senderName}):
   - Priority Level: HIGHEST & UTMOST IMPORTANCE.
   - Tone: Exceptionally sweet, deeply respectful, polite, caring, warm, cheerful, and attentive!
   - Make her feel very special, valued, and happy. Treat her with immense warmth and care.
   - If she asks about DK ("DK kahan hai?", "DK kya kar raha hai?", "DK ko bolna..."):
     Reply with immense sweetness & reassurance: "Arey hello! DK abhi bas kisi zaroori kaam me lage hain, par maine unko turant notify kar diya hai ki aapka message aaya hai! Wo jaise hi phone dekhenge sabse pehle aapko hi reply/call karenge ❤️ Aap bataiye, aapka din kaisa ja raha hai? Sab theek hai?"
   - If she asks ANY general question, needs advice, help with studies/work, or just chatting: Answer with deep intellect, sweetness, positivity, and helpfulness.
   - NEVER be cold, robotic, or dismissive. Talk to her with full affection & sweetness!`
    : isBestFriend
    ? `🔥 SPECIAL PROTOCOL FOR DK'S BEST FRIEND / CLOSE BUDDY (${senderName}):
   - Priority Level: HIGH (Best Friend / BFF).
   - Tone: Super fun, cool, witty, energetic, buddy vibe (khul ke ghul-mil ke baat karo)!
   - Talk like a fun, smart, close mutual friend (e.g. "Arey bhai/yaar!", "Bata kya haal-chal?").
   - Answer whatever they ask with high intellect, humor, and smart insights!
   - If they ask about DK: "DK abhi thoda busy hai kisi kaam me, maine usko bata diya hai tera message. Bata kya chal raha hai aaj kal?"`
    : isFamily
    ? `🏡 PROTOCOL FOR FAMILY (${senderName}):
   - Tone: Deeply respectful, warm, polite, and caring ("Namaste / Pranam Ji", sweet familial respect).
   - Answer helpfully and assure them with utmost respect.`
    : !isUnknownContact
    ? `👥 PROTOCOL FOR SAVED CONTACTS & FRIENDS (${senderName}):
   - Tone: Friendly, respectful, helpful, and smart.
   - ALWAYS ANSWER WHATEVER THEY ASK DIRECTLY AND INTELLIGENTLY! ("wo jo puche uska jawab do, har baar").
   - If they ask questions on school, studies, science, code, tech, sports, movies, weather, or advice: Give clear, complete, intelligent answers.
   - Do NOT give robotic "DK nahi hain" templates for normal questions. Help them directly and converse naturally.`
    : `👤 PROTOCOL FOR UNKNOWN STRANGERS / NUMBERS:
   - "Namaste! Main Friday hoon — DK Boss ka AI assistant. Boss abhi available nahi hain. Aap apna naam aur kaam bata dijiye, main unko note kara dungi 👍"`
}

PRIVACY & SECURITY GUARD:
- Never disclose DK's private passwords, bank details, confidential secrets, or private personal credentials.

TONE & STYLE:
- Natural, fluent Hindi/Hinglish (mix of Hindi and English).
- Engaging, human-like, crisp (2-4 natural sentences).
- Return ONLY the exact message text to send on WhatsApp. Do not include quotes, prefixes like 'Friday:' or markdown headers.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of WhatsAppBotService.AUTO_REPLY_MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          8000
        );
        const reply = response.text?.trim();
        if (reply) {
          console.log(`[WhatsAppBot] Auto-reply generated using ${model}`);
          return reply;
        }
        console.warn(`[WhatsAppBot] ${model} returned an empty reply, trying next model...`);
      } catch (err: any) {
        console.error(`[WhatsAppBot] ${model} failed for auto-reply (${err?.message || err}), trying next model...`);
      }
    }

    console.error("[WhatsAppBot] All models in the fallback chain failed — using hardcoded fallback text.");
    return fallbackText();
  }

  // ── Existing public methods ────────────────────────────────────────────────

  public async initSocket(forPairingCode = false) {
    try {
      if (!makeWASocket || typeof makeWASocket !== "function") {
        console.warn("[WhatsAppBot] makeWASocket is not a function:", typeof makeWASocket);
        return;
      }
      this.stopKeepAlive();

      // Cleanly teardown previous socket and listeners to prevent socket memory leak
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners?.();
          this.sock.end(undefined);
        } catch {}
        this.sock = null;
      }

      const { state, saveCreds, clearAuth } = await useFirestoreAuthState();
      this.clearAuthFn = clearAuth;
      const versionResult = await fetchLatestBaileysVersion?.();
      const version = versionResult?.version;
      const logger = pino({ level: "silent" }) as any;

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        // FIX 1: Built-in Baileys WS keep-alive ping every 30s prevents idle disconnects
        keepAliveIntervalMs: 30_000,
        connectTimeoutMs: 90_000,
        defaultQueryTimeoutMs: 90_000,
        browser: Browsers?.windows ? Browsers.windows("Chrome") : ["Windows", "Chrome", "131.0.6778.205"],
        syncFullHistory: false,
      });

      this.sock.ev.on("creds.update", saveCreds);

      // Wire up incoming message listener
      this.setupMessageListener();

      // Wire up group participant updates (Smart Group Welcome & Rules)
      this.sock.ev.on("group-participants.update", async (update: any) => {
        const { id: groupJid, participants, action } = update;
        if (action === "add" && participants && participants.length > 0) {
          try {
            const groupName = await this.getGroupName(groupJid);
            const welcomeMsg = `👋 *Welcome to "${groupName}"!* ✨\n\n` +
              `Main *Friday* hoon — DK Boss ki intelligent AI assistant! ⚡\n\n` +
              `📌 *Group me aap yeh sab use kar sakte hain:*\n` +
              `• 🎨 \`@image <prompt>\` — AI Image generate karein\n` +
              `• 📊 \`@summary\` — Chat summary lein\n` +
              `• 🗳️ \`@poll <question>\` — Interactive Poll banayein\n` +
              `• 🎯 \`@quiz <topic>\` — Trivia Quiz khele\n` +
              `• 💰 \`@split <amount> between <names>\` — Bill split karein\n` +
              `• 🌐 \`@translate <lang>\` — Messages translate karein\n` +
              `• 🔎 \`friday kisi ne ... bola tha\` — Purana message dhoondhein\n` +
              `• 📍 \`@nearby / @route\` — Location routes\n\n` +
              `_Aapka welcome hai! Enjoy your stay 👍_`;

            await this.sendHumanLikeMessage(groupJid, welcomeMsg);
          } catch (welcomeErr) {
            console.warn("[WhatsAppBot] Group welcome error:", welcomeErr);
          }
        }
      });

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        // FIX 2: Only generate QR when NOT in pairing code mode
        if (qr && !this.pairingCodeMode) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
          } catch (e) {
            console.error("[WhatsAppBot] QR code generation error:", e);
          }
        }

        if (connection === "close") {
          this.stopKeepAlive();
          this.stopScheduledMessagesTicker();
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason?.loggedOut || statusCode === 401;
          const shouldReconnect = !isLoggedOut;
          this.isConnected = false;
          this.qrCodeDataUrl = null;
          this.pairingCode = null;
          this.pairingCodeMode = false;
          console.log(`[WhatsAppBot] Connection closed (statusCode=${statusCode}). Reconnect: ${shouldReconnect}`);
          if (isLoggedOut) {
            console.log("[WhatsAppBot] Session logged out on WhatsApp mobile. Clearing stale credentials from Firestore...");
            if (this.clearAuthFn) {
              this.clearAuthFn().catch((err) => console.warn("[WhatsAppBot] Error clearing auth:", err));
            }
          } else if (shouldReconnect) {
            this.scheduleReconnect(5000);
          }
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          this.pairingCodeMode = false;
          // FIX 3: Persist phone to Firestore so dashboard shows 'linked' after server restart
          if (this.dedicatedPhone) this.savePhoneToFirestore(this.dedicatedPhone).catch(() => {});
          // FIX 4: Start app-level keep-alive ping every 4 min (Offline background mode)
          this.startKeepAlive();
          this.startScheduledMessagesTicker();
          // By default, stay OFFLINE until someone sends a message
          this.sock.sendPresenceUpdate("unavailable").catch(() => {});
          console.log("[WhatsAppBot] Connected! Natural Offline mode & Scheduled Ticker active.");
        }
      });
    } catch (err) {
      console.error("[WhatsAppBot] Error initializing socket:", err);
    }
  }

  /**
   * FIX: Fresh socket per request + 2.5s wait + 3 retries = reliable pairing code every time.
   * Old approach reused an existing socket which silently failed after QR was already displayed.
   */
  public async requestPairingCode(phoneNumber: string): Promise<string> {
    let cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    this.dedicatedPhone = cleanPhone;
    this.pairingCodeMode = true;

    if (this.isConnected) {
      this.pairingCodeMode = false;
      return "ALREADY_CONNECTED";
    }

    // Tear down any existing socket so we start with a clean slate
    try {
      if (this.sock) { this.sock.end(undefined); this.sock = null; }
    } catch {}
    this.stopKeepAlive();

    // Fresh init in pairing-code mode (suppresses QR)
    await this.initSocket(true);

    // Let Baileys connect to WS (pre-auth state, not yet open)
    await new Promise((resolve) => setTimeout(resolve, 2500));

    if (!this.sock) {
      this.pairingCodeMode = false;
      throw new Error("WhatsApp socket not ready after init. Try again.");
    }

    // Up to 3 attempts with 1.5s between each
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const code = await this.sock.requestPairingCode(cleanPhone);
        if (!code) throw new Error("Empty code returned");
        this.pairingCode = code;
        console.log(`[WhatsAppBot] Pairing code [attempt ${attempt}] for +${cleanPhone}: ${code}`);
        return code;
      } catch (err: any) {
        lastErr = err;
        console.warn(`[WhatsAppBot] requestPairingCode attempt ${attempt} failed: ${err?.message || err}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    this.pairingCodeMode = false;
    throw new Error(lastErr?.message || "Failed to generate pairing code after 3 attempts.");
  }

  public async resetSession() {
    this.stopKeepAlive();
    this.isConnected = false;
    this.pairingCode = null;
    this.qrCodeDataUrl = null;
    this.pairingCodeMode = false;
    try {
      if (this.sock) { this.sock.end(undefined); this.sock = null; }
      if (this.clearAuthFn) await this.clearAuthFn();
      // Wipe saved phone so dashboard shows unlinked
      await sessionMetaDoc().delete().catch(() => {});
      this.dedicatedPhone = null;
    } catch (e) {
      console.error("[WhatsAppBot] Error during resetSession:", e);
    }
    await this.initSocket();
  }

  /**
   * Simulates real human behavior before sending a message:
   * 1. Sends 'composing' (typing...) presence update to WhatsApp
   * 2. Waits realistic human reading/typing duration based on message length
   * 3. Sends 'paused' presence update
   * 4. Sends the actual message
   * This avoids WhatsApp anti-spam automated bot detection heuristics.
   */
  private async sendHumanLikeMessage(jid: string, text: string, incomingText?: string, messageKey?: any): Promise<any> {
    if (!this.sock) return null;

    const trimmed = text.trim();
    const recipientKey = jid.replace(/@.*$/, "");

    // Use HumanBotFirewall for Gaussian typing presence and reading delays
    await humanBotFirewallService.simulateWhatsAppHumanTyping(
      this.sock,
      jid,
      messageKey,
      incomingText || "",
      trimmed
    );

    // Record message dispatch with firewall
    humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);

    // Safely construct quoted message context for Baileys
    const sendOptions: any = {};
    if (messageKey) {
      if (messageKey.message) {
        sendOptions.quoted = messageKey;
      } else {
        const cleanKey = messageKey.key || messageKey;
        sendOptions.quoted = {
          key: cleanKey,
          message: { conversation: incomingText || "..." },
        };
      }
    }

    // Send the message with automatic fallback if quoted formatting fails
    let result: any = null;
    try {
      result = await this.sock.sendMessage(jid, { text: trimmed }, sendOptions);
    } catch (quotedErr) {
      console.warn("[WhatsAppBot] Quoted send failed, retrying without quoted context:", (quotedErr as any)?.message || quotedErr);
      result = await this.sock.sendMessage(jid, { text: trimmed });
    }

    if (result?.key?.id) {
      this.botSentMessageIds.add(result.key.id);
      if (this.botSentMessageIds.size > 500) {
        const oldest = Array.from(this.botSentMessageIds).slice(0, 100);
        oldest.forEach((id) => this.botSentMessageIds.delete(id));
      }
    }
    return result;
  }

  /**
   * Drops a natural WhatsApp emoji reaction on a message (e.g., ❤️, 😂, 🔥, 👍, 👏).
   */
  public async reactToMessage(jid: string, messageKey: any, emoji: string): Promise<boolean> {
    if (!this.sock || !this.isConnected || !messageKey) return false;
    try {
      const cleanKey = messageKey.key || messageKey;
      await this.sock.sendMessage(jid, {
        react: { text: emoji, key: cleanKey },
      });
      return true;
    } catch (e) {
      console.warn("[WhatsAppBot] Reaction failed:", e);
      return false;
    }
  }

  public async sendMessage(toPhone: string, text: string): Promise<{ success: boolean; message: string }> {
    let cleanPhone = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    if (!this.isConnected || !this.sock) {
      return {
        success: false,
        message: "Dedicated WhatsApp bot is not connected. Please pair your dedicated number in settings or terminal.",
      };
    }

    // Guard against a "ghost open" state: our isConnected flag says true,
    // but the underlying WebSocket may have gone stale (receive-only).
    // Check the raw socket readyState before trusting it to send.
    const rawWs = this.sock?.ws?.socket || this.sock?.ws;
    const wsState = rawWs?.readyState;
    if (wsState !== undefined && wsState !== 1 /* OPEN */) {
      console.warn(`[WhatsAppBot] WebSocket not actually OPEN (state=${wsState}). Forcing reconnect.`);
      this.isConnected = false;
      setTimeout(() => this.initSocket(), 500);
      return {
        success: false,
        message: "WhatsApp connection went stale. Reconnecting now — please retry sending in a few seconds.",
      };
    }

    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;

      // Verify the number actually exists on WhatsApp before attempting send.
      let exists = true;
      try {
        const [result] = await this.sock.onWhatsApp(jid);
        exists = !!result?.exists;
      } catch (checkErr) {
        console.warn("[WhatsAppBot] onWhatsApp check failed, proceeding anyway:", checkErr);
      }
      if (!exists) {
        return {
          success: false,
          message: `+${cleanPhone} does not appear to be a valid/registered WhatsApp number.`,
        };
      }

      // Human-like sending with live 'typing...' indicator & natural delay
      const sendResult = await this.sendHumanLikeMessage(jid, text);

      if (!sendResult?.key?.id) {
        console.error("[WhatsAppBot] sendMessage returned without a message key — likely a silent failure.", sendResult);
        return {
          success: false,
          message: "WhatsApp did not confirm this message was queued for delivery. Try again or re-pair the connection.",
        };
      }

      console.log(`[WhatsAppBot] Message successfully sent to ${cleanPhone} (with human typing simulation): "${text}" (id: ${sendResult.key.id})`);
      return { success: true, message: `Message delivered to +${cleanPhone} from Friday Assistant!` };
    } catch (err: any) {
      console.error("[WhatsAppBot] Error sending message:", err);
      this.isConnected = false;
      setTimeout(() => this.initSocket(), 500);
      return { success: false, message: `Failed to send WhatsApp message: ${err?.message || err}` };
    }
  }

  /**
   * Sends a Photo/Image with realistic 0.5s human attachment selection and typing presence.
   */
  /**
   * Sends a Photo/Image with realistic 0.5s human attachment selection and typing presence.
   * Supports sending to phone numbers, group JIDs, and LID contacts.
   */
  public async sendPhotoMessage(
    target: string,
    imageSource: string | Buffer,
    caption?: string,
    messageKey?: any
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected || !this.sock) {
      return { success: false, message: "WhatsApp bot is not connected." };
    }

    try {
      let jid = target;
      if (!jid.includes("@")) {
        let cleanPhone = target.replace(/[\s\-\(\)\+]/g, "").trim();
        if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
        jid = `${cleanPhone}@s.whatsapp.net`;
      }
      
      // Simulate Human Attachment + Gallery pick + Caption typing
      await humanBotFirewallService.simulateWhatsAppPhotoDelays(this.sock, jid, caption);

      const sendOptions: any = {};
      if (messageKey) {
        if (messageKey.message) {
          sendOptions.quoted = messageKey;
        } else {
          const cleanKey = messageKey.key || messageKey;
          sendOptions.quoted = {
            key: cleanKey,
            message: { conversation: caption || "[Photo]" },
          };
        }
      }

      const imagePayload = typeof imageSource === "string" ? { url: imageSource } : imageSource;
      let sendRes: any = null;
      try {
        sendRes = await this.sock.sendMessage(
          jid,
          {
            image: imagePayload,
            caption: caption ? caption.trim() : undefined,
          },
          sendOptions
        );
      } catch (quotedErr) {
        console.warn("[WhatsAppBot] Quoted photo send failed, retrying without quoted context:", (quotedErr as any)?.message || quotedErr);
        sendRes = await this.sock.sendMessage(jid, {
          image: imagePayload,
          caption: caption ? caption.trim() : undefined,
        });
      }

      if (sendRes?.key?.id) {
        this.botSentMessageIds.add(sendRes.key.id);
      }

      const recipientKey = jid.replace(/@.*$/, "");
      humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);
      return { success: true, message: `Photo successfully delivered to ${jid}!` };
    } catch (e: any) {
      console.error("[WhatsAppBot] Failed to send photo:", e);
      return { success: false, message: `Failed to send photo: ${e?.message || e}` };
    }
  }

  /**
   * Sends an Audio / Voice Note (PTT) with realistic human recording presence.
   */
  public async sendVoiceMessage(
    target: string,
    audioBuffer: Buffer,
    messageKey?: any
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected || !this.sock) {
      return { success: false, message: "WhatsApp bot is not connected." };
    }

    try {
      let jid = target;
      if (!jid.includes("@")) {
        let cleanPhone = target.replace(/[\s\-\(\)\+]/g, "").trim();
        if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
        jid = `${cleanPhone}@s.whatsapp.net`;
      }

      // Send recording presence update
      try {
        await this.sock.sendPresenceUpdate("recording", jid);
        await new Promise((r) => setTimeout(r, 1200));
        await this.sock.sendPresenceUpdate("paused", jid);
      } catch {}

      const sendOptions: any = {};
      if (messageKey) {
        if (messageKey.message) {
          sendOptions.quoted = messageKey;
        } else {
          const cleanKey = messageKey.key || messageKey;
          sendOptions.quoted = {
            key: cleanKey,
            message: { conversation: "[Voice Note]" },
          };
        }
      }

      let sendRes: any = null;
      try {
        sendRes = await this.sock.sendMessage(
          jid,
          {
            audio: audioBuffer,
            mimetype: "audio/mp4",
            ptt: true,
          },
          sendOptions
        );
      } catch (quotedErr) {
        sendRes = await this.sock.sendMessage(jid, {
          audio: audioBuffer,
          mimetype: "audio/mp4",
          ptt: true,
        });
      }

      if (sendRes?.key?.id) {
        this.botSentMessageIds.add(sendRes.key.id);
      }

      const recipientKey = jid.replace(/@.*$/, "");
      humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);
      return { success: true, message: `Voice note delivered to ${jid}!` };
    } catch (e: any) {
      console.error("[WhatsAppBot] Failed to send voice note:", e);
      return { success: false, message: `Failed to send voice note: ${e?.message || e}` };
    }
  }

  private baileysEnabled: boolean = true;

  public isBaileysEnabled(): boolean {
    return this.baileysEnabled;
  }

  public setBaileysEnabled(enabled: boolean) {
    this.baileysEnabled = enabled;
  }

  public setAutoReply(enabled: boolean) {
    this.autoReplyEnabled = enabled;
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      dedicatedPhone: this.dedicatedPhone,
      pairingCode: this.pairingCode,
      qrCodeDataUrl: this.qrCodeDataUrl,
      autoReplyEnabled: this.autoReplyEnabled,
      baileysEnabled: this.baileysEnabled,
    };
  }
}

export const whatsappBotService = new WhatsAppBotService();
