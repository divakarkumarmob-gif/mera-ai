/**
 * whatsappFeatureEngine.ts
 *
 * Advanced AI Feature Suite for WhatsApp (1v1 Personal Chats & Groups):
 * 1. 📊 Group & 1v1 Catch-Up Digest / Summary (@summary, @catchup, @digest)
 * 2. 🌐 Multi-Language Translator (@translate)
 * 3. 🌐 Web & Live URL Scraper / Reader (@web, @read)
 * 4. ⏰ Scheduled WhatsApp Message Sender (@schedule, @send_later)
 * 5. 🗳️ Group AI Poll & Voting Engine (@poll)
 * 6. ❓ Group Trivia & Quiz Master (@quiz)
 * 7. 💻 Live Code Explainer & Debugger (@code, @debug)
 * 8. 🛡️ Anti-Spam & Phishing Link Guard (@safety)
 * 9. 🎵 Music & Lyrics Finder (@music)
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { contactsService } from "./contactsService";

export interface ScheduledMessageDoc {
  id: string;
  recipientPhone: string;
  recipientName: string;
  messageText: string;
  scheduledForTs: number;
  scheduledForStr: string;
  status: "pending" | "sent" | "failed";
  createdAt: number;
}

const scheduledCol = () => db.collection("whatsapp_scheduled_messages");

class WhatsAppFeatureEngine {
  private static readonly MODEL_CHAIN = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
  ];

  private async callGeminiWithFallback(prompt: string, timeoutMs = 9000): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });

    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
      ]);

    for (const model of WhatsAppFeatureEngine.MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          timeoutMs
        );
        const text = response.text?.trim();
        if (text) return text;
      } catch (err: any) {
        console.warn(`[FeatureEngine] Model ${model} failed (${err?.message || err}), trying next...`);
      }
    }
    return null;
  }

  // ── 1. 📊 Group & 1v1 Catch-Up Digest / Summary (@summary, @digest) ──────

  public async generateGroupSummary(
    groupName: string,
    messages: Array<{ senderName: string; text: string; dateStr: string }>
  ): Promise<string> {
    if (!messages || messages.length === 0) {
      return `Group "${groupName}" me pichle kuch der me koi naya message nahi mila.`;
    }

    const messageLog = messages
      .slice(-35)
      .map((m) => `[${m.dateStr}] ${m.senderName}: ${m.text}`)
      .join("\n");

    const prompt = `You are Friday, an ultra-smart executive AI assistant.
Summarize the recent WhatsApp group conversation in group "${groupName}".

CONVERSATION LOG (Oldest to Newest):
${messageLog}

OUTPUT RULES:
- Language: Natural Hinglish (crisp, professional, friendly).
- Format:
  📊 *Group Catch-up Summary: ${groupName}* (Pichle ${messages.length} msgs)
  • 📌 *Main Discussion Topics:* (2-3 concise bullets)
  • 💡 *Key Decisions / Outcomes:* (1-2 bullets)
  • ❓ *Pending / Unanswered Questions:* (if any)
  • ⚡ *Action Items:* (who needs to do what)
- Keep it under 180 words, high value, easy to read.`;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `📊 *Summary for ${groupName}:*\n• Total messages: ${messages.length}\n• Activity summary abhi generate nahi ho payi, kripya dobara try karein.`;
  }

  public async generatePersonalDigest(
    messages: Array<{ senderName: string; senderPhone: string; text: string; dateStr: string; isGroup: boolean }>
  ): Promise<string> {
    const personalMsgs = messages.filter((m) => !m.isGroup && m.senderPhone !== "me").slice(0, 40);
    if (personalMsgs.length === 0) {
      return "Boss, pichle 24 ghante me koi unread ya naya personal message nahi aaya hai! Sab clear hai. 👍";
    }

    const log = personalMsgs
      .map((m) => `From ${m.senderName} (+${m.senderPhone}) [${m.dateStr}]: ${m.text}`)
      .join("\n");

    const prompt = `You are Friday, DK Boss's personal AI executive companion.
Boss was away and asked "kiska kiska msg aaya tha?" (Who messaged me while away?).

INCOMING MESSAGES LOG:
${log}

OUTPUT RULES:
- Address Boss with respect & warmth ("Boss", "DK Boss").
- Group by sender name.
- Highlight urgent/important requests first (e.g. money, assignments, meetings, callbacks).
- Format cleanly with bullet points and emojis.
- Language: Natural witty Hinglish.`;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `📩 *Messages Digest for Boss:*\n${personalMsgs.map((m, i) => `${i + 1}. *${m.senderName}:* _"${m.text.slice(0, 80)}"_`).join("\n")}`;
  }

  // ── 2. 🌐 Multi-Language Translator (@translate) ─────────────────────────

  public async translateText(text: string, targetLanguage = "english"): Promise<string> {
    const prompt = `Translate the following text accurately into ${targetLanguage}.
Keep the original emotional tone, slangs, context, and formatting intact.

TEXT TO TRANSLATE:
"""${text}"""

OUTPUT:
Return ONLY the translated text, followed by 1 line mentioning [🌐 Translated to ${targetLanguage}].`;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `🌐 *Translation (${targetLanguage}):*\n${text}`;
  }

  // ── 3. 🌐 Web & Live URL Scraper / Reader (@web, @read) ──────────────────

  public async summarizeWebUrl(url: string, userQuery = ""): Promise<string> {
    try {
      const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
      const response = await fetch(cleanUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return `⚠️ URL open nahi ho paya (Status: ${response.status}). Kripya link verify karein.`;
      }

      const html = await response.text();
      // Simple text extract: strip tags and scripts
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);

      const prompt = `You are Friday AI. Summarize the content of this webpage for Boss/User.
URL: ${cleanUrl}
${userQuery ? `User Question: "${userQuery}"` : ""}

WEBPAGE CONTENT:
${cleanText}

OUTPUT RULES:
- Give a crisp 3-4 bullet executive summary.
- Highlight key takeaways, prices, dates, or answers.
- Format with clean WhatsApp bold/italics.`;

      const res = await this.callGeminiWithFallback(prompt);
      return (
        res ||
        `🌐 *Web Page Digest:*\n🔗 Link: ${cleanUrl}\n\n• Page successfully fetched (${cleanText.length} chars).`
      );
    } catch (e: any) {
      return `⚠️ Web page scrape karne me error: ${e?.message || e}`;
    }
  }

  // ── 4. ⏰ Scheduled WhatsApp Message Sender (@schedule, @send_later) ─────

  public async scheduleMessage(
    contactNameOrPhone: string,
    messageText: string,
    timeInstruction: string
  ): Promise<{ success: boolean; message: string }> {
    let phone = contactNameOrPhone.replace(/\D/g, "");
    let contactName = contactNameOrPhone;

    try {
      const contact = await contactsService.findContact(contactNameOrPhone);
      if (contact && contact.id !== "temp" && contact.phone) {
        phone = contact.phone.replace(/\D/g, "");
        contactName = contact.name;
      }
    } catch {}

    if (!phone || phone.length < 10) {
      return { success: false, message: `Could not resolve valid phone number for "${contactNameOrPhone}".` };
    }
    if (phone.length === 10) phone = `91${phone}`;

    // Parse time offset / target time (e.g. "10 mins", "2 hours", "subah 9 baje")
    const now = Date.now();
    let scheduledTs = now + 10 * 60 * 1000; // default 10 mins

    const minMatch = timeInstruction.match(/(\d+)\s*(?:min|minute|m)/i);
    const hourMatch = timeInstruction.match(/(\d+)\s*(?:hour|hr|ghante|h)/i);
    const secMatch = timeInstruction.match(/(\d+)\s*(?:sec|second|s)/i);

    if (minMatch) {
      scheduledTs = now + parseInt(minMatch[1]) * 60 * 1000;
    } else if (hourMatch) {
      scheduledTs = now + parseInt(hourMatch[1]) * 60 * 60 * 1000;
    } else if (secMatch) {
      scheduledTs = now + parseInt(secMatch[1]) * 1000;
    } else {
      scheduledTs = now + 15 * 60 * 1000; // 15 mins default
    }

    const scheduledDateStr = new Date(scheduledTs).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    });

    const docId = `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const schedDoc: ScheduledMessageDoc = {
      id: docId,
      recipientPhone: phone,
      recipientName: contactName,
      messageText,
      scheduledForTs: scheduledTs,
      scheduledForStr: scheduledDateStr,
      status: "pending",
      createdAt: now,
    };

    await scheduledCol().doc(docId).set(schedDoc);

    return {
      success: true,
      message: `⏰ *WhatsApp Message Scheduled!* ✅\n\n👤 *Recipient:* ${contactName} (+${phone})\n📅 *Delivery Time:* ${scheduledDateStr} (IST)\n💬 *Message:* _"${messageText}"_\n\n_Main theek time par delivery execute kar dungi Boss!_`,
    };
  }

  public async processPendingScheduledMessages(
    sendFn: (toPhone: string, text: string) => Promise<any>
  ): Promise<number> {
    try {
      const now = Date.now();
      const snap = await scheduledCol()
        .where("status", "==", "pending")
        .where("scheduledForTs", "<=", now)
        .limit(10)
        .get();

      if (snap.empty) return 0;

      let count = 0;
      for (const doc of snap.docs) {
        const item = doc.data() as ScheduledMessageDoc;
        try {
          console.log(`[FeatureEngine] Delivering scheduled message to ${item.recipientName} (+${item.recipientPhone})...`);
          await sendFn(item.recipientPhone, item.messageText);
          await doc.ref.update({ status: "sent", sentAt: Date.now() });
          count++;
        } catch (err) {
          console.error(`[FeatureEngine] Failed to deliver scheduled msg ${item.id}:`, err);
          await doc.ref.update({ status: "failed", error: String(err) });
        }
      }
      return count;
    } catch (e) {
      console.warn("[FeatureEngine] Error in processPendingScheduledMessages:", e);
      return 0;
    }
  }

  // ── 5. 🗳️ Group AI Poll & Voting Engine (@poll) ───────────────────────────

  public async generatePoll(query: string): Promise<string> {
    const prompt = `You are Friday AI. A WhatsApp group user wants to create an engaging, interactive poll.
Query/Topic: "${query}"

RULES:
- Extract the question and 2 to 4 distinct options.
- If options are not provided, generate 3 smart, funny/relevant options.
- Format strictly as a WhatsApp Poll card with voting instruction:
  🗳️ *AI GROUP POLL:* [Question]
  
  1️⃣ [Option 1]
  2️⃣ [Option 2]
  3️⃣ [Option 3]
  4️⃣ [Option 4] (if applicable)
  
  👉 *Vote karne ke liye reply me option number (1, 2, 3) type karein!*`;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `🗳️ *Group Poll:* "${query}"\n1️⃣ Option A\n2️⃣ Option B\n👉 Reply 1 or 2 to vote!`;
  }

  // ── 6. ❓ Group Trivia & Quiz Master (@quiz) ──────────────────────────────

  public async generateQuiz(topic = "tech & general knowledge"): Promise<string> {
    const prompt = `You are Friday, the entertaining Trivia Master in a WhatsApp group.
Generate 1 fascinating, high-engagement multiple-choice trivia question on topic: "${topic}".

FORMAT:
🎯 *FRIDAY TRIVIA CHALLENGE:* [Topic]

❓ *Question:* [Intriguing question]

A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]

💡 *Rule:* Reply with your answer (A, B, C, or D). Answer reveal in 60 seconds! ⚡`;

    const res = await this.callGeminiWithFallback(prompt);
    return (
      res ||
      `🎯 *FRIDAY TRIVIA:* Tech Quiz!\n❓ *Question:* What is the default port for HTTP?\nA) 443\nB) 80\nC) 8080\nD) 22\n\n👉 Reply A, B, C, or D!`
    );
  }

  // ── 7. 💻 Live Code Explainer & Debugger (@code, @debug) ───────────────────

  public async analyzeCode(codeSnippet: string, userQuery = ""): Promise<string> {
    const prompt = `You are Friday, an expert Staff Software Engineer.
Explain, debug, or optimize the following code snippet.
${userQuery ? `User Question: "${userQuery}"` : ""}

CODE:
\`\`\`
${codeSnippet}
\`\`\`

OUTPUT FORMAT:
💻 *Code Analysis & Solution:*
• 🐛 *Bug / Issue:* (1 line)
• 💡 *Explanation:* (2 lines)
• ✅ *Fixed / Optimized Code:*
\`\`\`
[corrected code]
\`\`\``;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `💻 *Code Review:*\nCode snippet received (${codeSnippet.length} chars).`;
  }

  // ── 8. 🛡️ Anti-Spam & Phishing Link Guard ─────────────────────────────────

  public checkLinkSafety(text: string): { isSuspicious: boolean; reason?: string } {
    const lower = text.toLowerCase();

    // Phishing keywords & suspicious URL patterns
    const suspiciousPatterns = [
      /t\.me\/(joinchat|\+[A-Za-z0-9_-]+)/i, // spam telegram invites
      /(free\s*recharge|free\s*iphone|earn\s*5000\s*daily|crypto\s*double|binance-bonus)/i,
      /(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd)\/[A-Za-z0-9_-]+/i, // generic shorteners with spam context
      /(18\+|porn|betting|winzo\s*hack|rummy\s*bonus)/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(lower)) {
        return {
          isSuspicious: true,
          reason: "Suspicious promotional spam or unverified shortened link detected.",
        };
      }
    }

    return { isSuspicious: false };
  }

  // ── 9. 🎵 Music & Lyrics Finder (@music) ──────────────────────────────────

  public async searchMusicWithLyrics(query: string): Promise<string> {
    try {
      const { publicApisService } = await import("./publicApisService");
      const musicRes = await publicApisService.searchMusic(query);

      if (musicRes.success && musicRes.spotifyUrl) {
        return `🎵 *${musicRes.title}* by *${musicRes.artist}*\n\n▶️ *Spotify Link:* ${musicRes.spotifyUrl}\n\n✨ _"Music makes every moment special!"_`;
      }

      const prompt = `Provide the track title, artist name, and iconic 4-line lyrics snippet for the song query: "${query}".
Format with WhatsApp bold and music emojis.`;
      const res = await this.callGeminiWithFallback(prompt);
      return res || `🎵 *Music Finder:* Searched for "${query}".`;
    } catch (e: any) {
      return `🎵 *Music Finder:* Error searching track: ${e?.message || e}`;
    }
  }
}

export const whatsappFeatureEngine = new WhatsAppFeatureEngine();
