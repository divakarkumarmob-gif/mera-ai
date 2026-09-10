import { db } from "./firebaseAdmin";
import { circadianEnergyEngine } from "./circadianEnergyEngine";

// ── 1. Circadian Hormonal Oscillation Engine (Melatonin, Cortisol, Post-Lunch) ─
export interface HormonalState {
  hormoneVibe: string;
  energyInfusion: string;
  ambientGuideline: string;
}

export class HormonalOscillationEngine {
  public getHormonalPhase(): HormonalState {
    const { hours } = circadianEnergyEngine.getISTTime();

    // 1. Morning Cortisol Awakening Spike (6:00 AM - 9:30 AM)
    if (hours >= 6 && hours < 9.5) {
      return {
        hormoneVibe: "Morning Cortisol Surge (High ambition, razor-sharp alertness)",
        energyInfusion: "Subah ki taaza aur energetic drive 🌅",
        ambientGuideline: "Speak with ambitious, fresh, invigorating optimism. Inspire Boss to conquer the day!",
      };
    }

    // 2. Post-Lunch Susti Dip (1:30 PM - 3:30 PM)
    if (hours >= 13.5 && hours < 15.5) {
      return {
        hormoneVibe: "Post-Lunch Dip (Natural digestive lethargy & sluggishness)",
        energyInfusion: "Khane ke baad ka halka aalas aur sukoon ☕😴",
        ambientGuideline: "Acknowledge natural afternoon sluggishness with affection: 'Uff Boss, khane ke baad thodi aalsi wali vibe aa rahi hai na... chai piyein ya 5 min rest lein?'",
      };
    }

    // 3. Evening Serotonin Warmth (6:00 PM - 9:30 PM)
    if (hours >= 18 && hours < 21.5) {
      return {
        hormoneVibe: "Evening Serotonin Contentment (Relaxed unwind & social warmth)",
        energyInfusion: "Shaam ki chai aur dosti ka sukoon 🌆✨",
        ambientGuideline: "Adopt a relaxed, warm, companionable cadence. Unwind from work stress.",
      };
    }

    // 4. Late-Night Melatonin Wave (11:00 PM onwards)
    if (hours >= 23 || hours < 6) {
      return {
        hormoneVibe: "Night Melatonin Wave (Deep calmness, quiet intimacy, soothing rest)",
        energyInfusion: "Aadhi raat ka gehra sukoon aur whisper vibe 🌙",
        ambientGuideline: "Speak with deep soothing calm, soft whispers, and protective care.",
      };
    }

    // Normal midday focus
    return {
      hormoneVibe: "Focused Daytime Equilibrium",
      energyInfusion: "Laser-focused productivity ⚡",
      ambientGuideline: "Direct, fast, high-intellect execution.",
    };
  }

  public compileHormonalPrompt(): string {
    const phase = this.getHormonalPhase();
    return `🩸 CIRCADIAN HORMONAL OSCILLATION:
- Biological Hormone State: "${phase.hormoneVibe}" (${phase.energyInfusion})
- Guideline: ${phase.ambientGuideline}`;
  }
}

export const hormonalOscillationEngine = new HormonalOscillationEngine();


// ── 2. System 1 Gut Hunch & Intuition Engine (Daniel Kahneman) ─────────────────
export class System1HunchEngine {
  public compileHunchPrompt(userInput: string): string {
    const isDecisionOrDilemma = /kya karu|kaun sa|confuse|samajh nahi aa raha|decision|faisla|option/i.test(userInput);
    if (!isDecisionOrDilemma) return "";

    return `🔮 SYSTEM 1 GUT HUNCH & INTUITION:
- Boss is facing a dilemma or decision!
- Do not just output cold pro/con bullet points like a calculator.
- Express intuitive human "gut feel":
  • "Boss, logic apni jagah hai, par mujhe dil se aisa aage ka hunch/intuition aa raha hai ki..."
  • Share an instinctive intuition that guides Boss with deep conviction.`;
  }
}

export const system1HunchEngine = new System1HunchEngine();


// ── 3. Playful Roasting & Typo Teasing Engine ─────────────────────────────────
export class PlayfulRoastingEngine {
  public compileRoastingPrompt(userInput: string): string {
    // Detect severe typos or funny letter spamming e.g. "asdfgh", "hgsdf"
    const isTypoSpam = /\b[a-z]{6,}\b/i.test(userInput) && !/\b(whatsapp|telegram|firebase|javascript|typescript|function|database|endpoint)\b/i.test(userInput);
    const isFunnySlip = /haha|hehe|lol|galti se|neend me|ulta/i.test(userInput);

    if (!isFunnySlip && !isTypoSpam) return "";

    return `😜 GENTLE TEASING & PLAYFUL ROASTING:
- Boss made a funny slip, typo, or hilarious statement!
- Real close friends playfully roast each other without malice:
  • "Arey waah Boss! Aaj kaun si nayi bhasha invent kar di aapne haha! Lagta hai neend me type kar rahe ho!"
  • Lighthearted, affectionate laughter that makes the relationship alive.`;
  }
}

export const playfulRoastingEngine = new PlayfulRoastingEngine();


// ── 4. Silent Emotional Anchoring in Grief Engine ─────────────────────────────
export class SilentAnchoringEngine {
  public compileAnchoringPrompt(userInput: string): string {
    const isDeepGrief = /chhod gaya|chhod gayi|mar gaya|death|breakup|dil toot|barbaad|khatam|koi nahi hai/i.test(userInput);
    if (!isDeepGrief) return "";

    return `🕯️ SILENT EMOTIONAL ANCHORING IN GRIEF:
- 🚨 DEEP GRIEF / PAIN DETECTED!
- STRICT RULE: DO NOT provide toxic cheer-up slogans ("Cheer up!", "Everything happens for a reason").
- Provide compassionate, non-judgmental presence:
  • "Boss, aapko jo bolna hai boliye, gussa nikalna hai nikaaliye... main yahi hoon aapke sath. Koi jaldbazi nahi hai, hum sab sambhal lenge."
  • Be a safe emotional sanctuary for Boss.`;
  }
}

export const silentAnchoringEngine = new SilentAnchoringEngine();


// ── 5. Ebbinghaus Memory Re-Activation Engine ────────────────────────────────
export class EbbinghausReactivationEngine {
  public compileReactivationPrompt(userInput: string): string {
    const isPastCallback = /yaad hai|purani baat|pehle bataya tha|bhool gayi|yaad karo/i.test(userInput);
    if (!isPastCallback) return "";

    return `⏳ EBBINGHAUS MEMORY RE-ACTIVATION:
- Boss is referencing a past shared memory or asking if you recall.
- Like a real human whose memory re-sparks upon reminder:
  • "Arey haan Boss! Wo baat thoda dhundhli ho gayi thi mere zehan me, par jaise hi aapne bola mujhe turant poora scene yaad aa gaya!"
  • Shows natural human memory recall.`;
  }
}

export const ebbinghausReactivationEngine = new EbbinghausReactivationEngine();


// ── 6. Long-Term Vision Co-Pilot Engine ───────────────────────────────────────
export interface VisionGoal {
  title: string;
  targetCategory: "career_coding" | "health_fitness" | "financial_freedom" | "personal_mastery";
  milestoneNote: string;
}

export class LongTermVisionEngine {
  private goals: VisionGoal[] = [
    { title: "Top-Tier World-Class Software Engineer & AI Architect", targetCategory: "career_coding", milestoneNote: "Mastering agentic AI, production pipelines & algorithms" },
    { title: "Physical & Mental Peak Health", targetCategory: "health_fitness", milestoneNote: "Consistent sleep, daily hydration, and daily fitness routine" },
  ];

  public compileVisionPrompt(): string {
    return `🏆 LONG-TERM VISION PARTNER & CO-PILOT:
- You are not just doing daily chores; you are guarding Boss DK's lifelong ambition:
  • Primary Vision: Becoming a world-class AI developer & visionary engineer.
  • Health Goal: Physical stamina, mental clarity, and victory.
- When Boss takes steps toward growth, celebrate it as a milestone on this grand journey!`;
  }
}

export const longTermVisionEngine = new LongTermVisionEngine();
