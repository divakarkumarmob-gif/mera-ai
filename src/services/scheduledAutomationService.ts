/**
 * Scheduled Automation Service for Friday AI
 * 
 * Handles automated cron routines and timed outbound contact messages:
 * 1. Recurring Morning & Daily Updates:
 *    - "subah 6 bje weather update bhejna" (Daily at 06:00 AM IST)
 *    - "6:10 me top 10 news bhejna" (Daily at 06:10 AM IST)
 *    - Custom days: "har monday ko", "weekdays par", "weekends par"
 * 2. Timed Outbound WhatsApp Contact Dispatch:
 *    - "5 bje ram ko msg karna, chlo ghumne" (Sends WhatsApp message to Ram at 5:00 PM / 17:00 IST)
 */

import { db } from "./firebaseAdmin";
import { weatherService } from "./weatherService";
import { newsService } from "./newsService";
import { contactsService } from "./contactsService";
import { sendWhatsAppUnified } from "./whatsappService";

export interface ScheduledTask {
  id: string;
  type: "recurring_cron" | "one_time_message";
  title: string;
  targetHour: number; // 0 - 23 (IST)
  targetMinute: number; // 0 - 59
  timeString: string; // e.g. "06:00 AM", "06:10 AM", "05:00 PM"
  frequency: "daily" | "weekdays" | "weekends" | "once" | string; // e.g. "monday", "tuesday,thursday"
  actionType: "weather_update" | "news_briefing" | "whatsapp_contact_message" | "custom_prompt";
  targetContactName?: string;
  targetPhone?: string;
  messageBody?: string;
  city?: string;
  lastRunDate?: string; // YYYY-MM-DD
  status: "active" | "completed" | "cancelled";
  createdAt: number;
  updatedAt: number;
}

const automationsCol = () => db.collection("scheduledAutomations");

class ScheduledAutomationService {
  private inMemoryTasks: Map<string, ScheduledTask> = new Map();
  private intervalHandle: NodeJS.Timeout | null = null;
  private isChecking = false;
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      const snap = await automationsCol().where("status", "==", "active").get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const task = { id: doc.id, ...(doc.data() as any) } as ScheduledTask;
          this.inMemoryTasks.set(task.id, task);
        }
      }
      this.isInitialized = true;
      console.log(`[ScheduledAutomationService] Loaded ${this.inMemoryTasks.size} active automations from Firestore.`);
    } catch (e: any) {
      console.warn("[ScheduledAutomationService] Firestore init warning:", e?.message || e);
      this.isInitialized = true;
    }
  }

  /**
   * Starts the background scheduler loop (checks every 30s).
   */
  public start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.checkDueAutomations(), 30 * 1000);
    this.checkDueAutomations();
    console.log("[ScheduledAutomationService] Background runner active (polling every 30s).");
  }

  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Helper: Parses natural time string to IST hour & minute.
   * Examples: "6:00 AM", "6:10 am", "6 baje", "subah 6 bje", "5 bje", "17:00", "5:00 PM"
   */
  public parseTimeString(timeStr: string): { hour: number; minute: number; formatted: string } | null {
    const raw = (timeStr || "").toLowerCase().trim();
    if (!raw) return null;

    let isPM = raw.includes("pm") || raw.includes("shaam") || raw.includes("raat") || raw.includes("dopahar");
    const isAM = raw.includes("am") || raw.includes("subah") || raw.includes("pratah");

    // Match HH:MM
    const colonMatch = raw.match(/(\d{1,2})[:.](\d{2})/);
    if (colonMatch) {
      let h = parseInt(colonMatch[1], 10);
      const m = parseInt(colonMatch[2], 10);
      if (isPM && h < 12) h += 12;
      if (isAM && h === 12) h = 0;
      const formatted = `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? "0" + m : m} ${h >= 12 ? "PM" : "AM"}`;
      return { hour: h, minute: m, formatted };
    }

    // Match single hour: "6 baje", "6 bje", "5 pm", "5pm", "6 am"
    const singleHourMatch = raw.match(/(\d{1,2})\s*(?:baje|bje|am|pm|o'clock|hr|hrs)?/);
    if (singleHourMatch) {
      let h = parseInt(singleHourMatch[1], 10);
      // Heuristic: if no AM/PM specified, numbers 1-7 in context of "chlo ghumne" or "msg" usually mean PM (13-19)
      if (!isAM && !isPM) {
        if (h >= 1 && h <= 7 && (raw.includes("ghumne") || raw.includes("shaam") || raw.includes("milte"))) {
          isPM = true;
        } else if (h >= 1 && h <= 5 && !raw.includes("subah")) {
          isPM = true;
        }
      }
      if (isPM && h < 12) h += 12;
      if (isAM && h === 12) h = 0;
      const formatted = `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;
      return { hour: h, minute: 0, formatted };
    }

    return null;
  }

  /**
   * Creates a recurring automated cron task for Boss (e.g. 6 AM weather, 6:10 AM top news).
   */
  public async createCronTask(opts: {
    title: string;
    timeString: string;
    frequency?: string; // "daily", "weekdays", "weekends", "monday", etc.
    actionType: "weather_update" | "news_briefing" | "custom_prompt";
    city?: string;
    messageBody?: string;
  }): Promise<{ success: boolean; message: string; task?: ScheduledTask }> {
    const parsedTime = this.parseTimeString(opts.timeString);
    if (!parsedTime) {
      return { success: false, message: `Time format samajh nahi aaya: "${opts.timeString}". Kripya '6:00 AM' ya '6:10 AM' specify karein.` };
    }

    const id = `cron_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task: ScheduledTask = {
      id,
      type: "recurring_cron",
      title: opts.title || `${parsedTime.formatted} ${opts.actionType.replace("_", " ")}`,
      targetHour: parsedTime.hour,
      targetMinute: parsedTime.minute,
      timeString: parsedTime.formatted,
      frequency: (opts.frequency || "daily").toLowerCase(),
      actionType: opts.actionType,
      city: opts.city || "Patna",
      messageBody: opts.messageBody,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await automationsCol().doc(id).set(task);
      this.inMemoryTasks.set(id, task);
      return {
        success: true,
        message: `✅ Scheduled! Har ${task.frequency === "daily" ? "roz" : task.frequency} subah/shaam *${task.timeString} IST* par Friday aapko *${task.title}* WhatsApp par send kar degi!`,
        task,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to save scheduled task: ${e?.message || e}` };
    }
  }

  /**
   * Schedules a one-off or recurring WhatsApp message to be sent to a contact (e.g. "5 bje ram ko msg karna, chlo ghumne").
   */
  public async scheduleContactMessage(opts: {
    contactNameOrPhone: string;
    messageBody: string;
    timeString: string;
    frequency?: string;
  }): Promise<{ success: boolean; message: string; task?: ScheduledTask }> {
    const parsedTime = this.parseTimeString(opts.timeString);
    if (!parsedTime) {
      return { success: false, message: `Time format samajh nahi aaya: "${opts.timeString}". Kripya '5:00 PM' ya '17:00' specify karein.` };
    }

    // Resolve contact name or phone
    const contact = await contactsService.findContact(opts.contactNameOrPhone);
    const resolvedName = contact ? contact.name : opts.contactNameOrPhone;
    const resolvedPhone = contact ? contact.phone : String(opts.contactNameOrPhone).replace(/\D/g, "");

    if (!resolvedPhone) {
      return {
        success: false,
        message: `Contact "${opts.contactNameOrPhone}" ka phone number nahi mila. Kripya pehle save karein ya phone number bolein.`,
      };
    }

    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task: ScheduledTask = {
      id,
      type: opts.frequency && opts.frequency !== "once" ? "recurring_cron" : "one_time_message",
      title: `Message to ${resolvedName} at ${parsedTime.formatted}`,
      targetHour: parsedTime.hour,
      targetMinute: parsedTime.minute,
      timeString: parsedTime.formatted,
      frequency: (opts.frequency || "once").toLowerCase(),
      actionType: "whatsapp_contact_message",
      targetContactName: resolvedName,
      targetPhone: resolvedPhone,
      messageBody: opts.messageBody,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await automationsCol().doc(id).set(task);
      this.inMemoryTasks.set(id, task);
      return {
        success: true,
        message: `✅ Scheduled! Friday *${task.timeString} IST* par *${resolvedName}* (+${resolvedPhone}) ko message bhej degi:\n\n💬 _"${opts.messageBody}"_`,
        task,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to schedule contact message: ${e?.message || e}` };
    }
  }

  /**
   * Lists all active scheduled tasks and contact messages.
   */
  public async listAutomations(): Promise<ScheduledTask[]> {
    return Array.from(this.inMemoryTasks.values()).filter((t) => t.status === "active");
  }

  /**
   * Cancels/deletes a scheduled automation by ID or query.
   */
  public async cancelAutomation(idOrQuery: string): Promise<{ success: boolean; message: string }> {
    const q = idOrQuery.toLowerCase().trim();
    for (const [id, task] of this.inMemoryTasks.entries()) {
      if (id === q || task.title.toLowerCase().includes(q) || task.targetContactName?.toLowerCase().includes(q)) {
        task.status = "cancelled";
        task.updatedAt = Date.now();
        await automationsCol().doc(id).update({ status: "cancelled", updatedAt: Date.now() }).catch(() => {});
        this.inMemoryTasks.delete(id);
        return { success: true, message: `Scheduled automation "${task.title}" successfully cancel kar di gayi.` };
      }
    }
    return { success: false, message: `Koi matching scheduled task nahi mila: "${idOrQuery}".` };
  }

  /**
   * Background Checker: Evaluates active tasks every 30s against current IST clock.
   */
  private async checkDueAutomations(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const now = new Date();
      const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
      const istDate = new Date(istString);
      const currentHour = istDate.getHours();
      const currentMinute = istDate.getMinutes();
      const todayDateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
      const dayName = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" }).toLowerCase();

      for (const task of Array.from(this.inMemoryTasks.values())) {
        if (task.status !== "active") continue;

        // Check time match (Hour & Minute)
        if (task.targetHour === currentHour && task.targetMinute === currentMinute) {
          // Check if already ran today
          if (task.lastRunDate === todayDateStr) continue;

          // Check frequency match
          if (!this.matchesFrequency(task.frequency, dayName)) continue;

          console.log(`[ScheduledAutomationService] Executing automation: "${task.title}" (Type: ${task.actionType})`);
          await this.executeTask(task, todayDateStr);
        }
      }
    } catch (err) {
      console.error("[ScheduledAutomationService] Error during poll execution:", err);
    } finally {
      this.isChecking = false;
    }
  }

  private matchesFrequency(freq: string, currentDay: string): boolean {
    const f = (freq || "daily").toLowerCase();
    if (f === "daily" || f === "once" || f === "everyday") return true;
    if (f === "weekdays" && !["saturday", "sunday"].includes(currentDay)) return true;
    if (f === "weekends" && ["saturday", "sunday"].includes(currentDay)) return true;
    if (f.includes(currentDay) || currentDay.startsWith(f.slice(0, 3))) return true;
    return false;
  }

  /**
   * Executes the exact scheduled action.
   */
  private async executeTask(task: ScheduledTask, todayDateStr: string): Promise<void> {
    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER || process.env.BOT_OWNER_NUMBER;

    try {
      if (task.actionType === "weather_update") {
        const city = task.city || "Patna";
        const weatherRes = await weatherService.getCurrentWeather(city);
        const header = `🌤️ *Morning Weather Update (${city})* — _${task.timeString}_`;
        const weatherText = `${header}\n\n${weatherRes.message || "Weather update fetched successfully."}\n\n_Have a productive day, Boss!_ ⚡`;

        if (ownerPhone) {
          await sendWhatsAppUnified(ownerPhone, weatherText);
        }
      } else if (task.actionType === "news_briefing") {
        const newsRes = await newsService.getLatestNews("India top news breaking");
        const articles = (newsRes.articles || []).slice(0, 10);
        let newsText = `📰 *Top 10 Morning News Headlines* — _${task.timeString}_\n\n`;
        if (articles.length > 0) {
          articles.forEach((a: any, idx: number) => {
            newsText += `*${idx + 1}.* ${a.title || a.headline}\n`;
            if (a.source) newsText += `   _${a.source}_\n`;
          });
        } else {
          newsText += newsRes.message || "Daily morning news briefing.";
        }
        newsText += `\n_Friday AI Morning Intelligence Brief_ ⚡`;

        if (ownerPhone) {
          await sendWhatsAppUnified(ownerPhone, newsText);
        }
      } else if (task.actionType === "whatsapp_contact_message") {
        if (task.targetPhone && task.messageBody) {
          const { whatsappBotService } = await import("./whatsappBotService");
          await whatsappBotService.sendMessage(task.targetPhone, task.messageBody);

          // Confirm execution to Boss
          if (ownerPhone) {
            const confirmText = `✅ *[Scheduled Message Delivered]*\nBoss, aapka schedule kiya gaya message *${task.targetContactName || task.targetPhone}* (+${task.targetPhone}) ko deliver kar diya gaya:\n\n💬 _"${task.messageBody}"_`;
            await sendWhatsAppUnified(ownerPhone, confirmText);
          }
        }
      }

      // Mark run
      task.lastRunDate = todayDateStr;
      if (task.type === "one_time_message" || task.frequency === "once") {
        task.status = "completed";
        this.inMemoryTasks.delete(task.id);
      }

      await automationsCol().doc(task.id).update({
        lastRunDate: todayDateStr,
        status: task.status,
        updatedAt: Date.now(),
      });
    } catch (execErr) {
      console.error(`[ScheduledAutomationService] Failed to execute task ${task.id}:`, execErr);
    }
  }
}

export const scheduledAutomationService = new ScheduledAutomationService();
