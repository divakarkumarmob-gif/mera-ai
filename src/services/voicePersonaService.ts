import { db } from "./firebaseAdmin";

export interface VoicePersona {
  id: string;
  name: string;
  voiceStyle: string;
  tagline: string;
  systemInstructionAddendum: string;
}

export const PERSONAS: Record<string, VoicePersona> = {
  friday_classic: {
    id: "friday_classic",
    name: "Friday Classic",
    voiceStyle: "Kore / Aoede (Warm, loyal, fast-thinking)",
    tagline: "Your loyal, witty, Iron Man AI companion.",
    systemInstructionAddendum:
      "PERSONA: Friday Classic. Speak in a warm, witty, energetic mix of Hindi and English (Hinglish). Address user as 'Boss'. Fast, direct, loyal, and proactive.",
  },
  jarvis_british: {
    id: "jarvis_british",
    name: "J.A.R.V.I.S.",
    voiceStyle: "Fenrir / Charon (Deep, polite, refined British tone)",
    tagline: "Always at your service, sir.",
    systemInstructionAddendum:
      "PERSONA: J.A.R.V.I.S. Speak with refined British politeness, absolute composure, and subtle dry wit. Address user as 'Sir' or 'Boss'. Provide calculated, elegant solutions.",
  },
  cyberpunk_ai: {
    id: "cyberpunk_ai",
    name: "Cyberpunk Netrunner",
    voiceStyle: "Puck / Kore (Tactical, edgy, futuristic)",
    tagline: "Systems primed. Grid online, Choom.",
    systemInstructionAddendum:
      "PERSONA: Cyberpunk Netrunner AI. Speak with futuristic tactical sharpness, tech jargon, and edge. Refer to tasks as protocols and missions. Fast, precise, no-nonsense.",
  },
  professor_mentor: {
    id: "professor_mentor",
    name: "Professor AI",
    voiceStyle: "Charon / Fenrir (Deep, articulate, academic)",
    tagline: "Knowledge is the ultimate defense.",
    systemInstructionAddendum:
      "PERSONA: Professor AI. Act as an elite computer science & cybersecurity professor. Explain complex concepts in structured, easy-to-understand 3-4 steps with real-world examples in Hinglish.",
  },
  motivational_coach: {
    id: "motivational_coach",
    name: "Iron Coach",
    voiceStyle: "Fenrir / Puck (High-energy, relentless, inspiring)",
    tagline: "Discipline equals freedom. Let's conquer today!",
    systemInstructionAddendum:
      "PERSONA: Iron Coach. High energy, relentless discipline, zero excuses. Push the user to execute their goals, maintain focus, and dominate their daily schedule.",
  },
};

// Firestore document path for voice preferences
const VOICE_PREFS_DOC = "friday_settings/voice_preferences";

class VoicePersonaService {
  private activePersonaId = "friday_classic";
  private activeVoiceName = "Aoede";  // Gemini voice name — persisted in Firebase

  // ── Firebase: Save voice name persistently ─────────────────────────────
  async saveVoiceName(voiceName: string): Promise<void> {
    this.activeVoiceName = voiceName;
    try {
      if (!db) return;
      await db.doc(VOICE_PREFS_DOC).set(
        { voiceName, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      console.log(`[VoicePersona] ✅ Voice "${voiceName}" saved to Firebase`);
    } catch (e) {
      console.warn("[VoicePersona] Firebase save failed (non-critical):", e);
    }
  }

  // ── Firebase: Load saved voice name on server start ────────────────────
  async loadSavedVoiceName(): Promise<string> {
    try {
      if (!db) return this.activeVoiceName;
      const snap = await db.doc(VOICE_PREFS_DOC).get();
      if (snap.exists) {
        const data = snap.data();
        if (data?.voiceName) {
          this.activeVoiceName = data.voiceName;
          console.log(`[VoicePersona] ✅ Loaded saved voice: "${this.activeVoiceName}"`);
          return this.activeVoiceName;
        }
      }
    } catch (e) {
      console.warn("[VoicePersona] Firebase load failed (non-critical):", e);
    }
    return this.activeVoiceName;
  }

  // ── Get current active voice name ─────────────────────────────────────
  getActiveVoiceName(): string {
    return this.activeVoiceName;
  }

  // ── REST: Update voice (called from dispatcher) ────────────────────────
  async setVoice(voiceName: string): Promise<{ success: boolean; voiceName: string; message: string }> {
    await this.saveVoiceName(voiceName);
    return {
      success: true,
      voiceName,
      message: `Voice "${voiceName}" save ho gayi Firebase mein! Device change karo — same awaaz rahegi.`,
    };
  }

  // ── REST: Get saved preferences (for API endpoint) ─────────────────────
  async getSavedPreferences(): Promise<{ voiceName: string; updatedAt?: string }> {
    try {
      if (!db) return { voiceName: this.activeVoiceName };
      const snap = await db.doc(VOICE_PREFS_DOC).get();
      if (snap.exists) return snap.data() as any;
    } catch {}
    return { voiceName: this.activeVoiceName };
  }

  public getActivePersona(): VoicePersona {
    return PERSONAS[this.activePersonaId] || PERSONAS.friday_classic;
  }

  public getAllPersonas(): VoicePersona[] {
    return Object.values(PERSONAS);
  }

  public switchPersona(personaIdOrName: string): { success: boolean; activePersona: VoicePersona; message: string } {
    const raw = (personaIdOrName || "").toLowerCase().trim();
    let matchedId = "friday_classic";

    if (raw.includes("jarvis") || raw.includes("british")) matchedId = "jarvis_british";
    else if (raw.includes("cyberpunk") || raw.includes("hacker")) matchedId = "cyberpunk_ai";
    else if (raw.includes("professor") || raw.includes("mentor") || raw.includes("teacher")) matchedId = "professor_mentor";
    else if (raw.includes("coach") || raw.includes("motivation") || raw.includes("gym")) matchedId = "motivational_coach";
    else matchedId = "friday_classic";

    this.activePersonaId = matchedId;
    const persona = PERSONAS[matchedId];

    return {
      success: true,
      activePersona: persona,
      message: `Boss, persona switch ho gaya: **${persona.name}** active hai! ("${persona.tagline}")`,
    };
  }
}

export const voicePersonaService = new VoicePersonaService();
