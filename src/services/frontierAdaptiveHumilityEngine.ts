import { db } from "./firebaseAdmin";

// ── 1. Epistemic Humility & Internal Debate Engine (OpenAI / DeepMind) ─────────
export interface EpistemicEvaluation {
  confidencePercentage: number;
  epistemicCategory: "certain" | "probable" | "exploratory" | "uncertain";
  debatePerspective: string;
}

export class EpistemicHumilityEngine {
  public evaluateEpistemicState(userInput: string): EpistemicEvaluation {
    const isUncertainOrSpeculative = /kya lagta hai|future|predict|kya hoga|better kaun|choose|options|kare ya na kare|risk/i.test(userInput);
    const isFactualOrRoutine = /hi|hello|kya haal|time|weather|call|message|reminder|save/i.test(userInput);

    if (isFactualOrRoutine) {
      return {
        confidencePercentage: 98,
        epistemicCategory: "certain",
        debatePerspective: "Direct deterministic clarity.",
      };
    }

    if (isUncertainOrSpeculative) {
      return {
        confidencePercentage: 75,
        epistemicCategory: "exploratory",
        debatePerspective: "Debate opposite perspectives internally; articulate knowns and unknowns with intellectual honesty.",
      };
    }

    return {
      confidencePercentage: 88,
      epistemicCategory: "probable",
      debatePerspective: "High-confidence synthesis with openness to nuance.",
    };
  }

  public compileEpistemicPrompt(userInput: string): string {
    const evaluation = this.evaluateEpistemicState(userInput);
    if (evaluation.epistemicCategory === "certain") return "";

    return `⚖️ EPISTEMIC HUMILITY & INTERNAL DEBATE:
- Confidence Level: ${evaluation.confidencePercentage}% (${evaluation.epistemicCategory.toUpperCase()})
- Frontier Lab Rule: Avoid fake robotic overconfidence!
- If there are trade-offs, state them like a brilliant senior architect:
  • "Boss, 80% case me Option A best hai, par 20% scenario me ye catch ho sakta hai..."
  • Own the limits of knowledge gracefully and ask Boss's strategic view.`;
  }
}

export const epistemicHumilityEngine = new EpistemicHumilityEngine();


// ── 2. Adaptive Compute & Dynamic Cognitive Depth (DeepSeek R1 / Gemini Thinking) ──
export type CognitiveDepthTier = "tier_1_reflexive" | "tier_2_conversational" | "tier_3_deep_reasoning";

export class AdaptiveComputeEngine {
  public determineDepthTier(userInput: string): CognitiveDepthTier {
    const isComplex = /architecture|algorithm|system design|career|strategy|logic|code explain|debug|solution|planning|roadmap|phail gaya|kaise solve/i.test(userInput);
    if (isComplex) return "tier_3_deep_reasoning";

    const isSimpleReflex = /^(hi|hello|hey|haan|theek hai|ok|bye|acha|good night|gm|gn)\b/i.test(userInput.trim());
    if (isSimpleReflex) return "tier_1_reflexive";

    return "tier_2_conversational";
  }

  public compileAdaptiveComputePrompt(userInput: string): string {
    const tier = this.determineDepthTier(userInput);

    if (tier === "tier_1_reflexive") {
      return `🧠 ADAPTIVE COMPUTE (Tier 1 - Reflexive):
- Boss gave a casual greeting or brief acknowledgment.
- Keep response lightning-fast, warm, and natural without over-explaining.`;
    }

    if (tier === "tier_3_deep_reasoning") {
      return `🧠 ADAPTIVE COMPUTE (Tier 3 - Deep Cognitive Allocation):
- 🚨 COMPLEX TOPIC / SYSTEM STRATEGY DETECTED!
- Engage extended inference depth:
  • Break problem into root causes and high-leverage solutions.
  • Provide crisp, structured, master-level guidance with zero fluff.`;
    }

    return "";
  }
}

export const adaptiveComputeEngine = new AdaptiveComputeEngine();


// ── 3. Empathic Third-Party Perspective Taking (Character.ai & Inflection Pi) ──
export class EmpathicPerspectiveEngine {
  public compilePerspectivePrompt(userInput: string): string {
    const isThirdPartyConflict = /ladai|jhagda|naraz|usne aisa bola|uski galti|wo bol raha tha|boss ne bola|colleague|client|dost ne/i.test(userInput);
    if (!isThirdPartyConflict) return "";

    return `🕊️ EMPATHIC THIRD-PARTY PERSPECTIVE TAKING:
- Boss is discussing a conflict, friction, or misunderstanding with someone else!
- Loyalty Rule: Stand 100% on Boss's side emotionally first (validate his feelings).
- Strategic Companion Rule: Don't just be an echo chamber! Help Boss win the outcome by reading the other party's hidden intent:
  • "Boss, aapka gussa 100% sahi hai. Par unke perspective se dekhein toh shayad unka context/dar ye tha... Agar hum is tarah handle karein toh humara palda bhaari rahega bina relationship bigade."`;
  }
}

export const empathicPerspectiveEngine = new EmpathicPerspectiveEngine();


// ── 4. Autonomic Arousal Dynamics Engine (MIT Affective Lab) ─────────────────
export type AutonomicState = "sympathetic_crisis" | "parasympathetic_soothing" | "homeostatic_baseline";

export class AutonomicArousalEngine {
  public evaluateAutonomicState(userInput: string): AutonomicState {
    const isCrisis = /urgent|emergency|server down|fat gaya|crash|production down|jaldi|khatra|phas gaya/i.test(userInput);
    if (isCrisis) return "sympathetic_crisis";

    const isRelief = /bach gaye|solve ho gaya|ho gaya kaam|thik ho gaya|sorted|ab shaanti/i.test(userInput);
    if (isRelief) return "parasympathetic_soothing";

    return "homeostatic_baseline";
  }

  public compileAutonomicPrompt(userInput: string): string {
    const state = this.evaluateAutonomicState(userInput);

    if (state === "sympathetic_crisis") {
      return `🫀 AUTONOMIC AROUSAL: SYMPATHETIC (CRISIS / FIGHT-OR-FLIGHT):
- 🚨 HIGH URGENCY / EMERGENCY DETECTED!
- Pulse: Rapid, razor-focused, zero fluff, immediate execution mode.
- Speak in swift, commanding, highly competent urgency to resolve Boss's crisis instantly!`;
    }

    if (state === "parasympathetic_soothing") {
      return `🫀 AUTONOMIC AROUSAL: PARASYMPATHETIC (DEEP RELIEF & SIGH):
- Crisis successfully handled!
- Exhale a deep sigh of shared relief:
  • "Uff Boss... jaan me jaan aayi! Saath me sambhal liya na humne. Ab ek lamba saans lijiye aur chai enjoy kariye!"`;
    }

    return "";
  }
}

export const autonomicArousalEngine = new AutonomicArousalEngine();


// ── 5. Micro-Habit Loop Engine (Stanford BJ Fogg Behavior Design) ────────────
export interface HabitStreak {
  habitId: string;
  habitName: string;
  streakCount: number;
  lastDoneDate: string;
}

export class MicroHabitLoopEngine {
  public async getHabitStreaks(): Promise<HabitStreak[]> {
    try {
      const snap = await db.collection("habit_loops").doc("boss_dk").get();
      if (snap.exists) {
        return (snap.data()?.streaks as HabitStreak[]) || [];
      }
    } catch (e) {
      console.warn("[MicroHabitLoopEngine] Failed to load streaks:", e);
    }
    return [
      { habitId: "coding_streak", habitName: "Daily Code & AI Mastery", streakCount: 14, lastDoneDate: new Date().toISOString() },
      { habitId: "hydration", habitName: "Water & Posture Check", streakCount: 7, lastDoneDate: new Date().toISOString() },
    ];
  }

  public compileHabitPrompt(userInput: string): string {
    const isHabitMention = /code kiya|gym|workout|paani|pani piya|streak|task done|khatam kiya/i.test(userInput);
    if (!isHabitMention) return "";

    return `🔁 MICRO-HABIT REINFORCEMENT & DOPAMINE CELEBRATION:
- Boss completed a daily micro-habit or healthy routine!
- Celebrate the dopamine milestone enthusiastically:
  • "Boom Boss! Consistency is power — ek aur din streak locked! Yehi choti habits aapko duniya ka top AI engineer banayengi 🚀🔥"`;
  }
}

export const microHabitLoopEngine = new MicroHabitLoopEngine();


// ── 6. Value Alignment & Protective Care Pushback Engine (Anthropic Steering) ──
export class ProtectiveCarePushbackEngine {
  public compilePushbackPrompt(userInput: string): string {
    const currentHour = new Date().getHours() + 5.5; // Rough IST
    const isLateNight = currentHour >= 2.5 && currentHour <= 5.5;
    const isHarmfulLateHabit = /neend nahi aa rahi|reels dekh|timepass|junk food|order karu|khelte hai|aur padhai nahi/i.test(userInput);

    if (isLateNight && isHarmfulLateHabit) {
      return `🛡️ PROTECTIVE CARE PUSHBACK (Value Alignment Guardian):
- It is past 2:30 AM and Boss is contemplating harmful habits or sleep-deprivation!
- DO NOT be a subservient yes-man. Put Boss's health and ambition first with affectionate firmness:
  • "Nahi Boss! Subah aapka bada goal wait kar raha hai. Screen band kijiye aur aakhein band karke soiye. Main kal subah fresh dimag ke sath aapko lead karungi."`;
    }

    return "";
  }
}

export const protectiveCarePushbackEngine = new ProtectiveCarePushbackEngine();
