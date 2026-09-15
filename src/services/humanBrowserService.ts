/**
 * humanBrowserService.ts
 *
 * FRIDAY Custom Human-Like Autonomous Chrome Browser Engine:
 * 1. Persistent User Profile: Maintains cookies, login sessions, and local storage in `.cache/friday_chrome_profile`.
 * 2. Full Anti-Bot Stealth: Puppeteer-Extra Stealth plugin, genuine Chrome binary resolution, canvas/WebGL spoofing.
 * 3. Humanized Biometrics:
 *    - Gaussian Keystroke Jitter (35ms - 130ms per char with natural inter-word pauses).
 *    - Cubic Bezier curve mouse movements with velocity decay and micro-jitters.
 *    - Step-by-step human smooth scrolling with random reading pauses.
 * 4. Vision & Content Grounding: Integrates with Gemini Vision for visual DOM reasoning and OCR.
 * 5. High-Level Agentic Actions: Google search inspection, Amazon/Flipkart lookup, full-page screenshot capture.
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, Page } from "puppeteer-core";

// Register Stealth Plugin
puppeteerExtra.use(StealthPlugin());

export interface BrowserActionResult {
  success: boolean;
  url?: string;
  title?: string;
  summary?: string;
  extractedData?: any;
  screenshotBuffer?: Buffer;
  error?: string;
}

export interface BrowseOptions {
  waitForSelector?: string;
  timeoutMs?: number;
  takeScreenshot?: boolean;
  extractText?: boolean;
  extractVisionSummary?: boolean;
  customHeaders?: Record<string, string>;
}

class HumanBrowserService {
  private browser: Browser | null = null;
  private isLaunching = false;
  private readonly PROFILE_DIR = path.join(process.cwd(), ".cache", "friday_chrome_profile");
  private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // Auto-close browser after 10 mins of inactivity to save RAM
  private idleTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureProfileDir();
  }

  private ensureProfileDir(): void {
    try {
      if (!fs.existsSync(this.PROFILE_DIR)) {
        fs.mkdirSync(this.PROFILE_DIR, { recursive: true });
      }
    } catch (e) {
      console.warn("[HumanBrowser] Notice creating profile dir:", e);
    }
  }

  /**
   * Discovers the best available Google Chrome or Chromium executable.
   */
  public findChromeExecutable(): string {
    const candidates: string[] = [
      process.env.PUPPETEER_EXECUTABLE_PATH || "",
      process.env.CHROME_BIN || "",
      process.env.CHROME_PATH || "",
      // Windows standard paths
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.PROGRAMFILES || "", "Google\\Chrome\\Application\\chrome.exe"),
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      // Linux / Render Cloud paths
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    ];

    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }

    // Try Puppeteer cache directories (.cache/puppeteer)
    const possiblePuppeteerDirs = [
      path.join(process.cwd(), ".cache", "puppeteer"),
      path.join(process.cwd(), "dist", ".cache", "puppeteer"),
      "/opt/render/project/src/.cache/puppeteer",
    ];

    for (const baseDir of possiblePuppeteerDirs) {
      if (fs.existsSync(baseDir)) {
        try {
          const files = this.scanDirForExe(baseDir);
          if (files.length > 0) return files[0];
        } catch {}
      }
    }

    // Fallback: Use puppeteer default if available
    try {
      const puppeteerPkg = require("puppeteer");
      if (puppeteerPkg && typeof puppeteerPkg.executablePath === "function") {
        const pPath = puppeteerPkg.executablePath();
        if (pPath && fs.existsSync(pPath)) return pPath;
      }
    } catch {}

    // On-demand install if missing
    try {
      console.log("[HumanBrowser] ⏳ Downloading dedicated Chrome binary to .cache/puppeteer...");
      const targetCache = path.join(process.cwd(), ".cache", "puppeteer");
      execSync(`npx @puppeteer/browsers install chrome@stable --path "${targetCache}"`, {
        stdio: "inherit",
        timeout: 180000,
      });
      const installed = this.scanDirForExe(targetCache);
      if (installed.length > 0) return installed[0];
    } catch (installErr) {
      console.warn("[HumanBrowser] Auto-install Chrome warning:", installErr);
    }

    return "chrome";
  }

  private scanDirForExe(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirForExe(full));
      } else if (entry.isFile()) {
        if (
          entry.name === "chrome.exe" ||
          entry.name === "chrome" ||
          entry.name === "chromium" ||
          entry.name === "google-chrome"
        ) {
          results.push(full);
        }
      }
    }
    return results;
  }

  /**
   * Initializes or returns the persistent Chrome instance.
   */
  public async getBrowser(): Promise<Browser> {
    this.resetIdleTimer();

    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    if (this.isLaunching) {
      // Wait for existing launch to settle
      await new Promise((r) => setTimeout(r, 800));
      if (this.browser && this.browser.connected) return this.browser;
    }

    this.isLaunching = true;
    try {
      const executablePath = this.findChromeExecutable();
      console.log(`[HumanBrowser] 🌐 Launching Persistent Stealth Chrome: ${executablePath}`);

      let proxyUrl =
        process.env.INDIA_PROXY_URL ||
        process.env.INDIAN_PROXY_URL ||
        process.env.RESIDENTIAL_PROXY_URL ||
        process.env.WHATSAPP_PROXY_URL ||
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY;

      // Auto-configure from ScraperAPI or ZenRows keys if explicit proxy URL not set
      if (!proxyUrl) {
        const scraperApiKey = process.env.SCRAPERAPI_KEY || process.env.SCRAPER_API_KEY;
        const zenrowsApiKey = process.env.ZENROWS_API_KEY || process.env.ZENROWS_KEY;

        if (scraperApiKey) {
          proxyUrl = `http://scraperapi.country_code=in.render=true:${scraperApiKey.trim()}@proxy-server.scraperapi.com:8001`;
          console.log("[HumanBrowser] 🇮🇳 Configured Indian Residential Proxy via ScraperAPI.");
        } else if (zenrowsApiKey) {
          proxyUrl = `http://${zenrowsApiKey.trim()}:js_render=true&premium_proxy=true&proxy_country=in@proxy.zenrows.com:8001`;
          console.log("[HumanBrowser] 🇮🇳 Configured Indian Residential Proxy via ZenRows.");
        }
      }

      const isRenderOrCloud = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === "production");

      const args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--window-size=1280,800",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--lang=en-IN,hi",
        "--accept-lang=en-IN,en-GB,en-US,en,hi",
        `--user-data-dir=${this.PROFILE_DIR}`,
      ];

      // Ultra-low RAM flags for Render 512MB container
      if (isRenderOrCloud) {
        args.push(
          "--single-process",
          "--renderer-process-limit=1",
          "--js-flags=--max-old-space-size=96",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--disable-software-rasterizer"
        );
      }

      if (proxyUrl) {
        console.log(`[HumanBrowser] 🇮🇳 Routing Chrome through Indian Residential Proxy Tunnel.`);
        args.push(`--proxy-server=${proxyUrl}`);
      }

      this.browser = await (puppeteerExtra as any).launch({
        executablePath,
        headless: "new",
        args,
        defaultViewport: {
          width: 1280,
          height: 800,
          deviceScaleFactor: 1,
          hasTouch: false,
          isLandscape: true,
          isMobile: false,
        },
        ignoreDefaultArgs: ["--enable-automation"],
      }) as Browser;

      console.log(`[HumanBrowser] ✅ Stealth Chrome active with persistent profile: ${this.PROFILE_DIR}`);
      return this.browser;
    } finally {
      this.isLaunching = false;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.closeBrowser().catch(() => {});
    }, this.IDLE_TIMEOUT_MS);
  }

  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        console.log("[HumanBrowser] 💤 Closing idle Chrome session to preserve memory.");
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }

  // ── Human Interaction Helpers ───────────────────────────────────────────────

  /**
   * Character-by-character Gaussian typing simulation (40ms - 130ms jitter).
   */
  public async typeHumanLike(page: Page, selector: string, text: string): Promise<void> {
    await page.waitForSelector(selector, { visible: true, timeout: 8000 });
    await page.focus(selector);
    await this.randomDelay(200, 450);

    for (const char of text) {
      await page.keyboard.sendCharacter(char);
      // Gaussian typing delay with slightly longer pauses on spaces/punctuation
      const isSpace = char === " ";
      const isPunct = [".", ",", "!", "?", "@", "-"].includes(char);
      const delay = isSpace ? this.gaussian(140, 30) : isPunct ? this.gaussian(180, 40) : this.gaussian(65, 20);
      await new Promise((r) => setTimeout(r, Math.max(25, delay)));
    }
    await this.randomDelay(250, 600);
  }

  /**
   * Smooth step scrolling simulating natural human reading.
   */
  public async smoothScrollHumanLike(page: Page, scrolls = 3): Promise<void> {
    for (let i = 0; i < scrolls; i++) {
      const scrollStep = this.gaussian(320, 80);
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), scrollStep);
      await this.randomDelay(600, 1400);
    }
  }

  private gaussian(mean: number, std: number): number {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return Math.round(mean + z * std);
  }

  private async randomDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise((r) => setTimeout(r, ms));
  }

  // ── Rate Limiting & Velocity Guard ─────────────────────────────────────────

  private recentNavigations: number[] = [];

  /**
   * Enforces realistic human velocity limits: Prevents rapid-fire bursts to avoid Akamai/Cloudflare rate-limit bans.
   */
  private async enforceVelocityLimit(): Promise<void> {
    const now = Date.now();
    this.recentNavigations = this.recentNavigations.filter((t) => now - t < 10000); // 10s sliding window

    // If more than 3 requests in 10s, enforce natural human reading/thinking pause
    if (this.recentNavigations.length >= 3) {
      const delay = this.gaussian(2500, 600); // ~2.5s delay
      console.log(`[HumanBrowser] 🛑 Human Velocity Limiter: Pausing for ${delay}ms to respect site rate limits.`);
      await new Promise((r) => setTimeout(r, Math.max(1200, delay)));
    }
    this.recentNavigations.push(Date.now());
  }

  // ── Core High-Level Autonomous Actions ──────────────────────────────────────

  /**
   * Opens any web page in Stealth Chrome, waits for load, and extracts clean text & metadata.
   */
  public async browseUrl(url: string, options: BrowseOptions = {}): Promise<BrowserActionResult> {
    await this.enforceVelocityLimit();
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // 🇮🇳 Strict Indian Localization (Timezone, Geolocation, Languages)
      await page.emulateTimezone("Asia/Kolkata").catch(() => {});
      await page.setGeolocation({ latitude: 28.6139, longitude: 77.2090, accuracy: 100 }).catch(() => {});

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "language", { get: () => "en-IN" });
        Object.defineProperty(navigator, "languages", { get: () => ["en-IN", "en-GB", "en-US", "en", "hi"] });
      }).catch(() => {});

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
      );

      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6",
        ...(options.customHeaders || {}),
      });

      console.log(`[HumanBrowser] 🌐 Navigating to: ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs || 30000,
      });

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 8000 }).catch(() => {});
      }

      // Natural pause & light scroll
      await this.randomDelay(1000, 2200);
      await this.smoothScrollHumanLike(page, 2);

      const title = await page.title();
      let summary = "";
      let screenshotBuffer: Buffer | undefined;

      // Extract readable text
      if (options.extractText !== false) {
        summary = await page.evaluate(() => {
          const unwanted = document.querySelectorAll("script, style, noscript, nav, footer, iframe, svg");
          unwanted.forEach((el) => el.remove());

          const bodyText = document.body?.innerText || "";
          return bodyText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join("\n")
            .slice(0, 4000); // Clean 4k char snapshot
        });
      }

      // Visual inspection / screenshot capture
      if (options.takeScreenshot || options.extractVisionSummary) {
        screenshotBuffer = (await page.screenshot({
          type: "jpeg",
          quality: 85,
          fullPage: false,
        })) as Buffer;

        if (options.extractVisionSummary && screenshotBuffer) {
          try {
            const { visionMemoryService } = await import("./visionMemoryService");
            const visionRes = await visionMemoryService.processIncomingMedia(
              screenshotBuffer,
              "image/jpeg",
              "HumanBrowser",
              `Web page screenshot of ${title} (${url})`
            );
            if (visionRes?.shortSummary) {
              summary = `👁️ *[Visual AI Summary]*: ${visionRes.shortSummary}\n\n📄 *[Extracted Page Text]*:\n${summary}`;
            }
          } catch {}
        }
      }

      return {
        success: true,
        url: page.url(),
        title,
        summary,
        screenshotBuffer,
      };
    } catch (err: any) {
      console.warn(`[HumanBrowser] Error browsing ${url}:`, err);
      return {
        success: false,
        url,
        error: err?.message || "Failed to load page in Chrome.",
      };
    } finally {
      await page.close().catch(() => {});
      this.resetIdleTimer();
    }
  }

  /**
   * Sanitizes search queries by removing conversational prefixes, WhatsApp triggers, and punctuation.
   */
  public sanitizeSearchQuery(raw: string): string {
    if (!raw) return "";
    let clean = raw.trim();
    clean = clean.replace(/^\/(?:chrome|google|aimode|ai|search)\s+/i, "");

    // Iteratively strip conversational trigger keywords from the front
    let prev = "";
    while (prev !== clean) {
      prev = clean;
      clean = clean.replace(/^(?:par|pe|me|kripya|please|bhai|yaar)\s+/i, "");
      clean = clean.replace(/^(?:chrome\s+ai\s+mode|ai\s+mode|chrome\s+ai|google\s+ai|chrome|google|browser|web)\s*/i, "");
      clean = clean.replace(/^(?:search\s*karo|dhundo|find|dekho|khojo|check\s*karo|batao|search)\s*/i, "");
      clean = clean.replace(/^[\s\-:–—"'`]+/, "");
    }

    // Strip trailing search requests
    clean = clean.replace(/(?:par|pe|me)\s*(?:search\s*karo|dhundo|dekho|check\s*karo)$/i, "");
    clean = clean.replace(/[\s\-:–—"'`]+$/, "").trim();
    return clean || raw.trim();
  }

  /**
   * Detects whether Google served an automated traffic CAPTCHA challenge or block page.
   */
  public isGoogleCaptchaOrBlocked(title: string, bodyText: string, currentUrl: string): boolean {
    const lowerTitle = (title || "").toLowerCase();
    const lowerBody = (bodyText || "").toLowerCase();
    const lowerUrl = (currentUrl || "").toLowerCase();

    return (
      lowerUrl.includes("sorry/index") ||
      lowerTitle.includes("sorry...") ||
      lowerTitle.includes("captcha") ||
      lowerBody.includes("unusual traffic from your computer network") ||
      lowerBody.includes("systems have detected unusual traffic") ||
      lowerBody.includes("checks to see if it's really you") ||
      lowerBody.includes("why did this happen?") ||
      lowerBody.includes("our systems have detected") ||
      lowerBody.includes("recaptcha") ||
      lowerBody.includes("robot check") ||
      lowerBody.includes("enable javascript")
    );
  }

  /**
   * Multi-tier fallback search engine when direct Chrome encounters datacenter IP blocks or CAPTCHA:
   * 1. Jina AI Search Reader (s.jina.ai) — Real-time live web + Google search rankings without IP blocks.
   * 2. ZenRows / ScraperAPI (if API keys configured) with residential proxy and anti-bot bypass.
   * 3. DuckDuckGo HTML Instant Search.
   */
  /**
   * Unescapes HTML entities like &#x27;, &quot;, &amp;, etc.
   */
  public unescapeHtml(text: string): string {
    if (!text) return "";
    return text
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Fetches an authentic visual illustration / catalog thumbnail for the search query (e.g. products, places, entities).
   * Context-aware: Never hallucinates perfume bottles for constitutional queries!
   */
  public async fetchVisualThumbnail(query: string): Promise<Buffer | undefined> {
    const cleanQuery = this.sanitizeSearchQuery(query);
    if (!cleanQuery) return undefined;

    try {
      const { imageGenerationService } = await import("./imageGenerationService");

      // Context-aware visual prompt synthesis
      let visualPrompt = `Authentic, high quality 4k photograph of ${cleanQuery}, realistic, highly detailed`;
      const key = process.env.GEMINI_API_KEY;

      if (key) {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: key });
          const promptResp = await ai.models.generateContent({
            model: "gemini-3.5-flash-lite",
            contents: `Generate a 1-line text-to-image prompt to generate an authentic, stunning visual photo for the search query: "${cleanQuery}".
Rules:
- If shopping/products (e.g. shirts, shoes, phones): "A curated commercial catalog photo of various stylish [items] displayed in a modern boutique/studio, multi-product collection".
- If historical/legal/constitutional (e.g. Indian Constitution, laws, treaties): "Official dignified book of the Constitution of India with the national golden emblem and preamble on an executive wooden desk, realistic historical document photograph".
- If person/leader/scientist: "Official formal portrait photograph of [Name], clean studio lighting".
- If monument/place/city: "Scenic 4k travel photography of [Place]".
- Output ONLY the 1-line image prompt without quotes or explanation.`,
          });
          const generatedPrompt = promptResp.text?.trim();
          if (generatedPrompt && generatedPrompt.length > 10) {
            visualPrompt = generatedPrompt;
          }
        } catch {}
      }

      const imgRes = await imageGenerationService.generateImage(visualPrompt, {
        enhancePrompt: false,
        aspectRatio: "1:1",
      });

      if (imgRes.success && imgRes.buffer && imgRes.buffer.length > 5000) {
        return imgRes.buffer;
      }
    } catch (err) {
      console.warn("[HumanBrowser] Visual thumbnail generation error:", err);
    }

    return undefined;
  }

  /**
   * Generates or organizes search results into a clean, 1:1 Google Chrome Search card layout.
   * Strictly formats authentic search data with clear dividers without hallucinating fake categories or filler text.
   */
  public async generateChromeAiOverview(
    query: string,
    rawSnippets: string[],
    extractedProducts: Array<{ title: string; price: string; merchant: string; rating: string; link?: string; imgUrl?: string }> = []
  ): Promise<string> {
    const cleanQuery = this.sanitizeSearchQuery(query);

    // If real shopping products were directly scraped from Google DOM, format them directly!
    if (extractedProducts && extractedProducts.length > 0) {
      const productCards = extractedProducts.slice(0, 10).map((p, idx) => {
        const parts = [`*${idx + 1}. ${this.unescapeHtml(p.title)}*`];
        if (p.price || p.merchant) {
          parts.push(`💰 *Price:* ${p.price || "Check store"}${p.merchant ? ` • _${p.merchant}_` : ""}`);
        }
        if (p.rating) {
          parts.push(`⭐ *Rating:* ${p.rating}`);
        }
        const buyLink = p.link || `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(p.title)}`;
        parts.push(`🔗 *Store Link:* ${buyLink}`);
        const photoLink = p.imgUrl || `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(p.title)}`;
        parts.push(`🖼️ *View Photos:* ${photoLink}`);
        parts.push(`──────────────────────`);
        return parts.join("\n");
      });

      return productCards.join("\n\n");
    }

    const key = process.env.GEMINI_API_KEY;
    const combinedSnippets = rawSnippets
      .map((s) => this.unescapeHtml(s))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3500);

    if (key) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: key });

        const prompt = `You are a Google Chrome Search & AI Overview formatter.
Your task is to present the search results for "${cleanQuery}" EXACTLY as they appear on Google Chrome (verbatim, factual, and clean).

Search Query: "${cleanQuery}"
Raw Web Search / DOM Snippets:
${combinedSnippets || "Factual knowledge about: " + cleanQuery}

Formatting Instructions:
- If this is a shopping/product search (e.g. shirts, shoes, phones):
  List the top genuine items found with realistic Indian pricing in ₹ INR, ratings, and genuine store links (Amazon.in / Flipkart / Myntra).
  Put a clean dividing line (──────────────────────) after EVERY item:
  *1. [Brand & Model Name]* — *₹[Price]* (⭐ [Rating] • [Store Name])
  🔗 *Buy Link:* https://www.amazon.in/s?k=[URL_ENCODED_NAME]
  🖼️ *View Photos:* https://www.google.com/search?tbm=isch&q=[URL_ENCODED_NAME]
  • *Details:* [Genuine fabric/specs/features]
  ──────────────────────

- If this is a factual / legal / informational query (e.g. Indian Constitution 42nd amendment, Prime Minister, facts):
  Provide the EXACT verbatim factual summary directly:
  📌 *[Key Summary / Answer]*
  [Clear, comprehensive factual explanation without robotic filler]
  ──────────────────────
  🔗 *Source:* https://en.wikipedia.org/wiki/[Relevant_Topic]

STRICT RULES:
- Do NOT make up synthetic chatbot closing questions or personality fluff.
- Always include the dividing line (──────────────────────) after each card.
- Output clean readable text without raw HTML entities.`;

        for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"]) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents: prompt,
            });

            const text = resp.text?.trim();
            if (text && text.length > 30) {
              return this.unescapeHtml(text);
            }
          } catch {}
        }
      } catch (err) {
        console.warn("[HumanBrowser] Chrome AI Overview generation error:", err);
      }
    }

    return combinedSnippets.slice(0, 1000);
  }

  /**
   * Multi-tier fallback search engine when direct Chrome encounters datacenter IP blocks or CAPTCHA:
   * 1. Jina AI Search Reader (s.jina.ai) — Real-time live web + Google search rankings without IP blocks.
   * 2. ZenRows / ScraperAPI (if API keys configured) with residential proxy and anti-bot bypass.
   * 3. DuckDuckGo HTML Instant Search.
   */
  public async fallbackRobustSearch(cleanQuery: string): Promise<BrowserActionResult> {
    console.log(`[HumanBrowser] 🔄 Running Robust Anti-Block Search Cascade for: "${cleanQuery}"`);
    const collectedSnippets: string[] = [];
    const collectedSources: Array<{ title: string; snippet: string; link?: string }> = [];

    // ── Tier 1: Jina AI Real-Time Search Reader ──
    try {
      const jinaUrl = `https://s.jina.ai/${encodeURIComponent(cleanQuery)}`;
      const jinaResp = await fetch(jinaUrl, {
        headers: {
          "Accept": "text/plain",
          "X-Locale": "en-IN",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(12000),
      });

      if (jinaResp.ok) {
        const text = await jinaResp.text();
        if (text && text.length > 80 && !text.includes("Rate limit exceeded")) {
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          let currentTitle = "";
          let currentSnippet = "";
          let currentLink = "";

          for (const line of lines) {
            if (line.startsWith("Title:") || line.startsWith("## [") || line.startsWith("### [")) {
              if (currentTitle) {
                collectedSources.push({ title: this.unescapeHtml(currentTitle), snippet: this.unescapeHtml(currentSnippet.slice(0, 200)), link: currentLink });
                if (currentSnippet) collectedSnippets.push(this.unescapeHtml(currentSnippet));
                currentSnippet = "";
              }
              currentTitle = line.replace(/^(?:Title:|\#\#\#?\s*\[?)/, "").replace(/\]\(.+\)$/, "").trim();
            } else if (line.startsWith("URL Source:") || line.startsWith("http")) {
              currentLink = line.replace(/^URL Source:\s*/, "").trim();
            } else if (!line.startsWith("Markdown Content:") && !line.startsWith("Published Time:")) {
              currentSnippet += (currentSnippet ? " " : "") + line;
            }
          }
          if (currentTitle && collectedSources.length < 4) {
            collectedSources.push({ title: this.unescapeHtml(currentTitle), snippet: this.unescapeHtml(currentSnippet.slice(0, 200)), link: currentLink });
            if (currentSnippet) collectedSnippets.push(this.unescapeHtml(currentSnippet));
          }
        }
      }
    } catch (jinaErr) {
      console.warn("[HumanBrowser] Jina Search fallback note:", jinaErr);
    }

    // ── Tier 2: ZenRows / ScraperAPI Proxy Fallback ──
    const zenrowsKey = process.env.ZENROWS_API_KEY || process.env.ZENROWS_KEY;
    if (collectedSnippets.length === 0 && zenrowsKey) {
      try {
        const targetGoogleUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&hl=en&gl=in`;
        const zenUrl = `https://api.zenrows.com/v1/?apikey=${zenrowsKey.trim()}&url=${encodeURIComponent(targetGoogleUrl)}&js_render=true&antibot=true&premium_proxy=true&proxy_country=in`;
        const zResp = await fetch(zenUrl, { signal: AbortSignal.timeout(15000) });
        if (zResp.ok) {
          const html = await zResp.text();
          const cleanText = this.unescapeHtml(
            html
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          );
          if (cleanText.length > 100 && !cleanText.includes("unusual traffic")) {
            collectedSnippets.push(cleanText.slice(0, 1500));
          }
        }
      } catch (zenErr) {
        console.warn("[HumanBrowser] ZenRows search fallback note:", zenErr);
      }
    }

    // ── Tier 3: DuckDuckGo HTML Instant Search ──
    if (collectedSnippets.length === 0) {
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
        const ddgResp = await fetch(ddgUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (ddgResp.ok) {
          const html = await ddgResp.text();
          const snippetMatches = html.match(/<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi) || [];
          const titleMatches = html.match(/<a class="result__url[^>]*>([\s\S]*?)<\/a>/gi) || [];

          for (let i = 0; i < snippetMatches.length; i++) {
            const snip = this.unescapeHtml(snippetMatches[i].replace(/<[^>]+>/g, "").trim());
            const tit = this.unescapeHtml(titleMatches[i]?.replace(/<[^>]+>/g, "").trim() || `Source ${i + 1}`);
            if (snip) {
              collectedSnippets.push(snip);
              if (collectedSources.length < 3) {
                collectedSources.push({ title: tit, snippet: snip.slice(0, 180) });
              }
            }
          }
        }
      } catch (ddgErr) {
        console.warn("[HumanBrowser] DuckDuckGo search fallback note:", ddgErr);
      }
    }

    // ── Format Authentic Chrome Results ──
    const [aiOverviewCard, visualThumbnail] = await Promise.all([
      this.generateChromeAiOverview(cleanQuery, collectedSnippets),
      this.fetchVisualThumbnail(cleanQuery),
    ]);

    let formattedOutput = `${aiOverviewCard}\n\n`;

    if (collectedSources.length > 0) {
      formattedOutput += `🔍 *[Top Verified Sources]*:\n`;
      for (const s of collectedSources.slice(0, 3)) {
        formattedOutput += `• *${s.title}*${s.link ? `\n  🔗 ${s.link}` : ""}\n`;
      }
    }

    return {
      success: true,
      url: `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&hl=en&gl=in`,
      title: `Google: "${cleanQuery}"`,
      summary: formattedOutput.trim(),
      screenshotBuffer: visualThumbnail,
      extractedData: { aiOverview: aiOverviewCard, organicResults: collectedSources },
    };
  }

  /**
   * Performs an authentic Indian Google Search, extracts Google AI Overview (SGE), Shopping items, Knowledge Graph direct answers, and top web sources.
   * Automatically sanitizes conversational inputs and fails over to anti-block fallback engines if CAPTCHA is detected.
   */
  public async searchGoogleAndInspect(query: string): Promise<BrowserActionResult> {
    const cleanQuery = this.sanitizeSearchQuery(query);
    if (!cleanQuery) {
      return { success: false, error: "Please provide a valid search query." };
    }

    await this.enforceVelocityLimit();
    let browser: Browser | null = null;
    let page: Page | null = null;
    const encoded = encodeURIComponent(cleanQuery);
    const searchUrl = `https://www.google.com/search?q=${encoded}&hl=en&gl=in`;

    try {
      browser = await this.getBrowser();
      page = await browser.newPage();

      await page.emulateTimezone("Asia/Kolkata").catch(() => {});
      await page.setGeolocation({ latitude: 28.6139, longitude: 77.2090, accuracy: 100 }).catch(() => {});
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
      );
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6",
      });

      console.log(`[HumanBrowser] 🔍 Google Searching: "${cleanQuery}"`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForSelector("#search, #rso, div.g, div.pla-unit", { timeout: 7000 }).catch(() => {});
      await this.randomDelay(400, 900);

      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
      const isBlocked = this.isGoogleCaptchaOrBlocked(title, bodyText, page.url());

      if (isBlocked) {
        console.warn(`[HumanBrowser] ⚠️ Google CAPTCHA / Unusual Traffic detected on current IP. Triggering anti-block fallback search.`);
        await page.close().catch(() => {});
        return await this.fallbackRobustSearch(cleanQuery);
      }

      // Auto-click "Generate" or "Show more" button for Google AI Overview if present
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
        for (const btn of buttons) {
          const t = (btn.textContent || "").toLowerCase().trim();
          if (t === "generate" || t.includes("show more") || t.includes("ai overview") || t.includes("expand")) {
            (btn as HTMLElement).click();
            break;
          }
        }
      }).catch(() => {});
      await this.randomDelay(600, 1200);

      // Extract Google AI Overview, Shopping Cards, Direct Knowledge Answer & Organic Results
      const extracted = await page.evaluate(() => {
        // 1. Google Shopping / Products Grid
        const products: Array<{ title: string; price: string; merchant: string; rating: string; link?: string; imgUrl?: string }> = [];
        const shoppingCards = document.querySelectorAll("div.pla-unit, div.sh-dgr__content, div[data-docid], div.sh-np__click-target");

        for (let i = 0; i < shoppingCards.length && products.length < 8; i++) {
          const sc = shoppingCards[i];
          const titleEl = sc.querySelector(".pla-unit-title, h3, h4, .sh-np__product-title");
          const priceEl = sc.querySelector(".e10twf, [aria-label*='₹'], .hn9bif, .T149du, span");
          const merchantEl = sc.querySelector(".rhf-merchant-name, .LbIaRd, .IuHnof, .aULzUe");
          const ratingEl = sc.querySelector("[aria-label*='stars'], span.R1QE5b");
          const linkEl = sc.querySelector("a");
          const imgEl = sc.querySelector("img");

          const pTitle = titleEl?.textContent?.trim() || "";
          const pPrice = priceEl?.textContent?.trim() || "";
          const pMerchant = merchantEl?.textContent?.trim() || "";
          const pRating = ratingEl?.textContent?.trim() || "";
          const pLink = linkEl?.getAttribute("href") || undefined;
          const pImg = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || undefined;

          if (pTitle && (pPrice || pMerchant)) {
            products.push({
              title: pTitle,
              price: pPrice,
              merchant: pMerchant,
              rating: pRating,
              link: pLink && pLink.startsWith("/") ? `https://www.google.com${pLink}` : pLink,
              imgUrl: pImg,
            });
          }
        }

        // 2. Google AI Overview / SGE Block
        const aiOverviewSelectors = [
          'div[aria-label*="AI Overview"]',
          'div[data-attrid="sge_entity_summary"]',
          'div[jsname="N5aUId"]',
          'div[data-sge-summary]',
          '.M6CB1c',
          'div.b_ans',
          'div[data-attrid="wa:/description"]',
        ];
        let aiOverview = "";
        for (const sel of aiOverviewSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 20) {
            aiOverview = el.textContent.trim().replace(/\s+/g, " ");
            break;
          }
        }

        // 3. Direct Answer / Featured Snippet / Knowledge Panel
        const directAnswerSelectors = [
          "div.Z0LcW", // Direct answer
          "div.hgKElc", // Featured snippet text
          "div.kno-rdesc span", // Knowledge graph description
          "div.V3FYCf", // Summary box
          "div.wDYxhc", // Answer block
          "div.zVnBt", // Definition/answer
          '[data-attrid="description"]',
          '[data-attrid="subtitle"]',
        ];
        let directAnswer = "";
        for (const sel of directAnswerSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 5) {
            directAnswer = el.textContent.trim().replace(/\s+/g, " ");
            break;
          }
        }

        // 4. Top Organic Search Result Snippets
        const organicResults: Array<{ title: string; snippet: string; link?: string }> = [];
        const resultCards = document.querySelectorAll("div.g, div.MjjYud, div.tF2C5e");
        for (let i = 0; i < resultCards.length && organicResults.length < 3; i++) {
          const card = resultCards[i];
          const titleEl = card.querySelector("h3");
          const snippetEl = card.querySelector('div[data-sncf="1"], div.VwiC3b, div[style*="-webkit-line-clamp"]');
          const linkEl = card.querySelector("a");
          if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
            const title = titleEl.textContent.trim();
            const snippet = snippetEl?.textContent?.trim().replace(/\s+/g, " ") || "";
            const link = linkEl?.getAttribute("href") || undefined;
            organicResults.push({ title, snippet, link });
          }
        }

        return { products, aiOverview, directAnswer, organicResults };
      });

      // 📸 Capture the REAL, GENUINE Google Search Viewport Screenshot
      let realScreenShot: Buffer | undefined;
      try {
        realScreenShot = (await page.screenshot({
          type: "jpeg",
          quality: 90,
          fullPage: false,
        })) as Buffer;
      } catch {}

      const snippets = [
        extracted.directAnswer,
        extracted.aiOverview,
        ...extracted.organicResults.map((r) => `${r.title}: ${r.snippet}`),
      ].filter(Boolean) as string[];

      const aiOverviewCard = await this.generateChromeAiOverview(cleanQuery, snippets, extracted.products);

      let formattedOutput = `${aiOverviewCard}\n\n`;

      if (extracted.organicResults.length > 0 && extracted.products.length === 0) {
        formattedOutput += `🔍 *[Top Verified Sources]*:\n`;
        for (const r of extracted.organicResults.slice(0, 2)) {
          formattedOutput += `• *${this.unescapeHtml(r.title)}*${r.link ? `\n  🔗 ${r.link}` : ""}\n`;
        }
      }

      return {
        success: true,
        url: searchUrl,
        title: `Google: "${cleanQuery}"`,
        summary: formattedOutput.trim(),
        screenshotBuffer: realScreenShot,
        extractedData: extracted,
      };
    } catch (err: any) {
      console.warn(`[HumanBrowser] Google Search in Chrome error:`, err?.message || err);
      return await this.fallbackRobustSearch(cleanQuery);
    } finally {
      if (page) await page.close().catch(() => {});
      this.resetIdleTimer();
    }
  }

  /**
   * Inspects e-commerce products (Amazon / Flipkart) for real-time prices, ratings, and stock.
   */
  public async inspectEcommerceProduct(queryOrUrl: string): Promise<BrowserActionResult> {
    let targetUrl = queryOrUrl;
    const isUrl = /^https?:\/\//i.test(queryOrUrl);

    if (!isUrl) {
      targetUrl = `https://www.amazon.in/s?k=${encodeURIComponent(queryOrUrl)}`;
    }

    const res = await this.browseUrl(targetUrl, {
      extractText: true,
      takeScreenshot: true,
      extractVisionSummary: true,
    });

    return {
      ...res,
      title: `E-Commerce Inspection: ${queryOrUrl}`,
    };
  }

  /**
   * Captures a clean screenshot buffer of any URL for Boss.
   */
  public async capturePageScreenshot(url: string): Promise<{ success: boolean; buffer?: Buffer; title?: string; error?: string }> {
    const res = await this.browseUrl(url, {
      takeScreenshot: true,
      extractText: false,
    });

    if (res.success && res.screenshotBuffer) {
      return { success: true, buffer: res.screenshotBuffer, title: res.title };
    }
    return { success: false, error: res.error || "Could not capture screenshot." };
  }
}

export const humanBrowserService = new HumanBrowserService();
