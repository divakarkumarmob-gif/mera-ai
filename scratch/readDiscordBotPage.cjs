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
    await page.goto('https://perchance.org/perchance-discord-bot', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Check all frames
    for (let i = 0; i < page.frames().length; i++) {
      const f = page.frames()[i];
      try {
        await f.waitForSelector('body', { timeout: 5000 });
        const text = await f.evaluate(() => document.body ? document.body.innerText : 'NO BODY');
        console.log(`=== FRAME ${i} (${f.url()}) ===`);
        console.log(text);
      } catch (e) {
        console.log(`Frame ${i} error:`, e.message);
      }
    }

    // Also get the Perchance editor content if available (the code panel)
    const editorContent = await page.evaluate(() => {
      const codePanel = document.querySelector('#codePanel, .code-editor, textarea, #code-panel');
      if (codePanel) return codePanel.value || codePanel.innerText;
      return null;
    });
    if (editorContent) {
      console.log('=== CODE PANEL CONTENT ===');
      console.log(editorContent);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
})();
