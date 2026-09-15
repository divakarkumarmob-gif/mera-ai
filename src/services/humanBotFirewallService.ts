/**
 * humanBotFirewallService.ts
 *
 * Anti-Bot & Human Simulation Firewall for WhatsApp (Baileys) and Instagram.
 * Ensures all automated interactions appear 100% human-crafted:
 * 1. Realistic Read Receipts & Typing Status ("composing..." indicator).
 * 2. Gaussian Random Jitter & Dynamic Reading/Typing Delays.
 * 3. Strict Anti-Ban Rate Limiting (Hourly limits, per-contact cooldowns, loop-breaker).
 * 4. Human-like natural text formatting & nighttime awareness.
 */

import { db } from "./firebaseAdmin";

export interface FirewallStats {
  totalProtectedMessages: number;
  blockedSpamCount: number;
  lastActivePlatform: string | null;
  activeRateLimits: {
    whatsappCooldownCount: number;
    instagramCooldownCount: number;
  };
}

class HumanBotFirewallService {
  private lastReplyTimestamps = new Map<string, number>(); // platform:key -> timestamp
  private replyCountToday = new Map<string, { count: number; dateStr: string }>(); // platform:key -> {count, date}
  private hourlyCount = new Map<string, { count: number; hourKey: string }>(); // platform -> {count, hour}
  private totalProtectedMessages = 0;
  private blockedSpamCount = 0;
  private lastActivePlatform: string | null = null;

  private readonly MIN_COOLDOWN_MS = 6000; // 6 seconds min between replies to same person
  private readonly MAX_DAILY_PER_CONTACT = 20; // 20 replies max per contact per day
  private readonly MAX_HOURLY_PLATFORM = 35; // 35 replies max per platform per hour (ban-safe)

  /**
   * Generates a random number with Gaussian (Normal) Distribution using Box-Muller transform
   */
  public gaussianRandom(mean: number, stdDev: number, minBound?: number, maxBound?: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    let result = mean + num * stdDev;
    if (minBound !== undefined) result = Math.max(minBound, result);
    if (maxBound !== undefined) result = Math.min(maxBound, result);
    return Math.round(result);
  }

  // Zero-width invisible characters for anti-hash duplicate detection avoidance
  private static readonly ZERO_WIDTH_CHARS = ['\u200B', '\u200C', '\u200D', '\uFEFF'];

  /**
   * Injects invisible zero-width unicode characters into outgoing text messages.
   * This creates a 100% unique cryptographic hash/fingerprint for every dispatch
   * so Meta's automated spam scanners cannot cluster messages into template broadcasts,
   * while human recipients see 100% clean, normal text.
   */
  public injectAntiHashZeroWidthEntropy(text: string): string {
    if (!text || typeof text !== 'string') return text;
    const clean = text.trim();
    if (!clean) return clean;

    const chars = HumanBotFirewallService.ZERO_WIDTH_CHARS;

    // If text contains URLs or code blocks, append invisible entropy safely at the ending
    if (clean.includes('```') || clean.includes('http://') || clean.includes('https://')) {
      const count = Math.floor(Math.random() * 3) + 2;
      let suffix = '';
      for (let i = 0; i < count; i++) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
      }
      return clean + suffix;
    }

    // Split text into words
    const words = clean.split(' ');
    const modifiedWords = words.map((word, idx) => {
      // 30% chance to inject an invisible character after word if not the last word
      if (idx < words.length - 1 && Math.random() < 0.30) {
        return word + chars[Math.floor(Math.random() * chars.length)];
      }
      return word;
    });

    // Always append a unique invisible signature (2 to 4 zero-width chars) at the ending
    const signatureLength = Math.floor(Math.random() * 3) + 2;
    let endEntropy = '';
    for (let i = 0; i < signatureLength; i++) {
      endEntropy += chars[Math.floor(Math.random() * chars.length)];
    }

    return modifiedWords.join(' ') + endEntropy;
  }

  // ──────────────────────────────────────────────────────────────────────
  // DYNAMIC MESSAGE TEXT VARIATION (Spam Filter Bypass)
  // Makes every outgoing message visually unique so Instagram's spam
  // clustering algorithm cannot group them as template/broadcast messages.
  // Uses: Synonym swaps, Hinglish fillers, emoji rotation, punctuation
  // variation, sentence reordering, and casual text transforms.
  // ──────────────────────────────────────────────────────────────────────

  // Common Hindi/Hinglish synonym swaps (word -> alternatives)
  private static readonly SYNONYM_MAP: Record<string, string[]> = {
    'hello': ['hey', 'hi', 'hii', 'heyy', 'yo'],
    'hi': ['hello', 'hey', 'hii', 'heyy', 'heya'],
    'hey': ['hi', 'hello', 'hii', 'heya', 'yo'],
    'ok': ['okay', 'alright', 'theek hai', 'sahi', 'acha'],
    'okay': ['ok', 'alright', 'theek hai', 'sahi hai', 'acha'],
    'thanks': ['thank you', 'shukriya', 'dhanyavaad', 'ty', 'thnx'],
    'thank': ['thanks', 'shukriya', 'dhanyavaad'],
    'yes': ['haan', 'ha', 'yep', 'yup', 'ji'],
    'no': ['nahi', 'nah', 'nope', 'na'],
    'please': ['plz', 'pls', 'kripa karke'],
    'good': ['accha', 'badhiya', 'great', 'nice', 'awesome', 'mast'],
    'bad': ['bura', 'kharab', 'not good'],
    'wait': ['ruko', 'hold on', 'ek sec', 'ruk'],
    'sorry': ['maaf karo', 'my bad', 'sorry yaar', 'oops'],
    'sure': ['bilkul', 'zaroor', 'of course', 'haan bhai', 'pakka'],
    'bro': ['bhai', 'yaar', 'dude', 'buddy', 'dost'],
    'what': ['kya', 'konsa'],
    'when': ['kab'],
    'where': ['kahan', 'kidhar'],
    'how': ['kaise', 'kaisa'],
    'why': ['kyun', 'kyu', 'kyunki'],
    'nice': ['badhiya', 'mast', 'accha', 'sahi', 'kamaal'],
    'great': ['awesome', 'amazing', 'kamaal', 'zabardast', 'shandar'],
    'cool': ['mast', 'sahi', 'badhiya', 'lit'],
    'bye': ['alvida', 'see ya', 'chal phir', 'tata', 'baad me milte'],
    'morning': ['subah', 'good morning', 'suprabhat'],
    'night': ['raat', 'good night', 'shubh ratri'],
    'friend': ['dost', 'yaar', 'bhai', 'buddy'],
    'problem': ['dikkat', 'issue', 'pareshani', 'trouble'],
    'happy': ['khush', 'glad', 'excited'],
    'sad': ['dukhi', 'upset', 'udaas'],
    'today': ['aaj'],
    'tomorrow': ['kal'],
    'now': ['abhi', 'right now', 'filhaal'],
    'later': ['baad me', 'phir', 'thodi der baad'],
    'very': ['bahut', 'bohot', 'kaafi'],
    'think': ['lagta', 'sochta', 'feel karta'],
    'understand': ['samajh', 'samjha', 'got it'],
    'tell': ['bata', 'batao', 'bol'],
    'see': ['dekh', 'dekho', 'dekhna'],
    'know': ['pata', 'maloom'],
    'come': ['aa', 'aao', 'aaja'],
    'go': ['ja', 'jao', 'chalo'],
  };

  // Random Hinglish fillers to sprinkle naturally
  private static readonly HINGLISH_FILLERS = [
    'btw', 'waise', 'haan', 'acha', 'like', 'basically',
    'matlab', 'you know', 'samjhe', 'dekho', 'sun',
    'bhai', 'yaar', 'dost', 'boss', 'bro',
  ];

  // Emoji clusters to randomly append or swap
  private static readonly EMOJI_POOL = [
    '😊', '👍', '🙏', '😄', '💪', '🔥', '✨', '😁', '🤝', '💯',
    '😅', '🫡', '👌', '🙌', '😎', '🤗', '✅', '💫', '🎯', '😇',
  ];

  // Sentence-ending punctuation variations
  private static readonly PUNCTUATION_VARIANTS = ['.', '!', '..', '...', '~', ' 😊', ' 👍', ' ✨'];

  /**
   * Dynamic Message Text Variation — Spam Filter Bypass
   * Makes every outgoing message unique by applying random combinations of:
   * 1. Synonym word swaps (English <-> Hinglish)
   * 2. Random filler word insertion
   * 3. Emoji rotation/insertion
   * 4. Punctuation variation
   * 5. Capitalization tweaks
   * 6. Sentence order shuffling (for multi-sentence messages)
   *
   * Combined with injectAntiHashZeroWidthEntropy(), this creates
   * a double-layer defense against Instagram's spam clustering.
   */
  public dynamicMessageVariation(text: string): string {
    if (!text || typeof text !== 'string') return text;
    let msg = text.trim();
    if (!msg) return msg;

    // Skip variation for code blocks, URLs, or very short messages
    if (msg.includes('```') || msg.includes('http://') || msg.includes('https://')) {
      return msg;
    }

    // 1. SYNONYM SWAP: 25% chance per matching word
    const words = msg.split(' ');
    const swappedWords = words.map((word) => {
      const lower = word.toLowerCase().replace(/[^a-z]/g, '');
      if (lower && HumanBotFirewallService.SYNONYM_MAP[lower] && Math.random() < 0.25) {
        const alternatives = HumanBotFirewallService.SYNONYM_MAP[lower];
        const replacement = alternatives[Math.floor(Math.random() * alternatives.length)];
        // Preserve original casing pattern
        if (word[0] === word[0].toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      }
      return word;
    });
    msg = swappedWords.join(' ');

    // 2. HINGLISH FILLER INSERTION: 15% chance to add a casual filler
    if (Math.random() < 0.15 && msg.length > 15) {
      const filler = HumanBotFirewallService.HINGLISH_FILLERS[
        Math.floor(Math.random() * HumanBotFirewallService.HINGLISH_FILLERS.length)
      ];
      const insertPos = Math.random() < 0.5 ? 'start' : 'middle';
      if (insertPos === 'start') {
        msg = filler + ', ' + msg.charAt(0).toLowerCase() + msg.slice(1);
      } else {
        const sentenceParts = msg.split('. ');
        if (sentenceParts.length >= 2) {
          const idx = Math.floor(Math.random() * (sentenceParts.length - 1)) + 1;
          sentenceParts[idx] = filler + ', ' + sentenceParts[idx].charAt(0).toLowerCase() + sentenceParts[idx].slice(1);
          msg = sentenceParts.join('. ');
        }
      }
    }

    // 3. EMOJI ROTATION: 20% chance to append a random emoji
    if (Math.random() < 0.20) {
      const emoji = HumanBotFirewallService.EMOJI_POOL[
        Math.floor(Math.random() * HumanBotFirewallService.EMOJI_POOL.length)
      ];
      // Swap existing trailing emoji or append
      const trailingEmojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}✅💯🎯💫🫡]+$/u;
      if (trailingEmojiRegex.test(msg)) {
        msg = msg.replace(trailingEmojiRegex, emoji);
      } else {
        msg = msg + ' ' + emoji;
      }
    }

    // 4. PUNCTUATION VARIATION: Vary sentence endings
    if (Math.random() < 0.30) {
      // Replace last punctuation with a variant
      const lastChar = msg[msg.length - 1];
      if (['.', '!'].includes(lastChar)) {
        const variant = HumanBotFirewallService.PUNCTUATION_VARIANTS[
          Math.floor(Math.random() * HumanBotFirewallService.PUNCTUATION_VARIANTS.length)
        ];
        msg = msg.slice(0, -1) + variant;
      }
    }

    // 5. CASUAL CAPITALIZATION TWEAK: 10% chance to lowercase first letter (casual vibe)
    if (Math.random() < 0.10 && msg.length > 5) {
      msg = msg.charAt(0).toLowerCase() + msg.slice(1);
    }

    // 6. MULTI-SENTENCE SHUFFLE: If 3+ sentences, 15% chance to swap two adjacent ones
    if (Math.random() < 0.15) {
      const sentences = msg.split(/(?<=[.!?])\s+/);
      if (sentences.length >= 3) {
        const swapIdx = 1 + Math.floor(Math.random() * (sentences.length - 2));
        [sentences[swapIdx], sentences[swapIdx - 1]] = [sentences[swapIdx - 1], sentences[swapIdx]];
        msg = sentences.join(' ');
      }
    }

    // 7. DOUBLE/SINGLE EXCLAMATION VARIATION: "!!" <-> "!" <-> "!!!"
    if (Math.random() < 0.20) {
      msg = msg.replace(/!{1,3}/g, () => {
        const variants = ['!', '!!', '!!!'];
        return variants[Math.floor(Math.random() * variants.length)];
      });
    }

    return msg;
  }

  // QWERTY keyboard adjacent key map for realistic human typos
  private static readonly ADJACENT_KEYS: Record<string, string[]> = {
    a: ['q', 'w', 's', 'z'],
    b: ['v', 'g', 'h', 'n'],
    c: ['x', 'd', 'f', 'v'],
    d: ['s', 'e', 'r', 'f', 'c', 'x'],
    e: ['w', 's', 'd', 'r'],
    f: ['d', 'r', 't', 'g', 'v', 'c'],
    g: ['f', 't', 'y', 'h', 'b', 'v'],
    h: ['g', 'y', 'u', 'j', 'n', 'b'],
    i: ['u', 'j', 'k', 'o'],
    j: ['h', 'u', 'i', 'k', 'm', 'n'],
    k: ['j', 'i', 'o', 'l', 'm'],
    l: ['k', 'o', 'p'],
    m: ['n', 'j', 'k'],
    n: ['b', 'h', 'j', 'm'],
    o: ['i', 'k', 'l', 'p'],
    p: ['o', 'l'],
    q: ['w', 'a'],
    r: ['e', 'd', 'f', 't'],
    s: ['a', 'w', 'e', 'd', 'x', 'z'],
    t: ['r', 'f', 'g', 'y'],
    u: ['y', 'h', 'j', 'i'],
    v: ['c', 'f', 'g', 'b'],
    w: ['q', 'a', 's', 'e'],
    x: ['z', 's', 'd', 'c'],
    y: ['t', 'g', 'h', 'u'],
    z: ['a', 's', 'x'],
  };

  /**
   * Calculates realistic human read delay and typing delay based on Gaussian Box-Muller distribution:
   * 1. Reading: Gaussian delay per char (mean: 310ms, std: 45ms, min: 250ms).
   * 2. Inter-word gap: Gaussian pause between words (mean: 650ms, std: 110ms, min: 500ms).
   * 3. Keystroke typing: Gaussian cadence (mean: 110ms, std: 25ms).
   * 4. Typo + Backspace simulation: Realistic keyboard typos, pause to notice, backspace & retype.
   */
  public calculateHumanDelays(incomingText: string, replyText: string): {
    readDelayMs: number;
    typingDelayMs: number;
    totalDelayMs: number;
    simulatedTyposCount: number;
  } {
    const inClean = (incomingText || "").trim();
    const inCharCount = inClean.length;

    // 1. Initial Notification / Reading Pause (10s - 15s): Real humans do not open notifications instantly
    const baseNoticeDelay = this.gaussianRandom(12000, 1200, 10000, 15000);
    const readDelayMs = baseNoticeDelay;

    // 2. Typing Time with Gaussian word gap & Typo simulation
    const words = (replyText || "").trim().split(/\s+/).filter(Boolean);
    let typingDelayMs = 0;
    let simulatedTyposCount = 0;

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];

      // Gaussian gap between words (mean: 650ms, std: 110ms, min: 500ms)
      if (wIdx > 0) {
        typingDelayMs += this.gaussianRandom(650, 110, 500, 950);
      }

      // Check if a typo should occur on this word (~20% chance on words with >= 3 chars)
      const hasTypo = word.length >= 3 && Math.random() < 0.22;

      if (hasTypo) {
        simulatedTyposCount++;
        // Type characters up to typo point
        const typoPos = Math.floor(Math.random() * (word.length - 1)) + 1;
        
        // 1. Type correct chars up to typo (Gaussian per char)
        for (let i = 0; i < typoPos; i++) {
          typingDelayMs += this.gaussianRandom(105, 20, 80, 160);
        }

        // 2. Type 1-2 wrong characters (Gaussian per char)
        const wrongCharsCount = Math.random() < 0.7 ? 1 : 2;
        for (let i = 0; i < wrongCharsCount; i++) {
          typingDelayMs += this.gaussianRandom(125, 25, 95, 180);
        }

        // 3. Human realization pause ("Mistake noticed!"): Gaussian mean 360ms, std 40ms
        typingDelayMs += this.gaussianRandom(360, 40, 280, 480);

        // 4. Backspacing each wrong character: Gaussian mean 135ms, std 15ms
        for (let i = 0; i < wrongCharsCount + 1; i++) {
          typingDelayMs += this.gaussianRandom(135, 15, 110, 170);
        }

        // 5. Retype remaining word correctly
        for (let i = typoPos; i < word.length; i++) {
          typingDelayMs += this.gaussianRandom(105, 20, 80, 160);
        }
      } else {
        // Normal typing for this word (Gaussian ~105ms per char with natural human variance)
        for (let c = 0; c < word.length; c++) {
          typingDelayMs += this.gaussianRandom(105, 22, 75, 165);
        }
      }
    }

    // Clamp typing delay within natural human bounds (minimum 2.5s, maximum 9s)
    const finalTyping = Math.max(2500, Math.min(9000, Math.round(typingDelayMs)));

    return {
      readDelayMs,
      typingDelayMs: finalTyping,
      totalDelayMs: readDelayMs + finalTyping,
      simulatedTyposCount,
    };
  }

  /**
   * Generates step-by-step keystroke progression with real-time typos and backspaces.
   * Useful for UI typing simulations, browser inputs, and realistic typing streams.
   */
  public generateKeystrokeTypoStream(text: string): Array<{ text: string; delayMs: number; isBackspace?: boolean }> {
    const stream: Array<{ text: string; delayMs: number; isBackspace?: boolean }> = [];
    const words = (text || "").trim().split(/\s+/).filter(Boolean);
    let currentText = "";

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      if (wIdx > 0) {
        currentText += " ";
        // 0.5s - 0.95s inter-word pause
        stream.push({ text: currentText, delayMs: 500 + Math.floor(Math.random() * 450) });
      }

      const hasTypo = word.length >= 3 && Math.random() < 0.25;

      if (hasTypo) {
        const typoPos = Math.floor(Math.random() * (word.length - 1)) + 1;
        // 1. Type correct characters up to typo point
        for (let i = 0; i < typoPos; i++) {
          currentText += word[i];
          stream.push({ text: currentText, delayMs: 90 + Math.floor(Math.random() * 45) });
        }

        // 2. Type 1-2 wrong adjacent characters (e.g. 'e' instead of 'a' -> 'rem' instead of 'ram')
        const charToMess = word[typoPos].toLowerCase();
        const adjacentOptions = HumanBotFirewallService.ADJACENT_KEYS[charToMess] || ['e', 's', 'd', 'r'];
        const wrongChar = adjacentOptions[Math.floor(Math.random() * adjacentOptions.length)] || 'e';
        currentText += wrongChar;
        stream.push({ text: currentText, delayMs: 110 + Math.floor(Math.random() * 50) });

        // 3. Human realization pause ("Mistake noticed!"): 300ms - 500ms
        stream.push({ text: currentText, delayMs: 320 + Math.floor(Math.random() * 180) });

        // 4. Backspace wrong character
        currentText = currentText.slice(0, -1);
        stream.push({ text: currentText, delayMs: 140 + Math.floor(Math.random() * 40), isBackspace: true });

        // 5. Retype correct character and finish word
        for (let i = typoPos; i < word.length; i++) {
          currentText += word[i];
          stream.push({ text: currentText, delayMs: 95 + Math.floor(Math.random() * 45) });
        }
      } else {
        // Normal human typing
        for (let i = 0; i < word.length; i++) {
          currentText += word[i];
          stream.push({ text: currentText, delayMs: 90 + Math.floor(Math.random() * 45) });
        }
      }
    }

    return stream;
  }

  /**
   * Student Exam / Question Reading Simulator:
   * Waits 30 to 45 seconds with natural micro-scrolling and reading pauses,
   * exactly like a real student reading a question, reviewing options, and thinking before answering.
   */
  public async simulateStudentDeepThinkingDelay(
    minSeconds = 30,
    maxSeconds = 45,
    onProgress?: (info: { elapsedSeconds: number; totalSeconds: number; phase: string }) => void
  ): Promise<number> {
    const totalSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds; // 30s to 45s
    const totalMs = totalSeconds * 1000;
    const startTime = Date.now();

    console.log(`[HumanFirewall] 🎓 Student Reading Mode: Pausing for ${totalSeconds}s (30s-45s range) with natural micro-scrolls...`);

    const phases = [
      { name: "Reading question statement carefully", fraction: 0.30 },
      { name: "Slow micro-scroll down to review options", fraction: 0.25 },
      { name: "Thinking & analyzing solution", fraction: 0.30 },
      { name: "Final verification before submitting", fraction: 0.15 },
    ];

    let currentPhaseIdx = 0;
    while (Date.now() - startTime < totalMs) {
      const elapsedMs = Date.now() - startTime;
      const progressFraction = Math.min(1, elapsedMs / totalMs);

      // Determine current phase
      let accumulated = 0;
      for (let i = 0; i < phases.length; i++) {
        accumulated += phases[i].fraction;
        if (progressFraction <= accumulated) {
          currentPhaseIdx = i;
          break;
        }
      }

      if (onProgress) {
        onProgress({
          elapsedSeconds: Math.floor(elapsedMs / 1000),
          totalSeconds,
          phase: phases[currentPhaseIdx].name,
        });
      }

      // Micro step sleep (1.5s - 3s)
      const stepMs = Math.min(totalMs - elapsedMs, 2000 + Math.floor(Math.random() * 1000));
      await this.sleep(stepMs);
    }

    console.log(`[HumanFirewall] 🎓 Student Reading completed (${totalSeconds}s elapsed). Ready to answer naturally.`);
    return totalSeconds;
  }

  /**
   * Character-by-character Human Typing for Browser Pages (Puppeteer / CDP / Playwright):
   * STRICT ANTI-COPY-PASTE: Never uses clipboard dumps or value injections!
   * Simulates realistic physical keystrokes, inter-word pauses (0.5s+),
   * keyboard typos on nearby keys, hesitation pause, backspace delete, and re-typing.
   */
  public async typeHumanlyIntoPage(page: any, text: string): Promise<void> {
    if (!page || !page.keyboard) return;

    const words = (text || "").trim().split(/\s+/).filter(Boolean);

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];

      // Minimum 0.5s pause between words (500ms - 950ms)
      if (wIdx > 0) {
        await page.keyboard.type(" ", { delay: 0 });
        await this.sleep(500 + Math.floor(Math.random() * 450));
      }

      // Check for realistic human typo
      const hasTypo = word.length >= 3 && Math.random() < 0.22;

      if (hasTypo) {
        const typoPos = Math.floor(Math.random() * (word.length - 1)) + 1;

        // 1. Type correct chars up to typo
        for (let i = 0; i < typoPos; i++) {
          await page.keyboard.type(word[i], { delay: 0 });
          await this.sleep(90 + Math.floor(Math.random() * 45));
        }

        // 2. Type wrong character from adjacent QWERTY key
        const charToMess = word[typoPos].toLowerCase();
        const adjacentOptions = HumanBotFirewallService.ADJACENT_KEYS[charToMess] || ['e', 's', 'd', 'r'];
        const wrongChar = adjacentOptions[Math.floor(Math.random() * adjacentOptions.length)] || 'e';
        await page.keyboard.type(wrongChar, { delay: 0 });
        await this.sleep(110 + Math.floor(Math.random() * 50));

        // 3. Hesitation pause (noticing typo): 320ms - 500ms
        await this.sleep(320 + Math.floor(Math.random() * 180));

        // 4. Backspace wrong character
        await page.keyboard.press("Backspace");
        await this.sleep(140 + Math.floor(Math.random() * 40));

        // 5. Retype remaining word correctly
        for (let i = typoPos; i < word.length; i++) {
          await page.keyboard.type(word[i], { delay: 0 });
          await this.sleep(95 + Math.floor(Math.random() * 45));
        }
      } else {
        // Normal typing
        for (let i = 0; i < word.length; i++) {
          await page.keyboard.type(word[i], { delay: 0 });
          await this.sleep(90 + Math.floor(Math.random() * 45));
        }
      }
    }
  }

  /**
   * Helper to get realistic human typing delay for an outgoing message text
   */
  public calculateDynamicTypingDelay(messageText: string): number {
    return this.calculateHumanDelays("", messageText).typingDelayMs;
  }

  /**
   * Sleep helper
   */
  public sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private todayIST(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  private currentHourKey(): string {
    const d = new Date();
    return `${this.todayIST()}_${d.getHours()}`;
  }

  /**
   * Checks if an auto-reply is allowed or should be rate-limited by the firewall.
   */
  public canSendAutoReply(
    platform: "whatsapp" | "instagram",
    recipientKey: string
  ): { allowed: boolean; reason?: string } {
    const compositeKey = `${platform}:${recipientKey}`;
    const now = Date.now();
    const today = this.todayIST();
    const hourKey = this.currentHourKey();

    // 1. Rapid fire cooldown check (6 seconds)
    const lastAt = this.lastReplyTimestamps.get(compositeKey) || 0;
    if (now - lastAt < this.MIN_COOLDOWN_MS) {
      this.blockedSpamCount++;
      return { allowed: false, reason: `Rapid fire cooldown active (${Math.ceil((this.MIN_COOLDOWN_MS - (now - lastAt)) / 1000)}s left)` };
    }

    // 2. Platform hourly limit
    const hourly = this.hourlyCount.get(platform);
    if (hourly && hourly.hourKey === hourKey) {
      if (hourly.count >= this.MAX_HOURLY_PLATFORM) {
        this.blockedSpamCount++;
        return { allowed: false, reason: `Platform hourly ban-protection limit reached (${this.MAX_HOURLY_PLATFORM}/hr)` };
      }
    }

    // 3. Contact daily reply limit
    const daily = this.replyCountToday.get(compositeKey);
    if (daily && daily.dateStr === today) {
      if (daily.count >= this.MAX_DAILY_PER_CONTACT) {
        this.blockedSpamCount++;
        return { allowed: false, reason: `Daily auto-reply limit reached for contact (${this.MAX_DAILY_PER_CONTACT}/day)` };
      }
    }

    return { allowed: true };
  }

  /**
   * Records that an auto-reply was successfully dispatched.
   */
  public recordDispatchedMessage(platform: "whatsapp" | "instagram", recipientKey: string) {
    const compositeKey = `${platform}:${recipientKey}`;
    const now = Date.now();
    const today = this.todayIST();
    const hourKey = this.currentHourKey();

    this.lastReplyTimestamps.set(compositeKey, now);
    this.lastActivePlatform = platform;
    this.totalProtectedMessages++;

    // Update daily count
    const daily = this.replyCountToday.get(compositeKey);
    if (!daily || daily.dateStr !== today) {
      this.replyCountToday.set(compositeKey, { count: 1, dateStr: today });
    } else {
      daily.count++;
    }

    // Update hourly count
    const hourly = this.hourlyCount.get(platform);
    if (!hourly || hourly.hourKey !== hourKey) {
      this.hourlyCount.set(platform, { count: 1, hourKey });
    } else {
      hourly.count++;
    }
  }

  private goOfflineTimer: any = null;

  /**
   * Schedules turning WhatsApp presence back to "unavailable" (Offline) after a natural pause.
   */
  public scheduleGoOffline(sock: any, delayMs = 14000) {
    if (this.goOfflineTimer) clearTimeout(this.goOfflineTimer);
    this.goOfflineTimer = setTimeout(async () => {
      try {
        if (sock && sock.sendPresenceUpdate) {
          await sock.sendPresenceUpdate("unavailable");
          console.log("[HumanFirewall] WhatsApp presence automatically switched to OFFLINE (Natural human close).");
        }
      } catch {}
    }, delayMs);
  }

  /**
   * WhatsApp Human Simulator:
   * 1. Remains OFFLINE during initial reading period.
   * 2. Switches to ONLINE ('available') when opening chat.
   * 3. Marks message as read (blue ticks).
   * 4. Shows "composing" (typing...) with 0.5s word gaps & typo-backspace simulation.
   * 5. Brief tap pause, sends message.
   * 6. Automatically switches back to OFFLINE ('unavailable') after 14s of inactivity.
   */
  /**
   * WhatsApp Human Simulator:
   * 1. Remains OFFLINE during initial reading period (Gaussian delayed).
   * 2. Switches to ONLINE ('available') when opening chat.
   * 3. Marks message as read (blue ticks) after natural reaction.
   * 4. Shows "composing" (typing...) with Gaussian word gaps & typo-backspace simulation.
   * 5. Brief tap pause (Gaussian), sends message.
   * 6. Automatically switches back to OFFLINE ('unavailable') after natural inactivity window.
   */
  public async simulateWhatsAppHumanTyping(
    sock: any,
    jid: string,
    messageKey: any,
    incomingText: string,
    replyText: string
  ): Promise<void> {
    if (!sock) return;

    const { readDelayMs, typingDelayMs } = this.calculateHumanDelays(incomingText, replyText);

    try {
      // 1. Reading pause while still OFFLINE (Simulating lockscreen/notification preview reading)
      await this.sleep(readDelayMs);

      // 2. Open WhatsApp -> Go ONLINE
      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate("available").catch(() => {});
      }

      // 3. Mark as Read (Blue ticks appear when chat opens)
      if (messageKey && sock.readMessages) {
        await sock.readMessages([messageKey]).catch(() => {});
      }

      // 4. Human thinking & reaction pause after opening chat (Gaussian mean 850ms, std 180ms)
      const thinkingDelay = this.gaussianRandom(850, 180, 500, 1400);
      await this.sleep(thinkingDelay);

      // 5. Presence "composing" (Shows 'typing...' to sender)
      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate("composing", jid).catch(() => {});
      }

      // 6. Typing duration pause (Includes Gaussian word gaps and typo-backspaces)
      await this.sleep(typingDelayMs);

      // 7. Presence "paused" (Brief pause before hitting Send button: Gaussian mean 450ms, std 80ms)
      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate("paused", jid).catch(() => {});
      }
      const preSendPause = this.gaussianRandom(450, 80, 300, 700);
      await this.sleep(preSendPause);

      // 8. Auto-schedule returning to OFFLINE after natural inactivity (Gaussian 12s - 20s)
      const offlineDelay = this.gaussianRandom(15000, 2500, 10000, 22000);
      this.scheduleGoOffline(sock, offlineDelay);
    } catch (e) {
      console.warn("[HumanFirewall] WhatsApp presence simulation notice:", e);
    }
  }

  /**
   * Human Entropy (Inbound Simulation):
   * Emulates a real human unlocking the phone and checking WhatsApp periodically:
   * 1. Briefly goes 'available' (Online).
   * 2. Scrolls through recent active chats, subscribes to contact presence, checks statuses/profile previews.
   * 3. Idles naturally for 8s-22s (mimicking human reading/scrolling chat history & status feed).
   * 4. Switches back to 'unavailable' (Offline).
   * Active 24/7 (Sleep hours disabled).
   */
  public async simulateWhatsAppInboundEntropy(sock: any, knownJids: string[] = []): Promise<void> {
    if (!sock) return;

    try {
      // Human checks WhatsApp (24/7 Active)
      console.log("[HumanFirewall] 📱 Human Entropy: Simulating natural phone unlock & WhatsApp chat scrolling session...");
      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate("available").catch(() => {});
      }

      // 1. If we have recent active contacts/chats, simulate scrolling and tapping on 1 to 3 chats
      if (knownJids.length > 0) {
        const shuffled = [...knownJids].sort(() => 0.5 - Math.random());
        const chatsToBrowse = shuffled.slice(0, Math.min(3, Math.floor(Math.random() * 3) + 1));

        for (const chatJid of chatsToBrowse) {
          try {
            // Human taps chat: presence subscription
            if (sock.presenceSubscribe) {
              await sock.presenceSubscribe(chatJid).catch(() => {});
            }

            // Human scrolls through chat history / reads messages (1.5s - 3.8s)
            const chatReadTime = this.gaussianRandom(2400, 600, 1200, 4200);
            await this.sleep(chatReadTime);

            // 25% chance human checks user's status or profile
            if (Math.random() < 0.25 && sock.fetchStatus) {
              await sock.fetchStatus(chatJid).catch(() => {});
            }
            if (Math.random() < 0.15 && sock.profilePictureUrl) {
              await sock.profilePictureUrl(chatJid, "preview").catch(() => {});
            }

            // Micro gap before returning to chat list
            await this.sleep(400 + Math.floor(Math.random() * 500));
          } catch {}
        }
      }

      // General feed / status tab scroll idle
      const browseDuration = this.gaussianRandom(6000, 1500, 3500, 10000);
      await this.sleep(browseDuration);

      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate("unavailable").catch(() => {});
      }
      console.log("[HumanFirewall] 📱 Human Entropy: WhatsApp chat scrolling concluded, back to offline.");
    } catch (e) {
      console.warn("[HumanFirewall] Notice in inbound entropy session:", e);
    }
  }

  /**
   * Instagram Ultra-Realistic Human DM Lifecycle Engine:
   * 1. [STANDBY / OFFLINE]: Bot is NOT constantly online.
   * 2. [10-SECOND NOTICE DELAY]: When message arrives, wait ~10s before opening chat (looks unread on sender's phone).
   * 3. [SEEN RECEIPT]: Open chat -> Mark message as seen (`direct_message_seen`).
   * 4. [UNDERSTANDING / THINKING DELAY]: Pause 3 to 6 seconds while reading & understanding what to reply.
   * 5. [TYPING DELAY]: Character-by-character human typing presence (with natural word gaps & pauses).
   * 6. [PRE-SEND DELAY]: 0.5s - 1.5s final pause before tapping Send button.
   * 7. [POST-DISPATCH STANDBY / OFFLINE]: After dispatch, close active session & return to offline idle.
   */
  public async simulateInstagramHumanTyping(
    ig: any,
    threadId: string,
    itemId: string,
    incomingText: string,
    replyText: string
  ): Promise<void> {
    try {
      // ── STAGE 1: 10-Second Notice Delay (Phone in pocket/table -> pick up phone -> unlock) ──
      const noticeDelayMs = this.gaussianRandom(10000, 1000, 9000, 13000); // 9-13s (around 10s)
      console.log(`[HumanFirewall] 📱 Stage 1: Notification received. Waiting ${(noticeDelayMs/1000).toFixed(1)}s before opening DM (sender sees Unread)...`);
      await this.sleep(noticeDelayMs);

      // ── STAGE 2: Open Chat & Mark Seen ──
      console.log(`[HumanFirewall] 👁️ Stage 2: Opening chat and marking message as SEEN...`);
      if (ig && threadId && itemId) {
        try {
          if (typeof ig.markSeen === "function") {
            await ig.markSeen(threadId, itemId).catch(() => {});
          } else if (ig.entity?.directThread) {
            const directThread = ig.entity.directThread(threadId);
            await directThread.markItemSeen(itemId).catch(() => {});
          }
        } catch {}
      }

      // ── STAGE 3: Samajhne Ka Delay (Understanding / Thinking Delay: 3-6s) ──
      const understandingDelayMs = this.gaussianRandom(4000, 700, 3000, 6000); // 3-6s
      console.log(`[HumanFirewall] 🤔 Stage 3: Reading & understanding message for ${(understandingDelayMs/1000).toFixed(1)}s...`);
      await this.sleep(understandingDelayMs);

      // ── STAGE 4: Typing Delay (Real human speed: ~100ms per char + word gaps) ──
      const { typingDelayMs } = this.calculateHumanDelays(incomingText, replyText);
      console.log(`[HumanFirewall] ⌨️ Stage 4: Simulating human typing for ${(typingDelayMs/1000).toFixed(1)}s (${replyText.length} chars)...`);
      await this.sleep(typingDelayMs);

      // ── STAGE 5: Pre-Send Tap Delay (0.5s - 1.5s pause before pressing send) ──
      const preSendPause = this.gaussianRandom(850, 150, 500, 1500);
      console.log(`[HumanFirewall] 👆 Stage 5: Final ${(preSendPause/1000).toFixed(1)}s pause before tapping Send...`);
      await this.sleep(preSendPause);

      // ── STAGE 6: Offline / Standby log ──
      console.log(`[HumanFirewall] 🚀 Stage 6: Dispatched! Returning to offline idle standby.`);
    } catch (e) {
      console.warn("[HumanFirewall] Instagram presence simulation notice:", e);
    }
  }

  /**
   * Photo & Media Attachment Simulator for WhatsApp:
   * 1. 0.5s (500ms) tap delay for opening attachment/gallery.
   * 2. 0.5s (500ms) tap delay for photo selection.
   * 3. If caption present -> realistic typing presence (0.5s word gap + typo correction).
   * 4. 0.5s (500ms) tap delay for pressing Send button.
   */
  public async simulateWhatsAppPhotoDelays(
    sock: any,
    jid: string,
    caption?: string
  ): Promise<void> {
    try {
      // 1. Tap attachment/camera icon pause: Min 0.5s (500ms - 850ms)
      await this.sleep(500 + Math.floor(Math.random() * 350));

      // 2. Select photo from gallery pause: Min 0.5s (500ms - 850ms)
      await this.sleep(500 + Math.floor(Math.random() * 350));

      // 3. If caption present, simulate human typing presence
      if (caption && caption.trim()) {
        const delays = this.calculateHumanDelays("", caption);
        if (sock && sock.sendPresenceUpdate) {
          await sock.sendPresenceUpdate("composing", jid).catch(() => {});
        }
        await this.sleep(delays.typingDelayMs);
        if (sock && sock.sendPresenceUpdate) {
          await sock.sendPresenceUpdate("paused", jid).catch(() => {});
        }
      }

      // 4. Tap send button pause: Min 0.5s (500ms - 850ms)
      await this.sleep(500 + Math.floor(Math.random() * 350));
    } catch (e) {
      console.warn("[HumanFirewall] WhatsApp photo simulation notice:", e);
    }
  }

  /**
   * Photo & Media Simulator for Instagram:
   * 1. Min 0.5s (500ms - 850ms) tap gallery.
   * 2. Min 0.5s (500ms - 850ms) select photo.
   * 3. Min 0.5s (500ms - 850ms) tap send.
   */
  public async simulateInstagramPhotoDelays(): Promise<void> {
    // 1. Open photo picker
    await this.sleep(500 + Math.floor(Math.random() * 350));
    // 2. Select image
    await this.sleep(500 + Math.floor(Math.random() * 350));
    // 3. Tap send
    await this.sleep(500 + Math.floor(Math.random() * 350));
  }

  /**
   * Link Sharing Simulator (WhatsApp / Instagram):
   * 1. Min 0.5s paste link pause.
   * 2. Min 0.5s link preview thumbnail fetch pause.
   * 3. Min 0.5s tap send.
   */
  public async simulateLinkSharingDelays(sockOrIg?: any, jid?: string): Promise<void> {
    // 1. Paste link pause
    await this.sleep(500 + Math.floor(Math.random() * 350));

    // 2. Show brief composing while preview loads
    if (sockOrIg?.sendPresenceUpdate && jid) {
      await sockOrIg.sendPresenceUpdate("composing", jid).catch(() => {});
      await this.sleep(600 + Math.floor(Math.random() * 300));
      await sockOrIg.sendPresenceUpdate("paused", jid).catch(() => {});
    } else {
      await this.sleep(500 + Math.floor(Math.random() * 350));
    }

    // 3. Tap send pause
    await this.sleep(500 + Math.floor(Math.random() * 350));
  }

  /**
   * Instagram Search Simulator:
   * 1. Min 0.5s tap search icon.
   * 2. Type query with realistic ~90-140ms per char.
   * 3. Min 0.5s wait for search results to render.
   */
  public async simulateInstagramSearchTyping(query: string): Promise<void> {
    // 1. Tap search bar
    await this.sleep(500 + Math.floor(Math.random() * 350));

    // 2. Type query characters (e.g. 90ms - 130ms per char)
    const clean = (query || "").trim();
    for (let i = 0; i < clean.length; i++) {
      await this.sleep(90 + Math.floor(Math.random() * 40));
    }

    // 3. Min 0.5s wait for results list
    await this.sleep(500 + Math.floor(Math.random() * 350));
  }

  /**
   * Instagram Human Feed / Post Scroll Step:
   * Simulates a human flick/scroll gesture and reading each post (0.5s - 0.7s per item).
   */
  public async simulateInstagramScrollStep(): Promise<void> {
    const scrollDuration = 500 + Math.floor(Math.random() * 200); // 500ms - 700ms
    await this.sleep(scrollDuration);
  }

  /**
   * Instagram Like Tap Simulation:
   * 1. 0.5s pause looking at post.
   * 2. Double-tap / Heart icon press (250ms).
   * 3. 0.5s pause after like.
   */
  public async simulateInstagramLikeTap(): Promise<void> {
    await this.sleep(500);
    await this.sleep(250);
    await this.sleep(500);
  }

  /**
   * Instagram Comment Simulation:
   * 1. 0.5s tap comment icon.
   * 2. Type comment text with 0.5s word gaps + typo simulation.
   * 3. 0.5s tap post/send comment.
   */
  public async simulateInstagramCommentTyping(comment: string): Promise<void> {
    // 1. Tap comment box
    await this.sleep(500);

    // 2. Type comment with word gaps
    const delays = this.calculateHumanDelays("", comment);
    await this.sleep(delays.typingDelayMs);

    // 3. Tap post comment
    await this.sleep(500);
  }

  // =========================================================================
  // 6 ADVANCED STEALTH & ANTI-DETECTION TECHNIQUES
  // =========================================================================

  /**
   * Technique 1: Bézier Curved Mouse Movement with Realistic Overshoot & Hand Tremor
   * Calculates a cubic Bézier curve with randomized control points and hand-jitter.
   */
  public async moveMouseBezierWithOvershoot(
    page: any,
    targetX: number,
    targetY: number,
    startX?: number,
    startY?: number
  ): Promise<void> {
    if (!page || !page.mouse) return;

    // Get or fallback start position
    const curX = startX ?? Math.floor(Math.random() * 400 + 200);
    const curY = startY ?? Math.floor(Math.random() * 300 + 150);

    // Calculate overshoot point (past target by 8px - 22px in flight direction)
    const angle = Math.atan2(targetY - curY, targetX - curX);
    const overshootDist = 8 + Math.random() * 14;
    const overshootX = targetX + Math.cos(angle) * overshootDist;
    const overshootY = targetY + Math.sin(angle) * overshootDist;

    // Control points for cubic Bézier
    const cp1X = curX + (targetX - curX) * 0.25 + (Math.random() - 0.5) * 80;
    const cp1Y = curY + (targetY - curY) * 0.25 + (Math.random() - 0.5) * 80;
    const cp2X = curX + (targetX - curX) * 0.75 + (Math.random() - 0.5) * 50;
    const cp2Y = curY + (targetY - curY) * 0.75 + (Math.random() - 0.5) * 50;

    const steps = 18 + Math.floor(Math.random() * 10);

    // 1. Move to Overshoot along Bézier curve
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Cubic Bézier formula
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      let x = uuu * curX + 3 * uu * t * cp1X + 3 * u * tt * cp2X + ttt * overshootX;
      let y = uuu * curY + 3 * uu * t * cp1Y + 3 * u * tt * cp2Y + ttt * overshootY;

      // Add subtle hand tremor (0.5px - 1.5px)
      x += (Math.random() - 0.5) * 1.5;
      y += (Math.random() - 0.5) * 1.5;

      await page.mouse.move(x, y);
      await this.sleep(8 + Math.floor(Math.random() * 12));
    }

    // 2. Micro-pause at overshoot
    await this.sleep(40 + Math.floor(Math.random() * 60));

    // 3. Correction back to true target
    const correctionSteps = 6;
    for (let j = 1; j <= correctionSteps; j++) {
      const ct = j / correctionSteps;
      const cx = overshootX + (targetX - overshootX) * ct;
      const cy = overshootY + (targetY - overshootY) * ct;
      await page.mouse.move(cx, cy);
      await this.sleep(12 + Math.floor(Math.random() * 10));
    }
  }

  /**
   * Technique 2: Inverted Micro-Scroll & Re-reading Simulator
   * Scrolls down with variable human speed, then occasionally scrolls BACK UP (40px-90px)
   * to mimic re-reading earlier lines or options.
   */
  public async simulateHumanReadingScroll(page: any, totalDistance = 500): Promise<void> {
    if (!page) return;

    let scrolled = 0;
    while (scrolled < totalDistance) {
      const step = 60 + Math.floor(Math.random() * 90);
      scrolled += step;

      // Smooth scroll down
      await page.evaluate((y: number) => {
        window.scrollBy({ top: y, behavior: "smooth" });
      }, step).catch(() => {});

      await this.sleep(300 + Math.floor(Math.random() * 400));

      // 30% chance of "Inverted Micro-Scroll" (scroll back up 40px - 85px to re-check)
      if (Math.random() < 0.32 && scrolled > 120) {
        const backUp = 40 + Math.floor(Math.random() * 45);
        await page.evaluate((y: number) => {
          window.scrollBy({ top: -y, behavior: "smooth" });
        }, backUp).catch(() => {});

        // Gaze re-read pause (800ms - 1800ms)
        await this.sleep(800 + Math.floor(Math.random() * 1000));

        // Scroll back down
        await page.evaluate((y: number) => {
          window.scrollBy({ top: y, behavior: "smooth" });
        }, backUp).catch(() => {});
        await this.sleep(250 + Math.floor(Math.random() * 200));
      }
    }
  }

  /**
   * Technique 3: Text Selection & Idle Cursor Drift
   * Drifts cursor naturally across the screen and briefly highlights random text
   * to simulate student focus while reading.
   */
  public async simulateIdleCursorDriftAndSelection(page: any): Promise<void> {
    if (!page || !page.mouse) return;

    // 1. Natural idle cursor drift across 3-4 points
    for (let i = 0; i < 3; i++) {
      const dx = 200 + Math.floor(Math.random() * 500);
      const dy = 180 + Math.floor(Math.random() * 350);
      await this.moveMouseBezierWithOvershoot(page, dx, dy);
      await this.sleep(600 + Math.floor(Math.random() * 900));
    }

    // 2. Select text and deselect (Focus highlight gesture)
    try {
      await page.evaluate(() => {
        const p = document.querySelector("p, h1, h2, h3, span, label");
        if (p && window.getSelection) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(p);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
      await this.sleep(700 + Math.floor(Math.random() * 600));

      // Deselect (Click empty spot)
      await page.evaluate(() => {
        window.getSelection()?.removeAllRanges();
      });
    } catch {}
  }

  /**
   * Technique 4: Multi-Tab Switch Simulation (Blur & Focus)
   * Simulates switching to another tab or reference window for a few seconds.
   */
  public async simulateTabSwitchPause(page: any, durationMs = 5000): Promise<void> {
    if (!page) return;

    try {
      // Trigger blur / visibility hidden
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true, configurable: true });
        Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }).catch(() => {});

      console.log(`[HumanFirewall] 🔀 Simulating tab switch / background window pause (${Math.round(durationMs / 1000)}s)...`);
      await this.sleep(durationMs);

      // Trigger focus / visibility visible
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
        Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      }).catch(() => {});

      await this.sleep(800 + Math.floor(Math.random() * 600));
    } catch {}
  }

  /**
   * Technique 5: Circadian Rhythm Awareness (IST Day / Night adaptive multiplier)
   */
  public getCircadianDelayMultiplier(): { multiplier: number; isNight: boolean; hourIST: number; description: string } {
    const d = new Date();
    const istHour = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();

    if (istHour >= 0 && istHour < 6) {
      // Late Night (12:00 AM - 6:00 AM): 2.2x slower, sleepiness buffer
      return { multiplier: 2.2, isNight: true, hourIST: istHour, description: "Late Night (Slow Human Reflexes & Night Buffer)" };
    } else if (istHour >= 6 && istHour < 9) {
      // Early Morning (6:00 AM - 9:00 AM): 1.3x wake-up buffer
      return { multiplier: 1.3, isNight: false, hourIST: istHour, description: "Early Morning (Waking Up)" };
    } else if (istHour >= 9 && istHour < 19) {
      // Peak Daytime (9:00 AM - 7:00 PM): 1.0x standard human alertness
      return { multiplier: 1.0, isNight: false, hourIST: istHour, description: "Daytime (Peak Human Alertness)" };
    } else {
      // Evening (7:00 PM - 11:59 PM): 1.2x relaxed evening pace
      return { multiplier: 1.2, isNight: false, hourIST: istHour, description: "Evening (Relaxed Human Pace)" };
    }
  }

  /**
   * Technique 6: Canvas, WebGL, Audio & Hardware Fingerprint Shield
   * Injects scripts into Puppeteer / Browser pages to spoof authentic Windows Chrome hardware signatures.
   */
  public async injectAntiFingerprintShield(page: any): Promise<void> {
    if (!page || !page.evaluateOnNewDocument) return;

    try {
      await page.evaluateOnNewDocument(() => {
        // 1. Mask navigator.webdriver
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });

        // 2. Hardware specs (8 Cores, 16GB RAM)
        Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
        Object.defineProperty(navigator, "deviceMemory", { get: () => 16 });
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });

        // 3. Indian English languages
        Object.defineProperty(navigator, "languages", { get: () => ["en-IN", "en-GB", "en-US", "hi"] });

        // 4. Spoof WebGL GPU Renderer (NVIDIA GeForce RTX 4060)
        const getParameterProto = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
          if (parameter === 37445) return "Google Inc. (NVIDIA)";
          if (parameter === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
          return getParameterProto.apply(this, [parameter]);
        };

        // 5. Canvas Micro-Entropy Noise (Defeats Canvas Hash Tracking without visual distortion)
        const toDataURLProto = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type?: string, ...args: any[]) {
          const ctx = this.getContext("2d");
          if (ctx) {
            const imgData = ctx.getImageData(0, 0, Math.min(10, this.width), Math.min(10, this.height));
            for (let i = 0; i < imgData.data.length; i += 4) {
              imgData.data[i] = (imgData.data[i] + (i % 2 === 0 ? 1 : 0)) % 256;
            }
          }
          return toDataURLProto.apply(this, [type, ...args]);
        };

        // 6. Chrome Runtime & Plugins
        (window as any).chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" } },
          runtime: { OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" } },
        };
      });
      console.log("[HumanFirewall] 🛡️ Anti-Fingerprint & Hardware Shield injected into page.");
    } catch (e) {
      console.warn("[HumanFirewall] Notice injecting fingerprint shield:", e);
    }
  }

  public getStats(): FirewallStats {
    return {
      totalProtectedMessages: this.totalProtectedMessages,
      blockedSpamCount: this.blockedSpamCount,
      lastActivePlatform: this.lastActivePlatform,
      activeRateLimits: {
        whatsappCooldownCount: this.lastReplyTimestamps.size,
        instagramCooldownCount: this.replyCountToday.size,
      },
    };
  }
}

export const humanBotFirewallService = new HumanBotFirewallService();
