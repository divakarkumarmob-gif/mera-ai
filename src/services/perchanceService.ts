import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";

puppeteerExtra.use(StealthPlugin());

export interface PerchanceImageResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  prompt: string;
  error?: string;
  durationMs?: number;
}

export class PerchanceService {
  private static instance: PerchanceService;

  public static getInstance(): PerchanceService {
    if (!PerchanceService.instance) {
      PerchanceService.instance = new PerchanceService();
    }
    return PerchanceService.instance;
  }

  /**
   * Finds the Chrome / Chromium / Edge executable path across OS environments.
   */
  public getExecutablePath(): string | null {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }

    const candidates = [
      // Windows
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      // Linux / Docker / Render
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/lib/chromium/chromium",
      "/usr/bin/chrome",
      // macOS
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Automates https://perchance.org/ai-photo-generator to create an AI image from a prompt.
   * Enters the prompt, clicks generate, captures the generated image buffer, and returns it.
   */
  public async generateImage(promptText: string, timeoutMs = 50000): Promise<PerchanceImageResult> {
    const cleanPrompt = (promptText || "").trim();
    if (!cleanPrompt) {
      return { success: false, prompt: promptText, error: "Prompt cannot be empty" };
    }

    const execPath = this.getExecutablePath();
    if (!execPath) {
      return {
        success: false,
        prompt: cleanPrompt,
        error: "Chrome/Chromium browser executable not found on server.",
      };
    }

    const startTime = Date.now();
    console.log(`[PerchanceService] 🚀 Starting generation for: "${cleanPrompt}" using ${execPath}`);

    let browser: any = null;

    try {
      browser = await (puppeteerExtra as any).launch({
        executablePath: execPath,
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
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

      // Intercept network response for generated image
      page.on("response", async (res: any) => {
        try {
          const url: string = res.url();
          const contentType: string = res.headers()["content-type"] || "";

          if (
            url.includes("downloadTemporaryImage") ||
            url.includes("user-generated-asset.perchance.org") ||
            (contentType.startsWith("image/") && (url.includes("perchance") || url.includes("image-generation")))
          ) {
            const buf = await res.buffer();
            if (buf && buf.length > 5000) {
              console.log(`[PerchanceService] 📸 Intercepted network image buffer (${buf.length} bytes)`);
              imageBuffer = buf;
              if (resolveImage) resolveImage(buf);
            }
          }
        } catch {}
      });

      console.log("[PerchanceService] Navigating to https://perchance.org/ai-photo-generator...");
      await page.goto("https://perchance.org/ai-photo-generator", {
        waitUntil: "networkidle2",
        timeout: 35000,
      });

      // Find generator iframe
      const iframeHandle = await page.waitForSelector("iframe#outputIframeEl", { timeout: 20000 });
      if (!iframeHandle) throw new Error("Could not find generator iframe on Perchance page");
      const frame = await iframeHandle.contentFrame();
      if (!frame) throw new Error("Could not access generator content frame");

      // Wait for prompt textarea
      await frame.waitForSelector("textarea", { timeout: 20000 });
      const textareas = await frame.$$("textarea");
      const promptInput = textareas.length > 1 ? textareas[1] : textareas[0];

      // Set prompt value both through DOM and typing for maximum compatibility
      await promptInput.click();
      await frame.evaluate((el: any, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, promptInput, cleanPrompt);

      // Also type slightly to trigger keyboard handlers
      await promptInput.type(" ", { delay: 10 });

      // Click generate button
      console.log("[PerchanceService] Clicking ✨ generate button...");
      const genBtn = await frame.waitForSelector("#generateButtonEl", { timeout: 15000 });
      if (!genBtn) throw new Error("Could not find #generateButtonEl on Perchance");
      await genBtn.click();

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
                  console.log("[PerchanceService] 🖼️ Found data:image/jpeg in child frame");
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
                      imageBuffer = buf;
                      return buf;
                    }
                  }
                }
              }
            } catch {}
          }

          await new Promise((r) => setTimeout(r, 1500));
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
      console.log(`[PerchanceService] ✅ Image generated successfully in ${(durationMs / 1000).toFixed(1)}s (${finalBuf.length} bytes)`);

      return {
        success: true,
        buffer: finalBuf,
        mimeType: "image/jpeg",
        prompt: cleanPrompt,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error("[PerchanceService] ❌ Image generation error:", err?.message || err);
      return {
        success: false,
        prompt: cleanPrompt,
        error: err?.message || "Unknown error generating image on Perchance",
        durationMs,
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }
}

export const perchanceService = PerchanceService.getInstance();
