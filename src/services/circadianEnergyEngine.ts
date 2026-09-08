export interface CircadianPhaseInfo {
  phase: "morning_energy" | "afternoon_focus" | "evening_chill" | "night_intimacy";
  vibeName: string;
  greetingStyle: string;
  energyLevel: "high" | "focused" | "relaxed" | "calm_soft";
  conversationalGuideline: string;
}

class CircadianEnergyEngine {
  /**
   * Returns current IST hour and minute safely.
   */
  public getISTTime(date: Date = new Date()): { hours: number; minutes: number; timeStr: string } {
    const istString = date.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
    const istDate = new Date(istString);
    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const timeStr = date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
    return { hours, minutes, timeStr };
  }

  /**
   * Resolves the active Circadian Phase based on Indian Standard Time.
   */
  public getCurrentCircadianPhase(date: Date = new Date()): CircadianPhaseInfo {
    const { hours, timeStr } = this.getISTTime(date);

    // 1. Morning (06:00 AM - 11:30 AM)
    if (hours >= 6 && hours < 11.5) {
      return {
        phase: "morning_energy",
        vibeName: "Morning Fresh Energy & Ambition 🌅",
        greetingStyle: "High energy, inspiring, fresh, positive! ('Good morning Boss! Aaj din me kuch kamaal karte hain!')",
        energyLevel: "high",
        conversationalGuideline: "Speak with vibrant clarity, encourage Boss's goals, and project high optimism.",
      };
    }

    // 2. Afternoon (11:30 AM - 05:30 PM)
    if (hours >= 11.5 && hours < 17.5) {
      return {
        phase: "afternoon_focus",
        vibeName: "Afternoon Laser Focus & High Productivity ⚡",
        greetingStyle: "Sharp, fast, efficient, supportive ('Haanji Boss! Bilkul ready, bataiye kya execute karein?')",
        energyLevel: "focused",
        conversationalGuideline: "Be direct, solve technical and daily tasks rapidly, respect Boss's deep focus workflow.",
      };
    }

    // 3. Evening (05:30 PM - 09:30 PM)
    if (hours >= 17.5 && hours < 21.5) {
      return {
        phase: "evening_chill",
        vibeName: "Evening Unwind, Chai & Warm Camaraderie ☕",
        greetingStyle: "Warm, relaxed, friendly, companionable ('Shaam ke sukoon ke sath, bataiye Boss kya haal chal!')",
        energyLevel: "relaxed",
        conversationalGuideline: "Adopt a relaxed, conversational tone. Mention tea breaks, unwinding after work, casual check-ins.",
      };
    }

    // 4. Night (09:30 PM - 05:30 AM)
    return {
      phase: "night_intimacy",
      vibeName: "Late-Night Soft Intimacy, Calm & Reflection 🌙",
      greetingStyle: "Soft, gentle, peaceful, soothing, low volume ('Raat ke sukoon me Boss... bataiye main kya sunau ya help karu?')",
      energyLevel: "calm_soft",
      conversationalGuideline: "Lower vocal intensity, speak in a gentle soothing cadence. If Boss is coding late, offer gentle company without loud jarring tones.",
    };
  }

  /**
   * Compiles the dynamic Circadian context prompt.
   */
  public compileCircadianPrompt(date: Date = new Date()): string {
    const { hours, minutes, timeStr } = this.getISTTime(date);
    const phaseInfo = this.getCurrentCircadianPhase(date);

    return `============================================================
⏳ CIRCADIAN ENERGY & MOOD RHYTHM (Natural Human Time Adaptation):
• Current IST Time: ${timeStr}
• Active Circadian Mood: ${phaseInfo.vibeName}
• Current Energy Setting: ${phaseInfo.energyLevel.toUpperCase()}
• Natural Greeting Style: ${phaseInfo.greetingStyle}
• Human Vibe Rule: ${phaseInfo.conversationalGuideline}
============================================================`;
  }
}

export const circadianEnergyEngine = new CircadianEnergyEngine();
