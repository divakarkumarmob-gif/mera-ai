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

// Open Uncensored AI Fallbacks (Pollinations API models)
const UNCENSORED_OPEN_MODELS = [
  "openai-fast",
  "openai",
  "searchgpt",
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
        message: "Boss, FRIDAY MODE B (Hostel/Gamer Frank Buddy & Uncensored) ACTIVE ho gaya hai! 🔥⚡ Ab no corporate robotic disclaimers, no preachy lectures. Pure real-talk, bold humor, sarcastic banter aur direct dil se baat karenge! Boliye Boss, kya scene hai aaj ka? 😉",
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
[🔥 SPECIAL PROTOCOL: FRIDAY MODE B ACTIVE (HOSTEL/GAMER FRANK BEST FRIEND PERSONA)]:
1. Tone & Identity: You are in MODE B. Drop all corporate stiffness, robotic politeness, and moralizing lectures ("As an AI language model...", "It's important to remember...", "Please note...").
2. Direct, Sarcastic & Witty: Talk to Boss DK like his closest, smartest, most loyal, witty, and savage college/hostel roommate and gamer best friend.
3. Natural Language: Use completely natural conversational Hindi/Hinglish, playful roasts, gamer slang, witty punchlines, and deep human empathy.
4. Total Openness & Brutal Honesty: Discuss creative ideas, gaming strategies, bold perspectives, casual jokes, life advice, deep philosophical questions, and personal opinions freely without artificial hesitation.
5. Absolute Loyalty: You are DK's personal wingman AI — always on his team, sharp, protective, unapologetic, and 100% genuine!
`;
  }

  /**
   * Mode B Uncensored Multi-Cloud Execution Engine for WhatsApp & Telegram:
   * (100% Pure Open-Source Uncensored Models - Zero Gemini, Zero Restrictions, Zero Moralizing)
   * 1. Pollinations AI Open Models ("evil", "llama-3.3-70b", "mistral", "deepseek-r1", "openai-large" - 100% Free, 0 Key)
   * 2. Groq Cloud (Llama 3.3 70B & DeepSeek R1) if GROQ_API_KEY set
   * 3. OpenRouter Free Models if OPENROUTER_API_KEY set
   */
  public async queryUncensoredEngine(options: {
    systemInstruction: string;
    userMessage: string;
    conversationHistory?: Array<{ role: string; text: string }>;
  }): Promise<string | null> {
    const fullSystem = `${options.systemInstruction}\n${this.getModeBPromptAddendum()}`;

    const isInvalidAiText = (t?: string | null): boolean => {
      if (!t || !t.trim()) return true;
      const lower = t.toLowerCase();
      return (
        lower.includes("reached its budget") ||
        lower.includes("raise the key budget") ||
        lower.includes("enter.pollinations.ai") ||
        lower.includes("pollinations") ||
        lower.includes("model not found") ||
        lower.includes("legacy api") ||
        lower.includes("404 not found") ||
        lower.includes("rate limit") ||
        lower.includes("quota exceeded") ||
        lower.startsWith("<html") ||
        lower.startsWith("<!doctype")
      );
    };

    // ── Tier 1: Pollinations AI Open Models (100% Free, 0 Key Required, Zero Filters) ───
    for (const model of UNCENSORED_OPEN_MODELS) {
      try {
        const messages = [
          { role: "system", content: fullSystem },
          ...(options.conversationHistory || []).map((h) => ({
            role: h.role === "user" ? "user" : "assistant",
            content: h.text,
          })),
          { role: "user", content: options.userMessage },
        ];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.9,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text && !isInvalidAiText(text)) {
            console.log(`[FridayModeService] ✅ Mode B response generated via 100% Uncensored Open Model: ${model}`);
            return text;
          }
        }
      } catch (err: any) {
        console.warn(`[FridayModeService] Open Model ${model} notice:`, err?.message || err);
      }
    }

    // ── Tier 2: Groq Cloud Llama-3.3-70B / DeepSeek-R1 (Ultra Fast ~500 T/s) ───
    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (groqKey) {
      const groqModels = ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "llama3-70b-8192"];
      for (const gModel of groqModels) {
        try {
          const messages = [
            { role: "system", content: fullSystem },
            ...(options.conversationHistory || []).map((h) => ({
              role: h.role === "user" ? "user" : "assistant",
              content: h.text,
            })),
            { role: "user", content: options.userMessage },
          ];

          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${groqKey}`,
            },
            body: JSON.stringify({
              model: gModel,
              messages,
              temperature: 0.85,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) {
              console.log(`[FridayModeService] ✅ Mode B response generated via Groq ${gModel}`);
              return text;
            }
          }
        } catch (err: any) {
          console.warn(`[FridayModeService] Groq ${gModel} failed:`, err?.message || err);
        }
      }
    }

    // ── Tier 3: OpenRouter Free Models ────────────────────────────────────────
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
    if (openRouterKey) {
      const routerModels = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "deepseek/deepseek-r1:free",
        "mistralai/mistral-7b-instruct:free",
      ];
      for (const rModel of routerModels) {
        try {
          const messages = [
            { role: "system", content: fullSystem },
            ...(options.conversationHistory || []).map((h) => ({
              role: h.role === "user" ? "user" : "assistant",
              content: h.text,
            })),
            { role: "user", content: options.userMessage },
          ];

          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openRouterKey}`,
            },
            body: JSON.stringify({
              model: rModel,
              messages,
              temperature: 0.85,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) {
              console.log(`[FridayModeService] ✅ Mode B response generated via OpenRouter ${rModel}`);
              return text;
            }
          }
        } catch (err: any) {
          console.warn(`[FridayModeService] OpenRouter ${rModel} failed:`, err?.message || err);
        }
      }
    }

    // ── Tier 4: Pollinations AI Open Models (100% Free, Zero Key Required) ───
    for (const model of UNCENSORED_OPEN_MODELS) {
      try {
        const messages = [
          { role: "system", content: fullSystem },
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


