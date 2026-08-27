import { memoryEngine } from "./memoryEngine";
import { dailyUpdateService, todayIST } from "./dailyUpdateService";
import { vectorMemoryService } from "./vectorMemoryService";

export interface UnifiedMemoryContext {
  originalQuery: string;
  detectedKeywords: string[];
  tier1_recentDialogues: Array<{ time: string; speaker: string; text: string }>;
  tier2_dailyUpdates: Array<{ date: string; text: string }>;
  tier3_longTermVectors: Array<{
    date: string;
    summary: string;
    similarity: number;
    snippet: string;
  }>;
  compiledHumanContext: string;
}

class SmartMemoryRetrieverService {
  /**
   * चरण 1: संदर्भ को पहचानना (Semantic Search Query & Keywords Generator)
   * Extracts meaningful topic/problem keywords from the user utterance.
   */
  public extractSearchKeywords(utterance: string): string[] {
    const clean = utterance.toLowerCase();
    // Stopwords filter for Hindi/English conversational filler
    const stopwords = new Set([
      "yaar", "aaj", "jo", "tha", "thi", "the", "me", "mein", "par", "ko",
      "se", "kya", "hai", "hain", "tha", "phir", "se", "wahi", "usme", "kar",
      "raha", "rahe", "ek", "aur", "ki", "ka", "ke", "meri", "mera", "mere",
      "tum", "tumne", "mai", "maine", "to", "bhi", "yeh", "woh", "ab", "kuch",
    ]);

    const rawWords: string[] = clean.match(/[\w\u0900-\u097F]+/g) || [];
    const keywords: string[] = rawWords.filter((w: string) => w.length > 2 && !stopwords.has(w));

    // Return unique keywords + original phrase for semantic vector lookup
    return Array.from(new Set(keywords));
  }

  /**
   * चरण 2: तीनों परतों (Tiers) से समानांतर (Parallel) डेटा खींचना
   * Executes concurrent queries across Tier 1, Tier 2, and Tier 3.
   */
  public async fetchMultiTierMemory(userUtterance: string): Promise<UnifiedMemoryContext> {
    const keywords = this.extractSearchKeywords(userUtterance);
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    // Execute Tier 1, Tier 2, and Tier 3 in PARALLEL
    const [tier1Matches, tier2Matches, tier3Result] = await Promise.all([
      // Tier 1: 4-Day Window (Recent verbatim chat)
      this.fetchTier1Matches(keywordsLower),

      // Tier 2: Daily Updates (Active & 30-Day update records)
      this.fetchTier2Matches(keywordsLower),

      // Tier 3: Vector DB (Long-term semantic cosine search)
      vectorMemoryService.searchSemanticMemory(userUtterance, 3, 0.15),
    ]);

    const tier3Matches = tier3Result.results.map((r) => ({
      date: r.dateRange,
      summary: r.summary,
      similarity: r.similarity,
      snippet: r.snippet,
    }));

    // चरण 3: इंसानी दिमाग की तरह सब कुछ मिलाना (Smart Dynamic Context Injection)
    const compiledHumanContext = this.synthesizeSmartPrompt({
      originalQuery: userUtterance,
      detectedKeywords: keywords,
      tier1_recentDialogues: tier1Matches,
      tier2_dailyUpdates: tier2Matches,
      tier3_longTermVectors: tier3Matches,
    });

    return {
      originalQuery: userUtterance,
      detectedKeywords: keywords,
      tier1_recentDialogues: tier1Matches,
      tier2_dailyUpdates: tier2Matches,
      tier3_longTermVectors: tier3Matches,
      compiledHumanContext,
    };
  }

  /**
   * Tier 1: Search within the 4-Day verbatim memory window for relevant messages.
   */
  private async fetchTier1Matches(
    keywords: string[]
  ): Promise<Array<{ time: string; speaker: string; text: string }>> {
    const matches: Array<{ time: string; speaker: string; text: string }> = [];
    if (keywords.length === 0) return matches;

    try {
      const activeSessions = memoryEngine.getActiveSessions();
      const memories = await memoryEngine.getMemories();
      const allRecent = [...activeSessions, ...((memories.recentSessions as any[]) || [])];

      for (const session of allRecent) {
        for (const msg of (session.messages || [])) {
          const lowerText = String(msg.text || "").toLowerCase();
          const hasMatch = keywords.some((k) => lowerText.includes(k));
          if (hasMatch) {
            matches.push({
              time: msg.timeStr || new Date(msg.timestamp).toLocaleTimeString(),
              speaker: msg.sender === "user" ? "Boss DK" : "Friday",
              text: msg.text,
            });
          }
        }
      }
    } catch {}

    return matches.slice(-6); // Keep most recent 6 relevant dialogues
  }

  /**
   * Tier 2: Search within the 30-Day daily updates for mentions of keywords or projects.
   */
  private async fetchTier2Matches(
    keywords: string[]
  ): Promise<Array<{ date: string; text: string }>> {
    const matches: Array<{ date: string; text: string }> = [];
    if (keywords.length === 0) return matches;

    try {
      const today = todayIST();
      const todayEntry = await dailyUpdateService.getUpdateForDate(today);
      if (todayEntry?.text) {
        const lower = todayEntry.text.toLowerCase();
        if (keywords.some((k) => lower.includes(k))) {
          matches.push({ date: today, text: todayEntry.text });
        }
      }
    } catch {}

    return matches;
  }

  /**
   * चरण 3: The Smart Prompt Injection
   * Synthesizes Past, Present, and Long-Term context into a natural human prompt block.
   */
  private synthesizeSmartPrompt(data: {
    originalQuery: string;
    detectedKeywords: string[];
    tier1_recentDialogues: Array<{ time: string; speaker: string; text: string }>;
    tier2_dailyUpdates: Array<{ date: string; text: string }>;
    tier3_longTermVectors: Array<{ date: string; summary: string; similarity: number; snippet: string }>;
  }): string {
    const sections: string[] = [];

    // Keywords Detected
    if (data.detectedKeywords.length > 0) {
      sections.push(`• DETECTED TOPIC / INTENT KEYWORDS: [${data.detectedKeywords.join(", ")}]`);
    }

    // Tier 1: Recent 4-Day Window
    if (data.tier1_recentDialogues.length > 0) {
      const dialogues = data.tier1_recentDialogues
        .map((d) => `  - [${d.time}] ${d.speaker}: "${d.text}"`)
        .join("\n");
      sections.push(`• TIER 1 (LAST 4 DAYS RECENT DIALOGUE CONTEXT):\n${dialogues}`);
    }

    // Tier 2: Daily Updates
    if (data.tier2_dailyUpdates.length > 0) {
      const updates = data.tier2_dailyUpdates
        .map((u) => `  - [${u.date}]: "${u.text}"`)
        .join("\n");
      sections.push(`• TIER 2 (30-DAY DAILY UPDATES CONTEXT):\n${updates}`);
    }

    // Tier 3: Long-term Vector Vault
    if (data.tier3_longTermVectors.length > 0) {
      const vectors = data.tier3_longTermVectors
        .map((v) => `  - [Historic Date: ${v.date} | Match: ${(v.similarity * 100).toFixed(0)}%]:\n    Summary: ${v.summary}\n    Key Detail: ${v.snippet}`)
        .join("\n");
      sections.push(`• TIER 3 (LONG-TERM VECTOR DB - PAST MONTHS / SIMILAR ISSUES):\n${vectors}`);
    }

    if (sections.length === 0) {
      return "";
    }

    return `============================================================
🧠 MULTI-TIER CONTEXT SYNTHESIS (REAL-TIME HUMAN AWARENESS):
${sections.join("\n\n")}

CRITICAL INSTRUCTION FOR FRIDAY:
A close friend already knows what Boss means by "purani dikkat" or "wo project" because you remember past history!
Directly speak with full awareness of these past details. DO NOT say "Maine memory me search kiya".
Acknowledge past context naturally:
Example: "Arey Boss, wahi [issue/project name] wali dikkat na jo [Date] ko aayi thi? Us waqt humne [solution] kiya tha..."
============================================================`;
  }
}

export const smartMemoryRetrieverService = new SmartMemoryRetrieverService();
