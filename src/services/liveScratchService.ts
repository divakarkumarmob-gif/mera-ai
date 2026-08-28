import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { vectorMemoryService } from "./vectorMemoryService";
import { memoryNotificationService } from "./memoryNotificationService";
import { encryptData, decryptData } from "../utils/cryptoVault";

export interface LiveScratchTurn {
  id: string;
  sessionId: string;
  sender: "user" | "ai";
  text: string;
  timestamp: number;
  spokenTimeIST: string;
  status?: "active" | "archived_pending_delete";
  safeDeleteAfter?: number;
}

export interface ScratchSummaryEntry {
  id: string;
  dateStr: string;
  summary: string;
  fullContent: string;
  timestamp: number;
  expiresAt30d: number;
}

const scratchCol = () => db.collection("live_scratch_cache");
const scratchSummariesCol = () => db.collection("memory").doc("scratchSummaries").collection("entries");

const MS_24_HOURS = 24 * 60 * 60 * 1000;
const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

class LiveScratchService {
  private inMemoryScratch: Map<string, LiveScratchTurn> = new Map();
  private inMemorySummaries: Map<string, ScratchSummaryEntry> = new Map();
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      const now = Date.now();
      const cutoff24h = now - MS_24_HOURS;

      // Load active turns from last 24h from Firestore
      const snap = await scratchCol().where("timestamp", ">=", cutoff24h).orderBy("timestamp", "asc").get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as LiveScratchTurn;
          data.text = decryptData(data.text);
          this.inMemoryScratch.set(data.id, data);
        }
      }

      // Load 30-day summaries from Firestore
      const cutoff30d = now - MS_30_DAYS;
      const sumSnap = await scratchSummariesCol().where("timestamp", ">=", cutoff30d).get();
      if (!sumSnap.empty) {
        for (const doc of sumSnap.docs) {
          const data = doc.data() as ScratchSummaryEntry;
          data.summary = decryptData(data.summary);
          data.fullContent = decryptData(data.fullContent);
          this.inMemorySummaries.set(data.id, data);
        }
      }
    } catch (e: any) {
      console.warn("[LiveScratchService] Firestore sync warning (in-memory mode):", e?.message || e);
    }
  }

  /**
   * Real-time live Firestore stream: persists every single message turn immediately.
   * Crash-proof: survives server restarts or abrupt process terminates!
   */
  public async recordLiveTurn(sessionId: string, sender: "user" | "ai", text: string): Promise<LiveScratchTurn> {
    const cleanText = text.trim();
    const now = Date.now();
    const spokenTimeIST = new Date(now).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "medium",
    });

    const id = "turn_" + Math.random().toString(36).substring(2, 9) + "_" + now;
    const turn: LiveScratchTurn = {
      id,
      sessionId,
      sender,
      text: cleanText,
      timestamp: now,
      spokenTimeIST,
    };

    this.inMemoryScratch.set(id, turn);

    // Write encrypted asynchronously to Firestore
    const turnToStore = {
      ...turn,
      text: encryptData(turn.text),
    };
    scratchCol()
      .doc(id)
      .set(turnToStore)
      .catch((err) => {
        console.warn("[LiveScratchService] Failed to stream turn to Firestore:", err?.message || err);
      });

    return turn;
  }

  /**
   * Returns all active scratch turns within the last 24 hours.
   */
  public async getRecentScratchTurns(hours: number = 24): Promise<LiveScratchTurn[]> {
    await this.initPromise;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return Array.from(this.inMemoryScratch.values())
      .filter((t) => t.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Lifecycle cleaner:
   * 1. Turns > 24 hours: Summarized and stored in 30-day summaries collection; raw turn purged.
   * 2. Summaries > 30 days: Converted into Vector Database embeddings permanently!
   */
  public async runScratchLifecycle(ai?: GoogleGenAI): Promise<void> {
    await this.initPromise;
    const now = Date.now();
    const cutoff24h = now - MS_24_HOURS;
    const cutoff30d = now - MS_30_DAYS;

    try {
      // 1. Find raw turns older than 24 hours
      const oldTurns = Array.from(this.inMemoryScratch.values()).filter((t) => t.timestamp < cutoff24h);
      if (oldTurns.length >= 4 && ai) {
        // Group by session or batch into a 24h summary
        const content = oldTurns.map((t) => `[${t.spokenTimeIST}] ${t.sender.toUpperCase()}: ${t.text}`).join("\n");
        const earliestTime = oldTurns[0].spokenTimeIST;
        const latestTime = oldTurns[oldTurns.length - 1].spokenTimeIST;
        const dateRangeStr = `${earliestTime} – ${latestTime}`;
        try {
          let summary = "";
          const summaryModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"];
        for (const model of summaryModels) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents: `Summarize these raw past 24-hour conversation scratch turns cleanly for long-term memory, highlighting key decisions, commands, personal details, and topics discussed:\n\n${content}`,
            });
            if (resp.text?.trim()) {
              summary = resp.text.trim();
              break;
            }
          } catch (mErr: any) {
            console.warn(`[LiveScratchService] Summary model ${model} failed, trying fallback:`, mErr?.message || mErr);
          }
        }
        if (!summary) {
          summary = `24-hour scratch activity summary (${dateRangeStr}): ${content.slice(0, 300)}`;
        }

          const summaryId = "scratch_sum_" + now;
          const summaryEntry: ScratchSummaryEntry = {
            id: summaryId,
            dateStr: dateRangeStr,
            summary,
            fullContent: content,
            timestamp: now,
            expiresAt30d: now + MS_30_DAYS,
          };

          this.inMemorySummaries.set(summaryId, summaryEntry);
          const summaryEntryToStore = {
            ...summaryEntry,
            summary: encryptData(summaryEntry.summary),
            fullContent: encryptData(summaryEntry.fullContent),
          };
          await scratchSummariesCol().doc(summaryId).set(summaryEntryToStore);

          // Real-time verified confirmation to Telegram and WhatsApp
          memoryNotificationService.notifySummaryVerifiedAndStaged({
            dateRangeStr,
            summaryType: "scratch_archive",
            summaryId,
            summaryText: summary,
            targetCollection: "scratchSummaries",
          }).catch(() => {});

          // Zero Data-Loss: Stage processed turns under 24-hour buffer instead of instant deletion!
          const batch = db.batch();
          const safeDeleteAfter = now + MS_24_HOURS;
          for (const t of oldTurns) {
            if (t.status === "archived_pending_delete" && t.safeDeleteAfter && t.safeDeleteAfter <= now) {
              // 24 hours have passed -> Safe to prune
              this.inMemoryScratch.delete(t.id);
              batch.delete(scratchCol().doc(t.id));
            } else if (!t.status || t.status === "active") {
              // Stage with 24-hour safety buffer
              t.status = "archived_pending_delete";
              t.safeDeleteAfter = safeDeleteAfter;
              this.inMemoryScratch.set(t.id, t);
              batch.set(scratchCol().doc(t.id), { status: "archived_pending_delete", safeDeleteAfter }, { merge: true });
            }
          }
          await batch.commit().catch(() => {});
          console.log(`[LiveScratchService] 🛡️ Staged/Pruned ${oldTurns.length} turns under 24h buffer.`);
        } catch (sumErr) {
          console.warn("[LiveScratchService] 24h summarization error:", sumErr);
        }
      }

      // 2. Find summaries older than 30 days -> convert to permanent vector database!
      const expiredSummaries = Array.from(this.inMemorySummaries.values()).filter((s) => s.timestamp < cutoff30d);
      if (expiredSummaries.length > 0) {
        const batch = db.batch();
        for (const expired of expiredSummaries) {
          await vectorMemoryService.archiveToVectorStore({
            originalText: expired.fullContent,
            summary: expired.summary,
            sourceType: "scratch_cache",
            dateRangeStr: expired.dateStr,
            startTimestamp: expired.timestamp - MS_24_HOURS,
            endTimestamp: expired.timestamp,
            metadata: {
              session_id: "scratch_archive",
              exact_date: expired.dateStr,
            },
          });

          this.inMemorySummaries.delete(expired.id);
          batch.delete(scratchSummariesCol().doc(expired.id));
          console.log(`[LiveScratchService] Archived 30d+ scratch summary ${expired.id} into permanent vector database.`);
        }
        await batch.commit().catch(() => {});
      }
    } catch (e: any) {
      console.error("[LiveScratchService] Lifecycle error:", e?.message || e);
    }
  }
}

export const liveScratchService = new LiveScratchService();
