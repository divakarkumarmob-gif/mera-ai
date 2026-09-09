import { db } from "../firebaseAdmin";
import { QuotedMessageContext } from "./whatsappTypes";

export interface GroupSafetyConfig {
  groupId: string;
  groupName?: string;
  enabled: boolean;
  blockProfanity: boolean;
  blockNsfwMedia: boolean;
  deletedCount: number;
  warnedCount: number;
  updatedAt: number;
  lastAction?: string;
}

const safetyCol = () => db.collection("whatsapp_group_safety");

export class WhatsAppGroupSafetyEngine {
  private safetyCache: Map<string, GroupSafetyConfig> = new Map();
  private loaded = false;

  // ── 1. Comprehensive Indian & Global Profanity Words Set ─────────────────────
  private static readonly PROFANITY_WORDS = new Set([
    // Short acronyms & slang
    "mc", "bc", "bkl", "bsdk", "mkc", "bkc", "tmkc", "tkl", "mkl", "gandu", "gaandu", "lodu", "jhatu", "jhaatu", "chutya", "chotya", "bhosad",
    // Mother / Sister / Family Slurs
    "madarchod", "maderchod", "madarchode", "madarchodi", "madarjaat", "madarchood", "maachod", "maarchod", "machod", "maachuda",
    "bhenchod", "behenchod", "bhenchode", "behenchode", "bhnchod", "benchod", "behnchod", "betichod", "bhenchoda", "behenchoda",
    // BSDK / Bhosda
    "bhosdike", "bhosadike", "bhosdk", "bhosdi", "bhosda", "bhosada", "bhosdiwale", "bhosadiwale", "bhosri", "bhosrike", "bhosdika",
    // Chut / Chutiya
    "chutiya", "chutiye", "chutiyo", "chutiyapa", "chutiyagiri", "chootiya", "chootiye", "chut", "choot", "chute", "chutad", "chootad", "chutmarike", "chutmarani",
    // Lund / Loda
    "lund", "lauda", "laude", "loda", "lode", "lawda", "lawde", "louda", "loude", "lodu", "lnd", "l@uda", "l@ude",
    // Gand / Gaand
    "gand", "gaand", "gandu", "gaandu", "gandwe", "gandwa", "gandmarike", "gandmasti", "ganduon", "gandfat", "gandfatu",
    // Randi / Raand
    "randi", "raand", "raandi", "randwe", "randwa", "randibaaz", "randirona", "randiwaaz",
    // Harami / Kamina / Insults
    "harami", "haramzada", "haramzade", "haramzaada", "haramzadi", "haramkhor", "kamina", "kamine", "kamini",
    "saale", "saali", "kutta", "kutte", "suar", "suwar", "bhadwe", "bhadwa", "dalaal", "dalla", "chakka", "hijra",
    "jhat", "jhaat", "jhatu", "jhaatu", "jhant", "tatte", "tatton", "chuchi", "chuchiya",
    // Sex / Chudai
    "chudai", "chodunga", "chudega", "chudwa", "chodampatti", "chudakkad", "chudwao", "chodne", "chudne", "pelunga",
    // English
    "fuck", "fucking", "fucker", "motherfucker", "bitch", "slut", "whore", "bastard", "asshole", "cunt", "pussy", "dick", "porn", "nude", "naked", "nsfw", "xxx"
  ]);

  // ── 2. Multi-Word Phrases & Devanagari Patterns ────────────────────────────
  private static readonly PROFANITY_PHRASES: RegExp[] = [
    /\b(?:teri\s+m[a@4]+(?:\s+k[i1]|\s+k[a@4])\b)/i,
    /\b(?:m[a@4]+\s+k[i1]\s+ch[u0]t)\b/i,
    /\b(?:m[a@4]+\s+k[a@4]\s+bh[o0]sd[a@4])\b/i,
    /\b(?:bh[e3]n\s+k[e3]\s+l[o0]d[e3]|bh[e3]n\s+k\s+l[o0]d[e3]|b[e3]h[e3]n\s+k[e3]\s+l[o0]d[e3]|b[e3]h[a@4]n\s+k[e3]\s+l[o0]d[e3])\b/i,
    /\b(?:bh[o0]sd[i1]\s+k[e3]|bh[o0]s[a@4]d[i1]\s+k[e3])\b/i,
    /\b(?:g[a@4]+nd\s+(?:m[a@4]r|f[a@4]d|ch[u0]d|m[a@4]rw[a@4]|m[a@4]r[a@4]o|m[e3]\s+u))\b/i,
    /\b(?:l[u0]nd\s+(?:l[e3]|m[e3]r[a@4]|p[e3]|ch[u0]s|d[e3]|f[e3]k))\b/i,
    /\b(?:l[a@4]ud[e3]\s+l[a@4]g\s+g[a@4]y[e3]|l[o0]d[e3]\s+l[a@4]g\s+g[a@4]y[e3])\b/i,
    /\b(?:r[a@4]nd[i1]\s+k[a@4]\s+b[a@4]ch[a@4]|r[a@4]nd[i1]\s+k[i1]\s+[a@4]ul[a@4]d|r[a@4]nd[i1]\s+r[o0]n[a@4])\b/i,
    /\b(?:kutt[e3]\s+k[e3]\s+p[i1]ll[e3]|kutt[e3]\s+k[a@4]\s+p[i1]ll[a@4]|su[a@4]r\s+k[e3]\s+b[a@4]chh[e3])\b/i,
    /\b(?:jh[a@4]+t\s+k[e3]\s+b[a@4]l|jh[a@4]+t\s+k[e3]\s+l[o0]d[e3])\b/i,
    /\b(?:b\s*\.?\s*s\s*\.?\s*d\s*\.?\s*k|b\s*\.?\s*k\s*\.?\s*l|m\s*\.?\s*c|b\s*\.?\s*c|m\s*\.?\s*k\s*\.?\s*c|t\s*\.?\s*m\s*\.?\s*k\s*\.?\s*c)\b/i,
    // Devanagari Hindi Regex
    /(?:मादरचोद|मदरचोद|मादरचोद|बहनचोद|भेनचोद|भोसड़ीके|भोसडीके|भोसड़ा|गांड|गांडू|चूत|चूतिया|चूतिये|लौड़े|लौड़े|लौड़ा|लंड|रांड|रंडी|हरामी|कमीने|कुत्ता|सूअर|झांट|तत्ते|दल्ले|भाड़वे|चोद|चुदाई)/i,
  ];

  // ── 3. Media NSFW triggers ────────────────────────────────────────────────
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

  public async isGroupSafetyEnabled(groupId: string): Promise<boolean> {
    if (!this.loaded) await this.preloadFromFirestore();
    const config = this.safetyCache.get(groupId);
    if (!config) return true; // Default ON for all groups
    return config.enabled !== false;
  }

  public async enableGroupSafety(groupId: string, groupName?: string): Promise<{ success: boolean; message: string }> {
    try {
      const current = this.safetyCache.get(groupId) || {
        groupId,
        groupName: groupName || "WhatsApp Group",
        enabled: true,
        blockProfanity: true,
        blockNsfwMedia: true,
        deletedCount: 0,
        warnedCount: 0,
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
        message: `🛡️ *@block safe GUARD ACTIVATED!* ⚡\n\nAb is group me agar koi bhi:\n• ❌ Gandi gaali / Abusive slurs\n• ❌ Inappropriate NSFW / Vulgar photos & videos\nbheje ga, toh Friday Admin hone par use **chat se turant auto-delete** kar degi aur warning de degi! 🚀`,
      };
    } catch (err: any) {
      console.error("[GroupSafetyEngine] Error enabling safety:", err);
      return { success: false, message: `Failed to enable safety: ${err?.message || err}` };
    }
  }

  public async disableGroupSafety(groupId: string): Promise<{ success: boolean; message: string }> {
    try {
      const current = this.safetyCache.get(groupId) || {
        groupId,
        enabled: false,
        blockProfanity: false,
        blockNsfwMedia: false,
        deletedCount: 0,
        warnedCount: 0,
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
        warnedCount: 0,
        updatedAt: Date.now(),
      };
      this.safetyCache.set(groupId, config);
    }
    return config;
  }

  private normalizeText(text: string): string {
    if (!text) return "";
    let s = text.toLowerCase();
    s = s.replace(/0/g, "o")
         .replace(/[@4]/g, "a")
         .replace(/[1!|]/g, "i")
         .replace(/[$5]/g, "s")
         .replace(/3/g, "e")
         .replace(/8/g, "b")
         .replace(/\+/g, "t");
    return s;
  }

  private collapseConsecutiveLetters(word: string): string {
    return word.replace(/(.)\1+/g, "$1");
  }

  /**
   * Check if a text message contains Gandi Gaali / Profanity
   */
  public detectProfanity(rawText: string): { isProfane: boolean; reason?: string } {
    if (!rawText || !rawText.trim()) return { isProfane: false };

    const rawLower = rawText.toLowerCase();

    // 1. Check Multi-word Phrases & Devanagari & Regex
    for (const phraseRegex of WhatsAppGroupSafetyEngine.PROFANITY_PHRASES) {
      if (phraseRegex.test(rawLower)) {
        return { isProfane: true, reason: "Gandi gaali / Abusive phrase detected" };
      }
    }

    // 2. Normalize Text
    const normalized = this.normalizeText(rawText);

    // Check phrases on normalized text too
    for (const phraseRegex of WhatsAppGroupSafetyEngine.PROFANITY_PHRASES) {
      if (phraseRegex.test(normalized)) {
        return { isProfane: true, reason: "Gandi gaali / Abusive phrase detected" };
      }
    }

    // 3. Tokenize by whitespace and punctuation
    const words = normalized.split(/[\s,.\-_:;!?*~#^&()\[\]{}|\\/+=<>`'"]+/).filter(Boolean);

    for (const word of words) {
      // Direct match
      if (WhatsAppGroupSafetyEngine.PROFANITY_WORDS.has(word)) {
        return { isProfane: true, reason: `Gandi gaali detected ("${word}")` };
      }

      // Collapsed repeat letters match (e.g., "chhuuuuuuttt" -> "chut")
      const collapsed = this.collapseConsecutiveLetters(word);
      if (WhatsAppGroupSafetyEngine.PROFANITY_WORDS.has(collapsed)) {
        return { isProfane: true, reason: `Gandi gaali detected ("${collapsed}")` };
      }

      // Substring checks for compound gaalis (e.g. "madarchodo", "bhenchodon", "chutiyapa")
      for (const root of WhatsAppGroupSafetyEngine.PROFANITY_WORDS) {
        if (root.length >= 4 && (word.startsWith(root) || word.endsWith(root))) {
          return { isProfane: true, reason: `Abusive word detected ("${word}")` };
        }
      }
    }

    // 4. Dot/space joined abbreviations check (e.g., "b.s.d.k", "b s d k", "m.c", "b.c", "m c", "b c")
    const stripped = normalized.replace(/[^a-z0-9]/g, "");
    for (const root of ["bsdk", "bkl", "mkc", "bkc", "tmkc", "madarchod", "bhenchod", "bhosdike", "chutiya", "randi"]) {
      if (stripped.includes(root)) {
        return { isProfane: true, reason: `Hidden abusive word detected ("${root}")` };
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
        return { isUnsafe: true, reason: `Explicit NSFW media trigger "${trigger}"` };
      }
    }

    const profCheck = this.detectProfanity(caption);
    if (profCheck.isProfane) {
      return { isUnsafe: true, reason: "Gandi gaali in media caption" };
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
      const botLid = sock.user?.lid || "";
      const botPhone = (dedicatedPhone || botJid.split(":")[0].split("@")[0] || "").replace(/\D/g, "");
      const botUserPrefix = botJid.split(":")[0];
      const botLidPrefix = botLid ? botLid.split(":")[0] : "";

      const participant = meta.participants.find((p: any) => {
        const pPhone = (p.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
        if (botPhone && pPhone && pPhone === botPhone) return true;
        if (botUserPrefix && p.id.includes(botUserPrefix)) return true;
        if (botLidPrefix && p.id.includes(botLidPrefix)) return true;
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
      const keyToDelete = {
        remoteJid: cleanKey.remoteJid || groupJid,
        fromMe: Boolean(cleanKey.fromMe),
        id: cleanKey.id,
        participant: cleanKey.participant || cleanKey.participantAlt || senderJid,
      };

      await sock.sendMessage(groupJid, { delete: keyToDelete });

      // Increment deleted counter
      const config = await this.getGroupSafetyStatus(groupJid);
      config.deletedCount = (config.deletedCount || 0) + 1;
      config.updatedAt = Date.now();
      this.safetyCache.set(groupJid, config);
      safetyCol().doc(groupJid).set({ deletedCount: config.deletedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});

      console.log(`[GroupSafetyEngine] Successfully deleted message ${cleanKey.id} in ${groupJid}`);
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
      const targetKey = quotedMessage.stanzaId
        ? { id: quotedMessage.stanzaId, remoteJid: groupJid, participant: quotedMessage.senderPhone ? `${quotedMessage.senderPhone}@s.whatsapp.net` : undefined }
        : messageKey;

      if (isAdm) {
        const deleted = await this.deleteMessage(sock, groupJid, targetKey, quotedMessage.senderPhone);
        if (deleted) {
          const senderTag = quotedMessage.senderPhone ? `@${quotedMessage.senderPhone}` : quotedMessage.sender;
          return {
            handled: true,
            replyText: `🗑️ *Message Deleted by Friday Safety Guard!* ⚡\n👤 Quoted message from ${senderTag} has been removed from the chat.`,
          };
        }
      } else {
        // Try deleting anyway in case admin cache was stale
        const attempted = await this.deleteMessage(sock, groupJid, targetKey, quotedMessage.senderPhone);
        if (attempted) {
          return {
            handled: true,
            replyText: `🗑️ *Message Deleted!* Quoted message removed from the chat.`,
          };
        }
        return {
          handled: true,
          replyText: `⚠️ *Friday Admin nahi hai!* Group me dusro ke messages delete karne ke liye kripya Friday ko group admin banayein.`,
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
   * If detected:
   * 1. Attempts to delete message immediately from group.
   * 2. Posts an immediate warning alert tagging the sender.
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

    // Do not filter Boss DK's messages
    if (isOwner) return { intercepted: false };

    // Check if safety is active for this group
    const isEnabled = await this.isGroupSafetyEnabled(groupJid);
    if (!isEnabled) return { intercepted: false };

    // 1. Profanity / Gaali Check
    const profResult = this.detectProfanity(text || mediaCaption || "");
    const mediaUnsafe = hasMedia ? this.detectUnsafeMedia(mediaCaption, fileName) : { isUnsafe: false };

    if (!profResult.isProfane && !mediaUnsafe.isUnsafe) {
      return { intercepted: false };
    }

    const reason = profResult.isProfane
      ? (profResult.reason || "Gandi gaali / Abusive language")
      : (mediaUnsafe.reason || "Inappropriate / NSFW Media");

    console.log(`[GroupSafetyEngine] 🚨 Offensive message detected in ${groupName} from +${senderPhone}: "${text || mediaCaption}" (${reason})`);

    const cleanPhone = (senderPhone || "").replace(/\D/g, "");
    const mentionJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : senderJid;
    const mentionsList = Array.from(new Set([mentionJid, senderJid])).filter(Boolean);

    // 2. Check Admin & Attempt Immediate Deletion
    let deleted = false;
    if (sock) {
      try {
        deleted = await this.deleteMessage(sock, groupJid, messageKey, senderJid);
      } catch (delErr) {
        console.warn("[GroupSafetyEngine] Direct delete attempt failed:", delErr);
      }
    }

    // 3. Increment Warning Count in Firestore
    try {
      const config = await this.getGroupSafetyStatus(groupJid);
      config.warnedCount = (config.warnedCount || 0) + 1;
      config.updatedAt = Date.now();
      this.safetyCache.set(groupJid, config);
      safetyCol().doc(groupJid).set({ warnedCount: config.warnedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});
    } catch {}

    // 4. Send Clear & Distinct Warning Alert to Group
    if (sock) {
      const senderTag = cleanPhone ? `@${cleanPhone}` : (senderName || "Member");

      let alertMessage = "";
      if (deleted) {
        alertMessage = `🛡️ *FRIDAY GROUP AUTO-SHIELD (@block safe)* ⚡\n\n🚫 *Abusive Message / Media Deleted!* 🗑️\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${reason}\n\n_Group ke shishtachar, decency aur family safety ke liye ye message turant delete kar diya gaya hai. Kripya abusive words ya unsafe content share na karein._ 🙏`;
      } else {
        alertMessage = `🛡️ *FRIDAY SAFETY WARNING (@block safe)* ⚡\n\n⚠️ *Gandi Gaali / Abusive Content Detected!*\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${reason}\n\n_Kripya group me aisi bhasha ya inappropriate content ka prayog na karein!_\n\n👑 _(Admin Notice: Friday ko Group Admin banayein taaki aisi abusive messages chat se automatically delete ho sakein.)_`;
      }

      try {
        await sock.sendMessage(groupJid, {
          text: alertMessage,
          mentions: mentionsList,
        });
        console.log(`[GroupSafetyEngine] Warning alert delivered to ${groupName}`);
      } catch (alertErr) {
        console.error("[GroupSafetyEngine] Failed to send warning alert to group:", alertErr);
      }
    }

    return { intercepted: true, reason, deleted };
  }
}

export const whatsappGroupSafetyEngine = new WhatsAppGroupSafetyEngine();
