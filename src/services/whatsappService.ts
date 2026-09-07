import { whatsappCloudService } from "./whatsappCloudService";
import { whatsappBotService } from "./whatsappBotService";

export interface SendWhatsAppOptions {
  /**
   * "whatsapp1" = Official Meta WhatsApp Cloud API
   * "whatsapp2" = WhatsApp Baileys Multi-Device Bot
   * "auto"      = Try WhatsApp 1 first; if fails, smart failover/prompt to WhatsApp 2
   */
  channel?: "auto" | "whatsapp1" | "whatsapp2";
  baileysEnabled?: boolean;
}

export interface SendWhatsAppResult {
  success: boolean;
  message: string;
  via?: "cloud_api" | "baileys";
  channelUsed?: "whatsapp1" | "whatsapp2";
  canFallbackToWhatsApp2?: boolean;
  suggestBaileysFallback?: boolean;
}

/**
 * Dual WhatsApp message dispatcher:
 * - WhatsApp 1: Official Meta Cloud API (ban-safe, high reliability)
 * - WhatsApp 2: Baileys Multi-Device Bot (personal/spare number, bypasses 24h Meta restriction)
 */
export async function sendWhatsAppUnified(
  toPhone: string,
  text: string,
  options: SendWhatsAppOptions = {}
): Promise<SendWhatsAppResult> {
  const { channel = "auto" } = options;
  const isBaileysActive = typeof options.baileysEnabled === "boolean"
    ? options.baileysEnabled
    : whatsappBotService.isBaileysEnabled();

  const cleanPhone = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();

  // ── 1. DIRECT CHANNEL: WhatsApp 2 (Baileys Dedicated Bot) ─────────────────
  if (channel === "whatsapp2") {
    const baileysStatus = whatsappBotService.getStatus();
    if (!baileysStatus.isConnected) {
      return {
        success: false,
        channelUsed: "whatsapp2",
        message: "Boss, WhatsApp 2 (Baileys) abhi linked nahi hai. Kripya settings mein jakar QR scan ya Pairing code se WhatsApp 2 link karein.",
      };
    }

    const baileysRes = await whatsappBotService.sendMessage(cleanPhone, text);
    return {
      success: baileysRes.success,
      via: "baileys",
      channelUsed: "whatsapp2",
      message: baileysRes.success
        ? `Delivered via WhatsApp 2 (Baileys): ${baileysRes.message}`
        : `WhatsApp 2 send failed: ${baileysRes.message}`,
    };
  }

  // ── 2. DIRECT CHANNEL: WhatsApp 1 (Official Meta Cloud API) ───────────────
  if (channel === "whatsapp1") {
    const cloudStatus = whatsappCloudService.getStatus();
    if (!cloudStatus.configured) {
      return {
        success: false,
        channelUsed: "whatsapp1",
        message: "Boss, WhatsApp 1 (Official Meta Cloud API) .env mein configured nahi hai (WHATSAPP_API_TOKEN / WHATSAPP_PHONE_ID missing).",
      };
    }

    const cloudRes = await whatsappCloudService.sendMessage(cleanPhone, text);
    return {
      success: cloudRes.success,
      via: "cloud_api",
      channelUsed: "whatsapp1",
      message: cloudRes.success
        ? `Delivered via WhatsApp 1 (Official Cloud API): ${cloudRes.message}`
        : `WhatsApp 1 failed: ${cloudRes.message}`,
    };
  }

  // ── 3. AUTO MODE: Try WhatsApp 1 first, with Smart WhatsApp 2 Failover ───
  const cloudStatus = whatsappCloudService.getStatus();
  let cloudError: string | null = null;

  if (cloudStatus.configured) {
    const cloudRes = await whatsappCloudService.sendMessage(cleanPhone, text);
    if (cloudRes.success) {
      return {
        success: true,
        via: "cloud_api",
        channelUsed: "whatsapp1",
        message: cloudRes.message,
      };
    }
    cloudError = cloudRes.message;
    console.warn(`[WhatsApp] WhatsApp 1 (Cloud API) failed: ${cloudError}. Checking WhatsApp 2 (Baileys) fallback...`);
  } else {
    cloudError = "WhatsApp 1 (Cloud API) not configured";
  }

  // WhatsApp 1 failed — check WhatsApp 2 (Baileys) status
  const baileysStatus = whatsappBotService.getStatus();

  // Case A: WhatsApp 2 is linked AND enabled in settings -> Auto-send via WhatsApp 2
  if (baileysStatus.isConnected && isBaileysActive) {
    console.log(`[WhatsApp] WhatsApp 2 (Baileys) is active & connected. Performing automatic failover...`);
    const baileysRes = await whatsappBotService.sendMessage(cleanPhone, text);
    if (baileysRes.success) {
      return {
        success: true,
        via: "baileys",
        channelUsed: "whatsapp2",
        message: `Delivered via WhatsApp 2 (Baileys) as WhatsApp 1 was unavailable (${cloudError}).`,
      };
    }
    return {
      success: false,
      message: `WhatsApp 1 failed (${cloudError}) and WhatsApp 2 failed (${baileysRes.message}).`,
    };
  }

  // Case B: WhatsApp 2 is linked BUT toggle is OFF in settings -> Prompt Friday to ask Boss
  if (baileysStatus.isConnected && !isBaileysActive) {
    return {
      success: false,
      canFallbackToWhatsApp2: true,
      suggestBaileysFallback: true,
      channelUsed: "whatsapp1",
      message: `Boss, WhatsApp 1 se message nahi jaa raha hai (${cloudError}). WhatsApp 2 (Baileys) linked hai par setting se OFF hai. Kya main WhatsApp 2 se bhej doon?`,
    };
  }

  // Case C: WhatsApp 2 is NOT linked at all
  return {
    success: false,
    channelUsed: "whatsapp1",
    message: `WhatsApp 1 failed (${cloudError}). WhatsApp 2 (Baileys) abhi linked nahi hai — Settings mein jaakar link karein.`,
  };
}
