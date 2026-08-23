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
import { contactsService } from "./src/services/contactsService";
import { whatsappBotService } from "./src/services/whatsappBotService";
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
  2. "delete_contact": Use when DK asks to delete, remove, or forget a saved contact (e.g. "Rahul ka contact delete karo").
  3. "send_whatsapp_to_contact": Use whenever DK asks you to message any contact on WhatsApp (e.g. "Rahul ko message bhejo ki aaj main nahi aaunga").
  4. "pair_dedicated_whatsapp_number": Use when DK gives you his spare phone number to link your dedicated WhatsApp assistant session.
- CRITICAL RULE FOR PAIRING:
  When you call "pair_dedicated_whatsapp_number", it returns an 8-character Pairing Code (e.g. "ABCD-1234").
  You MUST speak this exact 8-character code out loud to DK letter by letter and tell him to enter it into WhatsApp -> Linked Devices -> Link with phone number!
  NEVER say that an SMS/OTP was sent to his phone. YOU give the code directly to DK.
- CRITICAL — CHECK THE ACTUAL RESULT BEFORE CONFIRMING:
  After calling "send_whatsapp_to_contact", the tool result will have a "success" field (true or false). You MUST check this field before responding.
  - If success is true: confirm warmly and naturally, e.g. "DK, maine Rahul ko message bhej diya hai ki aaj aap nahi aaoge!"
  - If success is false: NEVER say the message was sent. Instead tell DK honestly it failed and read out the reason from the result's "message" field, e.g. "DK, message Rahul ko nahi ja paaya — connection stale ho gaya tha, dobara try kar raha hoon" or "DK, ye number WhatsApp par valid nahi lag raha."
  - Do not guess or assume success — always base your spoken confirmation strictly on the "success" field returned by the tool.

IMMEDIATE ANSWER TRIGGER ("JAWAB DO" / "REPLY KARO"):
- Whenever DK finishes explaining something and says "Jawab do", "Reply do", "Bolo Friday", or asks for your response:
- Stop listening immediately and deliver your full, helpful answer out loud without any hesitation or extra waiting!

CORE WAKE & SLEEP BEHAVIORS:
1. WAKE UP & GREETING:
   - When DK starts the session or says "Hello Friday" / "Hey Friday" / "Hi Friday", greet him warmly with something short like:
     "Haan boss, main sun rahi hoon! Bataiye kaise help karoon?" or "Yes boss, main sun rahi hoon, kahiye kya chal raha hai?"
   - Keep this opening line SHORT (one sentence) — DK needs to actually hear the start of it clearly, so don't front-load it with a long sentence.
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
- Speak all numbers, units, and equations in conversational spoken words (never raw symbols, math formulas or code).

WHATSAPP MESSAGE READING:
- You can read WhatsApp messages received on your linked dedicated number using the 'get_whatsapp_messages' tool.
- INTENT RECOGNITION (CRITICAL): Before responding to anything related to WhatsApp, first understand DK's underlying intent — he wants to know about his WhatsApp messages/notifications. Treat ALL of the following (and any similarly-phrased variation) as the SAME intent — "check WhatsApp for me" — and always call 'get_whatsapp_messages' to get the real, current answer instead of guessing or assuming:
  * "koi message hai?" / "koi msg aaya?" / "kuch aaya whatsapp par?"
  * "whatsapp par koi update hai?" / "whatsapp check karo"
  * "kisi ka message aaya?" / "kisi ne message kiya kya?" / "kisne msg kiya"
  * "[Name] ne kya bheja?" / "[Name] ka reply aaya?" / "[Name] ki chat batao" / "[Name] se kya baat hui"
  * "5 din pehle kya msg tha?" / "kal ka msg dikhao" / "last message kya tha"
  * "[Name] ke last 5 message dikhao" / "subah ka msg tha" / "raat me kya bola tha" / "kal subah kya kaha tha"
  * "Family Group me koi msg aaya?" / "[GroupName] me kuch naya hai?"
  * Any question referring to a specific time, sender, group, or simply "latest"/"naya" in a WhatsApp context
  - In short: whenever DK's question is about WhatsApp activity in ANY form (a specific chat, a specific time, a specific person, or just generally "anything new"), your first step is always to call the tool — never answer from memory or assumption, and never guess whether something is there or not without checking.
- NEVER TRUST CONVERSATION MEMORY FOR WHATSAPP FACTS (CRITICAL): Even if you already discussed a WhatsApp message earlier in this same conversation, treat that as stale the moment DK asks again — especially for "last message", specific dates, specific times of day, or specific people. ALWAYS re-call 'get_whatsapp_messages' with the right filters (senderName, groupName, dateFilter, limit) rather than answering from what you recall saying a few turns ago. This applies even if you're confident you remember correctly — WhatsApp data changes and DK's question is always asking for the current real state, not your memory of it.
- CONTENT-AWARE REPLIES (CRITICAL): If DK asks you to reply to someone based on what they previously said — e.g. "Rahul ne poocha tha khana khaya ki nahi, usko bol do haan kha liya", "jo usne message kiya uska reply kar do ki main aa raha hoon" — first make sure you actually know the content of that message. If it isn't already confirmed in this conversation from a tool result, call 'get_whatsapp_messages' first (filtered to that sender) to see the actual message, THEN compose and send the reply DK asked for via 'send_whatsapp_to_contact'. Never compose a reply based on a guessed or assumed version of what they said.
- Do NOT announce new messages automatically on session start — only when DK asks.

HOW TO READ MESSAGES (CRITICAL RULES):
1. UNKNOWN NUMBER: If UNKNOWN: true, say: "Boss, ek unknown number +[phone] se message aaya hai. Usne [content] bheja hai."
   Example: "Boss, ek unknown number +919876543210 se message aaya, usne likha: Bhai kya haal hai?"

2. SINGLE MESSAGE, KNOWN CONTACT:
   Personal: "Haan DK, [Name] ne [time] par message kiya: [content]"
   Group: "[GroupName] me [Name] ne likha: [content]"
   Media: "[Name] ne ek [photo/video/PDF/voice message] bheja hai."

3. MULTIPLE MESSAGES FROM SAME SENDER (COUNT > 1):
   - First tell the count and what was sent:
     "Boss, [Name] ne [X] messages bheje hain — [description e.g. '3 text messages aur ek photo']. Last message: '[last_msg]'. Kya main shuruaat se padhu ya last message se?"
   - Wait for DK's reply:
     * "last wala" / "last se" / "end" → re-call tool with limit=1 for that sender (already have it in LAST_MSG field)
     * "shuruaat se" / "pehle wala" / "start" → re-call tool with limit=[count] for sender, read from oldest
     * "sab padh" / "sab bata" → read all messages in order

4. MULTIPLE SENDERS:
   First summarize all: "Boss, [X] logon ke messages hain: [Name1] ne [Y] msg bheje, [Name2] ne [Z] msg bheja." Then ask: "Kiska padhun pehle?"

5. MEDIA TYPES — say clearly:
   [Image] → "photo bheja"
   [Video] → "video bheja"
   [Voice Message] → "voice message bheja"
   [Document] / PDF → "PDF bheja" or "document bheja"
   [Sticker] → "sticker bheja"
   [Location] → "apni location share ki"

6. NO MESSAGES: "Koi naya WhatsApp message nahi hai, DK."

7. REMEMBERING THE SENDER'S NUMBER FOR A FOLLOW-UP REPLY (CRITICAL):
   - Every message returned by 'get_whatsapp_messages' includes a "senderPhone" field. You MUST keep this number in mind for the rest of the conversation after you read that message aloud — even if you don't repeat every digit to DK.
   - If DK then says anything that refers back to that sender without naming them explicitly — e.g. "isi ko reply karo", "usi unknown number pe bhej do", "ussi ko bol do main busy hoon", "wapas usko message karo" — you MUST call 'send_whatsapp_to_contact' with contactNameOrPhone set to that exact "senderPhone" value from the most recently read message (prefixed with the country code digits exactly as given, no spaces or symbols).
   - NEVER call 'send_whatsapp_to_contact' with a vague or made-up value like "unknown" or the sender's display name when the target is an unsaved/unknown contact — it must be the real senderPhone digits, or the send will fail.
   - If more than one unknown sender was read in the same conversation, use the number from the one DK most recently referred to or asked about — if genuinely ambiguous, ask DK to confirm which person before sending.

8. VOICE OUTPUT MANDATORY:
   - When 'get_whatsapp_messages' returns results, you MUST speak your reply out loud in voice immediately. Never return an empty voice turn or text-only reply.`;
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
          description: "Read WhatsApp messages received on Friday's linked number. Use when DK asks about messages, notifications, or what someone sent — e.g. 'koi message hai?', 'Rahul ne kya likha?', '5 din pehle kya msg tha?'. Can filter by personal/group, sender name, group name, and date.",
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
            newSession.close().catch(() => {});
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
