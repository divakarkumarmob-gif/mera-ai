import { Router } from "express";
import { memoryEngine } from "../services/memoryEngine";
import { getHistory, clearHistory } from "../services/historyService";
import { vectorMemoryService } from "../services/vectorMemoryService";
import { smartMemoryRetrieverService } from "../services/smartMemoryRetrieverService";
import { memoryBackupService } from "../services/memoryBackupService";
import { appSecurityService } from "../services/appSecurityService";
import { bossRoutineService } from "../services/bossRoutineService";

export function createMemoryRouter(): Router {
  const router = Router();

  // ── Chat History Endpoints ────────────────────────────────────────────────
  router.get("/api/history", async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Number(req.query.limit) || 50, 200) : 50;
      const before = req.query.before ? Number(req.query.before) : undefined;
      res.json({ messages: await getHistory(limit, before) });
    } catch (e) {
      console.error("Failed to load history:", e);
      res.status(500).json({ error: "failed_to_load_history" });
    }
  });

  router.post("/api/history/clear", async (_req, res) => {
    try {
      await clearHistory();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_history" });
    }
  });

  // ── Core Memory Endpoints ──────────────────────────────────────────────────
  router.get("/api/memory", async (_req, res) => {
    try {
      res.json(await memoryEngine.getMemories());
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_memory" });
    }
  });

  router.post("/api/memory/clear", async (_req, res) => {
    try {
      await memoryEngine.clearAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_memory" });
    }
  });

  router.post("/api/memory/pin", async (req, res) => {
    try {
      const { fact } = req.body;
      if (fact) await memoryEngine.addPinnedMemory(fact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_pin_memory" });
    }
  });

  router.post("/api/memory/vault", async (req, res) => {
    try {
      const { category, exactFact } = req.body;
      if (exactFact) await memoryEngine.addPersonalVaultFact(category, exactFact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_save_vault" });
    }
  });

  // ── Vector Memory Semantic Search & Lifecycle ──────────────────────────────
  router.get("/api/memory/vector/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = req.query.limit ? Number(req.query.limit) : 5;
      const filterDate = req.query.date ? String(req.query.date).trim() : undefined;
      if (!q) return res.status(400).json({ ok: false, error: "query 'q' is required" });
      const searchRes = await vectorMemoryService.searchSemanticMemory(
        q,
        limit,
        0.15,
        filterDate ? { exactDate: filterDate } : undefined
      );
      res.json({ ok: true, ...searchRes });
    } catch (e) {
      res.status(500).json({ error: "failed_to_search_vector_memory" });
    }
  });

  router.get("/api/memory/live-session", async (_req, res) => {
    try {
      const { liveCircadianSessionService } = await import("../services/liveCircadianSessionService");
      res.json({ ok: true, session: liveCircadianSessionService.getStatus() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.get("/api/memory/whatsapp-session", async (_req, res) => {
    try {
      const { whatsappCircadianSessionService } = await import("../services/whatsapp/whatsappCircadianSessionService");
      const status = await whatsappCircadianSessionService.getStatus();
      res.json({ ok: true, whatsappSession: status });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.post("/api/memory/whatsapp-session/force-reset", async (_req, res) => {
    try {
      const { whatsappCircadianSessionService } = await import("../services/whatsapp/whatsappCircadianSessionService");
      const result = await whatsappCircadianSessionService.executeNightlyResetRoutine({ force: true });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.get("/api/memory/lifecycle/stats", async (_req, res) => {
    try {
      const vectorStats = await vectorMemoryService.getVectorStoreStats();
      const memories = await memoryEngine.getMemories();
      res.json({
        ok: true,
        stats: {
          pastSessionsCount: memories.pastSessionsCount,
          vectorStats,
          policy: {
            exactDialoguesDays: 4,
            comprehensiveSummariesDays: 60,
            permanentVectorArchivalDays: "60+",
            dailyUpdatesVerbatimDays: 30,
            liveScratchStreamHours: 24,
          },
        },
      });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_lifecycle_stats" });
    }
  });

  router.get("/api/memory/smart-retrieve", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "query 'q' is required" });
      const result = await smartMemoryRetrieverService.fetchMultiTierMemory(q);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: "failed_to_retrieve_smart_memory" });
    }
  });

  // ── Memory Decrypted Export & Restore ──────────────────────────────────────
  router.get("/api/memory/export/decrypted-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      const passkey = (req.query.key as string) || (req.headers["x-master-app-key"] as string);
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!passkey || passkey.trim() !== activeKey.trim())) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Unauthorized backup export attempt with invalid Master Key on ${req.path}`
        );
        return res.status(403).json({
          ok: false,
          error: "ACCESS_BLOCKED_IMMEDIATE",
          message: "🚨 Critical Intrusion: Wrong/missing Master App Key for decrypted backup. IP & Device blocked.",
        });
      }

      const backup = await memoryBackupService.exportDecryptedBackup();
      const filename = `friday_memory_backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(backup, null, 2));
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to export backup" });
    }
  });

  router.post("/api/memory/import/restore-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      const passkey = (req.query.key as string) || (req.headers["x-master-app-key"] as string) || req.body?.masterKey;
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!passkey || passkey.trim() !== activeKey.trim())) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Unauthorized backup restore attempt with invalid Master Key on ${req.path}`
        );
        return res.status(403).json({
          ok: false,
          error: "ACCESS_BLOCKED_IMMEDIATE",
          message: "🚨 Critical Intrusion: Wrong/missing Master App Key for memory restore. IP & Device blocked.",
        });
      }

      const backupData = req.body;
      if (!backupData || !backupData.version) {
        return res.status(400).json({ ok: false, error: "Invalid backup JSON payload" });
      }
      const result = await memoryBackupService.restoreAndReEncryptBackup(backupData);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to restore backup" });
    }
  });

  // ── Habit & Daily Timetable Routine Graph ──────────────────────────────────
  router.get("/api/routine", async (_req, res) => {
    try {
      const routine = await (bossRoutineService as any).getCurrentHabitGraph?.() || (bossRoutineService as any).getCurrentSlot?.() || {};
      res.json({ ok: true, routine });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/routine/update", async (req, res) => {
    try {
      const { day, timetable } = req.body || {};
      if (!day || !timetable) {
        return res.status(400).json({ ok: false, error: "day and timetable required" });
      }
      const updated = await (bossRoutineService as any).updateDayTimetable?.(day, timetable) || { success: true };
      res.json({ ok: true, updated });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
