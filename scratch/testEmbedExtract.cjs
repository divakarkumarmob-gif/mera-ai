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
    console.log("Navigating...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const iframeElement = await page.$('iframe#outputIframeEl');
    const frame = await iframeElement.contentFrame();

    const textareas = await frame.$$('textarea');
    const targetTextarea = textareas[1] || textareas[0];
    await targetTextarea.click();
    await frame.evaluate(el => el.value = '', targetTextarea);
    await targetTextarea.type('portrait of a beautiful young woman in traditional indian saree, cinematic lighting, 8k', { delay: 5 });

    const genBtn = await frame.$('#generateButtonEl');
    await genBtn.click();
    console.log("Generate clicked! Waiting for image from embed frames...");

    let resultBuffer = null;

    for (let check = 0; check < 40; check++) {
      await new Promise(r => setTimeout(r, 1000));
      
      const allFrames = page.frames();
      for (const f of allFrames) {
        if (!f.url().includes('image-generation.perchance.org')) continue;
        
        try {
          const frameImgData = await f.evaluate(() => {
            const img = document.querySelector('img');
            if (img && img.src && (img.src.startsWith('data:image') || img.src.startsWith('blob:') || img.src.includes('downloadTemporaryImage') || img.src.includes('http'))) {
              return {
                src: img.src,
                w: img.naturalWidth || img.width,
                h: img.naturalHeight || img.height,
                complete: img.complete
              };
            }
            return null;
          });

          if (frameImgData && frameImgData.w > 200) {
            console.log("Found HD image in embed frame:", frameImgData.src.substring(0, 100), `Dimensions: ${frameImgData.w}x${frameImgData.h}`);
            
            if (frameImgData.src.startsWith('data:image')) {
              resultBuffer = Buffer.from(frameImgData.src.split(',')[1], 'base64');
            } else {
              const base64 = await f.evaluate(async (src) => {
                const res = await fetch(src);
                const blob = await res.blob();
                return new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                });
              }, frameImgData.src);
              if (base64 && typeof base64 === 'string') {
                resultBuffer = Buffer.from(base64.split(',')[1], 'base64');
              }
            }
            break;
          }
        } catch (e) {}
      }
      if (resultBuffer) break;
    }

    if (resultBuffer) {
      console.log(`SUCCESS! Extracted full quality image (${resultBuffer.length} bytes)!`);
      fs.writeFileSync('scratch/perchance_woman.jpg', resultBuffer);
    } else {
      console.log("Failed to get image in time.");
    }
  } finally {
    await browser.close();
  }
})();
