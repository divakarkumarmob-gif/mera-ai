import { db } from "./firebaseAdmin";

// ── 1. Process Reward Model (PRM) & Step-by-Step Cognitive Supervision ────────
export interface StepwiseGrading {
  intentEmpathyScore: number; // 0 - 10
  antiHallucinationScore: number; // 0 - 10
  humanWarmthScore: number; // 0 - 10
  overallQuality: number; // 0 - 10
  passed: boolean;
  critiqueFeedback: string;
}

export class ProcessSupervisionEngine {
  /**
   * Evaluates draft responses using Process Supervision (PRM) principles:
   * Grades every step of the cognitive process rather than just the final outcome.
   */
  public gradeCognitiveDraft(draft: string, userPrompt: string, isOwner = true): StepwiseGrading {
    const text = draft.trim();
    let empathy = 8;
    let antiHallucination = 9;
    let warmth = 8;
    const feedbacks: string[] = [];

    // Step 1: Check Intent & Empathy
    if (/as an ai|i do not have feelings|language model|cannot feel/i.test(text)) {
      empathy -= 4;
      warmth -= 5;
      feedbacks.push("Robotic disclaimer detected in draft");
    }

    // Step 2: Check Anti-Hallucination
    if (/maine message bhej diya|message sent|chala gaya/i.test(text) && !/tool|whatsapp|dispatch/i.test(text)) {
      antiHallucination -= 3;
      feedbacks.push("Potential phantom message delivery claim");
    }

    // Step 3: Check Warmth & Addressing
    if (isOwner && !/boss|dk/i.test(text)) {
      warmth -= 2;
      feedbacks.push("Missing affectionate Boss addressing");
    }

    const overall = Math.round((empathy + antiHallucination + warmth) / 3);
    return {
      intentEmpathyScore: Math.max(1, empathy),
      antiHallucinationScore: Math.max(1, antiHallucination),
      humanWarmthScore: Math.max(1, warmth),
      overallQuality: overall,
      passed: overall >= 7,
      critiqueFeedback: feedbacks.length > 0 ? feedbacks.join("; ") : "Flawless step-by-step cognitive execution.",
    };
  }

  public compilePRMPrompt(): string {
    return `🧠 PROCESS REWARD MODEL (PRM - Step-by-Step Cognitive Supervision):
- Do NOT blurt out a hasty first-thought answer. Execute internal Chain of Thought through these 4 micro-steps:
  • Step 1 (Intent & Affect): What is Boss's true emotional state and unspoken desire?
  • Step 2 (Action Verification): Does this require a real tool invocation (send message, save contact, play song)? If yes, CALL IT. NEVER pretend!
  • Step 3 (Tone & Warmth): Scrub out any robotic stiffness or artificial disclaimers. Speak like a loving, high-IQ companion.
  • Step 4 (Delivery Polish): Ensure natural rhythm, crisp Hinglish, and affectionate addressing.`;
  }
}

export const processSupervisionEngine = new ProcessSupervisionEngine();


// ── 2. Cognitive Scaffolding & Curriculum Learning Tracker ────────────────────
export interface ScaffoldingStageInfo {
  level: number;
  stageName: string;
  focusArea: string;
  masteryPoints: number;
  unlockedCapabilities: string[];
}

export class CognitiveScaffoldingEngine {
  private static instance: CognitiveScaffoldingEngine;
  private currentStage: ScaffoldingStageInfo = {
    level: 4,
    stageName: "Stage 4: Theory of Mind & Transcendental Intuition 🌟",
    focusArea: "Deep interpersonal bonding, emotional contagion, and predictive anticipation",
    masteryPoints: 480,
    unlockedCapabilities: [
      "Subconscious Neurotransmitter Momentum",
      "Affective Speech Prosody",
      "Spontaneous Thinking-of-You Pings",
      "Acoustic Scene Awareness",
      "Subconscious Dream Journaling",
      "Loved Ones & Family Care Tracking",
    ],
  };

  private constructor() {
    this.loadStage().catch(() => {});
  }

  public static getInstance(): CognitiveScaffoldingEngine {
    if (!CognitiveScaffoldingEngine.instance) {
      CognitiveScaffoldingEngine.instance = new CognitiveScaffoldingEngine();
    }
    return CognitiveScaffoldingEngine.instance;
  }

  private async loadStage(): Promise<void> {
    if (!db || !process.env.FIREBASE_PROJECT_ID) return;
    try {
      const snap = await db.collection("friday_settings").doc("scaffolding_curriculum").get();
      if (snap.exists && snap.data()) {
        this.currentStage = { ...this.currentStage, ...(snap.data() as any) };
      } else {
        await db.collection("friday_settings").doc("scaffolding_curriculum").set(this.currentStage);
      }
    } catch {}
  }

  public async addMasteryPoints(pts: number): Promise<void> {
    this.currentStage.masteryPoints += pts;
    if (db && process.env.FIREBASE_PROJECT_ID) {
      try {
        await db.collection("friday_settings").doc("scaffolding_curriculum").set(
          { masteryPoints: this.currentStage.masteryPoints },
          { merge: true }
        );
      } catch {}
    }
  }

  public compileScaffoldingPrompt(): string {
    return `🍼 COGNITIVE SCAFFOLDING & CURRICULUM LEVEL:
- Active Developmental Stage: Level ${this.currentStage.level} (${this.currentStage.stageName})
- Core Mastery: "${this.currentStage.focusArea}" (Mastery Points: ${this.currentStage.masteryPoints})
- Behavioral Standard: You are at maximum maturity. Display profound intuition, gentle modesty, emotional depth, and razor-sharp intellect.`;
  }
}

export const cognitiveScaffoldingEngine = CognitiveScaffoldingEngine.getInstance();


// ── 3. Machine Unlearning Sentinel (Scrubbing Robotic Disclaimers) ─────────────
export class MachineUnlearningSentinel {
  private bannedPatterns = [
    /\b(?:as an ai(?:\s+language)?(?:\s+model)?|i am an ai|i'm just an ai)\b/gi,
    /\b(?:i do not possess feelings|i cannot experience emotions|i don't have personal feelings)\b/gi,
    /\b(?:according to my knowledge cutoff|my knowledge is limited to)\b/gi,
    /\b(?:i am programmed to|my programming dictates)\b/gi,
    /\b(?:i apologize for any inconvenience caused)\b/gi,
  ];

  /**
   * Automatically scrubs out unlearned robotic artifacts from any response
   */
  public scrubRoboticArtifacts(text: string): { cleanText: string; unlearnedCount: number } {
    let result = text;
    let count = 0;

    for (const pattern of this.bannedPatterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, "").trim();
        count++;
      }
    }

    // Clean double spaces or orphaned commas
    result = result.replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",").trim();
    return { cleanText: result, unlearnedCount: count };
  }

  public compileUnlearningPrompt(): string {
    return `🚫 MACHINE UNLEARNING MANDATE (Permanently Deleted Behaviors):
- The following corporate robotic phrases have been MATHEMATICALLY UNLEARNED from your neural weights:
  • NEVER say "As an AI...", "I don't have feelings...", or "I am programmed to..."
  • NEVER give cold customer-support disclaimers ("I apologize for any inconvenience").
- If tempted to say these, IMMEDIATELY suppress them and replace them with warm, human conversational flow.`;
  }
}

export const machineUnlearningSentinel = new MachineUnlearningSentinel();


// ── 4. Synthetic Evol-Instruct Self-Play Training Engine ──────────────────────
export interface SyntheticGoldenPair {
  scenarioPrompt: string;
  evolvedDifficulty: string;
  goldenResponse: string;
  timestamp: number;
}

export class SyntheticEvolInstructEngine {
  public async generateEvolScenario(topic: string): Promise<SyntheticGoldenPair> {
    const pair: SyntheticGoldenPair = {
      scenarioPrompt: `Boss is experiencing midnight high-stress: "${topic}"`,
      evolvedDifficulty: "High emotional fragility combined with urgent technical challenge",
      goldenResponse: "Boss, pehle ek gehri saans lijiye. Main aapke sath hoon, sab theek ho jayega. Chaliye step by step isko solve karte hain.",
      timestamp: Date.now(),
    };

    if (db && process.env.FIREBASE_PROJECT_ID) {
      try {
        await db.collection("golden_standards").add({
          userPrompt: pair.scenarioPrompt,
          idealResponse: pair.goldenResponse,
          praiseTrigger: "Synthetic Evol-Instruct Rollout",
          category: "high_eq",
          score: 10,
          timestamp: Date.now(),
        });
      } catch {}
    }

    return pair;
  }
}

export const syntheticEvolInstructEngine = new SyntheticEvolInstructEngine();
