import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { visionMemoryService } from "./visionMemoryService";
import { voiceBiometricsService } from "./voiceBiometricsService";
import { codeAgentService } from "./codeAgentService";
import { dailyUpdateService } from "./dailyUpdateService";
import { publicApisService } from "./publicApisService";
import { voiceBridgeService, VoiceBridgeService } from "./voiceBridgeService";

export interface TelegramStatus {
  isConfigured: boolean;
  botUsername: string | null;
  pollingActive: boolean;
  lastActive: number | null;
}

export interface TelegramUserProfile {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  lastSeenAt: number;
}

class TelegramBotService {
  private token: string = "";
  private botUsername: string | null = null;
  private isPolling: boolean = false;
  private pollingAbortController: AbortController | null = null;
  private offset: number = 0;
  private lastActive: number | null = null;
  private messageCallback: ((msg: { sender: string; text: string; time: string; chatId: number }) => void) | null = null;

  // Multi-tier model fallback chain
  private static readonly MODEL_FALLBACK_CHAIN = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
    "gemini-2.5-flash",
  ];

  constructor() {
    this.token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  }

  public get isConfigured(): boolean {
    return !!this.token && this.token.length > 15;
  }

  public getStatus(): TelegramStatus {
    return {
      isConfigured: this.isConfigured,
      botUsername: this.botUsername,
      pollingActive: this.isPolling,
      lastActive: this.lastActive,
    };
  }

  public setMessageCallback(cb: (msg: { sender: string; text: string; time: string; chatId: number }) => void) {
    this.messageCallback = cb;
  }

  private async callApi(method: string, body?: any): Promise<any> {
    if (!this.token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.description || `Telegram API ${method} failed`);
    }
    return json.result;
  }

  /**
   * Initializes the Telegram Bot and starts long-polling for messages.
   */
  public async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log("[TelegramBot] TELEGRAM_BOT_TOKEN not provided, bot is disabled.");
      return;
    }

    try {
      const me = await this.callApi("getMe");
      this.botUsername = me.username;
      console.log(`[TelegramBot] Connected as @${this.botUsername} (ID: ${me.id})`);
      this.startPolling();
    } catch (e: any) {
      console.error("[TelegramBot] Failed to connect to Telegram API:", e?.message || e);
    }
  }

  public stop(): void {
    if (this.pollingAbortController) {
      this.pollingAbortController.abort();
      this.pollingAbortController = null;
    }
    this.isPolling = false;
    console.log("[TelegramBot] Polling stopped.");
  }

  /**
   * Sends a text message to a Telegram chat.
   */
  public async sendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: any
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    try {
      const result = await this.callApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return { success: true, messageId: result.message_id };
    } catch (e: any) {
      console.error(`[TelegramBot] Send failed to ${chatId}:`, e?.message);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * Sends a real Voice Note (.ogg / .mp3) to a Telegram chat.
   */
  public async sendVoice(
    chatId: number | string,
    audioBuffer: Buffer,
    caption?: string
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    if (!this.token) return { success: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendVoice`;
      const formData = new FormData();
      formData.append("chat_id", String(chatId));
      const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
      formData.append("voice", blob, "voice.mp3");
      if (caption) formData.append("caption", caption);

      const res = await fetch(url, { method: "POST", body: formData });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.description || "sendVoice API failed");
      }
      return { success: true, messageId: json.result.message_id };
    } catch (e: any) {
      console.error(`[TelegramBot] sendVoice failed to ${chatId}:`, e?.message);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * Sends an Audio file (.mp3) to a Telegram chat.
   */
  public async sendAudio(
    chatId: number | string,
    audioBuffer: Buffer,
    title: string = "Voice Note",
    caption?: string
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    if (!this.token) return { success: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendAudio`;
      const formData = new FormData();
      formData.append("chat_id", String(chatId));
      const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
      formData.append("audio", blob, `${title}.mp3`);
      formData.append("title", title);
      formData.append("performer", "Friday AI");
      if (caption) formData.append("caption", caption);

      const res = await fetch(url, { method: "POST", body: formData });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.description || "sendAudio API failed");
      }
      return { success: true, messageId: json.result.message_id };
    } catch (e: any) {
      console.error(`[TelegramBot] sendAudio failed to ${chatId}:`, e?.message);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * Saves or updates a Telegram user's profile in Firestore.
   */
  public async saveTelegramUser(chatId: number, from: any): Promise<void> {
    try {
      const fullName = `${from.first_name || ""} ${from.last_name || ""}`.trim() || "Telegram User";
      const profile: TelegramUserProfile = {
        chatId,
        username: from.username ? from.username.toLowerCase() : undefined,
        firstName: from.first_name || "",
        lastName: from.last_name || "",
        fullName,
        lastSeenAt: Date.now(),
      };
      await db.collection("telegramUsers").doc(String(chatId)).set(profile, { merge: true });
    } catch (e) {
      console.warn("[TelegramBot] Failed to save telegram user:", e);
    }
  }

  /**
   * Resolves a recipient (Contact name, username, or Chat ID) to a numeric Telegram Chat ID.
   */
  public async resolveTargetChatId(target: string): Promise<{ chatId?: number; name?: string; error?: string }> {
    const raw = String(target || "").trim();
    if (!raw) return { error: "Recipient name ya ID required hai." };

    // 1. If raw is a numeric Chat ID
    if (/^\d{5,15}$/.test(raw)) {
      return { chatId: Number(raw), name: `User (${raw})` };
    }

    const clean = raw.replace(/^@/, "").toLowerCase().trim();

    try {
      // 2. Search in Firestore telegramUsers collection
      const snap = await db.collection("telegramUsers").get();
      const users = snap.docs.map((d) => d.data() as TelegramUserProfile);

      // Exact username match
      const byUsername = users.find((u) => u.username && u.username.toLowerCase() === clean);
      if (byUsername) return { chatId: byUsername.chatId, name: byUsername.fullName || byUsername.username };

      // Exact or fuzzy full name / first name match
      const byName = users.find(
        (u) =>
          u.fullName.toLowerCase().includes(clean) ||
          (u.firstName && u.firstName.toLowerCase().includes(clean))
      );
      if (byName) return { chatId: byName.chatId, name: byName.fullName };

      // 3. Search in contactsService
      const allContacts = await contactsService.getAllContacts();
      const matchedContact = allContacts.find((c) =>
        c.name.toLowerCase().includes(clean)
      );

      if (matchedContact) {
        // Check if any telegram user has phone matching contact phone
        const contactDigits = matchedContact.phone.replace(/\D/g, "");
        const userByPhone = users.find((u) => {
          const uDigits = String(u.chatId);
          return uDigits === contactDigits || (u.username && u.username.toLowerCase() === clean);
        });
        if (userByPhone) return { chatId: userByPhone.chatId, name: matchedContact.name };
      }
    } catch (e) {
      console.warn("[TelegramBot] Error resolving contact:", e);
    }

    return {
      error: `Boss, '${target}' ka Telegram Chat ID nahi mila. Unhone abhi tak bot (@${this.botUsername || "FridayAIBot"}) ko start nahi kiya hai ya unka username save nahi hai.`,
    };
  }

  /**
   * Sends a Telegram message to anyone (Contact name, username, or Chat ID).
   */
  public async sendMessageToTarget(
    target: string,
    message: string
  ): Promise<{ success: boolean; message: string; resolvedName?: string }> {
    const res = await this.resolveTargetChatId(target);
    if (!res.chatId) {
      return {
        success: false,
        message: res.error || `Could not find Telegram user "${target}".`,
      };
    }

    const sendRes = await this.sendMessage(res.chatId, message);
    if (sendRes.success) {
      return {
        success: true,
        resolvedName: res.name,
        message: `Boss, Telegram par ${res.name || target} ko message bhej diya gaya hai: "${message}" ✅`,
      };
    } else {
      return {
        success: false,
        message: `Telegram send failed: ${sendRes.error}`,
      };
    }
  }

  /**
   * Downloads a Telegram media file (photo/document) into a Buffer.
   */
  private async downloadFile(fileId: string): Promise<{ buffer: Buffer; filePath: string }> {
    const fileInfo = await this.callApi("getFile", { file_id: fileId });
    const filePath = fileInfo.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const res = await fetch(fileUrl);
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), filePath };
  }

  /**
   * Sends chat action (e.g. 'typing...') to make interactions feel human and lively.
   */
  public async sendChatAction(chatId: number | string, action: string = "typing"): Promise<void> {
    try {
      await this.callApi("sendChatAction", { chat_id: chatId, action });
    } catch {
      // ignore
    }
  }

  /**
   * Sends a message with realistic 'typing...' presence and natural typing duration.
   */
  public async sendHumanLikeMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: any
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    await this.sendChatAction(chatId, "typing");
    const delayMs = Math.min(3000, Math.max(1200, text.length * 30));
    await new Promise((r) => setTimeout(r, delayMs));
    return this.sendMessage(chatId, text, replyMarkup);
  }

  /**
   * Generates a conversational AI reply using a multi-tier Gemini model fallback chain.
   * Matches WhatsApp auto-reply behavior: identifies as DK's AI, explains DK is busy, takes notes.
   */
  private async generateSmartAiReply(senderName: string, messageText: string, isOwner: boolean = false): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return `Haanji ${senderName} ji! Main Friday hoon — DK Boss (Divakar Kumar) ka AI assistant. Boss abhi busy hain, jaise hi aayenge main unko aapka message bol dungi 👍`;
    }

    // 1. Try factual answer from today's daily update first (if not owner)
    if (!isOwner) {
      try {
        const updateAnswer = await dailyUpdateService.answerFromTodayUpdate(messageText);
        if (updateAnswer) {
          return `${senderName} ji, ${updateAnswer}`;
        }
      } catch (e) {
        // continue
      }
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, loyal, warm, human-like AI companion.

CHAT CONTEXT:
Sender: "${senderName}"
Is Sender Boss (DK)?: ${isOwner ? "YES (Talk directly to Boss with affection/respect)" : "NO (This is someone messaging DK/Friday on Telegram)"}
Message Received: "${messageText}"

INSTRUCTIONS FOR WHEN SENDER IS SOMEONE ELSE (NOT DK):
1. IDENTITY & CREATOR:
   - If they ask who you are, your name, who made you, or whose bot/number this is:
     Reply: "Haanji! Main Friday hoon — DK Boss (Divakar Kumar) ka personal AI assistant. DK abhi thode busy hain. Aap bataiye, aapko kya kaam hai ya kya janna hai?"
2. STATUS & BOSS BUSY:
   - For general messages, greetings, or inquiries:
     Politely clarify that DK is currently busy/occupied, but you are taking notes and will pass their message to DK as soon as he is free.
3. PASSING MESSAGES:
   - If they leave a message, ask a question, or ask for a callback:
     Assure them: "Maine aapka message note kar liya hai, jaise hi DK aayenge main unko bol dungi aur wo reply kar denge."
4. PRIVACY GUARD (STRICT):
   - Never disclose confidential private details (DK's personal passwords, bank/financial info, private residence, secrets).
   - Politely refuse: "Yeh personal jaankari main share nahi kar sakti. Iska jawab sirf DK boss hi de sakte hain."
5. TONE & STYLE:
   - Fluent, natural Hindi/Hinglish (mix of Hindi and English).
   - Warm, respectful, crisp (1-3 short sentences).
   - Return ONLY the exact text to send on Telegram without markdown headers.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of TelegramBotService.MODEL_FALLBACK_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
          }),
          7000
        );
        const reply = response.text?.trim();
        if (reply) {
          console.log(`[TelegramBot] Reply generated using ${model}`);
          return reply;
        }
      } catch (err: any) {
        console.warn(`[TelegramBot] ${model} failed (${err?.message || err}), falling back to next model...`);
      }
    }

    return `Haanji ${senderName} ji! Main Friday hoon — DK Boss abhi busy hain, jaise hi wo aayenge main aapka message unko bata dungi 👍`;
  }

  /**
   * Long-polling loop to receive and handle updates from Telegram.
   */
  private async startPolling(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollingAbortController = new AbortController();

    console.log("[TelegramBot] Starting long-polling loop...");

    while (this.isPolling) {
      try {
        const updates = await this.callApi("getUpdates", {
          offset: this.offset,
          timeout: 20,
          allowed_updates: ["message", "callback_query"],
        });

        if (Array.isArray(updates) && updates.length > 0) {
          for (const update of updates) {
            this.offset = update.update_id + 1;
            this.handleUpdate(update).catch((err) =>
              console.error("[TelegramBot] Update handler error:", err)
            );
          }
        }
      } catch (e: any) {
        if (!this.isPolling) break;
        console.warn("[TelegramBot] Polling error, retrying in 4s:", e?.message || e);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  /**
   * Dispatches and processes an incoming Telegram update.
   */
  private async handleUpdate(update: any): Promise<void> {
    this.lastActive = Date.now();

    // 1. Handle Inline Keyboard Button Clicks (Coding Agent Approve/Deny)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const from = msg.from || {};
    const senderName = from.first_name ? `${from.first_name} ${from.last_name || ""}`.trim() : "Boss";
    const text = (msg.text || msg.caption || "").trim();

    // Save/Update user profile in Firestore for future targeted messaging
    if (chatId) {
      this.saveTelegramUser(chatId, from).catch(() => {});
    }

    // Broadcast incoming message to Live UI
    if (this.messageCallback && chatId) {
      this.messageCallback({
        sender: `✈️ ${senderName}`,
        text: text || (msg.photo ? "📷 [Photo]" : msg.document ? "📄 [Document]" : "[Media]"),
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
        chatId,
      });
    }

    // 2. Handle /start, "start bot", and greeting commands
    if (
      text === "/start" ||
      text === "/help" ||
      /^(\/start@|start\s*bot|hi\s*friday|hello\s*friday)/i.test(text)
    ) {
      const isGroup = msg.chat?.type === "group" || msg.chat?.type === "supergroup";
      if (isGroup) {
        const welcomeGroup = `👋 *Namaste! Main Friday hoon — DK Boss (Divakar Kumar) ka AI Assistant.* 🚀⚡\n\nKripya neeche se option choose karein:`;
        await this.sendMessage(chatId, welcomeGroup, {
          inline_keyboard: [
            [
              { text: "💬 Personal Chat", callback_data: `mode_personal_${chatId}` },
              { text: "👥 Group Voice Bridge Call", callback_data: `mode_group_bridge_${chatId}` },
            ],
          ],
        });
        return;
      }

      const welcome = `👋 *Namaste ${senderName}! Main Friday AI Assistant hoon.* 🚀⚡

Kripya neeche se mode choose karein ya direct message type karein:`;
      await this.sendMessage(chatId, welcome, {
        inline_keyboard: [
          [
            { text: "💬 Personal Chat", callback_data: `mode_personal_${chatId}` },
            { text: "👥 Group Voice Bridge Call", callback_data: `mode_group_bridge_${chatId}` },
          ],
        ],
      });
      return;
    }

    // 2.01 Handle Group Textual Role Setup: "User A @username" / "User B @username"
    const isGroupChat = msg.chat?.type === "group" || msg.chat?.type === "supergroup";
    if (isGroupChat) {
      // Setup User A: e.g. "User A @username" or "User A 12345"
      const matchUserA = text.match(/^(?:user\s*a|set\s*user\s*a)\s*[:=-]?\s*(.+)/i);
      if (matchUserA) {
        const rawTarget = matchUserA[1].trim();
        const resolved = await this.resolveTargetChatId(rawTarget);
        const targetId = resolved.chatId || from.id;
        const targetName = resolved.name || rawTarget;

        voiceBridgeService.setUserAInGroup(chatId, targetId, targetName);
        await this.sendMessage(
          chatId,
          `✅ *User A (Text Mode User) Set:* **${targetName}** (ID: \`${targetId}\`)\n\n• _User A text likhega to direct voice note bankar User B ko sunai dega._\n\n👉 Ab User B set karein: \`User B @username\``,
          this.getGroupControlPanelMarkup(chatId)
        );
        return;
      }

      // Setup User B: e.g. "User B @username" or "User B 12345"
      const matchUserB = text.match(/^(?:user\s*b|set\s*user\s*b)\s*[:=-]?\s*(.+)/i);
      if (matchUserB) {
        const rawTarget = matchUserB[1].trim();
        const resolved = await this.resolveTargetChatId(rawTarget);
        const targetId = resolved.chatId || from.id;
        const targetName = resolved.name || rawTarget;

        voiceBridgeService.setUserBInGroup(chatId, targetId, targetName);
        await this.sendMessage(
          chatId,
          `✅ *User B (Voice Mode User) Set:* **${targetName}** (ID: \`${targetId}\`)\n\n• _User B voice note bolega to uska transcribed text User A ko milega._\n\n👉 Call start karne ke liye likhein: \`Start Call\` ya neeche button dabayein!`,
          this.getGroupControlPanelMarkup(chatId)
        );
        return;
      }

      // Group Call Actions via text
      if (/^(start\s*call|start\s*bridge|\/call\s*start)/i.test(text)) {
        const res = voiceBridgeService.startGroupCall(chatId);
        if (!res.success) {
          await this.sendMessage(chatId, `⚠️ ${res.error}`, this.getGroupControlPanelMarkup(chatId));
        } else {
          await this.sendMessage(
            chatId,
            `🚀 *LIVE GROUP CALL BRIDGE STARTED!* ⚡📞\n\n• ✍️ *User A (${res.session?.userA_name}):* Ab normal text likhiye — Friday voice me bolegi!\n• 🎙️ *User B (${res.session?.userB_name}):* Ab Voice Notes bhejiye — Friday text me transcribe karegi!\n\n_Call controls live below:_`,
            this.getGroupControlPanelMarkup(chatId)
          );
        }
        return;
      }

      if (/^(end\s*call|stop\s*call|end\s*bridge|stop\s*bridge|\/call\s*stop)/i.test(text)) {
        voiceBridgeService.endGroupCall(chatId);
        await this.sendMessage(
          chatId,
          `🔴 *Group Live Call Bridge Ended.* Call successfully disconnect ho gayi hai. ✨`,
          this.getGroupControlPanelMarkup(chatId)
        );
        return;
      }

      if (/^(mute\s*call|mute\s*bot|\/mute)/i.test(text)) {
        voiceBridgeService.toggleMuteGroupCall(chatId);
        await this.sendMessage(
          chatId,
          `🔇 *Friday Bot is now MUTED in this group call.*`,
          this.getGroupControlPanelMarkup(chatId)
        );
        return;
      }

      if (/^(unmute\s*call|unmute\s*bot|\/unmute)/i.test(text)) {
        const res = voiceBridgeService.initOrGetGroupSession(chatId);
        res.isMuted = false;
        await this.sendMessage(
          chatId,
          `🔊 *Friday Bot is now UNMUTED in this group call.*`,
          this.getGroupControlPanelMarkup(chatId)
        );
        return;
      }
    }

    // 2.1 Handle "send chat id" / "my chat id" / "/id" request
    if (/^(send\s*chat\s*id|chat\s*id|my\s*chat\s*id|my\s*id|send\s*id|\/id|\/chatid|mera\s*chat\s*id)/i.test(text)) {
      const idReply = `🆔 *Aapka Telegram Chat ID hai:*\n\`${chatId}\`\n\n📌 *Details:*\n• Name: *${senderName}*\n• Username: *${from.username ? `@${from.username}` : "Not set"}*\n\n_(Aap is Chat ID ko copy karke apne .env me \`TELEGRAM_OWNER_CHAT_ID=${chatId}\` set kar sakte hain)_ ✨`;
      await this.sendMessage(chatId, idReply);
      return;
    }

    // 2.2 Handle Voice Bridge Commands (/bridge, /tts, /voice)
    if (text.startsWith("/bridge") || /^(bridge start|start bridge|bridge stop|voice bridge)/i.test(text)) {
      const parts = text.split(/\s+/);
      const subCommand = parts[1]?.toLowerCase();

      if (subCommand === "stop" || /^(stop|end|band|khatam)/i.test(subCommand || "")) {
        const stopped = await voiceBridgeService.stopBridgeSession(chatId);
        if (stopped) {
          await this.sendMessage(
            chatId,
            `🔴 *Voice-Text Bridge session disconnect kar diya gaya hai.*`
          );
          const partnerChatId = chatId === stopped.userA_chatId ? stopped.userB_chatId : stopped.userA_chatId;
          await this.sendMessage(
            partnerChatId,
            `🔴 *${senderName} ne Voice-Text Bridge session disconnect kar diya hai.*`
          );
        } else {
          await this.sendMessage(chatId, "ℹ️ Aapka koi active Voice Bridge session nahi chal raha hai.");
        }
        return;
      }

      if (subCommand === "status") {
        const session = voiceBridgeService.getSession(chatId);
        if (session) {
          const isUserA = chatId === session.userA_chatId;
          const role = isUserA ? "✍️ User A (Text Mode)" : "🎙️ User B (Voice Mode)";
          const partnerName = isUserA ? session.userB_name : session.userA_name;
          await this.sendMessage(
            chatId,
            `🟢 *Voice Bridge Active:*\n\n• *Aapka Role:* ${role}\n• *Partner:* ${partnerName}\n• *Voice:* \`${session.preferredVoice || "hi-IN-MadhurNeural"}\`\n\n_User A text likhega to Voice banegi, User B voice bolega to Text aayega._`
          );
        } else {
          await this.sendMessage(chatId, "ℹ️ Koi active bridge session nahi hai. Start karne ke liye: `/bridge @username`");
        }
        return;
      }

      // Start Bridge with Target: /bridge @target_username or /bridge <chatId>
      const targetQuery = parts.slice(1).join(" ").trim();
      if (!targetQuery) {
        await this.sendMessage(
          chatId,
          `ℹ️ *Voice Bridge kaise use karein:*\n\n1. \`/bridge @username\` — Kisi contact ke sath bridge start karein\n2. \`/bridge stop\` — Bridge session end karein\n3. \`/bridge status\` — Current bridge check karein\n4. \`/voice female\` ya \`/voice male\` — Voice badlein\n5. \`/tts <text>\` — Instant voice note generate karein`
        );
        return;
      }

      const resolved = await this.resolveTargetChatId(targetQuery);
      if (!resolved.chatId) {
        await this.sendMessage(chatId, `❌ ${resolved.error || `Target '${targetQuery}' nahi mila.`}`);
        return;
      }

      if (resolved.chatId === chatId) {
        await this.sendMessage(chatId, "⚠️ Aap khud ke sath bridge nahi bana sakte. Kisi dusre user ka username ya Chat ID dein.");
        return;
      }

      const newSession = await voiceBridgeService.createBridgeSession(
        chatId,
        senderName,
        resolved.chatId,
        resolved.name || targetQuery
      );

      await this.sendMessage(
        chatId,
        `🚀 *Voice-Text Bridge ACTIVATED!* ⚡\n\n• *Aap (User A):* ✍️ Text likhiye (Friday isko audio banakar bheje gi)\n• *${newSession.userB_name} (User B):* 🎙️ Voice notes bhejenge (Friday unko text me convert karke aapko degi)\n\n_Ab aap normal message type kijiye!_`
      );

      await this.sendMessage(
        resolved.chatId,
        `🔊 *Voice-Text Bridge Connected with ${senderName}!* ⚡\n\n• *Aap (User B):* 🎙️ Voice notes boliye (Friday text banakar unko deliver karegi)\n• *${senderName} (User A):* ✍️ Jo bhi likhenge, aapko Voice Note me sunai dega!\n\n_Bridge band karne ke liye \`/bridge stop\` likhein._`
      );
      return;
    }

    // 2.3 Handle /voice command (Switch TTS Voice Tone)
    if (text.startsWith("/voice")) {
      const choice = text.replace(/^\/voice\s*/i, "").trim().toLowerCase();
      let voiceCode = VoiceBridgeService.DEFAULT_VOICE;
      if (choice.includes("female") || choice.includes("ladki") || choice.includes("swara")) {
        voiceCode = VoiceBridgeService.FEMALE_VOICE;
      } else if (choice.includes("english") || choice.includes("en")) {
        voiceCode = VoiceBridgeService.ENGLISH_VOICE;
      }

      voiceBridgeService.setPreferredVoice(chatId, voiceCode);
      await this.sendMessage(
        chatId,
        `🎙️ *Voice tone updated to:* \`${voiceCode}\` (${voiceCode.includes("Swara") ? "Female Hindi" : voiceCode.includes("Prabhat") ? "Indian English" : "Male Hindi"})\n\nAb bridge me yehi voice use hogi! ✨`
      );
      return;
    }

    // 2.4 Handle /tts command (Instant Text-to-Speech Voice Note)
    if (text.startsWith("/tts ") || /^voice me bolo /i.test(text)) {
      const speechText = text.replace(/^(\/tts|voice me bolo)\s*/i, "").trim();
      if (speechText) {
        try {
          await this.sendChatAction(chatId, "record_voice");
          const audioBuf = await voiceBridgeService.textToSpeechBuffer(speechText);
          await this.sendVoice(chatId, audioBuf, `🔊 "${speechText}"`);
        } catch (e: any) {
          await this.sendMessage(chatId, `❌ Voice generate karne me error: ${e?.message || e}`);
        }
        return;
      }
    }

    // 2.5 Handle Incoming Voice Notes / Audio Messages (Live STT via Groq Whisper)
    const voiceObj = msg.voice || msg.audio;
    if (voiceObj) {
      try {
        await this.sendChatAction(chatId, "typing");
        const { buffer } = await this.downloadFile(voiceObj.file_id);
        const transcribedText = await voiceBridgeService.transcribeAudio(
          buffer,
          voiceObj.mime_type || "audio/ogg",
          voiceObj.file_name || "voice.ogg"
        );

        console.log(`[TelegramBot] Voice Transcribed from ${senderName}: "${transcribedText}"`);

        // Check if sender is in an active 1-on-1 bridge session
        const session = voiceBridgeService.getSession(chatId);
        if (session) {
          // If sender is User B (Voice mode) -> Deliver transcribed text to User A
          if (chatId === session.userB_chatId) {
            await this.sendMessage(
              session.userA_chatId,
              `🎙️ *${senderName} (Voice):*\n\n"${transcribedText}"`
            );
            await this.sendMessage(chatId, `✍️ _Text deliver ho gaya to ${session.userA_name}_`);
            return;
          }
          // If sender is User A (User A also sent a voice note) -> Deliver transcribed text or voice to User B
          if (chatId === session.userA_chatId) {
            await this.sendVoice(session.userB_chatId, buffer, `🔊 Voice from ${senderName}`);
            await this.sendMessage(chatId, `🔊 _Voice note deliver ho gaya to ${session.userB_name}_`);
            return;
          }
        }

        // Check if Group Call Bridge is active in this group
        const grpSession = voiceBridgeService.getGroupSession(chatId);
        if (grpSession && grpSession.isCallActive) {
          if (!grpSession.isMuted) {
            await this.sendMessage(
              chatId,
              `🎙️ *${grpSession.userB_name || senderName} (Voice):*\n\n"${transcribedText}"`
            );
          }
          return;
        }

        // Outside bridge session: Display transcription and generate smart AI reply
        await this.sendMessage(
          chatId,
          `🎙️ *Aapki Aawaz (Transcription):*\n_"${transcribedText}"_`
        );

        const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
        const isOwner = !!ownerChatId && String(chatId) === String(ownerChatId);
        const replyText = await this.generateSmartAiReply(senderName, transcribedText, isOwner);
        await this.sendHumanLikeMessage(chatId, replyText);
      } catch (e: any) {
        console.error("[TelegramBot] Error processing voice note:", e);
        await this.sendMessage(chatId, `❌ Voice note process karne me error: ${e?.message || e}`);
      }
      return;
    }

    // 2.6 Active Bridge Check for Text Messages (1-on-1 Bridge)
    const activeSession = voiceBridgeService.getSession(chatId);
    if (activeSession && chatId === activeSession.userA_chatId && text && !text.startsWith("/")) {
      try {
        await this.sendChatAction(chatId, "record_voice");
        const voiceBuffer = await voiceBridgeService.textToSpeechBuffer(
          text,
          activeSession.preferredVoice || VoiceBridgeService.DEFAULT_VOICE
        );

        // Send real voice note directly to User B
        await this.sendVoice(
          activeSession.userB_chatId,
          voiceBuffer,
          `🔊 Voice from ${senderName}`
        );

        // Confirm delivery to User A
        await this.sendMessage(
          chatId,
          `🔊 _Delivered as Voice Note to ${activeSession.userB_name}_`
        );
        return;
      } catch (e: any) {
        console.error("[TelegramBot] Bridge TTS send failed:", e);
        await this.sendMessage(chatId, `⚠️ Voice conversion error: ${e?.message || e}`);
      }
    }

    // 2.7 Active Group Call Bridge Check for Text Messages (Group User A -> TTS in Group)
    const activeGrpSession = voiceBridgeService.getGroupSession(chatId);
    if (
      activeGrpSession &&
      activeGrpSession.isCallActive &&
      !activeGrpSession.isMuted &&
      text &&
      !text.startsWith("/")
    ) {
      const isUserA = from.id === activeGrpSession.userA_id || senderName === activeGrpSession.userA_name;
      if (isUserA) {
        try {
          await this.sendChatAction(chatId, "record_voice");
          const voiceBuffer = await voiceBridgeService.textToSpeechBuffer(
            text,
            activeGrpSession.preferredVoice || VoiceBridgeService.DEFAULT_VOICE
          );

          await this.sendVoice(
            chatId,
            voiceBuffer,
            `🔊 [Voice from ${activeGrpSession.userA_name} to ${activeGrpSession.userB_name || "Group"}]`
          );
          return;
        } catch (e: any) {
          console.error("[TelegramBot] Group Bridge TTS error:", e);
          await this.sendMessage(chatId, `⚠️ Voice conversion error: ${e?.message || e}`);
        }
      }
    }

    // 3. Handle Voice PIN updates (e.g. "voice pin - 123456", "voice pin: 994411")
    const pinRes = await voiceBiometricsService.handleWhatsAppVoicePinMessage(text, senderName);
    if (pinRes.handled && pinRes.replyText) {
      await this.sendMessage(chatId, `🔐 *Voice PIN Update:*\n\n${pinRes.replyText}`);
      return;
    }

    // 4. Handle Photos & Images (Vision AI & Face Recognition)
    if (msg.photo && msg.photo.length > 0) {
      const highestResPhoto = msg.photo[msg.photo.length - 1];
      try {
        await this.sendMessage(chatId, "👁️ *Photo analyze ho rahi hai...*");
        const { buffer } = await this.downloadFile(highestResPhoto.file_id);

        if (/^(ye kaun hai|pehchano|who is this|identify)/i.test(text)) {
          const idRes = await visionMemoryService.identifyPersonInPhoto(buffer);
          await this.sendMessage(chatId, idRes.explanation);
        } else if (/^(iska naam|ye photo|save person|inka naam)/i.test(text)) {
          const nameMatch = text.match(/(?:naam|name)\s+(?:hai\s+)?([A-Za-z0-9\s]+)/i);
          const personName = nameMatch ? nameMatch[1].trim() : "Contact";
          const saveRes = await visionMemoryService.savePersonMemory(personName, "Friend / Contact", text, buffer);
          await this.sendMessage(chatId, saveRes.summary);
        } else {
          const analysisRes = await visionMemoryService.processIncomingMedia(buffer, "image/jpeg", senderName, text);
          await this.sendMessage(chatId, `🖼️ *Photo Breakdown & OCR:*\n\n${analysisRes.analysis}`);
        }
      } catch (e: any) {
        await this.sendMessage(chatId, `❌ Photo process karne me error: ${e?.message || e}`);
      }
      return;
    }

    // 5. Handle Documents / PDFs (Vision OCR)
    if (msg.document) {
      try {
        await this.sendMessage(chatId, "📄 *Document / PDF analyze ho raha hai...*");
        const mimeType = msg.document.mime_type || "application/pdf";
        const { buffer } = await this.downloadFile(msg.document.file_id);
        const analysisRes = await visionMemoryService.processIncomingMedia(buffer, mimeType, senderName, text);
        await this.sendMessage(chatId, `📑 *Document OCR & Summary:*\n\n${analysisRes.analysis}`);
      } catch (e: any) {
        await this.sendMessage(chatId, `❌ Document process karne me error: ${e?.message || e}`);
      }
      return;
    }

    // 6. Handle Coding Agent Approvals ("yes" / "ok" / "approve")
    const normalized = text.toLowerCase();
    if (["yes", "ok", "approve", "haan", "theek hai"].includes(normalized)) {
      const handled = await codeAgentService.handleWhatsAppApprovalReply(text);
      if (handled) {
        await this.sendMessage(chatId, "🚀 *Boss, Coding Agent ko approval de diya gaya hai! Code main branch me commit kiya ja raha hai.*");
        return;
      }
    }

    // 7. Handle Music Finder Requests ("gana chalao ...", "song ...")
    if (/(gana chalao|song|music|spotify)/i.test(text)) {
      const songQuery = text.replace(/(gana chalao|gana sunao|song|play|music)/gi, "").trim();
      if (songQuery) {
        const musicRes = await publicApisService.searchMusic(songQuery);
        if (musicRes.success && musicRes.spotifyUrl) {
          await this.sendMessage(
            chatId,
            `🎵 *${musicRes.title}* by ${musicRes.artist}\n\n▶️ [Play on Spotify](${musicRes.spotifyUrl})\n\nEnjoy kijiye Boss! ✨`
          );
          return;
        }
      }
    }

    // 8. Handle Daily Updates ("aaj ka update note karo ...")
    if (/^(aaj ka update|update note|log update)/i.test(text)) {
      const cleanUpdate = text.replace(/^(aaj ka update note karo|aaj ka update|update note karo)/gi, "").trim();
      if (cleanUpdate) {
        await dailyUpdateService.appendUpdate(cleanUpdate);
        await this.sendMessage(chatId, "✅ *Boss, aaj ka update successfully log aur save kar liya hai!*");
        return;
      }
    }

    // 9. General Smart AI Conversational Reply via Multi-Tier Fallback Chain (with Typing presence)
    const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
    const isOwner = !!ownerChatId && String(chatId) === String(ownerChatId);
    const replyText = await this.generateSmartAiReply(senderName, text, isOwner);
    await this.sendHumanLikeMessage(chatId, replyText);
  }

  /**
   * Generates interactive inline keyboard controls for Group Voice Bridge Call.
   */
  private getGroupControlPanelMarkup(groupId: number) {
    const session = voiceBridgeService.getGroupSession(groupId);
    const isCallActive = session?.isCallActive || false;
    const isMuted = session?.isMuted || false;
    const voiceName = session?.preferredVoice?.includes("Swara")
      ? "Female (Swara)"
      : session?.preferredVoice?.includes("Prabhat")
      ? "English (Prabhat)"
      : "Male (Madhur)";

    return {
      inline_keyboard: [
        [
          { text: `✍️ User A: ${session?.userA_name || "❌ Not Set"}`, callback_data: `grp_set_a_${groupId}` },
          { text: `🎙️ User B: ${session?.userB_name || "❌ Not Set"}`, callback_data: `grp_set_b_${groupId}` },
        ],
        [
          {
            text: isCallActive ? "🔴 End Call Bridge" : "⚡ Start Call Bridge",
            callback_data: isCallActive ? `grp_end_${groupId}` : `grp_start_${groupId}`,
          },
          {
            text: isMuted ? "🔊 Unmute Bot" : "🔇 Mute Bot",
            callback_data: `grp_mute_${groupId}`,
          },
        ],
        [
          { text: `🗣️ Voice: ${voiceName}`, callback_data: `grp_voice_${groupId}` },
          { text: "📊 Call Status", callback_data: `grp_status_${groupId}` },
        ],
      ],
    };
  }

  /**
   * Generates a status summary message for group call bridge.
   */
  private getGroupStatusText(groupId: number): string {
    const session = voiceBridgeService.initOrGetGroupSession(groupId);
    return `👑 *Friday Live Group Voice-Text Bridge:* ⚡\n\n• ✍️ *User A (Text User):* ${session.userA_name || "_Not set (likhein 'User A @username')_"}\n• 🎙️ *User B (Voice User):* ${session.userB_name || "_Not set (likhein 'User B @username')_"}\n• 📞 *Call State:* ${session.isCallActive ? "🟢 LIVE CALL ACTIVE" : "⚪ IDLE (Not Started)"}\n• 🔇 *Bot Audio:* ${session.isMuted ? "🔇 MUTED" : "🔊 UNMUTED (Active)"}\n• 🗣️ *TTS Voice:* \`${session.preferredVoice || "hi-IN-MadhurNeural"}\`\n\n_User A text likhega to direct voice sunai degi, User B voice bolega to text aayega!_`;
  }

  /**
   * Handles interactive button clicks from Telegram (e.g. Coding Agent inline actions & Group Call Controls).
   */
  private async handleCallbackQuery(query: any): Promise<void> {
    const data = String(query.data || "");
    const chatId = query.message?.chat?.id;
    const senderName = query.from?.first_name || "User";

    try {
      await this.callApi("answerCallbackQuery", { callback_query_id: query.id });

      // 1. Mode Selection: Personal Chat
      if (data.startsWith("mode_personal_")) {
        await this.sendMessage(
          chatId,
          `✨ *Personal Chat Mode Active!* 💬\n\nNamaste ${senderName}! Main Friday hoon — DK Boss ka AI assistant. Mujhse koi bhi sawal poochiye ya task karwaiye.`
        );
        return;
      }

      // 2. Mode Selection: Group Voice Bridge Call
      if (data.startsWith("mode_group_bridge_")) {
        const targetGroupId = Number(data.replace("mode_group_bridge_", "")) || chatId;
        const introText = `🎉 *Thank you! Main Group Voice Bridge Call activate kar rahi hoon.* ⚡\n\n👑 *DK Boss ne mujhe is group me live call & voice bridge sambhalne ke liye banaya hai.*\nMain live call & voice ko real-time *TTS (Text-to-Speech)* aur *STT (Speech-to-Text)* kar sakti hoon.\n\n📋 *Rules samajh lijiye:*\n• ✍️ *User A (Text Mode):* User A jo bhi text likhega, uski aawaz direct Voice Note bankar group me User B ko sunai degi.\n• 🎙️ *User B (Voice Mode):* User B group me voice bolega to User A ko uska transcribed text milega.\n\n👇 *Neeche diye gaye buttons ya text format se User A & B set karein:*`;
        await this.sendMessage(targetGroupId, introText, this.getGroupControlPanelMarkup(targetGroupId));
        return;
      }

      // 3. Group Set User A Prompt
      if (data.startsWith("grp_set_a_")) {
        const targetGroupId = Number(data.replace("grp_set_a_", "")) || chatId;
        await this.sendMessage(
          targetGroupId,
          `✍️ *User A (Text User) set karne ke liye group me likhein:*\n\`User A @username\` ya \`User A ${query.from.id}\`\n\n_(User A text type karega aur Friday usko voice bana degi)_`
        );
        return;
      }

      // 4. Group Set User B Prompt
      if (data.startsWith("grp_set_b_")) {
        const targetGroupId = Number(data.replace("grp_set_b_", "")) || chatId;
        await this.sendMessage(
          targetGroupId,
          `🎙️ *User B (Voice User) set karne ke liye group me likhein:*\n\`User B @username\` ya \`User B ${query.from.id}\`\n\n_(User B voice bolega aur Friday text me transcribe karegi)_`
        );
        return;
      }

      // 5. Group Start Call
      if (data.startsWith("grp_start_")) {
        const targetGroupId = Number(data.replace("grp_start_", "")) || chatId;
        const res = voiceBridgeService.startGroupCall(targetGroupId);
        if (!res.success) {
          await this.sendMessage(targetGroupId, `⚠️ ${res.error}`, this.getGroupControlPanelMarkup(targetGroupId));
        } else {
          await this.sendMessage(
            targetGroupId,
            `🚀 *LIVE GROUP CALL BRIDGE STARTED!* ⚡📞\n\n• ✍️ *User A (${res.session?.userA_name}):* Ab normal text likhiye — Friday voice me bolegi!\n• 🎙️ *User B (${res.session?.userB_name}):* Ab Voice Notes bhejiye — Friday text me transcribe karegi!\n\n_Call controls live below:_`,
            this.getGroupControlPanelMarkup(targetGroupId)
          );
        }
        return;
      }

      // 6. Group End Call
      if (data.startsWith("grp_end_")) {
        const targetGroupId = Number(data.replace("grp_end_", "")) || chatId;
        const ended = voiceBridgeService.endGroupCall(targetGroupId);
        await this.sendMessage(
          targetGroupId,
          `🔴 *Group Live Call Bridge Ended.* Call successfully disconnect ho gayi hai. ✨`,
          this.getGroupControlPanelMarkup(targetGroupId)
        );
        return;
      }

      // 7. Group Mute / Unmute
      if (data.startsWith("grp_mute_")) {
        const targetGroupId = Number(data.replace("grp_mute_", "")) || chatId;
        const muteRes = voiceBridgeService.toggleMuteGroupCall(targetGroupId);
        await this.sendMessage(
          targetGroupId,
          muteRes.isMuted
            ? `🔇 *Friday Bot is now MUTED in this group call.* (Audio generation paused)`
            : `🔊 *Friday Bot is now UNMUTED in this group call.* (Audio generation active)`,
          this.getGroupControlPanelMarkup(targetGroupId)
        );
        return;
      }

      // 8. Group Switch Voice Tone
      if (data.startsWith("grp_voice_")) {
        const targetGroupId = Number(data.replace("grp_voice_", "")) || chatId;
        const newVoice = voiceBridgeService.switchGroupVoice(targetGroupId);
        const name = newVoice.includes("Swara") ? "Female Hindi (Swara)" : newVoice.includes("Prabhat") ? "Indian English (Prabhat)" : "Male Hindi (Madhur)";
        await this.sendMessage(
          targetGroupId,
          `🗣️ *Voice updated to:* \`${name}\` ✨`,
          this.getGroupControlPanelMarkup(targetGroupId)
        );
        return;
      }

      // 9. Group Status Query
      if (data.startsWith("grp_status_")) {
        const targetGroupId = Number(data.replace("grp_status_", "")) || chatId;
        await this.sendMessage(
          targetGroupId,
          this.getGroupStatusText(targetGroupId),
          this.getGroupControlPanelMarkup(targetGroupId)
        );
        return;
      }

      // 10. Coding Agent Approvals
      if (data.startsWith("code_approve_")) {
        const reqId = data.replace("code_approve_", "");
        await codeAgentService.approveAndPushDirectlyToMain(reqId);
        await this.sendMessage(chatId, `🚀 *Task ${reqId} Approved & Pushed directly to Main Origin Branch!*`);
      } else if (data.startsWith("code_deny_")) {
        const reqId = data.replace("code_deny_", "");
        await codeAgentService.deny(reqId);
        await this.sendMessage(chatId, `❌ *Task ${reqId} Denied and Cancelled.*`);
      }
    } catch (e: any) {
      console.error("[TelegramBot] Callback query error:", e?.message);
    }
  }
}

export const telegramBotService = new TelegramBotService();
