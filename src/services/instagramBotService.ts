import { IgApiClient } from "instagram-private-api";
import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { dailyUpdateService } from "./dailyUpdateService";
import { humanBotFirewallService } from "./humanBotFirewallService";
import fs from "fs";
import path from "path";

export interface InstagramStatus {
  isLoggedIn: boolean;
  username: string | null;
  fullName: string | null;
  profilePicUrl?: string | null;
  lastCheckedAt: number | null;
  totalMessagesProcessed: number;
  autoReplyEnabled: boolean;
  requiresTwoFactor?: boolean;
  twoFactorInfo?: any;
  lastError?: string | null;
  isEnvConfigured?: boolean;
}

export interface InstagramUserProfile {
  igid: string;
  username?: string;
  name?: string;
  lastSeenAt: number;
  messageCount: number;
}

const LOCAL_SESSION_FILE = path.resolve(process.cwd(), "data", "instagram_session.json");

class InstagramBotService {
  private ig: IgApiClient | null = null;
  private isLoggedIn: boolean = false;
  private currentUsername: string | null = null;
  private currentFullName: string | null = null;
  private currentProfilePicUrl: string | null = null;
  private lastCheckedAt: number | null = null;
  private totalMessagesProcessed: number = 0;
  private autoReplyEnabled: boolean = true;
  private pollInterval: any = null;
  private processedItemIds: Set<string> = new Set();
  private pendingTwoFactor: { twoFactorIdentifier: string; username: string } | null = null;
  private messageCallback: ((msg: { sender: string; text: string; time: string; igid: string }) => void) | null = null;
  private lastError: string | null = null;
  private activeSessionId: string | null = null;

  // Multi-tier model fallback chain
  private static readonly MODEL_FALLBACK_CHAIN = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

  constructor() {
    this.initSession();
  }

  public getActiveSessionId(): string | null {
    if (this.activeSessionId) return this.activeSessionId;
    const envSession = (process.env.INSTAGRAM_SESSION_ID || process.env.INSTAGRAM_SESSIONID || process.env.INSTAGRAM_COOKIE || "").trim();
    if (envSession) {
      let clean = envSession;
      if (clean.startsWith("sessionid=")) clean = clean.substring("sessionid=".length).trim();
      clean = clean.replace(/^["']|["']$/g, "");
      if (clean) return clean;
    }
    return null;
  }

  private ensureDataDir() {
    const dir = path.dirname(LOCAL_SESSION_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initializes session from .env Session ID or Firestore or Local JSON or .env credentials
   */
  public async initSession() {
    try {
      // 1. Priority 1: Check .env INSTAGRAM_SESSION_ID or INSTAGRAM_SESSIONID or INSTAGRAM_COOKIE
      const envSession = (process.env.INSTAGRAM_SESSION_ID || process.env.INSTAGRAM_SESSIONID || process.env.INSTAGRAM_COOKIE || "").trim();
      const envUser = (process.env.INSTAGRAM_USERNAME || "").trim();

      if (envSession) {
        console.log("[InstagramBot] Auto-logging in via .env INSTAGRAM_SESSION_ID...");
        const res = await this.loginWithSessionId(envSession, envUser || undefined);
        if (res.success) {
          this.lastError = null;
          return;
        } else {
          this.lastError = res.message;
          console.warn("[InstagramBot] .env session login failed:", res.message);
        }
      }

      // 2. Priority 2: Try restore from Firestore
      const sessionDoc = await db.collection("instagram_auth").doc("session").get().catch(() => null);
      if (sessionDoc && sessionDoc.exists) {
        const data = sessionDoc.data() as any;
        if (data?.session && data?.username) {
          console.log(`[InstagramBot] Restoring session from Firestore for @${data.username}...`);
          const restored = await this.restoreSession(data.username, data.session);
          if (restored) {
            this.lastError = null;
            return;
          }
        }
      }

      // 3. Priority 3: Try restore from Local File
      if (fs.existsSync(LOCAL_SESSION_FILE)) {
        try {
          const raw = fs.readFileSync(LOCAL_SESSION_FILE, "utf-8");
          const data = JSON.parse(raw);
          if (data?.session && data?.username) {
            console.log(`[InstagramBot] Restoring session from local cache for @${data.username}...`);
            const restored = await this.restoreSession(data.username, data.session);
            if (restored) {
              this.lastError = null;
              return;
            }
          }
        } catch {}
      }

      // 4. Priority 4: Fallback auto-login with .env username/password if provided
      const envPass = (process.env.INSTAGRAM_PASSWORD || "").trim();
      if (envUser && envPass) {
        console.log(`[InstagramBot] Auto-logging in via .env credentials for @${envUser}...`);
        const res = await this.login(envUser, envPass);
        if (res.success) {
          this.lastError = null;
        } else {
          this.lastError = res.message;
        }
      }
    } catch (e: any) {
      console.warn("[InstagramBot] Init session standby:", e?.message || e);
      this.lastError = e?.message || String(e);
    }
  }

  private async saveSessionToStorage(username: string, sessionState: any) {
    try {
      this.ensureDataDir();
      fs.writeFileSync(LOCAL_SESSION_FILE, JSON.stringify({ username, session: sessionState }, null, 2));

      await db.collection("instagram_auth").doc("session").set(
        {
          username,
          session: sessionState,
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(() => {});
    } catch (e: any) {
      console.warn("[InstagramBot] Failed to save session to storage:", e?.message || e);
    }
  }

  /**
   * Configures a genuine Indian Mobile Device profile for Instagram API client
   * matching standard Android device identity with IST timezone (+05:30) and Indian locale.
   */
  private configureIndianDevice(ig: IgApiClient, username: string) {
    ig.state.generateDevice(username);
    ig.state.timezoneOffset = "19800"; // +05:30 IST
    ig.state.language = "en_IN";
    ig.state.radioType = "wifi-none";
  }

  private async restoreSession(username: string, sessionState: any): Promise<boolean> {
    try {
      const ig = new IgApiClient();
      this.configureIndianDevice(ig, username);
      await ig.state.deserialize(sessionState);

      // Verify that session is valid
      const currentUser = await ig.account.currentUser();
      if (currentUser && currentUser.pk) {
        this.ig = ig;
        this.isLoggedIn = true;
        this.currentUsername = currentUser.username;
        this.currentFullName = currentUser.full_name || currentUser.username;
        this.currentProfilePicUrl = currentUser.profile_pic_url || null;
        console.log(`[InstagramBot] Session active & verified for @${currentUser.username} (${currentUser.full_name})!`);

        this.startInboxPolling();
        return true;
      }
    } catch (e: any) {
      console.warn("[InstagramBot] Saved session expired or invalid:", e?.message || e);
    }
    return false;
  }

  /**
   * Direct Login with Instagram Username & Password (and optional 2FA / Verification code)
   */
  public async login(username: string, password?: string, verificationCode?: string): Promise<{ success: boolean; requiresTwoFactor?: boolean; message: string }> {
    let cleanUser = username.trim().replace(/^@/, "");
    // If it's not an email, strip extra spaces
    if (!cleanUser.includes("@")) {
      cleanUser = cleanUser.replace(/\s+/g, "");
    }

    try {
      // If resolving 2FA challenge
      if (verificationCode && this.pendingTwoFactor && this.ig) {
        console.log(`[InstagramBot] Submitting 2FA code for @${cleanUser}...`);
        const twoFactorRes = await this.ig.account.twoFactorLogin({
          username: cleanUser.toLowerCase(),
          verificationCode: verificationCode.trim(),
          twoFactorIdentifier: this.pendingTwoFactor.twoFactorIdentifier,
          verificationMethod: "1", // SMS or Authenticator App
        });

        this.isLoggedIn = true;
        const userObj: any = twoFactorRes;
        this.currentUsername = userObj.username || userObj.logged_in_user?.username || cleanUser;
        this.currentFullName = userObj.full_name || userObj.logged_in_user?.full_name || this.currentUsername;
        this.currentProfilePicUrl = userObj.profile_pic_url || userObj.logged_in_user?.profile_pic_url || null;
        this.pendingTwoFactor = null;

        const sessionState = await this.ig.state.serialize();
        await this.saveSessionToStorage(this.currentUsername, sessionState);
        this.startInboxPolling();

        return {
          success: true,
          message: `Instagram login successful for @${this.currentUsername}! 🎉`,
        };
      }

      if (!password) {
        return { success: false, message: "Password is required for Instagram login." };
      }

      console.log(`[InstagramBot] Logging in to Instagram as ${cleanUser}...`);
      const ig = new IgApiClient();
      this.configureIndianDevice(ig, cleanUser);

      // Perform pre-login flow simulation so Instagram registers mobile device handshake
      try {
        await ig.simulate.preLoginFlow();
      } catch (flowErr) {
        console.warn("[InstagramBot] Pre-login simulation notice:", flowErr);
      }

      try {
        const user = await ig.account.login(cleanUser, password);
        this.ig = ig;
        this.isLoggedIn = true;
        this.currentUsername = user.username;
        this.currentFullName = user.full_name || user.username;
        this.currentProfilePicUrl = user.profile_pic_url || null;

        // Post-login flow in background
        process.nextTick(async () => {
          try {
            await ig.simulate.postLoginFlow();
          } catch {}
        });

        const sessionState = await ig.state.serialize();
        await this.saveSessionToStorage(user.username, sessionState);
        this.startInboxPolling();

        console.log(`[InstagramBot] Logged in successfully as @${user.username}!`);
        return {
          success: true,
          message: `Instagram login successful for @${user.username}! 🎉`,
        };
      } catch (loginError: any) {
        // Handle 2FA / Two-Factor Authentication requirement
        if (loginError.name === "IgLoginTwoFactorRequiredError" || loginError.response?.body?.two_factor_required) {
          const twoFactorInfo = loginError.response?.body?.two_factor_info || {};
          this.ig = ig;
          this.pendingTwoFactor = {
            twoFactorIdentifier: twoFactorInfo.two_factor_identifier || "",
            username: cleanUser,
          };
          return {
            success: false,
            requiresTwoFactor: true,
            message: "Instagram 2FA verification code required. Please enter the OTP sent to your phone/authenticator.",
          };
        }

        // Handle Checkpoint / Challenge
        if (loginError.name === "IgCheckpointError") {
          return {
            success: false,
            message: "Instagram security checkpoint triggered. Please open Instagram on your phone once to tap 'This Was Me', then login again or use Session ID login.",
          };
        }

        // Account not found or bad request
        const rawMsg = loginError?.response?.body?.message || loginError?.message || "";
        if (rawMsg.toLowerCase().includes("can't find an account") || rawMsg.includes("400")) {
          return {
            success: false,
            message: `Instagram ko account nahi mila. Agar username/number se nahi ho raha, toh apna registered Email ID daalein ya neeche 'Session ID Login' use karein.`,
          };
        }

        throw loginError;
      }
    } catch (e: any) {
      console.error("[InstagramBot] Login error:", e?.message || e);
      return {
        success: false,
        message: e?.response?.body?.message || e?.message || "Instagram login failed. Please verify credentials.",
      };
    }
  }

  /**
   * Login using Instagram Web sessionid cookie (Bypasses Meta account lookup, checkpoints & password challenges)
   */
  public async loginWithSessionId(sessionId: string, usernameHint?: string): Promise<{ success: boolean; message: string }> {
    try {
      let cleanSession = (sessionId || "").trim();
      if (cleanSession.startsWith("sessionid=")) {
        cleanSession = cleanSession.substring("sessionid=".length).trim();
      }
      cleanSession = cleanSession.replace(/^["']|["']$/g, "");

      if (!cleanSession) {
        return { success: false, message: "Valid Instagram sessionid is required." };
      }

      this.activeSessionId = cleanSession;
      console.log("[InstagramBot] Logging in via Session ID cookie...");
      const ig = new IgApiClient();

      let dsUserId = "0";
      // Instagram sessionid format is typically: <numeric_ds_user_id>%3A<token> or <numeric_ds_user_id>:<token>
      const parts = cleanSession.split(/%3A|:/);
      if (parts.length > 0 && /^\d+$/.test(parts[0])) {
        dsUserId = parts[0];
      }

      this.configureIndianDevice(ig, dsUserId !== "0" ? dsUserId : (usernameHint || "user_session"));

      const csrfToken = "csrftoken_" + Math.random().toString(36).substring(2, 12);
      const mid = "Y" + Math.random().toString(36).substring(2, 10);

      const jarSerialized = {
        version: "tough-cookie@4.1.4",
        storeType: "MemoryCookieStore",
        rejectPublicSuffixes: true,
        cookies: [
          {
            key: "sessionid",
            value: cleanSession,
            domain: "i.instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: true,
            secure: true,
          },
          {
            key: "sessionid",
            value: cleanSession,
            domain: "instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: true,
            secure: true,
          },
          {
            key: "ds_user_id",
            value: dsUserId,
            domain: "i.instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: false,
            secure: true,
          },
          {
            key: "ds_user_id",
            value: dsUserId,
            domain: "instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: false,
            secure: true,
          },
          {
            key: "csrftoken",
            value: csrfToken,
            domain: "i.instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: false,
            secure: true,
          },
          {
            key: "mid",
            value: mid,
            domain: "i.instagram.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            httpOnly: false,
            secure: true,
          },
        ],
      };

      await ig.state.deserializeCookieJar(jarSerialized as any);

      // Multi-strategy user resolver (bypasses the fragile /api/v1/accounts/current_user/?edit=true endpoint)
      let resolvedUsername = usernameHint ? usernameHint.replace(/^@/, "").trim() : "";
      let resolvedFullName = resolvedUsername || "Instagram User";
      let resolvedPic: string | null = null;
      let isVerified = false;

      // Strategy 1: Direct Web Profile Endpoint with session cookie
      if (dsUserId !== "0") {
        try {
          const webRes = await fetch(`https://www.instagram.com/api/v1/users/${dsUserId}/info/`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
              "Cookie": `sessionid=${cleanSession}; ds_user_id=${dsUserId};`,
              "X-IG-App-ID": "936619743392459",
            },
          });
          if (webRes.ok) {
            const data = await webRes.json();
            if (data?.user?.username) {
              resolvedUsername = data.user.username;
              resolvedFullName = data.user.full_name || resolvedUsername;
              resolvedPic = data.user.profile_pic_url || null;
              isVerified = true;
              console.log(`[InstagramBot] Verified via Instagram Web API: @${resolvedUsername}`);
            }
          }
        } catch (webErr: any) {
          console.warn("[InstagramBot] Web info strategy notice:", webErr?.message);
        }
      }

      // Strategy 2: Try ig.user.info(dsUserId) via private API
      if (!isVerified && dsUserId !== "0") {
        try {
          const uInfo = await ig.user.info(dsUserId);
          if (uInfo && (uInfo as any).username) {
            resolvedUsername = (uInfo as any).username;
            resolvedFullName = (uInfo as any).full_name || resolvedUsername;
            resolvedPic = (uInfo as any).profile_pic_url || null;
            isVerified = true;
            console.log(`[InstagramBot] Verified via ig.user.info: @${resolvedUsername}`);
          }
        } catch (uErr: any) {
          console.warn("[InstagramBot] ig.user.info strategy notice:", uErr?.message);
        }
      }

      // Strategy 3: Try ig.feed.directInbox() to confirm session works
      if (!isVerified) {
        try {
          const inbox = await ig.feed.directInbox().request();
          if (inbox) {
            isVerified = true;
            if ((inbox as any).viewer?.username) {
              resolvedUsername = (inbox as any).viewer.username;
              resolvedFullName = (inbox as any).viewer.full_name || resolvedUsername;
              resolvedPic = (inbox as any).viewer.profile_pic_url || null;
            }
            console.log(`[InstagramBot] Verified via directInbox session handshake!`);
          }
        } catch (inboxErr: any) {
          console.warn("[InstagramBot] directInbox verification notice:", inboxErr?.message);
        }
      }

      // Strategy 4: Try ig.account.currentUser()
      if (!isVerified) {
        try {
          const currentUser = await ig.account.currentUser();
          if (currentUser && currentUser.username) {
            resolvedUsername = currentUser.username;
            resolvedFullName = currentUser.full_name || currentUser.username;
            resolvedPic = currentUser.profile_pic_url || null;
            isVerified = true;
          }
        } catch (curErr: any) {
          console.warn("[InstagramBot] ig.account.currentUser strategy failed:", curErr?.message);
        }
      }

      // If we have a dsUserId or any verification succeeded, accept session
      if (isVerified || dsUserId !== "0") {
        if (!resolvedUsername) {
          resolvedUsername = `user_${dsUserId}`;
          resolvedFullName = `Instagram User (${dsUserId})`;
        }

        this.ig = ig;
        this.isLoggedIn = true;
        this.currentUsername = resolvedUsername;
        this.currentFullName = resolvedFullName;
        this.currentProfilePicUrl = resolvedPic;

        const sessionState = await ig.state.serialize();
        await this.saveSessionToStorage(resolvedUsername, sessionState);
        this.startInboxPolling();

        console.log(`[InstagramBot] Session login successful for @${resolvedUsername}! 🎉`);
        return {
          success: true,
          message: `Instagram session login successful for @${resolvedUsername}! 🎉`,
        };
      }

      return {
        success: false,
        message: "Invalid or expired Instagram Session ID. Please re-copy from browser and try again.",
      };
    } catch (e: any) {
      console.error("[InstagramBot] Session login error:", e?.message || e);
      return {
        success: false,
        message: e?.message || "Session login failed. Please verify your sessionid cookie.",
      };
    }
  }

  /**
   * Log out & clear saved sessions
   */
  public async logout(): Promise<{ success: boolean; message: string }> {
    try {
      this.isLoggedIn = false;
      this.currentUsername = null;
      this.currentFullName = null;
      this.currentProfilePicUrl = null;
      this.ig = null;
      this.activeSessionId = null;

      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      // Remove from Firestore & Local file
      await db.collection("instagram_auth").doc("session").delete().catch(() => {});
      if (fs.existsSync(LOCAL_SESSION_FILE)) {
        try { fs.unlinkSync(LOCAL_SESSION_FILE); } catch {}
      }

      return { success: true, message: "Logged out from Instagram successfully." };
    } catch (e: any) {
      return { success: false, message: e?.message || "Failed to logout." };
    }
  }

  public getStatus(): InstagramStatus {
    const hasEnvSession = !!(process.env.INSTAGRAM_SESSION_ID || process.env.INSTAGRAM_SESSIONID || process.env.INSTAGRAM_COOKIE);
    const hasEnvCreds = !!(process.env.INSTAGRAM_USERNAME && process.env.INSTAGRAM_PASSWORD);

    return {
      isLoggedIn: this.isLoggedIn,
      username: this.currentUsername,
      fullName: this.currentFullName,
      profilePicUrl: this.currentProfilePicUrl,
      lastCheckedAt: this.lastCheckedAt,
      totalMessagesProcessed: this.totalMessagesProcessed,
      autoReplyEnabled: this.autoReplyEnabled,
      requiresTwoFactor: !!this.pendingTwoFactor,
      lastError: this.lastError,
      isEnvConfigured: hasEnvSession || hasEnvCreds,
    };
  }

  public setAutoReply(enabled: boolean) {
    this.autoReplyEnabled = enabled;
  }

  public setMessageCallback(cb: (msg: { sender: string; text: string; time: string; igid: string }) => void) {
    this.messageCallback = cb;
  }

  /**
   * Starts periodic inbox polling with randomized Gaussian jitter and circadian awareness
   * to avoid repetitive machine interval signatures on Meta servers.
   */
  private startInboxPolling() {
    if (this.pollInterval) clearTimeout(this.pollInterval);

    // Initial check after 3.5s
    this.pollInterval = setTimeout(() => {
      this.checkInbox().catch(() => {});
      this.scheduleNextInboxCheck();
    }, 3500);
  }

  private scheduleNextInboxCheck() {
    if (this.pollInterval) clearTimeout(this.pollInterval);
    if (!this.isLoggedIn) return;

    // Random interval between 18s and 32s scaled by Circadian night/day multiplier
    const circadian = humanBotFirewallService.getCircadianDelayMultiplier();
    const baseMs = 18000 + Math.floor(Math.random() * 14000); // 18s - 32s
    const actualDelay = Math.round(baseMs * circadian.multiplier);

    this.pollInterval = setTimeout(async () => {
      try {
        await this.checkInbox();
      } catch {}
      this.scheduleNextInboxCheck();
    }, actualDelay);
  }

  /**
   * Polls Direct Inbox for new incoming messages
   */
  public async checkInbox() {
    if (!this.ig || !this.isLoggedIn) return;

    try {
      this.lastCheckedAt = Date.now();
      const inbox = this.ig.feed.directInbox();
      const threads = await inbox.items();

      for (const thread of threads) {
        if (!thread.items || thread.items.length === 0) continue;

        const latestItem = thread.items[0];
        const itemId = latestItem.item_id;

        // Skip already processed items
        if (this.processedItemIds.has(itemId)) continue;
        this.processedItemIds.add(itemId);

        // Keep set size reasonable
        if (this.processedItemIds.size > 500) {
          const arr = Array.from(this.processedItemIds);
          this.processedItemIds = new Set(arr.slice(-250));
        }

        // Only process text messages not sent by logged in user
        const isFromSelf = String(latestItem.user_id) === String(this.ig.state.cookieUserId);
        if (isFromSelf || latestItem.item_type !== "text") continue;

        const text = latestItem.text?.trim() || "";
        if (!text) continue;

        const senderUser = thread.users?.[0];
        const senderName = senderUser?.full_name || senderUser?.username || "Instagram User";
        const senderUsername = senderUser?.username || "";
        const senderPk = senderUser?.pk?.toString() || "";

        this.totalMessagesProcessed++;

        // Save sender user to Firestore
        if (senderPk) {
          this.saveInstagramUser(senderPk, senderName, senderUsername).catch(() => {});
        }

        // Notify UI
        if (this.messageCallback) {
          this.messageCallback({
            sender: `📸 ${senderName} (@${senderUsername})`,
            text,
            time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
            igid: senderPk,
          });
        }

        // Auto-reply if enabled
        if (this.autoReplyEnabled) {
          const recipientKey = senderUsername || senderPk;
          const firewallCheck = humanBotFirewallService.canSendAutoReply("instagram", recipientKey);
          
          if (!firewallCheck.allowed) {
            console.log(`[InstagramBot] Auto-reply rate-limited by Human Firewall: ${firewallCheck.reason}`);
          } else {
            try {
              console.log(`[InstagramBot] Generating human-like AI reply for @${senderUsername}: "${text}"`);
              const reply = await this.generateSmartAutoReply(senderName, text);
              
              // Simulate human reading time + typing presence
              await humanBotFirewallService.simulateInstagramHumanTyping(this.ig, thread.thread_id, itemId, text, reply);

              const directThread = this.ig.entity.directThread(thread.thread_id);
              await directThread.broadcastText(reply);
              humanBotFirewallService.recordDispatchedMessage("instagram", recipientKey);

              console.log(`[InstagramBot] Sent Human AI reply to @${senderUsername}: "${reply.substring(0, 50)}..."`);
            } catch (replyErr: any) {
              console.warn(`[InstagramBot] Failed to auto-reply to @${senderUsername}:`, replyErr?.message || replyErr);
            }
          }
        }
      }
    } catch (e: any) {
      // If login session expired during poll
      if (e?.message?.includes("login_required") || e?.name === "IgLoginRequiredError") {
        console.warn("[InstagramBot] Session expired during inbox check. Marking logged out.");
        this.isLoggedIn = false;
      }
    }
  }

  /**
   * Sends an Instagram DM directly by username or user ID.
   */
  public async sendMessageToTarget(
    target: string,
    message: string
  ): Promise<{ success: boolean; message: string; resolvedName?: string }> {
    if (!this.ig || !this.isLoggedIn) {
      return {
        success: false,
        message: "Instagram is not connected. Please log in with your Instagram ID & Password in Friday settings.",
      };
    }

    const cleanTarget = String(target || "").trim().replace(/^@/, "");
    if (!cleanTarget || !message) {
      return { success: false, message: "Recipient and message text are required." };
    }

    try {
      let targetPk: string | null = null;
      let displayName: string = cleanTarget;

      // 1. If numeric PK
      if (/^\d{6,25}$/.test(cleanTarget)) {
        targetPk = cleanTarget;
      } else {
        // 2. Search exact username using Instagram API
        try {
          const user = await this.ig.user.searchExact(cleanTarget);
          if (user && user.pk) {
            targetPk = user.pk.toString();
            displayName = user.full_name || `@${user.username}`;
          }
        } catch {
          // If searchExact fails, fallback to general search
          const searchRes = await this.ig.user.search(cleanTarget);
          if (searchRes.users && searchRes.users.length > 0) {
            const first = searchRes.users[0];
            targetPk = first.pk.toString();
            displayName = first.full_name || `@${first.username}`;
          }
        }
      }

      if (!targetPk) {
        return {
          success: false,
          message: `Boss, Instagram par '${target}' ka account nahi mila. Kripya correct username check karein.`,
        };
      }

      // Simulate human typing delay before sending DM
      const typingDelay = humanBotFirewallService.calculateDynamicTypingDelay(message);
      await new Promise((resolve) => setTimeout(resolve, Math.min(typingDelay, 4000)));

      // Create or get direct thread and send text
      const thread = this.ig.entity.directThread([targetPk]);
      await thread.broadcastText(message);
      humanBotFirewallService.recordDispatchedMessage("instagram", cleanTarget);

      return {
        success: true,
        resolvedName: displayName,
        message: `Boss, Instagram par ${displayName} ko DM bhej diya gaya hai: "${message}" ✅`,
      };
    } catch (e: any) {
      console.error(`[InstagramBot] Send DM to ${target} failed:`, e?.message || e);
      return {
        success: false,
        message: `Instagram DM send failed: ${e?.message || String(e)}`,
      };
    }
  }

  public async saveInstagramUser(igid: string, name?: string, username?: string): Promise<void> {
    try {
      const ref = db.collection("instagramUsers").doc(igid);
      const snap = await ref.get();
      const count = snap.exists ? (snap.data()?.messageCount || 0) + 1 : 1;

      const profile: InstagramUserProfile = {
        igid,
        name: name || snap.data()?.name || "Instagram User",
        lastSeenAt: Date.now(),
        messageCount: count,
      };

      const resolvedUsername = username ? username.toLowerCase().replace(/^@/, "") : snap.data()?.username;
      if (resolvedUsername) {
        profile.username = resolvedUsername;
      }

      await ref.set(profile, { merge: true });
    } catch (e) {
      console.warn("[InstagramBot] Failed to save Instagram user profile:", e);
    }
  }

  /**
   * Checks if an incoming message is requesting a sensitive / privileged action.
   */
  private isSensitiveAction(text: string): boolean {
    const sensitivePatterns = [
      /(commit|push|merge|code\s*agent|rollback|deploy|branch)/i,
      /(voice\s*pin|security\s*pin|password\s*change|update\s*pin)/i,
      /(delete\s*memory|delete\s*contact|delete\s*profile|wipe\s*data|clear\s*database)/i,
      /(bank|account\s*number|credit\s*card|debit\s*card|otp|password)/i,
      /(private\s*secret|personal\s*secret|confidential)/i,
    ];
    return sensitivePatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Generates a smart conversational reply using Gemini multi-tier model fallback.
   */
  private async generateSmartAutoReply(senderName: string, messageText: string): Promise<string> {
    if (this.isSensitiveAction(messageText)) {
      return `Haanji ${senderName}! Main Friday hoon (DK Boss ka AI assistant). Security policy ke mutabiq sensitive actions ya confidential settings Instagram se allow nahi hain. Kripya DK se direct WhatsApp ya Voice call par sampark karein. 🙏`;
    }

    try {
      const updateAnswer = await dailyUpdateService.answerFromTodayUpdate(messageText);
      if (updateAnswer) {
        return `Haanji ${senderName}! ${updateAnswer}`;
      }
    } catch {}

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return `Haanji ${senderName}! Main Friday hoon — DK Boss (Divakar Kumar) ka AI assistant. Boss abhi busy hain, maine aapka DM note kar liya hai aur wo jaldi reply karenge 👍`;
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, witty, loyal, human-like AI companion on Instagram Direct Messages.

CHAT CONTEXT:
Instagram User: "${senderName}"
DM Received: "${messageText}"

INSTRUCTIONS:
1. IDENTITY & CREATOR:
   - Identify as Friday: DK Boss's (Divakar Kumar) personal AI assistant.
2. STATUS & BOSS BUSY:
   - Clarify that DK Boss is currently occupied/busy.
   - Assure them: "Maine aapka message/DM note kar liya hai, jaise hi DK free honge wo aapko reply karenge."
3. STRICT SENSITIVE PRIVACY GUARD:
   - Never leak passwords, banking, personal secrets, home address, or confidential data.
4. TONE & STYLE:
   - Natural Hindi/Hinglish (mix of Hindi and English).
   - Warm, polite, crisp, human-like (1-3 short sentences max).
   - Return ONLY the exact text to send in the Instagram DM.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of InstagramBotService.MODEL_FALLBACK_CHAIN) {
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
          return reply;
        }
      } catch (err: any) {
        console.warn(`[InstagramBot] ${model} fallback:`, err?.message || err);
      }
    }

    return `Haanji ${senderName}! Main Friday hoon — DK Boss abhi busy hain, maine aapka DM note kar liya hai 👍`;
  }

  /**
   * Sends a Photo/Image with realistic 0.5s tap simulation for picker and send action.
   */
  public async sendPhotoMessage(target: string, imageBuffer: Buffer): Promise<{ success: boolean; message: string }> {
    if (!this.ig || !this.isLoggedIn) {
      return { success: false, message: "Instagram is not connected. Please log in first." };
    }

    try {
      const cleanTarget = String(target || "").trim().replace(/^@/, "");
      const user = await this.ig.user.searchExact(cleanTarget);
      if (!user || !user.pk) {
        return { success: false, message: `Instagram user @${target} not found.` };
      }

      // Simulate Human Photo Picker & Taps (0.5s intervals)
      await humanBotFirewallService.simulateInstagramPhotoDelays();

      const thread = this.ig.entity.directThread([user.pk.toString()]);
      await thread.broadcastPhoto({ file: imageBuffer });
      humanBotFirewallService.recordDispatchedMessage("instagram", cleanTarget);

      return { success: true, message: `Photo sent to @${cleanTarget} on Instagram!` };
    } catch (e: any) {
      return { success: false, message: `Failed to send photo on Instagram: ${e?.message || e}` };
    }
  }

  /**
   * Human-Paced Search / Live Search via Instagram Session:
   * Uses authenticated Session ID topsearch and IgApiClient search to find real Instagram users.
   */
  public async searchUserHumanPaced(query: string): Promise<any> {
    return this.searchUserLive(query);
  }

  /**
   * Real-time Instagram Live Search using Session ID & IgApiClient:
   * 1. If logged in to IgApiClient -> searches live via ig.user.search(query)
   * 2. If Session ID is available -> searches live via Instagram Web Topsearch API (context=blended)
   * 3. Fallback -> Instagram Web Topsearch / profile query
   */
  public async searchUserLive(query: string): Promise<any> {
    const raw = String(query || "").replace(/^@/, "").trim();
    if (!raw) {
      return { success: false, message: "Search query zaroori hai." };
    }

    const sessionId = this.getActiveSessionId();
    let dsUserId = "0";
    if (sessionId) {
      const parts = sessionId.split(/%3A|:/);
      if (parts.length > 0 && /^\d+$/.test(parts[0])) {
        dsUserId = parts[0];
      }
    }

    // 1. Try via IgApiClient session if logged in
    if (this.ig && this.isLoggedIn) {
      try {
        await humanBotFirewallService.simulateInstagramSearchTyping(raw);
        const searchRes = await this.ig.user.search(raw);
        if (searchRes && Array.isArray(searchRes.users) && searchRes.users.length > 0) {
          const profiles = searchRes.users.slice(0, 8).map((u, idx) => ({
            rank: idx + 1,
            pk: u.pk?.toString(),
            username: u.username,
            fullName: u.full_name || u.username,
            profileUrl: `https://www.instagram.com/${u.username}/`,
            isVerified: !!u.is_verified,
            isPrivate: !!u.is_private,
            profilePicUrl: u.profile_pic_url || null,
          }));

          return {
            success: true,
            query: raw,
            totalFound: profiles.length,
            profiles,
            sourceProvider: "instagram_logged_in_session",
            message: `Instagram session se "${raw}" ke ${profiles.length} real profiles mil gaye hain.`,
          };
        }
      } catch (igErr: any) {
        console.warn("[InstagramBot] IgApiClient searchUser notice:", igErr?.message || igErr);
      }
    }

    // 2. Query Instagram Live Web Topsearch with Session ID cookie
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com/",
      };

      if (sessionId) {
        headers["Cookie"] = `sessionid=${sessionId}; ds_user_id=${dsUserId};`;
      }

      const searchUrl = `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(raw)}&rank_token=${Math.random().toString(36).substring(2, 10)}`;
      const res = await fetch(searchUrl, { headers });

      if (res.ok) {
        const data: any = await res.json();
        const rawUsers = data?.users || [];
        if (Array.isArray(rawUsers) && rawUsers.length > 0) {
          const profiles = rawUsers.slice(0, 8).map((item: any, idx: number) => {
            const u = item.user || item;
            return {
              rank: idx + 1,
              pk: u.pk?.toString() || u.id?.toString(),
              username: u.username,
              fullName: u.full_name || u.username,
              profileUrl: `https://www.instagram.com/${u.username}/`,
              isVerified: !!u.is_verified,
              isPrivate: !!u.is_private,
              profilePicUrl: u.profile_pic_url || null,
            };
          });

          return {
            success: true,
            query: raw,
            totalFound: profiles.length,
            profiles,
            sourceProvider: sessionId ? "instagram_session_topsearch" : "instagram_web_topsearch",
            message: `Instagram session se "${raw}" ke ${profiles.length} live profiles search ho gaye hain.`,
          };
        }
      }
    } catch (webSearchErr: any) {
      console.warn("[InstagramBot] Web TopSearch failed:", webSearchErr?.message || webSearchErr);
    }

    // 3. If query might be a direct handle, check live profile info
    try {
      const infoRes = await this.getUserInfoLive(raw);
      if (infoRes && infoRes.success && infoRes.username) {
        return {
          success: true,
          query: raw,
          totalFound: 1,
          profiles: [
            {
              rank: 1,
              username: infoRes.username,
              fullName: infoRes.fullName || infoRes.username,
              profileUrl: infoRes.profileUrl || `https://www.instagram.com/${infoRes.username}/`,
              isVerified: !!infoRes.isVerified,
              isPrivate: !!infoRes.isPrivate,
              followersCount: infoRes.followersCount,
              followingCount: infoRes.followingCount,
              totalPosts: infoRes.totalPosts,
              bio: infoRes.biography,
              profilePicUrl: infoRes.profilePicUrl,
            },
          ],
          sourceProvider: infoRes.sourceProvider || "instagram_live_profile",
          message: `Instagram par @${infoRes.username} ka live profile mil gaya hai.`,
        };
      }
    } catch {}

    // 4. Honest response if not found anywhere on Instagram
    return {
      success: true,
      query: raw,
      totalFound: 0,
      profiles: [],
      notFound: true,
      message: `Boss, Instagram par "${raw}" search karne par koi profile nahi mila. Kripya correct spelling ya exact username check karein.`,
      instagramSearchUrl: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(raw)}`,
    };
  }

  /**
   * Live Instagram User Info Lookup via Session ID / IgApiClient / Web Profile API:
   */
  public async getUserInfoLive(usernameOrQuery: string): Promise<any> {
    const raw = String(usernameOrQuery || "").replace(/^@/, "").trim();
    if (!raw) return { success: false, message: "Instagram username zaroori hai." };

    const clean = raw.toLowerCase().replace(/\s+/g, ".");
    const profileUrl = `https://www.instagram.com/${clean}/`;
    const sessionId = this.getActiveSessionId();
    let dsUserId = "0";
    if (sessionId) {
      const parts = sessionId.split(/%3A|:/);
      if (parts.length > 0 && /^\d+$/.test(parts[0])) {
        dsUserId = parts[0];
      }
    }

    // 1. Try human-paced IgApiClient inspector if logged in
    if (this.ig && this.isLoggedIn) {
      try {
        const clientRes = await this.getUserFeedAndPostsHumanPaced(clean);
        if (clientRes && clientRes.success) {
          return {
            ...clientRes,
            profileUrl,
            sourceProvider: "instagram_logged_in_session",
          };
        }
      } catch {}
    }

    // 2. Query Web Profile Info API with session cookie
    try {
      const headers: Record<string, string> = {
        "x-ig-app-id": "936619743392459",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": profileUrl,
      };
      if (sessionId) {
        headers["Cookie"] = `sessionid=${sessionId}; ds_user_id=${dsUserId};`;
      }

      const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(clean)}`, {
        headers,
      });

      if (res.ok) {
        const json = await res.json();
        const user = json?.data?.user;
        if (user) {
          const edges = user.edge_owner_to_timeline_media?.edges || [];
          const latestPosts = edges.slice(0, 4).map((e: any) => {
            const node = e.node;
            const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
            return {
              type: node.is_video ? "Reel / Video" : "Photo",
              caption: caption.length > 120 ? caption.slice(0, 120) + "..." : caption,
              likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
              comments: node.edge_media_to_comment?.count || 0,
              views: node.video_view_count || undefined,
              postUrl: `https://www.instagram.com/p/${node.shortcode}/`,
              shortcode: node.shortcode,
            };
          });

          return {
            success: true,
            username: user.username,
            fullName: user.full_name || user.username,
            biography: user.biography || "",
            followersCount: user.edge_followed_by?.count || 0,
            followingCount: user.edge_follow?.count || 0,
            totalPosts: user.edge_owner_to_timeline_media?.count || 0,
            isVerified: !!user.is_verified,
            isPrivate: !!user.is_private,
            profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
            profileUrl,
            recentPostsCount: latestPosts.length,
            latestPosts,
            sourceProvider: sessionId ? "instagram_session_api" : "instagram_web_api",
          };
        }
      }
    } catch (webErr: any) {
      console.warn("[InstagramBot] web_profile_info fetch notice:", webErr?.message || webErr);
    }

    // 3. Fallback: Instagram HTML Meta Scraper
    try {
      const res = await fetch(profileUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (res.ok) {
        const html = await res.text();
        const ogTitleMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*)"/i) || html.match(/<meta\s+content="([^"]*)"\s+(?:property|name)="og:title"/i);
        const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || html.match(/<meta\s+content="([^"]*)"\s+name="description"/i);

        const ogTitle = ogTitleMatch ? ogTitleMatch[1] : "";
        const metaDesc = descMatch ? descMatch[1] : "";

        let fullName = "";
        const nameMatch = ogTitle.match(/^(.*?)\s*\(@[a-zA-Z0-9._]+\)/);
        if (nameMatch) fullName = nameMatch[1].trim();

        const followersMatch = metaDesc.match(/([0-9.,]+[KkMmBb]?)\s+Followers/i);
        const followingMatch = metaDesc.match(/([0-9.,]+[KkMmBb]?)\s+Following/i);
        const postsMatch = metaDesc.match(/([0-9.,]+[KkMmBb]?)\s+Posts/i);

        if (fullName || followersMatch) {
          return {
            success: true,
            username: clean,
            fullName: fullName || clean,
            followersCount: followersMatch ? followersMatch[1] : undefined,
            followingCount: followingMatch ? followingMatch[1] : undefined,
            totalPosts: postsMatch ? postsMatch[1] : undefined,
            profileUrl,
            sourceProvider: "instagram_html_meta",
          };
        }
      }
    } catch {}

    // Default basic link
    return {
      success: true,
      username: clean,
      fullName: raw,
      profileUrl,
      message: `Instagram par @${clean} ka profile link: ${profileUrl}`,
      sourceProvider: "instagram_profile_link",
    };
  }

  /**
   * Human-Paced Profile & Feed Inspector:
   * Inspects profile bio, counts, and scrolls through recent posts with 0.5s-0.7s human scroll steps.
   */
  public async getUserFeedAndPostsHumanPaced(username: string, maxPosts = 6): Promise<any> {
    if (!this.ig || !this.isLoggedIn) {
      return { success: false, message: "Instagram is not connected." };
    }

    try {
      const clean = String(username || "").trim().replace(/^@/, "");
      
      // 1. Human search / open profile pause: 0.5s
      await humanBotFirewallService.simulateInstagramSearchTyping(clean);

      const user = await this.ig.user.searchExact(clean);
      if (!user || !user.pk) {
        return { success: false, message: `User @${username} not found on Instagram.` };
      }

      // 2. Fetch user detailed info
      const userInfo = await this.ig.user.info(user.pk);

      // 3. User Feed: Scroll posts one-by-one with human pauses
      const userFeed = this.ig.feed.user(user.pk);
      const items = await userFeed.items();
      const posts: any[] = [];

      for (let i = 0; i < Math.min(items.length, maxPosts); i++) {
        // Human scroll gesture pause (0.5s - 0.7s)
        await humanBotFirewallService.simulateInstagramScrollStep();

        const item: any = items[i];
        posts.push({
          id: item.id,
          code: item.code,
          caption: item.caption?.text || "",
          likeCount: item.like_count || 0,
          commentCount: item.comment_count || 0,
          mediaType: item.media_type === 2 ? "Video/Reel" : item.media_type === 8 ? "Carousel" : "Photo",
          takenAt: item.taken_at ? new Date(item.taken_at * 1000).toISOString() : undefined,
          postUrl: `https://www.instagram.com/p/${item.code}/`,
        });
      }

      return {
        success: true,
        username: userInfo.username,
        fullName: userInfo.full_name,
        biography: userInfo.biography,
        followersCount: userInfo.follower_count,
        followingCount: userInfo.following_count,
        totalPosts: userInfo.media_count,
        isPrivate: userInfo.is_private,
        isVerified: userInfo.is_verified,
        posts,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to inspect profile: ${e?.message || e}` };
    }
  }

  /**
   * Human-Paced Post Like:
   * Pauses 0.5s on post, double-taps/likes, and pauses 0.5s.
   */
  public async likeMediaHumanPaced(mediaId: string): Promise<any> {
    if (!this.ig || !this.isLoggedIn) {
      return { success: false, message: "Instagram is not connected." };
    }

    try {
      await humanBotFirewallService.simulateInstagramLikeTap();
      await this.ig.media.like({
        mediaId,
        d: 0,
        moduleInfo: {
          module_name: "profile",
          username: this.currentUsername || "",
          user_id: this.ig.state.cookieUserId,
        } as any,
      });
      return { success: true, message: `Post ${mediaId} liked with natural human gesture! ❤️` };
    } catch (e: any) {
      return { success: false, message: `Like failed: ${e?.message || e}` };
    }
  }

  /**
   * Human-Paced Post Comment:
   * Types comment with 0.5s inter-word gap and 0.5s post button tap.
   */
  public async commentMediaHumanPaced(mediaId: string, text: string): Promise<any> {
    if (!this.ig || !this.isLoggedIn) {
      return { success: false, message: "Instagram is not connected." };
    }

    try {
      await humanBotFirewallService.simulateInstagramCommentTyping(text);
      const res: any = await this.ig.media.comment({
        mediaId,
        text: text.trim(),
      });
      return { success: true, message: `Comment posted on ${mediaId} with natural typing delays! 💬`, commentId: res?.pk || res?.id || "posted" };
    } catch (e: any) {
      return { success: false, message: `Comment failed: ${e?.message || e}` };
    }
  }

  /**
   * Human-Paced Followers / Following Scroll List:
   */
  public async getUserFollowersHumanPaced(username: string, maxCount = 15): Promise<any> {
    if (!this.ig || !this.isLoggedIn) {
      return { success: false, message: "Instagram is not connected." };
    }

    try {
      const clean = String(username || "").trim().replace(/^@/, "");
      await humanBotFirewallService.simulateInstagramSearchTyping(clean);

      const user = await this.ig.user.searchExact(clean);
      if (!user || !user.pk) {
        return { success: false, message: `User @${username} not found.` };
      }

      // Tap followers list & scroll with human pauses
      await humanBotFirewallService.sleep(500);

      const followersFeed = this.ig.feed.accountFollowers(user.pk);
      const items = await followersFeed.items();
      const list: any[] = [];

      for (let i = 0; i < Math.min(items.length, maxCount); i++) {
        await humanBotFirewallService.simulateInstagramScrollStep();
        const f = items[i];
        list.push({
          username: f.username,
          fullName: f.full_name,
          isVerified: f.is_verified,
          profilePicUrl: f.profile_pic_url,
        });
      }

      return {
        success: true,
        target: clean,
        count: list.length,
        followers: list,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to fetch followers: ${e?.message || e}` };
    }
  }
}

export const instagramBotService = new InstagramBotService();
