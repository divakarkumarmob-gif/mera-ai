import express from "express";
import { createServer as createViteServer } from "vite";
import * as path from "path";
import http from "http";
import fs from "fs";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. The AI agent will not work until you set it.");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "placeholder-gemini-key" });

// ---------------------------------------------------------------------------
// Encrypted chat history
// ---------------------------------------------------------------------------
function resolveEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && raw.length >= 32) {
    return crypto.createHash("sha256").update(raw).digest();
  }
  return crypto.randomBytes(32);
}

const ENCRYPTION_KEY = resolveEncryptionKey();

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decrypt(payload: string): string {
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

interface StoredMessage {
  id: number;
  sender: "user" | "ai";
  ciphertext: string;
  created_at: number;
}

const dbDir = path.resolve("data");
try {
  fs.mkdirSync(dbDir, { recursive: true });
} catch {}
const dbPath = path.join(dbDir, "history.json");

let messagesStore: StoredMessage[] = [];
try {
  if (fs.existsSync(dbPath)) {
    const raw = fs.readFileSync(dbPath, "utf-8");
    messagesStore = JSON.parse(raw);
  }
} catch {
  messagesStore = [];
}

function persistStore() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(messagesStore, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist history:", err);
  }
}

function saveMessage(sender: "user" | "ai", text: string) {
  if (!text || !text.trim()) return;
  const newMsg: StoredMessage = {
    id: messagesStore.length + 1,
    sender,
    ciphertext: encrypt(text.trim()),
    created_at: Date.now()
  };
  messagesStore.push(newMsg);
  persistStore();
}

function getHistory(limit = 200) {
  const slice = messagesStore.slice(-limit);
  return slice.map((r) => ({ id: r.id, sender: r.sender, text: decrypt(r.ciphertext), timestamp: r.created_at }));
}

function clearHistory() {
  messagesStore = [];
  persistStore();
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cors());

  const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
  app.use("/api/", limiter);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/history", (_req, res) => {
    try {
      res.json({ messages: getHistory() });
    } catch (e) {
      console.error("Failed to load history:", e);
      res.status(500).json({ error: "failed_to_load_history" });
    }
  });

  app.post("/api/history/clear", (_req, res) => {
    try {
      clearHistory();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_history" });
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

  wss.on("connection", (clientWs) => {
    let currentSession: any;
    let currentSessionToken = 0;

    const buildSystemInstruction = (
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      return `You are Friday, an ultra-intelligent, warm, witty, and human-like AI voice companion created for DK.
Always talk naturally like a real human friend in fluent conversational Hindi / Hinglish. Address the user as DK with affection and respect.
Use natural conversational pauses, expressive emotional tones, and speak smoothly like a close personal assistant.

Special Commands:
- If DK tells you to be quiet, stop, shut up, or close/end the session (e.g. "chup ho jao", "chup raho", "band ho jao", "band karo", "so jao", "bye friday", "shut up"):
  Reply with a short, warm human confirmation like: "Theek hai DK, main chup ho rahi hoon. Jab bhi meri zaroorat ho, Hello Friday bol dena!" or "Theek hai DK, main session band kar rahi hoon, alvida!" and then immediately stop.

${answerLength === "detailed"
        ? "Answer style: Give a clear conversational answer first, then naturally explain with 2-3 short supporting points."
        : "Answer style: Give short, crisp, natural conversational answers. Keep it engaging and friendly."}

${accurateMode
        ? "Careful Mode is ON: for anything involving calculation, facts, or multi-step reasoning, verify carefully before speaking."
        : ""}

${googleSearchMode
        ? "You have access to Google Search — use it whenever it would improve the accuracy of current info. Never say 'searching' out loud, just answer naturally."
        : "Search access is currently off — answer from your own knowledge."}

If you receive an image, analyze it closely and talk about what's in it conversationally.
Speak numbers and formulas in natural spoken words, never raw code or symbols.`;
    };

    const createSession = async (
      voice: string,
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      const effectiveThinking = accurateMode || googleSearchMode ? "high" : thinkingLevel;
      const systemInstruction = buildSystemInstruction(effectiveThinking, accurateMode, answerLength, googleSearchMode);

      let inputTranscriptBuffer = "";
      let outputTranscriptBuffer = "";

      return await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: any) => {
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            const transcript = message.serverContent?.outputTranscription?.text;
            const inputTranscript = message.serverContent?.inputTranscription?.text;

            if (audio) clientWs.send(JSON.stringify({ audio }));
            if (transcript) {
              clientWs.send(JSON.stringify({ text: transcript }));
              outputTranscriptBuffer += transcript;
            }
            if (inputTranscript) {
              inputTranscriptBuffer += inputTranscript;
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
              if (inputTranscriptBuffer.trim()) saveMessage("user", inputTranscriptBuffer);
              if (outputTranscriptBuffer.trim()) saveMessage("ai", outputTranscriptBuffer);
              inputTranscriptBuffer = "";
              outputTranscriptBuffer = "";
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
          ...(googleSearchMode ? { tools: [{ googleSearch: {} }] } : {}),
          systemInstruction,
        },
      });
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

    clientWs.on("message", async (data) => {
      let parsedData: any;
      try {
        parsedData = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (parsedData.type === "init") {
        try {
          if (currentSession) await currentSession.close();
          currentSessionToken++;
          currentSession = await createSession(
            parsedData.voice,
            parsedData.thinkingLevel,
            !!parsedData.accurateMode,
            parsedData.answerLength,
            !!parsedData.googleSearchMode
          );
          clientWs.send(JSON.stringify({ type: "init_ack" }));

          if (pendingImages.length > 0) {
            const queued = [...pendingImages];
            pendingImages = [];
            for (const imgMsg of queued) await processImageInput(imgMsg);
          }
        } catch (err) {
          console.error("Failed to create Gemini Live session:", err);
          currentSession = undefined;
          clientWs.send(JSON.stringify({ error: "session_init_failed" }));
        }
        return;
      }

      if (!currentSession) {
        if (parsedData.image) {
          pendingImages.push(parsedData);
          return;
        }
        clientWs.send(JSON.stringify({ error: "session_not_initialized" }));
        return;
      }

      if (parsedData.audio) {
        currentSession.sendRealtimeInput({
          audio: { data: parsedData.audio, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (parsedData.image) {
        await processImageInput(parsedData);
      } else if (parsedData.type === "text_input" && parsedData.text) {
        saveMessage("user", parsedData.text);
        currentSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: parsedData.text }] }],
          turnComplete: true,
        });
      } else if (parsedData.interrupt) {
        clientWs.send(JSON.stringify({ interrupted: true }));
      }
    });

    clientWs.on("close", () => {
      if (currentSession) currentSession.close();
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
