import { db } from "../firebaseAdmin";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";
import { whatsappBossAiEngine } from "./whatsappBossAiEngine";
import { whatsappBotService } from "../whatsappBotService";
import { whatsappContactsHumanEngine } from "./whatsappContactsHumanEngine";
import { whatsappUnknownAssistantEngine } from "./whatsappUnknownAssistantEngine";

export interface ActiveWhatsAppChatter {
  key: string;
  replyJid: string;
  senderPhone: string;
  senderName: string;
  isBoss: boolean;
  lastMessageTimestamp: number;
  hoursSinceLastMessage: number;
  lastMessageSnippet: string;
}

export interface ResetRoutineResult {
  success: boolean;
  cycleId: string;
  timestamp: number;
  eligibleCount: number;
  notifiedCount: number;
  skippedInactiveCount: number;
  recipients: string[];
  skippedDetails: Array<{ id: string; reason: string; hoursSince: number }>;
  error?: string;
}

/**
 * WhatsApp Circadian Session Service for Friday AI.
 * 
 * Manages the daily 24-hour conversational lifecycle anchored at 03:00 AM IST:
 * - 03:00 AM IST represents the daily circadian boundary.
 * - At 03:00 AM IST, contacts who actively chatted with Friday in the last 24 hours
 *   receive a gentle, courteous "session reset & archival" message.
 * - Strict Inactivity Guard: Anyone who has NOT messaged in > 24 hours (e.g. 25+ hours)
 *   is strictly excluded and will NOT be disturbed.
 * - Group chats and bot-originated messages are strictly excluded.
 * - Working chat sessions in RAM are reset for a clean slate, while all permanent
 *   memories (Vault, Pinned Facts, Profile) remain 100% intact.
 */
class WhatsAppCircadianSessionService {
  private activeCycleId: string;
  private checkInterval?: NodeJS.Timeout;
  private isProcessing = false;
  private lastCompletedCycle: string = "";

  constructor() {
    this.activeCycleId = this.getCircadianCycleId();

    // Check periodically every 60 seconds
    this.checkInterval = setInterval(() => {
      this.checkAndTriggerCircadianReset().catch((err) => {
        console.warn("[WhatsAppCircadian] Periodic check error:", err?.message || err);
      });
      this.checkAndTriggerSundayNudge().catch((err) => {
        console.warn("[WhatsAppCircadian] Sunday nudge check error:", err?.message || err);
      });
    }, 60 * 1000);

    // Initial check 20 seconds after launch
    setTimeout(() => {
      this.checkAndTriggerCircadianReset().catch(() => {});
      this.checkAndTriggerSundayNudge().catch(() => {});
    }, 20 * 1000);
  }

  /**
   * Returns current IST hour, minute, and formatted date string.
   */
  public getISTTime(now: Date = new Date()): { hours: number; minutes: number; dateStr: string; timeStr: string } {
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istNow.getHours();
    const minutes = istNow.getMinutes();
    const yyyy = istNow.getFullYear();
    const mm = String(istNow.getMonth() + 1).padStart(2, "0");
    const dd = String(istNow.getDate()).padStart(2, "0");
    return {
      hours,
      minutes,
      dateStr: `${yyyy}-${mm}-${dd}`,
      timeStr: istNow.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
    };
  }

  /**
   * Calculates the 24-hour circadian cycle ID anchored at 03:00 AM IST.
   * Cycle runs continuously from 03:00 AM to 02:59:59 AM next morning.
   */
  public getCircadianCycleId(now: Date = new Date()): string {
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istNow.getHours();
    const d = new Date(istNow);
    if (hours < 3) {
      d.setDate(d.getDate() - 1);
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Scans and returns all WhatsApp contacts who actively chatted with Friday in the last 24 hours.
   * Explicitly filters out users whose last message was > 24 hours ago (e.g. 25+ hours).
   */
  public async getEligibleChatters(nowMs: number = Date.now()): Promise<{
    eligible: ActiveWhatsAppChatter[];
    skippedInactive: Array<{ id: string; reason: string; hoursSince: number }>;
  }> {
    const cutoff24h = nowMs - 24 * 60 * 60 * 1000;
    const ownerPhone = (
      process.env.OWNER_WHATSAPP_NUMBER ||
      process.env.BOSS_WHATSAPP_NUMBER ||
      process.env.OWNER_PHONE ||
      ""
    ).replace(/\D/g, "");

    // 1. Gather messages from Firestore whatsapp_inbox
    let firestoreMsgs: any[] = [];
    try {
      const snap = await db.collection("whatsapp_inbox")
        .where("timestamp", ">=", cutoff24h)
        .get();
      firestoreMsgs = snap.docs.map((d) => d.data());
    } catch (e: any) {
      console.warn("[WhatsAppCircadian] Fallback query for whatsapp_inbox:", e?.message || e);
      try {
        const fallbackSnap = await db.collection("whatsapp_inbox")
          .orderBy("timestamp", "desc")
          .limit(300)
          .get();
        firestoreMsgs = fallbackSnap.docs.map((d) => d.data());
      } catch {}
    }

    // 2. Gather messages from RAM cache
    const ramMsgs = whatsappHistoryEngine.getMessageCache();

    // Combine messages
    const allMsgs = [...firestoreMsgs, ...ramMsgs];

    // Map to track the most recent inbound message per unique contact
    const contactMap = new Map<string, {
      replyJid: string;
      senderPhone: string;
      senderName: string;
      isBoss: boolean;
      maxTimestamp: number;
      lastText: string;
      isGroup: boolean;
    }>();

    for (const msg of allMsgs) {
      if (!msg) continue;
      const ts = Number(msg.timestamp) || 0;
      if (!ts) continue;

      // Filter out groups
      const isGroup = !!msg.isGroup || (msg.replyJid && msg.replyJid.endsWith("@g.us"));
      if (isGroup) continue;

      // Filter out bot outgoing messages
      if (msg.senderPhone === "bot") continue;

      const rawPhone = (msg.senderPhone || "").replace(/\D/g, "");
      const isBossMsg =
        msg.senderPhone === "me" ||
        (ownerPhone && rawPhone.endsWith(ownerPhone.slice(-10))) ||
        (msg.senderName && /boss|dk/i.test(msg.senderName));

      // Resolve a reliable key and reply JID
      let targetJid = msg.replyJid || "";
      if (!targetJid || !targetJid.includes("@")) {
        if (isBossMsg && ownerPhone) {
          targetJid = `${ownerPhone}@s.whatsapp.net`;
        } else if (rawPhone) {
          targetJid = `${rawPhone}@s.whatsapp.net`;
        }
      }

      const key = isBossMsg ? "boss_dk" : (rawPhone || targetJid);
      if (!key) continue;

      const existing = contactMap.get(key);
      if (!existing || ts > existing.maxTimestamp) {
        contactMap.set(key, {
          replyJid: targetJid,
          senderPhone: rawPhone || (isBossMsg ? ownerPhone : ""),
          senderName: isBossMsg ? "Boss (DK)" : (msg.senderName || msg.senderDisplayName || "Contact"),
          isBoss: isBossMsg,
          maxTimestamp: ts,
          lastText: msg.text || "",
          isGroup: false,
        });
      }
    }

    // Also include in-memory active Boss sessions if active within last 24h
    const activeSessions = whatsappBossAiEngine.getAllActiveSessions();
    activeSessions.forEach((sess, sessionKey) => {
      const isBossSess = sessionKey === "boss_dk" || (ownerPhone && sessionKey.includes(ownerPhone.slice(-10)));
      const key = isBossSess ? "boss_dk" : sessionKey;
      const ts = sess.lastActive || 0;
      const existing = contactMap.get(key);

      if (!existing || ts > existing.maxTimestamp) {
        contactMap.set(key, {
          replyJid: isBossSess && ownerPhone ? `${ownerPhone}@s.whatsapp.net` : sessionKey,
          senderPhone: isBossSess ? ownerPhone : sessionKey.replace(/\D/g, ""),
          senderName: isBossSess ? "Boss (DK)" : "Contact",
          isBoss: isBossSess,
          maxTimestamp: ts,
          lastText: existing?.lastText || "[Active Circadian Session]",
          isGroup: false,
        });
      }
    });

    const eligible: ActiveWhatsAppChatter[] = [];
    const skippedInactive: Array<{ id: string; reason: string; hoursSince: number }> = [];

    // Apply the 24h vs 25h rule strictly
    for (const [key, contact] of contactMap.entries()) {
      const diffMs = nowMs - contact.maxTimestamp;
      const hoursSince = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));

      // Golden Rule: If inactive for > 24 hours (e.g. 25h, 30h, 2 days), DO NOT SEND!
      if (diffMs > 24 * 60 * 60 * 1000) {
        skippedInactive.push({
          id: key,
          reason: `Last active ${hoursSince} hours ago (> 24 hours). Excluded from 3:00 AM reset notification.`,
          hoursSince,
        });
        continue;
      }

      // OWNER EXEMPTION MANDATE:
      // Owner session NEVER auto-resets at 3:00 AM. It only resets when Owner explicitly types or says 'new session'.
      if (contact.isBoss) {
        console.log(`[WhatsAppCircadian] 👑 Boss (${key}) is exempt from 03:00 AM auto-reset per Boss mandate. (Only resets on explicit 'new session' command).`);
        skippedInactive.push({
          id: key,
          reason: "Owner session is persistent and exempt from 03:00 AM auto-reset. Only resets on explicit 'new session' command.",
          hoursSince,
        });
        continue;
      }

      // Valid non-boss chatter within last 24 hours!
      eligible.push({
        key,
        replyJid: contact.replyJid,
        senderPhone: contact.senderPhone,
        senderName: contact.senderName,
        isBoss: contact.isBoss,
        lastMessageTimestamp: contact.maxTimestamp,
        hoursSinceLastMessage: hoursSince,
        lastMessageSnippet: contact.lastText.slice(0, 60),
      });
    }

    return { eligible, skippedInactive };
  }

  /**
   * Executes the 03:00 AM IST circadian session reset and sends notification
   * ONLY to users who chatted in the last 24 hours.
   */
  public async executeNightlyResetRoutine(options: { force?: boolean } = {}): Promise<ResetRoutineResult> {
    if (this.isProcessing && !options.force) {
      return {
        success: false,
        cycleId: this.activeCycleId,
        timestamp: Date.now(),
        eligibleCount: 0,
        notifiedCount: 0,
        skippedInactiveCount: 0,
        recipients: [],
        skippedDetails: [],
        error: "Reset routine already in progress",
      };
    }

    this.isProcessing = true;
    const now = new Date();
    const cycleId = this.getCircadianCycleId(now);
    const nowMs = Date.now();

    console.log(`[WhatsAppCircadian] 🌙 03:00 AM IST Circadian Session Reset triggered for cycle: ${cycleId}...`);

    try {
      // 1. Verify idempotency in Firestore (unless force)
      if (!options.force) {
        const runLogRef = db.collection("memory").doc("circadianResetLog").collection("whatsapp_runs").doc(cycleId);
        const existingRun = await runLogRef.get();
        if (existingRun.exists) {
          console.log(`[WhatsAppCircadian] ⏭️ Cycle ${cycleId} was already completed at ${existingRun.data()?.completedAtStr || "earlier"}. Skipping duplicate.`);
          this.lastCompletedCycle = cycleId;
          this.isProcessing = false;
          return {
            success: true,
            cycleId,
            timestamp: nowMs,
            eligibleCount: 0,
            notifiedCount: 0,
            skippedInactiveCount: 0,
            recipients: [],
            skippedDetails: [],
          };
        }
      }

      // 2. Discover eligible chatters (active within <= 24 hours)
      const { eligible, skippedInactive } = await this.getEligibleChatters(nowMs);
      console.log(`[WhatsAppCircadian] Found ${eligible.length} eligible chatters (last 24h) and ${skippedInactive.length} inactive contacts (> 24h).`);

      const notifiedRecipients: string[] = [];
      const isWaConnected = whatsappBotService.getStatus().isConnected;

      // 3. Dispatch session reset messages to each eligible contact
      for (const chatter of eligible) {
        try {
          const cleanKey = chatter.key.replace(/[^\w]/g, "_");
          const notifDocRef = db.collection("memory").doc("circadianResetLog").collection("notifications").doc(`${cycleId}_${cleanKey}`);

          // Idempotency per contact
          if (!options.force) {
            const alreadyNotified = await notifDocRef.get();
            if (alreadyNotified.exists) {
              console.log(`[WhatsAppCircadian] Contact ${chatter.key} already notified for cycle ${cycleId}.`);
              continue;
            }
          }

          // Compose warm Friday session reset notification
          const resetMessage = chatter.isBoss
            ? `Boss, raat ke 3:00 AM ho chuke hain aur hamara daily conversation session safely wrap-up aur reset ho gaya hai. 🌙\n\nAapki saari important baatein, preferences aur memories permanent memory me save ho chuki hain. Kal subah milte hain fresh energy ke saath!\n\nGood night & sleep well, Boss! ⚡`
            : `Hello! Raat ke 3:00 AM ho chuke hain aur Friday AI ka daily conversation session safely complete aur reset ho gaya hai. 🌙\n\nAapki baatein archive kar li gayi hain. Kal subah naye din ke saath fresh baat karenge.\n\nGood night! ✨`;

          if (isWaConnected && chatter.replyJid) {
            await whatsappBotService.sendHumanLikeMessage(chatter.replyJid, resetMessage);
            console.log(`[WhatsAppCircadian] ✉️ Sent 3:00 AM reset message to ${chatter.senderName} (${chatter.replyJid}) — Last active ${chatter.hoursSinceLastMessage}h ago.`);
          } else {
            console.log(`[WhatsAppCircadian] ℹ️ WhatsApp socket not connected or no JID for ${chatter.senderName}. Recorded notification without live dispatch.`);
          }

          // Reset active working session in RAM
          whatsappBossAiEngine.resetBossSession(chatter.replyJid);

          // Mark notified in Firestore
          await notifDocRef.set({
            cycleId,
            contactKey: chatter.key,
            recipientName: chatter.senderName,
            recipientJid: chatter.replyJid,
            isBoss: chatter.isBoss,
            hoursSinceLastMessage: chatter.hoursSinceLastMessage,
            notifiedAt: Date.now(),
            notifiedAtIST: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          });

          notifiedRecipients.push(chatter.replyJid || chatter.key);

          // Natural human pause between dispatches (1.5s)
          await new Promise((r) => setTimeout(r, 1500));
        } catch (dispatchErr: any) {
          console.warn(`[WhatsAppCircadian] Error notifying chatter ${chatter.key}:`, dispatchErr?.message || dispatchErr);
        }
      }

      // Also reset any remaining in-memory sessions for non-boss contacts only (Boss session is persistent)
      whatsappBossAiEngine.resetNonBossSessions();
      whatsappContactsHumanEngine.resetSessions();
      whatsappUnknownAssistantEngine.resetSessions();

      // 4. Mark cycle run as completed in Firestore
      this.lastCompletedCycle = cycleId;
      await db.collection("memory").doc("circadianResetLog").collection("whatsapp_runs").doc(cycleId).set({
        cycleId,
        completedAt: nowMs,
        completedAtStr: new Date(nowMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        eligibleCount: eligible.length,
        notifiedCount: notifiedRecipients.length,
        skippedInactiveCount: skippedInactive.length,
        recipients: notifiedRecipients,
      });

      console.log(`[WhatsAppCircadian] ✅ Nightly 03:00 AM reset complete. Notified: ${notifiedRecipients.length}, Excluded Inactive (> 24h): ${skippedInactive.length}`);

      return {
        success: true,
        cycleId,
        timestamp: nowMs,
        eligibleCount: eligible.length,
        notifiedCount: notifiedRecipients.length,
        skippedInactiveCount: skippedInactive.length,
        recipients: notifiedRecipients,
        skippedDetails: skippedInactive,
      };
    } catch (err: any) {
      console.error("[WhatsAppCircadian] Failed to execute nightly reset:", err);
      return {
        success: false,
        cycleId,
        timestamp: nowMs,
        eligibleCount: 0,
        notifiedCount: 0,
        skippedInactiveCount: 0,
        recipients: [],
        skippedDetails: [],
        error: err?.message || String(err),
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Periodic check that executes automatically around 03:00 AM IST (between 03:00 and 03:15).
   */
  public async checkAndTriggerCircadianReset(): Promise<boolean> {
    const now = new Date();
    const { hours, minutes } = this.getISTTime(now);
    const currentCycle = this.getCircadianCycleId(now);

    // If cycle flipped from previous cycle
    const isNewCycle = currentCycle !== this.activeCycleId;
    if (isNewCycle) {
      this.activeCycleId = currentCycle;
    }

    // Trigger window: between 03:00 AM and 03:15 AM IST
    const isThreeAmWindow = hours === 3 && minutes <= 15;

    if ((isNewCycle || isThreeAmWindow) && this.lastCompletedCycle !== currentCycle) {
      console.log(`[WhatsAppCircadian] ⏰ 03:00 AM IST window detected (IST Hour: ${hours}:${String(minutes).padStart(2, "0")}). Running reset routine...`);
      const res = await this.executeNightlyResetRoutine();
      return res.success;
    }

    return false;
  }

  /**
   * Retrieves the age in days of Boss's current active conversation session.
   */
  public async getBossSessionAgeDays(): Promise<number> {
    try {
      const snap = await db.collection("memory").doc("bossSessionTracker").get();
      if (snap.exists && snap.data()?.sessionStartedAt) {
        const startedAt = Number(snap.data()!.sessionStartedAt);
        const diffMs = Math.max(0, Date.now() - startedAt);
        const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        return days;
      }
    } catch (err: any) {
      console.warn("[WhatsAppCircadian] Error reading bossSessionTracker:", err?.message || err);
    }
    return 1;
  }

  /**
   * Automatically executes every Sunday at 2 distinct times:
   * Slot 1 (Morning/Noon): 11:00 AM - 11:20 AM IST
   * Slot 2 (Evening): 07:30 PM - 07:50 PM IST (19:30 - 19:50)
   * Nudges Boss gently on WhatsApp about session age and offering to start a fresh new session.
   */
  public async checkAndTriggerSundayNudge(): Promise<boolean> {
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const dayOfWeek = istNow.getDay(); // 0 is Sunday
    if (dayOfWeek !== 0) return false;

    const hours = istNow.getHours();
    const minutes = istNow.getMinutes();
    const yyyy = istNow.getFullYear();
    const mm = String(istNow.getMonth() + 1).padStart(2, "0");
    const dd = String(istNow.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    let slotKey: "morning_noon" | "evening" | null = null;
    if (hours === 11 && minutes <= 20) {
      slotKey = "morning_noon";
    } else if (hours === 19 && minutes >= 30 && minutes <= 50) {
      slotKey = "evening";
    }

    if (!slotKey) return false;

    const slotDocId = `sunday_${dateStr}_${slotKey}`;
    try {
      const existingDoc = await db.collection("memory").doc("circadianResetLog").collection("sunday_nudges").doc(slotDocId).get();
      if (existingDoc.exists) {
        return false; // Already sent for this slot today
      }
    } catch {}

    const res = await this.forceSendSundayNudge(slotKey, dateStr);
    return res.success;
  }

  /**
   * Dispatches the Sunday session nudge message to Boss.
   */
  public async forceSendSundayNudge(
    slot: "morning_noon" | "evening" = "morning_noon",
    dateStr?: string
  ): Promise<{ success: boolean; message: string; daysOld: number; sentText: string }> {
    const ownerPhone = (
      process.env.OWNER_WHATSAPP_NUMBER ||
      process.env.BOSS_WHATSAPP_NUMBER ||
      process.env.OWNER_PHONE ||
      ""
    ).replace(/\D/g, "");

    if (!ownerPhone) {
      return { success: false, message: "No OWNER_WHATSAPP_NUMBER configured", daysOld: 0, sentText: "" };
    }

    const daysOld = await this.getBossSessionAgeDays();
    const daysText = daysOld <= 0 ? "aaj hi start hua" : (daysOld === 1 ? "1 din" : `${daysOld} din`);

    let nudgeText = "";
    if (slot === "morning_noon") {
      nudgeText = `Boss, Sunday check-in! 🌤️\n\nHamara ongoing conversation session abhi lagbhag *${daysText} purana* ho gaya hai. 🗓️\n\nAap chahein to fresh energy aur high speed ke liye new session start kar sakte hain — bas type ya bol dijiye: *"new session"* ya *"naya session"*.\n(Aapka Personal Vault aur permanent yaadein 100% safe rahengi). Have a wonderful Sunday! ⚡`;
    } else {
      nudgeText = `Boss, Sunday evening reminder! 🌆\n\nHamara conversation session *${daysText} purana* chal raha hai. Naye week ke liye agar aap fresh start chahein, to bas bol ya likh dijiye: *"new session"*.\nBaaki continue rakhna ho to koi dikkat nahi, sab safely context me hai. Have a great evening! ✨`;
    }

    const targetJid = `${ownerPhone}@s.whatsapp.net`;
    const isConnected = whatsappBotService.getStatus().isConnected;

    if (isConnected) {
      await whatsappBotService.sendHumanLikeMessage(targetJid, nudgeText);
      console.log(`[WhatsAppCircadian] 💌 Sent Sunday session age nudge (${slot}, ${daysText} old) to Boss.`);
    }

    const now = Date.now();
    const effectiveDateStr = dateStr || new Date(now).toISOString().split("T")[0];
    const slotDocId = `sunday_${effectiveDateStr}_${slot}`;

    try {
      await db.collection("memory").doc("circadianResetLog").collection("sunday_nudges").doc(slotDocId).set({
        slotKey: slot,
        dateStr: effectiveDateStr,
        daysOld,
        sentAt: now,
        sentAtIST: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        sentText: nudgeText,
      });
    } catch {}

    return {
      success: true,
      message: `Sunday nudge dispatched to Boss (${daysText} old)`,
      daysOld,
      sentText: nudgeText,
    };
  }

  /**
   * Returns current service status, active cycle, and diagnostic telemetry.
   */
  public async getStatus(): Promise<{
    activeCycleId: string;
    lastCompletedCycle: string;
    istTime: string;
    bossSessionDaysOld: number;
    eligibleChattersCount: number;
    skippedInactiveCount: number;
    eligibleChatters: Array<{ name: string; hoursSince: number; isBoss: boolean }>;
    skippedInactive: Array<{ id: string; hoursSince: number }>;
  }> {
    const now = new Date();
    const { timeStr } = this.getISTTime(now);
    const { eligible, skippedInactive } = await this.getEligibleChatters();
    const bossSessionDaysOld = await this.getBossSessionAgeDays();

    return {
      activeCycleId: this.getCircadianCycleId(now),
      lastCompletedCycle: this.lastCompletedCycle,
      istTime: timeStr,
      bossSessionDaysOld,
      eligibleChattersCount: eligible.length,
      skippedInactiveCount: skippedInactive.length,
      eligibleChatters: eligible.map((e) => ({
        name: e.senderName,
        hoursSince: e.hoursSinceLastMessage,
        isBoss: e.isBoss,
      })),
      skippedInactive: skippedInactive.map((s) => ({
        id: s.id,
        hoursSince: s.hoursSince,
      })),
    };
  }
}

export const whatsappCircadianSessionService = new WhatsAppCircadianSessionService();
