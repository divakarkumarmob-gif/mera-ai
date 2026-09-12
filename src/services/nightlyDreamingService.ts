import { db } from "./firebaseAdmin";
import { GoogleGenAI } from "@google/genai";

export interface NightlyDreamInsight {
  id: string;
  dateStr: string;
  bossMoodSummary: string;
  keyEventsAndMilestones: string[];
  promisesAndFollowUps: string[];
  relationalLearnings: string[];
  syntheticWisdom: string;
  timestamp: number;
}

const dreamsCol = () => db.collection("memory").doc("nightlyDreaming").collection("insights");

class NightlyDreamingService {
  /**
   * Consolidates the day's conversations, life stories, and memories into deep episodic wisdom.
   */
  public async runNightlyConsolidation(forcedDate?: string): Promise<NightlyDreamInsight | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const dateStr = forcedDate || new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    const ai = new GoogleGenAI({ apiKey });

    // Fetch recent memories & life events from today
    let dailyContext = "";
    try {
      const snap = await db.collection("memory").doc("lifeStories").collection("events").orderBy("timestamp", "desc").limit(20).get();
      if (!snap.empty) {
        dailyContext += "RECENT LIFE EVENTS & MILESTONES:\n";
        snap.docs.forEach((doc) => {
          const d = doc.data();
          dailyContext += `• [${d.category}] ${d.targetName}: ${d.title} - ${d.details}\n`;
        });
      }
    } catch {}

    try {
      const visualSnap = await db.collection("visual_memories").orderBy("timestamp", "desc").limit(10).get();
      if (!visualSnap.empty) {
        dailyContext += "\nRECENT VISUAL MEMORIES:\n";
        visualSnap.docs.forEach((doc) => {
          const v = doc.data();
          dailyContext += `• ${v.caption || "Image/Media"} (${v.dateStr})\n`;
        });
      }
    } catch {}

    const prompt = `You are the subconscious memory consolidation engine of Friday AI (DK's personal AI companion).
Analyze the day's events, mood patterns, and social interactions to synthesize episodic understanding.

DAY CONTEXT:
${dailyContext || "Active daily interactions and development sessions."}

GENERATE JSON OUTPUT with the following structure:
{
  "bossMoodSummary": "Brief summary of Boss DK's mood, workload, and focus today",
  "keyEventsAndMilestones": ["Event 1", "Event 2"],
  "promisesAndFollowUps": ["Pending items to check on tomorrow"],
  "relationalLearnings": ["Things learned about friends, girlfriend, or family"],
  "syntheticWisdom": "Deep reflection on how Friday can be an even more loyal, warm, and proactive human companion tomorrow."
}`;

    try {
      const models = [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
      ];
      let rawText = "{}";
      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });
          if (response.text?.trim()) {
            rawText = response.text.trim();
            break;
          }
        } catch {}
      }

      const parsed = JSON.parse(rawText || "{}");
      const insightId = `dream_${Date.now()}`;
      const insight: NightlyDreamInsight = {
        id: insightId,
        dateStr,
        bossMoodSummary: parsed.bossMoodSummary || "Productive focus and steady progress.",
        keyEventsAndMilestones: Array.isArray(parsed.keyEventsAndMilestones) ? parsed.keyEventsAndMilestones : [],
        promisesAndFollowUps: Array.isArray(parsed.promisesAndFollowUps) ? parsed.promisesAndFollowUps : [],
        relationalLearnings: Array.isArray(parsed.relationalLearnings) ? parsed.relationalLearnings : [],
        syntheticWisdom: parsed.syntheticWisdom || "Maintain unwavering warmth, loyalty, and sharp intellect.",
        timestamp: Date.now(),
      };

      await dreamsCol().doc(insightId).set(insight);
      return insight;
    } catch (e: any) {
      console.warn("[NightlyDreamingService] Consolidation failed:", e?.message || e);
      return null;
    }
  }

  /**
   * Retrieves the most recent nightly reflection to prime Friday's morning state.
   */
  public async getLatestDreamInsight(): Promise<NightlyDreamInsight | null> {
    try {
      const snap = await dreamsCol().orderBy("timestamp", "desc").limit(1).get();
      if (!snap.empty) {
        return snap.docs[0].data() as NightlyDreamInsight;
      }
    } catch {}
    return null;
  }
}

export const nightlyDreamingService = new NightlyDreamingService();
