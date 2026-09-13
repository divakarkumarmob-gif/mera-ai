import { db } from "../firebaseAdmin";
import { contactsService } from "../contactsService";

export interface QuotaCheckResult {
  allowed: boolean;
  currentCount: number;
  effectiveLimit: number; // -1 indicates unlimited
  isUnlimited: boolean;
  isQuotaExhaustedNow: boolean;
  quotaExhaustedNotice?: string;
}

export interface ContactQuotaConfig {
  phone: string;
  name?: string;
  dailyLimit: number; // -1 for unlimited, or 0..N
  updatedAt: number;
  updatedBy?: string;
}

export interface GlobalQuotaConfig {
  globalDefaultLimit: number; // default fallback, e.g. 10 (-1 for unlimited)
  knownContactsLimit: number; // default for saved contacts, e.g. 10 (-1 for unlimited)
  unknownContactsLimit: number; // default for unknown contacts, e.g. 10 (-1 for unlimited)
  updatedAt: number;
}

interface DailyUsageRecord {
  phone: string;
  count: number;
  dateStr: string; // YYYY-MM-DD in Asia/Kolkata
  lastMessageAt: number;
  notifiedExhaustedDate?: string;
}

const DEFAULT_LIMIT = 10;
const SYSTEM_CONFIG_DOC = "system_config/whatsapp_message_quotas";

export class WhatsAppDailyQuotaEngine {
  private globalConfig: GlobalQuotaConfig = {
    globalDefaultLimit: DEFAULT_LIMIT,
    knownContactsLimit: DEFAULT_LIMIT,
    unknownContactsLimit: DEFAULT_LIMIT,
    updatedAt: Date.now(),
  };

  private contactOverrides: Map<string, ContactQuotaConfig> = new Map();
  private dailyUsageCache: Map<string, DailyUsageRecord> = new Map();
  private isLoadedFromDb = false;

  constructor() {
    this.loadConfigFromDb().catch((err) => {
      console.warn("[WhatsAppDailyQuotaEngine] Initial DB load error:", err?.message || err);
    });
  }

  /**
   * Get today's date formatted as YYYY-MM-DD in Indian Standard Time (IST).
   * Daily quotas automatically reset at 12:00 AM IST.
   */
  public getTodayIST(): string {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  }

  /**
   * Normalize phone number to standard digits (e.g. 919876543210 or last 10 digits).
   */
  public normalizePhone(rawPhone: string): string {
    if (!rawPhone) return "";
    const clean = rawPhone.replace(/\D/g, "");
    if (clean.length === 10) return `91${clean}`;
    return clean;
  }

  /**
   * Load stored configs and overrides from Firestore
   */
  private async loadConfigFromDb(): Promise<void> {
    try {
      const snap = await db.doc(SYSTEM_CONFIG_DOC).get();
      if (snap.exists) {
        const data = snap.data();
        if (data) {
          if (typeof data.globalDefaultLimit === "number") {
            this.globalConfig.globalDefaultLimit = data.globalDefaultLimit;
          }
          if (typeof data.knownContactsLimit === "number") {
            this.globalConfig.knownContactsLimit = data.knownContactsLimit;
          }
          if (typeof data.unknownContactsLimit === "number") {
            this.globalConfig.unknownContactsLimit = data.unknownContactsLimit;
          }
          if (data.contactOverrides && typeof data.contactOverrides === "object") {
            for (const [phone, cfg] of Object.entries(data.contactOverrides)) {
              if (cfg && typeof cfg === "object") {
                this.contactOverrides.set(phone, cfg as ContactQuotaConfig);
              }
            }
          }
        }
      }
      this.isLoadedFromDb = true;
    } catch (e: any) {
      console.warn("[WhatsAppDailyQuotaEngine] Failed to load quota config:", e?.message || e);
    }
  }

  /**
   * Save configuration to Firestore
   */
  private async persistConfig(): Promise<void> {
    try {
      const overridesObj: Record<string, any> = {};
      for (const [phone, cfg] of this.contactOverrides.entries()) {
        overridesObj[phone] = cfg;
      }
      await db.doc(SYSTEM_CONFIG_DOC).set(
        {
          globalDefaultLimit: this.globalConfig.globalDefaultLimit,
          knownContactsLimit: this.globalConfig.knownContactsLimit,
          unknownContactsLimit: this.globalConfig.unknownContactsLimit,
          contactOverrides: overridesObj,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e: any) {
      console.error("[WhatsAppDailyQuotaEngine] Failed to persist config:", e?.message || e);
    }
  }

  /**
   * Resolve effective daily limit for a contact or phone number.
   * Return -1 for unlimited.
   */
  public async getEffectiveLimit(phone: string, isKnownContact: boolean): Promise<number> {
    if (!this.isLoadedFromDb) {
      await this.loadConfigFromDb();
    }
    const cleanPhone = this.normalizePhone(phone);
    const last10 = cleanPhone.slice(-10);

    // 1. Check direct override by full normalized phone or last 10 digits
    if (this.contactOverrides.has(cleanPhone)) {
      return this.contactOverrides.get(cleanPhone)!.dailyLimit;
    }
    if (last10 && this.contactOverrides.has(last10)) {
      return this.contactOverrides.get(last10)!.dailyLimit;
    }

    // 2. Apply group/global policy
    if (isKnownContact) {
      return this.globalConfig.knownContactsLimit ?? this.globalConfig.globalDefaultLimit ?? DEFAULT_LIMIT;
    } else {
      return this.globalConfig.unknownContactsLimit ?? this.globalConfig.globalDefaultLimit ?? DEFAULT_LIMIT;
    }
  }

  /**
   * Check if a message is allowed under the daily quota and increment usage.
   * If the limit is reached or just exhausted, returns detailed state.
   */
  public async checkAndConsumeQuota(
    phone: string,
    isKnownContact: boolean,
    contactName?: string
  ): Promise<QuotaCheckResult> {
    const today = this.getTodayIST();
    const cleanPhone = this.normalizePhone(phone);
    const effectiveLimit = await this.getEffectiveLimit(cleanPhone, isKnownContact);

    // Check if unlimited
    if (effectiveLimit === -1 || effectiveLimit >= 999999) {
      let record = this.dailyUsageCache.get(cleanPhone);
      if (!record || record.dateStr !== today) {
        record = { phone: cleanPhone, count: 0, dateStr: today, lastMessageAt: Date.now() };
      }
      record.count++;
      record.lastMessageAt = Date.now();
      this.dailyUsageCache.set(cleanPhone, record);

      return {
        allowed: true,
        currentCount: record.count,
        effectiveLimit: -1,
        isUnlimited: true,
        isQuotaExhaustedNow: false,
      };
    }

    // Load usage for today
    let record = this.dailyUsageCache.get(cleanPhone);
    if (!record || record.dateStr !== today) {
      try {
        const usageDocId = `usage_${cleanPhone}_${today}`;
        const snap = await db.collection("whatsapp_daily_usage").doc(usageDocId).get();
        if (snap.exists) {
          const data = snap.data();
          record = {
            phone: cleanPhone,
            count: data?.count || 0,
            dateStr: today,
            lastMessageAt: data?.lastMessageAt || Date.now(),
            notifiedExhaustedDate: data?.notifiedExhaustedDate,
          };
        } else {
          record = { phone: cleanPhone, count: 0, dateStr: today, lastMessageAt: Date.now() };
        }
      } catch {
        record = { phone: cleanPhone, count: 0, dateStr: today, lastMessageAt: Date.now() };
      }
      this.dailyUsageCache.set(cleanPhone, record);
    }

    // Check if quota is already fully exhausted
    if (record.count >= effectiveLimit) {
      const alreadyNotified = record.notifiedExhaustedDate === today;
      if (!alreadyNotified) {
        record.notifiedExhaustedDate = today;
        this.dailyUsageCache.set(cleanPhone, record);
        this.persistDailyUsage(record).catch(() => {});
        return {
          allowed: false,
          currentCount: record.count,
          effectiveLimit,
          isUnlimited: false,
          isQuotaExhaustedNow: true,
          quotaExhaustedNotice: `Aaj ka message limit (${effectiveLimit}) pura ho gaya hai. Kal baat karte hain! 🙏 (Daily reset at 12:00 AM midnight)`,
        };
      }
      return {
        allowed: false,
        currentCount: record.count,
        effectiveLimit,
        isUnlimited: false,
        isQuotaExhaustedNow: true,
      };
    }

    // Increment count
    record.count++;
    record.lastMessageAt = Date.now();
    const isJustExhausted = record.count >= effectiveLimit;
    if (isJustExhausted) {
      record.notifiedExhaustedDate = today;
    }
    this.dailyUsageCache.set(cleanPhone, record);
    this.persistDailyUsage(record).catch(() => {});

    return {
      allowed: true,
      currentCount: record.count,
      effectiveLimit,
      isUnlimited: false,
      isQuotaExhaustedNow: isJustExhausted,
      quotaExhaustedNotice: isJustExhausted
        ? `\n\n📌 *Aaj ka message limit pura ho gaya hai (${record.count}/${effectiveLimit}). Kal baat karte hain!* 🙏`
        : undefined,
    };
  }

  private async persistDailyUsage(record: DailyUsageRecord): Promise<void> {
    try {
      const usageDocId = `usage_${record.phone}_${record.dateStr}`;
      await db.collection("whatsapp_daily_usage").doc(usageDocId).set(
        {
          phone: record.phone,
          count: record.count,
          dateStr: record.dateStr,
          lastMessageAt: record.lastMessageAt,
          notifiedExhaustedDate: record.notifiedExhaustedDate || null,
        },
        { merge: true }
      );
    } catch (e: any) {
      // Non-blocking
    }
  }

  /**
   * Set a custom limit or unlimited for a specific contact or phone number.
   * Accepts number (e.g. 5, 20, 50), -1 for unlimited, or "unlimited" string.
   */
  public async setContactQuota(
    contactNameOrPhone: string,
    limit: number | string,
    setBy: string = "Boss DK"
  ): Promise<{ success: boolean; message: string; resolvedPhone?: string; limit: number }> {
    if (!this.isLoadedFromDb) await this.loadConfigFromDb();

    let resolvedLimit: number;
    if (typeof limit === "string") {
      const cleanLimit = limit.toLowerCase().trim();
      if (cleanLimit.includes("unlimit") || cleanLimit === "-1" || cleanLimit.includes("hata") || cleanLimit.includes("no limit")) {
        resolvedLimit = -1;
      } else {
        const parsed = parseInt(cleanLimit.replace(/\D/g, ""), 10);
        resolvedLimit = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT;
      }
    } else {
      resolvedLimit = limit < 0 ? -1 : limit;
    }

    let phone = this.normalizePhone(contactNameOrPhone);
    let contactName = contactNameOrPhone;

    try {
      const contact = await contactsService.findContact(contactNameOrPhone);
      if (contact && contact.id !== "temp" && contact.phone) {
        phone = this.normalizePhone(contact.phone);
        contactName = contact.name || contactNameOrPhone;
      }
    } catch {}

    if (!phone || phone.length < 5) {
      return {
        success: false,
        message: `❌ "${contactNameOrPhone}" ke liye valid contact ya phone number nahi mila.`,
        limit: resolvedLimit,
      };
    }

    const configEntry: ContactQuotaConfig = {
      phone,
      name: contactName,
      dailyLimit: resolvedLimit,
      updatedAt: Date.now(),
      updatedBy: setBy,
    };

    this.contactOverrides.set(phone, configEntry);
    const last10 = phone.slice(-10);
    if (last10 && last10 !== phone) {
      this.contactOverrides.set(last10, configEntry);
    }

    await this.persistConfig();

    const limitDisplay = resolvedLimit === -1 ? "✨ UNLIMITED (No Daily Limit)" : `📊 ${resolvedLimit} messages / day`;
    return {
      success: true,
      message: `✅ *Contact Quota Updated Successfully!*\n👤 *Contact:* ${contactName} (+${phone})\n🎯 *Daily Limit:* ${limitDisplay}\n🔄 *Reset Time:* Har roz raat 12:00 AM IST.`,
      resolvedPhone: phone,
      limit: resolvedLimit,
    };
  }

  /**
   * Set global daily message quota for a specific scope: 'all' | 'known_contacts' | 'unknown_contacts'
   */
  public async setGlobalQuota(
    scope: "all" | "known" | "known_contacts" | "unknown" | "unknown_contacts" | "saved",
    limit: number | string,
    setBy: string = "Boss DK"
  ): Promise<{ success: boolean; message: string; scope: string; limit: number }> {
    if (!this.isLoadedFromDb) await this.loadConfigFromDb();

    let resolvedLimit: number;
    if (typeof limit === "string") {
      const cleanLimit = limit.toLowerCase().trim();
      if (cleanLimit.includes("unlimit") || cleanLimit === "-1" || cleanLimit.includes("hata") || cleanLimit.includes("no limit")) {
        resolvedLimit = -1;
      } else {
        const parsed = parseInt(cleanLimit.replace(/\D/g, ""), 10);
        resolvedLimit = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT;
      }
    } else {
      resolvedLimit = limit < 0 ? -1 : limit;
    }

    const normalizedScope = scope.toLowerCase();
    let scopeName = "All Contacts";

    if (normalizedScope.includes("unknown")) {
      this.globalConfig.unknownContactsLimit = resolvedLimit;
      scopeName = "Unknown / Unsaved Contacts";
    } else if (normalizedScope.includes("known") || normalizedScope.includes("saved")) {
      this.globalConfig.knownContactsLimit = resolvedLimit;
      scopeName = "Known / Saved Contacts";
    } else {
      this.globalConfig.globalDefaultLimit = resolvedLimit;
      this.globalConfig.knownContactsLimit = resolvedLimit;
      this.globalConfig.unknownContactsLimit = resolvedLimit;
      scopeName = "All Contacts (Known & Unknown)";
    }
    this.globalConfig.updatedAt = Date.now();

    await this.persistConfig();

    const limitDisplay = resolvedLimit === -1 ? "✨ UNLIMITED" : `📊 ${resolvedLimit} messages / day`;
    return {
      success: true,
      message: `✅ *Global Message Quota Configured!*\n🌐 *Scope:* ${scopeName}\n🎯 *New Limit:* ${limitDisplay}\n🔄 *Reset:* Raat 12:00 AM IST pe auto-reset hoga.`,
      scope: scopeName,
      limit: resolvedLimit,
    };
  }

  /**
   * Get quota status and active usage report
   */
  public async getQuotaStatus(contactNameOrPhone?: string): Promise<{
    success: boolean;
    report: string;
    globalConfig: GlobalQuotaConfig;
    contactDetails?: any;
  }> {
    if (!this.isLoadedFromDb) await this.loadConfigFromDb();
    const today = this.getTodayIST();

    if (contactNameOrPhone && contactNameOrPhone.trim() !== "" && contactNameOrPhone.toLowerCase() !== "all") {
      let phone = this.normalizePhone(contactNameOrPhone);
      let contactName = contactNameOrPhone;
      let isKnown = false;

      try {
        const contact = await contactsService.findContact(contactNameOrPhone);
        if (contact && contact.id !== "temp" && contact.phone) {
          phone = this.normalizePhone(contact.phone);
          contactName = contact.name || contactNameOrPhone;
          isKnown = true;
        }
      } catch {}

      const effectiveLimit = await this.getEffectiveLimit(phone, isKnown);
      const usage = this.dailyUsageCache.get(phone);
      const todayCount = usage && usage.dateStr === today ? usage.count : 0;
      const isUnlimited = effectiveLimit === -1;
      const remaining = isUnlimited ? "Unlimited" : Math.max(0, effectiveLimit - todayCount);

      const limitStr = isUnlimited ? "✨ Unlimited" : `${effectiveLimit} msgs/day`;
      const report = `📋 *DAILY MESSAGE QUOTA STATUS*\n━━━━━━━━━━━━━━━━━━━\n👤 *Contact:* ${contactName} (+${phone})\n🏷️ *Type:* ${isKnown ? "Saved Contact" : "Unknown / Direct"}\n🎯 *Daily Limit:* ${limitStr}\n💬 *Messages Sent Today (${today}):* ${todayCount}\n⏳ *Remaining Today:* ${remaining}\n🔄 *Midnight Reset:* 12:00 AM IST`;

      return {
        success: true,
        report,
        globalConfig: this.globalConfig,
        contactDetails: {
          phone,
          contactName,
          isKnown,
          effectiveLimit,
          todayCount,
          remaining,
        },
      };
    }

    // Overall Global Summary
    const knownLimitStr = this.globalConfig.knownContactsLimit === -1 ? "Unlimited" : `${this.globalConfig.knownContactsLimit} msgs/day`;
    const unknownLimitStr = this.globalConfig.unknownContactsLimit === -1 ? "Unlimited" : `${this.globalConfig.unknownContactsLimit} msgs/day`;
    const defaultLimitStr = this.globalConfig.globalDefaultLimit === -1 ? "Unlimited" : `${this.globalConfig.globalDefaultLimit} msgs/day`;

    const overridesList: string[] = [];
    for (const [phone, cfg] of this.contactOverrides.entries()) {
      if (phone.length <= 10 && this.contactOverrides.has(`91${phone}`)) continue; // avoid duplicates
      const lim = cfg.dailyLimit === -1 ? "Unlimited" : `${cfg.dailyLimit} msgs/day`;
      overridesList.push(`• ${cfg.name || "Contact"} (+${phone}): *${lim}*`);
    }

    const report = `📊 *SYSTEM-WIDE MESSAGE QUOTA STATUS*\n━━━━━━━━━━━━━━━━━━━━━\n🌐 *Default Limit:* ${defaultLimitStr}\n👥 *Saved Contacts Limit:* ${knownLimitStr}\n👤 *Unknown Senders Limit:* ${unknownLimitStr}\n\n🌟 *Custom Contact Overrides (${this.contactOverrides.size}):*\n${overridesList.length > 0 ? overridesList.slice(0, 10).join("\n") : "• None set (Using global policy)"}\n\n🔄 *Reset Schedule:* Daily at 12:00 AM IST (Midnight)`;

    return {
      success: true,
      report,
      globalConfig: this.globalConfig,
    };
  }

  /**
   * Reset today's message counters back to 0 (for a single contact or all contacts).
   */
  public async resetDailyCounters(contactNameOrPhone?: string): Promise<{ success: boolean; message: string }> {
    const today = this.getTodayIST();

    if (contactNameOrPhone && contactNameOrPhone.toLowerCase() !== "all") {
      let phone = this.normalizePhone(contactNameOrPhone);
      try {
        const contact = await contactsService.findContact(contactNameOrPhone);
        if (contact && contact.id !== "temp" && contact.phone) {
          phone = this.normalizePhone(contact.phone);
        }
      } catch {}

      if (phone) {
        this.dailyUsageCache.delete(phone);
        try {
          const usageDocId = `usage_${phone}_${today}`;
          await db.collection("whatsapp_daily_usage").doc(usageDocId).delete();
        } catch {}
        return {
          success: true,
          message: `🔄 Daily counter for +${phone} has been reset to 0 for today (${today}).`,
        };
      }
    }

    // Reset all in-memory usage
    this.dailyUsageCache.clear();
    return {
      success: true,
      message: `🔄 All daily message usage counters have been reset to 0 for today (${today}).`,
    };
  }
}

export const whatsappDailyQuotaEngine = new WhatsAppDailyQuotaEngine();
