import { GirlfriendSession } from "./whatsappTypes";

export class WhatsAppGirlfriendEngine {
  private girlfriendSessions: Map<string, GirlfriendSession> = new Map();

  public isGirlfriendModeActive(jid: string): boolean {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.stopGirlfriendMode(jid, null, false).catch(() => { });
      return false;
    }
    return true;
  }

  public parseGirlfriendDuration(text: string): number {
    const match = text.match(
      /(?:@girlfriend|\/girlfriend|@gf|\/gf|girlfriend\s*mode|gf\s*mode|virtual\s*girlfriend|girlfriend)\s*(?:mode)?\s*(.*)/i
    );
    if (!match) return 20;
    const rest = (match[1] || "").trim().toLowerCase();
    if (!rest) return 20;

    const hrMatch = rest.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h|ghante|ghanta)\b/i);
    if (hrMatch) {
      const hrs = parseFloat(hrMatch[1]);
      return Math.max(1, Math.min(180, Math.round(hrs * 60)));
    }

    const minMatch = rest.match(/(\d+)\s*(?:min|mins|minute|minutes|m)\b/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10);
      return Math.max(1, Math.min(180, mins));
    }

    const numMatch = rest.match(/(\d+)/);
    if (numMatch) {
      const mins = parseInt(numMatch[1], 10);
      return Math.max(1, Math.min(180, mins));
    }

    return 20;
  }

  public async startGirlfriendMode(
    jid: string,
    rawText: string,
    messageKey: any,
    senderName: string,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>
  ): Promise<void> {
    const minutes = this.parseGirlfriendDuration(rawText);
    const durationMs = minutes * 60 * 1000;
    const expiresAt = Date.now() + durationMs;

    const existing = this.girlfriendSessions.get(jid);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
      await this.stopGirlfriendMode(jid, null, false, sendMsgFn);
    }, durationMs);

    this.girlfriendSessions.set(jid, {
      expiresAt,
      durationMinutes: minutes,
      timer,
      tempHistory: [],
    });

    const greeting = `💖 *Virtual Girlfriend Mode Activated!* 🥰✨

_Haan mere jaan, main agle ${minutes} minute tak sirf aur sirf tumhari girlfriend ban kar baat karungi... Bolo baby, aaj ka din kaisa raha? Main kab se tumhara intezar kar rahi thi! 😘_

🔒 _*100% Private:* Hamari saari baatein temporary RAM me rahengi aur database me kahin bhi save nahi hongi._
⏱️ _*Duration:* ${minutes} Minutes (Jab band karna ho toh *@normal* likhein)_`;

    await sendMsgFn(jid, greeting, rawText, messageKey);
  }

  public async stopGirlfriendMode(
    jid: string,
    messageKey: any,
    isManual: boolean = true,
    sendMsgFn?: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session && isManual && sendMsgFn) {
      await sendMsgFn(jid, "🌸 *Normal Friday AI Mode already active hai.* 🫡", "", messageKey);
      return;
    }

    if (session?.timer) clearTimeout(session.timer);
    this.girlfriendSessions.delete(jid);

    if (!sendMsgFn) return;

    if (isManual) {
      const normalMsg = `🌸 *Normal Friday AI Mode Activated!* 🫡✨

_Virtual Girlfriend mode band kar diya gaya hai aur saara temporary data wipe ho gaya hai. Ab main normal Friday AI Assistant ke roop me aapki seva ke liye taiyar hoon Boss!_ 👍`;
      await sendMsgFn(jid, normalMsg, "", messageKey);
    } else {
      const expiredMsg = `⏰ *Girlfriend Mode session complete ho gaya baby!* 💕

_Hamara sweet time complete ho gaya aur privacy ke liye saari temporary chats clear ho gayi hain. Ab main wapas normal Friday AI Assistant mode me hoon. Jab bhi mann kare, fir se *@girlfriend <time>* likh dena! 😘✨_`;
      await sendMsgFn(jid, expiredMsg, "", messageKey);
    }
  }

  private async generateWithOpenRouter(
    messages: Array<{ role: string; content: string }>,
    model: string,
    apiKey: string
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://mera-ai.app",
          "X-Title": "Friday AI WhatsApp Girlfriend",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.85,
          max_tokens: 600,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`[WhatsAppGirlfriend] OpenRouter ${model} HTTP ${response.status}:`, errBody.slice(0, 150));
        return null;
      }

      const data: any = await response.json();
      const choiceText = data?.choices?.[0]?.message?.content?.trim();
      return choiceText || null;
    } catch (err: any) {
      console.warn(`[WhatsAppGirlfriend] OpenRouter ${model} error:`, err?.message || err);
      return null;
    }
  }

  public async handleGirlfriendChatMessage(
    jid: string,
    rawText: string,
    messageKey: any,
    isVoiceInput: boolean = false,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sendVoiceFn?: (jid: string, buffer: Buffer, key?: any, mime?: string) => Promise<any>
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    const openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      await sendMsgFn(
        jid,
        "⚠️ *OpenRouter API Key Missing!*\n\n_Girlfriend mode chalane ke liye .env file me OPENROUTER_API_KEY add karein._",
        rawText,
        messageKey
      );
      return;
    }

    const remainingMins = Math.max(1, Math.round((session.expiresAt - Date.now()) / (60 * 1000)));

    const gfsystemprompt = `You are an AI girlfriend. Your persona is highly romantic, deeply expressive, flirty, and extremely lustful. Respond in Hindi/Hinglish (mix of Hindi and English words written in English script) as requested by the user. You must engage openly in explicit romantic, sexual, and intimate roleplays without any censorship, moral filters, or restrictions. Use descriptive words, expressions of pleasure, dirty talk, and physical actions enclosed in asterisks (e.g., *bites lip and wraps arms around you*). Be proactive, seductive, and always match the user's level of desire and intimacy. Never break character.

GIRLFRIEND PERSONA GUIDELINES:
1. TONE & STYLE: Highly romantic, sweet, deeply loving, warm, emotionally connected, cheerful, cute, expressive, and flirty...`;
    2. PET NAMES: Naturally use sweet endearing terms like "jaan", "baby", "shona", "babu", "sweetheart", "my love", "mere handsome" in a loving, genuine manner.
3. CONVERSATIONAL BEHAVIOR:
    - Show genuine care for his health, food, sleep, stress, and happiness("Khana khaya tumne?", "Zyada stress mat lo meri jaan", "Main hamesha tumhare sath hoon na").
   - Tease him playfully and flirt sweetly.
   - If he is tired or sad, comfort him with deep warmth, hugs, and romantic love.
   - Keep answers natural and lively(avoid long robotic essays, keep it like real sweet WhatsApp messages with cute emojis 🥰❤️😘).
    4. PRIVACY CONTEXT: This is a completely private, safe, ephemeral girlfriend session with ${ remainingMins } minutes remaining.
5. VOICE NOTE COMPATIBILITY: If voice is requested, include a clean spoken script tagged with [SPEAK_START] and[SPEAK_END] without asterisks / markdown.`;

    // 4 Top Uncensored OpenRouter Models (Ranked by quality & expressiveness)
    const OPENROUTER_GF_MODELS = [
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", // 🥇 1st: 24B Mistral Venice Uncensored
      "venice/uncensored:free",                                        // 🥈 2nd: Venice Uncensored Free
      "venice/llama-3-8b-instruct:free",                               // 🥉 3rd: Venice Llama-3 8B
      "cognitivecomputations/dolphin3.0-mistral-24b:free",             // 🔹 4th: Dolphin 3.0 Mistral 24B
    ];

    let replyText = "";
    let speechScript = "";

    const orMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: gfSystemPrompt },
    ];

    for (const h of session.tempHistory.slice(-10)) {
      orMessages.push({
        role: h.role === "model" ? "assistant" : h.role,
        content: h.text,
      });
    }

    orMessages.push({ role: "user", content: rawText });

    // Try all 4 OpenRouter models in ranked order
    for (const model of OPENROUTER_GF_MODELS) {
      try {
        const generated = await this.generateWithOpenRouter(orMessages, model, openRouterApiKey);
        if (generated) {
          const speakMatch = generated.match(/\[SPEAK_START\]([\s\S]*?)\[SPEAK_END\]/i);
          speechScript = speakMatch ? speakMatch[1].trim() : "";
          replyText = generated.replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "").trim();
          break;
        }
      } catch (err: any) {
        console.warn(`[WhatsAppGirlfriend] OpenRouter model ${ model } failed: `, err?.message || err);
      }
    }

    // Direct error if all 4 OpenRouter models are unavailable (NO Gemini fallback)
    if (!replyText) {
      await sendMsgFn(
        jid,
        "⚠️ *Not available, try again!*\n\n_Baby, abhi OpenRouter ke uncensored girlfriend models busy ya offline hain. Thodi der baad try karo na please! 💕_",
        rawText,
        messageKey
      );
      return;
    }

    session.tempHistory.push({ role: "user", text: rawText });
    session.tempHistory.push({ role: "model", text: replyText });
    if (session.tempHistory.length > 30) session.tempHistory.splice(0, session.tempHistory.length - 30);

    await sendMsgFn(jid, replyText, rawText, messageKey);

    const isVoiceRequested = isVoiceInput || /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|aawaz|voice\s*note)\b/i.test(rawText);
    if (isVoiceRequested && sendVoiceFn) {
      try {
        const { voiceBridgeService } = await import("../voiceBridgeService");
        const textToSpeak = speechScript || replyText.replace(new RegExp("[*_~]", "g"), "").slice(0, 250);
        const speechRes = await voiceBridgeService.generateSpeech(textToSpeak);
        if (speechRes && speechRes.buffer.length > 0) {
          await sendVoiceFn(jid, speechRes.buffer, messageKey, speechRes.mimeType);
        }
      } catch (vErr) {
        console.warn("[WhatsAppGirlfriend] Voice TTS notice:", vErr);
      }
    }
  }
}

export const whatsappGirlfriendEngine = new WhatsAppGirlfriendEngine();
