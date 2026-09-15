/**
 * sensitiveActionGatekeeper.ts
 *
 * Multi-Layered Sensitive Action Gatekeeper & Zero-Bulk Deletion Shield:
 * 1. Bulk/Total Wipes are Permanently Forbidden (Only granular/single-item deletions permitted).
 * 2. Full item details (exact memory content, category, timestamp, source) are resolved and displayed on every step.
 * 3. Every single deletion requires Fresh Step-Up Verification:
 *    - Step 1: Master App Password (/auth <password>) with full item preview.
 *    - Step 2: WhatsApp OTP Verification (/verify <code>) with full item details on WhatsApp.
 * 4. Honeypot Trap: Entering the raw 6-digit WhatsApp code directly triggers a security breach alert & immediate lock.
 * 5. Silent 2x Cipher: Entering transformed code does NOT say "matched" or delete immediately.
 *    - Instead says "Approve on WhatsApp" on Telegram.
 *    - Dispatches a final confirmation request to Boss WhatsApp with FULL ITEM DETAILS: "Boss, kya sach me delete kar du?"
 *    - Strict rule: Casual "haa/yes/ok" will NOT delete; Boss MUST explicitly send "yes i want to delete".
 * 6. 3-Strike Permanent System/IP Block:
 *    - More than 3 wrong attempts permanently blocks the session/IP.
 *    - Can ONLY be unblocked by Boss sending "unblock <id>" or "unblock all" from WhatsApp.
 */

import { appSecurityService } from "./appSecurityService";

export interface SensitiveGateResult {
  requiresAuth: boolean;
  isBlocked?: boolean;
  isBulkForbidden?: boolean;
  isStep1Password?: boolean;
  isStep2Otp?: boolean;
  actionDescription?: string;
  itemDetailsPreview?: string;
  isSessionActive: boolean;
  message?: string;
}

interface DeletionFlowState {
  stage: "needs_password" | "needs_otp" | "awaiting_whatsapp_boss_confirmation";
  originChatId: string;
  pendingPrompt: string;
  targetItem: string;
  actionDescription: string;
  itemDetailsPreview: string;
  baseOtp?: string;
  transformedOtp?: string;
  numeric2xOtp?: string;
  otpExpiresAt?: number;
  failedAttempts: number;
}

interface ChatAuthSession {
  authenticatedUntil: number;
  pendingPrompt?: string;
  pendingActionType?: string;
  failedAttempts: number;
  deletionFlow?: DeletionFlowState;
}

class SensitiveActionGatekeeper {
  // Master Password Session TTL: 15 minutes of verified access for general sensitive read/write
  private readonly SESSION_TTL = 15 * 60 * 1000;
  // OTP TTL: 5 minutes
  private readonly OTP_TTL = 5 * 60 * 1000;

  private sessions = new Map<string, ChatAuthSession>();
  private blockedSessions = new Set<string>();
  private globalPendingDeletionFlow: DeletionFlowState | null = null;

  /**
   * Checks if a session or IP is permanently blocked.
   */
  public isBlocked(sessionId: string): boolean {
    return this.blockedSessions.has(sessionId);
  }

  /**
   * Permanently blocks a session/IP after 3 failed attempts and alerts Boss on WhatsApp.
   */
  public async blockSession(sessionId: string, reason = "3 consecutive failed security verification attempts"): Promise<void> {
    this.blockedSessions.add(sessionId);
    this.sessions.delete(sessionId);
    if (this.globalPendingDeletionFlow?.originChatId === sessionId) {
      this.globalPendingDeletionFlow = null;
    }

    const bossPhone = this.getBossWhatsAppNumber();
    const alertMsg =
      `🚨 *CRITICAL SECURITY ALERT: USER / IP BLOCKED* 🛡️\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Boss, 3 se zyada galat OTP/Password attempts detect hone ke baad user ko PERMANENTLY BLOCK kar diya gaya hai!\n\n` +
      `📌 *Blocked Session ID:* \`${sessionId}\`\n` +
      `⚠️ *Reason:* ${reason}\n\n` +
      `👉 *Isko unblock karne ke liye WhatsApp par command dein:*\n` +
      `\`/unblock ${sessionId}\` ya direct likhiye: *"unblock ${sessionId}"* (ya *"unblock all"*)\n\n` +
      `_(System strictly Boss ke WhatsApp order par hi unblock karega)_ ✨`;

    try {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      await sendWhatsAppUnified(bossPhone, alertMsg, { channel: "whatsapp2" });
      console.log(`[SensitiveGatekeeper] Session ${sessionId} permanently BLOCKED. Alert sent to Boss WhatsApp.`);
    } catch (err) {
      console.error(`[SensitiveGatekeeper] Error sending block alert to Boss WhatsApp:`, err);
    }
  }

  /**
   * Unblocks a specific session/IP or all sessions (Only executable by Boss from WhatsApp).
   */
  public unblockSession(sessionId: string): { success: boolean; unblockedCount: number } {
    if (sessionId === "all" || sessionId === "*") {
      const count = this.blockedSessions.size;
      this.blockedSessions.clear();
      this.sessions.clear();
      return { success: true, unblockedCount: count };
    }

    const existed = this.blockedSessions.delete(sessionId);
    this.sessions.delete(sessionId);
    return { success: existed, unblockedCount: existed ? 1 : 0 };
  }

  /**
   * Checks if an action is an attempt to wipe all/bulk data.
   */
  public isBulkDeletionAttempt(promptText: string): boolean {
    const text = (promptText || "").trim();
    if (!text) return false;

    return (
      /^\/forget\s+(?:all|everything|full|sab|saara|sabhi)$/i.test(text) ||
      /(?:delete\s+all|clear\s+all|wipe\s+all|wipe\s+memory|reset\s+brain|format\s+memory|erase\s+all|drop\s+database|destroy\s+all)/i.test(text) ||
      /(?:saari\s+yaadein|sabhi\s+memory|sab\s+kuch)\s+(?:mita\s*do|delete\s*karo|hata\s*do|clear\s*karo)/i.test(text) ||
      /(?:reset\s+directives|clear\s+rules|delete\s+all\s+rules|delete\s+all\s+lessons)/i.test(text) ||
      /(?:remote\s*wipe|killswitch|factory\s*reset)/i.test(text)
    );
  }

  /**
   * Checks if an action is a granular/single-item deletion command.
   */
  public isGranularDeletionAction(promptText: string): { isDeletion: boolean; actionDescription: string; targetItem: string } {
    const text = (promptText || "").trim();
    if (!text) return { isDeletion: false, actionDescription: "", targetItem: "" };

    if (this.isBulkDeletionAttempt(text)) {
      return { isDeletion: true, actionDescription: "Bulk Data Deletion (Forbidden)", targetItem: "all" };
    }

    const GRANULAR_PATTERNS = [
      /^\/forget\s+(.+)$/i,
      /(?:delete|remove|forget|mita\s*do|hata\s*do|clear)\s+(?:fact|memory|note|rule|lesson|contact)\s+(.+)/i,
      /(?:ye\s+memory|is\s+fact\s+ko|is\s+rule\s+ko)\s+(?:delete\s*karo|hata\s*do|mita\s*do)/i,
    ];

    for (const pattern of GRANULAR_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const item = (match[1] || "Specific Memory Item").trim();
        return { isDeletion: true, actionDescription: `Delete Memory: "${item}"`, targetItem: item };
      }
    }

    return { isDeletion: false, actionDescription: "", targetItem: "" };
  }

  /**
   * Resolves full rich item details from memory/directives for display in security alerts.
   */
  public async getDeletionItemDetails(targetQuery: string): Promise<{
    found: boolean;
    previewText: string;
    exactFact?: string;
    category?: string;
    dateStr?: string;
    source?: string;
  }> {
    const q = (targetQuery || "").toLowerCase().trim();
    if (!q) {
      return { found: false, previewText: `• 📌 *Target Query:* "${targetQuery}"` };
    }

    try {
      const { unifiedMemoryService } = await import("./unifiedMemoryService");
      const facts = await unifiedMemoryService.listAllFacts();
      const matched = facts.find(
        (f) => f.fact.toLowerCase().includes(q) || f.category.toLowerCase().includes(q) || q.includes(f.fact.toLowerCase())
      );

      if (matched) {
        return {
          found: true,
          exactFact: matched.fact,
          category: matched.category,
          dateStr: matched.dateStr,
          source: matched.source,
          previewText:
            `• 🧠 *Memory Content:* "${matched.fact}"\n` +
            `• 🏷️ *Category:* \`${matched.category}\`\n` +
            `• 📅 *Recorded On:* ${matched.dateStr || "Recent"}\n` +
            `• 📱 *Source Channel:* ${matched.source || "Telegram Vault"}\n` +
            `• 🆔 *Fact ID:* \`${matched.id}\``,
        };
      }

      // Check Boss Directives
      const { bossDirectivesService } = await import("./bossDirectivesService");
      const directives = await bossDirectivesService.getActiveDirectives();
      const matchedDirective = directives.find(
        (d) => (d.targetWord && d.targetWord.toLowerCase().includes(q)) || d.rule.toLowerCase().includes(q)
      );

      if (matchedDirective) {
        return {
          found: true,
          exactFact: matchedDirective.rule,
          category: "boss_directive",
          previewText:
            `• 📋 *Directive Rule:* "${matchedDirective.rule}"\n` +
            (matchedDirective.targetWord ? `• 🔄 *Replacement Word:* "${matchedDirective.targetWord}" ➔ "${matchedDirective.replacementWord}"\n` : "") +
            `• 🏷️ *Category:* \`boss_directive\``,
        };
      }

      // Check Lessons
      const { fridayChildTrainingService } = await import("./fridayChildTrainingService");
      const lessons = await fridayChildTrainingService.getAllLessons();
      const matchedLesson = lessons.find(
        (l) => l.situationTrigger.toLowerCase().includes(q) || l.taughtReaction.toLowerCase().includes(q)
      );

      if (matchedLesson) {
        return {
          found: true,
          exactFact: matchedLesson.situationTrigger,
          category: "behavioral_lesson",
          previewText:
            `• 🎓 *Lesson Trigger:* "${matchedLesson.situationTrigger}"\n` +
            `• 👉 *Taught Reaction:* "${matchedLesson.taughtReaction}"\n` +
            `• 🏷️ *Category:* \`child_training_lesson\``,
        };
      }
    } catch (e) {
      console.warn("[SensitiveGatekeeper] Error resolving item details:", e);
    }

    return {
      found: false,
      previewText: `• 📌 *Target Query:* "${targetQuery}"\n• ℹ️ *Info:* Record matching this topic will be removed`,
    };
  }

  /**
   * Identifies if an action is a general sensitive read/write action.
   */
  public isSensitiveAction(promptText: string): { isSensitive: boolean; actionDescription: string } {
    const text = (promptText || "").trim();
    if (!text) return { isSensitive: false, actionDescription: "" };

    const delCheck = this.isGranularDeletionAction(text);
    if (delCheck.isDeletion) {
      return { isSensitive: true, actionDescription: delCheck.actionDescription };
    }

    const SENSITIVE_READ_PATTERNS = [
      /(?:app\s*key|app\s*password|master\s*key|master\s*password|vault\s*key|vault\s*password|login\s*password|wifi\s*password|passkey|secret\s*key)/i,
      /(?:password|pin|otp|cvv|bank\s*account|debit\s*card|credit\s*card|upi\s*pin|credentials?|secret)\s+(?:batao|dikhao|kya\s*hai|de\s*do|show|view|read|get|check|likho|save)/i,
      /(?:show|view|read|get|check)\s+(?:password|pin|otp|credentials?|secret|master\s*key)/i,
      /(?:\/unblock\s+all|logout\s+all|unblock\s+all\s+clients)/i,
    ];

    for (const pattern of SENSITIVE_READ_PATTERNS) {
      if (pattern.test(text)) {
        if (/password|pin|otp|credentials?|secret|app\s*key/i.test(text)) {
          return { isSensitive: true, actionDescription: "Sensitive Password / Vault Credential Access" };
        }
        return { isSensitive: true, actionDescription: "Restricted Administrative Action" };
      }
    }

    return { isSensitive: false, actionDescription: "" };
  }

  /**
   * Checks session status for a chat/user.
   */
  public isSessionAuthenticated(sessionId: string): boolean {
    if (this.isBlocked(sessionId)) return false;
    const sess = this.sessions.get(sessionId);
    if (!sess) return false;
    if (Date.now() > sess.authenticatedUntil) {
      sess.authenticatedUntil = 0;
      return false;
    }
    return true;
  }

  /**
   * Resolves Boss's WhatsApp phone number.
   */
  public getBossWhatsAppNumber(): string {
    const candidates = [
      process.env.WHATSAPP_OWNER_PHONE,
      process.env.BOSS_WHATSAPP_PHONE,
      process.env.WHATSAPP_OWNER_NUMBER,
      process.env.WHATSAPP_BOSS_PHONE,
      process.env.OWNER_WHATSAPP_NUMBER,
      process.env.BOSS_WHATSAPP_NUMBER,
      process.env.OWNER_PHONE,
      process.env.BOSS_PHONE,
      "919999999999",
    ].filter(Boolean) as string[];

    for (const raw of candidates) {
      const clean = raw.replace(/\D/g, "");
      if (clean.length >= 10) return clean;
    }
    return "919999999999";
  }

  /**
   * Evaluates if an incoming prompt needs authentication before proceeding.
   */
  public async checkGateAsync(sessionId: string, promptText: string): Promise<SensitiveGateResult> {
    const text = (promptText || "").trim();

    // 0. Check if user/session is permanently blocked
    if (this.isBlocked(sessionId)) {
      return {
        requiresAuth: true,
        isBlocked: true,
        isSessionActive: false,
        message:
          `🚨 *SYSTEM / IP PERMANENTLY BLOCKED* 🛡️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `3 se zyada galat security attempts detect hone ke karan aapka access block kar diya gaya hai.\n\n` +
          `⚠️ *Security Policy:* Yeh block sirf **Boss DK apne WhatsApp se** unblock command bhejkar hi hata sakte hain.`,
      };
    }

    // 1. Permanently block bulk wipe requests
    if (this.isBulkDeletionAttempt(text)) {
      return {
        requiresAuth: true,
        isBulkForbidden: true,
        isSessionActive: false,
        message:
          `🚫 *BULK WIPE PERMANENTLY FORBIDDEN* 🛡️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Safety policy ke mutabiq saara data ek sath kabhi delete nahi kiya ja sakta.\n\n` +
          `Memory ko sirf **thoda-thoda (item-by-item)** hi delete kiya ja sakta hai:\n` +
          `👉 Jaise: \`/forget <specific_topic>\``,
      };
    }

    // 2. Check for Granular Deletion (Requires Multi-Step Auth: App Password -> WhatsApp OTP -> WhatsApp Approval)
    const delCheck = this.isGranularDeletionAction(text);
    if (delCheck.isDeletion) {
      const details = await this.getDeletionItemDetails(delCheck.targetItem);

      const sess = this.sessions.get(sessionId) || { authenticatedUntil: 0, failedAttempts: 0 };
      const flowState: DeletionFlowState = {
        stage: "needs_password",
        originChatId: sessionId,
        pendingPrompt: text,
        targetItem: delCheck.targetItem,
        actionDescription: delCheck.actionDescription,
        itemDetailsPreview: details.previewText,
        failedAttempts: 0,
      };
      sess.deletionFlow = flowState;
      this.sessions.set(sessionId, sess);
      this.globalPendingDeletionFlow = flowState;

      const promptMsg =
        `🔐 *DELETION SECURITY — STEP 1 OF 2* 🛡️\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Boss, aap ye data delete karne ja rahe hain:\n\n` +
        `📋 *EXACT DATA TO BE DELETED:*\n` +
        `${details.previewText}\n\n` +
        `Data deletion ke liye **Master App Password** enter karna anivarya hai.\n\n` +
        `👉 *Kripya reply karein:* \`/auth <password>\``;

      return {
        requiresAuth: true,
        isStep1Password: true,
        actionDescription: delCheck.actionDescription,
        itemDetailsPreview: details.previewText,
        isSessionActive: false,
        message: promptMsg,
      };
    }

    // 3. Check for General Sensitive Read/Write
    const sensCheck = this.isSensitiveAction(text);
    if (!sensCheck.isSensitive) {
      return { requiresAuth: false, isSessionActive: this.isSessionAuthenticated(sessionId) };
    }

    if (this.isSessionAuthenticated(sessionId)) {
      const sess = this.sessions.get(sessionId);
      if (sess) sess.authenticatedUntil = Date.now() + this.SESSION_TTL;
      return { requiresAuth: false, actionDescription: sensCheck.actionDescription, isSessionActive: true };
    }

    const current = this.sessions.get(sessionId) || { authenticatedUntil: 0, failedAttempts: 0 };
    current.pendingPrompt = text;
    current.pendingActionType = sensCheck.actionDescription;
    this.sessions.set(sessionId, current);

    const promptMessage =
      `🔐 *ZERO-TRUST SECURITY AUTHENTICATION REQUIRED* 🛡️\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Boss, yeh ek **Sensitive Action** hai:\n` +
      `📌 *Action:* _${sensCheck.actionDescription}_\n\n` +
      `Security policy ke mutabiq sensitive data read/write karne ke liye **Master App Password** enter karna zaroori hai.\n\n` +
      `👉 *Kripya reply karein:* \`/auth <password>\` ya direct password likhiye.\n` +
      `_(Ek baar verify hone par agle 15 minutes tak access active rahega)_ ✨`;

    return {
      requiresAuth: true,
      actionDescription: sensCheck.actionDescription,
      isSessionActive: false,
      message: promptMessage,
    };
  }

  /**
   * Verifies Master App Password.
   * On 3 failed attempts, permanently blocks session and notifies Boss WhatsApp.
   */
  public async verifyPassword(
    sessionId: string,
    inputPassword: string
  ): Promise<{ success: boolean; message: string; requiresStep2Otp?: boolean; resumedPrompt?: string }> {
    if (this.isBlocked(sessionId)) {
      return {
        success: false,
        message: `🚨 *SYSTEM / IP PERMANENTLY BLOCKED:* 3 se zyada galat attempts ke baad access block hai. Only Boss can unblock from WhatsApp.`,
      };
    }

    const raw = String(inputPassword || "").trim();
    if (!raw) {
      return { success: false, message: "⚠️ Kripya password enter karein: `/auth <password>`" };
    }

    const appKey = await appSecurityService.getAppKey();
    const vaultMasterKey = (process.env.VAULT_MASTER_KEY || "friday_super_secret_master_vault_key_2026").trim();
    const envKey = (process.env.APP_KEY || process.env.APP_PASSWORD || "").trim();

    const isMatch =
      (appKey && raw === appKey) ||
      (vaultMasterKey && raw === vaultMasterKey) ||
      (envKey && raw === envKey);

    const sess = this.sessions.get(sessionId) || { authenticatedUntil: 0, failedAttempts: 0 };

    if (!isMatch) {
      sess.failedAttempts = (sess.failedAttempts || 0) + 1;
      this.sessions.set(sessionId, sess);

      if (sess.failedAttempts >= 3) {
        await this.blockSession(sessionId, "3 consecutive incorrect Master Password attempts");
        return {
          success: false,
          message:
            `🚨 *SYSTEM / IP PERMANENTLY BLOCKED!* 🛡️\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `3 galat password attempts detect hone par security lock activate ho gaya hai.\n` +
            `Boss ke WhatsApp par unblock alert bhej diya gaya hai. Only Boss can unblock from WhatsApp.`,
        };
      }

      return {
        success: false,
        message: `❌ *ACCESS DENIED:* Galat App Password! (Attempt ${sess.failedAttempts}/3)\n_Kripya sahi Master Password enter karein._`,
      };
    }

    // Check if we are in Deletion Step 1 -> Transition to Step 2 (WhatsApp Security Code)
    if (sess.deletionFlow && sess.deletionFlow.stage === "needs_password") {
      const baseOtp = Math.floor(100000 + Math.random() * 900000).toString();

      // Silent Mathematical Cipher
      const transformedOtp = baseOtp
        .split("")
        .map((digit) => String(parseInt(digit, 10) * 2))
        .join("");
      const numeric2xOtp = String(parseInt(baseOtp, 10) * 2);

      sess.deletionFlow.stage = "needs_otp";
      sess.deletionFlow.baseOtp = baseOtp;
      sess.deletionFlow.transformedOtp = transformedOtp;
      sess.deletionFlow.numeric2xOtp = numeric2xOtp;
      sess.deletionFlow.otpExpiresAt = Date.now() + this.OTP_TTL;
      sess.deletionFlow.failedAttempts = 0;
      this.sessions.set(sessionId, sess);
      this.globalPendingDeletionFlow = sess.deletionFlow;

      // Send Base Security Code to Boss WhatsApp cleanly with FULL ITEM DETAILS
      const bossPhone = this.getBossWhatsAppNumber();
      const waAlert =
        `🚨 *FRIDAY HIGH-SECURITY ALERT* 🛡️\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Boss, Telegram par ye data delete karne ki authorization request aayi hai:\n\n` +
        `📋 *EXACT DATA DETAILS:*\n` +
        `${sess.deletionFlow.itemDetailsPreview}\n\n` +
        `🔑 *Security Code:* *${baseOtp}*\n` +
        `⏳ *Validity:* 5 Minutes`;

      try {
        const { sendWhatsAppUnified } = await import("./whatsappService");
        await sendWhatsAppUnified(bossPhone, waAlert, { channel: "whatsapp2" });
        console.log(`[SensitiveGatekeeper] Deletion OTP sent to WhatsApp: ${baseOtp}`);
      } catch (err) {
        console.error(`[SensitiveGatekeeper] Failed to send WhatsApp OTP:`, err);
      }

      const step2Msg =
        `✅ *APP PASSWORD VERIFIED!* 🔓\n\n` +
        `🛡️ *DELETION SECURITY — STEP 2 OF 2*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *Target Data:* _"${sess.deletionFlow.targetItem}"_\n` +
        `📲 Verification Security Code aapke **WhatsApp** par deliver kar diya gaya hai (with item details).\n\n` +
        `👉 WhatsApp check karein aur verification command dein:\n` +
        `\`/verify <code>\``;

      return {
        success: true,
        requiresStep2Otp: true,
        message: step2Msg,
      };
    }

    // General Sensitive Session Grant
    const resumedPrompt = sess.pendingPrompt;
    sess.pendingPrompt = undefined;
    sess.authenticatedUntil = Date.now() + this.SESSION_TTL;
    sess.failedAttempts = 0;
    this.sessions.set(sessionId, sess);

    return {
      success: true,
      message: `🔓 *IDENTITY VERIFIED — ACCESS GRANTED!* ⚡\nMaster App Password verify ho gaya hai. Agle **15 minutes** ke liye sensitive read & write access unlock hai! ✅`,
      resumedPrompt,
    };
  }

  /**
   * Verifies the Step 2 Deletion OTP.
   * - If raw base code is entered: Direct Warning & Honeypot Lock!
   * - If 3 wrong attempts occur: Permanently blocks session & sends unblock request to Boss WhatsApp.
   * - If transformed code is entered: Tells Telegram "Approve on WhatsApp" and sends confirmation prompt to Boss WhatsApp with FULL ITEM DETAILS.
   */
  public async verifyDeletionOtp(
    sessionId: string,
    inputOtp: string
  ): Promise<{ success: boolean; isHoneypot?: boolean; message: string; requiresWhatsAppApproval?: boolean; resumedPrompt?: string }> {
    if (this.isBlocked(sessionId)) {
      return {
        success: false,
        message: `🚨 *SYSTEM / IP PERMANENTLY BLOCKED:* 3 se zyada galat attempts ke baad access block hai. Only Boss can unblock from WhatsApp.`,
      };
    }

    const sess = this.sessions.get(sessionId);
    const flow = sess?.deletionFlow;

    if (!flow || flow.stage !== "needs_otp" || !flow.otpExpiresAt || Date.now() > flow.otpExpiresAt) {
      if (sess) sess.deletionFlow = undefined;
      this.globalPendingDeletionFlow = null;
      return {
        success: false,
        message: `⌛ *REQUEST EXPIRED YA NOT FOUND:*\nKoi active deletion authorization session nahi mila. Kripya command dobara dein.`,
      };
    }

    const cleanInput = String(inputOtp || "").trim().replace(/\s+/g, "");
    if (!cleanInput) {
      return { success: false, message: `⚠️ Kripya verification code enter karein: \`/verify <code>\`` };
    }

    // ── HONEYPOT CHECK: Raw WhatsApp 6-digit base code entered directly! ──
    if (flow.baseOtp && cleanInput === flow.baseOtp) {
      await this.blockSession(sessionId, "Raw honeypot security code directly entered");
      return {
        success: false,
        isHoneypot: true,
        message:
          `🚨 *SECURITY BREACH DETECTED: PERMANENT SYSTEM BLOCK!* 🛡️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Raw security code directly enter karne ke karan system/IP ko block kar diya gaya hai.\n` +
          `Boss ke WhatsApp par security alert bhej diya gaya hai. Only Boss can unblock from WhatsApp.`,
      };
    }

    // ── CIPHER VERIFICATION ──
    const isMatch =
      cleanInput === flow.transformedOtp ||
      cleanInput === flow.numeric2xOtp;

    if (!isMatch) {
      flow.failedAttempts = (flow.failedAttempts || 0) + 1;
      if (flow.failedAttempts >= 3) {
        await this.blockSession(sessionId, "3 consecutive incorrect OTP verification attempts");
        return {
          success: false,
          message:
            `🚨 *SYSTEM / IP PERMANENTLY BLOCKED!* 🛡️\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `3 galat verification attempts detect hone par session block kar di gayi hai.\n` +
            `Boss ke WhatsApp par unblock alert deliver ho gaya hai. Only Boss can unblock from WhatsApp.`,
        };
      }
      return {
        success: false,
        message: `❌ *INVALID CODE:* Entered verification code galat hai! (Attempt ${flow.failedAttempts}/3)`,
      };
    }

    // ── CIPHER MATCHED: Transition to WhatsApp Direct Boss Confirmation Stage! ──
    flow.stage = "awaiting_whatsapp_boss_confirmation";
    flow.failedAttempts = 0;
    sess.deletionFlow = flow;
    this.sessions.set(sessionId, sess);
    this.globalPendingDeletionFlow = flow;

    // Send Direct Confirmation to Boss WhatsApp with FULL DETAILS
    const bossPhone = this.getBossWhatsAppNumber();
    const bossConfirmMsg =
      `🚨 *FRIDAY FINAL DELETION CONFIRMATION* 🛡️\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Boss, Telegram par ye memory permanently delete karne ki request aayi hai:\n\n` +
      `📋 *EXACT DATA TO BE DELETED:*\n` +
      `${flow.itemDetailsPreview}\n\n` +
      `Boss, kya sach me isko delete kar du?\n\n` +
      `⚠️ *Safety Rule:* Sirf "haa", "yes" ya "ok" bolne se delete nahi hoga. Confirm karne ke liye exact likhiye:\n` +
      `👉 *"yes i want to delete"*\n\n` +
      `_(Cancel karne ke liye likhein: "cancel")_`;

    try {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      await sendWhatsAppUnified(bossPhone, bossConfirmMsg, { channel: "whatsapp2" });
      console.log(`[SensitiveGatekeeper] Final confirmation prompt with full details sent to Boss WhatsApp (${bossPhone})`);
    } catch (err) {
      console.error(`[SensitiveGatekeeper] Failed to send WhatsApp confirmation prompt:`, err);
    }

    // Do NOT say "matched" on Telegram -> Prompt user to approve on WhatsApp!
    const tgReply =
      `⚠️ *ACTION PENDING BOSS APPROVAL ON WHATSAPP* 🛡️\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Target Item:* _${flow.actionDescription}_\n\n` +
      `Authorization code accept ho gaya hai. Final deletion execute karne ke liye Boss DK ka WhatsApp par direct confirmation anivarya hai.\n\n` +
      `👉 *Next Step:* _Approve on WhatsApp_ ✨`;

    return {
      success: true,
      requiresWhatsAppApproval: true,
      message: tgReply,
    };
  }

  /**
   * Handles Boss WhatsApp Direct Approval Flow & Unblock Commands.
   * Called when Boss messages on WhatsApp.
   */
  public async handleWhatsAppBossApproval(
    senderPhone: string,
    messageText: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const rawText = (messageText || "").trim();
    const text = rawText.toLowerCase();

    // ── 1. BOSS UNBLOCK COMMANDS ON WHATSAPP ──────────────────────────────
    const unblockMatch = rawText.match(/^\/?(?:unblock|unban)\s*(.*)/i);
    if (unblockMatch) {
      const target = unblockMatch[1].trim() || "all";
      const res = this.unblockSession(target);

      if (target.toLowerCase() === "all") {
        // Broadcast to Telegram that system is unblocked
        try {
          const { telegramMemoryBotService } = await import("./telegramMemoryBotService");
          if (telegramMemoryBotService.getBossChatId()) {
            await telegramMemoryBotService.safeSendMessage(
              telegramMemoryBotService.getBossChatId()!,
              `🔓 *SYSTEM UNBLOCKED:* Boss DK ne WhatsApp se saare security blocks hata diye hain. System fully accessible hai! ✅`
            );
          }
        } catch {}

        return {
          handled: true,
          replyText: `🔓 *ALL BLOCKS CLEARED!* ⚡\n\nBoss, saare blocked sessions & IPs successfully unblock kar diye gaye hain (${res.unblockedCount} unblocked). System normal mode me hai! ✅`,
        };
      }

      // Unblock specific target
      try {
        const { telegramMemoryBotService } = await import("./telegramMemoryBotService");
        await telegramMemoryBotService.safeSendMessage(
          target,
          `🔓 *ACCESS RESTORED:* Boss DK ne WhatsApp se aapka security block hata diya hai. Aap ab system use kar sakte hain! ✅`
        );
      } catch {}

      return {
        handled: true,
        replyText: `🔓 *USER / IP UNBLOCKED:* Session \`${target}\` successfully unblock ho gaya hai! ✅`,
      };
    }

    // ── 2. BOSS DELETION APPROVAL / CANCELLATION FLOW ─────────────────────
    const flow = this.globalPendingDeletionFlow;
    if (!flow || flow.stage !== "awaiting_whatsapp_boss_confirmation") {
      return { handled: false };
    }

    // Check for Cancel
    if (/^(cancel|no|mat\s*karo|rehnde\s*do|ruk\s*jao|stop)$/i.test(text)) {
      this.globalPendingDeletionFlow = null;
      const originSess = this.sessions.get(flow.originChatId);
      if (originSess) originSess.deletionFlow = undefined;

      // Notify Telegram of cancellation
      try {
        const { telegramMemoryBotService } = await import("./telegramMemoryBotService");
        await telegramMemoryBotService.safeSendMessage(
          flow.originChatId,
          `🛑 *DELETION CANCELLED:* Boss DK ne WhatsApp par deletion request cancel kar di hai.`
        );
      } catch {}

      return {
        handled: true,
        replyText: `🛑 *DELETION CANCELLED:* Request cancel kar di gayi hai. Koi data delete nahi kiya gaya! ✅`,
      };
    }

    // Check for exact confirmation phrase "yes i want to delete"
    if (text === "yes i want to delete") {
      this.globalPendingDeletionFlow = null;
      const originSess = this.sessions.get(flow.originChatId);
      if (originSess) originSess.deletionFlow = undefined;

      // Execute the deletion
      const { unifiedMemoryService } = await import("./unifiedMemoryService");
      const delRes = await unifiedMemoryService.removeAtomicFact(flow.targetItem);

      // Sync Telegram Cloud Vault
      try {
        const { telegramMemoryBotService } = await import("./telegramMemoryBotService");
        const updatedFacts = await unifiedMemoryService.listAllFacts();
        await telegramMemoryBotService.saveManifestToTelegramCloud(flow.originChatId, updatedFacts);

        // Notify Telegram chat that Boss confirmed & item is deleted
        await telegramMemoryBotService.safeSendMessage(
          flow.originChatId,
          `✅ *DELETION EXECUTED:* Boss DK ne WhatsApp par *"yes i want to delete"* confirm kar diya hai.\n\n🗑️ *Deleted Record:*\n${flow.itemDetailsPreview}\n\n• Status: ${delRes.message}`
        );
      } catch (err) {
        console.error("[SensitiveGatekeeper] Cloud sync error after deletion:", err);
      }

      return {
        handled: true,
        replyText:
          `✅ *DELETION CONFIRMED & EXECUTED!* 🗑️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 *Deleted Record:*\n${flow.itemDetailsPreview}\n\n` +
          `Telegram Cloud Vault aur Memory successfully updated! ✅`,
      };
    }

    // Check if Boss sent a casual/partial agreement like "haa", "yes", "ok", "kardo"
    if (/^(haa|ha|yes|yep|delete\s*kar\s*do|ok|okay|kardo|haa\s*kardo)$/i.test(text)) {
      return {
        handled: true,
        replyText:
          `⚠️ *SAFETY CONFIRMATION PHRASE REQUIRED* 🛡️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 *Item:* "${flow.targetItem}"\n\n` +
          `Boss, accidental deletion se bachne ke liye sirf "haa" ya "ok" se delete nahi hoga.\n\n` +
          `👉 Kripya exact likhiye:\n` +
          `*"yes i want to delete"*\n\n` +
          `_(Ya cancel karne ke liye "cancel" likhein)_`,
      };
    }

    return { handled: false };
  }

  /**
   * Checks if session is currently waiting for Step 2 OTP.
   */
  public isAwaitingOtp(sessionId: string): boolean {
    if (this.isBlocked(sessionId)) return false;
    const sess = this.sessions.get(sessionId);
    return !!(
      sess?.deletionFlow &&
      sess.deletionFlow.stage === "needs_otp" &&
      sess.deletionFlow.otpExpiresAt &&
      Date.now() <= sess.deletionFlow.otpExpiresAt
    );
  }

  /**
   * Immediately locks session & revokes authentication.
   */
  public lockSession(sessionId: string): { message: string } {
    this.sessions.delete(sessionId);
    this.globalPendingDeletionFlow = null;
    return {
      message: `🔒 *SESSION LOCKED!* 🛡️\n\nSensitive access turant revoke kar diya gaya hai.`,
    };
  }
}

export const sensitiveActionGatekeeper = new SensitiveActionGatekeeper();
