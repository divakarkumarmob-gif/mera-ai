import { db } from "./firebaseAdmin";
import { memoryEngine } from "./memoryEngine";
import { dailyUpdateService, todayIST } from "./dailyUpdateService";
import { vectorMemoryService } from "./vectorMemoryService";
import { decryptData, encryptData } from "../utils/cryptoVault";

export interface DecryptedMemoryBackup {
  version: "1.0";
  exportDate: string;
  timestamp: number;
  personalVault: Array<{ id: string; category: string; exactFact: string; date: string }>;
  pinnedMemories: Array<{ id: string; fact: string; date: string }>;
  dailyUpdates: Array<{ dateStr: string; text: string; updatedAt: number }>;
  recentSessions: Array<{ id: string; dateStr: string; summary?: string; messages: Array<{ sender: string; text: string; timeStr?: string }> }>;
  vectorMemories: Array<{ id: string; dateRangeStr: string; summary: string; originalText: string; metadata?: any }>;
}

class MemoryBackupService {
  /**
   * Exports all personal memories, vault, daily updates, and sessions in
   * 100% human-readable decrypted plain text JSON.
   */
  public async exportDecryptedBackup(): Promise<DecryptedMemoryBackup> {
    const now = Date.now();
    const exportDate = new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    // 1. Vault & Pinned & Sessions
    const memData = await memoryEngine.getMemories();

    // 2. Daily updates
    const updatesSnap = await db.collection("daily_updates").orderBy("dateStr", "desc").get();
    const dailyUpdates = updatesSnap.docs.map((d) => {
      const data = d.data();
      return {
        dateStr: data.dateStr,
        text: decryptData(data.text || ""),
        updatedAt: data.updatedAt || now,
      };
    });

    // 3. Vector memories
    const vectorSnap = await db.collection("memory").doc("vectorStore").collection("entries").get();
    const vectorMemories = vectorSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        dateRangeStr: data.dateRangeStr || "",
        summary: decryptData(data.summary || ""),
        originalText: decryptData(data.originalText || ""),
        metadata: data.metadata,
      };
    });

    return {
      version: "1.0",
      exportDate,
      timestamp: now,
      personalVault: (memData.personalVault || []).map((v) => ({
        id: v.id,
        category: v.category,
        exactFact: v.exactFact,
        date: v.date,
      })),
      pinnedMemories: (memData.pinnedMemories || []).map((p: any) => ({
        id: p.id,
        fact: p.fact,
        date: p.date,
      })),
      dailyUpdates,
      recentSessions: (memData.recentSessions || []).map((s: any) => ({
        id: s.id,
        dateStr: s.dateStr,
        summary: s.summary,
        messages: (s.messages || []).map((m: any) => ({
          sender: m.sender,
          text: m.text,
          timeStr: m.timeStr,
        })),
      })),
      vectorMemories,
    };
  }

  /**
   * Imports a plain text backup file, encrypts every field with the CURRENT
   * active ENCRYPTION_KEY, and restores into Firestore!
   * Perfect for rotating keys or disaster recovery.
   */
  public async restoreAndReEncryptBackup(backup: DecryptedMemoryBackup): Promise<{
    success: boolean;
    restoredCounts: {
      vault: number;
      pinned: number;
      dailyUpdates: number;
      sessions: number;
      vectors: number;
    };
  }> {
    if (!backup || !backup.version) {
      throw new Error("Invalid backup format. Must be version 1.0 JSON.");
    }

    const counts = { vault: 0, pinned: 0, dailyUpdates: 0, sessions: 0, vectors: 0 };

    // 1. Restore Vault
    if (Array.isArray(backup.personalVault)) {
      for (const v of backup.personalVault) {
        if (v.exactFact) {
          await memoryEngine.addPersonalVaultFact(v.category, v.exactFact);
          counts.vault++;
        }
      }
    }

    // 2. Restore Pinned
    if (Array.isArray(backup.pinnedMemories)) {
      for (const p of backup.pinnedMemories) {
        if (p.fact) {
          await memoryEngine.addPinnedMemory(p.fact);
          counts.pinned++;
        }
      }
    }

    // 3. Restore Daily Updates
    if (Array.isArray(backup.dailyUpdates)) {
      for (const u of backup.dailyUpdates) {
        if (u.text && u.dateStr) {
          await db.collection("daily_updates").doc(u.dateStr).set({
            dateStr: u.dateStr,
            text: encryptData(u.text),
            updatedAt: u.updatedAt || Date.now(),
            status: "active",
          });
          counts.dailyUpdates++;
        }
      }
    }

    // 4. Restore Vector Memories
    if (Array.isArray(backup.vectorMemories)) {
      for (const vec of backup.vectorMemories) {
        if (vec.originalText || vec.summary) {
          await vectorMemoryService.archiveToVectorStore({
            originalText: vec.originalText || "",
            summary: vec.summary || "",
            sourceType: "custom_archive",
            dateRangeStr: vec.dateRangeStr || todayIST(),
            startTimestamp: Date.now(),
            endTimestamp: Date.now(),
            metadata: vec.metadata || {},
          });
          counts.vectors++;
        }
      }
    }

    return { success: true, restoredCounts: counts };
  }
}

export const memoryBackupService = new MemoryBackupService();
