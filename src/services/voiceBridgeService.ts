import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

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
  public static readonly DEFAULT_VOICE = "hi-IN-MadhurNeural"; // Natural Hindi Male
  public static readonly FEMALE_VOICE = "hi-IN-SwaraNeural"; // Natural Hindi Female
  public static readonly ENGLISH_VOICE = "en-IN-PrabhatNeural"; // Indian English

  constructor() {
    this.loadSessionsFromDb().catch(() => {});
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
   * 1. Text-to-Speech (TTS) using Microsoft Edge Neural Engine (100% Free, High Quality)
   */
  public async textToSpeechBuffer(
    text: string,
    voice: string = VoiceBridgeService.DEFAULT_VOICE
  ): Promise<Buffer> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Text is empty for TTS");

    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const stream = await tts.toStream(cleanText);

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
          model: "gemini-2.5-flash",
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
