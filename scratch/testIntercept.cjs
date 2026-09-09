const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    let generatedImageBuffer = null;

    page.on('response', async (res) => {
      const url = res.url();
      const ct = res.headers()['content-type'] || '';
      if (
        url.includes('downloadTemporaryImage') ||
        url.includes('user-generated-asset') ||
        (ct.startsWith('image/') && (url.includes('perchance') || url.includes('blob')))
      ) {
        try {
          const buf = await res.buffer();
          if (buf && buf.length > 5000) {
            console.log(`[NET INTERCEPT] Got image buffer: ${buf.length} bytes from ${url.substring(0, 80)}`);
            generatedImageBuffer = buf;
          }
        } catch (e) {}
      }
    });

    console.log("Navigating to perchance...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const iframeElement = await page.$('iframe#outputIframeEl');
    const frame = await iframeElement.contentFrame();

    const textareas = await frame.$$('textarea');
    const targetTextarea = textareas[1] || textareas[0];
    await targetTextarea.click();
    await frame.evaluate(el => el.value = '', targetTextarea);
    await targetTextarea.type('a stunning sports car on neon night street, 8k wallpaper', { delay: 10 });

    const genBtn = await frame.$('#generateButtonEl');
    await genBtn.click();
    console.log("Generate clicked! Waiting for image response...");

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (generatedImageBuffer) break;

      // Also check child frames for data:image/jpeg
      for (const f of page.frames()) {
        try {
          const dataUrl = await f.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            for (const img of imgs) {
              if (img.src && img.src.startsWith('data:image/jpeg') && img.src.length > 5000) {
                return img.src;
              }
            }
            return null;
          });
          if (dataUrl) {
            console.log("[FRAME INTERCEPT] Found data:image/jpeg in frame:", dataUrl.substring(0, 60));
            generatedImageBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');
            break;
          }
        } catch (e) {}
      }
      if (generatedImageBuffer) break;
    }

    if (generatedImageBuffer) {
      console.log(`SUCCESS! Extracted ${generatedImageBuffer.length} bytes image!`);
      fs.writeFileSync('scratch/perchance_car.jpg', generatedImageBuffer);
    } else {
      console.log("Failed to capture image.");
    }
  } finally {
    await browser.close();
  }
})();
