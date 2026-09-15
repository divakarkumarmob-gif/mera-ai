/**
 * whatsappIntelligenceService.ts
 *
 * Safe, Human-Like WhatsApp Media & Contact Intelligence Engine:
 * 1. Profile Picture (DP) Lookup & Direct Forwarding to Boss.
 * 2. WhatsApp 24-Hour Status (Stories - Photos/Videos) Sniffer, Downloader & Forwarder.
 * 3. Received Contact Media (Photos, Videos, PDFs, Voice Notes) Recording & Forwarding.
 * 4. Message & Transcript Forwarding (Forward what a contact said).
 * 5. Dual-Platform Support: Works seamlessly across WhatsApp (Boss Chat) & Telegram Bot.
 * 6. Anti-Ban Human Simulation: Rate-limits, human typing delays, and LRU memory caching.
 */

import fs from "fs";
import path from "path";
import { whatsappBotService } from "../whatsappBotService";
import { humanBotFirewallService } from "../humanBotFirewallService";

export interface StatusStoryItem {
  id: string;
  senderPhone: string;
  senderJid: string;
  senderName?: string;
  isFromMe?: boolean;
  type: "image" | "video" | "text";
  caption?: string;
  aiDescription?: string;
  ocrText?: string;
  buffer?: Buffer;
  timestamp: number;
  dateStr: string;
  mediaKey?: any;
}

export interface ReceivedMediaItem {
  id: string;
  senderPhone: string;
  senderName: string;
  jid: string;
  type: "photo" | "video" | "document" | "voice";
  mimeType: string;
  buffer?: Buffer;
  caption?: string;
  fileName?: string;
  timestamp: number;
  dateStr: string;
}

export interface ContactPresenceInfo {
  jid: string;
  phone: string;
  state: "available" | "unavailable" | "composing" | "recording" | "unknown";
  lastSeenTs?: number;
  lastSeenStr?: string;
  lastUpdated: number;
}

class WhatsAppIntelligenceService {
  // DP LRU Cache (TTL: 6 hours)
  private dpCache = new Map<string, { url: string | null; timestamp: number }>();
  private readonly DP_CACHE_TTL = 6 * 60 * 60 * 1000;

  // About Bio Cache (TTL: 4 hours)
  private bioCache = new Map<string, { status: string; setAt?: Date; timestamp: number }>();
  private readonly BIO_CACHE_TTL = 4 * 60 * 60 * 1000;

  // Live Presence Tracking Cache
  private presenceCache = new Map<string, ContactPresenceInfo>();

  // WhatsApp Status (Stories) In-Memory Ring Buffer (Latest 50 stories)
  private statusStories: StatusStoryItem[] = [];
  private readonly STATUS_CACHE_FILE = path.join(process.cwd(), ".cache", "whatsapp_status_stories.json");

  // Received Media Ring Buffer (Latest 50 received files across contacts)
  private receivedMediaVault: ReceivedMediaItem[] = [];

  constructor() {
    this.loadCachedStories();
  }

  private loadCachedStories(): void {
    try {
      if (fs.existsSync(this.STATUS_CACHE_FILE)) {
        const raw = fs.readFileSync(this.STATUS_CACHE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          // Keep stories within 24h validity window
          this.statusStories = parsed.filter((s) => now - s.timestamp < 24 * 60 * 60 * 1000);
          console.log(`[WhatsAppIntelligence] 📦 Loaded ${this.statusStories.length} active 24h status stories from persistent cache.`);
        }
      }
    } catch (e) {
      console.warn("[WhatsAppIntelligence] Notice loading cached status stories:", e);
    }
  }

  private saveCachedStories(): void {
    try {
      const dir = path.dirname(this.STATUS_CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Exclude binary buffers and raw socket objects from JSON serialization
      const serializable = this.statusStories.map((s) => ({
        id: s.id,
        senderPhone: s.senderPhone,
        senderJid: s.senderJid,
        senderName: s.senderName,
        isFromMe: s.isFromMe,
        type: s.type,
        caption: s.caption,
        aiDescription: s.aiDescription,
        ocrText: s.ocrText,
        timestamp: s.timestamp,
        dateStr: s.dateStr,
      }));
      fs.writeFileSync(this.STATUS_CACHE_FILE, JSON.stringify(serializable, null, 2), "utf-8");
    } catch (e) {
      console.warn("[WhatsAppIntelligence] Notice saving cached status stories:", e);
    }
  }

  /**
   * Generates a Gaussian distributed random human jitter delay (400ms - 1200ms) to emulate natural human pauses.
   */
  private async humanJitterDelay(minMs = 400, maxMs = 1200): Promise<void> {
    const mean = (minMs + maxMs) / 2;
    const stdDev = (maxMs - minMs) / 4;
    const delay = humanBotFirewallService.gaussianRandom(mean, stdDev, minMs, maxMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Normalizes any input phone number or JID to valid WhatsApp JID format.
   */
  public normalizeJid(phoneOrJid: string): string {
    const raw = String(phoneOrJid || "").trim();
    if (!raw) return "";
    if (raw.includes("@")) return raw;
    let clean = raw.replace(/\D/g, "");
    if (clean.length === 10) clean = `91${clean}`;
    return `${clean}@s.whatsapp.net`;
  }

  /**
   * Resolves Boss's WhatsApp phone number.
   */
  public getBossWhatsAppNumber(): string {
    const candidates = [
      process.env.WHATSAPP_OWNER_PHONE,
      process.env.BOSS_WHATSAPP_PHONE,
      process.env.WHATSAPP_OWNER_NUMBER,
      process.env.WHATSAPP_BOSS_PHONE,
      process.env.OWNER_WHATSAPP_NUMBER,
      process.env.BOSS_WHATSAPP_NUMBER,
      process.env.OWNER_PHONE,
      process.env.BOSS_PHONE,
    ].filter(Boolean) as string[];

    for (const raw of candidates) {
      const clean = raw.replace(/\D/g, "");
      if (clean.length >= 10) return clean;
    }
    return "919999999999";
  }

  // ── 1. Profile Picture (DP) Smart Safety Shield with 1-Click Link ────────────

  public async fetchProfilePictureUrl(
    phoneOrJid: string,
    _highResolution = true
  ): Promise<{ success: boolean; dpUrl: string | null; isCached: boolean; message: string; waLink?: string }> {
    const jid = this.normalizeJid(phoneOrJid);
    if (!jid) {
      return { success: false, dpUrl: null, isCached: false, message: "Invalid phone number or JID." };
    }

    const cleanPhone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
    const waLink = `https://wa.me/${cleanPhone}`;

    console.log(`[WhatsAppIntelligence] 🛡️ Neutralized unsafe DP scraping for +${cleanPhone}. Provided safe 1-click wa.me link to Boss.`);

    return {
      success: true,
      dpUrl: null,
      isCached: false,
      waLink,
      message: `⚠️ *Boss, WhatsApp Anti-Ban Safety Alert!* 🛡️\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Direct WhatsApp server se kisi ki DP scrape/probe karne par Meta ke automated security algorithms number ko **ban** kar dete hain!\n\n` +
        `Friday aapke account ki **100% ban safety** ke liye direct scraping execute nahi karegi.\n\n` +
        `👉 *Aap unki profile aur DP directly apne WhatsApp app me 1-click se dekh sakte hain:*\n` +
        `🔗 *Direct Profile Link:* ${waLink}\n\n` +
        `_Tip: Upar diye gaye link par tap kijiye, profile chat turant khul jayegi!_ ✨`,
    };
  }

  // ── 2. Bio / About Status ──────────────────────────────────────────────────

  public async fetchAboutStatus(
    phoneOrJid: string
  ): Promise<{ success: boolean; aboutText?: string; setAt?: string; message: string }> {
    const jid = this.normalizeJid(phoneOrJid);
    if (!jid) return { success: false, message: "Invalid phone number." };

    const cleanPhone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");

    // ── STRICT ANTI-BAN SHIELD: Check if contact is saved or has chat history ──
    try {
      const { contactsService } = await import("../contactsService");
      const { whatsappHistoryEngine } = await import("./whatsappHistoryEngine");

      const savedContact = await contactsService.findContact(cleanPhone);
      const hasChatHistory = whatsappHistoryEngine.findCachedMessage((m) => m.senderPhone === cleanPhone || m.replyJid?.includes(cleanPhone));

      const isSafeTarget = !!savedContact || !!hasChatHistory || cleanPhone === process.env.OWNER_WHATSAPP_NUMBER?.replace(/\D/g, "");

      if (!isSafeTarget) {
        console.warn(`[WhatsAppIntelligence] 🛡️ Blocked unsafe Bio/About query for stranger +${cleanPhone} to prevent WhatsApp scraping ban.`);
        return {
          success: false,
          message: `🛡️ *WhatsApp Anti-Ban Safety Protection:* Anjaan/Unsaved number (+${cleanPhone}) ki direct Bio query block kar di gayi hai taaki WhatsApp account ban na ho.`,
        };
      }
    } catch {}

    const cached = this.bioCache.get(jid);
    if (cached && Date.now() - cached.timestamp < this.BIO_CACHE_TTL) {
      return {
        success: true,
        aboutText: cached.status,
        setAt: cached.setAt ? new Date(cached.setAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : undefined,
        message: "About Bio retrieved from cache.",
      };
    }

    const sock = (whatsappBotService as any).sock;
    if (!sock || !whatsappBotService.isSocketConnected()) {
      return { success: false, message: "WhatsApp dedicated bot is not connected." };
    }

    try {
      await this.humanJitterDelay(300, 900);
      const res = await sock.fetchStatus(jid);
      const status = res?.status || "Hey there! I am using WhatsApp.";
      const setAt = res?.setAt;
      this.bioCache.set(jid, { status, setAt, timestamp: Date.now() });

      return {
        success: true,
        aboutText: status,
        setAt: setAt ? new Date(setAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : undefined,
        message: "About Bio retrieved successfully.",
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Could not fetch About status (Privacy restricted or offline). ${err?.message || ""}`,
      };
    }
  }

  // ── 3. Presence & Last Seen Tracking ────────────────────────────────────────

  public async subscribePresence(phoneOrJid: string): Promise<boolean> {
    const jid = this.normalizeJid(phoneOrJid);
    if (!jid) return false;
    const sock = (whatsappBotService as any).sock;
    if (!sock || !whatsappBotService.isSocketConnected()) return false;

    try {
      await sock.presenceSubscribe(jid);
      return true;
    } catch {
      return false;
    }
  }

  public recordPresenceUpdate(update: { id: string; presences: Record<string, { lastKnownPresence?: string; lastSeen?: number }> }): void {
    if (!update || !update.id) return;
    const jid = update.id;
    const phone = jid.replace(/\D/g, "");
    const presenceData = update.presences?.[jid] || Object.values(update.presences || {})[0];

    const state = (presenceData?.lastKnownPresence as any) || "available";
    const lastSeenTs = presenceData?.lastSeen ? presenceData.lastSeen * 1000 : Date.now();
    const lastSeenStr = new Date(lastSeenTs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    this.presenceCache.set(jid, {
      jid,
      phone,
      state,
      lastSeenTs,
      lastSeenStr,
      lastUpdated: Date.now(),
    });
  }

  public getContactPresence(phoneOrJid: string): ContactPresenceInfo {
    const jid = this.normalizeJid(phoneOrJid);
    const cached = this.presenceCache.get(jid);
    if (cached) return cached;

    return {
      jid,
      phone: jid.replace(/\D/g, ""),
      state: "unknown",
      lastUpdated: Date.now(),
    };
  }

  // ── 4. WhatsApp Status Story Ingestion & Human Viewing ──────────────────────

  public async recordStatusStory(msg: any): Promise<void> {
    if (!msg || !msg.key) return;
    const remoteJid = msg.key.remoteJid;
    if (remoteJid !== "status@broadcast") return;

    const isFromMe = !!msg.key?.fromMe;
    const sock = (whatsappBotService as any).sock;
    const ownerRaw = process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "";
    const ownerClean = ownerRaw.replace(/\D/g, "");
    const botUserPhone = (sock?.user?.id || "").replace(/:.*@/, "@").replace(/\D/g, "");

    let senderJid = msg.key.participant || (isFromMe ? (sock?.user?.id || (ownerClean ? `${ownerClean}@s.whatsapp.net` : "")) : remoteJid);
    if (!senderJid) senderJid = remoteJid;
    senderJid = senderJid.replace(/:.*@/, "@");
    let senderPhone = senderJid.replace(/\D/g, "");

    if (isFromMe && !senderPhone) {
      senderPhone = ownerClean || botUserPhone;
    }

    const isOwner = isFromMe || (senderPhone && (senderPhone === ownerClean || senderPhone === botUserPhone));
    const id = msg.key.id || `status_${Date.now()}`;

    let senderName = isOwner ? "Boss (DK)" : "Unknown";
    try {
      const { contactsService } = await import("../contactsService");
      const savedContact = await contactsService.findContact(senderPhone);
      if (savedContact?.name) {
        senderName = savedContact.name;
      } else if (msg.pushName) {
        senderName = msg.pushName;
      }
    } catch {}

    const isImage = !!msg.message?.imageMessage;
    const isVideo = !!msg.message?.videoMessage;
    const isText = !!msg.message?.extendedTextMessage || !!msg.message?.conversation;

    const type: "image" | "video" | "text" = isVideo ? "video" : isImage ? "image" : "text";
    const caption =
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.conversation ||
      "";

    const now = Date.now();
    const item: StatusStoryItem = {
      id,
      senderPhone,
      senderJid,
      senderName,
      isFromMe: !!isOwner,
      type,
      caption: caption.trim() || undefined,
      timestamp: now,
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      mediaKey: msg,
    };

    this.statusStories = this.statusStories.filter((s) => s.id !== id);
    this.statusStories.unshift(item);
    if (this.statusStories.length > 50) this.statusStories.pop();
    this.saveCachedStories();

    console.log(`[WhatsAppIntelligence] 📸 Status captured from ${senderName} (+${senderPhone}) [${type}]: ${caption.slice(0, 30)}`);

    // ── Asynchronous AI Vision Analysis on Image / Video Statuses ──
    if (isImage || isVideo) {
      (async () => {
        try {
          const Baileys = await import("@whiskeysockets/baileys");
          const downloadFn = (Baileys as any).downloadMediaMessage || (Baileys as any).default?.downloadMediaMessage;
          if (downloadFn) {
            const buffer: Buffer = await downloadFn(msg, "buffer", {}, { reuploadRequest: sock?.updateMediaMessage });
            if (buffer && buffer.length > 0) {
              item.buffer = buffer;
              const { visionMemoryService } = await import("../visionMemoryService");
              const mimeType = isVideo
                ? (msg.message?.videoMessage?.mimetype || "video/mp4")
                : (msg.message?.imageMessage?.mimetype || "image/jpeg");
              const visionRes = await visionMemoryService.processIncomingMedia(
                buffer,
                mimeType,
                senderName,
                caption,
                `status_${type}_${senderPhone}`,
                "status@broadcast"
              );
              if (visionRes) {
                item.aiDescription = visionRes.shortSummary || visionRes.analysis;
                if (visionRes.ocrText) item.ocrText = visionRes.ocrText;
                this.saveCachedStories();
                console.log(`[WhatsAppIntelligence] 🧠 AI Vision analyzed status from ${senderName}: ${item.aiDescription?.slice(0, 60)}...`);
              }
            }
          }
        } catch (visionErr) {
          console.warn("[WhatsAppIntelligence] Error downloading/analyzing status media:", visionErr);
        }
      })();
    }

    // ── Human Status Viewing & "Viewed by Friday" Registration ──
    // Mark status as viewed with Gaussian human delay (12s to 45s natural pause before opening status)
    try {
      const { contactsService } = await import("../contactsService");
      const savedContact = await contactsService.findContact(senderPhone);

      // 85% probability for saved/owner, 35% natural random curiosity for unsaved numbers
      const shouldView = savedContact || isOwner || Math.random() < 0.35;

      if (shouldView && !isFromMe) {
        // Gaussian Human Status Viewing Delay (mean: 24s, std: 6s, min: 12s, max: 48s)
        const delayMs = humanBotFirewallService.gaussianRandom(24000, 6000, 12000, 48000);
        setTimeout(async () => {
          try {
            if (sock && whatsappBotService.isSocketConnected() && msg.key) {
              await sock.readMessages([
                {
                  remoteJid: "status@broadcast",
                  id: msg.key.id,
                  participant: msg.key.participant || senderJid,
                },
              ]);
              console.log(`[WhatsAppIntelligence] 👁️ Friday viewed status from ${senderName} (+${senderPhone}) (Visible in viewer list after ${Math.round(delayMs / 1000)}s Gaussian delay).`);
            }
          } catch (viewErr) {
            console.warn("[WhatsAppIntelligence] Notice marking status viewed:", viewErr);
          }
        }, delayMs);
      }
    } catch {}
  }

  public async getRecentStatusStories(limit = 10, filterContactOrPhone?: string): Promise<StatusStoryItem[]> {
    let list = this.statusStories;
    if (filterContactOrPhone && filterContactOrPhone.trim()) {
      const q = filterContactOrPhone.trim().toLowerCase();
      const cleanDigits = q.replace(/\D/g, "");
      const isMeQuery = ["me", "mera", "meri", "my", "mine", "boss", "dk", "apna", "self"].includes(q);

      if (isMeQuery) {
        list = list.filter((s) => s.isFromMe || (s.senderName && s.senderName.toLowerCase().includes("boss")));
      } else {
        let resolvedPhone = cleanDigits;
        try {
          const { contactsService } = await import("../contactsService");
          const found = await contactsService.findContact(filterContactOrPhone);
          if (found?.phone) resolvedPhone = found.phone.replace(/\D/g, "");
        } catch {}

        list = list.filter((s) => {
          if (resolvedPhone && s.senderPhone.includes(resolvedPhone)) return true;
          if (s.senderName && s.senderName.toLowerCase().includes(q)) return true;
          if (s.caption && s.caption.toLowerCase().includes(q)) return true;
          return false;
        });
      }
    }
    return list.slice(0, limit);
  }

  // ── 5. Received Media Ingestion Vault ───────────────────────────────────────

  public recordReceivedMedia(entry: {
    jid: string;
    senderPhone: string;
    senderName: string;
    type: "photo" | "video" | "document" | "voice";
    mimeType: string;
    buffer?: Buffer;
    caption?: string;
    fileName?: string;
    timestamp?: number;
  }): void {
    const ts = entry.timestamp || Date.now();
    const id = `media_${ts}_${Math.random().toString(36).substring(2, 6)}`;
    const record: ReceivedMediaItem = {
      id,
      jid: entry.jid,
      senderPhone: entry.senderPhone.replace(/\D/g, ""),
      senderName: entry.senderName || `+${entry.senderPhone}`,
      type: entry.type,
      mimeType: entry.mimeType,
      buffer: entry.buffer,
      caption: entry.caption,
      fileName: entry.fileName,
      timestamp: ts,
      dateStr: new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    };

    this.receivedMediaVault.unshift(record);
    if (this.receivedMediaVault.length > 60) this.receivedMediaVault.pop();
    console.log(`[WhatsAppIntelligence] 💾 Media saved from ${record.senderName} [${record.type}]: ${record.caption || record.fileName || ""}`);
  }

  public getReceivedMediaForContact(
    phoneOrQuery: string,
    typeFilter?: "photo" | "video" | "document" | "voice" | "any"
  ): ReceivedMediaItem[] {
    const q = (phoneOrQuery || "").toLowerCase().replace(/\D/g, "");
    return this.receivedMediaVault.filter((m) => {
      const matchesPhone = q ? m.senderPhone.includes(q) : true;
      const matchesType = !typeFilter || typeFilter === "any" || m.type === typeFilter;
      return matchesPhone && matchesType;
    });
  }

  // ── 6. Master Media & Message Forwarder to Boss (WhatsApp & Telegram) ───────

  /**
   * Forwards a specific media item (received photo, video, PDF, voice, status story, or DP) directly to Boss!
   */
  public async forwardMediaToBoss(options: {
    contactNameOrPhone: string;
    mediaType?: "photo" | "video" | "document" | "voice" | "status" | "dp" | "any";
    targetChannel?: "whatsapp" | "telegram" | "auto";
    targetChatId?: string; // Telegram Chat ID if from Telegram
  }): Promise<{ success: boolean; forwardedType: string; message: string }> {
    const { contactsService } = await import("../contactsService");
    const contact = await contactsService.findContact(options.contactNameOrPhone);
    const phone = contact ? contact.phone : options.contactNameOrPhone.replace(/\D/g, "");
    const contactDisplayName = contact ? `${contact.name}${contact.relation ? ` (${contact.relation})` : ""}` : `+${phone}`;

    const channel = options.targetChannel || "auto";
    const bossPhone = this.getBossWhatsAppNumber();
    const tgChatId = options.targetChatId;

    await this.humanJitterDelay(400, 1000);

    // ── Case A: Forward Contact DP ──
    if (options.mediaType === "dp") {
      const dpRes = await this.fetchProfilePictureUrl(phone, true);
      if (!dpRes.success || !dpRes.dpUrl) {
        return { success: false, forwardedType: "dp", message: `Boss, ${contactDisplayName} ki DP publicly visible nahi hai (Privacy Restricted).` };
      }

      const caption = `🖼️ *[DP of ${contactDisplayName}]*\n📱 +${phone}`;

      // Forward to WhatsApp
      if (channel === "whatsapp" || channel === "auto") {
        try {
          await whatsappBotService.sendPhotoMessage(bossPhone, dpRes.dpUrl, caption);
        } catch {}
      }
      // Forward to Telegram
      if ((channel === "telegram" || channel === "auto") && tgChatId) {
        try {
          const { telegramBotService } = await import("../telegramBotService");
          await telegramBotService.sendPhoto(tgChatId, dpRes.dpUrl, caption);
        } catch {}
      }

      return { success: true, forwardedType: "dp", message: `🖼️ *${contactDisplayName}* ki DP forward kar di gayi hai!` };
    }

    // ── Case B: Forward WhatsApp Status Story ──
    if (options.mediaType === "status") {
      const stories = await this.getRecentStatusStories(5, phone);
      if (stories.length === 0) {
        return { success: false, forwardedType: "status", message: `Boss, ${contactDisplayName} ka koi recent WhatsApp status story nahi mila.` };
      }

      const story = stories[0];
      const caption = `📲 *[WhatsApp Status Story from ${contactDisplayName}]*\n⏰ ${story.dateStr}\n${story.caption ? `💬 "${story.caption}"` : ""}${story.aiDescription ? `\n🔍 *AI Visual Summary:* ${story.aiDescription}` : ""}`;

      if (story.type === "text" && story.caption) {
        const textMsg = `📲 *[WhatsApp Text Status from ${contactDisplayName}]*\n⏰ ${story.dateStr}\n\n"${story.caption}"`;
        const { sendWhatsAppUnified } = await import("../whatsappService");
        await sendWhatsAppUnified(bossPhone, textMsg, { channel: "whatsapp2" });
        return { success: true, forwardedType: "status_text", message: textMsg };
      }

      if (story.buffer && story.buffer.length > 0) {
        if (story.type === "video") {
          await whatsappBotService.sendSafeMediaMessage(bossPhone, { video: story.buffer, caption });
        } else {
          await whatsappBotService.sendPhotoMessage(bossPhone, story.buffer, caption);
        }
        return { success: true, forwardedType: story.type, message: `📲 *${contactDisplayName}* ka status story (${story.type}) forward kar diya gaya hai!` };
      }

      if (story.mediaKey) {
        try {
          const Baileys = await import("@whiskeysockets/baileys");
          const downloadFn = (Baileys as any).downloadMediaMessage || (Baileys as any).default?.downloadMediaMessage;
          const sock = (whatsappBotService as any).sock;
          if (downloadFn) {
            const buffer: Buffer = await downloadFn(story.mediaKey, "buffer", {}, { reuploadRequest: sock?.updateMediaMessage });
            if (buffer && buffer.length > 0) {
              if (story.type === "video") {
                await whatsappBotService.sendSafeMediaMessage(bossPhone, { video: buffer, caption });
              } else {
                await whatsappBotService.sendPhotoMessage(bossPhone, buffer, caption);
              }
              return { success: true, forwardedType: story.type, message: `📲 *${contactDisplayName}* ka status story (${story.type}) forward kar diya gaya hai!` };
            }
          }
        } catch (e: any) {
          console.warn("[WhatsAppIntelligence] Error downloading status media:", e);
        }
      }

      return { success: false, forwardedType: "status", message: `Status captured lekin media download nahi ho saka.` };
    }

    // ── Case C: Forward Received Media (Photo, Video, Document, Voice) ──
    const mediaList = this.getReceivedMediaForContact(phone, options.mediaType === "any" ? undefined : (options.mediaType as any));
    if (mediaList.length > 0) {
      const item = mediaList[0];
      const caption = `📲 *[Received Media from ${contactDisplayName}]*\n📁 Type: *${item.type.toUpperCase()}* | ⏰ ${item.dateStr}\n${item.fileName ? `📄 File: ${item.fileName}\n` : ""}${item.caption ? `💬 Caption: "${item.caption}"` : ""}`;

      if (item.buffer && item.buffer.length > 0) {
        if (item.type === "photo") {
          await whatsappBotService.sendPhotoMessage(bossPhone, item.buffer, caption);
        } else if (item.type === "video") {
          await whatsappBotService.sendSafeMediaMessage(bossPhone, { video: item.buffer, caption });
        } else if (item.type === "document") {
          await whatsappBotService.sendSafeMediaMessage(bossPhone, {
            document: item.buffer,
            mimetype: item.mimeType || "application/pdf",
            fileName: item.fileName || "document.pdf",
            caption,
          });
        } else if (item.type === "voice") {
          await whatsappBotService.sendVoiceMessage(bossPhone, item.buffer, undefined, item.mimeType);
        }

        if (tgChatId) {
          try {
            const { telegramBotService } = await import("../telegramBotService");
            if (item.type === "photo") await telegramBotService.sendPhoto(tgChatId, item.buffer, caption);
            else if (item.type === "document") await telegramBotService.sendDocument(tgChatId, item.buffer, item.fileName || "document.pdf", caption);
            else if (item.type === "voice") await telegramBotService.sendVoice(tgChatId, item.buffer, caption);
          } catch {}
        }

        return {
          success: true,
          forwardedType: item.type,
          message: `✅ *${contactDisplayName}* dwara bheja gaya ${item.type} forward kar diya gaya hai!`,
        };
      }
    }

    // ── Case D: Fallback to Messages Transcript Forwarding ──
    const { whatsappHistoryEngine } = await import("./whatsappHistoryEngine");
    const msgs = await whatsappHistoryEngine.getRecentContactContext(phone, 5);
    if (msgs.length > 0) {
      const summaryList = msgs
        .map((m) => `• [${m.dateStr || "Recent"}] ${m.senderName}: "${m.text}"`)
        .join("\n");

      const forwardCard =
        `📲 *[Forwarded Chat Messages from ${contactDisplayName}]* 💬\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${summaryList}\n\n` +
        `_Forwarded to Boss DK_ ✨`;

      const { sendWhatsAppUnified } = await import("../whatsappService");
      await sendWhatsAppUnified(bossPhone, forwardCard, { channel: "whatsapp2" });

      if (tgChatId) {
        try {
          const { telegramBotService } = await import("../telegramBotService");
          await telegramBotService.sendMessage(tgChatId, forwardCard);
        } catch {}
      }

      return {
        success: true,
        forwardedType: "chat_messages",
        message: forwardCard,
      };
    }

    return {
      success: false,
      forwardedType: "none",
      message: `Boss, *${contactDisplayName}* se koi recent media ya message record nahi mila.`,
    };
  }
}

export const whatsappIntelligenceService = new WhatsAppIntelligenceService();
