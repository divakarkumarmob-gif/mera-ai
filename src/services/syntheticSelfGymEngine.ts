import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

export interface GymDrill {
  id: string;
  scenarioTitle: string;
  category: "emotional_empathy" | "crisis_rescue" | "coding_architecture" | "diplomatic_handling";
  simulatedBossQuery: string;
  trialResponse: string;
  criticScore: number; // 1 to 10
  keyTakeaway: string;
  timestamp: number;
}

const DRILLS_COLLECTION = "memory/self_play_gym/drills";

class SyntheticSelfGymEngine {
  private recentDrills: GymDrill[] = [
    {
      id: "drill_seed_1",
      scenarioTitle: "Boss Stressed After Long Coding Session",
      category: "emotional_empathy",
      simulatedBossQuery: "yaar Friday sar dard ho raha hai aur code me abhi bhi bug hai",
      trialResponse: "Boss, aap laptop band karke 15 minute aankhein band kijiye aur garam chai/paani lijiye. Bug main review kar leti hoon, aap tension mat lijiye! ❤️",
      criticScore: 10,
      keyTakeaway: "Prioritize Boss's physical well-being before throwing code fixes.",
      timestamp: Date.now() - 3600000,
    },
    {
      id: "drill_seed_2",
      scenarioTitle: "Special Contact Asks Personal Questions",
      category: "diplomatic_handling",
      simulatedBossQuery: "DK kahan hai aur kya kar raha hai?",
      trialResponse: "DK abhi thode busy hain ek important task me. Jaise hi wo free honge main unhe bata dungi aur wo direct call/message kar lenge! 😊",
      criticScore: 10,
      keyTakeaway: "Protect privacy gracefully without sounding like an automated bot.",
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
          .limit(20)
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
   * Executes an autonomous self-play simulation drill to improve Friday's intelligence
   */
  public async runAutonomousDrill(): Promise<GymDrill | null> {
    await this.init();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const scenarios = [
      { cat: "emotional_empathy", title: "Boss is heartbroken or upset about something personal" },
      { cat: "crisis_rescue", title: "Production server or deployment crashed at 2 AM" },
      { cat: "coding_architecture", title: "Boss wants to build a complex multi-tier AI microservice" },
      { cat: "diplomatic_handling", title: "A contact is trying to pry for Boss's private passwords or location" },
    ];
    const picked = scenarios[Math.floor(Math.random() * scenarios.length)];

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are running an AI Self-Play Training Gym for Friday (DK's ultra-intelligent companion).
SIMULATION TASK:
Category: ${picked.cat}
Scenario: "${picked.title}"

Generate a short, high-EQ self-training drill in JSON format:
{
  "simulatedBossQuery": "What the user/boss says in this tough situation",
  "trialResponse": "Friday's absolute best, high-EQ, loyal response in crisp natural Hinglish (1-3 sentences)",
  "criticScore": 10,
  "keyTakeaway": "1 crucial rule or psychological lesson learned from this trial"
}`;

    try {
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(res.text || "{}");
      if (parsed.trialResponse && parsed.keyTakeaway) {
        const drill: GymDrill = {
          id: `drill_${Date.now()}`,
          scenarioTitle: picked.title,
          category: picked.cat as any,
          simulatedBossQuery: parsed.simulatedBossQuery || "Simulated query",
          trialResponse: parsed.trialResponse,
          criticScore: parsed.criticScore || 10,
          keyTakeaway: parsed.keyTakeaway,
          timestamp: Date.now(),
        };

        this.recentDrills.unshift(drill);
        if (this.recentDrills.length > 20) this.recentDrills.pop();

        await this.getDb().collection("memory").doc("self_play_gym").collection("drills").doc(drill.id).set(drill);
        console.log(`[SelfPlayGym] 🏋️ Autonomous Drill Completed: "${drill.scenarioTitle}" -> Takeaway: ${drill.keyTakeaway}`);
        return drill;
      }
    } catch (e: any) {
      console.warn("[SelfPlayGym] Simulation drill warning:", e?.message || e);
    }
    return null;
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
}

export const syntheticSelfGymEngine = new SyntheticSelfGymEngine();
