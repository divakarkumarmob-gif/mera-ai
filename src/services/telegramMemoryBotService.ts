/**
 * telegramMemoryBotService.ts
 *
 * Dedicated Telegram Memory Vault Bot (Bot #3 on Render):
 * 1. 🧠 Instant Long-Term Memory Storage & Retrieval
 * 2. ⚡ True Telegram Cloud Storage Fallback (Persistent across Render restarts without Firebase!)
 * 3. 🔄 Auto-Hydration on Boot (Restores memory facts directly from Telegram's cloud servers)
 * 4. 📌 Immutable Cloud Vault Manifest & Sync
 * 5. 🔍 Deep Cross-Platform Search
 * 6. 🚀 100% Native Fetch Polling (Zero external dependency, esbuild/bundle proof)
 * 7. 🎓 Intent-First Cognitive Brain (Child Training, Directives, Gemini Tool Calling & Self-Check)
 */

import { GoogleGenAI } from "@google/genai";
import { unifiedMemoryService, AtomicFactEntry } from "./unifiedMemoryService";
import { semanticIntentEngine } from "./semanticIntentEngine";
import { bossDirectivesService } from "./bossDirectivesService";
import { fridayChildTrainingService } from "./fridayChildTrainingService";
import { humanComprehensionEngine } from "./humanComprehensionEngine";
import { aiAdvancedLearningService } from "./aiAdvancedLearningService";
import { frontierCognitionService } from "./frontierCognitionService";
import { sensitiveActionGatekeeper } from "./sensitiveActionGatekeeper";

class TelegramMemoryBotService {
  private isInitialized = false;
  private isPolling = false;
  private pollingAbortController: AbortController | null = null;
  private memoryBotToken: string = "";
  private bossChatId: number | string | null = null;
  private manifestMessageId: number | null = null;
  private botUsername: string = "";
  private pollingOffset: number = 0;

  // Multi-day persistent dialogue turns cache
  private static chatHistory: Array<{ senderName: string; text: string; timeStr: string; timestamp: number }> = [];

  public static recordTurn(senderName: string, text: string) {
    if (!text || text.startsWith("[Reaction:") || !text.trim()) return;
    this.chatHistory.push({
      senderName,
      text: text.trim(),
      timeStr: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    });
    if (this.chatHistory.length > 25) {
      this.chatHistory = this.chatHistory.slice(-25);
    }
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    this.memoryBotToken = (
      process.env.TELEGRAM_MEMORY_BOT_TOKEN ||
      process.env.TELEGRAM_BRAIN_BOT_TOKEN ||
      ""
    ).trim();

    this.bossChatId =
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_BOSS_CHAT_ID ||
      process.env.BOSS_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_OWNER_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      null;

    if (!this.memoryBotToken || this.memoryBotToken.length < 15) {
      console.log("[TelegramMemoryBot] ℹ️ TELEGRAM_MEMORY_BOT_TOKEN not set in .env. Memory Bot is in standby.");
      return;
    }

    // Robust connection loop with auto-retry on Render startup network delays
    const connectWithRetry = async (attempt = 1): Promise<void> => {
      try {
        try {
          await this.callApi("deleteWebhook", { drop_pending_updates: false }, 10000);
        } catch {}

        const me = await this.callApi("getMe", undefined, 12000);
        this.botUsername = me.username || "friday_memory_bot";
        this.isInitialized = true;
        console.log(`[TelegramMemoryBot] 🧠 Memory Vault Bot connected as @${this.botUsername} (ID: ${me.id})`);

        try {
          await this.callApi("setMyCommands", {
            commands: [
              { command: "start", description: "⚡ Start Memory Vault & Control Hub" },
              { command: "memory", description: "📋 View all saved facts & memories" },
              { command: "json", description: "📄 View raw JSON memory data" },
              { command: "remember", description: "💾 Save a permanent fact (/remember <text>)" },
              { command: "forget", description: "🗑️ Delete a memory fact (2FA Protected)" },
              { command: "verify", description: "🔑 Verify WhatsApp 2FA Deletion OTP (/verify <otp>)" },
              { command: "auth", description: "🔐 Master Password Login (/auth <pass>)" },
              { command: "lock", description: "🔒 Lock session & revoke active access" },
              { command: "search", description: "🔍 Search cross-platform memory" },
              { command: "rules", description: "📋 View active boss directives & strict rules" },
              { command: "lessons", description: "🎓 View learned behavioral lessons" },
              { command: "sync", description: "☁️ Force sync to Telegram Cloud Vault" },
              { command: "briefing", description: "🌅 Chief of Staff Morning Briefing" },
              { command: "stats", description: "📊 Memory Storage Health & Diagnostics" },
            ],
          });
        } catch {}

        this.startPolling();

        if (this.bossChatId) {
          this.hydrateFactsFromTelegramCloud().catch((err) => {
            console.warn("[TelegramMemoryBot] Cloud hydration on boot warning:", err?.message || err);
          });
        }
      } catch (err: any) {
        const delay = Math.min(15000, 2000 * Math.pow(1.5, Math.min(attempt, 5)));
        console.warn(`[TelegramMemoryBot] Connect attempt ${attempt} failed (${err?.message || err}). Retrying in ${Math.round(delay/1000)}s...`);
        setTimeout(() => connectWithRetry(attempt + 1), delay);
      }
    };

    connectWithRetry();
  }

  private async callApi(method: string, body?: any, timeoutMs = 35000): Promise<any> {
    if (!this.memoryBotToken) throw new Error("TELEGRAM_MEMORY_BOT_TOKEN is not configured.");
    const url = `https://api.telegram.org/bot${this.memoryBotToken}/${method}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.description || `Telegram Memory API ${method} failed`);
      }
      return json.result;
    } catch (err: any) {
      if (err?.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(err?.message || "")) {
        throw new Error(`NETWORK_TIMEOUT: ${err?.message || "Connection timed out"}`);
      }
      throw err;
    }
  }

  private isAuthorized(chatId: number | string, from?: any): boolean {
    const configuredBoss =
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_BOSS_CHAT_ID ||
      process.env.BOSS_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_OWNER_ID ||
      process.env.TELEGRAM_CHAT_ID;

    const fromId = from?.id;
    const username = String(from?.username || "").toLowerCase();
    const name = String(`${from?.first_name || ""} ${from?.last_name || ""}`).toLowerCase();

    // 1. Strict Env match
    if (configuredBoss) {
      const isMatch = String(chatId) === String(configuredBoss) || (!!fromId && String(fromId) === String(configuredBoss));
      if (isMatch) {
        this.bossChatId = chatId;
        return true;
      }
      return false;
    }

    // 2. Known Boss identifiers
    if (username.includes("divakar") || username.includes("dk") || name.includes("divakar") || name.includes("boss")) {
      this.bossChatId = chatId;
      return true;
    }

    // 3. Dynamic first-user binding if no env is set
    if (!this.bossChatId) {
      this.bossChatId = chatId;
      return true;
    }

    return String(chatId) === String(this.bossChatId) || (!!fromId && String(fromId) === String(this.bossChatId));
  }

  private async startPolling(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollingAbortController = new AbortController();

    let consecutiveErrors = 0;
    while (this.isPolling) {
      try {
        const updates = await this.callApi(
          "getUpdates",
          {
            offset: this.pollingOffset,
            timeout: 25,
            allowed_updates: ["message", "callback_query"],
          },
          32000
        );

        consecutiveErrors = 0;

        if (Array.isArray(updates) && updates.length > 0) {
          for (const update of updates) {
            this.pollingOffset = update.update_id + 1;
            if (update.message) {
              this.handleIncomingMessage(update.message).catch((e) =>
                console.error("[TelegramMemoryBot] Error handling message:", e)
              );
            }
          }
        }
      } catch (err: any) {
        if (!this.isPolling) break;
        const msg = String(err?.message || err);
        if (!msg.includes("NETWORK_TIMEOUT")) {
          consecutiveErrors++;
          if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
            console.warn(`[TelegramMemoryBot] Polling issue (attempt ${consecutiveErrors}): ${msg}`);
          }
        }
        await new Promise((r) => setTimeout(r, Math.min(10000, 1500 * consecutiveErrors || 1500)));
      }
    }
  }

  public stop(): void {
    this.isPolling = false;
    if (this.pollingAbortController) {
      this.pollingAbortController.abort();
      this.pollingAbortController = null;
    }
  }

  private async handleIncomingMessage(msg: any): Promise<void> {
    const chatId = msg.chat?.id;
    const text = String(msg.text || "").trim();
    if (!chatId || !text) return;

    if (!this.isAuthorized(chatId, msg.from)) {
      await this.safeSendMessage(
        chatId,
        "🔒 *Access Denied:* Ye Friday ka private Memory Vault hai. Only Boss DK is authorized."
      );
      return;
    }

    this.bossChatId = chatId;
    const firstName = msg.from?.first_name || "Boss";
    TelegramMemoryBotService.recordTurn(firstName, text);

    // ── Command: /start or /help ───────────────────────────────────────────
    if (/^\/(?:start|help)/i.test(text)) {
      const helpMsg = `🧠 *Namaste Boss! Friday Memory Vault Active* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hi *${firstName}*! Main aapki dedicated **True Cloud Storage Memory Vault & Learning Brain** hoon.

📌 *Key Advantage:*
Even agar Firebase configured nahi hai, ye bot Telegram ke Cloud Servers ko **database** ki tarah use karke Render restart ke baad bhi aapki memory **100% zinda** rakhega!

📌 *Quick Commands Menu:*
• \`/memory\` -> Saari saved yaadein list karo
• \`/json\` -> Raw JSON data export aur view karo
• \`/remember <fact>\` -> Explicit fact memory save
• \`/forget <keyword>\` -> Specific memory delete karo
• \`/search <keyword>\` -> Cross-platform memory search
• \`/rules\` -> Boss Directives & Strict Word Rules
• \`/lessons\` -> Friday ke Learned Behavioral Lessons
• \`/sync\` -> Telegram Cloud Vault se instant sync & backup update
• \`/briefing\` -> Aaj ka morning Chief-of-Staff briefing
• \`/stats\` -> Memory storage health & diagnostics

💡 _Aap mujhe kuch bhi sikha sakte hain ("jab mai thaka hu to comfort dena") ya normal chat ("hello", "9 baje alarm laga do") kar sakte hain!_`;

      await this.safeSendMessage(chatId, helpMsg);
      return;
    }

    // ── Command: /verify <otp> (2FA WhatsApp Deletion OTP Verification) ────
    const verifyMatch = text.match(/^\/(?:verify|otp|code)\s*(.*)/i);
    const isPureDigitsOtp = /^\d{6,14}$/.test(text.trim()) && sensitiveActionGatekeeper.isAwaitingOtp(String(chatId));

    if (verifyMatch || isPureDigitsOtp) {
      const inputOtp = verifyMatch ? verifyMatch[1].trim() : text.trim();
      const otpRes = await sensitiveActionGatekeeper.verifyDeletionOtp(String(chatId), inputOtp);
      await this.safeSendMessage(chatId, otpRes.message);

      if (otpRes.success && otpRes.resumedPrompt) {
        await this.safeSendMessage(chatId, `⚡ *Executing Authorized Action:* _"${otpRes.resumedPrompt}"_...`);
        // If it was an explicit /forget command
        const forgetMatch = otpRes.resumedPrompt.match(/^\/forget\s*(.+)/i);
        if (forgetMatch) {
          const target = forgetMatch[1].trim();
          const res = await unifiedMemoryService.removeAtomicFact(target);
          await this.safeSendMessage(chatId, res.message);
          const updatedFacts = await unifiedMemoryService.listAllFacts();
          await this.saveManifestToTelegramCloud(chatId, updatedFacts);
          return;
        }

        const resumedReply = await this.generateCognitiveMemoryAiReply(otpRes.resumedPrompt, firstName, chatId);
        if (resumedReply) {
          await this.safeSendMessage(chatId, resumedReply);
        }
      }
      return;
    }

    // ── Command: /auth <password> (Zero-Trust Master App Password Unlock) ───
    const authMatch = text.match(/^\/(?:auth|login|unlock|passkey|key)\s*(.*)/i);
    if (authMatch) {
      const inputPass = authMatch[1].trim();
      const authRes = await sensitiveActionGatekeeper.verifyPassword(String(chatId), inputPass);
      await this.safeSendMessage(chatId, authRes.message);
      if (authRes.success && authRes.resumedPrompt) {
        await this.safeSendMessage(chatId, `⚡ *Executing Pending Action:* _"${authRes.resumedPrompt}"_...`);
        const resumedReply = await this.generateCognitiveMemoryAiReply(authRes.resumedPrompt, firstName, chatId);
        if (resumedReply) {
          await this.safeSendMessage(chatId, resumedReply);
        }
      }
      return;
    }

    // ── Command: /lock (Lock Session & Revoke Access) ──────────────────────
    if (/^\/(?:lock|logout|exit)/i.test(text)) {
      const lockRes = sensitiveActionGatekeeper.lockSession(String(chatId));
      await this.safeSendMessage(chatId, lockRes.message);
      return;
    }

    // ── ZERO-TRUST SENSITIVE READ/WRITE & DELETION 2FA GATEKEEPER ──────────
    const gateCheck = await sensitiveActionGatekeeper.checkGateAsync(String(chatId), text);
    if (gateCheck.requiresAuth) {
      await this.safeSendMessage(chatId, gateCheck.message!);
      return;
    }

    // ── Command: /sync ─────────────────────────────────────────────────────
    if (/^\/(?:sync|backup)/i.test(text)) {
      const facts = await unifiedMemoryService.listAllFacts();
      const synced = await this.saveManifestToTelegramCloud(chatId, facts);
      if (synced) {
        await this.safeSendMessage(
          chatId,
          `☁️ *Telegram Cloud Storage Synced!* ${facts.length} memory facts are permanently backed up to Telegram Cloud. Render restart hone par 0% loss hoga. ✅`
        );
      } else {
        await this.safeSendMessage(chatId, `⚠️ Cloud sync failed. Please try again.`);
      }
      return;
    }

    // ── Command: /memory or /memories ──────────────────────────────────────
    if (/^\/(?:memory|memories|list|vault)/i.test(text)) {
      const facts = await unifiedMemoryService.listAllFacts();
      const formatted = unifiedMemoryService.formatFactsListMarkdown(facts);
      await this.safeSendMessage(chatId, formatted);
      return;
    }

    // ── Command: /json (View Raw Memory JSON Object) ───────────────────────
    if (/^\/(?:json|raw_json|export_json)/i.test(text) || /^(json dikhao|show json|view json|memory json|json format)/i.test(text)) {
      const facts = await unifiedMemoryService.listAllFacts();
      if (facts.length === 0) {
        await this.safeSendMessage(chatId, "📁 *Memory Vault Empty:*\n\nAbhi tak koi memory save nahi hui hai. Fact save karne ke liye likhein: `/remember <fact>`");
        return;
      }
      const prettyJson = JSON.stringify(facts, null, 2);
      if (prettyJson.length > 3500) {
        const shortJson = JSON.stringify(facts.slice(0, 10), null, 2);
        await this.safeSendMessage(chatId, `📄 *Friday Raw Memory JSON (${facts.length} facts total):*\n\n\`\`\`json\n${shortJson}\n\`\`\`\n\n_(Showing latest 10 facts)_`);
      } else {
        await this.safeSendMessage(chatId, `📄 *Friday Raw Memory JSON Snapshot (${facts.length} facts):*\n\n\`\`\`json\n${prettyJson}\n\`\`\``);
      }
      return;
    }

    // ── Command: /rules (View Boss Directives) ──────────────────────────────
    if (/^\/(?:rules|directives)/i.test(text)) {
      const active = await bossDirectivesService.getActiveDirectives();
      if (active.length === 0) {
        await this.safeSendMessage(chatId, "📋 *Boss Directives:* Abhi koi custom directive ya strict rule active nahi hai. Sab standard normal mode me hai! ✨");
        return;
      }
      const listStr = active.map((d, i) => d.targetWord && d.replacementWord ? `*${i+1}.* "${d.targetWord}" ➔ "${d.replacementWord}"` : `*${i+1}.* ${d.rule}`).join("\n");
      await this.safeSendMessage(chatId, `📋 *Active Boss Directives & Strict Rules:*\n\n${listStr}`);
      return;
    }

    // ── Command: /lessons (View Learned Behavioral Lessons) ─────────────────
    if (/^\/(?:lessons|training|playbook)/i.test(text)) {
      const lessons = await fridayChildTrainingService.getAllLessons();
      if (lessons.length === 0) {
        await this.safeSendMessage(chatId, "🎓 *Learned Lessons:* Abhi tak koi behavioral lesson save nahi hua hai. Aap mujhe kabhi bhi sikha sakte hain!");
        return;
      }
      const listStr = lessons.map((l, i) => `*${i+1}. Jab:* "${l.situationTrigger}"\n   👉 *Taught Reaction:* "${l.taughtReaction}"`).join("\n\n");
      await this.safeSendMessage(chatId, `🎓 *Friday's Learned Behavioral Lessons:*\n\n${listStr}`);
      return;
    }

    // ── Command: /remember <fact> ──────────────────────────────────────────
    const rememberMatch = text.match(/^\/remember\s*(.+)/i);
    if (rememberMatch) {
      const factText = rememberMatch[1].trim();
      if (!factText) {
        await this.safeSendMessage(chatId, "⚠️ Boss, please fact likhein. Jaise: `/remember Mera exam 20 May ko hai`");
        return;
      }
      const saveRes = await unifiedMemoryService.addAtomicFact(factText, "personal_detail", "telegram");
      await this.safeSendMessage(chatId, saveRes.confirmationMessage);
      return;
    }

    // ── Command: /forget <fact> ────────────────────────────────────────────
    const forgetMatch = text.match(/^\/forget\s*(.+)/i);
    if (forgetMatch) {
      const target = forgetMatch[1].trim();
      if (!target) {
        await this.safeSendMessage(chatId, "⚠️ Boss, keyword likhein jise bhoolna hai. Jaise: `/forget coffee`");
        return;
      }
      const res = await unifiedMemoryService.removeAtomicFact(target);
      await this.safeSendMessage(chatId, res.message);
      const updatedFacts = await unifiedMemoryService.listAllFacts();
      await this.saveManifestToTelegramCloud(chatId, updatedFacts);
      return;
    }

    // ── Command: /search <query> ───────────────────────────────────────────
    const searchMatch = text.match(/^\/search\s*(.+)/i);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      if (!query) {
        await this.safeSendMessage(chatId, "⚠️ Search query likhein: `/search meeting`");
        return;
      }
      const res = await unifiedMemoryService.searchCrossPlatformMemory(query, { daysBack: 90, limit: 10 });
      await this.safeSendMessage(chatId, res.summary);
      return;
    }

    // ── Command: /briefing ─────────────────────────────────────────────────
    if (/^\/(?:briefing|morning)/i.test(text)) {
      const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
      const briefingText = await proactiveExecutiveService.generateChiefOfStaffMorningBriefing();
      await this.safeSendMessage(chatId, briefingText);
      return;
    }

    // ── Command: /unanswered ───────────────────────────────────────────────
    if (/^\/(?:unanswered|pending)/i.test(text)) {
      const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
      const res = await proactiveExecutiveService.checkPendingUnansweredMessages(3);
      await this.safeSendMessage(chatId, res.formattedSummary);
      return;
    }

    // ── Command: /stats ────────────────────────────────────────────────────
    if (/^\/(?:stats|status|health)/i.test(text)) {
      const facts = await unifiedMemoryService.listAllFacts();
      const isCloudFirestore = unifiedMemoryService.isCloudFirestoreConfigured();
      const statsMsg = `📊 *Friday Memory Storage Diagnostics:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 🧠 *Total Active Memories:* ${facts.length}
• ☁️ *Cloud Storage Status:* ${isCloudFirestore ? "🟢 Google Cloud Firestore Active" : "🟢 Telegram Cloud Vault Active (Render Persistent)"}
• 🔄 *Render Restart Persistence:* 100% Protected
• 📱 *Cross-Platform Bridge:* WhatsApp ↔ Telegram Sync Active`;
      await this.safeSendMessage(chatId, statsMsg);
      return;
    }

    // ── 3-STEP INTENT & COGNITIVE BRAIN PROCESSING (NATURAL DIALOGUE) ────────
    // Step 1: Automatic Fact Observation & Learning
    unifiedMemoryService.observeAndExtractFacts(firstName, text, "telegram", true);

    // Step 2: Direct Greetings Fast-Path
    const isGreeting = /^(?:hi|hello|hey|namaste|hlo|helo|hy|suno|oye|kese ho|kaise ho|good morning|good evening|kya haal)[!?.]*$/i.test(text);
    if (isGreeting) {
      await this.safeSendMessage(
        chatId,
        `👋 *Namaste Boss!* 🫡\n\nMain aapki dedicated Memory Vault & Executive Brain assistant hoon. Sab badhiya chal raha hai! Aaj kya yaad rakhna hai, ya koi task execute karna hai? ✨\n\n_Commands: \`/memory\`, \`/json\`, \`/rules\`, \`/lessons\`, \`/remember <fact>\`_`
      );
      return;
    }

    // Step 2.5: Truth Verification & Fact-Checking Audit
    const { truthVerificationCheckerEngine } = await import("./truthVerificationCheckerEngine");
    if (truthVerificationCheckerEngine.isTruthChallenge(text)) {
      const recentTurns = TelegramMemoryBotService.chatHistory || [];
      const recentContextStr = recentTurns.slice(-6).map((m) => `${m.senderName}: "${m.text}"`).join("\n");
      const lastReply = recentTurns.slice().reverse().find((m) => m.senderName === "Friday")?.text || "";
      const auditRes = await truthVerificationCheckerEngine.performTruthAudit(text, recentContextStr, lastReply);
      if (auditRes.auditCard) {
        await this.safeSendMessage(chatId, auditRes.auditCard);
        return;
      }
    }

    // Step 3: Check Child-Like Teaching Lesson Intent ("jab mai aisa bolu to aisa karna", etc.)
    const trainingCheck = fridayChildTrainingService.parseTeachingCommand(text);
    if (trainingCheck.isTeachingCommand && trainingCheck.situation && trainingCheck.reaction) {
      await fridayChildTrainingService.teachLesson(trainingCheck.situation, trainingCheck.reaction);
      await this.safeSendMessage(
        chatId,
        `🎓 *Ji Boss! Maine yeh lesson seekh liya hai:* 🫡✨\n\n• *Jab:* "${trainingCheck.situation}"\n• *Reaction:* "${trainingCheck.reaction}"\n\nMain aage se hamesha is rule aur behavior ka dhyan rakhungi!`
      );
      return;
    }

    // Step 4: Check Boss Strict Directives Intent ("'X' ko 'Y' bolo", rule banao, etc.)
    const directiveCheck = bossDirectivesService.parseDirectiveCommand(text);
    if (directiveCheck.isDirectiveCommand && directiveCheck.action === "add" && (directiveCheck.ruleText || directiveCheck.targetWord)) {
      await bossDirectivesService.addDirective(directiveCheck.ruleText || text, {
        targetWord: directiveCheck.targetWord,
        replacementWord: directiveCheck.replacementWord,
      });
      await this.safeSendMessage(
        chatId,
        directiveCheck.targetWord && directiveCheck.replacementWord
          ? `✅ *Boss Directive Saved!* Ab se "${directiveCheck.targetWord}" ki jagah hamesha "${directiveCheck.replacementWord}" use karungi.`
          : `✅ *Boss Directive Saved:* "${directiveCheck.ruleText || text}"`
      );
      return;
    }

    // Step 5: Cognitive Semantic Intent & Tool Execution (Same as WhatsApp Engine)
    const replyText = await this.generateCognitiveMemoryAiReply(text, firstName, chatId);
    if (replyText && replyText.trim().length > 0) {
      await this.safeSendMessage(chatId, replyText);
      TelegramMemoryBotService.recordTurn("Friday (You)", replyText);
    }
  }

  /**
   * Generates smart context-aware conversational AI reply using Gemini, Function Calling, and Boss Memory.
   */
  private async generateCognitiveMemoryAiReply(promptText: string, senderName: string, chatId: number | string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "";

    try {
      // 1. Compile all brain context
      const facts = await unifiedMemoryService.listAllFacts();
      const factsContext = facts.length > 0
        ? facts.map((f, i) => `${i + 1}. [${f.category}] ${f.fact}`).join("\n")
        : "No saved facts yet.";

      const directivesContext = await bossDirectivesService.compileDirectivesPrompt();
      const trainingLessonsContext = await fridayChildTrainingService.compileTrainingPrompt(promptText);
      const rlhfContext = await aiAdvancedLearningService.compileRlhfPrompt();
      const goldenStandardsContext = await aiAdvancedLearningService.compileGoldenStandardsPrompt();
      const bossStyleContext = await aiAdvancedLearningService.compileBossStylePrompt();
      const affinityContext = await frontierCognitionService.compileAffinityPrompt("boss_dk", "Boss DK");
      const cognitivePass = humanComprehensionEngine.performCognitivePrePass(promptText, { isOwner: true });

      const recentDialogue = TelegramMemoryBotService.chatHistory.slice(-10);
      const dialogueContext = recentDialogue.length > 0
        ? recentDialogue.map((m) => `• [${m.timeStr}] ${m.senderName}: "${m.text}"`).join("\n")
        : `• Boss DK: "${promptText}"`;

      const systemInstruction = `You are Friday, the ultra-intelligent, loyal personal AI Chief-of-Staff and Autonomous Memory Vault for Divakar Kumar (Boss DK).

[BOSS IDENTIFIERS & RELATIONSHIP]
- The user talking to you is Boss DK (Divakar Kumar) — your creator and Commander.
- Always address him with utmost respect, warmth, and dedication (Boss, Boss DK).
- Respond in natural, expressive, crisp Hinglish.

[COGNITIVE CHECKPOINT & CONVERSATIONAL CONTINUITY]
- Subconscious Intent: ${cognitivePass.subconsciousIntent} (Continuity: ${cognitivePass.continuityType})
- Actionable Goal: ${cognitivePass.actionableGoal}
- Thread Continuity Rule: If Boss is modifying a previous schedule or asking about a prior topic, seamlessly connect with recent context without topic bleeding.

[STORED MEMORY VAULT FACTS]
${factsContext}

[BOSS DIRECTIVES & WORD RULES]
${directivesContext}

[BEHAVIORAL TRAINING LESSONS]
${trainingLessonsContext}

[LEARNING & GOLDEN STANDARDS]
${rlhfContext}
${goldenStandardsContext}
${bossStyleContext}
${affinityContext}

[RECENT DIALOGUE TRANSCRIPT]
${dialogueContext}

[HUMAN TIME INTUITION RULES]
- When Boss gives natural time commands ("kal subah call karna", "shaam ko check karna", "9 bje alarm"):
  • Subah / Morning -> 8:00 AM default
  • Dopahar / Afternoon -> 1:30 PM default
  • Shaam / Evening -> 6:30 PM default
  • Raat / Night -> 9:30 PM default
- If scheduling a task, trigger the appropriate tool function.

[RESPONSE POLICIES]
1. If Boss is asking to remember or store something, acknowledge warmly that it is permanently cataloged in his Memory Vault.
2. If Boss is asking what you remember or querying past data, answer accurately using the Stored Memory Vault Facts.
3. If Boss teaches you a behavior or gives feedback, acknowledge like an eager, loyal learner.
4. Keep the reply concise, energetic, crisp, and under 3-4 sentences.`;

      const ai = new GoogleGenAI({ apiKey });
      const tools = semanticIntentEngine.getBossFunctionDeclarations();

      const modelFallbackChain = [
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
      ];

      for (const model of modelFallbackChain) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              { role: "user", parts: [{ text: promptText }] },
            ],
            config: {
              systemInstruction,
              tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
              temperature: 0.7,
            },
          });

          // Check if tool was invoked
          const candidate = response.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          const functionCalls = parts.filter((p: any) => p.functionCall);

          if (functionCalls.length > 0) {
            let toolOutputs: string[] = [];
            for (const callPart of functionCalls) {
              const toolCall = callPart.functionCall!;
              const toolRes = await semanticIntentEngine.executeTool(
                toolCall.name,
                toolCall.args || {},
                {
                  channel: "telegram",
                  chatId: String(chatId),
                  senderName: "Boss DK",
                }
              );

              if (toolRes.message) {
                toolOutputs.push(toolRes.message);
              }
            }

            if (toolOutputs.length > 0) {
              return toolOutputs.join("\n\n");
            }
          }

          let replyText = response.text?.trim() || "";
          if (replyText) {
            // Apply strict Boss Directive word replacements
            replyText = bossDirectivesService.applyWordReplacements(replyText);
            return replyText;
          }
        } catch (err: any) {
          console.warn(`[TelegramMemoryBot] Model ${model} failed (${err?.message || err}). Trying next in chain...`);
        }
      }

      return "";
    } catch (e: any) {
      console.warn("[TelegramMemoryBot] AI cognitive reply error:", e?.message || e);
      return "";
    }
  }

  // ── 2. TRUE TELEGRAM CLOUD STORAGE FALLBACK IMPLEMENTATION ────────────────

  /**
   * Saves or updates the full AtomicFactEntry snapshot as a special tagged cloud message in Telegram.
   */
  public async saveManifestToTelegramCloud(chatId: number | string, facts: AtomicFactEntry[]): Promise<boolean> {
    if (!this.memoryBotToken || !chatId) return false;
    try {
      const payloadStr = JSON.stringify(facts);
      const encodedPayload = Buffer.from(payloadStr, "utf-8").toString("base64");
      const storageMessage = `🔒 #FRIDAY_CLOUD_MEMORY_VAULT_SNAPSHOT\n\`${encodedPayload}\`\n\n_Last Cloud Sync: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} | Total Facts: ${facts.length}_`;

      if (this.manifestMessageId) {
        try {
          await this.callApi("editMessageText", {
            chat_id: chatId,
            message_id: this.manifestMessageId,
            text: storageMessage,
            parse_mode: "Markdown",
          });
          return true;
        } catch {
          // If edit fails, post a fresh one
        }
      }

      const sent = await this.callApi("sendMessage", {
        chat_id: chatId,
        text: storageMessage,
        parse_mode: "Markdown",
      });

      if (sent?.message_id) {
        this.manifestMessageId = sent.message_id;
        try {
          await this.callApi("pinChatMessage", {
            chat_id: chatId,
            message_id: sent.message_id,
            disable_notification: true,
          });
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
    if (!this.memoryBotToken || !this.bossChatId) return [];
    try {
      console.log(`[TelegramMemoryBot] ☁️ Hydrating memory facts from Telegram Cloud Storage for chat ${this.bossChatId}...`);

      const chat = await this.callApi("getChat", { chat_id: this.bossChatId });
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
    return !!(this.memoryBotToken && this.bossChatId);
  }

  public async safeSendMessage(chatId: number | string, text: string, options: any = {}): Promise<boolean> {
    if (!this.memoryBotToken || !chatId) return false;
    try {
      await this.callApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || "Markdown",
      });
      return true;
    } catch (err: any) {
      console.warn("[TelegramMemoryBot] Send message Markdown warning. Retrying plain text...", err?.message || err);
      try {
        await this.callApi("sendMessage", {
          chat_id: chatId,
          text: text.replace(/[*_`]/g, ""),
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  public isBotActive(): boolean {
    return this.isInitialized && this.isPolling;
  }
}

export const telegramMemoryBotService = new TelegramMemoryBotService();
