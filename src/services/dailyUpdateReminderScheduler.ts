import { sendWhatsAppUnified } from "./whatsappService";
import { dailyUpdateService, todayIST } from "./dailyUpdateService";

// ---------------------------------------------------------------------------
// Daily-update reminder scheduler.
//
// If DK hasn't logged an update for today yet, pings him on his own WhatsApp
// number asking him to dictate one. Stops nagging for the day the moment an update
// is logged, respects quiet hours (11 PM - 8 AM IST), and resets naturally at midnight.
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

class DailyUpdateReminderScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastPingTimestamp: number = 0;

  public start(intervalMs = DEFAULT_POLL_INTERVAL_MS) {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.checkAndPing(false), intervalMs);
    console.log(`[DailyUpdateReminder] Started — polling every ${Math.round(intervalMs / 60000)} mins.`);
  }

  public stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log("[DailyUpdateReminder] Stopped scheduler.");
    }
  }

  /**
   * Triggers an immediate reminder check (optionally bypassing quiet hours and already-logged check).
   */
  public async triggerNow(force: boolean = false): Promise<{ success: boolean; message: string }> {
    return this.checkAndPing(force);
  }

  public async checkAndPing(force: boolean = false): Promise<{ success: boolean; message: string }> {
    try {
      // 1. Check if DK has already logged today's update
      const hasUpdate = await dailyUpdateService.hasTodayUpdate();
      if (hasUpdate && !force) {
        return {
          success: false,
          message: `Boss ne aaj (${todayIST()}) ka update pehle hi de diya hai. Reminder skipped.`,
        };
      }

      // 2. Quiet hours check: 11 PM to 8 AM IST (skip unless forced)
      const istHours = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
      if (!force && (istHours >= 23 || istHours < 8)) {
        console.log(`[DailyUpdateReminder] Quiet hours active (${istHours}:00 IST). Skipping reminder ping.`);
        return {
          success: false,
          message: "Quiet hours active (11 PM - 8 AM IST). Night reminder suppressed.",
        };
      }

      // 3. Minimum cooldown check (at least 45 minutes between pings unless forced)
      const now = Date.now();
      if (!force && now - this.lastPingTimestamp < 45 * 60 * 1000) {
        return {
          success: false,
          message: "Cooldown active: pichhle 45 minutes me reminder bhej chuke hain.",
        };
      }

      const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "").replace(/\D/g, "");
      if (!ownerPhone) {
        console.warn("[DailyUpdateReminder] OWNER_WHATSAPP_NUMBER not set — cannot send WhatsApp reminder.");
        return {
          success: false,
          message: "OWNER_WHATSAPP_NUMBER environment variable is not configured.",
        };
      }

      const reminderText = "Boss, aaj ka update kya hai? 😊 Voice note ya text me bhej dijiye, main record kar lungi!";
      const sendRes = await sendWhatsAppUnified(ownerPhone, reminderText);

      if (sendRes.success) {
        this.lastPingTimestamp = now;
        console.log(`[DailyUpdateReminder] Sent reminder for ${todayIST()} via ${sendRes.via || "WhatsApp"}.`);
        return {
          success: true,
          message: `Reminder sent to Boss (+${ownerPhone}) via ${sendRes.via || "WhatsApp"}.`,
        };
      } else {
        console.warn(`[DailyUpdateReminder] Reminder delivery failed: ${sendRes.message}`);
        return {
          success: false,
          message: `Failed to deliver reminder: ${sendRes.message}`,
        };
      }
    } catch (e: any) {
      console.error("[DailyUpdateReminder] Error during check:", e);
      return {
        success: false,
        message: `Error during check: ${e?.message || e}`,
      };
    }
  }
}

export const dailyUpdateReminderScheduler = new DailyUpdateReminderScheduler();
