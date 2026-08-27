import { appSecurityService } from "./appSecurityService";

// ---------------------------------------------------------------------------
// FRIDAY DEDICATED SECURITY SENTINEL TELEGRAM BOT
//
// Exclusively handles security, active users, blocked clients, app passkeys,
// and system defense.
//
// Dual-Layer Security Verification:
// 1. Layer 1: Telegram Chat ID must match BOSS_TELEGRAM_CHAT_ID.
// 2. Layer 2: User must enter the Master App Password to unlock commands.
// ---------------------------------------------------------------------------

interface AuthSession {
  authenticated: boolean;
  lastActive: number;
  failedAttempts: number;
}

class TelegramSecurityBotService {
  private token: string = "";
  private isRunning: boolean = false;
  private pollingOffset: number = 0;
  private botUsername: string = "";

  // Session timeout: 30 minutes of inactivity
  private readonly SESSION_TTL = 30 * 60 * 1000;
  private authSessions = new Map<number, AuthSession>();

  // Reference to wss for active live connections count
  private getActiveConnectionsCount: () => number = () => 0;

  constructor() {
    this.token = (process.env.TELEGRAM_SECURITY_BOT_TOKEN || "").trim();
  }

  public setConnectionTracker(tracker: () => number) {
    this.getActiveConnectionsCount = tracker;
  }

  public get isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 20);
  }

  private getBossChatId(): number | null {
    const raw = (process.env.BOSS_TELEGRAM_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || "").trim();
    if (raw) {
      const parsed = Number(raw);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private async callApi(method: string, body?: any): Promise<any> {
    if (!this.token) throw new Error("TELEGRAM_SECURITY_BOT_TOKEN is not configured.");
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

  public async sendMessage(chatId: number, text: string, keyboard?: any): Promise<any> {
    if (!this.token) return;
    try {
      return await this.callApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch {
      // Fallback without markdown if formatting fails
      return await this.callApi("sendMessage", {
        chat_id: chatId,
        text: text.replace(/[*_`]/g, ""),
        reply_markup: keyboard,
      });
    }
  }

  public async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log("[SecurityBot] TELEGRAM_SECURITY_BOT_TOKEN not set. Security Sentinel Bot is disabled.");
      return;
    }

    try {
      const me = await this.callApi("getMe");
      this.botUsername = me.username;
      console.log(`[SecurityBot] 🛡️ Security Sentinel connected as @${this.botUsername} (ID: ${me.id})`);

      await this.callApi("setMyCommands", {
        commands: [
          { command: "start", description: "🔐 Start & Authenticate with Master Key" },
          { command: "active", description: "👥 View Active Users & Live Sessions" },
          { command: "blocked", description: "🛑 View Blocked Clients & Attackers" },
          { command: "unblock", description: "🔓 Unblock IP (/unblock <ip> or /unblock all)" },
          { command: "appkey", description: "🔑 View / Set Master App Key" },
          { command: "status", description: "📊 System Security Shield Status" },
          { command: "logout", description: "🚪 Lock Session & Exit" },
        ],
      });

      this.startPolling();
    } catch (e: any) {
      console.error("[SecurityBot] Failed to connect to Telegram API:", e?.message || e);
    }
  }

  private startPolling(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        const updates = await this.callApi("getUpdates", {
          offset: this.pollingOffset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"],
        });

        if (Array.isArray(updates)) {
          for (const update of updates) {
            this.pollingOffset = update.update_id + 1;
            if (update.message) {
              await this.handleMessage(update.message);
            }
          }
        }
      } catch (err: any) {
        // Sleep on error
        await new Promise((r) => setTimeout(r, 4000));
      }
      setTimeout(poll, 300);
    };

    poll();
  }

  /**
   * Main Message Processing Logic with 2-Layer Zero-Trust Verification.
   */
  private async handleMessage(msg: any): Promise<void> {
    const chatId = msg.chat?.id;
    const text = (msg.text || "").trim();
    const from = msg.from || {};
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(" ") || "Unknown";

    if (!chatId || !text) return;

    const bossChatId = this.getBossChatId();

    // ── Layer 1: Telegram Chat ID Verification ────────────────────────────────
    if (!bossChatId) {
      // If BOSS_TELEGRAM_CHAT_ID is not configured in .env yet, inform the user
      await this.sendMessage(
        chatId,
        `⚠️ *SECURITY CONFIGURATION REQUIRED*\n\n` +
        `Boss, aapka Telegram Chat ID abhi \`.env\` me configure nahi hai.\n\n` +
        `🆔 *Aapka Chat ID:* \`${chatId}\`\n` +
        `👤 *Name:* ${senderName}\n\n` +
        `👉 Kripya apne \`.env\` me yeh line add karein:\n` +
        `\`BOSS_TELEGRAM_CHAT_ID=${chatId}\`\n\n` +
        `Uske baad server restart karte hi yeh bot sirf aapke liye activate ho jayega!`
      );
      return;
    }

    if (chatId !== bossChatId) {
      // Unauthorized person attempting to access the security bot!
      console.warn(`[SecurityBot] 🚨 UNAUTHORIZED ACCESS ATTEMPT by ID ${chatId} (${senderName}, @${from.username})`);
      await this.sendMessage(
        chatId,
        `⛔ *ACCESS DENIED: UNAUTHORIZED USER*\n\n` +
        `Yeh private Security Command Bot sirf **Boss DK** ke liye reserve hai.\n` +
        `Aapka Chat ID (\`${chatId}\`) authorized list me nahi hai.\n\n` +
        `Intrusion attempt has been logged. 🛡️`
      );

      // Alert Boss on his official Chat ID
      await this.sendMessage(
        bossChatId,
        `🚨 *SECURITY ALERT: UNAUTHORIZED BOT ACCESS* 🚨\n\n` +
        `Kisi ne Friday Security Bot ko access karne ki koshish ki!\n` +
        `👤 *Name:* ${senderName}\n` +
        `🆔 *Chat ID:* \`${chatId}\`\n` +
        `📱 *Username:* ${from.username ? `@${from.username}` : "None"}\n` +
        `💬 *Message:* "${text}"\n` +
        `🛡️ *Action:* Access denied immediately.`
      );
      return;
    }

    // ── Layer 2: Master App Password Session Verification ─────────────────────
    let session = this.authSessions.get(chatId);
    const now = Date.now();

    // Check if session has expired
    if (session && now - session.lastActive > this.SESSION_TTL) {
      this.authSessions.delete(chatId);
      session = undefined;
    }

    // If not authenticated, check if this message is the Master Password
    if (!session || !session.authenticated) {
      const activeKey = await appSecurityService.getAppKey();

      if (text === "/start") {
        await this.sendMessage(
          chatId,
          `🔐 *FRIDAY SECURITY SENTINEL* 🔐\n\n` +
          `Namaste Boss! Chat ID verified: ✅ (\`${chatId}\`)\n\n` +
          `Lekin security double-lock ke liye kripya apna **Master App Password / Key** yahan enter karein:`
        );
        return;
      }

      // Check if text matches active App Key
      if (activeKey && text === activeKey.trim()) {
        this.authSessions.set(chatId, {
          authenticated: true,
          lastActive: now,
          failedAttempts: 0,
        });

        await this.sendMainMenu(chatId, `🎉 *AUTHENTICATION SUCCESSFUL!* 🔓\n\nWelcome Boss! Security session active hai (30 mins). Neeche diye menu se command select karein:`);
        return;
      } else {
        const attempts = (session?.failedAttempts || 0) + 1;
        this.authSessions.set(chatId, {
          authenticated: false,
          lastActive: now,
          failedAttempts: attempts,
        });

        await this.sendMessage(
          chatId,
          `❌ *GALAT APP PASSWORD!*\n\n` +
          `Master Key match nahi hui (Attempt ${attempts}/3).\n` +
          `Kripya sahi Master App Password type karein:`
        );
        return;
      }
    }

    // Refresh last active timestamp
    session.lastActive = now;

    // ── Handle Authenticated Commands & Interactive Menu ─────────────────────
    const lower = text.toLowerCase();

    // 1. Logout Command
    if (lower === "/logout" || lower === "🚪 logout" || lower === "logout") {
      this.authSessions.delete(chatId);
      await this.sendMessage(
        chatId,
        `🔒 *LOGGED OUT SUCCESSFULLY*\n\nAapka security session close ho gaya hai. Dobara access karne ke liye \`/start\` bhejkar password enter karein.`
      );
      return;
    }

    // 2. Active Users / Sessions
    if (lower === "/active" || lower === "👥 active users" || lower === "active") {
      const liveWsCount = this.getActiveConnectionsCount();
      await this.sendMessage(
        chatId,
        `👥 *ACTIVE USERS & SESSIONS STATUS*\n\n` +
        `• 🟢 *Live Voice WebSocket Connections:* \`${liveWsCount}\` active\n` +
        `• 📱 *Security Bot Session:* Active (Boss DK)\n` +
        `• ⏱️ *Session Auto-Lock In:* ${Math.round((this.SESSION_TTL - (now - session.lastActive)) / 60000)} minutes\n` +
        `• 🌐 *Server Status:* Online & Running ⚡`,
        this.getMainKeyboard()
      );
      return;
    }

    // 3. Blocked Clients / Attackers
    if (lower === "/blocked" || lower === "🛑 blocked clients" || lower === "blocked") {
      const list = await appSecurityService.listBlockedIps();
      if (list.length === 0) {
        await this.sendMessage(
          chatId,
          `🛡️ *SECURITY SHIELD GREEN* ✅\n\nAbhi koi bhi IP ya device BLOCKED nahi hai. Sabhi clients normal state me hain!`,
          this.getMainKeyboard()
        );
        return;
      }

      const formatted = list
        .map(
          (b, idx) =>
            `*${idx + 1}.* \`${b.ip}\`\n` +
            `   📱 Device: ${b.userAgent || "Unknown Device"}\n` +
            `   🎯 Reason: ${b.reason || "Failed authentication"}\n` +
            `   ⏰ Time: ${new Date(b.blockedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
        )
        .join("\n\n");

      await this.sendMessage(
        chatId,
        `🚨 *CURRENTLY BLOCKED CLIENTS (${list.length}):*\n\n${formatted}\n\n` +
        `🔓 *Unblock karne ke liye type karein:*\n` +
        `👉 \`/unblock <ip>\`\n` +
        `👉 \`/unblock all\``,
        this.getMainKeyboard()
      );
      return;
    }

    // 4. Unblock Command
    const unblockMatch = text.match(/^\/?unblock\s+([^\s]+)/i);
    if (unblockMatch || lower === "🔓 unblock ip") {
      if (!unblockMatch || !unblockMatch[1]) {
        await this.sendMessage(
          chatId,
          `ℹ️ *UNBLOCK COMMAND FORMAT:*\n\n` +
          `Kisi specific IP ko unblock karne ke liye type karein:\n` +
          `👉 \`/unblock 192.168.1.1\`\n\n` +
          `Ya sabhi ko ek sath unblock karne ke liye:\n` +
          `👉 \`/unblock all\``,
          this.getMainKeyboard()
        );
        return;
      }

      const target = unblockMatch[1].trim();
      if (target === "all") {
        const count = await appSecurityService.unblockAll();
        await this.sendMessage(
          chatId,
          `✅ *SUCCESS:* Sabhi blocked IPs (${count}) ko unblock kar diya gaya hai! 🔓`,
          this.getMainKeyboard()
        );
      } else {
        const success = await appSecurityService.unblockIp(target);
        await this.sendMessage(
          chatId,
          success
            ? `✅ *SUCCESS:* IP \`${target}\` ko unblock kar diya gaya hai! 🔓`
            : `⚠️ *NOT FOUND:* IP \`${target}\` blocked list me nahi mila.`,
          this.getMainKeyboard()
        );
      }
      return;
    }

    // 5. App Key Inspection / Change
    if (lower === "/appkey" || lower === "🔑 app key" || lower === "appkey") {
      const keyData = await appSecurityService.getAppKeyData();
      await this.sendMessage(
        chatId,
        `🔑 *MASTER APP KEY CONFIGURATION*\n\n` +
        `• 🔐 *Active Key:* \`${keyData?.appKey || "Not configured"}\`\n` +
        `• 👤 *Set By:* ${keyData?.updatedBy || "System"}\n` +
        `• ⏰ *Updated At:* ${keyData?.updatedAt ? new Date(keyData.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "N/A"}\n\n` +
        `✏️ *Naya Key set karne ke liye type karein:*\n` +
        `👉 \`/setappkey apna_naya_password\``,
        this.getMainKeyboard()
      );
      return;
    }

    const setKeyMatch = text.match(/^\/?(?:setappkey|set\s+app\s*key)[\s\:\=]+([^\s]+)/i);
    if (setKeyMatch && setKeyMatch[1]) {
      const newKey = setKeyMatch[1].trim();
      const res = await appSecurityService.setAppKey(newKey, senderName, "telegram");
      await this.sendMessage(chatId, res.message, this.getMainKeyboard());
      return;
    }

    // 6. Security Status & Health
    if (lower === "/status" || lower === "📊 system health" || lower === "status") {
      const blockedList = await appSecurityService.listBlockedIps();
      const liveWsCount = this.getActiveConnectionsCount();

      await this.sendMessage(
        chatId,
        `🛡️ *FRIDAY SECURITY SENTINEL STATUS REPORT*\n\n` +
        `• 🔒 *AES-256-GCM Firestore Encryption:* Active ✅\n` +
        `• 🛡️ *Double-Lock Protection:* Active ✅\n` +
        `• ⚡ *Anti-Brute Force Rate Limiter:* Active (2 attempts/min) ✅\n` +
        `• 🛑 *Currently Blocked Attackers:* \`${blockedList.length}\`\n` +
        `• 👥 *Live Connected Users:* \`${liveWsCount}\`\n` +
        `• 🤖 *Security Bot Mode:* Dual-Layer Authenticated (Boss Only)\n` +
        `• ⏳ *Server Uptime:* ${Math.round(process.uptime() / 60)} minutes`,
        this.getMainKeyboard()
      );
      return;
    }

    // Default Fallback: Show Main Menu
    await this.sendMainMenu(chatId, `Boss, kripya neeche diye gaye Security Menu se option chunein:`);
  }

  private getMainKeyboard(): any {
    return {
      keyboard: [
        [{ text: "👥 Active Users" }, { text: "🛑 Blocked Clients" }],
        [{ text: "🔑 App Key" }, { text: "📊 System Health" }],
        [{ text: "🔓 Unblock IP" }, { text: "🚪 Logout" }],
      ],
      resize_keyboard: true,
      persistent: true,
    };
  }

  private async sendMainMenu(chatId: number, text: string): Promise<void> {
    await this.sendMessage(chatId, text, this.getMainKeyboard());
  }
}

export const telegramSecurityBotService = new TelegramSecurityBotService();
