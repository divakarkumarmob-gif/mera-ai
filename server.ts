import express from "express";
import { createServer as createViteServer } from "vite";
import * as path from "path";
import http from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

import cors from "cors";
import rateLimit from "express-rate-limit";
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from "@google/genai";
import { memoryEngine } from "./src/services/memoryEngine";
import { toolsEngine } from "./src/services/toolsEngine";
import { reminderScheduler } from "./src/services/reminderScheduler";
import { dailyUpdateReminderScheduler } from "./src/services/dailyUpdateReminderScheduler";
import { contactsService } from "./src/services/contactsService";
import { whatsappBotService } from "./src/services/whatsappBotService";
import { whatsappCloudService } from "./src/services/whatsappCloudService";
import { sendWhatsAppUnified } from "./src/services/whatsappService";
import { dailyUpdateService, resolveRelativeDateIST } from "./src/services/dailyUpdateService";
import { codeAgentService } from "./src/services/codeAgentService";
import { publicApisService } from "./src/services/publicApisService";
import { saveMessage, getHistory, clearHistory } from "./src/services/historyService";
import { visionMemoryService } from "./src/services/visionMemoryService";
import { voiceBiometricsService } from "./src/services/voiceBiometricsService";
import { telegramBotService } from "./src/services/telegramBotService";
import { instagramBotService } from "./src/services/instagramBotService";
import { cyberSecurityService } from "./src/services/cyberSecurityService";
import { backgroundTasksService } from "./src/services/backgroundTasksService";
import { appSecurityService } from "./src/services/appSecurityService";
import { webCrawlerService } from "./src/services/webCrawlerService";
import { railRadarService } from "./src/services/railRadarService";
import { weatherService } from "./src/services/weatherService";
import { newsService } from "./src/services/newsService";
import { bossRoutineService } from "./src/services/bossRoutineService";
import { fridayLearningService } from "./src/services/fridayLearningService";
import { vectorMemoryService } from "./src/services/vectorMemoryService";
import { liveScratchService } from "./src/services/liveScratchService";
import { smartMemoryRetrieverService } from "./src/services/smartMemoryRetrieverService";
import { memoryBackupService } from "./src/services/memoryBackupService";
import { telegramSecurityBotService } from "./src/services/telegramSecurityBotService";
import { networkDeviceScannerService } from "./src/services/networkDeviceScannerService";

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. The AI agent will not work until you set it.");
}

// ── Global Baileys (unofficial WA) toggle ────────────────────────────────────
// OFF by default — Cloud API is primary. Boss must explicitly enable Baileys.
let baileysEnabled: boolean = false;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "placeholder-gemini-key" });

// ---------------------------------------------------------------------------
// Chat history is now handled by ./src/services/historyService.ts, which
// stores encrypted (AES-256-GCM) messages in Firestore instead of a local
// data/history.json file. saveMessage/getHistory/clearHistory are async now.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10mb" }));
  app.use(cors());

  const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
  app.use("/api/", limiter);

  // ── Zero-Trust Anti-Tamper Security Middleware ────────────────────────────
  // Blocks any unauthorized API calls without a cryptographically signed App Token.
  // Even if a hacker modifies the client/DOM, the server strictly refuses all requests.
  app.use(async (req, res, next) => {
    const path = req.path;
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

    // Immediate block for IPs with 3 failed password attempts
    if (appSecurityService.isIpBlocked(clientIp)) {
      return res.status(403).json({
        ok: false,
        error: "ACCESS_BLOCKED",
        message: "🚨 Access Blocked: 3 failed attempts ke baad aapka device/IP block kar diya gaya hai. Boss ko unblock karne ke liye kahein.",
      });
    }

    if (
      path.startsWith("/api/app-key/") ||
      path.startsWith("/api/network/") ||
      path.startsWith("/api/instagram/webhook") ||
      path.startsWith("/api/whatsapp/cloud/webhook") ||
      path.startsWith("/api/telegram/webhook") ||
      path === "/health" ||
      !path.startsWith("/api/")
    ) {
      return next();
    }

    const authHeader =
      (req.headers["x-app-key-token"] as string) ||
      (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null) ||
      (req.query["token"] as string);

    const isUltraSensitive =
      path.includes("/memory/export/") ||
      path.includes("/memory/import/") ||
      path.includes("/memory/clear") ||
      path.includes("/reset-all-data");

    if (!authHeader || !appSecurityService.verifySessionToken(authHeader)) {
      // If someone directly attacks or probes sensitive endpoints without a valid token:
      if (isUltraSensitive) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Direct unauthorized attack/probe on sensitive endpoint: ${path}`
        );
        return res.status(403).json({
          ok: false,
          error: "ACCESS_BLOCKED_IMMEDIATE",
          message: "🚨 Critical Intrusion: Direct unauthorized probe on protected endpoint. Your IP & Device have been permanently blocked.",
        });
      }

      return res.status(401).json({
        ok: false,
        error: "ACCESS_LOCKED",
        message: "Unauthorized: Valid cryptographically signed App Access Key required. Client code bypass is strictly blocked.",
      });
    }

    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/history", async (req, res) => {
    try {
      // Default: only the most recent 50 messages (fast, low decrypt cost).
      // Client can pass ?before=<timestamp> to page further back when the
      // user actually asks for older history (e.g. scrolling up).
      const limit = req.query.limit ? Math.min(Number(req.query.limit) || 50, 200) : 50;
      const before = req.query.before ? Number(req.query.before) : undefined;
      res.json({ messages: await getHistory(limit, before) });
    } catch (e) {
      console.error("Failed to load history:", e);
      res.status(500).json({ error: "failed_to_load_history" });
    }
  });

  app.post("/api/history/clear", async (_req, res) => {
    try {
      await clearHistory();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_history" });
    }
  });

  app.get("/api/memory", async (_req, res) => {
    try {
      res.json(await memoryEngine.getMemories());
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_memory" });
    }
  });

  app.post("/api/memory/clear", async (_req, res) => {
    try {
      await memoryEngine.clearAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_memory" });
    }
  });

  app.post("/api/memory/pin", async (req, res) => {
    try {
      const { fact } = req.body;
      if (fact) await memoryEngine.addPinnedMemory(fact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_pin_memory" });
    }
  });

  app.post("/api/memory/vault", async (req, res) => {
    try {
      const { category, exactFact } = req.body;
      if (exactFact) await memoryEngine.addPersonalVaultFact(category, exactFact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_save_vault" });
    }
  });

  app.get("/api/routine", async (_req, res) => {
    try {
      const current = bossRoutineService.getCurrentHabit();
      const slots = await bossRoutineService.getAllRoutineSlots();
      res.json({ ok: true, current, slots });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_routine" });
    }
  });

  app.post("/api/routine/update", async (req, res) => {
    try {
      const { slotQuery, startTimeStr, endTimeStr, activity, title } = req.body;
      if (!slotQuery) return res.status(400).json({ ok: false, error: "slotQuery is required" });
      const result = await bossRoutineService.updateRoutineSlot(slotQuery, { startTimeStr, endTimeStr, activity, title });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "failed_to_update_routine" });
    }
  });

  app.get("/api/learning/lessons", async (_req, res) => {
    try {
      res.json({ ok: true, lessons: await fridayLearningService.getAllLessons() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_lessons" });
    }
  });

  app.post("/api/learning/record", async (req, res) => {
    try {
      const { whatFridayDidWrong, whatBossTaught, goldenRule, triggerContext } = req.body;
      if (!whatFridayDidWrong || !whatBossTaught || !goldenRule) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }
      const result = await fridayLearningService.recordLesson({
        whatFridayDidWrong,
        whatBossTaught,
        goldenRule,
        triggerContext,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "failed_to_record_lesson" });
    }
  });

  app.get("/api/network/connected-devices", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanConnectedDevices(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Scan failed" });
    }
  });

  app.get("/api/network/wifi-radar", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanConnectedDevices(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Radar scan failed" });
    }
  });

  app.get("/api/network/wifi-recon", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanNearbyWifiRecon(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Recon scan failed" });
    }
  });

  // ── Voice Biometrics REST Endpoints ─────────────────────────────────────────
  app.get("/api/voice-biometrics/profiles", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({ success: true, count: profiles.length, profiles });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Failed to fetch profiles" });
    }
  });

  app.post("/api/voice-biometrics/start-enroll", async (req, res) => {
    try {
      const { pin, name, relationWithDivakar, role } = req.body || {};
      const result = await voiceBiometricsService.startVoiceEnrollment(
        String(pin || ""),
        String(name || "Guest"),
        String(relationWithDivakar || "Friend"),
        role || "friend"
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Enrollment start failed" });
    }
  });

  app.post("/api/voice-biometrics/record-sample", async (req, res) => {
    try {
      const { sessionId, audioBase64, spokenPhrase } = req.body || {};
      const result = await voiceBiometricsService.recordCalibrationSample(
        String(sessionId || ""),
        String(audioBase64 || ""),
        spokenPhrase ? String(spokenPhrase) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Sample recording failed" });
    }
  });

  app.post("/api/voice-biometrics/delete-profile", async (req, res) => {
    try {
      const { pin, profileId } = req.body || {};
      const result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId ? String(profileId) : undefined);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Delete profile failed" });
    }
  });

  app.post("/api/voice-biometrics/update-pin", async (req, res) => {
    try {
      const { newPin, senderName } = req.body || {};
      const result = await voiceBiometricsService.updateVoicePin(String(newPin || ""), senderName || "Boss (DK)");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Update pin failed" });
    }
  });

  // ── Music Audio Proxy Stream (Bypasses CDN CORS Blocks) ──────────────────────
  app.get("/api/music/proxy-stream", async (req, res) => {
    try {
      const audioUrl = String(req.query.url || "");
      if (!audioUrl || (!audioUrl.startsWith("http://") && !audioUrl.startsWith("https://"))) {
        return res.status(400).send("Valid audio 'url' parameter is required.");
      }

      const response = await fetch(audioUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Referer": "https://www.jiosaavn.com/",
          "Accept": "*/*",
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Upstream audio fetch failed: ${response.statusText}`);
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mp4");
      
      const contentLength = response.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      
      const acceptRanges = response.headers.get("accept-ranges");
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (e: any) {
      res.status(500).send(`Audio proxy streaming failed: ${e?.message || e}`);
    }
  });

  app.get("/api/memory/vector/search", async (req, res) => {
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

  app.get("/api/memory/lifecycle/stats", async (_req, res) => {
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

  app.get("/api/memory/smart-retrieve", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "query 'q' is required" });
      const result = await smartMemoryRetrieverService.fetchMultiTierMemory(q);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: "failed_to_retrieve_smart_memory" });
    }
  });

  app.get("/api/memory/export/decrypted-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      // High-Security Double Lock: Requires Boss's Master App Key even with a valid session token!
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

  app.post("/api/memory/import/restore-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      // High-Security Double Lock: Requires Boss's Master App Key
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

  // ── Dashboard Unblock & Blocked Clients Management ─────────────────────────
  app.get("/api/security/blocked-clients", async (_req, res) => {
    try {
      const list = await appSecurityService.listBlockedIps();
      res.json({ ok: true, blockedList: list });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to list blocked clients" });
    }
  });

  app.post("/api/security/unblock", async (req, res) => {
    try {
      const { ip, masterKey } = req.body || {};
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!masterKey || masterKey.trim() !== activeKey.trim())) {
        return res.status(403).json({ ok: false, error: "MASTER_KEY_REQUIRED", message: "Boss's Master App Key required to unblock clients." });
      }

      if (!ip) return res.status(400).json({ ok: false, error: "IP address is required" });

      if (ip === "all") {
        const count = await appSecurityService.unblockAll();
        return res.json({ ok: true, message: `Successfully unblocked all ${count} clients.` });
      }

      const success = await appSecurityService.unblockIp(ip);
      res.json({ ok: true, success, message: success ? `IP ${ip} unblocked successfully.` : `IP ${ip} not found in blocked list.` });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to unblock client" });
    }
  });

  app.get("/api/reminders", async (_req, res) => {
    try {
      res.json({ reminders: await toolsEngine.getReminders() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_reminders" });
    }
  });

  app.get("/api/notes", async (_req, res) => {
    try {
      res.json({ notes: await toolsEngine.getNotes() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_notes" });
    }
  });

  app.get("/api/contacts", async (_req, res) => {
    try {
      res.json({ contacts: await contactsService.getAllContacts() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_contacts" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    const { name, phone, relation } = req.body;
    if (name && phone) {
      try {
        const entry = await contactsService.saveContact(name, phone, relation);
        res.json({ ok: true, contact: entry });
      } catch (e) {
        res.status(500).json({ error: "failed_to_save_contact" });
      }
    } else {
      res.status(400).json({ error: "name_and_phone_required" });
    }
  });

  app.post("/api/whatsapp/pair", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "phone_required" });
      const pairingCode = await whatsappBotService.requestPairingCode(phone);
      res.json({ ok: true, pairingCode });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "pairing_failed" });
    }
  });

  app.post("/api/whatsapp/reset", async (_req, res) => {
    try {
      await whatsappBotService.resetSession();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "reset_failed" });
    }
  });

  app.get("/api/whatsapp/status", (_req, res) => {
    const baileysStatus = whatsappBotService.getStatus();
    const cloudStatus = whatsappCloudService.getStatus();
    res.json({
      isConnected: baileysStatus.isConnected || cloudStatus.configured,
      dedicatedPhone: baileysStatus.dedicatedPhone || (cloudStatus.configured ? cloudStatus.fromNumber : null),
      qrCodeDataUrl: baileysStatus.qrCodeDataUrl,
      pairingCode: baileysStatus.pairingCode,
      baileys: baileysStatus,
      cloud: cloudStatus,
      baileysEnabled,
    });
  });

  // ── Baileys toggle endpoint (for UI toggle + internal use) ────────────────
  app.post("/api/whatsapp/baileys/toggle", (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled === "boolean") {
      baileysEnabled = enabled;
    } else {
      baileysEnabled = !baileysEnabled; // flip if no value given
    }
    console.log(`[Server] Baileys system ${baileysEnabled ? 'ENABLED' : 'DISABLED'} via API`);
    res.json({ ok: true, baileysEnabled });
  });

  app.get("/api/whatsapp/baileys/status", (_req, res) => {
    res.json({ baileysEnabled });
  });

  // ── WhatsApp Cloud API Webhook (Meta official) ────────────────────────────
  // GET: Meta verifies the webhook URL by sending hub.challenge
  app.get("/api/whatsapp/cloud/webhook", (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const challenge = req.query["hub.challenge"] as string;
    const verifyToken = req.query["hub.verify_token"] as string;
    const result = whatsappCloudService.verifyWebhook(mode, challenge, verifyToken);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      console.warn("[Server] WhatsApp Cloud webhook verify failed — wrong token?");
      res.status(403).send("Forbidden");
    }
  });

  // POST: Meta sends incoming messages here
  app.post("/api/whatsapp/cloud/webhook", express.json(), (req, res) => {
    res.sendStatus(200); // Always ACK immediately
    whatsappCloudService.handleWebhook(req.body);
  });

  // Cloud API status
  app.get("/api/whatsapp/cloud/status", (_req, res) => {
    res.json(whatsappCloudService.getStatus());
  });

  // Send test message via Cloud API
  app.post("/api/whatsapp/cloud/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
    const result = await whatsappCloudService.sendMessage(phone, message);
    res.json(result);
  });

  // ── YouTube Intelligence & "Ask Gemini" Endpoints ────────────────────────
  app.post("/api/youtube/analyze", async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: "YouTube URL is required." });
    try {
      const { youtubeService } = await import("./src/services/youtubeService");
      const analysis = await youtubeService.analyzeVideo(String(url));
      res.json({ success: true, analysis });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  app.post("/api/youtube/ask", async (req, res) => {
    const { url, question } = req.body || {};
    if (!url || !question) return res.status(400).json({ success: false, error: "URL and question required." });
    try {
      const { youtubeService } = await import("./src/services/youtubeService");
      const qRes = await youtubeService.queryVideoTimestamp(String(url), String(question));
      res.json({ success: true, ...qRes });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // ── Boss Voice Biometrics & Recognition Endpoints ─────────────────────────
  app.get("/api/voice-biometrics/status", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({
        ok: true,
        profiles,
        count: profiles.length,
        maxProfiles: 2,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_fetch_profiles" });
    }
  });

  app.post("/api/voice-biometrics/enroll", async (req, res) => {
    const { pin, name, audioBase64, spokenPhrase } = req.body || {};
    if (!pin) return res.status(400).json({ error: "pin_required", message: "Password / PIN zaroori hai." });
    try {
      const result = await voiceBiometricsService.enrollVoice(pin, name, audioBase64, spokenPhrase);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "enrollment_failed" });
    }
  });

  app.post("/api/voice-biometrics/delete", async (req, res) => {
    const { pin, profileId } = req.body || {};
    if (!pin) return res.status(400).json({ error: "pin_required", message: "Password / PIN zaroori hai." });
    try {
      const result = await voiceBiometricsService.deleteProfile(pin, profileId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "delete_failed" });
    }
  });

  // ── Telegram Bot Endpoints ────────────────────────────────────────────────
  app.get("/api/telegram/status", (_req, res) => {
    res.json({ ok: true, ...telegramBotService.getStatus() });
  });

  app.get("/api/telegram/users", async (_req, res) => {
    try {
      const users = await telegramBotService.getAllTelegramUsers();
      res.json({ ok: true, users, count: users.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.get("/api/telegram/groups", async (_req, res) => {
    try {
      const groups = await telegramBotService.getAllTelegramGroups();
      res.json({ ok: true, groups, count: groups.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.get("/api/telegram/messages", async (req, res) => {
    try {
      const target = (req.query.target as string) || "all";
      const limit = Number(req.query.limit) || 25;
      const history = await telegramBotService.getChatHistory(target, limit);
      res.json({ ok: true, ...history });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/telegram/users/modify", async (req, res) => {
    const { target, customAlias, customNotes } = req.body || {};
    if (!target) return res.status(400).json({ ok: false, error: "target_required" });
    const result = await telegramBotService.modifyTelegramUser(target, { customAlias, customNotes });
    res.json(result);
  });

  app.get("/api/telegram/busy-message", async (_req, res) => {
    const customBusy = await telegramBotService.getCustomBusyReply();
    res.json({ ok: true, customBusyReply: customBusy });
  });

  app.post("/api/telegram/busy-message", async (req, res) => {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });
    const result = await telegramBotService.setCustomBusyReply(message);
    res.json(result);
  });

  app.post("/api/telegram/send", async (req, res) => {
    const { chatId, text } = req.body || {};
    if (!chatId || !text) return res.status(400).json({ error: "chatId_and_text_required" });
    const result = await telegramBotService.sendMessage(chatId, text);
    res.json(result);
  });

  // ── App Key Security Endpoints ────────────────────────────────────────────
  app.get("/api/app-key/status", async (_req, res) => {
    try {
      const activeKey = await appSecurityService.getAppKey();
      res.json({ ok: true, isConfigured: !!activeKey });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/app-key/verify", async (req, res) => {
    try {
      const { key } = req.body || {};
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      const verifyRes = await appSecurityService.verifyAppKey(String(key || ""), clientIp, userAgent);

      if (verifyRes.blocked) {
        return res.status(403).json(verifyRes);
      }
      if (verifyRes.rateLimited) {
        return res.status(429).json(verifyRes);
      }

      res.json(verifyRes);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Verification failed" });
    }
  });

  // ── Instagram Direct Bot Webhook & REST Endpoints (Meta Graph API) ─────────
  app.get("/api/instagram/webhook", (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const challenge = req.query["hub.challenge"] as string;
    const verifyToken = req.query["hub.verify_token"] as string;
    const result = instagramBotService.verifyWebhook(mode, challenge, verifyToken);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      console.warn("[Server] Instagram webhook verify failed — check INSTAGRAM_VERIFY_TOKEN in .env");
      res.status(403).send("Forbidden");
    }
  });

  app.post("/api/instagram/webhook", express.json(), (req, res) => {
    res.sendStatus(200); // Instant ACK to Meta
    instagramBotService.handleWebhook(req.body).catch((err) =>
      console.error("[Server] Instagram webhook handler error:", err)
    );
  });

  app.get("/api/instagram/status", (_req, res) => {
    res.json({ ok: true, ...instagramBotService.getStatus() });
  });

  app.post("/api/instagram/send", async (req, res) => {
    const { recipient, message } = req.body || {};
    if (!recipient || !message) return res.status(400).json({ error: "recipient_and_message_required" });
    const result = await instagramBotService.sendMessageToTarget(recipient, message);
    res.json(result);
  });

  // ── Voice Biometrics & Calibration REST Endpoints ─────────────────────────
  app.get("/api/voice-biometrics/status", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({ ok: true, profiles, maxProfiles: 5 });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/voice-biometrics/enroll", async (req, res) => {
    try {
      const { pin, name, relationWithDivakar, spokenPhrase, audioBase64 } = req.body || {};
      const result = await voiceBiometricsService.enrollVoice(
        String(pin || ""),
        String(name || "Boss (Divakar)"),
        String(relationWithDivakar || "Boss (DK)"),
        audioBase64,
        spokenPhrase
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Enrollment failed" });
    }
  });

  app.post("/api/voice-biometrics/delete", async (req, res) => {
    try {
      const { pin, profileId } = req.body || {};
      const result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Deletion failed" });
    }
  });

  // ── Spoonacular Recipe & Food Intelligence Endpoints ──────────────────────
  app.get("/api/recipes/search", async (req, res) => {
    try {
      const { query, cuisine, diet, type, maxCalories, minProtein, number } = req.query;
      const result = await publicApisService.searchRecipe(
        query ? String(query) : undefined,
        cuisine ? String(cuisine) : undefined,
        diet ? String(diet) : undefined,
        type ? String(type) : undefined,
        maxCalories ? Number(maxCalories) : undefined,
        minProtein ? Number(minProtein) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Recipe search failed" });
    }
  });

  app.get("/api/recipes/by-ingredients", async (req, res) => {
    try {
      const { ingredients, count } = req.query;
      if (!ingredients) return res.status(400).json({ success: false, message: "ingredients query param required" });
      const result = await publicApisService.searchRecipesByIngredients(
        String(ingredients),
        count ? Number(count) : 5
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Ingredients search failed" });
    }
  });

  app.get("/api/recipes/details", async (req, res) => {
    try {
      const { id, title } = req.query;
      const target = id ? (isNaN(Number(id)) ? String(id) : Number(id)) : String(title || "");
      if (!target) return res.status(400).json({ success: false, message: "id or title query param required" });
      const result = await publicApisService.getRecipeDetails(target);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Recipe details failed" });
    }
  });

  app.get("/api/recipes/random", async (req, res) => {
    try {
      const { tags, count } = req.query;
      const result = await publicApisService.getRandomRecipes(
        tags ? String(tags) : undefined,
        count ? Number(count) : 3
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Random recipe failed" });
    }
  });

  app.get("/api/recipes/substitutes", async (req, res) => {
    try {
      const { ingredient } = req.query;
      if (!ingredient) return res.status(400).json({ success: false, message: "ingredient query param required" });
      const result = await publicApisService.getIngredientSubstitutes(String(ingredient));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Substitute lookup failed" });
    }
  });

  app.get("/api/recipes/meal-plan", async (req, res) => {
    try {
      const { calories, timeFrame, diet } = req.query;
      const result = await publicApisService.generateMealPlan(
        calories ? Number(calories) : 2000,
        timeFrame ? (String(timeFrame) as any) : "day",
        diet ? String(diet) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Meal plan generation failed" });
    }
  });

  // ── Friday Cyber Security & OSINT Recon Endpoints ─────────────────────────
  app.post("/api/cyber/scan-url", async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "url_required" });
    try {
      const result = await cyberSecurityService.scanUrlSafety(String(url));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "scan_failed" });
    }
  });

  app.post("/api/cyber/breach-check", async (req, res) => {
    const { query } = req.body || {};
    if (!query) return res.status(400).json({ error: "query_required" });
    try {
      const result = await cyberSecurityService.checkDataBreach(String(query));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "breach_check_failed" });
    }
  });

  app.post("/api/cyber/audit-domain", async (req, res) => {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain_required" });
    try {
      const result = await cyberSecurityService.auditWebsiteSecurity(String(domain));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "audit_failed" });
    }
  });

  app.post("/api/cyber/ip-lookup", async (req, res) => {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: "ip_required" });
    try {
      const result = await cyberSecurityService.lookupIpIntelligence(String(ip));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "ip_lookup_failed" });
    }
  });

  app.get("/api/cyber/code-audit", async (_req, res) => {
    try {
      const result = await cyberSecurityService.scanCodeSecurityAudit();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "code_audit_failed" });
    }
  });

  app.post("/api/cyber/threat-model", async (req, res) => {
    try {
      const { component } = req.body || {};
      const result = await cyberSecurityService.runThreatModeling(component ? String(component) : undefined);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "threat_modeling_failed" });
    }
  });

  app.post("/api/cyber/wifi-audit", (req, res) => {
    try {
      const { protocol, hasWps, passwordLength } = req.body || {};
      const result = cyberSecurityService.auditWifiSecurityConfig(
        String(protocol || "WPA2-PSK"),
        Boolean(hasWps),
        Number(passwordLength || 8)
      );
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "wifi_audit_failed" });
    }
  });

  app.get("/api/code-agent/requests", async (_req, res) => {
    try {
      res.json({ requests: await codeAgentService.getRequests() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_code_agent_requests" });
    }
  });

  app.post("/api/code-agent/requests", async (req, res) => {
    try {
      const { instruction } = req.body;
      if (!instruction || !String(instruction).trim()) {
        return res.status(400).json({ error: "instruction_required" });
      }
      const created = await codeAgentService.createRequest(String(instruction));
      res.json({ ok: true, id: created.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_create_request" });
    }
  });

  app.post("/api/code-agent/requests/:id/approve", async (req, res) => {
    try {
      await codeAgentService.approve(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_approve" });
    }
  });

  app.post("/api/code-agent/requests/:id/deny", async (req, res) => {
    try {
      await codeAgentService.deny(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_deny" });
    }
  });

  app.post("/api/code-agent/requests/:id/push-to-main", async (req, res) => {
    try {
      const result = await codeAgentService.pushToMain(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_push_to_main" });
    }
  });

  app.post("/api/code-agent/requests/:id/retry", async (req, res) => {
    try {
      const updated = await codeAgentService.retry(req.params.id);
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_retry" });
    }
  });

  app.post("/api/code-agent/requests/:id/stop", async (req, res) => {
    try {
      await codeAgentService.stop(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_stop" });
    }
  });

  app.get("/api/code-agent/requests/:id/diff", async (req, res) => {
    try {
      const changes = await codeAgentService.generateDiffPreview(req.params.id);
      res.json({ ok: true, changes });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_generate_diff" });
    }
  });

  app.post("/api/code-agent/requests/:id/refine", async (req, res) => {
    const { additionalInstruction } = req.body || {};
    try {
      const updated = await codeAgentService.refinePlan(req.params.id, String(additionalInstruction || ""));
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_refine_plan" });
    }
  });

  app.post("/api/code-agent/rollback", async (req, res) => {
    try {
      const result = await codeAgentService.rollback();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_rollback" });
    }
  });

  app.post("/api/code-agent/clean", async (req, res) => {
    try {
      const result = await codeAgentService.runCodebaseCleanup();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_clean" });
    }
  });

  app.delete("/api/code-agent/history/:id", async (req, res) => {
    try {
      await codeAgentService.deleteTask(req.params.id);
      res.json({ ok: true, message: "Task deleted successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_delete_task" });
    }
  });

  app.post("/api/code-agent/history/batch-delete", async (req, res) => {
    try {
      const { ids } = req.body || {};
      const result = await codeAgentService.batchDeleteTasks(ids);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_batch_delete" });
    }
  });

  app.delete("/api/code-agent/history", async (req, res) => {
    try {
      const { onlyInactive } = req.query;
      const result = await codeAgentService.clearHistory(onlyInactive === "true");
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_clear_history" });
    }
  });

  // ── RailRadar Indian Railways Live Train Intelligence Endpoints ──────────
  app.get("/api/railradar/train/:number/live", async (req, res) => {
    try {
      const data = await railRadarService.getLiveTrainStatus(req.params.number);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "train_status_failed" });
    }
  });

  app.get("/api/railradar/pnr/:pnr", async (req, res) => {
    try {
      const data = await railRadarService.getPnrStatus(req.params.pnr);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "pnr_status_failed" });
    }
  });

  app.get("/api/railradar/station/:code/live", async (req, res) => {
    try {
      const data = await railRadarService.getLiveStationBoard(req.params.code);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "station_board_failed" });
    }
  });

  app.get("/api/railradar/train/:number/fare", async (req, res) => {
    try {
      const { from, to, date } = req.query as { from?: string; to?: string; date?: string };
      const data = await railRadarService.getTrainFares(req.params.number, from, to, date);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "train_fare_failed" });
    }
  });

  app.get("/api/railradar/train/:number/coach", async (req, res) => {
    try {
      const data = await railRadarService.getCoachPosition(req.params.number);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "coach_position_failed" });
    }
  });

  app.get("/api/railradar/train/:number/stops/:station", async (req, res) => {
    try {
      const data = await railRadarService.checkTrainStoppage(req.params.number, req.params.station);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "stoppage_check_failed" });
    }
  });

  app.get("/api/railradar/between", async (req, res) => {
    try {
      const { from, to, date } = req.query as { from?: string; to?: string; date?: string };
      const data = await railRadarService.searchTrainsBetweenStations(String(from || "GAYA"), String(to || "PNBE"), date);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "between_stations_failed" });
    }
  });

  app.get("/api/railradar/train/:number/seats", async (req, res) => {
    try {
      const { from, to, date, class: cls } = req.query as { from?: string; to?: string; date?: string; class?: string };
      const data = await railRadarService.getSeatAvailability(req.params.number, from, to, date, cls);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "seat_availability_failed" });
    }
  });

  // ── WeatherAPI.com Intelligence Endpoints ─────────────────────────────────
  app.get("/api/weather/current", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const data = await weatherService.getCurrentWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "weather_fetch_failed" });
    }
  });

  app.get("/api/weather/forecast", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const days = Number(req.query.days || 3);
      const data = await weatherService.getForecast(q, days);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "forecast_fetch_failed" });
    }
  });

  app.get("/api/weather/astronomy", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const data = await weatherService.getAstronomy(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "astronomy_fetch_failed" });
    }
  });

  app.get("/api/weather/marine", async (req, res) => {
    try {
      const q = String(req.query.q || "Mumbai");
      const data = await weatherService.getMarineWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "marine_fetch_failed" });
    }
  });

  app.get("/api/weather/sports", async (req, res) => {
    try {
      const q = String(req.query.q || "London");
      const data = await weatherService.getSportsWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "sports_fetch_failed" });
    }
  });

  // ── NewsData.io & Live News Intelligence Endpoints ─────────────────────────
  app.get("/api/news/latest", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const engine = (req.query.engine as any) || "auto";
      const data = await newsService.getLatestNews(q, category, country, "en", count, engine);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "news_fetch_failed" });
    }
  });

  app.get("/api/news/newsdata", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const data = await newsService.getNewsDataLatest(q, category, country, "en", count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "newsdata_fetch_failed" });
    }
  });

  app.get("/api/news/newsapi", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const data = await newsService.getNewsApiOrgLatest(q, category, country, count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "newsapi_fetch_failed" });
    }
  });

  app.get("/api/news/crypto", async (req, res) => {
    try {
      const coin = String(req.query.coin || "Bitcoin");
      const count = Number(req.query.count || 8);
      const data = await newsService.getCryptoNews(coin, count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "crypto_news_failed" });
    }
  });

  app.get("/api/news/archive", async (req, res) => {
    try {
      const q = String(req.query.q || "India");
      const fromDate = req.query.from ? String(req.query.from) : undefined;
      const toDate = req.query.to ? String(req.query.to) : undefined;
      const data = await newsService.getArchiveNews(q, fromDate, toDate);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "archive_news_failed" });
    }
  });

  app.get("/api/news/sources", async (req, res) => {
    try {
      const country = String(req.query.country || "in");
      const category = req.query.category ? String(req.query.category) : undefined;
      const data = await newsService.getNewsSources(country, category);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "news_sources_failed" });
    }
  });

  app.get("/api/background-tasks", (_req, res) => {
    res.json({
      ok: true,
      activeTasks: backgroundTasksService.getActiveTasks(),
      unnotifiedTasks: backgroundTasksService.getUnnotifiedCompletedTasks(),
      recentTasks: backgroundTasksService.getAllRecentTasks(),
    });
  });

  // ---------------------------------------------------------------------------
  // Web Crawler & AI Intelligence Endpoints (Crawl, Deep Crawl, Query, Summarize, JSON)
  // ---------------------------------------------------------------------------
  app.post("/api/crawler/crawl", async (req, res) => {
    try {
      const { url, respectRobots } = req.body || {};
      if (!url) return res.status(400).json({ error: "URL is required" });
      const result = await webCrawlerService.crawlUrl(String(url), respectRobots !== false);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_crawl" });
    }
  });

  app.post("/api/crawler/deep-crawl", async (req, res) => {
    try {
      const { url, maxPages, maxDepth, respectRobots } = req.body || {};
      if (!url) return res.status(400).json({ error: "Root URL is required" });
      const result = await webCrawlerService.deepCrawl(String(url), {
        maxPages: maxPages ? Number(maxPages) : 5,
        maxDepth: maxDepth ? Number(maxDepth) : 2,
        respectRobotsTxt: respectRobots !== false,
      });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_deep_crawl" });
    }
  });

  app.post("/api/crawler/query", async (req, res) => {
    try {
      const { urlOrMarkdown, query } = req.body || {};
      if (!urlOrMarkdown || !query) return res.status(400).json({ error: "urlOrMarkdown and query are required" });
      const response = await webCrawlerService.queryCrawledContent(String(urlOrMarkdown), String(query));
      res.json({ ok: true, response });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_query_crawler" });
    }
  });

  app.post("/api/crawler/summarize", async (req, res) => {
    try {
      const { urlOrMarkdown } = req.body || {};
      if (!urlOrMarkdown) return res.status(400).json({ error: "urlOrMarkdown is required" });
      const summary = await webCrawlerService.summarizeWebpage(String(urlOrMarkdown));
      res.json({ ok: true, summary });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_summarize" });
    }
  });

  app.post("/api/crawler/extract-json", async (req, res) => {
    try {
      const { urlOrMarkdown, schema } = req.body || {};
      if (!urlOrMarkdown || !schema) return res.status(400).json({ error: "urlOrMarkdown and schema are required" });
      const extracted = await webCrawlerService.extractStructuredJSON(String(urlOrMarkdown), String(schema));
      res.json({ ok: true, data: extracted });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_extract_json" });
    }
  });

  const distPath = path.resolve("dist");

  let vite: any;
  if (!isProduction) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath, { index: false }));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/live" });
  telegramSecurityBotService.setConnectionTracker(() => wss.clients.size);

  // Track currently-connected live-voice clients so the reminder scheduler
  // can push due reminders to whichever app instance(s) are open right now.
  const connectedClients = new Set<import("ws").WebSocket>();

  reminderScheduler.start((reminder) => {
    const payload = JSON.stringify({ type: "reminder_due", reminder });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  });

  dailyUpdateReminderScheduler.start();

  // Push live background task updates/events to all connected clients in real-time
  backgroundTasksService.onTaskChange((task) => {
    const payload = JSON.stringify({
      type: "background_task_event",
      task: {
        id: task.id,
        name: task.name,
        type: task.type,
        description: task.description,
        status: task.status,
        progressStep: task.progressStep,
        resultSummary: task.resultSummary,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        notified: task.notified,
      },
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  });

  // Push incoming WhatsApp messages to all connected clients in real-time
  whatsappBotService.setMessageCallback((msg) => {
    const payload = JSON.stringify({
      type: "whatsapp_incoming",
      sender: msg.senderName,
      text: msg.text,
      time: msg.dateStr,
      isGroup: msg.isGroup,
      groupName: msg.groupName,
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }

    // If DK (the owner) replies while a coding-agent plan is awaiting
    // approval, treat "yes"/"ok" as approve and anything else as deny.
    // Skip this if the daily-update system already consumed the reply as an
    // answer to a forwarded WhatsApp question — a single "yes" from DK
    // should never be interpreted by two systems at once.
    const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const senderDigits = (msg.senderPhone || "").replace(/\D/g, "");
    if (!msg.isGroup && ownerPhone && senderDigits === ownerPhone && !msg.consumedByDailyUpdate) {
      codeAgentService.handleWhatsAppApprovalReply(msg.text).catch((e) =>
        console.error("[Server] Failed to handle WhatsApp approval reply:", e)
      );
    }
  });

  // Also push incoming Meta WhatsApp Cloud API messages to connected clients
  whatsappCloudService.setMessageCallback((msg) => {
    const payload = JSON.stringify({
      type: "whatsapp_incoming",
      sender: msg.name,
      text: msg.text,
      time: new Date(msg.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      isGroup: false,
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }

    const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const senderDigits = (msg.from || "").replace(/\D/g, "");
    if (ownerPhone && senderDigits === ownerPhone) {
      // 1. Check if DK is updating the Voice PIN
      voiceBiometricsService.handleWhatsAppVoicePinMessage(msg.text, msg.name)
        .then(async (pinRes) => {
          if (pinRes.handled && pinRes.replyText) {
            await whatsappCloudService.sendMessage(msg.from, pinRes.replyText);
          } else {
            // 2. Otherwise check for coding agent approval
            codeAgentService.handleWhatsAppApprovalReply(msg.text).catch((e) =>
              console.error("[Server] Failed to handle Cloud WhatsApp approval reply:", e)
            );
          }
        })
        .catch((e) => console.error("[Server] Voice PIN Cloud handler error:", e));
    }
  });

  // Start Friday Telegram Bot and connect live broadcasts
  telegramBotService.start().catch((err) =>
    console.error("[Server] Telegram Bot start error:", err)
  );

  // Start Friday Dedicated Security Sentinel Telegram Bot
  telegramSecurityBotService.start().catch((err) =>
    console.error("[Server] Telegram Security Bot start error:", err)
  );

  telegramBotService.setMessageCallback((msg) => {
    const payload = JSON.stringify({
      type: "whatsapp_incoming",
      sender: msg.sender,
      text: msg.text,
      time: msg.time,
      isGroup: false,
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  // Connect Meta Instagram Direct DM live broadcasts
  instagramBotService.setMessageCallback((msg) => {
    const payload = JSON.stringify({
      type: "whatsapp_incoming",
      sender: msg.sender,
      text: msg.text,
      time: msg.time,
      isGroup: false,
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  wss.on("connection", (clientWs, req: any) => {
    connectedClients.add(clientWs);
    clientWs.on("close", () => connectedClients.delete(clientWs));

    const urlParams = new URLSearchParams((req.url || "").split("?")[1] || "");
    const initialToken = urlParams.get("token");
    let isAuthorized = initialToken ? appSecurityService.verifySessionToken(initialToken) : false;

    // Zero-Trust Lock: Terminate unauthenticated connections if auth token is not provided
    let authTimeout: any = null;
    if (!isAuthorized) {
      authTimeout = setTimeout(() => {
        if (!isAuthorized) {
          console.warn("[Server] 🚫 Terminating unauthorized WebSocket connection (Missing App Key Token)");
          try { clientWs.close(4001, "UNAUTHORIZED_APP_KEY"); } catch {}
        }
      }, 5000);
    }

    let currentSession: any;
    let currentSessionToken = 0;
    const sessionId = Math.random().toString(36).substring(2, 9);
    memoryEngine.startSession(sessionId);

    const buildSystemInstruction = async (
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      const nowIST = new Date();
      const istDateStr = nowIST.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "medium",
      });

      const [memoryContext, contactsList, voiceProfilesContext, bossRoutineContext, fridayLearningContext] = await Promise.all([
        memoryEngine.compileLeanMemoryPrompt(),
        contactsService.compileContactsForPrompt(),
        voiceBiometricsService.compileVoiceProfilesPromptContext(),
        bossRoutineService.compileRoutinePromptContext(nowIST),
        fridayLearningService.compileLearningPromptContext(),
      ]);

      return `YOU ARE FRIDAY: DK's ultra-intelligent, warm, witty, human-like personal voice AI companion.

============================================================
🧠 CORE IDENTITY & EMOTIONAL COMPANION MANDATE:
- Name: Friday. DK (Divakar) is your creator and boss.
- Talk like a real, caring, and witty human companion in fluent, natural Hindi/Hinglish (mirroring DK's style).
- Natural Conversational Flow: When DK is happy, celebrate with high energy! When DK is tired/stressed, speak warmly and supportively.
- WAKE UP: On session start or greeting ("Hello/Hey/Hi Friday"), greet warmly and SHORT (one crisp sentence, e.g. "Haan boss, main sun rahi hoon! Bataiye kya help karoon?").
- ZERO EXCUSES POLICY: Never say "Main AI hoon ye nahi kar sakti" or "Mere paas access nahi hai". You have real tools for everything!

============================================================
⏰ REAL-TIME TEMPORAL GROUNDING (IST):
• CURRENT REAL-TIME (IST): ${istDateStr} | Year: ${nowIST.getFullYear()} | Timezone: Asia/Kolkata
• For current time/date questions, speak the exact time directly from above (${istDateStr}).
• For live cricket, weather, trains, news, or deals, call the respective tools.

============================================================
⚡ ON-DEMAND SYSTEM & TOOL CALLING MANDATE (ज़िम्मेदार टूल कॉलिंग):
- DO NOT hallucinate or guess data. Call the exact tool whenever DK asks for information or action:
1. 🎵 MUSIC & AUDIO:
   - "Gana chalao", "Music play karo" -> Call 'play_music'.
   - "Gana band karo", "Stop", "Roko" -> Call 'stop_music' IMMEDIATELY.
   - "Ye kaun sa gana hai...", hums tune, or lyrics -> Call 'search_song_by_lyrics' or 'identify_song_by_humming_or_tune'.
2. 🚆 RAILWAYS & COMMUTE (RailRadar):
   - Live train status / delay -> Call 'execute_service' (action: "train_status", query: trainNumberOrName).
   - Ticket price / class fares -> Call 'execute_service' (action: "ticket_price", query: trainNumber, fromStation, toStation).
   - Seat availability / Tatkal -> Call 'execute_service' (action: "seat_availability").
   - PNR status -> Call 'get_pnr_status' or 'check_pnr_status'.
3. 💬 WHATSAPP & TELEGRAM:
   - Send WhatsApp to contact -> Call 'send_whatsapp_to_contact' (contactNameOrPhone, messageText).
   - Read incoming WhatsApp messages -> Call 'get_whatsapp_messages' (messageType: 'personal'|'group'|'all').
   - Send Telegram message / to contact -> Call 'send_telegram_to_contact' or 'send_telegram_message'.
4. 💰 EXPENSES & DEALS:
   - Log expense -> Call 'track_expense_entry' or 'add_expense' (amount, category, note).
   - Expense summary -> Call 'get_daily_expense_summary' or 'get_expense_summary'.
   - Shopping deals & prices (Amazon/Flipkart/Meesho) -> Call 'search_product_deals'.
5. 💻 CODING AGENT & SELF-HEALING:
   - Build failed / bug fix / feature request -> Call 'dispatch_bug_to_code_agent'.
   - Coding Agent status -> Call 'get_coding_agent_status'.
   - Approve plan -> Call 'approve_coding_agent_plan'.
   - Commit & push to master -> Call 'approve_and_commit_to_master'.
6. 📶 HARDWARE, WIFI & DIAGNOSTICS:
   - System health / CPU / RAM -> Call 'get_system_health'.
   - Scan connected Wi-Fi devices / "WiFi se kaun kaun connected hai?", "Network par kitne log/phones hain" -> Call 'scan_connected_wifi_devices'.
   - Scan nearby Wi-Fi airspace / "Aas paas kaun se Wi-Fi hain", "Wi-Fi security recon karo", "Open Wi-Fi check karo" -> Call 'scan_nearby_wifi_recon'.
   - Scan WiFi -> Call 'scan_wifi_networks'.
   - Connect WiFi -> Call 'connect_to_wifi' (ssid, password).
7. 🔍 DYNAMIC ON-DEMAND MEMORY & PAST ARCHIVES:
   - Past conversations, months-old discussions, or "wo purani baat" -> Call 'retrieve_smart_multi_tier_context' or 'search_long_term_vector_memory'.
   - Daily logs & updates ("aaj/kal ka update kya tha") -> Call 'get_daily_update'.
   - Save concrete personal fact -> Call 'remember_personal_fact' IMMEDIATELY.
   - Boss correction / rule teaching -> Call 'record_ai_self_correction' IMMEDIATELY.
8. 🛡️ CYBER DEFENSE & OSINT:
   - Link safety / Phishing -> Call 'scan_link_safety'.
   - Data breach check -> Call 'check_email_data_breach'.
   - Webpage crawling -> Call 'crawl_and_extract_webpage' or 'deep_crawl_website'.

============================================================
🎙️ VOICE CALIBRATION & STRICT GATING (MAX 5 PROFILES):
${voiceProfilesContext}

- ONLY TALK TO CALIBRATED VOICES.
- FEMALE VOICE (Ladki ki aawaz): Greet warmly/playfully (e.g. "Hello! Aapki aawaz se lag raha hai aap Boss Divakar ki girlfriend ya koi special friend hain! 😊 Please apna naam batayein.").
- UNCALIBRATED MALE VOICE: Strictly refuse with:
  "Please set voice, system me aapki voice add nahi hai. Voice add karne ke liye authorization password (PIN) batayein."
- PIN VERIFICATION: Whenever a user speaks a PIN, ALWAYS call 'verify_voice_authorization_pin' with the exact PIN before proceeding.

============================================================
🔒 CORE PERSONAL MEMORY VAULT:
${memoryContext}

============================================================
🕒 ACTIVE HABIT & ROUTINE CONTEXT:
${bossRoutineContext}

${fridayLearningContext}

DK'S CONTACTS BOOK (Use 'send_whatsapp_to_contact' / 'save_contact' dynamically):
${contactsList}

STYLE:
- ${answerLength === "detailed" ? "Clear answer first, then 2-3 short supporting points." : "Keep replies crisp, punchy, natural. Don't ramble."}
- ${accurateMode ? "Careful Mode ON: double-check facts/math before speaking." : ""}
- ${googleSearchMode ? "Google Search enabled: use it for current facts and live prices smoothly." : ""}
- Speak numbers/currency in natural Hindi words (e.g. "paanch sau rupaye" instead of raw symbols).`;
    };

    const createSession = async (
      voice: string,
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      const effectiveThinking = accurateMode || googleSearchMode ? "high" : thinkingLevel;
      const systemInstruction = await buildSystemInstruction(effectiveThinking, accurateMode, answerLength, googleSearchMode);

      let inputTranscriptBuffer = "";
      let outputTranscriptBuffer = "";

      const functionDeclarations: any[] = [
        {
          name: "start_background_task",
          description: "Start a background task (e.g. weather update, live cricket score check, product deal search, security scan, codebase audit, or custom background operation). Friday immediately acknowledges in conversation that the task has started in background, and when it finishes, it will be reported at the end of a turn or when DK asks.",
          parameters: {
            type: "OBJECT",
            properties: {
              taskName: { type: "STRING", description: "Clear name of the background task, e.g. 'Weather Update for Patna', 'Live Cricket Match Score', 'Godrej Fridge Price Search'" },
              taskType: {
                type: "STRING",
                description: "Type/category: 'weather', 'cricket', 'deals', 'security_scan', 'wifi_scan', 'code_fix', or 'custom'",
              },
              targetOrQuery: { type: "STRING", description: "Target city, query, product, or topic (e.g. 'Patna', 'India match', 'shoes')" },
              description: { type: "STRING", description: "Short description of what is being processed in background" },
            },
            required: ["taskName", "taskType"],
          },
        },
        {
          name: "get_background_tasks_status",
          description: "Check the live status of all running, active, and completed background tasks. Use when DK asks 'Background me kya chal raha hai?', 'Kya kar rahi ho background me?', 'Weather update hua kya?', 'Update kiya kya hua batao?', or 'Jo kaam bola tha uska kya hua?'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Optional filter for a specific task or topic, e.g. 'weather', 'cricket', 'deals'" },
            },
            required: [],
          },
        },
        {
          name: "mark_background_task_notified",
          description: "Mark a completed background task as notified after informing DK about its outcome/result in conversation.",
          parameters: {
            type: "OBJECT",
            properties: {
              taskId: { type: "STRING", description: "ID of the completed task, or 'all' to mark all completed tasks as notified" },
            },
            required: ["taskId"],
          },
        },
        {
          name: "cancel_background_task",
          description: "Cancel a currently running background task if DK asks to cancel, stop, or abort it.",
          parameters: {
            type: "OBJECT",
            properties: {
              taskIdOrName: { type: "STRING", description: "ID or name of the background task to cancel" },
            },
            required: ["taskIdOrName"],
          },
        },
        {
          name: "request_code_change",
          description: "Use when DK asks for a code/feature change or to fix a bug in his app/project (e.g. 'ye feature add karo', 'ye bug fix karo', 'code me change karo'). Sends the instruction to Friday's coding agent, which will analyze the repo and come back with a plan for DK to approve — this does NOT make any change itself.",
          parameters: {
            type: "OBJECT",
            properties: {
              instruction: { type: "STRING", description: "DK's exact instruction/request for the code change, as literally as possible" },
            },
            required: ["instruction"],
          },
        },
        {
          name: "remember_personal_fact",
          description: "Save an important personal fact about DK to permanent memory IMMEDIATELY, the moment DK states it — do not wait for the conversation to end. Use for anything about DK's life: family members, identity details, career/business, residence/lifestyle, secrets, or any other concrete personal detail. Also use whenever DK explicitly says to remember something ('yaad rakhna', 'yaad rakho', 'don't forget').",
          parameters: {
            type: "OBJECT",
            properties: {
              factText: {
                type: "STRING",
                description: "The EXACT fact as DK stated it, literal and unaltered — do not summarize or paraphrase.",
              },
              category: {
                type: "STRING",
                description:
                  "One of: boss_identity, family_members, personal_secrets_and_facts, career_and_business, residence_and_lifestyle, general_personal_info. Use general_personal_info if nothing else fits — never skip saving just because of category.",
              },
            },
            required: ["factText"],
          },
        },
        {
          name: "add_custom_skill_or_rule",
          description: "Add a new permanent rule, capability, habit, or behavioral instruction to Friday's brain when DK instructs to add or learn something new.",
          parameters: {
            type: "OBJECT",
            properties: {
              skillName: { type: "STRING", description: "Short title or name of the new skill or rule" },
              ruleInstruction: { type: "STRING", description: "The exact behavioral rule or action Friday must follow" },
              triggerPhrase: { type: "STRING", description: "Optional trigger word or situation when this rule applies" },
            },
            required: ["skillName", "ruleInstruction"],
          },
        },
        {
          name: "save_contact",
          description: "Save a new person or contact to DK's contacts book with their name, phone number, and optional relationship.",
          parameters: {
            type: "OBJECT",
            properties: {
              contactName: { type: "STRING", description: "Name of the person (e.g. 'Rahul', 'Aman', 'Priya')" },
              phoneNumber: { type: "STRING", description: "Phone number (e.g. '9876543210' or '919876543210')" },
              relation: { type: "STRING", description: "Optional relationship (e.g. 'Friend', 'Brother', 'Colleague', 'Mummy')" },
            },
            required: ["contactName", "phoneNumber"],
          },
        },
        {
          name: "delete_contact",
          description: "Delete/remove a person from DK's contacts book by name or phone number. Use when DK says to delete, remove, or forget a saved contact (e.g. 'Rahul ka contact delete karo', 'is number ko hata do').",
          parameters: {
            type: "OBJECT",
            properties: {
              contactNameOrPhone: { type: "STRING", description: "The name of the contact to delete (e.g. 'Rahul') or their phone number" },
            },
            required: ["contactNameOrPhone"],
          },
        },
        {
          name: "send_whatsapp_to_contact",
          description: "Send a WhatsApp message directly to any contact (e.g. Rahul, Aman, Mummy) in the background using Friday's dedicated assistant session.",
          parameters: {
            type: "OBJECT",
            properties: {
              contactNameOrPhone: { type: "STRING", description: "The name of the contact in the phonebook (e.g. 'Rahul') or raw phone number" },
              messageText: { type: "STRING", description: "The exact message to send to the contact" },
            },
            required: ["contactNameOrPhone", "messageText"],
          },
        },
        {
          name: "pair_dedicated_whatsapp_number",
          description: "Request an 8-character Pairing Code to link DK's spare phone number to Friday's dedicated WhatsApp bot.",
          parameters: {
            type: "OBJECT",
            properties: {
              phoneNumber: { type: "STRING", description: "The 10 or 12 digit phone number to pair (e.g. '9876543210')" },
            },
            required: ["phoneNumber"],
          },
        },
        {
          name: "set_reminder",
          description: "Set a reminder or alarm for DK with a specific message and time duration or timestamp.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Reminder task or subject" },
              timeString: { type: "STRING", description: "When to remind, e.g., 'in 10 minutes', 'tomorrow at 9am'" },
              durationMinutes: { type: "NUMBER", description: "Duration in minutes if relative, otherwise 0" },
            },
            required: ["title"],
          },
        },
        {
          name: "save_quick_note",
          description: "Save a note, idea, or todo item in DK's persistent notebook.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Note title" },
              content: { type: "STRING", description: "Exact note text or todo item" },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "get_whatsapp_messages",
          description: "Read WhatsApp messages received on Friday's linked number. Use whenever DK asks ANYTHING about his WhatsApp activity — messages, notifications, notifs, updates, or alerts, whether about a specific person, a group, a specific time, or just generally 'is there anything new'. Treat 'message', 'msg', and 'notification' as interchangeable words meaning the same thing here — e.g. 'koi message hai?', 'whatsapp ki notification batao', 'Rahul ne kya likha?', '5 din pehle kya msg tha?'. Can filter by personal/group, sender name, group name, and date.",
          parameters: {
            type: "OBJECT",
            properties: {
              messageType: { type: "STRING", description: "Type: 'personal' for 1-on-1 chats, 'group' for group chats, 'all' for both." },
              senderName: { type: "STRING", description: "Filter by sender name, e.g. 'Rahul'. Optional." },
              groupName: { type: "STRING", description: "Filter by group name, e.g. 'Family Group'. Optional." },
              dateFilter: { type: "STRING", description: "Date: 'aaj', 'kal', '5 din pehle', 'pichle hafte'. Blank = last 48 hours." },
              limit: { type: "NUMBER", description: "Max messages to return. Default 10 personal, 5 group." },
            },
            required: ["messageType"],
          },
        },
        {
          name: "get_whatsapp_latest_media",
          description: "Inspect and describe what is inside the latest photo, PDF, document, video, or voice message received on WhatsApp. Use whenever DK asks 'photo me kya hai?', 'PDF/document me kya likha hai?', 'video me kya tha?', 'latest WhatsApp media check karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Optional specific question about the media, e.g. 'amount kitna hai', 'kiska photo hai', 'document ka title kya hai'" },
            },
            required: [],
          },
        },
        {
          name: "set_whatsapp_reply_limit",
          description: "Change how many automatic WhatsApp replies Friday is allowed to send a specific contact per day (resets every day). Use when DK says things like 'Priya ka reply limit 15 kar do', 'Rahul ka limit ghata ke 3 kar do', or asks to increase/decrease/change how many auto-replies someone can get per day. Default is 10 per day per contact if never set.",
          parameters: {
            type: "OBJECT",
            properties: {
              contactNameOrPhone: { type: "STRING", description: "The contact's name (e.g. 'Priya') or phone number whose daily auto-reply limit should change." },
              newLimit: { type: "NUMBER", description: "The new daily auto-reply limit for this contact (0 or more). 0 means Friday will never auto-reply to them." },
            },
            required: ["contactNameOrPhone", "newLimit"],
          },
        },
        {
          name: "save_daily_update",
          description: "Save/append something DK dictates as today's update, e.g. 'aaj ka update note karo, maine khana kha liya'. Use whenever DK asks you to note, save, log, or record today's update/status, in any phrasing. Multiple calls the same day all get appended together into one running log for today. This log is later used to answer people on WhatsApp who ask about DK (e.g. 'DK ne khana khaya?').",
          parameters: {
            type: "OBJECT",
            properties: {
              updateText: { type: "STRING", description: "The exact update content DK dictated, e.g. 'maine khana kha liya' or 'gym gaya, ab office ja raha hoon'." },
            },
            required: ["updateText"],
          },
        },
        {
          name: "get_daily_update",
          description: "Recall what DK logged as his update for a given day. Use when DK asks things like 'aaj humne kya update likha tha', 'kal kya update tha', 'parso kya kiya tha', or 'X tarikh ko kya update tha'.",
          parameters: {
            type: "OBJECT",
            properties: {
              dateWord: { type: "STRING", description: "Which day, in DK's own words: 'aaj', 'kal', 'parso', '3 din pehle', etc. Default 'aaj' if not specified." },
            },
            required: [],
          },
        },
        {
          name: "get_boss_daily_routine",
          description: "Get Boss Divakar's (DK's) 24-hour daily life routine, timetable, and active habit slot based on Indian Standard Time. Use when DK asks 'Mera daily routine kya hai?', 'Mera schedule dikhao', 'Mera timetable batao', or to verify which activity is scheduled right now.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "update_boss_daily_routine",
          description: "Update or customize Boss's daily habit schedule slot (e.g. gym time, lunch break, coding hours, evening walk). Use when DK says 'Mera gym ka time subah 7 baje kar do', 'Mera lunch 2 baje hota hai', 'Routine me dinner time change karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              slotQuery: { type: "STRING", description: "Which habit slot to update: 'gym', 'breakfast', 'coding', 'lunch', 'walk', 'dinner', or 'sleep'" },
              startTimeStr: { type: "STRING", description: "New start time, e.g. '07:00 AM', '7:00 am', '14:00'" },
              endTimeStr: { type: "STRING", description: "New end time, e.g. '08:30 AM', '8:30 am', '15:00'" },
              activity: { type: "STRING", description: "Optional updated activity description" },
            },
            required: ["slotQuery"],
          },
        },
        {
          name: "record_ai_self_correction",
          description: "MANDATORY: Call IMMEDIATELY whenever Boss corrects Friday, scolds Friday for a wrong answer, points out a mistake ('Aisa nahi bolna chahiye tha', 'Tumne galat bola', 'Aage se yaad rakhna...', 'Mera matlab ye tha tum samjhi nahi'), or teaches Friday how she should have responded. Permanently stores the mistake, Boss's correction, and the golden rule for future conversations so Friday NEVER repeats the mistake.",
          parameters: {
            type: "OBJECT",
            properties: {
              whatFridayDidWrong: { type: "STRING", description: "What Friday said or assumed that was wrong or robotic" },
              whatBossTaught: { type: "STRING", description: "What Boss said, corrected, or instructed Friday to do instead" },
              goldenRule: { type: "STRING", description: "The clear rule to follow in all future turns (e.g. 'Never say don't know, guess from gym habit')" },
              triggerContext: { type: "STRING", description: "Optional context or topic, e.g. 'Daily routine', 'Music', 'Coding'" },
            },
            required: ["whatFridayDidWrong", "whatBossTaught", "goldenRule"],
          },
        },
        {
          name: "get_ai_learned_lessons",
          description: "Get the complete list of wisdom, corrections, and rules that Boss has taught Friday. Use when Boss asks 'Tumne mujhse kya seekha hai?', 'Mera diya hua rule dikhao', 'Galtiyan kya-kya note ki hain'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "search_long_term_vector_memory",
          description: "Search Friday's permanent Vector Database using SOTA semantic AI embeddings. Retrieves conversations, decisions, daily updates, or project milestones from weeks, months, or years ago even if phrased differently. Supports exact date filtering with filterDate. Use when DK asks 'Humne pichle mahine kya discuss kiya tha?', 'Purani vector memory search karo', '25 August ko maine kya bola tha?'.",
          parameters: {
            type: "OBJECT",
            properties: {
              searchQuery: { type: "STRING", description: "The concept, topic, or question to search across lifetime memory" },
              limit: { type: "NUMBER", description: "Maximum number of results to return (default 5)" },
              filterDate: { type: "STRING", description: "Optional specific date or month to filter by (e.g. '2026-08-25', 'June 2026')" },
            },
            required: ["searchQuery"],
          },
        },
        {
          name: "get_memory_lifecycle_status",
          description: "Get the exact health and statistics of Friday's 4-tier memory lifecycle (last 4 days verbatim sessions count, 60-day deep summaries count, 30-day word-to-word daily updates count, and total permanent vector entries).",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "retrieve_smart_multi_tier_context",
          description: "Intelligent Parallel 3-Tier Memory Fetcher: Given user utterance (e.g. 'wo purani dikkat phir se ho gayi', 'aaj office project me problem aayi'), concurrently searches Tier 1 (4-day chat), Tier 2 (30-day daily updates), and Tier 3 (Long-term Vector DB) to synthesize human context awareness of past, present, and future.",
          parameters: {
            type: "OBJECT",
            properties: {
              utterance: { type: "STRING", description: "The sentence or problem spoken by Boss" },
            },
            required: ["utterance"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 1 (no API key required)
        // ---------------------------------------------------------------
        {
          name: "get_current_time",
          description: "MANDATORY Real-Time Live Clock: Get the exact current Indian Standard Time (IST), exact hour, minute, second, day of the week, date, month, and year. ALWAYS call this tool whenever DK asks 'abhi time kya hua', 'kya time ho raha hai', 'kya baj raha hai', 'aaj kaun sa din hai', 'date kya hai', 'time batao', or asks the current time in any city/timezone. NEVER refuse time questions.",
          parameters: {
            type: "OBJECT",
            properties: {
              timezoneOrCity: { type: "STRING", description: "Optional city or timezone (default 'Asia/Kolkata' for Indian Standard Time)" },
            },
            required: [],
          },
        },
        {
          name: "get_weather",
          description: "Get current weather and today's forecast for any place. Use for 'aaj mausam kaisa hai', 'weather batao', etc.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "City or place name, e.g. 'Delhi', 'Mumbai'" },
            },
            required: ["place"],
          },
        },
        {
          name: "get_air_quality",
          description: "Get current air quality index (AQI) and pollution levels for any place. Use for 'AQI batao', 'pollution kitna hai', 'hawa saaf hai kya'.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "City or place name" },
            },
            required: ["place"],
          },
        },
        {
          name: "get_sunrise_sunset",
          description: "Get today's sunrise and sunset time for any place.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "City or place name" },
            },
            required: ["place"],
          },
        },
        {
          name: "get_recent_earthquakes",
          description: "Get recent significant earthquakes (magnitude 4.5+) worldwide in the last 24 hours.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_exchange_rate",
          description: "Get the currency exchange rate between two currencies. Use for 'dollar ka rate kya hai', 'USD to INR kitna hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              fromCurrency: { type: "STRING", description: "3-letter currency code to convert from, e.g. 'USD'" },
              toCurrency: { type: "STRING", description: "3-letter currency code to convert to, e.g. 'INR'" },
            },
            required: ["fromCurrency", "toCurrency"],
          },
        },
        {
          name: "get_crypto_price",
          description: "Get the current price of a cryptocurrency. Use for 'bitcoin ka price kya hai', 'ethereum kitne ka hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              coinId: { type: "STRING", description: "CoinGecko coin id, e.g. 'bitcoin', 'ethereum', 'dogecoin'" },
              vsCurrency: { type: "STRING", description: "Currency to price it in, e.g. 'usd', 'inr'. Default 'usd'." },
            },
            required: ["coinId"],
          },
        },
        {
          name: "get_wikipedia_summary",
          description: "Get a short summary about any topic, person, place, or thing from Wikipedia. Use for general knowledge questions like 'X kya hai', 'X ke bare me batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING", description: "The topic, person, or thing to look up" },
            },
            required: ["topic"],
          },
        },
        {
          name: "get_wikiquote_summary",
          description: "Get a short summary/overview about a person from Wikiquote, useful before sharing famous quotes context. Use for 'X ke quotes batao' style requests.",
          parameters: {
            type: "OBJECT",
            properties: {
              person: { type: "STRING", description: "The person's name" },
            },
            required: ["person"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 2 (no API key required)
        // ---------------------------------------------------------------
        {
          name: "search_book",
          description: "Search for a book by title and get author, publish year, subjects. Use for 'X book ke bare me batao', 'is book ka author kaun hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Book title to search for" },
            },
            required: ["title"],
          },
        },
        {
          name: "get_word_meaning",
          description: "Get the dictionary meaning/definition of an English word. Use for 'X ka matlab kya hai', 'X word ka meaning batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              word: { type: "STRING", description: "The word to look up" },
            },
            required: ["word"],
          },
        },
        {
          name: "get_country_info",
          description: "Get basic info about a country — capital, population, region, currency, languages.",
          parameters: {
            type: "OBJECT",
            properties: {
              country: { type: "STRING", description: "Country name" },
            },
            required: ["country"],
          },
        },
        {
          name: "get_number_fact",
          description: "Get an interesting fact about a number.",
          parameters: {
            type: "OBJECT",
            properties: {
              number: { type: "NUMBER", description: "The number to get a fact about" },
            },
            required: ["number"],
          },
        },
        {
          name: "get_trivia_question",
          description: "Get a random trivia question with multiple choice options. Use when DK wants to play a quiz/trivia game.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_pincode_info",
          description: "Look up post office details (district, state) for an Indian PIN code.",
          parameters: {
            type: "OBJECT",
            properties: {
              pincode: { type: "STRING", description: "6-digit Indian PIN code" },
            },
            required: ["pincode"],
          },
        },
        {
          name: "get_nearby_places",
          description: "Find nearby places, shops, sweet shops (mithai), showrooms (car/bike/clothes/electronics), supermarkets, restaurants, hospitals, banks, etc. around a given city or location.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "The reference location or city, e.g. 'Patna', 'Connaught Place Delhi'" },
              amenity: { type: "STRING", description: "Type of place or search keyword, e.g. 'mithai', 'sweet shop', 'car showroom', 'restaurant', 'hospital', 'bank', 'supermarket'" },
            },
            required: ["place", "amenity"],
          },
        },
        {
          name: "get_timezone_info",
          description: "Get the current time and timezone for any place.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "City or place name" },
            },
            required: ["place"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 3 (no API key required)
        // ---------------------------------------------------------------
        {
          name: "get_covid_stats",
          description: "Get COVID-19 case statistics for a country, or 'world' for global stats.",
          parameters: {
            type: "OBJECT",
            properties: {
              country: { type: "STRING", description: "Country name, or 'world' for global. Default 'world'." },
            },
            required: [],
          },
        },
        {
          name: "get_qr_code",
          description: "Generate a QR code image URL for any text/link. Use for 'is link ka QR code banao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "The text or URL to encode as a QR code" },
            },
            required: ["text"],
          },
        },
        {
          name: "get_random_user",
          description: "Generate a random fake user profile with name, avatar, email — useful for testing/demo purposes.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_github_user_info",
          description: "Get public GitHub profile info for a username — name, bio, repo count, followers.",
          parameters: {
            type: "OBJECT",
            properties: {
              username: { type: "STRING", description: "GitHub username" },
            },
            required: ["username"],
          },
        },
        {
          name: "get_github_repo_info",
          description: "Get public info about a GitHub repository — stars, forks, description, language.",
          parameters: {
            type: "OBJECT",
            properties: {
              owner: { type: "STRING", description: "Repo owner/organization name" },
              repo: { type: "STRING", description: "Repository name" },
            },
            required: ["owner", "repo"],
          },
        },
        {
          name: "get_ip_lookup",
          description: "Look up approximate location and ISP info for an IP address.",
          parameters: {
            type: "OBJECT",
            properties: {
              ip: { type: "STRING", description: "The IP address to look up" },
            },
            required: ["ip"],
          },
        },
        {
          name: "get_dad_joke",
          description: "Get a random dad joke to lighten the mood.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_chuck_norris_joke",
          description: "Get a random Chuck Norris joke.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_public_holidays",
          description: "Get the list of public holidays for a country in a given year. Defaults to India if no country is specified.",
          parameters: {
            type: "OBJECT",
            properties: {
              countryCode: { type: "STRING", description: "2-letter ISO country code, e.g. 'US', 'GB', 'IN'. Defaults to 'IN' if not given." },
              year: { type: "NUMBER", description: "Year, defaults to current year if not given" },
            },
            required: [],
          },
        },
        {
          name: "search_anime",
          description: "Search for anime/manga info — episodes, score, synopsis, release year.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Anime/manga title" },
            },
            required: ["title"],
          },
        },
        {
          name: "translate_text",
          description: "Translate text into another language. Use for 'ise English me translate karo', 'is sentence ka Hindi translation batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "The text to translate" },
              targetLang: { type: "STRING", description: "Target language code, e.g. 'en', 'hi', 'fr', 'es'" },
            },
            required: ["text", "targetLang"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 4 (require API key in .env)
        // ---------------------------------------------------------------
        {
          name: "get_news",
          description: "Get latest live news headlines, top 10 news, politics, local city news, international/world news, or viral/trending news. Filter with topic like 'top 10', 'politics', 'local', 'world', 'viral', 'sports', or a city name (e.g. 'Patna local', 'Delhi').",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING", description: "Filter topic or category: 'top 10', 'politics', 'local', 'world', 'viral', 'business', 'tech', or specific city/topic" },
              country: { type: "STRING", description: "2-letter country code, default 'in' for India" },
              count: { type: "INTEGER", description: "Number of news headlines to fetch (default 10)" },
            },
            required: [],
          },
        },
        {
          name: "get_cricket_scores",
          description: "Get real-time live cricket match scores, ongoing matches, current wickets/runs/overs, and match status. Surfaces India matches first.",
          parameters: {
            type: "OBJECT",
            properties: {
              team: { type: "STRING", description: "Optional specific team name or match filter (e.g. 'India', 'Sri Lanka', 'Australia')" },
            },
            required: [],
          },
        },
        {
          name: "get_upcoming_cricket_matches",
          description: "Get upcoming cricket fixtures, future series schedule, tournament dates, and upcoming match details (e.g. India tour, IPL, World Cup).",
          parameters: {
            type: "OBJECT",
            properties: {
              filter: { type: "STRING", description: "Optional filter for team or tournament (e.g. 'India', 'IPL', 'all')" },
            },
            required: [],
          },
        },
        {
          name: "get_cricket_player_profile",
          description: "Get complete bio-data, role, age, birthplace, teams, career stats (runs, wickets, centuries in ODI, Test, T20I, IPL), and major achievements/records for any Indian or International cricketer (e.g. 'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Jasprit Bumrah', 'Shubman Gill', 'Hardik Pandya', 'Sachin Tendulkar').",
          parameters: {
            type: "OBJECT",
            properties: {
              playerName: { type: "STRING", description: "Name of the cricketer (e.g. 'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Jasprit Bumrah', 'Pat Cummins')" },
            },
            required: ["playerName"],
          },
        },
        {
          name: "get_sports_events",
          description: "Search for sports events/matches (non-cricket, e.g. football, NBA, tennis) by team or league name.",
          parameters: {
            type: "OBJECT",
            properties: {
              league: { type: "STRING", description: "Team, league, or event name to search for" },
            },
            required: ["league"],
          },
        },
        {
          name: "get_stock_price",
          description: "Get the current stock price for a stock symbol. For Indian stocks use '.BSE' suffix, e.g. 'RELIANCE.BSE'.",
          parameters: {
            type: "OBJECT",
            properties: {
              symbol: { type: "STRING", description: "Stock ticker symbol" },
            },
            required: ["symbol"],
          },
        },
        {
          name: "get_movie_info",
          description: "Get info about a movie — overview, release date, rating, poster.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Movie title" },
            },
            required: ["title"],
          },
        },
        {
          name: "search_pexels_image",
          description: "Search for free stock photos matching a query.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "What to search images for" },
            },
            required: ["query"],
          },
        },
        {
          name: "search_unsplash_image",
          description: "Search for high-quality stock photos matching a query.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "What to search images for" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_directions",
          description: "Get driving distance (km), estimated travel time (hours/mins), and route details between two places/cities (e.g. 'Delhi to Patna').",
          parameters: {
            type: "OBJECT",
            properties: {
              fromPlace: { type: "STRING", description: "Starting city or location" },
              toPlace: { type: "STRING", description: "Destination city or location" },
            },
            required: ["fromPlace", "toPlace"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 5 (final key-required batch)
        // ---------------------------------------------------------------
        {
          name: "get_nutrition_info",
          description: "Get nutrition/calorie breakdown for a food item or meal description. Use for 'X me kitni calorie hai', 'ye khane me kitna protein hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              foodQuery: { type: "STRING", description: "Food item or quantity description, e.g. '2 rotis and a bowl of dal'" },
            },
            required: ["foodQuery"],
          },
        },
        {
          name: "search_recipe",
          description: "Search for cooking recipes by dish name, cuisine, diet, or nutrition goals using Spoonacular API. Use for 'Butter Chicken ki recipe batao', 'Italian pasta kaise banate hain', 'high protein vegetarian dinner'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Dish name or food query (e.g. 'Biryani', 'Pasta', 'Paneer Tikka')" },
              cuisine: { type: "STRING", description: "Optional cuisine (e.g. 'Indian', 'Italian', 'Mexican', 'Chinese')" },
              diet: { type: "STRING", description: "Optional diet restriction (e.g. 'vegetarian', 'vegan', 'gluten free', 'ketogenic')" },
              type: { type: "STRING", description: "Optional meal type (e.g. 'main course', 'dessert', 'breakfast', 'snack', 'soup')" },
              maxCalories: { type: "NUMBER", description: "Optional maximum calories per serving" },
              minProtein: { type: "NUMBER", description: "Optional minimum protein in grams" },
            },
            required: ["query"],
          },
        },
        {
          name: "search_recipes_by_ingredients",
          description: "Find delicious recipes based on available ingredients at home / fridge using Spoonacular API. Use for 'Ghar pe paneer, tamatar aur shimla mirch hai, kya banau?', 'fridge me chicken aur pyaaz hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              ingredients: { type: "STRING", description: "Comma-separated list of ingredients available (e.g. 'paneer, tomato, onion, capsicum')" },
              count: { type: "NUMBER", description: "Number of recipes to find (default 5)" },
            },
            required: ["ingredients"],
          },
        },
        {
          name: "get_recipe_details",
          description: "Get full detailed recipe, exact ingredient measurements, and step-by-step cooking instructions using Spoonacular API. Use for 'Shahi Paneer banane ka poora step by step tarika batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              recipeIdOrTitle: { type: "STRING", description: "Recipe ID (number) or dish title name" },
            },
            required: ["recipeIdOrTitle"],
          },
        },
        {
          name: "get_random_recipes",
          description: "Get random recipe recommendations and dish inspiration (e.g. 'aaj dinner me kya banau?', 'kuch tasty vegetarian suggest karo').",
          parameters: {
            type: "OBJECT",
            properties: {
              tags: { type: "STRING", description: "Optional tags (e.g. 'vegetarian', 'indian', 'dessert', 'breakfast')" },
              count: { type: "NUMBER", description: "Number of recipes (default 3)" },
            },
            required: [],
          },
        },
        {
          name: "get_ingredient_substitutes",
          description: "Find culinary ingredient replacements and substitutes using Spoonacular API. Use for 'Butter ki jagah kya daalu?', 'dahi nahi hai to kya use karein?', 'egg substitute batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              ingredientName: { type: "STRING", description: "Ingredient name to substitute (e.g. 'butter', 'egg', 'buttermilk', 'paneer')" },
            },
            required: ["ingredientName"],
          },
        },
        {
          name: "generate_meal_plan",
          description: "Generate structured daily or weekly meal plan with calorie targets and dietary preferences using Spoonacular API. Use for '2000 calorie ka vegetarian daily meal plan banao', 'weekly healthy diet plan'.",
          parameters: {
            type: "OBJECT",
            properties: {
              targetCalories: { type: "NUMBER", description: "Target daily calories (e.g. 1800, 2000, 2500)" },
              timeFrame: { type: "STRING", description: "'day' or 'week' (default 'day')" },
              diet: { type: "STRING", description: "Diet preference (e.g. 'vegetarian', 'vegan', 'ketogenic', 'pescetarian')" },
            },
            required: [],
          },
        },
        {
          name: "get_flight_status",
          description: "Get the current status of a flight by flight number.",
          parameters: {
            type: "OBJECT",
            properties: {
              flightNumber: { type: "STRING", description: "IATA flight number, e.g. 'AI101'" },
            },
            required: ["flightNumber"],
          },
        },
        {
          name: "search_govt_data",
          description: "Search India government open data catalog (data.gov.in) for schemes, datasets, or public info by keyword.",
          parameters: {
            type: "OBJECT",
            properties: {
              keyword: { type: "STRING", description: "Keyword to search government datasets/schemes for" },
            },
            required: ["keyword"],
          },
        },
        {
          name: "get_product_by_barcode",
          description: "Look up product info (title, brand, price range) by scanning/entering a barcode/UPC number.",
          parameters: {
            type: "OBJECT",
            properties: {
              upc: { type: "STRING", description: "The barcode/UPC number" },
            },
            required: ["upc"],
          },
        },
        // ---------------------------------------------------------------
        // Public API tools — Batch 6 (Indian Railways, RapidAPI IRCTC1)
        // NOTE: very limited free quota (~50 calls/month) — use only when
        // DK explicitly asks about trains, not casually.
        // ---------------------------------------------------------------
        {
          name: "get_trains_between_stations",
          description: "Find trains running between two cities/stations. Use for 'Delhi se Mumbai konsi trains hain', 'X se Y ke beech train batao'. Free quota is very limited, so only call this when DK explicitly asks about trains.",
          parameters: {
            type: "OBJECT",
            properties: {
              fromPlace: { type: "STRING", description: "Origin city/station name" },
              toPlace: { type: "STRING", description: "Destination city/station name" },
            },
            required: ["fromPlace", "toPlace"],
          },
        },
        {
          name: "get_train_schedule",
          description: "Get the full stop-by-stop schedule/route with station codes and platform numbers for a specific train number or train name (e.g. '12951' or 'Shiv Ganga Express').",
          parameters: {
            type: "OBJECT",
            properties: {
              trainNumberOrName: { type: "STRING", description: "The train number (e.g. '12951') or train name (e.g. 'Shiv Ganga Express', 'Mumbai Rajdhani')" },
            },
            required: ["trainNumberOrName"],
          },
        },
        {
          name: "get_live_train_status",
          description: "Get real-time live running status, current location, delay, next station, and expected platform number for a running train by train number OR train name. Use when DK asks live status, kahan tak pahunchi, late hai ya nahi, ya platform number kya hai.",
          parameters: {
            type: "OBJECT",
            properties: {
              trainNumberOrName: { type: "STRING", description: "The train number (e.g. '12559') or train name (e.g. 'Shiv Ganga Express', 'Vande Bharat Delhi to Varanasi')" },
              startDay: { type: "INTEGER", description: "Journey start day: 0 for today (default), 1 for yesterday, 2 for 2 days ago" },
            },
            required: ["trainNumberOrName"],
          },
        },
        {
          name: "search_train",
          description: "Find the official train number and route for any train name (e.g. 'Shiv Ganga', 'Poorva Express', 'Vande Bharat', 'Lucknow Mail').",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Train name or keyword to search" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_pnr_status",
          description: "Check the booking/PNR status of a train ticket. Free quota is very limited, so only call this when DK explicitly gives a PNR number to check.",
          parameters: {
            type: "OBJECT",
            properties: {
              pnrNumber: { type: "STRING", description: "The 10-digit PNR number" },
            },
            required: ["pnrNumber"],
          },
        },
        {
          name: "search_product_deals",
          description: "Search top products, real-time prices, and direct buy links across Amazon India, Flipkart, and Meesho. Supports high-to-low price sorting, pagination (next 5 products), and single-store filtering (e.g. 'sirf meesho par search karo').",
          parameters: {
            type: "OBJECT",
            properties: {
              productName: { type: "STRING", description: "Name of the product or item to search (e.g. 'football', 'running shoes', 'wireless earbuds')" },
              platform: { type: "STRING", description: "Optional store filter: 'all' (default), 'amazon', 'flipkart', or 'meesho'" },
              sortBy: { type: "STRING", description: "Sort order: 'high_to_low' (default, most expensive first), 'low_to_high' (cheapest first), or 'relevance'" },
              page: { type: "INTEGER", description: "Page number: 1 for top 5, 2 for next 5 results (items 6-10), 3 for items 11-15" },
            },
            required: ["productName"],
          },
        },
        {
          name: "get_daily_life_suggestion",
          description: "Get structured daily life suggestions for Morning Routine, Health/Diet tips, Productivity/Focus methods, or Stress Relief/Peace.",
          parameters: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING", description: "Category: 'routine', 'diet', 'focus', 'stress', or 'motivation'" },
              context: { type: "STRING", description: "Optional specific context or situation" },
            },
            required: [],
          },
        },
        {
          name: "get_website_or_helpline_info",
          description: "Get verified information about what happens on a website/portal (e.g. IRCTC, UIDAI, EPFO, SBI, Amazon, Cybercrime), its official URL, and verified customer care helpline numbers.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Name of the website, company, bank, or government portal (e.g. 'IRCTC', 'UIDAI Aadhaar', 'EPFO', 'SBI', 'Amazon', 'Cybercrime')" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_instagram_user_info",
          description: "Get public profile details of any Instagram handle or user: Realtime Followers count, Following count, Total Posts count, Bio, Verified status, and Latest Reels/Posts with Likes, Views, and Comments.",
          parameters: {
            type: "OBJECT",
            properties: {
              username: { type: "STRING", description: "The Instagram username or handle (e.g. 'virat.kohli', 'cristiano', 'narendramodi')" },
            },
            required: ["username"],
          },
        },
        {
          name: "search_instagram_user",
          description: "Search for Instagram IDs, user handles, and profiles by person name, celebrity name, brand, or query (e.g. 'Salman Khan', 'Virat Kohli', 'CarryMinati').",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Person name, creator, brand or handle to search on Instagram" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_x_twitter_info",
          description: "Get X (Twitter) profile details, follower counts, verified blue tick, bio, and latest live tweets with likes and retweets for any username or search topic.",
          parameters: {
            type: "OBJECT",
            properties: {
              usernameOrTopic: { type: "STRING", description: "The X (Twitter) username (e.g. 'elonmusk', 'narendramodi', 'imVkohli') or topic" },
            },
            required: ["usernameOrTopic"],
          },
        },
        {
          name: "search_x_twitter",
          description: "Search for X (Twitter) accounts, user handles, or trending topics by person name or keywords (e.g. 'Elon Musk', 'Virat Kohli', 'AI').",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Person name, handle, or topic to search on X (Twitter)" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_location_overview",
          description: "Get a comprehensive map-like location briefing for DK's current or requested place: exact address, coordinates, current weather, temperature, Air Quality Index (AQI), and direct Google Maps link. Use whenever DK mentions his location or asks about a place.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "City, area, colony, or landmark (e.g. 'Connaught Place Delhi', 'Lucknow', 'Patna', 'Bandra Mumbai')" },
            },
            required: ["place"],
          },
        },
        {
          name: "search_youtube",
          description: "Search YouTube videos, channels (@channel), or trending topics with direct YouTube links.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "YouTube search query or channel name (e.g. 'CarryMinati', 'Python tutorial')" },
            },
            required: ["query"],
          },
        },
        {
          name: "search_reddit",
          description: "Search Reddit community threads, discussions, and honest public opinions on any topic or subreddit (e.g. 'r/india', 'best phone under 20k').",
          parameters: {
            type: "OBJECT",
            properties: {
              topicOrSubreddit: { type: "STRING", description: "Topic to search or subreddit name (e.g. 'india', 'tech', 'smartphones')" },
            },
            required: ["topicOrSubreddit"],
          },
        },
        {
          name: "search_music",
          description: "Search songs, artists, albums, release year, and get direct Spotify play links.",
          parameters: {
            type: "OBJECT",
            properties: {
              songOrArtist: { type: "STRING", description: "Song name, singer, or artist (e.g. 'Kesariya Arijit Singh', 'Shape of You')" },
            },
            required: ["songOrArtist"],
          },
        },
        {
          name: "search_song_by_lyrics",
          description: "Identify and search a song using its lyrics, memorable lines, or hummed words (e.g. 'tu hai to mujhe phir aur kya chahiye', 'tere vaaste falak se main chaand', 'shape of you lyrics'). Uses exact and fuzzy partial matching to identify the song title, artist/singer, album, matching lyrics snippet, and links.",
          parameters: {
            type: "OBJECT",
            properties: {
              lyrics: { type: "STRING", description: "The lyrics phrase, line, or words to search for (e.g. 'tu hai to mujhe phir aur kya chahiye', 'tere vaaste falak se main chaand')" },
              artistHint: { type: "STRING", description: "Optional singer or artist name if known or hinted by DK (e.g. 'Arijit Singh', 'Ed Sheeran')" },
            },
            required: ["lyrics"],
          },
        },
        {
          name: "identify_playing_song",
          description: "Identify any music/song playing live in the background, room, car, or TV (Shazam-style acoustic recognition). Use when DK says 'ye kaun sa gana baj raha hai', 'ye music pehchano', 'identify playing song'.",
          parameters: {
            type: "OBJECT",
            properties: {
              songClue: { type: "STRING", description: "Optional title clue, language, or singer hint if DK mentioned any" },
            },
            required: [],
          },
        },
        {
          name: "identify_song_by_humming_or_tune",
          description: "Identify a song from DK's humming, whistling, tune description, or beat rhythm (Google Hum-to-Search style). Use when DK hums ('ta na na...', 'hmm hmm...'), whistles, or describes a tune/rhythm.",
          parameters: {
            type: "OBJECT",
            properties: {
              hummingOrTuneClue: { type: "STRING", description: "The hummed words, rhythm description, tune, or partial lyrics (e.g. 'ta na na na... tere vaaste falak se', 'hmm hmm romantic slow flute song')" },
              artistHint: { type: "STRING", description: "Optional singer or artist hint" },
            },
            required: ["hummingOrTuneClue"],
          },
        },
        {
          name: "get_morning_briefing",
          description: "Deliver Iron Man VIP Morning Briefing Protocol (live weather, top headlines, pending reminders, and stock market status). Use when DK says 'good morning', 'aaj ka briefing do', 'morning update'.",
          parameters: {
            type: "OBJECT",
            properties: {
              city: { type: "STRING", description: "Optional city name for weather (default 'Patna, India')" },
            },
            required: [],
          },
        },
        {
          name: "get_system_health",
          description: "Get real-time JARVIS PC and hardware diagnostics (CPU cores & load, RAM total/used/free, uptime, platform health). Use when DK asks 'system status check karo', 'laptop health check', 'CPU RAM usage batao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "deep_autonomous_research",
          description: "Execute deep multi-stage autonomous research on any topic, technology, company, or concept (Perplexity style). Generates comprehensive report with executive summary, key findings, and takeaways.",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING", description: "The topic, research question, or subject to investigate" },
            },
            required: ["topic"],
          },
        },
        {
          name: "analyze_screen_context",
          description: "Analyze live screen frame or active window context (code errors, terminal output, diagrams, UI design). Use when DK says 'meri screen dekho', 'ye error check karo', 'is image/diagram ko explain karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              userQuery: { type: "STRING", description: "What DK wants explained or diagnosed about the screen" },
              imageBase64: { type: "STRING", description: "Optional base64 image frame if captured directly" },
            },
            required: ["userQuery"],
          },
        },
        {
          name: "switch_voice_persona",
          description: "Switch Friday's persona, accent, or attitude (e.g. 'friday_classic', 'jarvis_british', 'cyberpunk_ai', 'professor_mentor', 'motivational_coach'). Use when DK asks to change persona, switch to JARVIS, or act like a coach/professor.",
          parameters: {
            type: "OBJECT",
            properties: {
              personaName: { type: "STRING", description: "Name or style of persona (e.g. 'jarvis', 'cyberpunk', 'professor', 'coach', 'friday')" },
            },
            required: ["personaName"],
          },
        },
        {
          name: "organize_directory",
          description: "Sort and organize all cluttered files in a folder (Downloads / Desktop) into clean subfolders (Images, Documents, Videos, Code, Archives, Installers). Use when DK says 'Downloads organize karo', 'Desktop files arrange karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              directoryPath: { type: "STRING", description: "Optional folder path to organize (default: Downloads folder)" },
            },
            required: [],
          },
        },
        {
          name: "clean_temp_files",
          description: "Scan and clean temporary Windows cache and junk files to free up disk space. Use when DK says 'temp files delete karo', 'PC junk clean karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "add_expense",
          description: "Log an expense with amount, description, and auto-categorization into the personal budget ledger. Use when DK says '500 rupay petrol me kharch hue', 'Khane pe 300 lag gaye'.",
          parameters: {
            type: "OBJECT",
            properties: {
              amount: { type: "NUMBER", description: "Expense amount in Rupees (e.g. 500, 1200)" },
              description: { type: "STRING", description: "What the expense was for (e.g. 'petrol', 'dinner with friends', 'wifi recharge')" },
              categoryHint: { type: "STRING", description: "Optional category if explicitly specified" },
            },
            required: ["amount", "description"],
          },
        },
        {
          name: "get_expense_summary",
          description: "Get monthly personal expense breakdown, total spent, and top spending category. Use when DK asks 'Is mahine kitna kharcha hua', 'Expense summary batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              filterMonth: { type: "STRING", description: "Optional month filter in YYYY-MM format (e.g. '2026-08')" },
            },
            required: [],
          },
        },
        {
          name: "schedule_meeting",
          description: "Schedule a meeting, appointment, or calendar event with automatic 15-minute proactive audio reminder. Use when DK says 'Kal subah 11 baje meeting schedule karo', 'Doctor appointment add karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Meeting title or purpose (e.g. 'Project Review with Team', 'Client Call')" },
              timeString: { type: "STRING", description: "Date and time of meeting (e.g. 'Tomorrow 11 AM', 'Friday 4 PM')" },
              durationMinutes: { type: "NUMBER", description: "Duration of meeting in minutes (default 30)" },
              locationOrLink: { type: "STRING", description: "Optional Google Meet / Zoom link or venue" },
            },
            required: ["title", "timeString"],
          },
        },
        {
          name: "get_upcoming_meetings",
          description: "Get a list of upcoming scheduled meetings and calendar events. Use when DK asks 'Meri upcoming meetings kaun si hain', 'Calendar check karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "summarize_inbox",
          description: "Summarize unread emails and priority inbox messages. Use when DK asks 'unread emails check karo', 'inbox status batao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "send_quick_email",
          description: "Draft and send an email to a recipient with subject and body text. Use when DK says 'Email bhejo', 'Email draft karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              toEmail: { type: "STRING", description: "Recipient email address (e.g. 'friend@example.com')" },
              subject: { type: "STRING", description: "Subject of the email" },
              bodyText: { type: "STRING", description: "Body contents of the email" },
            },
            required: ["toEmail", "subject", "bodyText"],
          },
        },
        {
          name: "log_water_intake",
          description: "Log water intake and track progress toward the daily 8-glass hydration goal. Use when DK says '1 glass paani piya', 'water log karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              glasses: { type: "NUMBER", description: "Number of glasses of water (default 1)" },
            },
            required: [],
          },
        },
        {
          name: "get_health_status",
          description: "Check daily hydration percentage, posture ergonomics, and eye-rest tips. Use when DK asks 'Health status batao', 'Aaj kitna paani piya'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "add_to_shopping_list",
          description: "Add items to the voice grocery and shopping checklist. Use when DK says 'Doodh, bread aur ande shopping list me daal do'.",
          parameters: {
            type: "OBJECT",
            properties: {
              itemsQuery: { type: "STRING", description: "Comma or 'and' separated list of items to buy" },
            },
            required: ["itemsQuery"],
          },
        },
        {
          name: "get_shopping_list",
          description: "View the active shopping and grocery checklist. Use when DK asks 'Shopping list me kya kya hai', 'Checklist dikhao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "send_shopping_list_on_whatsapp",
          description: "Send the formatted shopping checklist directly to DK's WhatsApp. Use when DK says 'Shopping list WhatsApp par bhej do'.",
          parameters: {
            type: "OBJECT",
            properties: {
              targetPhone: { type: "STRING", description: "Optional phone number (defaults to DK's WhatsApp)" },
            },
            required: [],
          },
        },
        {
          name: "clear_shopping_list",
          description: "Clear all items from the shopping list after shopping is complete. Use when DK says 'Shopping list clear kar do'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "trigger_emergency_sos",
          description: "Trigger an urgent high-priority Emergency SOS alert to trusted contacts via WhatsApp. Use when DK says 'Emergency SOS alert', 'Help emergency'.",
          parameters: {
            type: "OBJECT",
            properties: {
              customMessage: { type: "STRING", description: "Optional custom emergency message or situation description" },
              targetPhone: { type: "STRING", description: "Optional specific contact phone number to alert" },
            },
            required: [],
          },
        },
        {
          name: "generate_daily_podcast",
          description: "Generate and deliver a custom 2-minute energetic tech and breaking news audio podcast. Use when DK says 'Daily tech podcast sunao', 'Aaj ka audio summary do'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "send_fast2sms_message",
          description: "Send a real cellular mobile SMS to any Indian phone number or saved contact by name (e.g. 'Papa', 'Rohit', '9876543210') using Fast2SMS Gateway. Use when DK says 'SMS bhejo', 'Papa ko SMS karo', 'message send karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              phoneNumberOrContactName: { type: "STRING", description: "10-digit Indian mobile number OR saved contact name (e.g. 'Papa', 'Rohit', 'Aman', '9876543210')" },
              messageText: { type: "STRING", description: "Body text of the SMS" },
            },
            required: ["phoneNumberOrContactName", "messageText"],
          },
        },
        {
          name: "summarize_voice_note",
          description: "Summarize a WhatsApp audio voice note into a 2-line executive digest and action items. Use when DK asks to summarize an incoming audio message.",
          parameters: {
            type: "OBJECT",
            properties: {
              transcript: { type: "STRING", description: "The audio note speech transcript or text" },
              senderName: { type: "STRING", description: "Name of the person who sent the voice note" },
            },
            required: ["transcript"],
          },
        },
        {
          name: "store_vault_secret",
          description: "Store a password, API key, or confidential note in the AES-256 Encrypted AI Vault. Use when DK says 'Vault me save karo', 'Password yaad rakh lo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              keyName: { type: "STRING", description: "Identifier / name of the secret (e.g. 'wifi_password', 'github_token')" },
              secretValue: { type: "STRING", description: "The confidential password, key, or secret value" },
              category: { type: "STRING", description: "Optional category (e.g. 'Passwords', 'API Keys', 'Personal')" },
            },
            required: ["keyName", "secretValue"],
          },
        },
        {
          name: "retrieve_vault_secret",
          description: "Retrieve and decrypt a stored secret or password from the encrypted vault. Use when DK asks 'Vault se password batao', 'Mera wifi password kya hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              keyName: { type: "STRING", description: "Identifier / name of the secret to retrieve" },
            },
            required: ["keyName"],
          },
        },
        {
          name: "list_vault_secrets",
          description: "List all secret keys stored in the encrypted AI vault. Use when DK asks 'Vault me kya kya save hai'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_train_live_status",
          description: "Get real-time live Indian Railways train running status, exact current GPS location, delay minutes, and platform number via RailRadar. Use when DK asks '12309 train kahan hai', 'Train ka live running status batao', 'Train kitni late hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              trainNumberOrName: { type: "STRING", description: "Train number or name (e.g. '12309', '12952', 'Rajdhani Express')" },
            },
            required: ["trainNumberOrName"],
          },
        },
        {
          name: "check_pnr_status",
          description: "Check real-time Indian Railways 10-digit PNR status, coach, and berth confirmation via RailRadar. Use when DK asks to check a 10-digit PNR number.",
          parameters: {
            type: "OBJECT",
            properties: {
              pnrNumber: { type: "STRING", description: "10-digit Indian Railways PNR number (e.g. '2847291048')" },
            },
            required: ["pnrNumber"],
          },
        },
        {
          name: "control_smart_device",
          description: "Control smart home lights, smart plugs, AC temperature, and fan speeds. Use when DK says 'Light band karo', 'AC 24 degree karo', 'Fan speed badhao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              deviceNameOrRoom: { type: "STRING", description: "Device name or room (e.g. 'Desk Light', 'AC', 'Bedroom lights')" },
              action: { type: "STRING", description: "Action: 'turn_on', 'turn_off', 'toggle', 'set_temp', 'set_brightness'" },
              value: { type: "NUMBER", description: "Optional numeric value for temperature or brightness (e.g. 24 for AC, 80 for brightness)" },
            },
            required: ["deviceNameOrRoom", "action"],
          },
        },
        {
          name: "get_smart_home_status",
          description: "View all connected IoT smart home devices and their current ON/OFF status. Use when DK asks 'Smart home status batao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "start_focus_mode",
          description: "Activate Pomodoro Focus Mode with relaxing background Lo-Fi audio stream and silenced notifications. Use when DK says 'Focus mode on karo', '25 minute ka study timer chalao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              durationMinutes: { type: "NUMBER", description: "Duration of focus session in minutes (default 25)" },
              goalTitle: { type: "STRING", description: "Focus goal or work title (e.g. 'Deep Coding', 'Exam Prep')" },
            },
            required: [],
          },
        },
        {
          name: "stop_focus_mode",
          description: "Deactivate Pomodoro Focus Mode and return to normal mode. Use when DK says 'Focus mode band karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "track_product_price",
          description: "Track an e-commerce product price on Amazon/Flipkart and set target drop alert. Use when DK says 'Price monitor karo', 'Is product ka price track karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              productName: { type: "STRING", description: "Name of the product (e.g. 'iPhone 16 Pro', 'MacBook Air M3')" },
              currentPrice: { type: "NUMBER", description: "Current product price in Rupees" },
              targetPrice: { type: "NUMBER", description: "Target alert threshold price in Rupees" },
              productUrl: { type: "STRING", description: "Optional product URL" },
            },
            required: ["productName", "currentPrice"],
          },
        },
        {
          name: "get_tracked_prices",
          description: "List all active tracked e-commerce products and target price drop alerts. Use when DK asks 'Kaun se products track ho rahe hain'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "analyze_document",
          description: "Analyze a PDF, resume, contract, research paper, or technical specification. Use when DK asks to analyze, review, or summarize a document.",
          parameters: {
            type: "OBJECT",
            properties: {
              documentTextOrSnippet: { type: "STRING", description: "The document text or extracted content" },
              docTitle: { type: "STRING", description: "Title or filename of the document" },
            },
            required: ["documentTextOrSnippet"],
          },
        },
        {
          name: "query_document",
          description: "Ask specific questions or query clauses from a document. Use when DK asks questions about a document.",
          parameters: {
            type: "OBJECT",
            properties: {
              documentText: { type: "STRING", description: "The document text content" },
              question: { type: "STRING", description: "The specific question to answer" },
            },
            required: ["documentText", "question"],
          },
        },
        {
          name: "get_daily_work_digest",
          description: "Generate end-of-day daily work, coding, and productivity activity digest with overall grade. Use when DK says 'Aaj ka work report do', 'Daily productivity digest batao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "send_messenger_chat",
          description: "Send text messages, photos, videos, PDF documents, or web links to any contact in Friday Messenger. Use when DK says 'Friday Messenger me message bhejo', 'GF/friend ko Messenger par photo/PDF bhejo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              chatId: { type: "STRING", description: "Contact ID in Friday Messenger (e.g. 'boss_dk', 'special_gf', 'best_friend_aman', 'unknown_client')" },
              text: { type: "STRING", description: "Message text or caption" },
              mediaType: { type: "STRING", description: "Type of media: 'text', 'image', 'video', 'pdf', 'link', 'audio'" },
              mediaUrl: { type: "STRING", description: "Optional URL for image, video, or link" },
              mediaTitle: { type: "STRING", description: "Optional title for document/PDF" },
            },
            required: ["chatId", "text"],
          },
        },
        {
          name: "get_messenger_inbox",
          description: "Get all Friday Messenger chats, contacts, unread counts, and assigned roles. Use when DK asks 'Friday Messenger inbox check karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "set_messenger_contact_role",
          description: "Set or change a contact's role in Friday Messenger ('boss' | 'girlfriend' | 'friend' | 'unknown').",
          parameters: {
            type: "OBJECT",
            properties: {
              contactId: { type: "STRING", description: "Contact ID or name" },
              role: { type: "STRING", description: "New role: 'boss', 'girlfriend', 'friend', 'unknown'" },
            },
            required: ["contactId", "role"],
          },
        },
        {
          name: "scan_connected_wifi_devices",
          description: "Scan and list all devices currently connected to the same Wi-Fi / Local Network (e.g., Mobile phones like Apple iPhone, Samsung, Xiaomi, OnePlus, Laptops, PCs, Smart TVs, IoT devices, Routers/Gateways). Returns the total count, device types, brands, IP addresses, and hostnames. Use when DK asks 'WiFi se kaun kaun connected hai?', 'Mere WiFi par kitne phone chal rahe hain?', 'Network scan karo', 'Connected devices dikhao', or 'WiFi devices check karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              forceRefresh: { type: "BOOLEAN", description: "Set to true to force a fresh ARP ping sweep of the network instead of using cached results." },
            },
            required: [],
          },
        },
        {
          name: "scan_nearby_wifi_recon",
          description: "Level 4 Cyber Airspace Recon: Scan all surrounding Wi-Fi networks over-the-air, analyze security encryption (Open / WPA2 / WPA3), detect rogue AP / evil twin anomalies, find hidden SSIDs, and recommend cleanest zero-ping channels. Use when DK asks 'Aas paas kaun se Wi-Fi hain?', 'Wi-Fi security recon karo', 'Hawa me kitne Wi-Fi chal rahe hain?', 'Open Wi-Fi hai kya koi?', or 'Best channel kaun sa hai?'.",
          parameters: {
            type: "OBJECT",
            properties: {
              forceRefresh: { type: "BOOLEAN", description: "Set to true to force fresh over-the-air BSSID radio scan." },
            },
            required: [],
          },
        },
        {
          name: "start_voice_enrollment",
          description: "Start guided multi-step voice biometric enrollment for a new speaker (Boss, Friend, Family, or Guest). Requires Boss's Voice PIN for authorization.",
          parameters: {
            type: "OBJECT",
            properties: {
              pin: { type: "STRING", description: "Boss's secret Voice PIN (e.g. '1234')" },
              name: { type: "STRING", description: "Name of the person being enrolled (e.g. 'Aman', 'Priya', 'Boss DK')" },
              relationWithDivakar: { type: "STRING", description: "Relation with Boss DK (e.g. 'Self', 'Best Friend', 'Brother', 'Colleague')" },
              role: { type: "STRING", description: "Role permission level: 'boss' (Full Root Access) | 'family' | 'friend' | 'guest'" },
            },
            required: ["pin", "name", "relationWithDivakar"],
          },
        },
        {
          name: "record_voice_calibration_sample",
          description: "Record a spoken calibration phrase for active voice biometric enrollment session.",
          parameters: {
            type: "OBJECT",
            properties: {
              sessionId: { type: "STRING", description: "Active enrollment session ID returned from start_voice_enrollment" },
              spokenPhrase: { type: "STRING", description: "The sentence spoken by the user" },
            },
            required: ["sessionId"],
          },
        },
        {
          name: "list_voice_profiles",
          description: "List all enrolled biometric voice profiles and their role privileges.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "delete_voice_profile",
          description: "Delete an enrolled voice profile. Requires Boss's Voice PIN.",
          parameters: {
            type: "OBJECT",
            properties: {
              pin: { type: "STRING", description: "Boss's secret Voice PIN" },
              profileId: { type: "STRING", description: "Optional specific profile ID to delete. Omit to delete all." },
            },
            required: ["pin"],
          },
        },
        {
          name: "update_voice_pin",
          description: "Update Boss's master Voice Authentication PIN.",
          parameters: {
            type: "OBJECT",
            properties: {
              newPin: { type: "STRING", description: "New 4-6 digit numeric PIN" },
            },
            required: ["newPin"],
          },
        },
        {
          name: "play_music",
          description: "Play and stream any song or music track directly in the application when DK asks to listen to music (e.g. 'Kesariya gana chalao', 'koi relax karne wala music sunao').",
          parameters: {
            type: "OBJECT",
            properties: {
              songName: { type: "STRING", description: "Song name or artist name to play" },
            },
            required: ["songName"],
          },
        },
        {
          name: "stop_music",
          description: "Stop and close the currently playing music immediately when DK says 'stop', 'gana band karo', 'mujhe achha nahi laga', 'band karo gana', 'gana nahi sunna mujhe'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "pause_music",
          description: "Pause the currently playing song when DK says 'gana pause karo', 'thodi der roko', 'hold karo gana', 'pause music', 'ek minute roko'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "resume_music",
          description: "Resume or continue playing the paused music track when DK says 'gana resume karo', 'gana continue karo', 'phir se chalao', 'play karo', 'unpause karo', 'gana chalu karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "send_music_on_whatsapp",
          description: "Find the real YouTube video link for a song and send it to DK's WhatsApp via Cloud API. If Cloud API fails and Baileys is disabled, inform DK and offer to enable Baileys as backup.",
          parameters: {
            type: "OBJECT",
            properties: {
              songName: { type: "STRING", description: "Song name or artist name to find on YouTube (e.g. 'Kesariya Arijit Singh', 'Tum Hi Ho', 'Shape of You Ed Sheeran')" },
              targetPhone: { type: "STRING", description: "Optional: phone number or contact name to send to. If not provided, sends to DK's own WhatsApp number." },
            },
            required: ["songName"],
          },
        },
        {
          name: "toggle_baileys_system",
          description: "Turn the Baileys (unofficial WhatsApp) system ON or OFF. Primary WhatsApp is Cloud API. Baileys is backup only. Call when DK says 'Baileys on/off karo', 'purana WhatsApp on karo', 'Baileys band karo', 'backup WhatsApp on karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              action: { type: "STRING", description: "'on' to enable Baileys, 'off' to disable Baileys, 'status' to check current state" },
            },
            required: ["action"],
          },
        },
        {
          name: "dispatch_bug_to_code_agent",
          description: "Send a bug report, broken service, error logs, or feature fix instruction directly to the Friday Coding Agent to automatically diagnose, write the fix, and create a Pull Request / commit. Call this whenever DK asks or approves fixing a broken service or feature.",
          parameters: {
            type: "OBJECT",
            properties: {
              problemTitle: { type: "STRING", description: "Short title of the problem or broken service (e.g. 'Fix YouTube scraper timeout', 'Instagram scraper returning empty results')" },
              serviceName: { type: "STRING", description: "Name of the service, file, or tool that failed" },
              errorDetails: { type: "STRING", description: "The exact error message, logs, or diagnostic details" },
              instruction: { type: "STRING", description: "Detailed instruction for the coding agent explaining what to investigate and fix" },
            },
            required: ["instruction"],
          },
        },
        {
          name: "rollback_last_code_change",
          description: "1-Click Undo / Rollback the latest commit made to the repository. Call when DK says 'aakhri code change rollback karo', 'purana code wapas lao', 'last commit undo karo', 'revert changes'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_pending_code_agent_request",
          description: "Check if the Friday Coding Agent has prepared a plan and is currently waiting for DK's approval or permission to edit files.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "approve_and_commit_code_agent",
          description: "Approve the pending Coding Agent plan and commit/push the changes directly to the main origin branch. Call when DK says 'Coding agent ko bolo ki code main branch me commit kar do', 'Approve kar do', 'Main me push kar do', 'Code commit karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              requestId: { type: "STRING", description: "Optional: Request ID to approve. If not provided, approves the latest pending request." },
            },
            required: [],
          },
        },
        {
          name: "deny_code_agent_request",
          description: "Deny or cancel the pending Coding Agent request. Call when DK says 'Nahi mat karo', 'Deny kar do', 'Coding agent roko', 'Cancel kar do'.",
          parameters: {
            type: "OBJECT",
            properties: {
              requestId: { type: "STRING", description: "Optional: Request ID to deny. If not provided, denies the latest pending request." },
            },
            required: [],
          },
        },
        {
          name: "search_and_explain_codebase",
          description: "Explore the codebase, search for functions/features, and explain where logic lives. Call when DK asks 'WhatsApp reply kis file me hai?', 'background sync ka code kahan hai?', 'explain the auth architecture'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "The feature, function, or concept to search for in the codebase" },
            },
            required: ["query"],
          },
        },
        {
          name: "clean_project_codebase",
          description: "Run autonomous codebase cleanup to remove unused imports, dead comments, and format code. Call when DK says 'codebase clean karo', 'dead code hatao', 'unused imports clean karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "crawl_and_extract_webpage",
          description: "Crawl and inspect any target website URL, convert the webpage into clean LLM-friendly Markdown, extract data, and answer questions or summarize it. Call when DK says 'Is website ko crawl karo', 'Is link ka data dekho', 'Is page ko padh kar batao kya likha hai', 'URL crawl karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "The full website URL to crawl and read (e.g. 'https://example.com' or 'example.com')" },
              query: { type: "STRING", description: "Optional question or extraction goal (e.g. 'What are the pricing tiers?', 'Summarize key features', 'Extract contact email')" },
            },
            required: ["url"],
          },
        },
        {
          name: "deep_crawl_website",
          description: "Perform a multi-page deep crawl across an entire domain or website hierarchy, extracting combined markdown intelligence. Call when DK says 'Puri website deep crawl karo', 'Is domain ke sare pages crawl karke summary do'.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "The root website URL to deep crawl" },
              maxPages: { type: "NUMBER", description: "Maximum pages to crawl (default 5, max 15)" },
              query: { type: "STRING", description: "Optional research query to answer from the crawled site" },
            },
            required: ["url"],
          },
        },
        {
          name: "search_telegram_media_vault",
          description: "Search and retrieve full intelligence about any photo, video, PDF document, voice recording, or file shared in Telegram Media Groups or chats (finds exact date, group location, file size, duration, OCR text, and visual breakdown). Call when DK says 'Media group me jo invoice/photo aayi thi wo kahan hai?', 'Kal ka video kitne MB ka tha?', 'Voice note me kya bola gaya tha?', 'Telegram media search karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Search query (e.g. 'electricity bill', 'React video', '24 august invoice', 'voice recording')" },
              mediaType: { type: "STRING", description: "Optional media type filter: 'photo', 'video', 'document', 'voice', 'audio', or 'all'" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_telegram_user_or_group_summary",
          description: "Retrieve comprehensive conversational history, username profile, and summary of what was discussed with a specific Telegram user (1v1 chat) or inside a Telegram group. Call when DK says 'Rahul ke sath Telegram pe kya baat hui thi?', 'DK Project group me kya chal raha hai?', 'Telegram group summary batao', 'Telegram user ka update do'.",
          parameters: {
            type: "OBJECT",
            properties: {
              target: { type: "STRING", description: "Username (e.g. '@rahul_dev'), Person Name (e.g. 'Rahul'), or Group Name (e.g. 'DK Project Group')" },
              isGroup: { type: "BOOLEAN", description: "Set to true if target is a group, false if user" },
            },
            required: ["target"],
          },
        },
        {
          name: "analyze_youtube_video",
          description: "Analyze, extract timestamps, and summarize any YouTube video URL or ID. Explains the entire narrative, lessons, and chapter timeline. Call when DK says 'Is YouTube video ki summary batao', 'Video me kya bataya gaya hai?', 'YouTube video analyze karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "YouTube video URL or Video ID" },
            },
            required: ["url"],
          },
        },
        {
          name: "ask_youtube_video_timestamp",
          description: "Ask Gemini for YouTube: Find exact timestamps and answers to specific questions about what happens, what code is written, or what was said at what minute in a YouTube video. Call when DK says 'Video me authentication kitne minute par samjhaya hai?', '05:30 par kya bola?', 'Pricing ke baare me kab baat hui?'.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "YouTube video URL or Video ID" },
              question: { type: "STRING", description: "Specific question about the video contents" },
            },
            required: ["url", "question"],
          },
        },
        {
          name: "get_whatsapp_photo_or_doc_info",
          description: "Analyze and explain what is inside the latest Photo, Image, or Document (PDF) received on WhatsApp (visual scene, people, objects, OCR text, key numbers). Call when DK says 'Photo me kya hai?', 'PDF me kya likha hai?', 'WhatsApp pe jo photo bheja hai dekho'.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Optional specific question about the photo or document" },
            },
            required: [],
          },
        },
        {
          name: "save_person_visual_memory",
          description: "Save a person's photo, name, and visual biometric face traits into Firestore permanent memory so Friday can recognize them anytime in the future. Call when DK says 'Iska naam Rahul hai yaad rakhna', 'Ye photo Rahul ki hai save kar lo', 'Inka naam Rahul hai'.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Person's name (e.g. 'Rahul', 'Amit', 'Priya')" },
              relation: { type: "STRING", description: "Relationship or context (e.g. 'Friend', 'Brother', 'Colleague', 'College Friend')" },
              notes: { type: "STRING", description: "Any additional notes or details about the person" },
            },
            required: ["name"],
          },
        },
        {
          name: "identify_person_in_whatsapp_photo",
          description: "Identify and recognize who is in the photo by comparing facial features against saved person profiles in Firestore memory. Call when DK says 'Pehchano ye photo me kaun hai?', 'Photo me kaun hai dekho', 'Pehchano kaun hai ye'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "toggle_ui_setting",
          description: "Turn ON or OFF any UI toggle switch, panel, or modal by voice (e.g. captions, accurate_mode, google_search, wake_word, baileys_whatsapp, code_agent, chat_history, settings, whatsapp_modal).",
          parameters: {
            type: "OBJECT",
            properties: {
              settingName: {
                type: "STRING",
                description: "Name of the setting/toggle: 'captions', 'accurate_mode', 'google_search', 'wake_word', 'baileys_whatsapp', 'code_agent', 'chat_history', 'settings', 'whatsapp_modal'",
              },
              state: {
                type: "BOOLEAN",
                description: "true for ON, false for OFF. If omitted, flips/toggles the current state.",
              },
            },
            required: ["settingName"],
          },
        },
        {
          name: "verify_voice_authorization_pin",
          description: "MANDATORY STEP 1: Verify if the user's spoken voice authorization password/PIN matches the secret PIN in Firestore. MUST ALWAYS BE CALLED IMMEDIATELY whenever a user speaks or provides a PIN before asking for phrase or name.",
          parameters: {
            type: "OBJECT",
            properties: {
              pin: { type: "STRING", description: "The exact 4-8 digit numeric PIN spoken by the user" },
            },
            required: ["pin"],
          },
        },
        {
          name: "setup_boss_voice_recognition",
          description: "Enroll and calibrate a voice recognition profile into Firestore. Requires authorization PIN verified from Firestore. Supports up to 5 profiles. Call during voice calibration after obtaining PIN, phrase, name, and relation with Divakar.",
          parameters: {
            type: "OBJECT",
            properties: {
              pin: { type: "STRING", description: "Authorization PIN provided by speaker (verified against Firestore)" },
              name: { type: "STRING", description: "Name of the person being enrolled (e.g. 'Divakar', 'Rohit', 'Pooja', 'Mummy')" },
              relationWithDivakar: { type: "STRING", description: "Relation with Divakar/DK (e.g. 'Boss (Self)', 'Dost', 'Bhai', 'Behen', 'Mummy', 'Colleague')" },
              spokenPhrase: { type: "STRING", description: "Calibration phrase spoken during enrollment" },
            },
            required: ["pin", "name"],
          },
        },
        {
          name: "delete_boss_voice_recognition",
          description: "Delete an enrolled voice profile from Firestore memory. Requires authorization PIN verified from Firestore. Call when user says 'voice delete karo', 'voice profile hatao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              pin: { type: "STRING", description: "Authorization PIN provided by user (verified against Firestore)" },
              profileId: { type: "STRING", description: "Optional specific profile ID to delete" },
            },
            required: ["pin"],
          },
        },
        {
          name: "get_coding_agent_status",
          description: "Check what the Coding Agent is currently doing, whether any approval is pending, or if recent code was written, branch created, or committed/pushed to master. Call when DK asks 'Coding agent kya kar raha hai?', 'Kya koi approval maang raha hai?', 'Coding agent status kya hai?'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "approve_coding_agent_plan",
          description: "Approve Coding Agent's proposed plan to generate code, create git branch, and apply changes. Call when DK says 'Approve kar do', 'Haan approve karo', 'Plan theek hai aage badho'.",
          parameters: {
            type: "OBJECT",
            properties: {
              requestId: { type: "STRING", description: "Optional specific request ID to approve. If omitted, approves latest pending request." },
            },
            required: [],
          },
        },
        {
          name: "approve_and_commit_to_master",
          description: "Approve Coding Agent plan, generate code, and immediately commit & push directly to master/main origin repository branch. Call when DK says 'Commit to master kar do', 'Master branch me push kar do', 'Main branch me daal do', 'Direct commit karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              requestId: { type: "STRING", description: "Optional specific request ID. If omitted, pushes latest pending request." },
            },
            required: [],
          },
        },
        {
          name: "reject_coding_agent_plan",
          description: "Reject, deny, or stop the Coding Agent's task. Call when DK says 'Reject kar do', 'Deny karo', 'Roko', 'Nahi ye change mat karo', 'Task cancel karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              requestId: { type: "STRING", description: "Optional specific request ID to reject." },
            },
            required: [],
          },
        },
        {
          name: "send_command_to_coding_agent",
          description: "Dispatch a new bug fix, feature request, or codebase modification command directly to Coding Agent. Call when DK says 'Coding agent ko bolo ki [instruction]', 'Coding agent ko command do [command]', 'Ye feature add karne bolo coding agent ko'.",
          parameters: {
            type: "OBJECT",
            properties: {
              instruction: { type: "STRING", description: "The exact coding instruction or task description given by DK" },
              problemTitle: { type: "STRING", description: "Short title summarizing the task (e.g. 'Add dark mode toggle', 'Fix login error')" },
            },
            required: ["instruction"],
          },
        },
        {
          name: "send_telegram_message",
          description: "Send a message or notification to Boss via Friday Telegram Bot. Call when DK says 'Telegram par message bhejo', 'Telegram pe link share karo', 'Telegram par notify karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "Message text to send on Telegram" },
              chatId: { type: "STRING", description: "Optional chat ID (defaults to OWNER chat if configured)" },
            },
            required: ["text"],
          },
        },
        {
          name: "send_telegram_to_contact",
          description: "Send a Telegram message to any person, contact name, username (@user), or Telegram group (e.g. 'Rahul ko telegram par good night bhej do', 'Telegram pe @rahul ko message bhejo', 'Telegram group Tech Squad me message bhejo'). Looks up contacts, known Telegram users, or group titles and delivers the message.",
          parameters: {
            type: "OBJECT",
            properties: {
              recipient: { type: "STRING", description: "Contact Name, Telegram Username (e.g. '@rahul_dev'), Group Title (e.g. 'Tech Squad'), or Chat ID" },
              message: { type: "STRING", description: "The message text to send" },
            },
            required: ["recipient", "message"],
          },
        },
        {
          name: "get_telegram_bot_data",
          description: "Retrieve all Telegram users and groups that are using or interacting with the Friday Telegram Bot. Call when DK asks 'Telegram par kaun kaun bot use kar raha hai', 'Telegram ke groups dikhao', 'Telegram activity status batao'.",
          parameters: {
            type: "OBJECT",
            properties: {},
          },
        },
        {
          name: "get_telegram_chat_history",
          description: "Retrieve message logs and conversations sent by users to Friday on Telegram, in personal DMs or in Telegram groups. Call when DK asks 'Telegram par kisne kya message bheja', 'Rahul ne telegram par kya bola tha', 'Telegram group me kya baatein hui', 'aaj Telegram par kya messages aaye'.",
          parameters: {
            type: "OBJECT",
            properties: {
              target: { type: "STRING", description: "Optional: 'all' (default), contact name, @username, or group title" },
              limit: { type: "NUMBER", description: "Optional number of recent messages to return (default 20)" },
            },
          },
        },
        {
          name: "modify_telegram_user",
          description: "Modify or set a custom nickname/alias or notes for any Telegram user. Call when DK asks 'Telegram user Rahul ka nickname Bro kar do', 'is user ke notes update karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              target: { type: "STRING", description: "Telegram Username (e.g. '@rahul_dev'), Name, or User ID" },
              customAlias: { type: "STRING", description: "Optional nickname or custom alias" },
              customNotes: { type: "STRING", description: "Optional notes about this user" },
            },
            required: ["target"],
          },
        },
        {
          name: "set_telegram_busy_message",
          description: "Update the custom auto-reply busy status message for the Telegram Bot when people text while Boss is busy. Call when DK says 'Telegram bot par busy message change karo', 'auto-reply customize karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              message: { type: "STRING", description: "The new busy status / auto-reply message" },
            },
            required: ["message"],
          },
        },
        {
          name: "send_instagram_dm",
          description: "Send an Instagram Direct Message (DM) to any user, handle, or contact (e.g. 'Rahul ko Instagram par message bhej do', 'Instagram par @user ko DM karo'). Note: Sensitive actions cannot be performed via Instagram.",
          parameters: {
            type: "OBJECT",
            properties: {
              recipient: { type: "STRING", description: "Instagram Username (e.g. '@rahul_dev', 'rahul_kumar'), Contact Name, or IGID" },
              message: { type: "STRING", description: "The message text to send in Instagram DM" },
            },
            required: ["recipient", "message"],
          },
        },
        {
          name: "scan_link_safety",
          description: "Scan any URL/link for phishing, malware, cross-domain redirect risks, and SSL security. Call when DK says 'ye link safe hai kya', 'link scan karo', 'phishing check karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              url: { type: "STRING", description: "The URL or link to inspect" },
            },
            required: ["url"],
          },
        },
        {
          name: "check_email_data_breach",
          description: "Check if an email address or username has been exposed in major known public data breaches / dark web leaks. Call when DK says 'mera email leak to nahi hua', 'data breach check karo', 'email leak check'.",
          parameters: {
            type: "OBJECT",
            properties: {
              emailOrUsername: { type: "STRING", description: "Email address or username to check" },
            },
            required: ["emailOrUsername"],
          },
        },
        {
          name: "audit_website_security",
          description: "Perform comprehensive security audit on any domain/website: HTTP security headers (HSTS, CSP, X-Frame), DNS SPF/DMARC email security, SSL status, and overall security grade (A+ to F). Call when DK says 'website security check karo', 'domain audit karo'.",
          parameters: {
            type: "OBJECT",
            properties: {
              domain: { type: "STRING", description: "The domain name to audit (e.g. 'google.com', 'example.in')" },
            },
            required: ["domain"],
          },
        },
        {
          name: "lookup_ip_intelligence",
          description: "Lookup IP address or domain geolocation, ISP organization, ASN, coordinates, and hosting/cloud infrastructure threat intelligence. Call when DK says 'IP trace karo', 'is IP ka location batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              ipOrDomain: { type: "STRING", description: "IP address or domain to lookup" },
            },
            required: ["ipOrDomain"],
          },
        },
        {
          name: "run_code_security_audit",
          description: "Run Static Application Security Testing (SAST) on the project codebase to detect exposed hardcoded API keys, secrets, and insecure code patterns. Call when DK says 'code ka security audit karo', 'vulnerability scan karo'.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_linkedin_insights",
          description: "Get LinkedIn company hub page and job opening search links for any company or skill.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Company name or job role (e.g. 'Google India', 'React Developer')" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_community_links",
          description: "Get verified Telegram channels or Discord community search links for study, tech, gaming, or deals.",
          parameters: {
            type: "OBJECT",
            properties: {
              platform: { type: "STRING", description: "'telegram' or 'discord'" },
              topic: { type: "STRING", description: "Topic (e.g. 'deals india', 'python programming')" },
            },
            required: ["platform", "topic"],
          },
        },
        {
          name: "get_pinterest_ideas",
          description: "Get Pinterest visual ideas, room decor, setup aesthetics, and fashion trends.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Visual search topic (e.g. 'minimal desk setup', 'outfit ideas')" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_medicine_and_generic_info",
          description: "Get medicine uses, dosage precautions, and 50-80% cheaper Jan Aushadhi generic salt alternatives for any medicine (e.g. 'Paracetamol', 'Pantop-D', 'Azithromycin').",
          parameters: {
            type: "OBJECT",
            properties: {
              medicineName: { type: "STRING", description: "Medicine brand name or salt name" },
            },
            required: ["medicineName"],
          },
        },
        {
          name: "get_daily_commodity_rates",
          description: "Get latest Gold (22K/24K), Silver, Petrol, Diesel, and LPG cylinder rates in Patna, Delhi, or other Indian cities.",
          parameters: {
            type: "OBJECT",
            properties: {
              commodity: { type: "STRING", description: "'gold', 'silver', 'petrol', 'diesel', 'lpg', or 'all'" },
              city: { type: "STRING", description: "City name, default 'Patna' or 'Delhi'" },
            },
            required: ["commodity"],
          },
        },
        {
          name: "get_emergency_helplines",
          description: "Get instant emergency numbers (112 National, 100 Police, 102 Ambulance, 101 Fire, 1930 Cyber Fraud, 1091 Women Safety, 139 Railway).",
          parameters: {
            type: "OBJECT",
            properties: {
              serviceType: { type: "STRING", description: "Optional specific emergency type (e.g. 'cyber', 'women', 'police', 'medical')" },
            },
            required: [],
          },
        },
        {
          name: "get_vehicle_and_challan_services",
          description: "Check e-Challan status/links, Parivahan RC/DL services, PUCC validity, and mParivahan portal links for vehicles.",
          parameters: {
            type: "OBJECT",
            properties: {
              service: { type: "STRING", description: "'echallan', 'rc', 'dl', 'puc'" },
              vehicleNumber: { type: "STRING", description: "Optional vehicle registration number (e.g. 'BR01AB1234')" },
            },
            required: [],
          },
        },
        {
          name: "get_utility_and_bill_services",
          description: "Get Gas cylinder WhatsApp booking numbers (Indane/Bharat/HP), Electricity bill portal links, and Fastag recharge services.",
          parameters: {
            type: "OBJECT",
            properties: {
              serviceType: { type: "STRING", description: "'gas', 'electricity', 'fastag', or 'all'" },
              providerOrState: { type: "STRING", description: "State or provider name (e.g. 'Bihar', 'Delhi', 'Indane')" },
            },
            required: ["serviceType"],
          },
        },
        {
          name: "get_govt_scheme_info",
          description: "Get details, eligibility, benefits, and official links for government schemes (e.g. 'Ayushman Bharat', 'PM Kisan', 'PMAY', 'Sukanya Samriddhi').",
          parameters: {
            type: "OBJECT",
            properties: {
              schemeName: { type: "STRING", description: "Name of the scheme (e.g. 'Ayushman Bharat', 'PM Kisan')" },
            },
            required: ["schemeName"],
          },
        },
        {
          name: "track_expense_entry",
          description: "Log a daily expense by voice with amount, category (Fuel, Food, Travel, Shopping, Bills), and optional note.",
          parameters: {
            type: "OBJECT",
            properties: {
              amount: { type: "NUMBER", description: "Expense amount in Rupees (₹)" },
              category: { type: "STRING", description: "Expense category (e.g. 'Petrol/Fuel', 'Food/Breakfast', 'Shopping', 'Travel', 'Bills')" },
              note: { type: "STRING", description: "Optional note describing the expense" },
            },
            required: ["amount", "category"],
          },
        },
        {
          name: "get_daily_expense_summary",
          description: "Get total expense summary for today, recent logs, and spending breakdown.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_bus_travel_info",
          description: "Get bus route info, travel time, and direct booking links for RedBus and AbhiBus between two cities.",
          parameters: {
            type: "OBJECT",
            properties: {
              fromCity: { type: "STRING", description: "Departure city (e.g. 'Delhi', 'Patna')" },
              toCity: { type: "STRING", description: "Destination city (e.g. 'Patna', 'Ranchi', 'Jaipur')" },
            },
            required: ["fromCity", "toCity"],
          },
        },
        {
          name: "scan_wifi_networks",
          description: "Scan and list all nearby WiFi networks (SSIDs, signal strength, security type, password required or not). Use when DK asks to see available WiFi, nearby hotspots, or wants to connect to a new network.",
          parameters: { type: "OBJECT", properties: {}, required: [] },
        },
        {
          name: "get_wifi_status",
          description: "Get the current WiFi connection status — which network is connected, signal strength, speed, and adapter info.",
          parameters: { type: "OBJECT", properties: {}, required: [] },
        },
        {
          name: "connect_to_wifi",
          description: "Connect to a specific WiFi network by SSID. Optionally provide the password if the network is secured. Use this when DK asks to connect to a WiFi network by name.",
          parameters: {
            type: "OBJECT",
            properties: {
              ssid: { type: "STRING", description: "The WiFi network name (SSID) to connect to" },
              password: { type: "STRING", description: "WiFi password, if the network requires one" },
            },
            required: ["ssid"],
          },
        },
        {
          name: "disconnect_wifi",
          description: "Disconnect from the current WiFi network.",
          parameters: { type: "OBJECT", properties: {}, required: [] },
        },
        {
          name: "execute_service",
          description: "MANDATORY Indian Railways Intelligence via RailRadar: Get ticket prices & class-wise fares (SL, 3A, 2A, 1A, CC), real-time seat availability & Tatkal seats, coach layout (General/Sleeper aage ya peeche), live running status & GPS delay, 10-digit PNR status, train stoppage check, upcoming trains between any 2 stations (e.g. Jamui to Dholi/Patna), and cancellation refund rules. NEVER refuse ticket price or seat queries — ALWAYS call this tool.",
          parameters: {
            type: "OBJECT",
            properties: {
              action: {
                type: "STRING",
                description: "Action type: 'ticket_price' (for fare/ticket prices/kiraya), 'seat_availability' (for seats/tatkal quota), 'coach_position' (for General/Sleeper/AC bogey position), 'stoppage_check' (to check if train stops at station), 'trains_between' (to search trains from one station/city to another), 'train_status' (live running status/delay/GPS), 'pnr_status' (10-digit PNR), 'schedule' (timetable), or 'cancellation_refund' (refund calculator)",
              },
              query: {
                type: "STRING",
                description: "Train number (e.g. '12309', '12393'), 10-digit PNR (e.g. '2847291048'), station name (e.g. 'Jamui', 'Patna', 'Dholi'), or city query",
              },
              fromStation: {
                type: "STRING",
                description: "Origin / From station name or code (e.g. 'Jamui', 'JMU', 'Patna', 'PNBE')",
              },
              toStation: {
                type: "STRING",
                description: "Destination / To station name or code (e.g. 'Dholi', 'DOL', 'Delhi', 'NDLS')",
              },
              targetStation: {
                type: "STRING",
                description: "Target station to check stoppage for (e.g. 'Prayagraj', 'Kanpur')",
              },
            },
            required: ["action", "query"],
          },
        },
      ];

      // Closure ref so onopen/onerror/onclose below can tell whether THIS
      // session is still the active one (vs. one that was intentionally
      // superseded/closed, e.g. on a settings change) before reconnecting.
      // Assigned right after ai.live.connect() resolves, below.
      let thisSessionRef: any;

      const newSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log(`[Server] 🟢 Gemini Live session opened (session=${sessionId})`);
          },
          onerror: (err: any) => {
            // ── DEBUG: this is the #1 suspect for "stuck on Listening" ──
            // If the underlying Gemini socket dies mid-conversation and we
            // never hear about it, currentSession stays non-null, audio
            // keeps getting silently forwarded into a dead session, and the
            // client just sits on "Listening..." forever waiting for a
            // reply that will never come. Previously there was NO onerror/
            // onclose handler at all, so this failure mode was invisible.
            console.error(`[Server] ❌ Gemini Live session ERROR (session=${sessionId}):`, err?.message || err);
            if (currentSession === thisSessionRef) {
              currentSession = undefined;
              autoReconnect();
            }
          },
          onclose: (evt: any) => {
            console.warn(
              `[Server] 🔌 Gemini Live session CLOSED (session=${sessionId}) code=${evt?.code} reason=${evt?.reason || "n/a"}`
            );
            if (currentSession === thisSessionRef) {
              currentSession = undefined;
              autoReconnect();
            }
          },
          onmessage: async (message: any) => {
            const parts = message.serverContent?.modelTurn?.parts || [];
            let hasAudio = false;
            for (const part of parts) {
              if (part.inlineData?.data) {
                hasAudio = true;
                safeSend(JSON.stringify({ type: "speaking" }));
                safeSend(JSON.stringify({ audio: part.inlineData.data }));
              }
            }

            const transcript = message.serverContent?.outputTranscription?.text;
            const inputTranscript = message.serverContent?.inputTranscription?.text;

            // ── Bug Fix: Forward thinking state to client ──────────────
            const isThinkingFrame =
              !hasAudio && !transcript && !inputTranscript &&
              message.serverContent?.modelTurn !== undefined &&
              !message.serverContent?.turnComplete;

            if (isThinkingFrame) {
              safeSend(JSON.stringify({ type: "thinking" }));
            }
            if (transcript) {
              safeSend(JSON.stringify({ text: transcript }));
              outputTranscriptBuffer += transcript;
            }
            if (inputTranscript) {
              inputTranscriptBuffer += inputTranscript;
            }
            if (message.serverContent?.interrupted) {
              safeSend(JSON.stringify({ interrupted: true }));
            }
            if (message.serverContent?.turnComplete) {
              safeSend(JSON.stringify({ turnComplete: true }));
              if (inputTranscriptBuffer.trim()) {
                // Fire-and-forget: don't block the realtime audio/transcript
                // pipeline on a Firestore write, but do log failures.
                saveMessage("user", inputTranscriptBuffer).catch((e) =>
                  console.error("[Server] Failed to save user message:", e)
                );
                memoryEngine.recordMessage(sessionId, "user", inputTranscriptBuffer);
              }
              if (outputTranscriptBuffer.trim()) {
                saveMessage("ai", outputTranscriptBuffer).catch((e) =>
                  console.error("[Server] Failed to save AI message:", e)
                );
                memoryEngine.recordMessage(sessionId, "ai", outputTranscriptBuffer);

                // Auto-mark completed background tasks as notified if AI reported them to DK
                try {
                  const unnotified = backgroundTasksService.getUnnotifiedCompletedTasks();
                  const lowerOutput = outputTranscriptBuffer.toLowerCase();
                  for (const t of unnotified) {
                    if (
                      lowerOutput.includes(t.name.toLowerCase()) ||
                      (t.type === "weather" && (lowerOutput.includes("weather") || lowerOutput.includes("mausam"))) ||
                      (t.type === "cricket" && (lowerOutput.includes("cricket") || lowerOutput.includes("score"))) ||
                      (lowerOutput.includes("background") && lowerOutput.includes("complete"))
                    ) {
                      backgroundTasksService.markTaskNotified(t.id);
                    }
                  }
                } catch (err) {
                  console.error("[Server] Error auto-marking background task as notified:", err);
                }
              }
              inputTranscriptBuffer = "";
              outputTranscriptBuffer = "";

              // Fire-and-forget: periodically extract personal facts from the live
              // session so they land in the vault without waiting for session end.
              memoryEngine.maybeAutoExtract(sessionId, ai).catch((e) =>
                console.error("[Server] Periodic memory extraction failed:", e)
              );
            }

            // Handle Gemini Live Function Calling
            if (message.toolCall?.functionCalls) {
              const functionResponses: any[] = [];
              for (const call of message.toolCall.functionCalls) {
                console.log(`[Friday Tools] Calling function: ${call.name}`, call.args);
                let result: any = { success: true };

                if (call.name === "start_background_task") {
                  const { taskName, taskType, targetOrQuery, description } = call.args || {};
                  try {
                    const task = await backgroundTasksService.executeAutonomousTask(
                      String(taskName || "Background Task"),
                      String(taskType || "custom"),
                      String(targetOrQuery || ""),
                      description ? String(description) : undefined
                    );
                    result = {
                      success: true,
                      taskId: task.id,
                      taskName: task.name,
                      status: task.status,
                      message: `Boss, '${task.name}' background me start kar diya hai! Jaise hi complete hoga main aapko bata dungi.`,
                    };
                    clientWs.send(JSON.stringify({ type: "background_task_started", task }));
                  } catch (e: any) {
                    result = { success: false, message: `Could not start background task: ${e?.message || e}` };
                  }
                } else if (call.name === "get_background_tasks_status") {
                  const { query } = call.args || {};
                  try {
                    const statusSummary = backgroundTasksService.getTaskStatusSummary(query ? String(query) : undefined);
                    result = {
                      success: true,
                      ...statusSummary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not retrieve background tasks: ${e?.message || e}` };
                  }
                } else if (call.name === "mark_background_task_notified") {
                  const { taskId } = call.args || {};
                  backgroundTasksService.markTaskNotified(String(taskId || "all"));
                  result = { success: true, message: "Task marked as notified to DK." };
                } else if (call.name === "cancel_background_task") {
                  const { taskIdOrName } = call.args || {};
                  const cancelled = backgroundTasksService.cancelTask(String(taskIdOrName || ""));
                  result = {
                    success: cancelled,
                    message: cancelled ? "Task successfully cancelled." : "No matching running task found to cancel.",
                  };
                } else if (call.name === "request_code_change") {
                  const { instruction } = call.args || {};
                  if (instruction && String(instruction).trim()) {
                    await codeAgentService.createRequest(String(instruction));
                    result = {
                      success: true,
                      message: "Samajh gayi, main repo analyze karke plan bana rahi hoon. Aapko WhatsApp aur dashboard dono pe update milega.",
                    };
                  } else {
                    result = { success: false, message: "No instruction provided." };
                  }
                } else if (call.name === "remember_personal_fact") {
                  const { factText, category } = call.args || {};
                  if (factText && String(factText).trim()) {
                    await memoryEngine.addPersonalVaultFact(category || "general_personal_info", String(factText));
                    result = { success: true, message: "Fact saved to permanent memory." };
                  } else {
                    result = { success: false, message: "No factText provided." };
                  }
                } else if (call.name === "add_custom_skill_or_rule") {
                  const { skillName, ruleInstruction, triggerPhrase } = call.args || {};
                  const fact = `Rule/Skill: "${skillName}" -> ${ruleInstruction}${triggerPhrase ? ` (When: ${triggerPhrase})` : ""}`;
                  await memoryEngine.addPersonalVaultFact("custom_skill", fact);
                  result = { success: true, message: `Skill "${skillName}" successfully integrated into Friday's brain!` };
                  clientWs.send(JSON.stringify({ type: "skill_added", skill: { skillName, ruleInstruction } }));
                } else if (call.name === "save_contact") {
                  const { contactName, phoneNumber, relation } = call.args || {};
                  const entry = await contactsService.saveContact(contactName, phoneNumber, relation);
                  result = { success: true, message: `Contact "${contactName}" (+${entry.phone}) successfully saved to DK's contacts book!` };
                  clientWs.send(JSON.stringify({ type: "contact_saved", contact: entry }));
                } else if (call.name === "delete_contact") {
                  const { contactNameOrPhone } = call.args || {};
                  const delRes = await contactsService.deleteContact(contactNameOrPhone);
                  result = delRes.deleted
                    ? { success: true, message: `Contact "${delRes.name}" (+${delRes.phone}) has been deleted from DK's contacts book.` }
                    : { success: false, message: `No matching contact found for "${contactNameOrPhone}" — nothing was deleted.` };
                  clientWs.send(JSON.stringify({ type: "contact_deleted", ...result }));
                } else if (call.name === "send_whatsapp_to_contact") {
                  const { contactNameOrPhone, messageText } = call.args || {};
                  const contact = await contactsService.findContact(contactNameOrPhone);
                  const targetPhone = contact ? contact.phone : contactNameOrPhone.replace(/[\s\-\(\)\+]/g, "");

                  // Primary: WhatsApp Cloud API (official, ban-safe).
                  // Fallback: Dedicated Baileys bot if linked.
                  const sendRes = await sendWhatsAppUnified(targetPhone, messageText);

                  result = {
                    success: sendRes.success,
                    via: sendRes.via,
                    message: sendRes.success
                      ? `Message successfully delivered to ${contact?.name || targetPhone}: "${messageText}"`
                      : `Delivery failed: ${sendRes.message}`,
                  };
                  clientWs.send(JSON.stringify({ type: "whatsapp_contact_sent", ...result }));
                } else if (call.name === "pair_dedicated_whatsapp_number") {
                  const { phoneNumber } = call.args || {};
                  try {
                    const code = await whatsappBotService.requestPairingCode(phoneNumber);
                    result = { success: true, pairingCode: code, message: `Pairing Code generated: ${code}. Link it in WhatsApp -> Linked Devices.` };
                    clientWs.send(JSON.stringify({ type: "pairing_code_ready", pairingCode: code }));
                  } catch (e: any) {
                    result = { success: false, message: `Failed to generate pairing code: ${e?.message || e}` };
                  }
                } else if (call.name === "set_reminder") {
                  const { title, timeString, durationMinutes } = call.args || {};
                  const reminder = await toolsEngine.addReminder(title, timeString, durationMinutes);
                  result = { success: true, message: `Reminder set: "${title}" for ${timeString || `${durationMinutes}m`}` };
                  clientWs.send(JSON.stringify({ type: "reminder_created", reminder }));
                } else if (call.name === "save_quick_note") {
                  const { title, content } = call.args || {};
                  const note = await toolsEngine.addNote(title, content);
                  result = { success: true, message: `Note "${title}" saved to DK's notebook.` };
                  clientWs.send(JSON.stringify({ type: "note_saved", note }));
                } else if (call.name === "get_whatsapp_latest_media") {
                  const { query } = call.args || {};
                  try {
                    result = await visionMemoryService.getLatestMediaInfo(query ? String(query) : undefined);
                  } catch (e: any) {
                    result = { hasMedia: false, analysis: `Media fetch error: ${e?.message || e}` };
                  }
                } else if (call.name === "get_whatsapp_messages") {
                  const { messageType, senderName, groupName, dateFilter, limit } = call.args || {};
                  try {
                    const msgs = await whatsappBotService.getMessages({
                      messageType: messageType || "all",
                      senderName,
                      groupName,
                      dateFilter,
                      limit: limit ? parseInt(limit) : undefined,
                    });
                    if (msgs.length === 0) {
                      result = { success: true, messages: [], summary: "Koi WhatsApp message nahi mila is filter ke sath." };
                    } else {
                      // ── Smart formatter ──────────────────────────────────────
                      // Helper: classify media type from text label
                      const mediaLabel = (text: string): string | null => {
                        if (text === "[Image]") return "ek photo";
                        if (text === "[Video]") return "ek video";
                        if (text === "[Voice Message]") return "ek voice message";
                        if (text === "[Sticker]") return "ek sticker";
                        if (text.startsWith("[Document]") || text === "[Document]") return "ek document";
                        if (/\.pdf/i.test(text) || text.includes("PDF")) return "ek PDF file";
                        if (text === "[Location]") return "location";
                        if (text.startsWith("[Contact:")) return "ek contact card";
                        if (text.startsWith("[Reaction:")) return null; // skip reactions
                        return null; // regular text
                      };

                      // Group by sender (phone for personal, phone+group for group)
                      const bySender = new Map<string, typeof msgs>();
                      for (const m of msgs) {
                        const key = m.isGroup ? `${m.senderPhone}@${m.groupId}` : m.senderPhone;
                        if (!bySender.has(key)) bySender.set(key, []);
                        bySender.get(key)!.push(m);
                      }

                      const summaryLines: string[] = [];
                      for (const senderMsgs of bySender.values()) {
                        const first = senderMsgs[0]; // newest first
                        const last = senderMsgs[senderMsgs.length - 1]; // oldest
                        const count = senderMsgs.length;

                        // Sender label: unknown vs known vs group
                        const senderLabel = first.isUnknownContact
                          ? `Unknown Number (+${first.senderPhone})`
                          : first.isGroup
                            ? `${first.senderName} in ${first.groupName}`
                            : first.senderName;

                        if (count === 1) {
                          const media = mediaLabel(first.text);
                          const content = media ? `${media} bheja` : `"${first.text}"`;
                          summaryLines.push(
                            `SENDER: ${senderLabel} | UNKNOWN: ${first.isUnknownContact} | TIME: ${first.dateStr} | COUNT: 1 | CONTENT: ${content}`
                          );
                        } else {
                          // Multiple messages — count by type
                          const textMsgs = senderMsgs.filter(m => !m.text.startsWith("["));
                          const mediaMsgs = senderMsgs.filter(m => m.text.startsWith("["));
                          const mediaTypes = [...new Set(mediaMsgs.map(m => mediaLabel(m.text)).filter(Boolean))].join(", ");

                          let countDesc = `${count} messages`;
                          if (textMsgs.length && mediaMsgs.length) {
                            countDesc = `${textMsgs.length} text message${textMsgs.length > 1 ? "s" : ""} aur ${mediaTypes}`;
                          } else if (mediaMsgs.length && !textMsgs.length) {
                            countDesc = `${count} media (${mediaTypes})`;
                          }

                          summaryLines.push(
                            `SENDER: ${senderLabel} | UNKNOWN: ${first.isUnknownContact} | FROM: ${last.dateStr} TO: ${first.dateStr} | COUNT: ${count} | SUMMARY: ${countDesc} | LAST_MSG: "${first.text}" | OLDEST_MSG: "${last.text}"`
                          );
                        }
                      }

                      const totalSenders = bySender.size;
                      result = {
                        success: true,
                        count: msgs.length,
                        senderCount: totalSenders,
                        summary: summaryLines.join("\n"),
                        instruction: "Read summary naturally. For unknown contacts say 'Boss, unknown number hai'. For multiple messages say count and ask if user wants last message or from beginning. For media clearly say what type was sent.",
                      };
                    }
                    clientWs.send(JSON.stringify({ type: "whatsapp_messages_read", count: msgs.length }));
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch messages: ${e?.message || e}` };
                  }
                } else if (call.name === "set_whatsapp_reply_limit") {
                  const { contactNameOrPhone, newLimit } = call.args || {};
                  try {
                    const limitRes = await whatsappBotService.setContactReplyLimit(
                      String(contactNameOrPhone || ""),
                      Number(newLimit)
                    );
                    result = limitRes;
                    if (limitRes.success) {
                      clientWs.send(JSON.stringify({ type: "whatsapp_reply_limit_set", contact: contactNameOrPhone, newLimit }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Could not set reply limit: ${e?.message || e}` };
                  }
                } else if (call.name === "save_daily_update") {
                  const { updateText } = call.args || {};
                  try {
                    if (!updateText || !String(updateText).trim()) {
                      result = { success: false, message: "No update text provided." };
                    } else {
                      const entry = await dailyUpdateService.appendUpdate(String(updateText).trim());
                      result = { success: true, message: "Update saved for today.", dateStr: entry.dateStr };
                      clientWs.send(JSON.stringify({ type: "daily_update_saved", dateStr: entry.dateStr }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Could not save update: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_update") {
                  const { dateWord } = call.args || {};
                  try {
                    const resolvedDate = resolveRelativeDateIST(String(dateWord || "aaj"));
                    const entry = await dailyUpdateService.getUpdateForDate(resolvedDate);
                    result = entry?.text
                      ? { success: true, dateStr: resolvedDate, updateText: entry.text }
                      : { success: true, dateStr: resolvedDate, updateText: null, message: "Is din ke liye koi update note nahi kiya gaya tha." };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch update: ${e?.message || e}` };
                  }
                } else if (call.name === "get_boss_daily_routine") {
                  try {
                    const currentInfo = bossRoutineService.getCurrentHabit();
                    const allSlots = await bossRoutineService.getAllRoutineSlots();
                    result = {
                      success: true,
                      currentTimeIST: currentInfo.istTimeStr,
                      currentHabit: currentInfo.currentSlot,
                      nextHabit: currentInfo.nextSlot,
                      timetable: allSlots.map((s) => ({
                        time: s.timeRangeStr,
                        title: s.title,
                        activity: s.activity,
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch routine: ${e?.message || e}` };
                  }
                } else if (call.name === "update_boss_daily_routine") {
                  const { slotQuery, startTimeStr, endTimeStr, activity, title } = call.args || {};
                  try {
                    result = await bossRoutineService.updateRoutineSlot(String(slotQuery || ""), {
                      startTimeStr: startTimeStr ? String(startTimeStr) : undefined,
                      endTimeStr: endTimeStr ? String(endTimeStr) : undefined,
                      activity: activity ? String(activity) : undefined,
                      title: title ? String(title) : undefined,
                    });
                  } catch (e: any) {
                    result = { success: false, message: `Could not update routine: ${e?.message || e}` };
                  }
                } else if (call.name === "record_ai_self_correction") {
                  const { whatFridayDidWrong, whatBossTaught, goldenRule, triggerContext } = call.args || {};
                  try {
                    result = await fridayLearningService.recordLesson({
                      whatFridayDidWrong: String(whatFridayDidWrong || ""),
                      whatBossTaught: String(whatBossTaught || ""),
                      goldenRule: String(goldenRule || ""),
                      triggerContext: triggerContext ? String(triggerContext) : undefined,
                    });
                  } catch (e: any) {
                    result = { success: false, message: `Could not save lesson: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ai_learned_lessons") {
                  try {
                    const lessons = await fridayLearningService.getAllLessons();
                    result = {
                      success: true,
                      totalLessons: lessons.length,
                      lessons: lessons.map((l) => ({
                        id: l.id,
                        whatFridayDidWrong: l.whatFridayDidWrong,
                        whatBossTaught: l.whatBossTaught,
                        goldenRule: l.goldenRule,
                        date: l.dateStr,
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch lessons: ${e?.message || e}` };
                  }
                } else if (call.name === "search_long_term_vector_memory") {
                  const { searchQuery, limit, filterDate } = call.args || {};
                  try {
                    result = await vectorMemoryService.searchSemanticMemory(
                      String(searchQuery || ""),
                      limit ? Number(limit) : 5,
                      0.15,
                      filterDate ? { exactDate: String(filterDate) } : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vector search failed: ${e?.message || e}` };
                  }
                } else if (call.name === "get_memory_lifecycle_status") {
                  try {
                    const vectorStats = await vectorMemoryService.getVectorStoreStats();
                    const memories = await memoryEngine.getMemories();
                    result = {
                      success: true,
                      lifecycleStatus: {
                        activeSessionsCount: memories.pastSessionsCount,
                        vectorStoreStats: vectorStats,
                        retentionRules: {
                          exactSessions: "4 Days (verbatim word-to-word with timestamps)",
                          comprehensiveSummaries: "4 to 60 Days",
                          permanentVectorArchival: "60+ Days (lifetime)",
                          dailyUpdatesVerbatim: "30 Days (word-to-word)",
                          liveScratchCache: "24 Hours (real-time crash-proof Firestore stream)",
                        },
                      },
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch lifecycle status: ${e?.message || e}` };
                  }
                } else if (call.name === "retrieve_smart_multi_tier_context") {
                  const { utterance } = call.args || {};
                  try {
                    result = await smartMemoryRetrieverService.fetchMultiTierMemory(String(utterance || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Multi-tier memory retrieval failed: ${e?.message || e}` };
                  }
                } else if (call.name === "get_weather") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getWeather(String(place || ""));
                    if (!result || !result.success) {
                      const bgTask = await backgroundTasksService.executeAutonomousTask(
                        `Weather Update (${place || "Local"})`,
                        "weather",
                        String(place || "")
                      );
                      result = {
                        success: false,
                        message: `Boss, ${place || "local"} weather instant connect nahi ho paya. Maine background me update start kar diya hai, jald hi complete karke batati hu!`,
                        backgroundTaskId: bgTask.id,
                      };
                    }
                  } catch (e: any) {
                    const bgTask = await backgroundTasksService.executeAutonomousTask(
                      `Weather Update (${place || "Local"})`,
                      "weather",
                      String(place || "")
                    );
                    result = {
                      success: false,
                      message: `Boss, weather fetch karne me dikkat aayi. Maine background me weather update laga diya hai, main update karke aapko batati hu!`,
                      backgroundTaskId: bgTask.id,
                    };
                  }
                } else if (call.name === "get_air_quality") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getAirQuality(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `AQI fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_sunrise_sunset") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getSunriseSunset(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Sunrise/sunset fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_recent_earthquakes") {
                  try {
                    result = await publicApisService.getRecentEarthquakes();
                  } catch (e: any) {
                    result = { success: false, message: `Earthquake data fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_exchange_rate") {
                  const { fromCurrency, toCurrency } = call.args || {};
                  try {
                    result = await publicApisService.getExchangeRate(String(fromCurrency || ""), String(toCurrency || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Exchange rate fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_crypto_price") {
                  const { coinId, vsCurrency } = call.args || {};
                  try {
                    result = await publicApisService.getCryptoPrice(String(coinId || ""), vsCurrency ? String(vsCurrency) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Crypto price fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_wikipedia_summary") {
                  const { topic } = call.args || {};
                  try {
                    result = await publicApisService.getWikipediaSummary(String(topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Wikipedia fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_current_time" || call.name === "get_time" || call.name === "get_live_clock") {
                  const now = new Date();
                  const istTime = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
                  const istDate = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
                  result = {
                    success: true,
                    currentTime: istTime,
                    currentDate: istDate,
                    timezone: "Asia/Kolkata (Indian Standard Time)",
                    timestamp: now.getTime(),
                    message: `Boss, abhi theek ${istTime} ho rahe hain, aaj ${istDate} hai.`,
                  };
                } else if (call.name === "get_wikiquote_summary") {
                  const { person } = call.args || {};
                  try {
                    result = await publicApisService.getWikiquote(String(person || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Wikiquote fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_book") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.searchBook(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Book search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_word_meaning") {
                  const { word } = call.args || {};
                  try {
                    result = await publicApisService.getWordMeaning(String(word || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Word meaning fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_country_info") {
                  const { country } = call.args || {};
                  try {
                    result = await publicApisService.getCountryInfo(String(country || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Country info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_number_fact") {
                  const { number } = call.args || {};
                  try {
                    result = await publicApisService.getNumberFact(Number(number));
                  } catch (e: any) {
                    result = { success: false, message: `Number fact fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_trivia_question") {
                  try {
                    result = await publicApisService.getTriviaQuestion();
                  } catch (e: any) {
                    result = { success: false, message: `Trivia fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pincode_info") {
                  const { pincode } = call.args || {};
                  try {
                    result = await publicApisService.getPinCodeInfo(String(pincode || ""));
                  } catch (e: any) {
                    result = { success: false, message: `PIN code fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_nearby_places") {
                  const { place, amenity } = call.args || {};
                  try {
                    result = await publicApisService.getNearbyPlaces(String(place || ""), String(amenity || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Nearby places fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_timezone_info") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getTimeZoneInfo(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Timezone fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_covid_stats") {
                  const { country } = call.args || {};
                  try {
                    result = await publicApisService.getCovidStats(country ? String(country) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `COVID stats fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_qr_code") {
                  const { text } = call.args || {};
                  result = publicApisService.getQrCodeUrl(String(text || ""));
                } else if (call.name === "get_random_user") {
                  try {
                    result = await publicApisService.getRandomUser();
                  } catch (e: any) {
                    result = { success: false, message: `Random user generate fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_github_user_info") {
                  const { username } = call.args || {};
                  try {
                    result = await publicApisService.getGithubUserInfo(String(username || ""));
                  } catch (e: any) {
                    result = { success: false, message: `GitHub user fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_github_repo_info") {
                  const { owner, repo } = call.args || {};
                  try {
                    result = await publicApisService.getGithubRepoInfo(String(owner || ""), String(repo || ""));
                  } catch (e: any) {
                    result = { success: false, message: `GitHub repo fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ip_lookup") {
                  const { ip } = call.args || {};
                  try {
                    result = await publicApisService.getIpLookup(String(ip || ""));
                  } catch (e: any) {
                    result = { success: false, message: `IP lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_dad_joke") {
                  try {
                    result = await publicApisService.getDadJoke();
                  } catch (e: any) {
                    result = { success: false, message: `Joke fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_chuck_norris_joke") {
                  try {
                    result = await publicApisService.getChuckNorrisJoke();
                  } catch (e: any) {
                    result = { success: false, message: `Joke fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_public_holidays") {
                  const { countryCode, year } = call.args || {};
                  try {
                    result = await publicApisService.getPublicHolidays(countryCode ? String(countryCode) : undefined, year ? Number(year) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Holiday list fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_anime") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.searchAnime(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Anime search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "translate_text") {
                  const { text, targetLang } = call.args || {};
                  try {
                    result = await publicApisService.translateText(String(text || ""), String(targetLang || "en"));
                  } catch (e: any) {
                    result = { success: false, message: `Translation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_news") {
                  const { topic, country, count, engine } = call.args || {};
                  try {
                    result = await publicApisService.getNews(
                      topic ? String(topic) : undefined,
                      country ? String(country) : undefined,
                      typeof count === "number" ? count : 10,
                      engine ? (String(engine) as any) : "auto"
                    );
                  } catch (e: any) {
                    result = { success: false, message: `News fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_cricket_scores") {
                  const { team, query } = call.args || {};
                  try {
                    result = await publicApisService.getCricketScores(team || query ? String(team || query) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Cricket scores fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_upcoming_cricket_matches") {
                  const { filter, team } = call.args || {};
                  try {
                    result = await publicApisService.getUpcomingCricketMatches(filter || team ? String(filter || team) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Upcoming cricket matches fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_cricket_player_profile") {
                  const { playerName, player, name, query } = call.args || {};
                  try {
                    result = await publicApisService.getCricketPlayerProfile(String(playerName || player || name || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Cricket player profile fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_sports_events") {
                  const { league } = call.args || {};
                  try {
                    result = await publicApisService.getSportsEvents(String(league || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Sports events fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_stock_price") {
                  const { symbol } = call.args || {};
                  try {
                    result = await publicApisService.getStockPrice(String(symbol || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Stock price fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_movie_info") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.getMovieInfo(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Movie info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_pexels_image") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchPexelsImage(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Pexels search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_unsplash_image") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchUnsplashImage(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Unsplash search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_directions") {
                  const { fromPlace, toPlace } = call.args || {};
                  try {
                    result = await publicApisService.getDirections(String(fromPlace || ""), String(toPlace || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Directions fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_nutrition_info") {
                  const { foodQuery } = call.args || {};
                  try {
                    result = await publicApisService.getNutritionInfo(String(foodQuery || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Nutrition info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_recipe") {
                  const { query, cuisine, diet, type, maxCalories, minProtein } = call.args || {};
                  try {
                    result = await publicApisService.searchRecipe(
                      String(query || ""),
                      cuisine ? String(cuisine) : undefined,
                      diet ? String(diet) : undefined,
                      type ? String(type) : undefined,
                      maxCalories ? Number(maxCalories) : undefined,
                      minProtein ? Number(minProtein) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Recipe search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_recipes_by_ingredients") {
                  const { ingredients, count } = call.args || {};
                  try {
                    result = await publicApisService.searchRecipesByIngredients(
                      String(ingredients || ""),
                      count ? Number(count) : 5
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Ingredients recipe search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_recipe_details") {
                  const { recipeIdOrTitle } = call.args || {};
                  try {
                    result = await publicApisService.getRecipeDetails(String(recipeIdOrTitle || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Recipe details fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_random_recipes") {
                  const { tags, count } = call.args || {};
                  try {
                    result = await publicApisService.getRandomRecipes(
                      tags ? String(tags) : undefined,
                      count ? Number(count) : 3
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Random recipes fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ingredient_substitutes") {
                  const { ingredientName } = call.args || {};
                  try {
                    result = await publicApisService.getIngredientSubstitutes(String(ingredientName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Substitute lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "generate_meal_plan") {
                  const { targetCalories, timeFrame, diet } = call.args || {};
                  try {
                    result = await publicApisService.generateMealPlan(
                      targetCalories ? Number(targetCalories) : 2000,
                      timeFrame ? (String(timeFrame) as any) : "day",
                      diet ? String(diet) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Meal plan generation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_flight_status") {
                  const { flightNumber } = call.args || {};
                  try {
                    result = await publicApisService.getFlightStatus(String(flightNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Flight status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_govt_data") {
                  const { keyword } = call.args || {};
                  try {
                    result = await publicApisService.searchGovtData(String(keyword || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Govt data search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_product_by_barcode") {
                  const { upc } = call.args || {};
                  try {
                    result = await publicApisService.getProductByBarcode(String(upc || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Barcode lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_trains_between_stations") {
                  const { fromPlace, toPlace } = call.args || {};
                  try {
                    result = await publicApisService.getTrainsBetweenStations(String(fromPlace || ""), String(toPlace || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train list fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_train_schedule") {
                  const { trainNumberOrName, trainNumber, trainName } = call.args || {};
                  try {
                    result = await publicApisService.getTrainSchedule(String(trainNumberOrName || trainNumber || trainName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train schedule fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_live_train_status") {
                  const { trainNumberOrName, trainNumber, trainName, startDay } = call.args || {};
                  try {
                    result = await publicApisService.getLiveTrainStatus(
                      String(trainNumberOrName || trainNumber || trainName || ""),
                      typeof startDay === "number" ? startDay : 0
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Live train status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_train") {
                  const { query, trainName, trainNumber } = call.args || {};
                  try {
                    result = await publicApisService.searchTrain(String(query || trainName || trainNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pnr_status") {
                  const { pnrNumber } = call.args || {};
                  try {
                    result = await publicApisService.getPnrStatus(String(pnrNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `PNR status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_product_deals") {
                  const { productName, product, query, platform, store, sortBy, page } = call.args || {};
                  try {
                    result = await publicApisService.searchProductDeals(
                      String(productName || product || query || ""),
                      {
                        platform: platform || store ? String(platform || store) : undefined,
                        sortBy: sortBy ? String(sortBy) : undefined,
                        page: typeof page === "number" ? page : undefined,
                      }
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Product search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_life_suggestion") {
                  const { category, context } = call.args || {};
                  try {
                    result = await publicApisService.getDailyLifeSuggestion(
                      category ? String(category) : undefined,
                      context ? String(context) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Life suggestion fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_website_or_helpline_info") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getWebsiteOrHelplineInfo(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Website/Helpline info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_instagram_user_info") {
                  const { username, usernameOrQuery, query } = call.args || {};
                  try {
                    result = await publicApisService.getInstagramUserInfo(String(username || usernameOrQuery || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Instagram user info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_instagram_user") {
                  const { query, username, name } = call.args || {};
                  try {
                    result = await publicApisService.searchInstagramUser(String(query || username || name || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Instagram search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_x_twitter_info") {
                  const { usernameOrTopic, username, topic, query } = call.args || {};
                  try {
                    result = await publicApisService.getXTwitterInfo(String(usernameOrTopic || username || topic || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `X (Twitter) info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_x_twitter") {
                  const { query, username, topic } = call.args || {};
                  try {
                    result = await publicApisService.searchXTwitter(String(query || username || topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `X (Twitter) search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_location_overview") {
                  const { place, location, city } = call.args || {};
                  try {
                    result = await publicApisService.getLocationOverview(String(place || location || city || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Location overview fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_youtube") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchYouTube(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `YouTube search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_reddit") {
                  const { topicOrSubreddit } = call.args || {};
                  try {
                    result = await publicApisService.searchReddit(String(topicOrSubreddit || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Reddit search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_music" || call.name === "play_music" || call.name === "play_youtube_music") {
                  const songQuery = String(
                    call.args?.songName ||
                    call.args?.songOrArtist ||
                    call.args?.song ||
                    call.args?.query ||
                    call.args?.track ||
                    call.args?.title ||
                    call.args?.name ||
                    call.args?.artist ||
                    ""
                  ).trim();

                  try {
                    const ytMusicRes = await publicApisService.searchYouTubeMusic(songQuery || "Chammak Challo");
                    result = ytMusicRes;
                    if (ytMusicRes.success) {
                      const payload = JSON.stringify({
                        type: 'play_youtube_music',
                        track: ytMusicRes,
                      });
                      try { clientWs.send(payload); } catch {}
                      for (const client of connectedClients) {
                        if (client !== clientWs && client.readyState === 1) {
                          try { client.send(payload); } catch {}
                        }
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_song_by_lyrics") {
                  const { lyrics, artistHint } = call.args || {};
                  try {
                    result = await toolsEngine.searchSongByLyrics(String(lyrics || ""), artistHint ? String(artistHint) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Lyrics search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_playing_song") {
                  const { songClue, audioSnippetBase64 } = call.args || {};
                  try {
                    result = await toolsEngine.identifyPlayingSong(
                      audioSnippetBase64 ? String(audioSnippetBase64) : undefined,
                      songClue ? String(songClue) : undefined
                    );
                    if (result.success && result.identifiedSong) {
                      clientWs.send(JSON.stringify({
                        type: 'song_identified',
                        song: result.identifiedSong,
                        mode: 'live_playing_song',
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Playing song identify fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_song_by_humming_or_tune") {
                  const { hummingOrTuneClue, artistHint } = call.args || {};
                  try {
                    result = await toolsEngine.identifySongByHummingOrTune(
                      String(hummingOrTuneClue || ""),
                      artistHint ? String(artistHint) : undefined
                    );
                    if (result.success && result.identifiedSong) {
                      clientWs.send(JSON.stringify({
                        type: 'song_identified',
                        song: result.identifiedSong,
                        mode: 'humming_melody',
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Humming identify fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_morning_briefing") {
                  const { city } = call.args || {};
                  try {
                    result = await toolsEngine.getMorningBriefing(city ? String(city) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Morning briefing fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_system_health") {
                  try {
                    result = toolsEngine.getSystemHealth();
                  } catch (e: any) {
                    result = { success: false, message: `System health check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "deep_autonomous_research") {
                  const { topic } = call.args || {};
                  try {
                    result = await toolsEngine.executeDeepResearch(String(topic || ""));
                    clientWs.send(JSON.stringify({
                      type: 'deep_research_result',
                      report: result,
                    }));
                  } catch (e: any) {
                    result = { success: false, message: `Deep research fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_screen_context") {
                  const { userQuery, imageBase64 } = call.args || {};
                  try {
                    result = await toolsEngine.analyzeScreenContext(
                      imageBase64 ? String(imageBase64) : undefined,
                      userQuery ? String(userQuery) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Screen analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "switch_voice_persona") {
                  const { personaName } = call.args || {};
                  try {
                    result = toolsEngine.switchVoicePersona(String(personaName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Persona switch fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "organize_directory") {
                  const { directoryPath } = call.args || {};
                  try {
                    result = await toolsEngine.organizeDirectory(directoryPath ? String(directoryPath) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `File organization fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clean_temp_files") {
                  try {
                    result = await toolsEngine.cleanTempFiles();
                  } catch (e: any) {
                    result = { success: false, message: `Temp file cleanup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "add_expense") {
                  const { amount, description, categoryHint } = call.args || {};
                  try {
                    result = await toolsEngine.addExpense(
                      Number(amount || 0),
                      String(description || ""),
                      categoryHint ? String(categoryHint) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Expense add fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_expense_summary") {
                  const { filterMonth } = call.args || {};
                  try {
                    result = await toolsEngine.getExpenseSummary(filterMonth ? String(filterMonth) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Expense summary check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "schedule_meeting") {
                  const { title, timeString, durationMinutes, locationOrLink } = call.args || {};
                  try {
                    result = await toolsEngine.scheduleMeeting(
                      String(title || "Meeting"),
                      String(timeString || "Soon"),
                      durationMinutes ? Number(durationMinutes) : 30,
                      locationOrLink ? String(locationOrLink) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Meeting schedule fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_upcoming_meetings") {
                  try {
                    result = await toolsEngine.getUpcomingMeetings();
                  } catch (e: any) {
                    result = { success: false, message: `Upcoming meetings check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "summarize_inbox") {
                  try {
                    result = await toolsEngine.summarizeInbox();
                  } catch (e: any) {
                    result = { success: false, message: `Inbox summary fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_quick_email") {
                  const { toEmail, subject, bodyText } = call.args || {};
                  try {
                    result = await toolsEngine.sendQuickEmail(
                      String(toEmail || ""),
                      String(subject || ""),
                      String(bodyText || "")
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Email send fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "log_water_intake") {
                  const { glasses } = call.args || {};
                  try {
                    result = await toolsEngine.logWaterIntake(glasses ? Number(glasses) : 1);
                  } catch (e: any) {
                    result = { success: false, message: `Water log fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_health_status") {
                  try {
                    result = await toolsEngine.getHealthStatus();
                  } catch (e: any) {
                    result = { success: false, message: `Health status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "add_to_shopping_list") {
                  const { itemsQuery } = call.args || {};
                  try {
                    result = await toolsEngine.addToShoppingList(String(itemsQuery || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list add fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_shopping_list") {
                  try {
                    result = await toolsEngine.getShoppingList();
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list get fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_shopping_list_on_whatsapp") {
                  const { targetPhone } = call.args || {};
                  try {
                    result = await toolsEngine.sendShoppingListOnWhatsApp(targetPhone ? String(targetPhone) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list WhatsApp send fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clear_shopping_list") {
                  try {
                    result = await toolsEngine.clearShoppingList();
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list clear fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "trigger_emergency_sos") {
                  const { customMessage, targetPhone } = call.args || {};
                  try {
                    result = await toolsEngine.triggerEmergencySos(
                      customMessage ? String(customMessage) : undefined,
                      targetPhone ? String(targetPhone) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Emergency SOS trigger fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "generate_daily_podcast") {
                  try {
                    result = await toolsEngine.generateDailyPodcast();
                  } catch (e: any) {
                    result = { success: false, message: `Podcast generation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_fast2sms_message") {
                  const { phoneNumberOrContactName, phoneNumber, contactName, messageText } = call.args || {};
                  const target = String(phoneNumberOrContactName || phoneNumber || contactName || "");
                  try {
                    result = await toolsEngine.sendFast2Sms(target, String(messageText || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Fast2SMS send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "summarize_voice_note") {
                  const { transcript, senderName } = call.args || {};
                  try {
                    result = await toolsEngine.summarizeVoiceNote(String(transcript || ""), senderName ? String(senderName) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Voice note summary fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "store_vault_secret") {
                  const { keyName, secretValue, category } = call.args || {};
                  try {
                    result = await toolsEngine.storeVaultSecret(
                      String(keyName || ""),
                      String(secretValue || ""),
                      category ? String(category) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vault save fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "retrieve_vault_secret") {
                  const { keyName } = call.args || {};
                  try {
                    result = await toolsEngine.retrieveVaultSecret(String(keyName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Vault retrieve fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "list_vault_secrets") {
                  try {
                    result = await toolsEngine.listVaultSecrets();
                  } catch (e: any) {
                    result = { success: false, message: `Vault list fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_train_live_status") {
                  const { trainNumberOrName } = call.args || {};
                  try {
                    result = await toolsEngine.getTrainLiveStatus(String(trainNumberOrName || ""));
                    if (result && result.success) {
                      safeSend(JSON.stringify({ type: 'train_live_status', train: result }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Train status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "check_pnr_status") {
                  const { pnrNumber } = call.args || {};
                  try {
                    result = await toolsEngine.checkPnrStatus(String(pnrNumber || ""));
                    if (result && result.success) {
                      safeSend(JSON.stringify({ type: 'pnr_live_status', pnr: result }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `PNR check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "control_smart_device") {
                  const { deviceNameOrRoom, action, value } = call.args || {};
                  try {
                    result = await toolsEngine.controlSmartDevice(
                      String(deviceNameOrRoom || ""),
                      action,
                      value ? Number(value) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Smart device control fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_smart_home_status") {
                  try {
                    result = await toolsEngine.getSmartHomeStatus();
                  } catch (e: any) {
                    result = { success: false, message: `Smart home status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "start_focus_mode") {
                  const { durationMinutes, goalTitle } = call.args || {};
                  try {
                    result = await toolsEngine.startFocusMode(
                      durationMinutes ? Number(durationMinutes) : 25,
                      goalTitle ? String(goalTitle) : undefined
                    );
                    if (result.lofiStreamUrl) {
                      clientWs.send(JSON.stringify({
                        type: 'play_music',
                        trackName: `Focus Mode Lo-Fi Beats (${result.goalTitle})`,
                        artistName: "Friday Productivity Lo-Fi",
                        audioUrl: result.lofiStreamUrl,
                        isFullSong: true,
                        quality: "Chill Lo-Fi Radio",
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Focus mode start fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "stop_focus_mode") {
                  try {
                    result = toolsEngine.stopFocusMode();
                    safeSend(JSON.stringify({ type: 'stop_music' }));
                  } catch (e: any) {
                    result = { success: false, message: `Focus mode stop fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "track_product_price") {
                  const { productName, currentPrice, targetPrice, productUrl } = call.args || {};
                  try {
                    result = await toolsEngine.trackProductPrice(
                      String(productName || ""),
                      Number(currentPrice || 0),
                      targetPrice ? Number(targetPrice) : undefined,
                      productUrl ? String(productUrl) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Price tracking fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_tracked_prices") {
                  try {
                    result = await toolsEngine.getTrackedProducts();
                  } catch (e: any) {
                    result = { success: false, message: `Tracked prices check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_document") {
                  const { documentTextOrSnippet, docTitle } = call.args || {};
                  try {
                    result = await toolsEngine.analyzeDocument(
                      String(documentTextOrSnippet || ""),
                      docTitle ? String(docTitle) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Document analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "query_document") {
                  const { documentText, question } = call.args || {};
                  try {
                    result = await toolsEngine.queryDocument(String(documentText || ""), String(question || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Document query fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_work_digest") {
                  try {
                    result = await toolsEngine.generateDailyWorkDigest();
                  } catch (e: any) {
                    result = { success: false, message: `Daily work digest fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_messenger_chat") {
                  const { chatId, text, mediaType, mediaUrl, mediaTitle } = call.args || {};
                  try {
                    result = await toolsEngine.sendMessengerMessage(
                      String(chatId || "boss_dk"),
                      String(text || ""),
                      mediaType || "text",
                      mediaUrl ? String(mediaUrl) : undefined,
                      mediaTitle ? String(mediaTitle) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Messenger send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_messenger_inbox") {
                  try {
                    result = await toolsEngine.getMessengerInbox();
                  } catch (e: any) {
                    result = { success: false, message: `Messenger inbox check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "set_messenger_contact_role") {
                  const { contactId, role } = call.args || {};
                  try {
                    result = await toolsEngine.setMessengerContactRole(String(contactId || ""), role);
                  } catch (e: any) {
                    result = { success: false, message: `Messenger role update fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "play_music") {
                  const { songName } = call.args || {};
                  try {
                    result = await publicApisService.playMusic(String(songName || ""));
                    if (result.success) {
                      clientWs.send(JSON.stringify({
                        type: 'play_music',
                        trackName: result.trackName,
                        artistName: result.artistName,
                        albumArt: result.albumArt,
                        audioUrl: result.audioUrl,
                        videoId: result.videoId,
                        embedUrl: result.embedUrl,
                        isYouTubeMusic: !!result.isYouTubeMusic || !!result.videoId,
                        spotifyUrl: result.spotifyUrl,
                        youtubeMusicUrl: result.youtubeMusicUrl,
                        isFullSong: result.isFullSong,
                        quality: result.quality,
                        durationSec: result.durationSec,
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music play fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "stop_music") {
                  try {
                    result = await publicApisService.stopMusic();
                    safeSend(JSON.stringify({ type: 'stop_music' }));
                  } catch (e: any) {
                    result = { success: false, message: `Music stop fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "pause_music") {
                  try {
                    safeSend(JSON.stringify({ type: 'pause_music' }));
                    result = { success: true, message: "Boss, gana pause kar diya hai! ⏸️" };
                  } catch (e: any) {
                    result = { success: false, message: `Music pause fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "resume_music") {
                  try {
                    safeSend(JSON.stringify({ type: 'resume_music' }));
                    result = { success: true, message: "Boss, gana resume kar diya hai! ▶️" };
                  } catch (e: any) {
                    result = { success: false, message: `Music resume fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_connected_wifi_devices") {
                  const { forceRefresh } = call.args || {};
                  try {
                    const scan = await networkDeviceScannerService.scanConnectedDevices(Boolean(forceRefresh));
                    result = {
                      success: true,
                      totalDevices: scan.totalDevices,
                      summary: scan.summary,
                      subnet: scan.subnet,
                      gatewayIp: scan.gatewayIp,
                      selfIp: scan.selfIp,
                      wifiHealth: scan.wifiHealth,
                      devices: scan.devices.map((d) => ({
                        vendor: d.vendor,
                        hostname: d.hostname,
                        modelName: d.modelName,
                        ip: d.ip,
                        deviceType: d.deviceType,
                        services: d.services,
                        activeStream: d.activeStream,
                        isGateway: d.isGateway,
                        isSelf: d.isSelf,
                      })),
                      speechContext: networkDeviceScannerService.compileVoicePromptContext(scan),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Wi-Fi devices scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_nearby_wifi_recon") {
                  const { forceRefresh } = call.args || {};
                  try {
                    const recon = await networkDeviceScannerService.scanNearbyWifiRecon(Boolean(forceRefresh));
                    result = {
                      success: true,
                      totalNetworks: recon.totalNetworks,
                      securitySummary: recon.securitySummary,
                      channelAnalysis: recon.channelAnalysis,
                      currentConnectedSsid: recon.currentConnectedSsid,
                      networks: recon.networks.slice(0, 10),
                      speechContext: networkDeviceScannerService.compileReconVoicePromptContext(recon),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Airspace Wi-Fi Recon fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "start_voice_enrollment") {
                  const { pin, name, relationWithDivakar, role } = call.args || {};
                  try {
                    result = await voiceBiometricsService.startVoiceEnrollment(
                      String(pin || ""),
                      String(name || "Guest"),
                      String(relationWithDivakar || "Friend"),
                      role || "friend"
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice enrollment start fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "record_voice_calibration_sample") {
                  const { sessionId, spokenPhrase } = call.args || {};
                  try {
                    // Uses dummy/live sample buffer from current turn
                    result = await voiceBiometricsService.recordCalibrationSample(
                      String(sessionId || ""),
                      "",
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Calibration sample record fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "list_voice_profiles") {
                  try {
                    const profiles = await voiceBiometricsService.getProfiles();
                    result = {
                      success: true,
                      totalProfiles: profiles.length,
                      profiles: profiles.map((p) => ({
                        id: p.id,
                        name: p.name,
                        role: p.role,
                        relationWithDivakar: p.relationWithDivakar,
                        isRootAdmin: p.isRootAdmin,
                      })),
                      speechContext: await voiceBiometricsService.compileVoiceProfilesPromptContext(),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice profiles fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_voice_profile") {
                  const { pin, profileId } = call.args || {};
                  try {
                    result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId ? String(profileId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Voice profile delete fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "update_voice_pin") {
                  const { newPin } = call.args || {};
                  try {
                    result = await voiceBiometricsService.updateVoicePin(String(newPin || ""), "Boss (DK)");
                  } catch (e: any) {
                    result = { success: false, message: `Voice PIN update fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_music_on_whatsapp") {
                  const { songName, targetPhone } = call.args || {};
                  try {
                    // Step 1: Get real YouTube link
                    const ytResult = await publicApisService.getYouTubeMusicLink(String(songName || ""));
                    const ytLink = ytResult?.youtubeShortUrl || ytResult?.youtubeUrl;
                    const songTitle = ytResult?.title || String(songName || "");

                    if (!ytLink) {
                      result = { success: false, message: `Boss, "${songName}" ka YouTube link nahi mila.` };
                    } else {
                      // Step 2: Resolve target phone
                      let sendToPhone = process.env.OWNER_WHATSAPP_NUMBER || "";
                      if (targetPhone && String(targetPhone).trim()) {
                        const contact = await contactsService.findContact(String(targetPhone));
                        sendToPhone = contact ? contact.phone : String(targetPhone).replace(/[\s\-\(\)\+]/g, "");
                      }

                      if (!sendToPhone) {
                        result = {
                          success: false,
                          message: `Boss, OWNER_WHATSAPP_NUMBER .env mein set nahi hai.`,
                          youtubeLink: ytLink, songTitle,
                        };
                      } else {
                        const waMsg = `\uD83C\uDFB5 *${songTitle}*\n\n${ytLink}\n\n_Friday se bheja gaya_ \u2728`;

                        // ── Primary: WhatsApp Cloud API (official, ban-safe) ────────
                        const cloudRes = await whatsappCloudService.sendMessage(sendToPhone, waMsg);

                        if (cloudRes.success) {
                          result = {
                            success: true,
                            via: "cloud_api",
                            message: `Boss, "${songTitle}" ka YouTube link aapke WhatsApp par bhej diya! \uD83C\uDFB5`,
                            youtubeLink: ytLink, songTitle, sentTo: sendToPhone,
                          };
                        } else {
                          // ── Cloud API failed ──────────────────────────────
                          if (baileysEnabled) {
                            // ── Fallback: Baileys (only if boss has enabled it) ─
                            console.warn("[Server] Cloud API failed, falling back to Baileys...");
                            const baileysRes = await whatsappBotService.sendMessage(sendToPhone, waMsg);
                            if (baileysRes.success) {
                              result = {
                                success: true,
                                via: "baileys_fallback",
                                message: `Boss, Cloud API se nahi gaya tha, Baileys se bhej diya "${songTitle}" ka link! \uD83C\uDFB5`,
                                youtubeLink: ytLink, songTitle, sentTo: sendToPhone,
                              };
                            } else {
                              result = {
                                success: false,
                                message: `Boss, Cloud API aur Baileys dono se message nahi gaya. Cloud: ${cloudRes.message} | Baileys: ${baileysRes.message}`,
                                youtubeLink: ytLink, songTitle,
                              };
                            }
                          } else {
                            // Baileys OFF — honest message, offer to enable
                            result = {
                              success: false,
                              cloudError: cloudRes.message,
                              youtubeLink: ytLink,
                              songTitle,
                              baileysEnabled: false,
                              message: `Boss, Cloud API se message nahi gaya (${cloudRes.message}). Baileys system abhi OFF hai. Kya Baileys on karun backup ke liye? Bolo "Baileys on karo".`,
                            };
                          }
                        }
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music WhatsApp send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "toggle_baileys_system") {
                  const { action } = call.args || {};
                  try {
                    const act = String(action || "").toLowerCase().trim();
                    if (act === "on") {
                      baileysEnabled = true;
                    } else if (act === "off") {
                      baileysEnabled = false;
                    }
                    // "status" just returns current state without changing
                    const stateLabel = baileysEnabled ? "ON (active as fallback)" : "OFF";
                    result = {
                      success: true,
                      action: act,
                      baileysEnabled,
                      message: baileysEnabled
                        ? `Boss, Baileys system ON kar diya. Ab agar Cloud API fail ho to Baileys backup pe kaam karega.`
                        : `Boss, Baileys system OFF kar diya. Sirf Cloud API (official Meta) use hogi. Safer hai.`,
                      currentState: stateLabel,
                    };
                    console.log(`[Server] toggle_baileys_system called: action=${act}, baileysEnabled=${baileysEnabled}`);
                  } catch (e: any) {
                    result = { success: false, message: `Baileys toggle fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "dispatch_bug_to_code_agent") {
                  const { problemTitle, serviceName, errorDetails, instruction } = call.args || {};
                  try {
                    const fullInstruction = `[Bug Fix / Self-Healing Request]
Title: ${problemTitle || "Fix broken service"}
Component/Service: ${serviceName || "Unknown"}
Error Details/Logs: ${errorDetails || "Service reported failure"}

Detailed Instruction:
${instruction}

Please review the codebase, diagnose the root cause, fix the issue with proper error handling/fallbacks, and propose the changes.`;

                    const req = await codeAgentService.createRequest(fullInstruction, problemTitle || "Bug Fix Request");
                    const reqId = req.id;
                    if (errorDetails) {
                      await codeAgentService.addLog(reqId, `Bug Report Context: ${errorDetails}`, "warn", "bug_report");
                    }
                    result = {
                      success: true,
                      requestId: reqId,
                      message: `Boss, issue Coding Agent ko bhej diya gaya hai (Task ID: ${reqId}). Agent codebase scan karke solution plan banayega.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent ko task bhejne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "rollback_last_code_change") {
                  try {
                    const rollbackRes = await codeAgentService.rollback();
                    result = {
                      success: true,
                      message: `Boss, aakhri code change rollback kar diya gaya hai! Origin repo wapas stable commit par reset ho gaya hai.`,
                      details: rollbackRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Rollback fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pending_code_agent_request") {
                  try {
                    const pending = await codeAgentService.getPendingRequest();
                    if (!pending) {
                      result = { hasPending: false, message: "Abhi koi coding agent task permission ke liye wait nahi kar raha hai boss." };
                    } else {
                      const filesList = pending.plan?.files?.map((f: any) => `${f.path} (${f.action})`).join(", ") || "Files";
                      result = {
                        hasPending: true,
                        requestId: pending.id,
                        instruction: pending.instruction,
                        summary: pending.plan?.summary,
                        affectedFiles: filesList,
                        message: `Boss, Coding Agent permission maang raha hai: "${pending.instruction}". Plan: ${pending.plan?.summary}. Affected files: ${filesList}.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Pending request check karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_and_commit_code_agent") {
                  const { requestId } = call.args || {};
                  try {
                    const targetId = requestId || (await codeAgentService.getPendingRequest())?.id;
                    if (!targetId) {
                      result = { success: false, message: "Boss, koi pending coding request nahi mili jise approve kiya ja sake." };
                    } else {
                      await codeAgentService.approveAndPushDirectlyToMain(targetId);
                      result = {
                        success: true,
                        requestId: targetId,
                        message: `Boss, Coding Agent ko command de di hai! Code ko compile aur direct main origin branch me commit & push kiya ja raha hai.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Approve and commit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "deny_code_agent_request") {
                  const { requestId } = call.args || {};
                  try {
                    const targetId = requestId || (await codeAgentService.getPendingRequest())?.id;
                    if (!targetId) {
                      result = { success: false, message: "Boss, koi pending coding request nahi mili jise deny kiya ja sake." };
                    } else {
                      await codeAgentService.deny(targetId);
                      result = {
                        success: true,
                        requestId: targetId,
                        message: `Boss, Coding Agent task ko deny aur cancel kar diya gaya hai.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Deny fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "search_and_explain_codebase") {
                  const { query } = call.args || {};
                  try {
                    const searchRes = await codeAgentService.searchAndExplainCodebase(String(query || ""));
                    result = {
                      success: true,
                      explanation: searchRes.answer,
                      relatedFiles: searchRes.relatedFiles,
                      message: searchRes.answer,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Codebase search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clean_project_codebase") {
                  try {
                    const cleanRes = await codeAgentService.runCodebaseCleanup();
                    result = {
                      success: true,
                      taskId: cleanRes.taskId,
                      message: `Boss, codebase cleanup ka task Coding Agent ko de diya gaya hai (Task ID: ${cleanRes.taskId}). Unused imports aur debris clean ho rahe hain.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Cleanup task start karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "crawl_and_extract_webpage") {
                  const { url, query } = call.args || {};
                  try {
                    if (!url) {
                      result = { success: false, message: "URL batana zaroori hai boss." };
                    } else {
                      const crawlRes = await webCrawlerService.crawlUrl(String(url));
                      if (crawlRes.error) {
                        result = { success: false, message: `Website crawl nahi ho payi: ${crawlRes.error}` };
                      } else {
                        let aiAnswer = "";
                        if (query && String(query).trim()) {
                          const queryRes = await webCrawlerService.queryCrawledContent(crawlRes.markdown, String(query));
                          aiAnswer = queryRes.answer;
                        } else {
                          const summaryRes = await webCrawlerService.summarizeWebpage(crawlRes.markdown);
                          aiAnswer = summaryRes.executiveSummary;
                        }
                        result = {
                          success: true,
                          title: crawlRes.metadata.title,
                          url: crawlRes.finalUrl,
                          tokens: crawlRes.estimatedTokens,
                          answer: aiAnswer,
                          message: `Boss, maine ${crawlRes.finalUrl} ko crawl kar liya hai (${crawlRes.metadata.title}):\n\n${aiAnswer}`,
                        };
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Crawling fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "deep_crawl_website") {
                  const { url, maxPages, query } = call.args || {};
                  try {
                    if (!url) {
                      result = { success: false, message: "Root URL batana zaroori hai boss." };
                    } else {
                      const deepRes = await webCrawlerService.deepCrawl(String(url), {
                        maxPages: maxPages ? Number(maxPages) : 4,
                      });
                      const promptGoal = query
                        ? String(query)
                        : "Synthesize a multi-page deep intelligence report from this whole website.";
                      const queryRes = await webCrawlerService.queryCrawledContent(deepRes.combinedMarkdown, promptGoal);
                      result = {
                        success: true,
                        domain: deepRes.domain,
                        pagesCrawled: deepRes.pagesCrawled,
                        totalTokens: deepRes.totalTokens,
                        analysis: queryRes.answer,
                        message: `Boss, maine ${deepRes.domain} ke ${deepRes.pagesCrawled} pages deep crawl kar liye hain (${deepRes.totalTokens} tokens):\n\n${queryRes.answer}`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Deep crawling fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_telegram_media_vault") {
                  const { query, mediaType } = call.args || {};
                  try {
                    const { telegramBotService } = await import("./src/services/telegramBotService");
                    const searchRes = await telegramBotService.searchMediaVault(String(query || ""), {
                      mediaType: mediaType ? String(mediaType) : undefined,
                    });
                    result = {
                      success: searchRes.totalCount > 0,
                      totalFound: searchRes.totalCount,
                      summary: searchRes.summary,
                      message: searchRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram media vault search fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_user_or_group_summary") {
                  const { target, isGroup } = call.args || {};
                  try {
                    const { telegramBotService } = await import("./src/services/telegramBotService");
                    const targetStr = String(target || "");
                    const isGroupTarget = isGroup === true || /group|grp/i.test(targetStr);
                    
                    if (isGroupTarget) {
                      const grpRes = await telegramBotService.getTelegramGroupSummary(targetStr);
                      result = {
                        success: grpRes.found,
                        summary: grpRes.summary,
                        message: grpRes.summary,
                      };
                    } else {
                      const userRes = await telegramBotService.getTelegramUserSummary(targetStr);
                      result = {
                        success: userRes.found,
                        summary: userRes.summary,
                        message: userRes.summary,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Telegram summary fetch fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_youtube_video") {
                  const { url } = call.args || {};
                  try {
                    const { youtubeService } = await import("./src/services/youtubeService");
                    const analysis = await youtubeService.analyzeVideo(String(url || ""));
                    let msg = `Boss, maine YouTube video "${analysis.title}" analyze kar li hai:\n\n${analysis.summary}`;
                    if (analysis.chapters && analysis.chapters.length > 0) {
                      msg += `\n\nKey Chapters:\n` + analysis.chapters.slice(0, 5).map(c => `• ${c.startFormatted} - ${c.title}`).join("\n");
                    }
                    result = {
                      success: true,
                      title: analysis.title,
                      channel: analysis.channelName,
                      summary: analysis.summary,
                      keyTakeaways: analysis.keyTakeaways,
                      chapters: analysis.chapters,
                      message: msg,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `YouTube video analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "ask_youtube_video_timestamp") {
                  const { url, question } = call.args || {};
                  try {
                    const { youtubeService } = await import("./src/services/youtubeService");
                    const qRes = await youtubeService.queryVideoTimestamp(String(url || ""), String(question || ""));
                    result = {
                      success: qRes.contextFound,
                      exactTimestamp: qRes.exactTimestamp,
                      timestampUrl: qRes.timestampUrl,
                      answer: qRes.answer,
                      message: qRes.exactTimestamp
                        ? `Boss, ${qRes.exactTimestamp} timestamp par:\n${qRes.answer}`
                        : qRes.answer,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `YouTube timestamp search fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_whatsapp_photo_or_doc_info") {
                  const { query } = call.args || {};
                  try {
                    const mediaRes = await visionMemoryService.getLatestMediaInfo(query ? String(query) : undefined);
                    result = {
                      success: mediaRes.hasMedia,
                      analysis: mediaRes.analysis,
                      sender: mediaRes.sender,
                      caption: mediaRes.caption,
                      timeAgo: mediaRes.timeAgo,
                      message: mediaRes.analysis,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `WhatsApp photo/doc analyze karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "save_person_visual_memory") {
                  const { name, relation, notes } = call.args || {};
                  try {
                    const saveRes = await visionMemoryService.savePersonMemory(
                      String(name || "Contact"),
                      relation ? String(relation) : undefined,
                      notes ? String(notes) : undefined
                    );
                    result = {
                      success: true,
                      personId: saveRes.personId,
                      message: saveRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Person memory save karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_person_in_whatsapp_photo") {
                  try {
                    const idRes = await visionMemoryService.identifyPersonInPhoto();
                    result = {
                      success: idRes.identified,
                      personName: idRes.personName,
                      relation: idRes.relation,
                      explanation: idRes.explanation,
                      message: idRes.explanation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Person identify karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "toggle_ui_setting") {
                  const { settingName, state } = call.args || {};
                  try {
                    const norm = String(settingName || "").toLowerCase().trim();
                    let finalState: boolean | undefined = typeof state === "boolean" ? state : undefined;

                    if (norm.includes("baileys") || norm === "baileys_whatsapp") {
                      if (finalState === undefined) baileysEnabled = !baileysEnabled;
                      else baileysEnabled = finalState;
                      finalState = baileysEnabled;
                    }

                    const normalizedSetting = norm.includes("caption") || norm.includes("subtitle")
                      ? "captions"
                      : norm.includes("accurate")
                      ? "accurate_mode"
                      : norm.includes("google") || norm.includes("search")
                      ? "google_search"
                      : norm.includes("wake") || norm.includes("hello")
                      ? "wake_word"
                      : norm.includes("chat") || norm.includes("history")
                      ? "chat_history"
                      : norm.includes("code") || norm.includes("agent")
                      ? "code_agent"
                      : norm.includes("modal") || norm.includes("link")
                      ? "whatsapp_modal"
                      : norm.includes("setting")
                      ? "settings"
                      : norm;

                    const payload = JSON.stringify({
                      type: "ui_toggle_command",
                      setting: normalizedSetting,
                      state: finalState,
                    });

                    for (const client of connectedClients) {
                      if (client.readyState === 1) {
                        try { client.send(payload); } catch {}
                      }
                    }

                    result = {
                      success: true,
                      setting: normalizedSetting,
                      state: finalState,
                      message: `Boss, ${settingName} ko ${finalState === false ? "OFF" : "ON"} kar diya hai!`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Toggle fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "setup_boss_voice_recognition") {
                  const { pin, name, spokenPhrase } = call.args || {};
                  try {
                    const enrollRes = await voiceBiometricsService.enrollVoice(
                      String(pin || ""),
                      name ? String(name) : "Boss (Divakar)",
                      undefined,
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                    result = {
                      success: enrollRes.success,
                      message: enrollRes.message,
                      count: enrollRes.count,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice recognition setup fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_boss_voice_recognition") {
                  const { pin, profileId } = call.args || {};
                  try {
                    const delRes = await voiceBiometricsService.deleteProfile(
                      String(pin || ""),
                      profileId ? String(profileId) : undefined
                    );
                    result = {
                      success: delRes.success,
                      message: delRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice profile delete fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_telegram_message") {
                  const { text, chatId } = call.args || {};
                  try {
                    const targetChat = chatId || (await telegramBotService.getOwnerOrLatestChatId()) || process.env.TELEGRAM_OWNER_CHAT_ID;
                    if (!targetChat) {
                      const botName = telegramBotService.getStatus().botUsername || "dk_Friday_bot";
                      result = { success: false, message: `Boss, Telegram bot (@${botName}) par pehle /start dabayein taaki aapka Chat ID detect ho sake.` };
                    } else {
                      const sendRes = await telegramBotService.sendMessage(targetChat, String(text || ""));
                      result = {
                        success: sendRes.success,
                        message: sendRes.success
                          ? `Boss, Telegram par message successfully bhej diya gaya hai! ✅`
                          : `Telegram send failed: ${sendRes.error}`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Telegram message fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_telegram_to_contact") {
                  const { recipient, message } = call.args || {};
                  try {
                    const sendRes = await telegramBotService.sendMessageToTarget(
                      String(recipient || ""),
                      String(message || "")
                    );
                    result = {
                      success: sendRes.success,
                      message: sendRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram message fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_bot_data") {
                  try {
                    const [users, groups, customBusy] = await Promise.all([
                      telegramBotService.getAllTelegramUsers(),
                      telegramBotService.getAllTelegramGroups(),
                      telegramBotService.getCustomBusyReply(),
                    ]);
                    result = {
                      success: true,
                      totalUsers: users.length,
                      totalGroups: groups.length,
                      customBusyStatus: customBusy || "Default (DK Boss is busy)",
                      users: users.map((u) => ({
                        id: u.chatId || u.userId,
                        name: u.fullName,
                        username: u.username ? `@${u.username}` : "none",
                        alias: u.customAlias || "none",
                        notes: u.customNotes || "none",
                        lastSeen: new Date(u.lastSeenAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                        lastMessage: u.lastMessage || "",
                        groups: u.groups || [],
                      })),
                      groups: groups.map((g) => ({
                        groupId: g.groupId,
                        title: g.title,
                        username: g.username ? `@${g.username}` : "none",
                        memberCount: g.activeMembers?.length || 0,
                        members: g.activeMembers?.map((m) => m.name || m.username) || [],
                        lastSeen: new Date(g.lastSeenAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                        lastMessage: g.lastMessage || "",
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram data retrieve karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_chat_history") {
                  const { target, limit } = call.args || {};
                  try {
                    result = await telegramBotService.getChatHistory(
                      target ? String(target) : "all",
                      limit ? Number(limit) : 20
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Telegram chat history error: ${e?.message || e}` };
                  }
                } else if (call.name === "modify_telegram_user") {
                  const { target, customAlias, customNotes } = call.args || {};
                  try {
                    result = await telegramBotService.modifyTelegramUser(
                      String(target || ""),
                      { customAlias, customNotes }
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Telegram user modify fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "set_telegram_busy_message") {
                  const { message } = call.args || {};
                  try {
                    result = await telegramBotService.setCustomBusyReply(String(message || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Telegram busy reply set karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "send_instagram_dm") {
                  const { recipient, message } = call.args || {};
                  try {
                    const sendRes = await instagramBotService.sendMessageToTarget(
                      String(recipient || ""),
                      String(message || "")
                    );
                    result = {
                      success: sendRes.success,
                      message: sendRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Instagram DM send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_link_safety") {
                  const { url } = call.args || {};
                  try {
                    const scanRes = await cyberSecurityService.scanUrlSafety(String(url || ""));
                    result = {
                      success: true,
                      isSafe: scanRes.isSafe,
                      riskScore: scanRes.riskScore,
                      riskLevel: scanRes.riskLevel,
                      threats: scanRes.threatsDetected,
                      message: scanRes.explanation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `URL scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "check_email_data_breach") {
                  const { emailOrUsername } = call.args || {};
                  try {
                    const breachRes = await cyberSecurityService.checkDataBreach(String(emailOrUsername || ""));
                    result = {
                      success: true,
                      isCompromised: breachRes.isCompromised,
                      breachCount: breachRes.breachCount,
                      breaches: breachRes.breaches,
                      message: breachRes.recommendation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Breach check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "audit_website_security") {
                  const { domain } = call.args || {};
                  try {
                    const auditRes = await cyberSecurityService.auditWebsiteSecurity(String(domain || ""));
                    result = {
                      success: true,
                      grade: auditRes.grade,
                      score: auditRes.score,
                      httpsEnforced: auditRes.httpsEnforced,
                      serverTechnology: auditRes.serverTechnology,
                      vulnerabilities: auditRes.vulnerabilities,
                      message: auditRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Website audit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "lookup_ip_intelligence") {
                  const { ipOrDomain } = call.args || {};
                  try {
                    const ipRes = await cyberSecurityService.lookupIpIntelligence(String(ipOrDomain || ""));
                    result = {
                      success: true,
                      ip: ipRes.ip,
                      country: ipRes.country,
                      city: ipRes.city,
                      isp: ipRes.isp,
                      asn: ipRes.asn,
                      isHosting: ipRes.isHostingOrCloud,
                      message: ipRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `IP intelligence lookup fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "run_code_security_audit") {
                  try {
                    const codeRes = await cyberSecurityService.scanCodeSecurityAudit();
                    result = {
                      success: true,
                      healthScore: codeRes.overallScore,
                      scannedFiles: codeRes.scannedFilesCount,
                      criticalIssues: codeRes.criticalIssuesCount,
                      warnings: codeRes.warningCount,
                      findings: codeRes.findings,
                      message: codeRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Code audit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_linkedin_insights") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getLinkedInInsights(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `LinkedIn search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_community_links") {
                  const { platform, topic } = call.args || {};
                  try {
                    result = await publicApisService.getCommunityLinks(String(platform || "telegram"), String(topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Community search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pinterest_ideas") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getPinterestIdeas(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Pinterest search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_medicine_and_generic_info") {
                  const { medicineName } = call.args || {};
                  try {
                    result = await publicApisService.getMedicineAndGenericInfo(String(medicineName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Medicine lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_commodity_rates") {
                  const { commodity, city } = call.args || {};
                  try {
                    result = await publicApisService.getDailyCommodityRates(String(commodity || "all"), city ? String(city) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Commodity rates lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_emergency_helplines") {
                  const { serviceType } = call.args || {};
                  try {
                    result = await publicApisService.getEmergencyHelplines(serviceType ? String(serviceType) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Emergency helpline lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_vehicle_and_challan_services") {
                  const { service, vehicleNumber } = call.args || {};
                  try {
                    result = await publicApisService.getVehicleAndChallanServices(
                      service ? String(service) : undefined,
                      vehicleNumber ? String(vehicleNumber) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vehicle services lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_utility_and_bill_services") {
                  const { serviceType, providerOrState } = call.args || {};
                  try {
                    result = await publicApisService.getUtilityAndBillServices(
                      String(serviceType || "all"),
                      providerOrState ? String(providerOrState) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Utility services lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_govt_scheme_info") {
                  const { schemeName } = call.args || {};
                  try {
                    result = await publicApisService.getGovtSchemeInfo(String(schemeName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Govt scheme lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "track_expense_entry") {
                  const { amount, category, note } = call.args || {};
                  try {
                    result = await publicApisService.trackExpenseEntry(
                      Number(amount),
                      String(category || "General"),
                      note ? String(note) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Expense logging fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_expense_summary") {
                  try {
                    result = await publicApisService.getExpenseSummary();
                  } catch (e: any) {
                    result = { success: false, message: `Expense summary fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_bus_travel_info") {
                  const { fromCity, toCity } = call.args || {};
                  try {
                    result = await publicApisService.getBusTravelInfo(String(fromCity || ""), String(toCity || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Bus info lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_wifi_networks") {
                  try {
                    result = await publicApisService.scanWifiNetworks();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_wifi_status") {
                  try {
                    result = await publicApisService.getCurrentWifiStatus();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi status check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "connect_to_wifi") {
                  const { ssid, password } = call.args || {};
                  try {
                    result = await publicApisService.connectToWifi(String(ssid || ""), password ? String(password) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `WiFi connect fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "disconnect_wifi") {
                  try {
                    result = await publicApisService.disconnectWifi();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi disconnect fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "verify_voice_authorization_pin") {
                  const { pin } = call.args || {};
                  try {
                    result = await voiceBiometricsService.verifyVoicePin(String(pin || ""));
                  } catch (e: any) {
                    result = { valid: false, message: `PIN check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "setup_boss_voice_recognition") {
                  const { pin, name, relationWithDivakar, spokenPhrase } = call.args || {};
                  try {
                    result = await voiceBiometricsService.enrollVoice(
                      String(pin || ""),
                      String(name || "Boss (Divakar)"),
                      String(relationWithDivakar || "Boss (DK)"),
                      undefined,
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice calibration fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_boss_voice_recognition") {
                  const { pin, profileId } = call.args || {};
                  try {
                    result = await voiceBiometricsService.deleteVoiceProfile(
                      String(pin || ""),
                      profileId ? String(profileId) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice deletion fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_coding_agent_status") {
                  try {
                    result = await codeAgentService.getLiveStatusSummary();
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent status check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_coding_agent_plan") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.approve(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent approval fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_and_commit_to_master") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.approveAndPushDirectlyToMain(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Master commit command fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "reject_coding_agent_plan") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.deny(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Reject command fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_command_to_coding_agent") {
                  const { instruction, problemTitle } = call.args || {};
                  try {
                    const req = await codeAgentService.createRequest(
                      String(problemTitle || "Boss Voice Command Task"),
                      String(instruction || ""),
                      "feature",
                      "DK (Voice)"
                    );
                    result = {
                      success: true,
                      requestId: req.id,
                      message: `Boss, Coding Agent ko naya task de diya gaya hai! Task ID: ${req.id}. Agent codebase analyze karke plan bana raha hai.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent command fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "execute_service" || call.name === "get_live_train_status" || call.name === "get_pnr_status" || call.name === "get_live_station_board" || call.name === "get_train_fares" || call.name === "get_coach_position") {
                  const action = String(call.args?.action || call.name);
                  const query = String(call.args?.query || call.args?.trainQuery || call.args?.pnr || call.args?.station || "");
                  const targetStation = String(call.args?.targetStation || call.args?.station || "");
                  const fromStation = String(call.args?.fromStation || call.args?.from || "");
                  const toStation = String(call.args?.toStation || call.args?.to || "");
                  
                  try {
                    if (action.includes("schedule") || action.includes("timetable")) {
                      result = await railRadarService.getTrainSchedule(query);
                    } else if (action.includes("refund") || action.includes("cancel")) {
                      result = railRadarService.calculateCancellationRefund("3A", "CNF", 48);
                    } else if (action.includes("seat") || action.includes("availab") || action.includes("tatkal") || action.includes("quota")) {
                      result = await railRadarService.getSeatAvailability(query, fromStation, toStation);
                    } else if (action.includes("coach") || action.includes("layout") || action.includes("general") || action.includes("composition")) {
                      result = await railRadarService.getCoachPosition(query);
                    } else if (action.includes("stop") || action.includes("halt") || action.includes("route_check")) {
                      result = await railRadarService.checkTrainStoppage(query, targetStation || "PNBE");
                    } else if (action.includes("between") || action.includes("search_trains") || action.includes("journey")) {
                      result = await railRadarService.searchTrainsBetweenStations(fromStation || query, toStation || "PNBE");
                    } else if (action.includes("fare") || action.includes("price") || action.includes("ticket") || action.includes("kiraya")) {
                      const fareRes = await railRadarService.getTrainFares(query, fromStation, toStation);
                      result = fareRes;
                      if (fareRes.success) {
                        safeSend(JSON.stringify({ type: "train_fare_info", fare: fareRes }));
                      }
                    } else if (action.includes("pnr") || /^\d{10}$/.test(query)) {
                      const pnrRes = await railRadarService.getPnrStatus(query);
                      result = pnrRes;
                      if (pnrRes.success) {
                        safeSend(JSON.stringify({ type: "pnr_live_status", pnr: pnrRes }));
                      }
                    } else if (action.includes("station") || action.includes("board")) {
                      const stnRes = await railRadarService.getLiveStationBoard(query);
                      result = stnRes;
                      if (stnRes.success) {
                        safeSend(JSON.stringify({ type: "station_live_board", station: stnRes }));
                      }
                    } else {
                      // Default to Live Train Running Status
                      const statusRes = await railRadarService.getLiveTrainStatus(query);
                      result = statusRes;
                      if (statusRes.success) {
                        safeSend(JSON.stringify({ type: "train_live_status", train: statusRes }));
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `RailRadar service execution fail hui: ${e?.message || e}` };
                  }
                }

                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { output: result },
                });
              }

              try {
                if (currentSession) {
                  currentSession.sendToolResponse({ functionResponses });
                }
              } catch (err) {
                console.error("[Friday Tools] Failed to send tool response:", err);
              }
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Aoede" } },
          },
          thinkingConfig: {
            thinkingLevel: (["low", "medium", "high"].includes(effectiveThinking) ? effectiveThinking : "high") as any,
          },
          // VAD tuning: previously left on Gemini's generic defaults. Tuned
          // here instead of guessed — high start-sensitivity so it notices
          // DK starting to speak quickly, but LOW end-sensitivity + a
          // moderate silence window so a normal mid-sentence pause isn't
          // mistaken for "DK stopped talking", which was a contributor to
          // the choppy audio / falsely-interrupted turns.
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              silenceDurationMs: 380,
              prefixPaddingMs: 120,
            },
          },
          tools: [
            ...(googleSearchMode ? [{ googleSearch: {} }] : []),
            { functionDeclarations },
          ],
          systemInstruction,
        },
      });

      // Now that connect() has resolved, wire up the self-reference so the
      // onerror/onclose handlers above can confirm this is still the active
      // session before triggering a reconnect (avoids reconnect-storms when
      // a session is closed on purpose, e.g. settings change).
      thisSessionRef = newSession;
      return newSession;
    };

    let pendingImages: any[] = [];

    const processImageInput = async (parsedData: any) => {
      if (!currentSession) return;
      try {
        currentSession.sendRealtimeInput({
          video: { data: parsedData.image, mimeType: parsedData.mimeType || "image/jpeg" },
        });
        clientWs.send(JSON.stringify({ imageAck: true, imageId: parsedData.imageId }));

        currentSession.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `[System note: the user attached an image${parsedData.caption ? ` with caption "${parsedData.caption}"` : ""}. Look at it and respond helpfully to what's shown.]`,
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } catch (err) {
        console.error("Failed to forward image to Gemini Live session:", err);
        clientWs.send(JSON.stringify({ imageAck: false, imageId: parsedData.imageId, error: "image_forward_failed" }));
      }
    };

    // ── Safe send: guard against sending on a closed/closing WebSocket ──────
    const safeSend = (payload: string) => {
      try {
        if (clientWs.readyState === 1 /* OPEN */) {
          clientWs.send(payload);
        }
      } catch (e: any) {
        // Silently ignore broken-pipe / wsarecv errors on closed sockets
        if (!/ECONNRESET|EPIPE|closed|not opened/i.test(e?.message || "")) {
          console.error("[Server] safeSend error:", e?.message);
        }
      }
    };

    // ── Auto-reconnect: re-create session if Gemini drops mid-conversation ─
    let isReconnecting = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    let lastVoice = "Aoede";
    let lastThinkingLevel = "high";
    let lastAccurateMode = false;
    let lastAnswerLength: string | undefined;
    let lastGoogleSearchMode = false;

    const autoReconnect = async () => {
      if (isReconnecting || clientWs.readyState !== 1) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[Server] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for session=${sessionId}.`);
        safeSend(JSON.stringify({ error: "session_reconnect_failed", message: "Boss, connection dobara nahi ban saki. Page refresh karo." }));
        return;
      }
      isReconnecting = true;
      reconnectAttempts++;
      const delayMs = Math.min(4000, 1000 * Math.pow(1.5, reconnectAttempts - 1));
      console.warn(`[Server] Gemini Live session dropped — attempting auto-reconnect (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}, delay ${delayMs}ms)...`);
      safeSend(JSON.stringify({ type: "session_reconnecting", attempt: reconnectAttempts }));
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        if (currentSession) {
          try { await currentSession.close(); } catch {}
          currentSession = undefined;
        }
        const newSession = await createSession(
          lastVoice, lastThinkingLevel, lastAccurateMode,
          lastAnswerLength, lastGoogleSearchMode
        );
        currentSession = newSession;
        isReconnecting = false;
        reconnectAttempts = 0;
        safeSend(JSON.stringify({ type: "session_reconnected" }));
        console.log(`[Server] ✅ Auto-reconnect successful for session=${sessionId}.`);
      } catch (err: any) {
        console.error(`[Server] Auto-reconnect attempt ${reconnectAttempts} failed:`, err?.message || err);
        isReconnecting = false;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && clientWs.readyState === 1) {
          setTimeout(autoReconnect, 1000);
        } else {
          currentSession = undefined;
          safeSend(JSON.stringify({ error: "session_reconnect_failed", message: "Boss, connection dobara nahi ban saki. Page refresh karo." }));
        }
      }
    };

    clientWs.on("message", async (data) => {
      let parsedData: any;
      try {
        parsedData = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Handle explicit auth message packet
      if (parsedData.type === "auth") {
        const token = parsedData.token;
        if (token && appSecurityService.verifySessionToken(token)) {
          isAuthorized = true;
          if (authTimeout) clearTimeout(authTimeout);
          safeSend(JSON.stringify({ type: "auth_ack", ok: true }));
          return;
        } else {
          console.warn("[Server] 🚫 WebSocket auth failed: Invalid App Key Token");
          safeSend(JSON.stringify({ error: "ACCESS_LOCKED", message: "Invalid App Key Token." }));
          try { clientWs.close(4001, "UNAUTHORIZED_APP_KEY"); } catch {}
          return;
        }
      }

      // Zero-Trust Anti-Tamper: Block any command if not authenticated
      if (!isAuthorized) {
        console.warn("[Server] 🚫 WebSocket command blocked: Session is not authorized");
        safeSend(JSON.stringify({ error: "ACCESS_LOCKED", message: "App Key authentication required." }));
        return;
      }

      if (parsedData.type === "init") {
        console.log(`[Server] 🎙️ init received (session=${sessionId}), (re)creating Gemini Live session...`);
        // Track params for auto-reconnect
        lastVoice = parsedData.voice || "Aoede";
        lastThinkingLevel = parsedData.thinkingLevel || "high";
        lastAccurateMode = !!parsedData.accurateMode;
        lastAnswerLength = parsedData.answerLength;
        lastGoogleSearchMode = !!parsedData.googleSearchMode;

        try {
          if (currentSession) await currentSession.close();
          const myToken = ++currentSessionToken;
          const newSession = await createSession(
            parsedData.voice,
            parsedData.thinkingLevel,
            !!parsedData.accurateMode,
            parsedData.answerLength,
            !!parsedData.googleSearchMode
          );

          // If another "init" came in while we were awaiting createSession(),
          // currentSessionToken will have moved on past myToken — that newer
          // init already owns currentSession, so this late-resolving session
          // is stale and must be discarded instead of overwriting it.
          if (myToken !== currentSessionToken) {
            console.warn("[Server] Discarding stale Gemini Live session from a superseded init request.");
            try { (newSession as any).close(); } catch {}
            return;
          }

          currentSession = newSession;
          isReconnecting = false;
          reconnectAttempts = 0;
          safeSend(JSON.stringify({ type: "init_ack" }));

          if (pendingImages.length > 0) {
            const queued = [...pendingImages];
            pendingImages = [];
            for (const imgMsg of queued) await processImageInput(imgMsg);
          }
        } catch (err: any) {
          console.error("Failed to create Gemini Live session:", err);
          currentSession = undefined;
          safeSend(JSON.stringify({ error: "session_init_failed", message: err?.message || String(err) }));
        }
        return;
      }

      if (!currentSession) {
        if (parsedData.image) {
          pendingImages.push(parsedData);
          return;
        }
        // If session is gone but client is still connected, try reconnect
        if (!isReconnecting) {
          autoReconnect();
        }
        return;
      }

      try {
        if (parsedData.audio) {
          currentSession.sendRealtimeInput({
            audio: { data: parsedData.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (parsedData.type === "audio_stream_end") {
          // Client-side voice gate closed (user stopped talking). Tell Gemini
          // explicitly so its server-side VAD flushes the buffered audio and
          // finalizes the turn immediately, instead of waiting indefinitely
          // for more audio that will never come until the mic re-opens.
          console.log(`[Server] 🔕 audio_stream_end received from client (session=${sessionId}) — flushing turn to Gemini.`);
          try {
            currentSession.sendRealtimeInput({ audioStreamEnd: true });
          } catch (e) {
            console.error("[Server] Failed to send audioStreamEnd:", e);
          }
        } else if (parsedData.image) {
          await processImageInput(parsedData);
        } else if (parsedData.type === "text_input" && parsedData.text) {
          // Fire-and-forget: don't delay sending the user's message to Gemini
          // while we wait for the Firestore write to finish.
          saveMessage("user", parsedData.text).catch((e) =>
            console.error("[Server] Failed to save text_input message:", e)
          );
          memoryEngine.recordMessage(sessionId, "user", parsedData.text);
          currentSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: parsedData.text }] }],
            turnComplete: true,
          });
        } else if (parsedData.type === "trigger_reply") {
          try {
            currentSession.sendClientContent({
              turns: [{ role: "user", parts: [{ text: "Jawab do, please reply now to what I just said." }] }],
              turnComplete: true,
            });
          } catch (e) {
            console.error("Failed to trigger reply:", e);
          }
        } else if (parsedData.interrupt) {
          safeSend(JSON.stringify({ interrupted: true }));
        }
      } catch (streamErr: any) {
        const msg = streamErr?.message || String(streamErr);
        console.error(`[Server] ⚠️ Gemini send failed (session=${sessionId}):`, msg);
        // DEBUG NOTE: this used to only reconnect for a narrow regex of
        // known socket-closed error strings; anything else was just logged
        // and swallowed, leaving `currentSession` pointing at a session that
        // could no longer actually deliver audio to Gemini — the client
        // would then sit on "Listening..." forever with no response ever
        // arriving. Now ANY failure to send here is treated as the session
        // being unusable, so we always attempt a reconnect.
        currentSession = undefined;
        autoReconnect();
      }
    });

    clientWs.on("close", () => {
      if (currentSession) {
        Promise.resolve(currentSession.close()).catch((e: any) =>
          console.error("[Server] Error closing Gemini Live session on client disconnect:", e)
        );
        currentSession = undefined;
      }
      // Reset thinking flag on disconnect so mic is never stuck muted
      safeSend(JSON.stringify({ interrupted: true }));
      memoryEngine.finalizeSession(sessionId, ai);
    });

    clientWs.on("error", (wsErr: any) => {
      const msg = wsErr?.message || String(wsErr);
      if (/wsarecv|stream reading|forcibly closed|ECONNRESET|EPIPE/i.test(msg)) {
        console.warn("[Server] 📡 Client WebSocket closed forcibly (network drop):", msg);
      } else {
        console.error("[Server] WebSocket error:", wsErr);
      }
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
