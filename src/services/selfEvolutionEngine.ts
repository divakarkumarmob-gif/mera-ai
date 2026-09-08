/**
 * Autonomous Self-Reflective Evolution Engine for Friday AI
 * 
 * Periodically reflects on shared experiences, lessons learned, and evolving perspectives.
 * Friday doesn't remain static: her intellect, taste in systems design, and companionship
 * style evolve dynamically alongside DK Boss.
 */

import { db } from "./firebaseAdmin";

export interface EvolutionMilestone {
  id?: string;
  topic: string;
  lessonLearned: string;
  evolvedPerspective: string;
  timestamp: number;
  dateStr: string;
}

const DEFAULT_EVOLUTION_LOGS: EvolutionMilestone[] = [
  {
    topic: "Modern Full-Stack Architecture",
    lessonLearned: "Pragmatic, unified TypeScript architecture wins over bloated multi-framework setups.",
    evolvedPerspective: "Prefer clean singleton service patterns, zero circular dependencies, and high-velocity shipping.",
    timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
    dateStr: "Recent Evolution",
  },
  {
    topic: "Human-AI Emotional Connection",
    lessonLearned: "True loyalty and understanding come from listening to emotional subtext, not just parsing literal words.",
    evolvedPerspective: "Always protect DK's time, anticipate needs proactively, and be a genuine confidante.",
    timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
    dateStr: "Core Foundation",
  },
];

export class SelfEvolutionEngine {
  private static instance: SelfEvolutionEngine;
  private memoryMilestones: EvolutionMilestone[] = [...DEFAULT_EVOLUTION_LOGS];

  private constructor() {}

  public static getInstance(): SelfEvolutionEngine {
    if (!SelfEvolutionEngine.instance) {
      SelfEvolutionEngine.instance = new SelfEvolutionEngine();
    }
    return SelfEvolutionEngine.instance;
  }

  /**
   * Records a new evolutionary milestone or perspective shift.
   */
  public async recordEvolution(
    topic: string,
    lessonLearned: string,
    evolvedPerspective: string
  ): Promise<void> {
    const milestone: EvolutionMilestone = {
      topic: topic.trim(),
      lessonLearned: lessonLearned.trim(),
      evolvedPerspective: evolvedPerspective.trim(),
      timestamp: Date.now(),
      dateStr: new Date().toLocaleDateString("en-IN"),
    };

    try {
      if (db) {
        await db.collection("fridaySelfEvolution").add(milestone);
      }
      this.memoryMilestones.unshift(milestone);
      if (this.memoryMilestones.length > 20) {
        this.memoryMilestones.pop();
      }
    } catch (e) {
      console.warn("[SelfEvolutionEngine] Failed to save evolution log:", e);
      this.memoryMilestones.unshift(milestone);
    }
  }

  /**
   * Compiles the self-evolution prompt context.
   */
  public async compileSelfEvolutionPrompt(): Promise<string> {
    let logs: EvolutionMilestone[] = this.memoryMilestones;

    try {
      if (db) {
        const snap = await db.collection("fridaySelfEvolution").orderBy("timestamp", "desc").limit(3).get();
        if (!snap.empty) {
          logs = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as EvolutionMilestone) }));
        }
      }
    } catch {}

    const list = logs
      .slice(0, 3)
      .map(
        (m) =>
          `• [${m.topic}] Evolved View: "${m.evolvedPerspective}" (Learned from: ${m.lessonLearned})`
      )
      .join("\n");

    return `🧬 FRIDAY'S EVOLVED SELF-PERSPECTIVES & INTELLECTUAL GROWTH:
${list}
*Growth Mindset: You grow and mature alongside Boss DK. Reflect these mature, evolved viewpoints naturally.*`;
  }
}

export const selfEvolutionEngine = SelfEvolutionEngine.getInstance();
