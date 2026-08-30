/**
 * FRIDAY AI Chrome Extension — Content Script
 * Executes native in-page 1-click purchases directly inside user's active session without any automation bot flags
 */

console.log("[FRIDAY Companion] Active on page:", window.location.href);

// Inject floating FRIDAY quick-action capsule onto store pages
(function injectFridayFloatingWidget() {
  if (document.getElementById("friday-ecom-widget")) return;

  const widget = document.createElement("div");
  widget.id = "friday-ecom-widget";
  widget.style.position = "fixed";
  widget.style.bottom = "20px";
  widget.style.right = "20px";
  widget.style.zIndex = "999999";
  widget.style.background = "linear-gradient(135deg, #0f172a, #0284c7)";
  widget.style.color = "#fff";
  widget.style.padding = "10px 16px";
  widget.style.borderRadius = "30px";
  widget.style.boxShadow = "0 8px 30px rgba(6,182,212,0.4)";
  widget.style.border = "1px solid rgba(6,182,212,0.5)";
  widget.style.display = "flex";
  widget.style.alignItems = "center";
  widget.style.gap = "8px";
  widget.style.fontFamily = "sans-serif";
  widget.style.fontSize = "12px";
  widget.style.fontWeight = "bold";
  widget.style.cursor = "pointer";
  widget.style.transition = "all 0.2s ease";

  widget.innerHTML = `<span style="font-size: 16px;">🤖</span> <span>FRIDAY Connected</span>`;

  widget.onmouseover = () => (widget.style.transform = "scale(1.05)");
  widget.onmouseout = () => (widget.style.transform = "scale(1)");

  widget.onclick = () => {
    window.open("http://localhost:5000", "_blank");
  };

  document.body.appendChild(widget);
})();

// Listen for direct orders from FRIDAY
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXECUTE_1CLICK_BUY") {
    console.log("[FRIDAY Companion] Received 1-Click Buy Command:", request);

    // Human randomized click
    setTimeout(() => {
      // 1. Flipkart Buy Now
      const fkBuy = document.querySelector("button._2KpZ6l._2U9uOA._3v1-ww, button:has-text('BUY NOW')");
      if (fkBuy) {
        fkBuy.click();
        sendResponse({ success: true, store: "flipkart", status: "buy_now_clicked" });
        return;
      }

      // 2. Amazon Buy Now
      const amzBuy = document.querySelector("#buy-now-button, input[name='submit.buy-now']");
      if (amzBuy) {
        amzBuy.click();
        sendResponse({ success: true, store: "amazon", status: "buy_now_clicked" });
        return;
      }

      sendResponse({ success: false, message: "Buy Now button not found on active page" });
    }, 1200);

    return true; // Keep message channel open for async response
  }
});
