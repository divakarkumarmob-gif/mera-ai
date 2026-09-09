const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  console.log("Launching headless browser...");
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    console.log("Navigating to https://perchance.org/ai-photo-generator...");
    await page.goto('https://perchance.org/ai-photo-generator', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Find iframe
    const iframeElement = await page.$('iframe#outputIframeEl');
    if (!iframeElement) {
      console.log("Could not find iframe#outputIframeEl");
      return;
    }
    const frame = await iframeElement.contentFrame();
    if (!frame) {
      console.log("Could not get contentFrame");
      return;
    }

    console.log("Frame loaded:", frame.url());

    // Evaluate in frame to find input elements and structure
    const frameDetails = await frame.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).map((t, idx) => ({
        idx,
        placeholder: t.placeholder,
        value: t.value,
        className: t.className
      }));
      const btn = document.querySelector('#generateButtonEl');
      return {
        textareas,
        hasGenBtn: !!btn
      };
    });

    console.log("Frame details:", JSON.stringify(frameDetails, null, 2));

    // Clear and set prompt directly via evaluate or type
    await frame.evaluate((testPrompt) => {
      const textareas = document.querySelectorAll('textarea');
      // Description is usually the 2nd textarea or the one with college girl placeholder
      const promptEl = Array.from(textareas).find(t => t.placeholder.includes('college girl')) || textareas[1] || textareas[0];
      if (promptEl) {
        promptEl.value = testPrompt;
        promptEl.dispatchEvent(new Event('input', { bubbles: true }));
        promptEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const btn = document.querySelector('#generateButtonEl');
      if (btn) btn.click();
    }, "a cute red panda sitting on a bamboo tree, 4k ultra realistic");

    console.log("Triggered prompt and generate button click. Waiting for image...");

    let foundImage = null;
    for (let check = 1; check <= 25; check++) {
      await new Promise(r => setTimeout(r, 2000));
      const imgs = await frame.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(img => ({
          src: img.src,
          currentSrc: img.currentSrc,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          complete: img.complete
        }));
      });

      console.log(`[Check ${check}] Total images in frame:`, imgs.length);
      for (const img of imgs) {
        if (img.src && !img.src.includes('data:image/svg') && (img.width > 150 || img.src.startsWith('blob:') || img.src.includes('image') || img.src.startsWith('data:image/jpeg') || img.src.startsWith('data:image/png') || img.src.includes('perchance'))) {
          console.log("Image found:", img.src.substring(0, 80), "width:", img.width, "height:", img.height);
          foundImage = img.src;
          break;
        }
      }
      if (foundImage) break;
    }

    if (foundImage) {
      console.log("SUCCESS! Generated image src:", foundImage.substring(0, 100));
    } else {
      console.log("Did not get final image within timeout.");
    }

  } catch (err) {
    console.error("Test Error:", err);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
})();
