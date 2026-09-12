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

import crypto from "crypto";
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
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
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
      // Query single field 'status' only so Firestore never requires a composite index
      const snap = await scheduledCol()
        .where("status", "==", "pending")
        .limit(25)
        .get();

      if (snap.empty) return 0;

      let count = 0;
      for (const doc of snap.docs) {
        const item = doc.data() as ScheduledMessageDoc;
        // Check if scheduled time has arrived in memory
        if (item.scheduledForTs && item.scheduledForTs > now) {
          continue; // Not yet time to deliver
        }
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

  // ── 9. 🎵 Music & Song Finder (@song / @music) ───────────────────────────

  private chatLastSongMap: Map<string, { title: string; artist: string; ytUrl: string; spotifyUrl: string; timestamp: number; album?: string; year?: string; genre?: string; lyrics?: string }> = new Map();
  private chatPlaylistMap: Map<string, { playlist: Array<{ title: string; artist: string; year: string; ytUrl: string; previewAudioUrl?: string }>; currentIndex: number; categoryName: string; timestamp: number }> = new Map();
  private chatSongSearchSessionMap: Map<
    string,
    {
      originalQuery: string;
      seenSongs: Array<{ title: string; artist: string; ytUrl: string }>;
      attemptCount: number;
      timestamp: number;
    }
  > = new Map();

  public recordLastSong(
    chatId: string,
    song: {
      title: string;
      artist: string;
      ytUrl: string;
      spotifyUrl?: string;
      album?: string;
      year?: string;
      genre?: string;
      lyrics?: string;
    }
  ) {
    if (!chatId) return;
    this.chatLastSongMap.set(chatId, { ...song, spotifyUrl: song.spotifyUrl || "", timestamp: Date.now() });
  }

  public getLastSong(chatId: string) {
    if (!chatId) return null;
    return this.chatLastSongMap.get(chatId) || null;
  }

  public decryptJioSaavnMediaUrl(encryptedUrl: string): string | null {
    if (!encryptedUrl) return null;
    try {
      const key = Buffer.from("38346591", "utf8");
      const decipher = crypto.createDecipheriv("des-ecb", key, "");
      decipher.setAutoPadding(true);
      let decrypted = decipher.update(encryptedUrl, "base64", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted.replace(/_96\.(mp4|m4a|aac|mp3)/, "_320.$1").replace(/_96\./, "_320.");
    } catch (e) {
      return null;
    }
  }

  public async fetchJioSaavnFullSongAudio(searchTarget: string): Promise<{
    audioBuffer: Buffer | null;
    mediaUrl: string | null;
    songTitle?: string;
    artist?: string;
  }> {
    try {
      const searchRes = await fetch(
        `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=5&p=1&q=${encodeURIComponent(searchTarget)}&_marker=0&ctx=android&api_version=4`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(6000),
        }
      );

      if (searchRes.ok) {
        const text = await searchRes.text();
        const startIdx = text.indexOf("{");
        const endIdx = text.lastIndexOf("}");
        if (startIdx !== -1 && endIdx !== -1) {
          const cleanJsonStr = text.substring(startIdx, endIdx + 1);
          const data = JSON.parse(cleanJsonStr);
          const results = data.results || (Array.isArray(data) ? data : []);
          const first = results[0];

          if (first) {
            const encUrl = first.more_info?.encrypted_media_url || first.encrypted_media_url;
            if (encUrl) {
              const directUrl = this.decryptJioSaavnMediaUrl(encUrl);
              if (directUrl) {
                const audioRes = await fetch(directUrl, {
                  headers: { "User-Agent": "Mozilla/5.0" },
                  signal: AbortSignal.timeout(15000),
                });
                if (audioRes.ok) {
                  const ab = await audioRes.arrayBuffer();
                  if (ab.byteLength > 100000) { // at least 100KB full song
                    return {
                      audioBuffer: Buffer.from(ab),
                      mediaUrl: directUrl,
                      songTitle: first.title || first.song,
                      artist: first.more_info?.primary_artists || first.primary_artists,
                    };
                  }
                }
              }
            }
          }
        }
      }
    } catch (jioErr) {
      console.warn("[WhatsAppFeatureEngine] JioSaavn full audio fetch error:", jioErr);
    }
    return { audioBuffer: null, mediaUrl: null };
  }

  public isFullSongRequest(text: string, quotedText?: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return (
      clean === "full song" ||
      clean === "full gaana" ||
      clean === "full gana" ||
      clean === "full track" ||
      clean === "full music" ||
      clean === "pura song" ||
      clean === "pura gaana" ||
      clean === "pura gana" ||
      clean === "pura track" ||
      clean === "pura music" ||
      clean === "@fullsong" ||
      clean === "/fullsong" ||
      clean === "full audio" ||
      clean === "pura audio" ||
      clean === "jiosaavn song" ||
      clean === "jio seven song" ||
      clean === "jio saavn song" ||
      /^(?:full\s*(?:song|gaana|gana|track|audio|music)|pura\s*(?:song|gaana|gana|track|audio|music))\b/i.test(clean) ||
      /\b(?:full\s*song\s*(?:bhejo|do|chalao|send|download)|pura\s*gaana\s*(?:bhejo|do|chalao|send|download)|jio\s*saavn\s*se\s*gaana|jio\s*seven\s*se\s*gaana|full\s*song)\b/i.test(clean)
    );
  }

  public async handleFullSongRequest(
    chatId: string,
    rawText: string,
    requesterName = "Boss"
  ): Promise<{
    handled: boolean;
    replyText: string;
    audioBuffer?: Buffer | null;
    trackTitle?: string;
  }> {
    const lastSong = this.getLastSong(chatId);
    let targetTitle = lastSong?.title || "";
    let targetArtist = lastSong?.artist || "";
    let ytUrl = lastSong?.ytUrl || "";

    // If query has specific song name e.g. "full song Kesariya"
    const specificClean = rawText
      .replace(/^(?:full\s*(?:song|gaana|gana|track|audio|music)|pura\s*(?:song|gaana|gana|track|audio|music)|@fullsong|\/fullsong)\s*/i, "")
      .trim();

    if (specificClean && specificClean.length > 2) {
      targetTitle = specificClean;
    }

    if (!targetTitle) {
      return {
        handled: true,
        replyText: `⚠️ Boss, pehle koi gaana search ya preview kijiye, phir "full song" likhiye! 👍`,
      };
    }

    const searchTarget = `${targetTitle} ${targetArtist}`.trim();
    if (!ytUrl) {
      ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;
    }

    // Try fetching full song from JioSaavn
    const jioResult = await this.fetchJioSaavnFullSongAudio(searchTarget);

    if (jioResult.audioBuffer && jioResult.audioBuffer.length > 0) {
      const successCard = `🎵 *FRIDAY FULL SONG PLAYER* 🎧✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${targetTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Pura gaana JioSaavn se download karke bhej diya gaya hai! Enjoy ${requesterName}!_ 🔊🔥`;

      return {
        handled: true,
        replyText: successCard,
        audioBuffer: jioResult.audioBuffer,
        trackTitle: targetTitle,
      };
    }

    // If JioSaavn full audio is not available or download failed:
    const fallbackCard = `🔴 *YOUTUBE FULL SONG* 🎬🎧
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${targetTitle}

▶️ *Watch on YouTube:*
${ytUrl}
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ _Sorry ${requesterName}, full audio track download nahi mil paya. Aap direct YouTube par suniye!_ 👍`;

    return {
      handled: true,
      replyText: fallbackCard,
      audioBuffer: null,
      trackTitle: targetTitle,
    };
  }

  public isWrongSongFeedback(text: string, quotedText?: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    const quoted = (quotedText || "").toLowerCase();
    const isQuotingSong =
      quoted.includes("song radar") ||
      quoted.includes("audio preview") ||
      quoted.includes("music:") ||
      quoted.includes("hook lyrics") ||
      quoted.includes("singer:");

    const isExplicitSongRejection =
      /^(?:ye\s+(?:gaana|gana|song)\s+(?:galat|nahi|nhi)|galat\s*(?:gaana|gana|song)|wrong\s*song|ye\s*gaana\s*nahi\s*hai|dusra\s*(?:gaana|gana|song)\s*(?:dhundo|bhejo|play|sunao))$/i.test(clean);

    if (isExplicitSongRejection) return true;

    if (isQuotingSong) {
      return /^(?:ye\s*(?:bhi\s*)?(?:nahi|nhi|galat)|wrong|ye\s*wala\s*(?:nahi|nhi)|dusra\s*(?:dhundo|bhejo|sunao)?|not\s*this)$/i.test(clean);
    }

    return false;
  }

  public async handleWrongSongAlternative(
    chatId: string,
    requesterName = "Boss"
  ): Promise<{
    handled: boolean;
    replyText?: string;
    audioBuffer?: Buffer | null;
    trackTitle?: string;
  }> {
    const session = this.chatSongSearchSessionMap.get(chatId);
    const lastSong = this.getLastSong(chatId);
    const query = session?.originalQuery || lastSong?.title || "Bollywood song";
    const seenList = session?.seenSongs || (lastSong ? [{ title: lastSong.title, artist: lastSong.artist, ytUrl: lastSong.ytUrl }] : []);
    const attempt = (session?.attemptCount || 1) + 1;

    let trackTitle = `${query} (Alternative)`;
    let artistName = "Alternative Artist";
    let albumName = "";
    let releaseYear = "";
    let genre = "Music";
    let lyricsSnippet = "";

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const rejectedStr = seenList.map((s, i) => `${i + 1}. "${s.title}" by ${s.artist}`).join("\n");

        const prompt = `You are an elite music DJ & song identification engine for Friday AI.
User originally searched for song: "${query}".
User stated that the following previously suggested track(s) were INCORRECT / NOT the one they were searching for:
${rejectedStr}

Identify a DIFFERENT, alternative canonical song or version that matches user query "${query}".
For example:
- Original vintage version vs modern remake/cover vs remix
- Different movie/album track with the same title or hook line
- Different iconic artist's version
- Another high-confidence semantic song match

Respond ONLY with valid JSON in this exact structure:
{
  "trackTitle": "Different Exact Song Name",
  "artists": "Singer(s), Music Composer",
  "albumOrMovie": "Movie / Album Name",
  "year": "YYYY",
  "genre": "Genre",
  "lyricsSnippet": "Famous 2-line hook lyrics..."
}`;

        const aiRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(aiRes.text?.trim() || "{}");
        if (json.trackTitle) trackTitle = json.trackTitle;
        if (json.artists) artistName = json.artists;
        if (json.albumOrMovie) albumName = json.albumOrMovie;
        if (json.year) releaseYear = json.year;
        if (json.genre) genre = json.genre;
        if (json.lyricsSnippet) lyricsSnippet = json.lyricsSnippet;
      } catch (aiErr) {
        console.warn("[WhatsAppFeatureEngine] Alternative song AI error:", aiErr);
      }
    }

    const searchTarget = `${trackTitle} ${artistName}`.trim();
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(searchTarget)}`;

    // Update seen list and session
    seenList.push({ title: trackTitle, artist: artistName, ytUrl: ytSearchUrl });
    this.chatSongSearchSessionMap.set(chatId, {
      originalQuery: query,
      seenSongs: seenList,
      attemptCount: attempt,
      timestamp: Date.now(),
    });

    this.recordLastSong(chatId, {
      title: trackTitle,
      artist: artistName,
      ytUrl: ytSearchUrl,
      spotifyUrl,
      album: albumName,
      year: releaseYear,
      genre,
      lyrics: lyricsSnippet,
    });

    // Fetch 30-sec official audio preview from iTunes
    let audioBuffer: Buffer | null = null;
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(searchTarget)}&media=music&entity=song&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (itunesRes.ok) {
        const itunesData: any = await itunesRes.json();
        const previewUrl = itunesData.results?.[0]?.previewUrl;
        if (previewUrl) {
          const audioFetch = await fetch(previewUrl, { signal: AbortSignal.timeout(8000) });
          if (audioFetch.ok) {
            audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
          }
        }
      }
    } catch (itErr) {
      console.warn("[WhatsAppFeatureEngine] Alternative song iTunes preview warning:", itErr);
    }

    const card = `🎧 *FRIDAY AUDIO PREVIEW (ALTERNATE MATCH #${attempt})* 🔊✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${trackTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
👉 _Agar ye bhi nahi hai to bolen: "ye bhi nahi"_
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Volume UP ${requesterName}! Enjoy the preview!_ 🔊🔥`;

    return {
      handled: true,
      replyText: card,
      audioBuffer,
      trackTitle,
    };
  }

  public isSongLinkFollowUp(text: string, quotedText?: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    const quoted = (quotedText || "").toLowerCase();

    if (
      clean === "link" ||
      clean === "@link" ||
      clean === "/link" ||
      clean === "link do" ||
      clean === "link de" ||
      clean === "link bhejo" ||
      clean === "youtube link" ||
      clean === "yt link" ||
      clean === "video link" ||
      clean === "full song link" ||
      clean === "pura gaana link" ||
      clean === "pura gana"
    ) {
      return true;
    }

    const isLinkIntent =
      /^(?:(?:is\s*ka|iska|us\s*ka|uska|iss\s*ka|isska|gaane\s*ka|song\s*ka)?\s*(?:bhi\s*)?(?:youtube\s*)?(?:link|video|url)\s*(?:do|de|bhejo|share|chahiye|send|dedo|bhej|de\s*na|plz|batao)?|(?:youtube|yt)\s*link|full\s*(?:song|gaana)|pura\s*(?:song|gaana)|link\s*(?:do|de|bhejo|share)|link|(\d+)(?:st|nd|rd|th)?\s*(?:ka|number)?\s*link)\b/i.test(clean) ||
      /\b(?:iska\s*link|link\s*bhejo|link\s*do|youtube\s*link|full\s*song\s*link|pura\s*gaana\s*link|\d+\s*(?:ka|wala)\s*link)\b/i.test(clean);

    const isReferencingSong =
      quoted.includes("song radar") ||
      quoted.includes("audio preview") ||
      quoted.includes("recommendations") ||
      quoted.includes("music:") ||
      quoted.includes("track:") ||
      quoted.includes("singer");

    return isLinkIntent && (isReferencingSong || clean.includes("link") || clean.includes("youtube") || clean === "link");
  }

  public isSongDetailsQuery(text: string, quotedText?: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    const quoted = (quotedText || "").toLowerCase();
    const isQuotingSong =
      quoted.includes("song radar") ||
      quoted.includes("audio preview") ||
      quoted.includes("music:") ||
      quoted.includes("hook lyrics") ||
      quoted.includes("singer:");

    const isExplicitSongDetailsIntent =
      /\b(?:gaane\s*ke\s*(?:bol|lyrics|details)|song\s*details|gaane\s*ki\s*details|kisne\s*gaya|singer\s*kaun\s*hai|kis\s*(?:film|movie)\s*ka\s*(?:gaana|song)|lyrics\s*(?:batao|bhejo|dikhao)|full\s*lyrics)\b/i.test(clean);

    if (isExplicitSongDetailsIntent) return true;

    if (isQuotingSong) {
      return /^(?:singer|artist|kisne\s*gaya|movie\s*name|album|year|genre|lyrics|bol|details?)$/i.test(clean);
    }

    return false;
  }

  public handleSongDetailsQuery(chatId: string, text: string, quotedText?: string): string | null {
    const cached = this.getLastSong(chatId);
    if (!cached || Date.now() - cached.timestamp > 3600000) return null;

    const detailsLines: string[] = [
      `🎶 *Music:* ${cached.title}`,
      cached.artist ? `🎙️ *Singer(s):* ${cached.artist}` : "",
      cached.album ? `🎬 *Movie / Album:* ${cached.album}` : "",
      cached.year ? `📅 *Year:* ${cached.year}` : "",
      cached.genre ? `🏷️ *Genre:* ${cached.genre}` : "",
    ].filter(Boolean);

    const lyricsBlock = cached.lyrics ? `\n\n📝 *Hook Lyrics:*\n_"${cached.lyrics}"_` : "";

    return `📋 *SONG DETAILS* 🎶✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${detailsLines.join("\n")}${lyricsBlock}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n▶️ *YouTube Link:*\n${cached.ytUrl}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎧 _Enjoy! Volume UP!_ 🔊🔥`;
  }

  public isNextSongRequest(text: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return /^(?:agla\s*(?:gaana|song|ganna|preview)|next\s*(?:song|preview|gaana)|dusra\s*(?:gaana|song)|change\s*song|@next|\/next)$/i.test(clean) ||
      /\b(agla\s*gaana|next\s*song|dusra\s*gaana|agla\s*preview|next\s*preview)\b/i.test(clean);
  }

  public async handleNextSongInPlaylist(chatId: string, requesterName = "Boss"): Promise<{
    handled: boolean;
    replyText?: string;
    audioBuffer?: Buffer | null;
    currentSong?: any;
  }> {
    const session = this.chatPlaylistMap.get(chatId);
    if (!session || !session.playlist || session.playlist.length === 0 || Date.now() - session.timestamp > 3600000) {
      return { handled: false };
    }

    session.currentIndex = (session.currentIndex + 1) % session.playlist.length;
    const current = session.playlist[session.currentIndex];
    const songNum = session.currentIndex + 1;
    const total = session.playlist.length;

    // Fetch 30-sec audio preview from iTunes
    let audioBuffer: Buffer | null = null;
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(current.title + " " + current.artist)}&media=music&entity=song&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (itunesRes.ok) {
        const itunesData: any = await itunesRes.json();
        const previewUrl = itunesData.results?.[0]?.previewUrl;
        if (previewUrl) {
          const audioFetch = await fetch(previewUrl, { signal: AbortSignal.timeout(8000) });
          if (audioFetch.ok) {
            audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
          }
        }
      }
    } catch (e) {
      console.warn("[WhatsAppFeatureEngine] Next song audio fetch warning:", e);
    }

    this.recordLastSong(chatId, {
      title: current.title,
      artist: current.artist,
      ytUrl: current.ytUrl,
      spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(current.title + " " + current.artist)}`,
      year: current.year || "",
    });

    const replyText = `🎧 *FRIDAY AUDIO PREVIEW (#${songNum}/${total})* 🔊✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${current.title}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
👉 _Agla preview sunne ke liye type karein "next"_ (${songNum === total ? "1st gaana wapas aayega" : `#${songNum + 1} gaana`})
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Volume UP ${requesterName}!_ 🔊🔥`;

    return {
      handled: true,
      replyText,
      audioBuffer,
      currentSong: current,
    };
  }

  public handleSongLinkFollowUp(chatId: string, text: string, quotedText?: string): string | null {
    let targetTitle = "";
    let targetArtist = "";
    let ytUrl = "";

    const clean = (text || "").toLowerCase();
    const specificNumberMatch = clean.match(/(\d+)(?:st|nd|rd|th)?\s*(?:ka|number|wala)?\s*link/i) || clean.match(/(?:link\s*)?(\d+)/i);

    // 0. If user asked for specific number from playlist (e.g. "3rd ka link", "2nd ka link")
    if (specificNumberMatch && chatId) {
      const session = this.chatPlaylistMap.get(chatId);
      if (session && session.playlist && session.playlist.length > 0) {
        const idx = parseInt(specificNumberMatch[1], 10) - 1;
        if (idx >= 0 && idx < session.playlist.length) {
          const s = session.playlist[idx];
          return `🔴 *YOUTUBE LINK (#${idx + 1}):* 🎬🎧\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎶 *Music:* ${s.title}\n\n▶️ *YouTube Link:*\n${s.ytUrl}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎧 _Pura gaana suniye aur vibe kijiye! Volume UP!_ 🔊🔥`;
        }
      }
    }

    // 1. Try to extract from quoted message
    if (quotedText) {
      const trackMatch = quotedText.match(/Music:\s*\*?([^\n\r*]+)\*?/i) || quotedText.match(/Track:\s*\*?([^\n\r*]+)\*?/i) || quotedText.match(/AUDIO PREVIEW:\s*\*([^*]+)\*/i) || quotedText.match(/PREVIEW\s*#\d+\/\d+:\s*\*([^*]+)\*/i);
      const artistMatch = quotedText.match(/Singer(?:\(s\))?:\s*\*?([^\n\r*]+)\*?/i);
      if (trackMatch && trackMatch[1]) targetTitle = trackMatch[1].trim();
      if (artistMatch && artistMatch[1]) targetArtist = artistMatch[1].trim();
    }

    // 2. Fall back to memory cache
    if (!targetTitle && chatId) {
      const cached = this.getLastSong(chatId);
      if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour memory
        targetTitle = cached.title;
        targetArtist = cached.artist;
        ytUrl = cached.ytUrl;
      }
    }

    if (!targetTitle) return null;

    if (!ytUrl) {
      const searchTarget = `${targetTitle} ${targetArtist}`.trim();
      ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;
    }

    return `🔴 *YOUTUBE LINK* 🎬🎧\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎶 *Music:* ${targetTitle}\n\n▶️ *YouTube Link:*\n${ytUrl}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎧 _Pura gaana suniye aur vibe kijiye! Volume UP!_ 🔊🔥`;
  }

  public isCategorySongQuery(query: string): boolean {
    const clean = (query || "").toLowerCase();
    return (
      /(?:sad|mood\s*off|bhojpuri|hindi|punjabi|romantic|party|lofi|90s?|80s?|70s?|60s?|19\d\d|20\d\d|breakup|motivational|workout|dance|old|purane|latest|trending|viral|top\s*\d+|bollywood|hollywood|sufi|ghazal|bhajan|rap)\s*(?:songs?|gan[ae]|music|tracks?)/i.test(clean) ||
      /(?:songs?|gan[ae]|music)\s*(?:for|ke|ki|wala|wali)?\s*(?:sad|mood|party|dance|gym|study|sleep|drive|car|monsoon|baarish|travel|love|romantic)/i.test(clean) ||
      /(?:top|5|10|best|hit|popular|trending)\s*(?:songs?|gan[ae]|music)/i.test(clean) ||
      /(?:19\d\d|20\d\d)\s*(?:ke|ka|ki)?\s*(?:gan[ae]|songs?)/i.test(clean)
    );
  }

  public async searchMusicWithLyrics(query: string, requesterName = "Boss", chatId?: string): Promise<{
    replyText: string;
    trackTitle: string;
    artistName: string;
    ytUrl: string;
    spotifyUrl: string;
    previewAudioUrl?: string;
    audioBuffer?: Buffer | null;
    isPreviewRequested: boolean;
    isPlaylist?: boolean;
  }> {
    const rawClean = (query || "")
      .replace(/^(?:@song|@music|@gaana|\/song|\/music|\/gaana|song:|music:|gaana:)\s*/i, "")
      .replace(/^(?:friday\s+)?(?:song|gaana|music)\s+(?:dhundo|sunao|chalao|ka\s*link|bhejo|play\s*karo)\s*/i, "")
      .trim();

    if (!rawClean) {
      return {
        replyText: `🎵 *FRIDAY SONG RADAR:* Kripya song ka naam ya mood likhein!\n\n👉 *Examples:* \`@song Kesariya\`, \`@song sad song\`, \`@song bhojpuri song\`, \`@song 1960 ke gane\``,
        trackTitle: "",
        artistName: "",
        ytUrl: "",
        spotifyUrl: "",
        isPreviewRequested: false,
      };
    }

    const lowerQuery = (query || "").toLowerCase();
    const isPreviewReq = /\b(?:preview|audio\s*preview|audio|sample|clip|30s|30\s*sec|30\s*second|audio\s*sunao|preview\s*bhejo|preview\s*play|preview\s*karo)\b/i.test(lowerQuery) || lowerQuery.trim() === "preview";
    let searchClean = rawClean.replace(/\b(?:preview|audio\s*preview|audio|sample|clip|30s|30\s*sec|30\s*second|audio\s*sunao|preview\s*bhejo|preview\s*play|preview\s*karo)\b/gi, "").trim();

    if (!searchClean && isPreviewReq && chatId) {
      const last = this.getLastSong(chatId);
      if (last && last.title) {
        searchClean = `${last.title} ${last.artist || ""}`.trim();
      }
    }

    if (!searchClean) {
      searchClean = rawClean || "trending hit song";
    }

    // ── Check if this is a Category / Mood / Era Song Request (Top 5 Recommendations) ──
    const isCategory = this.isCategorySongQuery(searchClean);

    if (isCategory) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `You are an elite music DJ & Spotify/YouTube curation expert for Friday AI.
User requested: "${searchClean}".

Provide the TOP 5 most iconic, highest-viewed, and beloved hit songs for this exact mood / genre / era / language.
Sort them with the #1 highest-viewed / most iconic song first.

Respond ONLY with valid JSON in this exact structure:
{
  "categoryName": "Descriptive Category (e.g. Sad Bollywood Hits, 1960s Evergreen Classics, High-Energy Bhojpuri Hits)",
  "songs": [
    { "title": "Song 1 Title", "artist": "Singer 1", "year": "YYYY" },
    { "title": "Song 2 Title", "artist": "Singer 2", "year": "YYYY" },
    { "title": "Song 3 Title", "artist": "Singer 3", "year": "YYYY" },
    { "title": "Song 4 Title", "artist": "Singer 4", "year": "YYYY" },
    { "title": "Song 5 Title", "artist": "Singer 5", "year": "YYYY" }
  ]
}`;

          const aiRes = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });

          const json = JSON.parse(aiRes.text?.trim() || "{}");
          const songsList = Array.isArray(json.songs) && json.songs.length > 0 ? json.songs.slice(0, 5) : [];

          if (songsList.length > 0) {
            const compiledPlaylist = songsList.map((s: any) => ({
              title: s.title,
              artist: s.artist,
              year: s.year || "",
              ytUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(s.title + " " + s.artist + " official song")}`,
            }));

            const categoryName = json.categoryName || searchClean;

            if (chatId) {
              this.chatPlaylistMap.set(chatId, {
                playlist: compiledPlaylist,
                currentIndex: 0,
                categoryName,
                timestamp: Date.now(),
              });
              this.recordLastSong(chatId, {
                title: compiledPlaylist[0].title,
                artist: compiledPlaylist[0].artist,
                ytUrl: compiledPlaylist[0].ytUrl,
                spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(compiledPlaylist[0].title + " " + compiledPlaylist[0].artist)}`,
              });
            }

            // Fetch 30-sec audio preview of 1st Song
            let audioBuffer: Buffer | null = null;
            let previewAudioUrl = "";
            try {
              const itunesRes = await fetch(
                `https://itunes.apple.com/search?term=${encodeURIComponent(compiledPlaylist[0].title + " " + compiledPlaylist[0].artist)}&media=music&entity=song&limit=1`,
                { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
              );
              if (itunesRes.ok) {
                const itunesData: any = await itunesRes.json();
                previewAudioUrl = itunesData.results?.[0]?.previewUrl || "";
                if (previewAudioUrl && isPreviewReq) {
                  const audioFetch = await fetch(previewAudioUrl, { signal: AbortSignal.timeout(8000) });
                  if (audioFetch.ok) {
                    audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
                  }
                }
              }
            } catch (itErr) {
              console.warn("[WhatsAppFeatureEngine] Category 1st song audio preview warning:", itErr);
            }

            const playlistLines = compiledPlaylist.map((s: any, idx: number) => {
              const isFirst = idx === 0;
              const previewTag = isFirst && (isPreviewReq || audioBuffer) ? " 🔊 _[PLAYING 30s PREVIEW]_" : "";
              return `${idx + 1}️⃣ *${s.title}*${previewTag}`;
            }).join("\n");

            const card = `🎧 *FRIDAY TOP 5 RECOMMENDATIONS: ${categoryName.toUpperCase()}* 🎵✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
${playlistLines}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
👉 _Agla gaana sunne ke liye type karein "next"_
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Gaana suniye aur vibe kijiye ${requesterName}! Volume UP!_ 🔊🔥`;

            return {
              replyText: card,
              trackTitle: compiledPlaylist[0].title,
              artistName: compiledPlaylist[0].artist,
              ytUrl: compiledPlaylist[0].ytUrl,
              spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(compiledPlaylist[0].title + " " + compiledPlaylist[0].artist)}`,
              previewAudioUrl,
              audioBuffer,
              isPreviewRequested: isPreviewReq || !!audioBuffer,
              isPlaylist: true,
            };
          }
        } catch (catErr) {
          console.warn("[WhatsAppFeatureEngine] Category song generation error:", catErr);
        }
      }
    }

    // ── Single Specific Song Flow ──
    let trackTitle = searchClean;
    let artistName = "Various Artists";
    let albumName = "";
    let releaseYear = "";
    let genre = "Music";
    let lyricsSnippet = "";
    let appleMusicUrl = "";
    let previewAudioUrl = "";

    // Step 1: Query free iTunes API for instantaneous official metadata & Apple Music link & 30s Audio Preview
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(searchClean)}&media=music&entity=song&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (itunesRes.ok) {
        const itunesData: any = await itunesRes.json();
        const first = itunesData.results?.[0];
        if (first) {
          trackTitle = first.trackName || searchClean;
          artistName = first.artistName || "Unknown Artist";
          albumName = first.collectionName || "";
          releaseYear = first.releaseDate ? first.releaseDate.substring(0, 4) : "";
          genre = first.primaryGenreName || "Music";
          appleMusicUrl = first.trackViewUrl || "";
          previewAudioUrl = first.previewUrl || "";
        }
      }
    } catch (itunesErr) {
      console.warn("[WhatsAppFeatureEngine] iTunes search warning:", itunesErr);
    }

    // Step 1B: Fallback to JioSaavn if previewAudioUrl is not found from iTunes
    if (!previewAudioUrl && isPreviewReq) {
      try {
        const { jioSaavnService } = await import("./jioSaavnService");
        const saavnRes = await jioSaavnService.searchSong(searchClean, 1);
        if (saavnRes.songs && saavnRes.songs.length > 0) {
          const s = saavnRes.songs[0];
          previewAudioUrl = s.audio320kbps || s.audio160kbps || s.audio96kbps || "";
          if (s.songName && (!trackTitle || trackTitle === searchClean)) trackTitle = s.songName;
          if (s.artistName && (!artistName || artistName === "Various Artists")) artistName = s.artistName;
        }
      } catch (saavnErr) {
        console.warn("[WhatsAppFeatureEngine] JioSaavn preview search warning:", saavnErr);
      }
    }

    // Step 2: Query Gemini AI for accurate Hindi/Bollywood/Regional song context, lyrics snippet & movie details
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are a music recognition expert for Friday AI.
Identify this song request from user "${searchClean}".
If it's in Hindi/Bollywood/Punjabi/English/Regional, identify the exact canonical Track Title, Singers/Artists, Movie/Album, Release Year, and 2-3 iconic lines of lyrics in Hinglish/Roman script.

Respond ONLY with valid JSON in this exact structure:
{
  "trackTitle": "Exact Song Name",
  "artists": "Singer 1, Singer 2, Composer",
  "albumOrMovie": "Movie or Album Name",
  "year": "YYYY",
  "genre": "Romantic / Pop / Lo-Fi / Sufi / Rock",
  "lyricsSnippet": "2-3 most famous hook lyrics lines...",
  "searchKeyword": "Canonical Song Name Artist"
}`;

        const aiRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(aiRes.text?.trim() || "{}");
        if (json.trackTitle) trackTitle = json.trackTitle;
        if (json.artists) artistName = json.artists;
        if (json.albumOrMovie) albumName = json.albumOrMovie;
        if (json.year) releaseYear = json.year;
        if (json.genre) genre = json.genre;
        if (json.lyricsSnippet) lyricsSnippet = json.lyricsSnippet;
      } catch (geminiErr) {
        console.warn("[WhatsAppFeatureEngine] Gemini song identification error:", geminiErr);
      }
    }

    // Step 3: Platform Intent Detection (YouTube is DEFAULT Priority)
    const searchTarget = `${trackTitle} ${artistName}`.trim();
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(searchTarget)}`;

    // Record last song into chat memory & search session
    if (chatId) {
      this.recordLastSong(chatId, {
        title: trackTitle,
        artist: artistName,
        ytUrl: ytSearchUrl,
        spotifyUrl,
        album: albumName,
        year: releaseYear,
        genre,
        lyrics: lyricsSnippet,
      });

      const existingSession = this.chatSongSearchSessionMap.get(chatId);
      const isSameQuery = existingSession && existingSession.originalQuery.toLowerCase().trim() === searchClean.toLowerCase().trim();
      const seen = isSameQuery ? existingSession.seenSongs : [];
      if (!seen.some((s) => s.title.toLowerCase() === trackTitle.toLowerCase())) {
        seen.push({ title: trackTitle, artist: artistName, ytUrl: ytSearchUrl });
      }
      this.chatSongSearchSessionMap.set(chatId, {
        originalQuery: searchClean,
        seenSongs: seen,
        attemptCount: isSameQuery ? existingSession.attemptCount + 1 : 1,
        timestamp: Date.now(),
      });
    }

    // Fetch Audio Preview Buffer if preview requested
    let audioBuffer: Buffer | null = null;
    if (previewAudioUrl && isPreviewReq) {
      try {
        const audioFetchRes = await fetch(previewAudioUrl, { signal: AbortSignal.timeout(8000) });
        if (audioFetchRes.ok) {
          const ab = await audioFetchRes.arrayBuffer();
          audioBuffer = Buffer.from(ab);
        }
      } catch (audioErr) {
        console.warn("[WhatsAppFeatureEngine] Failed to download audio preview buffer:", audioErr);
      }
    }

    if (isPreviewReq || audioBuffer) {
      const previewCard = `🎧 *FRIDAY AUDIO PREVIEW* 🔊✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${trackTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Gaana suniye aur vibe kijiye ${requesterName}! Volume UP!_ 🔊🔥`;

      return {
        replyText: previewCard,
        trackTitle,
        artistName,
        ytUrl: ytSearchUrl,
        spotifyUrl,
        previewAudioUrl,
        audioBuffer,
        isPreviewRequested: true,
        isPlaylist: false,
      };
    }

    // Default Direct Search (YouTube Link only)
    const card = `🎵 *FRIDAY AI SONG RADAR* 🎬🎧
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${trackTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
▶️ *YouTube Link:*
${ytSearchUrl}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _(Preview sunne ke liye type karein: "@song ${trackTitle} preview")_
🎧 _Gaana suniye aur vibe kijiye ${requesterName}! Volume UP!_ 🔊🔥`;

    return {
      replyText: card,
      trackTitle,
      artistName,
      ytUrl: ytSearchUrl,
      spotifyUrl,
      previewAudioUrl,
      audioBuffer,
      isPreviewRequested: false,
      isPlaylist: false,
    };
  }

  // ── 9.1 🎶 AI Shazam & Voice Humming Song Identifier (@hum / @shazam) ───

  public async identifySongFromHumming(
    audioBuffer: Buffer,
    mimeType = "audio/ogg",
    requesterName = "Boss",
    chatId?: string
  ): Promise<{
    replyText: string;
    trackTitle: string;
    artistName: string;
    ytUrl: string;
    audioBuffer?: Buffer | null;
  }> {
    const apiKey = process.env.GEMINI_API_KEY;
    let trackTitle = "Identified Song";
    let artistName = "Original Artist";
    let albumName = "";
    let releaseYear = "";
    let genre = "Music";
    let confidence = "High (94%)";
    let identifiedSnippet = "";

    if (apiKey && audioBuffer && audioBuffer.length > 0) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const base64Audio = audioBuffer.toString("base64");

        const prompt = `You are an elite music recognition AI Shazam engine for Friday AI.
Listen to this user audio recording where a person is singing, humming (e.g. "hmm hmm", "na na re", tune rhythm), or playing a background song.
Identify the EXACT canonical song title, artist(s), movie/album, and iconic hook lyrics in Hindi/Bollywood/Punjabi/English/Regional.

Respond ONLY with valid JSON in this exact structure:
{
  "trackTitle": "Exact Song Name",
  "artists": "Singer Name, Music Composer",
  "albumOrMovie": "Movie or Album Name",
  "lyricsSnippet": "Famous 2-line lyrics snippet...",
  "confidence": "96%"
}`;

        const aiRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            { inlineData: { mimeType: mimeType || "audio/ogg", data: base64Audio } },
            { text: prompt },
          ],
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(aiRes.text?.trim() || "{}");
        if (json.trackTitle) trackTitle = json.trackTitle;
        if (json.artists) artistName = json.artists;
        if (json.albumOrMovie) albumName = json.albumOrMovie;
        if (json.confidence) confidence = json.confidence;
        if (json.lyricsSnippet) identifiedSnippet = json.lyricsSnippet;
      } catch (humErr) {
        console.warn("[WhatsAppFeatureEngine] Humming recognition error:", humErr);
      }
    }

    const searchTarget = `${trackTitle} ${artistName}`.trim();
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(searchTarget)}`;

    // Record last song into chat memory
    if (chatId) {
      this.recordLastSong(chatId, {
        title: trackTitle,
        artist: artistName,
        ytUrl: ytSearchUrl,
        spotifyUrl,
        album: albumName,
        year: releaseYear,
        genre,
        lyrics: identifiedSnippet,
      });
      this.recordGroupSongPlay(chatId, trackTitle, artistName, requesterName);
    }

    // Fetch 30-sec official audio preview from iTunes
    let previewBuffer: Buffer | null = null;
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(searchTarget)}&media=music&entity=song&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (itunesRes.ok) {
        const itunesData: any = await itunesRes.json();
        const previewUrl = itunesData.results?.[0]?.previewUrl;
        if (previewUrl) {
          const audioFetch = await fetch(previewUrl, { signal: AbortSignal.timeout(8000) });
          if (audioFetch.ok) {
            previewBuffer = Buffer.from(await audioFetch.arrayBuffer());
          }
        }
      }
    } catch (itErr) {
      console.warn("[WhatsAppFeatureEngine] iTunes preview fetch warning:", itErr);
    }

    const card = `🎙️ *FRIDAY AI SHAZAM & HUMMING RADAR* 🎧✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${trackTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Volume UP ${requesterName}! Enjoy the preview!_ 🔊🔥`;

    return {
      replyText: card,
      trackTitle,
      artistName,
      ytUrl: ytSearchUrl,
      audioBuffer: previewBuffer,
    };
  }

  // ── 9.2 🎬 Reel / Shorts Background Song Extractor (@reel / @bgm) ─────────

  public async extractReelBackgroundSong(
    urlOrText: string,
    requesterName = "Boss",
    chatId?: string
  ): Promise<{
    replyText: string;
    trackTitle: string;
    artistName: string;
    ytUrl: string;
    audioBuffer?: Buffer | null;
  }> {
    const rawClean = (urlOrText || "")
      .replace(/^(?:@reel|@bgm|@short|@shorts|\/reel|\/bgm|\/short|\/shorts|reel:|bgm:)\s*/i, "")
      .trim();

    const apiKey = process.env.GEMINI_API_KEY;
    let trackTitle = "Trending Reel Track";
    let artistName = "Viral Audio Artist";
    let albumName = "";
    let releaseYear = "";
    let genre = "Music";
    let vibe = "Viral Trending BGM";
    let iconicDrop = "";

    if (apiKey) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are a social media & viral Reel/Shorts music analyst for Friday AI.
User provided Instagram Reel / Shorts link or description: "${rawClean}".
Identify the famous background soundtrack / viral trending audio / BGM used in this reel or trend.

Respond ONLY with valid JSON in this exact structure:
{
  "trackTitle": "Exact Song Name",
  "artists": "Singer / Music Producer",
  "albumOrMovie": "Movie or Album Name",
  "vibe": "Trending Instagram Reel Audio / Slowed+Reverb / Bass Boosted",
  "iconicDrop": "Key hook line or beat drop description"
}`;

        const aiRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(aiRes.text?.trim() || "{}");
        if (json.trackTitle) trackTitle = json.trackTitle;
        if (json.artists) artistName = json.artists;
        if (json.albumOrMovie) albumName = json.albumOrMovie;
        if (json.vibe) vibe = json.vibe;
        if (json.iconicDrop) iconicDrop = json.iconicDrop;
      } catch (reelErr) {
        console.warn("[WhatsAppFeatureEngine] Reel song extractor error:", reelErr);
      }
    }

    const searchTarget = `${trackTitle} ${artistName}`.trim();
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTarget + " official song")}`;

    if (chatId) {
      this.recordLastSong(chatId, {
        title: trackTitle,
        artist: artistName,
        ytUrl: ytSearchUrl,
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(searchTarget)}`,
        album: albumName,
        year: releaseYear,
        genre,
        lyrics: iconicDrop,
      });
      this.recordGroupSongPlay(chatId, trackTitle, artistName, requesterName);
    }

    // Fetch 30-sec official audio preview from iTunes
    let audioBuffer: Buffer | null = null;
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(searchTarget)}&media=music&entity=song&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (itunesRes.ok) {
        const itunesData: any = await itunesRes.json();
        const previewUrl = itunesData.results?.[0]?.previewUrl;
        if (previewUrl) {
          const audioFetch = await fetch(previewUrl, { signal: AbortSignal.timeout(8000) });
          if (audioFetch.ok) {
            audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
          }
        }
      }
    } catch (itErr) {
      console.warn("[WhatsAppFeatureEngine] Reel iTunes preview warning:", itErr);
    }

    const dropBlock = iconicDrop ? `\n\n⚡ *Beat / Hook:* _"${iconicDrop}"_` : "";

    const card = `🎬 *REEL & SHORTS BACKGROUND SONG* 📱🎧
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎶 *Music:* ${trackTitle}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Pura gaana sunne ke liye type karein "link"_
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Vibe kijiye ${requesterName}! Volume UP!_ 🔊🔥`;

    return {
      replyText: card,
      trackTitle,
      artistName,
      ytUrl: ytSearchUrl,
      audioBuffer,
    };
  }

  // ── 9.3 📊 Group Weekly Billboard Music Chart (@groupchart) ───────────────

  private groupMusicCharts: Map<string, Array<{ title: string; artist: string; playCount: number; lastPlayedAt: number; requestedBy: string }>> = new Map();

  public recordGroupSongPlay(groupId: string, songTitle: string, artist: string, requestedBy = "Member") {
    if (!groupId || !songTitle) return;
    const list = this.groupMusicCharts.get(groupId) || [];
    const cleanTitle = songTitle.toLowerCase().trim();
    const existing = list.find((s) => s.title.toLowerCase().trim() === cleanTitle);

    if (existing) {
      existing.playCount += 1;
      existing.lastPlayedAt = Date.now();
      existing.requestedBy = requestedBy;
    } else {
      list.push({
        title: songTitle,
        artist: artist || "Artist",
        playCount: 1,
        lastPlayedAt: Date.now(),
        requestedBy,
      });
    }

    this.groupMusicCharts.set(groupId, list);
  }

  public getGroupMusicChart(groupId: string, groupName = "WhatsApp Group", requesterName = "Boss"): string {
    const list = this.groupMusicCharts.get(groupId) || [];

    if (list.length === 0) {
      return `🏆 *FRIDAY BILLBOARD CHART: ${groupName.toUpperCase()}* 📊✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
Abhi is group me koi song request record nahi hua hai!

👉 *Gaana chalane ke liye type karein:*
• \`@song Kesariya\`
• \`@song sad song preview\`
• \`@hum\` (voice note bhejkar)`;
    }

    const sorted = [...list].sort((a, b) => b.playCount - a.playCount).slice(0, 5);
    const totalStreams = list.reduce((acc, s) => acc + s.playCount, 0);

    const badges = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    const chartLines = sorted.map((s, idx) => {
      const b = badges[idx] || `${idx + 1}️⃣`;
      return `${b} *${s.title}* - ${s.artist}\n   🔥 *${s.playCount} Play${s.playCount > 1 ? "s" : ""}* _(Requested by @${s.requestedBy})_`;
    }).join("\n\n");

    const topTrackYt = `https://www.youtube.com/results?search_query=${encodeURIComponent(sorted[0].title + " " + sorted[0].artist + " official song")}`;

    return `🏆 *FRIDAY BILLBOARD WEEKLY CHART: ${groupName.toUpperCase()}* 📊🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━
${chartLines}
━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *#1 Trending Track:* ${sorted[0].title}
📈 *Total Group Song Streams:* ${totalStreams} Plays
━━━━━━━━━━━━━━━━━━━━━━━━━━
▶️ *#1 Track YouTube Link:*
${topTrackYt}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎧 _Aapke group ka music taste legendary hai ${requesterName}! Keep vibing!_ 🔊✨`;
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
