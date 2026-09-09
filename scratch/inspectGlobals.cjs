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

    const result = await frame.evaluate(() => {
      return {
        hasGenerate: typeof window.generate !== 'undefined',
        hasT2i: typeof window.t2i !== 'undefined',
        windowKeys: Object.keys(window).filter(k => !k.startsWith('webkit') && !k.startsWith('on') && !k.startsWith('HTML'))
      };
    });
    console.log("Window evaluation:", result);
  } finally {
    await browser.close();
  }
})();
