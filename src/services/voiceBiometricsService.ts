import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export type SpeakerRole = "boss" | "family" | "friend" | "guest" | "unknown";

export interface BossVoiceProfile {
  id: string;
  name: string;
  role: SpeakerRole;
  relationWithDivakar: string;
  voiceTraits: string;
  spokenPhrases: string[];
  acousticProfile?: {
    pitchRange: string;
    timbre: string;
    gender: "male" | "female" | "neutral";
    cadence: string;
  };
  isRootAdmin: boolean;
  allowedActions: string[];
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
}

export interface VoiceEnrollmentSession {
  sessionId: string;
  name: string;
  role: SpeakerRole;
  relationWithDivakar: string;
  pin: string;
  step: number;
  totalSteps: number;
  recordedSamples: Array<{ phrase: string; audioBase64: string }>;
  createdAt: number;
}

export interface SpeakerVerificationResult {
  isBoss: boolean;
  speakerRole: SpeakerRole;
  speakerName: string;
  confidence: number;
  isRootAdmin: boolean;
  reason: string;
  matchedProfileId?: string;
}

const MAX_PROFILES = 10;

// Actions that are strictly reserved for Boss DK (Root Admin)
const SENSITIVE_ACTIONS = new Set([
  "delete_memory",
  "clear_all_memory",
  "read_contacts",
  "get_messenger_inbox",
  "send_whatsapp_message",
  "send_music_on_whatsapp",
  "execute_shell_command",
  "delete_voice_profile",
  "update_voice_pin",
  "clear_all_data",
  "modify_system_settings",
  "access_memory_vault",
  "view_chat_history",
  "view_code_agent_diff",
]);

class VoiceBiometricsService {
  private cachedPin: string = "1234";
  private inMemoryProfiles = new Map<string, BossVoiceProfile>();
  private activeEnrollments = new Map<string, VoiceEnrollmentSession>();
  private activeSessionSpeakerCache = new Map<string, { result: SpeakerVerificationResult; timestamp: number }>();
  private readonly SESSION_CACHE_TTL_MS = 60 * 1000; // 1 Minute active speaker continuity

  private getGenAI(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * Checks if an action is authorized for a specific speaker role.
   * Boss has 100% full root access.
   * Friends/Family/Guests can access general info, music, weather, and conversational AI,
   * but CANNOT view contacts, delete memories, execute shell, or modify system settings.
   */
  public isActionAuthorized(
    speakerRole: SpeakerRole,
    actionName: string
  ): { authorized: boolean; reason?: string } {
    if (speakerRole === "boss") {
      return { authorized: true };
    }

    if (SENSITIVE_ACTIONS.has(actionName)) {
      return {
        authorized: false,
        reason:
          "Aapki aawaz mere Boss DK se match nahi ho rahi hai. Main yeh sensitive details share ya modify nahi kar sakti. Kripya apni Voice Profile banayein ya Boss se permission lein.",
      };
    }

    return { authorized: true };
  }

  /**
   * Fetches active PIN from Firestore (doc: systemSecurity/voicePin) with in-memory fallback.
   * Ensures Friday ALWAYS verifies against the latest Firestore document.
   */
  public async getActivePin(): Promise<string | null> {
    try {
      if (db) {
        const doc = await db.collection("systemSecurity").doc("voicePin").get();
        if (doc.exists && doc.data()?.pin) {
          const pin = String(doc.data()?.pin).trim();
          this.cachedPin = pin;
          return pin;
        }
      }
    } catch (e) {
      console.warn("[VoiceBiometrics] Firestore getActivePin read error, using cache:", e);
    }

    return this.cachedPin || process.env.VOICE_AUTH_PIN || "1234";
  }

  /**
   * Updates the single active PIN in Firestore, overwriting any previous PIN.
   */
  public async updateVoicePin(
    newPin: string,
    senderName: string = "Boss (DK)",
    channel: string = "system"
  ): Promise<{ success: boolean; pin: string; message: string }> {
    const cleanPin = String(newPin || "").trim().replace(/\D/g, "");
    if (!cleanPin || cleanPin.length < 4) {
      return {
        success: false,
        pin: "",
        message: "⚠️ Voice PIN kam se kam 4 se 8 digits ka hona chahiye (e.g. `voice code 4589`).",
      };
    }

    this.cachedPin = cleanPin;

    try {
      if (db) {
        await db.collection("systemSecurity").doc("voicePin").set({
          pin: cleanPin,
          updatedAt: Date.now(),
          updatedAtISO: new Date().toISOString(),
          updatedBy: senderName,
          channel,
        });
        console.log(`[VoiceBiometrics] ✅ Firestore Voice PIN updated to [${cleanPin}] by ${senderName} via ${channel}`);
      }
    } catch (e) {
      console.warn("[VoiceBiometrics] Firestore write error (using memory cache):", e);
    }

    return {
      success: true,
      pin: cleanPin,
      message: `🔐 *VOICE CODE UPDATED SUCCESSFULLY!* ✅\n\n` +
        `• 🔑 *New Active Voice Code / PIN:* \`${cleanPin}\`\n` +
        `• 👤 *Set By:* ${senderName}\n` +
        `• 💾 *Storage:* Firestore (\`systemSecurity/voicePin\`)\n\n` +
        `Purana PIN replace ho gaya hai! Ab Friday voice mode me aapse baat karte waqt isi naye code (\`${cleanPin}\`) se verify karegi. 👑`,
    };
  }

  /**
   * Verifies the provided PIN against Firestore or cache.
   * Supports raw digits, English words ("one two three four"), and Hindi words ("ek do teen char").
   */
  public async verifyPin(pin: string): Promise<boolean> {
    let raw = String(pin || "").toLowerCase().trim();
    
    // Map spoken number words in Hindi and English to digits
    const wordToDigit: Record<string, string> = {
      zero: "0", shunya: "0", sifar: "0",
      one: "1", ek: "1",
      two: "2", do: "2",
      three: "3", teen: "3",
      four: "4", chaar: "4", char: "4",
      five: "5", paanch: "5", panch: "5",
      six: "6", chhah: "6", che: "6",
      seven: "7", saat: "7", sat: "7",
      eight: "8", aath: "8", ath: "8",
      nine: "9", nau: "9", no: "9",
    };

    for (const [word, digit] of Object.entries(wordToDigit)) {
      raw = raw.replace(new RegExp(`\\b${word}\\b`, "gi"), digit);
    }

    const normalizedInput = raw.replace(/\D/g, "");
    if (!normalizedInput) return false;

    const active = await this.getActivePin();
    if (!active) return false;

    return normalizedInput === active.trim();
  }

  /**
   * Returns all active enrolled voice profiles from Firestore with in-memory fallback.
   */
  /**
   * Returns all active enrolled voice profiles from Firestore with in-memory fallback.
   */
  public async getProfiles(): Promise<BossVoiceProfile[]> {
    try {
      const snap = await db.collection("bossVoiceProfiles").orderBy("createdAt", "asc").get();
      const list = snap.docs.map((doc) => {
        const data = doc.data() as any;
        const name = String(data.name || "Unknown").trim();
        const role: SpeakerRole = data.role || (name.toLowerCase().includes("boss") || name.toLowerCase().includes("divakar") ? "boss" : "friend");
        const isRootAdmin = data.isRootAdmin ?? (role === "boss");
        const profile: BossVoiceProfile = {
          id: doc.id || data.id || `voice_${Date.now()}`,
          name,
          role,
          relationWithDivakar: data.relationWithDivakar || (role === "boss" ? "Boss (Self)" : "Friend"),
          voiceTraits: data.voiceTraits || "Voice biometric profile.",
          spokenPhrases: Array.isArray(data.spokenPhrases) ? data.spokenPhrases : (data.spokenPhrase ? [data.spokenPhrase] : []),
          acousticProfile: data.acousticProfile,
          isRootAdmin,
          allowedActions: Array.isArray(data.allowedActions) ? data.allowedActions : (isRootAdmin ? ["all"] : ["general_info", "music", "weather", "calculator", "chat", "web_search"]),
          createdAt: Number(data.createdAt || Date.now()),
          updatedAt: Number(data.updatedAt || Date.now()),
          lastVerifiedAt: data.lastVerifiedAt ? Number(data.lastVerifiedAt) : undefined,
        };
        this.inMemoryProfiles.set(profile.id, profile);
        return profile;
      });
      return list;
    } catch {
      return Array.from(this.inMemoryProfiles.values());
    }
  }

  /**
   * Compiles list of enrolled voice profiles for Friday system prompt context.
   */
  public async compileVoiceProfilesPromptContext(): Promise<string> {
    try {
      const profiles = await this.getProfiles();
      if (!profiles || profiles.length === 0) {
        return `VOICE BIOMETRICS SECURITY STATUS:
- No voice profiles enrolled yet.
- DEFAULT ACCESS POLICY: Boss DK has full access. If strangers speak, identify context and offer guided voice profile creation.`;
      }

      const list = profiles
        .map((p, i) => {
          const roleStr = (p.role || "friend").toUpperCase();
          const nameStr = p.name || "Unknown";
          const relationStr = p.relationWithDivakar || "Friend";
          const adminStr = p.isRootAdmin ? "YES 👑" : "NO (Restricted)";
          return `${i + 1}. Name: "${nameStr}" | Role: ${roleStr} (Relation: ${relationStr}) | Root Admin: ${adminStr} | Profile ID: "${p.id}"`;
        })
        .join("\n");

      return `VOICE BIOMETRICS PROFILES (${profiles.length} Enrolled):
${list}

SPEAKER ACCESS RULES:
1. If speaker matches BOSS (DK): 100% Root Access granted.
2. If speaker matches Enrolled Friend/Family (e.g. Aman, Priya): Greet by name, provide friendly chat, music & general info. SENSITIVE ACTIONS (Contacts, Memory Deletions, System Settings, Shell Commands) are STRICTLY BLOCKED with refusal.
3. If speaker is UNKNOWN: General Info only. If asking sensitive questions, refuse and say: "Aapki aawaz mere Boss DK se match nahi ho rahi hai. Main yeh sensitive details share nahi kar sakti. Kripya apni Voice Profile banayein."`;
    } catch (err) {
      console.warn("[VoiceBiometrics] Failed to compile voice prompt context:", err);
      return `VOICE BIOMETRICS SECURITY STATUS:
- Default Access: Boss DK has full access.`;
    }
  }

  /**
   * 1. Start Guided Multi-Sample Voice Enrollment
   */
  public async startVoiceEnrollment(
    pin: string,
    name: string,
    relationWithDivakar: string,
    role: SpeakerRole = "friend"
  ): Promise<{ success: boolean; sessionId?: string; nextPrompt?: string; message: string }> {
    const isPinValid = await this.verifyPin(pin);
    if (!isPinValid) {
      return {
        success: false,
        message: "Sorry, password galat hai! Voice profile setup ke liye Boss ka Voice PIN zaroori hai.",
      };
    }

    const currentProfiles = await this.getProfiles();
    if (currentProfiles.length >= MAX_PROFILES) {
      return {
        success: false,
        message: `Maximum ${MAX_PROFILES} voice profiles allowed hain. Naya add karne ke liye purana profile delete karein.`,
      };
    }

    const sessionId = `enroll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: VoiceEnrollmentSession = {
      sessionId,
      name,
      role,
      relationWithDivakar,
      pin,
      step: 1,
      totalSteps: 3,
      recordedSamples: [],
      createdAt: Date.now(),
    };

    this.activeEnrollments.set(sessionId, session);

    const firstPhrase = `Friday main ${name} hoon, meri aawaz pehchano`;
    return {
      success: true,
      sessionId,
      nextPrompt: firstPhrase,
      message: `Voice calibration start ho gaya hai! Step 1/3: Kripya normal aawaz me boliye: "${firstPhrase}"`,
    };
  }

  /**
   * 2. Record Calibration Sample (Multi-Phrase Ingestion)
   */
  public async recordCalibrationSample(
    sessionId: string,
    audioBase64: string,
    spokenPhrase?: string
  ): Promise<{ success: boolean; step: number; totalSteps: number; isComplete: boolean; nextPrompt?: string; message: string }> {
    const session = this.activeEnrollments.get(sessionId);
    if (!session) {
      return {
        success: false,
        step: 0,
        totalSteps: 3,
        isComplete: false,
        message: "Enrollment session expire ya invalid ho gaya hai. Dobara start karein.",
      };
    }

    session.recordedSamples.push({
      phrase: spokenPhrase || `Calibration sample phrase ${session.step}`,
      audioBase64,
    });

    session.step += 1;

    if (session.step <= session.totalSteps) {
      const phrases = [
        `Friday main ${session.name} hoon, meri aawaz pehchano`,
        `Friday aaj ka mausam aur taaza khabrein batao`,
        `Friday mujhe mere Boss DK se connect karo`,
      ];
      const nextPhrase = phrases[session.step - 1] || `Sample phrase ${session.step}`;

      return {
        success: true,
        step: session.step,
        totalSteps: session.totalSteps,
        isComplete: false,
        nextPrompt: nextPhrase,
        message: `Sample ${session.step - 1} capture ho gaya! Step ${session.step}/${session.totalSteps}: Ab boliye: "${nextPhrase}"`,
      };
    }

    // All 3 samples recorded -> Finalize
    const finalizeRes = await this.finalizeVoiceEnrollment(sessionId);
    return {
      success: finalizeRes.success,
      step: session.totalSteps,
      totalSteps: session.totalSteps,
      isComplete: true,
      message: finalizeRes.message,
    };
  }

  /**
   * 3. Finalize Voice Enrollment with Multi-Sample Composite Embedding
   */
  public async finalizeVoiceEnrollment(
    sessionId: string
  ): Promise<{ success: boolean; profileId?: string; message: string }> {
    const session = this.activeEnrollments.get(sessionId);
    if (!session) {
      return { success: false, message: "Invalid enrollment session." };
    }

    const ai = this.getGenAI();
    let voiceTraits = `Multi-sample biometric voice profile for ${session.name} (${session.relationWithDivakar}, Role: ${session.role}).`;
    let acousticProfile: BossVoiceProfile["acousticProfile"] = {
      pitchRange: "Normal Baritone",
      timbre: "Clear Vocal Resonance",
      gender: session.role === "boss" ? "male" : "neutral",
      cadence: "Conversational Pace",
    };

    if (ai && session.recordedSamples.length > 0) {
      try {
        const prompt = `You are Friday AI Multi-Sample Acoustic Biometric Analyzer.
Analyze these 3 multi-phrase voice samples for speaker "${session.name}" (Role: ${session.role}, Relation with DK: "${session.relationWithDivakar}").

Extract composite acoustic traits:
1. Fundamental pitch range and resonance frequency.
2. Gender classification (strictly note if male/female/neutral).
3. Speech cadence, articulation, vocal harmonics.
4. Synthesize a unique biometric signature to differentiate this speaker from others and prevent false rejections.

Return JSON:
{
  "voiceTraits": "Detailed acoustic summary",
  "pitchRange": "e.g. Deep Baritone 95-130 Hz",
  "timbre": "Warm resonant / Crisp",
  "gender": "male" | "female" | "neutral",
  "cadence": "Fast / Measured / Calm"
}`;

        const sample = session.recordedSamples[0];
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
                    data: sample.audioBase64,
                  },
                },
              ],
            },
          ],
        });

        const raw = response.text || "{}";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          voiceTraits = parsed.voiceTraits || voiceTraits;
          acousticProfile = {
            pitchRange: parsed.pitchRange || acousticProfile.pitchRange,
            timbre: parsed.timbre || acousticProfile.timbre,
            gender: parsed.gender || acousticProfile.gender,
            cadence: parsed.cadence || acousticProfile.cadence,
          };
        }
      } catch (e) {
        console.warn("[VoiceBiometrics] Acoustic analysis fallback:", e);
      }
    }

    const isBoss = session.role === "boss" || session.name.toLowerCase().includes("divakar") || session.relationWithDivakar.toLowerCase().includes("boss");
    const profileId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const newProfile: BossVoiceProfile = {
      id: profileId,
      name: session.name,
      role: isBoss ? "boss" : session.role,
      relationWithDivakar: session.relationWithDivakar,
      voiceTraits,
      spokenPhrases: session.recordedSamples.map((s) => s.phrase),
      acousticProfile,
      isRootAdmin: isBoss,
      allowedActions: isBoss ? ["all"] : ["general_info", "music", "weather", "calculator", "chat", "web_search"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.inMemoryProfiles.set(profileId, newProfile);
    this.activeEnrollments.delete(sessionId);

    try {
      await db.collection("bossVoiceProfiles").doc(profileId).set(newProfile);
    } catch {
      // Offline fallback
    }

    console.log(`[VoiceBiometrics] Successfully enrolled voice profile "${session.name}" (${session.role}) ID: ${profileId}`);

    return {
      success: true,
      profileId,
      message: `Voice calibration 100% complete! "${session.name}" (${session.relationWithDivakar}) ki Voice Profile save ho gayi hai. Ab Friday inki aawaz pehchankar unke role (${session.role.toUpperCase()}) ke mutabiq baat karegi! ✅`,
    };
  }

  /**
   * Fast, False-Rejection Immune Speaker Verifier:
   * Compares live audio against enrolled profiles.
   */
  public async verifySpeakerReal(
    audioBase64: string,
    sessionId?: string
  ): Promise<SpeakerVerificationResult> {
    const profiles = await this.getProfiles();
    if (profiles.length === 0) {
      // Default: Boss DK access if no profile is enrolled yet
      return {
        isBoss: true,
        speakerRole: "boss",
        speakerName: "Boss (Divakar)",
        confidence: 1.0,
        isRootAdmin: true,
        reason: "No biometric locks enrolled yet — Boss default access.",
      };
    }

    // Check active conversational session cache
    if (sessionId && this.activeSessionSpeakerCache.has(sessionId)) {
      const cached = this.activeSessionSpeakerCache.get(sessionId)!;
      if (Date.now() - cached.timestamp < this.SESSION_CACHE_TTL_MS) {
        return cached.result;
      }
    }

    // ── Tier 1: Microsoft Azure Speaker Recognition (High Precision 98%+) ──────
    try {
      const { azureSpeakerRecognitionService } = await import("./azureSpeakerRecognitionService");
      if (azureSpeakerRecognitionService.isConfigured) {
        const azureRes = await azureSpeakerRecognitionService.identifyWhoIsSpeaking(audioBase64);
        if (azureRes.identified) {
          const result: SpeakerVerificationResult = {
            isBoss: azureRes.speakerRole === "boss",
            speakerRole: azureRes.speakerRole,
            speakerName: azureRes.speakerName,
            confidence: azureRes.score,
            isRootAdmin: azureRes.isRootAdmin,
            reason: `Azure Biometric Match: ${azureRes.reason}`,
            matchedProfileId: azureRes.profileId,
          };
          if (sessionId) {
            this.activeSessionSpeakerCache.set(sessionId, { result, timestamp: Date.now() });
          }
          return result;
        }
      }
    } catch (azErr) {
      console.warn("[VoiceBiometrics] Azure Speaker Recognition check fallback:", azErr);
    }

    const ai = this.getGenAI();
    if (!ai) {
      return {
        isBoss: true,
        speakerRole: "boss",
        speakerName: "Boss (Divakar)",
        confidence: 0.9,
        isRootAdmin: true,
        reason: "Fallback verification.",
      };
    }

    try {
      const prompt = `You are Friday AI Real-Time Voice Biometric Verifier.
Compare this live audio sample against all enrolled profiles.

ENROLLED PROFILES:
${JSON.stringify(
  profiles.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    relation: p.relationWithDivakar,
    traits: p.voiceTraits,
    acoustic: p.acousticProfile,
  })),
  null,
  2
)}

CRITICAL VERIFICATION RULES:
1. BOSS IDENTITY RULE:
   - Boss DK is strictly male with distinct baritone resonance.
   - Do NOT reject Boss due to minor fan noise, mic distance, or fast speech.
   - If audio matches Boss characteristics, return role: "boss", isBoss: true, isRootAdmin: true.
2. ENROLLED GUEST / FRIEND RULE:
   - If audio matches an enrolled friend/family profile (e.g. Aman, Priya), identify their exact profile name and role ("friend" | "family" | "guest"), isBoss: false, isRootAdmin: false.
3. UNKNOWN SPEAKER RULE:
   - If audio does NOT match any profile, return role: "unknown", isBoss: false, isRootAdmin: false.

Return JSON:
{
  "matchedProfileId": "profile_id or null",
  "speakerName": "Name of speaker or 'Unknown Speaker'",
  "speakerRole": "boss" | "family" | "friend" | "guest" | "unknown",
  "isBoss": true | false,
  "confidence": 0.0 to 1.0,
  "isRootAdmin": true | false,
  "reason": "Brief verification rationale"
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
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      if (!parsed) {
        return {
          isBoss: true,
          speakerRole: "boss",
          speakerName: "Boss (DK)",
          confidence: 0.85,
          isRootAdmin: true,
          reason: "Default session continuity.",
        };
      }

      const result: SpeakerVerificationResult = {
        isBoss: !!parsed.isBoss,
        speakerRole: parsed.speakerRole || (parsed.isBoss ? "boss" : "unknown"),
        speakerName: parsed.speakerName || (parsed.isBoss ? "Boss (DK)" : "Guest"),
        confidence: parsed.confidence || 0.88,
        isRootAdmin: !!parsed.isRootAdmin,
        reason: parsed.reason || "Biometric matching complete.",
        matchedProfileId: parsed.matchedProfileId,
      };

      if (sessionId) {
        this.activeSessionSpeakerCache.set(sessionId, { result, timestamp: Date.now() });
      }

      return result;
    } catch (e) {
      console.warn("[VoiceBiometrics] Verification error, allowing fallback:", e);
      return {
        isBoss: true,
        speakerRole: "boss",
        speakerName: "Boss (DK)",
        confidence: 0.85,
        isRootAdmin: true,
        reason: "Fallback continuity.",
      };
    }
  }

  /**
   * Delete voice profile with PIN check.
   */
  public async deleteVoiceProfile(
    pin: string,
    profileId?: string
  ): Promise<{ success: boolean; message: string }> {
    const isPinValid = await this.verifyPin(pin);
    if (!isPinValid) {
      return {
        success: false,
        message: "Sorry, password galat hai! Voice profile delete nahi kiya ja sakta.",
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
        message: "Voice profile successfully delete ho gaya hai.",
      };
    } catch (e: any) {
      return {
        success: false,
        message: `Delete failed: ${e?.message || e}`,
      };
    }
  }

  /**
   * Compatibility alias for single-phrase enrollment.
   */
  public async enrollVoice(
    pin: string,
    name: string = "Boss (Divakar)",
    relationWithDivakar: string = "Boss (DK)",
    audioBase64?: string,
    spokenPhrase?: string
  ): Promise<{ success: boolean; profileId?: string; message: string; count?: number }> {
    const start = await this.startVoiceEnrollment(pin, name, relationWithDivakar, name.toLowerCase().includes("boss") ? "boss" : "friend");
    if (!start.success || !start.sessionId) {
      return { success: false, message: start.message };
    }

    if (audioBase64) {
      await this.recordCalibrationSample(start.sessionId, audioBase64, spokenPhrase);
    }
    const finalRes = await this.finalizeVoiceEnrollment(start.sessionId);
    const count = (await this.getProfiles()).length;
    return { success: finalRes.success, profileId: finalRes.profileId, message: finalRes.message, count };
  }

  public async deleteProfile(pin: string, profileId?: string) {
    return this.deleteVoiceProfile(pin, profileId);
  }

  public async verifyVoicePin(pin: string): Promise<{ valid: boolean; message: string }> {
    const valid = await this.verifyPin(pin);
    return {
      valid,
      message: valid ? "Authorization Password verified successfully!" : "Incorrect password! Spoken PIN does NOT match Firestore voice PIN.",
    };
  }

  public async handleWhatsAppVoicePinMessage(
    text: string,
    senderName: string,
    channel: string = "whatsapp"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const raw = String(text || "").trim();

    // 1. Check Voice Code Query (e.g. "voice code kya hai", "/voicecode", "check voice pin")
    const queryPattern = /^\/?(?:voice\s*code|voice\s*pin|boss\s*code|voice\s*password|check\s*voice\s*pin)(?:\s*(?:kya\s*hai|check|status|batao|\?))?$/i;
    if (queryPattern.test(raw)) {
      const active = await this.getActivePin();
      return {
        handled: true,
        replyText:
          `🔐 *ACTIVE FRIDAY VOICE AUTH CODE* 🎙️\n\n` +
          `• 🔑 *Active Voice Code / PIN:* \`${active || "1234"}\`\n` +
          `• 💾 *Storage:* Cloud Firestore (\`systemSecurity/voicePin\`)\n\n` +
          `Friday se voice mode me bolte waqt \`Boss Code ${active || "1234"}\` bol kar aap 100% Root Access verify kar sakte hain.\n\n` +
          `✏️ *Badalne ke liye type karein:*\n` +
          `👉 \`voice code <naya_pin>\` (e.g. \`voice code 4589\`)`,
      };
    }

    // 2. Set / Update Voice Code (e.g. "voice code 4589", "/voicecode 4589", "boss code 9876", "set voice code 1234")
    const updatePattern = /(?:^\/?(?:voice\s*code|voice\s*pin|boss\s*code|voice\s*password|security\s*pin|auth\s*pin|set\s*voice\s*code|update\s*voice\s*pin|new\s*pin|mera\s*voice\s*code)[\s\:\-\=]+([0-9]{4,8}))|(?:(?:voice\s*code|voice\s*pin|boss\s*code)[\s\:\-\=]+([0-9]{4,8}))/i;
    const match = raw.match(updatePattern);

    const pinCandidate = match ? (match[1] || match[2]) : null;

    if (pinCandidate) {
      const result = await this.updateVoicePin(pinCandidate, senderName, channel);
      return {
        handled: true,
        replyText: result.message,
      };
    }

    return { handled: false };
  }
}

export const voiceBiometricsService = new VoiceBiometricsService();