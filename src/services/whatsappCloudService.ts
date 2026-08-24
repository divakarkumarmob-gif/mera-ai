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

export interface CloudMessage {
  from: string;       // Sender phone (with country code, no +)
  name: string;       // Sender display name
  text: string;       // Message text
  messageId: string;
  timestamp: number;
}

export type MessageCallback = (msg: CloudMessage) => void;

class WhatsAppCloudService {
  private token: string = "";
  private phoneId: string = "";
  private webhookVerifyToken: string = "";
  private fromNumber: string = "";
  private messageCallback: MessageCallback | null = null;
  private isConfigured = false;

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

  /**
   * Cleans and normalizes raw phone numbers or WhatsApp JIDs to standard E.164 digits format.
   * e.g., "+1 (555) 012-3456" -> "15550123456", "919876543210@s.whatsapp.net" -> "919876543210"
   */
  private formatPhoneNumber(toPhone: string): string {
    return toPhone.replace(/@.*$/, "").replace(/\D/g, "");
  }

  // ── Send a text message via Cloud API ──────────────────────────────────────
  public async sendMessage(toPhone: string, text: string): Promise<{ success: boolean; message: string }> {
    this.reload();

    if (!this.isConfigured) {
      return {
        success: false,
        message: "WhatsApp Cloud API is not configured. Please set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_ID in environment settings.",
      };
    }

    const phone = this.formatPhoneNumber(toPhone);
    if (!phone) {
      return { success: false, message: "Invalid recipient phone number." };
    }

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

      const errMsg = data?.error?.message || JSON.stringify(data);
      console.error(`[WhatsApp Cloud] Send failed to ${phone}:`, errMsg);
      return { success: false, message: errMsg };

    } catch (e: any) {
      console.error("[WhatsApp Cloud] Network error:", e?.message);
      return { success: false, message: `Network error: ${e?.message}` };
    }
  }

  // ── Send a media message (Image, Document, Audio, Video) via Cloud API ────
  public async sendMediaMessage(
    toPhone: string,
    mediaType: "image" | "document" | "audio" | "video",
    mediaUrl: string,
    caption?: string,
    fileName?: string
  ): Promise<{ success: boolean; message: string }> {
    this.reload();

    if (!this.isConfigured) {
      return {
        success: false,
        message: "WhatsApp Cloud API is not configured. Please set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_ID in environment settings.",
      };
    }

    const phone = this.formatPhoneNumber(toPhone);
    if (!phone) {
      return { success: false, message: "Invalid recipient phone number." };
    }

    const mediaObj: Record<string, any> = { link: mediaUrl };
    if (caption && (mediaType === "image" || mediaType === "document" || mediaType === "video")) {
      mediaObj.caption = caption;
    }
    if (fileName && mediaType === "document") {
      mediaObj.filename = fileName;
    }

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
            type: mediaType,
            [mediaType]: mediaObj,
          }),
        }
      );

      const data = await res.json();

      if (res.ok && data.messages?.[0]?.id) {
        console.log(`[WhatsApp Cloud] Sent ${mediaType} to ${phone}`);
        return { success: true, message: `Media sent to ${phone}` };
      }

      const errMsg = data?.error?.message || JSON.stringify(data);
      console.error(`[WhatsApp Cloud] Send media failed to ${phone}:`, errMsg);
      return { success: false, message: errMsg };
    } catch (e: any) {
      console.error("[WhatsApp Cloud] Network error sending media:", e?.message);
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

    const phone = this.formatPhoneNumber(toPhone);
    if (!phone) {
      return { success: false, message: "Invalid recipient phone number." };
    }

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
      return { success: false, message: data?.error?.message || JSON.stringify(data) };
    } catch (e: any) {
      return { success: false, message: `Error: ${e?.message}` };
    }
  }

  // ── Verify webhook (Meta calls this when you set up the webhook) ────────────
  public verifyWebhook(mode: string, challenge: string, verifyToken: string): string | null {
    this.reload();
    if (mode === "subscribe" && verifyToken === this.webhookVerifyToken) {
      console.log("[WhatsApp Cloud] Webhook verified by Meta.");
      return challenge;
    }
    return null;
  }

  // ── Handle incoming webhook payload from Meta ──────────────────────────────
  public handleWebhook(body: any): void {
    try {
      this.reload();
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.length) return;

      for (const msg of value.messages) {
        const isText = msg.type === "text";
        const isMedia = msg.type === "image" || msg.type === "document" || msg.type === "audio" || msg.type === "video";

        const from = msg.from;
        const text = isText
          ? (msg.text?.body || "")
          : (msg.image?.caption || msg.document?.caption || msg.video?.caption || `[${msg.type}]`);
        const messageId = msg.id;
        const timestamp = parseInt(msg.timestamp, 10) * 1000 || Date.now();

        const contacts = value?.contacts || [];
        const contact = contacts.find((c: any) => c.wa_id === from);
        const name = contact?.profile?.name || from;

        // Vision AI: Download Cloud media if image/document
        if (isMedia && this.token) {
          const mediaId = msg.image?.id || msg.document?.id || msg.audio?.id || msg.video?.id;
          const mimeType = msg.image?.mime_type || msg.document?.mime_type || msg.audio?.mime_type || msg.video?.mime_type || "image/jpeg";
          const caption = msg.image?.caption || msg.document?.caption || msg.video?.caption || "";

          if (mediaId) {
            (async () => {
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
                  const { visionMemoryService } = await import("./visionMemoryService");
                  await visionMemoryService.processIncomingMedia(buffer, mimeType, name, caption);
                }
              } catch (mediaErr) {
                console.warn("[WhatsApp Cloud] Failed to process incoming media for Vision:", mediaErr);
              }
            })();
          }
        }

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
    this.reload();
    if (!this.isConfigured || !messageId) return;

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
    } catch {
      /* non-critical background operation */
    }
  }
}

export const whatsappCloudService = new WhatsAppCloudService();