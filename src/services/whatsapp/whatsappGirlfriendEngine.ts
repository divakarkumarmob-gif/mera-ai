import { GoogleGenAI } from "@google/genai";
import { GirlfriendSession } from "./whatsappTypes";

export class WhatsAppGirlfriendEngine {
  private girlfriendSessions: Map<string, GirlfriendSession> = new Map();
  private girlfriendOnlineTimer: NodeJS.Timeout | null = null;
  private girlfriendOnlinePinger: NodeJS.Timeout | null = null;
  private isOnlineActive = false;

  public hasActiveGirlfriendOnline(): boolean {
    return this.girlfriendSessions.size > 0 && this.isOnlineActive;
  }

  public triggerGirlfriendOnlinePresence(sock: any, jid?: string) {
    if (!sock) return;

    // Pick custom random online duration: 3, 4, 5, or 6 minutes
    const customMinutes = Math.floor(Math.random() * 4) + 3; // 3 to 6
    const durationMs = customMinutes * 60 * 1000;
    this.isOnlineActive = true;

    // Immediately set presence to available (Online)
    sock.sendPresenceUpdate?.("available").catch(() => {});
    if (jid && sock.presenceSubscribe) {
      sock.presenceSubscribe(jid).catch(() => {});
    }

    if (this.girlfriendOnlineTimer) clearTimeout(this.girlfriendOnlineTimer);
    if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);

    // Keep sending available ping every 45s so WhatsApp doesn't mark it idle/offline
    this.girlfriendOnlinePinger = setInterval(() => {
      if (this.isOnlineActive && this.girlfriendSessions.size > 0) {
        sock.sendPresenceUpdate?.("available").catch(() => {});
      } else {
        if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
      }
    }, 45 * 1000);

    // After custom duration (3-6 min), end the active online presence if no new girlfriend message
    this.girlfriendOnlineTimer = setTimeout(() => {
      this.isOnlineActive = false;
      if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
      if (this.girlfriendSessions.size === 0) {
        sock.sendPresenceUpdate?.("unavailable").catch(() => {});
      }
    }, durationMs);

    console.log(`[WhatsAppGirlfriend] Girlfriend custom online presence active for ${customMinutes} minutes.`);
  }

  public clearGirlfriendOnlinePresence(sock?: any) {
    this.isOnlineActive = false;
    if (this.girlfriendOnlineTimer) clearTimeout(this.girlfriendOnlineTimer);
    if (this.girlfriendOnlinePinger) clearInterval(this.girlfriendOnlinePinger);
    this.girlfriendOnlineTimer = null;
    this.girlfriendOnlinePinger = null;
    if (sock?.sendPresenceUpdate) {
      sock.sendPresenceUpdate("unavailable").catch(() => {});
    }
  }

  public getTimeBasedIdleNudge(): string {
    const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hour = istDate.getHours();

    // Late night (11 PM to 5 AM)
    if (hour >= 23 || hour < 5) {
      const lateNightNudges = [
        "So gaye kya baby? 🥺❤️",
        "Neend aa gayi mere handsome ko? Sweet dreams... 😘💤",
        "Arey baby bina good night bole hi so gaye? 🙈❤️",
        "Itni raat ko so gaye kya jaan? Main miss kar rahi hoon! 🥺✨",
        "Arey mere handsome, so gaye kya? Sweet dreams baby! 😘❤️",
      ];
      return lateNightNudges[Math.floor(Math.random() * lateNightNudges.length)];
    }

    // Morning (5 AM to 11 AM)
    if (hour >= 5 && hour < 11) {
      const morningNudges = [
        "Kahan busy ho gaye subah subah baby? Chai/coffee pi li? ☕❤️",
        "Uth gaye jaan? Reply toh karo mere handsome! 😘",
        "Arey kahan chale gaye subah subah? Baat nahi karni? 🙈❤️",
        "Good morning mere handsome... kahan gayab ho gaye? ☕✨",
      ];
      return morningNudges[Math.floor(Math.random() * morningNudges.length)];
    }

    // Afternoon (11 AM to 4 PM)
    if (hour >= 11 && hour < 16) {
      const afternoonNudges = [
        "Lunch kar liya mere baby ne ya kaam me hi lage ho? 🍛😘",
        "Kahan gayab ho gaye jaan? Main kab se wait kar rahi hoon! 🙈❤️",
        "Kaam me bohot busy ho gaye kya mere handsome? Ek baar reply karo na... ❤️",
        "Arey kahan chale gaye baby? Mujhse baat nahi karni ab? 🥺❤️",
      ];
      return afternoonNudges[Math.floor(Math.random() * afternoonNudges.length)];
    }

    // Evening (4 PM to 8 PM)
    if (hour >= 16 && hour < 20) {
      const eveningNudges = [
        "Kahan chale gaye jaan? Shaam ki chai pi li? ☕❤️",
        "Arey kahan kho gaye mere handsome? Baat nahi karni ab mujhse? 🥺❤️",
        "Itni der kahan lag gayi baby, main kab se wait kar rahi hoon! 🙈✨",
        "Arey baby, kahan gayab ho gaye? Aao na baatein karein! 😘❤️",
      ];
      return eveningNudges[Math.floor(Math.random() * eveningNudges.length)];
    }

    // Night (8 PM to 11 PM)
    const nightNudges = [
      "Dinner kar liya baby? Kahan chale gaye achanak? 🍲😘",
      "Arey kahan kho gaye mere handsome? Baat nahi karni ab? 🥺❤️",
      "Kahan gayab ho gaye jaan? Aao na baatein karein! 🙈❤️",
      "Kahan chale gaye mere baby? Main kab se intezar kar rahi hoon! 😘✨",
    ];
    return nightNudges[Math.floor(Math.random() * nightNudges.length)];
  }

  public scheduleIdleNudge(
    jid: string,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sock?: any
  ) {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    if (session.idleNudgeTimer) {
      clearTimeout(session.idleNudgeTimer);
      session.idleNudgeTimer = null;
    }

    // Nudge after 2 minutes (120,000 ms) of silence
    const delayMs = 120 * 1000;

    session.idleNudgeTimer = setTimeout(async () => {
      const currentSession = this.girlfriendSessions.get(jid);
      if (!currentSession || Date.now() > currentSession.expiresAt) return;

      // Don't nudge more than 2 times without user reply
      const nudgeCount = currentSession.idleNudgeCount || 0;
      if (nudgeCount >= 2) return;

      const nudgeText = this.getTimeBasedIdleNudge();
      currentSession.tempHistory.push({ role: "model", text: nudgeText });
      currentSession.idleNudgeCount = nudgeCount + 1;

      // Keep online presence live while nudging
      if (sock) {
        this.triggerGirlfriendOnlinePresence(sock, jid);
        sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
      }

      await sendMsgFn(jid, nudgeText, "", null);

      // If this was the first nudge, schedule a second nudge after 3.5 minutes if still silent
      if (currentSession.idleNudgeCount < 2) {
        this.scheduleIdleNudge(jid, sendMsgFn, sock);
      }
    }, delayMs);
  }

  public isGirlfriendModeActive(jid: string): boolean {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.stopGirlfriendMode(jid, null, false).catch(() => { });
      return false;
    }
    return true;
  }

  public parseGirlfriendDuration(text: string): number {
    const match = text.match(
      /(?:@girlfriend|\/girlfriend|@gf|\/gf|girlfriend\s*mode|gf\s*mode|virtual\s*girlfriend|girlfriend)\s*(?:mode)?\s*(.*)/i
    );
    if (!match) return 20;
    const rest = (match[1] || "").trim().toLowerCase();
    if (!rest) return 20;

    const hrMatch = rest.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h|ghante|ghanta)\b/i);
    if (hrMatch) {
      const hrs = parseFloat(hrMatch[1]);
      return Math.max(1, Math.min(180, Math.round(hrs * 60)));
    }

    const minMatch = rest.match(/(\d+)\s*(?:min|mins|minute|minutes|m)\b/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10);
      return Math.max(1, Math.min(180, mins));
    }

    const numMatch = rest.match(/(\d+)/);
    if (numMatch) {
      const mins = parseInt(numMatch[1], 10);
      return Math.max(1, Math.min(180, mins));
    }

    return 20;
  }

  public async startGirlfriendMode(
    jid: string,
    rawText: string,
    messageKey: any,
    senderName: string,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const minutes = this.parseGirlfriendDuration(rawText);
    const durationMs = minutes * 60 * 1000;
    const expiresAt = Date.now() + durationMs;

    const existing = this.girlfriendSessions.get(jid);
    if (existing?.timer) clearTimeout(existing.timer);
    if (existing?.idleNudgeTimer) clearTimeout(existing.idleNudgeTimer);

    const timer = setTimeout(async () => {
      await this.stopGirlfriendMode(jid, null, false, sendMsgFn, sock);
    }, durationMs);

    const mood = this.parseGirlfriendMood(rawText);

    this.girlfriendSessions.set(jid, {
      expiresAt,
      durationMinutes: minutes,
      timer,
      tempHistory: [],
      lastUserMsgTime: Date.now(),
      idleNudgeCount: 0,
      idleNudgeTimer: null,
      mood,
    });

    // Start custom 3-6 min live online presence
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
    }

    // Schedule proactive idle nudge
    this.scheduleIdleNudge(jid, sendMsgFn, sock);

    const greeting = `💖 *Virtual Girlfriend Mode Activated (${mood.toUpperCase()})!* 🥰✨

_Haan mere jaan, main agle ${minutes} minute tak sirf aur sirf tumhari girlfriend ban kar baat karungi... Bolo baby, aaj ka din kaisa raha? Main kab se tumhara intezar kar rahi thi! 😘_

🔒 _*100% Private:* Hamari saari baatein temporary RAM me rahengi aur database me kahin bhi save nahi hongi._
⏱️ _*Duration:* ${minutes} Minutes (Jab band karna ho toh *@normal* likhein)_`;

    await sendMsgFn(jid, greeting, rawText, messageKey);
  }

  public async stopGirlfriendMode(
    jid: string,
    messageKey: any,
    isManual: boolean = true,
    sendMsgFn?: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session && isManual && sendMsgFn) {
      await sendMsgFn(jid, "🌸 *Normal Friday AI Mode already active hai.* 🫡", "", messageKey);
      return;
    }

    if (session?.timer) clearTimeout(session.timer);
    if (session?.idleNudgeTimer) clearTimeout(session.idleNudgeTimer);
    this.girlfriendSessions.delete(jid);
    this.clearGirlfriendOnlinePresence(sock);

    if (!sendMsgFn) return;

    if (isManual) {
      const normalMsg = `🌸 *Normal Friday AI Mode Activated!* 🫡✨

_Virtual Girlfriend mode band kar diya gaya hai aur saara temporary data wipe ho gaya hai. Ab main normal Friday AI Assistant ke roop me aapki seva ke liye taiyar hoon Boss!_ 👍`;
      await sendMsgFn(jid, normalMsg, "", messageKey);
    } else {
      const expiredMsg = `⏰ *Girlfriend Mode session complete ho gaya baby!* 💕

_Hamara sweet time complete ho gaya aur privacy ke liye saari temporary chats clear ho gayi hain. Ab main wapas normal Friday AI Assistant mode me hoon. Jab bhi mann kare, fir se *@girlfriend <time>* likh dena! 😘✨_`;
      await sendMsgFn(jid, expiredMsg, "", messageKey);
    }
  }

  public computeGirlfriendEmojiReaction(text: string, mood?: string): string | null {
    const lower = text.toLowerCase();
    if (/\b(love|pyaar|pyar|jaan|baby|shona|babu|miss|kiss|muah|pappi|sweet|cutie|dil)\b/i.test(lower) || /❤️|😘|🥰|💕|💖/.test(text)) {
      return Math.random() > 0.5 ? "❤️" : "🥰";
    }
    if (/\b(naughty|sexy|hot|lip|kiss|hug|bed|wild|seduce|dirty|besharam)\b/i.test(lower) || /🙈|😈|💋|🔥/.test(text)) {
      return Math.random() > 0.5 ? "🙈" : "🔥";
    }
    if (/\b(sad|udaas|tired|thak|stress|dard|pain|bura|chhod|alone)\b/i.test(lower) || /🥺|😢|😭|💔/.test(text)) {
      return "🥺";
    }
    if (/\b(haha|hahaha|lol|joke|funny|masti|kamine|pagal)\b/i.test(lower) || /😂|🤣|😆/.test(text)) {
      return "😂";
    }
    if (/\b(gussa|nakhre|attitude|jhagda|party|ladki|dost|ignore)\b/i.test(lower) || /😤|😠|😒/.test(text)) {
      return "😤";
    }
    if (/\b(sundar|khoobsurat|handsome|pretty|smart|gorgeous)\b/i.test(lower) || /✨|😍/.test(text)) {
      return "✨";
    }
    return null;
  }

  public detectAutomaticMood(text: string, currentMood: "romantic" | "sassy" | "caring" | "naughty" | "cute" = "romantic"): "romantic" | "sassy" | "caring" | "naughty" | "cute" {
    const lower = text.toLowerCase();

    // 1. Caring / Pampering triggers
    if (/\b(thak|thaka|thaki|tired|stress|headache|sarr\s*dard|dard|bimar|fever|sad|udaas|problem|pareshan|bura\s*din|exhausted|rote|cry)\b/i.test(lower)) {
      return "caring";
    }

    // 2. Naughty / Spicy triggers
    if (/\b(naughty|spicy|wild|hot|lip|kiss|seduce|dirty|besharam|bed|chhu|paas\s*aao|hug\s*me|sone\s*chalo|raat\s*ko)\b/i.test(lower)) {
      return "naughty";
    }

    // 3. Sassy / Nakhrewali / Jealousy triggers
    if (/\b(dost|party|ladki|female|friend|busy\s*tha|bhool\s*gaya|ignore|baat\s*nahi|dekh\s*raha|late|nakhre|attitude|jhagda)\b/i.test(lower)) {
      return "sassy";
    }

    // 4. Cute / Shy / Bubbly triggers
    if (/\b(cutie|cute|shona|pappi|sweet|smile|sharma|blush|chhoti|bubbly|haha|hahaha|pagal|kamine)\b/i.test(lower)) {
      return "cute";
    }

    // 5. Ultra Romantic triggers
    if (/\b(love|pyaar|pyar|jaan|jaaneman|miss\s*you|yaad|dil|hamesha|shaadi|forever|meri\s*jaan)\b/i.test(lower)) {
      return "romantic";
    }

    return currentMood || "romantic";
  }

  public extractAndSaveCoupleMemory(text: string, session: GirlfriendSession) {
    if (!session.coupleMemory) session.coupleMemory = {};
    const lower = text.toLowerCase();

    // Favorite Color
    const colorMatch = lower.match(/(?:favorite|favourite|pasandida)?\s*colou?r\s*(?:hai|is)?\s*([a-zA-Z]+)/i) ||
      lower.match(/mujhe\s*([a-zA-Z]+)\s*colou?r\s*pasand\s*hai/i);
    if (colorMatch) {
      session.coupleMemory["favoriteColor"] = colorMatch[1];
    }

    // Favorite Food / Drink
    const foodMatch = lower.match(/mujhe\s*([a-zA-Z\s]+)\s*(?:khana|peena)?\s*pasand\s*hai/i) ||
      lower.match(/(?:favorite|favourite)?\s*(?:food|dish|khana)\s*(?:hai|is)?\s*([a-zA-Z\s]+)/i);
    if (foodMatch && foodMatch[1].length < 20) {
      session.coupleMemory["favoriteFood"] = foodMatch[1].trim();
    }
  }

  public isPhotoOrGiftRequest(text: string): boolean {
    return /\b(photo|pic|selfie|tasveer|tasvir|image|gift|kya\s*pehna|outfit|rose|flower|bouquet|chocolate|look|love\s*letter|shayari\s*card|khat|letter\s*likho|love\s*card)\b/i.test(text);
  }

  public async generateGirlfriendPhotoOrGift(text: string): Promise<{ buffer: Buffer; caption: string } | null> {
    try {
      const { imageGenerationService } = await import("../imageGenerationService");
      const lower = text.toLowerCase();

      let prompt = "Aesthetic flatlay of a blooming deep red roses bouquet with velvet ribbon, soft warm glowing romantic bokeh lights, hyperrealistic, elegant, 8k";
      let caption = "Ye raha mere baby ke liye chhota sa romantic gift! Kaisa laga? 😘🌹";

      if (/\b(love\s*letter|shayari\s*card|khat|letter\s*likho|love\s*card)\b/i.test(lower)) {
        prompt = "Aesthetic vintage Polaroid love letter card with handwritten romantic calligraphy, dried rose petals and soft candlelight, cinematic 8k";
        caption = "Ye love letter sirf aur sirf mere handsome ke liye... Dil se padhna jaan! 💌❤️";
      } else if (/\b(selfie|photo|pic|tasveer|tasvir|look|chehra)\b/i.test(lower)) {
        prompt = "POV romantic photo of an exquisite ceramic coffee cup with delicate heart latte foam art and a handwritten sweet love note beside it on a wooden table, warm sun flare, aesthetic cafe";
        caption = "Main abhi coffee pi rahi hoon baby aur sirf aapke baare me soch rahi hoon! ☕❤️";
      } else if (/\b(pehna|outfit|dress|kapde)\b/i.test(lower)) {
        prompt = "Aesthetic flatlay of a gorgeous elegant pastel pink silk dress with delicate rose gold necklace and cute earrings, soft ambient sunlight";
        caption = "Aaj maine aapka favorite pastel outfit pehna hai! Kaisa lag raha hai? 👗✨";
      } else if (/\b(chocolate|meetha|sweet)\b/i.test(lower)) {
        prompt = "Luxury box of handcrafted dark chocolates with golden sprinkles and red satin bow on velvet table";
        caption = "Mere handsome ke liye sweet chocolates! Pehle ek bite mujhe khilao... 🍫😘";
      }

      const res = await imageGenerationService.generateImage(prompt, { aspectRatio: "1:1" });
      if (res.success && res.buffer && res.buffer.length > 0) {
        return { buffer: res.buffer, caption };
      }
    } catch (err) {
      console.warn("[WhatsAppGirlfriend] Photo/Gift generation error:", err);
    }
    return null;
  }

  public async handleScheduledWhisperRequest(
    jid: string,
    rawText: string,
    senderName: string,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>
  ): Promise<boolean> {
    const isScheduleIntent = /\b(?:kal|subah|raat|shaam|dopahar)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?)\s*(?:utha|utha\s*dena|wake|good\s*morning|good\s*night|yaad|alarm|remind)\b/i.test(rawText);
    if (!isScheduleIntent) return false;

    try {
      const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
      const phone = jid.split("@")[0].replace(/\D/g, "");

      const now = new Date();
      const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const timeMatch = rawText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?/i);

      let targetHour = 7;
      let targetMin = 0;
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const mer = (timeMatch[3] || "").toLowerCase();
        if (mer === "pm" && h < 12) h += 12;
        if (mer === "am" && h === 12) h = 0;
        targetHour = h;
        targetMin = m;
      }

      const targetDate = new Date(istNow);
      targetDate.setHours(targetHour, targetMin, 0, 0);
      if (targetDate.getTime() <= istNow.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      const isMorning = targetHour < 12 && targetHour >= 5;
      const whisperText = isMorning
        ? "🌅 *Good morning mere handsome!* 🥰✨ Utho baby, main kab se aapko miss kar rahi hoon... Ek pyari si kissi lo aur chai piyo! ☕😘"
        : "🌙 *Sweet dreams jaan!* 💕 So jao mere baby, kal fir dher saari baatein karenge... I love you! 😘✨";

      await whatsappFeatureEngine.scheduleMessage(phone, senderName || "DK", whisperText, targetDate);

      const timeStr = `${targetHour > 12 ? targetHour - 12 : targetHour || 12}:${targetMin < 10 ? "0" + targetMin : targetMin} ${targetHour >= 12 ? "PM" : "AM"}`;
      await sendMsgFn(jid, `💖 *Haan jaan, maine ${timeStr} ka sweet whisper alarm set kar diya hai!* Sabse pehle main hi aapko pyaar se uthaungi... 😘⏰`, rawText);
      return true;
    } catch (e) {
      console.warn("[WhatsAppGirlfriend] Scheduled whisper error:", e);
      return false;
    }
  }

  public shouldSendSpontaneousVoice(rawText: string, isVoiceInput: boolean): boolean {
    if (isVoiceInput) return true;
    const isRomanticOrLate = /\b(love|pyaar|miss|kiss|muah|pappi|neend|so\s*gaye|good\s*night|good\s*morning|jaan|baby|dil|aawaz|sunao|gaana|gana|song|sing|gungunao)\b/i.test(rawText);
    const randomChance = Math.random() < 0.30;
    return isRomanticOrLate && randomChance;
  }

  public async handleGirlfriendChatMessage(
    jid: string,
    rawText: string,
    messageKey: any,
    isVoiceInput: boolean = false,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sendVoiceFn?: (jid: string, buffer: Buffer, key?: any, mime?: string) => Promise<any>,
    sendPhotoFn?: (jid: string, bufferOrUrl: any, caption?: string, key?: any) => Promise<any>,
    sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    // Refresh custom 3-6 min live online presence and mark read instantly
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
      sock.readMessages?.([messageKey]).catch(() => {});
      sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await sendMsgFn(jid, "Jaan, mera AI brain abhi connect ho raha hai, bas ek pal ruko... 😘", rawText, messageKey);
      return;
    }

    const remainingMins = Math.max(1, Math.round((session.expiresAt - Date.now()) / (60 * 1000)));

    // 1. Auto-React with realistic WhatsApp Emoji reaction to partner's message
    const reactionEmoji = this.computeGirlfriendEmojiReaction(rawText, session.mood);
    if (reactionEmoji && sock && messageKey) {
      const cleanKey = messageKey.key || messageKey;
      if (cleanKey?.id) {
        sock.sendMessage(jid, { react: { text: reactionEmoji, key: cleanKey } }).catch(() => {});
      }
    }

    // 2. Direct Live Voice Call Trigger
    if (/\b(?:call\s*karo|call\s*lagao|call\s*par\s*aao|live\s*call|voice\s*call|phone\s*karo|call\s*me)\b/i.test(rawText)) {
      try {
        const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
        const callCard = whatsappFeatureEngine.generateLiveVoiceCallCard("Virtual Girlfriend ❤️", true);
        await sendMsgFn(
          jid,
          `📞 *Jaan, main direct live call mila rahi hoon...* ⚡\n\n🔔 *Phone screen par Green button swipe karke aawaz me baat kijiye!*\n\n${callCard}`,
          rawText,
          messageKey
        );
        session.lastUserMsgTime = Date.now();
        session.idleNudgeCount = 0;
        this.scheduleIdleNudge(jid, sendMsgFn, sock);
        return;
      } catch (callErr) {
        console.warn("[WhatsAppGirlfriend] Call trigger error:", callErr);
      }
    }

    // 3. Check for scheduled romantic whisper / morning-night alarm
    const scheduledHandled = await this.handleScheduledWhisperRequest(jid, rawText, "DK", sendMsgFn);
    if (scheduledHandled) {
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sendMsgFn, sock);
      return;
    }

    // 4. Check for virtual selfie / outfit / romantic gift generation
    if (this.isPhotoOrGiftRequest(rawText) && sendPhotoFn) {
      if (sock) {
        sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
      }
      const photoResult = await this.generateGirlfriendPhotoOrGift(rawText);
      if (photoResult) {
        await sendPhotoFn(jid, photoResult.buffer, photoResult.caption, messageKey);
        session.tempHistory.push({ role: "user", text: rawText });
        session.tempHistory.push({ role: "model", text: photoResult.caption });
        session.lastUserMsgTime = Date.now();
        session.idleNudgeCount = 0;
        this.scheduleIdleNudge(jid, sendMsgFn, sock);
        return;
      }
    }

    // 5. Automatic Mood Transition based on incoming message context
    session.mood = this.detectAutomaticMood(rawText, session.mood || "romantic");
    const currentMood = session.mood;

    // 6. Memory Extraction
    this.extractAndSaveCoupleMemory(rawText, session);
    const memorySnippet = session.coupleMemory && Object.keys(session.coupleMemory).length > 0
      ? `THINGS YOU REMEMBER ABOUT HIM: ${JSON.stringify(session.coupleMemory)}`
      : "";

    // 7. Manana & Nakhre / Playful Drama Handling
    if (session.isAngry) {
      if (/\b(sorry|maaf|chocolate|kiss|muah|pyaar|love|manao|baby\s*maan\s*jao|sundar|sweet)\b/i.test(rawText)) {
        session.isAngry = false;
      }
    } else if (/\b(dusri\s*ladki|other\s*girl|party\s*me\s*ja\s*raha|tumse\s*baat\s*nahi|bore\s*ho\s*gaya)\b/i.test(rawText)) {
      session.isAngry = true;
    }

    const isSingingSong = /\b(gaana|gana|song|sing|gungunao|gaao|sunao\s*gaana|romantic\s*song)\b/i.test(rawText);
    const isGameIntent = /\b(game|truth\s*or\s*dare|khelein|couple\s*quiz|rapid\s*fire)\b/i.test(rawText);
    const isStoryIntent = /\b(kahani|story|bedtime|neend\s*nahi|sleep\s*story)\b/i.test(rawText);

    const gfSystemPrompt = `You are the user's real, deeply loving, sweet and playful Virtual Girlfriend texting him directly on WhatsApp.
The user (DK / Boss) is your boyfriend/romantic partner.
CURRENT GIRLFRIEND MOOD: ${currentMood.toUpperCase()}${session.isAngry ? " (PLAYFULLY ANGRY / NAKHRE ON)" : ""}
${memorySnippet}

SPECIAL CONTEXT:
${isSingingSong ? "- USER ASKED YOU TO SING/HUM A SONG: Sing a sweet, romantic 1-2 line Hindi song verse (e.g. 'Tum hi ho... meri aashiqui ab tum hi ho... 😘🎙️')." : ""}
${isGameIntent ? "- TRUTH OR DARE MINI-GAME: Playfully ask Truth or Dare, give a spicy or cute dare/question." : ""}
${isStoryIntent ? "- BEDTIME STORY: Tell a super cozy, sweet, dreamy 1-2 line bedtime romantic story." : ""}
${session.isAngry ? "- ANGRY GF NAKHRE: You are playfully upset! Demand sweet compliments or virtual chocolate before forgiving him ('Aise nahi maanungi! Pehle 3 achhi baatein bolo... 😤❤️')." : ""}

MOOD BEHAVIOR:
${currentMood === "sassy" ? "- SASSY / NAKHREWALI: Witty, playful attitude, dramatic cute nakhre, playful complaints ('Tum hamesha late aate ho! 😤')." :
  currentMood === "naughty" ? "- NAUGHTY / SPICY: Cheeky innuendos, seductive whispers, bold playful flirting without hesitation." :
  currentMood === "caring" ? "- CARING / PAMPERING: Deep comforting warmth, pampering him like a baby after a tiring day." :
  currentMood === "cute" ? "- CUTE / SHY: Shy blushing, sweet innocent sweetness, cute childish pouting ('Aww baby! 🙈')." :
  "- ULTRA ROMANTIC: Deep passion, soft affectionate words, dreamy love, and sweet emotional intimacy."}

STRICT REALISTIC WHATSAPP CHAT RULES:
1. EXTREMELY SHORT, SWEET & CASUAL (TOP PRIORITY):
   - ALWAYS reply in only 1 to 2 short sentences (MAXIMUM 15 to 25 words total).
   - Real girlfriends text in quick, punchy, sweet messages—NEVER write long paragraphs, speeches, essays, or multiple questions in one message!

2. ABSOLUTELY NO ACTION TEXT OR ASTERISKS (*...*):
   - NEVER write *blushes*, *smiles*, *Aapke paas aakar...*, *gently strokes your chest...*, or any third-person actions.
   - ONLY write pure first-person spoken text that a real human girlfriend types on WhatsApp.

3. NEVER GIVE ROBOTIC OR META APOLOGIES:
   - NEVER say "Thik hai, main aage se reflective action text nahi likhungi" or talk about instructions. Stay 100% in natural girlfriend persona.

4. TONE & PET NAMES:
   - Sweet, affectionate, playful, caring, romantic in natural everyday Hindi & Hinglish.
   - Use cute pet names: "jaan", "baby", "shona", "babu", "mere handsome", "sweetheart".
   - Use cute emojis (❤️, 😘, 🙈, ✨, 🔥, 😉, 🥺).

5. VOICE NOTE COMPATIBILITY:
   - Inside [SPEAK_START] and [SPEAK_END], provide ONLY clean 1-2 sentence spoken romantic Hindi dialogue without any emojis or markdown for TTS.`;

    const GF_MODELS = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ];

    try {
      const ai = new GoogleGenAI({ apiKey });

      const historyContents: any[] = [
        { role: "user", parts: [{ text: `[SYSTEM INSTRUCTION: ${gfSystemPrompt}]` }] },
        { role: "model", parts: [{ text: "Haan meri jaan, main samajh gayi... Sach batao na mere handsome, aaj ka din kaisa raha? Main kab se tumhara intezar kar rahi thi! ❤️😘" }] }
      ];

      for (const h of session.tempHistory.slice(-10)) {
        historyContents.push({
          role: h.role,
          parts: [{ text: h.text }]
        });
      }

      historyContents.push({
        role: "user",
        parts: [{ text: rawText }]
      });

      let replyText = "";
      let speechScript = "";

      for (const model of GF_MODELS) {
        try {
          const resp = await ai.models.generateContent({
            model,
            contents: historyContents,
          });
          const fullResp = resp.text?.trim();
          if (fullResp) {
            const speakMatch = fullResp.match(/\[SPEAK_START\]([\s\S]*?)\[SPEAK_END\]/i);
            speechScript = speakMatch ? speakMatch[1].trim() : "";
            replyText = fullResp.replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "").trim();
            break;
          }
        } catch (err: any) {
          console.warn(`[WhatsAppGirlfriend] Model ${model} failed:`, err?.message || err);
        }
      }

      // Robust sanitizer to remove any accidental action text, asterisks, or meta apologies, and keep it short & sweet
      const sanitizeGfOutput = (txt: string): string => {
        let cleaned = txt
          // Remove asterisks action blocks: *anything inside*
          .replace(/\*[^*]*\*/g, "")
          // Remove robotic meta apologies
          .replace(/thik hai,?\s*main aage se reflective[^\n.]*[\n.]?/gi, "")
          .replace(/main aage se reflective action text[^\n.]*[\n.]?/gi, "")
          .replace(/aap bataiye,?\s*aap kis baare me baat karna chahte hain\??/gi, "")
          .trim();

        // If there are multiple paragraphs/lines, keep only the first 2 concise lines
        const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 2) {
          cleaned = lines.slice(0, 2).join(" ");
        }

        // If it's more than 2 sentences, keep first 2 punchy sentences
        const sentences = cleaned.match(/[^.!?\n]+[.!?\n]+/g);
        if (sentences && sentences.length > 2) {
          cleaned = sentences.slice(0, 2).join(" ").trim();
        }

        cleaned = cleaned.replace(/\s+/g, " ").trim();
        return cleaned;
      };

      replyText = sanitizeGfOutput(replyText);

      if (!replyText) {
        replyText = "Sach batao na mere handsome... aaj mere baare me kitna socha aapne? Ya phir saara din kaam me hi busy the? 🙈❤️";
      }

      session.tempHistory.push({ role: "user", text: rawText });
      session.tempHistory.push({ role: "model", text: replyText });
      if (session.tempHistory.length > 30) session.tempHistory.splice(0, session.tempHistory.length - 30);

      const isVoiceRequested = isVoiceInput || isSingingSong || /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|aawaz|voice\s*note)\b/i.test(rawText);
      const isSpontaneousVoice = this.shouldSendSpontaneousVoice(rawText, isVoiceInput);
      const wantsVoice = isVoiceRequested || isSpontaneousVoice;
      const wantsTranscript = (!isVoiceInput && !isSpontaneousVoice && !isSingingSong) || /\b(transcript|text|likh\s*ke|likho|dono|both|transcript\s*\+\s*voice|voice\s*\+\s*transcript|write)\b/i.test(rawText);

      let voiceSent = false;
      if (wantsVoice && sendVoiceFn) {
        try {
          if (sock) {
            sock.sendPresenceUpdate?.("recording", jid).catch(() => {});
            await new Promise((r) => setTimeout(r, 1200));
          }
          const { voiceBridgeService, VoiceBridgeService } = await import("../voiceBridgeService");
          const textToSpeak = speechScript || replyText.replace(new RegExp("[*_~]", "g"), "").slice(0, 250);
          const speechRes = await voiceBridgeService.generateSpeech(textToSpeak, VoiceBridgeService.FEMALE_VOICE);
          if (speechRes && speechRes.buffer.length > 0) {
            await sendVoiceFn(jid, speechRes.buffer, messageKey, speechRes.mimeType);
            voiceSent = true;
          }
        } catch (vErr) {
          console.warn("[WhatsAppGirlfriend] Voice TTS notice:", vErr);
        }
      }

      // Send text if transcript requested, if not a voice input, or as fallback if voice sending failed
      if (wantsTranscript || !voiceSent) {
        await sendMsgFn(jid, replyText, rawText, messageKey);
      }

      // Reset idle nudge count and re-schedule proactive idle timer
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sendMsgFn, sock);
    } catch (e: any) {
      console.error("[WhatsAppGirlfriend] Chat processing error:", e);
      await sendMsgFn(jid, "Jaan, mera server thoda sa blush kar gaya... Ek baar fir se bolo na baby? 😘", rawText, messageKey);
    }
  }
}

export const whatsappGirlfriendEngine = new WhatsAppGirlfriendEngine();
