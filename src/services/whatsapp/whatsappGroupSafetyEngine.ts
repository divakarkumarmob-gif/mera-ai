import { db } from "../firebaseAdmin";
import { QuotedMessageContext } from "./whatsappTypes";

export interface GroupSafetyConfig {
  groupId: string;
  groupName?: string;
  enabled: boolean;
  blockProfanity: boolean;
  blockNsfwMedia: boolean;
  deletedCount: number;
  updatedAt: number;
  lastAction?: string;
}

const safetyCol = () => db.collection("whatsapp_group_safety");

export class WhatsAppGroupSafetyEngine {
  private safetyCache: Map<string, GroupSafetyConfig> = new Map();
  private loaded = false;

  // Comprehensive Regex for Gandi Gaali (Hindi, Hinglish, Bhojpuri, English) & Vulgarities
  private static readonly PROFANITY_PATTERNS: RegExp[] = [
    // Mother / Sister slurs & variants
    /\b(?:m[a@4]d[a@4]r?ch[o0]d|m[a@4]d[a@4]r?ch[o0]de?|m[a@4]d[a@4]r?ch[o0]di|m\.?c\.?|m\s+c)\b/i,
    /\b(?:bh[e3]nch[o0]d|b[e3]h[e3]nch[o0]d|b[e3]h[e3]n\s*ch[o0]d|b\.?c\.?|b\s+c|bhen\s*ke\s*l[o0]d[e3]|bkl)\b/i,
    /\b(?:bh[o0]sd[i1]k[e3]|bh[o0]sd[i1]k[a@4]|bh[o0]sd[i1]|bsdk|b\.?s\.?d\.?k\.?)\b/i,
    /\b(?:b[e3]t[i1]ch[o0]d|m[a@4][a@4]?ch[o0]d|m[a@4]\s*k[i1]\s*ch[u0]t|m[a@4]\s*k[a@4]\s*bh[o0]sd[a@4])\b/i,
    
    // Genitalia & Explicit Anatomy slurs
    /\b(?:ch[u0]t|ch[o0][o0]t|ch[u0]t[i1]y[a@4]|ch[u0]t[i1]y[e3]|ch[u0]t[i1]y[e3]p[a@4]|ch[u0]tiye|ch[u0]tiya|ch\*tiya)\b/i,
    /\b(?:l[u0]nd|l[a@4]ud[a@4]|l[a@4]ud[e3]|l[o0]d[a@4]|l[o0]d[e3]|l\*nd|l\s*u\s*n\s*d)\b/i,
    /\b(?:g[a@4][a@4]?nd|g[a@4]nd[u0]|g[a@4]ndm[a@4]r[i1]|g\*\*nd|g\s*a\s*n\s*d)\b/i,
    /\b(?:t[a@4]tt[e3]|ch[u0]ch[i1]|b[o0][o0]bs?|t[i1]ts?|d[i1]ck|p[u0]ssy|c[u0]nt|c[o0]ck)\b/i,

    // Derogatory slurs, insults & sex acts
    /\b(?:r[a@4]nd[i1]|r[a@4][a@4]nd|r[a@4]nd[i1]b[a@4][a@4]z|ch[u0]d[a@4][i1]|ch[o0]d|ch[u0]d|ch[u0]dw[a@4]|ch[u0]dd[u0])\b/i,
    /\b(?:h[a@4]r[a@4]m[i1]|h[a@4]r[a@4]mz[a@4]d[e3]|h[a@4]r[a@4]mz[a@4]d[a@4]|k[a@4]m[i1]n[a@4]|k[a@4]m[i1]n[e3])\b/i,
    /\b(?:bh[a@4]dw[e3]|bh[a@4]dw[a@4]|d[a@4]l[a@4][a@4]l|jh[a@4][a@4]t[u0]|jh[a@4]nt|l[o0]d[u0])\b/i,

    // English Profanity & Vulgarities
    /\b(?:f+u+c+k+|f+u+c+k+i+n+g+|m+o+t+h+e+r+f+u+c+k+e+r+|b+i+t+c+h+|s+l+u+t+|w+h+o+r+e+|b+a+s+t+a+r+d+)\b/i,
    /\b(?:a+s+s+h+o+l+e+|d+i+c+k+h+e+a+d+|b+u+l+l+s+h+i+t+|p+o+r+n+|n+s+f+w+|x+x+x+|h+e+n+t+a+i+)\b/i,
    /\b(?:gandi\s*galli|gandi\s*video|gandi\s*photo|nangi\s*photo|nangi\s*video|sex\s*video)\b/i,
  ];

  // Media NSFW keywords
  private static readonly MEDIA_NSFW_TRIGGERS = [
    "nude", "naked", "porn", "xxx", "sex", "boobs", "nsfw", "hentai", "strip", "leak", "mms",
    "gandi photo", "gandi video", "nangi photo", "nangi video", "sexy photo", "hot video 18+",
    "18+ adult", "adult content", "nudity"
  ];

  constructor() {
    this.preloadFromFirestore().catch(() => {});
  }

  private async preloadFromFirestore() {
    if (this.loaded) return;
    try {
      const snap = await safetyCol().get();
      snap.forEach((doc) => {
        const data = doc.data() as GroupSafetyConfig;
        if (data && data.groupId) {
          this.safetyCache.set(data.groupId, data);
        }
      });
      this.loaded = true;
      console.log(`[GroupSafetyEngine] Loaded safety configs for ${this.safetyCache.size} groups.`);
    } catch (e) {
      console.warn("[GroupSafetyEngine] Failed to preload configs:", e);
    }
  }

  /**
   * Check if safety guard (@block safe) is enabled for a group.
   * By default, returns true if enabled in config or if group is active.
   */
  public async isGroupSafetyEnabled(groupId: string): Promise<boolean> {
    if (!this.loaded) await this.preloadFromFirestore();
    const config = this.safetyCache.get(groupId);
    if (!config) return true; // Default ON for protection when commanded
    return config.enabled !== false;
  }

  /**
   * Enable Group Safety Guard (@block safe)
   */
  public async enableGroupSafety(groupId: string, groupName?: string): Promise<{ success: boolean; message: string }> {
    try {
      const current = this.safetyCache.get(groupId) || {
        groupId,
        groupName: groupName || "WhatsApp Group",
        enabled: true,
        blockProfanity: true,
        blockNsfwMedia: true,
        deletedCount: 0,
        updatedAt: Date.now(),
      };

      current.enabled = true;
      current.blockProfanity = true;
      current.blockNsfwMedia = true;
      if (groupName) current.groupName = groupName;
      current.updatedAt = Date.now();
      current.lastAction = "Enabled @block safe protection";

      this.safetyCache.set(groupId, current);
      await safetyCol().doc(groupId).set(current, { merge: true });

      return {
        success: true,
        message: `🛡️ *@block safe GUARD ACTIVATED!* ⚡\n\nAb is group me agar koi bhi:\n• ❌ Gandi gaali / Abusive slurs\n• ❌ Inappropriate NSFW / Vulgar photos & videos\nbheje ga, toh Friday Admin hone par use **chat se turant auto-delete** kar degi! 🚀`,
      };
    } catch (err: any) {
      console.error("[GroupSafetyEngine] Error enabling safety:", err);
      return { success: false, message: `Failed to enable safety: ${err?.message || err}` };
    }
  }

  /**
   * Disable Group Safety Guard
   */
  public async disableGroupSafety(groupId: string): Promise<{ success: boolean; message: string }> {
    try {
      const current = this.safetyCache.get(groupId) || {
        groupId,
        enabled: false,
        blockProfanity: false,
        blockNsfwMedia: false,
        deletedCount: 0,
        updatedAt: Date.now(),
      };

      current.enabled = false;
      current.updatedAt = Date.now();
      current.lastAction = "Disabled safety protection";

      this.safetyCache.set(groupId, current);
      await safetyCol().doc(groupId).set(current, { merge: true });

      return {
        success: true,
        message: `🔓 *@block safe GUARD DISABLED.* Group safety auto-moderation abhi pause kar di gayi hai.`,
      };
    } catch (err: any) {
      console.error("[GroupSafetyEngine] Error disabling safety:", err);
      return { success: false, message: `Failed to disable safety: ${err?.message || err}` };
    }
  }

  /**
   * Get Safety Guard status for a group
   */
  public async getGroupSafetyStatus(groupId: string): Promise<GroupSafetyConfig> {
    if (!this.loaded) await this.preloadFromFirestore();
    let config = this.safetyCache.get(groupId);
    if (!config) {
      config = {
        groupId,
        enabled: true,
        blockProfanity: true,
        blockNsfwMedia: true,
        deletedCount: 0,
        updatedAt: Date.now(),
      };
      this.safetyCache.set(groupId, config);
    }
    return config;
  }

  /**
   * Check if a text message contains Gandi Gaali / Profanity
   */
  public detectProfanity(text: string): { isProfane: boolean; matchedPattern?: string } {
    if (!text || !text.trim()) return { isProfane: false };
    const clean = text.trim();

    for (const pattern of WhatsAppGroupSafetyEngine.PROFANITY_PATTERNS) {
      if (pattern.test(clean)) {
        return { isProfane: true, matchedPattern: pattern.source };
      }
    }
    return { isProfane: false };
  }

  /**
   * Check if incoming media or caption contains NSFW/Inappropriate triggers
   */
  public detectUnsafeMedia(caption = "", fileName = "", mimeType = ""): { isUnsafe: boolean; reason?: string } {
    const combined = `${caption} ${fileName}`.toLowerCase();

    for (const trigger of WhatsAppGroupSafetyEngine.MEDIA_NSFW_TRIGGERS) {
      if (combined.includes(trigger)) {
        return { isUnsafe: true, reason: `Explicit keyword "${trigger}" detected` };
      }
    }

    const profCheck = this.detectProfanity(caption);
    if (profCheck.isProfane) {
      return { isUnsafe: true, reason: "Gandi gaali / abusive text in media caption" };
    }

    return { isUnsafe: false };
  }

  /**
   * Check if Friday bot is an Admin in the specified WhatsApp Group
   */
  public async isBotAdmin(sock: any, groupJid: string, dedicatedPhone?: string | null): Promise<boolean> {
    if (!sock || !groupJid.endsWith("@g.us")) return false;
    try {
      const meta = await sock.groupMetadata(groupJid);
      if (!meta || !Array.isArray(meta.participants)) return false;

      const botJid = sock.user?.id || "";
      const botPhone = (dedicatedPhone || botJid.split(":")[0].split("@")[0] || "").replace(/\D/g, "");
      const botUserPrefix = botJid.split(":")[0];

      const participant = meta.participants.find((p: any) => {
        const pPhone = (p.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
        if (botPhone && pPhone && pPhone === botPhone) return true;
        if (botUserPrefix && p.id.includes(botUserPrefix)) return true;
        return false;
      });

      return participant?.admin === "admin" || participant?.admin === "superadmin";
    } catch (e) {
      console.warn(`[GroupSafetyEngine] Error checking admin status for ${groupJid}:`, e);
      return false;
    }
  }

  /**
   * Delete a message from the group chat using Baileys socket
   */
  public async deleteMessage(sock: any, groupJid: string, messageKey: any, senderJid?: string): Promise<boolean> {
    if (!sock || !groupJid || !messageKey) return false;
    try {
      const cleanKey = messageKey.key || messageKey;
      const id = cleanKey.id;
      if (!id) return false;

      const participant = cleanKey.participant || cleanKey.participantAlt || senderJid;

      await sock.sendMessage(groupJid, {
        delete: {
          remoteJid: groupJid,
          fromMe: Boolean(cleanKey.fromMe),
          id,
          participant,
        },
      });

      // Increment deleted counter
      const config = await this.getGroupSafetyStatus(groupJid);
      config.deletedCount = (config.deletedCount || 0) + 1;
      config.updatedAt = Date.now();
      this.safetyCache.set(groupJid, config);
      safetyCol().doc(groupJid).set({ deletedCount: config.deletedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});

      console.log(`[GroupSafetyEngine] Successfully deleted message ${id} in ${groupJid}`);
      return true;
    } catch (err) {
      console.error(`[GroupSafetyEngine] Failed to delete message in ${groupJid}:`, err);
      return false;
    }
  }

  /**
   * Check if a command is a Safety Command (@block safe, @safety on, etc.)
   */
  public isSafetyCommand(text: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return (
      clean.startsWith("@block safe") ||
      clean.startsWith("/block safe") ||
      clean.startsWith("@blocksafe") ||
      clean.startsWith("/blocksafe") ||
      clean.startsWith("@safety") ||
      clean.startsWith("/safety") ||
      /^(?:block\s*safe|safety\s*mode|group\s*safety|gandi\s*galli\s*delete|auto\s*delete\s*gaali)/i.test(clean)
    );
  }

  /**
   * Handle direct @block safe commands
   */
  public async handleSafetyCommand(
    sock: any,
    groupJid: string,
    groupName: string,
    text: string,
    senderName: string,
    senderPhone: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = (text || "").toLowerCase().trim();

    // 1. Quoted Message Delete Command (@block safe delete)
    if (/\b(?:delete|hatao|remove|del)\b/i.test(clean) && quotedMessage && quotedMessage.isReply) {
      const isAdm = await this.isBotAdmin(sock, groupJid);
      if (isAdm) {
        const targetKey = quotedMessage.stanzaId
          ? { id: quotedMessage.stanzaId, remoteJid: groupJid }
          : messageKey;
        const deleted = await this.deleteMessage(sock, groupJid, targetKey, quotedMessage.senderPhone);
        if (deleted) {
          const senderTag = quotedMessage.senderPhone ? `@${quotedMessage.senderPhone}` : quotedMessage.sender;
          return {
            handled: true,
            replyText: `🗑️ *Message Deleted by Friday Safety Guard!* ⚡\n👤 Quoted message from ${senderTag} has been removed from the chat.`,
          };
        }
      } else {
        return {
          handled: true,
          replyText: `⚠️ *Friday Admin nahi hai!* Messages delete karne ke liye kripya Friday ko group admin banayein.`,
        };
      }
    }

    // 2. Enable / Activate Command
    if (
      /\b(?:on|enable|activate|chalu|start|active|shuru)\b/i.test(clean) ||
      clean === "@block safe" ||
      clean === "/block safe" ||
      clean === "@blocksafe"
    ) {
      const isAdm = await this.isBotAdmin(sock, groupJid);
      const res = await this.enableGroupSafety(groupJid, groupName);
      const adminNotice = isAdm
        ? `\n\n🛡️ *Admin Status:* ✅ Friday is Admin (Auto-delete Active).`
        : `\n\n⚠️ *Admin Status:* ❌ Friday abhi Group Admin nahi hai. Messages delete karne ke liye Friday ko Admin banayein.`;

      return {
        handled: true,
        replyText: `${res.message}${adminNotice}`,
      };
    }

    // 3. Disable / Deactivate Command
    if (/\b(?:off|disable|deactivate|band|stop|pause)\b/i.test(clean)) {
      const res = await this.disableGroupSafety(groupJid);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 4. Status Command
    if (/\b(?:status|check|info)\b/i.test(clean) || clean === "@safety") {
      const isAdm = await this.isBotAdmin(sock, groupJid);
      const status = await this.getGroupSafetyStatus(groupJid);

      return {
        handled: true,
        replyText: `🛡️ *FRIDAY GROUP SAFETY STATUS (@block safe)* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
🔒 *Protection:* ${status.enabled !== false ? "✅ ACTIVE (Enabled)" : "❌ INACTIVE (Disabled)"}
🚫 *Gandi Gaali Auto-Delete:* ${status.blockProfanity !== false ? "✅ Active" : "❌ Disabled"}
🔞 *NSFW / Unsafe Media Auto-Delete:* ${status.blockNsfwMedia !== false ? "✅ Active" : "❌ Disabled"}
👑 *Friday Admin Status:* ${isAdm ? "✅ Admin (Can Delete Messages)" : "⚠️ Not Admin (Cannot Delete without Admin rights)"}
📊 *Total Offensive Messages Deleted:* ${status.deletedCount || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Commands:*
• \`@block safe on\` ➔ Guard activate karein.
• \`@block safe off\` ➔ Guard disable karein.
• \`@block safe delete\` ➔ Quoted message delete karein.`,
      };
    }

    return { handled: false };
  }

  /**
   * Main Interceptor: Check incoming group message for offensive language/media.
   * If detected and Bot is Admin, deletes message instantly and warns offender.
   */
  public async inspectAndModerateGroupMessage(params: {
    sock: any;
    groupJid: string;
    groupName: string;
    senderName: string;
    senderPhone: string;
    senderJid: string;
    text: string;
    messageKey: any;
    hasMedia?: boolean;
    mediaType?: string;
    mediaCaption?: string;
    fileName?: string;
    dedicatedPhone?: string | null;
    isOwner?: boolean;
  }): Promise<{ intercepted: boolean; reason?: string; deleted?: boolean }> {
    const {
      sock,
      groupJid,
      groupName,
      senderName,
      senderPhone,
      senderJid,
      text,
      messageKey,
      hasMedia,
      mediaCaption,
      fileName,
      dedicatedPhone,
      isOwner,
    } = params;

    // Do not delete Boss DK's messages
    if (isOwner) return { intercepted: false };

    // Check if safety is active
    const isEnabled = await this.isGroupSafetyEnabled(groupJid);
    if (!isEnabled) return { intercepted: false };

    // 1. Profanity / Gaali Check
    const profResult = this.detectProfanity(text || mediaCaption || "");
    const mediaUnsafe = hasMedia ? this.detectUnsafeMedia(mediaCaption, fileName) : { isUnsafe: false };

    if (!profResult.isProfane && !mediaUnsafe.isUnsafe) {
      return { intercepted: false };
    }

    const reason = profResult.isProfane
      ? "Gandi gaali / Abusive vulgar language"
      : (mediaUnsafe.reason || "Inappropriate / NSFW Media");

    console.log(`[GroupSafetyEngine] Offensive message detected in ${groupName} from +${senderPhone}: ${reason}`);

    // Check if Friday is Admin
    const isAdm = await this.isBotAdmin(sock, groupJid, dedicatedPhone);

    if (isAdm && sock) {
      // 1. DELETE OFFENDING MESSAGE IMMEDIATELY FROM GROUP
      const deleted = await this.deleteMessage(sock, groupJid, messageKey, senderJid);

      // 2. SEND FIRM SAFETY WARNING IN GROUP
      const mentionJid = senderJid.endsWith("@s.whatsapp.net") ? senderJid : `${senderPhone}@s.whatsapp.net`;
      const cleanPhone = senderPhone.replace(/\D/g, "");

      const alertMessage = `🛡️ *FRIDAY GROUP AUTO-SHIELD (@block safe)* ⚡\n\n🚫 *Offensive Message Deleted!* 🗑️\n👤 *Sender:* @${cleanPhone || senderName}\n📌 *Wajah:* ${reason}\n\n_Group ke shishtachar, decency aur family safety ke liye ye message turant delete kar diya gaya hai. Kripya abusive words ya unsafe content share na karein._ 🙏`;

      try {
        await sock.sendMessage(groupJid, {
          text: alertMessage,
          mentions: [mentionJid, senderJid],
        });
      } catch (alertErr) {
        console.warn("[GroupSafetyEngine] Failed to post delete warning:", alertErr);
      }

      return { intercepted: true, reason, deleted: true };
    } else if (sock) {
      // If not admin, send warning alert
      const mentionJid = senderJid.endsWith("@s.whatsapp.net") ? senderJid : `${senderPhone}@s.whatsapp.net`;
      const cleanPhone = senderPhone.replace(/\D/g, "");

      const warningMessage = `⚠️ *Friday Safety Warning:* @${cleanPhone || senderName} kripya group me gandi gaali ya inappropriate content na bhejein!\n\nℹ️ _(Notice: Friday ko Group Admin banayein taaki aisi abusive messages chat se automatically delete ho sakein.)_`;

      try {
        await sock.sendMessage(groupJid, {
          text: warningMessage,
          mentions: [mentionJid, senderJid],
        });
      } catch {}

      return { intercepted: true, reason, deleted: false };
    }

    return { intercepted: true, reason, deleted: false };
  }
}

export const whatsappGroupSafetyEngine = new WhatsAppGroupSafetyEngine();
