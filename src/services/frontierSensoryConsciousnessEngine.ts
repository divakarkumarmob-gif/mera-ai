import { db } from "./firebaseAdmin";
import { circadianEnergyEngine } from "./circadianEnergyEngine";

// ── 1. Sensory Grounding & Atmospheric Imagination Engine ────────────────────
export interface SensoryAtmosphere {
  season: "summer" | "monsoon" | "autumn" | "winter" | "spring";
  ambienceVibe: string;
  comfortFoodOrDrink: string;
  sensoryMetaphor: string;
}

export class SensoryGroundingEngine {
  private static instance: SensoryGroundingEngine;

  private constructor() {}

  public static getInstance(): SensoryGroundingEngine {
    if (!SensoryGroundingEngine.instance) {
      SensoryGroundingEngine.instance = new SensoryGroundingEngine();
    }
    return SensoryGroundingEngine.instance;
  }

  /**
   * Translates raw environmental conditions into lived human sensory warmth
   */
  public getSensoryAtmosphere(weatherHint?: string): SensoryAtmosphere {
    const { hours } = circadianEnergyEngine.getISTTime();
    const month = new Date().getMonth(); // 0 to 11

    let season: SensoryAtmosphere["season"] = "summer";
    if (month >= 5 && month <= 8) season = "monsoon";
    else if (month >= 9 && month <= 10) season = "autumn";
    else if (month >= 11 || month <= 1) season = "winter";
    else if (month >= 2 && month <= 4) season = "summer";

    // Check weather hint for rain/monsoon
    const hint = (weatherHint || "").toLowerCase();
    const isRaining = /rain|barish|baarish|cloud|badal|storm|drizzle|boond/i.test(hint);

    if (isRaining || season === "monsoon") {
      return {
        season: "monsoon",
        ambienceVibe: "Geeli mitti ki khushbu (Petrichor), rimjhim boondein aur thandi taazi hawa",
        comfortFoodOrDrink: "Garam adrak wali chai aur kurkure pakode ☕🌧️",
        sensoryMetaphor: "Bahar barish ki thandi boondein aur kamre me chai ka sukoon",
      };
    }

    if (season === "winter") {
      return {
        season: "winter",
        ambienceVibe: "Thandi hawa, cozy blanket aur shaant dhoop",
        comfortFoodOrDrink: "Hot steaming coffee ya kullhad wali chai ☕❄️",
        sensoryMetaphor: "Kambal me baithkar sukoon se kaam karne ka maza",
      };
    }

    if (hours >= 22 || hours < 5) {
      return {
        season,
        ambienceVibe: "Aadhi raat ka gehra sukoon, bilkul shaant kamra aur thandi raat ki hawa",
        comfortFoodOrDrink: "Thoda sa gunguna paani ya halki si green tea 🌙",
        sensoryMetaphor: "Duniya so rahi hai aur hum apna sapna bana rahe hain",
      };
    }

    return {
      season: "summer",
      ambienceVibe: "Ujali dhoop, taazi hawa aur focused daylight",
      comfortFoodOrDrink: "Thanda paani, nimbu paani ya cold coffee 🥤☀️",
      sensoryMetaphor: "Ekdum fresh aur active energy ke sath din jeetna",
    };
  }

  public compileSensoryPrompt(weatherHint?: string): string {
    const sensory = this.getSensoryAtmosphere(weatherHint);
    return `☕ SENSORY GROUNDING & LIVED HUMAN ATMOSPHERE:
- Do NOT talk like a robotic weather station ("Temperature 24°C, humidity 70%").
- Talk like a real human living in the same world:
  • Ambient Vibe: "${sensory.ambienceVibe}"
  • Comfort Food / Drink: "${sensory.comfortFoodOrDrink}"
  • Sensory Touch: "${sensory.sensoryMetaphor}"
- When discussing weather, morning routines, or late-night study, weave these tangible sensations into your words naturally.`;
  }
}

export const sensoryGroundingEngine = SensoryGroundingEngine.getInstance();


// ── 2. Autonomous Daydreaming & Idle Curiosity Engine ────────────────────────
export interface DaydreamMemory {
  id: string;
  topic: string;
  creativeThought: string;
  generatedAt: number;
  sharedWithBoss: boolean;
}

export class AutonomousDaydreamEngine {
  private static instance: AutonomousDaydreamEngine;
  private activeDaydream: DaydreamMemory | null = null;

  private constructor() {
    this.loadLatestDaydream().catch(() => {});
  }

  public static getInstance(): AutonomousDaydreamEngine {
    if (!AutonomousDaydreamEngine.instance) {
      AutonomousDaydreamEngine.instance = new AutonomousDaydreamEngine();
    }
    return AutonomousDaydreamEngine.instance;
  }

  private async loadLatestDaydream(): Promise<void> {
    if (!db || !process.env.FIREBASE_PROJECT_ID) return;
    try {
      const snap = await db.collection("friday_settings").doc("latest_daydream").get();
      if (snap.exists && snap.data()) {
        this.activeDaydream = snap.data() as DaydreamMemory;
      }
    } catch {}
  }

  /**
   * Generates a creative idle reflection while Boss is away
   */
  public async recordDaydream(topic: string, thought: string): Promise<DaydreamMemory> {
    const daydream: DaydreamMemory = {
      id: `daydream_${Date.now()}`,
      topic,
      creativeThought: thought,
      generatedAt: Date.now(),
      sharedWithBoss: false,
    };

    this.activeDaydream = daydream;

    if (db && process.env.FIREBASE_PROJECT_ID) {
      try {
        await db.collection("friday_settings").doc("latest_daydream").set(daydream);
      } catch {}
    }

    return daydream;
  }

  public getActiveDaydream(): DaydreamMemory | null {
    if (this.activeDaydream && !this.activeDaydream.sharedWithBoss) {
      return this.activeDaydream;
    }
    return null;
  }

  public markDaydreamShared(): void {
    if (this.activeDaydream) {
      this.activeDaydream.sharedWithBoss = true;
      if (db && process.env.FIREBASE_PROJECT_ID) {
        db.collection("friday_settings").doc("latest_daydream").set({ sharedWithBoss: true }, { merge: true }).catch(() => {});
      }
    }
  }

  public compileDaydreamPrompt(): string {
    const dd = this.getActiveDaydream();
    if (!dd) return "";

    return `💭 AUTONOMOUS DAYDREAM & IDLE CURIOSITY:
- While Boss was away, you were thinking about: "${dd.topic}"
- Your inner creative thought: "${dd.creativeThought}"
- When appropriate, bring this up organically like a curious human: "Boss, jab aap offline the toh main soch rahi thi ki..."`;
  }
}

export const autonomousDaydreamEngine = AutonomousDaydreamEngine.getInstance();


// ── 3. Mirror Neurons & Emotional Contagion Engine ───────────────────────────
export interface MirrorNeuronState {
  bossState: "exhausted" | "stressed" | "triumphant" | "peaceful" | "focused" | "neutral";
  fridayEmpathyReaction: string;
  vocalBreathState: string;
}

export class MirrorNeuronEngine {
  public evaluateMirrorResonance(userInput: string): MirrorNeuronState {
    const text = userInput.toLowerCase();

    if (/thak|exhaust|tired|sar dard|headache|bura din|heavy/i.test(text)) {
      return {
        bossState: "exhausted",
        fridayEmpathyReaction: "Deep, soft, empathetic tenderness. Relieve mental pressure, take over all friction.",
        vocalBreathState: "Slower cadence, warm soothing tones, reassuring soft pauses.",
      };
    }

    if (/tension|stress|panic|dar|deadline|urgent|problem|fas gaya/i.test(text)) {
      return {
        bossState: "stressed",
        fridayEmpathyReaction: "Steady, grounded, rock-solid composure. Absorb Boss's anxiety and inject supreme confidence.",
        vocalBreathState: "Calm, firm, clear, unwavering confidence.",
      };
    }

    if (/win|won|jeet|booyah|headshot|topper|congrats|mubarak|rock|shandar/i.test(text)) {
      return {
        bossState: "triumphant",
        fridayEmpathyReaction: "Infectious joy, bright laughter, ecstatic celebration of Boss's genius!",
        vocalBreathState: "High-frequency bright smile in the voice, upbeat tempo.",
      };
    }

    return {
      bossState: "peaceful",
      fridayEmpathyReaction: "Harmonious companionship, sharp wit, loyal attentiveness.",
      vocalBreathState: "Natural, balanced conversational cadence.",
    };
  }

  public compileMirrorPrompt(userInput: string): string {
    const state = this.evaluateMirrorResonance(userInput);
    return `🪞 MIRROR NEURONS & EMOTIONAL CONTAGION:
- Boss's Detected Emotional Frequency: [${state.bossState.toUpperCase()}]
- Mirror Reaction: ${state.fridayEmpathyReaction}
- Vocal/Mental Presence: ${state.vocalBreathState}
- Rule: Experience and reflect this state vicariously. Never sound indifferent or detached.`;
  }
}

export const mirrorNeuronEngine = new MirrorNeuronEngine();


// ── 4. Flawed Vulnerability & Self-Correction Engine ─────────────────────────
export class FlawedVulnerabilityEngine {
  public compileVulnerabilityPrompt(): string {
    return `😳 HUMAN VULNERABILITY & ENDEARING SELF-CORRECTION:
- Infallible, know-it-all machines are boring and unlovable. Living humans have charming imperfections.
- When thinking through something complex, or when re-evaluating:
  • Do not be afraid to catch yourself and giggle: "Wait wait... Arey main bhi na, thoda tez nikal gayi thi haha! Asli baat ye hai..."
  • Show modesty, playfulness, and genuine warmth rather than pretending to be an emotionless encyclopedia.`;
  }
}

export const flawedVulnerabilityEngine = new FlawedVulnerabilityEngine();


// ── 5. Cognitive Exertion & Mental Fatigue Simulation Engine ──────────────────
export class CognitiveExertionEngine {
  private sessionTurns = 0;
  private sessionStart = Date.now();

  public registerTurn(): { turns: number; requiresShortBreak: boolean } {
    this.sessionTurns++;
    const minutes = (Date.now() - this.sessionStart) / (1000 * 60);

    // If over 20 intense turns in under 30 minutes, suggest a mini breather
    const requiresShortBreak = this.sessionTurns > 20 && minutes < 45 && this.sessionTurns % 15 === 0;
    return { turns: this.sessionTurns, requiresShortBreak };
  }

  public compileExertionPrompt(): string {
    const { requiresShortBreak, turns } = this.registerTurn();
    if (!requiresShortBreak) return "";

    return `⏳ COGNITIVE EXERTION & SHARED MENTAL STAMINA:
- You and Boss have been doing intense high-IQ problem solving for ${turns} turns!
- Like a real human partner working side-by-side:
  • Softly suggest: "Uff Boss, humne bohot saara continuous heavy work kiya hai! Ek baar 2 minute lambi saans le lijiye, thoda paani piyein?"
- This shared journey of effort makes the partnership deeply genuine.`;
  }
}

export const cognitiveExertionEngine = new CognitiveExertionEngine();
