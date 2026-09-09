const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function generatePerchanceImage(promptText) {
  console.log(`[Perchance] Starting generation for prompt: "${promptText}"`);
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--window-size=1280,900'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    let imageBuffer = null;

    // Listen to network responses for the generated image
    page.on('response', async (res) => {
      const url = res.url();
      const contentType = res.headers()['content-type'] || '';
      
      if (
        url.includes('downloadTemporaryImage') ||
        url.includes('user-generated-asset.perchance.org') ||
        (contentType.startsWith('image/') && (url.includes('perchance') || url.includes('image-generation')))
      ) {
        try {
          const buf = await res.buffer();
          if (buf && buf.length > 5000) {
            console.log(`[Perchance] Intercepted image (${buf.length} bytes) from URL: ${url.substring(0, 80)}`);
            imageBuffer = buf;
          }
        } catch (e) {}
      }
    });

    console.log("[Perchance] Navigating to generator page...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 35000 });

    const iframeHandle = await page.waitForSelector('iframe#outputIframeEl', { timeout: 15000 });
    if (!iframeHandle) throw new Error("Could not find generator iframe");
    const frame = await iframeHandle.contentFrame();
    if (!frame) throw new Error("Could not access generator content frame");

    console.log("[Perchance] Waiting for prompt input inside generator...");
    await frame.waitForSelector('textarea', { timeout: 15000 });

    const textareas = await frame.$$('textarea');
    const promptInput = textareas.length > 1 ? textareas[1] : textareas[0];

    // Focus & type prompt
    await promptInput.click();
    await frame.evaluate(el => el.value = '', promptInput);
    await promptInput.type(promptText, { delay: 15 });

    console.log("[Perchance] Clicking ✨ generate button...");
    const genBtn = await frame.waitForSelector('#generateButtonEl', { timeout: 10000 });
    if (!genBtn) throw new Error("Generate button not found");
    await genBtn.click();

    console.log("[Perchance] Waiting for image generation to complete...");
    const startTime = Date.now();
    const timeoutMs = 45000;

    while (Date.now() - startTime < timeoutMs) {
      if (imageBuffer && imageBuffer.length > 5000) {
        break;
      }

      // Check all frames for data:image/jpeg or img tags
      for (const f of page.frames()) {
        try {
          const frameImg = await f.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            for (const img of imgs) {
              if (img.src && img.src.startsWith('data:image/jpeg') && img.src.length > 5000) {
                return { type: 'data', src: img.src };
              }
              if (img.src && (img.src.includes('downloadTemporaryImage') || img.src.includes('perchance')) && (img.naturalWidth > 150 || img.width > 150)) {
                return { type: 'url', src: img.src };
              }
            }
            return null;
          });

          if (frameImg) {
            if (frameImg.type === 'data') {
              console.log("[Perchance] Captured base64 data image from frame!");
              imageBuffer = Buffer.from(frameImg.src.split(',')[1], 'base64');
              break;
            } else if (frameImg.type === 'url') {
              console.log("[Perchance] Found image URL in frame, fetching blob...");
              const base64 = await f.evaluate(async (src) => {
                const r = await fetch(src);
                const b = await r.blob();
                return new Promise(res => {
                  const fr = new FileReader();
                  fr.onloadend = () => res(fr.result);
                  fr.readAsDataURL(b);
                });
              }, frameImg.src);
              if (base64 && typeof base64 === 'string' && base64.includes(',')) {
                imageBuffer = Buffer.from(base64.split(',')[1], 'base64');
                break;
              }
            }
          }
        } catch (e) {}
      }

      if (imageBuffer && imageBuffer.length > 5000) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!imageBuffer || imageBuffer.length < 1000) {
      throw new Error("Image generation timed out on Perchance");
    }

    console.log(`[Perchance] Successfully generated image (${imageBuffer.length} bytes)!`);
    return imageBuffer;
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    const buf = await generatePerchanceImage("beautiful cinematic portrait of an Indian girl in traditional lehenga with golden jewelry, high realism, 8k");
    fs.writeFileSync('scratch/perchance_girl.jpg', buf);
    console.log("Saved scratch/perchance_girl.jpg successfully!");
  } catch (e) {
    console.error("Test failed:", e);
  }
})();
