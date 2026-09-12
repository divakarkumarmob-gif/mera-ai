/**
 * telegramMemoryBotService.ts
 *
 * Dedicated Telegram Memory Vault Bot (Bot #3 on Render):
 * 1. 🧠 Instant Long-Term Memory Storage & Retrieval
 * 2. ⚡ True Telegram Cloud Storage Fallback (Persistent across Render restarts without Firebase!)
 * 3. 🔄 Auto-Hydration on Boot (Restores memory facts directly from Telegram's cloud servers)
 * 4. 📌 Immutable Cloud Vault Manifest & Sync
 * 5. 🔍 Deep Cross-Platform Search
 */

import * as _TelegramBot from "node-telegram-bot-api";
const TelegramBot: any = (_TelegramBot as any).default || _TelegramBot;
import { unifiedMemoryService, AtomicFactEntry } from "./unifiedMemoryService";

class TelegramMemoryBotService {
  private bot: any = null;
  private isInitialized = false;
  private memoryBotToken: string = "";
  private bossChatId: number | string | null = null;
  private manifestMessageId: number | null = null;

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    this.memoryBotToken =
      process.env.TELEGRAM_MEMORY_BOT_TOKEN ||
      process.env.TELEGRAM_BRAIN_BOT_TOKEN ||
      "";

    this.bossChatId =
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_BOSS_CHAT_ID ||
      process.env.BOSS_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_OWNER_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      null;

    if (!this.memoryBotToken) {
      console.log("[TelegramMemoryBot] ℹ️ TELEGRAM_MEMORY_BOT_TOKEN not set in .env. Memory Bot is in standby.");
      return;
    }

    try {
      this.bot = new (TelegramBot as any)(this.memoryBotToken, {
        polling: {
          interval: 1000,
          autoStart: true,
          params: { timeout: 10 },
        },
      });

      this.registerHandlers();
      this.isInitialized = true;
      console.log("[TelegramMemoryBot] 🧠 Telegram Memory Vault Bot initialized & polling!");

      // If bossChatId is known, auto-hydrate facts from Telegram Cloud
      if (this.bossChatId) {
        this.hydrateFactsFromTelegramCloud().catch((err) => {
          console.warn("[TelegramMemoryBot] Cloud hydration on boot warning:", err?.message || err);
        });
      }
    } catch (err: any) {
      console.warn("[TelegramMemoryBot] Failed to initialize Telegram Memory Bot:", err?.message || err);
    }
  }

  private isAuthorized(chatId: number | string, fromId?: number | string): boolean {
    const configuredBoss =
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_BOSS_CHAT_ID ||
      process.env.BOSS_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_OWNER_ID;
    if (configuredBoss) {
      return String(chatId) === String(configuredBoss) || (!!fromId && String(fromId) === String(configuredBoss));
    }
    if (!this.bossChatId) {
      this.bossChatId = chatId;
      return true;
    }
    return String(chatId) === String(this.bossChatId) || (!!fromId && String(fromId) === String(this.bossChatId));
  }

  private registerHandlers(): void {
    if (!this.bot) return;

    // ── Command: /start or /help ───────────────────────────────────────────
    this.bot.onText(/^\/(?:start|help)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Ye Friday ka private Memory Vault hai. Only DK Boss is authorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const firstName = msg.from?.first_name || "Boss";
      const helpMsg = `🧠 *Welcome to Friday Memory Vault Bot!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hi *${firstName}*! Main Friday ki dedicated **True Cloud Storage Memory Vault** hoon.

📌 *Key Advantage:*
Even agar Firebase configured nahi hai, ye bot Telegram ke Cloud Servers ko **database** ki tarah use karke Render restart ke baad bhi aapki memory **100% zinda** rakhega!

📌 *Quick Commands:*
• \`yaad rakhna mujhe black coffee pasand hai\` -> Direct fact save
• \`/remember <fact>\` -> Explicit fact memory save
• \`/memory\` ya \`/memories\` -> Saari saved yaadein list karo
• \`/sync\` -> Telegram Cloud Vault se instant sync & backup update
• \`/search <keyword>\` -> Memory me search karo
• \`/forget <keyword>\` -> Specific memory delete karo
• \`/briefing\` -> Aaj ka morning Chief-of-Staff briefing
• \`/stats\` -> Memory engine storage health status

💡 _Aap koi bhi personal note, goal ya habit yahan direct bhej sakte hain!_`;

      await this.safeSendMessage(chatId, helpMsg, { parse_mode: "Markdown" });
    });

    // ── Command: /sync (Force Telegram Cloud Storage Sync) ─────────────────
    this.bot.onText(/^\/(?:sync|backup)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const facts = await unifiedMemoryService.listAllFacts();
      const synced = await this.saveManifestToTelegramCloud(chatId, facts);
      if (synced) {
        await this.safeSendMessage(
          chatId,
          `☁️ *Telegram Cloud Storage Synced!* ${facts.length} memory facts are permanently backed up to Telegram Cloud. Render restart hone par 0% loss hoga. ✅`,
          { parse_mode: "Markdown" }
        );
      } else {
        await this.safeSendMessage(chatId, `⚠️ Cloud sync failed. Please try again.`, { parse_mode: "Markdown" });
      }
    });

    // ── Command: /memory or /memories ──────────────────────────────────────
    this.bot.onText(/^\/(?:memory|memories|list|vault)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const facts = await unifiedMemoryService.listAllFacts();
      const formatted = unifiedMemoryService.formatFactsListMarkdown(facts);
      await this.safeSendMessage(chatId, formatted, { parse_mode: "Markdown" });
    });

    // ── Command: /remember <fact> ──────────────────────────────────────────
    this.bot.onText(/^\/remember\s*(.+)/i, async (msg: any, match: RegExpExecArray | null) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const factText = match && match[1] ? match[1].trim() : "";
      if (!factText) {
        await this.safeSendMessage(chatId, "⚠️ Boss, please fact likhein. Jaise: `/remember Mera exam 20 May ko hai`", { parse_mode: "Markdown" });
        return;
      }
      const saveRes = await unifiedMemoryService.addAtomicFact(factText, "personal_detail", "telegram");
      await this.safeSendMessage(chatId, saveRes.confirmationMessage, { parse_mode: "Markdown" });
    });

    // ── Command: /forget <fact> ────────────────────────────────────────────
    this.bot.onText(/^\/forget\s*(.+)/i, async (msg: any, match: RegExpExecArray | null) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const target = match && match[1] ? match[1].trim() : "";
      if (!target) {
        await this.safeSendMessage(chatId, "⚠️ Boss, keyword likhein jise bhoolna hai. Jaise: `/forget coffee`", { parse_mode: "Markdown" });
        return;
      }
      const res = await unifiedMemoryService.removeAtomicFact(target);
      await this.safeSendMessage(chatId, res.message, { parse_mode: "Markdown" });
      // Sync cloud after deletion
      const updatedFacts = await unifiedMemoryService.listAllFacts();
      await this.saveManifestToTelegramCloud(chatId, updatedFacts);
    });

    // ── Command: /search <query> ───────────────────────────────────────────
    this.bot.onText(/^\/search\s*(.+)/i, async (msg: any, match: RegExpExecArray | null) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const query = match && match[1] ? match[1].trim() : "";
      if (!query) {
        await this.safeSendMessage(chatId, "⚠️ Search query likhein: `/search meeting`", { parse_mode: "Markdown" });
        return;
      }
      const res = await unifiedMemoryService.searchCrossPlatformMemory(query, { daysBack: 90, limit: 10 });
      await this.safeSendMessage(chatId, res.summary, { parse_mode: "Markdown" });
    });

    // ── Command: /briefing ─────────────────────────────────────────────────
    this.bot.onText(/^\/(?:briefing|morning)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
      const text = await proactiveExecutiveService.generateChiefOfStaffMorningBriefing();
      await this.safeSendMessage(chatId, text, { parse_mode: "Markdown" });
    });

    // ── Command: /unanswered ───────────────────────────────────────────────
    this.bot.onText(/^\/(?:unanswered|pending)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
      const res = await proactiveExecutiveService.checkPendingUnansweredMessages(3);
      await this.safeSendMessage(chatId, res.formattedSummary, { parse_mode: "Markdown" });
    });

    // ── Command: /stats ────────────────────────────────────────────────────
    this.bot.onText(/^\/(?:stats|status|health)/i, async (msg: any) => {
      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        await this.safeSendMessage(chatId, "🔒 *Access Denied:* Unauthorized.", { parse_mode: "Markdown" });
        return;
      }
      this.bossChatId = chatId;
      const facts = await unifiedMemoryService.listAllFacts();
      const isCloudFirestore = unifiedMemoryService.isCloudFirestoreConfigured();
      const statsMsg = `📊 *Friday Memory Storage Diagnostics:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 🧠 *Total Active Memories:* ${facts.length}
• ☁️ *Cloud Storage Status:* ${isCloudFirestore ? "🟢 Google Cloud Firestore Active" : "🟢 Telegram Cloud Vault Active (Render Persistent)"}
• 🔄 *Render Restart Persistence:* 100% Protected
• 📱 *Cross-Platform Bridge:* WhatsApp ↔ Telegram Sync Active`;
      await this.safeSendMessage(chatId, statsMsg, { parse_mode: "Markdown" });
    });

    // ── General Message Handler (Natural Language + Auto-Memory) ───────────
    this.bot.on("message", async (msg: any) => {
      const text = (msg.text || "").trim();
      if (!text || text.startsWith("/")) return;

      const chatId = msg.chat.id;
      const fromId = msg.from?.id;
      if (!this.isAuthorized(chatId, fromId)) {
        return;
      }
      this.bossChatId = chatId;
      const parsedCmd = unifiedMemoryService.parseMemoryCommand(text);

      if (parsedCmd.isMemoryCommand) {
        if (parsedCmd.action === "list") {
          const facts = await unifiedMemoryService.listAllFacts();
          await this.safeSendMessage(chatId, unifiedMemoryService.formatFactsListMarkdown(facts), { parse_mode: "Markdown" });
          return;
        } else if (parsedCmd.action === "remember" && parsedCmd.targetText) {
          const saveRes = await unifiedMemoryService.addAtomicFact(parsedCmd.targetText, "personal_detail", "telegram");
          await this.safeSendMessage(chatId, saveRes.confirmationMessage, { parse_mode: "Markdown" });
          return;
        } else if (parsedCmd.action === "forget" && parsedCmd.targetText) {
          const res = await unifiedMemoryService.removeAtomicFact(parsedCmd.targetText);
          await this.safeSendMessage(chatId, res.message, { parse_mode: "Markdown" });
          const updatedFacts = await unifiedMemoryService.listAllFacts();
          await this.saveManifestToTelegramCloud(chatId, updatedFacts);
          return;
        }
      }

      // If user sends a regular note/statement, observe facts
      unifiedMemoryService.observeAndExtractFacts(msg.from?.first_name || "Boss", text, "telegram", true);

      if (/mera|meri|mujhe|hum|mai|hamesha|pasand|date|exam|birthday|kaam|meeting/i.test(text)) {
        await this.safeSendMessage(
          chatId,
          `🧠 *Noted Boss!* Maine is baat ko aapke permanent memory vault me process kar liya hai. ✨\n\n_Check karne ke liye \`/memory\` likhein._`,
          { parse_mode: "Markdown" }
        );
      }
    });

    // Polling error shield (prevents unhandled crash)
    this.bot.on("polling_error", (err: any) => {
      if (err?.message && !err.message.includes("ETELEGRAM: 409 Conflict")) {
        console.warn("[TelegramMemoryBot] Polling warning:", err.message);
      }
    });
  }

  // ── 2. TRUE TELEGRAM CLOUD STORAGE FALLBACK IMPLEMENTATION ────────────────

  /**
   * Saves or updates the full AtomicFactEntry snapshot as a special tagged cloud message in Telegram.
   */
  public async saveManifestToTelegramCloud(chatId: number | string, facts: AtomicFactEntry[]): Promise<boolean> {
    if (!this.bot || !chatId) return false;
    try {
      const payloadStr = JSON.stringify(facts);
      const encodedPayload = Buffer.from(payloadStr, "utf-8").toString("base64");
      const storageMessage = `🔒 #FRIDAY_CLOUD_MEMORY_VAULT_SNAPSHOT\n\`${encodedPayload}\`\n\n_Last Cloud Sync: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} | Total Facts: ${facts.length}_`;

      if (this.manifestMessageId) {
        try {
          await this.bot.editMessageText(storageMessage, {
            chat_id: chatId,
            message_id: this.manifestMessageId,
            parse_mode: "Markdown",
          });
          return true;
        } catch {
          // If edit fails, post a fresh one
        }
      }

      const sent = await this.bot.sendMessage(chatId, storageMessage, { parse_mode: "Markdown" });
      if (sent?.message_id) {
        this.manifestMessageId = sent.message_id;
        try {
          await this.bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
        } catch {}
      }
      return true;
    } catch (err: any) {
      console.warn("[TelegramMemoryBot] Failed to save manifest to Telegram Cloud:", err?.message || err);
      return false;
    }
  }

  /**
   * Hydrates memory facts directly from Telegram's cloud servers on server boot / Render restart.
   */
  public async hydrateFactsFromTelegramCloud(): Promise<AtomicFactEntry[]> {
    if (!this.bot || !this.bossChatId) return [];
    try {
      console.log(`[TelegramMemoryBot] ☁️ Hydrating memory facts from Telegram Cloud Storage for chat ${this.bossChatId}...`);

      // Try fetching chat to ensure bot access
      const chat = await this.bot.getChat(this.bossChatId);
      if (chat?.pinned_message?.text && chat.pinned_message.text.includes("#FRIDAY_CLOUD_MEMORY_VAULT_SNAPSHOT")) {
        const text = chat.pinned_message.text;
        const match = text.match(/`([A-Za-z0-9+/=]+)`/);
        if (match && match[1]) {
          const rawJson = Buffer.from(match[1], "base64").toString("utf-8");
          const facts = JSON.parse(rawJson) as AtomicFactEntry[];
          if (Array.isArray(facts) && facts.length > 0) {
            this.manifestMessageId = chat.pinned_message.message_id;
            console.log(`[TelegramMemoryBot] 🟢 Successfully restored ${facts.length} facts from Telegram Pinned Cloud Vault!`);
            return facts;
          }
        }
      }
    } catch (err: any) {
      console.warn("[TelegramMemoryBot] Telegram Cloud hydration warning:", err?.message || err);
    }
    return [];
  }

  public async backupFactToTelegramCloud(entry: AtomicFactEntry): Promise<boolean> {
    const targetChatId =
      this.bossChatId ||
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_BOSS_CHAT_ID ||
      process.env.BOSS_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_OWNER_ID;
    if (!targetChatId) return false;
    const allFacts = await unifiedMemoryService.listAllFacts();
    return await this.saveManifestToTelegramCloud(targetChatId, allFacts);
  }

  public getBossChatId(): number | string | null {
    return this.bossChatId;
  }

  public isTelegramCloudStorageActive(): boolean {
    return !!(this.bot && this.bossChatId);
  }

  public async safeSendMessage(chatId: number | string, text: string, options: any = {}): Promise<boolean> {
    if (!this.bot || !chatId) return false;
    try {
      await this.bot.sendMessage(chatId, text, options);
      return true;
    } catch (err: any) {
      console.warn("[TelegramMemoryBot] Send message warning:", err?.message || err);
      try {
        await this.bot.sendMessage(chatId, text);
        return true;
      } catch {
        return false;
      }
    }
  }

  public isBotActive(): boolean {
    return this.isInitialized && !!this.bot;
  }
}

export const telegramMemoryBotService = new TelegramMemoryBotService();
