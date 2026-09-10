import { getFirestore } from "firebase-admin/firestore";

export interface TrainingLesson {
  id: string;
  situationTrigger: string;       // e.g. "Jab Boss thake hue ya gusse me hon", "Jab koi ladai ya narazgi ho"
  taughtReaction: string;          // e.g. "Bohot softly baat karna, koi logic na bolna, bas comfort dena"
  idealSampleResponse?: string;   // e.g. "Boss, aap aaram kijiye, sab sambhal jayega..."
  forbiddenBehaviors?: string[];  // e.g. ["Do not give dry factual advice", "Do not argue"]
  category: "emotional_comfort" | "relationship_advice" | "social_etiquette" | "task_execution" | "voice_tone";
  practiceScore?: number;         // 1 to 5 rating
  isAnchor?: boolean;             // Elastic Memory Anchor
  anchorPriority?: number;        // 1 to 100
  createdAt: number;
  updatedAt: number;
}

const COLLECTION_NAME = "child_training_playbook";

class FridayChildTrainingService {
  private lessons: TrainingLesson[] = [];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private activeDrill: { situation: string; startedAt: number } | null = null;

  private getCollection() {
    return getFirestore().collection(COLLECTION_NAME);
  }

  /**
   * Initializes and loads all training lessons from Firestore into memory
   */
  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const snap = await this.getCollection().orderBy("updatedAt", "desc").limit(200).get();
        this.lessons = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        this.isLoaded = true;
        console.log(`[FridayChildTraining] Loaded ${this.lessons.length} training lessons from Firestore.`);
      } catch (e: any) {
        console.warn("[FridayChildTraining] Firestore init warning (using memory cache):", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Teaches Friday a new behavioral scenario and reaction lesson (like teaching a child)
   */
  public async teachLesson(
    situation: string,
    reaction: string,
    options?: {
      idealSampleResponse?: string;
      forbiddenBehaviors?: string[];
      category?: TrainingLesson["category"];
      isAnchor?: boolean;
      anchorPriority?: number;
    }
  ): Promise<TrainingLesson> {
    await this.init();

    const cleanSituation = situation.trim();
    const cleanReaction = reaction.trim();

    // Auto-detect category based on keywords
    let category: TrainingLesson["category"] = options?.category || "emotional_comfort";
    const lower = `${cleanSituation} ${cleanReaction}`.toLowerCase();
    if (/naraz|gussa|ladai|breakup|manana|sorry|relationship|pyaar|crush|gf/i.test(lower)) {
      category = "relationship_advice";
    } else if (/task|kaam|order|code|file|system|deploy|build/i.test(lower)) {
      category = "task_execution";
    } else if (/voice|aawaz|tone|soft|slow|loud|sweet/i.test(lower)) {
      category = "voice_tone";
    }

    const lesson: TrainingLesson = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      situationTrigger: cleanSituation,
      taughtReaction: cleanReaction,
      idealSampleResponse: options?.idealSampleResponse,
      forbiddenBehaviors: options?.forbiddenBehaviors,
      category,
      practiceScore: 5,
      isAnchor: options?.isAnchor ?? true,
      anchorPriority: options?.anchorPriority ?? 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Check if an existing lesson has very similar situation to update
    const existingIndex = this.lessons.findIndex((l) =>
      l.situationTrigger.toLowerCase() === cleanSituation.toLowerCase() ||
      (cleanSituation.length > 10 && l.situationTrigger.toLowerCase().includes(cleanSituation.toLowerCase()))
    );

    if (existingIndex >= 0) {
      lesson.id = this.lessons[existingIndex].id;
      this.lessons[existingIndex] = lesson;
    } else {
      this.lessons.unshift(lesson);
    }

    try {
      await this.getCollection().doc(lesson.id).set(lesson, { merge: true });
      console.log(`[FridayChildTraining] 🎓 Lesson taught & saved: "${cleanSituation}" -> "${cleanReaction}"`);
    } catch (e: any) {
      console.warn("[FridayChildTraining] Failed to persist lesson to Firestore:", e?.message || e);
    }

    return lesson;
  }

  /**
   * Corrects the most recent lesson or matches a specific mistake
   */
  public async correctPreviousMistake(correctionText: string): Promise<{ success: boolean; lesson?: TrainingLesson; message: string }> {
    await this.init();

    if (this.lessons.length === 0) {
      return {
        success: false,
        message: "Boss, abhi tak koi lesson save nahi hua hai jise correct kiya ja sake. Aap pehle mujhe koi nayi baat sikhaiye!",
      };
    }

    // Update the most recently modified lesson
    const latestLesson = this.lessons[0];
    latestLesson.taughtReaction += ` [Boss Correction: ${correctionText.trim()}]`;
    latestLesson.updatedAt = Date.now();

    try {
      await this.getCollection().doc(latestLesson.id).set(latestLesson, { merge: true });
    } catch (e: any) {
      console.warn("[FridayChildTraining] Failed to update lesson in Firestore:", e?.message || e);
    }

    return {
      success: true,
      lesson: latestLesson,
      message: `Theek hai Boss! Maine apni galti sudhaar li hai: "${latestLesson.situationTrigger}" ke waqt ab se "${correctionText.trim()}" ka dhyan rakhungi! 🫡`,
    };
  }

  /**
   * Retrieves all learned lessons
   */
  public async getAllLessons(): Promise<TrainingLesson[]> {
    await this.init();
    return this.lessons;
  }

  /**
   * Deletes a training lesson by query/keyword
   */
  public async deleteLesson(query: string): Promise<{ success: boolean; message: string }> {
    await this.init();
    const clean = query.trim().toLowerCase();

    if (/all|saare|sare|reset|clear/i.test(clean)) {
      const count = this.lessons.length;
      for (const l of this.lessons) {
        try { await this.getCollection().doc(l.id).delete(); } catch {}
      }
      this.lessons = [];
      return { success: true, message: `Boss, maine saare (${count}) training lessons delete kar diye hain. Ab memory fresh hai!` };
    }

    const index = this.lessons.findIndex((l) =>
      l.id.toLowerCase() === clean ||
      l.situationTrigger.toLowerCase().includes(clean) ||
      l.taughtReaction.toLowerCase().includes(clean)
    );

    if (index === 0 || index > 0) {
      const removed = this.lessons.splice(index, 1)[0];
      try { await this.getCollection().doc(removed.id).delete(); } catch {}
      return { success: true, message: `Boss, "${removed.situationTrigger}" wala lesson maine hata diya hai!` };
    }

    return { success: false, message: `Boss, "${query}" se related koi lesson nahi mila.` };
  }

  /**
   * Finds matching lessons relevant to current incoming message text
   */
  public findRelevantLessons(messageText: string): TrainingLesson[] {
    if (!messageText || this.lessons.length === 0) return [];

    const lower = messageText.toLowerCase();
    const words = lower.split(/\s+/).filter((w) => w.length > 2);

    return this.lessons.filter((l) => {
      const sitLower = l.situationTrigger.toLowerCase();
      // Exact substring match
      if (lower.includes(sitLower) || sitLower.includes(lower)) return true;
      // Word overlap match
      const matchedWords = words.filter((w) => sitLower.includes(w));
      return matchedWords.length >= 2;
    }).slice(0, 4);
  }

  /**
   * Compiles learned lessons prompt block to inject into Friday's cognitive reasoning
   */
  public async compileTrainingPrompt(incomingMessage?: string): Promise<string> {
    await this.init();
    if (this.lessons.length === 0) return "";

    let relevant = incomingMessage ? this.findRelevantLessons(incomingMessage) : [];
    if (relevant.length === 0) {
      // Pick top 4 most recent core lessons
      relevant = this.lessons.slice(0, 4);
    }

    const lines = relevant.map((l, i) => {
      let line = `  ${i + 1}. [SITUATION]: "${l.situationTrigger}"\n     👉 [HOW BOSS TAUGHT YOU TO REACT]: "${l.taughtReaction}"`;
      if (l.idealSampleResponse) {
        line += `\n     💬 [EXAMPLE RESPONSE]: "${l.idealSampleResponse}"`;
      }
      return line;
    });

    return `\n\n🎓 GOLDEN BEHAVIORAL LESSONS TAUGHT PERSONALLY BY BOSS DK (OBEY STRICTLY LIKE A WELL-TRAINED CHILD):
You were personally taught and mentored by Boss DK to behave according to these rules:
${lines.join("\n\n")}
Apply these exact behavioral principles to your tone, emotion, and actions in this conversation!\n`;
  }

  /**
   * Parses natural language teaching commands from Boss
   */
  public parseTeachingCommand(messageText: string): {
    isTeachingCommand: boolean;
    action?: "teach" | "correct" | "practice" | "revise" | "delete";
    situation?: string;
    reaction?: string;
    correctionText?: string;
  } {
    const text = (messageText || "").trim();

    // 1. Revision command: "jo jo sikhaya hai revise karke batao", "lessons batao", "training list"
    if (/(?:jo\s+jo\s+sikhaya|lessons|training|gurukul|playbook)\s+(?:hai\s+)?(?:revise|dikhao|batao|list|suna)/i.test(text)) {
      return { isTeachingCommand: true, action: "revise" };
    }

    // 2. Correction command: "nahi friday aise nahi bolte...", "galti sudharo...", "aage se aisa mat bolna..."
    const correctMatch =
      text.match(/(?:nahi\s+friday|aise\s+nahi|galat\s+hai|galti\s+sudharo|aage\s+se\s+aisa\s+mat\s+bolna|sudhaar\s+lo)\s*[,:!]\s*(.+)/i) ||
      text.match(/(?:aage\s+se|ab\s+se)\s+(?:aise|ye)\s+bolna\s*[:,-]?\s*(.+)/i);

    if (correctMatch) {
      return {
        isTeachingCommand: true,
        action: "correct",
        correctionText: correctMatch[1].trim(),
      };
    }

    // 3. Teaching command: "Friday sikh lo: Jab X ho tab Y karna", "Jab bhi X ho to Y bolna"
    const teachMatch =
      text.match(/(?:friday\s+)?(?:sikh\s+lo|yaad\s+rakho|samajh\s+lo|dhyan\s+rakho|main\s+sikha\s+raha\s+hu)\s*[:,-]?\s*(?:jab\s+bhi|jab)\s+(.+?)\s+(?:tab|toh|to|tabhi)\s+(.+)/i) ||
      text.match(/jab\s+(?:bhi\s+)?(.+?)\s+(?:tab|toh|to)\s+(?:tum|friday\s+)?(.+)/i);

    if (teachMatch) {
      return {
        isTeachingCommand: true,
        action: "teach",
        situation: teachMatch[1].trim(),
        reaction: teachMatch[2].trim(),
      };
    }

    // 4. Practice drill command: "Chalo practice karte hain...", "Maan lo maine bola X..."
    const practiceMatch = text.match(/(?:chalo\s+practice\s+karte\s+hain|mock\s+test|maan\s+lo\s+maine\s+bola)\s*[:,-]?\s*(.+)/i);
    if (practiceMatch) {
      return {
        isTeachingCommand: true,
        action: "practice",
        situation: practiceMatch[1].trim(),
      };
    }

    // 5. Delete lesson: "lesson hata do", "training delete karo"
    const deleteMatch = text.match(/(?:lesson|training|sikhaya\s+hua\s+rule)\s+(?:hata\s+do|delete\s+karo|clear\s+karo)\s*[:,-]?\s*(.*)/i);
    if (deleteMatch) {
      return {
        isTeachingCommand: true,
        action: "delete",
        situation: deleteMatch[1]?.trim() || "all",
      };
    }

    return { isTeachingCommand: false };
  }
}

export const fridayChildTrainingService = new FridayChildTrainingService();
