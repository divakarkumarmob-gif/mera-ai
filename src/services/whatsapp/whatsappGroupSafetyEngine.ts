import { db } from "../firebaseAdmin";
import { QuotedMessageContext } from "./whatsappTypes";

export interface GroupSafetyConfig {
  groupId: string;
  groupName?: string;
  enabled: boolean;
  blockProfanity: boolean;
  blockNsfwMedia: boolean;
  blockSpam: boolean;
  welcomeEnabled: boolean;
  quietModeEnabled: boolean;
  autoTranscribeVoice?: boolean; // @voicenote on/off: auto-transcribe all group voice notes
  quietStartHour?: number; // default 23 (11 PM)
  quietEndHour?: number;   // default 6  (6 AM)
  deletedCount: number;
  warnedCount: number;
  kickedCount: number;
  updatedAt: number;
  lastAction?: string;
}

const safetyCol = () => db.collection("whatsapp_group_safety");
const strikesCol = () => db.collection("whatsapp_group_strikes");

export class WhatsAppGroupSafetyEngine {
  private safetyCache: Map<string, GroupSafetyConfig> = new Map();
  private strikesCache: Map<string, number> = new Map(); // key: `${groupId}_${senderPhone}`
  private spamRateTracker: Map<string, number[]> = new Map(); // key: `${groupId}_${senderPhone}`
  private lastQuietReminderMap: Map<string, number> = new Map(); // key: `${groupId}_${senderPhone}`
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

  // ── 2. Multi-Word Phrases, Hinglish Colloquial Slurs & Devanagari Patterns ─
  private static readonly PROFANITY_PHRASES: RegExp[] = [
    // Teri maa / behen / family variations
    /\b(?:teri\s+(?:m[a@4]+|m[a@4][a@4]|mummy|ammi|mai|behan|bhen|behen|sister|dadi|nani)\s+(?:k[i1]|k[a@4]|k[o0]|pe|me|se)\b)/i,
    /\b(?:apni\s+(?:m[a@4]+|bhen|behen|g[a@4]+nd)\s+(?:chud[a@4]|marw[a@4]|d[e3]|le))\b/i,
    /\b(?:m[a@4]+\s+k[i1]\s+(?:ch[u0]t|ch[o0][o0]t|l[a@4]ud[a@4]|bhosd[a@4]|[a@4]nkh|chud[a@4]i))\b/i,
    /\b(?:m[a@4]+\s+k[a@4]\s+bh[o0]sd[a@4])\b/i,
    /\b(?:m[a@4]+\s+chud[a@4]|m[a@4]+\s+chud[a@4]o|m[a@4]\s*chud[a@4])\b/i,
    /\b(?:bhen\s+chud[a@4]|behen\s+chud[a@4]|bhen\s*chud[a@4])\b/i,
    /\b(?:bh[e3]n\s+k[e3]\s+l[o0]d[e3]|bh[e3]n\s+k\s+l[o0]d[e3]|b[e3]h[e3]n\s+k[e3]\s+l[o0]d[e3]|b[e3]h[a@4]n\s+k[e3]\s+l[o0]d[e3])\b/i,
    /\b(?:bh[o0]sd[i1]\s+k[e3]|bh[o0]s[a@4]d[i1]\s+k[e3])\b/i,

    // Gand / Gaand variations
    /\b(?:g[a@4]+nd\s+(?:m[a@4]r[a@4]|m[a@4]r[a@4]o|m[a@4]rw[a@4]|f[a@4]d|f[a@4]+d|chud|m[e3]\s+d[a@4]l|m[e3]\s+ghus|tod|todung[a@4]|f[a@4]dung[a@4]|k[a@4]\s+andh[a@4]|m[e3]\s+ungl[i1]))\b/i,
    /\b(?:g[a@4]+ndu\s+(?:s[a@4]l[e3]|ins[a@4]n|log|k[a@4]h[i1]n\s+k[a@4]))\b/i,

    // Lund / Lauda / Loda variations
    /\b(?:l[u0]nd\s+(?:l[e3]|l[e3]l[e3]|p[e3]|p[e3]\s+baith|ch[u0]s|ch[u0]so|pakad|d[e3]|m[e3]r[a@4]|k[a@4]|jais[a@4]|k[e3]\s+t[o0]p[e3]))\b/i,
    /\b(?:l[a@4]ud[e3]\s+(?:l[a@4]g\s+g[a@4]y[e3]|nik[a@4]l|p[e3]|chup|p[e3]\s+baith|m[e3]r[e3]))\b/i,
    /\b(?:l[o0]d[e3]\s+(?:l[a@4]g\s+g[a@4]y[e3]|nik[a@4]l|p[e3]|chup|p[e3]\s+baith|m[e3]r[e3]|k[e3]))\b/i,
    /\b(?:b[a@4]ap\s+ko\s+m[a@4]t\s+ch[o0]d|b[a@4]ap\s+k[o0]\s+ch[o0]d)\b/i,

    // Chutiya / Chutiyapa variations
    /\b(?:chutiya\s+(?:s[a@4]l[a@4]|h[a@4]i\s+ky[a@4]|m[a@4]t\s+b[a@4]n[a@4]|b[a@4]n[a@4]y[a@4]|ins[a@4]n|k[a@4]h[i1]n\s+k[a@4]|log|jais[a@4]))\b/i,
    /\b(?:chutiy[a@4]p[a@4]\s+(?:m[a@4]t\s+k[a@4]r|band\s+k[a@4]r|ch[a@4]l\s+r[a@4]h[a@4]))\b/i,
    /\b(?:chup\s+chutiy[e3]|nik[a@4]l\s+chutiy[e3]|bhaag\s+chutiy[e3])\b/i,

    // BSDK / Bhosda insults
    /\b(?:(?:chup|nik[a@4]l|bh[a@4]g|ch[a@4]l|ab[e3]|oy[e3]|suno|sun)\s+(?:bsdk|bhosdike|bhosadike|bkl|lodu|gandu|chutiye|harami))\b/i,
    /\b(?:(?:bsdk|bhosdike|bhosadike|bkl|lodu|gandu|chutiye|harami)\s+(?:k[e3]|w[a@4]l[e3]|s[a@4]l[e3]|chup|nik[a@4]l|bh[a@4]g|k[a@4]h[i1]n\s+k[a@4]))\b/i,

    // Randi variations
    /\b(?:r[a@4]nd[i1]\s+(?:k[a@4]\s+b[a@4]ch[a@4]|k[i1]\s+[a@4]ul[a@4]d|k[e3]|r[o0]n[a@4]|b[a@4]z|b[a@4]z[i1]))\b/i,
    /\b(?:r[a@4]nd[i1]\s+r[o0]n[a@4]\s+(?:m[a@4]t\s+k[a@4]r|b[a@4]nd\s+k[a@4]r))\b/i,

    // Harami / Kamina / Insults
    /\b(?:h[a@4]r[a@4]m[i1]\s+(?:s[a@4]l[a@4]|s[a@4]l[e3]|k[a@4]h[i1]n\s+k[a@4]|ins[a@4]n|k[e3]))\b/i,
    /\b(?:kutt[e3]\s+(?:k[e3]\s+p[i1]ll[e3]|k[a@4]\s+p[i1]ll[a@4]|k[i1]\s+m[a@4]ut|k[a@4]min[e3]|s[a@4]l[e3]))\b/i,
    /\b(?:su[a@4]r\s+(?:k[e3]\s+b[a@4]chh[e3]|k[e3]\s+pill[e3]|s[a@4]l[e3]|k[a@4]h[i1]n\s+k[e3]))\b/i,
    /\b(?:bh[a@4]dw[e3]\s+(?:s[a@4]l[e3]|k[a@4]h[i1]n\s+k[e3]|log|ins[a@4]n))\b/i,
    /\b(?:jh[a@4]+t\s+k[e3]\s+(?:b[a@4]l|l[o0]d[e3]|jais[a@4]|b[a@4]r[a@4]b[a@4]r))\b/i,
    /\b(?:t[a@4]tt[e3]\s+(?:ch[a@4]t|d[a@4]b[a@4]|m[e3]|jais[e3]))\b/i,

    // English & Hinglish cross profanities
    /\b(?:fuck\s+(?:off|you|u|your|this|that|all|bitch|him|her))\b/i,
    /\b(?:shut\s+(?:up|the\s+fuck\s+up)|stfu|gtfo)\b/i,
    /\b(?:son\s+of\s+a\s+(?:bitch|whore))\b/i,
    /\b(?:suck\s+my\s+(?:dick|cock|balls|nuts))\b/i,
    /\b(?:go\s+to\s+hell\s+(?:bsdk|sale|chutiye)?)\b/i,
    /\b(?:dickhead|asshole|motherfucker|dumbass|bastard|bullshit)\b/i,

    // Acronyms
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

  // ── 4. Spam Links & Phishing Regexes ──────────────────────────────────────
  private static readonly SPAM_LINK_PATTERNS = [
    /\b(?:t\.me\/|telegram\.me\/|bit\.ly\/|tinyurl\.com\/|cutt\.ly\/|is\.gd\/)\b/i,
    /\b(?:free\s*(?:recharge|money|paytm|gift\s*card|crypto|airdrop|spin|bonus)|earn\s*(?:daily|money|per\s*day|online\s*5000)|lottery\s*winner|lucky\s*draw)\b/i,
    /\b(?:join\s*telegram\s*channel|invest\s*100\s*get|crypto\s*bot|color\s*prediction)\b/i,
  ];

  // Flexible Regex Builders for Words with Extra / Repeated Characters (e.g. "maadddarchod")
  private static readonly FLEXIBLE_ROOTS = [
    "madarchod", "maderchod", "madarchodi", "madarjaat", "maachod", "machod", "maarchod", "maachuda",
    "bhenchod", "behenchod", "bhnchod", "benchod", "behnchod", "betichod", "bhenchoda", "behenchoda",
    "bhosdike", "bhosadike", "bhosdk", "bhosdi", "bhosda", "bhosada", "bhosdiwale", "bhosadiwale", "bhosri", "bhosrike", "bhosdika",
    "chutiya", "chutiye", "chutiyo", "chutiyapa", "chutiyagiri", "chootiya", "chootiye", "chut", "choot", "chute", "chutad", "chootad", "chutmarike", "chutmarani", "chutya", "chotya",
    "lund", "lauda", "laude", "loda", "lode", "lawda", "lawde", "louda", "loude", "lodu", "lnd",
    "gand", "gaand", "gandu", "gaandu", "gandwe", "gandwa", "gandmarike", "gandmasti", "ganduon", "gandfat", "gandfatu",
    "randi", "raand", "raandi", "randwe", "randwa", "randibaaz", "randirona", "randiwaaz",
    "harami", "haramzada", "haramzade", "haramzaada", "haramzadi", "haramkhor", "kamina", "kamine", "kamini",
    "saale", "saali", "kutta", "kutte", "suar", "suwar", "bhadwe", "bhadwa", "dalaal", "dalla", "chakka", "hijra",
    "jhat", "jhaat", "jhatu", "jhaatu", "jhant", "tatte", "tatton", "chuchi", "chuchiya",
    "chudai", "chodunga", "chudega", "chudwa", "chodampatti", "chudakkad", "chudwao", "chodne", "chudne", "pelunga",
    "bsdk", "bkl", "mc", "bc", "mkc", "bkc", "tmkc", "tkl", "mkl"
  ];

  private static readonly FLEXIBLE_PATTERNS: RegExp[] = WhatsAppGroupSafetyEngine.FLEXIBLE_ROOTS.map((word) => {
    const pattern = word.split("").map((c) => `${c}+`).join("[\\s_\\-.*~`^]*");
    return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i");
  });

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

      const strikesSnap = await strikesCol().get();
      strikesSnap.forEach((doc) => {
        const data = doc.data() as { count: number };
        if (data && typeof data.count === "number") {
          this.strikesCache.set(doc.id, data.count);
        }
      });

      this.loaded = true;
      console.log(`[GroupSafetyEngine] Loaded safety configs for ${this.safetyCache.size} groups, ${this.strikesCache.size} active strikes.`);
    } catch (e) {
      console.warn("[GroupSafetyEngine] Failed to preload configs:", e);
    }
  }

  public async isGroupSafetyEnabled(groupId: string): Promise<boolean> {
    if (!this.loaded) await this.preloadFromFirestore();
    const config = this.safetyCache.get(groupId);
    if (!config) return true; // Default ON
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
        blockSpam: true,
        welcomeEnabled: true,
        quietModeEnabled: false,
        deletedCount: 0,
        warnedCount: 0,
        kickedCount: 0,
        updatedAt: Date.now(),
      };

      current.enabled = true;
      current.blockProfanity = true;
      current.blockNsfwMedia = true;
      current.blockSpam = true;
      if (groupName) current.groupName = groupName;
      current.updatedAt = Date.now();
      current.lastAction = "Enabled @block safe protection";

      this.safetyCache.set(groupId, current);
      await safetyCol().doc(groupId).set(current, { merge: true });

      return {
        success: true,
        message: `🛡️ *@block safe GUARD ACTIVATED!* ⚡\n\nAb is group me:\n• ❌ Gandi gaali / Abusive slurs\n• ❌ Inappropriate NSFW / Vulgar photos & videos\n• ❌ Spam flood & phishing links\n• 🥊 3-Strike Auto-Kick System\n\nFriday Admin hone par sabhi offensive messages **turant auto-delete** karegi aur 3 strikes par member ko remove kar degi! 🚀`,
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
        blockSpam: false,
        welcomeEnabled: true,
        quietModeEnabled: false,
        deletedCount: 0,
        warnedCount: 0,
        kickedCount: 0,
        updatedAt: Date.now(),
      };

      current.enabled = false;
      current.blockProfanity = false;
      current.blockNsfwMedia = false;
      current.blockSpam = false;
      current.updatedAt = Date.now();
      current.lastAction = "Activated @allow all (Disabled safety protection)";

      this.safetyCache.set(groupId, current);
      await safetyCol().doc(groupId).set(current, { merge: true });

      return {
        success: true,
        message: `🔓 *@allow all MODE ACTIVATED!* ⚡\n\nAb is group me Gaali Filter, Anti-Spam aur Safety Warnings completely **OFF** kar di gayi hain! Sabhi messages bina kisi restriction ke allow hain. 👍\n\n_(Tip: Dobara protection on karne ke liye \`@block safe\` likhein.)_`,
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
        blockSpam: true,
        welcomeEnabled: true,
        quietModeEnabled: false,
        deletedCount: 0,
        warnedCount: 0,
        kickedCount: 0,
        updatedAt: Date.now(),
      };
      this.safetyCache.set(groupId, config);
    }
    return config;
  }

  // ── Strike Management (3-Strike System) ───────────────────────────────────

  public async getUserStrikes(groupId: string, senderPhone: string): Promise<number> {
    if (!this.loaded) await this.preloadFromFirestore();
    const key = `${groupId}_${senderPhone}`;
    return this.strikesCache.get(key) || 0;
  }

  public async recordStrike(groupId: string, senderPhone: string): Promise<number> {
    const key = `${groupId}_${senderPhone}`;
    const count = (this.strikesCache.get(key) || 0) + 1;
    this.strikesCache.set(key, count);
    strikesCol().doc(key).set({ count, updatedAt: Date.now() }, { merge: true }).catch(() => {});
    return count;
  }

  public async resetStrikes(groupId: string, senderPhone?: string): Promise<{ success: boolean; message: string }> {
    if (senderPhone) {
      const key = `${groupId}_${senderPhone}`;
      this.strikesCache.delete(key);
      await strikesCol().doc(key).delete().catch(() => {});
      return { success: true, message: `Strikes reset to 0 for @${senderPhone}.` };
    }
    // Reset all strikes in group
    for (const [key] of this.strikesCache.entries()) {
      if (key.startsWith(groupId)) {
        this.strikesCache.delete(key);
        strikesCol().doc(key).delete().catch(() => {});
      }
    }
    return { success: true, message: `All strikes have been reset in this group.` };
  }

  // ── Anti-Spam Rate Limiter ────────────────────────────────────────────────

  public checkSpamRate(groupId: string, senderPhone: string): boolean {
    const key = `${groupId}_${senderPhone}`;
    const now = Date.now();
    let timestamps = this.spamRateTracker.get(key) || [];
    // Keep timestamps from the last 3.5 seconds
    timestamps = timestamps.filter((t) => now - t < 3500);
    timestamps.push(now);
    this.spamRateTracker.set(key, timestamps);

    // If 4 or more messages sent within 3.5s -> spam flood
    return timestamps.length >= 4;
  }

  public detectSpamLinks(text: string): { isSpam: boolean; reason?: string } {
    if (!text) return { isSpam: false };
    for (const pattern of WhatsAppGroupSafetyEngine.SPAM_LINK_PATTERNS) {
      if (pattern.test(text)) {
        return { isSpam: true, reason: "Promotional spam link / Telegram phishing detected" };
      }
    }
    return { isSpam: false };
  }

  // ── Welcome Card Manager ──────────────────────────────────────────────────

  public async toggleWelcome(groupId: string, enable: boolean): Promise<string> {
    const config = await this.getGroupSafetyStatus(groupId);
    config.welcomeEnabled = enable;
    config.updatedAt = Date.now();
    this.safetyCache.set(groupId, config);
    await safetyCol().doc(groupId).set({ welcomeEnabled: enable, updatedAt: config.updatedAt }, { merge: true });
    return enable
      ? "👋 *Welcome Greetings ON:* Naye members ke aane par Friday unka smart card ke saath swagat karegi!"
      : "👋 *Welcome Greetings OFF:* New member welcome messages disable kar diye gaye hain.";
  }

  public async handleGroupParticipantsUpdate(sock: any, update: any, groupName: string) {
    if (!sock || !update || update.action !== "add" || !Array.isArray(update.participants)) return;
    const groupJid = update.id;
    const config = await this.getGroupSafetyStatus(groupJid);
    if (config.welcomeEnabled === false) return;

    const botJid = sock.user?.id || "";
    const isBotAdded = update.participants.some((p: string) => p.includes(botJid.split(":")[0]));
    if (isBotAdded) return; // Don't welcome bot itself

    const mentions = update.participants;
    const memberTags = mentions.map((p: string) => `@${p.split("@")[0].split(":")[0].replace(/\D/g, "")}`).join(", ");

    const welcomeCard = `👋 *WELCOME TO ${groupName.toUpperCase()}!* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━
Aapka group me hardik swagat hai! ✨
👥 *New Member${mentions.length > 1 ? "s" : ""}:* ${memberTags}

📜 *Group Rules:*
1. Kripya shishtachar aur aapsi samman banaye rakhein.
2. Gandi gaali ya unwanted spam links share na karein (Auto-shield active hai).
3. Friday AI se baat karne ya photo/summary banane ke liye \`@friday\` ya \`@image\` likhein! ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
Enjoy your time here! 😊`;

    try {
      await sock.sendMessage(groupJid, { text: welcomeCard, mentions });
    } catch (wErr) {
      console.warn("[GroupSafetyEngine] Failed to send welcome card:", wErr);
    }
  }

  // ── Quiet Mode Manager ────────────────────────────────────────────────────

  public async toggleQuietMode(groupId: string, enable: boolean): Promise<string> {
    const config = await this.getGroupSafetyStatus(groupId);
    config.quietModeEnabled = enable;
    config.updatedAt = Date.now();
    this.safetyCache.set(groupId, config);
    await safetyCol().doc(groupId).set({ quietModeEnabled: enable, updatedAt: config.updatedAt }, { merge: true });
    return enable
      ? "🌙 *Night Quiet Mode ON:* Raat 11:00 PM se Subah 6:30 AM tak group me shanti banaye rakhne ka reminder active hai!"
      : "🌙 *Night Quiet Mode OFF:* Quiet mode disable kar diya gaya hai.";
  }

  public isQuietHours(): boolean {
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hour = nowIST.getHours();
    const minute = nowIST.getMinutes();
    // 11:00 PM (23) to 6:30 AM (6:30)
    if (hour >= 23 || hour < 6 || (hour === 6 && minute <= 30)) {
      return true;
    }
    return false;
  }

  // ── Voice Note Auto-Transcribe Manager ────────────────────────────────────

  public async isAutoTranscribeVoiceEnabled(groupId: string): Promise<boolean> {
    if (!this.loaded) await this.preloadFromFirestore();
    const config = this.safetyCache.get(groupId);
    return Boolean(config?.autoTranscribeVoice);
  }

  public async toggleAutoTranscribeVoice(groupId: string, enable: boolean): Promise<string> {
    const config = await this.getGroupSafetyStatus(groupId);
    config.autoTranscribeVoice = enable;
    config.updatedAt = Date.now();
    this.safetyCache.set(groupId, config);
    await safetyCol().doc(groupId).set({ autoTranscribeVoice: enable, updatedAt: config.updatedAt }, { merge: true });
    return enable
      ? `🎙️ *@voicenote AUTO-TRANSCRIBE ON!* ⚡\n\nAb is group me aane wale sabhi voice messages ko Friday automatic transcribe karke unka text transcript card post karegi, taaki bina audio play kiye sab padh sakein!`
      : `🎙️ *@voicenote AUTO-TRANSCRIBE OFF!* ⚡\n\nAb voice notes par automatic text card nahi aayega (Zero API cost mode). Kisi bhi voice note ko sunne/transcribe karne ke liye uspe \`?\` ya \`friday\` se swipe-reply karein!`;
  }

  // ── Profanity Normalization & Detection ───────────────────────────────────

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

  public detectProfanity(rawText: string): { isProfane: boolean; reason?: string } {
    if (!rawText || !rawText.trim()) return { isProfane: false };

    const rawLower = rawText.toLowerCase();

    // 1. Check Multi-word Phrases & Devanagari & Regex
    for (const phraseRegex of WhatsAppGroupSafetyEngine.PROFANITY_PHRASES) {
      if (phraseRegex.test(rawLower)) {
        return { isProfane: true, reason: "Gandi gaali / Abusive phrase detected" };
      }
    }

    // 2. Normalize Text (numbers/symbols to letters)
    const normalized = this.normalizeText(rawText);

    // Check phrases on normalized text too
    for (const phraseRegex of WhatsAppGroupSafetyEngine.PROFANITY_PHRASES) {
      if (phraseRegex.test(normalized)) {
        return { isProfane: true, reason: "Gandi gaali / Abusive phrase detected" };
      }
    }

    // 3. Flexible Regex for extra/repeated letters (e.g. "maadddarchod", "bheeeennnchood")
    for (let i = 0; i < WhatsAppGroupSafetyEngine.FLEXIBLE_ROOTS.length; i++) {
      const root = WhatsAppGroupSafetyEngine.FLEXIBLE_ROOTS[i];
      const regex = WhatsAppGroupSafetyEngine.FLEXIBLE_PATTERNS[i];
      if (regex.test(normalized) || regex.test(rawLower)) {
        return { isProfane: true, reason: `Gandi gaali detected ("${root}")` };
      }
    }

    // 4. Tokenize by whitespace and punctuation
    const words = normalized.split(/[\s,.\-_:;!?*~#^&()\[\]{}|\\/+=<>`'"]+/).filter(Boolean);

    for (const word of words) {
      if (WhatsAppGroupSafetyEngine.PROFANITY_WORDS.has(word)) {
        return { isProfane: true, reason: `Gandi gaali detected ("${word}")` };
      }

      const collapsed = this.collapseConsecutiveLetters(word);
      if (WhatsAppGroupSafetyEngine.PROFANITY_WORDS.has(collapsed)) {
        return { isProfane: true, reason: `Gandi gaali detected ("${collapsed}")` };
      }

      for (const root of WhatsAppGroupSafetyEngine.PROFANITY_WORDS) {
        if (root.length >= 4 && (word.startsWith(root) || word.endsWith(root) || collapsed.startsWith(root) || collapsed.endsWith(root))) {
          return { isProfane: true, reason: `Abusive word detected ("${word}")` };
        }
      }
    }

    // 5. Stripped & collapsed dot/space joined words
    const stripped = normalized.replace(/[^a-z0-9]/g, "");
    const strippedCollapsed = this.collapseConsecutiveLetters(stripped);

    for (const root of WhatsAppGroupSafetyEngine.FLEXIBLE_ROOTS) {
      if (stripped.includes(root) || strippedCollapsed.includes(this.collapseConsecutiveLetters(root))) {
        return { isProfane: true, reason: `Hidden abusive word detected ("${root}")` };
      }
    }

    return { isProfane: false };
  }

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

      const config = await this.getGroupSafetyStatus(groupJid);
      config.deletedCount = (config.deletedCount || 0) + 1;
      config.updatedAt = Date.now();
      this.safetyCache.set(groupJid, config);
      safetyCol().doc(groupJid).set({ deletedCount: config.deletedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});

      return true;
    } catch (err) {
      console.error(`[GroupSafetyEngine] Failed to delete message in ${groupJid}:`, err);
      return false;
    }
  }

  public async kickMember(sock: any, groupJid: string, participantJid: string): Promise<boolean> {
    if (!sock || !groupJid || !participantJid) return false;
    try {
      await sock.groupParticipantsUpdate(groupJid, [participantJid], "remove");
      const config = await this.getGroupSafetyStatus(groupJid);
      config.kickedCount = (config.kickedCount || 0) + 1;
      config.updatedAt = Date.now();
      this.safetyCache.set(groupJid, config);
      safetyCol().doc(groupJid).set({ kickedCount: config.kickedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});
      return true;
    } catch (e) {
      console.error(`[GroupSafetyEngine] Failed to kick member ${participantJid} from ${groupJid}:`, e);
      return false;
    }
  }

  public isSafetyCommand(text: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return (
      clean.startsWith("@block safe") ||
      clean.startsWith("/block safe") ||
      clean.startsWith("@blocksafe") ||
      clean.startsWith("/blocksafe") ||
      clean.startsWith("@allow all") ||
      clean.startsWith("/allow all") ||
      clean.startsWith("@allowall") ||
      clean.startsWith("/allowall") ||
      clean === "allow all" ||
      clean.startsWith("@voicenote") ||
      clean.startsWith("/voicenote") ||
      clean.startsWith("@vn") ||
      clean.startsWith("/vn") ||
      clean.startsWith("@voicetranscribe") ||
      clean.startsWith("@welcome") ||
      clean.startsWith("/welcome") ||
      clean.startsWith("@quiet") ||
      clean.startsWith("/quiet") ||
      clean.startsWith("@strike") ||
      clean.startsWith("/strike") ||
      clean.startsWith("@safety") ||
      clean.startsWith("/safety") ||
      /^(?:block\s*safe|allow\s*all|voicenote\s*on|voicenote\s*off|vn\s*on|vn\s*off|welcome\s*on|welcome\s*off|quiet\s*mode|strike\s*status|strike\s*reset|safety\s*mode|group\s*safety)/i.test(clean)
    );
  }

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

    // 0. Allow All Command (@allow all) -> Disable safety & warnings
    const isAllowAllCmd =
      clean.startsWith("@allow all") ||
      clean.startsWith("/allow all") ||
      clean.startsWith("@allowall") ||
      clean.startsWith("/allowall") ||
      clean === "allow all" ||
      /^(?:allow\s*all|unblock\s*all|no\s*filter|free\s*chat|disable\s*filter)$/i.test(clean);

    if (isAllowAllCmd) {
      const res = await this.disableGroupSafety(groupJid);
      return {
        handled: true,
        replyText: `🔓 *@allow all MODE ACTIVATED!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
🛡️ *Gaali Filter & Warning Status:* ❌ COMPLETELY OFF (Disabled)
💬 *Notice:* Ab is group me kisi bhi gaali par koi warning ya auto-delete action nahi hoga. Full free chat allowed hai! 👍
━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ️ _(Dobara safety shield on karne ke liye \`@block safe\` likhein.)_`,
      };
    }

    // 1. Welcome Card Toggle (@welcome on / @welcome off)
    if (clean.startsWith("@welcome") || clean.startsWith("/welcome") || clean.startsWith("welcome")) {
      if (clean.includes("off") || clean.includes("disable")) {
        const msg = await this.toggleWelcome(groupJid, false);
        return { handled: true, replyText: msg };
      }
      const msg = await this.toggleWelcome(groupJid, true);
      return { handled: true, replyText: msg };
    }

    // 1.5 Voice Note Auto-Transcribe Toggle (@voicenote on / @voicenote off / @vn on / @vn off)
    if (
      clean.startsWith("@voicenote") ||
      clean.startsWith("/voicenote") ||
      clean.startsWith("voicenote") ||
      clean.startsWith("@vn") ||
      clean.startsWith("/vn") ||
      clean.startsWith("vn") ||
      clean.startsWith("@voicetranscribe")
    ) {
      if (clean.includes("off") || clean.includes("disable") || clean.includes("band")) {
        const msg = await this.toggleAutoTranscribeVoice(groupJid, false);
        return { handled: true, replyText: msg };
      }
      const msg = await this.toggleAutoTranscribeVoice(groupJid, true);
      return { handled: true, replyText: msg };
    }

    // 2. Quiet Mode Toggle (@quiet mode on / @quiet mode off)
    if (clean.startsWith("@quiet") || clean.startsWith("/quiet") || clean.startsWith("quiet")) {
      if (clean.includes("off") || clean.includes("disable")) {
        const msg = await this.toggleQuietMode(groupJid, false);
        return { handled: true, replyText: msg };
      }
      const msg = await this.toggleQuietMode(groupJid, true);
      return { handled: true, replyText: msg };
    }

    // 3. Strikes Command (@strike status / @strike reset)
    if (clean.startsWith("@strike") || clean.startsWith("/strike") || clean.startsWith("strike")) {
      if (clean.includes("reset")) {
        const targetPhone = (quotedMessage?.senderPhone || "").replace(/\D/g, "");
        const res = await this.resetStrikes(groupJid, targetPhone || undefined);
        return { handled: true, replyText: `🥊 *Strike System:* ${res.message}` };
      }

      const status = await this.getGroupSafetyStatus(groupJid);
      return {
        handled: true,
        replyText: `🥊 *FRIDAY 3-STRIKE AUTO-KICK STATUS* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
⚠️ *Rules:*
• Strike 1: First Warning Alert (1/3)
• Strike 2: Final Warning Alert (2/3)
• Strike 3: Auto-Kick from Group (3/3 Out!)
📊 *Total Members Kicked:* ${status.kickedCount || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Commands:*
• \`@strike reset\` ➔ Group ke sabhi strikes reset karein.`,
      };
    }

    // 4. Quoted Message Delete Command (@block safe delete)
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

    // 5. Enable / Activate Command (@block safe)
    if (
      /\b(?:on|enable|activate|chalu|start|active|shuru)\b/i.test(clean) ||
      clean === "@block safe" ||
      clean === "/block safe" ||
      clean === "@blocksafe"
    ) {
      const isAdm = await this.isBotAdmin(sock, groupJid);
      const res = await this.enableGroupSafety(groupJid, groupName);
      const adminNotice = isAdm
        ? `\n\n🛡️ *Admin Status:* ✅ Friday is Admin (Auto-delete & Auto-kick Active).`
        : `\n\n⚠️ *Admin Status:* ❌ Friday abhi Group Admin nahi hai. Messages delete aur auto-kick karne ke liye Friday ko Admin banayein.`;

      return {
        handled: true,
        replyText: `${res.message}${adminNotice}`,
      };
    }

    // 6. Disable / Deactivate Command
    if (/\b(?:off|disable|deactivate|band|stop|pause)\b/i.test(clean)) {
      const res = await this.disableGroupSafety(groupJid);
      return {
        handled: true,
        replyText: res.message,
      };
    }

    // 7. Status Command (@safety / @block safe status)
    if (/\b(?:status|check|info)\b/i.test(clean) || clean === "@safety") {
      const isAdm = await this.isBotAdmin(sock, groupJid);
      const status = await this.getGroupSafetyStatus(groupJid);

      return {
        handled: true,
        replyText: `🛡️ *FRIDAY GROUP SAFETY STATUS (@block safe)* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
🔒 *Protection:* ${status.enabled !== false ? "✅ ACTIVE (Enabled)" : "❌ DISABLED (@allow all active)"}
🚫 *Gandi Gaali Auto-Delete:* ${status.blockProfanity !== false ? "✅ Active" : "❌ Disabled"}
🔞 *NSFW Media Auto-Delete:* ${status.blockNsfwMedia !== false ? "✅ Active" : "❌ Disabled"}
🚫 *Anti-Spam Shield:* ${status.blockSpam !== false ? "✅ Active" : "❌ Disabled"}
🎙️ *Voice Note Auto-Transcribe:* ${status.autoTranscribeVoice ? "✅ Active (@voicenote on)" : "❌ Disabled (Swipe '?' to transcribe)"}
👋 *New Member Welcome:* ${status.welcomeEnabled !== false ? "✅ Active" : "❌ Disabled"}
🌙 *Night Quiet Mode:* ${status.quietModeEnabled ? "✅ Active (11PM - 6:30AM)" : "❌ Disabled"}
👑 *Friday Admin Status:* ${isAdm ? "✅ Admin (Can Delete & Kick)" : "⚠️ Not Admin"}
📊 *Messages Deleted:* ${status.deletedCount || 0} | *Kicked:* ${status.kickedCount || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Commands:*
• \`@block safe\` ➔ Guard & 3-Strike Auto-Kick ON karein.
• \`@allow all\` ➔ Saare filters & warnings OFF karein.
• \`@voicenote on/off\` ➔ Voice note automatic transcription.
• \`@welcome on/off\` ➔ New member welcome greeting.
• \`@quiet mode on/off\` ➔ Night quiet mode.
• \`@block safe delete\` ➔ Quoted message delete karein.`,
      };
    }

    return { handled: false };
  }

  /**
   * Main Interceptor: Check incoming group message for offensive language, media, spam, or quiet mode.
   * If violation detected:
   * 1. Deletes message immediately.
   * 2. Issues 3-Strike Warning.
   * 3. On 3rd Strike, Auto-Kicks member from the group (if Admin).
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
  }): Promise<{ intercepted: boolean; reason?: string; deleted?: boolean; kicked?: boolean }> {
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

    // Do not moderate Boss DK
    if (isOwner) return { intercepted: false };

    // Check if safety is active for this group
    const isEnabled = await this.isGroupSafetyEnabled(groupJid);
    if (!isEnabled) return { intercepted: false };

    const cleanPhone = (senderPhone || "").replace(/\D/g, "");
    const mentionJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : senderJid;
    const mentionsList = Array.from(new Set([mentionJid, senderJid])).filter(Boolean);
    const senderTag = cleanPhone ? `@${cleanPhone}` : (senderName || "Member");

    // ── Check 1: Anti-Spam Rate Flooding & Phishing Links ─────────────────────
    const isFlood = this.checkSpamRate(groupJid, cleanPhone);
    const spamLink = this.detectSpamLinks(text || mediaCaption || "");

    if (isFlood || spamLink.isSpam) {
      const spamReason = isFlood ? "Rapid message spam flooding (4+ msgs in 3s)" : spamLink.reason!;
      console.log(`[GroupSafetyEngine] Spam detected in ${groupName} from +${cleanPhone}: ${spamReason}`);

      let deleted = false;
      if (sock) {
        try {
          deleted = await this.deleteMessage(sock, groupJid, messageKey, senderJid);
        } catch {}
      }

      const strikeCount = await this.recordStrike(groupJid, cleanPhone);
      const isAdm = await this.isBotAdmin(sock, groupJid, dedicatedPhone);

      if (strikeCount >= 3) {
        if (isAdm && sock) {
          await this.kickMember(sock, groupJid, senderJid);
          this.resetStrikes(groupJid, cleanPhone);
          const kickMsg = `🚨 *MEMBER REMOVED FROM GROUP (3 Strikes Out!)* ⛔\n\n👤 *Member:* ${senderTag}\n📌 *Wajah:* Baar-baar spam / rules violate karne ki wajah se auto-kick kar diya gaya hai.`;
          try {
            await sock.sendMessage(groupJid, { text: kickMsg, mentions: mentionsList });
          } catch {}
          return { intercepted: true, reason: spamReason, deleted, kicked: true };
        }
      }

      const spamWarning = `🛡️ *FRIDAY ANTI-SPAM GUARD (@block spam)* ⚡\n\n⚠️ *Spam Detected & Deleted!* 🚫\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${spamReason}\n🥊 *Strike:* ${strikeCount}/3 ${strikeCount === 2 ? "_(⚠️ Final Warning! Agli baar group se kick ho jayenge)_" : ""}`;
      try {
        await sock.sendMessage(groupJid, { text: spamWarning, mentions: mentionsList });
      } catch {}

      return { intercepted: true, reason: spamReason, deleted };
    }

    // ── Check 2: Profanity / Gaali & NSFW Media ──────────────────────────────
    const profResult = this.detectProfanity(text || mediaCaption || "");
    const mediaUnsafe = hasMedia ? this.detectUnsafeMedia(mediaCaption, fileName) : { isUnsafe: false };

    if (profResult.isProfane || mediaUnsafe.isUnsafe) {
      const reason = profResult.isProfane
        ? (profResult.reason || "Gandi gaali / Abusive language")
        : (mediaUnsafe.reason || "Inappropriate / NSFW Media");

      console.log(`[GroupSafetyEngine] 🚨 Offensive violation in ${groupName} from +${cleanPhone}: "${text || mediaCaption}" (${reason})`);

      let deleted = false;
      if (sock) {
        try {
          deleted = await this.deleteMessage(sock, groupJid, messageKey, senderJid);
        } catch (delErr) {
          console.warn("[GroupSafetyEngine] Direct delete attempt failed:", delErr);
        }
      }

      // Record 3-Strike Violation
      const strikeCount = await this.recordStrike(groupJid, cleanPhone);
      const isAdm = await this.isBotAdmin(sock, groupJid, dedicatedPhone);

      // Increment Warning Count
      try {
        const config = await this.getGroupSafetyStatus(groupJid);
        config.warnedCount = (config.warnedCount || 0) + 1;
        config.updatedAt = Date.now();
        this.safetyCache.set(groupJid, config);
        safetyCol().doc(groupJid).set({ warnedCount: config.warnedCount, updatedAt: config.updatedAt }, { merge: true }).catch(() => {});
      } catch {}

      // If Strike 3 -> AUTO KICK!
      if (strikeCount >= 3) {
        if (isAdm && sock) {
          await this.kickMember(sock, groupJid, senderJid);
          this.resetStrikes(groupJid, cleanPhone);
          const kickMsg = `🚨 *MEMBER REMOVED FROM GROUP (3 Strikes Out!)* ⛔\n\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${reason} (3 continuous rule violations).\n\n_Group ke shishtachar aur safety ke liye rule violators ko remove kar diya jata hai._`;
          try {
            await sock.sendMessage(groupJid, { text: kickMsg, mentions: mentionsList });
          } catch {}
          return { intercepted: true, reason, deleted, kicked: true };
        } else {
          const maxWarnMsg = `🚨 *MAXIMUM WARNINGS EXCEEDED (3/3):* ${senderTag} has reached 3 strikes for abusive language!\n👑 _(Admin Notice: Friday ko Group Admin banayein taaki rule breakers auto-kick ho sakein.)_`;
          try {
            await sock.sendMessage(groupJid, { text: maxWarnMsg, mentions: mentionsList });
          } catch {}
          return { intercepted: true, reason, deleted, kicked: false };
        }
      }

      // Warning Card (Strike 1 or Strike 2)
      let alertMessage = "";
      if (deleted) {
        alertMessage = `🛡️ *FRIDAY GROUP AUTO-SHIELD (@block safe)* ⚡\n\n🚫 *Abusive Message / Media Deleted!* 🗑️\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${reason}\n🥊 *Strike:* ${strikeCount}/3 ${strikeCount === 2 ? "_(⚠️ FINAL WARNING! 3rd strike par auto-remove ho jayenge)_" : ""}\n\n_Group ki shishtachar aur decency banaye rakhein._ 🙏`;
      } else {
        alertMessage = `🛡️ *FRIDAY SAFETY WARNING (@block safe)* ⚡\n\n⚠️ *Gandi Gaali / Abusive Content Detected!*\n👤 *Member:* ${senderTag}\n📌 *Wajah:* ${reason}\n🥊 *Strike:* ${strikeCount}/3 ${strikeCount === 2 ? "_(⚠️ FINAL WARNING! 3rd strike par auto-remove ho jayenge)_" : ""}\n\n👑 _(Admin Notice: Friday ko Group Admin banayein taaki aisi messages chat se automatically delete ho sakein.)_`;
      }

      try {
        await sock.sendMessage(groupJid, { text: alertMessage, mentions: mentionsList });
      } catch (alertErr) {
        console.error("[GroupSafetyEngine] Failed to send warning alert to group:", alertErr);
      }

      return { intercepted: true, reason, deleted };
    }

    // ── Check 3: Night Quiet Mode Reminder ───────────────────────────────────
    const status = await this.getGroupSafetyStatus(groupJid);
    if (status.quietModeEnabled && this.isQuietHours() && sock) {
      const quietKey = `${groupJid}_${cleanPhone}`;
      const lastReminded = this.lastQuietReminderMap.get(quietKey) || 0;
      // Remind at most once per 3 hours per user
      if (Date.now() - lastReminded > 3 * 60 * 60 * 1000) {
        this.lastQuietReminderMap.set(quietKey, Date.now());
        const quietNotice = `🌙 *Night Quiet Mode Active (@quiet mode)* 🤫\n\n👤 ${senderTag}, raat ke samay group me sabhi members ke aaram ke liye shanti banaye rakhein. (Emergency ho toh mention karein).`;
        try {
          await sock.sendMessage(groupJid, { text: quietNotice, mentions: mentionsList });
        } catch {}
      }
    }

    return { intercepted: false };
  }
}

export const whatsappGroupSafetyEngine = new WhatsAppGroupSafetyEngine();
