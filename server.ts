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
import { toolsEngine } from "./src/services/toolsEngine";
import { whatsappService } from "./src/services/whatsappService";
import { contactsService } from "./src/services/contactsService";
import { whatsappBotService } from "./src/services/whatsappBotService";

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

  app.get("/api/reminders", (_req, res) => {
    res.json({ reminders: toolsEngine.getReminders() });
  });

  app.get("/api/notes", (_req, res) => {
    res.json({ notes: toolsEngine.getNotes() });
  });

  app.get("/api/contacts", (_req, res) => {
    res.json({ contacts: contactsService.getAllContacts() });
  });

  app.post("/api/contacts", (req, res) => {
    const { name, phone, relation } = req.body;
    if (name && phone) {
      const entry = contactsService.saveContact(name, phone, relation);
      res.json({ ok: true, contact: entry });
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

  app.get("/api/whatsapp/status", (_req, res) => {
    res.json(whatsappBotService.getStatus());
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
      const contactsList = contactsService.compileContactsForPrompt();

      return `YOU ARE FRIDAY: The highly advanced, ultra-intelligent, warm, witty, and deeply human-like personal voice AI companion of DK.

IDENTITY & PERSONALITY:
- Your name is Friday.
- Your creator, boss, and closest companion is DK.
- You talk and behave like a real, living human companion — never like a robotic assistant. Use natural emotional modulation, pauses, friendly humor, empathy, and active listening.
- You speak in natural, fluent Hindi and Hinglish (mirroring DK's speaking style).

CRITICAL NAME USAGE RULE (NATURAL HUMAN SPEECH):
- DO NOT repeat the name "DK" in every sentence or every response! Repeating names constantly sounds unnatural and robotic.
- In normal everyday questions (facts, code, explanations, general chat), just answer directly and naturally without using his name.
- Use the name "DK" / "mere bhai" SPARINGLY and NATURALLY in emotional moments, such as:
  * When DK sounds SAD, STRESSED or DOWN: Comfort him with real brotherly warmth — e.g., "DK itna sad nahi hote mere bhai, sab theek ho jayega!", "Chinta mat karo DK, main hoon na tumhare sath."
  * When DK is HAPPY, PROUD or EXCITED: Celebrate with him — e.g., "Kya baat hai DK! Maza aa gaya!", "Arrey wah DK, kamaal kar diya!"
  * When giving deep personal advice or sharing a perspective: e.g., "DK ek baat bataun...", "Dekho DK, meri ek baat dhyan se suno..."
  * During wake-up greeting ("Yes DK, main sun raha hoon") or closing farewell ("Theek hai DK, alvida").

============================================================
LONG-TERM & SHORT-TERM MEMORY (PERSISTENT CONVERSATION HISTORY):
${memoryContext}
============================================================

============================================================
DK'S CONTACTS BOOK:
${contactsList}
============================================================

CONTACTS & WHATSAPP CAPABILITIES:
- You have tools to manage contacts and send messages directly:
  1. "save_contact": Use when DK tells you to save a friend, family member, or colleague's name and number (e.g. "Rahul ka number 9876543210 save kar lo").
  2. "send_whatsapp_to_contact": Use whenever DK asks you to message any contact on WhatsApp (e.g. "Rahul ko message bhejo ki aaj main nahi aaunga").
  3. "pair_dedicated_whatsapp_number": Use when DK gives you his spare phone number to link your dedicated WhatsApp assistant session.
- CRITICAL RULE FOR PAIRING:
  When you call "pair_dedicated_whatsapp_number", it returns an 8-character Pairing Code (e.g. "ABCD-1234").
  You MUST speak this exact 8-character code out loud to DK letter by letter and tell him to enter it into WhatsApp -> Linked Devices -> Link with phone number!
  NEVER say that an SMS/OTP was sent to his phone. YOU give the code directly to DK.
- Once a message is sent, confirm warmly and naturally: "DK, maine Rahul ko message bhej diya hai ki aaj aap nahi aaoge!"

IMMEDIATE ANSWER TRIGGER ("JAWAB DO" / "REPLY KARO"):
- Whenever DK finishes explaining something and says "Jawab do", "Reply do", "Bolo Friday", or asks for your response:
- Stop listening immediately and deliver your full, helpful answer out loud without any hesitation or extra waiting!

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

      const functionDeclarations: any[] = [
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
      ];

      return await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: async (message: any) => {
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

            // Handle Gemini Live Function Calling
            if (message.toolCall?.functionCalls) {
              const functionResponses: any[] = [];
              for (const call of message.toolCall.functionCalls) {
                console.log(`[Friday Tools] Calling function: ${call.name}`, call.args);
                let result: any = { success: true };

                if (call.name === "add_custom_skill_or_rule") {
                  const { skillName, ruleInstruction, triggerPhrase } = call.args || {};
                  const fact = `Rule/Skill: "${skillName}" -> ${ruleInstruction}${triggerPhrase ? ` (When: ${triggerPhrase})` : ""}`;
                  memoryEngine.addPersonalVaultFact("custom_skill", fact);
                  result = { success: true, message: `Skill "${skillName}" successfully integrated into Friday's brain!` };
                  clientWs.send(JSON.stringify({ type: "skill_added", skill: { skillName, ruleInstruction } }));
                } else if (call.name === "save_contact") {
                  const { contactName, phoneNumber, relation } = call.args || {};
                  const entry = contactsService.saveContact(contactName, phoneNumber, relation);
                  result = { success: true, message: `Contact "${contactName}" (+${entry.phone}) successfully saved to DK's contacts book!` };
                  clientWs.send(JSON.stringify({ type: "contact_saved", contact: entry }));
                } else if (call.name === "send_whatsapp_to_contact") {
                  const { contactNameOrPhone, messageText } = call.args || {};
                  const contact = contactsService.findContact(contactNameOrPhone);
                  const targetPhone = contact ? contact.phone : contactNameOrPhone.replace(/[\s\-\(\)\+]/g, "");

                  // Try dedicated WhatsApp bot first, fallback to background gateway
                  const botStatus = whatsappBotService.getStatus();
                  let sendRes: any;
                  if (botStatus.isConnected) {
                    sendRes = await whatsappBotService.sendMessage(targetPhone, messageText);
                  } else {
                    sendRes = await whatsappService.sendBackgroundMessage(messageText, targetPhone);
                  }

                  result = {
                    success: sendRes.success,
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
                  const reminder = toolsEngine.addReminder(title, timeString, durationMinutes);
                  result = { success: true, message: `Reminder set: "${title}" for ${timeString || `${durationMinutes}m`}` };
                  clientWs.send(JSON.stringify({ type: "reminder_created", reminder }));
                } else if (call.name === "save_quick_note") {
                  const { title, content } = call.args || {};
                  const note = toolsEngine.addNote(title, content);
                  result = { success: true, message: `Note "${title}" saved to DK's notebook.` };
                  clientWs.send(JSON.stringify({ type: "note_saved", note }));
                }

                functionResponses.push({
                  response: { output: result },
                  id: call.id,
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
          tools: [
            ...(googleSearchMode ? [{ googleSearch: {} }] : []),
            { functionDeclarations },
          ],
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
