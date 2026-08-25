import * as BaileysModule from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { GoogleGenAI } from "@google/genai";
import { useFirestoreAuthState } from "./whatsappAuthState";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { dailyUpdateService } from "./dailyUpdateService";
import { visionMemoryService } from "./visionMemoryService";

// Resolve Baileys exports safely across CJS/ESM bundling
const baileys: any = BaileysModule;
const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket || baileys;
const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;

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
        await this.sock.sendPresenceUpdate("available");
      } catch (e) {
        console.warn("[WhatsAppBot] Keep-alive ping failed, triggering reconnect:", (e as any)?.message);
        this.isConnected = false;
        this.scheduleReconnect(3000);
      }
    }, 4 * 60 * 1000);
    console.log("[WhatsAppBot] Keep-alive timer started (4 min interval).");
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

  /** Wire up the Baileys messages.upsert listener — called inside initSocket(). */
  private setupMessageListener() {
    if (!this.sock) return;

    this.sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify") return; // 'append' = history sync, skip

      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;

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
                    const mimeType =
                      msg.message?.imageMessage?.mimetype ||
                      msg.message?.documentMessage?.mimetype ||
                      msg.message?.videoMessage?.mimetype ||
                      msg.message?.audioMessage?.mimetype ||
                      (msg.message?.videoMessage ? "video/mp4" : msg.message?.audioMessage ? "audio/ogg" : msg.message?.documentMessage ? "application/pdf" : "image/jpeg");
                    const caption =
                      msg.message?.imageMessage?.caption ||
                      msg.message?.documentMessage?.caption ||
                      msg.message?.videoMessage?.caption ||
                      "";
                    const fileName = msg.message?.documentMessage?.fileName;
                    const { visionMemoryService } = await import("./visionMemoryService");
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
              const pinRes = await voiceBiometricsService.handleWhatsAppVoicePinMessage(text, senderName);
              if (pinRes.handled && pinRes.replyText) {
                consumedByDailyUpdate = true;
                if (this.sock && this.isConnected) {
                  await this.sendHumanLikeMessage(replyJid, pinRes.replyText);
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
                    await this.sendHumanLikeMessage(replyJid, keyRes.replyText);
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
          } else if (!isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // ── Smart AI Auto-Reply for 1-on-1 Personal Chats ──────────────────
            this.handleIncomingForAutoReply(senderName, senderPhone, text, isUnknownContact, replyJid).catch((e) =>
              console.error("[WhatsAppBot] Auto-reply handling failed:", e)
            );
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
    replyJid: string
  ) {
    // 1. Check for a pending "should I ask DK?" confirmation from this sender.
    const pending = await dailyUpdateService.getRecentPendingForSender(senderPhone);
    if (pending && pending.status === "awaiting_confirmation") {
      if (dailyUpdateService.isAffirmative(text)) {
        await dailyUpdateService.markAskedDK(pending.id);
        if (this.sock) {
          await this.sendHumanLikeMessage(replyJid, "Theek hai, main boss se pooch ke aapko jaldi batati hoon 👍");
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
        await this.sendHumanLikeMessage(replyJid, factualAnswer);
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
          "Iske baare mein mujhe pata nahi, boss ne mujhe kuch nahi bataya hai. Chahe to main unse pooch loon?"
        );
      }
      return;
    }

    // 4. Ordinary chat — fall through to the normal AI reply, rate-limited.
    await this.tryFactualOrChatReply(senderName, senderPhone, text, isUnknownContact, replyJid);
  }

  /** The rate-limited Gemini smart-reply path for ordinary chit-chat, subject to the daily per-contact limit. */
  private async tryFactualOrChatReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string
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
          await this.sendHumanLikeMessage(replyJid, LIMIT_REACHED_GENERIC_REPLY(senderName, isUnknownContact));
        } catch (e) {
          console.error(`[WhatsAppBot] Failed to send limit-reached notice to ${senderPhone}:`, e);
        }
      }
      return;
    }

    this.lastReplyAt.set(senderKey, now);
    setTimeout(async () => {
      try {
        if (this.sock && this.isConnected) {
          const aiReply = await this.generateSmartAutoReply(senderName, senderPhone, text, isUnknownContact);
          await this.sendHumanLikeMessage(replyJid, aiReply);
          console.log(`[WhatsAppBot] Smart AI Reply sent to ${senderName} (+${senderPhone}): "${aiReply}"`);
        }
      } catch (replyErr) {
        console.error(`[WhatsAppBot] Failed to send AI auto-reply to ${senderPhone}:`, replyErr);
      }
    }, 1200);
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
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
    "gemini-2.5-flash",
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
        browser: ["Ubuntu", "Chrome", "20.0.04"],
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
          const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
          this.isConnected = false;
          this.qrCodeDataUrl = null;
          this.pairingCode = null;
          this.pairingCodeMode = false;
          console.log(`[WhatsAppBot] Connection closed (statusCode=${statusCode}). Reconnect: ${shouldReconnect}`);
          if (shouldReconnect) this.scheduleReconnect(5000);
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          this.pairingCodeMode = false;
          // FIX 3: Persist phone to Firestore so dashboard shows 'linked' after server restart
          if (this.dedicatedPhone) this.savePhoneToFirestore(this.dedicatedPhone).catch(() => {});
          // FIX 4: Start app-level keep-alive ping every 4 min
          this.startKeepAlive();
          console.log("[WhatsAppBot] Connected! Keep-alive active.");
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
  private async sendHumanLikeMessage(jid: string, text: string): Promise<any> {
    if (!this.sock) return null;

    const trimmed = text.trim();
    const wordCount = trimmed.split(/\s+/).length;

    // Realistic human typing calculation:
    // Base "reading/thinking" time: 600ms - 1200ms
    // Typing time: ~120ms - 180ms per word
    // Plus random jitter to prevent static interval patterns
    const baseDelay = 600 + Math.floor(Math.random() * 600);
    const typingDelay = Math.min(Math.max(wordCount * 140, 800), 3800);
    const jitter = Math.floor(Math.random() * 400) - 200;
    const totalTypingTime = Math.min(Math.max(baseDelay + typingDelay + jitter, 1200), 4500);

    try {
      // 1. Show 'typing...' status on recipient's WhatsApp
      await this.sock.sendPresenceUpdate('composing', jid);
    } catch { /* non-critical */ }

    // 2. Wait realistic human typing duration
    await new Promise((resolve) => setTimeout(resolve, totalTypingTime));

    try {
      // 3. Stop typing status
      await this.sock.sendPresenceUpdate('paused', jid);
      // Brief human finger tap delay (150ms - 300ms)
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch { /* non-critical */ }

    // 4. Send the message
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
    };
  }
}

export const whatsappBotService = new WhatsAppBotService();
