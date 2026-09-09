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

    // Inspect script contents in the frame
    const scripts = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('script')).map(s => s.innerText || s.src).filter(Boolean);
    });
    console.log("Found scripts count:", scripts.length);
    for (let i = 0; i < scripts.length; i++) {
      if (typeof scripts[i] === 'string' && scripts[i].includes('generateButtonEl')) {
        console.log("Found generate script snippet:", scripts[i].substring(0, 500));
      }
    }
  } finally {
    await browser.close();
  }
})();
