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

export interface UserProfile {
  username: string; // unique lowercase identifier (e.g. "boss", "bhai")
  displayName: string;
  password: string;
  role: "boss" | "member";
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  source: "whatsapp" | "telegram" | "system";
  isActive: boolean;
  lastLoginAt?: number;
  lastLoginIp?: string;
  lastLoginDevice?: string;
}

export interface ActiveSessionDevice {
  sessionId: string;
  username?: string;
  role?: string;
  ip: string;
  userAgent: string;
  deviceName: string;
  deviceType: "apk" | "web" | "mobile_web" | "desktop_web";
  firstLoginAt: number;
  lastActiveAt: number;
  tokenIssuedAt: number;
}

const SESSION_TTL = 48 * 60 * 60 * 1000; // 48 Hours

class AppSecurityService {
  private cachedKey: string | null = null;
  private cachedUpdatedAt: number | null = null;
  private dynamicSecret: string | null = null;
  private globalRevocationEpoch: number = 0;

  // Active Sessions & Devices Registry
  private activeSessions = new Map<string, ActiveSessionDevice>();
  private broadcastCallback: ((event: any) => void) | null = null;

  // User Profiles Registry (created/managed exclusively by Boss via WhatsApp/Telegram)
  private userProfiles = new Map<string, UserProfile>();
  private isProfilesSynced = false;

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
    // Proactively initialize dynamic secret, sync blocked list & revocations from Firestore
    this.syncFromFirestore().catch(() => {});
  }

  /**
   * Sets real-time WebSocket broadcaster callback for instant killswitch push.
   */
  public setBroadcastCallback(cb: (event: any) => void) {
    this.broadcastCallback = cb;
  }

  /**
   * Parses user-agent string into a clean, human-friendly device name.
   */
  public parseDeviceName(userAgent: string): { name: string; type: "apk" | "web" | "mobile_web" | "desktop_web" } {
    const ua = String(userAgent || "").toLowerCase();
    if (ua.includes("fridayapp") || ua.includes("capacitor") || ua.includes("cordova") || ua.includes("friday_apk")) {
      return { name: "📱 Friday Mobile APK (Android)", type: "apk" };
    }
    if (ua.includes("android")) {
      return { name: "📱 Android Mobile (Browser)", type: "mobile_web" };
    }
    if (ua.includes("iphone")) {
      return { name: "📱 Apple iPhone (Safari)", type: "mobile_web" };
    }
    if (ua.includes("ipad")) {
      return { name: "📱 Apple iPad (Safari)", type: "mobile_web" };
    }
    if (ua.includes("windows nt 10") || ua.includes("windows nt 11") || ua.includes("windows")) {
      if (ua.includes("edg")) return { name: "💻 Windows PC (Microsoft Edge)", type: "desktop_web" };
      if (ua.includes("chrome")) return { name: "💻 Windows PC (Google Chrome)", type: "desktop_web" };
      if (ua.includes("firefox")) return { name: "💻 Windows PC (Firefox)", type: "desktop_web" };
      return { name: "💻 Windows PC (Desktop)", type: "desktop_web" };
    }
    if (ua.includes("macintosh") || ua.includes("mac os")) {
      return { name: "💻 Apple Mac (Safari / Chrome)", type: "desktop_web" };
    }
    if (ua.includes("linux")) {
      return { name: "💻 Linux Workstation", type: "desktop_web" };
    }
    return { name: "🌐 Web Client (Browser)", type: "web" };
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
   * Syncs blocked IPs and global revocation timestamps from Firestore.
   */
  public async syncFromFirestore(force = false): Promise<void> {
    if (this.isFirestoreSynced && !force) return;
    try {
      // 1. Sync Blocked IPs
      const blockedDoc = await db.collection("systemSecurity").doc("blockedAccess").get();
      if (blockedDoc.exists && blockedDoc.data()?.blockedList) {
        const list = blockedDoc.data()?.blockedList as Record<string, BlockedClientData>;
        this.blockedIps.clear();
        for (const [ip, val] of Object.entries(list)) {
          this.blockedIps.set(this.cleanIp(ip), val);
        }
      }

      // 2. Sync Global Session Revocation Epoch
      const revDoc = await db.collection("systemSecurity").doc("sessionRevocations").get();
      if (revDoc.exists && revDoc.data()?.revokedBefore) {
        this.globalRevocationEpoch = Number(revDoc.data()?.revokedBefore || 0);
      }

      // 3. Sync Active Sessions
      const sessionsDoc = await db.collection("systemSecurity").doc("activeSessions").get();
      if (sessionsDoc.exists && sessionsDoc.data()?.sessions) {
        const sessList = sessionsDoc.data()?.sessions as Record<string, ActiveSessionDevice>;
        const now = Date.now();
        for (const [sid, sess] of Object.entries(sessList)) {
          if (sess.lastActiveAt && now - sess.lastActiveAt < SESSION_TTL && sess.tokenIssuedAt > this.globalRevocationEpoch) {
            this.activeSessions.set(sid, sess);
          }
        }
      }

      // 4. Sync User Profiles
      await this.syncProfilesFromFirestore();

      this.isFirestoreSynced = true;
    } catch (e) {
      console.warn("[AppSecurity] Failed to sync security state from Firestore:", e);
    }
  }

  /**
   * Syncs blocked IPs specifically from Firestore.
   */
  public async syncBlockedFromFirestore(): Promise<void> {
    await this.syncFromFirestore(true);
  }

  /**
   * Syncs user profiles from Firestore collection app_user_profiles.
   * If empty, auto-seeds default 'boss' profile using current App Key.
   */
  public async syncProfilesFromFirestore(force = false): Promise<void> {
    if (this.isProfilesSynced && !force) return;
    try {
      const snap = await db.collection("app_user_profiles").get();
      if (!snap.empty) {
        this.userProfiles.clear();
        snap.forEach((doc) => {
          const data = doc.data() as UserProfile;
          if (data && data.username) {
            this.userProfiles.set(data.username.toLowerCase(), data);
          }
        });
      }

      // Ensure primary 'boss' profile is present
      if (!this.userProfiles.has("boss")) {
        await this.ensureDefaultBossProfile();
      }
      this.isProfilesSynced = true;
    } catch (e) {
      console.warn("[AppSecurity] Failed to sync user profiles from Firestore:", e);
      if (!this.userProfiles.has("boss")) {
        await this.ensureDefaultBossProfile();
      }
    }
  }

  /**
   * Ensures default 'boss' profile is seeded into memory and Firestore.
   */
  private async ensureDefaultBossProfile(): Promise<UserProfile> {
    const keyData = await this.getAppKeyData();
    const defaultPass = keyData?.appKey || "boss123";
    const bossProfile: UserProfile = {
      username: "boss",
      displayName: "DK Boss",
      password: defaultPass,
      role: "boss",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "system",
      source: "system",
      isActive: true,
    };
    this.userProfiles.set("boss", bossProfile);
    try {
      await db.collection("app_user_profiles").doc("boss").set(bossProfile, { merge: true });
    } catch {}
    return bossProfile;
  }

  /**
   * Generates a tamper-proof cryptographically signed session token (HMAC-SHA256).
   * Embeds keyUpdatedAt, unique sessionId, username, and role.
   */
  public generateSessionToken(
    keyUpdatedAt: number = Date.now(),
    sessionId?: string,
    username: string = "boss",
    role: string = "boss"
  ): { token: string; sessionId: string } {
    const sid = sessionId || `sess_${crypto.randomBytes(8).toString("hex")}`;
    const payload = {
      v: 2,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL, // 48 Hours
      keyUpdatedAt,
      sid,
      username,
      role,
      nonce: crypto.randomBytes(8).toString("hex"),
    };
    const dataStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const hmac = crypto.createHmac("sha256", this.getSigningSecret()).update(dataStr).digest("base64url");
    return { token: `${dataStr}.${hmac}`, sessionId: sid };
  }

  /**
   * Registers an active logged-in device session in memory and Firestore.
   */
  public async registerActiveSession(
    sessionId: string,
    clientIp: string,
    userAgent: string,
    tokenIssuedAt: number = Date.now(),
    username: string = "boss",
    role: string = "boss"
  ): Promise<ActiveSessionDevice> {
    const cleanIp = this.cleanIp(clientIp);
    const parsed = this.parseDeviceName(userAgent);
    const device: ActiveSessionDevice = {
      sessionId,
      username,
      role,
      ip: cleanIp,
      userAgent: (userAgent || "Unknown Device").substring(0, 200),
      deviceName: parsed.name,
      deviceType: parsed.type,
      firstLoginAt: Date.now(),
      lastActiveAt: Date.now(),
      tokenIssuedAt,
    };

    this.activeSessions.set(sessionId, device);

    // Persist to Firestore asynchronously
    this.persistActiveSessions().catch(() => {});
    return device;
  }

  /**
   * Creates or updates a User Profile. Only Boss can invoke this.
   */
  public async createUserProfile(
    username: string,
    password: string,
    displayName?: string,
    role: "boss" | "member" = "member",
    createdBy = "Boss",
    source: "whatsapp" | "telegram" = "whatsapp"
  ): Promise<{ success: boolean; message: string; profile?: UserProfile }> {
    const cleanUser = String(username || "").trim().toLowerCase();
    const cleanPass = String(password || "").trim();
    if (!cleanUser || cleanUser.length < 2) {
      return { success: false, message: "⚠️ Username kam se kam 2 characters ka hona chahiye." };
    }
    if (!cleanPass || cleanPass.length < 3) {
      return { success: false, message: "⚠️ Password kam se kam 3 characters ka hona chahiye." };
    }

    await this.syncProfilesFromFirestore();
    const cleanName = displayName?.trim() || (cleanUser.charAt(0).toUpperCase() + cleanUser.slice(1));
    const now = Date.now();
    const profile: UserProfile = {
      username: cleanUser,
      displayName: cleanName,
      password: cleanPass,
      role: cleanUser === "boss" ? "boss" : role,
      createdAt: now,
      updatedAt: now,
      createdBy,
      source,
      isActive: true,
    };

    this.userProfiles.set(cleanUser, profile);
    try {
      await db.collection("app_user_profiles").doc(cleanUser).set(profile, { merge: true });
      if (cleanUser === "boss") {
        this.cachedKey = cleanPass;
        this.cachedUpdatedAt = now;
        await db.collection("systemSecurity").doc("appAccessKey").set({
          appKey: cleanPass,
          updatedAt: now,
          updatedBy: createdBy,
          source,
        }, { merge: true });
      }
    } catch (e: any) {
      console.warn("[AppSecurity] Error saving user profile to Firestore:", e);
    }

    return {
      success: true,
      profile,
      message: `✅ *User Profile Successfully Created/Updated!*\n\n` +
        `👤 *Username:* \`${cleanUser}\`\n` +
        `🔑 *Password:* \`${cleanPass}\`\n` +
        `🏷️ *Name:* ${cleanName}\n` +
        `👑 *Role:* ${profile.role.toUpperCase()}\n` +
        `📱 User ab FRIDAY APK / Web me username \`${cleanUser}\` aur password se login kar sakta hai. Background GPS location bhi is profile se link rahegi. 📍`,
    };
  }

  /**
   * Resets password for a User Profile. Only Boss can invoke this.
   */
  public async resetUserPassword(
    username: string,
    newPassword: string,
    updatedBy = "Boss",
    source: "whatsapp" | "telegram" = "whatsapp"
  ): Promise<{ success: boolean; message: string }> {
    const cleanUser = String(username || "").trim().toLowerCase();
    const cleanPass = String(newPassword || "").trim();
    if (!cleanUser) return { success: false, message: "⚠️ Username specify karein." };
    if (!cleanPass || cleanPass.length < 3) return { success: false, message: "⚠️ Naya password kam se kam 3 characters ka hona chahiye." };

    await this.syncProfilesFromFirestore();
    let profile = this.userProfiles.get(cleanUser);
    if (!profile) {
      if (cleanUser === "boss") {
        profile = await this.ensureDefaultBossProfile();
      } else {
        return {
          success: false,
          message: `❌ User \`${cleanUser}\` nahi mila. Naya profile banane ke liye send karein:\n👉 \`user- ${cleanUser}, pass- ${cleanPass}\``,
        };
      }
    }

    profile.password = cleanPass;
    profile.updatedAt = Date.now();
    this.userProfiles.set(cleanUser, profile);

    try {
      await db.collection("app_user_profiles").doc(cleanUser).set(profile, { merge: true });
      if (cleanUser === "boss") {
        this.cachedKey = cleanPass;
        this.cachedUpdatedAt = profile.updatedAt;
        await db.collection("systemSecurity").doc("appAccessKey").set({
          appKey: cleanPass,
          updatedAt: profile.updatedAt,
          updatedBy,
          source,
        }, { merge: true });
      }
    } catch (e: any) {
      console.warn("[AppSecurity] Error resetting password in Firestore:", e);
    }

    // Terminate old sessions for this user so they must login with new password
    const revoked = this.revokeUserSessions(cleanUser);

    return {
      success: true,
      message: `🔑 *Password Reset Successful!*\n\n` +
        `👤 *User:* \`${cleanUser}\` (${profile.displayName})\n` +
        `🆕 *New Password:* \`${cleanPass}\`\n` +
        `🔒 *Security Notice:* User ke ${revoked} active session(s) invalidate kar diye gaye hain. Re-login zaroori hai.`,
    };
  }

  /**
   * Deletes a User Profile. Boss cannot delete the primary 'boss' profile.
   */
  public async deleteUserProfile(
    username: string,
    deletedBy = "Boss"
  ): Promise<{ success: boolean; message: string }> {
    const cleanUser = String(username || "").trim().toLowerCase();
    if (!cleanUser) return { success: false, message: "⚠️ Username specify karein." };
    if (cleanUser === "boss") {
      return { success: false, message: "⛔ *Action Denied:* Primary 'boss' profile ko delete nahi kiya ja sakta." };
    }

    await this.syncProfilesFromFirestore();
    if (!this.userProfiles.has(cleanUser)) {
      return { success: false, message: `❌ User \`${cleanUser}\` exist nahi karta.` };
    }

    this.userProfiles.delete(cleanUser);
    try {
      await db.collection("app_user_profiles").doc(cleanUser).delete();
    } catch (e: any) {
      console.warn("[AppSecurity] Error deleting user profile from Firestore:", e);
    }

    const revoked = this.revokeUserSessions(cleanUser);

    return {
      success: true,
      message: `🗑️ *User Profile Deleted!*\n\nUser \`${cleanUser}\` ko permanently delete kar diya gaya hai aur ${revoked} active session(s) terminate ho chuke hain.`,
    };
  }

  /**
   * Lists all registered user profiles.
   */
  public async listUserProfiles(): Promise<UserProfile[]> {
    await this.syncProfilesFromFirestore();
    return Array.from(this.userProfiles.values());
  }

  /**
   * Gets a specific user profile by username.
   */
  public async getUserProfile(username: string): Promise<UserProfile | null> {
    await this.syncProfilesFromFirestore();
    return this.userProfiles.get(String(username || "").toLowerCase().trim()) || null;
  }

  /**
   * Revokes active sessions for a specific username.
   */
  public revokeUserSessions(username: string): number {
    const clean = username.toLowerCase();
    let count = 0;
    for (const [sid, sess] of this.activeSessions.entries()) {
      if ((sess.username || "boss").toLowerCase() === clean) {
        this.activeSessions.delete(sid);
        count++;
      }
    }
    if (count > 0) {
      this.persistActiveSessions().catch(() => {});
      if (this.broadcastCallback) {
        this.broadcastCallback({
          type: "SECURITY_USER_REVOKED",
          username: clean,
          timestamp: Date.now(),
        });
      }
    }
    return count;
  }

  /**
   * Dispatches instant login notification to Boss on WhatsApp and Telegram when ANY user logs in.
   */
  public async dispatchLoginAlert(
    profile: UserProfile,
    clientIp: string,
    userAgent: string
  ): Promise<void> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
    const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    const parsed = this.parseDeviceName(userAgent);

    const alertMessage =
`🔐 *FRIDAY LOGIN NOTIFICATION* 🚀

👤 *User:* ${profile.displayName} (\`@${profile.username}\`)
👑 *Role:* ${profile.role.toUpperCase()}
📱 *Device:* ${parsed.name}
🌐 *IP Address:* \`${clientIp}\`
⏰ *Time:* ${timeStr}, ${dateStr} (IST)
🛡️ *Status:* Login Successful ✅

💡 *Remotely logout karne ke liye:*
👉 \`logout all\` ya \`user- ${profile.username}, new pass- <pass>\``;

    console.log(`[AppSecurity] 🚀 User @${profile.username} logged in from IP ${clientIp}. Dispatching instant WhatsApp & Telegram alerts...`);

    // 1. Send to WhatsApp Owner
    try {
      const ownerPhone = (
        process.env.OWNER_WHATSAPP_NUMBER ||
        process.env.BOSS_WHATSAPP_PHONE ||
        process.env.WHATSAPP_OWNER_NUMBER ||
        process.env.WHATSAPP_BOSS_PHONE ||
        ""
      ).replace(/\D/g, "");
      if (ownerPhone) {
        const { whatsappBotService } = await import("./whatsappBotService");
        if (whatsappBotService.getStatus().isConnected) {
          await whatsappBotService.sendMessage(ownerPhone, alertMessage);
          console.log(`[AppSecurity] Login notification delivered to WhatsApp (+${ownerPhone}).`);
        } else {
          const { whatsappCloudService } = await import("./whatsappCloudService");
          await whatsappCloudService.sendMessage(ownerPhone, alertMessage);
          console.log(`[AppSecurity] Login notification delivered via WhatsApp Cloud API.`);
        }
      }
    } catch (e) {
      console.warn("[AppSecurity] WhatsApp login alert dispatch error:", e);
    }

    // 2. Send to Telegram Owner
    try {
      const { telegramBotService } = await import("./telegramBotService");
      if (telegramBotService.isConfigured) {
        const chatId = await telegramBotService.getOwnerOrLatestChatId();
        if (chatId) {
          await telegramBotService.sendMessage(chatId, alertMessage);
          console.log(`[AppSecurity] Login notification delivered to Telegram chatId (${chatId}).`);
        }
      }
    } catch (e) {
      console.warn("[AppSecurity] Telegram login alert dispatch error:", e);
    }
  }

  /**
   * Touches active session to update its last-active timestamp.
   */
  public touchActiveSession(sessionId?: string, clientIp?: string, userAgent?: string) {
    if (!sessionId) return;
    const existing = this.activeSessions.get(sessionId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      if (clientIp) existing.ip = this.cleanIp(clientIp);
      if (userAgent) {
        existing.userAgent = userAgent.substring(0, 200);
        const parsed = this.parseDeviceName(userAgent);
        existing.deviceName = parsed.name;
        existing.deviceType = parsed.type;
      }
    } else if (clientIp) {
      this.registerActiveSession(sessionId, clientIp, userAgent || "Active Client", Date.now());
    }
  }

  /**
   * Persists active sessions list to Firestore.
   */
  private async persistActiveSessions(): Promise<void> {
    try {
      const sessionsObj = Object.fromEntries(this.activeSessions.entries());
      await db.collection("systemSecurity").doc("activeSessions").set(
        {
          sessions: sessionsObj,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      // Non-critical fallback
    }
  }

  /**
   * Returns all currently active / logged-in sessions.
   */
  public async getActiveSessions(): Promise<ActiveSessionDevice[]> {
    await this.syncFromFirestore();
    const now = Date.now();
    const active: ActiveSessionDevice[] = [];
    for (const [sid, sess] of this.activeSessions.entries()) {
      // Clean up sessions older than 48 hours or revoked before global revocation epoch
      if (sess.lastActiveAt && now - sess.lastActiveAt > SESSION_TTL) {
        this.activeSessions.delete(sid);
      } else if (sess.tokenIssuedAt && sess.tokenIssuedAt <= this.globalRevocationEpoch) {
        this.activeSessions.delete(sid);
      } else {
        active.push(sess);
      }
    }
    return active;
  }

  /**
   * Globally logs out ALL active sessions across all devices (Web, APK, Mobile).
   * Instantly forces all connected clients back to the App Pass / Key Modal.
   */
  public async logoutAll(
    reason: string = "Boss requested remote global logout",
    senderName: string = "Boss (DK)"
  ): Promise<{ count: number; message: string }> {
    const revokedEpoch = Date.now();
    this.globalRevocationEpoch = revokedEpoch;
    this.cachedUpdatedAt = revokedEpoch;

    const count = this.activeSessions.size;
    this.activeSessions.clear();

    // 1. Save global revocation timestamp & clear active sessions in Firestore
    try {
      await db.collection("systemSecurity").doc("sessionRevocations").set({
        revokedBefore: revokedEpoch,
        revokedBy: senderName,
        reason,
        updatedAt: revokedEpoch,
      });

      await db.collection("systemSecurity").doc("activeSessions").set({
        sessions: {},
        updatedAt: revokedEpoch,
      });
    } catch (e) {
      console.warn("[AppSecurity] Failed to save sessionRevocations to Firestore:", e);
    }

    // 2. Broadcast instant WebSocket force_logout payload to all active clients
    if (this.broadcastCallback) {
      try {
        this.broadcastCallback({
          type: "force_logout",
          reason,
          timestamp: revokedEpoch,
        });
      } catch (err) {
        console.error("[AppSecurity] Error sending force_logout broadcast:", err);
      }
    }

    console.log(`[AppSecurity] 🔒 GLOBAL LOGOUT: All ${count} active sessions terminated by ${senderName}. Reason: ${reason}`);

    return {
      count,
      message: `🔒 *ALL SESSIONS TERMINATED!* ⚡\n\n` +
        `Boss, sabhi devices (Web App & Friday APK) ko remotely *LOGOUT* kar diya gaya hai (${count} session${count === 1 ? "" : "s"} cleared).\n\n` +
        `Sabhi screens turant *App Key Lock / Password Screen* par wapas aa chuki hain. Kisi ko bhi dobara enter karne ke liye App Key enter karni hogi. 🛡️`,
    };
  }

  /**
   * Verifies cryptographic signature, 48-hour expiration, global revocation epoch, and key version.
   */
  public verifySessionToken(token: string, clientIp?: string, userAgent?: string): boolean {
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

      // 2. Check Global Revocation Epoch (logout all)
      if (this.globalRevocationEpoch && payload.iat && payload.iat <= this.globalRevocationEpoch) {
        return false;
      }

      // 3. Check if password was changed after token was issued
      if (this.cachedUpdatedAt && payload.keyUpdatedAt && payload.keyUpdatedAt < this.cachedUpdatedAt) {
        return false;
      }

      // 4. Update session touch
      if (payload.sid) {
        this.touchActiveSession(payload.sid, clientIp, userAgent);
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
      const ownerPhone = (
        process.env.OWNER_WHATSAPP_NUMBER ||
        process.env.BOSS_WHATSAPP_PHONE ||
        process.env.WHATSAPP_OWNER_NUMBER ||
        process.env.WHATSAPP_BOSS_PHONE ||
        ""
      ).replace(/\D/g, "");
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
  /**
   * Verifies user credentials (username and password) against registered User Profiles.
   * Also supports legacy single-key login if only password/key is supplied.
   * Enforces:
   * 1. Block check (3 failed attempts -> auto-lockout with WhatsApp + Telegram alert)
   * 2. Rate limit (max 2 attempts per minute per IP)
   * 3. Failed attempt counting and auto-lockout on 3rd failure
   * 4. INSTANT WhatsApp + Telegram notification to Boss on successful login!
   */
  public async verifyUserLogin(
    usernameInput: string,
    passwordInput: string,
    clientIp: string = "127.0.0.1",
    userAgent: string = "Unknown Device"
  ): Promise<{
    success: boolean;
    message: string;
    token?: string;
    user?: { username: string; displayName: string; role: string };
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

    let cleanUser = String(usernameInput || "").trim().toLowerCase();
    const cleanPass = String(passwordInput || "").trim();

    if (!cleanPass) {
      return { success: false, message: "Kripya Password enter karein." };
    }

    await this.syncProfilesFromFirestore();

    // If no username is provided, try finding matching profile by password or check boss
    if (!cleanUser) {
      const bossProfile = this.userProfiles.get("boss");
      const keyData = await this.getAppKeyData();
      if ((bossProfile && bossProfile.password === cleanPass) || (keyData && keyData.appKey === cleanPass)) {
        cleanUser = "boss";
      } else {
        // Search if any active profile has this password
        for (const [uname, prof] of this.userProfiles.entries()) {
          if (prof.isActive && prof.password === cleanPass) {
            cleanUser = uname;
            break;
          }
        }
      }
      if (!cleanUser) {
        cleanUser = "boss";
      }
    }

    const profile = this.userProfiles.get(cleanUser);

    // 3. Verify user profile and password
    if (profile && profile.isActive && profile.password === cleanPass) {
      // SUCCESS!
      this.failedAttempts.delete(cleanIp);
      this.verifyAttemptTimestamps.delete(cleanIp);

      const { token, sessionId } = this.generateSessionToken(
        profile.updatedAt,
        undefined,
        profile.username,
        profile.role
      );

      await this.registerActiveSession(
        sessionId,
        cleanIp,
        userAgent,
        Date.now(),
        profile.username,
        profile.role
      );

      // Record last login in profile
      profile.lastLoginAt = Date.now();
      profile.lastLoginIp = cleanIp;
      profile.lastLoginDevice = this.parseDeviceName(userAgent).name;
      db.collection("app_user_profiles").doc(profile.username).set(
        {
          lastLoginAt: profile.lastLoginAt,
          lastLoginIp: profile.lastLoginIp,
          lastLoginDevice: profile.lastLoginDevice,
        },
        { merge: true }
      ).catch(() => {});

      // Dispatch instant login notification to Boss via WhatsApp & Telegram
      this.dispatchLoginAlert(profile, cleanIp, userAgent).catch(() => {});

      return {
        success: true,
        token,
        user: {
          username: profile.username,
          displayName: profile.displayName,
          role: profile.role,
        },
        message: `Welcome back, ${profile.displayName}! ✅`,
      };
    }

    // 4. FAILURE -> Increment failed attempts for this IP
    const currentFail = this.failedAttempts.get(cleanIp) || { count: 0, lastFailed: 0, userAgent };
    currentFail.count += 1;
    currentFail.lastFailed = Date.now();
    currentFail.userAgent = userAgent;
    this.failedAttempts.set(cleanIp, currentFail);

    const attemptsLeft = this.maxFailedAttempts - currentFail.count;

    if (currentFail.count >= this.maxFailedAttempts) {
      // Automatically block IP & trigger instant alerts
      await this.blockClient(
        cleanIp,
        userAgent,
        `3 consecutive incorrect login attempts (Target user: ${cleanUser})`
      );
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
      message: `Galat Username ya Password! Access Denied ❌ (${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} bache hain)`,
    };
  }

  /**
   * Backwards-compatible verifyAppKey that delegates to verifyUserLogin.
   */
  public async verifyAppKey(
    inputKey: string,
    clientIp: string = "127.0.0.1",
    userAgent: string = "Unknown Device"
  ): Promise<{
    success: boolean;
    message: string;
    token?: string;
    user?: { username: string; displayName: string; role: string };
    blocked?: boolean;
    rateLimited?: boolean;
    remainingSeconds?: number;
    failedAttempts?: number;
  }> {
    return this.verifyUserLogin("", inputKey, clientIp, userAgent);
  }

  /**
   * Sets or updates the App Access Key in Firestore (max 10 chars/digits).
   * Automatically invalidates all existing sessions and forces global logout on all devices.
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

      // Auto force logout all devices so everyone must re-enter new key
      await this.logoutAll(`Naya App Access Key Boss (${senderName}) dwara update kiya gaya hai`, senderName);

      return {
        success: true,
        key: cleanKey,
        message: `Boss, aapka naya App Access Key [${cleanKey}] successfully save ho gaya hai! ✅\n\n` +
          `🔒 *Security Notice:* Sabhi active devices (Web aur Friday APK) ko automatically LOGOUT kar diya gaya hai taaki naye key ke bina koi app access na kar sake.`,
      };
    } catch (e: any) {
      console.warn("[AppSecurity] Saved App Key to local memory (Firestore offline):", e?.message || e);
      this.cachedKey = cleanKey;
      this.cachedUpdatedAt = Date.now();
      await this.logoutAll(`Naya App Access Key set hua`, senderName);
      return {
        success: true,
        key: cleanKey,
        message: `Boss, aapka naya App Access Key [${cleanKey}] set ho gaya hai! ✅ Sabhi active sessions logout ho chuke hain.`,
      };
    }
  }

  /**
   * Checks and handles incoming security commands from Owner:
   * 0. Logout All: "logout all", "/logout all", "logout every device", "sab logout"
   * 0.1 All Devices: "all device", "all devices", "all login device", "active devices", "sessions"
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

    // 0. Global Logout All Command
    const isLogoutAll = /^\/?(?:logout\s+all|all\s+logout|logout\s+every\s*device|logout\s+all\s*devices|sab\s+logout|force\s+logout\s*all|logout\s*sabhi|logout\s*all\s*device)/i.test(trimmed);
    if (isLogoutAll) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi globally sabhi devices ko logout kar sakte hain.",
        };
      }
      const res = await this.logoutAll("Boss requested remote global logout from " + source, senderName);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 0.1 All Devices / Active Logged-In Sessions Command
    const isDevicesQuery = /^\/?(?:all\s*device|all\s*devices|all\s*login\s*device|all\s*login\s*devices|login\s*device|logged\s*in\s*devices|active\s*devices|active\s*sessions|check\s*devices|devices|kis\s*kis\s*device\s*me\s*login|kaha\s*kaha\s*login)/i.test(trimmed);
    if (isDevicesQuery) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi logged-in devices list dekh sakte hain.",
        };
      }
      const sessions = await this.getActiveSessions();
      if (sessions.length === 0) {
        return {
          handled: true,
          replyText: `📱 *ALL LOGGED-IN SESSIONS & DEVICES (0)* 🛡️\n\nAbhi koi bhi active session ya device logged-in nahi hai. Sabhi web apps aur Friday APK lock screen par hain. ✅`,
        };
      }
      const formatted = sessions.map((s, idx) => {
        const lastActive = new Date(s.lastActiveAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
        const firstLogin = new Date(s.firstLoginAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
        return `${idx + 1}. ${s.deviceName}\n   🌐 IP: \`${s.ip}\`\n   ⏰ Active: \`${lastActive}\` (Logged in: ${firstLogin})`;
      }).join("\n\n");

      return {
        handled: true,
        replyText: `📱 *ALL LOGGED-IN SESSIONS & DEVICES (${sessions.length})* 🛡️\n\n${formatted}\n\n🚪 *Sabhi ko turant logout karne ke liye type karein:*\n👉 \`logout all\``,
      };
    }

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

    // 3. User Password Reset Command (e.g. "user-boss , new pass- 12345", "user- bhai, new pass- 9999", "reset pass bhai 1234")
    const resetPassPattern = /^(?:user[\s\:\-\=]+([^\s\,]+)[\s\,]+(?:new\s*pass|newpass|reset\s*pass)[\s\:\-\=]+([^\s]+)|(?:reset\s+pass|change\s+pass)\s+(?:for\s+)?([^\s]+)\s+([^\s]+)|user\s+([^\s]+)\s+new\s+pass\s+([^\s]+))/i;
    const resetPassMatch = trimmed.match(resetPassPattern);
    if (resetPassMatch) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi kisi bhi profile ka password reset kar sakte hain.",
        };
      }
      const targetUser = (resetPassMatch[1] || resetPassMatch[3] || resetPassMatch[5]).trim();
      const newPassword = (resetPassMatch[2] || resetPassMatch[4] || resetPassMatch[6]).trim();
      const res = await this.resetUserPassword(targetUser, newPassword, senderName, source);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 4. User Profile Creation / Update Command (e.g. "user- boss , pass- xxxxx", "user- bhai , pass- 12345", "create user bhai pass 12345")
    const createUserPattern = /^(?:user[\s\:\-\=]+([^\s\,]+)[\s\,]+pass(?:word)?[\s\:\-\=]+([^\s\,]+)(?:[\s\,]+(?:name|display)[\s\:\-\=]+([^\n\r]+))?|(?:create|add|new)\s+user\s+([^\s]+)\s+(?:pass|password)\s+([^\s]+)(?:\s+(?:name|role)\s+([^\n\r]+))?)/i;
    const createUserMatch = trimmed.match(createUserPattern);
    if (createUserMatch) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi naya user profile aur password create kar sakte hain.",
        };
      }
      const targetUser = (createUserMatch[1] || createUserMatch[4]).trim();
      const targetPass = (createUserMatch[2] || createUserMatch[5]).trim();
      const rawName = (createUserMatch[3] || createUserMatch[6])?.trim();
      const res = await this.createUserProfile(targetUser, targetPass, rawName, targetUser.toLowerCase() === "boss" ? "boss" : "member", senderName, source);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 5. User Profile Delete Command (e.g. "delete user bhai", "remove user bhai", "user delete bhai")
    const deleteUserPattern = /^(?:delete\s+user|remove\s+user|user\s+delete)[\s\:\-\=]+([^\s]+)/i;
    const deleteUserMatch = trimmed.match(deleteUserPattern);
    if (deleteUserMatch) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi user profile delete kar sakte hain.",
        };
      }
      const targetUser = deleteUserMatch[1].trim();
      const res = await this.deleteUserProfile(targetUser, senderName);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 6. List All User Profiles Command (e.g. "all users", "list users", "users list", "profiles")
    const isListUsers = /^\/?(?:all\s*users|list\s*users|users\s*list|show\s*users|profiles|all\s*profiles)/i.test(trimmed);
    if (isListUsers) {
      if (!isOwner) {
        return {
          handled: true,
          replyText: "⛔ *Permission Denied:* Sirf DK Boss (Owner) hi user profiles dekh sakte hain.",
        };
      }
      const profiles = await this.listUserProfiles();
      if (profiles.length === 0) {
        return {
          handled: true,
          replyText: "👥 *User Profiles (0):*\n\nAbhi koi bhi profiles registered nahi hain. 'boss' profile create karne ke liye type karein:\n👉 `user- boss , pass- <password>`",
        };
      }

      const formatted = profiles.map((p, idx) => {
        const lastLogin = p.lastLoginAt
          ? new Date(p.lastLoginAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })
          : "Never";
        return `${idx + 1}. ${p.role === "boss" ? "👑" : "👤"} *${p.username}* (${p.displayName})\n   🏷️ Role: \`${p.role.toUpperCase()}\` | Pass: \`${p.password}\`\n   ⏰ Last Login: \`${lastLogin}\`${p.lastLoginDevice ? ` on ${p.lastLoginDevice}` : ""}`;
      }).join("\n\n");

      return {
        handled: true,
        replyText: `👥 *REGISTERED USER PROFILES (${profiles.length})* 🛡️\n\n${formatted}\n\n📝 *Boss Commands:*\n👉 \`user- <name> , pass- <pass>\` (Create / Update)\n👉 \`user- <name> , new pass- <newpass>\` (Reset Password)\n👉 \`delete user <name>\` (Delete Profile)`,
      };
    }

    // 7. Legacy App Key Update Command (e.g. "app key - 123456", "app pass 987654", "set app key 1234")
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

  /**
   * Checks whether app lock key verification is required
   */
  public isAppKeyRequired(): boolean {
    return !!this.cachedKey;
  }
}

export const appSecurityService = new AppSecurityService();

