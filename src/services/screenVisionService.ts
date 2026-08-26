import { GoogleGenAI } from "@google/genai";

export interface ScreenAnalysisResult {
  success: boolean;
  timestamp: string;
  detectedContext: "code_error" | "terminal_log" | "web_document" | "general_ui";
  title: string;
  explanation: string;
  suggestedAction: string;
}

class ScreenVisionService {
  private getGenAI(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * Analyzes screen screenshot image / active window frame using real Gemini
   * multimodal vision. Falls back to a text-only heuristic reply only when no
   * image was provided at all, or when the AI key/call is unavailable.
   */
  public async analyzeScreenContext(
    imageBase64?: string,
    userQuery?: string,
    mimeType: string = "image/jpeg"
  ): Promise<ScreenAnalysisResult> {
    const q = (userQuery || "Explain what is on the screen and suggest next steps").trim();
    const nowStr = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

    if (!imageBase64) {
      return {
        success: false,
        timestamp: nowStr,
        detectedContext: "general_ui",
        title: "No Screen Frame Received",
        explanation: "Boss, koi screenshot ya screen frame receive nahi hua, isliye main screen analyze nahi kar payi.",
        suggestedAction: "Screen share on karo ya screenshot bhejo, phir main content explain kar dungi.",
      };
    }

    const ai = this.getGenAI();
    if (!ai) {
      console.error("[ScreenVision] GEMINI_API_KEY missing, cannot analyze screen image.");
      return {
        success: false,
        timestamp: nowStr,
        detectedContext: "general_ui",
        title: "Screen Vision Unavailable",
        explanation: "Boss, screen vision abhi configure nahi hai (AI key missing), isliye screen analyze nahi ho saka.",
        suggestedAction: "Please AI provider key set karo taaki screen analysis feature kaam kare.",
      };
    }

    try {
      const prompt = `You are Friday AI's Screen Vision module. Look at this screenshot/screen frame carefully and answer the user's question.

User's question: "${q}"

Respond with ONLY valid JSON in this exact shape:
{
  "detectedContext": "code_error" | "terminal_log" | "web_document" | "general_ui",
  "title": "short 3-6 word title for what's on screen",
  "explanation": "2-4 sentence explanation of what's visible and how it relates to the user's question, written in a warm Hinglish tone addressing the user as 'Boss'",
  "suggestedAction": "one concrete next step the user can take"
}`;

      const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
      let raw = "";

      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType,
                      data: imageBase64,
                    },
                  },
                ],
              },
            ],
          });
          raw = response.text || "";
          if (raw) break;
        } catch (mErr) {
          console.warn(`[ScreenVision] ${model} attempt warning:`, mErr);
        }
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      if (!parsed) {
        throw new Error("Could not parse Gemini vision response as JSON");
      }

      const validContexts = ["code_error", "terminal_log", "web_document", "general_ui"];
      const detectedContext = validContexts.includes(parsed.detectedContext) ? parsed.detectedContext : "general_ui";

      return {
        success: true,
        timestamp: nowStr,
        detectedContext,
        title: parsed.title || "Screen Analysis Complete",
        explanation: parsed.explanation || "Boss, screen inspect kar liya gaya hai.",
        suggestedAction: parsed.suggestedAction || "Aap voice me specific question puch sakte hain.",
      };
    } catch (e: any) {
      console.error("[ScreenVision] analyzeScreenContext failed:", e);
      return {
        success: false,
        timestamp: nowStr,
        detectedContext: "general_ui",
        title: "Screen Analysis Failed",
        explanation: `Boss, screen analyze karte waqt error aa gaya: ${e?.message || "unknown error"}.`,
        suggestedAction: "Thodi der baad dobara try karein.",
      };
    }
  }
}

export const screenVisionService = new ScreenVisionService();
