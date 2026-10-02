import express, { Router } from "express";
import { whatsappBotService } from "../services/whatsappBotService";
import { getPrimaryWhatsAppChannel, setPrimaryWhatsAppChannel } from "../services/whatsappService";
import { whatsappSessionHealthEngine } from "../services/whatsapp/whatsappSessionHealthEngine";
import { telegramBotService } from "../services/telegramBotService";
import { instagramBotService } from "../services/instagramBotService";
import { geminiKeyPoolService } from "../services/geminiKeyPoolService";

export interface BotRoutesContext {
  getBaileysEnabled?: () => boolean;
  setBaileysEnabled?: (v: boolean) => void;
}

export function createBotRouter(context?: BotRoutesContext): Router {
  const router = Router();
  const getBaileysEnabled = context?.getBaileysEnabled || (() => true);
  const setBaileysEnabled = context?.setBaileysEnabled || (() => {});

  // ══════════════════════════════════════════════════════════════════════════
  // WHATSAPP BOT & CLOUD API ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.post("/api/whatsapp/pair", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "phone_required" });
      const pairingCode = await whatsappBotService.requestPairingCode(phone);
      res.json({ ok: true, pairingCode });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "pairing_failed" });
    }
  });

  router.post("/api/whatsapp/reset", async (_req, res) => {
    try {
      await whatsappBotService.resetSession();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "reset_failed" });
    }
  });

  router.get("/api/whatsapp/status", (_req, res) => {
    const baileysStatus = whatsappBotService.getStatus();
    const baileysEnabled = getBaileysEnabled();
    res.json({
      isConnected: baileysStatus.isConnected,
      isBaileysConnected: baileysStatus.isConnected,
      isCloudConfigured: false,
      dedicatedPhone: baileysStatus.dedicatedPhone,
      cloudPhone: null,
      qrCodeDataUrl: baileysStatus.qrCodeDataUrl,
      pairingCode: baileysStatus.pairingCode,
      baileys: baileysStatus,
      cloud: { configured: false, phoneId: "", fromNumber: "" },
      baileysEnabled,
    });
  });

  router.post("/api/whatsapp/baileys/toggle", (req, res) => {
    const { enabled } = req.body;
    let bEnabled = getBaileysEnabled();
    if (typeof enabled === "boolean") {
      bEnabled = enabled;
    } else {
      bEnabled = !bEnabled;
    }
    setBaileysEnabled(bEnabled);
    whatsappBotService.setBaileysEnabled(bEnabled);
    console.log(`[Server] Baileys system ${bEnabled ? 'ENABLED' : 'DISABLED'} via API`);
    res.json({ ok: true, baileysEnabled: bEnabled });
  });

  router.get("/api/whatsapp/baileys/status", (_req, res) => {
    res.json({ baileysEnabled: getBaileysEnabled() });
  });

  router.get("/api/whatsapp/primary-channel", async (_req, res) => {
    try {
      const channel = await getPrimaryWhatsAppChannel();
      res.json({ ok: true, channel });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_get_primary_channel" });
    }
  });

  router.post("/api/whatsapp/primary-channel", async (req, res) => {
    try {
      const { channel } = req.body;
      const result = await setPrimaryWhatsAppChannel(channel);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_set_primary_channel" });
    }
  });



  router.get("/api/whatsapp/health", (_req, res) => {
    try {
      const report = whatsappSessionHealthEngine.calculateBanRisk();
      res.json({ ok: true, ...report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  router.post("/api/whatsapp/circuit-breaker/unpause", (_req, res) => {
    try {
      const result = whatsappSessionHealthEngine.manualUnpause();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  router.post("/api/whatsapp/circuit-breaker/pause", (req, res) => {
    try {
      const { hours = 24, reason = "Dashboard Manual Pause" } = req.body || {};
      const result = whatsappSessionHealthEngine.manualPause(Number(hours), String(reason));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TELEGRAM BOT REST ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/telegram/status", (_req, res) => {
    res.json({ ok: true, isConnected: (telegramBotService as any).isConnected?.() ?? true });
  });

  router.get("/api/telegram/users", async (_req, res) => {
    try {
      const users = await (telegramBotService as any).getStoredUsers?.() || [];
      res.json({ ok: true, users });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/telegram/groups", async (_req, res) => {
    try {
      const groups = await (telegramBotService as any).getStoredGroups?.() || [];
      res.json({ ok: true, groups });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/telegram/messages", async (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      const messages = await (telegramBotService as any).getRecentMessages?.(limit) || [];
      res.json({ ok: true, messages });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/telegram/users/modify", async (req, res) => {
    const { chatId, updates } = req.body || {};
    if (!chatId || !updates) return res.status(400).json({ ok: false, error: "chatId_and_updates_required" });
    const result = await (telegramBotService as any).updateUserData?.(chatId, updates) || { ok: true };
    res.json(result);
  });

  router.get("/api/telegram/busy-message", async (_req, res) => {
    const customBusy = await (telegramBotService as any).getCustomBusyReply?.() || "";
    res.json({ ok: true, customBusyReply: customBusy });
  });

  router.post("/api/telegram/busy-message", async (req, res) => {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });
    const result = await (telegramBotService as any).setCustomBusyReply?.(message) || { ok: true };
    res.json(result);
  });

  router.post("/api/telegram/send", async (req, res) => {
    const { chatId, text } = req.body || {};
    if (!chatId || !text) return res.status(400).json({ error: "chatId_and_text_required" });
    const result = await (telegramBotService as any).sendMessage?.(chatId, text) || { ok: true };
    res.json(result);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INSTAGRAM BOT ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/instagram/status", (_req, res) => {
    res.json({ ok: true, ...instagramBotService.getStatus() });
  });

  router.post("/api/instagram/login", async (req, res) => {
    const { username, password, verificationCode, sessionId } = req.body || {};
    if (sessionId) {
      const result = await instagramBotService.loginWithSessionId(sessionId, username);
      return res.json({ ok: result.success, ...result });
    }
    if (!username) return res.status(400).json({ ok: false, message: "Username, Email, or Session ID required." });
    const result = await instagramBotService.login(username, password, verificationCode);
    res.json({ ok: result.success, ...result });
  });

  router.post("/api/instagram/logout", async (_req, res) => {
    const result = await instagramBotService.logout();
    res.json({ ok: result.success, ...result });
  });

  router.post("/api/instagram/purge-sessions", async (_req, res) => {
    const result = await instagramBotService.purgeAllSessions();
    res.json({ ok: result.success, ...result });
  });

  router.post("/api/instagram/toggle-auto-reply", (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled === "boolean") {
      instagramBotService.setAutoReply(enabled);
    }
    res.json({ ok: true, ...instagramBotService.getStatus() });
  });

  router.post("/api/instagram/send", async (req, res) => {
    const { recipient, message } = req.body || {};
    if (!recipient || !message) return res.status(400).json({ error: "recipient_and_message_required" });
    const result = await instagramBotService.sendMessageToTarget(recipient, message);
    res.json(result);
  });

  router.get("/api/instagram/search", async (req, res) => {
    const query = String(req.query.q || req.query.query || "");
    const result = await instagramBotService.searchUserLive(query);
    res.json(result);
  });

  router.get("/api/instagram/user-info", async (req, res) => {
    const username = String(req.query.username || req.query.u || "");
    const result = await instagramBotService.getUserInfoLive(username);
    res.json(result);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ZERO-429 GEMINI MULTI-KEY MESH MONITOR & CONTROL ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/keys/status", (_req, res) => {
    res.json({ ok: true, ...geminiKeyPoolService.getDetailedStatus() });
  });

  router.post("/api/keys/reload", (_req, res) => {
    geminiKeyPoolService.reloadKeysFromEnv();
    res.json({ ok: true, message: "Keys reloaded successfully from environment", ...geminiKeyPoolService.getDetailedStatus() });
  });

  router.post("/api/keys/add", (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
      return res.status(400).json({ ok: false, error: "valid_apiKey_required" });
    }
    const added = geminiKeyPoolService.addKey(apiKey);
    if (!added) {
      return res.status(400).json({ ok: false, error: "key_already_exists_or_invalid" });
    }
    res.json({ ok: true, message: "Key added to pool successfully", ...geminiKeyPoolService.getDetailedStatus() });
  });

  return router;
}
