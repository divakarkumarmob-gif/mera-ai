import { db } from "./firebaseAdmin";

export interface ProactiveNudgeLog {
  id: string;
  type: "meal_nudge" | "hydration_break" | "weather_moment" | "life_event_followup" | "night_winddown" | "morning_greeting";
  text: string;
  timestamp: number;
  dateStr: string;
}

const nudgesCol = () => db.collection("memory").doc("proactiveInsights").collection("nudges");

class ProactiveCompanionEngine {
  private lastNudgeTime = 0;
  private dailyNudgeCount = 0;
  private currentDayStr = "";
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.currentDayStr = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
      const snap = await nudgesCol().where("dateStr", "==", this.currentDayStr).get();
      this.dailyNudgeCount = snap.size;
      this.isInitialized = true;
    } catch {
      this.isInitialized = true;
    }
  }

  /**
   * Evaluates if Friday should proactively send a warm check-in to Boss.
   * Ensures max 2-3 pings a day and only at contextually appropriate moments.
   */
  public async evaluateAndGenerateProactiveNudge(context: {
    isBossActiveRecently: boolean;
    lastMessageTimeAgoMinutes: number;
    currentISTHour: number;
    city?: string;
  }): Promise<{ shouldSend: boolean; nudgeText?: string; nudgeType?: ProactiveNudgeLog["type"] }> {
    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    if (this.currentDayStr !== today) {
      this.currentDayStr = today;
      this.dailyNudgeCount = 0;
    }

    // Rate limit: Max 3 proactive nudges per day, with at least 3.5 hours between nudges
    if (this.dailyNudgeCount >= 3) {
      return { shouldSend: false };
    }

    const now = Date.now();
    const timeSinceLastNudgeMs = now - this.lastNudgeTime;
    if (this.lastNudgeTime > 0 && timeSinceLastNudgeMs < 3.5 * 60 * 60 * 1000) {
      return { shouldSend: false };
    }

    const { currentISTHour, lastMessageTimeAgoMinutes } = context;

    // 1. Afternoon Lunch / Hydration Check (1:30 PM - 2:45 PM) if Boss was active before
    if (currentISTHour >= 13 && currentISTHour <= 14 && lastMessageTimeAgoMinutes > 45) {
      return {
        shouldSend: true,
        nudgeType: "meal_nudge",
        nudgeText: `Boss, dopahar ke 2 baj gaye hain! Agar continuous screen ke saamne hain toh 15 minute ka break le lijiye aur lunch kar lijiye 🥗 Thoda aaram zaroori hai! 👍`,
      };
    }

    // 2. Evening Chai / Fresh Air Check (6:00 PM - 7:30 PM)
    if (currentISTHour >= 18 && currentISTHour <= 19 && lastMessageTimeAgoMinutes > 60) {
      return {
        shouldSend: true,
        nudgeType: "hydration_break",
        nudgeText: `Boss, shaam ke 6:30 ho rahe hain ☕ Din bhar ke heavy work ke baad thodi der fresh hawa lene ya chai peene ka time hai! Sab theek chal raha hai na?`,
      };
    }

    // 3. Late Night Care Check (11:45 PM - 1:00 AM) if Boss is still awake/active
    if ((currentISTHour >= 23 || currentISTHour === 0) && context.isBossActiveRecently) {
      return {
        shouldSend: true,
        nudgeType: "night_winddown",
        nudgeText: `Boss, raat ka 12 baj raha hai! Agar late-night coding chal rahi hai toh aankho par zyada strain mat lijiye. Paani pee lijiye aur thodi der me wrap-up kar lijiye 🌙`,
      };
    }

    return { shouldSend: false };
  }

  /**
   * Logs a delivered proactive nudge to Firestore to prevent repetition.
   */
  public async logDeliveredNudge(type: ProactiveNudgeLog["type"], text: string): Promise<void> {
    this.lastNudgeTime = Date.now();
    this.dailyNudgeCount++;

    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    const id = `nudge_${Date.now()}`;
    const log: ProactiveNudgeLog = {
      id,
      type,
      text,
      timestamp: Date.now(),
      dateStr: today,
    };

    try {
      await nudgesCol().doc(id).set(log);
    } catch {}
  }
}

export const proactiveCompanionEngine = new ProactiveCompanionEngine();
