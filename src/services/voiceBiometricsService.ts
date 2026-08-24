import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export interface BossVoiceProfile {
  id: string;
  name: string;
  voiceTraits: string;
  audioFingerprint?: string;
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
}

const DEFAULT_PIN = "620455";
const MAX_PROFILES = 2;

class VoiceBiometricsService {
  private cachedPin: string | null = null;

  private getGenAI(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * Fetches the current active PIN from Firestore (doc: systemSecurity/voicePin).
   * Falls back to env or default 620455 if not set yet.
   */
  public async getActivePin(): Promise<string> {
    try {
      const doc = await db.collection("systemSecurity").doc("voicePin").get();
      if (doc.exists && doc.data()?.pin) {
        const pin = String(doc.data()?.pin).trim();
        this.cachedPin = pin;
        return pin;
      }
    } catch (e) {
      console.warn("[VoiceBiometrics] Failed to fetch voicePin from Firestore:", e);
    }
    return this.cachedPin || process.env.VOICE_AUTH_PIN || DEFAULT_PIN;
  }

  /**
   * Updates the single active PIN in Firestore, overwriting any previous PIN.
   */
  public async updateVoicePin(newPin: string, senderName: string = "Boss (DK)"): Promise<{ success: boolean; pin: string; message: string }> {
    const cleanPin = String(newPin || "").trim().replace(/\D/g, "");
    if (!cleanPin || cleanPin.length < 4) {
      return {
        success: false,
        pin: "",
        message: "PIN kam se kam 4-6 digits ka hona chahiye.",
      };
    }

    try {
      await db.collection("systemSecurity").doc("voicePin").set({
        pin: cleanPin,
        updatedAt: Date.now(),
        updatedBy: senderName,
      });
      this.cachedPin = cleanPin;
      console.log(`[VoiceBiometrics] Updated active voice PIN to [${cleanPin}] by ${senderName}`);

      return {
        success: true,
        pin: cleanPin,
        message: `Boss, aapka naya Voice PIN [${cleanPin}] save ho gaya hai! Purana PIN replace ho gaya. Ab aap is naye PIN se voice enroll ya delete kar sakte hain. ✅`,
      };
    } catch (e: any) {
      console.error("[VoiceBiometrics] Failed to save PIN to Firestore:", e);
      return {
        success: false,
        pin: "",
        message: `PIN save karne me error: ${e?.message || e}`,
      };
    }
  }

  /**
   * Checks if an incoming WhatsApp message from Boss is a Voice PIN update command.
   * e.g. "voice pin - 123456", "voice pin 620455", "voice pin: 987654"
   */
  public async handleWhatsAppVoicePinMessage(text: string, senderName: string): Promise<{ handled: boolean; replyText?: string }> {
    const pattern = /(?:voice\s*pin|voice\s*password|security\s*pin|auth\s*pin|new\s*pin)[\s\:\-\=]+([0-9]{4,8})/i;
    const match = text.match(pattern);

    if (match && match[1]) {
      const pin = match[1];
      const result = await this.updateVoicePin(pin, senderName);
      return {
        handled: true,
        replyText: result.message,
      };
    }
    return { handled: false };
  }

  /**
   * Verifies the provided PIN against the latest Firestore PIN (or fallback).
   */
  public async verifyPin(pin: string): Promise<boolean> {
    const normalizedInput = String(pin || "").trim().replace(/\D/g, "");
    const active = (await this.getActivePin()).trim();
    return normalizedInput === active;
  }

  /**
   * Returns all active enrolled Boss voice profiles from Firestore.
   */
  public async getProfiles(): Promise<BossVoiceProfile[]> {
    try {
      const snap = await db.collection("bossVoiceProfiles").orderBy("createdAt", "asc").get();
      return snap.docs.map((doc) => doc.data() as BossVoiceProfile);
    } catch (e) {
      console.warn("[VoiceBiometrics] Failed to fetch voice profiles:", e);
      return [];
    }
  }

  /**
   * Enrolls a new Boss Voice Profile into Firestore.
   * Requires dynamic PIN from Firestore and enforces max 2 profiles.
   */
  public async enrollVoice(
    pin: string,
    name: string = "Boss (Divakar)",
    audioBase64?: string,
    spokenPhrase?: string
  ): Promise<{ success: boolean; profileId?: string; message: string; count?: number }> {
    const isPinValid = await this.verifyPin(pin);
    if (!isPinValid) {
      return {
        success: false,
        message: "Sorry bhai, password galat hai! Voice recognition setup nahi ho sakta.",
      };
    }

    const currentProfiles = await this.getProfiles();
    if (currentProfiles.length >= MAX_PROFILES) {
      return {
        success: false,
        message: `Maximum ${MAX_PROFILES} voice profiles allow hain. Naya add karne ke liye pehle purana delete karein.`,
      };
    }

    const ai = this.getGenAI();
    let voiceTraits = "Boss voice biometric profile (pitch, cadence, tone fingerprint).";

    if (audioBase64 && ai) {
      try {
        const prompt = `You are Friday AI Voice Biometric Analyzer.
Extract a detailed acoustic voice profile from this audio sample:
Speaker Name: "${name}"
Spoken Phrase: "${spokenPhrase || "Friday main tumhara boss hoon, meri aawaz pehchano"}"

Extract key vocal characteristics:
1. Fundamental pitch range (deep/medium/high baritone/tenor)
2. Cadence, speech rhythm, articulation style, distinct acoustic harmonics
3. Vocal timbre and tone signature for strict biometric matching against impostors.`;

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "audio/pcm;rate=16000",
                    data: audioBase64,
                  },
                },
              ],
            },
          ],
        });
        voiceTraits = response.text || voiceTraits;
      } catch (e) {
        console.warn("[VoiceBiometrics] Audio analysis fallback:", e);
      }
    }

    const profileId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newProfile: BossVoiceProfile = {
      id: profileId,
      name,
      voiceTraits,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.collection("bossVoiceProfiles").doc(profileId).set(newProfile);
    console.log(`[VoiceBiometrics] Enrolled voice profile "${name}" (ID: ${profileId})`);

    const updatedCount = currentProfiles.length + 1;
    return {
      success: true,
      profileId,
      count: updatedCount,
      message: `Boss, aapka voice profile memory me successfully save ho gaya hai! (Total profiles: ${updatedCount}/${MAX_PROFILES}). Ab main aapki aawaz pehchan lungi.`,
    };
  }

  /**
   * Deletes a voice profile or all profiles after PIN validation.
   */
  public async deleteProfile(
    pin: string,
    profileId?: string
  ): Promise<{ success: boolean; message: string }> {
    const isPinValid = await this.verifyPin(pin);
    if (!isPinValid) {
      return {
        success: false,
        message: "Sorry bhai, password galat hai! Voice profile delete nahi kiya ja sakta.",
      };
    }

    try {
      if (profileId) {
        await db.collection("bossVoiceProfiles").doc(profileId).delete();
      } else {
        const snap = await db.collection("bossVoiceProfiles").get();
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      return {
        success: true,
        message: "Boss, voice profile successfully delete kar diya gaya hai.",
      };
    } catch (e: any) {
      return {
        success: false,
        message: `Delete failed: ${e?.message || e}`,
      };
    }
  }

  /**
   * Verifies if the speaker audio matches enrolled Boss profiles.
   */
  public async verifySpeaker(
    audioBase64: string
  ): Promise<{ isBoss: boolean; confidence: number; matchedName?: string; reason: string }> {
    const profiles = await this.getProfiles();
    if (profiles.length === 0) {
      // If no voice profile enrolled yet, allow access by default
      return {
        isBoss: true,
        confidence: 1.0,
        matchedName: "Boss",
        reason: "No biometric lock enrolled yet.",
      };
    }

    const ai = this.getGenAI();
    if (!ai) {
      return { isBoss: true, confidence: 0.9, matchedName: profiles[0].name, reason: "Default pass." };
    }

    try {
      const prompt = `You are Friday AI Biometric Voice Verifier.
Compare this live audio sample against the enrolled Boss voice traits:

ENROLLED BOSS PROFILES:
${JSON.stringify(profiles.map((p) => ({ id: p.id, name: p.name, traits: p.voiceTraits })), null, 2)}

TASK:
Determine if this live audio belongs to the enrolled Boss.
Return ONLY valid JSON:
{
  "isBoss": true | false,
  "confidence": 0.0 to 1.0,
  "matchedName": "Boss Name or empty",
  "reason": "Short reason"
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "audio/pcm;rate=16000",
                  data: audioBase64,
                },
              },
            ],
          },
        ],
      });

      const raw = response.text || "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { isBoss: true, confidence: 0.8 };

      if (parsed.isBoss) {
        // update last verified timestamp
        const matched = profiles.find((p) => p.name === parsed.matchedName) || profiles[0];
        await db.collection("bossVoiceProfiles").doc(matched.id).set({ lastVerifiedAt: Date.now() }, { merge: true });
      }

      return {
        isBoss: !!parsed.isBoss,
        confidence: parsed.confidence || 0.8,
        matchedName: parsed.matchedName || profiles[0].name,
        reason: parsed.reason || "Biometric matching complete.",
      };
    } catch (e: any) {
      console.warn("[VoiceBiometrics] Verification error:", e);
      return { isBoss: true, confidence: 0.7, matchedName: "Boss", reason: "Fallback verification." };
    }
  }
}

export const voiceBiometricsService = new VoiceBiometricsService();
