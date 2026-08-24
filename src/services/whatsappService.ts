import { whatsappCloudService } from "./whatsappCloudService";
import { whatsappBotService } from "./whatsappBotService";

export interface SendWhatsAppResult {
  success: boolean;
  message: string;
  via?: "cloud_api" | "baileys";
}

/**
 * Unified WhatsApp message dispatcher:
 * 1. Primary: WhatsApp Cloud API (official Meta API — ban-safe, reliable).
 * 2. Fallback: Baileys Dedicated Bot (if connected or enabled).
 * 3. Detailed diagnostics if both fail.
 */
export async function sendWhatsAppUnified(
  toPhone: string,
  text: string
): Promise<SendWhatsAppResult> {
  const cloudStatus = whatsappCloudService.getStatus();
  let cloudError: string | null = null;

  if (cloudStatus.configured) {
    const cloudRes = await whatsappCloudService.sendMessage(toPhone, text);
    if (cloudRes.success) {
      return {
        success: true,
        via: "cloud_api",
        message: cloudRes.message,
      };
    }
    cloudError = cloudRes.message;
    console.warn(`[WhatsApp] Cloud API failed: ${cloudError}. Checking Baileys / Template fallback...`);

    // Check if error is due to Meta's 24-hour conversation window policy
    const is24hWindowClosed = /24\s*hours|131047|template|131030|131026/i.test(cloudError);
    if (is24hWindowClosed) {
      // If Baileys is connected, it bypasses the 24-hour Meta limitation completely
      const baileysStatus = whatsappBotService.getStatus();
      if (baileysStatus.isConnected) {
        const baileysRes = await whatsappBotService.sendMessage(toPhone, text);
        if (baileysRes.success) {
          return {
            success: true,
            via: "baileys",
            message: `Delivered via WhatsApp Bot (Cloud API 24-hr window was closed).`,
          };
        }
      }

      // If Baileys is not linked, attempt to send a template message to initiate the session
      try {
        const templateRes = await whatsappCloudService.sendTemplate(toPhone, "hello_world");
        if (templateRes.success) {
          return {
            success: true,
            via: "cloud_api",
            message: `Template notification sent to +${toPhone} (Meta 24h window opened. Once recipient replies, full custom text will flow).`,
          };
        }
      } catch {}
    }
  }

  const baileysStatus = whatsappBotService.getStatus();
  if (baileysStatus.isConnected) {
    const baileysRes = await whatsappBotService.sendMessage(toPhone, text);
    if (baileysRes.success) {
      return {
        success: true,
        via: "baileys",
        message: baileysRes.message,
      };
    }
    return {
      success: false,
      message: cloudError
        ? `Cloud API failed (${cloudError}) & Baileys failed (${baileysRes.message})`
        : baileysRes.message,
    };
  }

  if (cloudError) {
    const is24h = /24\s*hours|131047|template|131030|131026/i.test(cloudError);
    return {
      success: false,
      message: is24h
        ? `Meta 24-hour Window Closed: Meta policy ke anusaar recipient ne 24 ghante mein aapke WhatsApp bot ko msg nahi kiya hai. Solution: Ya to recipient pehle aapko 'Hi' bhej kar window open kare, ya settings mein Baileys bot link karein.`
        : `WhatsApp Cloud API delivery failed: ${cloudError}`,
    };
  }

  return {
    success: false,
    message: "WhatsApp is not configured. Please add WHATSAPP_API_TOKEN & WHATSAPP_PHONE_ID to .env or link WhatsApp bot in settings.",
  };
}
