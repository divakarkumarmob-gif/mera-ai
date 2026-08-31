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
import { reminderScheduler } from "./src/services/reminderScheduler";
import { dailyUpdateReminderScheduler } from "./src/services/dailyUpdateReminderScheduler";
import { whatsappBotService } from "./src/services/whatsappBotService";
import { whatsappCloudService } from "./src/services/whatsappCloudService";
import { codeAgentService } from "./src/services/codeAgentService";
import { saveMessage } from "./src/services/historyService";
import { voiceBiometricsService } from "./src/services/voiceBiometricsService";
import { telegramBotService } from "./src/services/telegramBotService";
import { backgroundTasksService } from "./src/services/backgroundTasksService";
import { appSecurityService } from "./src/services/appSecurityService";
import { telegramSecurityBotService } from "./src/services/telegramSecurityBotService";

// Clean modular live AI & route subsystems
import { fridayFunctionDeclarations } from "./src/live/liveToolDeclarations";
import { dispatchLiveToolCall } from "./src/live/liveToolDispatcher";
import { buildLiveSystemInstruction } from "./src/live/liveSystemPrompt";
import { createApiRouter } from "./src/routes/apiRoutes";

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. The AI agent will not work until you set it.");
}

// ── Global Baileys (unofficial WA) toggle ────────────────────────────────────
let baileysEnabled: boolean = false;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "placeholder-gemini-key" });

// ---------------------------------------------------------------------------
// Express Master Server Application
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10mb" }));
  app.use(cors());

  const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
  app.use("/api/", limiter);

  // ── Zero-Trust Anti-Tamper Security Middleware ────────────────────────────
  app.use(async (req, res, next) => {
    const reqPath = req.path;
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
      reqPath.startsWith("/api/app-key/") ||
      reqPath.startsWith("/api/network/") ||
      reqPath.startsWith("/api/instagram/webhook") ||
      reqPath.startsWith("/api/whatsapp/cloud/webhook") ||
      reqPath.startsWith("/api/telegram/webhook") ||
      reqPath === "/health" ||
      !reqPath.startsWith("/api/")
    ) {
      return next();
    }

    const authHeader =
      (req.headers["x-app-key-token"] as string) ||
      (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null) ||
      (req.query["token"] as string);

    const isUltraSensitive =
      reqPath.includes("/memory/export/") ||
      reqPath.includes("/memory/import/") ||
      reqPath.includes("/memory/clear") ||
      reqPath.includes("/reset-all-data");

    if (!authHeader || !appSecurityService.verifySessionToken(authHeader)) {
      if (isUltraSensitive) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Direct unauthorized attack/probe on sensitive endpoint: ${reqPath}`
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

  // ── Register Modularized REST API Router ──────────────────────────────────
  app.use(createApiRouter({
    getBaileysEnabled: () => baileysEnabled,
    setBaileysEnabled: (v) => { baileysEnabled = v; },
    getActiveConnectionsCount: () => connectedClients.size,
  }));

  // ── Vite Dev Server / Production Static Serving ───────────────────────────
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

  // ── HTTP & WebSocket Server Setup ─────────────────────────────────────────
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/live" });
  telegramSecurityBotService.setConnectionTracker(() => wss.clients.size);

  const connectedClients = new Set<any>();

  // ── Background Schedulers & Real-time Event Broadcasters ──────────────────
  reminderScheduler.start((reminder) => {
    const payload = JSON.stringify({ type: "reminder_alert", task: reminder.title, time: reminder.timeString });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  dailyUpdateReminderScheduler.start();

  backgroundTasksService.onTaskChange((task) => {
    const payload = JSON.stringify({ type: "background_task_event", task });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

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

    const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const senderDigits = (msg.senderPhone || "").replace(/\D/g, "");
    if (!msg.isGroup && ownerPhone && senderDigits === ownerPhone && !msg.consumedByDailyUpdate) {
      codeAgentService.handleWhatsAppApprovalReply(msg.text).catch((e) =>
        console.error("[Server] Failed to handle WhatsApp approval reply:", e)
      );
    }
  });

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
      voiceBiometricsService.handleWhatsAppVoicePinMessage(msg.text, msg.name)
        .then(async (pinRes) => {
          if (pinRes.handled && pinRes.replyText) {
            await whatsappCloudService.sendMessage(msg.from, pinRes.replyText);
          } else {
            codeAgentService.handleWhatsAppApprovalReply(msg.text).catch((e) =>
              console.error("[Server] Failed to handle Cloud WhatsApp approval reply:", e)
            );
          }
        })
        .catch((e) => console.error("[Server] Voice PIN Cloud handler error:", e));
    }
  });

  telegramBotService.start().catch((err) =>
    console.error("[Server] Telegram Bot start error:", err)
  );

  telegramSecurityBotService.start().catch((err) =>
    console.error("[Server] Telegram Security Bot start error:", err)
  );

  telegramBotService.setMessageCallback((msg) => {
    const payload = JSON.stringify({
      type: "telegram_incoming",
      sender: msg.sender,
      text: msg.text,
      time: msg.time,
      chatId: msg.chatId,
    });
    for (const client of connectedClients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  // ---------------------------------------------------------------------------
  // WebSocket Live AI Connection Handler (Gemini Live Session)
  // ---------------------------------------------------------------------------
  wss.on("connection", (clientWs, req) => {
    console.log("[Server] Client connected to live session");
    connectedClients.add(clientWs);

    let isAuthorized = false;
    const authTimeout = setTimeout(() => {
      if (!isAuthorized) {
        console.warn("[Server] 🚫 Closing unauthorized WebSocket (Auth Timeout 10s)");
        try {
          clientWs.send(JSON.stringify({ error: "ACCESS_LOCKED", message: "Authentication timeout. App Access Key required." }));
          clientWs.close(4001, "UNAUTHORIZED_TIMEOUT");
        } catch {}
      }
    }, 10000);

    const safeSend = (payload: string) => {
      try {
        if (clientWs.readyState === 1 /* OPEN */) clientWs.send(payload);
      } catch (e: any) {
        if (!/ECONNRESET|EPIPE|closed|not opened/i.test(e?.message || "")) {
          console.error("[Server] safeSend error:", e?.message);
        }
      }
    };

    let currentSession: any;
    let currentSessionToken = 0;
    const sessionId = Date.now().toString();

    let isReconnecting = false;
    let isInitializingSession = false;
    let hasEverConnected = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    let lastVoice = "Aoede";
    let lastThinkingLevel = "high";
    let lastAccurateMode = false;
    let lastAnswerLength: string | undefined;
    let lastGoogleSearchMode = false;

    const createSession = async (
      voice: string,
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      const effectiveThinking = accurateMode || googleSearchMode ? "high" : (thinkingLevel || "high");
      const systemInstruction = await buildLiveSystemInstruction({
        thinkingLevel: effectiveThinking,
        accurateMode,
        answerLength,
        googleSearchMode,
        voiceName: voice || "Aoede",
      });


      let inputTranscriptBuffer = "";
      let outputTranscriptBuffer = "";
      let thisSessionRef: any;

      const newSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log(`[Server] 🟢 Gemini Live session opened (session=${sessionId})`);
          },
          onerror: (err: any) => {
            console.error(`[Server] ❌ Gemini Live session ERROR (session=${sessionId}):`, err?.message || err);
            if (currentSession === thisSessionRef) {
              currentSession = undefined;
              autoReconnect();
            }
          },
          onclose: (evt: any) => {
            console.warn(`[Server] 🔌 Gemini Live session CLOSED (session=${sessionId}) code=${evt?.code} reason=${evt?.reason || "n/a"}`);
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

            const isThinkingFrame =
              !hasAudio && !transcript && !inputTranscript &&
              message.serverContent?.modelTurn !== undefined &&
              !message.serverContent?.turnComplete;

            if (isThinkingFrame) safeSend(JSON.stringify({ type: "thinking" }));
            if (transcript) {
              safeSend(JSON.stringify({ text: transcript }));
              outputTranscriptBuffer += transcript;
            }
            if (inputTranscript) inputTranscriptBuffer += inputTranscript;
            if (message.serverContent?.interrupted) safeSend(JSON.stringify({ interrupted: true }));
            if (message.serverContent?.turnComplete) {
              safeSend(JSON.stringify({ turnComplete: true }));
              if (inputTranscriptBuffer.trim()) {
                saveMessage("user", inputTranscriptBuffer).catch((e) => console.error("[Server] Failed to save user message:", e));
                memoryEngine.recordMessage(sessionId, "user", inputTranscriptBuffer);
              }
              if (outputTranscriptBuffer.trim()) {
                saveMessage("ai", outputTranscriptBuffer).catch((e) => console.error("[Server] Failed to save AI message:", e));
                memoryEngine.recordMessage(sessionId, "ai", outputTranscriptBuffer);
                backgroundTasksService.markTaskNotified("all");
              }
              inputTranscriptBuffer = "";
              outputTranscriptBuffer = "";
            }

            // Handle Gemini Live Function Calling via Clean Modular Dispatcher
            if (message.toolCall?.functionCalls) {
              const functionResponses: any[] = [];
              for (const call of message.toolCall.functionCalls) {
                const toolOutput = await dispatchLiveToolCall(call, {
                  sessionId,
                  clientWs,
                  safeSend,
                  connectedClients,
                  getBaileysEnabled: () => baileysEnabled,
                  setBaileysEnabled: (v) => { baileysEnabled = v; },
                });
                functionResponses.push({ id: call.id, name: call.name, response: { output: toolOutput } });
              }

              try {
                if (currentSession) currentSession.sendToolResponse({ functionResponses });
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
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Aoede" } } },
          thinkingConfig: { thinkingLevel: (["low", "medium", "high"].includes(effectiveThinking) ? effectiveThinking : "high") as any },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              silenceDurationMs: 500,
              prefixPaddingMs: 160,
            },
          },
          tools: [
            ...(googleSearchMode ? [{ googleSearch: {} }] : []),
            { functionDeclarations: fridayFunctionDeclarations },
          ],
          systemInstruction,
        },
      });

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
              parts: [{ text: `[System note: the user attached an image${parsedData.caption ? ` with caption "${parsedData.caption}"` : ""}. Look at it and respond helpfully.]` }],
            },
          ],
          turnComplete: true,
        });
      } catch (err) {
        console.error("Failed to forward image to Gemini Live session:", err);
        clientWs.send(JSON.stringify({ imageAck: false, imageId: parsedData.imageId, error: "image_forward_failed" }));
      }
    };

    const autoReconnect = async () => {
      if (isReconnecting || isInitializingSession || clientWs.readyState !== 1) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[Server] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for session=${sessionId}.`);
        safeSend(JSON.stringify({ error: "session_reconnect_failed", message: "Boss, connection dobara nahi ban saki. Page refresh karo." }));
        return;
      }
      isReconnecting = true;
      reconnectAttempts++;
      const delayMs = Math.min(4000, 1000 * Math.pow(1.5, reconnectAttempts - 1));
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
        hasEverConnected = true;
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

      if (!isAuthorized) {
        console.warn("[Server] 🚫 WebSocket command blocked: Session is not authorized");
        safeSend(JSON.stringify({ error: "ACCESS_LOCKED", message: "App Key authentication required." }));
        return;
      }

      if (parsedData.type === "init") {
        if (isInitializingSession) {
          console.log(`[Server] ⏳ Session initialization already in progress (session=${sessionId}), ignoring duplicate init.`);
          return;
        }
        isInitializingSession = true;
        console.log(`[Server] 🎙️ init received (session=${sessionId}), (re)creating Gemini Live session...`);
        lastVoice = parsedData.voice || "Aoede";
        lastThinkingLevel = parsedData.thinkingLevel || "high";
        lastAccurateMode = !!parsedData.accurateMode;
        lastAnswerLength = parsedData.answerLength;
        lastGoogleSearchMode = !!parsedData.googleSearchMode;

        try {
          if (currentSession) {
            const oldSession = currentSession;
            currentSession = undefined;
            try { await oldSession.close(); } catch {}
          }
          const myToken = ++currentSessionToken;
          const newSession = await createSession(
            parsedData.voice,
            parsedData.thinkingLevel,
            !!parsedData.accurateMode,
            parsedData.answerLength,
            !!parsedData.googleSearchMode
          );

          if (myToken !== currentSessionToken) {
            console.warn("[Server] Discarding stale Gemini Live session from a superseded init request.");
            try { (newSession as any).close(); } catch {}
            isInitializingSession = false;
            return;
          }

          currentSession = newSession;
          hasEverConnected = true;
          isInitializingSession = false;
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
          isInitializingSession = false;
          safeSend(JSON.stringify({ error: "session_init_failed", message: err?.message || String(err) }));
        }
        return;
      }

      if (!currentSession) {
        if (parsedData.image) {
          pendingImages.push(parsedData);
          return;
        }
        if (isInitializingSession) return;
        if (hasEverConnected && !isReconnecting) autoReconnect();
        return;
      }

      try {
        if (parsedData.audio) {
          currentSession.sendRealtimeInput({
            audio: { data: parsedData.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (parsedData.type === "audio_stream_end") {
          console.log(`[Server] 🔕 audio_stream_end received from client (session=${sessionId}) — flushing turn to Gemini.`);
          try {
            currentSession.sendRealtimeInput({ audioStreamEnd: true });
          } catch (e) {
            console.error("[Server] Failed to send audioStreamEnd:", e);
          }
        } else if (parsedData.image) {
          await processImageInput(parsedData);
        }
      } catch (err) {
        console.error("Error processing client input:", err);
      }
    });

    clientWs.on("close", () => {
      console.log(`[Server] Client disconnected (session=${sessionId})`);
      connectedClients.delete(clientWs);
      if (authTimeout) clearTimeout(authTimeout);
      if (currentSession) {
        try { currentSession.close(); } catch {}
        currentSession = undefined;
      }
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] 🚀 Friday Clean Architecture Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[Server] Fatal initialization error:", err);
  process.exit(1);
});
