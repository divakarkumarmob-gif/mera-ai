import { toolsEngine, ReminderItem } from "./toolsEngine";
import { whatsappBotService } from "./whatsappBotService";

// ---------------------------------------------------------------------------
// Reminder scheduler — the missing piece from Bug #8.
//
// toolsEngine.addReminder() only ever wrote a document to Firestore; nothing
// ever checked whether a reminder's due time had passed, so reminders never
// actually fired. This service polls Firestore every 30s for due-but-not-
// completed reminders and delivers them:
//   1. Via WhatsApp to DK's own number (OWNER_WHATSAPP_NUMBER env var), if
//      the WhatsApp bot is connected.
//   2. Via a WebSocket push to any currently-connected live-voice clients,
//      so the app UI can show/speak the reminder if it's open.
// Either way, the reminder is marked completed so it doesn't fire twice.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30 * 1000;

type NotifyClientsFn = (reminder: ReminderItem) => void;

class ReminderScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private notifyClients: NotifyClientsFn | null = null;
  private isChecking = false;

  /** Called once from server.ts, passing a function to push a reminder to any connected live clients. */
  public start(notifyClients: NotifyClientsFn) {
    this.notifyClients = notifyClients;
    if (this.intervalHandle) return; // already started
    this.intervalHandle = setInterval(() => this.checkDueReminders(), POLL_INTERVAL_MS);
    // Also do an immediate check on startup, in case reminders became due
    // while the server was down/restarting.
    this.checkDueReminders();
    console.log(`[ReminderScheduler] Started — polling every ${POLL_INTERVAL_MS / 1000}s.`);
  }

  public stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async checkDueReminders() {
    if (this.isChecking) return; // avoid overlapping polls if one run is slow
    this.isChecking = true;
    try {
      const due = await toolsEngine.getDueReminders();
      for (const reminder of due) {
        await this.fireReminder(reminder);
      }
    } catch (e) {
      console.error("[ReminderScheduler] Error checking due reminders:", e);
    } finally {
      this.isChecking = false;
    }
  }

  private async fireReminder(reminder: ReminderItem) {
    console.log(`[ReminderScheduler] Firing reminder: "${reminder.title}"`);

    // 1. Push to any connected live-voice clients so the open app can show/speak it.
    try {
      this.notifyClients?.(reminder);
    } catch (e) {
      console.error("[ReminderScheduler] Failed to notify connected clients:", e);
    }

    // 2. Send via WhatsApp to the owner's number, if configured and connected.
    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (ownerPhone) {
      const status = whatsappBotService.getStatus();
      if (status.isConnected) {
        const message = `⏰ Reminder: ${reminder.title}${reminder.timeString ? ` (${reminder.timeString})` : ""}`;
        const sendRes = await whatsappBotService.sendMessage(ownerPhone, message);
        if (!sendRes.success) {
          console.error(`[ReminderScheduler] Failed to deliver reminder via WhatsApp: ${sendRes.message}`);
        }
      } else {
        console.warn("[ReminderScheduler] WhatsApp bot not connected — reminder will only reach an open app, if any.");
      }
    } else {
      console.warn(
        "[ReminderScheduler] OWNER_WHATSAPP_NUMBER not set — skipping WhatsApp delivery. " +
          "Set it in your .env to receive reminders on WhatsApp even when the app isn't open."
      );
    }

    // Mark completed either way, so it never fires twice. If both delivery
    // paths failed (app closed + WhatsApp not connected), the reminder is
    // still visible in the /api/reminders list with its original due time.
    await toolsEngine.markReminderCompleted(reminder.id);
  }
}

export const reminderScheduler = new ReminderScheduler();
