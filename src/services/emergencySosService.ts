import { whatsappCloudService } from "./whatsappCloudService";

export interface EmergencySosResult {
  success: boolean;
  timestamp: string;
  status: "dispatched" | "logged";
  targetContact?: string;
  message: string;
}

class EmergencySosService {
  public async triggerSos(customMessage?: string, targetPhone?: string): Promise<EmergencySosResult> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

    const phone = targetPhone || process.env.BOSS_WHATSAPP_NUMBER || process.env.EMERGENCY_CONTACT_PHONE || "919999999999";
    const alertBody = customMessage || "URGENT EMERGENCY ALERT: User has triggered an SOS voice alert through Friday AI Assistant. Please check in immediately.";

    const sosText = `🚨 *EMERGENCY SOS ALERT — FRIDAY AI*\n\n⚠️ *STATUS: HIGH PRIORITY*\n🕒 *Time:* ${timeStr}, ${dateStr}\n\n📢 *Message:* ${alertBody}\n\n📍 _Sent automatically via Friday AI Security Protocol_`;

    let status: "dispatched" | "logged" = "logged";

    try {
      await whatsappCloudService.sendTextMessage(phone, sosText);
      status = "dispatched";
    } catch (err) {
      console.warn("[EmergencySOS] Could not dispatch WhatsApp message:", err);
    }

    const message = `🚨 Boss, Emergency SOS alert trigger ho gaya hai! ${status === "dispatched" ? `Aapke primary contact (${phone}) ko instant WhatsApp alert bhej diya gaya hai!` : "Emergency protocol log kar diya gaya hai!"}`;

    return {
      success: true,
      timestamp: timeStr,
      status,
      targetContact: phone,
      message,
    };
  }
}

export const emergencySosService = new EmergencySosService();
