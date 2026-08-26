import { sendWhatsAppUnified } from "./whatsappService";
import { fast2SmsService } from "./fast2SmsService";
import { contactsService } from "./contactsService";

export interface EmergencySosResult {
  success: boolean;
  timestamp: string;
  status: "dispatched" | "partial" | "logged";
  targetContact: string;
  channels: {
    whatsapp: boolean;
    sms: boolean;
  };
  message: string;
}

class EmergencySosService {
  /**
   * Dispatches instant dual-channel SOS emergency alert across WhatsApp and Cellular SMS.
   */
  public async triggerSos(
    customMessage?: string,
    targetPhoneOrContact?: string
  ): Promise<EmergencySosResult> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

    // 1. Resolve contact or phone
    let phone = "";
    const rawTarget = (targetPhoneOrContact || "").trim();

    if (rawTarget) {
      try {
        const found = await contactsService.findContact(rawTarget);
        if (found && found.phone) {
          phone = found.phone.replace(/\D/g, "").slice(-10);
        }
      } catch {}
      if (!phone) {
        const digits = rawTarget.replace(/\D/g, "");
        phone = digits.length >= 10 ? digits.slice(-10) : digits;
      }
    }

    if (!phone) {
      const ownerEnv = (process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || process.env.EMERGENCY_CONTACT_PHONE || "").replace(/\D/g, "");
      phone = ownerEnv.length >= 10 ? ownerEnv.slice(-10) : (ownerEnv || "9999999999");
    }

    const fullInternationalPhone = phone.length === 10 ? `91${phone}` : phone;

    const alertBody = customMessage || "URGENT EMERGENCY ALERT: User has triggered an SOS voice alert through Friday AI Assistant. Please check in immediately.";

    const sosText = `🚨 *EMERGENCY SOS ALERT — FRIDAY AI*\n\n⚠️ *STATUS: HIGH PRIORITY CRITICAL*\n🕒 *Time:* ${timeStr}, ${dateStr}\n\n📢 *Message:* ${alertBody}\n\n📍 _Dispatched automatically via Friday AI Multi-Channel Emergency Protocol_`;

    let whatsappSent = false;
    let smsSent = false;

    // 2. Channel 1: WhatsApp Alert (Unified: Baileys socket + Cloud API fallback)
    try {
      const waRes = await sendWhatsAppUnified(fullInternationalPhone, sosText);
      whatsappSent = waRes.success;
      if (whatsappSent) {
        console.log(`[EmergencySOS] Dispatched WhatsApp SOS alert to +${fullInternationalPhone} via ${waRes.via || "WhatsApp"}`);
      }
    } catch (waErr) {
      console.warn("[EmergencySOS] WhatsApp dispatch error:", waErr);
    }

    // 3. Channel 2: Cellular SMS Alert (Fast2SMS Gateway)
    try {
      const smsRes = await fast2SmsService.sendSms(phone, `[EMERGENCY SOS] ${alertBody.slice(0, 120)}`);
      smsSent = smsRes.success;
      if (smsSent) {
        console.log(`[EmergencySOS] Dispatched cellular SMS alert to ${phone} via Fast2SMS.`);
      }
    } catch (smsErr) {
      console.warn("[EmergencySOS] SMS dispatch note:", smsErr);
    }

    let status: EmergencySosResult["status"] = "logged";
    if (whatsappSent && smsSent) {
      status = "dispatched";
    } else if (whatsappSent || smsSent) {
      status = "partial";
    }

    const message = whatsappSent || smsSent
      ? `🚨 Boss, Emergency SOS alert trigger ho gaya hai! Primary contact (+${fullInternationalPhone}) par instant alert dispatch kar diya gaya hai (WhatsApp: ${whatsappSent ? "✅" : "❌"}, SMS: ${smsSent ? "✅" : "❌"}).`
      : `🚨 Emergency alert logged locally. (Kripya verify karein WhatsApp/SMS configuration).`;

    return {
      success: true,
      timestamp: `${timeStr}, ${dateStr}`,
      status,
      targetContact: `+${fullInternationalPhone}`,
      channels: {
        whatsapp: whatsappSent,
        sms: smsSent,
      },
      message,
    };
  }
}

export const emergencySosService = new EmergencySosService();
