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
    
    page.on('request', req => {
      const url = req.url();
      if (url.includes('image-generation') || url.includes('/api/generate') || url.includes('downloadTemporaryImage')) {
        console.log('=== REQUEST ===');
        console.log('URL:', url);
        console.log('Method:', req.method());
        console.log('Headers:', JSON.stringify(req.headers(), null, 2));
        console.log('PostData:', req.postData());
      }
    });

    page.on('response', async res => {
      const url = res.url();
      if (url.includes('/api/generate') || url.includes('downloadTemporaryImage')) {
        console.log('=== RESPONSE ===');
        console.log('URL:', url);
        console.log('Status:', res.status());
        try {
          const text = await res.text();
          console.log('Body:', text.substring(0, 300));
        } catch (e) {}
      }
    });

    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2' });
    const iframeElement = await page.waitForSelector('iframe#outputIframeEl', { timeout: 15000 });
    const frame = await iframeElement.contentFrame();

    await frame.waitForSelector('textarea', { timeout: 15000 });
    const textareas = await frame.$$('textarea');
    const promptInput = textareas.length > 1 ? textareas[1] : textareas[0];
    await promptInput.click();
    await frame.evaluate(el => el.value = '', promptInput);
    await promptInput.type('a cute cat sitting on a chair', { delay: 10 });

    const genBtn = await frame.waitForSelector('#generateButtonEl', { timeout: 15000 });
    await genBtn.click();

    await new Promise(r => setTimeout(r, 15000));
  } finally {
    await browser.close();
  }
})();
