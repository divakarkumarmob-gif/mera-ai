import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

export interface RlhfFeedbackEntry {
  id: string;
  emoji: string;
  sentiment: "positive" | "negative" | "humor";
  targetMessageText: string;
  targetSender: string;
  bossFeedbackAnalysis: string;
  timestamp: number;
}

export interface BossStyleProfile {
  slangTokens: string[];
  favoriteEmojis: string[];
  averageSentenceLength: number;
  toneCharacteristics: string[];
  observedSampleCount: number;
  updatedAt: number;
}

const RLHF_COLLECTION = "rlhf_rewards";
const STYLE_DOC = "memory/bossStyleProfile";

class AiAdvancedLearningService {
  private rlhfCache: RlhfFeedbackEntry[] = [];
  private bossStyleCache: BossStyleProfile | null = null;
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
        const [rlhfSnap, styleSnap] = await Promise.all([
          this.getDb().collection(RLHF_COLLECTION).orderBy("timestamp", "desc").limit(100).get(),
          this.getDb().doc(STYLE_DOC).get(),
        ]);

        this.rlhfCache = rlhfSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        if (styleSnap.exists) {
          this.bossStyleCache = styleSnap.data() as BossStyleProfile;
        } else {
          this.bossStyleCache = {
            slangTokens: ["bhai", "yaar", "arre", "theek hai", "suno", "mast", "scene"],
            favoriteEmojis: ["👍", "🔥", "❤️", "😊", "✨"],
            averageSentenceLength: 8,
            toneCharacteristics: ["confident", "direct", "caring", "witty"],
            observedSampleCount: 0,
            updatedAt: Date.now(),
          };
        }
        this.isLoaded = true;
        console.log(`[AdvancedLearning] Loaded ${this.rlhfCache.length} RLHF reward events & Boss style profile.`);
      } catch (e: any) {
        console.warn("[AdvancedLearning] Firestore load warning:", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  // ── 1. RLHF EMOJI REACTION REWARD SYSTEM ──────────────────────────────────

  /**
   * Processes a WhatsApp message reaction (❤️, 👍, 👎, 😡, 😂) from Boss or contacts
   */
  public async processEmojiReaction(
    emoji: string,
    targetMessageText: string,
    targetSender: string,
    isFromBoss: boolean
  ): Promise<RlhfFeedbackEntry | null> {
    await this.init();

    const cleanEmoji = emoji.trim();
    if (!cleanEmoji || !targetMessageText) return null;

    let sentiment: RlhfFeedbackEntry["sentiment"] = "positive";
    let analysis = "";

    if (/❤️|💖|💕|🔥|👍|👏|🙏|💯|⭐/u.test(cleanEmoji)) {
      sentiment = "positive";
      analysis = `Boss strongly APPROVED and rewarded this response style: "${targetMessageText.slice(0, 100)}..."`;
    } else if (/😡|👎|💩|❌|💔|🙄|🤦/u.test(cleanEmoji)) {
      sentiment = "negative";
      analysis = `Boss DISAPPROVED and penalized this response style: "${targetMessageText.slice(0, 100)}..."`;
    } else if (/😂|🤣|😹/u.test(cleanEmoji)) {
      sentiment = "humor";
      analysis = `Boss found this witty and funny (Humor reward): "${targetMessageText.slice(0, 100)}..."`;
    } else {
      sentiment = "positive";
      analysis = `Reaction received: ${cleanEmoji}`;
    }

    const entry: RlhfFeedbackEntry = {
      id: `rlhf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      emoji: cleanEmoji,
      sentiment,
      targetMessageText: targetMessageText.trim(),
      targetSender,
      bossFeedbackAnalysis: analysis,
      timestamp: Date.now(),
    };

    this.rlhfCache.unshift(entry);
    if (this.rlhfCache.length > 100) this.rlhfCache.pop();

    try {
      await this.getDb().collection(RLHF_COLLECTION).doc(entry.id).set(entry);
      console.log(`[AdvancedLearning] 🎯 RLHF Reward logged (${cleanEmoji} -> ${sentiment}): ${analysis}`);
    } catch (e: any) {
      console.warn("[AdvancedLearning] Failed to save RLHF entry:", e?.message || e);
    }

    return entry;
  }

  /**
   * Compiles the RLHF feedback prompt for system instructions
   */
  public async compileRlhfPrompt(): Promise<string> {
    await this.init();
    if (this.rlhfCache.length === 0) return "";

    const positive = this.rlhfCache.filter((r) => r.sentiment === "positive" || r.sentiment === "humor").slice(0, 3);
    const negative = this.rlhfCache.filter((r) => r.sentiment === "negative").slice(0, 3);

    let prompt = `\n🎯 REINFORCEMENT LEARNING FROM BOSS FEEDBACK (RLHF SIGNALS):`;
    if (positive.length > 0) {
      prompt += `\n✅ APPROVED & REWARDED RESPONSE EXAMPLES (Emulate this tone):\n${positive.map((p) => `• "${p.targetMessageText}" (Boss reacted with ${p.emoji})`).join("\n")}`;
    }
    if (negative.length > 0) {
      prompt += `\n❌ PENALIZED & DISAPPROVED EXAMPLES (DO NOT repeat these mistakes):\n${negative.map((n) => `• "${n.targetMessageText}" (Boss reacted with ${n.emoji})`).join("\n")}`;
    }

    return prompt + "\n";
  }

  // ── 2. CONSTITUTIONAL AI SELF-CRITIQUE & REFLECTION LOOP ──────────────────

  /**
   * Evaluates draft text against Friday's Constitution before delivering to user
   */
  public async runConstitutionalCritique(
    draftText: string,
    context: {
      isToBoss: boolean;
      recipientName?: string;
      relation?: string;
    }
  ): Promise<string> {
    if (!draftText || draftText.length < 5) return draftText;

    // Rule 1: Identity Concealment for special contacts
    if (!context.isToBoss && context.relation && /girlfriend|gf|crush|wife|bestfriend|friend|family/i.test(context.relation)) {
      if (/main\s+(?:friday|ai|bot|language\s+model)\s+hoon/i.test(draftText)) {
        console.warn("[AdvancedLearning] 🛡️ Constitutional Critic intercepted AI disclosure to special contact. Cleansing...");
        draftText = draftText.replace(/main\s+(?:friday|ai|bot|language\s+model)\s+hoon[^\.]*\.?/gi, "").trim();
      }
    }

    // Rule 2: Remove robotic prefix leaks (e.g. "Friday:", "AI:", "Response:")
    draftText = draftText.replace(/^(?:friday|ai|bot|assistant)\s*:\s*/i, "").trim();

    return draftText;
  }

  // ── 3. SHADOW MODE / OBSERVATIONAL STYLE LEARNER ──────────────────────────

  /**
   * Observes Boss's outgoing chatting messages to learn style, slang, and emojis
   */
  public async observeBossChattingStyle(outgoingText: string, recipientNameOrPhone?: string): Promise<void> {
    await this.init();
    if (!outgoingText || outgoingText.length < 3) return;

    const clean = outgoingText.trim();
    if (!this.bossStyleCache) return;

    // 1. Extract emojis
    const emojiMatches = clean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
    for (const em of emojiMatches) {
      if (!this.bossStyleCache.favoriteEmojis.includes(em)) {
        this.bossStyleCache.favoriteEmojis.unshift(em);
        if (this.bossStyleCache.favoriteEmojis.length > 10) this.bossStyleCache.favoriteEmojis.pop();
      }
    }

    // 2. Extract slangs / frequent Hindi-English words
    const words = clean.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !w.startsWith("http"));
    for (const w of words) {
      if (["bhai", "yaar", "bro", "arre", "acha", "suno", "mast", "tension", "scene", "ghumne", "kaam", "party"].includes(w)) {
        if (!this.bossStyleCache.slangTokens.includes(w)) {
          this.bossStyleCache.slangTokens.push(w);
        }
      }
    }

    this.bossStyleCache.observedSampleCount += 1;
    this.bossStyleCache.updatedAt = Date.now();

    // Persist periodically
    if (this.bossStyleCache.observedSampleCount % 5 === 0) {
      try {
        await this.getDb().doc(STYLE_DOC).set(this.bossStyleCache, { merge: true });
        console.log(`[AdvancedLearning] 👁️ Shadow Style Profile updated (${this.bossStyleCache.observedSampleCount} samples).`);
      } catch (e: any) {
        console.warn("[AdvancedLearning] Failed to update style profile:", e?.message || e);
      }
    }
  }

  /**
   * Compiles Boss Style Persona prompt
   */
  public async compileBossStylePrompt(): Promise<string> {
    await this.init();
    if (!this.bossStyleCache || this.bossStyleCache.observedSampleCount < 3) return "";

    return `\n👁️ SHADOW LEARNING STYLE (Mirror Boss DK's Authentic Slangs & Flow):
- Boss's Natural Slangs: ${this.bossStyleCache.slangTokens.slice(0, 8).join(", ")}
- Boss's Favorite Emojis: ${this.bossStyleCache.favoriteEmojis.slice(0, 6).join(" ")}
- Tone Style: Natural, confident, brotherly/caring Hinglish flow.\n`;
  }
}

export const aiAdvancedLearningService = new AiAdvancedLearningService();
