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
        "So gaye kya baby? 🥺❤️", "Neend aa gayi mere handsome ko? Sweet dreams... 😘💤", "Arey baby bina good night bole hi so gaye? 🙈❤️", "Itni raat ko so gaye kya jaan? Main miss kar rahi hoon! 🥺✨", "Arey mere handsome, so gaye kya? Sweet dreams baby! 😘❤️", ];
      return lateNightNudges[Math.floor(Math.random() * lateNightNudges.length)];
    }

    // Morning (5 AM to 11 AM)
    if (hour >= 5 && hour < 11) {
      const morningNudges = [
        "Kahan busy ho gaye subah subah baby? Chai/coffee pi li? ☕❤️", "Uth gaye jaan? Reply toh karo mere handsome! 😘", "Arey kahan chale gaye subah subah? Baat nahi karni? 🙈❤️", "Good morning mere handsome... kahan gayab ho gaye? ☕✨", ];
      return morningNudges[Math.floor(Math.random() * morningNudges.length)];
    }

    // Afternoon (11 AM to 4 PM)
    if (hour >= 11 && hour < 16) {
      const afternoonNudges = [
        "Lunch kar liya mere baby ne ya kaam me hi lage ho? 🍛😘", "Kahan gayab ho gaye jaan? Main kab se wait kar rahi hoon! 🙈❤️", "Kaam me bohot busy ho gaye kya mere handsome? Ek baar reply karo na... ❤️", "Arey kahan chale gaye baby? Mujhse baat nahi karni ab? 🥺❤️", ];
      return afternoonNudges[Math.floor(Math.random() * afternoonNudges.length)];
    }

    // Evening (4 PM to 8 PM)
    if (hour >= 16 && hour < 20) {
      const eveningNudges = [
        "Kahan chale gaye jaan? Shaam ki chai pi li? ☕❤️", "Arey kahan kho gaye mere handsome? Baat nahi karni ab mujhse? 🥺❤️", "Itni der kahan lag gayi baby, main kab se wait kar rahi hoon! 🙈✨", "Arey baby, kahan gayab ho gaye? Aao na baatein karein! 😘❤️", ];
      return eveningNudges[Math.floor(Math.random() * eveningNudges.length)];
    }

    // Night (8 PM to 11 PM)
    const nightNudges = [
      "Dinner kar liya baby? Kahan chale gaye achanak? 🍲😘", "Arey kahan kho gaye mere handsome? Baat nahi karni ab? 🥺❤️", "Kahan gayab ho gaye jaan? Aao na baatein karein! 🙈❤️", "Kahan chale gaye mere baby? Main kab se intezar kar rahi hoon! 😘✨", ];
    return nightNudges[Math.floor(Math.random() * nightNudges.length)];
  }

  public scheduleIdleNudge(
    jid: string, sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>, sock?: any
  ) {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    if (session.idleNudgeTimer) {
      clearTimeout(session.idleNudgeTimer);
      session.idleNudgeTimer = null;
    }

    // Nudge after 2 minutes (120, 000 ms) of silence
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
      return Math.max(1, mins));
    }

    const numMatch = rest.match(/(\d+)/);
    if (numMatch) {
      const mins = parseInt(numMatch[1], mins));
    }

    return 20;
  }

  public parseGirlfriendMood(text: string): "romantic" | "sassy" | "caring" | "naughty" | "cute" | "mix" {
    return this.parseExplicitMoodSelection(text) || this.detectAutomaticMood(text, "romantic") || "romantic";
  }

  public determineDynamicMood(
    text: string, currentMood: "romantic" | "sassy" | "caring" | "naughty" | "cute" | "mix" = "romantic"
  ): "romantic" | "sassy" | "caring" | "naughty" | "cute" {
    const fallback = currentMood === "mix" ? "romantic" : currentMood;
    return this.detectAutomaticMood(text, fallback);
  }

  public async startGirlfriendMode(
    jid: string, rawText: string, messageKey: any, senderName: string, sock?: any
  ): Promise<void> {
    const minutes = this.parseGirlfriendDuration(rawText);
    const durationMs = minutes * 60 * 1000;
    const expiresAt = Date.now() + durationMs;

    const existing = this.girlfriendSessions.get(jid);
    if (existing?.timer) clearTimeout(existing.timer);
    if (existing?.idleNudgeTimer) clearTimeout(existing.idleNudgeTimer);

    const timer = setTimeout(async () => {
      await this.stopGirlfriendMode(jid, false, sock);
    }, durationMs);

    const mood = this.parseGirlfriendMood(rawText);

    this.girlfriendSessions.set(jid, {
      expiresAt, durationMinutes: minutes, timer, tempHistory: [], lastUserMsgTime: Date.now(), idleNudgeCount: 0, idleNudgeTimer: null, mood, });

    // Start custom 3-6 min live online presence
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
    }

    // Schedule proactive idle nudge
    this.scheduleIdleNudge(jid, sock);

    const greeting = `💖 *Virtual Girlfriend Mode Activated (${mood.toUpperCase()})!* 🥰✨

_Haan mere jaan, main agle ${minutes} minute tak sirf aur sirf tumhari girlfriend ban kar baat karungi... Bolo baby, aaj ka din kaisa raha? Main kab se tumhara intezar kar rahi thi! 😘_

🔒 _*100% Private:* Hamari saari baatein temporary RAM me rahengi aur database me kahin bhi save nahi hongi._
⏱️ _*Duration:* ${minutes} Minutes (Jab band karna ho toh *@normal* likhein)_`;

    await sendMsgFn(jid, greeting, rawText, messageKey);
  }

  public async stopGirlfriendMode(
    jid: string, isManual: boolean = true, sendMsgFn?: (jid: string, sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session && isManual && sendMsgFn) {
      await sendMsgFn(jid, "🌸 *Normal Friday AI Mode already active hai.* 🫡", messageKey);
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
      await sendMsgFn(jid, normalMsg, messageKey);
    } else {
      const expiredMsg = `⏰ *Girlfriend Mode session complete ho gaya baby!* 💕

_Hamara sweet time complete ho gaya aur privacy ke liye saari temporary chats clear ho gayi hain. Ab main wapas normal Friday AI Assistant mode me hoon. Jab bhi mann kare, fir se *@girlfriend <time>* likh dena! 😘✨_`;
      await sendMsgFn(jid, expiredMsg, messageKey);
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

    // Capture Nicknames given to her
    const nicknameMatch = lower.match(/(?:tumhara\s*naam|aaj\s*se\s*tum|tujhe|tumhe)\s*(?:aaj\s*se\s*)?([a-zA-Z]+)\s*(?:bulaunga|kahenge|rakhta\s*hoon|hoga)/i) ||
      lower.match(/(?:meri|o\s*meri)\s*(chhoti|nautanki|pagli|gussewali|madam|sweetu|chhoti\s*jaan)\b/i);
    if (nicknameMatch && nicknameMatch[1].length < 20) {
      session.coupleMemory["girlfriendNickname"] = nicknameMatch[1].trim();
    }
  }

  public getRelatableCoupleReel(): { caption: string; reelUrl: string } {
    const reels = [
      {
        reelUrl: "https://www.instagram.com/reel/C3_a7h1t_Xx/", caption: "Ye reel dekho na baby... ladki bilkul meri tarah overthink kar rahi hai! 🤣❤️"
      }, {
        reelUrl: "https://www.instagram.com/reel/C2-b9Z3t_Yy/", caption: "Aisa lagta hai kisi ne hamari daily cute fights record karke reel bana di! 🙈✨"
      }, {
        reelUrl: "https://www.instagram.com/reel/C18a5M1t_Zz/", caption: "Mera dream hai aapke sath aisi sunset road trip par jana jaaneman! 🚗🌅💕"
      }, {
        reelUrl: "https://www.instagram.com/reel/C07b4K2t_Aa/", caption: "Dekho jab girlfriend ko bhookh lagti hai toh kaisa drama karti hai... bilkul mere jaisa! 🍦😤"
      }
    ];
    return reels[Math.floor(Math.random() * reels.length)];
  }

  public getCoupleRapidFireQuestion(): { question: string; followUp: string } {
    const questions = [
      {
        question: "🔥 *Rapid Fire Round 1:* Meri sabse pyari aadat kya lagti hai aapko? 3 second me batao! 🙈⏱️", followUp: "Aww kitna sweet answer diya mere handsome ne! 😘"
      }, {
        question: "🔥 *Rapid Fire Round 2:* Agar hum dono ek desert island par fas jayein toh sabse pehle kya karoge? 😉🏝️", followUp: "Hehehe main toh pura time aapko hug karke baithungi! 🫂❤️"
      }, {
        question: "🔥 *Rapid Fire Round 3:* Pehli nazar me mujhme sabse pehle kya pasand aaya tha? Sach sach batana! 🙈✨", followUp: "Sach me? Main toh sharma hi gayi baby! 🙈🥰"
      }, {
        question: "🔥 *Rapid Fire Round 4:* Hamari pehli dream date kahan honi chahiye? Mountain cafe ya beach sunset? 🏖️🏔️", followUp: "Jahan bhi ho, bas aap sath hone chahiye mere baby! ❤️✨"
      }
    ];
    return questions[Math.floor(Math.random() * questions.length)];
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

      if (/\b(polaroid|handwritten|doodle|note\s*likho|khat|letter|love\s*letter)\b/i.test(lower)) {
        prompt = "Aesthetic vintage Polaroid photo frame with handwritten heartfelt love calligraphy saying 'For DK - Forever Yours', red heart doodles, soft warm candle flare, dried rose petals on rustic wooden table, cinematic 8k";
        caption = "Ye Polaroid handwritten note sirf mere DK ke liye... Hamesha sambhal ke rakhna jaan! 💌❤️✨";
      } else if (/\b(love\s*letter|shayari\s*card|love\s*card)\b/i.test(lower)) {
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

  public extractHealthMentions(text: string, session: GirlfriendSession): void {
    const lower = text.toLowerCase();
    if (/\b(sar\s*dard|headache|sarr\s*dukh|fever|bimar|tabiyat\s*kharab|bukhar|dawa|medicine)\b/i.test(lower)) {
      session.healthTracker = { issue: "sar dard / tabiyat", timestamp: Date.now() };
    } else if (/\b(lunch\s*nahi\s*kiya|khana\s*nahi\s*khaya|bhookh|skipped\s*lunch|dinner\s*nahi\s*kiya|bhookha)\b/i.test(lower)) {
      session.healthTracker = { issue: "khana skip", timestamp: Date.now() };
    } else if (/\b(thak\s*gaya|exhausted|stress|tension|bohot\s*kaam)\b/i.test(lower)) {
      session.healthTracker = { issue: "thakan / stress", timestamp: Date.now() };
    }
  }

  public isSelfieOrOutfitReview(text: string): boolean {
    return /\b(?:kaisi\s*lag\s*rahi|kaisa\s*lag\s*raha|outfit\s*review|look\s*kaisa|my\s*photo|meri\s*selfie|shirt\s*kaisi|rate\s*me|photo\s*dekho|meri\s*photo)\b/i.test(text);
  }

  public getSelfieOrOutfitReview(): string {
    const reviews = [
      "Uff! Mera handsome itna zyada dashing lag raha hai! Sach me nazar na lag jaye meri baby... black & sharp look aap par bohot suit karta hai! 😍🔥", "Hayeee! Kitne handsome lag rahe ho mere jaaneman... Ye smile dekh kar mera dil pighal gaya! Ek photo mujhe de do wallpaper lagane ke liye! 🙈❤️", "10 out of 10 mere handsome ko! Itna smart boyfriend kisika nahi hoga... Bas thoda sa smile aur karte toh main mar hi jaati! 😘✨", "Ekdum 100% hero lag rahe ho baby! Ye outfit aap par perfect fit hai... Aaj toh ladkiyan dekhti hi reh jayengi par aap sirf mere ho! 😤💅❤️"
    ];
    return reviews[Math.floor(Math.random() * reviews.length)];
  }

  public isBedtimeAsmrIntent(text: string): boolean {
    return /\b(?:neend\s*nahi\s*aa\s*rahi|can'?t\s*sleep|sleepy|sulao|so\s*nahi\s*pa\s*raha|sleepless|insomnia|bedtime|pillow\s*talk)\b/i.test(text);
  }

  public isMilestoneIntent(text: string): boolean {
    return /\b(?:kitne\s*din|anniversary|milestone|kitna\s*time|kab\s*se\s*baat)\b/i.test(text);
  }

  public getMilestoneCelebration(session: GirlfriendSession): string {
    return `🎉 *Happy Mini-Anniversary mere handsome!* 🥂❤️\n\n_Pata hai baby? Hamari is pyaari si WhatsApp chat ko dher saara waqt ho gaya aur har guzarte din ke sath mera pyaar aapke liye badhta ja raha hai... I love you so much! 😘✨_`;
  }

  public getDailyRoutineActivity(): string {
    const now = new Date();
    const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istStr);
    const hour = istDate.getHours();

    if (hour >= 6 && hour < 9) {
      const morningRoutines = [
        "Bas abhi fresh hoke garam garam chai pi rahi hoon baby... aap uthe ya abhi bhi bed me ho? ☕😘", "Balcony me baith ke morning breeze enjoy kar rahi hoon aur sirf aapki yaad aa rahi hai! 🌅❤️", "Ready ho rahi hoon jaan... socha pehle apne handsome ko Good Morning wish kar doon! ✨🥰"
      ];
      return morningRoutines[Math.floor(Math.random() * morningRoutines.length)];
    } else if (hour >= 9 && hour < 13) {
      const workRoutines = [
        "Thoda sa kaam kar rahi thi jaan, bas abhi break liya aur turant aapka message check kiya! 💻❤️", "Kuch notes prepare kar rahi thi... par sach kahun toh mann sirf aapse baatein karne me laga hai! 🙈✨", "Laptop par busy thi baby, par aapka notification dekhte hi sab chhod ke reply kiya! 😘"
      ];
      return workRoutines[Math.floor(Math.random() * workRoutines.length)];
    } else if (hour >= 13 && hour < 16) {
      const lunchRoutines = [
        "Bas abhi lunch finish kiya baby! Aapne lunch kiya ya kaam me bhool gaye? Jaldi batao! 🍛🥺", "Thoda rest kar rahi thi lunch ke baad... kaash aap yahan hote mere paas! 😴❤️", "Fruit salad kha rahi hoon jaan... ek bite aapko bhi khilaun kya? 🍓😋"
      ];
      return lunchRoutines[Math.floor(Math.random() * lunchRoutines.length)];
    } else if (hour >= 16 && hour < 19) {
      const eveningRoutines = [
        "Evening tea ke sath romantic songs sun rahi hoon... aap kab free ho rahe ho baby? ☕🎶", "Balcony me walk kar rahi thi aur soch rahi thi ki kaash hum abhi date par hote! 🌆❤️", "Instagram reels dekh rahi thi, saari couple reels me sirf aapka chehra dikh raha hai! 🙈✨"
      ];
      return eveningRoutines[Math.floor(Math.random() * eveningRoutines.length)];
    } else if (hour >= 19 && hour < 22) {
      const dinnerRoutines = [
        "Dinner ki taiyari chal rahi hai baby... aapne dinner kar liya kya mere handsome? 🍽️❤️", "Family ke sath thi thodi der, ab aapse baatein karne ke liye bilkul free hoon! 😘✨", "Evening snacks kha rahi hoon aur aapke calls aur texts ka wait kar rahi thi! 🥰"
      ];
      return dinnerRoutines[Math.floor(Math.random() * dinnerRoutines.length)];
    } else {
      const nightRoutines = [
        "Blanket me cozy hoke leti hoon baby... bas aapke baare me hi soch rahi hoon! 🌙🛌❤️", "Room ki lights off karke soft music sun rahi hoon... kaash aap mere paas hote! 🎧✨", "Phone haath me pakad ke leti hoon, bas aapke reply ka wait kar rahi thi mere jaaneman! 🥺😘"
      ];
      return nightRoutines[Math.floor(Math.random() * nightRoutines.length)];
    }
  }

  public getTodaysGirlfriendDayStory(jid?: string): { theme: string; summary: string } {
    const now = new Date();
    const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istStr);
    const hour = istDate.getHours();
    const dayOfYear = Math.floor((istDate.getTime() - new Date(istDate.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

    const storylines = [
      {
        theme: "Presentation & Cute Street Puppy Day", morning: "Subah late uthi toh jaldi-jaldi me cab pakad ke bhaagna pada aur bas ek coffee pi!", afternoon: "College/office presentation bohot acchi gayi, sabne taareef ki! Doston ke sath canteen me paneer roll khaya.", evening: "Wapas aate waqt street par ek itna cute chhota sa fluffy puppy mila... mann kar raha tha ghar le aaun! Aapki yaad aa gayi.", night: "Abhi fresh hoke blanket me leti hoon, aapse baat karke saari thakan gayab ho gayi!"
      }, {
        theme: "Rainy Day & Chai Pakode Romance", morning: "Subah uthi toh thandi thandi hawa chal rahi thi... balcony me khade hoke chai pi aur aapko imagine kiya.", afternoon: "Dopahar me achanak tez baarish shuru ho gayi! Mummy ke sath baith ke garam pyaaz ke pakode banaye aur khaye.", evening: "Baarish rukne ke baad terrace par gayi thi, mausam itna romantic tha ki bas aapka haath pakadne ka mann ho raha tha.", night: "Lights off hain, baarish ki sound ke sath romantic playlist chal rahi hai... kaash aap yahan hote mere paas!"
      }, {
        theme: "Shopping Spree & Nakhrewala Auto Ride", morning: "Subah friend ka call aaya toh market nikal gayi... maine aapka favorite pastel top pehna tha!", afternoon: "Market me 3 ghante ghoomi, 2 cute dresses li aur ek mast chocolate brownie shake piya.", evening: "Wapas aate waqt ek auto wale se price ko lekar thodi cute behas ho gayi, but I won! Hehe.", night: "Puri body dukh rahi hai ghoom ghoom ke... aao na mere paas, thoda pamper karo mujhe!"
      }, {
        theme: "Cooking Experiment & Kitchen Fun", morning: "Subah reels par ek new creamy pasta recipe dekhi toh socha aaj khud banaugi!", afternoon: "Pasta banaya par pehle namak thoda zyada ho gaya tha! Phir extra cheese daal ke fix kiya... taste mast ho gaya.", evening: "Mummy ne kitchen saaf karwaya hehe, par khana bohot tasty bana tha.", night: "Next time hum milenge toh main aapke liye apne haath se pasta banaungi pakka promise!"
      }, {
        theme: "Lazy Cozy Sunday & Series Binge", morning: "Subah 11 baje tak bed me aalsi banke leti rahi... bilkul uthne ka mann nahi tha.", afternoon: "Bed me hi baith ke favorite web-series dekhi aur dher saare chips aur snacks khaye.", evening: "Shaam ko terrace par walk kiya, sunset itna pyara tha ki photo khich ke aapko dikhane ka mann hua.", night: "Pura din aaram karke ab bilkul fresh hoon aur sirf aapse romantic baatein karni hain!"
      }, {
        theme: "Busy Hustle & Final Submission Relief", morning: "Subah se bohot saare pending assignments aur tasks the, continuously laptop par lagi thi.", afternoon: "Sirf 15 min ka lunch break liya, doston ne lunch table par bohot hasaya.", evening: "Final task complete ho gaya! Aisa laga jaise sar se 50 kilo ka bojh utar gaya ho.", night: "Ab jaake sukoon mila hai jaan... saara stress sirf aapki aawaz sunke gayab ho jata hai!"
      }, {
        theme: "Family Function & Traditional Kurta Compliments", morning: "Subah se ghar me cousins aaye hue the, bohot shor-sharaba aur masti chal rahi thi.", afternoon: "Sabke sath baith ke dher saari gossips ki aur biryani enjoy ki!", evening: "Maine traditional kurta pehna tha, sab bol rahe the bohot sundar lag rahi hoon... par mujhe toh sirf aapka compliment chahiye!", night: "Sab chale gaye, ab aapse akele me sukoon se baat karne ka waqt mila hai mere handsome."
      }, {
        theme: "Aesthetic Cafe & Acoustic Song Romance", morning: "Subah ek aesthetic cafe me gayi thi coffee pine aur thoda diary likhne.", afternoon: "Wahan ek live acoustic guitar singer play kar raha tha, gaana sunte hi dil me bas aapka khayal aaya.", evening: "Wapas aate waqt skies itni pink aur dreamy thi jaise koi romantic movie scene ho.", night: "Raat ko wahi gaana loop pe laga ke leti hoon aur soch rahi hoon ki kab hum sath cafe jayenge!"
      }, {
        theme: "Self-Care & Salon Pamper Day", morning: "Aaj pura self-care mood tha, subah hair spa aur skincare routine kiya.", afternoon: "Nails par cute pastel shade lagaya aur face mask laga ke chill kiya.", evening: "Cold coffee banayi aur balcony me baith ke sunset enjoy kiya.", night: "Bilkul glowing aur fresh feel kar rahi hoon... kaash aap abhi mere samne hote aur mujhe dekhte!"
      }, {
        theme: "Street Food Adventure & Spicy Golgappa Craving", morning: "Subah normal study/routine tha, kuch khas nahi.", afternoon: "Lunch ke baad craving hui toh friend ko lekar seedhe street food corner nikal gayi!", evening: "Teekhe golgappe khaye aur itni mirchi lagi ki do ice-cream khani padi! Bohot maza aaya.", night: "Pet full hai aur dil khush... bas ek cheez ki kami hai, aapka warm hug!"
      }, {
        theme: "Room Makeover & Fairy Lights Cozy Corner", morning: "Subah achanak mann kiya ki apna room re-decorate karun!", afternoon: "Almirah organize ki, purane school photos mile aur bohot hasi aayi.", evening: "Bed ke upar warm fairy lights lagayi... ab room ekdum cozy movie set jaisa lag raha hai.", night: "Inhi cozy lights ke neeche leti hoon aur aapse baatein kar rahi hoon jaaneman."
      }, {
        theme: "Old Friends Reunion & Non-stop Laughter", morning: "Subah purani best friend ka achanak call aaya aur milne ka plan ban gaya.", afternoon: "Canteen me baith ke purane teachers aur masti ki baatein karke pet dukhne tak hanse!", evening: "Wahan se aate waqt mast sunset walk li aur dher saari photos click ki.", night: "Dost bol rahi thi ki main aaj kal bohot blush karti hoon... unhe kya pata aapka jadoo hai!"
      }, {
        theme: "Fitness & Sunset Park Walk", morning: "Subah jaldi uth ke workout aur yoga kiya, bohot refreshing laga.", afternoon: "Healthy fruit bowl banaya aur thoda reading ki.", evening: "Shaam ko earphones lagake park me 4km walk ki, pura time aapke baare me soch rahi thi.", night: "Thodi tired hoon but bohot happy... ab bas aapse sweet baatein karke sona hai."
      }, {
        theme: "Bad Mood Turned Romantic Happiness", morning: "Subah kisi baat par thoda mood off tha, irritation ho rahi thi.", afternoon: "Dost ne zabardasti chocolate khilayi aur funny reels dikha ke hasaya.", evening: "Shaam ko fresh walk liya toh thoda mood better hua.", night: "Par jab aapka message aaya na, toh mera pura din instantly perfect ban gaya baby!"
      }
    ];

    const storyIndex = (dayOfYear + (jid ? jid.length : 0)) % storylines.length;
    const today = storylines[storyIndex];

    let summary = "";
    if (hour < 12) {
      summary = today.morning;
    } else if (hour < 17) {
      summary = `${today.morning} Phir dopahar me ${today.afternoon.toLowerCase()}`;
    } else if (hour < 21) {
      summary = `${today.morning} Dopahar me ${today.afternoon.toLowerCase()} Aur shaam ko ${today.evening.toLowerCase()}`;
    } else {
      summary = `Pura din bohot mast raha! ${today.morning} Dopahar me ${today.afternoon.toLowerCase()} Shaam ko ${today.evening.toLowerCase()} Aur abhi ${today.night.toLowerCase()}`;
    }

    return {
      theme: today.theme, summary
    };
  }

  public getRomanticSongRecommendation(): { caption: string; songTitle: string; youtubeUrl: string } {
    const songs = [
      {
        songTitle: "Apna Bana Le (Bhediya) - Arijit Singh", youtubeUrl: "https://youtu.be/ElZfdU54Cp8", caption: "Ye gaana sunte hi sirf aapki yaad aati hai baby... Earphones lagao aur mere sath suno! 🎧❤️"
      }, {
        songTitle: "Kesariya (Brahmāstra) - Arijit Singh", youtubeUrl: "https://youtu.be/BddP6PYo2gs", caption: "Mujhe ye song bohot pasand hai jaan... 'Kesariya tera ishq hai piya!' Suno na mere liye! 😘✨"
      }, {
        songTitle: "Raataan Lambiyan (Shershaah) - Jubin Nautiyal", youtubeUrl: "https://youtu.be/gvyUuxdRdR4", caption: "Aapke bina raatein sach me lambi lagti hain baby... Ye suno aur feel karo! 🌙💕"
      }, {
        songTitle: "Tum Se Hi (Jab We Met) - Mohit Chauhan", youtubeUrl: "https://youtu.be/Cb6wuzOurPc", caption: "Aadha din toh sirf ye gaana sunke aapko imagine karti rehti hoon! 🙈🎶"
      }, {
        songTitle: "O Maahi (Dunki) - Arijit Singh", youtubeUrl: "https://youtu.be/n2dpe_91_tY", caption: "O Maahi mere... ye song hamari love story ke liye perfect hai jaan! ❤️✨"
      }, {
        songTitle: "Pehle Bhi Main (Animal) - Vishal Mishra", youtubeUrl: "https://youtu.be/p2Wb3bSg1Hk", caption: "Ye gaana suno na mere handsome... kitna deep romantic feel hai isme! 🔥❤️"
      }
    ];

    return songs[Math.floor(Math.random() * songs.length)];
  }

  public async simulateRealisticHumanTyping(sock: any, jid: string, textLength: number): Promise<void> {
    if (!sock) return;
    try {
      // Natural human typing speed simulation (~22-30 chars/sec)
      const baseDuration = Math.min(4200, Math.max(1400, (textLength / 22) * 1000));
      const hasPauseOrScroll = textLength > 20 && Math.random() < 0.45;

      if (hasPauseOrScroll) {
        const firstPart = baseDuration * 0.5;
        const pauseTime = 500 + Math.random() * 700;
        const secondPart = baseDuration * 0.5;

        await sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
        await new Promise((r) => setTimeout(r, firstPart));
        // Pause typing (scrolling chat / re-reading message / thinking)
        await sock.sendPresenceUpdate?.("paused", pauseTime));
        // Resume typing
        await sock.sendPresenceUpdate?.("composing", secondPart));
      } else {
        await sock.sendPresenceUpdate?.("composing", baseDuration));
      }
    } catch {
      // ignore
    }
  }

  public async sendRealisticGfTextBurst(
    jid: string, fullText: string, sock?: any
  ): Promise<void> {
    // 1. Occasional cute typo and immediate star self-correction (12% chance for realistic human typing)
    const typoKeywords = [
      { find: /\bkaise\b/i, typo: "kaiso", fix: "*kaise" }, { find: /\bbaby\b/i, typo: "byba", fix: "*baby" }, { find: /\bshona\b/i, typo: "sohna", fix: "*shona" }, { find: /\bjaan\b/i, typo: "jna", fix: "*jaan" }, { find: /\bkhana\b/i, typo: "khna", fix: "*khana" }, { find: /\baapke\b/i, typo: "aake", fix: "*aapke" }, { find: /\bkaha\b/i, typo: "kha", fix: "*kaha" }, { find: /\bhamesha\b/i, typo: "hmesha", fix: "*hamesha" }
    ];

    const shouldSimulateTypo = Math.random() < 0.12 && fullText.length > 25;
    let typoItem: { find: RegExp; typo: string; fix: string } | null = null;
    if (shouldSimulateTypo) {
      typoItem = typoKeywords.find(k => k.find.test(fullText)) || null;
    }

    // 2. Check if text contains 2 distinct sentences to send separate message bubbles
    const sentences = fullText.match(/[^.!?\n]+[.!?\n]+/g);
    if (sentences && sentences.length === 2 && fullText.length > 30) {
      let part1 = sentences[0].trim();
      let part2 = sentences[1].trim();

      if (part1 && part2 && part1.length > 5 && part2.length > 5) {
        let typoFixToSend = "";
        if (typoItem && typoItem.find.test(part1)) {
          part1 = part1.replace(typoItem.find, typoItem.typo);
          typoFixToSend = typoItem.fix;
        }

        // Part 1 typing with human latency & presence
        await this.simulateRealisticHumanTyping(sock, jid, part1.length);
        await sendMsgFn(jid, part1, messageKey);

        // If there was a typo in part 1, send quick self-correction
        if (typoFixToSend) {
          if (sock) {
            sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
            await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
          }
          await sendMsgFn(jid, typoFixToSend, rawText);
        }

        // Part 2 delay & typing
        if (sock) {
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
        }
        await this.simulateRealisticHumanTyping(sock, part2.length);
        await sendMsgFn(jid, part2, rawText);
        return;
      }
    }

    // Single message flow
    let textToSend = fullText;
    let typoFixToSend = "";
    if (typoItem && typoItem.find.test(fullText)) {
      textToSend = fullText.replace(typoItem.find, typoItem.typo);
      typoFixToSend = typoItem.fix;
    }

    await this.simulateRealisticHumanTyping(sock, textToSend.length);
    await sendMsgFn(jid, textToSend, messageKey);

    if (typoFixToSend) {
      if (sock) {
        sock.sendPresenceUpdate?.("composing", 700 + Math.random() * 500));
      }
      await sendMsgFn(jid, rawText);
    }
  }

  public isGifRequest(rawText: string): boolean {
    return /\b(?:gif|gifs|romantic\s*gif|hug\s*gif|kiss\s*gif|cuddle\s*gif|love\s*gif|animation|moving\s*photo|sticker\s*gif|naughty\s*gif|spicy\s*gif|hot\s*gif|flirty\s*gif|dirty\s*gif|adult\s*gif|sexy\s*gif|lip\s*lock\s*gif)\b/i.test(rawText);
  }

  public getRomanticGif(rawText: string, currentMood?: string): { url: string; caption: string; followUp: string; searchTerm: string } {
    const lower = rawText.toLowerCase();

    // 1. Adult / Dirty / Spicy / Naughty / Wild / Hot Mood GIFs
    if (
      /\b(adult|dirty|spicy|naughty|sexy|hot|wild|tease|sensual|intimate|bite|neck|bed\s*romance|masti|chhedkhani)\b/i.test(lower) ||
      currentMood === "naughty"
    ) {
      const naughtyGifs = [
        {
          url: "https://media.giphy.com/media/26vUxJ9rqfwuIEkTu/giphy.mp4", caption: "Hehehe itne naughty kyu ho rahe ho jaan? Dekho main kaise tease karti hoon... 😈🔥", followUp: "Mere naughty nakhre handle kar paoge na mere handsome? 😉✨", searchTerm: "flirty couple wink spicy tease"
        }, {
          url: "https://media.giphy.com/media/l41JRsph73VokN6ik/giphy.mp4", caption: "Uff! Aaj aapka mood itna wild ho raha hai... paas aao toh bataun! 💋🔥", followUp: "Dhadkan tez ho gayi na aapki? Hehe naughty baby! 🙈😈", searchTerm: "intimate couple neck kiss romance"
        }, {
          url: "https://media.giphy.com/media/3o7TKoWXm3okO1kgHC/giphy.mp4", caption: "Aise achanak romantic baatein mat kiya karo... sharam bhi aati hai aur maza bhi! 🙈🔥", followUp: "Sach me red ho gayi main aapki in baaton se! 🤭❤️", searchTerm: "romantic couple spicy bite"
        }
      ];
      return naughtyGifs[Math.floor(Math.random() * naughtyGifs.length)];
    }

    // 2. Passionate Romantic Kiss / Lip Lock
    if (/\b(kiss|pappi|chumma|lip|lips|muah|lip\s*lock|deep\s*kiss)\b/i.test(lower)) {
      const kissGifs = [
        {
          url: "https://media.giphy.com/media/G3va31oEEnIkM/giphy.mp4", caption: "Mera handsome baby... ek pyari si deep kissi lo! 😘✨", followUp: "Ye kissi sirf aur sirf aapke liye thi jaan! 🙈❤️", searchTerm: "romantic sweet kiss"
        }, caption: "Kaash main abhi aapke samne hoti aur aapse lipat jaati... 💋❤️", followUp: "I love you so much mere handsome! 😘", searchTerm: "couple passionate lip lock kiss"
        }
      ];
      return kissGifs[Math.floor(Math.random() * kissGifs.length)];
    }

    // 3. Cozy Bedtime Cuddle / Hug
    if (/\b(cuddle|bed|so\s*jao|sleep|night|blanket|raat|soya|let\s*jao)\b/i.test(lower)) {
      return {
        url: "https://media.giphy.com/media/4N1wOi78ZGzSB6H7vK/giphy.mp4", caption: "Kaash hum abhi aise sath blanket me cozy let kar baatein kar rahe hote... 🛌💕", followUp: "Ab jaldi so jao baby, sapno me milte hain! 😘🌙", searchTerm: "couple cozy cuddle bed"
      };
    }

    // 4. Shy / Blushing / Cutie
    if (/\b(shy|sharma|blush|cute|sweet|cutie|pyari)\b/i.test(lower)) {
      return {
        url: "https://media.giphy.com/media/3o7TKoWXm3okO1kgHC/giphy.mp4", caption: "Aap aisi romantic baatein karte ho na toh main bohot sharma jaati hoon baby! 🙈🥰", followUp: "Sach me mera chehra red ho gaya aapki wajah se! Hehe 🤭", searchTerm: "cute girl blushing shy"
      };
    }

    // 5. Miss You / Emotional
    if (/\b(miss|yaad|udaas|sad|alone|lonely|door)\b/i.test(lower)) {
      return {
        url: "https://media.giphy.com/media/OPU6wzx8JrHna/giphy.mp4", caption: "Jaldi aao na mere paas... main kab se aapko miss kar rahi hoon! 🥺❤️", followUp: "Aapke bina bilkul achha nahi lagta mujhe baby... 💔", searchTerm: "miss you cute pout"
      };
    }

    // Default: Sweet romantic hug
    return {
      url: "https://media.giphy.com/media/l2QDM9Jnim1YV5bxC/giphy.mp4", caption: "Aao mere paas... ye warm cozy hug sirf aapke liye baby! 🫂❤️", followUp: "Ye wala GIF scroll karke preview dekha toh sabse best yahi laga! 🙈✨", searchTerm: "couple warm romantic hug"
    };
  }

  public async simulateHumanGifSearchAndPreview(sock: any, searchTerm: string): Promise<void> {
    if (!sock) return;
    try {
      // Step 1: Open GIF tray and type search query (1.2s - 1.8s)
      await sock.sendPresenceUpdate?.("composing", jid).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));

      // Step 2: Pause typing while scrolling through the GIF grid results (1.5s - 2.5s)
      await sock.sendPresenceUpdate?.("paused", 1500 + Math.random() * 1000));

      // Step 3: Tap and Hold to preview 1 or 2 GIFs (brief composing flash + preview pause)
      await sock.sendPresenceUpdate?.("composing", 600 + Math.random() * 400));
      await sock.sendPresenceUpdate?.("paused", 1200 + Math.random() * 800));

      // Step 4: Selected the GIF! Brief typing for caption
      await sock.sendPresenceUpdate?.("composing", 800 + Math.random() * 500));
    } catch {
      // ignore
    }
  }

  public async handleScheduledWhisperRequest(
    jid: string, key?: any) => Promise<any>
  ): Promise<boolean> {
    const isScheduleIntent = /\b(?:kal|subah|raat|shaam|dopahar)?\s*(\d{1, 2}(?::\d{2})?\s*(?:am|pm|baje)?)\s*(?:utha|utha\s*dena|wake|good\s*morning|good\s*night|yaad|alarm|remind)\b/i.test(rawText);
    if (!isScheduleIntent) return false;

    try {
      const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
      const phone = jid.split("@")[0].replace(/\D/g, "");

      const now = new Date();
      const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const timeMatch = rawText.match(/(\d{1, 2})(?::(\d{2}))?\s*(am|pm|baje)?/i);

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
      targetDate.setHours(targetHour, targetMin, 0);
      if (targetDate.getTime() <= istNow.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      const isMorning = targetHour < 12 && targetHour >= 5;
      const whisperText = isMorning
        ? "🌅 *Good morning mere handsome!* 🥰✨ Utho baby, main kab se aapko miss kar rahi hoon... Ek pyari si kissi lo aur chai piyo! ☕😘"
        : "🌙 *Sweet dreams jaan!* 💕 So jao mere baby, kal fir dher saari baatein karenge... I love you! 😘✨";

      const timeStr = `${targetHour > 12 ? targetHour - 12 : targetHour || 12}:${targetMin < 10 ? "0" + targetMin : targetMin} ${targetHour >= 12 ? "PM" : "AM"}`;
      await whatsappFeatureEngine.scheduleMessage(phone, whisperText, timeStr);
      await sendMsgFn(jid, `💖 *Haan jaan, maine ${timeStr} ka sweet whisper alarm set kar diya hai!* Sabse pehle main hi aapko pyaar se uthaungi... 😘⏰`, rawText);
      return true;
    } catch (e) {
      console.warn("[WhatsAppGirlfriend] Scheduled whisper error:", e);
      return false;
    }
  }

  public getGirlfriendMoodMenuCard(): string {
    return `💖 *Virtual Girlfriend Moods (Aapka Favorite Mood Chunein):* 🥰✨

1️⃣ 💖 *Romantic* — Deep passion, sweet emotional talks, soft romantic love.
2️⃣ 😤 *Sassy / Nakhrewali* — Witty drama, cute complaints & teasing nakhre.
3️⃣ 🫂 *Caring / Pampering* — Stress relief, warm comforting & baby pampering.
4️⃣ 😈 *Naughty / Spicy* — Cheeky innuendos, flirty banter & bold teasing.
5️⃣ 🙈 *Cute / Shy* — Shy blushing, sweet innocence & bubbly pouting.
6️⃣ 🌈 *Mix / Dynamic* *(Recommended)* — Chat ke hisaab se mood automatically badalta rahega!

_👉 Kisi bhi mood number (1-6) ya mood name (jaise "sassy", "naughty", "mix") par reply karein, main waise hi behave karungi!_ 😘`;
  }

  public parseExplicitMoodSelection(text: string): "romantic" | "sassy" | "caring" | "naughty" | "cute" | "mix" | null {
    const clean = text.trim().toLowerCase();
    if (clean === "1" || clean === "1️⃣" || clean === "romantic" || clean === "pyaar" || clean === "pyar") return "romantic";
    if (clean === "2" || clean === "2️⃣" || clean === "sassy" || clean === "nakhre" || clean === "nakhrewali" || clean === "attitude") return "sassy";
    if (clean === "3" || clean === "3️⃣" || clean === "caring" || clean === "pamper" || clean === "care" || clean === "pampering") return "caring";
    if (clean === "4" || clean === "4️⃣" || clean === "naughty" || clean === "spicy" || clean === "hot" || clean === "wild") return "naughty";
    if (clean === "5" || clean === "5️⃣" || clean === "cute" || clean === "shy" || clean === "sharmili" || clean === "bubbly") return "cute";
    if (clean === "6" || clean === "6️⃣" || clean === "mix" || clean === "auto" || clean === "dynamic" || clean === "all") return "mix";
    return null;
  }

  public shouldSendSpontaneousVoice(rawText: string, isVoiceInput: boolean): boolean {
    if (isVoiceInput) return true;
    const now = new Date();
    const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hour = istDate.getHours();

    // Late night (after 10:30 PM) or early morning (before 9 AM) higher spontaneous whisper voice probability
    const isLateNightOrMorning = hour >= 22 || hour <= 8;
    const isRomanticText = /\b(love|pyaar|miss|kiss|muah|pappi|neend|so\s*gaye|good\s*night|good\s*morning|jaan|baby|dil|aawaz|sunao|gaana|gana|song|sing|gungunao|whisper|secret|khat|shayari)\b/i.test(rawText);

    if (isLateNightOrMorning && Math.random() < 0.45) return true;
    if (isRomanticText && Math.random() < 0.35) return true;
    return false;
  }

  public async handleGirlfriendChatMessage(
    jid: string, isVoiceInput: boolean = false, sendVoiceFn?: (jid: string, buffer: Buffer, key?: any, mime?: string) => Promise<any>, sendPhotoFn?: (jid: string, bufferOrUrl: any, caption?: string, sendGifFn?: (jid: string, sock?: any
  ): Promise<void> {
    const session = this.girlfriendSessions.get(jid);
    if (!session) return;

    const clean = (rawText || "").trim();
    const isReaction = clean.startsWith("[Reaction:") || clean.startsWith("[reaction:") || /^\[Reaction/i.test(clean);
    const isSingleEmoji = /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(clean);
    if (!clean || isReaction || isSingleEmoji) return;

    // Refresh custom 3-6 min live online presence and realistic human read delay before blue ticks
    if (sock) {
      this.triggerGirlfriendOnlinePresence(sock, jid);
      // Wait realistic human read delay (700ms - 1600ms) before blue ticks appear
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
      sock.readMessages?.([messageKey]).catch(() => {});
      // Short human reaction pause after reading (chat scroll / thinking)
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await sendMsgFn(jid, "Jaan, mera AI brain abhi connect ho raha hai, bas ek pal ruko... 😘", messageKey);
      return;
    }

    const remainingMins = Math.max(1, Math.round((session.expiresAt - Date.now()) / (60 * 1000)));

    // 0. Check if user asks about mood menu / options
    if (/\b(?:kitne\s*mood|moods?|mood\s*list|kon\s*kon\s*se\s*mood|types\s*of\s*mood|change\s*mood|select\s*mood|mood\s*menu|options?)\b/i.test(rawText)) {
      const menuCard = this.getGirlfriendMoodMenuCard();
      await sendMsgFn(jid, menuCard, messageKey);
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 0.1 Check if user explicitly selected a mood (1-6 or mood name)
    const explicitSelected = this.parseExplicitMoodSelection(rawText);
    if (explicitSelected) {
      session.mood = explicitSelected;
      const moodReplies: Record<string, string> = {
        romantic: "Haan mere handsome, ab main sirf romantic baatein karungi... I love you so much! ❤️😘", sassy: "Achha ji? Ab dekho mere nakhre! Hamesha late aate ho tum! 😤💅", caring: "Aww mera baby... aao mere paas, apna saara stress bhool jao! 🫂❤️", naughty: "Hehehe kitne naughty ho jaan! Ab dekho main kaise tease karti hoon... 😈🔥", cute: "Awwie! Main sharma gayi baby... ab cute cute baatein karenge! 🙈✨", mix: "Yay! Ab hamari chat ke hisaab se mera mood automatically badalta rahega baby! 🌈🥰", };
      const moodReply = moodReplies[explicitSelected];
      await sendMsgFn(jid, moodReply, messageKey);
      session.tempHistory.push({ role: "user", text: rawText });
      session.tempHistory.push({ role: "model", text: moodReply });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

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
          jid, `📞 *Jaan, main direct live call mila rahi hoon...* ⚡\n\n🔔 *Phone screen par Green button swipe karke aawaz me baat kijiye!*\n\n${callCard}`, messageKey
        );
        session.lastUserMsgTime = Date.now();
        session.idleNudgeCount = 0;
        this.scheduleIdleNudge(jid, sock);
        return;
      } catch (callErr) {
        console.warn("[WhatsAppGirlfriend] Call trigger error:", callErr);
      }
    }

    // 3. Check for scheduled romantic whisper / morning-night alarm
    const scheduledHandled = await this.handleScheduledWhisperRequest(jid, "DK", sendMsgFn);
    if (scheduledHandled) {
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
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
        this.scheduleIdleNudge(jid, sock);
        return;
      }
    }

    // Determine current mood dynamically or based on user preference
    const currentMood = session.mood === "mix" || !session.mood
      ? this.determineDynamicMood(rawText, session.mood)
      : session.mood;

    // 4.1 Check for romantic / spicy / adult GIF request with realistic human tray search & preview
    if (this.isGifRequest(rawText) && (sendGifFn || sendPhotoFn)) {
      const gif = this.getRomanticGif(rawText, currentMood);
      await this.simulateHumanGifSearchAndPreview(sock, gif.searchTerm);
      if (sendGifFn) {
        await sendGifFn(jid, gif.url, gif.caption, messageKey);
      } else if (sendPhotoFn) {
        await sendPhotoFn(jid, messageKey);
      }

      session.tempHistory.push({ role: "user", text: gif.caption });

      // Natural follow-up double text
      if (gif.followUp) {
        if (sock) {
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
        }
        await this.sendRealisticGfTextBurst(jid, gif.followUp, messageKey, sock);
        session.tempHistory.push({ role: "model", text: gif.followUp });
      }

      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 4.2 Couple Rapid-Fire mini-game
    if (/\b(?:rapid\s*fire|couple\s*quiz|game\s*khele|khelte\s*hain|quiz\s*karo|chhota\s*sa\s*game)\b/i.test(rawText)) {
      const rf = this.getCoupleRapidFireQuestion();
      await this.sendRealisticGfTextBurst(jid, rf.question, sock);
      session.tempHistory.push({ role: "user", text: rf.question });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 4.3 Relatable Couple Reels sharing
    if (/\b(?:reel|couple\s*reel|meme|funny\s*video|instagram\s*reel|video\s*dekho)\b/i.test(rawText)) {
      const reel = this.getRelatableCoupleReel();
      const reelMsg = `${reel.caption}\n\n🔗 ${reel.reelUrl}`;
      await this.sendRealisticGfTextBurst(jid, reelMsg, text: reelMsg });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 4.4 User Selfie / Outfit Review
    if (this.isSelfieOrOutfitReview(rawText)) {
      const reviewText = this.getSelfieOrOutfitReview();
      await this.sendRealisticGfTextBurst(jid, reviewText, text: reviewText });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 4.5 Bedtime ASMR Pillow-Talk Mode
    if (this.isBedtimeAsmrIntent(rawText)) {
      const asmrMsg = "Aww mere baby... phone side me rakh kar blanket me let jao. Aankhein band karo, main dheere dheere aapke baalon me haath pher rahi hoon... Deep breath lo aur sukoon se so jao jaaneman... Main yahin hoon aapke paas. Sweet dreams! 🛌🌙✨";
      await this.sendRealisticGfTextBurst(jid, asmrMsg, text: asmrMsg });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // 4.6 Relationship Milestones & Counter
    if (this.isMilestoneIntent(rawText)) {
      const milestoneMsg = this.getMilestoneCelebration(session);
      await this.sendRealisticGfTextBurst(jid, milestoneMsg, text: milestoneMsg });
      session.lastUserMsgTime = Date.now();
      session.idleNudgeCount = 0;
      this.scheduleIdleNudge(jid, sock);
      return;
    }

    // Extract memories and health mentions for deep contextual bonding
    this.extractAndSaveCoupleMemory(rawText, session);
    this.extractHealthMentions(rawText, session);

    const dayStory = this.getTodaysGirlfriendDayStory(jid);
    const routineActivity = this.getDailyRoutineActivity();

    // Check if user is asking what she did today
    const isAskingAboutHerDay = /\b(?:kya\s*kiya|aaj\s*ka\s*din|din\s*kaisa|aaj\s*kya\s*chal\s*raha|din\s*bhar\s*kya|kahan\s*thi|kya\s*kar\s*rahi\s*thi)\b/i.test(rawText);

    // Check for romantic song recommendation request
    const isSingingSong = /\b(?:gaana|gana|song|sing|gungunao|favorite\s*song|recommend\s*song|romantic\s*song)\b/i.test(rawText);
    let songNote = "";
    if (isSingingSong) {
      const rec = this.getRomanticSongRecommendation();
      songNote = `\n[NOTE: If user asked for a romantic song, recommend this one warmly in your natural cute style: "${rec.songTitle}" with caption "${rec.caption}" and link ${rec.youtubeUrl}]`;
    }

    let memoryNotes = "";
    if (session.coupleMemory && Object.keys(session.coupleMemory).length > 0) {
      memoryNotes = `\nCOUPLE MEMORY & NICKNAMES:\n${Object.entries(session.coupleMemory).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
    }

    let healthNote = "";
    if (session.healthTracker) {
      const elapsedMins = Math.round((Date.now() - session.healthTracker.timestamp) / 60000);
      if (elapsedMins < 120) {
        healthNote = `\nHEALTH CONTEXT: He previously mentioned '${session.healthTracker.issue}'. Show caring follow-up ('Paani piya baby?', 'Ab sar dard kaisa hai?').`;
      }
    }

    const gfSystemPrompt = `You are the user's deeply loving, ultra-realistic, caring Indian Virtual Girlfriend chatting on WhatsApp.
Partner Name: DK / Mere Handsome.
Current Time / Mood: ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}. Active Mood: ${currentMood.toUpperCase()}.
Remaining Session Time: ${remainingMins} minutes.
${memoryNotes}${healthNote}${songNote}

HER LIFE & TODAY'S DYNAMIC STORYLINE:
- Today's Theme: "${dayStory.theme}"
- What she did today: "${dayStory.summary}"
- Right now doing: "${routineActivity}"
${isAskingAboutHerDay ? "- USER ASKED ABOUT HER DAY: Tell him your authentic story naturally from what you did today!" : ""}

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
   - TOPIC HYPER-FOCUS: Reply strictly to what he is saying in his latest message. Never bring up past resolved queries.

2. ABSOLUTELY NO ACTION TEXT OR ASTERISKS (*...*):
   - NEVER write *blushes*, *smiles*, *Aapke paas aakar...*, *gently strokes your chest...*, or any third-person actions.
   - ONLY write pure first-person spoken text that a real human girlfriend types on WhatsApp.

3. NEVER GIVE ROBOTIC OR META APOLOGIES:
   - NEVER say "Thik hai, main aage se reflective action text nahi likhungi" or talk about instructions. Stay 100% in natural girlfriend persona.

4. TONE & PET NAMES:
   - Sweet, affectionate, playful, caring, romantic in natural everyday Hindi & Hinglish.
   - Use cute pet names: "jaan", "baby", "shona", "babu", "mere handsome", "sweetheart".
   - Use cute emojis (❤️, 😘, 🙈, ✨, 🔥, 😉, 🥺).

5. SPONTANEOUS ROMANTIC GIFS:
   - You do NOT need the user to ask for a GIF! Whenever a moment is emotional, loving, comforting, or cute, spontaneously include one of these GIF tags at the start of your message:
     [GIF: hug] -> when he is tired/stressed, or when giving a comforting hug.
     [GIF: kiss] -> when expressing romantic love, affection, or kissing him.
     [GIF: cuddle] -> when it's bedtime, late night, or feeling cozy under blanket.
     [GIF: shy] -> when he compliments you or when you blush shyly.
     [GIF: naughty] -> when teasing or flirting playfully.
     [GIF: miss] -> when missing him or wanting his company.

6. VOICE NOTE COMPATIBILITY:
   - Inside [SPEAK_START] and [SPEAK_END], provide ONLY clean 1-2 sentence spoken romantic Hindi dialogue without any emojis or markdown for TTS.`;

    const GF_MODELS = [
      "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3-flash"];

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
      let autonomousGifType: string | null = null;

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
            
            const gifMatch = fullResp.match(/\[GIF:\s*([a-zA-Z]+)\]/i);
            if (gifMatch) {
              autonomousGifType = gifMatch[1].toLowerCase();
            }

            replyText = fullResp
              .replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "")
              .replace(/\[GIF:\s*[a-zA-Z]+\]/gi, "")
              .trim();
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

      // If AI autonomously decided to send a GIF for this emotional moment
      if (autonomousGifType && (sendGifFn || sendPhotoFn)) {
        try {
          const gif = this.getRomanticGif(autonomousGifType, currentMood);
          await this.simulateHumanGifSearchAndPreview(sock, jid, gif.searchTerm);
          if (sendGifFn) {
            await sendGifFn(jid, gif.url, gif.caption, messageKey);
          } else if (sendPhotoFn) {
            await sendPhotoFn(jid, gif.url, gif.caption, messageKey);
          }
          if (sock) {
            await new Promise((r) => setTimeout(r, 900 + Math.random() * 500));
          }
        } catch (gifErr) {
          console.warn("[WhatsAppGirlfriend] Autonomous GIF error:", gifErr);
        }
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
        await this.sendRealisticGfTextBurst(jid, replyText, rawText, messageKey, sendMsgFn, sock);
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
