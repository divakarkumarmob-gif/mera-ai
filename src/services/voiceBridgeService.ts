import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { humanSpeechProsodyEngine } from "./humanSpeechProsodyEngine";
import { getMessengerGeminiKey } from "./geminiKeyPoolService";

export const GEMINI_TTS_PRIORITY_MODELS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.8-flash-tts",
] as const;

export interface BridgeSession {
  userA_chatId: number; // Text user (Types text -> becomes voice for B)
  userA_name: string;
  userB_chatId: number; // Voice user (Speaks voice -> becomes text for A)
  userB_name: string;
  preferredVoice?: string;
  createdAt: number;
  isActive: boolean;
}

export interface GroupCallSession {
  groupId: number;
  groupTitle?: string;
  userA_id?: number; // User A (Text Mode)
  userA_name?: string;
  userB_id?: number; // User B (Voice Mode)
  userB_name?: string;
  isCallActive: boolean;
  isMuted: boolean;
  preferredVoice: string;
  startedAt: number;
}

export class VoiceBridgeService {
  private activeSessions: Map<number, BridgeSession> = new Map(); // Key: chatId -> Session
  private groupSessions: Map<number, GroupCallSession> = new Map(); // Key: groupId -> GroupCallSession
  private bossGlobalVoice: string = "hi-IN-SwaraNeural"; // Default: Female (Swara)
  public static readonly DEFAULT_VOICE = "hi-IN-MadhurNeural"; // Natural Hindi Male
  public static readonly FEMALE_VOICE = "hi-IN-SwaraNeural"; // Natural Hindi Female
  public static readonly ENGLISH_VOICE = "en-IN-PrabhatNeural"; // Indian English

  constructor() {
    this.loadSessionsFromDb().catch(() => {});
    this.getBossGlobalVoice().catch(() => {});
  }

  /**
   * Get active persistent voice tone for WhatsApp and Telegram voice replies
   */
  public async getBossGlobalVoice(): Promise<string> {
    try {
      if (db && process.env.FIREBASE_PROJECT_ID) {
        const doc = await db.collection("settings").doc("bossVoicePreference").get();
        if (doc.exists && doc.data()?.voice) {
          this.bossGlobalVoice = doc.data()?.voice;
        }
      }
    } catch {}
    return this.bossGlobalVoice || VoiceBridgeService.FEMALE_VOICE;
  }

  /**
   * Update persistent voice tone for WhatsApp & Telegram replies
   */
  public async setBossGlobalVoice(voiceChoice: string): Promise<{ success: boolean; voice: string; voiceName: string }> {
    let resolved = VoiceBridgeService.FEMALE_VOICE;
    let name = "Female Hindi (Swara / Aoede)";

    const clean = voiceChoice.toLowerCase().trim();
    if (clean.includes("puck")) {
      resolved = "Puck";
      name = "Gemini Puck (Male Upbeat)";
    } else if (clean.includes("charon")) {
      resolved = "Charon";
      name = "Gemini Charon (Male Informative)";
    } else if (clean.includes("fenrir")) {
      resolved = "Fenrir";
      name = "Gemini Fenrir (Male Excitable)";
    } else if (clean.includes("aoede")) {
      resolved = "Aoede";
      name = "Gemini Aoede (Female Melodic)";
    } else if (clean.includes("kore")) {
      resolved = "Kore";
      name = "Gemini Kore (Female Calm)";
    } else if (clean.includes("leda")) {
      resolved = "Leda";
      name = "Gemini Leda (Female Youthful)";
    } else if (clean.includes("zephyr")) {
      resolved = "Zephyr";
      name = "Gemini Zephyr (Female Warm)";
    } else if (clean.includes("male") || clean.includes("ladka") || clean.includes("madhur") || clean.includes("aadmi") || clean.includes("man") || clean.includes("purush")) {
      resolved = VoiceBridgeService.DEFAULT_VOICE; // Madhur Male
      name = "Male Hindi (Madhur / Puck)";
    } else if (clean.includes("english") || clean.includes("prabhat") || clean.includes("en")) {
      resolved = VoiceBridgeService.ENGLISH_VOICE; // Prabhat
      name = "Indian English (Prabhat)";
    } else if (clean.includes("swara") || clean.includes("female") || clean.includes("ladki") || clean.includes("aurat") || clean.includes("woman") || clean.includes("stri")) {
      resolved = VoiceBridgeService.FEMALE_VOICE; // Swara
      name = "Female Hindi (Swara / Aoede)";
    }

    this.bossGlobalVoice = resolved;

    try {
      if (db && process.env.FIREBASE_PROJECT_ID) {
        await db.collection("settings").doc("bossVoicePreference").set({
          voice: resolved,
          voiceName: name,
          updatedAt: Date.now(),
        }, { merge: true });
      }
      console.log(`[VoiceBridge] 🎙️ Boss Voice Preference updated to: ${name} (${resolved})`);
    } catch (e) {
      console.warn("[VoiceBridge] Failed to save boss voice preference:", e);
    }

    return { success: true, voice: resolved, voiceName: name };
  }

  /**
   * Load stored active bridge sessions from Firestore
   */
  private async loadSessionsFromDb(): Promise<void> {
    if (!db || !process.env.FIREBASE_PROJECT_ID) return;
    try {
      const snap = await Promise.race([
        db.collection("voiceBridgeSessions").where("isActive", "==", true).get(),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Firestore timeout")), 2500)),
      ]);
      snap.forEach((doc: any) => {
        const session = doc.data() as BridgeSession;
        this.activeSessions.set(session.userA_chatId, session);
        this.activeSessions.set(session.userB_chatId, session);
      });
      console.log(`[VoiceBridge] Loaded ${snap.size} active voice bridge sessions.`);
    } catch (e) {
      // Non-blocking if offline/local
    }
  }

  /**
   * 1. ElevenLabs High-Fidelity Neural TTS (Ultra-Realistic Human Voice)
   * Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (optional)
   */
  public async elevenLabsTTS(
    text: string,
    voiceId: string = process.env.ELEVENLABS_VOICE_ID || "cgSgspJ2msm6clMCkdW9" // Jessica (Free Premade Voice)
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return null;

    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn("[VoiceBridge] ElevenLabs TTS notice:", errText);
        return null;
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer && buffer.length > 0) {
        return { buffer, mimeType: "audio/mpeg" };
      }
    } catch (e: any) {
      console.warn("[VoiceBridge] ElevenLabs fetch failed:", e?.message || e);
    }
    return null;
  }

  /**
   * 2. Sarvam AI Dedicated Indian Languages TTS (Hindi & 22 Indian Languages)
   * Env: SARVAM_API_KEY (or SARVAM_AI_API_KEY)
   */
  public async sarvamTTS(
    text: string,
    targetLanguageCode: string = "hi-IN",
    speaker: string = "simran",
    prosodyOverride?: { pitch?: number; pace?: number; loudness?: number }
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const apiKey = (process.env.SARVAM_API_KEY || process.env.SARVAM_AI_API_KEY)?.trim();
    if (!apiKey) return null;

    try {
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [text.trim()],
          target_language_code: targetLanguageCode,
          speaker: speaker || "simran",
          pitch: prosodyOverride?.pitch ?? 0,
          pace: prosodyOverride?.pace ?? 1.0,
          loudness: prosodyOverride?.loudness ?? 1.5,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: "bulbul:v3",
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn("[VoiceBridge] Sarvam AI TTS notice:", errText);
        return null;
      }

      const data = await res.json();
      if (data?.audios && Array.isArray(data.audios) && data.audios[0]) {
        const buffer = Buffer.from(data.audios[0], "base64");
        return { buffer, mimeType: "audio/wav" };
      }
    } catch (e: any) {
      console.warn("[VoiceBridge] Sarvam AI fetch failed:", e?.message || e);
    }
    return null;
  }

  /**
   * Helper: Package raw PCM (16-bit linear PCM) into a standard RIFF WAV buffer.
   * Ensures seamless playback on WhatsApp (Baileys) and Telegram.
   */
  public pcmToWav(
    pcmBuffer: Buffer,
    sampleRate: number = 24000,
    numChannels: number = 1,
    bitsPerSample: number = 16
  ): Buffer {
    if (pcmBuffer.length >= 4 && pcmBuffer.subarray(0, 4).toString("ascii") === "RIFF") {
      return pcmBuffer;
    }
    const header = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // 1 = PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  /**
   * Resolves appropriate Gemini prebuilt voice name (Aoede, Kore, Puck, Charon, etc.)
   */
  public resolveGeminiVoice(targetVoice?: string): string {
    if (!targetVoice) return "Aoede";
    const clean = targetVoice.toLowerCase().trim();

    // Direct Gemini prebuilt voice names
    if (clean.includes("puck")) return "Puck";
    if (clean.includes("charon")) return "Charon";
    if (clean.includes("fenrir")) return "Fenrir";
    if (clean.includes("orus")) return "Orus";
    if (clean.includes("kore")) return "Kore";
    if (clean.includes("aoede")) return "Aoede";
    if (clean.includes("leda")) return "Leda";
    if (clean.includes("zephyr")) return "Zephyr";

    // Female keywords checked FIRST (prevents 'female' containing 'male')
    if (
      clean.includes("swara") ||
      clean.includes("female") ||
      clean.includes("ladki") ||
      clean.includes("aurat") ||
      clean.includes("woman") ||
      clean.includes("stri") ||
      clean.includes("girl")
    ) {
      return "Aoede";
    }

    // Male keywords
    if (
      clean.includes("madhur") ||
      clean.includes("kabir") ||
      clean.includes("aadmi") ||
      clean.includes("ladka") ||
      clean.includes("purush") ||
      clean.includes("boy") ||
      /\bmale\b/.test(clean) ||
      /\bman\b/.test(clean)
    ) {
      return "Puck";
    }

    if (clean.includes("prabhat") || clean.includes("en-in")) {
      return "Puck";
    }

    return "Aoede";
  }

  /**
   * Primary Text-to-Speech (TTS) Engine using Google Gemini REST Endpoints
   * Priority Order based on Google documentation & user specification:
   * 1. 3.1 Flash TTS (gemini-3.1-flash-tts-preview / gemini-3.1-flash-tts)
   * 2. 2.5 Flash TTS (gemini-2.5-flash-preview-tts / gemini-2.5-flash-tts)
   * 3. 3.8 Flash Lite TTS (gemini-3.8-flash-lite-tts)
   * 4. 3.8 Flash TTS (gemini-3.8-flash-tts)
   *
   * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
   */
  public async geminiTTS(
    text: string,
    targetVoice?: string,
    modelOverride?: string
  ): Promise<{ buffer: Buffer; mimeType: string; modelUsed: string } | null> {
    let apiKey = "";
    try {
      apiKey = getMessengerGeminiKey?.() || "";
    } catch {}
    if (!apiKey) {
      apiKey = (
        process.env.GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY_2 ||
        process.env.GEMINI_API_KEY_1 ||
        process.env.GOOGLE_API_KEY ||
        ""
      ).trim();
    }

    if (!apiKey) return null;

    const voiceName = this.resolveGeminiVoice(targetVoice);

    const modelTiers: string[][] = modelOverride
      ? [[modelOverride]]
      : [
          // 1. 3.1 Flash TTS
          ["gemini-3.1-flash-tts-preview", "gemini-3.1-flash-tts"],
          // 2. 2.5 Flash TTS
          ["gemini-2.5-flash-preview-tts", "gemini-2.5-flash-tts"],
          // 3. 3.8 Flash Lite TTS
          ["gemini-3.8-flash-lite-tts"],
          // 4. 3.8 Flash TTS
          ["gemini-3.8-flash-tts"],
        ];

    for (const tier of modelTiers) {
      for (const model of tier) {
        try {
          const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const requestBody = {
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: text.trim(),
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
            },
          };

          const res = await fetch(endpointUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(18000),
          });

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            console.warn(`[VoiceBridge] Gemini TTS (${model}) notice [${res.status}]: ${errBody.slice(0, 160)}`);
            continue;
          }

          const json = await res.json();
          const candidate = json.candidates?.[0];
          const parts = candidate?.content?.parts;
          if (!parts || !Array.isArray(parts)) continue;

          const audioPart = parts.find((p: any) => p.inlineData?.data || p.inline_data?.data);
          const rawInlineData = audioPart?.inlineData || audioPart?.inline_data;

          if (!rawInlineData?.data) {
            console.warn(`[VoiceBridge] Gemini TTS (${model}) response has no audio inlineData.`);
            continue;
          }

          const rawBuffer = Buffer.from(rawInlineData.data, "base64");
          if (!rawBuffer || rawBuffer.length === 0) continue;

          let rawMime = (rawInlineData.mimeType || "audio/wav").toLowerCase();
          let finalBuffer = rawBuffer;
          let finalMime = "audio/wav";

          if (rawMime.includes("mp3") || rawMime.includes("mpeg")) {
            finalMime = "audio/mpeg";
          } else if (rawMime.includes("ogg") || rawMime.includes("opus")) {
            finalMime = "audio/ogg";
          } else {
            const isPcm = rawMime.includes("pcm") || rawMime.includes("l16");
            const hasRiffHeader = rawBuffer.length >= 4 && rawBuffer.subarray(0, 4).toString("ascii") === "RIFF";

            if (isPcm || !hasRiffHeader) {
              const rateMatch = rawMime.match(/rate=(\d+)/i);
              const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
              finalBuffer = this.pcmToWav(rawBuffer, sampleRate, 1, 16);
            }
            finalMime = "audio/wav";
          }

          console.log(`[VoiceBridge] 🎙️ Synthesized speech via Gemini TTS (${model} | Voice: ${voiceName} | ${finalBuffer.length} bytes)`);
          return { buffer: finalBuffer, mimeType: finalMime, modelUsed: model };
        } catch (callErr: any) {
          console.warn(`[VoiceBridge] Gemini TTS error calling ${model}:`, callErr?.message || callErr);
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Universal Smart Text-to-Speech (TTS) Pipeline with Human Speech Prosody:
   * 1. Google Gemini Flash TTS (Priority: 3.1 Flash -> 2.5 Flash -> 3.8 Flash Lite -> 3.8 Flash)
   * 2. ElevenLabs TTS (Secondary - If ELEVENLABS_API_KEY present)
   * 3. Sarvam AI TTS (Tertiary - If SARVAM_API_KEY present)
   * 4. Microsoft Edge Neural Engine (Fallback - 100% Free & Unlimited)
   */
  public async generateSpeech(
    text: string,
    voice?: string,
    context?: { isBoss?: boolean; userPrompt?: string; emotionOverride?: any }
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Text is empty for TTS");

    const isSingleReactionEmoji = /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(cleanText);
    if (cleanText.startsWith("[Reaction:") || cleanText.startsWith("[reaction:") || /^\[Reaction/i.test(cleanText) || isSingleReactionEmoji) {
      throw new Error("Text is a reaction or single emoji, skipping speech generation");
    }

    // 0. Affective Humanization & Acoustic Cadence Infusion
    const { cleanSpokenText, prosody } = humanSpeechProsodyEngine.humanizeTextForSpeech(cleanText, context);
    const textToSpeak = cleanSpokenText || cleanText;

    const targetVoice = voice || (await this.getBossGlobalVoice());
    const isMale = targetVoice.toLowerCase().includes("madhur") || targetVoice.toLowerCase().includes("male") || targetVoice.toLowerCase().includes("kabir") || targetVoice.toLowerCase().includes("aadmi") || targetVoice.toLowerCase().includes("ladka");
    const isEnglish = targetVoice.toLowerCase().includes("prabhat") || targetVoice.toLowerCase().includes("en-in") || targetVoice.toLowerCase().includes("english");

    // 1. Google Gemini Flash TTS Priority Chain (3.1 Flash -> 2.5 Flash -> 3.8 Flash Lite -> 3.8 Flash)
    try {
      const geminiRes = await this.geminiTTS(textToSpeak, targetVoice);
      if (geminiRes && geminiRes.buffer.length > 0) {
        console.log(`[VoiceBridge] Generated voice via Gemini TTS (${geminiRes.modelUsed} - ${prosody.vibeDescription})`);
        return { buffer: geminiRes.buffer, mimeType: geminiRes.mimeType };
      }
    } catch (gErr: any) {
      console.warn("[VoiceBridge] Gemini TTS priority chain fallback:", gErr?.message || gErr);
    }

    // 2. ElevenLabs TTS (Secondary Fallback)
    try {
      const elevenRes = await this.elevenLabsTTS(textToSpeak);
      if (elevenRes && elevenRes.buffer.length > 0) {
        console.log(`[VoiceBridge] Generated voice via ElevenLabs TTS (${prosody.vibeDescription})`);
        return elevenRes;
      }
    } catch {}

    // 2. Sarvam AI TTS (Specialized Indian Hindi & Regional Languages - bulbul:v2)
    try {
      const sarvamSpeaker = isMale ? "abhilash" : isEnglish ? "amartya" : "anushka";
      const sarvamLang = isEnglish ? "en-IN" : "hi-IN";
      const sarvamRes = await this.sarvamTTS(textToSpeak, sarvamLang, sarvamSpeaker, prosody.sarvamProsody);
      if (sarvamRes && sarvamRes.buffer.length > 0) {
        console.log(`[VoiceBridge] Generated voice via Sarvam AI TTS (${sarvamSpeaker} - ${prosody.vibeDescription})`);
        return sarvamRes;
      }
    } catch {}

    // 3. Microsoft Edge Neural Engine (100% Free & Unlimited Fallback with Affective Prosody)
    console.log(`[VoiceBridge] Using Microsoft Edge Neural TTS (${targetVoice} - ${prosody.vibeDescription})`);
    const msBuf = await this.textToSpeechBuffer(textToSpeak, targetVoice, prosody.edgeProsody);
    return { buffer: msBuf, mimeType: "audio/mpeg" };
  }

  /**
   * Text-to-Speech (TTS) using Microsoft Edge Neural Engine (100% Free, High Quality)
   */
  public async textToSpeechBuffer(
    text: string,
    voice: string = VoiceBridgeService.DEFAULT_VOICE,
    prosodyOptions?: { pitch?: string; rate?: string | number; volume?: string }
  ): Promise<Buffer> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Text is empty for TTS");

    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const stream = await tts.toStream(cleanText, prosodyOptions ? ({ prosody: prosodyOptions } as any) : undefined);

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.audioStream.on("end", () => {
          tts.close();
          resolve(Buffer.concat(chunks));
        });
        stream.audioStream.on("error", (err: any) => {
          tts.close();
          reject(err);
        });
      });
    } catch (err) {
      try {
        tts.close();
      } catch {}
      throw err;
    }
  }

  /**
   * Synthesizes speech returning raw audio buffer directly
   */
  public async synthesizeSpeech(text: string, voice?: string): Promise<Buffer> {
    const res = await this.generateSpeech(text, voice);
    return res.buffer;
  }

  /**
   * 2. Speech-to-Text (STT) using Groq Whisper Large V3 (~200ms ultra fast)
   * Fallback to Gemini Multimodal Audio if Groq API key is not configured.
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string = "audio/ogg",
    filename: string = "voice.ogg"
  ): Promise<string> {
    const groqApiKey = process.env.GROQ_API_KEY?.trim();

    // Strategy A: Groq Cloud Whisper Large V3 (Ultra-Fast 200ms, accurate Hindi/English)
    if (groqApiKey) {
      try {
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: mimeType });
        formData.append("file", blob, filename);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "text");
        formData.append("language", "hi"); // Hindi / Hinglish primary

        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn("[VoiceBridge] Groq Whisper STT error:", errText);
        } else {
          const text = await res.text();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      } catch (e: any) {
        console.warn("[VoiceBridge] Groq STT fetch failed:", e?.message);
      }
    }

    // Strategy B: Fallback to Gemini 3.6 Flash / Flash-Lite Multimodal Audio STT
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const base64Audio = audioBuffer.toString("base64");
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType || "audio/ogg",
                    data: base64Audio,
                  },
                },
                {
                  text: "You are a fast speech-to-text transcriber. Transcribe the audio exactly as spoken in Hindi / Hinglish / English without any extra commentary. Output ONLY the transcribed text.",
                },
              ],
            },
          ],
        });

        const text = response.text?.trim();
        if (text) return text;
      } catch (e: any) {
        console.warn("[VoiceBridge] Gemini Audio STT fallback error:", e?.message);
      }
    }

    throw new Error(
      "STT transcription failed. Please set GROQ_API_KEY in .env for ultra-fast Whisper Large V3 transcription."
    );
  }

  /**
   * Start or create a Voice-Text Bridge session between User A (Text) and User B (Voice)
   */
  public async createBridgeSession(
    userA_chatId: number,
    userA_name: string,
    userB_chatId: number,
    userB_name: string,
    voice: string = VoiceBridgeService.DEFAULT_VOICE
  ): Promise<BridgeSession> {
    const session: BridgeSession = {
      userA_chatId,
      userA_name,
      userB_chatId,
      userB_name,
      preferredVoice: voice,
      createdAt: Date.now(),
      isActive: true,
    };

    this.activeSessions.set(userA_chatId, session);
    this.activeSessions.set(userB_chatId, session);

    // Persist async to Firestore without blocking the caller
    (async () => {
      try {
        const docId = `bridge_${userA_chatId}_${userB_chatId}`;
        await Promise.race([
          db.collection("voiceBridgeSessions").doc(docId).set(session),
          new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 2000)),
        ]);
      } catch {}
    })();

    return session;
  }

  /**
   * Stop an active bridge session for a user
   */
  public async stopBridgeSession(chatId: number): Promise<BridgeSession | null> {
    const session = this.activeSessions.get(chatId);
    if (!session) return null;

    session.isActive = false;
    this.activeSessions.delete(session.userA_chatId);
    this.activeSessions.delete(session.userB_chatId);

    // Update async in Firestore without blocking
    (async () => {
      try {
        const docId = `bridge_${session.userA_chatId}_${session.userB_chatId}`;
        await Promise.race([
          db.collection("voiceBridgeSessions").doc(docId).update({ isActive: false }),
          new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 2000)),
        ]);
      } catch {}
    })();

    return session;
  }

  /**
   * Get active session for a specific chat ID
   */
  public getSession(chatId: number): BridgeSession | undefined {
    const session = this.activeSessions.get(chatId);
    return session && session.isActive ? session : undefined;
  }

  /**
   * Set voice tone preference for user
   */
  public setPreferredVoice(chatId: number, voice: string): boolean {
    const session = this.getSession(chatId);
    if (session) {
      session.preferredVoice = voice;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------
  // GROUP CALL BRIDGE METHODS
  // -------------------------------------------------------------

  public getGroupSession(groupId: number): GroupCallSession | undefined {
    return this.groupSessions.get(groupId);
  }

  public initOrGetGroupSession(groupId: number, groupTitle?: string): GroupCallSession {
    let session = this.groupSessions.get(groupId);
    if (!session) {
      session = {
        groupId,
        groupTitle,
        isCallActive: false,
        isMuted: false,
        preferredVoice: VoiceBridgeService.DEFAULT_VOICE,
        startedAt: Date.now(),
      };
      this.groupSessions.set(groupId, session);
    } else if (groupTitle) {
      session.groupTitle = groupTitle;
    }
    return session;
  }

  public setUserAInGroup(groupId: number, userId: number, userName: string): GroupCallSession {
    const session = this.initOrGetGroupSession(groupId);
    session.userA_id = userId;
    session.userA_name = userName;
    return session;
  }

  public setUserBInGroup(groupId: number, userId: number, userName: string): GroupCallSession {
    const session = this.initOrGetGroupSession(groupId);
    session.userB_id = userId;
    session.userB_name = userName;
    return session;
  }

  public startGroupCall(groupId: number): { success: boolean; session?: GroupCallSession; error?: string } {
    const session = this.initOrGetGroupSession(groupId);
    if (!session.userA_id || !session.userB_id) {
      return {
        success: false,
        session,
        error: "Call shuru karne ke liye pehle User A aur User B dono ko set karein! (Example: 'User A @username' aur 'User B @username')",
      };
    }
    session.isCallActive = true;
    session.isMuted = false;
    session.startedAt = Date.now();
    return { success: true, session };
  }

  public toggleMuteGroupCall(groupId: number): { isMuted: boolean } {
    const session = this.initOrGetGroupSession(groupId);
    session.isMuted = !session.isMuted;
    return { isMuted: session.isMuted };
  }

  public endGroupCall(groupId: number): GroupCallSession | null {
    const session = this.groupSessions.get(groupId);
    if (!session) return null;
    session.isCallActive = false;
    session.isMuted = false;
    return session;
  }

  public switchGroupVoice(groupId: number): string {
    const session = this.initOrGetGroupSession(groupId);
    if (session.preferredVoice === VoiceBridgeService.DEFAULT_VOICE) {
      session.preferredVoice = VoiceBridgeService.FEMALE_VOICE;
    } else if (session.preferredVoice === VoiceBridgeService.FEMALE_VOICE) {
      session.preferredVoice = VoiceBridgeService.ENGLISH_VOICE;
    } else {
      session.preferredVoice = VoiceBridgeService.DEFAULT_VOICE;
    }
    return session.preferredVoice;
  }
}

export const voiceBridgeService = new VoiceBridgeService();
