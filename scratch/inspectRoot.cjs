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

    const rootKeys = await frame.evaluate(() => {
      const keys = [];
      if (window.root) {
        for (const k in window.root) {
          keys.push({ key: k, type: typeof window.root[k] });
        }
      }
      return { hasRoot: !!window.root, keys };
    });
    console.log("window.root keys:", JSON.stringify(rootKeys, null, 2));
  } finally {
    await browser.close();
  }
})();
