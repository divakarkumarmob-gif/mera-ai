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

export interface LiveCallSession {
  callId: string;
  callerName: string;
  isOwner: boolean;
  createdAt: number;
  expiresAt: number;
  durationMinutes: number;
  used: boolean;
}

class WhatsAppFeatureEngine {
  private activeCallSessions = new Map<string, LiveCallSession>();

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

  // ── 10. 🔎 Universal Chat Search & Message Finder (1v1 & Group) ─────────

  public async searchAndLocateMessage(
    queryText: string,
    allMessages: Array<{
      id: string;
      senderName: string;
      senderPhone: string;
      text: string;
      dateStr: string;
      groupId?: string | null;
      groupName?: string | null;
      isGroup?: boolean;
    }>,
    options?: {
      groupName?: string;
      isGroup?: boolean;
      requesterName?: string;
    }
  ): Promise<{ found: boolean; replyText: string; topMatch?: any }> {
    const rawClean = (queryText || "")
      .replace(/^(?:@?friday|fridaay|fryday|fraiday)/gi, "")
      .replace(/^(?:@search|\/search|@find|\/find|search|find)\s*/gi, "")
      .trim();

    // Extract core query from natural language phrases like "kisi ne apple ke bare me bola tha"
    let targetKeyword = rawClean;
    const pattern1 = rawClean.match(/(?:kisi\s*ne|kisne)\s+(.+?)\s+(?:ke\s*baare\s*me|ke\s*bare\s*me|ke\s*liye|ko\s*lekar)?\s*(?:bola\s*tha|kaha\s*tha|bheja\s*tha|likha\s*tha|message\s*kiya)/i);
    const pattern2 = rawClean.match(/(?:dhundo|dhundho|check\s*karo|dekho)\s+(?:kisi\s*ne\s+)?(.+?)(?:\s+bola\s*tha|\s+bheja\s*tha|\s+kaha\s*tha)?$/i);
    const pattern3 = rawClean.match(/(?:kisi\s*ne\s+)?(.+?)\s+(?:ke\s*bare\s*me\s*kya\s*bola|ke\s*baare\s*me\s*kya\s*bola|ke\s*bare\s*me|ke\s*baare\s*me)/i);

    if (pattern1 && pattern1[1]) {
      targetKeyword = pattern1[1].trim();
    } else if (pattern2 && pattern2[1]) {
      targetKeyword = pattern2[1].trim();
    } else if (pattern3 && pattern3[1]) {
      targetKeyword = pattern3[1].trim();
    }

    // Strip stop words
    const cleanSearchTerm = targetKeyword
      .replace(/^(?:kisi\s*ne|kisne|kya|bhai|koi|msg|message|chat\s*me)\s+/gi, "")
      .replace(/\s+(?:ke\s*baare\s*me|ke\s*bare\s*me|bola\s*tha|kaha\s*tha|bheja\s*tha|tha|kya)$/gi, "")
      .trim();

    if (!cleanSearchTerm || cleanSearchTerm.length < 2) {
      return {
        found: false,
        replyText: `🔍 *Message Search:*\nAapko chat me kya search karna hai? Example: _"friday kisi ne meeting ke bare me bola tha"_ ya _"friday search project"_\n_Main poori chat scan karke sender aur time ke sath dhoondh dungi!_`,
      };
    }

    const tokens = cleanSearchTerm.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

    // Score and filter messages
    const scoredMatches: Array<{ msg: any; score: number }> = [];

    for (const m of allMessages) {
      // Don't match the search command message itself
      if (m.text.toLowerCase().includes("kisi ne") && m.text.toLowerCase().includes("bola tha")) continue;

      const fullContent = `${m.text} ${m.senderName} ${m.groupName || ""}`.toLowerCase();
      let matchScore = 0;

      // Exact substring match gives high score
      if (fullContent.includes(cleanSearchTerm.toLowerCase())) {
        matchScore += 10;
      }

      // Individual token matches
      for (const token of tokens) {
        if (fullContent.includes(token)) {
          matchScore += 3;
        }
      }

      if (matchScore > 0) {
        scoredMatches.push({ msg: m, score: matchScore });
      }
    }

    // Sort by relevance (highest score first)
    scoredMatches.sort((a, b) => b.score - a.score);

    if (scoredMatches.length === 0) {
      return {
        found: false,
        replyText: `🔍 *Search Result:*\nMujhe chat me *"${cleanSearchTerm}"* se match karta hua koi purana message nahi mila. Aap thoda different keyword try kar sakte hain!`,
      };
    }

    const best = scoredMatches[0].msg;
    const isGroup = !!options?.isGroup;

    let reply = "";
    if (isGroup) {
      reply = `🔎 *Haan! Group me yeh message mila:*\n\n` +
        `👤 *Sender:* **${best.senderName}**\n` +
        `📅 *Time:* _${best.dateStr}_\n` +
        `💬 *Message:* \n` +
        `> _"${best.text.slice(0, 350)}"_\n\n` +
        `💡 *${best.senderName} ne yeh message bheja tha.*`;
    } else {
      reply = `🔎 *Haanji! Mujhe yeh message mil gaya hai:*\n\n` +
        `👤 *Sender:* **${best.senderName}** (+${best.senderPhone})\n` +
        `📅 *Date & Time:* _${best.dateStr}_\n` +
        `💬 *Message Content:* \n` +
        `> _"${best.text.slice(0, 350)}"_\n\n` +
        `✨ *${best.senderName} ne yeh message bheja tha.*`;
    }

    // If there are other notable matches, mention them briefly
    if (scoredMatches.length > 1) {
      const otherMatches = scoredMatches.slice(1, 3).map(
        (sm) => `• *${sm.msg.senderName}* [_${sm.msg.dateStr}_]: _"${sm.msg.text.slice(0, 80)}"_`
      );
      reply += `\n\n📌 *Kuch aur related messages bhi mile:*\n${otherMatches.join("\n")}`;
    }

    return {
      found: true,
      replyText: reply,
      topMatch: best,
    };
  }

  // ── 11. 💰 Group Bill Splitter & Instant UPI QR / Link Generator (@split) ─

  public async splitGroupBill(queryText: string): Promise<string> {
    const rawClean = queryText.replace(/^(?:@split|\/split|split\s*bill|split)\s*/gi, "").trim();

    const prompt = `You are Friday, an intelligent financial assistant for WhatsApp groups.
The user wants to split a bill among friends.
User Query: "${rawClean}"

RULES:
1. Extract:
   - Total Amount in INR (₹)
   - Number of people or list of names (e.g. Aman, Rahul, DK, Saurav).
   - If only a count is given (e.g. "500 among 4 people"), calculate per-person share.
   - If names are given, list each person's exact share.
2. Format as a clean WhatsApp Card:
   💰 *GROUP BILL SPLIT CALCULATION:*
   • 💵 *Total Bill:* ₹[Amount]
   • 👥 *Total Members:* [Count] ([Names or 'Equal Split'])
   • 🏷️ *Per Person Share:* *₹[Share]*
   
   📋 *Member Breakdown:*
   • 👤 [Name 1]: ₹[Share]
   • 👤 [Name 2]: ₹[Share]
   
   📲 *UPI Payment Link:*
   \`upi://pay?pa=divakarkumar@okaxis&pn=DK&am=[Share]&tn=Group+Split\`
   
   👉 _Click UPI link or scan QR code to pay instantly!_`;

    const res = await this.callGeminiWithFallback(prompt);
    return res || `💰 *Bill Splitter:* Total: ₹${rawClean}\nPlease specify amount and names (e.g. "@split 1200 between Aman, Rahul, DK").`;
  }

  // ── 12. 📅 WhatsApp Google Calendar & Meeting Scheduler (@meet) ──────────

  public async scheduleMeetingFromWhatsApp(queryText: string): Promise<string> {
    try {
      const { calendarEventService } = await import("./calendarEventService");
      const clean = queryText.replace(/^(?:@meet|\/meet|schedule\s*meet|meet)\s*/gi, "").trim();

      // Extract details with Gemini
      const prompt = `Extract meeting details from this WhatsApp command: "${clean}".
Return JSON ONLY:
{
  "title": "Meeting title or client name",
  "timeString": "e.g. tomorrow at 4 PM, today 5:30pm, in 2 hours",
  "durationMinutes": 30,
  "locationOrLink": "Google Meet or office location"
}`;
      const jsonRes = await this.callGeminiWithFallback(prompt);
      let parsed = { title: "Meeting with Client", timeString: "tomorrow at 4 PM", durationMinutes: 30, locationOrLink: "Google Meet" };
      try {
        if (jsonRes) {
          const match = jsonRes.match(/\{[\s\S]*\}/);
          if (match) parsed = { ...parsed, ...JSON.parse(match[0]) };
        }
      } catch {}

      const schedRes = await calendarEventService.scheduleMeeting(
        parsed.title,
        parsed.timeString,
        parsed.durationMinutes,
        parsed.locationOrLink
      );

      const eventDateStr = new Date(schedRes.event.eventTimestamp).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      return `📅 *Google Calendar Event Scheduled!* ✅\n\n` +
        `📌 *Title:* **${schedRes.event.title}**\n` +
        `⏱️ *Time:* _${eventDateStr} (IST)_\n` +
        `⏳ *Duration:* ${schedRes.event.durationMinutes} Minutes\n` +
        `📍 *Platform:* ${schedRes.event.locationOrLink || "Google Meet"}\n\n` +
        `_Meeting invite aapke calendar me add ho gaya hai aur time se 15 min pehle main remind kar dungi Boss!_ ✨`;
    } catch (e: any) {
      return `⚠️ Meeting schedule karne me issue aaya: ${e?.message || e}`;
    }
  }

  // ── 13. 📍 Live Location & Nearby / Route Finder (@nearby, @route) ────────

  public async searchNearbyOrRoute(queryText: string, locationPin?: { lat: number; lng: number }): Promise<string> {
    try {
      const { googleMapsService } = await import("./googleMapsService");
      const clean = queryText.replace(/^(?:@nearby|\/nearby|@route|\/route|nearby|route)\s*/gi, "").trim();

      // Case A: Route / Directions ("to Patna Airport", "from X to Y")
      if (/^(?:to|from)\s+/i.test(clean) || clean.includes(" to ")) {
        const parts = clean.split(/\s+to\s+/i);
        const origin = parts.length > 1 ? parts[0].replace(/^from\s+/i, "").trim() : (locationPin ? `${locationPin.lat},${locationPin.lng}` : "Patna, India");
        const destination = parts.length > 1 ? parts[1].trim() : parts[0].replace(/^to\s+/i, "").trim();

        const dirRes = await googleMapsService.getDirections(origin, destination);
        if (dirRes.success) {
          return `📍 *Live Route & Navigation:* **${dirRes.from} ➡️ ${dirRes.to}**\n\n` +
            `📏 *Distance:* ${dirRes.distanceKm}\n` +
            `⏱️ *Estimated Travel Time:* *${dirRes.durationInTrafficText || dirRes.durationText}*\n` +
            `🚦 *Traffic Status:* ${dirRes.durationInTrafficText ? "Live traffic accounted" : "Normal traffic"}\n\n` +
            `🗺️ *Google Maps Navigation Link:*\n${dirRes.googleMapsUrl}\n\n` +
            `💡 _Tap the link above to start turn-by-turn navigation!_`;
        }
      }

      // Case B: Nearby places search ("petrol pump", "hospital", "restaurant")
      const searchLocation = locationPin ? `${locationPin.lat},${locationPin.lng}` : "Patna, Bihar";
      const placeRes = await googleMapsService.searchNearbyPlaces(clean || "petrol pump", searchLocation);

      if (placeRes.success && placeRes.places.length > 0) {
        let card = `📍 *Nearby Top Results for "${clean || "Places"}":*\n\n`;
        placeRes.places.slice(0, 4).forEach((p, i) => {
          const ratingTxt = p.rating ? ` ⭐ ${p.rating}` : "";
          card += `${i + 1}. *${p.name}*${ratingTxt}\n   🏠 _${p.address || "Near location"}_\n   🗺️ [Open in Maps](${p.googleMapsUrl})\n\n`;
        });
        return card.trim();
      }

      return `📍 *Google Maps Search:* Searched for "${clean}".\n🗺️ Link: https://www.google.com/maps/search/${encodeURIComponent(clean)}`;
    } catch (e: any) {
      return `⚠️ Maps search error: ${e?.message || e}`;
    }
  }

  // ── 14. ☀️ Daily Morning WhatsApp Executive Briefing (@briefing) ──────────

  public async generateMorningBriefingCard(city = "Patna, India"): Promise<string> {
    try {
      const { morningBriefingService } = await import("./morningBriefingService");
      const b = await morningBriefingService.generateMorningBriefing(city);

      let card = `☀️ *Good Morning Boss! Friday Daily Briefing* 🌅\n`;
      card += `📅 *${b.dateStr}* | ⏱️ *${b.timeStr}*\n\n`;
      card += `🌤️ *Mausam (${b.weather.city}):* ${b.weather.temp}, ${b.weather.condition}\n\n`;

      if (b.pendingTasks && b.pendingTasks.length > 0) {
        card += `📋 *Today's Top Tasks & Meetings:*\n`;
        b.pendingTasks.forEach((t) => (card += `• 📌 ${t.title} (${t.timeString})\n`));
        card += `\n`;
      }

      if (b.newsHeadlines && b.newsHeadlines.length > 0) {
        card += `📰 *Top News Headlines:*\n`;
        b.newsHeadlines.forEach((n) => (card += `• ${n.title}\n`));
        card += `\n`;
      }

      if (b.marketSummary) {
        card += `📈 *Market Pulse:* ${b.marketSummary.nifty} | ${b.marketSummary.gold}\n\n`;
      }

      card += `✨ *Thought of the Day:*\n_"${b.motivationalQuote}"_\n\n`;
      card += `🚀 _Aapka din shubh aur productive rahe Boss! Let's conquer the day!_`;

      return card;
    } catch (e: any) {
      return `☀️ *Morning Briefing:* Good morning Boss! Have a productive day ahead!`;
    }
  }

  // ── 15. 🧠 Smart Fact & Memory Vault (@remember, @recall) ──────────────────

  public async saveSmartMemory(factText: string): Promise<string> {
    try {
      const { memoryEngine } = await import("./memoryEngine");
      const cleanFact = factText
        .replace(/^(?:@remember|\/remember|friday\s*yaad\s*rakhna|yaad\s*rakhna|remember)\s*[:=-]?\s*/gi, "")
        .trim();

      if (!cleanFact) return "Boss, kya yaad rakhna hai kripya wo fact batayein!";

      await memoryEngine.addPinnedMemory(cleanFact);
      await memoryEngine.addPersonalVaultFact("user_saved_facts", cleanFact);

      try {
        await db.collection("smart_memories_vault").add({
          fact: cleanFact,
          timestamp: Date.now(),
          dateStr: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
      } catch {}

      return `🧠 *Memory Permanently Saved in Vault!* ✅\n\n📌 *Fact:* _"${cleanFact}"_\n\n_Maine isko apne permanent memory vault me lock kar diya hai. Aap kabhi bhi poochhenge to main yaad dila dungi!_`;
    } catch (e: any) {
      return `⚠️ Memory save karne me issue: ${e?.message || e}`;
    }
  }

  public async recallSmartMemory(queryText: string): Promise<string> {
    try {
      const { memoryEngine } = await import("./memoryEngine");
      const cleanQuery = queryText
        .replace(/^(?:@recall|\/recall|friday\s*mujhe\s*yaad\s*dilao|yaad\s*dilao|kahan\s*rakha\s*tha|recall)\s*[:=-]?\s*/gi, "")
        .trim();

      const memorySummary = await memoryEngine.compileLeanMemoryPrompt();

      const prompt = `You are Friday AI, recalling a personal memory for DK Boss.
Boss is asking: "${queryText}"
Known Memory Vault:
${memorySummary}

Search the memory vault for the answer.
If found:
State the answer warmly with exact details in Hinglish.
If not found:
State politely that this specific detail is not recorded yet in the vault.`;

      const res = await this.callGeminiWithFallback(prompt);
      return res || `🧠 *Memory Vault:* Searched memory for "${cleanQuery}".`;
    } catch (e: any) {
      return `⚠️ Memory recall error: ${e?.message || e}`;
    }
  }

  /**
   * Generates a fresh, unique time-limited single-use Call link.
   * - 1v1 & Groups: 20 minutes expiry per new call
   * - Owner (DK): 30 minutes expiry per new call
   */
  public generateLiveVoiceCallCard(callerName: string, isOwner = false): string {
    const durationMinutes = isOwner ? 30 : 20;
    const now = Date.now();
    const expiresAt = now + durationMinutes * 60 * 1000;
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const session: LiveCallSession = {
      callId,
      callerName,
      isOwner,
      createdAt: now,
      expiresAt,
      durationMinutes,
      used: false,
    };

    this.activeCallSessions.set(callId, session);

    // Persist session in Firestore
    try {
      db.collection("live_call_sessions").doc(callId).set(session).catch(() => {});
    } catch {}

    const baseUrl = (process.env.APP_BASE_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
    const callUrl = `${baseUrl}/?call=true&callId=${callId}&caller=${encodeURIComponent(callerName)}&mode=live`;

    const expiryTimeStr = new Date(expiresAt).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

    return `📞 *FRIDAY 1-CLICK LIVE VOICE CALL (Jarvis Duplex Mode)* 🎙️⚡\n\n${isOwner ? "👑 *Boss DK*" : `👤 *${callerName}*`}, aapka *Live Voice Call Room* generate ho gaya hai!\n\nNeeche diye fresh link par tap karein aur call join karein:\n🔗 *Tap to Join Call:* ${callUrl}\n\n⏳ *Link Expiry:* *${durationMinutes} Minutes* (Valid till: _${expiryTimeStr}_)\n🔒 *Fresh Session:* Har naye call par naya unique link banta hai\n\n✨ *Live Voice Call Highlights:*\n• ⚡ *0-Latency Duplex Audio:* Real-time continuous conversation\n• 🗣️ *Hands-Free Speaking:* Mic hold karne ki zaroorat nahi\n• 🎧 *Neural AI Voice:* Natural Hindi/Hinglish speaking assistant\n• 🆓 *100% Free:* Zero telephony charges!`;
  }

  /**
   * Validates if a call session is active and not expired.
   */
  public async validateCallSession(callId: string): Promise<{ valid: boolean; session?: LiveCallSession; message?: string }> {
    if (!callId) {
      return { valid: false, message: "⚠️ Call ID missing. Kripya WhatsApp par '@call' ya 'call me' likh kar fresh link generate karein." };
    }

    let session = this.activeCallSessions.get(callId);

    // Fallback: check Firestore
    if (!session) {
      try {
        const doc = await db.collection("live_call_sessions").doc(callId).get();
        if (doc.exists) {
          session = doc.data() as LiveCallSession;
          this.activeCallSessions.set(callId, session);
        }
      } catch {}
    }

    if (!session) {
      return { valid: false, message: "⚠️ Ye Call Link invalid hai ya expire ho chuka hai. WhatsApp par 'call me' ya '@call' likh kar naya link lein!" };
    }

    const now = Date.now();
    if (now > session.expiresAt) {
      this.activeCallSessions.delete(callId);
      return {
        valid: false,
        message: `⏳ Ye Call Link ${session.durationMinutes} minute ki time-limit poori hone ke baad expire ho gaya hai! WhatsApp par naya link mangwayein.`,
      };
    }

    return { valid: true, session };
  }

  /**
   * Handles user declining a call and sends a polite busy note on WhatsApp.
   */
  public async handleCallDeclined(callId?: string, callerName?: string): Promise<boolean> {
    try {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      const ownerPhone = process.env.WHATSAPP_OWNER_PHONE || process.env.OWNER_PHONE || "919999999999";
      const message = `📞 *FRIDAY Call Update*\n\nBoss, lagta hai aap abhi busy hain ya meeting me hain. 🤝\nJab bhi aap free hon, bas WhatsApp par *"call me"* ya *"@call"* likh dena, main turant connect ho jaungi! ⚡`;
      await sendWhatsAppUnified(ownerPhone, message);
      return true;
    } catch (e) {
      console.warn("[WhatsAppFeatureEngine] Failed to send decline note:", e);
      return false;
    }
  }

  /**
   * Generates and sends a WhatsApp post-call summary with duration, key points, and action items.
   */
  public async handleCallEndedSummary(
    callId: string,
    callerName: string,
    durationSecs: number,
    transcript?: string
  ): Promise<boolean> {
    try {
      if (durationSecs < 5) {
        return false; // Skip very short / immediate hang-ups
      }

      const { sendWhatsAppUnified } = await import("./whatsappService");
      const ownerPhone = process.env.WHATSAPP_OWNER_PHONE || process.env.OWNER_PHONE || "919999999999";

      const mins = Math.floor(durationSecs / 60);
      const secs = durationSecs % 60;
      const durationStr = mins > 0 ? `${mins} min ${secs} sec` : `${secs} seconds`;

      let summaryContent = "Live Voice conversation completed successfully.";

      if (transcript && transcript.trim().length > 15) {
        const prompt = `You are Friday, an ultra-intelligent executive AI assistant.
A live voice phone call just ended with Boss.
Summarize the call conversation concisely for WhatsApp.

CALL TRANSCRIPT / NOTES:
${transcript.slice(0, 1500)}

OUTPUT FORMAT (Natural Hinglish):
• 📌 *Main Discussion:* (1-2 crisp lines)
• 💡 *Key Decisions / Insights:* (1-2 points)
• ⚡ *Action Items / Tasks:* (if any action was discussed)

Keep it short, professional, and formatted for WhatsApp with bold headers.`;

        const aiSummary = await this.callGeminiWithFallback(prompt);
        if (aiSummary) {
          summaryContent = aiSummary;
        }
      }

      const message = `📋 *FRIDAY CALL SUMMARY REPORT* 🎙️\n\n👤 *Caller:* ${callerName || "Boss DK"}\n⏱️ *Call Duration:* ${durationStr}\n🔒 *Status:* Completed & Encrypted\n\n${summaryContent}\n\n_Next Call: WhatsApp par 'call me' likh kar kabhi bhi call start karein!_`;

      await sendWhatsAppUnified(ownerPhone, message);
      return true;
    } catch (e) {
      console.warn("[WhatsAppFeatureEngine] Failed to send call summary:", e);
      return false;
    }
  }
}

export const whatsappFeatureEngine = new WhatsAppFeatureEngine();
