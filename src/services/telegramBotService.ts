import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { visionMemoryService } from "./visionMemoryService";
import { voiceBiometricsService } from "./voiceBiometricsService";
import { codeAgentService } from "./codeAgentService";
import { dailyUpdateService } from "./dailyUpdateService";
import { publicApisService } from "./publicApisService";

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
   * Generates a conversational AI reply using a multi-tier Gemini model fallback chain.
   */
  private async generateSmartAiReply(senderName: string, messageText: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return "Haanji! Friday active hai. Bataiye kya help karoon?";
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, witty, loyal, human-like AI companion.

CHAT CONTEXT:
Sender: "${senderName}"
Message: "${messageText}"

INSTRUCTIONS:
1. IDENTITY & CREATOR:
   - If they ask who you are, your name, or whose bot this is:
     Reply: "Main Friday hoon — DK Boss (Divakar Kumar) ka personal AI assistant! DK abhi occupied hain. Aap bataiye, aapko kya kaam hai?"
2. PRIVACY & SECURITY GUARD:
   - If they ask for confidential private details (DK's personal passwords, bank/money, confidential secrets):
     Strictly refuse: "Yeh personal jaankari main share nahi kar sakti. Iska jawab sirf DK boss hi de sakte hain."
3. STYLE & TONE:
   - Natural Hindi/Hinglish (mix of Hindi and English).
   - Crisp, polite, and warmly intelligent (1-3 short sentences).
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

    return `Haanji ${senderName}! Main Friday hoon. DK boss abhi busy hain, jaise hi wo aayenge main aapka message unko bata dungi 👍`;
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

    // 2. Handle /start and /help command
    if (text === "/start" || text === "/help") {
      const welcome = `👋 *Namaste ${senderName}! Main Friday AI Assistant hoon.* 🚀⚡

Main aapke saare kaam yahan Telegram par bhi handle kar sakti hoon:
• 💬 *AI Smart Chat:* Mujhse koi bhi sawal poochiye
• 📷 *Vision AI:* Photo ya PDF bhejiye — OCR aur Face Recognition
• 🎵 *Music Finder:* _"Gana chalao Arijit Singh"_
• 🤖 *Coding Agent:* Code plans review & approve
• 🔒 *Voice PIN Sync:* _"voice pin - 123456"_
• 📅 *Daily Updates:* _"aaj ka update note karo..."_

Bataiye Boss, aaj kya help karoon?`;
      await this.sendMessage(chatId, welcome);
      return;
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

    // 9. General Smart AI Conversational Reply via Multi-Tier Fallback Chain
    const replyText = await this.generateSmartAiReply(senderName, text);
    await this.sendMessage(chatId, replyText);
  }

  /**
   * Handles interactive button clicks from Telegram (e.g. Coding Agent inline actions).
   */
  private async handleCallbackQuery(query: any): Promise<void> {
    const data = query.data;
    const chatId = query.message?.chat?.id;

    try {
      await this.callApi("answerCallbackQuery", { callback_query_id: query.id });

      if (data?.startsWith("code_approve_")) {
        const reqId = data.replace("code_approve_", "");
        await codeAgentService.approveAndPushDirectlyToMain(reqId);
        await this.sendMessage(chatId, `🚀 *Task ${reqId} Approved & Pushed directly to Main Origin Branch!*`);
      } else if (data?.startsWith("code_deny_")) {
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
