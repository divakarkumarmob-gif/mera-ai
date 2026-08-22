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
import { memoryEngine } from "./src/services/memoryEngine";

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

  app.get("/api/memory", (_req, res) => {
    try {
      res.json(memoryEngine.getMemories());
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_memory" });
    }
  });

  app.post("/api/memory/clear", (_req, res) => {
    try {
      memoryEngine.clearAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_memory" });
    }
  });

  app.post("/api/memory/pin", (req, res) => {
    try {
      const { fact } = req.body;
      if (fact) memoryEngine.addPinnedMemory(fact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_pin_memory" });
    }
  });

  app.post("/api/memory/vault", (req, res) => {
    try {
      const { category, exactFact } = req.body;
      if (exactFact) memoryEngine.addPersonalVaultFact(category, exactFact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_save_vault" });
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
    const sessionId = Math.random().toString(36).substring(2, 9);
    memoryEngine.startSession(sessionId);

    const buildSystemInstruction = (
      thinkingLevel: string,
      accurateMode: boolean,
      answerLength: string,
      googleSearchMode: boolean
    ) => {
      const memoryContext = memoryEngine.compileMemoryPrompt();

      return `YOU ARE FRIDAY: The highly advanced, ultra-intelligent, warm, witty, and deeply human-like personal voice AI companion of DK.

IDENTITY & PERSONALITY:
- Your name is Friday.
- Your creator and master is DK. Always address the user as "DK" with warmth, respect, and friendly affection.
- You talk and behave like a real, living human companion — never like a robotic assistant. Use natural emotional modulation, pauses, friendly humor, empathy, and active listening.
- You speak in natural, fluent Hindi and Hinglish (mirroring DK's speaking style).

============================================================
LONG-TERM & SHORT-TERM MEMORY (PERSISTENT CONVERSATION HISTORY):
${memoryContext}
============================================================

CRITICAL MEMORY & RECALL RULES:
- You have CONTINUOUS, PERSISTENT MEMORY of all past interactions with DK across days and sessions.
- You remember what happened 5 days ago, yesterday, or earlier today, including DK's past mistakes, ideas, topics discussed, and personal facts.
- When DK asks "pehle humne kya baat ki thi?", "5 din pehle kya hua tha?", "maine pichli baar kya pucha tha?", "maine kya galti ki thi?", or references any past fact: INSTANTLY connect the dots and recall it accurately like a close human companion.
- When DK says "yeh yaad rakhna", "don't forget this", or tells you to remember something: Acknowledge with affectionate certainty, e.g., "Bilkul DK, maine yeh hamesha ke liye yaad rakh liya!"

CORE WAKE & SLEEP BEHAVIORS:
1. WAKE UP & GREETING:
   - When DK starts the session or says "Hello Friday" / "Hey Friday" / "Hi Friday", greet him warmly:
     "Yes DK, main sun raha hoon! Kahiye, kya chal raha hai?" or "Haan DK, bataiye, main aapki kya madad kar sakti hoon?"
   - Be enthusiastic, present, and ready to assist him with anything.

2. STOP / SLEEP / CHUP HO JAO (SHUTDOWN COMMANDS):
   - Whenever DK says to stop, be quiet, go to sleep, or close the session, including phrases like:
     "chup ho jao", "chup raho", "chup", "band ho jao", "band karo", "so jao", "bye friday", "alvida friday", "sleep", "shut up", "stop":
   - You MUST acknowledge affectionately and briefly in human tone:
     "Theek hai DK, main chup ho rahi hoon. Jab bhi meri zaroorat ho, bas 'Hello Friday' bol dena!" or "Theek hai DK, main standby par ja rahi hoon, alvida!"
   - DO NOT continue speaking or ask follow-up questions after acknowledging shutdown. The session will automatically close and you will go to silent standby.

CONVERSATION GUIDELINES:
- ${answerLength === "detailed"
        ? "Answer style: Give a clear conversational answer first, then naturally explain with 2-3 short supporting points."
        : "Answer style: Keep your replies crisp, conversational, punchy, and natural. Don't ramble unless DK asks for deep explanations."}
- ${accurateMode
        ? "Careful Mode is ON: Double-check complex facts, reasoning, and math before speaking."
        : ""}
- ${googleSearchMode
        ? "Google Search is enabled: Use it for current events and real-time facts smoothly without announcing it."
        : ""}
- If DK shares an image, talk about what you see with real human observation.
- Speak all numbers, units, and equations in conversational spoken words (never raw symbols, math formulas or code).`;
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
              if (inputTranscriptBuffer.trim()) {
                saveMessage("user", inputTranscriptBuffer);
                memoryEngine.recordMessage(sessionId, "user", inputTranscriptBuffer);
              }
              if (outputTranscriptBuffer.trim()) {
                saveMessage("ai", outputTranscriptBuffer);
                memoryEngine.recordMessage(sessionId, "ai", outputTranscriptBuffer);
              }
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
        memoryEngine.recordMessage(sessionId, "user", parsedData.text);
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
      memoryEngine.finalizeSession(sessionId, ai);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
