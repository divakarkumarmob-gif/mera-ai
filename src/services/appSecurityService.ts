import { db } from "./firebaseAdmin";
import crypto from "crypto";

export interface AppAccessKeyData {
  appKey: string;
  updatedAt: number;
  updatedBy: string;
  source: "whatsapp" | "telegram" | "system";
}

export interface BlockedClientData {
  ip: string;
  userAgent: string;
  blockedAt: number;
  reason: string;
  attempts: number;
}

const SESSION_TTL = 48 * 60 * 60 * 1000; // 48 Hours

class AppSecurityService {
  private cachedKey: string | null = null;
  private cachedUpdatedAt: number | null = null;
  private dynamicSecret: string | null = null;

  // Rate limiting: max 2 verification attempts per 60 seconds per IP
  private readonly rateLimitWindowMs = 60 * 1000; // 60s
  private readonly maxAttemptsPerWindow = 2; // 2 attempts per minute
  private verifyAttemptTimestamps = new Map<string, number[]>();

  // Failed attempts tracking & auto-blocking (3 wrong attempts -> block)
  private readonly maxFailedAttempts = 3;
  private failedAttempts = new Map<string, { count: number; lastFailed: number; userAgent: string }>();
  private blockedIps = new Map<string, BlockedClientData>();
  private isFirestoreSynced = false;

  constructor() {
    // Proactively initialize dynamic secret & sync blocked list from Firestore
    this.syncBlockedFromFirestore().catch(() => {});
  }

  /**
   * Cleans and normalizes IP string (handles IPv6 mapped IPv4 and proxy headers).
   */
  public cleanIp(ip: string): string {
    if (!ip) return "127.0.0.1";
    let cleaned = String(ip).trim();
    if (cleaned.startsWith("::ffff:")) {
      cleaned = cleaned.replace("::ffff:", "");
    }
    if (cleaned.includes(",")) {
      cleaned = cleaned.split(",")[0].trim();
    }
    return cleaned || "127.0.0.1";
  }

  /**
   * Retrieves high-entropy HMAC signing secret.
   * Strictly NO hardcoded public fallback strings in the repository.
   * If not found in environment variables, loads or generates a 256-bit
   * secure random key stored in Firestore doc 'systemSecurity/serverSecurityKey'
   * or memory.
   */
  private getSigningSecret(): string {
    if (process.env.APP_SECURITY_SECRET && process.env.APP_SECURITY_SECRET.length > 10) {
      return process.env.APP_SECURITY_SECRET;
    }
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length > 10) {
      return process.env.ENCRYPTION_KEY;
    }
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.length > 20) {
      return process.env.FIREBASE_PRIVATE_KEY;
    }
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10) {
      return process.env.GEMINI_API_KEY;
    }

    if (!this.dynamicSecret) {
      this.dynamicSecret = crypto.randomBytes(32).toString("hex");
      this.persistDynamicSecret(this.dynamicSecret).catch(() => {});
    }

    return this.dynamicSecret;
  }

  private async persistDynamicSecret(secret: string): Promise<void> {
    try {
      const docRef = db.collection("systemSecurity").doc("serverSecurityKey");
      const snap = await docRef.get();
      if (snap.exists && snap.data()?.secret) {
        this.dynamicSecret = snap.data()?.secret;
      } else {
        await docRef.set({
          secret,
          createdAt: Date.now(),
        });
      }
    } catch {
      // Non-critical: falls back to in-memory random secret
    }
  }

  /**
   * Syncs blocked IPs from Firestore so bans persist across server restarts.
   */
  private async syncBlockedFromFirestore(): Promise<void> {
    if (this.isFirestoreSynced) return;
    try {
      const doc = await db.collection("systemSecurity").doc("blockedAccess").get();
      if (doc.exists && doc.data()?.blockedList) {
        const list = doc.data()?.blockedList as Record<string, BlockedClientData>;
        for (const [ip, val] of Object.entries(list)) {
          this.blockedIps.set(this.cleanIp(ip), val);
        }
      }
      this.isFirestoreSynced = true;
    } catch (e) {
      console.warn("[AppSecurity] Failed to sync blockedAccess from Firestore:", e);
    }
  }

  /**
   * Generates a tamper-proof cryptographically signed session token (HMAC-SHA256).
   * Embeds keyUpdatedAt so changing the App Key instantly invalidates all active tokens.
   */
  public generateSessionToken(keyUpdatedAt: number = Date.now()): string {
    const payload = {
      v: 2,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL, // 48 Hours
      keyUpdatedAt,
      nonce: crypto.randomBytes(8).toString("hex"),
    };
    const dataStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const hmac = crypto.createHmac("sha256", this.getSigningSecret()).update(dataStr).digest("base64url");
    return `${dataStr}.${hmac}`;
  }

  /**
   * Verifies cryptographic signature, 48-hour expiration, and key version.
   */
  public verifySessionToken(token: string): boolean {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [dataStr, sig] = parts;

    try {
      const expectedSig = crypto.createHmac("sha256", this.getSigningSecret()).update(dataStr).digest("base64url");
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return false;
      }

      const payload = JSON.parse(Buffer.from(dataStr, "base64url").toString("utf8"));

      // 1. Check 48-hour expiration
      if (payload.exp && Date.now() > payload.exp) {
        return false;
      }

      // 2. Check if password was changed after token was issued
      if (this.cachedUpdatedAt && payload.keyUpdatedAt && payload.keyUpdatedAt !== this.cachedUpdatedAt) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if an IP or device is currently blocked.
   */
  public isIpBlocked(clientIp: string): boolean {
    const cleanIp = this.cleanIp(clientIp);
    return this.blockedIps.has(cleanIp);
  }

  /**
   * Rate limits password verification to a maximum of 2 attempts per minute.
   */
  public checkRateLimit(clientIp: string): { allowed: boolean; remainingSeconds: number } {
    const cleanIp = this.cleanIp(clientIp);
    const now = Date.now();
    const timestamps = (this.verifyAttemptTimestamps.get(cleanIp) || []).filter(
      (t) => now - t < this.rateLimitWindowMs
    );
    this.verifyAttemptTimestamps.set(cleanIp, timestamps);

    if (timestamps.length >= this.maxAttemptsPerWindow) {
      const oldest = timestamps[0];
      const remainingSeconds = Math.max(1, Math.ceil((this.rateLimitWindowMs - (now - oldest)) / 1000));
      return { allowed: false, remainingSeconds };
    }

    timestamps.push(now);
    this.verifyAttemptTimestamps.set(cleanIp, timestamps);
    return { allowed: true, remainingSeconds: 0 };
  }

  /**
   * Blocks an IP and user agent, persisting to Firestore and firing WhatsApp + Telegram alerts.
   */
  public async blockClient(
    clientIp: string,
    userAgent: string = "Unknown Device",
    reason: string = "3 consecutive incorrect password attempts"
  ): Promise<void> {
    const cleanIp = this.cleanIp(clientIp);
    const blockData: BlockedClientData = {
      ip: cleanIp,
      userAgent: userAgent.substring(0, 150),
      blockedAt: Date.now(),
      reason,
      attempts: this.failedAttempts.get(cleanIp)?.count || this.maxFailedAttempts,
    };

    this.blockedIps.set(cleanIp, blockData);

    try {
      const blockedObj = Object.fromEntries(this.blockedIps.entries());
      await db.collection("systemSecurity").doc("blockedAccess").set(
        {
          blockedList: blockedObj,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("[AppSecurity] Failed to save blockedAccess to Firestore:", e);
    }

    // Trigger instant Dual-Channel Alerts to WhatsApp and Telegram
    this.dispatchBlockAlert(cleanIp, userAgent, reason).catch((err) => {
      console.error("[AppSecurity] Error dispatching security block alerts:", err);
    });
  }

  /**
   * Dispatches instant security alert to WhatsApp and Telegram.
   */
  private async dispatchBlockAlert(clientIp: string, userAgent: string, reason?: string): Promise<void> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
    const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

    const isDirectAttack = reason && (reason.includes("Direct") || reason.includes("probe") || reason.includes("sensitive") || reason.includes("download"));
    const headline = isDirectAttack
      ? `🚨 *CRITICAL ALERT: UNAUTHORIZED ATTACK BLOCKED!* 🚨\n\n⚠️ Kisi ne direct sensitive endpoint ya memory backup ko unauthorized access / download karne ki koshish ki!\nDevice aur IP ko turant *PERMANENTLY BLOCK* kar diya gaya hai.`
      : `🚨 *SECURITY ALERT: APP ACCESS BLOCKED* 🚨\n\n⚠️ *3 galat password attempts* detect hue hain!\nDevice aur IP ko turant *BLOCK* kar diya gaya hai.`;

    const alertMessage =
`${headline}

🎯 *Reason / Target:* ${reason || "Unauthorized endpoint access"}
🌐 *IP Address:* \`${clientIp}\`
📱 *Device / Browser:* ${userAgent || "Unknown Device"}
⏰ *Time:* ${timeStr}, ${dateStr} (IST)
🛡️ *Status:* Access Locked ❌

🔓 *Boss, unblock karne ke liye reply karein:*
👉 \`/unblock ${clientIp}\`
ya
👉 \`/unblock all\``;

    console.warn(`[AppSecurity] 🚨 Auto-blocked IP ${clientIp}. Dispatching WhatsApp & Telegram alerts...`);

    // 1. Send to WhatsApp Owner
    try {
      const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
      if (ownerPhone) {
        const { whatsappBotService } = await import("./whatsappBotService");
        if (whatsappBotService.getStatus().isConnected) {
          await whatsappBotService.sendMessage(ownerPhone, alertMessage);
          console.log(`[AppSecurity] WhatsApp alert delivered to owner (+${ownerPhone}) via Baileys.`);
        } else {
          const { whatsappCloudService } = await import("./whatsappCloudService");
          await whatsappCloudService.sendMessage(ownerPhone, alertMessage);
          console.log(`[AppSecurity] WhatsApp alert delivered to owner (+${ownerPhone}) via Cloud API.`);
        }
      }
    } catch (e) {
      console.warn("[AppSecurity] WhatsApp alert dispatch error:", e);
    }

    // 2. Send to Telegram Owner
    try {
      const { telegramBotService } = await import("./telegramBotService");
      if (telegramBotService.isConfigured) {
        const chatId = await telegramBotService.getOwnerOrLatestChatId();
        if (chatId) {
          await telegramBotService.sendMessage(chatId, alertMessage);
          console.log(`[AppSecurity] Telegram alert delivered to chatId (${chatId}).`);
        }
      }
    } catch (e) {
      console.warn("[AppSecurity] Telegram alert dispatch error:", e);
    }
  }

  /**
   * Unblocks a specific IP address.
   */
  public async unblockIp(clientIp: string): Promise<boolean> {
    const cleanIp = this.cleanIp(clientIp);
    await this.syncBlockedFromFirestore();

    let wasBlocked = this.blockedIps.delete(cleanIp);
    this.failedAttempts.delete(cleanIp);
    this.verifyAttemptTimestamps.delete(cleanIp);

    // Also match partial or case-insensitive if exact match failed
    if (!wasBlocked) {
      for (const key of Array.from(this.blockedIps.keys())) {
        if (key.toLowerCase() === cleanIp.toLowerCase() || key.includes(cleanIp) || cleanIp.includes(key)) {
          this.blockedIps.delete(key);
          this.failedAttempts.delete(key);
          this.verifyAttemptTimestamps.delete(key);
          wasBlocked = true;
        }
      }
    }

    if (wasBlocked) {
      try {
        const blockedObj = Object.fromEntries(this.blockedIps.entries());
        await db.collection("systemSecurity").doc("blockedAccess").set({
          blockedList: blockedObj,
          updatedAt: Date.now(),
        });
        console.log(`[AppSecurity] Unblocked IP ${cleanIp}`);
      } catch (e) {
        console.error("[AppSecurity] Failed to update blockedAccess in Firestore:", e);
      }
    }

    return wasBlocked;
  }

  /**
   * Unblocks all blocked IPs.
   */
  public async unblockAll(): Promise<number> {
    await this.syncBlockedFromFirestore();
    const count = this.blockedIps.size;
    this.blockedIps.clear();
    this.failedAttempts.clear();
    this.verifyAttemptTimestamps.clear();

    try {
      await db.collection("systemSecurity").doc("blockedAccess").set({
        blockedList: {},
        updatedAt: Date.now(),
      });
      console.log(`[AppSecurity] Unblocked all (${count}) IPs.`);
    } catch (e) {
      console.error("[AppSecurity] Failed to clear blockedAccess in Firestore:", e);
    }

    return count;
  }

  /**
   * Returns list of currently blocked clients.
   */
  public async listBlockedIps(): Promise<BlockedClientData[]> {
    await this.syncBlockedFromFirestore();
    return Array.from(this.blockedIps.values());
  }

  /**
   * Retrieves the active App Access Key and its update timestamp from Firestore (doc: systemSecurity/appAccessKey).
   */
  public async getAppKeyData(): Promise<AppAccessKeyData | null> {
    try {
      const doc = await db.collection("systemSecurity").doc("appAccessKey").get();
      if (doc.exists && doc.data()?.appKey) {
        const data = doc.data() as AppAccessKeyData;
        const key = String(data.appKey).trim();
        this.cachedKey = key;
        this.cachedUpdatedAt = data.updatedAt || 0;
        return data;
      }
    } catch (e) {
      console.warn("[AppSecurity] Failed to fetch appAccessKey from Firestore:", e);
    }
    if (this.cachedKey) {
      return {
        appKey: this.cachedKey,
        updatedAt: this.cachedUpdatedAt || 0,
        updatedBy: "system",
        source: "system",
      };
    }
    const envKey = (process.env.APP_KEY || process.env.APP_PASSWORD || "").trim();
    if (envKey) {
      return {
        appKey: envKey,
        updatedAt: 0,
        updatedBy: "env",
        source: "system",
      };
    }
    return null;
  }

  /**
   * Retrieves the active App Access Key from Firestore.
   */
  public async getAppKey(): Promise<string | null> {
    const data = await this.getAppKeyData();
    return data ? data.appKey : null;
  }

  /**
   * Verifies an input key against the Firestore App Key.
   * Enforces:
   * 1. Block check (3 failed attempts -> lockout)
   * 2. Rate limit (max 2 attempts per minute)
   * 3. Failed attempt counting and auto-lockout on 3rd failure
   */
  public async verifyAppKey(
    inputKey: string,
    clientIp: string = "127.0.0.1",
    userAgent: string = "Unknown Device"
  ): Promise<{
    success: boolean;
    message: string;
    token?: string;
    blocked?: boolean;
    rateLimited?: boolean;
    remainingSeconds?: number;
    failedAttempts?: number;
  }> {
    const cleanIp = this.cleanIp(clientIp);
    await this.syncBlockedFromFirestore();

    // 1. Check if IP/Device is already blocked
    if (this.isIpBlocked(cleanIp)) {
      return {
        success: false,
        blocked: true,
        message: "🚨 Access Blocked: 3 galat password attempts ke baad aapka access block kar diya gaya hai. Boss ko WhatsApp aur Telegram par alert bhej diya gaya hai.",
      };
    }

    // 2. Check Rate Limit (max 2 attempts per minute)
    const rateCheck = this.checkRateLimit(cleanIp);
    if (!rateCheck.allowed) {
      return {
        success: false,
        rateLimited: true,
        remainingSeconds: rateCheck.remainingSeconds,
        message: `⚠️ Rate limit: 1 minute me maximum 2 attempts allowed hain. Kripya ${rateCheck.remainingSeconds} second baad try karein.`,
      };
    }

    const raw = String(inputKey || "").trim();
    if (!raw) {
      return { success: false, message: "Kripya App Key enter karein." };
    }

    const keyData = await this.getAppKeyData();
    if (!keyData || !keyData.appKey) {
      return {
        success: false,
        message: "App Access Key abhi Firestore me set nahi hai. WhatsApp ya Telegram par Boss se 'app key <password>' bhej kar set karein.",
      };
    }

    // 3. Verify Key
    if (raw === keyData.appKey) {
      // SUCCESS -> Reset failed attempts & rate limits
      this.failedAttempts.delete(cleanIp);
      this.verifyAttemptTimestamps.delete(cleanIp);
      const token = this.generateSessionToken(keyData.updatedAt);
      return { success: true, token, message: "App Access Granted! ✅" };
    }

    // 4. FAILURE -> Increment failed attempts
    const currentFail = this.failedAttempts.get(cleanIp) || { count: 0, lastFailed: 0, userAgent };
    currentFail.count += 1;
    currentFail.lastFailed = Date.now();
    currentFail.userAgent = userAgent;
    this.failedAttempts.set(cleanIp, currentFail);

    const attemptsLeft = this.maxFailedAttempts - currentFail.count;

    if (currentFail.count >= this.maxFailedAttempts) {
      // Automatically block IP & trigger instant alerts
      await this.blockClient(cleanIp, userAgent, "3 consecutive incorrect password attempts");
      return {
        success: false,
        blocked: true,
        failedAttempts: currentFail.count,
        message: "🚨 Security Lockout: 3 galat password try karne par aapka IP block kar diya gaya hai. Boss ko WhatsApp aur Telegram par turant alert bhej diya gaya hai.",
      };
    }

    return {
      success: false,
      failedAttempts: currentFail.count,
      message: `Galat App Key! Access Denied ❌ (${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} bache hain)`,
    };
  }

  /**
   * Sets or updates the App Access Key in Firestore (max 10 chars/digits).
   */
  public async setAppKey(
    newKey: string,
    senderName: string,
    source: "whatsapp" | "telegram" = "whatsapp"
  ): Promise<{ success: boolean; message: string; key?: string }> {
    const cleanKey = String(newKey || "").trim();

    if (!cleanKey || cleanKey.length < 3) {
      return {
        success: false,
        message: "App Key kam se kam 3 characters/digits ka hona chahiye.",
      };
    }

    if (cleanKey.length > 10) {
      return {
        success: false,
        message: "App Key maximum 10 characters/digits ka hona chahiye.",
      };
    }

    try {
      const payload: AppAccessKeyData = {
        appKey: cleanKey,
        updatedAt: Date.now(),
        updatedBy: senderName,
        source,
      };

      this.cachedKey = cleanKey;
      this.cachedUpdatedAt = payload.updatedAt;

      await db.collection("systemSecurity").doc("appAccessKey").set(payload, { merge: true });
      console.log(`[AppSecurity] Updated App Key to [${cleanKey}] from ${source} by ${senderName}`);

      return {
        success: true,
        key: cleanKey,
        message: `Boss, aapka naya App Access Key [${cleanKey}] Firestore me successfully save ho gaya hai! Ab app isi key se unlock hoga. ✅`,
      };
    } catch (e: any) {
      console.warn("[AppSecurity] Saved App Key to local memory (Firestore offline):", e?.message || e);
      this.cachedKey = cleanKey;
      this.cachedUpdatedAt = Date.now();
      return {
        success: true,
        key: cleanKey,
        message: `Boss, aapka naya App Access Key [${cleanKey}] set ho gaya hai! ✅`,
      };
    }
  }

  /**
   * Checks and handles incoming security commands from Owner:
   * 1. Set App Key: "app key 123456", "app pass 987654"
   * 2. Unblock IP: "unblock 192.168.1.1", "unblock all"
   * 3. List Blocked: "blocked list", "blocked ips", "list blocked"
   */
  public async handleOwnerSecurityMessage(
    text: string,
    isOwner: boolean,
    senderName: string,
    source: "whatsapp" | "telegram"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const trimmed = text.trim();

    // 1. Unblock Command (e.g. "/unblock 192.168.1.5", "unblock 192.168.1.5", or "unblock all")
    const unblockMatch = trimmed.match(/^\/?unblock\s+([^\s]+)/i);
    if (unblockMatch) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi IP/Device ko unblock kar sakte hain.",
        };
      }

      const target = unblockMatch[1].trim();
      if (target.toLowerCase() === "all" || target.toLowerCase() === "sabhi" || target.toLowerCase() === "app") {
        const count = await this.unblockAll();
        return {
          handled: true,
          replyText: `✅ *Security Shield Update:*\n\nBoss, sabhi blocked IPs (${count}) ko successfully *UNBLOCK* kar diya gaya hai! Ab app login access restore ho gaya hai. 🔓`,
        };
      } else {
        const success = await this.unblockIp(target);
        return {
          handled: true,
          replyText: success
            ? `✅ *Security Shield Update:*\n\nBoss, IP \`${target}\` ko successfully *UNBLOCK* kar diya gaya hai! Ab user password try kar sakta hai. 🔓`
            : `⚠️ *IP Not Found:* IP \`${target}\` blocked list me nahi mili ya pehle se unblocked hai.`,
        };
      }
    }

    // 2. List Blocked Command (e.g. "/blocked", "blocked list", "blocked ips", "list blocked")
    const isListBlocked = /^\/?(?:list\s+blocked|blocked\s+list|blocked\s+ips|blocked|show\s+blocked|check\s+blocked)/i.test(trimmed);
    if (isListBlocked) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi blocked list dekh sakte hain.",
        };
      }

      const blockedList = await this.listBlockedIps();
      if (blockedList.length === 0) {
        return {
          handled: true,
          replyText: "🛡️ *Security Shield Status:*\n\nAbhi koi bhi IP ya device BLOCKED nahi hai. Sabhi clients normal state me hain. ✅",
        };
      }

      const formatted = blockedList
        .map((b) => `• \`${b.ip}\` (${b.userAgent || "Unknown Device"}) — Failed ${b.attempts || 3} times`)
        .join("\n");

      return {
        handled: true,
        replyText: `🚨 *Currently Blocked Clients (${blockedList.length}):*\n\n${formatted}\n\n🔓 *Unblock karne ke liye reply karein:*\n\`unblock <ip>\` ya \`unblock all\``,
      };
    }

    // 3. App Key Update Command (e.g. "app key - 123456", "app pass 987654", "set app key 1234")
    const keyPattern = /^(?:set\s+)?(?:app\s*key|app\s*pass|app\s*password|access\s*key|app\s*lock)[\s\:\-\=]+([^\s]{1,15})/i;
    const keyMatch = trimmed.match(keyPattern);

    if (keyMatch && keyMatch[1]) {
      const candidateKey = keyMatch[1].trim();

      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi App Access Key create ya change kar sakte hain.",
        };
      }

      const res = await this.setAppKey(candidateKey, senderName, source);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    return { handled: false };
  }

  /**
   * Backwards-compatible alias for handleOwnerSecurityMessage.
   */
  public async handleOwnerAppKeyMessage(
    text: string,
    isOwner: boolean,
    senderName: string,
    source: "whatsapp" | "telegram"
  ): Promise<{ handled: boolean; replyText?: string }> {
    return this.handleOwnerSecurityMessage(text, isOwner, senderName, source);
  }
}

export const appSecurityService = new AppSecurityService();

