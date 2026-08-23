import { GoogleGenAI } from "@google/genai";
import { db, FieldValue } from "./firebaseAdmin";

export interface SessionMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: number;
}

export interface PersonalVaultEntry {
  id: string;
  category: string;
  exactFact: string;
  date: string;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  startTime: number;
  endTime?: number;
  dateStr: string;
  messages: SessionMessage[];
  summary?: string;
  pinnedFacts?: string[];
  mistakesOrInsights?: string[];
}

const DEFAULT_VAULT_ENTRY: PersonalVaultEntry = {
  id: "boss_identity_core",
  category: "boss_identity",
  exactFact: "DK is my creator, absolute master, and Boss. I am Friday, his dedicated, loyal personal AI companion.",
  date: "Core Identity",
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Firestore layout:
//   memory/personalVault/entries/{id}
//   memory/pinnedMemories/entries/{id}
//   memory/profile/data              (single doc: { profileFacts: [], knownMistakes: [] })
//   memory/sessions/entries/{sessionId}
// ---------------------------------------------------------------------------

const vaultCol = () => db.collection("memory").doc("personalVault").collection("entries");
const pinnedCol = () => db.collection("memory").doc("pinnedMemories").collection("entries");
const profileDoc = () => db.collection("memory").doc("profile");
const sessionsCol = () => db.collection("memory").doc("sessions").collection("entries");

class MemoryEngine {
  private activeSessions: Map<string, ConversationSession> = new Map();
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.ensureDefaultVaultEntry();
  }

  private async ensureDefaultVaultEntry() {
    try {
      const snap = await vaultCol().doc(DEFAULT_VAULT_ENTRY.id).get();
      if (!snap.exists) {
        await vaultCol().doc(DEFAULT_VAULT_ENTRY.id).set(DEFAULT_VAULT_ENTRY);
      }
    } catch (e) {
      console.error("[MemoryEngine] Failed to seed default vault entry in Firestore:", e);
    }
  }

  public startSession(sessionId: string): ConversationSession {
    const now = Date.now();
    const session: ConversationSession = {
      id: sessionId,
      startTime: now,
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      messages: [],
    };
    this.activeSessions.set(sessionId, session);
    return session;
  }

  public recordMessage(sessionId: string, sender: "user" | "ai", text: string) {
    if (!text || !text.trim()) return;
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      session = this.startSession(sessionId);
    }
    session.messages.push({
      sender,
      text: text.trim(),
      timestamp: Date.now(),
    });
  }

  public async finalizeSession(sessionId: string, ai?: GoogleGenAI) {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.messages.length === 0) {
      this.activeSessions.delete(sessionId);
      return;
    }

    session.endTime = Date.now();
    this.activeSessions.delete(sessionId);

    try {
      await sessionsCol().doc(session.id).set(session);
      await this.trimOldSessions();
    } catch (e) {
      console.error("[MemoryEngine] Failed to persist session to Firestore:", e);
    }

    // Auto Summarize & Extract Memories in Background if AI client provided
    if (ai && session.messages.length >= 2) {
      this.autoSummarizeSession(session, ai).catch((err) => {
        console.error(`[MemoryEngine] Summarization failed for session ${sessionId}:`, err);
      });
    }
  }

  /** Keep only the most recent 50 sessions, like the old local-file behavior. */
  private async trimOldSessions() {
    try {
      const snapshot = await sessionsCol().orderBy("startTime", "desc").get();
      if (snapshot.size <= 50) return;
      const toDelete = snapshot.docs.slice(50);
      const batch = db.batch();
      toDelete.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.error("[MemoryEngine] Failed to trim old sessions:", e);
    }
  }

  private async autoSummarizeSession(session: ConversationSession, ai: GoogleGenAI) {
    try {
      const transcript = session.messages
        .map((m) => `${m.sender === "user" ? "DK" : "Friday"}: ${m.text}`)
        .join("\n");

      const prompt = `You are Friday AI's memory engine. Analyze this conversation between user DK and Friday.
Extract long-term insights and return ONLY a valid JSON object matching this schema:
{
  "summary": "Brief 2-3 sentence summary of what was discussed.",
  "exactPersonalFacts": [
    {
      "category": "boss_identity | family_members | personal_secrets_and_facts | career_and_business | residence_and_lifestyle",
      "exactFact": "LITERAL, EXACT, UNALTERED personal fact directly as stated by DK. (e.g., family members, count, names, relationships, personal status, secrets). DO NOT SUMMARIZE OR PARAPHRASE."
    }
  ],
  "pinnedMemories": ["Array of explicit facts DK asked to remember, e.g., 'yeh yaad rakhna', 'yaad rakho', 'don't forget this'"],
  "mistakes": ["Array of mistakes, misconceptions, or errors DK made during discussion"],
  "profileFacts": ["General preferences, tech stack, or habits"]
}

Conversation:
${transcript}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);

      // Update the session doc with summary + pinned/mistakes extracted from it
      await sessionsCol().doc(session.id).set(
        {
          summary: parsed.summary || "",
          pinnedFacts: Array.isArray(parsed.pinnedMemories) ? parsed.pinnedMemories : [],
          mistakesOrInsights: Array.isArray(parsed.mistakes) ? parsed.mistakes : [],
        },
        { merge: true }
      );

      // Add to exact Personal Vault (NEVER SUMMARIZED) — dedup by exact text
      if (Array.isArray(parsed.exactPersonalFacts)) {
        const existingVault = await vaultCol().get();
        const existingFacts = new Set(existingVault.docs.map((d) => (d.data().exactFact || "").toLowerCase()));

        for (const item of parsed.exactPersonalFacts) {
          if (item?.exactFact && !existingFacts.has(item.exactFact.toLowerCase())) {
            const id = Math.random().toString(36).substring(2, 9);
            await vaultCol()
              .doc(id)
              .set({
                id,
                category: item.category || "personal_secrets_and_facts",
                exactFact: item.exactFact.trim(),
                date: session.dateStr,
                timestamp: session.startTime,
              });
            existingFacts.add(item.exactFact.toLowerCase());
          }
        }
      }

      // Add to global pinned memories — dedup by exact text
      if (Array.isArray(parsed.pinnedMemories) && parsed.pinnedMemories.length > 0) {
        const existingPinned = await pinnedCol().get();
        const existingPinnedFacts = new Set(existingPinned.docs.map((d) => (d.data().fact || "").toLowerCase()));

        for (const fact of parsed.pinnedMemories) {
          if (fact && !existingPinnedFacts.has(fact.toLowerCase())) {
            const id = Math.random().toString(36).substring(2, 9);
            await pinnedCol().doc(id).set({
              id,
              fact,
              date: session.dateStr,
              timestamp: session.startTime,
            });
            existingPinnedFacts.add(fact.toLowerCase());
          }
        }
      }

      // Add to DK profile facts / known mistakes (single doc, arrayUnion avoids dupes)
      const profileUpdates: Record<string, any> = {};
      if (Array.isArray(parsed.profileFacts) && parsed.profileFacts.length > 0) {
        profileUpdates.profileFacts = FieldValue.arrayUnion(...parsed.profileFacts);
      }
      if (Array.isArray(parsed.mistakes) && parsed.mistakes.length > 0) {
        profileUpdates.knownMistakes = FieldValue.arrayUnion(...parsed.mistakes);
      }
      if (Object.keys(profileUpdates).length > 0) {
        await profileDoc().set(profileUpdates, { merge: true });
      }

      console.log(`[MemoryEngine] Successfully processed session ${session.id}: "${parsed.summary}"`);
    } catch (e) {
      console.error("[MemoryEngine] Auto-summarization error:", e);
    }
  }

  public async addPersonalVaultFact(category: string, exactFact: string) {
    if (!exactFact || !exactFact.trim()) return;
    const now = Date.now();
    const id = Math.random().toString(36).substring(2, 9);
    try {
      await vaultCol().doc(id).set({
        id,
        category: category || "personal_secrets_and_facts",
        exactFact: exactFact.trim(),
        date: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        timestamp: now,
      });
    } catch (e) {
      console.error("[MemoryEngine] Failed to add personal vault fact:", e);
    }
  }

  public async addPinnedMemory(fact: string) {
    if (!fact || !fact.trim()) return;
    const now = Date.now();
    const id = Math.random().toString(36).substring(2, 9);
    try {
      await pinnedCol().doc(id).set({
        id,
        fact: fact.trim(),
        date: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        timestamp: now,
      });
    } catch (e) {
      console.error("[MemoryEngine] Failed to add pinned memory:", e);
    }
  }

  public async getMemories() {
    try {
      const [vaultSnap, pinnedSnap, profileSnap, sessionsSnap] = await Promise.all([
        vaultCol().get(),
        pinnedCol().orderBy("timestamp", "asc").get(),
        profileDoc().get(),
        sessionsCol().orderBy("startTime", "desc").limit(10).get(),
      ]);

      const profileData = profileSnap.exists ? profileSnap.data()! : { profileFacts: [], knownMistakes: [] };

      return {
        personalVault: vaultSnap.docs.map((d) => d.data() as PersonalVaultEntry),
        pinnedMemories: pinnedSnap.docs.map((d) => d.data()),
        profileFacts: profileData.profileFacts || [],
        knownMistakes: profileData.knownMistakes || [],
        pastSessionsCount: sessionsSnap.size,
        recentSessions: sessionsSnap.docs.map((d) => d.data()).reverse(),
      };
    } catch (e) {
      console.error("[MemoryEngine] Failed to fetch memories from Firestore:", e);
      return {
        personalVault: [],
        pinnedMemories: [],
        profileFacts: [],
        knownMistakes: [],
        pastSessionsCount: 0,
        recentSessions: [],
      };
    }
  }

  public async clearAll() {
    try {
      await Promise.all([
        this.deleteAllInCollection(vaultCol()),
        this.deleteAllInCollection(pinnedCol()),
        this.deleteAllInCollection(sessionsCol()),
        profileDoc().set({ profileFacts: [], knownMistakes: [] }),
      ]);
      await this.ensureDefaultVaultEntry();
    } catch (e) {
      console.error("[MemoryEngine] Failed to clear memory in Firestore:", e);
    }
  }

  private async deleteAllInCollection(col: FirebaseFirestore.CollectionReference) {
    const snapshot = await col.limit(500).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snapshot.size === 500) {
      await this.deleteAllInCollection(col);
    }
  }

  /**
   * Compiles the full persistent memory context to inject into Friday's system prompt.
   * Priority 1: Exact Personal Vault (Family, Boss identity, Private Facts)
   * Priority 2: Pinned Memories ("Yeh yaad rakhna")
   * Priority 3: DK Profile & Past Mistakes
   * Priority 4: Historical Sessions Timeline
   * Priority 5: Exact Verbatim Transcripts of LAST 5 CONVERSATIONS
   */
  public async compileMemoryPrompt(): Promise<string> {
    await this.initPromise;
    const sections: string[] = [];

    try {
      const [vaultSnap, pinnedSnap, profileSnap, allSessionsSnap] = await Promise.all([
        vaultCol().get(),
        pinnedCol().orderBy("timestamp", "asc").get(),
        profileDoc().get(),
        sessionsCol().orderBy("startTime", "asc").get(),
      ]);

      const personalVault = vaultSnap.docs.map((d) => d.data() as PersonalVaultEntry);
      const pinnedMemories = pinnedSnap.docs.map((d) => d.data() as { fact: string; date: string });
      const profileData = profileSnap.exists ? profileSnap.data()! : { profileFacts: [], knownMistakes: [] };
      const sessions = allSessionsSnap.docs.map((d) => d.data() as ConversationSession);

      // 1. EXACT PERSONAL VAULT (CRITICAL - NEVER SUMMARIZED)
      if (personalVault.length > 0) {
        const vaultList = personalVault
          .map((p, i) => `${i + 1}. [Category: ${p.category} | Added: ${p.date}]: "${p.exactFact}"`)
          .join("\n");
        sections.push(`### 🔒 DK'S CORE PERSONAL INFORMATION & FAMILY VAULT (EXACT LITERAL TRUTHS - NEVER SUMMARIZED):\n${vaultList}`);
      }

      // 2. Explicit Pinned Memories
      if (pinnedMemories.length > 0) {
        const pinnedList = pinnedMemories
          .slice(-20)
          .map((p, i) => `${i + 1}. [Saved on ${p.date}]: "${p.fact}"`)
          .join("\n");
        sections.push(`### 📌 IMPORTANT FACTS DK SPECIFICALLY ASKED YOU TO REMEMBER ("YEH YAAD RAKHNA"):\n${pinnedList}`);
      }

      // 3. DK Profile Facts & Known Mistakes
      const profileFacts: string[] = profileData.profileFacts || [];
      const knownMistakes: string[] = profileData.knownMistakes || [];
      if (profileFacts.length > 0 || knownMistakes.length > 0) {
        let profileText = "";
        if (profileFacts.length > 0) {
          profileText += `General Facts & Preferences about DK:\n- ${profileFacts.slice(-15).join("\n- ")}\n`;
        }
        if (knownMistakes.length > 0) {
          profileText += `Past Mistakes/Weaknesses DK made previously (for you to help correct):\n- ${knownMistakes.slice(-15).join("\n- ")}`;
        }
        sections.push(`### 🎯 DK'S PROFILE & LEARNING CONTEXT:\n${profileText.trim()}`);
      }

      // 4. Past Sessions Timeline (Earlier than last 5)
      const olderSessions = sessions.slice(0, -5).filter((s) => s.summary);
      if (olderSessions.length > 0) {
        const timeline = olderSessions
          .slice(-10)
          .map((s) => `- [${s.dateStr}]: ${s.summary}`)
          .join("\n");
        sections.push(`### HISTORICAL SESSIONS TIMELINE (PAST DAYS):\n${timeline}`);
      }

      // 5. EXACT TRANSCRIPTS OF LAST 5 CONVERSATIONS
      const last5Sessions = sessions.slice(-5);
      if (last5Sessions.length > 0) {
        const transcriptBlocks = last5Sessions.map((s, idx) => {
          const dialog = (s.messages || [])
            .slice(-12)
            .map((m) => `${m.sender === "user" ? "DK" : "Friday"}: ${m.text}`)
            .join("\n");
          return `--- Conversation #${idx + 1} (${s.dateStr}) ---${s.summary ? `\nSummary: ${s.summary}` : ""}\nExact Dialogue:\n${dialog}`;
        });
        sections.push(`### EXACT TRANSCRIPTS OF THE LAST ${last5Sessions.length} CONVERSATION(S):\n${transcriptBlocks.join("\n\n")}`);
      }
    } catch (e) {
      console.error("[MemoryEngine] Failed to compile memory prompt from Firestore:", e);
    }

    if (sections.length === 0) {
      return "[Memory is currently empty. This is your first interaction with DK. Learn about him and remember everything he shares!]";
    }

    return sections.join("\n\n");
  }
}

export const memoryEngine = new MemoryEngine();
