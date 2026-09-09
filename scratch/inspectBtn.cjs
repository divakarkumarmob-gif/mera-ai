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

    const info = await frame.evaluate(() => {
      const btn = document.querySelector('#generateButtonEl');
      const onclick = btn ? (btn.onclick ? btn.onclick.toString() : btn.getAttribute('onclick')) : null;
      const textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
        placeholder: t.placeholder,
        id: t.id,
        className: t.className
      }));
      return { onclick, textareas };
    });
    console.log("Button & Textareas:", JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
})();
