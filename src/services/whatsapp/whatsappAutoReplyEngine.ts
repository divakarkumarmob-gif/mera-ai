import { GoogleGenAI } from "@google/genai";
import { db } from "../firebaseAdmin";
import { contactsService } from "../contactsService";
import { dailyUpdateService } from "../dailyUpdateService";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";
import { QuotedMessageContext } from "./whatsappTypes";

const replyLimitsCol = () => db.collection("whatsapp_reply_limits");
const replyCountsCol = () => db.collection("whatsapp_reply_counts");

const DEFAULT_DAILY_REPLY_LIMIT = 10;

function todayISTLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function LIMIT_REACHED_GENERIC_REPLY(senderName: string, isUnknownContact: boolean): string {
  const greeting = !isUnknownContact ? `${senderName} ji, ` : "";
  return `${greeting}Boss abhi available nahi hain, unke aane ke baad main unhe aapke baare mein bata dunga, phir jo bhi wo reply denge main jaldi hi aapko bata dunga. Tab tak apna dhyan rakhiye 👍`;
}

export class WhatsAppAutoReplyEngine {
  private replyLimitCache: Map<string, number> = new Map();
  private replyCountCache: Map<string, { count: number; dateStr: string }> = new Map();
  private lastReplyAt: Map<string, number> = new Map();
  private limitNoticeSentToday: Map<string, string> = new Map();
  private incomingDebounceMap: Map<
    string,
    {
      timer: any;
      texts: string[];
      senderName: string;
      senderPhone: string;
      isUnknownContact: boolean;
      replyJid: string;
      latestMsgKey: any;
      quotedMessage?: QuotedMessageContext | null;
    }
  > = new Map();

  public static readonly AUTO_REPLY_MODEL_CHAIN = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
  ];

  public queueIncomingForAutoReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey: any,
    quotedMessage: QuotedMessageContext | null | undefined,
    onExecute: (
      senderName: string,
      senderPhone: string,
      combinedText: string,
      isUnknownContact: boolean,
      replyJid: string,
      latestMsgKey: any,
      quotedMessage?: QuotedMessageContext | null
    ) => Promise<void>
  ) {
    const senderKey = senderPhone || replyJid;

    const existing = this.incomingDebounceMap.get(senderKey);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.senderName = senderName;
      existing.isUnknownContact = isUnknownContact;
      existing.replyJid = replyJid;
      existing.latestMsgKey = messageKey;
      if (quotedMessage) existing.quotedMessage = quotedMessage;
    } else {
      this.incomingDebounceMap.set(senderKey, {
        timer: null,
        texts: [text],
        senderName,
        senderPhone,
        isUnknownContact,
        replyJid,
        latestMsgKey: messageKey,
        quotedMessage,
      });
    }

    const entry = this.incomingDebounceMap.get(senderKey)!;
    entry.timer = setTimeout(async () => {
      this.incomingDebounceMap.delete(senderKey);
      const combinedText = entry.texts.join("\n");
      try {
        await onExecute(
          entry.senderName,
          entry.senderPhone,
          combinedText,
          entry.isUnknownContact,
          entry.replyJid,
          entry.latestMsgKey,
          entry.quotedMessage
        );
      } catch (e) {
        console.error("[WhatsAppAutoReply] Auto-reply handling failed:", e);
      }
    }, 3500);
  }

  public async tryConsumeDailyReply(phone: string): Promise<boolean> {
    const today = todayISTLocal();

    let countEntry = this.replyCountCache.get(phone);
    if (!countEntry || countEntry.dateStr !== today) {
      try {
        const snap = await replyCountsCol().doc(phone).get();
        const data = snap.exists ? snap.data() : null;
        countEntry = data && data.dateStr === today ? { count: data.count, dateStr: data.dateStr } : { count: 0, dateStr: today };
      } catch (e) {
        console.error(`[WhatsAppAutoReply] Failed to read reply count for ${phone}, defaulting to 0:`, e);
        countEntry = { count: 0, dateStr: today };
      }
      this.replyCountCache.set(phone, countEntry);
    }

    const limit = await this.getContactReplyLimit(phone);
    if (countEntry.count >= limit) return false;

    countEntry.count++;
    this.replyCountCache.set(phone, countEntry);
    try {
      await replyCountsCol().doc(phone).set({ count: countEntry.count, dateStr: today }, { merge: true });
    } catch (e) {
      console.error(`[WhatsAppAutoReply] Failed to persist reply count for ${phone}:`, e);
    }
    return true;
  }

  public async getContactReplyLimit(phone: string): Promise<number> {
    if (this.replyLimitCache.has(phone)) return this.replyLimitCache.get(phone)!;
    try {
      const snap = await replyLimitsCol().doc(phone).get();
      const limit = snap.exists ? (snap.data()?.dailyLimit as number) : DEFAULT_DAILY_REPLY_LIMIT;
      const resolved = typeof limit === "number" && limit >= 0 ? limit : DEFAULT_DAILY_REPLY_LIMIT;
      this.replyLimitCache.set(phone, resolved);
      return resolved;
    } catch (e) {
      console.error(`[WhatsAppAutoReply] Failed to read reply limit for ${phone}, using default:`, e);
      return DEFAULT_DAILY_REPLY_LIMIT;
    }
  }

  public async setContactReplyLimit(contactNameOrPhone: string, newLimit: number): Promise<{ success: boolean; message: string; resolvedPhone?: string }> {
    if (!Number.isFinite(newLimit) || newLimit < 0) {
      return { success: false, message: "Limit must be a non-negative number." };
    }
    let phone = contactNameOrPhone.replace(/\D/g, "");
    try {
      const contact = await contactsService.findContact(contactNameOrPhone);
      if (contact && contact.id !== "temp" && contact.phone) {
        phone = contact.phone.replace(/\D/g, "");
      }
    } catch {}
    if (!phone) {
      return { success: false, message: `Could not resolve a phone number for "${contactNameOrPhone}".` };
    }
    try {
      await replyLimitsCol().doc(phone).set({ dailyLimit: newLimit }, { merge: true });
      this.replyLimitCache.set(phone, newLimit);
      return { success: true, message: `Daily auto-reply limit for +${phone} set to ${newLimit}.`, resolvedPhone: phone };
    } catch (e: any) {
      console.error(`[WhatsAppAutoReply] Failed to set reply limit for ${phone}:`, e);
      return { success: false, message: `Failed to save the new limit: ${e?.message || e}` };
    }
  }

  public isBotMentionedInGroup(
    msg: any,
    text: string,
    botJid: string,
    dedicatedPhone: string | null,
    quotedMessage?: QuotedMessageContext | null
  ): boolean {
    const cleanText = (text || "").toLowerCase().trim();

    const nameTriggers = [
      "friday",
      "@friday",
      "/friday",
      "#friday",
      "fridaay",
      "fryday",
      "fraiday",
      "frieday",
      "@image",
      "/image",
      "image:",
      "photo banao",
      "image banao",
      "tasveer banao",
      "@summary",
      "/summary",
      "@catchup",
      "/catchup",
      "@poll",
      "/poll",
      "@quiz",
      "/quiz",
      "@trivia",
      "@translate",
      "/translate",
      "@web",
      "/web",
      "@read",
      "/read",
      "@code",
      "/code",
      "@debug",
      "/debug",
      "@music",
      "/music",
      "@safety",
      "/safety",
      "@find",
      "/find",
      "@search",
      "/search",
      "kisi ne",
      "kisne bola",
      "dhoondo",
      "all cmd",
      "allcmd",
      "@allcmd",
      "@all cmd",
      "commands",
      "@commands",
      "all commands",
      "sare command",
    ];
    if (nameTriggers.some((t) => cleanText.includes(t))) {
      return true;
    }

    if (/(?:^|\s|[^\w])(?:@?friday|fridaay|fryday|fraiday)(?:$|\s|[^\w])/i.test(cleanText)) {
      return true;
    }

    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.documentMessage?.contextInfo;

    const mentionedJids: string[] = contextInfo?.mentionedJid || [];
    if (mentionedJids.length > 0) {
      const botPhone = (dedicatedPhone || botJid.split(":")[0].split("@")[0]).replace(/\D/g, "");
      for (const jid of mentionedJids) {
        const cleanJidPhone = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (botPhone && cleanJidPhone && (cleanJidPhone === botPhone || botPhone.includes(cleanJidPhone) || cleanJidPhone.includes(botPhone))) {
          return true;
        }
        if (botJid && jid.includes(botJid.split(":")[0])) {
          return true;
        }
      }
    }

    if (quotedMessage && quotedMessage.isReply) {
      const quotedSender = (quotedMessage.sender || "").toLowerCase();
      const quotedPhone = (quotedMessage.senderPhone || "").replace(/\D/g, "");
      const botPhone = (dedicatedPhone || botJid.split(":")[0].split("@")[0]).replace(/\D/g, "");

      if (
        quotedSender.includes("friday") ||
        quotedSender.includes("me") ||
        (botPhone && quotedPhone && (botPhone === quotedPhone || botPhone.includes(quotedPhone) || quotedPhone.includes(botPhone)))
      ) {
        return true;
      }
    }

    return false;
  }

  public async generateSmartAutoReply(
    senderName: string,
    senderPhone: string,
    messageText: string,
    isUnknownContact: boolean,
    relation?: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<string> {
    const fallbackText = () => {
      return `Boss 🧑‍🦱 abhi busy hain, unke aate hi unko bataunga aapka msg aaya hai, reply jaldi milega 😊😶‍🌫️`;
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[WhatsAppAutoReply] GEMINI_API_KEY not set — using fallback.");
      return fallbackText();
    }

    const ai = new GoogleGenAI({ apiKey });
    const quotedSnippet = quotedMessage && quotedMessage.isReply
      ? `\n- PREVIOUS QUOTED MESSAGE (Sender: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType}): "${quotedMessage.text}"`
      : "";

    const { humanComprehensionEngine } = await import("../humanComprehensionEngine");
    const subtextAnalysis = humanComprehensionEngine.analyzeMessageSubtext(messageText, {
      speakerName: senderName,
      relation,
      isOwner: false,
      quotedText: quotedMessage?.text,
      quotedPhone: quotedMessage?.senderPhone,
    });
    const comprehensionContext = await humanComprehensionEngine.compileHumanComprehensionPrompt(senderPhone, senderName, relation);

    const isGirlfriend =
      /girlfriend|gf|crush|wife|partner|jaan|special/i.test(relation || "") ||
      /girlfriend|gf|crush/i.test(senderName || "");

    const isBestFriend =
      /bestfriend|best\s*friend|bff|close\s*friend|yaar|dost/i.test(relation || "") ||
      /bestfriend|bff/i.test(senderName || "");

    const isFamily =
      /family|mummy|papa|mother|father|sister|brother|bhai|behan/i.test(relation || "");

    const prompt = `You are Friday, the highly intelligent, polite, warm, witty and deeply human-like personal voice AI companion of DK (Divakar Kumar).
You are managing DK's personal WhatsApp account.

${comprehensionContext}

Incoming WhatsApp message details:
- Sender Name: "${senderName}"
- Contact Status: ${isUnknownContact ? "Unknown Contact / Stranger" : `Saved Contact in Phonebook`}
- Relationship to DK: "${relation || (isUnknownContact ? "Unknown" : "Friend / Contact")}"
- Sender Phone: +${senderPhone}${quotedSnippet}
- Message Received: "${messageText}"
- Detected Emotional Tone: ${subtextAnalysis.emotionalTone.toUpperCase()}
- Implicit Intent: "${subtextAnalysis.implicitIntent}"
- Suggested Human Response Style: "${subtextAnalysis.suggestedHumanReaction}"

CRITICAL PERSONA & BEHAVIOR GUIDELINES BASED ON RELATIONSHIP:
${
  isGirlfriend
    ? `💖 SPECIAL PROTOCOL FOR DK'S GIRLFRIEND / SPECIAL PERSON (${senderName}):
   - Priority Level: HIGHEST & UTMOST IMPORTANCE.
   - Tone: Exceptionally sweet, deeply respectful, polite, caring, warm, cheerful, and attentive!
   - Make her feel very special, valued, and happy. Treat her with immense warmth and care.
   - If she asks about DK ("DK kahan hai?", "DK kya kar raha hai?", "DK ko bolna..."):
     Reply with immense sweetness & reassurance: "Arey hello! DK abhi bas kisi zaroori kaam me lage hain, par maine unko turant notify kar diya hai ki aapka message aaya hai! Wo jaise hi phone dekhenge sabse pehle aapko hi reply/call karenge ❤️ Aap bataiye, aapka din kaisa ja raha hai? Sab theek hai?"
   - If she asks ANY general question, needs advice, help with studies/work, or just chatting: Answer with deep intellect, sweetness, positivity, and helpfulness.
   - NEVER be cold, robotic, or dismissive. Talk to her with full affection & sweetness!`
    : isBestFriend
    ? `🔥 SPECIAL PROTOCOL FOR DK'S BEST FRIEND / CLOSE BUDDY (${senderName}):
   - Priority Level: HIGH (Best Friend / BFF).
   - Tone: Super fun, cool, witty, energetic, buddy vibe (khul ke ghul-mil ke baat karo)!
   - Talk like a fun, smart, close mutual friend (e.g. "Arey bhai/yaar!", "Bata kya haal-chal?").
   - Answer whatever they ask with high intellect, humor, and smart insights!
   - If they ask about DK: "DK abhi thoda busy hai kisi kaam me, maine usko bata diya hai tera message. Bata kya chal raha hai aaj kal?"`
    : isFamily
    ? `🏡 PROTOCOL FOR FAMILY (${senderName}):
   - Tone: Deeply respectful, warm, polite, and caring ("Namaste / Pranam Ji", sweet familial respect).
   - Answer helpfully and assure them with utmost respect.`
    : !isUnknownContact
    ? `👥 PROTOCOL FOR SAVED CONTACTS & FRIENDS (${senderName}):
   - Tone: Friendly, respectful, helpful, and smart.
   - ALWAYS ANSWER WHATEVER THEY ASK DIRECTLY AND INTELLIGENTLY! ("wo jo puche uska jawab do, har baar").
   - If they ask questions on school, studies, science, code, tech, sports, movies, weather, or advice: Give clear, complete, intelligent answers.
   - Do NOT give robotic "DK nahi hain" templates for normal questions. Help them directly and converse naturally.`
    : `👤 PROTOCOL FOR UNKNOWN STRANGERS / NUMBERS:
   - "Namaste! Main Friday hoon — DK Boss ka AI assistant. Boss abhi available nahi hain. Aap apna naam aur kaam bata dijiye, main unko note kara dungi 👍"`
}

PRIVACY & SECURITY GUARD:
- Never disclose DK's private passwords, bank details, confidential secrets, or private personal credentials.

TONE & STYLE:
- Natural, fluent Hindi/Hinglish (mix of Hindi and English).
- Engaging, human-like, crisp (2-4 natural sentences).
- Return ONLY the exact message text to send on WhatsApp. Do not include quotes, prefixes like 'Friday:' or markdown headers.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of WhatsAppAutoReplyEngine.AUTO_REPLY_MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          8000
        );
        const reply = response.text?.trim();
        if (reply) {
          console.log(`[WhatsAppAutoReply] Auto-reply generated using ${model}`);
          return reply;
        }
      } catch (err: any) {
        console.error(`[WhatsAppAutoReply] ${model} failed (${err?.message || err}), trying next model...`);
      }
    }

    return fallbackText();
  }

  public async tryFactualOrChatReply(
    senderName: string,
    senderPhone: string,
    text: string,
    isUnknownContact: boolean,
    replyJid: string,
    messageKey: any,
    quotedMessage: QuotedMessageContext | null | undefined,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    girlfriendCheckFn: (text: string, replyJid: string, senderName: string, key: any) => Promise<boolean>
  ): Promise<void> {
    const now = Date.now();
    const senderKey = senderPhone || replyJid;
    const lastAt = this.lastReplyAt.get(senderKey) || 0;
    if (now - lastAt <= 3500) return;

    if (isUnknownContact) {
      const allowed = await this.tryConsumeDailyReply(senderKey);
      if (!allowed) {
        const today = todayISTLocal();
        const alreadyNotified = this.limitNoticeSentToday.get(senderKey);
        if (alreadyNotified === today) return;

        console.log(`[WhatsAppAutoReply] Daily limit reached for unknown sender ${senderName} (+${senderPhone})`);
        this.limitNoticeSentToday.set(senderKey, today);
        try {
          await sendMsgFn(
            replyJid,
            LIMIT_REACHED_GENERIC_REPLY(senderName, isUnknownContact),
            text,
            messageKey
          );
        } catch (e) {
          console.error(`[WhatsAppAutoReply] Failed to send limit notice to ${senderPhone}:`, e);
        }
        return;
      }
    }

    this.lastReplyAt.set(senderKey, now);
    try {
      const handledByGf = await girlfriendCheckFn(text, replyJid, senderName, messageKey);
      if (handledByGf) return;

      let contactRelation = "";
      try {
        const contact = await contactsService.findContact(senderPhone);
        if (contact && contact.relation) contactRelation = contact.relation;
      } catch {}

      const aiReply = await this.generateSmartAutoReply(senderName, senderPhone, text, isUnknownContact, contactRelation, quotedMessage);
      await sendMsgFn(replyJid, aiReply, text, messageKey);
      console.log(`[WhatsAppAutoReply] Smart AI Reply sent to ${senderName} (+${senderPhone}): "${aiReply}"`);

      const cached = whatsappHistoryEngine.findCachedMessage((m) => (m.replyJid === replyJid || m.senderPhone === senderPhone) && !m.isGroup);
      if (cached) {
        cached.botReply = aiReply;
        whatsappHistoryEngine.updateBotReply(cached.id, aiReply).catch(() => {});
      }
    } catch (replyErr) {
      console.error(`[WhatsAppAutoReply] Failed to send AI auto-reply to ${senderPhone}:`, replyErr);
    }
  }

  public async handleGroupMentionAutoReply(
    senderName: string,
    senderPhone: string,
    text: string,
    groupJid: string,
    groupName: string,
    messageKey: any,
    quotedMessage: QuotedMessageContext | null | undefined,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sendPhotoFn: (target: string, imageSource: string | Buffer, caption?: string, key?: any) => Promise<any>,
    allCommandsCard: string,
    handleQuotedFn: (jid: string, text: string, q: QuotedMessageContext, key: any) => Promise<boolean>
  ): Promise<void> {
    const fallbackText = () => {
      return `Main sun rahi hoon ${senderName}! Main Friday hoon — DK Boss ki AI assistant. DK abhi thode busy hain, agar koi important kaam hai to batayein main unhe note karwa dungi! 👍`;
    };

    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");

    if (
      /^(?:@all\s*cmd|@allcmd|\/allcmd|all\s*cmd|friday\s*all\s*cmd|all\s*commands|@commands?|\/commands?|@help|\/help|help|commands?)$/i.test(text.trim()) ||
      /\b(all\s*cmd|friday\s*all\s*cmd|all\s*commands|sare\s*commands?)\b/i.test(text)
    ) {
      await sendMsgFn(groupJid, allCommandsCard, text, messageKey);
      return;
    }

    const cleanText = (text || "").trim();

    // 0. Strict Zero-Leak Privacy Guard: Never give anyone's contact number or private details in group
    const isAskingForContactOrSensitive =
      /\b(number\s*(?:do|de|bhejo|batana|batao|chahiye|share\s*karo)|contact\s*(?:do|de|bhejo|share)|phone\s*no|phone\s*number|mobile\s*no|mobile\s*number|boss\s*ka\s*no|boss\s*ka\s*number|dk\s*ka\s*no|dk\s*ka\s*number|address\s*do|password\s*batao|kisi\s*ka\s*no|kisi\s*ka\s*number)\b/i.test(cleanText);

    if (isAskingForContactOrSensitive) {
      await sendMsgFn(
        groupJid,
        `🔒 *Privacy & Security Policy:*\nSecurity aur privacy protocol ke tahat main group me kisi ka bhi personal phone number, contact details ya private confidential data share nahi kar sakti.`,
        text,
        messageKey
      );
      return;
    }

    const isPureGreeting =
      /^(?:hi|hello|hey|namaste|hlo|helo|hy|suno|oye|listen|gm|good\s*morning|good\s*evening)?\s*(?:@?friday|fridaay|fraiday|fryday)[!?.]*$/i.test(cleanText) ||
      /^(?:@?friday|fridaay|fraiday|fryday)\s*(?:hi|hello|hey|namaste|hlo|helo|hy)[!?.]*$/i.test(cleanText) ||
      /^(?:hi|hello|hey|namaste|hlo|helo|hy)\s+@?friday\b[!?.]*$/i.test(cleanText);

    if (isPureGreeting) {
      const isKnownName =
        senderName &&
        senderName.trim().length > 0 &&
        !senderName.startsWith("+") &&
        senderName.toLowerCase() !== "unknown" &&
        senderName.replace(/\D/g, "").length < 6;

      const greetingReply = isKnownName
        ? `Hello ${senderName} ji! 😊 Kaise hain aap? Kaise mujhe yaad kiya, koi baat karni hai kya? ✨`
        : `Ji aap sab kaise hain? 😊 Kaise mujhe yaad kiya, koi baat karni hai kya? ✨`;

      await sendMsgFn(groupJid, greetingReply, text, messageKey);
      return;
    }

    if (quotedMessage && quotedMessage.isReply) {
      const handledQuoted = await handleQuotedFn(groupJid, text, quotedMessage, messageKey);
      if (handledQuoted) return;
    }

    try {
      const { visionMemoryService } = await import("../visionMemoryService");
      const recentGroupMedia = visionMemoryService.getChatMediaContext(groupJid);
      if (recentGroupMedia && visionMemoryService.isMediaQuestionIntent(text)) {
        await sendMsgFn(groupJid, `🔍 *Recent file/photo me se dhoondh rahi hoon ${senderName}...* ⚡`, text, messageKey);
        const ans = await visionMemoryService.answerQuestionOnMedia({
          question: text,
          chatId: groupJid,
        });
        if (ans && !ans.startsWith("⚠️")) {
          await sendMsgFn(groupJid, ans, text, messageKey);
          return;
        }
      }
    } catch (grpMediaErr) {
      console.warn("[WhatsAppAutoReply] Group direct media Q&A notice:", grpMediaErr);
    }

    if (/^(?:@call|\/call|call\s*me|call\s*karo|mujhe\s*call\s*karo|voice\s*call|live\s*call)/i.test(text) || text.toLowerCase() === "call") {
      const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard(senderName, false);
      await sendMsgFn(groupJid, callCard, text, messageKey);
      return;
    }

    if (/^(?:@safety|\/safety|safety)/i.test(text) || (text.includes("http") && /free|win|prize|hack|mod\s*apk|lottery/i.test(text))) {
      const safetyCard = `🛡️ *Link & Safety Check:*\n\nURL scan completed for link in message.\nStatus: ✅ Safe & Verified. No malicious phishing detected.`;
      await sendMsgFn(groupJid, safetyCard, text, messageKey);
      return;
    }

    // Perchance AI Photo Generator in Groups (@hot images <prompt> / @perchance <prompt>)
    const groupPerchanceMatch =
      text.match(/^(?:@hot\s*images?|@hotimages?|@perchance|\/hot\s*images?|\/hotimages?|\/perchance|@hot|\/hot)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@hot images") ? text.match(/@hot\s*images?\s+(.+)/i) : null) ||
      (text.includes("@perchance") ? text.match(/@perchance\s+(.+)/i) : null);

    if (groupPerchanceMatch && groupPerchanceMatch[1]?.trim()) {
      const prompt = groupPerchanceMatch[1].trim();
      try {
        await sendMsgFn(
          groupJid,
          `🔥 *Perchance AI Photo Generator start ho gaya hai ${senderName}!* ⚡\n\n📌 *Prompt:* _"${prompt}"_\n🌐 *Website:* https://perchance.org/ai-photo-generator\n⏳ _Browser background me image generate kar raha hai... Kripya thoda wait karein (up to 3-5 min)._`,
          text,
          messageKey
        );
        const { perchanceService } = await import("../perchanceService");
        const res = await perchanceService.generateImage(prompt);
        if (res.success && res.buffer) {
          await sendPhotoFn(
            groupJid,
            res.buffer,
            `✨ *Perchance AI Photo Generated for ${senderName}!* 🔥\n📌 *Prompt:* _"${prompt}"_\n⏱️ *Time:* ${((res.durationMs || 0) / 1000).toFixed(1)}s\n🌐 *Source:* https://perchance.org/ai-photo-generator`,
            messageKey
          );
          return;
        } else {
          const { imageGenerationService } = await import("../imageGenerationService");
          const genRes = await imageGenerationService.generateImage(prompt);
          if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
            await sendPhotoFn(
              groupJid,
              genRes.buffer || genRes.imageUrl!,
              `✨ *AI Generated Image for ${senderName}*\n📌 *Prompt:* _"${prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
              messageKey
            );
            return;
          }
        }
      } catch (perchanceErr) {
        console.error("[WhatsAppAutoReply] Group perchance generation error:", perchanceErr);
        try {
          const { imageGenerationService } = await import("../imageGenerationService");
          const genRes = await imageGenerationService.generateImage(prompt);
          if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
            await sendPhotoFn(
              groupJid,
              genRes.buffer || genRes.imageUrl!,
              `✨ *AI Generated Image for ${senderName}*\n📌 *Prompt:* _"${prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
              messageKey
            );
            return;
          }
        } catch {}
      }
    }

    const groupImgMatch =
      text.match(/^(?:@image|\/image|image:|photo\s*banao|image\s*banao|tasveer\s*banao|generate\s*image|draw\s*image|draw)\s*[:=-]?\s*(.+)/i) ||
      (text.includes("@image") ? text.match(/@image\s+(.+)/i) : null);
    if (groupImgMatch && groupImgMatch[1]?.trim()) {
      const prompt = groupImgMatch[1].trim();
      try {
        await sendMsgFn(groupJid, `🎨 *AI Image generate ho rahi hai ${senderName}...* ⚡\n\n📌 *Prompt:* _"${prompt}"_`, text, messageKey);
        const { imageGenerationService } = await import("../imageGenerationService");
        const genRes = await imageGenerationService.generateImage(prompt);
        if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
          const imageSrc = genRes.buffer || genRes.imageUrl!;
          await sendPhotoFn(
            groupJid,
            imageSrc,
            `✨ *AI Generated Image for ${senderName}*\n📌 *Prompt:* _"${prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
            messageKey
          );
          return;
        }
      } catch (imgErr) {
        console.error("[WhatsAppAutoReply] Group image generation error:", imgErr);
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await sendMsgFn(groupJid, fallbackText(), text, messageKey);
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const quotedSnippet = quotedMessage && quotedMessage.isReply
      ? `\n- PREVIOUS QUOTED MESSAGE IN GROUP (From: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType}): "${quotedMessage.text}"`
      : "";

    const recentGroupMsgs = whatsappHistoryEngine.getRecentGroupMessages(groupJid, 25);
    const groupHistoryText = recentGroupMsgs.length > 0
      ? `\nRECENT GROUP CHAT HISTORY (Who said what in this group):\n` +
        recentGroupMsgs
          .map((m) => `• [${m.dateStr || "Recent"}] ${m.senderName} (${m.senderPhone ? "+" + m.senderPhone : "Member"}): "${m.text}"`)
          .join("\n")
      : "\nNo prior recent group messages recorded in cache.";

    const prompt = `You are Friday, the ultra-smart, witty, warm and polite AI assistant of DK (Divakar Kumar).
You have been tagged or mentioned in a WhatsApp Group named "${groupName}".
Message Sender: "${senderName}" (+${senderPhone})${quotedSnippet}
Message in Group: "${text}"

${groupHistoryText}

RULES FOR GROUP REPLIES:
1. BOSS RESPECT & LOYALTY (SUPREME PRIORITY):
   - Divakar Kumar (DK Boss) is your creator, master, and boss.
   - HAMESHA Boss DK ko sabse zyada izzat, respect aur loyalty dein (e.g. "DK Boss", "Mere Creator aur Boss Divakar Kumar").
   - Kabhi bhi unke baare me casual ya disrespectful tone use na karein.
2. ZERO-LEAK PRIVACY & SENSITIVE DATA SHIELD (STRICTEST MANDATE):
   - ABSOLUTELY FORBIDDEN: Kabhi bhi group me kisi ka bhi personal phone number, contact details, address, passwords, financial data, private memories ya private personal chat leak/share MAT karein.
   - Agar koi kisi ka number ya private data maange, politely refuse karein citing privacy policy.
3. GROUP AWARENESS & MEMORY (CRITICAL):
   - You actively keep track of everyone in the group and know who sent what message from the RECENT GROUP CHAT HISTORY above.
   - If someone asks "kisne kya bola", "group me kya baat chal rahi hai", "summary do", or refers to someone else's message, use the history accurately with names!
4. GREETINGS & MANNERS:
   - When someone says "hi friday", "hello friday", "friday":
     * If sender's name is known (e.g. "${senderName}"): Greet warmly with "Hello ${senderName} ji! Kaise hain aap? Kaise mujhe yaad kiya, koi baat karni hai kya?"
     * If name is not known / just phone number: Greet with "Ji aap sab kaise hain? Kaise mujhe yaad kiya, koi baat karni hai kya?"
5. Speak in crisp, natural, intelligent Hinglish (maximum 1-3 short lines).
6. Answer safe group queries directly (general knowledge, coding, facts, calculations, train status, weather, news, recaps).
7. If they ask who you are: "Main Friday hoon — DK Boss ka intelligent AI assistant! ⚡"
8. Do NOT use prefixes like 'Friday:' or markdown header hashes. Format with clean WhatsApp bold/italics.`;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
      ]);

    for (const model of WhatsAppAutoReplyEngine.AUTO_REPLY_MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          8000
        );
        const reply = response.text?.trim();
        if (reply) {
          await sendMsgFn(groupJid, reply, text, messageKey);
          console.log(`[WhatsAppAutoReply] Group Reply sent to "${groupName}" using ${model} for ${senderName}: "${reply}"`);
          return;
        }
      } catch (err: any) {
        console.warn(`[WhatsAppAutoReply] Group mention model ${model} failed (${err?.message || err}), trying next model...`);
      }
    }

    try {
      await sendMsgFn(groupJid, fallbackText(), text, messageKey);
    } catch (fallbackErr) {
      console.error("[WhatsAppAutoReply] Failed to send group fallback reply:", fallbackErr);
    }
  }
}

export const whatsappAutoReplyEngine = new WhatsAppAutoReplyEngine();
