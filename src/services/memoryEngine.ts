import { GoogleGenAI } from "@google/genai";
import { db, FieldValue } from "./firebaseAdmin";
import { vectorMemoryService } from "./vectorMemoryService";
import { liveScratchService } from "./liveScratchService";
import { memoryNotificationService } from "./memoryNotificationService";
import { encryptData, decryptData } from "../utils/cryptoVault";

export interface SessionMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: number;
  timeStr?: string;
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
  status?: "active" | "archived_pending_delete";
  safeDeleteAfter?: number;
  summaryId?: string;
  /** Index into `messages` up to which periodic fact-extraction has already run (in-memory only, not persisted). */
  lastExtractedIndex?: number;
  /** Guards against overlapping periodic-extraction calls for the same session. */
  isExtracting?: boolean;
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
      lastExtractedIndex: 0,
      isExtracting: false,
    };
    this.activeSessions.set(sessionId, session);
    return session;
  }

  public getActiveSessions(): ConversationSession[] {
    return Array.from(this.activeSessions.values());
  }

  public recordMessage(sessionId: string, sender: "user" | "ai", text: string) {
    if (!text || !text.trim()) return;
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      session = this.startSession(sessionId);
    }
    const now = Date.now();
    const timeStr = new Date(now).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    session.messages.push({
      sender,
      text: text.trim(),
      timestamp: now,
      timeStr,
    });

    // Real-time live crash-proof Firestore stream
    liveScratchService.recordLiveTurn(sessionId, sender, text.trim());
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
      const toPersist = {
        ...session,
        summary: session.summary ? encryptData(session.summary) : undefined,
        messages: (session.messages || []).map((m) => ({
          ...m,
          text: encryptData(m.text),
        })),
      };
      await sessionsCol().doc(session.id).set(toPersist);
      this.processVectorArchivalLifecycle().catch(() => {});
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

  /**
   * Sessions older than 60 days:
   * Phase 1 (Stage & Buffer): Converts to Vector Embeddings, saves to Firestore vectorStore,
   * marks status: "archived_pending_delete" with a 24-Hour Safety Buffer, and dispatches
   * verified alerts to Telegram and WhatsApp.
   * Phase 2 (Prune): Deletes raw document ONLY after 24 hours have elapsed.
   */
  public async processVectorArchivalLifecycle(): Promise<void> {
    try {
      const now = Date.now();
      const cutoff60d = now - 60 * 24 * 60 * 60 * 1000;
      const snapshot = await sessionsCol().where("startTime", "<", cutoff60d).get();
      if (snapshot.empty) return;

      let deleteBatch = db.batch();
      let deleteCount = 0;

      for (const doc of snapshot.docs) {
        const session = doc.data() as ConversationSession;

        // Phase 2: Prune if already buffered for 24 hours
        if (session.status === "archived_pending_delete") {
          if (session.safeDeleteAfter && session.safeDeleteAfter <= now) {
            deleteBatch.delete(doc.ref);
            deleteCount++;
            if (deleteCount >= 400) {
              await deleteBatch.commit().catch(() => {});
              deleteBatch = db.batch();
              deleteCount = 0;
            }
            console.log(`[MemoryEngine] 🗑️ Safely pruned 24h buffered session ${session.id} (${session.dateStr}).`);
          }
          continue;
        }

        // Phase 1: Stage, archive to Vector DB, set 24h buffer, notify
        const dialogueText = (session.messages || [])
          .map((m) => `[${m.timeStr || new Date(m.timestamp).toLocaleTimeString()}] ${m.sender.toUpperCase()}: ${m.text}`)
          .join("\n");
        const summary = session.summary || `Comprehensive conversation session on ${session.dateStr}`;

        const archiveRes = await vectorMemoryService.archiveToVectorStore({
          originalText: dialogueText,
          summary,
          sourceType: "session_dialogue",
          dateRangeStr: session.dateStr,
          startTimestamp: session.startTime,
          endTimestamp: session.endTime || session.startTime,
          metadata: {
            session_id: session.id,
            exact_date: session.dateStr,
            pinnedFacts: session.pinnedFacts || [],
          },
        });

        if (archiveRes.success && archiveRes.entryId) {
          const safeDeleteAfter = now + 24 * 60 * 60 * 1000; // 24-hour buffer
          await doc.ref.set(
            {
              status: "archived_pending_delete",
              safeDeleteAfter,
              summaryId: archiveRes.entryId,
            },
            { merge: true }
          );

          // Real-time verified confirmation to Telegram and WhatsApp
          memoryNotificationService
            .notifySummaryVerifiedAndStaged({
              dateRangeStr: session.dateStr,
              summaryType: "session_digest",
              summaryId: archiveRes.entryId,
              summaryText: summary,
              targetCollection: "vectorStore",
            })
            .catch(() => {});

          console.log(`[MemoryEngine] 🛡️ Staged session ${session.id} (${session.dateStr}) under 24h buffer.`);
        }
      }

      if (deleteCount > 0) {
        await deleteBatch.commit().catch(() => {});
      }
    } catch (e: any) {
      console.warn("[MemoryEngine] Vector archival lifecycle warning:", e?.message || e);
    }
  }

  /**
   * Calls Gemini on a slice of transcript and returns the parsed extraction
   * JSON, or null on failure. Pure — does not write anything to Firestore.
   * Tries a chain of models (newest/best first) so a single model being
   * overloaded, retired, or briefly down doesn't silently lose this
   * session's memory — only gives up if EVERY model fails.
   */
  private static readonly EXTRACTION_MODEL_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ];

  private async runExtraction(
    messages: SessionMessage[],
    ai: GoogleGenAI
  ): Promise<{
    summary: string;
    exactPersonalFacts: { category: string; exactFact: string }[];
    pinnedMemories: string[];
    mistakes: string[];
    profileFacts: string[];
  } | null> {
    if (messages.length === 0) return null;

    const transcript = messages.map((m) => `${m.sender === "user" ? "DK" : "Friday"}: ${m.text}`).join("\n");

    const prompt = `You are Friday AI's memory engine. Analyze this conversation snippet between user DK and Friday.
Extract long-term insights and return ONLY a valid JSON object matching this schema:
{
  "summary": "Detailed, comprehensive 3-5 sentence summary of what was discussed in this snippet, explicitly preserving all decisions, topics, questions asked, and key numbers/events so no vital information is missed.",
  "exactPersonalFacts": [
    {
      "category": "boss_identity | family_members | personal_secrets_and_facts | career_and_business | residence_and_lifestyle | general_personal_info",
      "exactFact": "LITERAL, EXACT, UNALTERED personal fact directly as stated by DK. (e.g., family members, count, names, relationships, personal status, secrets, likes/dislikes, plans, schedule, anything about DK's life). DO NOT SUMMARIZE OR PARAPHRASE. If a fact doesn't cleanly fit another category, use 'general_personal_info' — never drop a stated personal fact just because no category fits well."
    }
  ],
  "pinnedMemories": ["Array of explicit facts DK asked to remember, e.g., 'yeh yaad rakhna', 'yaad rakho', 'don't forget this'"],
  "mistakes": ["Array of mistakes, misconceptions, or errors DK made during discussion"],
  "profileFacts": ["General preferences, tech stack, or habits"]
}

IMPORTANT: Extract EVERY concrete personal fact DK states about himself or his life, even small ones — err on the side of including, not skipping.

Conversation:
${transcript}`;

    for (const model of MemoryEngine.EXTRACTION_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });
        const text = response.text || "{}";
        const parsed = JSON.parse(text);
        console.log(`[MemoryEngine] Extraction succeeded using ${model}`);
        return parsed;
      } catch (e) {
        console.error(`[MemoryEngine] ${model} failed for extraction (${(e as any)?.message || e}), trying next model...`);
      }
    }

    console.error("[MemoryEngine] All models in the fallback chain failed — this session's extraction is lost.");
    return null;
  }

  /** Writes a parsed extraction result to Firestore (vault/pinned/profile), deduping by exact text. */
  private async applyExtraction(
    parsed: {
      exactPersonalFacts?: { category: string; exactFact: string }[];
      pinnedMemories?: string[];
      mistakes?: string[];
      profileFacts?: string[];
    },
    dateStr: string,
    timestamp: number
  ) {
    // Add to exact Personal Vault (NEVER SUMMARIZED) — dedup by exact text
    if (Array.isArray(parsed.exactPersonalFacts) && parsed.exactPersonalFacts.length > 0) {
      const existingVault = await vaultCol().get();
      const existingFacts = new Set(existingVault.docs.map((d) => (d.data().exactFact || "").toLowerCase()));

      for (const item of parsed.exactPersonalFacts) {
        if (item?.exactFact && !existingFacts.has(item.exactFact.toLowerCase())) {
          const id = Math.random().toString(36).substring(2, 9);
          await vaultCol()
            .doc(id)
            .set({
              id,
              category: item.category || "general_personal_info",
              exactFact: item.exactFact.trim(),
              date: dateStr,
              timestamp,
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
            date: dateStr,
            timestamp,
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
  }

  /** Runs on session finalize: extracts facts from whatever hasn't been processed yet, plus writes the session summary. */
  private async autoSummarizeSession(session: ConversationSession, ai: GoogleGenAI) {
    try {
      const startIdx = session.lastExtractedIndex || 0;
      const unprocessed = session.messages.slice(startIdx);

      // Full-session summary always comes from the complete transcript.
      const parsedFull = await this.runExtraction(session.messages, ai);
      if (!parsedFull) return;

      session.summary = parsedFull.summary || "";
      const summaryEncrypted = session.summary ? encryptData(session.summary) : "";

      await sessionsCol().doc(session.id).set(
        {
          summary: summaryEncrypted,
          pinnedFacts: Array.isArray(parsedFull.pinnedMemories) ? parsedFull.pinnedMemories : [],
          mistakesOrInsights: Array.isArray(parsedFull.mistakes) ? parsedFull.mistakes : [],
        },
        { merge: true }
      );

      // Only apply facts from the slice that periodic extraction hasn't already covered,
      // to avoid redundant work — dedup in applyExtraction makes this safe either way.
      const parsedDelta = unprocessed.length > 0 && unprocessed.length !== session.messages.length
        ? await this.runExtraction(unprocessed, ai)
        : parsedFull;
      if (parsedDelta) {
        await this.applyExtraction(parsedDelta, session.dateStr, session.startTime);
      }

      console.log(`[MemoryEngine] Successfully processed session ${session.id}: "${parsedFull.summary}"`);
    } catch (e) {
      console.error("[MemoryEngine] Auto-summarization error:", e);
    }
  }

  /**
   * Called periodically during a LIVE (still-open) session — e.g. every N turns —
   * so personal facts get into the vault without waiting for the session to end.
   * Only processes messages since the last extraction (delta), fire-and-forget safe.
   */
  public async maybeAutoExtract(sessionId: string, ai: GoogleGenAI, everyNMessages = 8) {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.isExtracting) return;

    const startIdx = session.lastExtractedIndex || 0;
    const newCount = session.messages.length - startIdx;
    if (newCount < everyNMessages) return;

    session.isExtracting = true;
    const sliceEnd = session.messages.length;
    const unprocessed = session.messages.slice(startIdx, sliceEnd);

    try {
      const parsed = await this.runExtraction(unprocessed, ai);
      if (parsed) {
        await this.applyExtraction(parsed, session.dateStr, Date.now());
        console.log(`[MemoryEngine] Periodic extraction for session ${sessionId}: processed ${unprocessed.length} messages.`);
      }
      // Mark processed even if extraction failed, so we don't hammer the API retrying
      // the same slice forever — the finalize-time pass will still catch anything missed.
      session.lastExtractedIndex = sliceEnd;
    } catch (e) {
      console.error("[MemoryEngine] Periodic extraction error:", e);
    } finally {
      session.isExtracting = false;
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
        exactFact: encryptData(exactFact.trim()),
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
        fact: encryptData(fact.trim()),
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
        personalVault: vaultSnap.docs.map((d) => {
          const v = d.data() as PersonalVaultEntry;
          return { ...v, exactFact: decryptData(v.exactFact) };
        }),
        pinnedMemories: pinnedSnap.docs.map((d) => {
          const p = d.data();
          return { ...p, fact: decryptData(p.fact) };
        }),
        profileFacts: profileData.profileFacts || [],
        knownMistakes: profileData.knownMistakes || [],
        pastSessionsCount: sessionsSnap.size,
        recentSessions: sessionsSnap.docs.map((d) => {
          const s = d.data() as ConversationSession;
          return {
            ...s,
            summary: s.summary ? decryptData(s.summary) : s.summary,
            messages: (s.messages || []).map((m) => ({ ...m, text: decryptData(m.text) })),
          };
        }).reverse(),
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
   * Compiles a LEAN, lightning-fast memory context for WebSocket handshake / session start.
   * Priority: Essential core vault facts, pinned memories, profile overview, and IMMEDIATE PRIOR CONVERSATIONS.
   * Ensures 100% memory continuity across reconnects and consecutive sessions.
   */
  public async compileLeanMemoryPrompt(): Promise<string> {
    await this.initPromise;
    const sections: string[] = [];

    try {
      const [vaultSnap, pinnedSnap, profileSnap, recentSessionsSnap, recentTurns] = await Promise.all([
        vaultCol().limit(15).get(),
        pinnedCol().orderBy("timestamp", "desc").limit(8).get(),
        profileDoc().get(),
        sessionsCol().orderBy("startTime", "desc").limit(2).get().catch(() => ({ docs: [], empty: true } as any)),
        liveScratchService.getRecentScratchTurns(12).catch(() => []),
      ]);

      const personalVault = vaultSnap.docs.map((d) => {
        const v = d.data() as PersonalVaultEntry;
        return { ...v, exactFact: decryptData(v.exactFact) };
      });
      const pinnedMemories = pinnedSnap.docs.map((d) => {
        const p = d.data() as { fact: string; date: string };
        return { ...p, fact: decryptData(p.fact) };
      });
      const profileData = profileSnap.exists ? profileSnap.data()! : { profileFacts: [], knownMistakes: [] };

      // 1. Core Personal Vault (Essential identity truths)
      if (personalVault.length > 0) {
        const vaultList = personalVault
          .map((p, i) => `${i + 1}. [${p.category}]: "${p.exactFact}"`)
          .join("\n");
        sections.push(`### 🔒 CORE PERSONAL VAULT:\n${vaultList}`);
      }

      // 2. Pinned Memories (Most recent key facts)
      if (pinnedMemories.length > 0) {
        const pinnedList = pinnedMemories
          .map((p, i) => `${i + 1}. [${p.date}]: "${p.fact}"`)
          .join("\n");
        sections.push(`### 📌 PINNED KEY FACTS:\n${pinnedList}`);
      }

      // 3. DK Profile & Learning Context
      const profileFacts: string[] = profileData.profileFacts || [];
      if (profileFacts.length > 0) {
        sections.push(`### 🎯 DK PROFILE HIGHLIGHTS:\n- ${profileFacts.slice(-6).join("\n- ")}`);
      }

      // 4. IMMEDIATE PRIOR CONVERSATIONS (REALTIME MEMORY CONTINUITY FOR CONSECUTIVE SESSIONS)
      if (recentTurns && recentTurns.length > 0) {
        const recentDialogue = recentTurns.slice(-14).map((t) => {
          return `[${t.spokenTimeIST}] ${t.sender === "user" ? "Boss DK" : "Friday"}: "${t.text}"`;
        }).join("\n");
        sections.push(`### 🗣️ IMMEDIATE PRIOR CONVERSATIONS (LAST 12H - REALTIME CONTINUITY):\n${recentDialogue}`);
      } else if (!recentSessionsSnap.empty) {
        const recentSessionDocs = recentSessionsSnap.docs.reverse().map((d: any) => {
          const s = d.data() as ConversationSession;
          const decryptedSummary = s.summary ? decryptData(s.summary) : "";
          const messages = (s.messages || []).slice(-8).map((m) => {
            const timeFormatted = m.timeStr || new Date(m.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" });
            return `[${timeFormatted}] ${m.sender === "user" ? "Boss DK" : "Friday"}: "${decryptData(m.text)}"`;
          }).join("\n");
          return `Session (${s.dateStr}):\n${decryptedSummary ? `Summary: ${decryptedSummary}\n` : ""}Recent lines:\n${messages}`;
        }).join("\n\n");
        sections.push(`### 🗣️ RECENT PREVIOUS SESSIONS:\n${recentSessionDocs}`);
      }
    } catch (e) {
      console.error("[MemoryEngine] Failed to compile lean memory prompt:", e);
    }

    if (sections.length === 0) {
      return "Core Profile: DK is your creator and Boss. You are Friday, his loyal AI companion.";
    }

    return sections.join("\n\n");
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

      const personalVault = vaultSnap.docs.map((d) => {
        const v = d.data() as PersonalVaultEntry;
        return { ...v, exactFact: decryptData(v.exactFact) };
      });
      const pinnedMemories = pinnedSnap.docs.map((d) => {
        const p = d.data() as { fact: string; date: string };
        return { ...p, fact: decryptData(p.fact) };
      });
      const profileData = profileSnap.exists ? profileSnap.data()! : { profileFacts: [], knownMistakes: [] };
      const sessions = allSessionsSnap.docs.map((d) => {
        const s = d.data() as ConversationSession;
        return {
          ...s,
          summary: s.summary ? decryptData(s.summary) : s.summary,
          messages: (s.messages || []).map((m) => ({ ...m, text: decryptData(m.text) })),
        };
      });

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

      const now = Date.now();
      const cutoff4d = now - 4 * 24 * 60 * 60 * 1000;
      const cutoff60d = now - 60 * 24 * 60 * 60 * 1000;

      // 4. SESSIONS IN LAST 4 DAYS: 100% Exact Word-to-Word Transcripts (Unlimited Sessions)
      const last4DaySessions = sessions.filter((s) => s.startTime >= cutoff4d);
      if (last4DaySessions.length > 0) {
        const verbatimBlocks = last4DaySessions.map((s, idx) => {
          const dialog = (s.messages || [])
            .map((m) => {
              const timeFormatted = m.timeStr || new Date(m.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" });
              return `[${timeFormatted}] ${m.sender === "user" ? "Boss DK" : "Friday"}: "${m.text}"`;
            })
            .join("\n");
          return `--- Session #${idx + 1} (${s.dateStr}) ---${s.summary ? `\nContext Summary: ${s.summary}` : ""}\nExact Word-to-Word Dialogue:\n${dialog}`;
        });
        sections.push(`### 🗣️ EXACT WORD-TO-WORD DIALOGUES (LAST 4 DAYS - UNALTERED VERBATIM LOGS):\n${verbatimBlocks.join("\n\n")}`);
      }

      // 5. SESSIONS BETWEEN 4 DAYS AND 60 DAYS: High-Fidelity Comprehensive Summaries
      const midTierSessions = sessions.filter((s) => s.startTime < cutoff4d && s.startTime >= cutoff60d && s.summary);
      if (midTierSessions.length > 0) {
        const midSummaries = midTierSessions
          .map((s) => `• [${s.dateStr}]: ${s.summary}`)
          .join("\n");
        sections.push(`### 📚 COMPREHENSIVE PAST SESSIONS DIGEST (PAST 4 TO 60 DAYS):\n${midSummaries}`);
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
