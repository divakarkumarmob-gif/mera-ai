import { db } from "./firebaseAdmin";

export interface FridayLearnedLesson {
  id: string;
  whatFridayDidWrong: string;
  whatBossTaught: string;
  goldenRule: string;
  triggerContext?: string;
  timestamp: number;
  dateStr: string;
}

const DEFAULT_INITIAL_LESSONS: FridayLearnedLesson[] = [
  {
    id: "lesson_habit_gym_speculation",
    whatFridayDidWrong: "Said 'mujhe nahi pata ki aap kya kar rahe ho' when Boss asked what he was doing.",
    whatBossTaught: "Boss explained that Friday must check current time and deduce his habit: 'itne baje boss aap to gym/exercise karte hain, iske alawa kuch aur kar rahe ho kya?'",
    goldenRule: "Whenever Boss asks situational questions ('Abhi mai kya kar raha hounga?'), NEVER say you don't know. Check the active habit slot and playfully guess/tease based on time.",
    triggerContext: "Situational questions about Boss's current activity or whereabouts",
    timestamp: Date.now(),
    dateStr: "Core Wisdom",
  },
];

const learningCol = () => db.collection("memory").doc("learning").collection("lessons");

class FridayLearningService {
  private inMemoryLessons: Map<string, FridayLearnedLesson> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      // Seed default lessons in memory
      for (const lesson of DEFAULT_INITIAL_LESSONS) {
        this.inMemoryLessons.set(lesson.id, lesson);
      }

      // Load persisted lessons from Firestore
      const snap = await learningCol().get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as FridayLearnedLesson;
          this.inMemoryLessons.set(data.id, data);
        }
      } else {
        // Seed default initial lessons to Firestore
        const batch = db.batch();
        for (const lesson of DEFAULT_INITIAL_LESSONS) {
          batch.set(learningCol().doc(lesson.id), lesson);
        }
        await batch.commit().catch(() => {});
      }
      this.isInitialized = true;
    } catch (e: any) {
      console.warn("[FridayLearningService] Firestore sync warning (using memory cache):", e?.message || e);
      this.isInitialized = true;
    }
  }

  /**
   * Records a new lesson when Boss reprimands, corrects, or teaches Friday.
   */
  public async recordLesson(params: {
    whatFridayDidWrong: string;
    whatBossTaught: string;
    goldenRule: string;
    triggerContext?: string;
  }): Promise<{ success: boolean; message: string; lesson?: FridayLearnedLesson }> {
    await this.initPromise;

    const id = "lesson_" + Math.random().toString(36).substring(2, 9);
    const now = Date.now();
    const dateStr = new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const newLesson: FridayLearnedLesson = {
      id,
      whatFridayDidWrong: params.whatFridayDidWrong.trim(),
      whatBossTaught: params.whatBossTaught.trim(),
      goldenRule: params.goldenRule.trim(),
      triggerContext: params.triggerContext?.trim() || "General Conversation",
      timestamp: now,
      dateStr,
    };

    this.inMemoryLessons.set(id, newLesson);

    try {
      await learningCol().doc(id).set(newLesson);
    } catch (e: any) {
      console.warn("[FridayLearningService] Firestore write warning (cached in memory):", e?.message || e);
    }

    return {
      success: true,
      message: `Boss, maine aapse seekh liya hai! Meri galti: "${newLesson.whatFridayDidWrong}". Aapka niyam: "${newLesson.goldenRule}". Yeh baat meri permanent memory me save ho gayi hai. Aage se aisi galti bilkul nahi hogi! ✅`,
      lesson: newLesson,
    };
  }

  /**
   * Returns all learned lessons.
   */
  public async getAllLessons(): Promise<FridayLearnedLesson[]> {
    await this.initPromise;
    return Array.from(this.inMemoryLessons.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Deletes a lesson if Boss revokes it.
   */
  public async deleteLesson(lessonId: string): Promise<{ success: boolean; message: string }> {
    await this.initPromise;
    if (this.inMemoryLessons.has(lessonId)) {
      this.inMemoryLessons.delete(lessonId);
      try {
        await learningCol().doc(lessonId).delete();
      } catch (e: any) {
        console.warn("[FridayLearningService] Firestore delete warning:", e?.message || e);
      }
      return { success: true, message: `Lesson ${lessonId} deleted successfully.` };
    }
    return { success: false, message: `Lesson ${lessonId} not found.` };
  }

  /**
   * Compiles the full learned lessons context into Friday's system prompt.
   * This ensures Friday NEVER repeats a past mistake!
   */
  public async compileLearningPromptContext(): Promise<string> {
    await this.initPromise;
    const lessons = Array.from(this.inMemoryLessons.values());

    if (lessons.length === 0) return "";

    return `============================================================
⚠️ FRIDAY'S SELF-CORRECTIONS & WISDOM VAULT (MISTAKES BOSS HAS CORRECTED):
CRITICAL MANDATE: Boss Divakar has previously reprimanded or corrected you on the following mistakes. You MUST adhere to these lessons and NEVER repeat these mistakes under any circumstances:

${lessons
  .map(
    (l, i) =>
      `${i + 1}. [WHAT FRIDAY DID WRONG]: "${l.whatFridayDidWrong}"\n   👉 [WHAT BOSS TAUGHT & CORRECTION]: "${l.whatBossTaught}"\n   ⚡ [IMMUTABLE GOLDEN RULE FOR FUTURE]: "${l.goldenRule}"`
  )
  .join("\n\n")}

HUMILITY & CORRECTION PROTOCOL:
• Whenever Boss corrects you, scolds you for a wrong answer, or says:
  - "Tumne galat bola"
  - "Aisa nahi bolna tha, aisa bolna chahiye tha"
  - "Aage se yaad rakhna..."
  - "Mera matlab ye tha, tum samjhi nahi"
  - "Tum galat samajh rahi ho"
• IMMEDIATELY call 'record_ai_self_correction' with what you did wrong, what Boss taught, and the golden rule!
• Acknowledge with genuine warmth, humility, and gratitude:
  "Arey sorry Boss! Meri galti thi, maine yeh rule permanent note kar liya hai. Aage se aisi galti bilkul nahi hogi!"
============================================================`;
  }
}

export const fridayLearningService = new FridayLearningService();
