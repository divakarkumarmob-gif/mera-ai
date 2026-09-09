const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false, // let's run headed or check how it works
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  });
  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('response', res => {
      const url = res.url();
      if (url.includes('image') || url.includes('generate') || url.includes('perchance') || url.includes('poll') || url.includes('api')) {
        console.log('NET RES:', res.status(), url.substring(0, 100));
      }
    });

    console.log("Navigating...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const iframeElement = await page.$('iframe#outputIframeEl');
    const frame = await iframeElement.contentFrame();
    console.log("Found frame:", frame.url());

    // Focus and click the 2nd textarea
    const textareas = await frame.$$('textarea');
    console.log("Textareas:", textareas.length);
    const targetTextarea = textareas[1] || textareas[0];
    await targetTextarea.click();
    await frame.evaluate(el => el.value = '', targetTextarea);
    await targetTextarea.type('a cute red panda sitting on a bamboo tree, 4k ultra realistic photo', { delay: 20 });
    console.log("Typed prompt.");

    // Click generate button with element handle
    const genBtn = await frame.$('#generateButtonEl');
    if (genBtn) {
      console.log("Clicking genBtn directly...");
      await genBtn.click();
    }

    console.log("Waiting 15 seconds to monitor...");
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const res = await frame.evaluate(() => {
        const allImgs = Array.from(document.querySelectorAll('img')).map(i => ({ src: i.src, w: i.width, h: i.height }));
        const allIframes = Array.from(document.querySelectorAll('iframe')).map(i => i.src);
        const allContainers = Array.from(document.querySelectorAll('[id*="image"], [class*="image"], [id*="output"], [class*="output"]')).map(el => ({
          tag: el.tagName,
          id: el.id,
          class: el.className,
          html: el.innerHTML.substring(0, 100)
        }));
        return { allImgs, allIframes, allContainers };
      });
      console.log(`Sec ${i+1}: Imgs: ${res.allImgs.length}, Iframes: ${res.allIframes.length}, Containers: ${res.allContainers.length}`);
      if (res.allImgs.length > 0) {
        console.log("Found imgs:", res.allImgs);
        break;
      }
      if (res.allIframes.length > 0) {
        console.log("Found inner iframes:", res.allIframes);
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
})();
