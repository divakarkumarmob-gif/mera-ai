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
    console.log("Navigating...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const iframeElement = await page.$('iframe#outputIframeEl');
    const frame = await iframeElement.contentFrame();
    console.log("Found parent generator frame:", frame.url());

    const textareas = await frame.$$('textarea');
    const targetTextarea = textareas[1] || textareas[0];
    await targetTextarea.click();
    await frame.evaluate(el => el.value = '', targetTextarea);
    await targetTextarea.type('beautiful sunset over mountain peaks, ultra realistic photograph', { delay: 10 });

    const genBtn = await frame.$('#generateButtonEl');
    await genBtn.click();
    console.log("Generate clicked! Waiting for image across ALL frames...");

    let imageBuffer = null;
    let imageUrl = null;

    for (let check = 0; check < 30; check++) {
      await new Promise(r => setTimeout(r, 1500));
      
      const allFrames = page.frames();
      for (const f of allFrames) {
        try {
          const imgs = await f.evaluate(() => {
            return Array.from(document.querySelectorAll('img')).map(i => ({
              src: i.src,
              w: i.naturalWidth || i.width,
              h: i.naturalHeight || i.height,
              complete: i.complete
            }));
          });
          for (const img of imgs) {
            if (img.src && (img.src.startsWith('blob:') || img.src.startsWith('data:image') || img.src.includes('perchance') || img.src.includes('user-generated')) && img.w > 200) {
              imageUrl = img.src;
              console.log(`FOUND IMAGE in frame (${f.url().substring(0, 50)}):`, img.src.substring(0, 80), `Size: ${img.w}x${img.h}`);
              
              // Extract buffer if blob or data url or http
              if (img.src.startsWith('data:image')) {
                const base64Data = img.src.split(',')[1];
                imageBuffer = Buffer.from(base64Data, 'base64');
              } else {
                // If blob: or http, we can fetch it inside the frame or take screenshot of the img element!
                try {
                  const base64 = await f.evaluate(async (src) => {
                    const res = await fetch(src);
                    const blob = await res.blob();
                    return new Promise((resolve) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result);
                      reader.readAsDataURL(blob);
                    });
                  }, img.src);
                  if (base64 && typeof base64 === 'string') {
                    imageBuffer = Buffer.from(base64.split(',')[1], 'base64');
                  }
                } catch (bErr) {
                  console.log("Fetch blob error:", bErr);
                }
              }
              break;
            }
          }
        } catch (e) {}
        if (imageUrl && imageBuffer) break;
      }
      if (imageUrl && imageBuffer) break;
    }

    if (imageBuffer && imageBuffer.length > 0) {
      console.log(`SUCCESS! Extracted image buffer: ${imageBuffer.length} bytes!`);
      const fs = require('fs');
      fs.writeFileSync('scratch/test_generated.jpeg', imageBuffer);
      console.log("Saved image to scratch/test_generated.jpeg");
    } else {
      console.log("Did not get complete image buffer. Image URL was:", imageUrl);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
})();
