import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

export interface GroupMemberProfile {
  id: string;
  name: string;
  username?: string;
  messageCount: number;
  lastSpokeAt: number;
  observedKeywords: string[];
}

export interface GroupCollectiveProfile {
  groupId: string;
  groupTitle: string;
  platform: "whatsapp" | "telegram";
  slangTokens: string[];
  activeTopics: string[];
  insideJokes: string[];
  members: Record<string, GroupMemberProfile>;
  recentConversations: Array<{
    sender: string;
    text: string;
    timestamp: number;
  }>;
  totalMessagesAnalyzed: number;
  lastSummary?: string;
  updatedAt: number;
}

const COLLECTION_NAME = "group_learning_profiles";

class GroupCollectiveLearningService {
  private cache: Map<string, GroupCollectiveProfile> = new Map();
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
        const snap = await this.getDb().collection(COLLECTION_NAME).get();
        for (const doc of snap.docs) {
          this.cache.set(doc.id, doc.data() as GroupCollectiveProfile);
        }
        this.isLoaded = true;
        console.log(`[GroupLearning] Loaded ${this.cache.size} group collective profiles.`);
      } catch (e: any) {
        console.warn("[GroupLearning] Firestore load warning:", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Observes and learns from an incoming group message across WhatsApp or Telegram
   */
  public async learnFromGroupMessage(
    platform: "whatsapp" | "telegram", groupId: string, groupTitle: string, senderId: string, senderName: string, text: string
  ): Promise<void> {
    if (!text || text.length < 2 || text.startsWith("/")) return;
    const isSingleReactionEmoji = /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(text.trim());
    if (text.startsWith("[Reaction:") || text.startsWith("[reaction:") || /^\[Reaction/i.test(text) || isSingleReactionEmoji) return;
    await this.init();

    const cleanGroupId = String(groupId).replace(/[^a-zA-Z0-9_-]/g, "_");
    let profile = this.cache.get(cleanGroupId);

    if (!profile) {
      profile = {
        groupId: cleanGroupId, groupTitle: groupTitle || "Group Chat", platform, slangTokens: [], activeTopics: [], insideJokes: [], members: {}, recentConversations: [], totalMessagesAnalyzed: 0, updatedAt: Date.now(), };
    }

    // 1. Update member profile
    const memberKey = String(senderId || senderName).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!profile.members[memberKey]) {
      profile.members[memberKey] = {
        id: String(senderId), name: senderName, messageCount: 1, lastSpokeAt: Date.now(), observedKeywords: [], };
    } else {
      profile.members[memberKey].messageCount += 1;
      profile.members[memberKey].lastSpokeAt = Date.now();
      profile.members[memberKey].name = senderName;
    }

    // 2. Add to rolling conversation window
    profile.recentConversations.push({
      sender: senderName, text: text.slice(0, 300), timestamp: Date.now(), });
    if (profile.recentConversations.length > 40) {
      profile.recentConversations.shift();
    }

    // 3. Extract slang & topics
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    for (const w of words) {
      if (["bhai", "yaar", "bro", "arre", "scene", "party", "coding", "exam", "match", "movie", "plan", "khana", "trip", "chalo"].includes(w)) {
        if (!profile.slangTokens.includes(w)) {
          profile.slangTokens.push(w);
          if (profile.slangTokens.length > 20) profile.slangTokens.shift();
        }
      }
    }

    profile.totalMessagesAnalyzed += 1;
    profile.updatedAt = Date.now();
    this.cache.set(cleanGroupId, profile);

    // Periodically persist to Firestore (every 5 messages)
    if (profile.totalMessagesAnalyzed % 5 === 0) {
      try {
        await this.getDb().collection(COLLECTION_NAME).doc(cleanGroupId).set(profile, { merge: true });
      } catch (e: any) {
        console.warn("[GroupLearning] Failed to save group learning profile:", e?.message || e);
      }
    }
  }

  /**
   * Compiles learned group dynamics prompt for smart responses in this group
   */
  public async compileGroupContextPrompt(groupId: string): Promise<string> {
    await this.init();
    const cleanGroupId = String(groupId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const profile = this.cache.get(cleanGroupId);
    if (!profile) return "";

    const activeMembers = Object.values(profile.members)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 6)
      .map((m) => `${m.name} (${m.messageCount} msgs)`)
      .join(", ");

    const recentSnip = profile.recentConversations.slice(-6).map((c) => `${c.sender}: "${c.text}"`).join("\n");

    return `\n👥 LEARNED GROUP DYNAMICS & COLLECTIVE MEMORY FOR "${profile.groupTitle}":
- Platform: ${profile.platform.toUpperCase()}
- Active Group Members: ${activeMembers || "Group participants"}
- Group Common Slangs/Keywords: ${profile.slangTokens.slice(0, 8).join(", ") || "Normal chat"}
- Recent Group Context (Last discussions):
${recentSnip || "No recent messages"}\n`;
  }

  /**
   * Generates an AI-powered comprehensive summary of recent discussions in a WhatsApp or Telegram group
   */
  public async generateGroupSummary(groupId: string, groupTitle: string): Promise<string> {
    await this.init();
    const cleanGroupId = String(groupId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const profile = this.cache.get(cleanGroupId);

    if (!profile || profile.recentConversations.length === 0) {
      return `ℹ️ Is group (*${groupTitle}*) me abhi tak koi zyada conversation analyze nahi hui hai. Jaise hi members baat karenge, main automatic summary bana dungi! ✨`;
    }

    const convHistory = profile.recentConversations.map((c) => `${c.sender}: ${c.text}`).join("\n");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return `📊 *Group Catch-Up Summary (${profile.groupTitle}):*\n\nTotal ${profile.recentConversations.length} recent messages recorded from members: ${Object.values(profile.members).map((m) => m.name).join(", ")}.`;
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are Friday, DK's ultra-intelligent AI companion. Summarize this recent group chat transcript in natural, friendly Hinglish with structured bullet points.

GROUP NAME: "${profile.groupTitle}"
TRANSCRIPT:
"""
${convHistory}
"""

FORMAT YOUR TELEGRAM/WHATSAPP RESPONSE AS:
📊 *Group Catch-Up Digest:* **${profile.groupTitle}**
• 📌 *Main Topic (Kya baat chal rahi thi):* (1-2 crisp lines)
• 🗣️ *Key Highlights & Member Points:* (Bullet points of key things said by members)
• 💡 *Decisions / Plans (if any):* (Any dinner, meeting, game, or agreement mentioned)
• 🌟 *Active Contributors:* (Names of key active members)

Keep it warm, executive, clean, and engaging!`;

    try {
      const resp = await ai.models.generateContent({
        model: "gemini-3.6-flash", contents: prompt, });
      const summary = resp.text?.trim() || "Summary could not be generated.";
      profile.lastSummary = summary;
      return summary;
    } catch (e: any) {
      return `📊 *Group Summary (${profile.groupTitle}):*\n\n${profile.recentConversations.slice(-5).map((c) => `• *${c.sender}:* ${c.text}`).join("\n")}`;
    }
  }

  public async getAllProfiles(): Promise<GroupCollectiveProfile[]> {
    await this.init();
    return Array.from(this.cache.values());
  }
}

export const groupCollectiveLearningService = new GroupCollectiveLearningService();
