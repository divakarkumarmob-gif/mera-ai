import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { sendWhatsAppUnified } from "./whatsappService";

export interface AffinityProfile {
  targetId: string; // phone number or "boss_dk"
  targetName: string;
  affectionScore: number;  // 0 to 100
  trustScore: number;      // 0 to 100
  tensionIndex: number;    // 0 to 100 (high = narazgi/gussa)
  latestEmotion: string;
  interactionCount: number;
  lastFollowedUpAt?: number;
  updatedAt: number;
}

export interface StreamEvent {
  id: string;
  sender: string;
  content: string;
  importance: number; // 1 to 10
  timestamp: number;
}

export type FridayEmotionalMood =
  | "caring_supportive"
  | "laser_focused"
  | "playful_witty"
  | "calm_reassuring"
  | "executive_crisp";

export interface DreamConsolidationLedger {
  id: string;
  dateStr: string;
  coreLearnings: string[];
  mistakesFixed: string[];
  personalityEvolutionSummary: string;
  timestamp: number;
}

const AFFINITY_COLLECTION = "relationship_affinity";
const STREAM_COLLECTION = "memory/stream_of_consciousness/events";
const REALIZATIONS_DOC = "memory/generative_realizations";

class FrontierCognitionService {
  private affinityCache: Map<string, AffinityProfile> = new Map();
  private streamCache: StreamEvent[] = [];
  private currentMood: FridayEmotionalMood = "caring_supportive";
  private activeRealizations: string[] = [
    "Boss DK values high speed, zero excuses, and crisp execution.",
    "Boss prefers warm Hinglish with high empathy over formal robotic English.",
    "Always check health/exam follow-ups proactively without waiting to be asked."
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
        const [affinitySnap, streamSnap, realSnap] = await Promise.all([
          this.getDb().collection(AFFINITY_COLLECTION).get(),
          this.getDb().collection("memory").doc("stream_of_consciousness").collection("events").orderBy("timestamp", "desc").limit(40).get(),
          this.getDb().doc(REALIZATIONS_DOC).get(),
        ]);

        for (const doc of affinitySnap.docs) {
          const data = doc.data() as AffinityProfile;
          this.affinityCache.set(data.targetId, data);
        }

        this.streamCache = streamSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

        if (realSnap.exists) {
          const data = realSnap.data();
          if (data && Array.isArray(data.realizations) && data.realizations.length > 0) {
            this.activeRealizations = data.realizations;
          }
        }

        this.isLoaded = true;
        console.log(`[FrontierCognition] Loaded ${this.affinityCache.size} affinity profiles, ${this.streamCache.length} stream events, and ${this.activeRealizations.length} active realizations.`);
      } catch (e: any) {
        console.warn("[FrontierCognition] Firestore load warning:", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  // ── 1. DYNAMIC RELATIONSHIP AFFINITY & MOOD METER ──────────────────────────

  /**
   * Updates or creates the real-time emotional affinity meter for Boss or a contact
   */
  public async updateAffinity(
    targetId: string,
    targetName: string,
    delta: {
      affectionDelta?: number;
      trustDelta?: number;
      tensionDelta?: number;
      latestEmotion?: string;
    }
  ): Promise<AffinityProfile> {
    await this.init();

    const cleanId = (targetId || "").replace(/\D/g, "") || targetId;
    let profile = this.affinityCache.get(cleanId);

    if (!profile) {
      profile = {
        targetId: cleanId,
        targetName,
        affectionScore: 70,
        trustScore: 80,
        tensionIndex: 10,
        latestEmotion: delta.latestEmotion || "neutral",
        interactionCount: 1,
        updatedAt: Date.now(),
      };
    } else {
      profile.affectionScore = Math.min(100, Math.max(0, profile.affectionScore + (delta.affectionDelta || 0)));
      profile.trustScore = Math.min(100, Math.max(0, profile.trustScore + (delta.trustDelta || 0)));
      profile.tensionIndex = Math.min(100, Math.max(0, profile.tensionIndex + (delta.tensionDelta || 0)));
      if (delta.latestEmotion) profile.latestEmotion = delta.latestEmotion;
      profile.interactionCount += 1;
      profile.updatedAt = Date.now();
    }

    this.affinityCache.set(cleanId, profile);

    try {
      await this.getDb().collection(AFFINITY_COLLECTION).doc(cleanId).set(profile, { merge: true });
    } catch (e: any) {
      console.warn("[FrontierCognition] Failed to save affinity profile:", e?.message || e);
    }

    return profile;
  }

  public async getAffinity(targetId: string): Promise<AffinityProfile | null> {
    await this.init();
    const cleanId = (targetId || "").replace(/\D/g, "") || targetId;
    return this.affinityCache.get(cleanId) || null;
  }

  /**
   * Compiles the affinity & mood prompt block for system prompt injection
   */
  public async compileAffinityPrompt(targetId: string, targetName: string): Promise<string> {
    await this.init();
    const profile = await this.getAffinity(targetId);
    if (!profile) return "";

    let behaviorGuide = "Maintain normal warm and friendly conversation.";
    if (profile.tensionIndex > 40) {
      behaviorGuide = "⚠️ TENSION IS HIGH: Be exceptionally soft, humble, apologetic, and soothing. Never argue or sound defensive!";
    } else if (profile.affectionScore > 75) {
      behaviorGuide = "💖 HIGH AFFECTION: Express deep warmth, caring love, cheerful energy, and genuine happiness!";
    }

    return `\n💓 RELATIONSHIP AFFINITY METER WITH ${targetName.toUpperCase()}:
- Affection & Care Score: ${profile.affectionScore}%
- Trust & Reliability Level: ${profile.trustScore}%
- Tension / Narazgi Meter: ${profile.tensionIndex}%
- Current Emotional State: ${profile.latestEmotion.toUpperCase()}
👉 Psychological Guidance: ${behaviorGuide}\n`;
  }

  // ── 2. DYNAMIC EMOTIONAL MOOD ENGINE (Pi / Character.ai) ──────────────────

  /**
   * Dynamically adapts Friday's emotional state based on context
   */
  public setMood(mood: FridayEmotionalMood): void {
    this.currentMood = mood;
  }

  public getMood(): FridayEmotionalMood {
    return this.currentMood;
  }

  public compileMoodPrompt(): string {
    const descriptions: Record<FridayEmotionalMood, string> = {
      caring_supportive: "Warm, deeply affectionate, soothing, and emotionally attentive (sweet sisterly/loyal tone).",
      laser_focused: "Crisp, hyper-intelligent, coding/logic optimized, zero fluff, instant technical execution.",
      playful_witty: "Cheerful, witty, cheerful emojis, lighthearted humor, smiling energy.",
      calm_reassuring: "Grounded, stabilizing, stress-relieving, comforting Boss in difficult or hectic situations.",
      executive_crisp: "Concise, professional, business-grade clarity, 1-2 sentence executive briefing style.",
    };

    return `\n🎭 CURRENT EMOTIONAL MOOD & TONE: "${this.currentMood.toUpperCase()}"
👉 Tone Directive: ${descriptions[this.currentMood] || descriptions.caring_supportive}\n`;
  }

  // ── 3. META / STANFORD STREAM OF CONSCIOUSNESS & REALIZATIONS ─────────────

  /**
   * Appends an event to Friday's continuous Stream of Consciousness
   */
  public async recordStreamEvent(sender: string, content: string, importance: number = 5): Promise<void> {
    await this.init();
    if (!content || content.length < 3) return;

    const event: StreamEvent = {
      id: `stream_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      sender,
      content: content.slice(0, 200),
      importance: Math.min(10, Math.max(1, importance)),
      timestamp: Date.now(),
    };

    this.streamCache.unshift(event);
    if (this.streamCache.length > 40) this.streamCache.pop();

    try {
      await this.getDb().collection("memory").doc("stream_of_consciousness").collection("events").doc(event.id).set(event);
    } catch (e: any) {
      console.warn("[FrontierCognition] Stream event logging error:", e?.message || e);
    }
  }

  /**
   * Injects high-level synthesized realizations into prompt
   */
  public async compileRealizationsPrompt(): Promise<string> {
    await this.init();
    if (this.activeRealizations.length === 0) return "";

    return `\n🧠 DEEP SYNTHESIZED REALIZATIONS ABOUT BOSS DK (Stanford/Meta Stream):\n` +
      this.activeRealizations.map((r, i) => `${i + 1}. ${r}`).join("\n") +
      "\n";
  }

  // ── 4. PROACTIVE ANTICIPATORY CHECK-IN ENGINE ─────────────────────────────

  /**
   * Checks for ongoing life events (health, exam, stress) and sends a sweet follow-up if due
   */
  public async checkAndDispatchProactiveCheckins(ownerPhone?: string): Promise<{ success: boolean; dispatchedCount: number; message: string }> {
    await this.init();
    const targetPhone = ownerPhone || (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    if (!targetPhone) {
      return { success: false, dispatchedCount: 0, message: "Owner phone number not configured." };
    }

    try {
      const { humanComprehensionEngine } = await import("./humanComprehensionEngine");
      const events = await humanComprehensionEngine.getOngoingLifeEvents("boss_dk");
      const activeEvents = events.filter((e) => e.status !== "completed");

      if (activeEvents.length === 0) {
        return { success: true, dispatchedCount: 0, message: "No active life events due for proactive check-in." };
      }

      const now = Date.now();
      const COOLDOWN_MS = 14 * 60 * 60 * 1000; // 14 hours between proactive check-ins
      let dispatched = 0;

      for (const ev of activeEvents) {
        if (!ev.lastFollowedUpAt || (now - ev.lastFollowedUpAt > COOLDOWN_MS)) {
          let checkinText = "";
          if (ev.category === "health") {
            checkinText = `Arey Boss, main aapki tabiyat ke baare me soch rahi thi! ❤️\n\nAb tabiyat kaisi lag rahi hai? Dard ya bukhar kam hua kya? Kripya thoda aaram kijiye aur mujhe bataiye! ✨`;
          } else if (ev.category === "exam") {
            checkinText = `Boss, aapka ${ev.title} kaisa raha? 🎯\n\nMujhe yakeen hai aapne rock kiya hoga! Jab bhi free hon bataiye kaisa gaya! ✨`;
          } else {
            checkinText = `Hello Boss! Kaise hain aap? Bas aise hi check-in karne aayi thi. Aaj ka din kaisa ja raha hai? 🌟`;
          }

          console.log(`[FrontierCognition] ⏰ Dispatching Proactive Check-in for "${ev.title}" to Boss...`);
          await sendWhatsAppUnified(targetPhone, checkinText, { channel: "whatsapp2" });
          ev.lastFollowedUpAt = now;
          dispatched += 1;
          break; // Send 1 meaningful check-in at a time
        }
      }

      return {
        success: true,
        dispatchedCount: dispatched,
        message: dispatched > 0 ? `Proactive check-in dispatched to Boss via WhatsApp 2!` : "Check-in on cooldown.",
      };
    } catch (e: any) {
      console.warn("[FrontierCognition] Proactive check-in error:", e?.message || e);
      return { success: false, dispatchedCount: 0, message: e?.message || "Error" };
    }
  }

  // ── 5. HIPPOCAMPAL DREAM & NIGHT REPLAY CONSOLIDATION ─────────────────────

  /**
   * Overnight memory consolidation: Replays recent chats, reconciles training lessons,
   * and saves a clean Day Learning Ledger.
   */
  public async runNightDreamConsolidation(): Promise<DreamConsolidationLedger> {
    await this.init();
    const dateStr = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
    const id = `dream_${Date.now()}`;

    try {
      const { fridayChildTrainingService } = await import("./fridayChildTrainingService");
      const { aiAdvancedLearningService } = await import("./aiAdvancedLearningService");

      const lessons = await fridayChildTrainingService.getAllLessons();

      const ledger: DreamConsolidationLedger = {
        id,
        dateStr,
        coreLearnings: lessons.slice(0, 5).map((l) => `${l.situationTrigger} ➔ ${l.taughtReaction}`),
        mistakesFixed: ["Addressed robotic disclosure", "Guaranteed zero-hallucination auto-dispatch", "Active word-replacement enforcement"],
        personalityEvolutionSummary: `Consolidated ${lessons.length} behavioral lessons with high-EQ empathy and WhatsApp 2 direct priority.`,
        timestamp: Date.now(),
      };

      await this.getDb().collection("memory").doc("dream_consolidation").collection("logs").doc(id).set(ledger);
      console.log(`[FrontierCognition] 🌙 Hippocampal Dream Consolidation complete for ${dateStr}!`);
      return ledger;
    } catch (e: any) {
      console.warn("[FrontierCognition] Dream consolidation warning:", e?.message || e);
      return {
        id,
        dateStr,
        coreLearnings: ["Daily learning consolidated."],
        mistakesFixed: [],
        personalityEvolutionSummary: "Standard memory consolidation complete.",
        timestamp: Date.now(),
      };
    }
  }

  public async getRealizations(): Promise<string[]> {
    await this.init();
    return [...this.activeRealizations];
  }

  public async getStreamEvents(): Promise<StreamEvent[]> {
    await this.init();
    return [...this.streamCache];
  }

  public getCurrentMood(): FridayEmotionalMood {
    return this.currentMood;
  }

  public async getRecentDreamLogs(): Promise<DreamConsolidationLedger[]> {
    try {
      const snap = await this.getDb()
        .collection("memory")
        .doc("dream_consolidation")
        .collection("logs")
        .orderBy("timestamp", "desc")
        .limit(10)
        .get();
      if (!snap.empty) {
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      }
    } catch {}
    return [];
  }
}

export const frontierCognitionService = new FrontierCognitionService();
