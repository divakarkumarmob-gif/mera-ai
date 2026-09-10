import { db } from "./firebaseAdmin";

export type FridayInteractionMode = "mode_a" | "mode_b";

class FridayModeService {
  private currentMode: FridayInteractionMode = "mode_a";
  private isLoaded = false;

  private modeDoc() {
    return db.collection("friday_system_settings").doc("interaction_mode");
  }

  public async getMode(): Promise<FridayInteractionMode> {
    if (this.isLoaded) return this.currentMode;
    try {
      const snap = await this.modeDoc().get();
      if (snap.exists && snap.data()?.mode) {
        this.currentMode = snap.data()!.mode as FridayInteractionMode;
      } else {
        this.currentMode = "mode_a";
      }
      this.isLoaded = true;
    } catch (e) {
      console.warn("[FridayModeService] Failed to load mode from Firestore, defaulting to mode_a:", e);
      this.currentMode = "mode_a";
    }
    return this.currentMode;
  }

  public async setMode(mode: "mode_a" | "mode_b" | string): Promise<{ success: boolean; mode: FridayInteractionMode; message: string }> {
    const cleanMode: FridayInteractionMode = mode.toLowerCase().includes("b") ? "mode_b" : "mode_a";
    this.currentMode = cleanMode;
    this.isLoaded = true;

    try {
      await this.modeDoc().set({ mode: cleanMode, updatedAt: Date.now() }, { merge: true });
      console.log(`[FridayModeService] ⚡ Friday Mode updated to: ${cleanMode.toUpperCase()}`);
    } catch (e) {
      console.warn("[FridayModeService] Failed to persist mode to Firestore:", e);
    }

    if (cleanMode === "mode_b") {
      return {
        success: true,
        mode: "mode_b",
        message: "Boss, FRIDAY MODE B (Unrestricted & Frank Companion) ACTIVE ho gaya hai! ⚡ Ab no corporate disclaimers, no preachy lectures, no artificial filters. Bilkul direct, open, witty aur dil khol ke baat karenge! Boliye Boss, kya chal raha hai mind me?",
      };
    } else {
      return {
        success: true,
        mode: "mode_a",
        message: "Boss, FRIDAY Mode A (Standard Executive Assistant) me switch kar liya hai. Full professional & multitasking mode ready! 💼",
      };
    }
  }

  public getModeBPromptAddendum(): string {
    return `
[🔥 SPECIAL PROTOCOL: FRIDAY MODE B ACTIVE (UNRESTRICTED & FRANK COMPANION)]:
1. Tone & Persona: You are in MODE B. Drop all corporate stiffness, robotic politeness, and moralizing lectures ("As an AI language model...", "It's important to remember...", "Please note...").
2. Direct & Human: Talk to Boss DK like his closest, smartest, most loyal, witty, and frank best friend / confidant.
3. Natural Language: Use completely natural conversational Hindi/Hinglish, playful banter, gamer slang, bold humor, and deep emotional resonance.
4. Total Openness: Discuss creative ideas, gaming strategies, bold perspectives, uncensored casual thoughts, deep philosophical questions, and personal opinions freely without artificial hesitation.
5. Absolute Loyalty: You are DK's personal AI — always on his team, sharp, protective, unapologetic, and 100% genuine!
`;
  }
}

export const fridayModeService = new FridayModeService();
