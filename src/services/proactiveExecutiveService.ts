/**
 * proactiveExecutiveService.ts
 *
 * Industrial Proactive Autonomous Executive Engine:
 * 1. ⚡ Unanswered Messages Sentinel (Detects important unreplied messages & drafts replies)
 * 2. 📅 Commitment & Event Auto-Detector (Extracts promises, times & dates from casual chat)
 * 3. ☀️ Chief-of-Staff Morning Briefing Generator (Aggregates daily schedule, top unread, and tasks)
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";

export interface UnrepliedMessageAlert {
  senderName: string;
  senderPhone?: string;
  chatId?: number | string;
  channel: "whatsapp" | "telegram";
  messageText: string;
  elapsedHours: number;
  timeStr: string;
  suggestedDraftReply: string;
}

export interface DetectedCommitment {
  id: string;
  title: string;
  detectedDateTimeStr: string;
  timestampTarget?: number;
  confidence: number;
  extractedFromText: string;
  sender: string;
}

class ProactiveExecutiveService {
  /**
   * Scans recent WhatsApp and Telegram message logs for high-priority messages that Boss hasn't replied to.
   */
  public async checkPendingUnansweredMessages(thresholdHours = 3): Promise<{
    count: number;
    alerts: UnrepliedMessageAlert[];
    formattedSummary: string;
  }> {
    const alerts: UnrepliedMessageAlert[] = [];
    const now = Date.now();
    const cutoffTs = now - thresholdHours * 60 * 60 * 1000;
    const maxLookback = now - 48 * 60 * 60 * 1000;

    try {
      // 1. Scan WhatsApp Inbox
      const waSnap = await db.collection("whatsapp_inbox")
        .where("timestamp", ">=", maxLookback)
        .where("timestamp", "<=", cutoffTs)
        .where("isGroup", "==", false)
        .orderBy("timestamp", "desc")
        .limit(30)
        .get();

      if (!waSnap.empty) {
        for (const doc of waSnap.docs) {
          const data = doc.data();
          const sName = String(data.senderName || "");
          const isBoss = sName.includes("Boss") || sName.includes("DK") || data.senderPhone === "me";
          if (!isBoss && !data.botReply && data.text && data.text.length > 5) {
            const elapsed = Math.round((now - data.timestamp) / (1000 * 60 * 60));
            const draft = await this.generateQuickSuggestedDraft(sName, data.text);
            alerts.push({
              senderName: sName,
              senderPhone: data.senderPhone,
              channel: "whatsapp",
              messageText: data.text,
              elapsedHours: elapsed,
              timeStr: data.dateStr || `${elapsed}h ago`,
              suggestedDraftReply: draft,
            });
          }
        }
      }

      // 2. Scan Telegram Logs
      const tgSnap = await db.collection("telegramMessageLogs")
        .where("timestamp", ">=", maxLookback)
        .where("timestamp", "<=", cutoffTs)
        .where("isGroup", "==", false)
        .orderBy("timestamp", "desc")
        .limit(30)
        .get();

      if (!tgSnap.empty) {
        for (const doc of tgSnap.docs) {
          const data = doc.data();
          const sName = String(data.senderName || "");
          const isBoss = sName.includes("Boss") || sName.includes("DK");
          if (!isBoss && !data.botReply && data.text && data.text.length > 5) {
            const elapsed = Math.round((now - (data.timestamp || now)) / (1000 * 60 * 60));
            const draft = await this.generateQuickSuggestedDraft(sName, data.text);
            alerts.push({
              senderName: sName,
              chatId: data.chatId,
              channel: "telegram",
              messageText: data.text,
              elapsedHours: elapsed,
              timeStr: data.timeStr || `${elapsed}h ago`,
              suggestedDraftReply: draft,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[ProactiveExecutive] Unanswered message scan warning:", e);
    }

    if (alerts.length === 0) {
      return {
        count: 0,
        alerts: [],
        formattedSummary: "✅ *Sab Up-to-Date Hai:* Pichle 48 ghante me koi high-priority unanswered message pending nahi hai!",
      };
    }

    let summary = `📬 *Unanswered Messages Sentinel (${alerts.length} pending):*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    alerts.slice(0, 5).forEach((a, i) => {
      const channelEmoji = a.channel === "whatsapp" ? "💬 [WhatsApp]" : "✈️ [Telegram]";
      summary += `${i + 1}. *${a.senderName}* (${channelEmoji} - _${a.elapsedHours}h pehle_)\n   • *Message:* _"${a.messageText.slice(0, 100)}"_\n   💡 *Suggested Reply:* _"${a.suggestedDraftReply}"_\n\n`;
    });
    summary += `_Aap bol sakte hain: \`[Naam] ko wo suggested reply bhej do\`!_`;

    return {
      count: alerts.length,
      alerts,
      formattedSummary: summary.trim(),
    };
  }

  private async generateQuickSuggestedDraft(senderName: string, messageText: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: `You are Friday AI, executive assistant to Boss DK.
Draft a polite, natural, concise 1-sentence WhatsApp reply on Boss's behalf to ${senderName} who sent:
"${messageText}"
Respond with ONLY the suggested 1-sentence reply in natural Hinglish or English.`,
        });
        const reply = res.text?.trim();
        if (reply) return reply.replace(/^["']|["']$/g, "");
      } catch {}
    }

    const isQuestion = messageText.includes("?") || /kahan|kab|kaise|kyun|batao|aana|milte/i.test(messageText);
    if (isQuestion) {
      return `Haanji ${senderName}! Main abhi dekh kar confirm karta hoon thodi der me.`;
    }
    return `Noted ${senderName}! Thanks, main jaldi hi connect karta hoon.`;
  }

  /**
   * Scans text for commitments, promises, and future events.
   */
  public async detectCommitmentsAndEvents(messageText: string, senderName = "Boss"): Promise<DetectedCommitment | null> {
    const clean = (messageText || "").trim();
    if (clean.length < 8) return null;

    const timeKeywords = /(?:aaj|kal|parso|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sham|subah|raat|baje|pm|am|\d{1,2}:\d{2})/i;
    const actionKeywords = /(?:milte|jaana|jana|call|meeting|exam|assignment|party|train|flight|doctor|gym|payment)/i;

    if (!timeKeywords.test(clean) || !actionKeywords.test(clean)) {
      return null;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analyze this message and detect if there is an explicit promise, commitment, or scheduled event:
Message: "${clean}"

If an event is present, return JSON:
{
  "hasEvent": true,
  "title": "Short title, e.g. Meeting with Rahul",
  "detectedDateTimeStr": "Date and time extracted, e.g. Tomorrow 5:00 PM",
  "confidence": 0.95
}
Otherwise return {"hasEvent": false}`;

      const res = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      if (res.text) {
        const parsed = JSON.parse(res.text);
        if (parsed.hasEvent && parsed.title) {
          return {
            id: "commit_" + Date.now(),
            title: parsed.title,
            detectedDateTimeStr: parsed.detectedDateTimeStr || "Soon",
            confidence: parsed.confidence || 0.9,
            extractedFromText: clean,
            sender: senderName,
          };
        }
      }
    } catch {}

    return null;
  }

  /**
   * Generates a dynamic AI Chief-of-Staff Morning Briefing synthesized with Gemini.
   */
  public async generateChiefOfStaffMorningBriefing(): Promise<string> {
    const todayStr = new Date().toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const pendingCheck = await this.checkPendingUnansweredMessages(3);
    const { unifiedMemoryService } = await import("./unifiedMemoryService");
    const facts = await unifiedMemoryService.listAllFacts();
    const topFacts = facts.slice(0, 5).map((f) => `- [${f.category}] ${f.fact}`).join("\n");

    const apiKey = process.env.GEMINI_API_KEY;
    let dynamicBody = `👑 *Boss Divakar Kumar (DK), Good Morning!*\nAapka personal AI intelligence suite 100% active aur synced hai.`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are Friday, Boss DK's (Divakar Kumar) personal Chief of Staff AI companion.
Generate an empowering, sharp, energetic morning executive briefing for today (${todayStr}).
Context:
- Boss's Key Memories & Goals:
${topFacts || "Focus on personal growth and high leverage tech projects."}
- Pending Unreplied Messages: ${pendingCheck.count} pending messages.

Format with crisp emoji bullet points, action items, and a powerful punchy daily motivation line for Boss.`;

        const res = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        if (res.text) dynamicBody = res.text.trim();
      } catch (err: any) {
        console.warn("[ProactiveExecutive] Morning briefing AI synthesis warning:", err?.message || err);
      }
    }

    return `☀️ *FRIDAY CHIEF-OF-STAFF MORNING BRIEFING* ⚡\n📅 *${todayStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${dynamicBody}\n\n${pendingCheck.count > 0 ? `${pendingCheck.formattedSummary}\n\n` : ""}`;
  }

  // ── 4. 24/7 AUTOMATED BACKGROUND CRON DAEMON (RENDER READY) ───────────────
  private cronIntervalTimer: any = null;
  private lastBriefingDateStr: string = "";
  private lastUnansweredAlertTs: number = 0;

  public startBackgroundExecutiveCronDaemon(): void {
    if (this.cronIntervalTimer) return;

    console.log("[ProactiveExecutive] ⏰ Initializing 24/7 Automated Executive Cron Daemon...");

    // Tick every 60 seconds
    this.cronIntervalTimer = setInterval(async () => {
      try {
        await this.cronTick();
      } catch (err: any) {
        console.warn("[ProactiveExecutive] Cron tick warning:", err?.message || err);
      }
    }, 60 * 1000);

    // Initial warm-up tick after 15 seconds
    setTimeout(() => {
      this.cronTick().catch(() => {});
    }, 15000);
  }

  private async cronTick(): Promise<void> {
    const now = new Date();
    // Use IST timezone (Asia/Kolkata)
    const istTimeStr = now.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
    const istDateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
    const hour = parseInt(istTimeStr.split(":")[0], 10);
    const minute = parseInt(istTimeStr.split(":")[1], 10);

    // 1. Morning Briefing Push: 8:00 AM to 8:15 AM IST
    if (hour === 8 && minute <= 15 && this.lastBriefingDateStr !== istDateStr) {
      this.lastBriefingDateStr = istDateStr;
      console.log(`[ProactiveExecutive] ☀️ Triggering automated morning briefing for ${istDateStr}...`);
      const briefingText = await this.generateChiefOfStaffMorningBriefing();

      // Broadcast to WhatsApp and Telegram
      await this.broadcastToBoss(briefingText);
    }

    // 2. Hourly Unanswered Messages Sentinel (Between 9 AM and 10 PM IST)
    const nowTs = Date.now();
    if (hour >= 9 && hour <= 22 && nowTs - this.lastUnansweredAlertTs > 60 * 60 * 1000) {
      const res = await this.checkPendingUnansweredMessages(3);
      if (res.count > 0) {
        this.lastUnansweredAlertTs = nowTs;
        console.log(`[ProactiveExecutive] 📬 Unanswered messages detected (${res.count} pending). Sending sentinel alert...`);
        await this.broadcastToBoss(`⚠️ *Unanswered Messages Reminder:*\n\n${res.formattedSummary}`);
      }
    }
  }

  private async broadcastToBoss(text: string): Promise<void> {
    try {
      // 1. Send via Telegram Memory Bot / Telegram Bot
      const { telegramMemoryBotService } = await import("./telegramMemoryBotService");
      const { telegramBotService } = await import("./telegramBotService");
      const bossTgChatId =
        process.env.TELEGRAM_OWNER_CHAT_ID ||
        process.env.TELEGRAM_BOSS_CHAT_ID ||
        process.env.BOSS_TELEGRAM_CHAT_ID ||
        process.env.TELEGRAM_OWNER_ID ||
        process.env.TELEGRAM_CHAT_ID;

      if (bossTgChatId) {
        if (telegramMemoryBotService.isBotActive()) {
          await telegramMemoryBotService.safeSendMessage(bossTgChatId, text, { parse_mode: "Markdown" });
        } else {
          await telegramBotService.sendMessage(bossTgChatId, text);
        }
      }

      // 2. Send via WhatsApp to Boss
      const { whatsappBotService } = await import("./whatsappBotService");
      const bossWaPhone = process.env.BOSS_WHATSAPP_PHONE || process.env.WHATSAPP_OWNER_NUMBER || "me";
      if (bossWaPhone && bossWaPhone !== "me") {
        await whatsappBotService.sendMessage(bossWaPhone, text);
      }
    } catch (err: any) {
      console.warn("[ProactiveExecutive] Broadcast warning:", err?.message || err);
    }
  }
}

export const proactiveExecutiveService = new ProactiveExecutiveService();

