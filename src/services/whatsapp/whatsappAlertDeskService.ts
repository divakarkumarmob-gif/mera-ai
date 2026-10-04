import * as fs from "fs";
import * as path from "path";
import * as BaileysModule from "@whiskeysockets/baileys";
import { QuotedMessageContext } from "./whatsappTypes";

const baileys: any = BaileysModule;

export interface ForwardMediaOptions {
  senderName: string;
  senderPhone: string;
  sourceName: string;
  userNote?: string;
  timestamp?: number;
  rawMessage?: any; // Native Baileys WAMessage { key, message } for zero-download forward
  mediaBuffer?: Buffer;
  mimeType?: string;
  mediaType?: "photo" | "video" | "document" | "voice" | "audio";
  fileName?: string;
  contextDescription?: string;
}

export interface OutsiderMessageDetails {
  senderName: string;
  senderPhone: string;
  text: string;
  timestamp?: number;
  isGroup?: boolean;
  groupName?: string;
}

export interface RecordedRawMedia {
  rawMessage: any;
  mediaType: "photo" | "video" | "document" | "voice" | "audio";
  caption?: string;
  fileName?: string;
  timestamp: number;
}

class WhatsAppAlertDeskService {
  private deskGroupJid: string | null = null;
  private configFilePath = path.join(process.cwd(), "data", "friday_desk_group.json");
  private isInitializing = false;
  private botSentMessageIds: Set<string> = new Set();
  /** Recent raw WAMessages per chat for native instant zero-download forwarding */
  private recentRawMediaPerChat = new Map<string, RecordedRawMedia[]>();

  constructor() {
    this.loadPersistedDeskJid();
  }

  private loadPersistedDeskJid(): void {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.deskGroupJid) {
          this.deskGroupJid = parsed.deskGroupJid;
          console.log(`[WhatsAppAlertDesk] Loaded saved Alert Desk Group JID: ${this.deskGroupJid}`);
        }
      }
    } catch (e) {
      console.warn("[WhatsAppAlertDesk] Error loading saved Desk JID:", e);
    }
  }

  private savePersistedDeskJid(jid: string, name: string): void {
    try {
      const dataDir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        this.configFilePath,
        JSON.stringify(
          {
            deskGroupJid: jid,
            deskGroupName: name,
            updatedAt: Date.now(),
            ownerPhone: this.getOwnerPhone(),
          },
          null,
          2
        ),
        "utf-8"
      );
      this.deskGroupJid = jid;
      console.log(`[WhatsAppAlertDesk] Persisted Alert Desk Group JID: ${jid} (${name})`);
    } catch (e) {
      console.warn("[WhatsAppAlertDesk] Error saving Desk JID:", e);
    }
  }

  public getOwnerPhone(): string {
    return (
      process.env.WHATSAPP_OWNER_PHONE ||
      process.env.BOSS_WHATSAPP_PHONE ||
      process.env.WHATSAPP_OWNER_NUMBER ||
      process.env.WHATSAPP_BOSS_PHONE ||
      process.env.OWNER_WHATSAPP_NUMBER ||
      process.env.BOSS_WHATSAPP_NUMBER ||
      process.env.OWNER_PHONE ||
      process.env.BOSS_PHONE ||
      ""
    ).replace(/\D/g, "");
  }

  public isDeskGroup(jid?: string | null): boolean {
    if (!jid) return false;
    return !!this.deskGroupJid && (this.deskGroupJid === jid || this.deskGroupJid.split("@")[0] === jid.split("@")[0]);
  }

  public registerBotSentId(id?: string | null): void {
    if (id) this.botSentMessageIds.add(id);
  }

  public isBotSentMessage(id?: string | null): boolean {
    return id ? this.botSentMessageIds.has(id) : false;
  }

  /**
   * Records raw WAMessage in memory so that subsequent "ye photo boss ko bhej dena" commands
   * can natively forward the exact WhatsApp server media reference with ZERO downloads.
   */
  public recordRawMedia(
    chatId: string,
    rawMessage: any,
    mediaType: "photo" | "video" | "document" | "voice" | "audio",
    caption?: string,
    fileName?: string
  ): void {
    if (!chatId || !rawMessage?.message) return;
    const list = this.recentRawMediaPerChat.get(chatId) || [];
    list.unshift({
      rawMessage,
      mediaType,
      caption,
      fileName,
      timestamp: Date.now(),
    });
    if (list.length > 6) list.pop();
    this.recentRawMediaPerChat.set(chatId, list);
  }

  /**
   * Retrieves the most recent raw WAMessage for a chat (valid within 1 hour).
   */
  public getLatestRawMedia(chatId: string): RecordedRawMedia | null {
    const list = this.recentRawMediaPerChat.get(chatId);
    if (!list || list.length === 0) return null;
    const oneHour = 60 * 60 * 1000;
    const top = list[0];
    if (Date.now() - top.timestamp < oneHour) {
      return top;
    }
    return null;
  }

  /**
   * Discovers or creates the dedicated Owner & Friday Alert Desk Group.
   */
  public async getOrCreateAlertDeskGroup(sock: any): Promise<string | null> {
    if (this.deskGroupJid) return this.deskGroupJid;

    // 1. Env variable override
    const envJid = process.env.BOSS_ALERT_GROUP_JID || process.env.FRIDAY_DESK_GROUP_JID;
    if (envJid) {
      this.deskGroupJid = envJid.trim();
      return this.deskGroupJid;
    }

    if (!sock || this.isInitializing) return this.deskGroupJid;
    this.isInitializing = true;

    try {
      const ownerPhone = this.getOwnerPhone();
      const ownerJid = ownerPhone ? `${ownerPhone}@s.whatsapp.net` : null;

      // 2. Discover existing group via Baileys participating groups
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups as Record<string, any>)) {
          const subject = (meta?.subject || "").trim();
          if (
            /^(friday\s*(desk|alerts?|notify|inbox)|boss\s*desk|owner\s*desk|friday\s*&\s*dk|dk\s*&\s*friday)/i.test(subject) ||
            /\b(?:friday\s*desk|boss\s*desk)\b/i.test(subject)
          ) {
            console.log(`[WhatsAppAlertDesk] Discovered existing Alert Desk group: "${subject}" (${jid})`);
            this.savePersistedDeskJid(jid, subject);
            this.isInitializing = false;
            return jid;
          }
        }
      } catch (fetchErr) {
        console.warn("[WhatsAppAlertDesk] Error fetching participating groups:", fetchErr);
      }

      // 3. Auto-create Group with Owner if not found
      if (ownerJid) {
        try {
          console.log(`[WhatsAppAlertDesk] Creating new Alert Desk group for Owner (${ownerJid})...`);
          const groupTitle = "Friday Desk 🛡️";
          const newGroup = await sock.groupCreate(groupTitle, [ownerJid]);
          const groupJid = newGroup?.id || (newGroup as any)?.gid;

          if (groupJid) {
            this.savePersistedDeskJid(groupJid, groupTitle);

            // Send initial onboarding greeting
            const welcomeText =
              `🚀 *Friday Desk Activated!* 🛡️\n\n` +
              `Boss, yeh hamara dedicated Alert & Forwarding Desk hai.\n\n` +
              `📌 *Features & Workflow:*\n` +
              `• *Outsider Messages:* Koi bhi third-party/unknown user mujhe personal chat me message karega, uska alert yahan aayega.\n` +
              `• *Native Forwarding:* Agar koi group ya chat me bolega "ye photo/video/doc DK ko bhej do", to wo actual media full stamp (sender, time, source) ke saath instant native-forward hoga (Zero Download delay)!\n` +
              `• *Clean 1v1 Chat:* Aapki personal chat bilkul clean aur clutter-free rahegi.\n\n` +
              `_Main hamesha ready hoon, Boss!_ ✨`;

            const sent = await sock.sendMessage(groupJid, { text: welcomeText });
            if (sent?.key?.id) this.registerBotSentId(sent.key.id);

            this.isInitializing = false;
            return groupJid;
          }
        } catch (createErr) {
          console.error("[WhatsAppAlertDesk] Failed to auto-create Alert Desk group:", createErr);
        }
      }
    } finally {
      this.isInitializing = false;
    }

    return this.deskGroupJid;
  }

  /**
   * Relays 1-on-1 messages from outsiders/contacts into the Alert Desk Group.
   */
  public async relayOutsiderMessageToDesk(
    sock: any,
    details: OutsiderMessageDetails
  ): Promise<boolean> {
    try {
      const cleanSender = (details.senderPhone || "").replace(/\D/g, "");
      const ownerPhone = this.getOwnerPhone();

      if (!cleanSender || cleanSender === ownerPhone || cleanSender.slice(-10) === ownerPhone.slice(-10)) {
        return false;
      }

      const deskJid = await this.getOrCreateAlertDeskGroup(sock);
      const targetJid = deskJid || (ownerPhone ? `${ownerPhone}@s.whatsapp.net` : null);

      if (!targetJid || !sock) return false;

      const dateStr = new Date(details.timestamp || Date.now()).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      const senderLabel = details.senderName && !details.senderName.startsWith("+")
        ? `${details.senderName} (+${cleanSender})`
        : `+${cleanSender}`;

      const sourceLabel = details.isGroup ? details.groupName || "WhatsApp Group" : "Direct 1-on-1 Chat";

      const alertCard =
        `📩 *[New Message Alert]*\n` +
        `👤 *From:* ${senderLabel}\n` +
        `👥 *Source:* ${sourceLabel}\n` +
        `⏰ *Time:* ${dateStr}\n` +
        `💬 *Message:*\n"${(details.text || "").trim()}"`;

      const sent = await sock.sendMessage(targetJid, { text: alertCard });
      if (sent?.key?.id) this.registerBotSentId(sent.key.id);

      console.log(`[WhatsAppAlertDesk] 📩 Relayed outsider message from ${senderLabel} to ${deskJid ? "Alert Desk Group" : "Boss 1v1"}.`);
      return true;
    } catch (err) {
      console.warn("[WhatsAppAlertDesk] Failed to relay outsider message:", err);
      return false;
    }
  }

  /**
   * Forwards media to the Alert Desk Group with a full metadata STAMP.
   * PRIORITY 1: Native WhatsApp Forward (Zero-Download, Instant WhatsApp Server-to-Server Routing).
   * PRIORITY 2: Buffer Fallback (if raw WAMessage reference is not present).
   */
  public async forwardMediaToDesk(
    sock: any,
    options: ForwardMediaOptions
  ): Promise<{ success: boolean; deskGroupJid?: string; message: string }> {
    try {
      const cleanSender = (options.senderPhone || "").replace(/\D/g, "");
      const ownerPhone = this.getOwnerPhone();
      const deskJid = await this.getOrCreateAlertDeskGroup(sock);
      const targetJid = deskJid || (ownerPhone ? `${ownerPhone}@s.whatsapp.net` : null);

      if (!targetJid || !sock) {
        return { success: false, message: "Alert Desk Group / WhatsApp socket not available." };
      }

      const dateStr = new Date(options.timestamp || Date.now()).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      const senderLabel = options.senderName && !options.senderName.startsWith("+")
        ? `${options.senderName} (+${cleanSender})`
        : `+${cleanSender}`;

      const noteText = options.userNote ? `"${options.userNote.trim()}"` : `_"Forward this media to Boss"_\n`;
      const contextLine = options.contextDescription ? `\n📎 *Context / Item:* ${options.contextDescription}` : "";

      const stamp =
        `📩 *[Forwarded Media for Boss DK]*\n\n` +
        `👤 *Sender:* ${senderLabel}\n` +
        `👥 *Source:* ${options.sourceName}\n` +
        `⏰ *Time:* ${dateStr}\n` +
        `💬 *Note:* ${noteText}${contextLine}\n\n` +
        `_Forwarded by Friday Assistant_`;

      const mType = options.mediaType || "photo";

      // ── METHOD 1: Native WhatsApp Forward (ZERO DOWNLOAD / ZERO BUFFER / INSTANT) ──
      if (options.rawMessage && options.rawMessage.message) {
        try {
          const msgToForward = JSON.parse(JSON.stringify(options.rawMessage));
          const innerMedia =
            msgToForward.message?.imageMessage ||
            msgToForward.message?.videoMessage ||
            msgToForward.message?.documentMessage;

          // Inject stamp as caption directly on media
          if (innerMedia) {
            innerMedia.caption = stamp;
          }

          const sent = await sock.sendMessage(targetJid, {
            forward: msgToForward,
            force: true,
          });

          if (sent?.key?.id) this.registerBotSentId(sent.key.id);

          // For audio messages where protocol has no caption field, send stamp right after
          if (msgToForward.message?.audioMessage) {
            const textSent = await sock.sendMessage(targetJid, { text: stamp });
            if (textSent?.key?.id) this.registerBotSentId(textSent.key.id);
          }

          console.log(`[WhatsAppAlertDesk] ⚡ Natively forwarded ${mType} (Zero-Download) with stamp to ${targetJid}`);
          return { success: true, deskGroupJid: targetJid, message: `Natively forwarded ${mType} to Friday Desk` };
        } catch (fwdErr) {
          console.warn("[WhatsAppAlertDesk] Native forward error, trying buffer fallback:", fwdErr);
        }
      }

      // ── METHOD 2: Buffer Fallback (If raw message is not present or failed) ──
      if (options.mediaBuffer && options.mediaBuffer.length > 0) {
        let sent: any = null;
        if (mType === "photo") {
          sent = await sock.sendMessage(targetJid, {
            image: options.mediaBuffer,
            caption: stamp,
          });
        } else if (mType === "video") {
          sent = await sock.sendMessage(targetJid, {
            video: options.mediaBuffer,
            caption: stamp,
          });
        } else if (mType === "document") {
          sent = await sock.sendMessage(targetJid, {
            document: options.mediaBuffer,
            mimetype: options.mimeType || "application/pdf",
            fileName: options.fileName || "forwarded_document.pdf",
            caption: stamp,
          });
        } else if (mType === "voice" || mType === "audio") {
          sent = await sock.sendMessage(targetJid, {
            audio: options.mediaBuffer,
            mimetype: options.mimeType || "audio/mp4",
            ptt: false,
          });
          const textMsg = await sock.sendMessage(targetJid, { text: stamp });
          if (textMsg?.key?.id) this.registerBotSentId(textMsg.key.id);
        }

        if (sent?.key?.id) this.registerBotSentId(sent.key.id);
        console.log(`[WhatsAppAlertDesk] ✅ Forwarded ${mType} via buffer with stamp to ${targetJid}`);
        return { success: true, deskGroupJid: targetJid, message: `Forwarded ${mType} to Friday Desk` };
      }

      // ── METHOD 3: Text Note Fallback ──
      const fallbackCard =
        `📩 *[Forward Request for Boss DK]*\n\n` +
        `👤 *Sender:* ${senderLabel}\n` +
        `👥 *Source:* ${options.sourceName}\n` +
        `⏰ *Time:* ${dateStr}\n` +
        `💬 *Note:* ${noteText}${contextLine}\n\n` +
        `_Forwarded by Friday Assistant_`;

      const sent = await sock.sendMessage(targetJid, { text: fallbackCard });
      if (sent?.key?.id) this.registerBotSentId(sent.key.id);

      return { success: true, deskGroupJid: targetJid, message: "Forwarded note to Friday Desk" };
    } catch (err: any) {
      console.error("[WhatsAppAlertDesk] Error forwarding media to desk:", err);
      return { success: false, message: err?.message || "Failed to forward media" };
    }
  }

  /**
   * Intelligently resolves any media for a given chat:
   * 1. Quoted Message raw structure (Zero Download)
   * 2. Recent Raw Message from chat history (Zero Download)
   * 3. Vision Memory cached buffer fallback
   */
  public async resolveMediaForForward(
    replyJid: string,
    quotedMessage?: QuotedMessageContext | null,
    sock?: any
  ): Promise<{
    rawMessage?: any;
    buffer?: Buffer;
    mimeType?: string;
    mediaType?: "photo" | "video" | "document" | "voice";
    fileName?: string;
    caption?: string;
    summary?: string;
  } | null> {
    // 1. Quoted Message raw reference (ZERO DOWNLOAD!)
    if (quotedMessage?.rawQuotedMessage) {
      const q = quotedMessage.rawQuotedMessage;
      const isPhoto = !!q.imageMessage;
      const isVideo = !!q.videoMessage;
      const isDoc = !!q.documentMessage;
      const isAudio = !!q.audioMessage;

      if (isPhoto || isVideo || isDoc || isAudio) {
        const mediaType = isPhoto ? "photo" : isVideo ? "video" : isDoc ? "document" : "voice";
        const fileName = q.documentMessage?.fileName;
        const caption = q.imageMessage?.caption || q.videoMessage?.caption || q.documentMessage?.caption;
        const mimeType =
          q.imageMessage?.mimetype ||
          q.videoMessage?.mimetype ||
          q.documentMessage?.mimetype ||
          q.audioMessage?.mimetype;

        return {
          rawMessage: {
            key: { id: quotedMessage.stanzaId, remoteJid: replyJid },
            message: q,
          },
          mediaType,
          fileName,
          caption,
          mimeType,
        };
      }
    }

    // 2. Recent Raw Message in this chat (ZERO DOWNLOAD!)
    const recentRaw = this.getLatestRawMedia(replyJid);
    if (recentRaw && recentRaw.rawMessage) {
      return {
        rawMessage: recentRaw.rawMessage,
        mediaType: recentRaw.mediaType as any,
        fileName: recentRaw.fileName,
        caption: recentRaw.caption,
      };
    }

    // 3. Vision Memory Service active cached buffer fallback
    try {
      const { visionMemoryService } = await import("../visionMemoryService");
      const cached = visionMemoryService.getChatMediaContext(replyJid);
      if (cached?.buffer && cached.buffer.length > 0) {
        const isPhoto = cached.mimeType.startsWith("image/");
        const isVideo = cached.mimeType.startsWith("video/");
        const isDoc = cached.mimeType.includes("pdf") || cached.mimeType.includes("document") || !isPhoto && !isVideo;
        const mediaType = isPhoto ? "photo" : isVideo ? "video" : isDoc ? "document" : "voice";

        return {
          buffer: cached.buffer,
          mimeType: cached.mimeType,
          mediaType,
          fileName: cached.fileName,
          caption: cached.caption,
          summary: cached.shortSummary || cached.analysis,
        };
      }
    } catch {}

    // 4. WhatsApp Intelligence Vault buffer fallback
    try {
      const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
      const senderPhone = replyJid.replace(/@.*$/, "").replace(/\D/g, "");
      const items = whatsappIntelligenceService.getReceivedMediaForContact(senderPhone);
      if (items.length > 0 && items[0].buffer) {
        const it = items[0];
        return {
          buffer: it.buffer,
          mimeType: it.mimeType,
          mediaType: it.type,
          fileName: it.fileName,
          caption: it.caption,
        };
      }
    } catch {}

    return null;
  }
}

export const whatsappAlertDeskService = new WhatsAppAlertDeskService();
