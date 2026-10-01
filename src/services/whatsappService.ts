import { whatsappBotService } from "./whatsappBotService";

export type WhatsAppPrimaryChannel = "baileys" | "whatsapp2" | "auto";

export interface SendWhatsAppOptions {
  channel?: string;
  baileysEnabled?: boolean;
}

export interface SendWhatsAppResult {
  success: boolean;
  message: string;
  via?: "baileys";
  channelUsed?: "baileys";
  canFallbackToWhatsApp2?: boolean;
  suggestBaileysFallback?: boolean;
}

/**
 * Gets primary WhatsApp channel (Always Baileys Multi-Device Bot).
 */
export async function getPrimaryWhatsAppChannel(): Promise<WhatsAppPrimaryChannel> {
  return "baileys";
}

/**
 * Set primary WhatsApp channel (Locked to Baileys Multi-Device Bot).
 */
export async function setPrimaryWhatsAppChannel(_channel: string): Promise<{ success: boolean; message: string; channel: WhatsAppPrimaryChannel }> {
  return {
    success: true,
    channel: "baileys",
    message: "Boss, WhatsApp system ab 100% Baileys Dedicated Multi-Device Bot par configured hai! Saare messages direct isi bot se bheje jayenge.",
  };
}

/**
 * Direct Baileys WhatsApp message dispatcher.
 * All messages dispatch directly through Baileys Multi-Device bot.
 */
export async function sendWhatsAppUnified(
  toPhone: string,
  text: string,
  options: SendWhatsAppOptions = {}
): Promise<SendWhatsAppResult> {
  const isBaileysActive = typeof options.baileysEnabled === "boolean"
    ? options.baileysEnabled
    : whatsappBotService.isBaileysEnabled();

  const cleanPhone = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();

  const baileysStatus = whatsappBotService.getStatus();
  if (baileysStatus.isConnected && isBaileysActive) {
    const baileysRes = await whatsappBotService.sendMessage(cleanPhone, text);
    return {
      success: baileysRes.success,
      via: "baileys",
      channelUsed: "baileys",
      message: baileysRes.message,
    };
  }

  if (!baileysStatus.isConnected) {
    return {
      success: false,
      channelUsed: "baileys",
      message: "Boss, WhatsApp (Baileys) abhi linked nahi hai. Kripya Dashboard se WhatsApp QR ya Pairing code scan karein.",
    };
  }

  return {
    success: false,
    channelUsed: "baileys",
    message: "WhatsApp Baileys bot disabled hai ya message send nahi ho paya.",
  };
}
