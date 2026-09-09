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
    await page.goto('https://perchance.org/diy-perchance-api', { waitUntil: 'networkidle2', timeout: 30000 });
    for (let i = 0; i < page.frames().length; i++) {
      const f = page.frames()[i];
      try {
        await f.waitForSelector('body', { timeout: 5000 });
        const text = await f.evaluate(() => document.body ? document.body.innerText : 'NO BODY');
        if (text && text.length > 50) {
          console.log(`=== DIY API FRAME ${i} ===`);
          console.log(text);
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
})();
