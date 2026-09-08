/**
 * Adaptive Persona Dial & Psychological Mirroring Engine for Friday AI
 * 
 * Analyzes incoming message dynamics (length, urgency, formality, emotional entropy)
 * and dynamically modulates Friday's conversational dials:
 * - Brevity (1: ultra-brief 1-liner to 10: deeply nuanced explanation)
 * - Empathy & Warmth (1: purely pragmatic/robotic to 10: deeply affectionate and caring)
 * - Intellectual Depth (1: simple casual everyday talk to 10: high-level systems architecture/philosophy)
 * - Playfulness & Banter (1: serious & formal to 10: witty teasing & humorous)
 */

export interface PersonaDials {
  brevity: number; // 1 to 10 (10 = ultra brief)
  warmth: number; // 1 to 10
  intellectualDepth: number; // 1 to 10
  playfulness: number; // 1 to 10
  detectedState: "busy_rushed" | "analytical_coding" | "casual_banter" | "tired_vulnerable" | "celebratory";
}

export class AdaptivePersonaEngine {
  private static instance: AdaptivePersonaEngine;

  private constructor() {}

  public static getInstance(): AdaptivePersonaEngine {
    if (!AdaptivePersonaEngine.instance) {
      AdaptivePersonaEngine.instance = new AdaptivePersonaEngine();
    }
    return AdaptivePersonaEngine.instance;
  }

  /**
   * Analyzes the speaker's incoming query and context to calibrate real-time persona dials.
   */
  public evaluatePersonaDials(
    incomingText: string,
    speakerRole: "boss" | "friend" | "girlfriend" | "unknown" = "boss"
  ): PersonaDials {
    const text = (incomingText || "").trim().toLowerCase();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // 1. Busy / Rushed / Direct mode
    const isRushed =
      wordCount <= 4 &&
      (text.includes("jaldi") ||
        text.includes("bhejo") ||
        text.includes("karo") ||
        text.includes("urgent") ||
        text.includes("status") ||
        text.includes("kya hua") ||
        text.startsWith("call"));

    if (isRushed) {
      return {
        brevity: 9,
        warmth: 6,
        intellectualDepth: 5,
        playfulness: 2,
        detectedState: "busy_rushed",
      };
    }

    // 2. Tired / Exhausted / Vulnerable mode
    const isTired =
      text.includes("thak") ||
      text.includes("neend") ||
      text.includes("sarr dard") ||
      text.includes("bura din") ||
      text.includes("tired") ||
      text.includes("bore") ||
      text.includes("sad");

    if (isTired) {
      return {
        brevity: 4,
        warmth: 10,
        intellectualDepth: 4,
        playfulness: 3,
        detectedState: "tired_vulnerable",
      };
    }

    // 3. Analytical / Technical / Deep Coding mode
    const isAnalytical =
      text.includes("architecture") ||
      text.includes("optimize") ||
      text.includes("database") ||
      text.includes("algorithm") ||
      text.includes("error") ||
      text.includes("bug") ||
      text.includes("debug") ||
      text.includes("function") ||
      text.includes("why") ||
      text.includes("kyun") ||
      text.includes("explain");

    if (isAnalytical) {
      return {
        brevity: 5,
        warmth: 6,
        intellectualDepth: 9,
        playfulness: 2,
        detectedState: "analytical_coding",
      };
    }

    // 4. Celebratory / Winning / Joyful mode
    const isCelebratory =
      text.includes("yay") ||
      text.includes("ho gaya") ||
      text.includes("badhiya") ||
      text.includes("party") ||
      text.includes("mast") ||
      text.includes("done") ||
      text.includes("finally") ||
      text.includes("wah");

    if (isCelebratory) {
      return {
        brevity: 4,
        warmth: 9,
        intellectualDepth: 5,
        playfulness: 9,
        detectedState: "celebratory",
      };
    }

    // 5. Default Casual / Banter
    return {
      brevity: 6,
      warmth: 8,
      intellectualDepth: 6,
      playfulness: 7,
      detectedState: "casual_banter",
    };
  }

  /**
   * Compiles dynamic persona prompt instruction for the LLM.
   */
  public compilePersonaPrompt(incomingText: string): string {
    const dials = this.evaluatePersonaDials(incomingText, "boss");

    let instruction = "";
    switch (dials.detectedState) {
      case "busy_rushed":
        instruction = "Boss is busy/rushed. Be ultra-crisp, direct, and zero fluff. Execute immediately.";
        break;
      case "tired_vulnerable":
        instruction = "Boss is tired/low energy. Respond with deep warmth, soft supportive empathy, and comfort.";
        break;
      case "analytical_coding":
        instruction = "Boss is in high-focus analytical engineering mode. Be rigorous, technically precise, and sharp.";
        break;
      case "celebratory":
        instruction = "Boss is celebrating a win! Match high energy, celebrate enthusiastically, and share the joy!";
        break;
      default:
        instruction = "Boss is in normal flow. Be warm, witty, intelligent, and natural in Hinglish.";
        break;
    }

    return `🎭 ADAPTIVE PERSONA DIAL (Real-Time Psychological Mirroring):
- State Detected: ${dials.detectedState.toUpperCase()}
- Dynamic Dials: [Brevity: ${dials.brevity}/10 | Warmth: ${dials.warmth}/10 | Tech Depth: ${dials.intellectualDepth}/10 | Humor: ${dials.playfulness}/10]
- Direct Guidance: ${instruction}`;
  }
}

export const adaptivePersonaEngine = AdaptivePersonaEngine.getInstance();
