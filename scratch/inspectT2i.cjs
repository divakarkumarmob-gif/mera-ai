const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2' });
    
    const iframeElement = await page.$('iframe#outputIframeEl');
    const frame = await iframeElement.contentFrame();

    const t2iKeys = await frame.evaluate(() => {
      const keys = [];
      for (const k in window.t2i) {
        keys.push({ key: k, type: typeof window.t2i[k] });
      }
      return keys;
    });
    console.log("t2i keys:", t2iKeys);
  } finally {
    await browser.close();
  }
})();
