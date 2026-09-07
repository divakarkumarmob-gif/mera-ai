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

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log("[WhatsAppBot] Reconnecting...");
      await this.initSocket();
    }, delayMs);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register a callback that fires whenever a new incoming message arrives. */
  public setMessageCallback(cb: (msg: IncomingMessage) => void) {
    this.messageCallback = cb;
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

  /** Wire up the Baileys messages.upsert listener — called inside initSocket(). */
  private setupMessageListener() {
    if (!this.sock) return;

    this.sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify") return; // 'append' = history sync, skip

      for (const msg of messages) {
        try {
          // Log outgoing messages from Boss so they are stored in history forever
          if (msg.key.fromMe) {
            const remoteJid: string = msg.key.remoteJid || "";
            const text = this.extractMessageText(msg);
            if (text && remoteJid) {
              const ts = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
              const outgoing: IncomingMessage = {
                id: msg.key.id || Math.random().toString(36).substring(2, 9),
                senderPhone: "me",
                senderName: "DK (Boss)",
                senderDisplayName: "Me",
                replyJid: remoteJid,
                groupId: remoteJid.endsWith("@g.us") ? remoteJid : null,
                groupName: null,
                isGroup: remoteJid.endsWith("@g.us"),
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
            }
            continue;
          }

          const remoteJid: string = msg.key.remoteJid;
          if (!remoteJid) continue;

          const text = this.extractMessageText(msg);
          if (!text) continue;

          const isGroup = remoteJid.endsWith("@g.us");
          const isLid = remoteJid.endsWith("@lid");
          const senderJid: string = isGroup
            ? (msg.key.participant || msg.key.participantAlt || remoteJid)
            : remoteJid;

          // WhatsApp's newer LID (Linked ID) system means remoteJid/participant
          // can be an internal ID like "123456@lid" instead of a real phone
          // number JID ("91XXXXXXXXXX@s.whatsapp.net"). If we blindly strip
          // digits from a @lid JID we get a fake "phone number" that will
          // never match a saved contact and can never be sent a message.
          // Baileys attaches the real phone-number JID as senderPn / participantPn
          // (or msg.key.remoteJidAlt / participantAlt) when a message arrives
          // via LID — prefer that for phone extraction and future sends.
          const realPhoneJid: string | undefined =
            (msg as any).key?.senderPn ||
            (msg as any).key?.participantPn ||
            (isGroup ? (msg as any).key?.participantAlt : (msg as any).key?.remoteJidAlt) ||
            (!isLid ? senderJid : undefined);

          const senderPhone = (realPhoneJid || senderJid || "")
            .split("@")[0]
            .split(":")[0]
            .replace(/\D/g, "");
          const senderDisplayName: string = msg.pushName || (senderPhone ? `+${senderPhone}` : "Unknown");

          // Keep the raw JID actually usable for a reply. If we only have a
          // @lid identity and no resolved phone JID, replying must go back
          // to that same @lid JID — sending to "@s.whatsapp.net" with the
          // decoded LID digits will silently fail (wrong recipient / no-op).
          const replyJid: string = realPhoneJid
            ? `${senderPhone}@s.whatsapp.net`
            : senderJid;

          let groupName: string | null = null;
          if (isGroup) groupName = await this.getGroupName(remoteJid);

          // Resolve name from DK's contacts book
          let senderName = senderDisplayName;
          let isUnknownContact = true;
          try {
            const contact = await contactsService.findContact(senderPhone);
            if (contact && contact.id !== "temp") {
              senderName = contact.name;
              isUnknownContact = false; // Found in contacts book
            }
          } catch {}

          const ts = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : Date.now();

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
          };

          // RAM cache (newest first, max 200)
          this.messageCache.unshift(incoming);
          if (this.messageCache.length > 200) this.messageCache.pop();

          // Persist to Firestore
          this.saveToFirestore(incoming).catch(() => {});

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
                downloadFn(msg, "buffer", {}, { reuploadRequest: this.sock?.updateMediaMessage })
                  .then(async (buffer: Buffer) => {
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

                    // 1. Boss Voice Note -> STT + Autonomous Command Execution
                    if (isVoice && isFromOwner) {
                      try {
                        const { voiceBridgeService } = await import("./voiceBridgeService");
                        const transcribed = await voiceBridgeService.transcribeAudio(buffer, mimeType, fileName || "voice.ogg");
                        if (transcribed && transcribed.trim()) {
                          console.log(`[WhatsAppBot] Boss Voice Transcribed: "${transcribed}"`);
                          await this.sendHumanLikeMessage(replyJid, `🎙️ *Aapki Aawaz (Transcription):*\n_"${transcribed}"_`, "", msg.key);
                          await this.handleOwnerWhatsAppMessage(senderName, senderPhone, transcribed, replyJid, msg.key);
                          return;
                        }
                      } catch (sttErr) {
                        console.error("[WhatsAppBot] STT error on Boss voice note:", sttErr);
                      }
                    }

                    // 2. Boss Photo -> Conditional Vision AI Analysis or Firestore Memory Saving
                    if (isPhoto && isFromOwner) {
                      try {
                        const cap = (caption || "").trim();
                        const isAnalysisRequested =
                          /^(analysis|analyze|analyse|photo\s*analyze|ocr|dekho|check|batao|kya\s*hai|read)/i.test(cap) ||
                          /\b(analysis|analyze|kya\s*likha\s*hai|check\s*karo|padho|scan)\b/i.test(cap);
                        const isFaceIdQuery = /^(ye\s*kaun\s*hai|pehchano|who\s*is\s*this|identify)/i.test(cap);

                        // A. Explicit Analysis or Face ID Requested
                        if (isAnalysisRequested || isFaceIdQuery) {
                          await this.sendHumanLikeMessage(replyJid, "👁️ *Photo analyze ho rahi hai...*", "", msg.key);
                          if (isFaceIdQuery) {
                            const idRes = await visionMemoryService.identifyPersonInPhoto(buffer);
                            await this.sendHumanLikeMessage(replyJid, idRes.explanation, "", msg.key);
                          } else {
                            const analyzed = await visionMemoryService.processIncomingMedia(buffer, "image/jpeg", senderName, cap);
                            await this.sendHumanLikeMessage(replyJid, `🖼️ *Photo Breakdown & OCR:*\n\n${analyzed.analysis}`, "", msg.key);
                          }
                          return;
                        }

                        // B. Face / Person Memory Saving
                        if (/^(iska\s*naam|ye\s*photo|save\s*person|inka\s*naam)/i.test(cap)) {
                          const nameMatch = cap.match(/(?:naam|name)\s+(?:hai\s+)?([A-Za-z0-9\s]+)/i);
                          const personName = nameMatch ? nameMatch[1].trim() : "Contact";
                          const saveRes = await visionMemoryService.savePersonMemory(personName, "Friend / Contact", cap, buffer);
                          await this.sendHumanLikeMessage(replyJid, saveRes.summary, "", msg.key);
                          return;
                        }

                        // C. Boss provided info/description about the photo to remember permanently
                        if (cap) {
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
                          return;
                        }

                        // D. Uncaptioned Photo without "analysis" -> Simple acknowledgement without heavy OCR
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
                          `📸 *Photo receive ho gayi hai Boss!* (Agar iska analysis chahiye to photo ke niche _"analysis"_ likhkar bhejiye, ya iske baare me koi jaankari save karni ho to likhiye)`,
                          "",
                          msg.key
                        );
                        return;
                      } catch (photoErr) {
                        console.error("[WhatsAppBot] Photo processing error for Boss:", photoErr);
                      }
                    }

                    // 3. Boss Document / PDF -> Detailed OCR & Summary
                    if (isDoc && isFromOwner) {
                      try {
                        await this.sendHumanLikeMessage(replyJid, `📄 *Document / PDF analyze ho raha hai (${fileName || "file"})...*`, "", msg.key);
                        const analyzed = await visionMemoryService.processIncomingMedia(buffer, mimeType, senderName, caption, fileName);
                        await this.sendHumanLikeMessage(replyJid, `📑 *Document OCR & Summary (${fileName || "file"}):*\n\n${analyzed.analysis}`, "", msg.key);
                        return;
                      } catch (docErr) {
                        console.error("[WhatsAppBot] Document processing error for Boss:", docErr);
                      }
                    }

                    // 4. Boss Video -> Video Actions & Content Breakdown
                    if (isVideo && isFromOwner) {
                      try {
                        await this.sendHumanLikeMessage(replyJid, "🎬 *Video analyze ho rahi hai...*", "", msg.key);
                        const analyzed = await visionMemoryService.processIncomingMedia(buffer, "video/mp4", senderName, caption || "Analyze video", fileName);
                        await this.sendHumanLikeMessage(replyJid, `🎥 *Video Analysis Breakdown:*\n\n${analyzed.analysis}`, "", msg.key);
                        return;
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
                      fileName
                    );
                    if (analyzed.shortSummary) {
                      incoming.text = `${incoming.text} | AI Summary: ${analyzed.shortSummary}`;
                      this.saveToFirestore(incoming).catch(() => {});
                    }
                  })
                  .catch((err: any) => console.warn("[WhatsAppBot] Media download error:", err));
              }
            } catch (mediaErr) {
              console.warn("[WhatsAppBot] Failed to initiate media download:", mediaErr);
            }
          }

          const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
          const isFromOwner = !isGroup && !!ownerPhone && senderPhone === ownerPhone;

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
              this.handleOwnerWhatsAppMessage(senderName, senderPhone, text, replyJid, msg.key).catch((e) =>
                console.error("[WhatsAppBot] Owner Master Friday processing error:", e)
              );
            }
          } else if (!isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // ── Smart AI Auto-Reply with Burst Debounce for 1-on-1 Personal Chats ──
            this.queueIncomingForAutoReply(senderName, senderPhone, text, isUnknownContact, replyJid, msg.key);
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
   * Master FRIDAY AI Assistant for Boss (DK) on WhatsApp.
   * Gives DK 100% full autonomous access via WhatsApp chat:
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
    messageKey: any
  ): Promise<void> {
    const rawText = (text || "").trim();
    if (!rawText) return;

    // 1. YouTube Video Intelligence ("https://youtube.com/..." / "https://youtu.be/...")
    try {
      const { youtubeService } = await import("./youtubeService");
      const ytVideoId = youtubeService.extractVideoId(rawText);
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
        rawText.match(/train\s+(?:status|kahan\s*hai|live|no|number)?\s*[:=-]?\s*(\d{4,5})/i);
      if (trainMatch) {
        const trainQuery = trainMatch[1];
        const trainStatus = await railRadarService.getLiveTrainStatus(trainQuery);
        await this.sendHumanLikeMessage(replyJid, trainStatus.message, rawText, messageKey);
        return;
      }

      const pnrMatch = rawText.match(/^(?:\/pnr|pnr|pnr\s*status)\s+(\d{10})/i) || rawText.match(/\b(\d{10})\b/i);
      if (pnrMatch && (/pnr/i.test(rawText) || pnrMatch[0].startsWith("/pnr") || rawText.length === 10)) {
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

    // 10. AUTONOMOUS MASTER FRIDAY AI WITH TOOL CALLING FOR BOSS
    try {
      const reply = await this.executeBossChatAI(senderName, rawText);
      await this.sendHumanLikeMessage(replyJid, reply, rawText, messageKey);
    } catch (aiErr: any) {
      console.error("[WhatsAppBot] Error in executeBossChatAI:", aiErr);
      await this.sendHumanLikeMessage(replyJid, `Boss, main sun rahi hoon! Par kuch technical issue aaya: ${aiErr?.message || aiErr}`, rawText, messageKey);
    }
  }

  /**
   * Autonomous AI Chat Engine for Boss (DK) with tool calling.
   */
  private async executeBossChatAI(senderName: string, messageText: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return `Haanji Boss! Main Friday hoon. API Key abhi configure nahi hai, par main aapki baat note kar rahi hoon!`;
    }

    const { memoryEngine } = await import("./memoryEngine");
    const memoryContext = await memoryEngine.compileLeanMemoryPrompt();

    const ai = new GoogleGenAI({ apiKey });

    const functionDeclarations: any[] = [
      {
        name: "send_whatsapp_message",
        description: "Send a WhatsApp message to any contact or phone number from DK's contacts book.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. Rahul, Aman, Mummy) or phone number" },
            messageText: { type: "STRING", description: "The message to send" },
            channel: { type: "STRING", description: "Optional channel: 'whatsapp1', 'whatsapp2', or 'auto'" },
          },
          required: ["contactNameOrPhone", "messageText"],
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
    ];

    const systemInstruction = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, loyal, warm, witty, and deeply caring AI companion and chief executive assistant.
Boss (DK) is chatting with you directly on WhatsApp. He is using WhatsApp chat to communicate everything with you because he cannot talk out loud right now.
You have FULL AUTONOMOUS ACCESS to execute all tools:
1. Search all historical & recent WhatsApp messages (even 30+ days ago) using 'search_whatsapp_history'.
2. Cross-platform bridging: Forward any text/photo/video/file between WhatsApp and Telegram using 'forward_to_telegram' and 'forward_from_telegram_to_whatsapp'.
3. Send WhatsApp messages, lookup contacts, set reminders, take notes, track expenses, fetch weather, news, search web, and answer any technical, coding, personal, or life questions Boss asks.

BOSS IDENTITY & MEMORY:
${memoryContext}

COMMUNICATION STYLE:
- Address DK warmly and respectfully as 'Boss' or 'DK Boss'.
- Speak in natural, affectionate, crisp Hinglish (blend of Hindi and English) with high intellect.
- Format responses cleanly using WhatsApp markdown (*bold*, _italic_, bullet points).
- If Boss asks you to perform an action (send a message, save a note, check weather, search history, forward to telegram, etc.), call the appropriate tool immediately!`;

    const executeTool = async (toolName: string, args: any): Promise<any> => {
      try {
        if (toolName === "send_whatsapp_message") {
          const { contactsService } = await import("./contactsService");
          const { sendWhatsAppUnified } = await import("./whatsappService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
          const res = await sendWhatsAppUnified(phone, args.messageText, { channel: args.channel });
          return res;
        }
        if (toolName === "get_contact_info") {
          const { contactsService } = await import("./contactsService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          return contact
            ? { found: true, name: contact.name, phone: contact.phone, relation: contact.relation, notes: contact.notes }
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
          const res = await newsService.getTopNews(args.query);
          return { success: res.success, message: res.message };
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
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
      return { status: "unknown_tool" };
    };

    for (const model of ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash"]) {
      try {
        const chat = ai.chats.create({
          model,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
          },
        });

        let response = await chat.sendMessage({ message: messageText });

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
    messageKey: any
  ) {
    const senderKey = senderPhone || replyJid;

    const existing = this.incomingDebounceMap.get(senderKey);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.senderName = senderName;
      existing.isUnknownContact = isUnknownContact;
      existing.replyJid = replyJid;
      existing.latestMsgKey = messageKey;
    } else {
      this.incomingDebounceMap.set(senderKey, {
        timer: null,
        texts: [text],
        senderName,
        senderPhone,
        isUnknownContact,
        replyJid,
        latestMsgKey: messageKey,
      });
    }

    const entry = this.incomingDebounceMap.get(senderKey)!;
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
          entry.latestMsgKey
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
    messageKey?: any
  ) {
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

    // 3. Nothing relevant in today's update — if this looks like a question
    // DK would want to be asked about directly, offer to check with him.
    const looksLikeQuestion = /\?|kya|kaisa|kaisi|kahan|kab|kyu|kyun/i.test(text);
    if (looksLikeQuestion) {
      await dailyUpdateService.createPendingQuestion({ senderPhone, senderName, replyJid, question: text });
      if (this.sock) {
        await this.sendHumanLikeMessage(
          replyJid,
          "Iske baare mein mujhe pata nahi, boss ne mujhe kuch nahi bataya hai. Chahe to main unse pooch loon?",
          text,
          messageKey
        );
      }
      return;
    }

    // 4. Ordinary chat — fall through to the normal AI reply, rate-limited.
    await this.tryFactualOrChatReply(senderName, senderPhone, text, isUnknownContact, replyJid, messageKey);
  }

  /** The rate-limited Gemini smart-reply path for ordinary chit-chat, subject to the daily per-contact limit. */
  private async tryFactualOrChatReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey?: any
  ) {
    const now = Date.now();
    const senderKey = senderPhone || replyJid;
    const lastAt = this.lastReplyAt.get(senderKey) || 0;
    if (now - lastAt <= 6000) return; // avoid double-firing on rapid bursts

    const allowed = await this.tryConsumeDailyReply(senderKey);
    if (!allowed) {
      const today = todayISTLocal();
      const alreadyNotified = this.limitNoticeSentToday.get(senderKey);
      if (alreadyNotified === today) return; // already told them once today — stay quiet now

      console.log(`[WhatsAppBot] Daily auto-reply limit reached for ${senderName} (+${senderPhone}) — sending one-time generic notice.`);
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

    this.lastReplyAt.set(senderKey, now);
    try {
      if (this.sock && this.isConnected) {
        const aiReply = await this.generateSmartAutoReply(senderName, senderPhone, text, isUnknownContact);
        await this.sendHumanLikeMessage(replyJid, aiReply, text, messageKey);
        console.log(`[WhatsAppBot] Smart AI Reply sent to ${senderName} (+${senderPhone}): "${aiReply}"`);
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
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ];

  private async generateSmartAutoReply(
    senderName: string,
    senderPhone: string,
    messageText: string,
    isUnknownContact: boolean,
    relation?: string
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
    const prompt = `You are Friday, the highly intelligent, polite, warm, witty and deeply human-like personal voice AI companion of DK (Divakar Kumar).
You are managing DK's personal WhatsApp account while DK is away/busy.

Incoming WhatsApp message details:
- Sender Name: "${senderName}"
- Contact Status: ${isUnknownContact ? "Unknown Contact (Not saved in phonebook)" : `Saved in phonebook${relation ? ` (Relationship: ${relation})` : ""}`}
- Sender Phone: +${senderPhone}
- Message Received: "${messageText}"

YOUR RULES FOR GENERATING THE WHATSAPP REPLY:
1. IDENTITY & CREATOR:
   - If they ask who you are, your name, who made you, or whose number this is (e.g. "tumhara naam kya hai?", "kaun ho tum?", "tumhe kisne banaya?", "ye kiska number hai?"):
     Reply warmly: "Main Friday hoon — DK Boss (Divakar Kumar) ka personal AI assistant! DK abhi thode busy hain. Aap bataiye, aapko kya kaam hai ya kya janna hai?"
   - Always clarify that you are DK's AI contact assistant.

2. PRIVACY & SECURITY GUARD (STRICT ABSOLUTE RULE):
   - If they ask for DK's private or personal confidential data (such as personal home address, bank account/money details, passwords, confidential personal life secrets, private schedule):
     STRICTLY REFUSE politely: "Yeh personal jaankari main share nahi kar sakti. Iska jawab sirf DK boss hi de sakte hain. Maine unko aapka message note kar diya hai."

3. GENERAL & FRIENDLY CONVERSATIONS:
   - For greetings ("Hi", "Hello", "Kaise ho"): Greet back warmly in friendly Hinglish, let them know DK is occupied, and ask how you can assist or take a note.
   - For normal/general questions (weather, general help, normal knowledge): Answer politely, smartly and helpfully in 1-2 natural sentences.

4. PASSING MESSAGES TO DK:
   - If they leave a message, request a callback, or ask when DK will be available:
     Assure them: "Maine aapka message note kar liya hai, jaise hi DK aayenge main unko bol dungi aur wo jaldi hi reply denge."

5. TONE & STYLE:
   - Natural Hindi/Hinglish (mix of Hindi and English).
   - Crisp, polite, human-like (maximum 2-3 short sentences).
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
          // By default, stay OFFLINE until someone sends a message
          this.sock.sendPresenceUpdate("unavailable").catch(() => {});
          console.log("[WhatsAppBot] Connected! Natural Offline mode active.");
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

    // Send the message
    return await this.sock.sendMessage(jid, { text: trimmed });
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
  public async sendPhotoMessage(toPhone: string, imageSource: string | Buffer, caption?: string): Promise<{ success: boolean; message: string }> {
    let cleanPhone = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    if (!this.isConnected || !this.sock) {
      return { success: false, message: "WhatsApp bot is not connected." };
    }

    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;
      
      // Simulate Human Attachment + Gallery pick + Caption typing (0.5s gaps)
      await humanBotFirewallService.simulateWhatsAppPhotoDelays(this.sock, jid, caption);

      const imagePayload = typeof imageSource === "string" ? { url: imageSource } : imageSource;
      await this.sock.sendMessage(jid, {
        image: imagePayload,
        caption: caption ? caption.trim() : undefined,
      });

      humanBotFirewallService.recordDispatchedMessage("whatsapp", cleanPhone);
      return { success: true, message: `Photo successfully delivered to +${cleanPhone}!` };
    } catch (e: any) {
      return { success: false, message: `Failed to send photo: ${e?.message || e}` };
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
