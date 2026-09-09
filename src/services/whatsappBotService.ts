import * as BaileysModule from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { useFirestoreAuthState } from "./whatsappAuthState";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { dailyUpdateService } from "./dailyUpdateService";
import { humanBotFirewallService } from "./humanBotFirewallService";

// Sub-engine imports
import type { QuotedMessageContext, IncomingMessage, WhatsAppStatus } from "./whatsapp/whatsappTypes";
import { whatsappHistoryEngine } from "./whatsapp/whatsappHistoryEngine";
import { whatsappGirlfriendEngine } from "./whatsapp/whatsappGirlfriendEngine";
import { whatsappBossAiEngine } from "./whatsapp/whatsappBossAiEngine";
import { whatsappAutoReplyEngine } from "./whatsapp/whatsappAutoReplyEngine";
import { whatsappMediaRouter } from "./whatsapp/whatsappMediaRouter";

export type { QuotedMessageContext, IncomingMessage, WhatsAppStatus };

// Resolve Baileys exports safely across CJS/ESM bundling
const baileys: any = BaileysModule;
const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket || baileys;
const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
const Browsers = baileys.Browsers || baileys.default?.Browsers;

type WASocket = any;

const sessionMetaDoc = () => db.collection("whatsapp_auth").doc("session").collection("meta").doc("phone_meta");

class WhatsAppBotService {
  private sock: WASocket | null = null;
  private isConnected = false;
  private pairingCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private dedicatedPhone: string | null = null;
  private clearAuthFn: (() => Promise<void>) | null = null;
  private reconnectTimer: any = null;
  private keepAliveTimer: any = null;
  private scheduledMessageTimer: any = null;
  private pairingCodeMode = false;

  private groupNameCache: Map<string, string> = new Map();
  private messageCallback: ((msg: IncomingMessage) => void) | null = null;
  private callTriggerCallback: ((data: { callerName: string; isOwner: boolean; callId: string }) => void) | null = null;
  private autoReplyEnabled = true;
  private baileysEnabled = true;
  private botSentMessageIds: Set<string> = new Set();
  private pendingVoiceDebounce: Map<
    string,
    {
      timer: NodeJS.Timeout;
      senderName: string;
      senderPhone: string;
      transcribed: string;
      replyJid: string;
      messageKey: any;
      quotedMessage?: QuotedMessageContext | null;
    }
  > = new Map();

  constructor() {
    this.restorePhoneFromFirestore().then(() => {
      this.initSocket().catch((err) => {
        console.log("[WhatsAppBot] Init standby:", err?.message || err);
      });
    });
  }

  // ── Firestore Phone Persistence ───────────────────────────────────────────

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

  // ── Keep-Alive & Schedulers ───────────────────────────────────────────────

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      if (!this.sock || !this.isConnected) return;
      try {
        if (whatsappGirlfriendEngine.hasActiveGirlfriendOnline()) {
          await this.sock.sendPresenceUpdate("available");
        } else {
          await this.sock.sendPresenceUpdate("unavailable");
        }
      } catch (e) {
        console.warn("[WhatsAppBot] Keep-alive ping failed, triggering reconnect:", (e as any)?.message);
        this.isConnected = false;
        this.scheduleReconnect(3000);
      }
    }, 4 * 60 * 1000);
    console.log("[WhatsAppBot] Keep-alive timer started (Offline background / Girlfriend dynamic mode).");
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

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

  // ── Callbacks & History Delegation ────────────────────────────────────────

  public setMessageCallback(cb: (msg: IncomingMessage) => void) {
    this.messageCallback = cb;
  }

  public setCallTriggerCallback(cb: (data: { callerName: string; isOwner: boolean; callId: string }) => void) {
    this.callTriggerCallback = cb;
    whatsappBossAiEngine.setCallTriggerCallback(cb);
  }

  public recordIncomingMessage(msg: IncomingMessage) {
    whatsappHistoryEngine.recordIncomingMessage(msg);
  }

  public async getMessages(params: {
    messageType?: "personal" | "group" | "all";
    senderName?: string;
    groupName?: string;
    dateFilter?: string;
    limit?: number;
  } = {}): Promise<IncomingMessage[]> {
    return whatsappHistoryEngine.getMessages(params);
  }

  public async searchWhatsAppHistory(
    query: string,
    options?: { contact?: string; daysBack?: number; limit?: number }
  ) {
    return whatsappHistoryEngine.searchWhatsAppHistory(query, options);
  }

  public async getConversationSummaryAndHistory(
    targetQuery?: string,
    limit = 30,
    daysBack = 7
  ) {
    return whatsappHistoryEngine.getConversationSummaryAndHistory(targetQuery, limit, daysBack);
  }

  // ── Girlfriend Mode Delegation ────────────────────────────────────────────

  public isGirlfriendModeActive(jid: string): boolean {
    return whatsappGirlfriendEngine.isGirlfriendModeActive(jid);
  }

  public parseGirlfriendDuration(text: string): number {
    return whatsappGirlfriendEngine.parseGirlfriendDuration(text);
  }

  public async startGirlfriendMode(jid: string, rawText: string, messageKey: any, senderName: string): Promise<void> {
    return whatsappGirlfriendEngine.startGirlfriendMode(
      jid,
      rawText,
      messageKey,
      senderName,
      (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
      this.sock
    );
  }

  public async stopGirlfriendMode(jid: string, messageKey: any, isManual: boolean = true): Promise<void> {
    return whatsappGirlfriendEngine.stopGirlfriendMode(
      jid,
      messageKey,
      isManual,
      (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
      this.sock
    );
  }

  public async handleGirlfriendChatMessage(
    jid: string,
    rawText: string,
    messageKey: any,
    isVoiceInput: boolean = false
  ): Promise<void> {
    return whatsappGirlfriendEngine.handleGirlfriendChatMessage(
      jid,
      rawText,
      messageKey,
      isVoiceInput,
      (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
      (j, b, k, m) => this.sendVoiceMessage(j, b, k, m),
      (j, img, cap, k) => this.sendPhotoMessage(j, img, cap, k),
      (j, gif, cap, k) => this.sendGifMessage(j, gif, cap, k),
      this.sock
    );
  }

  // ── Media & Swipe Delegation ──────────────────────────────────────────────

  public extractQuotedContext(msg: any): QuotedMessageContext | null {
    return whatsappMediaRouter.extractQuotedContext(msg);
  }

  public detectPhotoEditIntent(text: string) {
    return whatsappMediaRouter.detectPhotoEditIntent(text);
  }

  public async handleQuotedMediaSummary(
    replyJid: string,
    rawText: string,
    quotedMessage: QuotedMessageContext,
    messageKey: any
  ): Promise<boolean> {
    return whatsappMediaRouter.handleQuotedMediaSummary(
      replyJid,
      rawText,
      quotedMessage,
      messageKey,
      this.sock,
      (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
      (j, c, k, fb) => this.sendSafeMediaMessage(j, c, k, fb),
      (j, b, k, m) => this.sendVoiceMessage(j, b, k, m)
    );
  }

  // ── Limits Delegation ─────────────────────────────────────────────────────

  public async getContactReplyLimit(phone: string): Promise<number> {
    return whatsappAutoReplyEngine.getContactReplyLimit(phone);
  }

  public async setContactReplyLimit(contactNameOrPhone: string, newLimit: number) {
    return whatsappAutoReplyEngine.setContactReplyLimit(contactNameOrPhone, newLimit);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  // ── Baileys Message Listener ──────────────────────────────────────────────

  private setupMessageListener() {
    if (!this.sock) return;

    this.sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        try {
          const remoteJid: string = msg.key?.remoteJid || "";
          if (!remoteJid) continue;

          const text = this.extractMessageText(msg);
          if (!text) continue;

          const isGroup = remoteJid.endsWith("@g.us");
          const isFromMe = !!msg.key?.fromMe;
          const isBotSelfEcho = isFromMe && !!msg.key?.id && this.botSentMessageIds.has(msg.key.id);

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
            if (!whatsappGirlfriendEngine.isGirlfriendModeActive(remoteJid)) {
              whatsappHistoryEngine.saveToFirestore(outgoing).catch(() => {});
            }

            if (isBotSelfEcho) continue;
            if (!isGroup) continue;
          }

          const senderJid: string = isGroup
            ? (msg.key.participant || msg.key.participantAlt || remoteJid)
            : remoteJid;

          const isParticipantLid = senderJid.endsWith("@lid");
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

          let senderName = senderDisplayName;
          let isUnknownContact = !isFromMe && !isSenderOwner;
          if (isSenderOwner) {
            senderName = "DK (Boss)";
            isUnknownContact = false;
          } else if (senderContact && senderContact.id !== "temp") {
            senderName = senderContact.name;
            isUnknownContact = false;
          }

          const ts = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
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

          whatsappHistoryEngine.unshiftMessage(incoming);
          whatsappHistoryEngine.saveToFirestore(incoming).catch(() => {});

          if (text && text.trim().length > 5) {
            import("./humanComprehensionEngine")
              .then(({ humanComprehensionEngine }) => humanComprehensionEngine.autoDetectAndSaveLifeEvents(senderPhone, senderName, text))
              .catch(() => {});
          }

          // Contact Card auto-saving
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

          // Media Processing
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

                  if (isVoice && isFromOwner) {
                    try {
                      const { voiceBridgeService } = await import("./voiceBridgeService");
                      const transcribed = await voiceBridgeService.transcribeAudio(buffer, mimeType, fileName || "voice.ogg");
                      if (transcribed && transcribed.trim()) {
                        // Check if an existing voice debounce timer is running for this chat
                        const existingPending = this.pendingVoiceDebounce.get(replyJid);
                        let finalTranscribed = transcribed;
                        if (existingPending) {
                          clearTimeout(existingPending.timer);
                          finalTranscribed = `${existingPending.transcribed} ${transcribed}`;
                        }

                        // 5-second buffer: wait 5s to see if user sends follow-up text or requests transcription
                        const timer = setTimeout(async () => {
                          const pending = this.pendingVoiceDebounce.get(replyJid);
                          this.pendingVoiceDebounce.delete(replyJid);
                          if (!pending) return;

                          const wantsTranscriptNotice = /\b(transcript|transcribe|likh\s*ke|text|text\s*bhi|likho|transcript\s*\+\s*voice|voice\s*\+\s*transcript|dono)\b/i.test(pending.transcribed);
                          if (wantsTranscriptNotice) {
                            await this.sendHumanLikeMessage(pending.replyJid, `🎙️ *Aapki Aawaz (Transcription):*\n_"${pending.transcribed}"_`, "", pending.messageKey);
                          }

                          await this.handleOwnerWhatsAppMessage(
                            pending.senderName,
                            pending.senderPhone,
                            pending.transcribed,
                            pending.replyJid,
                            pending.messageKey,
                            pending.quotedMessage,
                            true
                          );
                        }, 5000);

                        this.pendingVoiceDebounce.set(replyJid, {
                          timer,
                          senderName,
                          senderPhone,
                          transcribed: finalTranscribed,
                          replyJid,
                          messageKey: msg.key,
                          quotedMessage,
                        });
                        continue;
                      }
                    } catch (sttErr) {
                      console.error("[WhatsAppBot] STT error on Boss voice note:", sttErr);
                    }
                  }

                  if (isPhoto) {
                    whatsappMediaRouter.recordChatPhoto(replyJid, buffer, mimeType);
                    const cap = (caption || "").trim();

                    const isSummaryRequested =
                      /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|analyse|photo\s*analyze|ocr|dekho|check|batao|kya\s*hai|padho|scan|explain)\b/i.test(cap) ||
                      cap.startsWith("@summary") ||
                      cap.startsWith("/summary") ||
                      cap.startsWith("@friday");

                    if (isSummaryRequested) {
                      await this.sendHumanLikeMessage(replyJid, "👁️ *Photo analyze & summarize ho rahi hai...* ⚡", "", msg.key);
                      const summaryRes = await visionMemoryService.generateMediaSummary(buffer, "image/jpeg", cap, undefined, replyJid);
                      await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                      continue;
                    }
                  }

                  if (isDoc) {
                    const cap = (caption || "").trim();
                    const isDocSummaryReq = isFromOwner || /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|padho|check|batao|kya\s*hai|explain)\b/i.test(cap) || cap.startsWith("@friday");
                    if (isDocSummaryReq) {
                      await this.sendHumanLikeMessage(replyJid, `📄 *Document / PDF (${fileName || "file"}) analyze & summarize ho raha hai...* ⚡`, "", msg.key);
                      const summaryRes = await visionMemoryService.generateMediaSummary(buffer, mimeType, cap, fileName, replyJid);
                      await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                      continue;
                    }
                  }

                  if (isVideo && isFromOwner) {
                    await this.sendHumanLikeMessage(replyJid, "🎬 *Video analyze & summarize ho rahi hai...* ⚡", "", msg.key);
                    const summaryRes = await visionMemoryService.generateMediaSummary(buffer, "video/mp4", caption, fileName, replyJid);
                    await this.sendHumanLikeMessage(replyJid, summaryRes, "", msg.key);
                    continue;
                  }

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
                    whatsappHistoryEngine.saveToFirestore(incoming).catch(() => {});
                  }
                }
              }
            } catch (mediaErr) {
              console.warn("[WhatsAppBot] Media processing error:", mediaErr);
            }
            continue;
          }

          let consumedByDailyUpdate = false;
          if (isFromOwner) {
            // Check if there is a pending voice note waiting in the 5-sec debounce buffer
            const pendingVoice = this.pendingVoiceDebounce.get(replyJid);
            if (pendingVoice) {
              clearTimeout(pendingVoice.timer);
              this.pendingVoiceDebounce.delete(replyJid);

              const isFollowUpRequestingVoice = /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|aawaz|voice\s*note)\b/i.test(text);
              const isFollowUpRequestingTranscript = /\b(transcript|transcribe|likh\s*ke|text|text\s*bhi|likho|dono|both|transcript\s*\+\s*voice|voice\s*\+\s*transcript|write)\b/i.test(text);

              if (isFollowUpRequestingTranscript) {
                await this.sendHumanLikeMessage(replyJid, `🎙️ *Aapki Aawaz (Transcription):*\n_"${pendingVoice.transcribed}"_`, "", pendingVoice.messageKey);
              }

              const combinedText = `${pendingVoice.transcribed} [User follow-up: ${text}]`;
              this.handleOwnerWhatsAppMessage(
                senderName,
                senderPhone,
                combinedText,
                replyJid,
                msg.key,
                quotedMessage || pendingVoice.quotedMessage,
                !isFollowUpRequestingTranscript || isFollowUpRequestingVoice
              ).catch((e) => console.error("[WhatsAppBot] Follow-up voice handling error:", e));
              continue;
            }

            // 1. Voice PIN
            try {
              const { voiceBiometricsService } = await import("./voiceBiometricsService");
              const pinRes = await voiceBiometricsService.handleWhatsAppVoicePinMessage(text, senderName, "whatsapp");
              if (pinRes.handled && pinRes.replyText) {
                consumedByDailyUpdate = true;
                if (this.sock && this.isConnected) {
                  await this.sendHumanLikeMessage(replyJid, pinRes.replyText, text, msg.key);
                }
              }
            } catch {}

            // 1.1 App Access Key
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
              } catch {}
            }

            // 2. Answering forwarded question
            if (!consumedByDailyUpdate) {
              try {
                consumedByDailyUpdate = await this.tryForwardOwnerReplyToPendingSender(text);
              } catch {}
            }

            // 3. MASTER BOSS FRIDAY ASSISTANT
            if (!consumedByDailyUpdate && this.sock && this.isConnected) {
              this.handleOwnerWhatsAppMessage(senderName, senderPhone, text, replyJid, msg.key, quotedMessage).catch((e) =>
                console.error("[WhatsAppBot] Owner Master Friday error:", e)
              );
            }
          } else if (!isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // 1-on-1 Personal Chats
            whatsappAutoReplyEngine.queueIncomingForAutoReply(
              senderName,
              senderPhone,
              text,
              isUnknownContact,
              replyJid,
              msg.key,
              quotedMessage,
              async (sName, sPhone, combText, isUnk, rJid, lKey, qMsg) => {
                await whatsappAutoReplyEngine.tryFactualOrChatReply(
                  sName,
                  sPhone,
                  combText,
                  isUnk,
                  rJid,
                  lKey,
                  qMsg,
                  (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
                  async (gText, gJid, gName, gKey) => {
                    const isGfAct = /^(?:@girlfriend|\/girlfriend|@gf|\/gf|girlfriend\s*mode|gf\s*mode|virtual\s*girlfriend|girlfriend)\b/i.test(gText);
                    const isGfStop = /^(?:@normal|\/normal|normal\s*mode|normal|@stop\s*gf|@stop\s*girlfriend|stop\s*girlfriend|stop\s*gf|exit\s*girlfriend|exit\s*gf)$/i.test(gText);

                    if (isGfAct) {
                      await this.startGirlfriendMode(gJid, gText, gKey, gName);
                      return true;
                    }
                    if (isGfStop) {
                      await this.stopGirlfriendMode(gJid, gKey, true);
                      return true;
                    }
                    if (this.isGirlfriendModeActive(gJid)) {
                      await this.handleGirlfriendChatMessage(gJid, gText, gKey, false);
                      return true;
                    }
                    return false;
                  }
                );
              }
            );
          } else if (isGroup && this.autoReplyEnabled && this.sock && this.isConnected) {
            // Group Mentions
            const botJid = this.sock?.user?.id || "";
            const isMentioned = whatsappAutoReplyEngine.isBotMentionedInGroup(msg, text, botJid, this.dedicatedPhone, quotedMessage);

            if (isMentioned) {
              if (isSenderOwner) {
                this.handleOwnerWhatsAppMessage(senderName, senderPhone, text, remoteJid, msg.key, quotedMessage).catch((e) =>
                  console.error("[WhatsAppBot] Group Boss Friday error:", e)
                );
              } else {
                whatsappAutoReplyEngine.handleGroupMentionAutoReply(
                  senderName,
                  senderPhone,
                  text,
                  remoteJid,
                  groupName || "Group",
                  msg.key,
                  quotedMessage,
                  (j, t, inT, k) => this.sendHumanLikeMessage(j, t, inT, k),
                  (j, img, cap, k) => this.sendPhotoMessage(j, img, cap, k),
                  this.getGroupSafeCommandsCard(),
                  (j, rT, q, k) => this.handleQuotedMediaSummary(j, rT, q, k)
                ).catch((e) => console.error("[WhatsAppBot] Group Mention AI error:", e));
              }
            }
          }

          if (this.messageCallback) this.messageCallback({ ...incoming, consumedByDailyUpdate });
        } catch (e) {
          console.error("[WhatsAppBot] Error processing message:", e);
        }
      }
    });
  }

  // ── Master Owner Message Handler ──────────────────────────────────────────

  private async handleOwnerWhatsAppMessage(
    senderName: string,
    senderPhone: string,
    text: string,
    replyJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isVoiceInput: boolean = false
  ): Promise<void> {
    const rawText = (text || "").trim();
    if (!rawText) return;

    // ── VIRTUAL GIRLFRIEND MODE ROUTING ──
    const isGfActivationIntent =
      /^(?:@girlfriend|\/girlfriend|@gf|\/gf|girlfriend\s*mode|gf\s*mode|virtual\s*girlfriend|girlfriend)\b/i.test(rawText);

    const isGfStopIntent =
      /^(?:@normal|\/normal|normal\s*mode|normal|@stop\s*gf|@stop\s*girlfriend|stop\s*girlfriend|stop\s*gf|exit\s*girlfriend|exit\s*gf)$/i.test(rawText);

    if (isGfActivationIntent) {
      await this.startGirlfriendMode(replyJid, rawText, messageKey, senderName);
      return;
    }

    if (isGfStopIntent) {
      await this.stopGirlfriendMode(replyJid, messageKey, true);
      return;
    }

    if (this.isGirlfriendModeActive(replyJid)) {
      await this.handleGirlfriendChatMessage(replyJid, rawText, messageKey, isVoiceInput);
      return;
    }

    // 0. Quoted Swipe-to-Reply Media / Document / Photo Summary Engine
    if (quotedMessage && quotedMessage.isReply) {
      try {
        const handledQuoted = await this.handleQuotedMediaSummary(replyJid, rawText, quotedMessage, messageKey);
        if (handledQuoted) return;
      } catch (recentMediaErr) {
        console.warn("[WhatsAppBot] Direct recent media Q&A notice:", recentMediaErr);
      }
    }

    // 0.05 Recent Media Follow-Up Q&A
    const isGroupOrChatHistoryInstruction =
      /\b(group|grup|chat|conversation|history|last\s*\d+|msg|message|messages|bhejo|batao|karo|likho|send|forward|avengers|script)\b/i.test(rawText);

    if (!isGroupOrChatHistoryInstruction) {
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
    }

    // 0.08 Direct Auto-Ring Calling Engine
    if (
      /^(?:@call|\/call|call\s*me|call\s*karo|mujhe\s*call\s*karo|friday\s*call\s*me|voice\s*call|live\s*call|call\s*lagao|baat\s*karni\s*hai\s*call\s*par)/i.test(rawText) ||
      rawText.toLowerCase() === "call"
    ) {
      const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
      const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard("Boss DK", true);
      const callIdMatch = callCard.match(/callId=([a-zA-Z0-9_]+)/);
      const callId = callIdMatch ? callIdMatch[1] : `call_${Date.now()}`;

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

    // 0. Master All Commands Directory
    if (
      /^(?:@all\s*cmd|@allcmd|\/allcmd|all\s*cmd|friday\s*all\s*cmd|all\s*commands|@commands?|\/commands?|@help|\/help|help|commands?)$/i.test(rawText) ||
      /\b(all\s*cmd|friday\s*all\s*cmd|all\s*commands|sare\s*commands?)\b/i.test(rawText)
    ) {
      const cmdCard = this.getMasterAllCommandsCard();
      await this.sendHumanLikeMessage(replyJid, cmdCard, rawText, messageKey);
      return;
    }

    // 0.1 Perchance AI Photo Generator Handler (@hot images <prompt> / @perchance <prompt>)
    const perchanceMatch =
      rawText.match(/^(?:@hot\s*images?|@hotimages?|@perchance|\/hot\s*images?|\/hotimages?|\/perchance|@hot|\/hot)\s*[:=-]?\s*(.+)/i) ||
      (rawText.includes("@hot images") ? rawText.match(/@hot\s*images?\s+(.+)/i) : null) ||
      (rawText.includes("@perchance") ? rawText.match(/@perchance\s+(.+)/i) : null);

    if (perchanceMatch && perchanceMatch[1]?.trim()) {
      const prompt = perchanceMatch[1].trim();
      await this.sendHumanLikeMessage(
        replyJid,
        `🔥 *Perchance AI Photo Generator start ho gaya hai Boss DK!* ⚡\n\n📌 *Prompt:* _"${prompt}"_\n🌐 *Website:* https://perchance.org/ai-photo-generator\n⏳ _Browser background me website par prompt fill karke realistic HD photo generate kar raha hai... Kripya thoda wait karein (up to 3-5 min)._`,
        rawText,
        messageKey
      );

      try {
        const { perchanceService } = await import("./perchanceService");
        const res = await perchanceService.generateImage(prompt);

        if (res.success && res.buffer) {
          await this.sendPhotoMessage(
            replyJid,
            res.buffer,
            `✨ *Perchance AI Photo Generated!* 🔥\n\n📌 *Prompt:* _"${prompt}"_\n⏱️ *Time Taken:* ${((res.durationMs || 0) / 1000).toFixed(1)}s\n🌐 *Website:* https://perchance.org/ai-photo-generator\n🤖 *Engine:* Perchance AI Photo Generator (Realistic HD)`,
            messageKey
          );
          return;
        } else {
          await this.sendHumanLikeMessage(
            replyJid,
            `⚠️ *Perchance Photo Generation Failed:* ${res.error || "Generation error"}\nKripya thodi der baad dobara try karein.`,
            rawText,
            messageKey
          );
        }
      } catch (err: any) {
        console.error("[WhatsAppBot] Perchance generation error:", err);
        await this.sendHumanLikeMessage(
          replyJid,
          `⚠️ *Perchance Bot Error:* ${err?.message || "Execution error"}\nKripya thodi der baad dobara try karein.`,
          rawText,
          messageKey
        );
      }
      return;
    }

    // Execute Autonomous Boss AI with Tools
    try {
      const reply = await whatsappBossAiEngine.executeBossChatAI(
        senderName,
        rawText,
        quotedMessage,
        replyJid,
        messageKey,
        (j, img, cap, k) => this.sendPhotoMessage(j, img, cap, k)
      );
      const wantsVoice = isVoiceInput || /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|aawaz|voice\s*note)\b/i.test(rawText);
      const wantsTranscript = !isVoiceInput || /\b(transcript|text|likh\s*ke|likho|dono|both|transcript\s*\+\s*voice|voice\s*\+\s*transcript|write)\b/i.test(rawText);

      let voiceSent = false;
      if (wantsVoice) {
        try {
          const { voiceBridgeService, VoiceBridgeService } = await import("./voiceBridgeService");
          const speechRes = await voiceBridgeService.generateSpeech(reply, VoiceBridgeService.FEMALE_VOICE);
          if (speechRes && speechRes.buffer.length > 0) {
            await this.sendVoiceMessage(replyJid, speechRes.buffer, messageKey, speechRes.mimeType);
            voiceSent = true;
          }
        } catch (vErr) {
          console.warn("[WhatsAppBot] Voice response TTS generation error:", vErr);
        }
      }

      // Send text if user asked for transcript, if not a voice input, or as fallback if voice sending failed
      if (wantsTranscript || !voiceSent) {
        await this.sendHumanLikeMessage(replyJid, reply, rawText, messageKey);
      }
    } catch (aiErr: any) {
      console.error("[WhatsAppBot] Error in executeBossChatAI:", aiErr);
      await this.sendHumanLikeMessage(replyJid, `Boss, main sun rahi hoon! Par kuch technical issue aaya: ${aiErr?.message || aiErr}`, rawText, messageKey);
    }
  }

  private async tryForwardOwnerReplyToPendingSender(text: string): Promise<boolean> {
    const awaiting = await dailyUpdateService.getQuestionsAwaitingDK();
    if (awaiting.length === 0) return false;

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

  // ── Socket Initialization & Lifecycle ─────────────────────────────────────

  public async initSocket(forPairingCode = false) {
    try {
      if (!makeWASocket || typeof makeWASocket !== "function") {
        console.warn("[WhatsAppBot] makeWASocket is not a function:", typeof makeWASocket);
        return;
      }
      this.stopKeepAlive();

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
        keepAliveIntervalMs: 30_000,
        connectTimeoutMs: 90_000,
        defaultQueryTimeoutMs: 90_000,
        browser: Browsers?.windows ? Browsers.windows("Chrome") : ["Windows", "Chrome", "131.0.6778.205"],
        syncFullHistory: false,
      });

      this.sock.ev.on("creds.update", saveCreds);
      this.setupMessageListener();

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.pairingCodeMode) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr);
            this.pairingCode = null;
          } catch (err) {
            console.error("[WhatsAppBot] Error generating QR data URL:", err);
          }
        }

        if (connection === "close") {
          this.isConnected = false;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          this.stopKeepAlive();
          this.stopScheduledMessagesTicker();

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsAppBot] Connection closed (${statusCode}). Should reconnect: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.dedicatedPhone = null;
            await sessionMetaDoc().delete().catch(() => {});
            if (this.clearAuthFn) {
              await this.clearAuthFn();
            }
          } else if (shouldReconnect) {
            this.scheduleReconnect(5000);
          }
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          this.pairingCodeMode = false;
          if (this.dedicatedPhone) this.savePhoneToFirestore(this.dedicatedPhone).catch(() => {});
          this.startKeepAlive();
          this.startScheduledMessagesTicker();
          this.sock.sendPresenceUpdate("unavailable").catch(() => {});
          console.log("[WhatsAppBot] Connected! Natural Offline mode & Scheduled Ticker active.");
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
    this.pairingCodeMode = true;

    if (this.isConnected) {
      this.pairingCodeMode = false;
      return "ALREADY_CONNECTED";
    }

    try {
      if (this.sock) { this.sock.end(undefined); this.sock = null; }
    } catch {}
    this.stopKeepAlive();

    await this.initSocket(true);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    if (!this.sock) {
      this.pairingCodeMode = false;
      throw new Error("WhatsApp socket not ready after init. Try again.");
    }

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
      await sessionMetaDoc().delete().catch(() => {});
      this.dedicatedPhone = null;
    } catch (e) {
      console.error("[WhatsAppBot] Error during resetSession:", e);
    }
    await this.initSocket();
  }

  // ── Outgoing Dispatches with Firewall ─────────────────────────────────────

  public async sendHumanLikeMessage(jid: string, text: string, incomingText?: string, messageKey?: any): Promise<any> {
    if (!this.sock) return null;

    const trimmed = text.trim();
    const recipientKey = jid.replace(/@.*$/, "");

    await humanBotFirewallService.simulateWhatsAppHumanTyping(
      this.sock,
      jid,
      messageKey,
      incomingText || "",
      trimmed
    );

    humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);

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

    let result: any = null;
    try {
      result = await this.sock.sendMessage(jid, { text: trimmed }, sendOptions);
    } catch (quotedErr) {
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

  public async sendSafeMediaMessage(
    jid: string,
    content: any,
    messageKey?: any,
    fallbackText?: string
  ): Promise<any> {
    if (!this.sock || !this.isConnected) return null;

    const sendOptions: any = {};
    if (messageKey) {
      if (messageKey.key && messageKey.message) {
        sendOptions.quoted = messageKey;
      } else {
        const cleanKey = messageKey.key || messageKey;
        if (cleanKey && typeof cleanKey === "object" && (cleanKey.id || cleanKey.remoteJid)) {
          sendOptions.quoted = {
            key: {
              remoteJid: cleanKey.remoteJid || jid,
              fromMe: Boolean(cleanKey.fromMe),
              id: cleanKey.id || "",
              participant: cleanKey.participant || undefined,
            },
            message: { conversation: fallbackText || "..." },
          };
        }
      }
    }

    try {
      return await this.sock.sendMessage(jid, content, sendOptions);
    } catch (quotedErr) {
      return await this.sock.sendMessage(jid, content);
    }
  }

  public async reactToMessage(jid: string, messageKey: any, emoji: string): Promise<boolean> {
    if (!this.sock || !this.isConnected || !messageKey) return false;
    try {
      const cleanKey = messageKey.key || messageKey;
      await this.sock.sendMessage(jid, {
        react: { text: emoji, key: cleanKey },
      });
      return true;
    } catch (e) {
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

    const rawWs = this.sock?.ws?.socket || this.sock?.ws;
    const wsState = rawWs?.readyState;
    if (wsState !== undefined && wsState !== 1) {
      this.isConnected = false;
      setTimeout(() => this.initSocket(), 500);
      return {
        success: false,
        message: "WhatsApp connection went stale. Reconnecting now — please retry sending in a few seconds.",
      };
    }

    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;

      let exists = true;
      try {
        const [result] = await this.sock.onWhatsApp(jid);
        exists = !!result?.exists;
      } catch {}

      if (!exists) {
        return {
          success: false,
          message: `+${cleanPhone} does not appear to be a valid/registered WhatsApp number.`,
        };
      }

      const sendResult = await this.sendHumanLikeMessage(jid, text);

      if (!sendResult?.key?.id) {
        return {
          success: false,
          message: "WhatsApp did not confirm this message was queued for delivery. Try again or re-pair the connection.",
        };
      }

      return { success: true, message: `Message delivered to +${cleanPhone} from Friday Assistant!` };
    } catch (err: any) {
      this.isConnected = false;
      setTimeout(() => this.initSocket(), 500);
      return { success: false, message: `Failed to send WhatsApp message: ${err?.message || err}` };
    }
  }

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
      if (Buffer.isBuffer(imageSource)) {
        whatsappMediaRouter.recordChatPhoto(jid, imageSource, "image/jpeg");
      }
      let sendRes: any = null;
      try {
        sendRes = await this.sock.sendMessage(jid, { image: imagePayload }, sendOptions);
      } catch {
        sendRes = await this.sock.sendMessage(jid, { image: imagePayload });
      }

      if (sendRes?.key?.id) {
        this.botSentMessageIds.add(sendRes.key.id);
      }

      if (caption && caption.trim()) {
        try {
          await this.sendHumanLikeMessage(jid, caption.trim(), "", messageKey);
        } catch {}
      }

      const recipientKey = jid.replace(/@.*$/, "");
      humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);
      return { success: true, message: `Photo successfully delivered to ${jid}!` };
    } catch (e: any) {
      return { success: false, message: `Failed to send photo: ${e?.message || e}` };
    }
  }

  public async sendGifMessage(
    target: string,
    gifSource: string | Buffer,
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

      const gifPayload = typeof gifSource === "string" ? { url: gifSource } : gifSource;
      let sendRes: any = null;
      try {
        sendRes = await this.sock.sendMessage(jid, { video: gifPayload, gifPlayback: true, caption: caption || "" });
      } catch {
        sendRes = await this.sock.sendMessage(jid, { image: gifPayload, caption: caption || "" });
      }

      if (sendRes?.key?.id) {
        this.botSentMessageIds.add(sendRes.key.id);
      }

      const recipientKey = jid.replace(/@.*$/, "");
      humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);
      return { success: true, message: `GIF successfully delivered to ${jid}!` };
    } catch (e: any) {
      return { success: false, message: `Failed to send GIF: ${e?.message || e}` };
    }
  }

  public async sendVoiceMessage(
    target: string,
    audioBuffer: Buffer,
    messageKey?: any,
    mimetype: string = "audio/mpeg"
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
        sendRes = await this.sock.sendMessage(jid, { audio: audioBuffer, mimetype, ptt: false }, sendOptions);
      } catch {
        sendRes = await this.sock.sendMessage(jid, { audio: audioBuffer, mimetype, ptt: false });
      }

      if (sendRes?.key?.id) {
        this.botSentMessageIds.add(sendRes.key.id);
      }

      const recipientKey = jid.replace(/@.*$/, "");
      humanBotFirewallService.recordDispatchedMessage("whatsapp", recipientKey);
      return { success: true, message: `Voice note delivered to ${jid}!` };
    } catch (e: any) {
      return { success: false, message: `Failed to send voice note: ${e?.message || e}` };
    }
  }

  public isBaileysEnabled(): boolean {
    return this.baileysEnabled;
  }

  public setBaileysEnabled(enabled: boolean) {
    this.baileysEnabled = enabled;
  }

  public setAutoReply(enabled: boolean) {
    this.autoReplyEnabled = enabled;
  }

  public getGroupSafeCommandsCard(): string {
    return `⚡ *FRIDAY AI — PUBLIC GROUP COMMANDS* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *Creator & Master:* DK Boss (Divakar Kumar)
🛡️ *Privacy Shield:* Active (Strict Zero-Leak Protection)

🎨 *1. AI IMAGES & ART:*
• \`@image <prompt>\` ➔ Instant Ultra-HD 4K AI Image generation.
• \`@perchance <prompt>\` / \`@hot images <prompt>\` ➔ 4K Realistic AI Photo.
• \`@sticker\` / \`@bgremove\` ➔ Kisi photo ko WhatsApp sticker me badlein.

🔍 *2. SMART SUMMARY & KNOWLEDGE:*
• \`@summary\` ➔ Photo, Document (PDF), ya Group Chat ki safe summary.
• \`@web <query>\` ➔ Real-time web facts & information search.
• \`@code <code>\` / \`@debug <code>\` ➔ Programming code explanation & bug fix.
• \`@translate <lang>: <text>\` ➔ Multi-language translation.

👥 *3. GROUP UTILITIES:*
• \`@poll <question>\` ➔ WhatsApp interactive poll create karein.
• \`@quiz <topic>\` ➔ Group trivia/quiz game start karein.
• \`@safety <link>\` ➔ Phishing & scam link safety verification.

💬 *4. CHAT WITH FRIDAY:*
• \`@friday <sawal ya baat>\` ➔ Friday se direct group me baat karein.
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 *Security Notice:* Security aur privacy guidelines ke mutabik group me kisi ka personal number ya private vault data share nahi kiya jata hai.`;
  }

  public getMasterAllCommandsCard(): string {
    return `⚡ *FRIDAY AI — ALL @ COMMANDS DIRECTORY* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━

🎙️ *1. VOICE & MULTI-LANGUAGE:*
• \`@voice <text>\` / \`@speak <text>\` ➔ Friday human audio voice note (PTT) me bol kar sunati hai.
• \`@translate <lang>: <text>\` ➔ 20+ bhashaon me translate karein (e.g. \`@translate english: kaise ho\`).
• 💬 *Voice-to-Voice:* Agar aap Voice Note bhejenge, Friday naturally audio me bol kar hi answer degi!

🎬 *2. AI VIDEO & SOCIAL MEDIA DOWNLOADER:*
• \`@video <prompt>\` ➔ Instant 3-5 sec AI short video clip generation.
• \`@animate\` ➔ Kisi bhi photo par likhein, use dynamic moving video me convert kar dega.
• 📥 *Social Downloader:* Koi bhi Instagram Reel, YouTube Shorts, TikTok ya Twitter link bhejein, direct MP4 video mil jayegi!

🎨 *3. CREATIVE PHOTO & STICKER STUDIO:*
• \`@hot images <prompt>\` ➔ Direct https://perchance.org/ai-photo-generator par jakar realistic AI photo generate karke bhejta hai.
• \`@image <prompt>\` ➔ Instant Ultra-HD 4K AI Image generation (FLUX.1 Engine).
• \`@edit <instruction>\` ➔ Photo par swipe karke ya caption me likhein (e.g. \`@edit add sunglasses and cyberpunk background\`).
• \`@sticker\` / \`@bgremove\` ➔ Background remove karke direct WhatsApp Sticker banayein.
• \`@faceswap\` / \`@combine\` ➔ 2 photos ka Face Swap aur Style Fusion karein.

📊 *4. EXCEL, SUMMARY & PRODUCTIVITY:*
• \`@excel\` / \`@sheet\` ➔ Kisi bhi bill, receipt, ya table ki photo se instant Excel (.xlsx) file download karein!
• \`@summary\` / \`@catchup\` ➔ Current chat ya group ki complete summary.
• \`@digest\` ➔ Personal catchup digest.
• \`@web <url>\` ➔ Kisi bhi website/link ka instant executive summary.
• \`@music <song name>\` ➔ Song details, live lyrics & singer info.

⏱️ *5. AUTOMATION & VAULT:*
• \`@schedule <Name> in <time>: <msg>\` ➔ WhatsApp message schedule karein.
• \`@remind me in <time>: <task>\` ➔ Auto WhatsApp reminder ping.
• \`@meet with <person> <time>\` ➔ Google Calendar meeting schedule karein.
• \`@remember <fact>\` ➔ Permanent memory vault me save karein.

👥 *6. GROUPS & UTILITIES:*
• \`@poll <question>\` ➔ Interactive WhatsApp poll create karein.
• \`@quiz <topic>\` ➔ Group trivia/quiz game start karein.
• \`@split <amount> between <names>\` ➔ Group bill split & instant UPI split.
• \`@code <code>\` / \`@debug <code>\` ➔ Programming code explain & error debug.
• \`@call\` ➔ 1-Click live real incoming voice call on phone app.

💖 *7. VIRTUAL GIRLFRIEND & PERSONA:*
• \`@girlfriend <time>\` (e.g. \`@girlfriend 30 mins\`) ➔ 100% Private RAM-only girlfriend chat mode activate karein.
• \`@normal\` ➔ Wapas normal Friday AI Assistant mode me switch karein.

━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Tip:* Aap natural bhasha me bhi bol sakte hain (e.g. _"Ram ko msg kar do"_, _"is bill ka excel bana do"_, _"photo ko sticker bana do"_). Friday automatically execute karegi! 👍`;
  }

  /**
   * Find a group by name or JID from cache or active metadata
   */
  public async findGroup(groupQuery: string): Promise<{ groupId: string; groupName: string } | null> {
    const rawQ = (groupQuery || "").toLowerCase().trim();
    const cleanQ = rawQ.replace(/group|grup|ka|ki|ke/gi, "").trim();

    // 1. Direct JID match
    if (groupQuery.endsWith("@g.us")) {
      const name = await this.getGroupName(groupQuery);
      return { groupId: groupQuery, groupName: name };
    }

    // 2. Check groupNameCache
    for (const [jid, name] of this.groupNameCache.entries()) {
      if (name.toLowerCase().includes(cleanQ) || (cleanQ && jid.toLowerCase().includes(cleanQ))) {
        return { groupId: jid, groupName: name };
      }
    }

    // 3. Check WhatsApp History Engine cache
    const historyMsgs = whatsappHistoryEngine.getCachedMessages().filter((m) => m.isGroup && m.groupId);
    for (const m of historyMsgs) {
      if (m.groupName && m.groupName.toLowerCase().includes(cleanQ)) {
        this.groupNameCache.set(m.groupId!, m.groupName);
        return { groupId: m.groupId!, groupName: m.groupName };
      }
    }

    // 4. Fetch participating groups via Baileys if connected
    if (this.sock && this.isConnected) {
      try {
        const groups = await this.sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups as Record<string, any>)) {
          const subject = meta?.subject || jid;
          this.groupNameCache.set(jid, subject);
          if (subject.toLowerCase().includes(cleanQ) || jid.toLowerCase().includes(cleanQ)) {
            return { groupId: jid, groupName: subject };
          }
        }
      } catch (err) {
        console.warn("[WhatsAppBot] groupFetchAllParticipating failed:", err);
      }
    }

    return null;
  }

  /**
   * Send a message to a WhatsApp group
   */
  public async sendGroupMessage(
    groupQuery: string,
    messageText: string
  ): Promise<{ success: boolean; groupName?: string; groupId?: string; message: string }> {
    if (!this.sock || !this.isConnected) {
      return { success: false, message: "WhatsApp 2 (Baileys) disconnected hai. Message deliver nahi hua." };
    }

    const group = await this.findGroup(groupQuery);
    if (!group) {
      const available = Array.from(this.groupNameCache.values());
      return {
        success: false,
        message: `Group "${groupQuery}" nahi mila.${available.length > 0 ? ` Active groups: ${available.join(", ")}` : ""}`,
      };
    }

    try {
      await this.sock.sendMessage(group.groupId, { text: messageText });
      return {
        success: true,
        groupName: group.groupName,
        groupId: group.groupId,
        message: `Message "${group.groupName}" group me successfully send kar diya gaya! ✅`,
      };
    } catch (e: any) {
      return {
        success: false,
        groupName: group.groupName,
        message: `Failed to send message to group ${group.groupName}: ${e?.message || e}`,
      };
    }
  }

  public getStatus(): WhatsAppStatus {
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
