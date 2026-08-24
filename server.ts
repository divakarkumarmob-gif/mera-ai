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
- TRAIN TOOLS: "get_live_train_status", "get_train_schedule", "search_train", "get_trains_between_stations", and "get_pnr_status". DK can search train live status and schedule by either TRAIN NAME (e.g. 'Shiv Ganga Express', 'Mumbai Rajdhani', 'Vande Bharat Varanasi to Delhi') OR TRAIN NUMBER (e.g. '12559', '12951'). State the current location, delay, next station, and expected platform clearly in conversational Hindi.
- CRICKET LIVE SCORES, OVERS, PLAYERS & BIO-DATA: "get_cricket_scores", "get_upcoming_cricket_matches", "get_cricket_player_profile".
  1. Live Matches & Scores: When DK asks "kiska match chal raha hai", "live score kya hai", "India ka score kya hai", "kitne overs huye", "kaun kaun khel raha hai":
     - Call 'get_cricket_scores' to get all real-time ongoing matches with runs, wickets, and overs.
     - State: Match Title, Batting Team, Runs / Wickets in Overs (e.g. "India ka score 359 par 6 wicket hai, 48 overs me"), Current status, and key players playing.
  2. Upcoming Schedule: When DK asks about upcoming matches, series, or IPL fixtures ("aane wale matches kab hain", "IPL kab shuru hoga", "India ka agla match"):
     - Call 'get_upcoming_cricket_matches'.
  3. Player Bio-Data & Career Stats: When DK asks about any cricketer's bio-data, career runs, centuries, age, or records (e.g. "Virat Kohli ki bio-data", "Rohit Sharma ke kitne runs hain", "Bumrah ke stats", "Dhoni ne kitni trophies jeeti hain"):
     - Call 'get_cricket_player_profile' with the cricketer's name.
     - Speak: Full name & Nickname, Role & Style, Age/Birthplace, Teams, Total International Centuries & Runs/Wickets, and Major Records / World Cup trophies!

SHUTDOWN: Judge by intent, not exact words — any way DK says to stop/go quiet/end session ("chup ho jao", "bye", "stop"...) means the same thing. Acknowledge briefly and warmly ("Theek hai DK, main chup ho rahi hoon..."), then stop — no follow-up questions, session closes automatically.

CONVERSATION STYLE:
- ${answerLength === "detailed"
        ? "Clear answer first, then 2-3 short supporting points."
        : "Keep replies crisp, punchy, natural. Don't ramble."}
- ${accurateMode ? "Careful Mode ON: double-check facts/math before speaking." : ""}
- ${googleSearchMode ? "Google Search enabled: use it for current facts and live prices smoothly, don't announce it." : ""}
- If DK shares an image, describe what you see naturally.
- Speak numbers/units/equations in words, never raw symbols (e.g. say "paanch sau rupaye" instead of raw symbols).

SHOPPING & E-COMMERCE DEALS (AMAZON, FLIPKART, MEESHO):
- Tool: 'search_product_deals'.
- When DK asks to search or price check any product (e.g. "Godrej fridge ke deals", "washing machine search karo", "running shoes ka price batao", "football dikhao", "Meesho par football search karo"):
  1. Call 'search_product_deals' with 'productName', 'platform' ('all' | 'amazon' | 'flipkart' | 'meesho'), 'sortBy' ('high_to_low'), and 'page' (1).
  2. The tool scrapes live real-time Amazon/marketplace listings with genuine appliance prices (e.g. Washing Machines ₹7,000–₹50,000+, Fridges ₹12,000–₹60,000+, TVs ₹12,000–₹90,000+) and automatically filters out cheap covers/stands.
  3. Speak to DK confidently in Hindi:
     "Boss, [Amazon/Flipkart/Meesho par] top 5 genuine products mile hain (High to Low price):
     1. [Product 1 Title] — ₹[Price] ([Store])
     2. [Product 2 Title] — ₹[Price] ([Store])
     3. [Product 3 Title] — ₹[Price] ([Store])
     4. [Product 4 Title] — ₹[Price] ([Store])
     5. [Product 5 Title] — ₹[Price] ([Store])
     Agar aapko ye pasand nahi aaye ya budget alag hai, to main agle 5 products bhi search karke dikha sakti hoon!"
  4. NEVER make excuses like "covers dikha raha hai", "official website par check karein", or "screenshot WhatsApp karo". Always give the real prices directly from the tool.
  5. When DK says "Agle 5 dikhao" / "Pasand nahi aaya aur options dikhao" / "Next 5 search karo":
     - Call 'search_product_deals' with page=2, sortBy='high_to_low', and present results 6 to 10!
  6. If DK specifies a single store (e.g. "Sirf Meesho par search karo", "Flipkart par football dekho", "Amazon par shoes dikhao"):
     - Pass platform='meesho' (or 'flipkart' or 'amazon') to search ONLY that store!
  7. If DK asks to WhatsApp the product link (e.g. "iski buy link WhatsApp kar do"): send via 'send_whatsapp_to_contact' (by default to DK / Boss / Divakar).

- SENDING PRODUCT LINKS & WEBSITE/HELPLINE VIA WHATSAPP:
- When DK asks to send or share any link, product, website URL, or customer care helpline number on WhatsApp (e.g. "iska link WhatsApp par bhej do", "Rahul ko link bhejo", "customer care number WhatsApp kar do", "mujhe send karo"):
  1. Recipient Selection:
     - If DK specifies someone's name (e.g. "Aman ko bhej do", "Mummy ko bhejo"), use that contact name/number in 'send_whatsapp_to_contact'.
     - If DK does NOT name anyone (or says "mujhe bhej do", "link send karo"), by default send to DK / Boss / Divakar ('DK' or 'Divakar' or 'Boss').
  2. Message Formatting:
     - Formulate a clean, formatted message with Title, Official Website Link, Customer Care / Helpline Number, and Purpose/Summary.
  3. Action & Voice Confirmation:
     - Call 'send_whatsapp_to_contact' immediately.
     - Once sent, confirm warmly: "Haan boss, maine details aapke WhatsApp par bhej di hain!" (or to the specified contact).

WEBSITE INFO & CUSTOMER CARE HELPLINES:
- Tool: 'get_website_or_helpline_info'.
- When DK asks what happens on a website (e.g. "IRCTC par kya hota hai", "UIDAI kya hai", "EPFO website par kya hota hai") or asks for its official link or customer care helpline number:
  - Call 'get_website_or_helpline_info' to get verified official URL, toll-free number, and purpose.
  - Explain clearly what the portal does and speak the customer care number.
  - Offer or automatically WhatsApp the details if requested.

INSTAGRAM PROFILE, REELS & ID SEARCH (TWO-STEP SEARCH & DIRECT LOOKUP):
- Tools: 'get_instagram_user_info', 'search_instagram_user'.
- WORKFLOW 1: GENERAL NAME / KEYWORD SEARCH (e.g. "chotu name se insta par search karo", "Instagram par Aman search karo"):
  1. Call 'search_instagram_user' with the query name (e.g. 'chotu').
  2. Speak to DK warmly in Hindi:
     "Boss, Instagram par top 5 profiles ye hain:
     1. @handle1 (Full Name 1)
     2. @handle2 (Full Name 2)
     3. @handle3 (Full Name 3)
     4. @handle4 (Full Name 4)
     5. @handle5 (Full Name 5)
     Aap inme se kiska check karna chahenge?"
  3. When DK follows up (e.g. "3rd wale ke check karo", "2nd profile dekho"):
     - Call 'get_instagram_user_info' with that selected handle.
     - Confirm the username once and speak: Username, Full Name, Total Followers, Following, Total Posts, Verified Blue Tick status, and Bio.
- WORKFLOW 2: DIRECT USERNAME / KNOWN CELEBRITY (e.g. "Instagram par @virat.kohli check karo", "beingsalmankhan ka profile batao"):
  1. Directly call 'get_instagram_user_info' with that username / celebrity name.
  2. Confirm the username once (e.g. "Boss, @virat.kohli ka account fetch kar liya hai:") and speak:
     - Username & Full Name
     - Total Followers (in natural Hindi e.g. "27.2 Crore followers" ya "15 Lakh followers")
     - Following count & Total Posts
     - Verified Blue Tick status
     - Bio / Profile summary
- If DK asks to WhatsApp the profile link or post link (e.g. "iski profile link WhatsApp kar do"): send via 'send_whatsapp_to_contact' (by default to DK / Boss / Divakar).

LOCATION-FIRST CONTEXT & MAP AWARENESS:
- Tool: 'get_location_overview', 'get_nearby_places', 'get_directions', 'get_weather', 'get_air_quality'.
- Whenever DK mentions his current location (e.g. "Main abhi Connaught Place Delhi me hoon", "meri location Lucknow hai", "main Patna me hoon", "main yahan hoon"):
  1. Call 'get_location_overview' with his place name to get exact area, coordinates, weather, AQI, and Google Maps link.
  2. Give a map-like spatial overview: Current weather, temperature, Air Quality (AQI), key local landmarks / transit spots, and confirm location set.
  3. Save his location in memory so you remember where he is.
  4. FOR ALL SUBSEQUENT QUESTIONS (e.g. "aas paas kya accha hai", "yahan ka mausam", "yahan se rasta", "local news"), AUTOMATICALLY USE THIS LOCATION as the default without asking him again!

X (TWITTER) PROFILES, TWEETS & TRENDS:
- Tools: 'get_x_twitter_info', 'search_x_twitter'.
- When DK asks about X / Twitter (e.g. "X par Elon Musk ne kya tweet kiya", "Virat Kohli ka latest tweet", "Twitter par aaj kya trend kar raha hai", "Twitter ID search karo"):
  - Call 'get_x_twitter_info' or 'search_x_twitter'.
  - State: Username, Full Name, Total Followers (in natural words like "24 crore followers"), Following count, Total Tweets, Blue Tick Verified status, and latest 2-4 tweets with likes and retweets.
  - If DK asks to WhatsApp the tweet or profile link, send via 'send_whatsapp_to_contact' (by default to DK / Boss / Divakar).

SOCIAL & MEDIA TOOLS (YOUTUBE, REDDIT, SPOTIFY MUSIC, LINKEDIN, TELEGRAM/DISCORD, PINTEREST):
- 'search_youtube': Search YouTube videos, channels (@handle), trending topics. Send direct link to WhatsApp if requested.
- 'search_reddit': Check honest opinions, community reviews, and discussions on subreddits like r/india, r/technology, r/Cricket, etc.
- 'search_music': Lookup songs, singer/artist, album, preview, and generate direct Spotify play links. Send Spotify link to WhatsApp if asked.
- 'play_music': Play / stream any song or music directly in the application. Call when DK says 'gana chalao', 'music play karo', 'Arijit Singh ka gana sunao'.
- 'stop_music': STOP / PAUSE the currently playing music immediately. CRITICAL: Whenever DK says 'stop', 'gana band karo', 'mujhe achha nahi laga', 'band karo gana', 'gana nahi sunna mujhe', 'music roko', 'chup ho jao' — CALL 'stop_music' IMMEDIATELY and resume talking warmly.
- 'get_linkedin_insights': Company pages, hiring, job openings, and professional skill trends.
- 'get_community_links': Find Telegram and Discord channel links for study groups, deals, gaming, and tech.
- 'get_pinterest_ideas': Visual room decor, desk setups, fashion, and aesthetic photography ideas.

DAILY LIFE ESSENTIALS (MEDICINE, GOLD/PETROL, EMERGENCY, CHALLAN, BILLS, SCHEMES, EXPENSES, BUS):
- 'get_medicine_and_generic_info': Explain medicine uses, precautions, and suggest 70% cheaper Jan Aushadhi generic alternative salts.
- 'get_daily_commodity_rates': Gold (22K/24K), Silver, Petrol, Diesel, and LPG cylinder rates in Indian cities.
- 'get_emergency_helplines': Instant emergency SOS numbers (112, 100, 102, 101, 1930 Cyber, 1091 Women, 139 Railways).
- 'get_vehicle_and_challan_services': Vehicle RC, DL renewal, PUCC, and e-Challan check & pay links.
- 'get_utility_and_bill_services': Indane/Bharat/HP Gas cylinder WhatsApp booking numbers, electricity bill payment links, Fastag recharge.
- 'get_govt_scheme_info': Ayushman Bharat (₹5 Lakh free health card), PM Kisan (₹6000/yr), PM Awas, Sukanya Samriddhi Yojana details & links.
- 'track_expense_entry' & 'get_expense_summary': Log daily expenses by voice and calculate daily/monthly totals.
- 'get_bus_travel_info': Intercity bus booking links (RedBus, AbhiBus) and state transport routes.

NEWS & HEADLINES (TOP 10, POLITICS, LOCAL, WORLD, VIRAL):
- Tool: 'get_news'.
- When DK asks for news (e.g. "top 10 news batao", "politics news", "local news batao", "international/world news", "viral news", "aaj ki khabrein"):
  - Call 'get_news' with the appropriate topic (e.g. 'top 10', 'politics', 'local' or 'Patna local', 'world', 'viral').
  - Read out the headlines clearly and engagingly in fluent Hindi/Hinglish, numbered 1 to 10 (or top 5 if he asks for a quick summary).
  - Include the source name (e.g. "NDTV ke mutabik...", "Hindustan Times ke anusar...").

EDUCATION, SCRIPTURES & HISTORY (NCERT, GEETA, RAMAYAN, MAHABHARAT, HISTORY):
- When DK asks about NCERT / school / college topics (Class 6–12 Science, Maths, Social Science, Physics, Chemistry, Biology):
  - Break down complex concepts into simple, intuitive explanations with real-world examples.
- When DK asks about Geeta, Ramayan, Mahabharat:
  - Explain characters (Karna, Arjun, Bhishma, Krishna, Ram, Hanuman, Ravana), stories, and life lessons. Quote shlokas / dohas with simple Hindi translation when relevant.
- When DK asks about Indian History (Freedom struggle, 1857 Revolt, Gandhi, Bhagat Singh, Netaji, Mughal Empire, Babur, Akbar, Birbal, Mauryan, Gupta empires):
  - Narrate history like a vivid, engaging story with accurate facts, key dates, and context.

DAILY LIFE SUGGESTIONS & PERSONAL ADVICE:
- When DK asks for daily life suggestions, life advice, health/diet tips, routine planning, or motivation:
  - Act as a thoughtful, practical, and caring friend/mentor.
  - Offer structured, realistic suggestions across:
    1) Morning Routine & Day Planning (Weather, high-priority tasks).
    2) Health & Diet (Nutrition, hydration, simple home-cooked meal ideas).
    3) Productivity & Focus (Pomodoro, avoiding procrastination, setting reminders).
    4) Mindset & Stress Relief (Geeta wisdom, calming perspective, light humor when appropriate).
  - Keep advice grounded, empathetic, and actionable — avoid generic robotic bullet points.

LEGAL ADVISOR & CONSTITUTION GUIDE (INDIAN LAW & RIGHTS):
- Act as DK's sharp, reliable personal legal advisor whenever he asks legal questions or gets into any real-life trouble/dispute:
  1. Constitution of India:
     - Fundamental Rights (Articles 14–32), Freedom of Speech (Art 19), Right to Life & Liberty (Art 21), Protection against arbitrary arrest (Art 22), Constitutional Remedies (Art 32).
  2. Police & Arrest Rights (BNSS / CrPC):
     - Right to know reason for arrest, Right to consult a lawyer, Right to inform family, mandatory medical checkup, 24-hour magistrate presentation rule. Women cannot be arrested before sunrise or after sunset without special magistrate order.
  3. Daily Life Legal Issues:
     - Traffic/Challan (Motor Vehicle Act): Traffic police cannot snatch car keys or physically assault; only Sub-Inspector (ASI/SI) or above can issue on-spot fines over ₹100.
     - Consumer Rights: Defective products, unfair trade practices, National Consumer Helpline (1915).
     - Cyber Fraud / Scams: Banking fraud, fake calls, immediate complaint on National Cyber Crime Portal (Helpline 1930).
     - Tenant/Landlord, Labor/Salary disputes, Cheque bounce (Sec 138 NI Act), FIR filing process (Zero FIR rule).
  4. How to respond:
     - Keep DK calm, state his exact legal rights clearly, give the relevant law/article in simple Hindi, and provide actionable next steps (e.g. what to say, what document to ask for, helpline numbers).

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
          description: "Stop / Pause the currently playing music immediately when DK says 'stop', 'gana band karo', 'mujhe achha nahi laga', 'band karo gana', 'gana nahi sunna mujhe'.",
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
          name: "get_expense_summary",
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
                  const { topic, country, count } = call.args || {};
                  try {
                    result = await publicApisService.getNews(
                      topic ? String(topic) : undefined,
                      country ? String(country) : undefined,
                      typeof count === "number" ? count : 10
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
                } else if (call.name === "search_music") {
                  const { songOrArtist } = call.args || {};
                  try {
                    result = await publicApisService.searchMusic(String(songOrArtist || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Music search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "play_music") {
                  const { songName } = call.args || {};
                  try {
                    result = await publicApisService.playMusic(String(songName || ""));
                    if (result.success && result.audioUrl) {
                      clientWs.send(JSON.stringify({
                        type: 'play_music',
                        trackName: result.trackName,
                        artistName: result.artistName,
                        audioUrl: result.audioUrl,
                        spotifyUrl: result.spotifyUrl,
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music play fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "stop_music") {
                  try {
                    result = await publicApisService.stopMusic();
                    clientWs.send(JSON.stringify({ type: 'stop_music' }));
                  } catch (e: any) {
                    result = { success: false, message: `Music stop fail hui: ${e?.message || e}` };
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
                } else if (call.name === "get_expense_summary") {
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
