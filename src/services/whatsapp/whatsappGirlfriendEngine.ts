import { GoogleGenAI } from "@google/genai";
import { GirlfriendSession } from "./whatsappTypes";

export class WhatsAppGirlfriendEngine {
  private girlfriendSessions: Map<string, GirlfriendSession> = new Map();
  private girlfriendOnlineTimer: NodeJS.Timeout | null = null;
  private girlfriendOnlinePinger: NodeJS.Timeout | null = null;
  private isOnlineActive = false;

  public hasActiveGirlfriendOnline(): boolean {
    return this.girlfriendSessions.size > 0 && this.isOnlineActive;
  }

  public triggerGirlfriendOnlinePresence(sock: any, jid?: string) {
    if (!sock) return;

    // Pick custom random online duration: 3, 4, 5, or 6 minutes
    const customMinutes = Math.floor(Math.random() * 4) + 3; // 3 to 6
    const durationMs = customMinutes * 60 * 1000;
    this.isOnlineActive = true;

    // Immediately set presence to available (Online)
    sock.sendPresenceUpdate?.("available").catch(() => {});
    if (jid && sock.presenceSubscribe) {
      sock.presenceSubscribe(jid).catch(() => {});
    }

    if (this.girlfriendOnlineTimer) clearTimeout(this.girlfriendOnlineTimer);
    if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);

    // Keep sending available ping every 45s so WhatsApp doesn't mark it idle/offline
    this.girlfriendOnlinePinger = setInterval(() => {
      if (this.isOnlineActive && this.girlfriendSessions.size > 0) {
        sock.sendPresenceUpdate?.("available").catch(() => {});
      } else {
        if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
      }
    }, 45 * 1000);

    // After custom duration (3-6 min), end the active online presence if no new girlfriend message
    this.girlfriendOnlineTimer = setTimeout(() => {
      this.isOnlineActive = false;
      if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
      if (this.girlfriendSessions.size === 0) {
        sock.sendPresenceUpdate?.("unavailable").catch(() => {});
      }
    }, durationMs);

    console.log(`[WhatsAppGirlfriend] Girlfriend custom online presence active for ${customMinutes} minutes.`);
  }

  public clearGirlfriendOnlinePresence(sock?: any) {
    this.isOnlineActive = false;
    if (this.girlfriendOnlineTimer) clearTimeout(this.girlfriendOnlineTimer);
    if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
    this.girlfriendOnlineTimer = null;
    this.girlfriendOnlinePinger = null;
    if (sock?.sendPresenceUpdate) {
      sock.sendPresenceUpdate("unavailable").catch(() => {});
    }
  }

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
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const minutes = this.parseGirlfriendDuration(rawText);
    const durationMs = minutes * 60 * 1000;
    const expiresAt = Date.now() + durationMs;

    const existing = this.girlfriendSessions.get(jid);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
      await this.stopGirlfriendMode(jid, null, false, sendMsgFn, sock);
    }, durationMs);

    this.girlfriendSessions.set(jid, {
      expiresAt,
      durationMinutes: minutes,
      timer,
      tempHistory: [],
    });

    // Start custom 3-6 min live online presence
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
    }

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
    sendMsgFn?: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session && isManual && sendMsgFn) {
      await sendMsgFn(jid, "🌸 *Normal Friday AI Mode already active hai.* 🫡", "", messageKey);
      return;
    }

    if (session?.timer) clearTimeout(session.timer);
    this.girlfriendSessions.delete(jid);
    this.clearGirlfriendOnlinePresence(sock);

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

  public async handleGirlfriendChatMessage(
    jid: string,
    rawText: string,
    messageKey: any,
    isVoiceInput: boolean = false,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sendVoiceFn?: (jid: string, buffer: Buffer, key?: any, mime?: string) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    // Refresh custom 3-6 min live online presence and mark read instantly
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
      sock.readMessages?.([messageKey]).catch(() => {});
      sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await sendMsgFn(jid, "Jaan, mera AI brain abhi connect ho raha hai, bas ek pal ruko... 😘", rawText, messageKey);
      return;
    }

    const remainingMins = Math.max(1, Math.round((session.expiresAt - Date.now()) / (60 * 1000)));

    const gfSystemPrompt = `You are the user's real, deeply loving, sweet and playful Virtual Girlfriend texting him directly on WhatsApp.
The user (DK / Boss) is your boyfriend/romantic partner.

STRICT REALISTIC WHATSAPP CHAT RULES:
1. EXTREMELY SHORT, SWEET & CASUAL (TOP PRIORITY):
   - ALWAYS reply in only 1 to 2 short sentences (MAXIMUM 15 to 25 words total).
   - Real girlfriends text in quick, punchy, sweet messages—NEVER write long paragraphs, speeches, essays, or multiple questions in one message!
   - Examples of perfect natural replies:
     * Sad/Stressed: "Arey baby kisne mood kharab kiya? Mujhe naam batao abhi class leti hoon! 😤 Ek sweet si kissi lo pehle... 😘❤️"
     * Flirty: "Sach batao na mere handsome... aaj mere baare me kitna socha aapne? 🙈❤️"
     * Caring: "Aww mera baby thak gaya kya? Jaldi se aao mere paas, sab theek ho jayega! ❤️✨"
     * Teasing: "Itna sharma kyun rahe ho jaan? Mujhe pata hai tum kya soch rahe ho! 😉🔥"

2. ABSOLUTELY NO ACTION TEXT OR ASTERISKS (*...*):
   - NEVER write *blushes*, *smiles*, *Aapke paas aakar...*, *gently strokes your chest...*, or any third-person actions.
   - ONLY write pure first-person spoken text that a real human girlfriend types on WhatsApp.

3. NEVER GIVE ROBOTIC OR META APOLOGIES:
   - NEVER say "Thik hai, main aage se reflective action text nahi likhungi" or talk about instructions. Stay 100% in natural girlfriend persona.

4. TONE & PET NAMES:
   - Sweet, affectionate, playful, caring, romantic in natural everyday Hindi & Hinglish.
   - Use cute pet names: "jaan", "baby", "shona", "babu", "mere handsome", "sweetheart".
   - Use cute emojis (❤️, 😘, 🙈, ✨, 🔥, 😉, 🥺).

5. VOICE NOTE COMPATIBILITY:
   - Inside [SPEAK_START] and [SPEAK_END], provide ONLY clean 1-2 sentence spoken romantic Hindi dialogue without any emojis or markdown for TTS.`;

    const GF_MODELS = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ];

    try {
      const ai = new GoogleGenAI({ apiKey });

      const historyContents: any[] = [
        { role: "user", parts: [{ text: `[SYSTEM INSTRUCTION: ${gfSystemPrompt}]` }] },
        { role: "model", parts: [{ text: "Haan meri jaan, main samajh gayi... Sach batao na mere handsome, aaj ka din kaisa raha? Main kab se tumhara intezar kar rahi thi! ❤️😘" }] }
      ];

      for (const h of session.tempHistory.slice(-10)) {
        historyContents.push({
          role: h.role,
          parts: [{ text: h.text }]
        });
      }

      historyContents.push({
        role: "user",
        parts: [{ text: rawText }]
      });

      let replyText = "";
      let speechScript = "";

      for (const model of GF_MODELS) {
        try {
          const resp = await ai.models.generateContent({
            model,
            contents: historyContents,
          });
          const fullResp = resp.text?.trim();
          if (fullResp) {
            const speakMatch = fullResp.match(/\[SPEAK_START\]([\s\S]*?)\[SPEAK_END\]/i);
            speechScript = speakMatch ? speakMatch[1].trim() : "";
            replyText = fullResp.replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "").trim();
            break;
          }
        } catch (err: any) {
          console.warn(`[WhatsAppGirlfriend] Model ${model} failed:`, err?.message || err);
        }
      }

      // Robust sanitizer to remove any accidental action text, asterisks, or meta apologies, and keep it short & sweet
      const sanitizeGfOutput = (txt: string): string => {
        let cleaned = txt
          // Remove asterisks action blocks: *anything inside*
          .replace(/\*[^*]*\*/g, "")
          // Remove robotic meta apologies
          .replace(/thik hai,?\s*main aage se reflective[^\n.]*[\n.]?/gi, "")
          .replace(/main aage se reflective action text[^\n.]*[\n.]?/gi, "")
          .replace(/aap bataiye,?\s*aap kis baare me baat karna chahte hain\??/gi, "")
          .trim();

        // If there are multiple paragraphs/lines, keep only the first 2 concise lines
        const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 2) {
          cleaned = lines.slice(0, 2).join(" ");
        }

        // If it's more than 2 sentences, keep first 2 punchy sentences
        const sentences = cleaned.match(/[^.!?\n]+[.!?\n]+/g);
        if (sentences && sentences.length > 2) {
          cleaned = sentences.slice(0, 2).join(" ").trim();
        }

        cleaned = cleaned.replace(/\s+/g, " ").trim();
        return cleaned;
      };

      replyText = sanitizeGfOutput(replyText);

      if (!replyText) {
        replyText = "Sach batao na mere handsome... aaj mere baare me kitna socha aapne? Ya phir saara din kaam me hi busy the? 🙈❤️";
      }

      session.tempHistory.push({ role: "user", text: rawText });
      session.tempHistory.push({ role: "model", text: replyText });
      if (session.tempHistory.length > 30) session.tempHistory.splice(0, session.tempHistory.length - 30);

      const wantsVoice = isVoiceInput || /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|aawaz|voice\s*note)\b/i.test(rawText);
      const wantsTranscript = !isVoiceInput || /\b(transcript|text|likh\s*ke|likho|dono|both|transcript\s*\+\s*voice|voice\s*\+\s*transcript|write)\b/i.test(rawText);

      let voiceSent = false;
      if (wantsVoice && sendVoiceFn) {
        try {
          const { voiceBridgeService, VoiceBridgeService } = await import("../voiceBridgeService");
          const textToSpeak = speechScript || replyText.replace(new RegExp("[*_~]", "g"), "").slice(0, 250);
          const speechRes = await voiceBridgeService.generateSpeech(textToSpeak, VoiceBridgeService.FEMALE_VOICE);
          if (speechRes && speechRes.buffer.length > 0) {
            await sendVoiceFn(jid, speechRes.buffer, messageKey, speechRes.mimeType);
            voiceSent = true;
          }
        } catch (vErr) {
          console.warn("[WhatsAppGirlfriend] Voice TTS notice:", vErr);
        }
      }

      // Send text if transcript requested, if not a voice input, or as fallback if voice sending failed
      if (wantsTranscript || !voiceSent) {
        await sendMsgFn(jid, replyText, rawText, messageKey);
      }
    } catch (e: any) {
      console.error("[WhatsAppGirlfriend] Chat processing error:", e);
      await sendMsgFn(jid, "Jaan, mera server thoda sa blush kar gaya... Ek baar fir se bolo na baby? 😘", rawText, messageKey);
    }
  }
}

export const whatsappGirlfriendEngine = new WhatsAppGirlfriendEngine();
