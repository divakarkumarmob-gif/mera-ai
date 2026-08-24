// ---------------------------------------------------------------------------
// whatsappCloudService.ts
//
// Meta WhatsApp Cloud API (official, free tier) — ban-safe alternative to Baileys.
// No unofficial reverse engineering. Uses Meta's Graph API directly.
//
// Requires in .env:
//   WHATSAPP_API_TOKEN=<Permanent access token from Meta Business>
//   WHATSAPP_PHONE_ID=<Phone Number ID from Meta Developer Console>
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN=<Any random string you choose>
//   WHATSAPP_FROM_NUMBER=<Your WhatsApp Business number with country code>
// ---------------------------------------------------------------------------

import { db } from "./firebaseAdmin";

export interface CloudMessage {
  from: string;       // Sender phone (with country code, no +)
  name: string;       // Sender display name
  text: string;       // Message text
  messageId: string;
  timestamp: number;
}

type MessageCallback = (msg: CloudMessage) => void;

class WhatsAppCloudService {
  private token: string = "";
  private phoneId: string = "";
  private webhookVerifyToken: string = "";
  private fromNumber: string = "";
  private messageCallback: MessageCallback | null = null;
  private isConfigured = false;
  private lastAutoReplyAt = new Map<string, number>();

  constructor() {
    this.reload();
  }

  public reload() {
    this.token = process.env.WHATSAPP_API_TOKEN || "";
    this.phoneId = process.env.WHATSAPP_PHONE_ID || "";
    this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "friday_webhook_2024";
    this.fromNumber = process.env.WHATSAPP_FROM_NUMBER || "";
    this.isConfigured = !!(this.token && this.phoneId);
  }

  public getStatus(): { configured: boolean; phoneId: string; fromNumber: string } {
    this.reload();
    return {
      configured: this.isConfigured,
      phoneId: this.phoneId,
      fromNumber: this.fromNumber,
    };
  }

  public setMessageCallback(cb: MessageCallback) {
    this.messageCallback = cb;
  }

  /** Normalizes a phone number to WhatsApp international standard (e.g. 919876543210) */
  private normalizePhone(toPhone: string): string {
    let clean = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();
    if (clean.length === 10) {
      clean = `91${clean}`;
    }
    return clean;
  }

  // ── Send a text message via Cloud API ──────────────────────────────────────
  public async sendMessage(toPhone: string, text: string): Promise<{ success: boolean; message: string }> {
    this.reload();
    if (!this.isConfigured) {
      return {
        success: false,
        message: "WhatsApp Cloud API configured nahi hai. .env mein WHATSAPP_API_TOKEN aur WHATSAPP_PHONE_ID set karo.",
      };
    }

    // Normalize phone number — remove spaces, dashes, +, prefix 91 if 10-digit
    const phone = this.normalizePhone(toPhone);

    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${this.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "text",
            text: { preview_url: true, body: text },
          }),
        }
      );

      const data = await res.json();

      if (res.ok && data.messages?.[0]?.id) {
        console.log(`[WhatsApp Cloud] Sent to ${phone}: ${text.slice(0, 60)}`);
        return { success: true, message: `Message sent to ${phone}` };
      }

      const errObj = data?.error;
      const errCode = errObj?.code;
      const errSubcode = errObj?.error_subcode;
      const errMsg = errObj?.message || (typeof data === "string" ? data : JSON.stringify(data));
      console.error(`[WhatsApp Cloud] Send failed (code=${errCode}, subcode=${errSubcode}):`, errMsg);
      return { success: false, message: `[Meta Error ${errCode || 'Unknown'}]: ${errMsg}` };

    } catch (e: any) {
      console.error("[WhatsApp Cloud] Network error:", e?.message);
      return { success: false, message: `Network error: ${e?.message}` };
    }
  }

  // ── Send a template message (for first-message to a new user) ──────────────
  public async sendTemplate(
    toPhone: string,
    templateName: string = "hello_world",
    langCode: string = "en_US"
  ): Promise<{ success: boolean; message: string }> {
    this.reload();
    if (!this.isConfigured) {
      return { success: false, message: "Cloud API not configured." };
    }
    const phone = this.normalizePhone(toPhone);
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${this.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: { name: templateName, language: { code: langCode } },
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.messages?.[0]?.id) {
        return { success: true, message: `Template sent to ${phone}` };
      }
      return { success: false, message: data?.error?.message || "Unknown error" };
    } catch (e: any) {
      return { success: false, message: `Error: ${e?.message}` };
    }
  }

  // ── Verify webhook (Meta calls this when you set up the webhook) ────────────
  public verifyWebhook(mode: string, challenge: string, verifyToken: string): string | null {
    if (mode === "subscribe" && verifyToken === this.webhookVerifyToken) {
      console.log("[WhatsApp Cloud] Webhook verified by Meta.");
      return challenge;
    }
    return null;
  }

  // ── Handle incoming webhook payload from Meta ──────────────────────────────
  public handleWebhook(body: any): void {
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.length) return;

      for (const msg of value.messages) {
        const isText = msg.type === "text";
        const isImage = msg.type === "image";
        const isDoc = msg.type === "document";
        const isVideo = msg.type === "video";
        const isAudio = msg.type === "audio" || msg.type === "voice";
        const isMedia = isImage || isDoc || isVideo || isAudio;

        const from = msg.from;
        let text = isText ? (msg.text?.body || "") : `[${msg.type}]`;
        const messageId = msg.id;
        const timestamp = parseInt(msg.timestamp, 10) * 1000;

        const contacts = value?.contacts || [];
        const contact = contacts.find((c: any) => c.wa_id === from);
        const name = contact?.profile?.name || from;

        const docFileName = msg.document?.filename;
        const mediaCaption = isImage
          ? msg.image?.caption
          : isDoc
          ? msg.document?.caption
          : isVideo
          ? msg.video?.caption
          : undefined;

        // Async processor for media downloading, multimodal AI analysis, inbox saving & auto-reply
        (async () => {
          try {
            const { contactsService } = await import("./contactsService");
            const { whatsappBotService } = await import("./whatsappBotService");
            const { visionMemoryService } = await import("./visionMemoryService");

            const foundContact = await contactsService.findContact(from);
            const senderName = foundContact ? foundContact.name : name || from;
            const isUnknownContact = !foundContact;
            const dateStr = new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

            let mediaAnalysisSummary = "";
            let mediaCategory: "image" | "video" | "document" | "audio" | null = null;

            // 1. Download and analyze media if present
            if (isMedia && this.token) {
              const mediaId = msg.image?.id || msg.document?.id || msg.video?.id || msg.audio?.id;
              const mimeType = msg.image?.mime_type || msg.document?.mime_type || msg.video?.mime_type || msg.audio?.mime_type || (isVideo ? "video/mp4" : isAudio ? "audio/ogg" : isDoc ? "application/pdf" : "image/jpeg");

              if (mediaId) {
                try {
                  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
                    headers: { Authorization: `Bearer ${this.token}` },
                  });
                  const metaData = await metaRes.json();
                  if (metaData?.url) {
                    const fileRes = await fetch(metaData.url, {
                      headers: { Authorization: `Bearer ${this.token}` },
                    });
                    const arrayBuffer = await fileRes.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const analyzed = await visionMemoryService.processIncomingMedia(
                      buffer,
                      mimeType,
                      senderName,
                      mediaCaption,
                      docFileName
                    );
                    mediaAnalysisSummary = analyzed.shortSummary || analyzed.analysis;
                    mediaCategory = analyzed.mediaCategory;
                  }
                } catch (mediaErr) {
                  console.warn("[WhatsApp Cloud] Failed to process incoming media for Vision:", mediaErr);
                }
              }
            }

            // Construct rich message text
            if (isMedia) {
              if (isDoc) {
                text = docFileName
                  ? `[PDF/Document: ${docFileName}${mediaCaption ? ` - "${mediaCaption}"` : ""}${mediaAnalysisSummary ? ` | AI Summary: ${mediaAnalysisSummary}` : ""}]`
                  : `[Document/PDF${mediaAnalysisSummary ? ` | AI Summary: ${mediaAnalysisSummary}` : ""}]`;
              } else if (isImage) {
                text = `[Photo${mediaCaption ? ` "${mediaCaption}"` : ""}${mediaAnalysisSummary ? ` | Details: ${mediaAnalysisSummary}` : ""}]`;
              } else if (isVideo) {
                text = `[Video${mediaCaption ? ` "${mediaCaption}"` : ""}${mediaAnalysisSummary ? ` | Details: ${mediaAnalysisSummary}` : ""}]`;
              } else if (isAudio) {
                text = `[Voice Message${mediaAnalysisSummary ? ` | Transcript: ${mediaAnalysisSummary}` : ""}]`;
              }
            }

            const incomingRecord = {
              id: messageId,
              senderPhone: from,
              senderName,
              senderDisplayName: name || from,
              replyJid: `${from}@s.whatsapp.net`,
              groupId: null,
              groupName: null,
              isGroup: false,
              isUnknownContact,
              text,
              timestamp,
              dateStr,
              isRead: false,
            };

            // Save to Firestore inbox
            await db.collection("whatsapp_inbox").doc(messageId).set(incomingRecord, { merge: true });
            // Add to in-memory cache
            whatsappBotService.recordIncomingMessage(incomingRecord);

            // 2. Intelligent Auto-Reply if sender is not the owner
            const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
            const fromDigits = from.replace(/\D/g, "");
            if (!ownerPhone || fromDigits !== ownerPhone) {
              const now = Date.now();
              const lastSent = this.lastAutoReplyAt.get(from) || 0;
              // 15s debounce per sender
              if (now - lastSent > 15000) {
                this.lastAutoReplyAt.set(from, now);

                let replyText = "Boss 🧑‍🦱 abhi busy hain, unke aate hi unko bataunga aapka msg aaya hai, reply jaldi milega 😊😶‍🌫️";
                if (isDoc) {
                  replyText = `Boss 🧑‍🦱 abhi busy hain, maine aapka document/PDF (${docFileName || "file"}) receive kar liya hai. Jaise hi boss aayenge main unko bataungi, reply jaldi milega 😊😶‍🌫️`;
                } else if (isImage) {
                  replyText = `Boss 🧑‍🦱 abhi busy hain, maine aapki photo receive kar li hai. Jaise hi boss aayenge main unko bataungi, reply jaldi milega 😊😶‍🌫️`;
                } else if (isVideo) {
                  replyText = `Boss 🧑‍🦱 abhi busy hain, maine aapka video receive kar liya hai. Jaise hi boss aayenge main unko bataungi, reply jaldi milega 😊😶‍🌫️`;
                } else if (isAudio) {
                  replyText = `Boss 🧑‍🦱 abhi busy hain, maine aapka voice message note kar liya hai. Jaise hi boss aayenge main unko bataungi, reply jaldi milega 😊😶‍🌫️`;
                }

                console.log(`[WhatsApp Cloud] Sending auto-reply to ${from}: "${replyText}"`);
                await this.sendMessage(from, replyText);
              }
            }
          } catch (persistErr) {
            console.error("[WhatsApp Cloud] Failed to persist incoming message or auto-reply:", persistErr);
          }
        })();

        const cloudMsg: CloudMessage = { from, name, text, messageId, timestamp };
        console.log(`[WhatsApp Cloud] Incoming from ${name} (${from}): ${text.slice(0, 80)}`);

        if (this.messageCallback) {
          this.messageCallback(cloudMsg);
        }
      }
    } catch (e: any) {
      console.error("[WhatsApp Cloud] Webhook parse error:", e?.message);
    }
  }

  // ── Mark message as read ───────────────────────────────────────────────────
  public async markRead(messageId: string): Promise<void> {
    if (!this.isConfigured) return;
    try {
      await fetch(`https://graph.facebook.com/v19.0/${this.phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    } catch { /* non-critical */ }
  }
}

export const whatsappCloudService = new WhatsAppCloudService();
