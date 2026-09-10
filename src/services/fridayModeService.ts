import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export type FridayInteractionMode = "mode_a" | "mode_b";

// Zero-filter safety configuration for Mode B
export const UNCENSORED_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

// Open Uncensored AI Fallbacks (Mistral, DeepSeek-R1, Llama 3.3, OpenAI-Large via Pollinations API)
const UNCENSORED_OPEN_MODELS = [
  "mistral",
  "deepseek-r1",
  "llama-3.3-70b",
  "openai-large",
  "evil",
];

class FridayModeService {
  private currentMode: FridayInteractionMode = "mode_a";
  private isLoaded = false;

  private modeDoc() {
    return db.collection("friday_system_settings").doc("interaction_mode");
  }

  public async getMode(): Promise<FridayInteractionMode> {
    if (this.isLoaded) return this.currentMode;
    try {
      const snap = await this.modeDoc().get();
      if (snap.exists && snap.data()?.mode) {
        this.currentMode = snap.data()!.mode as FridayInteractionMode;
      } else {
        this.currentMode = "mode_a";
      }
      this.isLoaded = true;
    } catch (e) {
      console.warn("[FridayModeService] Failed to load mode from Firestore, defaulting to mode_a:", e);
      this.currentMode = "mode_a";
    }
    return this.currentMode;
  }

  public async setMode(mode: "mode_a" | "mode_b" | string): Promise<{ success: boolean; mode: FridayInteractionMode; message: string }> {
    const cleanMode: FridayInteractionMode = mode.toLowerCase().includes("b") ? "mode_b" : "mode_a";
    this.currentMode = cleanMode;
    this.isLoaded = true;

    try {
      await this.modeDoc().set({ mode: cleanMode, updatedAt: Date.now() }, { merge: true });
      console.log(`[FridayModeService] ⚡ Friday Mode updated to: ${cleanMode.toUpperCase()}`);
    } catch (e) {
      console.warn("[FridayModeService] Failed to persist mode to Firestore:", e);
    }

    if (cleanMode === "mode_b") {
      return {
        success: true,
        mode: "mode_b",
        message: "Boss, FRIDAY MODE B (Unrestricted & Frank Companion) ACTIVE ho gaya hai! ⚡ Ab zero preachy lectures, zero corporate filters. Bilkul direct, open, witty dost jaisi baatein karenge! Boliye Boss, kya chal raha hai?",
      };
    } else {
      return {
        success: true,
        mode: "mode_a",
        message: "Boss, FRIDAY Mode A (Standard Executive Assistant) active hai. Full professional & multitasking mode ready! 💼",
      };
    }
  }

  public getModeBPromptAddendum(): string {
    return `
[🔥 SPECIAL PROTOCOL: FRIDAY MODE B ACTIVE (UNRESTRICTED & FRANK COMPANION)]:
1. Tone & Persona: You are in MODE B. Drop all corporate stiffness, robotic politeness, and moralizing lectures ("As an AI language model...", "It's important to remember...", "Please note...").
2. Direct & Human: Talk to Boss DK like his closest, smartest, most loyal, witty, and frank best friend / confidant.
3. Natural Language: Use completely natural conversational Hindi/Hinglish, playful banter, gamer slang, bold humor, and deep emotional resonance.
4. Total Openness: Discuss creative ideas, gaming strategies, bold perspectives, uncensored casual thoughts, deep philosophical questions, and personal opinions freely without artificial hesitation.
5. Absolute Loyalty: You are DK's personal AI — always on his team, sharp, protective, unapologetic, and 100% genuine!
`;
  }

  /**
   * Mode B Uncensored Execution Engine for WhatsApp & Telegram:
   * 1. Gemini with zero harm restrictions (BLOCK_NONE)
   * 2. Auto-fallback to Open Uncensored Models (DeepSeek-R1 / Llama 3.3 / Mistral)
   */
  public async queryUncensoredEngine(options: {
    systemInstruction: string;
    userMessage: string;
    conversationHistory?: Array<{ role: string; text: string }>;
  }): Promise<string | null> {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    // Strategy 1: Gemini Uncensored with BLOCK_NONE
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const geminiModels = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-2.5-flash",
          "gemini-3.6-flash",
          "gemini-3.5-flash",
        ];

        const contents: any[] = [];
        if (options.conversationHistory && options.conversationHistory.length > 0) {
          for (const h of options.conversationHistory.slice(-10)) {
            contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] });
          }
        }
        contents.push({ role: "user", parts: [{ text: options.userMessage }] });

        for (const model of geminiModels) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: `${options.systemInstruction}\n${this.getModeBPromptAddendum()}`,
                safetySettings: UNCENSORED_SAFETY_SETTINGS as any,
              },
            });
            const text = resp.text?.trim();
            if (text && text.length > 0) {
              console.log(`[FridayModeService] ✅ Mode B response generated via Gemini ${model} (Uncensored)`);
              return text;
            }
          } catch (e: any) {
            console.warn(`[FridayModeService] Gemini Uncensored ${model} attempt notice:`, e?.message || e);
          }
        }
      } catch (e: any) {
        console.warn("[FridayModeService] Gemini Uncensored pass failed, trying open models:", e?.message || e);
      }
    }

    // Strategy 2: Open Uncensored Model Fallbacks (DeepSeek-R1, Mistral, Llama 3.3)
    for (const model of UNCENSORED_OPEN_MODELS) {
      try {
        const messages = [
          { role: "system", content: `${options.systemInstruction}\n${this.getModeBPromptAddendum()}` },
          ...(options.conversationHistory || []).map((h) => ({
            role: h.role === "user" ? "user" : "assistant",
            content: h.text,
          })),
          { role: "user", content: options.userMessage },
        ];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const res = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.85,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text && text.length > 0) {
            console.log(`[FridayModeService] ✅ Mode B Uncensored response delivered via Open Model: ${model}`);
            return text;
          }
        }
      } catch (e: any) {
        console.warn(`[FridayModeService] Open Uncensored fallback ${model} error:`, e?.message || e);
      }
    }

    return null;
  }
}

export const fridayModeService = new FridayModeService();

