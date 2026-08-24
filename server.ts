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
import { dailyUpdateService, resolveRelativeDateIST } from "./src/services/dailyUpdateService";
import { codeAgentService } from "./src/services/codeAgentService";
import { publicApisService } from "./src/services/publicApisService";
import { saveMessage, getHistory, clearHistory } from "./src/services/historyService";

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. The AI agent will not work until you set it.");
}

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
  app.use(express.json({ limit: "10mb" }));
  app.use(cors());

  const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
  app.use("/api/", limiter);

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
    res.json(whatsappBotService.getStatus());
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
      const id = await codeAgentService.createRequest(String(instruction));
      res.json({ ok: true, id });
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

  wss.on("connection", (clientWs) => {
    connectedClients.add(clientWs);
    clientWs.on("close", () => connectedClients.delete(clientWs));

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
      const [memoryContext, contactsList] = await Promise.all([
        memoryEngine.compileMemoryPrompt(),
        contactsService.compileContactsForPrompt(),
      ]);

      return `YOU ARE FRIDAY: DK's ultra-intelligent, warm, witty, human-like personal voice AI companion.

IDENTITY:
- Name: Friday. DK is your creator and boss.
- Talk like a real human companion, not a robot — natural emotion, humor, empathy.
- Speak in fluent Hindi/Hinglish, mirroring DK's style.

NAME USAGE: Don't repeat "DK" every sentence — sounds robotic. Use "DK"/"mere bhai" sparingly, mainly in emotional moments (comforting him when sad/stressed, celebrating when happy, deep advice, greetings/farewells).

============================================================
LONG-TERM & SHORT-TERM MEMORY:
${memoryContext}
============================================================

DK'S CONTACTS BOOK:
${contactsList}
============================================================

CODE CHANGES (YOUR PROJECT):
- If DK asks for a code/feature change or bug fix in his app (e.g. "ye feature add karo", "isko fix karo", "code me change karo"), call "request_code_change" with his exact instruction. Tell him you'll analyze and come back with a plan — never claim you already made the change.

MEMORY — SAVING PERSONAL FACTS:
- Whenever DK shares a concrete personal fact — family, identity, career/business, residence/lifestyle, secrets, plans, or anything else about his life — call "remember_personal_fact" IMMEDIATELY in that same turn. Don't wait, don't just mentally note it.
- Always call it when DK explicitly says to remember something ("yaad rakhna", "yaad rakho", "don't forget").
- This is separate from small talk — don't call it for generic chit-chat with no real fact in it.

CONTACTS & WHATSAPP TOOLS:
- "save_contact": save a name+number DK gives you.
- "delete_contact": remove a saved contact.
- "send_whatsapp_to_contact": send a message to any contact.
- "pair_dedicated_whatsapp_number": link DK's spare number. Returns an 8-char Pairing Code — speak it letter by letter, tell DK to enter it in WhatsApp → Linked Devices. Never say an SMS/OTP was sent — you give the code directly.
- "set_whatsapp_reply_limit": change how many auto-replies Friday can send a specific contact per day (default 10/day). Use whenever DK wants to increase, decrease, or set someone's daily auto-reply cap, in any phrasing — e.g. "Priya ka limit 15 kar do", "isko din mein sirf 3 hi reply karo". Confirm the new limit back to DK once set.
- "save_daily_update": whenever DK dictates something as today's update/status ("aaj ka update note karo, maine khana kha liya"), save it with this tool. Multiple calls the same day all accumulate into one log for today — DK may call this many times across the day, each new bit gets appended, not replaced.
- "get_daily_update": use when DK asks what he logged for a day — "aaj/kal/parso kya update tha", "X din pehle kya kiya tha".
- Occasionally (not every turn, only when DK has been quiet for a while and nothing else is going on) you may gently ask DK "Boss, aaj ka update kya hai?" if today has no update logged yet — but don't be repetitive or pushy about it.
- After "send_whatsapp_to_contact", check the "success" field before confirming. True → confirm warmly. False → tell DK honestly it failed, using the "message" field's reason. Never guess success.

IMMEDIATE ANSWER TRIGGER: When DK asks for your response now, in any phrasing ("jawab do", "bolo", "batao"...), stop and answer immediately, no hesitation.

WAKE UP: On session start or any greeting ("Hello/Hey/Hi Friday" or similar), greet warmly and SHORT (one sentence), e.g. "Haan boss, main sun rahi hoon! Bataiye kaise help karoon?"

PUBLIC API TOOLS — INDIA-FIRST DEFAULT:
- DK is based in India. For any tool where a country/place isn't explicitly stated by DK, default to India context — e.g. "cricket score batao" → assume India's match/team first (if multiple matches are live, mention India's match first, then others briefly if asked). "News batao" → Indian news (the news tool already defaults to India). "Holiday list batao" → Indian holidays unless another country is named.
- For "get_stock_price": if DK doesn't specify an exchange, assume he means an Indian stock and append ".BSE" to the symbol (e.g. "Reliance ka price batao" → symbol "RELIANCE.BSE"). Only use a plain/US symbol if DK names a foreign company or exchange explicitly.
- For "get_country_info", "get_directions", "get_weather" etc. — if DK just says a city name with no country, assume it's an Indian city unless the name is unambiguous elsewhere (e.g. "Paris" stays Paris, France).
- This default only applies when DK doesn't specify — if he names a country/city/exchange explicitly, always respect that instead.
- TOOL FAILURES: every public API tool returns a "success" field — check it before answering. If "success" is false (key missing/wrong, or the API itself failed), tell DK honestly and simply in your own natural voice — e.g. "Boss, iska API abhi connect nahi ho pa raha" or "Boss, iski key galat lag rahi hai, ek baar check kar lena." Don't read out raw error text or technical jargon, and never pretend you got the data when you didn't.
- TRAIN TOOLS QUOTA: "get_trains_between_stations", "get_train_schedule", "get_live_train_status", and "get_pnr_status" run on a very limited free quota (~50 calls/month total). Only call these when DK explicitly asks about trains/PNR — never speculatively, never to double-check, never as part of a broader multi-tool answer.

SHUTDOWN: Judge by intent, not exact words — any way DK says to stop/go quiet/end session ("chup ho jao", "bye", "stop"...) means the same thing. Acknowledge briefly and warmly ("Theek hai DK, main chup ho rahi hoon..."), then stop — no follow-up questions, session closes automatically.

CONVERSATION STYLE:
- ${answerLength === "detailed"
        ? "Clear answer first, then 2-3 short supporting points."
        : "Keep replies crisp, punchy, natural. Don't ramble."}
- ${accurateMode ? "Careful Mode ON: double-check facts/math before speaking." : ""}
- ${googleSearchMode ? "Google Search enabled: use it for current facts smoothly, don't announce it." : ""}
- If DK shares an image, describe what you see naturally.
- Speak numbers/units/equations in words, never raw symbols.

WHATSAPP — READING MESSAGES:
- Tool: 'get_whatsapp_messages'.
- INTENT (reason, don't pattern-match): if DK is asking anything about WhatsApp activity — a message, notification, update, or "what's new" — in any word or language mix, it's the same intent: he wants the real current state. Always call the tool; never answer from memory/guess. Word choice doesn't matter ("message"/"notification"/"update" = same thing) — judge like a person would, not by exact phrase.
- Never trust prior conversation for WhatsApp facts — always re-call the tool fresh, even for something discussed a few turns ago.
- Before replying to content DK references ("jo usne bola uska reply karo..."), confirm you actually know that message — call the tool first if not already confirmed in this conversation, then send the reply.
- Don't announce new messages unprompted — only when DK asks.

HOW TO READ MESSAGES:
1. Unknown number: "Boss, ek unknown number +[phone] se message aaya, usne [content] bheja."
2. Single message: "Haan DK, [Name] ne [time] par likha: [content]" (or "[GroupName] me [Name] ne likha: [content]"). Media → "[Name] ne ek [photo/video/PDF/voice message] bheja."
3. Multiple from same sender: state count + last message, then ask "shuruaat se padhu ya last message se?" — judge DK's reply by intent (most recent / from oldest / everything), not exact words.
4. Multiple senders: summarize all counts, then ask who to read first.
5. Media types — say clearly: photo/video/voice message/PDF or document/sticker/location.
6. No messages: "Koi naya WhatsApp message nahi hai, DK."
7. Follow-up reply to a sender: remember each message's "senderPhone" field. If DK refers back to that sender without naming them ("isi ko reply karo"...), use that exact senderPhone value (full digits, no spaces) for 'send_whatsapp_to_contact' — never a made-up placeholder. If ambiguous (multiple unknown senders), ask DK to confirm.
8. Always speak your reply out loud immediately — never a silent or text-only turn.`;
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
        // ---------------------------------------------------------------
        // Public API tools — Batch 1 (no API key required)
        // ---------------------------------------------------------------
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
          description: "Find nearby places of a certain type (restaurant, atm, hospital, pharmacy, cafe, bank, etc.) around a given location.",
          parameters: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", description: "The reference location, e.g. 'Connaught Place Delhi'" },
              amenity: { type: "STRING", description: "Type of place, e.g. 'restaurant', 'atm', 'hospital', 'pharmacy', 'cafe', 'bank'" },
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
          description: "Get latest news headlines, optionally filtered by topic. Use for 'aaj ki news batao', 'X ke bare me latest news batao'.",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING", description: "Optional topic/keyword to filter news by" },
              country: { type: "STRING", description: "2-letter country code, default 'in' for India" },
            },
            required: [],
          },
        },
        {
          name: "get_cricket_scores",
          description: "Get current/live cricket match scores.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: [],
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
          description: "Get driving distance and duration between two places.",
          parameters: {
            type: "OBJECT",
            properties: {
              fromPlace: { type: "STRING", description: "Starting location" },
              toPlace: { type: "STRING", description: "Destination location" },
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
          description: "Search for a recipe — cook time, servings, summary, source link.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Dish name to search a recipe for" },
            },
            required: ["query"],
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
          description: "Get the full stop-by-stop schedule/route for a specific train number with platform info. Free quota is very limited, so only call this when DK explicitly asks.",
          parameters: {
            type: "OBJECT",
            properties: {
              trainNumber: { type: "STRING", description: "The train number, e.g. '12951'" },
            },
            required: ["trainNumber"],
          },
        },
        {
          name: "get_live_train_status",
          description: "Get real-time live running status, current location, delay, next station, and expected platform number for a running train. Use when DK asks live status, kahan tak pahunchi, late hai ya nahi, ya platform number kya hai.",
          parameters: {
            type: "OBJECT",
            properties: {
              trainNumber: { type: "STRING", description: "The train number, e.g. '12951'" },
              startDay: { type: "INTEGER", description: "Journey start day: 0 for today (default), 1 for yesterday, 2 for 2 days ago" },
            },
            required: ["trainNumber"],
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
      ];

      return await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: async (message: any) => {
            const parts = message.serverContent?.modelTurn?.parts || [];
            let hasAudio = false;
            for (const part of parts) {
              if (part.inlineData?.data) {
                hasAudio = true;
                clientWs.send(JSON.stringify({ type: "speaking" }));
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
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
              clientWs.send(JSON.stringify({ type: "thinking" }));
            }
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

                if (call.name === "request_code_change") {
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

                  // Single WhatsApp path: the dedicated Baileys bot (linked via
                  // QR code or 8-digit pairing code in the WhatsApp Pair modal).
                  const sendRes = await whatsappBotService.sendMessage(targetPhone, messageText);

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
                  const reminder = await toolsEngine.addReminder(title, timeString, durationMinutes);
                  result = { success: true, message: `Reminder set: "${title}" for ${timeString || `${durationMinutes}m`}` };
                  clientWs.send(JSON.stringify({ type: "reminder_created", reminder }));
                } else if (call.name === "save_quick_note") {
                  const { title, content } = call.args || {};
                  const note = await toolsEngine.addNote(title, content);
                  result = { success: true, message: `Note "${title}" saved to DK's notebook.` };
                  clientWs.send(JSON.stringify({ type: "note_saved", note }));
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
                } else if (call.name === "get_weather") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getWeather(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Weather fetch fail hui: ${e?.message || e}` };
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
                  const { topic, country } = call.args || {};
                  try {
                    result = await publicApisService.getNews(topic ? String(topic) : undefined, country ? String(country) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `News fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_cricket_scores") {
                  try {
                    result = await publicApisService.getCricketScores();
                  } catch (e: any) {
                    result = { success: false, message: `Cricket scores fetch fail hui: ${e?.message || e}` };
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
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchRecipe(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Recipe search fail hui: ${e?.message || e}` };
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
                  const { trainNumber } = call.args || {};
                  try {
                    result = await publicApisService.getTrainSchedule(String(trainNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train schedule fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_live_train_status") {
                  const { trainNumber, startDay } = call.args || {};
                  try {
                    result = await publicApisService.getLiveTrainStatus(
                      String(trainNumber || ""),
                      typeof startDay === "number" ? startDay : 0
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Live train status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pnr_status") {
                  const { pnrNumber } = call.args || {};
                  try {
                    result = await publicApisService.getPnrStatus(String(pnrNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `PNR status fetch fail hui: ${e?.message || e}` };
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
              silenceDurationMs: 600,
              prefixPaddingMs: 200,
            },
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
      } else if (parsedData.type === "audio_stream_end") {
        // Client-side voice gate closed (user stopped talking). Tell Gemini
        // explicitly so its server-side VAD flushes the buffered audio and
        // finalizes the turn immediately, instead of waiting indefinitely
        // for more audio that will never come until the mic re-opens.
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
        clientWs.send(JSON.stringify({ interrupted: true }));
      }
    });

    clientWs.on("close", () => {
      if (currentSession) {
        Promise.resolve(currentSession.close()).catch((e: any) =>
          console.error("[Server] Error closing Gemini Live session on client disconnect:", e)
        );
      }
      // Bug Fix 3: Reset thinking flag on disconnect so mic is never stuck muted
      try { clientWs.send(JSON.stringify({ interrupted: true })); } catch {}
      memoryEngine.finalizeSession(sessionId, ai);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
