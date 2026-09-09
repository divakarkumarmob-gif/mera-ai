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
      '--no-first-run',
      '--no-zygote',
      '--window-size=1280,900'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    let finalBuffer = null;
    let resolvePromise = null;
    const completionPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    page.on('response', async (res) => {
      const url = res.url();
      const contentType = res.headers()['content-type'] || '';
      
      if (
        url.includes('downloadTemporaryImage') ||
        url.includes('user-generated-asset.perchance.org') ||
        (contentType.startsWith('image/') && url.includes('image-generation.perchance.org'))
      ) {
        try {
          const buf = await res.buffer();
          if (buf && buf.length > 5000) {
            console.log(`[Perchance] ⚡ Intercepted image (${buf.length} bytes) from URL: ${url.substring(0, 80)}`);
            finalBuffer = buf;
            if (resolvePromise) resolvePromise(buf);
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

    await frame.waitForSelector('textarea', { timeout: 15000 });
    const textareas = await frame.$$('textarea');
    const promptInput = textareas.length > 1 ? textareas[1] : textareas[0];

    await promptInput.click();
    await frame.evaluate(el => el.value = '', promptInput);
    await promptInput.type(promptText, { delay: 10 });

    const genBtn = await frame.waitForSelector('#generateButtonEl', { timeout: 10000 });
    if (!genBtn) throw new Error("Generate button not found");
    await genBtn.click();
    console.log("[Perchance] Clicked generate button. Waiting for image stream...");

    // Race timeout with completionPromise
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Perchance generation timed out (45s)")), 45000));
    const result = await Promise.race([completionPromise, timeout]);

    return result;
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    const t0 = Date.now();
    const buf = await generatePerchanceImage("a hot cute stylish girl in neon cyber city, 8k ultra realistic");
    fs.writeFileSync('scratch/perchance_cyber_girl.jpg', buf);
    console.log(`SUCCESS! Saved image in ${((Date.now() - t0)/1000).toFixed(1)}s (Size: ${buf.length} bytes)`);
  } catch (e) {
    console.error("Failed:", e);
  }
})();
