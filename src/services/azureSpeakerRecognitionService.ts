/**
 * FRIDAY AI — Azure Cognitive Services Speaker Recognition / Biometrics Service
 * Real-time Voice Fingerprinting & Speaker Identification (Render Compatible — Pure Node/JS)
 *
 * Capabilities:
 *  - Text-Independent Speaker Verification (1:1 biometric matching)
 *  - Text-Independent Speaker Identification (1:N who is speaking detection)
 *  - Native 16-bit PCM 16kHz to WAV binary converter (No FFmpeg/external binary required)
 *  - Profile enrollment, status tracking, and deletion
 *  - Seamless Cloud Firestore biometrics link
 */

import { db } from "./firebaseAdmin";

export interface AzureSpeakerProfile {
  profileId: string;
  name: string;
  role: "boss" | "family" | "friend" | "guest";
  relationWithDivakar: string;
  enrollmentStatus: "Enrolling" | "Enrolled";
  remainingEnrollmentSpeechTime: number;
  totalSpeechTime: number;
  locale: string;
  createdAt: number;
  updatedAt: number;
}

export interface AzureVerificationResult {
  identified: boolean;
  speakerRole: "boss" | "family" | "friend" | "guest" | "unknown";
  speakerName: string;
  confidence: "High" | "Medium" | "Low" | "None";
  score: number; // 0.0 to 1.0
  reason: string;
  profileId?: string;
  isRootAdmin: boolean;
}

class AzureSpeakerRecognitionService {
  private key: string = "";
  private region: string = "eastus";
  private customEndpoint: string = "";

  constructor() {
    this.reloadConfig();
  }

  public reloadConfig(): void {
    this.key = (
      process.env.AZURE_SPEECH_KEY ||
      process.env.AZURE_SPEAKER_RECOGNITION_KEY ||
      process.env.AZURE_COGNITIVE_KEY ||
      ""
    ).trim();
    this.region = (process.env.AZURE_SPEECH_REGION || "eastus").trim();
    this.customEndpoint = (process.env.AZURE_SPEECH_ENDPOINT || "").trim();
  }

  public get isConfigured(): boolean {
    this.reloadConfig();
    return Boolean(this.key && this.key.length >= 20);
  }

  private getBaseUrl(): string {
    if (this.customEndpoint) {
      return this.customEndpoint.replace(/\/+$/, "");
    }
    return `https://${this.region}.api.cognitive.microsoft.com`;
  }

  /**
   * Helper: Encodes raw 16-bit linear PCM (mono, 16000 Hz) to a valid RIFF/WAV Buffer
   */
  public encodePcmToWav(pcmBuffer: Buffer, sampleRate: number = 16000, numChannels: number = 1): Buffer {
    // If it already has a WAV header (starts with "RIFF"), return as is
    if (pcmBuffer.length > 12 && pcmBuffer.toString("ascii", 0, 4) === "RIFF") {
      return pcmBuffer;
    }

    const byteRate = sampleRate * numChannels * 2; // 16-bit = 2 bytes
    const blockAlign = numChannels * 2;
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);

    // RIFF identifier
    header.write("RIFF", 0);
    // File size - 8
    header.writeUInt32LE(dataSize + 36, 4);
    // RIFF type
    header.write("WAVE", 8);
    // Format chunk identifier
    header.write("fmt ", 12);
    // Format chunk length
    header.writeUInt32LE(16, 16);
    // Sample format (1 = PCM)
    header.writeUInt16LE(1, 20);
    // Channel count
    header.writeUInt16LE(numChannels, 22);
    // Sample rate
    header.writeUInt32LE(sampleRate, 24);
    // Byte rate
    header.writeUInt32LE(byteRate, 28);
    // Block align
    header.writeUInt16LE(blockAlign, 32);
    // Bits per sample
    header.writeUInt16LE(16, 34);
    // Data chunk identifier
    header.write("data", 36);
    // Data chunk length
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  /**
   * Parse input audio (Base64 string or Buffer) into proper WAV Buffer
   */
  private toWavBuffer(input: Buffer | string): Buffer {
    let pcmOrWav: Buffer;
    if (typeof input === "string") {
      // Clean base64 data URI if present
      const cleanBase64 = input.replace(/^data:audio\/[^;]+;base64,/, "").trim();
      pcmOrWav = Buffer.from(cleanBase64, "base64");
    } else {
      pcmOrWav = input;
    }
    return this.encodePcmToWav(pcmOrWav);
  }

  /**
   * 1. Create a Text-Independent Speaker Profile on Azure
   */
  public async createProfile(
    name: string,
    role: "boss" | "family" | "friend" | "guest" = "friend",
    relationWithDivakar: string = "Friend",
    locale: string = "en-US"
  ): Promise<{ success: boolean; profile?: AzureSpeakerProfile; message: string }> {
    if (!this.isConfigured) {
      return {
        success: false,
        message: "Azure Speech Key not configured. Set AZURE_SPEECH_KEY in Render environment variables.",
      };
    }

    const url = `${this.getBaseUrl()}/speaker/verification/v2.0/text-independent/profiles`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, message: `Azure Profile Creation failed (${res.status}): ${errText}` };
      }

      const data = await res.json();
      const profileId = data.profileId;

      const profile: AzureSpeakerProfile = {
        profileId,
        name,
        role: role || (name.toLowerCase().includes("boss") || name.toLowerCase().includes("divakar") ? "boss" : "friend"),
        relationWithDivakar,
        enrollmentStatus: "Enrolling",
        remainingEnrollmentSpeechTime: 20.0,
        totalSpeechTime: 0,
        locale,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Save to Cloud Firestore
      try {
        if (db) {
          await db.collection("azureSpeakerProfiles").doc(profileId).set(profile);
        }
      } catch (e) {
        console.warn("[AzureSpeaker] Firestore save fallback:", e);
      }

      return {
        success: true,
        profile,
        message: `Azure Speaker Profile created for "${name}" (ID: ${profileId})! Now record voice samples to complete enrollment.`,
      };
    } catch (e: any) {
      return { success: false, message: `Azure network error: ${e?.message || e}` };
    }
  }

  /**
   * 2. Enroll Audio Sample to a Speaker Profile (Needs total ~20 secs of speech)
   */
  public async enrollAudio(
    profileId: string,
    audioInput: Buffer | string
  ): Promise<{
    success: boolean;
    enrollmentStatus?: string;
    remainingEnrollmentSpeechTime?: number;
    totalSpeechTime?: number;
    message: string;
  }> {
    if (!this.isConfigured) {
      return { success: false, message: "Azure Speech Key not configured." };
    }

    const wavBuffer = this.toWavBuffer(audioInput);
    const url = `${this.getBaseUrl()}/speaker/verification/v2.0/text-independent/profiles/${profileId}/enrollments?ignoreMinOperationDelay=true`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        },
        body: wavBuffer as any,
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, message: `Azure Enrollment failed (${res.status}): ${errText}` };
      }

      const data = await res.json();
      const status = data.enrollmentStatus || "Enrolling";
      const remainingTime = data.remainingEnrollmentSpeechTime ?? 0;
      const totalTime = data.totalSpeechTime ?? 0;

      // Update Firestore
      try {
        if (db) {
          await db.collection("azureSpeakerProfiles").doc(profileId).update({
            enrollmentStatus: status,
            remainingEnrollmentSpeechTime: remainingTime,
            totalSpeechTime: totalTime,
            updatedAt: Date.now(),
          });
        }
      } catch {}

      const isEnrolled = status === "Enrolled";
      return {
        success: true,
        enrollmentStatus: status,
        remainingEnrollmentSpeechTime: remainingTime,
        totalSpeechTime: totalTime,
        message: isEnrolled
          ? `🎉 Voice enrollment 100% complete! Profile is fully trained on Azure.`
          : `Audio sample registered! Need ~${Math.ceil(remainingTime)}s more speech to complete enrollment.`,
      };
    } catch (e: any) {
      return { success: false, message: `Azure enrollment error: ${e?.message || e}` };
    }
  }

  /**
   * 3. Verify Live Audio against a Specific Profile (1:1 Matching)
   */
  public async verifySpeaker(
    profileId: string,
    audioInput: Buffer | string
  ): Promise<AzureVerificationResult> {
    if (!this.isConfigured) {
      return {
        identified: false,
        speakerRole: "unknown",
        speakerName: "Unknown",
        confidence: "None",
        score: 0,
        reason: "Azure Speech Key not configured.",
        isRootAdmin: false,
      };
    }

    const wavBuffer = this.toWavBuffer(audioInput);
    const url = `${this.getBaseUrl()}/speaker/verification/v2.0/text-independent/profiles/${profileId}/verify`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        },
        body: wavBuffer as any,
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          identified: false,
          speakerRole: "unknown",
          speakerName: "Unknown",
          confidence: "None",
          score: 0,
          reason: `Verification call failed (${res.status}): ${errText}`,
          isRootAdmin: false,
        };
      }

      const data = await res.json();
      const result = data.recognitionResult; // "Accept" or "Reject"
      const score = Number(data.score ?? 0);
      const isAccepted = result === "Accept";

      // Fetch profile details
      let profileName = "Enrolled Speaker";
      let role: "boss" | "family" | "friend" | "guest" = "friend";
      try {
        if (db) {
          const snap = await db.collection("azureSpeakerProfiles").doc(profileId).get();
          if (snap.exists) {
            const p = snap.data() as AzureSpeakerProfile;
            profileName = p.name;
            role = p.role;
          }
        }
      } catch {}

      const isBoss = role === "boss" || profileName.toLowerCase().includes("divakar") || profileName.toLowerCase().includes("boss");
      const confidence: AzureVerificationResult["confidence"] =
        score >= 0.85 ? "High" : score >= 0.7 ? "Medium" : score >= 0.5 ? "Low" : "None";

      return {
        identified: isAccepted,
        speakerRole: isAccepted ? (isBoss ? "boss" : role) : "unknown",
        speakerName: isAccepted ? profileName : "Unknown Speaker",
        confidence,
        score,
        profileId,
        isRootAdmin: isAccepted && isBoss,
        reason: isAccepted
          ? `Biometric Match Verified with ${confidence} confidence (Score: ${(score * 100).toFixed(1)}%).`
          : `Voice does not match profile (${result}, Score: ${(score * 100).toFixed(1)}%).`,
      };
    } catch (e: any) {
      return {
        identified: false,
        speakerRole: "unknown",
        speakerName: "Unknown",
        confidence: "None",
        score: 0,
        reason: `Azure verification exception: ${e?.message || e}`,
        isRootAdmin: false,
      };
    }
  }

  /**
   * 4. Identify Who is Speaking Among Multiple Enrolled Profiles (1:N Matching)
   */
  public async identifyWhoIsSpeaking(
    audioInput: Buffer | string
  ): Promise<AzureVerificationResult> {
    if (!this.isConfigured) {
      return {
        identified: false,
        speakerRole: "unknown",
        speakerName: "Unknown",
        confidence: "None",
        score: 0,
        reason: "Azure Speech Key not configured.",
        isRootAdmin: false,
      };
    }

    // Fetch all enrolled profile IDs from Firestore
    let profiles: AzureSpeakerProfile[] = [];
    try {
      if (db) {
        const snap = await db.collection("azureSpeakerProfiles").where("enrollmentStatus", "==", "Enrolled").get();
        profiles = snap.docs.map((d) => d.data() as AzureSpeakerProfile);
      }
    } catch {}

    if (profiles.length === 0) {
      return {
        identified: false,
        speakerRole: "unknown",
        speakerName: "Unknown",
        confidence: "None",
        score: 0,
        reason: "No fully enrolled Azure speaker profiles found in system.",
        isRootAdmin: false,
      };
    }

    const profileIds = profiles.map((p) => p.profileId).join(",");
    const wavBuffer = this.toWavBuffer(audioInput);
    const url = `${this.getBaseUrl()}/speaker/identification/v2.0/text-independent/profiles/identifySingleSpeaker?profileIds=${encodeURIComponent(profileIds)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        },
        body: wavBuffer as any,
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          identified: false,
          speakerRole: "unknown",
          speakerName: "Unknown",
          confidence: "None",
          score: 0,
          reason: `Azure Identification error (${res.status}): ${errText}`,
          isRootAdmin: false,
        };
      }

      const data = await res.json();
      const matchedProfileId = data.identifiedProfileId;
      const score = Number(data.score ?? 0);

      if (!matchedProfileId || matchedProfileId === "00000000-0000-0000-0000-000000000000") {
        return {
          identified: false,
          speakerRole: "unknown",
          speakerName: "Unrecognized Speaker",
          confidence: "None",
          score,
          reason: "Voice did not match any enrolled speaker profile.",
          isRootAdmin: false,
        };
      }

      const matchedProfile = profiles.find((p) => p.profileId === matchedProfileId);
      const profileName = matchedProfile?.name || "Enrolled Speaker";
      const role = matchedProfile?.role || "friend";
      const isBoss = role === "boss" || profileName.toLowerCase().includes("divakar") || profileName.toLowerCase().includes("boss");
      const confidence = (data.confidence as any) || (score >= 0.85 ? "High" : score >= 0.7 ? "Medium" : "Low");

      return {
        identified: true,
        speakerRole: isBoss ? "boss" : role,
        speakerName: profileName,
        confidence,
        score,
        profileId: matchedProfileId,
        isRootAdmin: isBoss,
        reason: `Successfully identified as "${profileName}" (${role.toUpperCase()}) with ${confidence} confidence (Score: ${(score * 100).toFixed(1)}%).`,
      };
    } catch (e: any) {
      return {
        identified: false,
        speakerRole: "unknown",
        speakerName: "Unknown",
        confidence: "None",
        score: 0,
        reason: `Azure Identification exception: ${e?.message || e}`,
        isRootAdmin: false,
      };
    }
  }

  /**
   * 5. Delete an Azure Speaker Profile
   */
  public async deleteProfile(profileId: string): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      return { success: false, message: "Azure Speech Key not configured." };
    }

    const url = `${this.getBaseUrl()}/speaker/verification/v2.0/text-independent/profiles/${profileId}`;
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
        },
      });

      // Remove from Firestore
      try {
        if (db) {
          await db.collection("azureSpeakerProfiles").doc(profileId).delete();
        }
      } catch {}

      return {
        success: res.ok || res.status === 404,
        message: `Azure Speaker Profile ${profileId} deleted successfully.`,
      };
    } catch (e: any) {
      return { success: false, message: `Azure delete error: ${e?.message || e}` };
    }
  }

  /**
   * Get all registered profiles from Firestore
   */
  public async getAllProfiles(): Promise<AzureSpeakerProfile[]> {
    try {
      if (!db) return [];
      const snap = await db.collection("azureSpeakerProfiles").orderBy("createdAt", "desc").get();
      return snap.docs.map((d) => d.data() as AzureSpeakerProfile);
    } catch {
      return [];
    }
  }

  /**
   * Status of Azure Speaker Recognition Service
   */
  public getStatus() {
    this.reloadConfig();
    return {
      configured: this.isConfigured,
      region: this.region,
      hasKey: Boolean(this.key),
      keyLength: this.key ? this.key.length : 0,
      endpoint: this.getBaseUrl(),
      description: "Microsoft Azure Cognitive Services Speaker Recognition (Text-Independent Verification & Identification)",
      features: [
        "1:1 Speaker Verification (Boss vs Imposter)",
        "1:N Who is Speaking Identification (Boss vs Friend vs Girlfriend)",
        "Pure JS 16-bit PCM to WAV encoding (Zero FFmpeg / Zero system binaries)",
        "Cloud Firestore profile synchronization",
      ],
      setupGuide: !this.isConfigured
        ? "To activate real Azure Speaker Recognition, create a free Azure Speech Service resource (5,000 free calls/month) and set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in Render environment variables."
        : "✅ Azure Speaker Recognition is configured and active.",
    };
  }
}

export const azureSpeakerRecognitionService = new AzureSpeakerRecognitionService();
