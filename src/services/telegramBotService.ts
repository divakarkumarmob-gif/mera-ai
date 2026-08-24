import { GoogleGenAI } from "@google/genai";
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

class TelegramBotService {
  private token: string = "";
  private botUsername: string | null = null;
  private isPolling: boolean = false;
  private pollingAbortController: AbortController | null = null;
  private offset: number = 0;
  private lastActive: number | null = null;
  private messageCallback: ((msg: { sender: string; text: string; time: string; chatId: number }) => void) | null = null;

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

    // 1. Handle Inline Keyboard Button Clicks (e.g. Coding Agent Approve/Deny)
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const senderName = msg.from?.first_name ? `${msg.from.first_name} ${msg.from.last_name || ""}`.trim() : "Boss";
    const text = (msg.text || msg.caption || "").trim();

    // Broadcast incoming message to Live UI
    if (this.messageCallback) {
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

    // 9. General Smart AI Conversational Reply via Gemini
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const prompt = `You are Friday: DK's ultra-intelligent, witty, loyal, human-like AI companion.
User: "${senderName}"
Message: "${text}"

Reply in natural, warm Hindi/Hinglish directly to Boss (DK). Keep it concise, helpful, and friendly.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      const replyText = response.text || "Haan Boss, main sun rahi hoon!";
      await this.sendMessage(chatId, replyText);
    } catch (e: any) {
      await this.sendMessage(chatId, "Haan Boss, bataiye kya help karoon?");
    }
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
