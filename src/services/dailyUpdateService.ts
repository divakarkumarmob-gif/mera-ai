import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { vectorMemoryService } from "./vectorMemoryService";

// ---------------------------------------------------------------------------
// Daily Update system.
//
// DK can say "aaj ka update note karo, maine khana kha liya" any time — it
// appends to today's entry (IST calendar day). At midnight IST a new day
// starts fresh. Exact word-to-word logs are kept for 30 days. After 30 days,
// they are automatically summarized and archived into the permanent Vector Database.
// ---------------------------------------------------------------------------

export interface DailyUpdateEntry {
  dateStr: string;      // "YYYY-MM-DD" in IST — the document id
  text: string;         // accumulated update text for the day, newest appended at the end
  updatedAt: number;     // ms epoch of last append
}

export interface PendingQuestion {
  id: string;
  senderPhone: string;
  senderName: string;
  replyJid: string;       // where to send DK's eventual answer back to
  question: string;       // the original question text
  askedDK: boolean;       // whether DK has already been notified about this one
  status: "awaiting_confirmation" | "awaiting_dk" | "answered" | "expired";
  createdAt: number;
}

const updatesCol = () => db.collection("daily_updates");
const pendingCol = () => db.collection("pending_questions");

const MAX_DAYS_RETAINED = 30;
const AFFIRMATIVE_WORDS = new Set([
  "haan", "haa", "ha", "han", "h", "hn", "hmm", "hmmm", "hmmmm", "hm",
  "yes", "yess", "yep", "yup", "ok", "okk", "okok", "okay", "o", "oo",
  "sahi", "sahi hai", "theek", "theek hai", "thik hai", "acha", "achha",
  "bilkul", "kar do", "kar dena", "pucho", "pooch lo", "poocho",
]);

/** Today's date string in IST (e.g. "2026-08-23"), used as the daily doc id. */
export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

/** Resolves relative date words (aaj/kal/parso...) DK might use in voice, to an IST date string. */
export function resolveRelativeDateIST(dateWord: string): string {
  const normalized = (dateWord || "").trim().toLowerCase();
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

  let daysAgo = 0;
  if (!normalized || normalized === "aaj" || normalized === "today") daysAgo = 0;
  else if (normalized === "kal" || normalized === "yesterday") daysAgo = 1;
  else if (normalized === "parso" || normalized === "parsoon" || normalized === "parson") daysAgo = 2;
  else {
    const match = normalized.match(/(\d+)/);
    if (match) daysAgo = parseInt(match[1], 10);
  }

  istNow.setDate(istNow.getDate() - daysAgo);
  return istNow.toLocaleDateString("en-CA");
}

class DailyUpdateService {
  // In-memory caches for zero-downtime offline resiliency
  private inMemoryUpdates: Map<string, DailyUpdateEntry> = new Map();
  private inMemoryPending: Map<string, PendingQuestion> = new Map();

  /**
   * Appends DK's spoken update to today's entry. Multiple calls the same
   * day accumulate into one document, separated by " | ".
   */
  public async appendUpdate(text: string): Promise<DailyUpdateEntry> {
    const date = todayIST();
    const now = Date.now();
    const cleanText = text.trim();

    // Check memory first
    const memExisting = this.inMemoryUpdates.get(date);
    let existingText = memExisting?.text || "";

    try {
      const snap = await updatesCol().doc(date).get();
      if (snap.exists) {
        existingText = (snap.data() as DailyUpdateEntry).text || existingText;
      }
    } catch (e: any) {
      console.warn("[DailyUpdate] Firestore read warning (using memory cache):", e?.message || e);
    }

    const timeFormatted = new Date(now).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const updateSnippet = `[${timeFormatted}] ${cleanText}`;
    const combinedText = existingText ? `${existingText} | ${updateSnippet}` : updateSnippet;
    const entry: DailyUpdateEntry = { dateStr: date, text: combinedText, updatedAt: now };

    this.inMemoryUpdates.set(date, entry);

    try {
      await updatesCol().doc(date).set(entry);
    } catch (e: any) {
      console.warn("[DailyUpdate] Firestore write warning (cached in memory):", e?.message || e);
    }

    this.trimOldUpdates().catch(() => {});
    return entry;
  }

  /** Fetches the raw update text for a given IST date string, or null if nothing was logged. */
  public async getUpdateForDate(dateStr: string): Promise<DailyUpdateEntry | null> {
    try {
      const snap = await updatesCol().doc(dateStr).get();
      if (snap.exists) {
        const data = snap.data() as DailyUpdateEntry;
        this.inMemoryUpdates.set(dateStr, data);
        return data;
      }
    } catch (e: any) {
      console.warn(`[DailyUpdate] Firestore fetch warning for ${dateStr}, checking memory cache.`);
    }

    return this.inMemoryUpdates.get(dateStr) || null;
  }

  /** Whether anything has been logged for today yet. */
  public async hasTodayUpdate(): Promise<boolean> {
    const entry = await this.getUpdateForDate(todayIST());
    return !!entry?.text?.trim();
  }

  /**
   * Keeps only the most recent MAX_DAYS_RETAINED (30 days) day-documents.
   * Documents older than 30 days are automatically converted into Vector Embeddings
   * and saved permanently into the Vector Database before raw removal!
   */
  private async trimOldUpdates() {
    try {
      const snapshot = await updatesCol().orderBy("dateStr", "desc").get();
      if (snapshot.size <= MAX_DAYS_RETAINED) return;
      const toArchive = snapshot.docs.slice(MAX_DAYS_RETAINED);

      for (const doc of toArchive) {
        const data = doc.data() as DailyUpdateEntry;
        if (data.text) {
          await vectorMemoryService.archiveToVectorStore({
            originalText: data.text,
            summary: `Daily Update Log for ${data.dateStr}: ${data.text.slice(0, 300)}`,
            sourceType: "daily_update",
            dateRangeStr: data.dateStr,
            startTimestamp: data.updatedAt || Date.now(),
            endTimestamp: data.updatedAt || Date.now(),
            metadata: { dateStr: data.dateStr },
          });
        }
        await doc.ref.delete();
        this.inMemoryUpdates.delete(data.dateStr);
        console.log(`[DailyUpdate] Archived 30d+ daily update for ${data.dateStr} into permanent vector database.`);
      }
    } catch (e) {
      console.warn("[DailyUpdate] Archival error:", e);
    }
  }

  /**
   * Tries to answer a question using ONLY today's update text. Returns null
   * if today has no update logged, or if the update genuinely doesn't
   * contain an answer (Gemini is instructed not to guess/hallucinate).
   */
  public async answerFromTodayUpdate(question: string): Promise<string | null> {
    const today = await this.getUpdateForDate(todayIST());
    if (!today?.text?.trim()) return null;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[DailyUpdate] GEMINI_API_KEY not set — cannot answer from update.");
      return null;
    }

    const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
    const prompt = `You are Friday, DK's WhatsApp assistant. Below is DK's own update log for TODAY only — short notes DK dictated about what he did/is doing today.

TODAY'S UPDATE LOG:
"${today.text}"

Someone on WhatsApp just asked: "${question}"

Answer ONLY using facts explicitly present in the update log above, in Friday's warm Hinglish voice, max 1-2 short sentences, third person about DK (e.g. "Haan, boss ne khana kha liya").
If the update log does NOT contain information relevant to this specific question, respond with EXACTLY the single word: NONE
Do not guess, infer, or make up anything not explicitly stated in the log.`;

    const ai = new GoogleGenAI({ apiKey });

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const reply = response.text?.trim();
        if (!reply || reply.toUpperCase() === "NONE") return null;
        return reply;
      } catch (e: any) {
        console.warn(`[DailyUpdate] Model ${model} failed, trying fallback:`, e?.message || e);
      }
    }

    return null;
  }

  // ── Pending questions (the "DK se poochu?" → forward-back flow) ──────────

  public async createPendingQuestion(params: {
    senderPhone: string;
    senderName: string;
    replyJid: string;
    question: string;
  }): Promise<PendingQuestion> {
    const id = "pq_" + Math.random().toString(36).substring(2, 9);
    const entry: PendingQuestion = {
      id,
      senderPhone: params.senderPhone,
      senderName: params.senderName,
      replyJid: params.replyJid,
      question: params.question,
      askedDK: false,
      status: "awaiting_confirmation",
      createdAt: Date.now(),
    };

    this.inMemoryPending.set(id, entry);

    try {
      await pendingCol().doc(id).set(entry);
    } catch (e: any) {
      console.warn("[DailyUpdate] Firestore pending save warning (cached in memory):", e?.message || e);
    }

    return entry;
  }

  /** Most recent not-yet-resolved pending question from this specific sender, if any (within the last hour). */
  public async getRecentPendingForSender(senderPhone: string): Promise<PendingQuestion | null> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    try {
      const snap = await pendingCol()
        .where("senderPhone", "==", senderPhone)
        .where("status", "in", ["awaiting_confirmation", "awaiting_dk"])
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (!snap.empty) {
        const entry = snap.docs[0].data() as PendingQuestion;
        if (entry.createdAt >= oneHourAgo) {
          this.inMemoryPending.set(entry.id, entry);
          return entry;
        }
      }
    } catch (e) {
      // Check memory fallback
      for (const entry of this.inMemoryPending.values()) {
        if (
          entry.senderPhone === senderPhone &&
          (entry.status === "awaiting_confirmation" || entry.status === "awaiting_dk") &&
          entry.createdAt >= oneHourAgo
        ) {
          return entry;
        }
      }
    }

    return null;
  }

  public async markAskedDK(id: string) {
    const p = this.inMemoryPending.get(id);
    if (p) {
      p.status = "awaiting_dk";
      p.askedDK = true;
    }
    try {
      await pendingCol().doc(id).set({ status: "awaiting_dk", askedDK: true }, { merge: true });
    } catch {}
  }

  public async markAnswered(id: string) {
    const p = this.inMemoryPending.get(id);
    if (p) {
      p.status = "answered";
    }
    try {
      await pendingCol().doc(id).set({ status: "answered" }, { merge: true });
    } catch {}
  }

  /** All pending questions currently waiting on DK's answer (for DK-side forwarding). */
  public async getQuestionsAwaitingDK(): Promise<PendingQuestion[]> {
    try {
      const snap = await pendingCol().where("status", "==", "awaiting_dk").get();
      return snap.docs.map((d) => d.data() as PendingQuestion);
    } catch (e) {
      return Array.from(this.inMemoryPending.values()).filter((p) => p.status === "awaiting_dk");
    }
  }

  /** True if the given text is a short affirmative ("haan", "hmm", "ok"...), used to detect "yes, ask DK". */
  public isAffirmative(text: string): boolean {
    const normalized = (text || "").trim().toLowerCase().replace(/[.!?]+$/g, "");
    if (AFFIRMATIVE_WORDS.has(normalized)) return true;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= 2 && !normalized.includes("?");
  }
}

export const dailyUpdateService = new DailyUpdateService();
