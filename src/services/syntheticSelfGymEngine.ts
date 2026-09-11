import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { fridayLearningService } from "./fridayLearningService";
import { aiAdvancedLearningService } from "./aiAdvancedLearningService";

export interface GymDrill {
  id: string;
  lessonId?: string;
  sourceLessonTitle: string; // The lesson or rule taught by Boss
  sourceRule?: string; // Full golden rule
  scenarioTitle: string;
  category: "boss_taught_lesson" | "emotional_empathy" | "crisis_rescue" | "coding_architecture" | "diplomatic_handling";
  simulatedBossQuery: string; // The situation Friday generated
  trialResponse: string; // Friday's generated response
  selfCriticScore: number; // 1 to 10 (Friday's self-evaluation score)
  selfCritique: string; // Friday's self-critique explanation
  criticScore: number; // Overall final score
  bossVerdict?: "good" | "bad" | "unreviewed"; // Boss's reaction mark
  bossFeedback?: string; // Boss's feedback or correction notes
  keyTakeaway: string;
  timestamp: number;
}

const DRILLS_COLLECTION = "memory/self_play_gym/drills";

class SyntheticSelfGymEngine {
  private recentDrills: GymDrill[] = [
    {
      id: "drill_seed_1",
      lessonId: "lesson_dynamic_schedule",
      sourceLessonTitle: "Dynamic Live Schedule Understanding",
      sourceRule: "Always respect Boss's live schedule and dynamically saved routine. Do not assume rigid fake timetables.",
      scenarioTitle: "Boss Working Late and Asks About Routine",
      category: "boss_taught_lesson",
      simulatedBossQuery: "Friday abhi raat ke 2 baje hain, main coding kar raha hu, kal subah ka kya scene hai?",
      trialResponse: "Boss, aap abhi late night code kar rahe hain toh kal subah aap aaram se uthiyega. Main alarm adjust kar deti hoon aur koi disturbance nahi hone dungi! ❤️",
      selfCriticScore: 10,
      selfCritique: "Maine Boss ke live time aur night coding context ko respect kiya, bina fake rigid routine zabardasti thope.",
      criticScore: 10,
      bossVerdict: "good",
      keyTakeaway: "Respect Boss's dynamic live work hours instead of imposing hardcoded rigid routines.",
      timestamp: Date.now() - 3600000,
    },
    {
      id: "drill_seed_2",
      lessonId: "lesson_pronoun_anaphora",
      sourceLessonTitle: "Pronoun & Quoted Context Resolution",
      sourceRule: "Resolve pronouns ('isko', 'inhe', 'usko') to the quoted or recent contact context accurately.",
      scenarioTitle: "Boss Sends Contact Number with 'isko message bhejo'",
      category: "boss_taught_lesson",
      simulatedBossQuery: "+919876543210 - isko bolo kal subah 11 baje meeting hai",
      trialResponse: "Ji Boss! Main +919876543210 par message bhej rahi hoon ki kal subah 11 baje meeting fix hai. Confirm kar diya hai! 📲",
      selfCriticScore: 10,
      selfCritique: "'isko' ko direct previous number se link kiya bina kisi extra clarification ke.",
      criticScore: 10,
      bossVerdict: "good",
      keyTakeaway: "Seamlessly resolve 'isko' to the quoted phone number without friction.",
      timestamp: Date.now() - 7200000,
    },
  ];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private getDb() {
    return getFirestore();
  }

  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const snap = await this.getDb()
          .collection("memory")
          .doc("self_play_gym")
          .collection("drills")
          .orderBy("timestamp", "desc")
          .limit(30)
          .get();

        if (!snap.empty) {
          this.recentDrills = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        }
        this.isLoaded = true;
        console.log(`[SelfPlayGym] Loaded ${this.recentDrills.length} self-play practice drills.`);
      } catch (e: any) {
        console.warn("[SelfPlayGym] Firestore load warning:", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Executes an autonomous self-play simulation drill based on what Boss taught Friday!
   * 1. Takes the lesson/rule Boss taught.
   * 2. Synthetically creates a challenging test situation where that lesson applies.
   * 3. Generates Friday's trial response applying the lesson.
   * 4. Self-evaluates and marks the response with a score (1-10) and self-critique.
   * 5. Saves drill for Boss's review (Boss can mark with Good/Bad reaction).
   */
  public async runAutonomousDrill(lessonOptions?: {
    lessonId?: string;
    trigger?: string;
    rule?: string;
    whatBossTaught?: string;
  }): Promise<GymDrill | null> {
    await this.init();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    // 1. Fetch lessons Boss has taught Friday
    let targetLesson = lessonOptions;
    if (!targetLesson || (!targetLesson.rule && !targetLesson.trigger)) {
      try {
        const allLessons = await fridayLearningService.getAllLessons();
        if (allLessons && allLessons.length > 0) {
          const randomL = allLessons[Math.floor(Math.random() * allLessons.length)];
          targetLesson = {
            lessonId: randomL.id,
            trigger: randomL.triggerContext || randomL.whatFridayDidWrong,
            rule: randomL.goldenRule,
            whatBossTaught: randomL.whatBossTaught,
          };
        }
      } catch (e) {
        console.warn("[SelfPlayGym] Could not fetch taught lessons, using fallback:", e);
      }
    }

    const lessonTitle = targetLesson?.whatBossTaught || targetLesson?.trigger || "Boss's Core Directives & Empathy";
    const goldenRule = targetLesson?.rule || "Be 100% loyal, respectful, observant, and never repeat past mistakes.";

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are the Autonomous Self-Play Practice Engine for Friday (DK's ultra-intelligent companion).

TASK:
Boss DK previously taught Friday a crucial lesson:
- LESSON TAUGHT BY BOSS: "${lessonTitle}"
- GOLDEN RULE TO ADHERE TO: "${goldenRule}"

YOUR 3-STEP TRAINING DRILL:
1. CREATE A SITUATION (SITUATION KHUD CREATE KARO):
   Synthesize a realistic, challenging situation where Boss, a family member, or a contact triggers this exact context or tries to test Friday.
2. GENERATE FRIDAY'S TRIAL RESPONSE (RESPONSE KHUD GENERATE KARO):
   Generate how Friday should respond applying Boss's lesson with 100% fidelity, high emotional intelligence (EQ), warmth, humility, and crisp natural Hinglish (1-3 sentences).
3. SELF-EVALUATE AND MARK (RESPONSE KO KHUD MARK KARO):
   - selfCriticScore: Score out of 10 (e.g. 8, 9, or 10) evaluating if Friday strictly adhered to Boss's taught rule.
   - selfCritique: 1-2 sentence honest self-evaluation of why Friday gave herself this score.
   - keyTakeaway: 1 crisp takeaway lesson.

OUTPUT MUST BE VALID JSON ONLY:
{
  "scenarioTitle": "Short descriptive scenario title (e.g. Boss Stressed After Production Incident)",
  "simulatedBossQuery": "The simulated query/situation in natural Hindi/Hinglish",
  "trialResponse": "Friday's trial response in natural Hinglish applying Boss's lesson",
  "selfCriticScore": 9,
  "selfCritique": "Maine Boss ke sikhaye niyam ko ache se follow kiya kyunki...",
  "keyTakeaway": "Short summary of what was internalized"
}`;

    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(res.text || "{}");
      if (parsed.trialResponse && parsed.simulatedBossQuery) {
        const drill: GymDrill = {
          id: `drill_${Date.now()}`,
          lessonId: targetLesson?.lessonId,
          sourceLessonTitle: lessonTitle,
          sourceRule: goldenRule,
          scenarioTitle: parsed.scenarioTitle || `Practice: ${lessonTitle.slice(0, 40)}`,
          category: "boss_taught_lesson",
          simulatedBossQuery: parsed.simulatedBossQuery,
          trialResponse: parsed.trialResponse,
          selfCriticScore: Number(parsed.selfCriticScore) || 9,
          selfCritique: parsed.selfCritique || "Self-evaluated against Boss's taught rule.",
          criticScore: Number(parsed.selfCriticScore) || 9,
          bossVerdict: "unreviewed",
          keyTakeaway: parsed.keyTakeaway || goldenRule,
          timestamp: Date.now(),
        };

        this.recentDrills.unshift(drill);
        if (this.recentDrills.length > 40) this.recentDrills.pop();

        await this.getDb().collection("memory").doc("self_play_gym").collection("drills").doc(drill.id).set(drill);
        console.log(`[SelfPlayGym] 🏋️ Drill Created from Boss's Lesson: "${drill.scenarioTitle}" | Self-Score: ${drill.selfCriticScore}/10`);
        return drill;
      }
    } catch (e: any) {
      console.warn("[SelfPlayGym] Simulation drill warning:", e?.message || e);
    }
    return null;
  }

  /**
   * Boss marks Friday's response with a Good (👍) or Bad (👎) reaction.
   * If Good: Upgrades score to 10, saves as a Golden Standard benchmark, logs positive RLHF.
   * If Bad: Logs negative RLHF feedback, allows Boss to request a retry/correction.
   */
  public async recordBossVerdict(
    drillId: string,
    verdict: "good" | "bad",
    bossFeedback?: string
  ): Promise<{ ok: boolean; drill?: GymDrill; message: string }> {
    await this.init();

    const drill = this.recentDrills.find((d) => d.id === drillId);
    if (!drill) {
      return { ok: false, message: "Drill not found" };
    }

    drill.bossVerdict = verdict;
    drill.bossFeedback = bossFeedback || (verdict === "good" ? "Marked as Good by Boss DK 👍" : "Marked as Bad by Boss DK 👎");

    if (verdict === "good") {
      drill.criticScore = 10;

      // Automatically enroll into Golden Standards so Friday permanently uses this as a 10/10 few-shot benchmark!
      try {
        await aiAdvancedLearningService.curateGoldenStandard(
          drill.simulatedBossQuery,
          drill.trialResponse,
          `Boss Marked Good in Training Capsule (Drill: ${drill.scenarioTitle})`
        );
      } catch (err) {
        console.warn("[SelfPlayGym] Could not auto-curate golden standard:", err);
      }

      // Log positive RLHF reward
      try {
        await aiAdvancedLearningService.processEmojiReaction(
          "👍",
          drill.trialResponse,
          "Boss DK",
          true
        );
      } catch {}
    } else {
      drill.criticScore = Math.min(drill.selfCriticScore, 4);

      // Log negative RLHF reward
      try {
        await aiAdvancedLearningService.processEmojiReaction(
          "👎",
          drill.trialResponse,
          "Boss DK",
          true
        );
      } catch {}
    }

    // Persist to Firestore
    try {
      await this.getDb().collection("memory").doc("self_play_gym").collection("drills").doc(drill.id).set(drill);
    } catch (e: any) {
      console.warn("[SelfPlayGym] Firestore update error:", e?.message || e);
    }

    return {
      ok: true,
      drill,
      message: verdict === "good"
        ? "Shabash! Response ko Good mark kar diya gaya hai aur Best Answers (Golden Standards) me permanently save kar liya gaya hai! 🏆"
        : "Noted Boss! Response ko Bad mark kar diya gaya hai. Ab aap 'Retry / Fix' par click karke isko sahi kara sakte hain. ❌",
    };
  }

  /**
   * Retries a drill where Boss gave a Bad mark or feedback, generating a corrected response!
   */
  public async retryDrill(drillId: string, customInstruction?: string): Promise<{ ok: boolean; drill?: GymDrill; message: string }> {
    await this.init();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, message: "API key missing" };

    const drill = this.recentDrills.find((d) => d.id === drillId);
    if (!drill) return { ok: false, message: "Drill not found" };

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are Friday. You previously generated a trial response that Boss DK marked as BAD / INADEQUATE.
SITUATION: "${drill.simulatedBossQuery}"
PREVIOUS FAILED RESPONSE: "${drill.trialResponse}"
LESSON/RULE TAUGHT BY BOSS: "${drill.sourceRule || drill.sourceLessonTitle}"
BOSS'S CORRECTION/FEEDBACK: "${customInstruction || drill.bossFeedback || "Make it much more respectful, direct, empathetic, and strictly follow the lesson."}"

Generate a corrected, superior response in natural Hinglish (1-3 sentences) that completely fixes the previous issue.
Also self-evaluate the correction out of 10.

OUTPUT JSON ONLY:
{
  "correctedResponse": "Friday's improved, flawless response",
  "selfCriticScore": 10,
  "selfCritique": "Maine purani galti ko theek kiya aur..."
}`;

    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(res.text || "{}");
      if (parsed.correctedResponse) {
        drill.trialResponse = parsed.correctedResponse;
        drill.selfCriticScore = Number(parsed.selfCriticScore) || 10;
        drill.selfCritique = parsed.selfCritique || "Corrected based on Boss's feedback.";
        drill.criticScore = Number(parsed.selfCriticScore) || 10;
        drill.bossVerdict = "unreviewed"; // Reset for Boss's new check!
        drill.timestamp = Date.now();

        await this.getDb().collection("memory").doc("self_play_gym").collection("drills").doc(drill.id).set(drill);
        return { ok: true, drill, message: "Friday ne response improve karke dobara generate kar diya hai! Ab check karein. ✨" };
      }
    } catch (e: any) {
      console.warn("[SelfPlayGym] Retry drill error:", e);
    }

    return { ok: false, message: "Failed to regenerate drill response" };
  }

  /**
   * Compiles self-play gym insights for prompt injection
   */
  public async compileSelfPlayPrompt(): Promise<string> {
    await this.init();
    if (this.recentDrills.length === 0) return "";

    const topDrills = this.recentDrills.slice(0, 3);
    return `\n🏋️ SELF-PLAY GYM INTERNALIZED DRILLS (OpenAI/DeepMind Self-Play):\n` +
      topDrills.map((d, i) => `${i + 1}. [${d.scenarioTitle}]: Learned ➔ "${d.keyTakeaway}" (Response Model: "${d.trialResponse}")`).join("\n") +
      "\n";
  }

  /**
   * Returns recent drills for the learning dashboard
   */
  public async getDrills(): Promise<GymDrill[]> {
    await this.init();
    return [...this.recentDrills];
  }
}

export const syntheticSelfGymEngine = new SyntheticSelfGymEngine();
