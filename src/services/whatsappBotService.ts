import * as BaileysModule from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { GoogleGenAI } from "@google/genai";
import { useFirestoreAuthState } from "./whatsappAuthState";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";

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
}

const inboxCol = () => db.collection("whatsapp_inbox");

class WhatsAppBotService {
  private sock: WASocket | null = null;
  private isConnected = false;
  private pairingCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private dedicatedPhone: string | null = null;
  private clearAuthFn: (() => Promise<void>) | null = null;

  // Incoming message storage & Auto-reply
  private messageCache: IncomingMessage[] = []; // RAM — max 200, newest first
  private groupNameCache: Map<string, string> = new Map();
  private messageCallback: ((msg: IncomingMessage) => void) | null = null;
  private autoReplyEnabled = true;
  private autoReplyCooldown: Map<string, { count: number; resetTime: number; lastReply: number }> = new Map();

  constructor() {
    this.initSocket().catch((err) => {
      console.log("[WhatsAppBot] Init standby:", err?.message || err);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register a callback that fires whenever a new incoming message arrives. */
  public setMessageCallback(cb: (msg: IncomingMessage) => void) {
    this.messageCallback = cb;
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
      // Recent → RAM cache (fast, last 48 hours)
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      messages = this.messageCache.filter((m) => m.timestamp >= cutoff);
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
      console.error("[WhatsAppBot] Failed to fetch from Firestore:", e);
      return this.messageCache.filter(
        (m) => m.timestamp >= startTs && m.timestamp <= endTs
      );
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

          // Notify server → broadcast to WebSocket clients
          if (this.messageCallback) this.messageCallback(incoming);

          // ── Smart AI Auto-Reply for 1-on-1 Personal Chats ──────────────────────────
          if (!isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            const now = Date.now();
            const senderKey = senderPhone || remoteJid;
            const tracker = this.autoReplyCooldown.get(senderKey) || { count: 0, resetTime: now + 30 * 60 * 1000, lastReply: 0 };

            // Reset counter every 30 minutes
            if (now > tracker.resetTime) {
              tracker.count = 0;
              tracker.resetTime = now + 30 * 60 * 1000;
            }

            // Max 8 AI replies per 30 mins, and at least 6 seconds between replies
            if (tracker.count < 8 && (now - tracker.lastReply > 6000)) {
              tracker.count++;
              tracker.lastReply = now;
              this.autoReplyCooldown.set(senderKey, tracker);

              setTimeout(async () => {
                try {
                  if (this.sock && this.isConnected) {
                    const aiReply = await this.generateSmartAutoReply(
                      senderName,
                      senderPhone,
                      text,
                      isUnknownContact,
                      (incoming as any).relation
                    );
                    await this.sock.sendMessage(replyJid, { text: aiReply });
                    console.log(`[WhatsAppBot] Smart AI Reply sent to ${senderName} (+${senderPhone}): "${aiReply}"`);
                  }
                } catch (replyErr) {
                  console.error(`[WhatsAppBot] Failed to send AI auto-reply to ${senderPhone}:`, replyErr);
                }
              }, 1500);
            }
          }

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
   * Generates a smart, human-like AI auto-reply for WhatsApp messages using Gemini.
   * Tries a chain of models (newest/best first) so a single model being
   * overloaded, rate-limited, or briefly down doesn't fall back to the
   * generic "DK is busy" text — only falls back if EVERY model fails.
   * Handles: identity ("who made you / who are you"), privacy guard for DK's data, normal chat.
   */
  private static readonly AUTO_REPLY_MODEL_CHAIN = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  private async generateSmartAutoReply(
    senderName: string,
    senderPhone: string,
    messageText: string,
    isUnknownContact: boolean,
    relation?: string
  ): Promise<string> {
    const fallbackText = () => {
      const greeting = !isUnknownContact ? `Haanji ${senderName} ji, ` : "";
      return `${greeting}Boss (DK) abhi busy hain, jaise hi wo aayenge main unko aapka message bol dunga, jaldi hi wo reply denge.`;
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

  public async initSocket() {
    try {
      if (!makeWASocket || typeof makeWASocket !== "function") {
        console.warn("[WhatsAppBot] makeWASocket is not a function:", typeof makeWASocket);
        return;
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
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      this.sock.ev.on("creds.update", saveCreds);

      // Wire up incoming message listener
      this.setupMessageListener();

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
          } catch (e) {
            console.error("[WhatsAppBot] QR code generation error:", e);
          }
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
          this.isConnected = false;
          this.qrCodeDataUrl = null;
          console.log(`[WhatsAppBot] Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
          if (shouldReconnect) setTimeout(() => this.initSocket(), 5000);
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          console.log("[WhatsAppBot] Connected successfully to dedicated WhatsApp number!");
        }
      });
    } catch (err) {
      console.error("[WhatsAppBot] Error initializing socket:", err);
    }
  }

  public async requestPairingCode(phoneNumber: string): Promise<string> {
    let cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    this.dedicatedPhone = cleanPhone;

    if (this.isConnected) return "ALREADY_CONNECTED";
    if (!this.sock) await this.initSocket();

    await new Promise((resolve) => setTimeout(resolve, 800));

    if (this.sock && !this.isConnected) {
      try {
        const code = await this.sock.requestPairingCode(cleanPhone);
        this.pairingCode = code;
        console.log(`[WhatsAppBot] Generated Pairing Code for ${cleanPhone}: ${code}`);
        return code;
      } catch (err: any) {
        console.error("[WhatsAppBot] Failed to request pairing code:", err);
        try {
          await this.resetSession();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const code = await this.sock.requestPairingCode(cleanPhone);
          this.pairingCode = code;
          return code;
        } catch (retryErr: any) {
          throw new Error(retryErr?.message || err?.message || "Failed to generate pairing code");
        }
      }
    }

    throw new Error("WhatsApp socket not ready. Please try again.");
  }

  public async resetSession() {
    this.isConnected = false;
    this.pairingCode = null;
    this.qrCodeDataUrl = null;
    try {
      if (this.sock) { this.sock.end(undefined); this.sock = null; }
      if (this.clearAuthFn) await this.clearAuthFn();
    } catch (e) {
      console.error("[WhatsAppBot] Error during resetSession:", e);
    }
    await this.initSocket();
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
      // Prevents false "success" when the JID is malformed or unregistered.
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

      // sendMessage resolves once Baileys hands the message to its send
      // queue — it does NOT guarantee server-side delivery. We treat the
      // returned message key as the real signal: no key/id means Baileys
      // itself considers the send incomplete, even without throwing.
      const sendResult = await this.sock.sendMessage(jid, { text: text.trim() });

      if (!sendResult?.key?.id) {
        console.error("[WhatsAppBot] sendMessage returned without a message key — likely a silent failure.", sendResult);
        return {
          success: false,
          message: "WhatsApp did not confirm this message was queued for delivery. Try again or re-pair the connection.",
        };
      }

      console.log(`[WhatsAppBot] Message successfully sent to ${cleanPhone}: "${text}" (id: ${sendResult.key.id})`);
      return { success: true, message: `Message delivered to +${cleanPhone} from Friday Assistant!` };
    } catch (err: any) {
      console.error("[WhatsAppBot] Error sending message:", err);
      // Any send failure could mean the socket is dead despite isConnected
      // still being true — reset it so the next attempt gets a fresh session.
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
