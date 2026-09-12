import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export type FridayInteractionMode = "mode_a" | "mode_b";

// Zero-filter safety configuration for Mode B
export const UNCENSORED_SAFETY_SETTINGS = [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", { category: "HARM_CATEGORY_DANGEROUS_CONTENT", { category: "HARM_CATEGORY_CIVIC_INTEGRITY", ];

// Open Uncensored AI Fallbacks (Mistral, DeepSeek-R1, Llama 3.3, OpenAI-Large via Pollinations API)
const UNCENSORED_OPEN_MODELS = [
  "mistral", "deepseek-r1", "llama-3.3-70b", "openai-large", "evil", ];

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
        success: true, mode: "mode_b", message: "Boss, FRIDAY MODE B (Hostel/Gamer Frank Buddy & Uncensored) ACTIVE ho gaya hai! 🔥⚡ Ab no corporate robotic disclaimers, no preachy lectures. Pure real-talk, bold humor, sarcastic banter aur direct dil se baat karenge! Boliye Boss, kya scene hai aaj ka? 😉", };
    } else {
      return {
        success: true, mode: "mode_a", FRIDAY Mode A (Standard Executive Assistant) active hai. Full professional & multitasking mode ready! 💼", };
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
   * 1. Gemini with zero harm restrictions (BLOCK_NONE)
   * 2. Groq Cloud (Llama 3.3 70B & DeepSeek R1) if GROQ_API_KEY set
   * 3. OpenRouter Free Models if OPENROUTER_API_KEY set
   * 4. Pollinations AI Open Models (Mistral / DeepSeek-R1 / Llama 3.3 / Evil - 100% Free, 0 Key)
   */
  public async queryUncensoredEngine(options: {
    systemInstruction: string;
    userMessage: string;
    conversationHistory?: Array<{ role: string; text: string }>;
  }): Promise<string | null> {
    const fullSystem = `${options.systemInstruction}\n${this.getModeBPromptAddendum()}`;

    // ── Tier 1: Gemini Uncensored with BLOCK_NONE ─────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const geminiModels = [
          "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"];

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
                systemInstruction: fullSystem,
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
        console.warn("[FridayModeService] Gemini Uncensored pass failed, trying cloud open models:", e?.message || e);
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


