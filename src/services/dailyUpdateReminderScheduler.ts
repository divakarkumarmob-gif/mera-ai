import { whatsappBotService } from "./whatsappBotService";
import { dailyUpdateService, todayIST } from "./dailyUpdateService";

// ---------------------------------------------------------------------------
// Daily-update reminder scheduler.
//
// If DK hasn't logged an update for today yet, pings him on his own WhatsApp
// number every 2 hours asking him to dictate one. Stops nagging for the day
// the moment an update is logged (checked fresh on every poll), and resets
// naturally at midnight IST since todayIST() rolls over.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

class DailyUpdateReminderScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastPingDate: string | null = null; // IST date string of the last day we already pinged today

  public start() {
    if (this.intervalHandle) return; // already started
    this.intervalHandle = setInterval(() => this.checkAndPing(), POLL_INTERVAL_MS);
    console.log(`[DailyUpdateReminder] Started — polling every ${POLL_INTERVAL_MS / (60 * 60 * 1000)}h.`);
  }

  public stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async checkAndPing() {
    try {
      const hasUpdate = await dailyUpdateService.hasTodayUpdate();
      if (hasUpdate) return; // DK already logged something today — stay quiet

      const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
      if (!ownerPhone) {
        console.warn("[DailyUpdateReminder] OWNER_WHATSAPP_NUMBER not set — cannot send reminder.");
        return;
      }

      const status = whatsappBotService.getStatus();
      if (!status.isConnected) {
        console.warn("[DailyUpdateReminder] WhatsApp bot not connected — skipping this cycle.");
        return;
      }

      const sendRes = await whatsappBotService.sendMessage(ownerPhone, "Boss, aaj ka update kya hai? 😊");
      if (sendRes.success) {
        console.log(`[DailyUpdateReminder] Sent reminder for ${todayIST()}.`);
      } else {
        console.error(`[DailyUpdateReminder] Failed to send reminder: ${sendRes.message}`);
      }
    } catch (e) {
      console.error("[DailyUpdateReminder] Error during check:", e);
    }
  }
}

export const dailyUpdateReminderScheduler = new DailyUpdateReminderScheduler();
