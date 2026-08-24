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
    console.warn(`[WhatsApp] Cloud API failed: ${cloudError}. Checking Baileys fallback...`);
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
    return {
      success: false,
      message: `WhatsApp Cloud API delivery failed: ${cloudError}`,
    };
  }

  return {
    success: false,
    message: "WhatsApp is not configured. Please add WHATSAPP_API_TOKEN & WHATSAPP_PHONE_ID to .env or link WhatsApp bot in settings.",
  };
}
