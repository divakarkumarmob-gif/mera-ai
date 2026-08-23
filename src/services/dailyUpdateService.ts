import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Daily Update system.
//
// DK can say "aaj ka update note karo, maine khana kha liya" any time — it
// appends to today's entry (IST calendar day). At midnight IST a new day
// starts fresh. Only the last 10 days are kept in Firestore.
//
// When someone messages DK on WhatsApp, Friday tries to answer using ONLY
// today's update text (via Gemini, told strictly not to guess). If nothing
// relevant is found, Friday tells the asker she doesn't know and asks DK —
// see PendingQuestion below for that flow.
// ---------------------------------------------------------------------------

export interface DailyUpdateEntry {
  dateStr: string;      // "YYYY-MM-DD" in IST — the document id
  text: string;         // accumulated update text for the day, newest appended at the end
  updatedAt: number;     // ms epoch of last append
}

/**
 * A question from someone on WhatsApp that today's update couldn't answer,
 * waiting on DK's reply so Friday can forward it back to the original sender.
 */
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

const MAX_DAYS_RETAINED = 10;
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
    // "3 din pehle" / "5 days ago" style — pull the first number out.
    const match = normalized.match(/(\d+)/);
    if (match) daysAgo = parseInt(match[1], 10);
  }

  istNow.setDate(istNow.getDate() - daysAgo);
  return istNow.toLocaleDateString("en-CA");
}

class DailyUpdateService {
  /**
   * Appends DK's spoken update to today's entry. Multiple calls the same
   * day accumulate into one document, separated by " | ".
   */
  public async appendUpdate(text: string): Promise<DailyUpdateEntry> {
    const date = todayIST();
    const now = Date.now();
    const ref = updatesCol().doc(date);

    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as DailyUpdateEntry) : null;
    const combinedText = existing?.text ? `${existing.text} | ${text.trim()}` : text.trim();

    const entry: DailyUpdateEntry = { dateStr: date, text: combinedText, updatedAt: now };
    await ref.set(entry);

    this.trimOldUpdates().catch((e) => console.error("[DailyUpdate] Trim failed:", e));
    return entry;
  }

  /** Fetches the raw update text for a given IST date string, or null if nothing was logged. */
  public async getUpdateForDate(dateStr: string): Promise<DailyUpdateEntry | null> {
    try {
      const snap = await updatesCol().doc(dateStr).get();
      return snap.exists ? (snap.data() as DailyUpdateEntry) : null;
    } catch (e) {
      console.error(`[DailyUpdate] Failed to fetch update for ${dateStr}:`, e);
      return null;
    }
  }

  /** Whether anything has been logged for today yet. */
  public async hasTodayUpdate(): Promise<boolean> {
    const entry = await this.getUpdateForDate(todayIST());
    return !!entry?.text?.trim();
  }

  /** Keeps only the most recent MAX_DAYS_RETAINED day-documents. */
  private async trimOldUpdates() {
    const snapshot = await updatesCol().orderBy("dateStr", "desc").get();
    if (snapshot.size <= MAX_DAYS_RETAINED) return;
    const toDelete = snapshot.docs.slice(MAX_DAYS_RETAINED);
    const batch = db.batch();
    toDelete.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
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

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday, DK's WhatsApp assistant. Below is DK's own update log for TODAY only — short notes DK dictated about what he did/is doing today.

TODAY'S UPDATE LOG:
"${today.text}"

Someone on WhatsApp just asked: "${question}"

Answer ONLY using facts explicitly present in the update log above, in Friday's warm Hinglish voice, max 1-2 short sentences, third person about DK (e.g. "Haan, boss ne khana kha liya").
If the update log does NOT contain information relevant to this specific question, respond with EXACTLY the single word: NONE
Do not guess, infer, or make up anything not explicitly stated in the log.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      const reply = response.text?.trim();
      if (!reply || reply.toUpperCase() === "NONE") return null;
      return reply;
    } catch (e) {
      console.error("[DailyUpdate] Failed to answer from today's update:", e);
      return null;
    }
  }

  // ── Pending questions (the "DK se poochu?" → forward-back flow) ──────────

  public async createPendingQuestion(params: {
    senderPhone: string;
    senderName: string;
    replyJid: string;
    question: string;
  }): Promise<PendingQuestion> {
    const id = Math.random().toString(36).substring(2, 9);
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
    await pendingCol().doc(id).set(entry);
    return entry;
  }

  /** Most recent not-yet-resolved pending question from this specific sender, if any (within the last hour). */
  public async getRecentPendingForSender(senderPhone: string): Promise<PendingQuestion | null> {
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const snap = await pendingCol()
        .where("senderPhone", "==", senderPhone)
        .where("status", "in", ["awaiting_confirmation", "awaiting_dk"])
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      if (snap.empty) return null;
      const entry = snap.docs[0].data() as PendingQuestion;
      if (entry.createdAt < oneHourAgo) return null;
      return entry;
    } catch (e) {
      console.error("[DailyUpdate] Failed to fetch pending question:", e);
      return null;
    }
  }

  public async markAskedDK(id: string) {
    await pendingCol().doc(id).set({ status: "awaiting_dk", askedDK: true }, { merge: true });
  }

  public async markAnswered(id: string) {
    await pendingCol().doc(id).set({ status: "answered" }, { merge: true });
  }

  /** All pending questions currently waiting on DK's answer (for DK-side forwarding). */
  public async getQuestionsAwaitingDK(): Promise<PendingQuestion[]> {
    try {
      const snap = await pendingCol().where("status", "==", "awaiting_dk").get();
      return snap.docs.map((d) => d.data() as PendingQuestion);
    } catch (e) {
      console.error("[DailyUpdate] Failed to fetch questions awaiting DK:", e);
      return [];
    }
  }

  /** True if the given text is a short affirmative ("haan", "hmm", "ok"...), used to detect "yes, ask DK". */
  public isAffirmative(text: string): boolean {
    const normalized = (text || "").trim().toLowerCase().replace(/[.!?]+$/g, "");
    if (AFFIRMATIVE_WORDS.has(normalized)) return true;
    // Reasoning-lite fallback: very short replies (<=3 words) that don't look
    // like a real new question are treated as affirmative-ish confirmations.
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= 2 && !normalized.includes("?");
  }
}

export const dailyUpdateService = new DailyUpdateService();
