import { db } from "./firebaseAdmin";
import crypto from "crypto";

export interface AppAccessKeyData {
  appKey: string;
  updatedAt: number;
  updatedBy: string;
  source: "whatsapp" | "telegram" | "system";
}

const SESSION_TTL = 48 * 60 * 60 * 1000; // 48 Hours

class AppSecurityService {
  private cachedKey: string | null = null;
  private cachedUpdatedAt: number | null = null;

  private getSigningSecret(): string {
    return (
      process.env.ENCRYPTION_KEY ||
      process.env.GEMINI_API_KEY ||
      "friday_super_anti_tamper_shield_secret_key_2026"
    );
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
   * If Boss updated the password, all tokens issued under the old password FAIL instantly.
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
   */
  public async verifyAppKey(inputKey: string): Promise<{ success: boolean; message: string; token?: string }> {
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

    if (raw === keyData.appKey) {
      const token = this.generateSessionToken(keyData.updatedAt);
      return { success: true, token, message: "App Access Granted! ✅" };
    }

    return { success: false, message: "Galat App Key! Access Denied ❌" };
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

      await db.collection("systemSecurity").doc("appAccessKey").set(payload, { merge: true });
      this.cachedKey = cleanKey;
      console.log(`[AppSecurity] Updated App Key to [${cleanKey}] from ${source} by ${senderName}`);

      return {
        success: true,
        key: cleanKey,
        message: `Boss, aapka naya App Access Key [${cleanKey}] Firestore me successfully save ho gaya hai! Ab app isi key se unlock hoga. ✅`,
      };
    } catch (e: any) {
      console.error("[AppSecurity] Failed to save App Key to Firestore:", e);
      return {
        success: false,
        message: `App Key save karne me error: ${e?.message || e}`,
      };
    }
  }

  /**
   * Checks if an incoming message is an App Key modification command.
   * Enforces OWNER-ONLY permission (WhatsApp Owner or Telegram Owner).
   * Patterns supported:
   *   "app key - 123456"
   *   "app pass 987654"
   *   "app password: secret"
   *   "set app key 12345"
   *   "app lock: pass10"
   */
  public async handleOwnerAppKeyMessage(
    text: string,
    isOwner: boolean,
    senderName: string,
    source: "whatsapp" | "telegram"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const pattern = /^(?:set\s+)?(?:app\s*key|app\s*pass|app\s*password|access\s*key|app\s*lock)[\s\:\-\=]+([^\s]{1,15})/i;
    const match = text.trim().match(pattern);

    if (match && match[1]) {
      const candidateKey = match[1].trim();

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
}

export const appSecurityService = new AppSecurityService();
