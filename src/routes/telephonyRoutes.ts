import { Router } from "express";
import { exotelService } from "../services/exotelService";
import { whatsappFeatureEngine } from "../services/whatsappFeatureEngine";
import { fast2SmsService } from "../services/fast2SmsService";

export function createTelephonyRouter(): Router {
  const router = Router();

  // ── 1-Click Live Voice Call Session Validation ─────────────────────────────
  router.get("/api/call/validate-session", async (req, res) => {
    try {
      const callId = String(req.query.callId || "").trim();
      const validation = await whatsappFeatureEngine.validateCallSession(callId);
      res.json({ ok: validation.valid, ...validation });
    } catch (e: any) {
      res.status(500).json({ ok: false, valid: false, message: e?.message || "Validation error" });
    }
  });

  // ── Call Declined Busy Message Endpoint ────────────────────────────────────
  router.post("/api/call/decline", async (req, res) => {
    try {
      const { callId, callerName } = req.body || {};
      const success = await whatsappFeatureEngine.handleCallDeclined(callId, callerName);
      res.json({ ok: success });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── Post-Call Summary WhatsApp Delivery Endpoint ───────────────────────────
  router.post("/api/call/end-summary", async (req, res) => {
    try {
      const { callId, callerName, durationSeconds, transcript } = req.body || {};
      if (!callId) {
        return res.status(400).json({ ok: false, error: "callId is required" });
      }
      const success = await (whatsappFeatureEngine as any).handleCallSummaryDelivery?.({
        callId,
        callerName,
        durationSeconds: Number(durationSeconds) || 0,
        transcript: Array.isArray(transcript) ? transcript : [],
      }) ?? true;
      res.json({ ok: success });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── Fast2SMS Dispatch Endpoint ─────────────────────────────────────────────
  router.post("/api/fast2sms/send", async (req, res) => {
    try {
      const { numbers, message } = req.body || {};
      if (!numbers || !message) {
        return res.status(400).json({ ok: false, error: "numbers and message are required" });
      }
      const result = await fast2SmsService.sendSms(numbers, message);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EXOTEL INDIAN CLOUD TELEPHONY (+91 VIRTUAL NUMBER) WEBHOOKS & REST APIS
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Inbound Call Webhook (Exotel Passthru Applet Entrypoint)
  router.all(["/api/exotel/incoming-call", "/api/exotel/passthru"], async (req, res) => {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "Unknown";
    console.log(`[ExotelDiagnostic:${traceId}] 📥 INCOMING_CALL Webhook Hit: Method=${req.method} IP=${clientIp}`);

    try {
      const callSid = String(req.query.CallSid || req.body.CallSid || `call_${Date.now()}`);
      const from = String(req.query.From || req.body.From || req.query.CallFrom || req.body.CallFrom || "Unknown");
      const to = String(req.query.To || req.body.To || req.query.CallTo || req.body.CallTo || "Friday");
      const host = req.get("host") || "localhost:3000";
      const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const baseUrl = `${protocol}://${host}`;

      const { exml } = await exotelService.handleIncomingCall({ callSid, from, to, baseUrl });
      res.set("Content-Type", "text/xml; charset=utf-8");
      res.status(200).send(exml);
    } catch (e: any) {
      console.error(`[ExotelDiagnostic:${traceId}] ❌ Incoming call webhook error:`, e);
      res.set("Content-Type", "text/xml; charset=utf-8");
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="female">नमस्ते! मैं Friday हूँ, कुछ ही समय में आपसे संपर्क करूँगी।</Say><Hangup/></Response>`);
    }
  });

  // 2. Process Caller's Voice Speech (Multi-Turn Voice Dialogue Loop)
  router.all("/api/exotel/process-speech", async (req, res) => {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    try {
      const callSid = String(req.query.callSid || req.query.CallSid || req.body.CallSid || "");
      const recordingUrl = String(req.query.RecordingUrl || req.body.RecordingUrl || req.body.RecordingURL || req.query.RecordingURL || "");
      const digits = String(req.query.Digits || req.body.Digits || "");
      const host = req.get("host") || "localhost:3000";
      const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const baseUrl = `${protocol}://${host}`;

      const { exml } = await exotelService.handleSpeechInput({ callSid, recordingUrl, digits, baseUrl });
      res.set("Content-Type", "text/xml; charset=utf-8");
      res.status(200).send(exml);
    } catch (e: any) {
      console.error(`[ExotelDiagnostic:${traceId}] ❌ Process speech webhook error:`, e);
      res.set("Content-Type", "text/xml; charset=utf-8");
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="female">धन्यवाद, मैंने आपकी बात नोट कर ली है।</Say><Hangup/></Response>`);
    }
  });

  // 3. Status Callback (Call Ended, Duration, and Recording Delivered)
  router.all("/api/exotel/call-status", async (req, res) => {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    try {
      const callSid = String(req.query.CallSid || req.body.CallSid || "");
      const status = String(req.query.Status || req.body.Status || req.query.CallStatus || req.body.CallStatus || "completed");
      const duration = req.query.Duration || req.body.Duration || (req.query.Legs as any)?.[0]?.Duration || 0;
      const recordingUrl = String(req.query.RecordingUrl || req.body.RecordingUrl || "");

      const session = await exotelService.handleCallStatus({
        callSid,
        status,
        duration: Number(duration),
        recordingUrl: recordingUrl || undefined,
      });

      res.json({ ok: true, session });
    } catch (e: any) {
      console.error(`[ExotelDiagnostic:${traceId}] ❌ Call status callback error:`, e);
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 4. Serve Dynamic Friday Voice MP3 Audio to Exotel
  router.all("/api/exotel/audio/:audioId", (req, res) => {
    const audioId = req.params.audioId;
    const audio = exotelService.getAudio(audioId);
    if (!audio) {
      return res.status(404).send("Audio expired or not found");
    }

    const totalLength = audio.buffer.length;
    const rangeHeader = req.headers.range;

    res.set({
      "Content-Type": audio.mimeType || "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=1800",
      "Content-Disposition": "inline",
      "Connection": "keep-alive",
    });

    if (req.method === "HEAD") {
      res.set("Content-Length", totalLength.toString());
      return res.status(200).end();
    }

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;
      const chunksize = end - start + 1;
      const slicedBuffer = audio.buffer.subarray(start, end + 1);

      res.status(206);
      res.set({
        "Content-Range": `bytes ${start}-${end}/${totalLength}`,
        "Content-Length": chunksize.toString(),
      });
      return res.end(slicedBuffer);
    }

    res.set("Content-Length", totalLength.toString());
    return res.status(200).end(audio.buffer);
  });

  // 5. Exotel Config Management
  router.get("/api/exotel/config", (_req, res) => {
    res.json({ ok: true, config: exotelService.getConfig() });
  });

  router.post("/api/exotel/config", (req, res) => {
    try {
      const result = exotelService.saveConfig(req.body || {});
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 6. Outbound Phone Call Trigger
  router.post("/api/exotel/make-call", async (req, res) => {
    try {
      const { to, customMessage } = req.body || {};
      if (!to) {
        return res.status(400).json({ ok: false, error: "Phone number 'to' is required" });
      }
      const host = req.get("host") || "localhost:3000";
      const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const result = await exotelService.makeOutboundCall({
        to: String(to),
        customMessage: customMessage ? String(customMessage) : undefined,
        baseUrl: `${protocol}://${host}`,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Outbound call failed" });
    }
  });

  // 7. Call Logs Management
  router.get("/api/exotel/call-logs", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ ok: true, logs: exotelService.getCallLogs(limit) });
  });

  router.post("/api/exotel/call-logs/clear", (_req, res) => {
    res.json({ ok: exotelService.clearCallLogs() });
  });

  return router;
}
