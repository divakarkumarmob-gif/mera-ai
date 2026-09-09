import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";

puppeteerExtra.use(StealthPlugin());

export interface PerchanceStepLog {
  level: "info" | "warn" | "error" | "success";
  step: string;
  message: string;
  timestamp: string;
}

export interface PerchanceImageResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  prompt: string;
  error?: string;
  durationMs?: number;
  logs?: PerchanceStepLog[];
}

export class PerchanceService {
  private static instance: PerchanceService;

  public static getInstance(): PerchanceService {
    if (!PerchanceService.instance) {
      PerchanceService.instance = new PerchanceService();
    }
    return PerchanceService.instance;
  }

  private findBinaryInDir(dir: string): string | null {
    try {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const res = this.findBinaryInDir(full);
          if (res) return res;
        } else if (e.isFile()) {
          const lower = e.name.toLowerCase();
          if (lower === "chrome.exe" || lower === "msedge.exe" || lower === "chrome" || lower === "chromium") {
            return full;
          }
        }
      }
    } catch {}
    return null;
  }

  /**
   * Finds the Chrome / Chromium / Edge executable path across OS environments (Windows, Linux, Docker, Render, macOS).
   */
  public getExecutablePath(): string | null {
    // 0. Project Local Cache Directory (Render persistent workspace)
    const projectCacheDirs = [
      path.join(process.cwd(), ".cache", "puppeteer"),
      path.join(process.cwd(), ".cache"),
      path.join(process.cwd(), "chrome"),
      path.join(process.cwd(), ".chrome"),
      path.join(process.cwd(), "dist", ".cache", "puppeteer"),
      path.join(process.cwd(), "dist", "chrome"),
      "/opt/render/project/src/.cache/puppeteer",
      "/opt/render/project/src/chrome",
    ];

    for (const d of projectCacheDirs) {
      if (fs.existsSync(d)) {
        const found = this.findBinaryInDir(d);
        if (found) return found;
      }
    }

    // 1. Puppeteer Bundled Chrome
    try {
      const puppeteerPkg = require("puppeteer");
      if (puppeteerPkg && typeof puppeteerPkg.executablePath === "function") {
        const pPath = puppeteerPkg.executablePath();
        if (pPath && typeof pPath === "string" && fs.existsSync(pPath)) {
          return pPath;
        }
      }
    } catch {}

    // 2. Environment variables
    const envVars = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_PATH,
      process.env.CHROMIUM_PATH,
      process.env.CHROME_BIN,
    ];
    for (const v of envVars) {
      if (v && fs.existsSync(v)) return v;
    }

    // 3. Dynamic 'which' or 'where' resolution
    try {
      const isWin = process.platform === "win32";
      const cmd = isWin ? "where" : "which";
      const bins = isWin
        ? ["chrome", "msedge", "brave"]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

      const { execSync } = require("child_process");
      for (const b of bins) {
        try {
          const out = execSync(`${cmd} ${b}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
          const first = out.split("\n")[0]?.trim();
          if (first && fs.existsSync(first)) return first;
        } catch {}
      }
    } catch {}

    // 4. Multi-OS Candidate paths
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      // Windows
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      homeDir ? path.join(homeDir, "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe") : "",
      // Linux / Render / Docker / Ubuntu / Debian
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/lib/chromium/chromium",
      "/usr/lib/chromium-browser/chromium-browser",
      "/usr/bin/chrome",
      "/opt/google/chrome/chrome",
      "/opt/google/chrome/google-chrome",
      // Puppeteer cache directories (.cache/puppeteer)
      homeDir ? path.join(homeDir, ".cache", "puppeteer") : "",
      "/root/.cache/puppeteer",
      // macOS
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.isDirectory()) {
            const found = this.findBinaryInDir(p);
            if (found) return found;
          } else {
            return p;
          }
        } catch {}
      }
    }

    // 5. Last-mile Auto-Installer at Runtime
    try {
      console.log("[PerchanceService] ⏳ No browser found. Running on-the-fly Chrome installer...");
      const { execSync } = require("child_process");
      const targetCache = path.join(process.cwd(), ".cache", "puppeteer");
      execSync(`npx @puppeteer/browsers install chrome@stable --path "${targetCache}"`, {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 90000,
      });
      const downloaded = this.findBinaryInDir(targetCache);
      if (downloaded) {
        console.log(`[PerchanceService] ⚡ Downloaded Chrome successfully to ${downloaded}`);
        return downloaded;
      }
    } catch (instErr) {
      console.warn("[PerchanceService] On-the-fly installer notice:", (instErr as any)?.message || instErr);
    }

    return null;
  }

  private activeLock: Promise<void> = Promise.resolve();

  /**
   * Automates https://perchance.org/ai-photo-generator to create an AI image from a prompt.
   * Sequential lock ensures only 1 Chrome instance runs at a time on low-RAM server.
   */
  public async generateImage(
    promptText: string,
    timeoutMs = 120000,
    onLog?: (log: PerchanceStepLog) => void
  ): Promise<PerchanceImageResult> {
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const currentLock = this.activeLock;
    this.activeLock = nextLock;

    try {
      await currentLock;
      return await this.executeGenerate(promptText, timeoutMs, onLog);
    } finally {
      releaseLock();
    }
  }

  private async executeGenerate(
    promptText: string,
    timeoutMs = 120000,
    onLog?: (log: PerchanceStepLog) => void
  ): Promise<PerchanceImageResult> {
    const cleanPrompt = (promptText || "").trim();
    const logs: PerchanceStepLog[] = [];

    const pushLog = (level: PerchanceStepLog["level"], step: string, message: string) => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      const logItem: PerchanceStepLog = { level, step, message, timestamp: timeStr };
      logs.push(logItem);
      if (level === "error") console.error(`[PerchanceService] [${step}] ❌ ${message}`);
      else if (level === "warn") console.warn(`[PerchanceService] [${step}] ⚠️ ${message}`);
      else console.log(`[PerchanceService] [${step}] ℹ️ ${message}`);

      if (onLog) {
        try {
          onLog(logItem);
        } catch {}
      }
    };

    if (!cleanPrompt) {
      pushLog("error", "Validation", "Prompt cannot be empty");
      return { success: false, prompt: promptText, error: "Prompt cannot be empty", logs };
    }

    pushLog("info", "Browser Initialization", "Scanning OS environment for Chrome / Chromium binary...");
    const execPath = this.getExecutablePath();
    if (!execPath) {
      pushLog("error", "Browser Initialization", "Chrome/Chromium executable not found on server.");
      return {
        success: false,
        prompt: cleanPrompt,
        error: "Chrome/Chromium browser executable not found on server.",
        logs,
      };
    }

    pushLog("info", "Browser Initialization", `Found browser engine: ${execPath}`);
    const startTime = Date.now();
    let browser: any = null;

    try {
      pushLog("info", "Browser Launch", "Launching headless Chrome with stealth & anti-detection flags...");
      browser = await (puppeteerExtra as any).launch({
        executablePath: execPath,
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );

      let imageBuffer: Buffer | null = null;
      let resolveImage: ((buf: Buffer) => void) | null = null;
      const imagePromise = new Promise<Buffer>((resolve) => {
        resolveImage = resolve;
      });

      // Intercept network response for generated image (both proxy and direct endpoints)
      page.on("response", async (res: any) => {
        try {
          const url: string = res.url();
          const contentType: string = res.headers()["content-type"] || "";

          if (
            url.includes("downloadTemporaryImage") ||
            url.includes("downloadTemporaryImageViaProxy") ||
            url.includes("user-generated-asset.perchance.org") ||
            (contentType.startsWith("image/") && (url.includes("perchance") || url.includes("image-generation")))
          ) {
            const buf = await res.buffer();
            if (buf && buf.length > 5000) {
              pushLog("success", "Network Stream", `Intercepted generated image buffer (${buf.length} bytes, ${(buf.length / 1024).toFixed(1)} KB)`);
              imageBuffer = buf;
              if (resolveImage) resolveImage(buf);
            }
          }
        } catch {}
      });

      pushLog("info", "Navigation", "Navigating to https://perchance.org/ai-photo-generator...");
      const navT0 = Date.now();
      await page.goto("https://perchance.org/ai-photo-generator", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const domTime = Date.now() - navT0;
      pushLog("info", "DOM Ready", `Page DOM loaded successfully in ${domTime}ms! Accessing generator iframe...`);

      // Wait for output generator iframe and its content
      const iframeHandle = await page.waitForSelector("iframe#outputIframeEl", { timeout: 45000 });
      if (!iframeHandle) throw new Error("Could not find generator iframe on Perchance page");
      const frame = await iframeHandle.contentFrame();
      if (!frame) throw new Error("Could not access generator content frame");

      pushLog("info", "Iframe Inspection", "Found #outputIframeEl frame. Locating prompt textarea...");

      // Wait for prompt textarea
      await frame.waitForSelector("textarea", { timeout: 30000 });
      const textareas = await frame.$$("textarea");
      const promptInput = textareas.length > 1 ? textareas[1] : textareas[0];

      pushLog("info", "Prompt Entry", `Typing prompt: "${cleanPrompt}" with virtual keyboard emulation...`);

      // Focus, clear, and type prompt with keyboard events for 100% reactivity
      await promptInput.click({ clickCount: 3 });
      await promptInput.press("Backspace");
      await promptInput.type(cleanPrompt, { delay: 10 });

      pushLog("info", "Action Trigger", "Prompt filled into generator. Clicking ✨ generate button...");
      const genBtn = await frame.waitForSelector("#generateButtonEl", { timeout: 20000 });
      if (!genBtn) throw new Error("Could not find #generateButtonEl on Perchance");
      await genBtn.click();
      pushLog("info", "AI Generation", "Generate button triggered! Listening on network streams and polling frame canvas...");

      // Poll frames in parallel with network interception
      const pollingPromise = (async () => {
        const pollStart = Date.now();
        while (Date.now() - pollStart < timeoutMs - 5000) {
          if (imageBuffer && imageBuffer.length > 5000) return imageBuffer;

          for (const f of page.frames()) {
            try {
              const frameImg = await f.evaluate(() => {
                const imgs = Array.from(document.querySelectorAll("img"));
                for (const img of imgs) {
                  if (img.src && img.src.startsWith("data:image/jpeg") && img.src.length > 5000) {
                    return { type: "data", src: img.src };
                  }
                  if (
                    img.src &&
                    (img.src.includes("downloadTemporaryImage") || img.src.includes("perchance")) &&
                    (img.naturalWidth > 150 || img.width > 150)
                  ) {
                    return { type: "url", src: img.src };
                  }
                }
                return null;
              });

              if (frameImg) {
                if (frameImg.type === "data") {
                  pushLog("success", "DOM Frame", "Extracted data:image/jpeg from child frame element");
                  const buf = Buffer.from(frameImg.src.split(",")[1], "base64");
                  if (buf.length > 5000) {
                    imageBuffer = buf;
                    return buf;
                  }
                } else if (frameImg.type === "url") {
                  const base64 = await f.evaluate(async (src: string) => {
                    const r = await fetch(src);
                    const b = await r.blob();
                    return new Promise((res) => {
                      const fr = new FileReader();
                      fr.onloadend = () => res(fr.result);
                      fr.readAsDataURL(b);
                    });
                  }, frameImg.src);

                  if (base64 && typeof base64 === "string" && base64.includes(",")) {
                    const buf = Buffer.from(base64.split(",")[1], "base64");
                    if (buf.length > 5000) {
                      pushLog("success", "DOM Fetch", `Extracted image blob from URL: ${frameImg.src.substring(0, 60)}...`);
                      imageBuffer = buf;
                      return buf;
                    }
                  }
                }
              }
            } catch {}
          }

          await new Promise((r) => setTimeout(r, 1200));
        }
        return null;
      })();

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`Perchance generation timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
      );

      const finalBuf = await Promise.race([imagePromise, pollingPromise, timeoutPromise]);

      if (!finalBuf || finalBuf.length < 2000) {
        throw new Error("No valid image buffer received from Perchance generator");
      }

      const durationMs = Date.now() - startTime;
      pushLog("success", "Complete", `Image generation completed in ${(durationMs / 1000).toFixed(1)}s (${(finalBuf.length / 1024).toFixed(1)} KB)!`);

      return {
        success: true,
        buffer: finalBuf,
        mimeType: "image/jpeg",
        prompt: cleanPrompt,
        durationMs,
        logs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      pushLog("error", "Execution Failure", err?.message || "Unknown error occurred during generation");
      return {
        success: false,
        prompt: cleanPrompt,
        error: err?.message || "Unknown error generating image on Perchance",
        durationMs,
        logs,
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
          pushLog("info", "Cleanup", "Headless browser session closed cleanly.");
        } catch {}
      }
    }
  }
}

export const perchanceService = PerchanceService.getInstance();

