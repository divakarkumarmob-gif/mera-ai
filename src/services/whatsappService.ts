import { whatsappCloudService } from "./whatsappCloudService";
import { whatsappBotService } from "./whatsappBotService";
import { db } from "./firebaseAdmin";

export type WhatsAppPrimaryChannel = "whatsapp1" | "whatsapp2" | "auto";

export interface SendWhatsAppOptions {
  /**
   * "whatsapp1" = Official Meta WhatsApp Cloud API
   * "whatsapp2" = WhatsApp Baileys Multi-Device Bot
   * "auto"      = Uses remembered primary channel (or smart fallback)
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

const channelMetaDoc = () => db.collection("whatsapp_auth").doc("session").collection("meta").doc("channel_meta");

let cachedPrimaryChannel: WhatsAppPrimaryChannel = "whatsapp2";
let isChannelLoaded = false;

/**
 * Gets the current remembered primary WhatsApp channel preference.
 * Persisted in Firestore so it survives server restarts.
 * Defaults to WhatsApp 2 (Baileys Multi-Device Bot).
 */
export async function getPrimaryWhatsAppChannel(): Promise<WhatsAppPrimaryChannel> {
  if (isChannelLoaded) return cachedPrimaryChannel;
  try {
    const snap = await channelMetaDoc().get();
    if (snap.exists && snap.data()?.primaryChannel) {
      cachedPrimaryChannel = snap.data()!.primaryChannel as WhatsAppPrimaryChannel;
    } else {
      cachedPrimaryChannel = "whatsapp2";
    }
    isChannelLoaded = true;
  } catch (e) {
    console.warn("[WhatsApp] Could not load primary WhatsApp channel preference:", e);
    cachedPrimaryChannel = "whatsapp2";
  }
  return cachedPrimaryChannel;
}

/**
 * Sets and permanently remembers DK's primary WhatsApp channel (WhatsApp 1 or WhatsApp 2).
 */
export async function setPrimaryWhatsAppChannel(channel: string): Promise<{ success: boolean; message: string; channel: WhatsAppPrimaryChannel }> {
  const norm = String(channel || "").trim().toLowerCase();
  const clean: WhatsAppPrimaryChannel =
    norm === "whatsapp2" || norm === "2" || norm.includes("2") || norm.includes("baileys") ? "whatsapp2"
      : norm === "whatsapp1" || norm === "1" || norm.includes("1") || norm.includes("cloud") ? "whatsapp1"
        : "auto";

  cachedPrimaryChannel = clean;
  isChannelLoaded = true;
  try {
    await channelMetaDoc().set({ primaryChannel: clean, updatedAt: Date.now() }, { merge: true });
    console.log(`[WhatsApp] Primary WhatsApp channel updated & saved to Firestore: ${clean}`);
  } catch (e: any) {
    console.warn("[WhatsApp] Could not persist primary channel preference:", e);
  }

  const channelLabel =
    clean === "whatsapp2" ? "WhatsApp 2 (Baileys Dedicated Bot)"
      : clean === "whatsapp1" ? "WhatsApp 1 (Official Meta Cloud API)"
        : "Auto Mode (Smart Dual Failover)";

  return {
    success: true,
    channel: clean,
    message: `Theek hai boss! Maine yaad rakh liya hai ki primary WhatsApp channel **${channelLabel}** hai. Aage se saare messages direct isi channel se bheje jayenge!`,
  };
}

/**
 * Dual WhatsApp message dispatcher:
 * - WhatsApp 1: Official Meta Cloud API (ban-safe, high reliability)
 * - WhatsApp 2: Baileys Multi-Device Bot (personal/spare number, bypasses 24h Meta restriction)
 * Automatically respects DK's remembered primary channel!
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

  // Resolve requested channel or fall back to remembered primary channel
  let targetChannel = options.channel && options.channel !== "auto"
    ? options.channel
    : await getPrimaryWhatsAppChannel();

  // ── 1. DIRECT CHANNEL: WhatsApp 2 (Baileys Dedicated Bot) ─────────────────
  if (targetChannel === "whatsapp2") {
    const baileysStatus = whatsappBotService.getStatus();
    if (baileysStatus.isConnected && isBaileysActive) {
      const baileysRes = await whatsappBotService.sendMessage(cleanPhone, text);
      if (baileysRes.success) {
        return {
          success: true,
          via: "baileys",
          channelUsed: "whatsapp2",
          message: baileysRes.message,
        };
      }
      console.warn(`[WhatsApp] Primary WhatsApp 2 send failed (${baileysRes.message}). Attempting fallback to WhatsApp 1...`);
    } else {
      console.warn(`[WhatsApp] WhatsApp 2 requested but not connected/enabled. Attempting fallback to WhatsApp 1...`);
    }

    // Fallback to WhatsApp 1 if WhatsApp 2 was unavailable/failed
    const cloudStatus = whatsappCloudService.getStatus();
    if (cloudStatus.configured) {
      const cloudRes = await whatsappCloudService.sendMessage(cleanPhone, text);
      if (cloudRes.success) {
        return {
          success: true,
          via: "cloud_api",
          channelUsed: "whatsapp1",
          message: `Delivered via WhatsApp 1 (Cloud API) as WhatsApp 2 was unavailable.`,
        };
      }
    }

    if (!baileysStatus.isConnected) {
      return {
        success: false,
        channelUsed: "whatsapp2",
        message: "Boss, WhatsApp 2 (Baileys) abhi linked nahi hai aur WhatsApp 1 bhi available nahi hai. Kripya WhatsApp 2 link karein.",
      };
    }

    return {
      success: false,
      channelUsed: "whatsapp2",
      message: "WhatsApp 2 aur WhatsApp 1 dono se message send nahi ho paya.",
    };
  }

  // ── 2. DIRECT CHANNEL / DEFAULT: WhatsApp 1 (Official Meta Cloud API) ─────
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
