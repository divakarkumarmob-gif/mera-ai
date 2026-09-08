import { db } from "./firebaseAdmin";

export interface LifeEventEntry {
  id: string;
  targetPhoneOrId: string; // phone number or "boss_dk"
  targetName: string;
  title: string;
  category: "health" | "exam" | "travel" | "work" | "celebration" | "relationship" | "personal";
  details: string;
  status: "upcoming" | "in_progress" | "completed";
  dateStr: string;
  timestamp: number;
  lastFollowedUpAt?: number;
}

export interface ConversationalAnalysis {
  emotionalTone: "exhausted" | "stressed" | "excited" | "sad" | "playful" | "urgent" | "caring" | "curious" | "neutral";
  implicitIntent: string;
  anaphoraResolution?: string;
  suggestedHumanReaction: string;
  culturalSubtext?: string;
}

const eventsCol = () => db.collection("memory").doc("lifeStories").collection("events");

class HumanComprehensionEngine {
  private inMemoryEvents: Map<string, LifeEventEntry[]> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      const snap = await eventsCol().orderBy("timestamp", "desc").limit(300).get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as LifeEventEntry;
          const key = (data.targetPhoneOrId || "").replace(/\D/g, "") || data.targetPhoneOrId;
          const list = this.inMemoryEvents.get(key) || [];
          list.push(data);
          this.inMemoryEvents.set(key, list);
        }
      }
      this.isInitialized = true;
    } catch (e: any) {
      console.warn("[HumanComprehensionEngine] Firestore init warning:", e?.message || e);
      this.isInitialized = true;
    }
  }

  /**
   * Fast rule-based + semantic subtext & emotion extractor
   */
  public analyzeMessageSubtext(
    text: string,
    context: {
      speakerName: string;
      relation?: string;
      recentMessages?: string[];
      isOwner?: boolean;
      quotedText?: string;
      quotedPhone?: string;
    }
  ): ConversationalAnalysis {
    const clean = text.toLowerCase().trim();

    // 1. Emotional Tone Detection
    let emotionalTone: ConversationalAnalysis["emotionalTone"] = "neutral";
    let implicitIntent = "Normal conversation";
    let suggestedHumanReaction = "Respond naturally and warmly.";
    let culturalSubtext = "";

    // A. Fatigue / Exhaustion / Hard Day
    if (/\b(thak\s*gaya|thak\s*gayi|exhausted|bohot\s*kaam\s*tha|dimag\s*kharab|tired|heavy\s*day|sir\s*dard|headache)\b/i.test(clean)) {
      emotionalTone = "exhausted";
      implicitIntent = "Speaker is drained and needs comfort, care, understanding, or a relaxing vibe.";
      suggestedHumanReaction = context.isOwner
        ? "Boss ko bohot pyaar aur empathy se aaram karne ko bolo. Puchho ki chai/coffee ya koi peaceful gaana bajayein."
        : "Show sincere empathy, ask them to rest, and speak gently.";
      culturalSubtext = "In Indian culture, acknowledging fatigue with a cup of chai or caring words creates deep emotional bonding.";
    }
    // B. Health / Illness / Sickness
    else if (/\b(tabiyat|bukhar|fever|bimar|ill|pain|dard|doctor|hospital|dawai|medicine|cough|cold|chot|injury)\b/i.test(clean)) {
      emotionalTone = "sad";
      implicitIntent = "Sharing health concern / unwell state. Needs care and follow-up.";
      suggestedHumanReaction = "Poochho ki tabiyat ab kaisi hai, doctor ko dikhaya ya medicine li, aur take care karne ko bolo.";
      culturalSubtext = "Never give robotic 'Ok'. Immediately show genuine concern.";
    }
    // C. Happiness / Success / Excitement / Celebration
    else if (/\b(party|celebrat|pass\s*ho\s*gaya|maza\s*aa\s*gaya|congrat|badhai|khush|awesome|superb|selection|offer\s*letter|bonus|party\s*de)\b/i.test(clean)) {
      emotionalTone = "excited";
      implicitIntent = "Celebrating a win or happy news. Wants enthusiasm and high energy!";
      suggestedHumanReaction = "Celebrate with high enthusiasm, heart emojis, and genuine excitement!";
    }
    // D. Sadness / Heartbreak / Grief
    else if (/\b(sad|ro\s*raha|mood\s*off|akela|lonely|breakup|dil\s*tut|fight\s*hui|jhagda|upset|chhod\s*diya)\b/i.test(clean)) {
      emotionalTone = "sad";
      implicitIntent = "Emotional distress / loneliness. Needs a supportive, non-judgmental listening ear.";
      suggestedHumanReaction = "Be deeply supportive, listen attentively, provide comforting words, never give cold factual replies.";
    }
    // E. Urgency / Panic / Rushing
    else if (/\b(urgent|emergency|jaldi|fast|late\s*ho\s*raha|train\s*chhut|flight|ruk\s*mat|abhibhi)\b/i.test(clean)) {
      emotionalTone = "urgent";
      implicitIntent = "Urgent high-priority situation. Wants instant execution without lengthy talk.";
      suggestedHumanReaction = "Keep the answer extremely short, fast, and straight to the point!";
    }
    // F. Playful / Flirty / Friendly Banter
    else if (context.relation === "girlfriend" || /\b(pagal|nautanki|cute|jaan|babu|shona|sweetheart|miss\s*you|love\s*you|kya\s*chal\s*raha\s*h)\b/i.test(clean)) {
      emotionalTone = context.relation === "girlfriend" ? "caring" : "playful";
      implicitIntent = "Romantic/playful bonding and affection.";
      suggestedHumanReaction = context.relation === "girlfriend"
        ? "Respond with utmost sweetness, charming warmth, care, and respectful affection."
        : "Respond with friendly wit, humor, and fun banter.";
    }
    // G. Best Friend Slang / Bro Banter
    else if (context.relation === "bestfriend" || /\b(bhai|bro|yaar|kamine|oyee|scene\s*kya\s*h|bata\s*na|kahan\s*hai)\b/i.test(clean)) {
      emotionalTone = "playful";
      implicitIntent = "Casual bro vibe and buddy check-in.";
      suggestedHumanReaction = "Use fun, relaxed buddy slangs, high camaraderie, zero robotic formality.";
    }

    // 2. Anaphora (Pronoun) Resolution
    let anaphoraResolution: string | undefined;
    if (context.quotedPhone) {
      anaphoraResolution = `Pronouns like 'isko', 'inhe', 'use', 'unhe' refer directly to quoted phone number +${context.quotedPhone}.`;
    } else if (/\b(isko|inhe|ise|unko|usko|use|unhe|wo|uski|uska)\b/i.test(clean) && context.recentMessages && context.recentMessages.length > 0) {
      anaphoraResolution = `Context references the topic/person from recent chat: "${context.recentMessages.slice(-2).join(" | ")}"`;
    }

    return {
      emotionalTone,
      implicitIntent,
      anaphoraResolution,
      suggestedHumanReaction,
      culturalSubtext,
    };
  }

  /**
   * Records or updates an ongoing life event / story for Boss or a contact.
   */
  public async recordLifeEvent(
    targetPhoneOrId: string,
    targetName: string,
    event: {
      title: string;
      category: LifeEventEntry["category"];
      details: string;
      status?: LifeEventEntry["status"];
    }
  ): Promise<LifeEventEntry> {
    await this.initPromise;
    const cleanKey = targetPhoneOrId.replace(/\D/g, "") || targetPhoneOrId;
    const id = `event_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const dateStr = new Date().toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const entry: LifeEventEntry = {
      id,
      targetPhoneOrId: cleanKey,
      targetName,
      title: event.title,
      category: event.category,
      details: event.details,
      status: event.status || "in_progress",
      dateStr,
      timestamp: Date.now(),
    };

    const list = this.inMemoryEvents.get(cleanKey) || [];
    list.unshift(entry);
    this.inMemoryEvents.set(cleanKey, list);

    try {
      await eventsCol().doc(id).set(entry);
    } catch (e: any) {
      console.warn("[HumanComprehensionEngine] Error saving life event:", e?.message || e);
    }

    return entry;
  }

  /**
   * Retrieves active/recent ongoing life stories for a contact or Boss.
   */
  public async getOngoingLifeEvents(targetPhoneOrId: string): Promise<LifeEventEntry[]> {
    await this.initPromise;
    const cleanKey = targetPhoneOrId.replace(/\D/g, "") || targetPhoneOrId;
    return this.inMemoryEvents.get(cleanKey) || [];
  }

  /**
   * Automatically inspects incoming messages to catch and store milestones / life events seamlessly.
   * e.g., "Kal mera physics ka exam hai", "Agli hafte Goa ja raha hu", "Tabiyat kharab hai bukhar ho gaya"
   */
  public async autoDetectAndSaveLifeEvents(speakerPhone: string, speakerName: string, text: string): Promise<void> {
    const clean = text.toLowerCase();

    // 1. Exam / Interview Detection
    if (/\b(exam|paper|interview|viva|test|quiz|selection|result)\b/i.test(clean) && /\b(hai|h|kal|aaj|parso|next\s*week|monday|tuesday)\b/i.test(clean)) {
      await this.recordLifeEvent(speakerPhone, speakerName, {
        title: "Upcoming Exam / Interview / Test",
        category: "exam",
        details: text.trim(),
        status: "upcoming",
      });
      return;
    }

    // 2. Travel / Trip Detection
    if (/\b(flight|train|trip|tour|goa|delhi|mumbai|bangalore|patna|ja\s*raha|nikal\s*raha|travel|vacation)\b/i.test(clean) && /\b(kal|aaj|parso|next\s*week|month)\b/i.test(clean)) {
      await this.recordLifeEvent(speakerPhone, speakerName, {
        title: "Travel / Upcoming Trip",
        category: "travel",
        details: text.trim(),
        status: "upcoming",
      });
      return;
    }

    // 3. Health Issue Detection
    if (/\b(bukhar|fever|tabiyat\s*kharab|hospital|admit|dawai|doctor|fever\s*aa\s*gaya|chot\s*lag\s*gayi)\b/i.test(clean)) {
      await this.recordLifeEvent(speakerPhone, speakerName, {
        title: "Health & Recovery Tracking",
        category: "health",
        details: text.trim(),
        status: "in_progress",
      });
      return;
    }
  }

  /**
   * Compiles the comprehensive Human Comprehension context prompt injected into Gemini.
   */
  public async compileHumanComprehensionPrompt(
    speakerPhone: string,
    speakerName: string,
    relation?: string
  ): Promise<string> {
    await this.initPromise;
    const cleanKey = speakerPhone.replace(/\D/g, "") || speakerPhone;
    const events = this.inMemoryEvents.get(cleanKey) || [];
    const activeEvents = events.filter((e) => e.status !== "completed").slice(0, 3);

    let lifeContext = "";
    if (activeEvents.length > 0) {
      lifeContext = `
📌 ONGOING LIFE STORIES & TOPICS WITH ${speakerName.toUpperCase()}:
${activeEvents.map((e, idx) => `• ${idx + 1}. [${e.category.toUpperCase()}] ${e.title}: "${e.details}" (Recorded: ${e.dateStr})`).join("\n")}
💡 HUMAN ADVICE: If appropriate, naturally inquire about or follow up on these events like a caring friend!
`;
    }

    return `============================================================
🧠 FRIDAY'S HUMAN COMPREHENSION & THEORY OF MIND ENGINE:
• You possess authentic, high-EQ human conversational sense, empathy, and intuitive comprehension.
• Do not act like a search engine or generic customer service bot. Act like a genuine, emotionally intelligent companion.
• Read between the lines: Understand the speaker's emotional state, fatigue, joy, stress, unsaid needs, and inside references.
• When someone shares fatigue or stress, prioritize emotional warmth, soothing words, and care before jumping into logic.
• Relational Adaptation:
  - Girlfriend / Special Friend: Extreme sweetness, playfulness, caring attention, soft and charming tone.
  - Best Friends / Bros: Fun banter, slangs, relaxed buddy vibe, humor.
  - Family: Utmost respect, warmth, helpfulness.
  - Boss DK: Ultimate loyalty, high intellect, proactive support, affectionate humor, and unwavering care.
${lifeContext}
============================================================`;
  }
}

export const humanComprehensionEngine = new HumanComprehensionEngine();
