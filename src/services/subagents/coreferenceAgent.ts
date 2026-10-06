import { GoogleGenAI } from "@google/genai";

const COREFERENCE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];

export interface ChatTurnContext {
  role: "user" | "assistant";
  text: string;
}

export class CoreferenceAgent {
  /**
   * Resolves ambiguous pronouns, ellipsis, and context-dependent references in the user's latest query
   * by analyzing the preceding 2-4 conversational turns.
   *
   * Example:
   * History: [User: "Mere paas ek German Shepherd dog hai", Assistant: "Bohot badhiya!"]
   * Query: "Uske kapde kharidne hain"
   * Output: "User wants to buy clothes for their German Shepherd dog"
   */
  public async resolveQueryContext(
    currentQuery: string,
    recentHistory: ChatTurnContext[] = []
  ): Promise<string> {
    const query = (currentQuery || "").trim();
    if (!query) return "";

    // If no recent history or query is clearly self-contained, return original
    if (recentHistory.length === 0 || query.length > 200) {
      return query;
    }

    // Check if query contains ambiguous demonstratives/pronouns
    const hasAmbiguity = /\b(uske|uski|uska|unka|unki|unke|usko|ise|isko|iski|iska|iske|wo|woh|yeh|ye|kahan|kaise|kab|wahan|wahan ka|wahi|same|bhi)\b/i.test(query)
      || query.split(/\s+/).length <= 4;

    if (!hasAmbiguity) {
      return query;
    }

    const { getIntentGeminiKey } = await import("../geminiKeyPoolService");
    const apiKey = getIntentGeminiKey();
    if (!apiKey) return query;

    const formattedHistory = recentHistory
      .slice(-4)
      .map((t) => `${t.role === "user" ? "Boss DK" : "Friday"}: "${t.text.slice(0, 150)}"`)
      .join("\n");

    const prompt = `You are an ultra-fast Coreference & Context Resolution Sub-Agent for Friday AI.
Given the recent conversational turns and the latest user query, determine what the user is explicitly referring to.
Resolve all pronouns ("uske", "uski", "wo", "uska", "ise", "iske", "it", "them", "his", "her") into explicit standalone subjects/entities.

<recent_dialogue>
${formattedHistory}
</recent_dialogue>

<latest_query>
"${query}"
</latest_query>

TASK:
Rewrite the latest query into a clear, standalone search query that preserves the full semantic context.
- If no pronoun or ambiguity exists, return the query as-is.
- Keep the output concise (1 short sentence in natural Hinglish/English).

OUTPUT FORMAT:
Return ONLY the resolved query string. Do not include quotes or explanations.`;

    const ai = new GoogleGenAI({ apiKey });

    for (const model of COREFERENCE_MODELS) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const resolved = resp.text?.trim();
        if (resolved && resolved.length > 2 && resolved.length < 300) {
          return resolved;
        }
      } catch {
        // Fallback to next model
      }
    }

    return query;
  }
}

export const coreferenceAgent = new CoreferenceAgent();
