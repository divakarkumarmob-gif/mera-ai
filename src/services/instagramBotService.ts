import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";
import { dailyUpdateService } from "./dailyUpdateService";

export interface InstagramStatus {
  isConfigured: boolean;
  accountId: string | null;
  lastWebhookAt: number | null;
  totalMessagesProcessed: number;
}

export interface InstagramUserProfile {
  igid: string;
  username?: string;
  name?: string;
  lastSeenAt: number;
  messageCount: number;
}

class InstagramBotService {
  private pageAccessToken: string = "";
  private accountId: string = "";
  private verifyToken: string = "";
  private lastWebhookAt: number | null = null;
  private totalMessagesProcessed: number = 0;
  private messageCallback: ((msg: { sender: string; text: string; time: string; igid: string }) => void) | null = null;

  // Multi-tier model fallback chain
  private static readonly MODEL_FALLBACK_CHAIN = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
    "gemini-2.5-flash",
  ];

  constructor() {
    this.refreshConfig();
  }

  public refreshConfig() {
    this.pageAccessToken = (
      process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
      process.env.INSTAGRAM_ACCESS_TOKEN ||
      process.env.META_PAGE_ACCESS_TOKEN ||
      ""
    ).trim();

    this.accountId = (process.env.INSTAGRAM_ACCOUNT_ID || "").trim();
    this.verifyToken = (
      process.env.INSTAGRAM_VERIFY_TOKEN ||
      process.env.WHATSAPP_CLOUD_VERIFY_TOKEN ||
      "friday_instagram_secret"
    ).trim();
  }

  public get isConfigured(): boolean {
    this.refreshConfig();
    return !!this.pageAccessToken && this.pageAccessToken.length > 20;
  }

  public getStatus(): InstagramStatus {
    this.refreshConfig();
    return {
      isConfigured: this.isConfigured,
      accountId: this.accountId || null,
      lastWebhookAt: this.lastWebhookAt,
      totalMessagesProcessed: this.totalMessagesProcessed,
    };
  }

  public setMessageCallback(cb: (msg: { sender: string; text: string; time: string; igid: string }) => void) {
    this.messageCallback = cb;
  }

  /**
   * Verifies the Meta Instagram Webhook GET request.
   */
  public verifyWebhook(mode: string, challenge: string, verifyToken: string): string | null {
    this.refreshConfig();
    if (mode === "subscribe" && verifyToken === this.verifyToken) {
      console.log("[InstagramBot] Webhook verified successfully by Meta!");
      return challenge;
    }
    console.warn(`[InstagramBot] Webhook verify failed. Expected "${this.verifyToken}", got "${verifyToken}"`);
    return null;
  }

  /**
   * Sends an outbound Instagram Direct Message via Meta Graph API.
   */
  public async sendDirectMessage(
    recipientId: string,
    text: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    this.refreshConfig();
    if (!this.isConfigured) {
      return {
        success: false,
        error: "INSTAGRAM_PAGE_ACCESS_TOKEN not configured in .env",
      };
    }

    try {
      const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${this.pageAccessToken}`;
      const payload = {
        recipient: { id: recipientId },
        message: { text },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Instagram DM API failed");
      }

      return { success: true, messageId: json.message_id || json.recipient_id };
    } catch (e: any) {
      console.error(`[InstagramBot] Send DM to ${recipientId} failed:`, e?.message || e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * Saves or updates an Instagram user in Firestore collection 'instagramUsers'.
   */
  public async saveInstagramUser(igid: string, name?: string, username?: string): Promise<void> {
    try {
      const ref = db.collection("instagramUsers").doc(igid);
      const snap = await ref.get();
      const count = snap.exists ? (snap.data()?.messageCount || 0) + 1 : 1;

      const profile: InstagramUserProfile = {
        igid,
        username: username ? username.toLowerCase().replace(/^@/, "") : snap.data()?.username,
        name: name || snap.data()?.name || "Instagram User",
        lastSeenAt: Date.now(),
        messageCount: count,
      };

      await ref.set(profile, { merge: true });
    } catch (e) {
      console.warn("[InstagramBot] Failed to save Instagram user profile:", e);
    }
  }

  /**
   * Resolves a target (Name, @username, or IGID) to a valid recipient IGID.
   */
  public async resolveTargetId(target: string): Promise<{ igid?: string; name?: string; error?: string }> {
    const raw = String(target || "").trim();
    if (!raw) return { error: "Recipient name ya Instagram handle required hai." };

    // 1. Direct numeric IGID
    if (/^\d{6,25}$/.test(raw)) {
      return { igid: raw, name: `User (${raw})` };
    }

    const clean = raw.replace(/^@/, "").toLowerCase().trim();

    try {
      // 2. Search Firestore instagramUsers collection
      const snap = await db.collection("instagramUsers").get();
      const users = snap.docs.map((d) => d.data() as InstagramUserProfile);

      // Exact username match
      const byUsername = users.find((u) => u.username && u.username.toLowerCase() === clean);
      if (byUsername) return { igid: byUsername.igid, name: byUsername.name || `@${byUsername.username}` };

      // Name match
      const byName = users.find(
        (u) =>
          (u.name && u.name.toLowerCase().includes(clean)) ||
          (u.username && u.username.toLowerCase().includes(clean))
      );
      if (byName) return { igid: byName.igid, name: byName.name };

      // 3. Search contactsService
      const allContacts = await contactsService.getAllContacts();
      const matchedContact = allContacts.find((c) =>
        c.name.toLowerCase().includes(clean)
      );

      if (matchedContact) {
        const userByContact = users.find((u) => u.name && u.name.toLowerCase().includes(matchedContact.name.toLowerCase()));
        if (userByContact) return { igid: userByContact.igid, name: matchedContact.name };
      }
    } catch (e) {
      console.warn("[InstagramBot] Error resolving Instagram contact:", e);
    }

    return {
      error: `Boss, '${target}' ka Instagram ID nahi mila. Unhone abhi tak aapke account par DM nahi bheja hai ya unka username mapped nahi hai.`,
    };
  }

  /**
   * Sends an Instagram DM to any person or handle.
   */
  public async sendMessageToTarget(
    target: string,
    message: string
  ): Promise<{ success: boolean; message: string; resolvedName?: string }> {
    const res = await this.resolveTargetId(target);
    if (!res.igid) {
      return {
        success: false,
        message: res.error || `Could not find Instagram user "${target}".`,
      };
    }

    const sendRes = await this.sendDirectMessage(res.igid, message);
    if (sendRes.success) {
      return {
        success: true,
        resolvedName: res.name,
        message: `Boss, Instagram par ${res.name || target} ko DM bhej diya gaya hai: "${message}" ✅`,
      };
    } else {
      return {
        success: false,
        message: `Instagram DM send failed: ${sendRes.error}`,
      };
    }
  }

  /**
   * Checks if an incoming message is requesting a sensitive / privileged action.
   * Strict Rule: Sensitive actions are STRICTLY FORBIDDEN from Instagram.
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
    // 1. Check if the message is a sensitive action request -> Strict Shield!
    if (this.isSensitiveAction(messageText)) {
      return `Haanji ${senderName}! Main Friday hoon (DK Boss ka AI assistant). Security policy ke mutabiq sensitive actions ya confidential settings Instagram se allow nahi hain. Kripya DK se direct WhatsApp ya Voice call par sampark karein. 🙏`;
    }

    // 2. Try factual answer from today's daily update
    try {
      const updateAnswer = await dailyUpdateService.answerFromTodayUpdate(messageText);
      if (updateAnswer) {
        return `Haanji ${senderName}! ${updateAnswer}`;
      }
    } catch {
      // continue
    }

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
          console.log(`[InstagramBot] Auto-reply generated using ${model}`);
          return reply;
        }
      } catch (err: any) {
        console.warn(`[InstagramBot] ${model} failed (${err?.message || err}), falling back...`);
      }
    }

    return `Haanji ${senderName}! Main Friday hoon — DK Boss abhi busy hain, maine aapka DM note kar liya hai 👍`;
  }

  /**
   * Handles incoming webhook payload from Meta Instagram Graph API.
   */
  public async handleWebhook(body: any): Promise<void> {
    this.lastWebhookAt = Date.now();
    this.totalMessagesProcessed++;

    if (!body || body.object !== "instagram" && body.object !== "page") {
      return;
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        const senderId = event.sender?.id;
        const text = event.message?.text?.trim();

        // Skip messages sent by the bot itself or empty messages
        if (!senderId || !text || event.message?.is_echo) {
          continue;
        }

        const senderName = "Instagram User";

        // Save user to Firestore for future direct messaging
        this.saveInstagramUser(senderId, senderName).catch(() => {});

        // Broadcast to connected Live UI clients
        if (this.messageCallback) {
          this.messageCallback({
            sender: `📸 ${senderName}`,
            text,
            time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
            igid: senderId,
          });
        }

        // Generate and send smart AI auto-reply
        try {
          const replyText = await this.generateSmartAutoReply(senderName, text);
          await this.sendDirectMessage(senderId, replyText);
          console.log(`[InstagramBot] Replied to ${senderId}: "${replyText.substring(0, 60)}..."`);
        } catch (e: any) {
          console.error("[InstagramBot] Failed to handle incoming Instagram DM:", e?.message || e);
        }
      }
    }
  }
}

export const instagramBotService = new InstagramBotService();
