/**
 * FRIDAY AI — Master Express REST API Router
 * Modularized domain routes for chat, memory, contacts, ecommerce, music, security, and bots.
 */

import express, { Router } from "express";
import { memoryEngine } from "../services/memoryEngine";
import { toolsEngine } from "../services/toolsEngine";
import { contactsService } from "../services/contactsService";
import { whatsappBotService } from "../services/whatsappBotService";
import { whatsappCloudService } from "../services/whatsappCloudService";
import { sendWhatsAppUnified } from "../services/whatsappService";
import { dailyUpdateService, resolveRelativeDateIST } from "../services/dailyUpdateService";
import { codeAgentService } from "../services/codeAgentService";
import { publicApisService } from "../services/publicApisService";
import { saveMessage, getHistory, clearHistory } from "../services/historyService";
import { visionMemoryService } from "../services/visionMemoryService";
import { voiceBiometricsService } from "../services/voiceBiometricsService";
import { telegramBotService } from "../services/telegramBotService";
import { instagramBotService } from "../services/instagramBotService";
import { cyberSecurityService } from "../services/cyberSecurityService";
import { backgroundTasksService } from "../services/backgroundTasksService";
import { appSecurityService } from "../services/appSecurityService";
import { webCrawlerService } from "../services/webCrawlerService";
import { railRadarService } from "../services/railRadarService";
import { weatherService } from "../services/weatherService";
import { newsService } from "../services/newsService";
import { bossRoutineService } from "../services/bossRoutineService";
import { fridayLearningService } from "../services/fridayLearningService";
import { vectorMemoryService } from "../services/vectorMemoryService";
import { liveScratchService } from "../services/liveScratchService";
import { smartMemoryRetrieverService } from "../services/smartMemoryRetrieverService";
import { memoryBackupService } from "../services/memoryBackupService";
import { telegramSecurityBotService } from "../services/telegramSecurityBotService";
import { networkDeviceScannerService } from "../services/networkDeviceScannerService";
import { jioSaavnService } from "../services/jioSaavnService";
import { youtubeMusicService } from "../services/youtubeMusicService";
import { calendarEventService } from "../services/calendarEventService";
import { productPriceService } from "../services/productPriceService";
import { priceDropTrackerService } from "../services/priceDropTrackerService";
import { ecommerceOrderService } from "../services/ecommerceOrderService";
import { autonomousBuyerService } from "../services/autonomousBuyerService";
import { sherlockService } from "../services/sherlockService";
import { theHarvesterService } from "../services/theHarvesterService";
import { sqlMapService } from "../services/sqlMapService";
import { niktoService } from "../services/niktoService";
import { socialEngineerToolkitService } from "../services/socialEngineerToolkitService";
import { johnTheRipperService } from "../services/johnTheRipperService";
import { voicePersonaService } from "../services/voicePersonaService";
import { serverFirewallService } from "../services/serverFirewallService";

export interface ApiRoutesContext {
  getBaileysEnabled: () => boolean;
  setBaileysEnabled: (v: boolean) => void;
  getActiveConnectionsCount: () => number;
}

export function createApiRouter(context: ApiRoutesContext): Router {
  const router = Router();
  const app = router;
  const { getBaileysEnabled, setBaileysEnabled, getActiveConnectionsCount } = context;

  let baileysEnabled = getBaileysEnabled();

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/security/firewall-stats", async (_req, res) => {
    try {
      const stats = await serverFirewallService.getFirewallStats();
      res.json({ ok: true, stats });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to fetch firewall stats" });
    }
  });

  app.get("/api/history", async (req, res) => {
    try {
      // Default: only the most recent 50 messages (fast, low decrypt cost).
      // Client can pass ?before=<timestamp> to page further back when the
      // user actually asks for older history (e.g. scrolling up).
      const limit = req.query.limit ? Math.min(Number(req.query.limit) || 50, 200) : 50;
      const before = req.query.before ? Number(req.query.before) : undefined;
      res.json({ messages: await getHistory(limit, before) });
    } catch (e) {
      console.error("Failed to load history:", e);
      res.status(500).json({ error: "failed_to_load_history" });
    }
  });

  app.post("/api/history/clear", async (_req, res) => {
    try {
      await clearHistory();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_history" });
    }
  });

  app.get("/api/memory", async (_req, res) => {
    try {
      res.json(await memoryEngine.getMemories());
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_memory" });
    }
  });

  app.post("/api/memory/clear", async (_req, res) => {
    try {
      await memoryEngine.clearAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_clear_memory" });
    }
  });

  app.post("/api/memory/pin", async (req, res) => {
    try {
      const { fact } = req.body;
      if (fact) await memoryEngine.addPinnedMemory(fact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_pin_memory" });
    }
  });

  app.post("/api/memory/vault", async (req, res) => {
    try {
      const { category, exactFact } = req.body;
      if (exactFact) await memoryEngine.addPersonalVaultFact(category, exactFact);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "failed_to_save_vault" });
    }
  });

  // ── Multi-Store E-Commerce Price Comparison & Scraping Endpoints ───────────
  app.get("/api/ecommerce/compare", async (req, res) => {
    try {
      const query = (req.query.q as string || req.query.query as string || "").trim();
      if (!query) {
        return res.status(400).json({ ok: false, error: "Search query 'q' is required" });
      }
      const result = await productPriceService.compareProductAcrossStores(query);
      res.json({ ok: true, data: result });
    } catch (e: any) {
      console.error("[ECommerce] Compare price error:", e);
      res.status(500).json({ ok: false, error: e?.message || "Failed to compare prices" });
    }
  });

  app.get("/api/ecommerce/search", async (req, res) => {
    try {
      const query = (req.query.q as string || "").trim();
      const store = (req.query.store as string || "all").toLowerCase();
      if (!query) {
        return res.status(400).json({ ok: false, error: "Search query 'q' is required" });
      }
      if (store === "amazon") {
        const items = await productPriceService.searchAmazon(query);
        return res.json({ ok: true, store: "amazon", items });
      } else if (store === "flipkart") {
        const items = await productPriceService.searchFlipkart(query);
        return res.json({ ok: true, store: "flipkart", items });
      } else if (store === "meesho") {
        const items = await productPriceService.searchMeesho(query);
        return res.json({ ok: true, store: "meesho", items });
      }
      const result = await productPriceService.compareProductAcrossStores(query);
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to search products" });
    }
  });

  app.post("/api/ecommerce/track", async (req, res) => {
    try {
      const { productName, currentPrice, targetPrice, productUrl, store } = req.body;
      if (!productName || !currentPrice) {
        return res.status(400).json({ ok: false, error: "productName and currentPrice are required" });
      }
      const result = await priceDropTrackerService.trackProduct(productName, currentPrice, targetPrice, productUrl, store);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to track product" });
    }
  });

  app.get("/api/ecommerce/tracked", async (_req, res) => {
    try {
      const result = await priceDropTrackerService.getTrackedProducts();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to get tracked products" });
    }
  });

  app.delete("/api/ecommerce/tracked/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await priceDropTrackerService.deleteTrackedProduct(id);
      res.json({ success, message: success ? "Product tracker deleted." : "Failed to delete" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to delete tracker" });
    }
  });

  app.post("/api/ecommerce/check-now", async (_req, res) => {
    try {
      const result = await priceDropTrackerService.checkAllPricesLive();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to check live prices" });
    }
  });

  // ── Autonomous E-Commerce Orders & Payment Endpoints ──────────────────────
  app.post("/api/ecommerce/order", async (req, res) => {
    try {
      const { productName, price, paymentMethod, store, productUrl, imageUrl, customAddress } = req.body;
      if (!productName || !price) {
        return res.status(400).json({ ok: false, error: "productName and price are required" });
      }
      const result = await ecommerceOrderService.createOrder({
        productName,
        price,
        paymentMethod: paymentMethod === "COD" ? "COD" : "ONLINE_UPI",
        store,
        productUrl,
        imageUrl,
        customAddress,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to create order" });
    }
  });

  app.get("/api/ecommerce/orders", async (_req, res) => {
    try {
      const orders = await ecommerceOrderService.getAllOrders();
      res.json({ ok: true, orders });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to fetch orders" });
    }
  });

  app.post("/api/ecommerce/orders/:id/paid", async (req, res) => {
    try {
      const { id } = req.params;
      const { utr } = req.body;
      const result = await ecommerceOrderService.markOrderPaid(id, utr);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to update order" });
    }
  });

  // ── Autonomous Auto-Buyer & Login Session Endpoints ────────────────────────
  app.post("/api/ecommerce/browser-login", async (req, res) => {
    try {
      const { store } = req.body;
      const targetStore = store === "amazon" ? "amazon" : store === "meesho" ? "meesho" : "flipkart";
      const result = await autonomousBuyerService.openInteractiveLogin(targetStore);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to open login helper" });
    }
  });

  app.post("/api/ecommerce/browser-logout", async (req, res) => {
    try {
      const { store } = req.body;
      const targetStore = store === "amazon" ? "amazon" : store === "meesho" ? "meesho" : "flipkart";
      const result = await autonomousBuyerService.logoutStore(targetStore);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to logout store" });
    }
  });

  app.get("/api/ecommerce/session-status", async (_req, res) => {
    try {
      const [fk, amz, meesho] = await Promise.all([
        autonomousBuyerService.checkLoginStatus("flipkart"),
        autonomousBuyerService.checkLoginStatus("amazon"),
        autonomousBuyerService.checkLoginStatus("meesho"),
      ]);
      res.json({ ok: true, sessions: { flipkart: fk, amazon: amz, meesho } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to check session status" });
    }
  });

  app.post("/api/ecommerce/auto-order-cod", async (req, res) => {
    try {
      const { productUrl, productName, price, store, addressKeyword } = req.body;
      if (!productUrl || !productName) {
        return res.status(400).json({ ok: false, error: "productUrl and productName are required" });
      }
      const targetStore = store === "amazon" ? "amazon" : store === "meesho" ? "meesho" : "flipkart";
      const result = await autonomousBuyerService.autoOrderCod({
        productUrl,
        productName,
        price: Number(price) || 0,
        store: targetStore,
        addressKeyword,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Autonomous COD order failed" });
    }
  });

  app.post("/api/ecommerce/send-buy-link", async (req, res) => {
    try {
      const { productName, price, store, productUrl, originalPrice, discountPercentage, rating } = req.body;
      if (!productUrl || !productName) {
        return res.status(400).json({ ok: false, error: "productUrl and productName are required" });
      }
      const result = await ecommerceOrderService.sendDirectBuyLink({
        productName: String(productName),
        price: Number(price) || 0,
        store: String(store || "Online Store"),
        productUrl: String(productUrl),
        originalPrice: originalPrice ? Number(originalPrice) : undefined,
        discountPercentage: discountPercentage ? Number(discountPercentage) : undefined,
        rating: rating ? Number(rating) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to send buy link" });
    }
  });

  // ── Public Web UPI 1-Click Pay & QR Portal ─────────────────────────────────
  app.get("/pay/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;
      const order = await ecommerceOrderService.getOrderById(orderId);
      if (!order) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head><title>Order Not Found</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="background:#0a0f24;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:20px;">
              <h2>❌ Order #${orderId} Not Found</h2>
              <p style="color:#94a3b8;">Yeh order link expire ho chuki hai ya galat hai.</p>
            </div>
          </body>
          </html>
        `);
      }

      const links = order.paymentLinks || ecommerceOrderService.generatePaymentLinks(order.id, order.price, order.productName);
      const qrData = encodeURIComponent(links.universalUpi);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${qrData}`;

      res.setHeader("Content-Type", "text/html");
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>FRIDAY Pay — Order #${order.id}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            body { background: #060918; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
            .card { background: #0f172a; border: 1px solid rgba(6, 182, 212, 0.3); box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 30px rgba(6, 182, 212, 0.15); border-radius: 24px; width: 100%; max-width: 440px; padding: 24px; text-align: center; }
            .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: rgba(6, 182, 212, 0.15); border: 1px solid rgba(6, 182, 212, 0.4); color: #22d3ee; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 16px; }
            .price { font-size: 36px; font-weight: 900; color: #38bdf8; margin: 8px 0; }
            .title { font-size: 15px; font-weight: 600; color: #e2e8f0; margin-bottom: 16px; line-height: 1.4; }
            .details { background: #1e293b; border-radius: 16px; padding: 12px 16px; font-size: 12px; color: #94a3b8; text-align: left; margin-bottom: 20px; }
            .details div { display: flex; justify-content: space-between; margin-bottom: 6px; }
            .details div:last-child { margin-bottom: 0; }
            .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 16px; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 14px; margin-bottom: 10px; transition: transform 0.15s, opacity 0.15s; }
            .btn:active { transform: scale(0.98); }
            .btn-phonepe { background: linear-gradient(135deg, #5f259f, #7c3aed); color: #fff; }
            .btn-gpay { background: linear-gradient(135deg, #1a73e8, #2563eb); color: #fff; }
            .btn-paytm { background: linear-gradient(135deg, #00b9f5, #0284c7); color: #fff; }
            .btn-any { background: #334155; color: #f8fafc; border: 1px solid rgba(255,255,255,0.1); }
            .qr-box { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); }
            .qr-img { width: 180px; height: 180px; border-radius: 12px; border: 4px solid #fff; margin: 8px auto; display: block; }
            .footer { font-size: 11px; color: #64748b; margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">⚡ FRIDAY Instant UPI Pay</div>
            <div class="price">₹${order.price.toLocaleString("en-IN")}</div>
            <div class="title">${order.productName}</div>

            <div class="details">
              <div><span>Order ID:</span> <b style="color:#f1f5f9;">#${order.id}</b></div>
              <div><span>Store:</span> <b style="color:#f1f5f9;">${order.store}</b></div>
              <div><span>Delivery:</span> <b style="color:#22d3ee;">${order.expectedDeliveryDate}</b></div>
            </div>

            <!-- 1-Tap UPI App Action Buttons -->
            <a href="${links.phonepe}" class="btn btn-phonepe">🟣 Pay with PhonePe</a>
            <a href="${links.gpay}" class="btn btn-gpay">🔵 Pay with Google Pay</a>
            <a href="${links.paytm}" class="btn btn-paytm">🔷 Pay with Paytm</a>
            <a href="${links.universalUpi}" class="btn btn-any">📲 Pay with Any UPI App / BHIM</a>

            <!-- Scan to Pay QR Code -->
            <div class="qr-box">
              <p style="font-size:12px; color:#94a3b8; font-weight:600;">Scan QR Code from any UPI App:</p>
              <img src="${qrUrl}" alt="UPI QR Code" class="qr-img" />
              <p style="font-size:11px; color:#64748b;">UPI ID: <b>${order.paymentLinks ? order.paymentLinks.universalUpi.split('pa=')[1].split('&')[0] : 'divakarkumar@upi'}</b></p>
            </div>

            <div class="footer">🔒 100% Secure & Encrypted by FRIDAY AI</div>
          </div>
        </body>
        </html>
      `);
    } catch (err: any) {
      res.status(500).send("Payment portal error: " + err?.message);
    }
  });

  app.get("/api/routine", async (_req, res) => {
    try {
      const current = bossRoutineService.getCurrentHabit();
      const slots = await bossRoutineService.getAllRoutineSlots();
      res.json({ ok: true, current, slots });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_routine" });
    }
  });

  app.post("/api/routine/update", async (req, res) => {
    try {
      const { slotQuery, startTimeStr, endTimeStr, activity, title } = req.body;
      if (!slotQuery) return res.status(400).json({ ok: false, error: "slotQuery is required" });
      const result = await bossRoutineService.updateRoutineSlot(slotQuery, { startTimeStr, endTimeStr, activity, title });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "failed_to_update_routine" });
    }
  });

  app.get("/api/learning/lessons", async (_req, res) => {
    try {
      res.json({ ok: true, lessons: await fridayLearningService.getAllLessons() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_lessons" });
    }
  });

  app.post("/api/learning/record", async (req, res) => {
    try {
      const { whatFridayDidWrong, whatBossTaught, goldenRule, triggerContext } = req.body;
      if (!whatFridayDidWrong || !whatBossTaught || !goldenRule) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }
      const result = await fridayLearningService.recordLesson({
        whatFridayDidWrong,
        whatBossTaught,
        goldenRule,
        triggerContext,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "failed_to_record_lesson" });
    }
  });

  // ── Audio Proxy for JioSaavn / CDN streams (HTTP 206 Range Stream Support) ──
  app.get("/api/music/proxy-stream", async (req, res) => {
    const rawUrl = String(req.query.url || "");
    if (!rawUrl || !rawUrl.startsWith("http")) {
      return res.status(400).send("Invalid stream URL");
    }
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range as string;
      }

      const audioRes = await fetch(rawUrl, { headers });

      res.status(audioRes.status);
      res.set({
        "Content-Type": audioRes.headers.get("content-type") || "audio/mp4",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Cache-Control": "public, max-age=86400",
      });

      if (audioRes.headers.get("content-range")) {
        res.set("Content-Range", audioRes.headers.get("content-range")!);
      }
      if (audioRes.headers.get("content-length")) {
        res.set("Content-Length", audioRes.headers.get("content-length")!);
      }

      const arrayBuf = await audioRes.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (e: any) {
      console.warn("[MusicProxy] Error streaming audio:", e?.message || e);
      if (!res.headersSent) res.status(500).send("Proxy error");
    }
  });

  // ── Music Lyrics Endpoint ──
  app.get("/api/music/lyrics", async (req, res) => {
    const query = String(req.query.query || "");
    if (!query) return res.status(400).json({ success: false, message: "Query required" });
    try {
      const searchRes = await jioSaavnService.searchSong(query);
      if (searchRes.success && searchRes.topSong?.id) {
        const lyricsRes = await jioSaavnService.getLyrics(searchRes.topSong.id);
        if (lyricsRes.success) {
          return res.json({ success: true, lyrics: lyricsRes.lyrics, copyright: lyricsRes.copyright });
        }
      }
      res.json({ success: false, message: "Lyrics not found" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // ── Music Search Endpoint (JioSaavn HD) ──
  app.get("/api/music/search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (!query) return res.status(400).json({ success: false, message: "Query required" });
    try {
      const searchRes = await jioSaavnService.searchSong(query);
      res.json(searchRes);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // ── Music Smart Queue Endpoint (JioSaavn Radio) ──
  app.get("/api/music/queue", async (req, res) => {
    try {
      const songName = String(req.query.songName || req.query.song || "");
      const artistName = String(req.query.artistName || req.query.artist || "");
      const albumName = String(req.query.albumName || req.query.album || "");
      const queue = await jioSaavnService.getSmartQueue({ songName, artistName, albumName });
      res.json({ success: true, count: queue.length, queue });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e, queue: [] });
    }
  });

  app.get("/api/network/connected-devices", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanConnectedDevices(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Scan failed" });
    }
  });

  app.get("/api/network/wifi-radar", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanConnectedDevices(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Radar scan failed" });
    }
  });

  app.get("/api/network/wifi-recon", async (req, res) => {
    try {
      const force = req.query.refresh !== "false";
      const result = await networkDeviceScannerService.scanNearbyWifiRecon(force);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Recon scan failed" });
    }
  });

  // ── Voice Biometrics REST Endpoints ─────────────────────────────────────────
  app.get("/api/voice-biometrics/profiles", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({ success: true, count: profiles.length, profiles });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Failed to fetch profiles" });
    }
  });

  app.post("/api/voice-biometrics/start-enroll", async (req, res) => {
    try {
      const { pin, name, relationWithDivakar, role } = req.body || {};
      const result = await voiceBiometricsService.startVoiceEnrollment(
        String(pin || ""),
        String(name || "Guest"),
        String(relationWithDivakar || "Friend"),
        role || "friend"
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Enrollment start failed" });
    }
  });

  app.post("/api/voice-biometrics/record-sample", async (req, res) => {
    try {
      const { sessionId, audioBase64, spokenPhrase } = req.body || {};
      const result = await voiceBiometricsService.recordCalibrationSample(
        String(sessionId || ""),
        String(audioBase64 || ""),
        spokenPhrase ? String(spokenPhrase) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Sample recording failed" });
    }
  });

  app.post("/api/voice-biometrics/delete-profile", async (req, res) => {
    try {
      const { pin, profileId } = req.body || {};
      const result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId ? String(profileId) : undefined);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Delete profile failed" });
    }
  });

  app.post("/api/voice-biometrics/update-pin", async (req, res) => {
    try {
      const { newPin, senderName } = req.body || {};
      const result = await voiceBiometricsService.updateVoicePin(String(newPin || ""), senderName || "Boss (DK)");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Update pin failed" });
    }
  });

  // ── Music Audio Proxy Stream (Bypasses CDN CORS Blocks) ──────────────────────
  app.get("/api/music/proxy-stream", async (req, res) => {
    try {
      const audioUrl = String(req.query.url || "");
      if (!audioUrl || (!audioUrl.startsWith("http://") && !audioUrl.startsWith("https://"))) {
        return res.status(400).send("Valid audio 'url' parameter is required.");
      }

      const response = await fetch(audioUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Referer": "https://www.jiosaavn.com/",
          "Accept": "*/*",
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Upstream audio fetch failed: ${response.statusText}`);
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mp4");
      
      const contentLength = response.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      
      const acceptRanges = response.headers.get("accept-ranges");
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (e: any) {
      res.status(500).send(`Audio proxy streaming failed: ${e?.message || e}`);
    }
  });

  app.get("/api/memory/vector/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = req.query.limit ? Number(req.query.limit) : 5;
      const filterDate = req.query.date ? String(req.query.date).trim() : undefined;
      if (!q) return res.status(400).json({ ok: false, error: "query 'q' is required" });
      const searchRes = await vectorMemoryService.searchSemanticMemory(
        q,
        limit,
        0.15,
        filterDate ? { exactDate: filterDate } : undefined
      );
      res.json({ ok: true, ...searchRes });
    } catch (e) {
      res.status(500).json({ error: "failed_to_search_vector_memory" });
    }
  });

  app.get("/api/memory/lifecycle/stats", async (_req, res) => {
    try {
      const vectorStats = await vectorMemoryService.getVectorStoreStats();
      const memories = await memoryEngine.getMemories();
      res.json({
        ok: true,
        stats: {
          pastSessionsCount: memories.pastSessionsCount,
          vectorStats,
          policy: {
            exactDialoguesDays: 4,
            comprehensiveSummariesDays: 60,
            permanentVectorArchivalDays: "60+",
            dailyUpdatesVerbatimDays: 30,
            liveScratchStreamHours: 24,
          },
        },
      });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_lifecycle_stats" });
    }
  });

  app.get("/api/memory/smart-retrieve", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "query 'q' is required" });
      const result = await smartMemoryRetrieverService.fetchMultiTierMemory(q);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: "failed_to_retrieve_smart_memory" });
    }
  });

  app.get("/api/memory/export/decrypted-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      // High-Security Double Lock: Requires Boss's Master App Key even with a valid session token!
      const passkey = (req.query.key as string) || (req.headers["x-master-app-key"] as string);
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!passkey || passkey.trim() !== activeKey.trim())) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Unauthorized backup export attempt with invalid Master Key on ${req.path}`
        );
        return res.status(403).json({
          ok: false,
          error: "ACCESS_BLOCKED_IMMEDIATE",
          message: "🚨 Critical Intrusion: Wrong/missing Master App Key for decrypted backup. IP & Device blocked.",
        });
      }

      const backup = await memoryBackupService.exportDecryptedBackup();
      const filename = `friday_memory_backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(backup, null, 2));
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to export backup" });
    }
  });

  app.post("/api/memory/import/restore-backup", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      // High-Security Double Lock: Requires Boss's Master App Key
      const passkey = (req.query.key as string) || (req.headers["x-master-app-key"] as string) || req.body?.masterKey;
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!passkey || passkey.trim() !== activeKey.trim())) {
        await appSecurityService.blockClient(
          clientIp,
          userAgent,
          `Unauthorized backup restore attempt with invalid Master Key on ${req.path}`
        );
        return res.status(403).json({
          ok: false,
          error: "ACCESS_BLOCKED_IMMEDIATE",
          message: "🚨 Critical Intrusion: Wrong/missing Master App Key for memory restore. IP & Device blocked.",
        });
      }

      const backupData = req.body;
      if (!backupData || !backupData.version) {
        return res.status(400).json({ ok: false, error: "Invalid backup JSON payload" });
      }
      const result = await memoryBackupService.restoreAndReEncryptBackup(backupData);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to restore backup" });
    }
  });

  // ── Dashboard Unblock & Blocked Clients Management ─────────────────────────
  app.get("/api/security/blocked-clients", async (_req, res) => {
    try {
      const list = await appSecurityService.listBlockedIps();
      res.json({ ok: true, blockedList: list });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to list blocked clients" });
    }
  });

  app.post("/api/security/unblock", async (req, res) => {
    try {
      const { ip, masterKey } = req.body || {};
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!masterKey || masterKey.trim() !== activeKey.trim())) {
        return res.status(403).json({ ok: false, error: "MASTER_KEY_REQUIRED", message: "Boss's Master App Key required to unblock clients." });
      }

      if (!ip) return res.status(400).json({ ok: false, error: "IP address is required" });

      if (ip === "all") {
        const count = await appSecurityService.unblockAll();
        return res.json({ ok: true, message: `Successfully unblocked all ${count} clients.` });
      }

      const success = await appSecurityService.unblockIp(ip);
      res.json({ ok: true, success, message: success ? `IP ${ip} unblocked successfully.` : `IP ${ip} not found in blocked list.` });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to unblock client" });
    }
  });

  app.get("/api/reminders", async (_req, res) => {
    try {
      res.json({ reminders: await toolsEngine.getReminders() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_reminders" });
    }
  });

  app.get("/api/notes", async (_req, res) => {
    try {
      res.json({ notes: await toolsEngine.getNotes() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_notes" });
    }
  });

  app.get("/api/contacts", async (_req, res) => {
    try {
      res.json({ contacts: await contactsService.getAllContacts() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_contacts" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    const { name, phone, relation } = req.body;
    if (name && phone) {
      try {
        const entry = await contactsService.saveContact(name, phone, relation);
        res.json({ ok: true, contact: entry });
      } catch (e) {
        res.status(500).json({ error: "failed_to_save_contact" });
      }
    } else {
      res.status(400).json({ error: "name_and_phone_required" });
    }
  });

  app.post("/api/whatsapp/pair", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "phone_required" });
      const pairingCode = await whatsappBotService.requestPairingCode(phone);
      res.json({ ok: true, pairingCode });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "pairing_failed" });
    }
  });

  app.post("/api/whatsapp/reset", async (_req, res) => {
    try {
      await whatsappBotService.resetSession();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "reset_failed" });
    }
  });

  app.get("/api/whatsapp/status", (_req, res) => {
    const baileysStatus = whatsappBotService.getStatus();
    const cloudStatus = whatsappCloudService.getStatus();
    res.json({
      isConnected: baileysStatus.isConnected || cloudStatus.configured,
      dedicatedPhone: baileysStatus.dedicatedPhone || (cloudStatus.configured ? cloudStatus.fromNumber : null),
      qrCodeDataUrl: baileysStatus.qrCodeDataUrl,
      pairingCode: baileysStatus.pairingCode,
      baileys: baileysStatus,
      cloud: cloudStatus,
      baileysEnabled,
    });
  });

  // ── Baileys toggle endpoint (for UI toggle + internal use) ────────────────
  app.post("/api/whatsapp/baileys/toggle", (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled === "boolean") {
      baileysEnabled = enabled;
    } else {
      baileysEnabled = !baileysEnabled; // flip if no value given
    }
    console.log(`[Server] Baileys system ${baileysEnabled ? 'ENABLED' : 'DISABLED'} via API`);
    res.json({ ok: true, baileysEnabled });
  });

  app.get("/api/whatsapp/baileys/status", (_req, res) => {
    res.json({ baileysEnabled });
  });

  // ── WhatsApp Cloud API Webhook (Meta official) ────────────────────────────
  // GET: Meta verifies the webhook URL by sending hub.challenge
  app.get("/api/whatsapp/cloud/webhook", (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const challenge = req.query["hub.challenge"] as string;
    const verifyToken = req.query["hub.verify_token"] as string;
    const result = whatsappCloudService.verifyWebhook(mode, challenge, verifyToken);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      console.warn("[Server] WhatsApp Cloud webhook verify failed — wrong token?");
      res.status(403).send("Forbidden");
    }
  });

  // POST: Meta sends incoming messages here
  app.post("/api/whatsapp/cloud/webhook", express.json(), (req, res) => {
    res.sendStatus(200); // Always ACK immediately
    whatsappCloudService.handleWebhook(req.body);
  });

  // Cloud API status
  app.get("/api/whatsapp/cloud/status", (_req, res) => {
    res.json(whatsappCloudService.getStatus());
  });

  // Send test message via Cloud API
  app.post("/api/whatsapp/cloud/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
    const result = await whatsappCloudService.sendMessage(phone, message);
    res.json(result);
  });

  // ── YouTube Intelligence & "Ask Gemini" Endpoints ────────────────────────
  app.post("/api/youtube/analyze", async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: "YouTube URL is required." });
    try {
      const { youtubeService } = await import("../services/youtubeService");
      const analysis = await youtubeService.analyzeVideo(String(url));
      res.json({ success: true, analysis });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  app.post("/api/youtube/ask", async (req, res) => {
    const { url, question } = req.body || {};
    if (!url || !question) return res.status(400).json({ success: false, error: "URL and question required." });
    try {
      const { youtubeService } = await import("../services/youtubeService");
      const qRes = await youtubeService.queryVideoTimestamp(String(url), String(question));
      res.json({ success: true, ...qRes });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // ── YouTube Safe Background Music & Stream Endpoints ──────────────────────
  app.get("/api/youtube/search-music", async (req, res) => {
    const q = String(req.query.q || req.query.query || "").trim();
    if (!q) return res.status(400).json({ success: false, error: "Query is required" });
    try {
      const results = await youtubeMusicService.searchTracks(q, 15);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  app.get("/api/youtube/stream-audio", async (req, res) => {
    const videoId = String(req.query.v || req.query.videoId || "").trim();
    if (!videoId) return res.status(400).json({ success: false, error: "Video ID is required" });
    try {
      const streamUrl = await youtubeMusicService.getAudioStreamUrl(videoId);
      if (streamUrl) {
        return res.redirect(302, streamUrl);
      }
      // If direct stream url is not available, return embed / fallback info
      res.json({
        success: false,
        videoId,
        fallbackEmbed: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`,
        message: "Direct audio stream format not found, using embed fallback.",
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // ── Boss Voice Biometrics & Recognition Endpoints ─────────────────────────
  app.get("/api/voice-biometrics/status", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({
        ok: true,
        profiles,
        count: profiles.length,
        maxProfiles: 2,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_fetch_profiles" });
    }
  });

  app.post("/api/voice-biometrics/enroll", async (req, res) => {
    const { pin, name, audioBase64, spokenPhrase } = req.body || {};
    if (!pin) return res.status(400).json({ error: "pin_required", message: "Password / PIN zaroori hai." });
    try {
      const result = await voiceBiometricsService.enrollVoice(pin, name, audioBase64, spokenPhrase);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "enrollment_failed" });
    }
  });

  app.post("/api/voice-biometrics/delete", async (req, res) => {
    const { pin, profileId } = req.body || {};
    if (!pin) return res.status(400).json({ error: "pin_required", message: "Password / PIN zaroori hai." });
    try {
      const result = await voiceBiometricsService.deleteProfile(pin, profileId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "delete_failed" });
    }
  });

  // ── Telegram Bot Endpoints ────────────────────────────────────────────────
  app.get("/api/telegram/status", (_req, res) => {
    res.json({ ok: true, ...telegramBotService.getStatus() });
  });

  app.get("/api/telegram/users", async (_req, res) => {
    try {
      const users = await telegramBotService.getAllTelegramUsers();
      res.json({ ok: true, users, count: users.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.get("/api/telegram/groups", async (_req, res) => {
    try {
      const groups = await telegramBotService.getAllTelegramGroups();
      res.json({ ok: true, groups, count: groups.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.get("/api/telegram/messages", async (req, res) => {
    try {
      const target = (req.query.target as string) || "all";
      const limit = Number(req.query.limit) || 25;
      const history = await telegramBotService.getChatHistory(target, limit);
      res.json({ ok: true, ...history });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/telegram/users/modify", async (req, res) => {
    const { target, customAlias, customNotes } = req.body || {};
    if (!target) return res.status(400).json({ ok: false, error: "target_required" });
    const result = await telegramBotService.modifyTelegramUser(target, { customAlias, customNotes });
    res.json(result);
  });

  app.get("/api/telegram/busy-message", async (_req, res) => {
    const customBusy = await telegramBotService.getCustomBusyReply();
    res.json({ ok: true, customBusyReply: customBusy });
  });

  app.post("/api/telegram/busy-message", async (req, res) => {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });
    const result = await telegramBotService.setCustomBusyReply(message);
    res.json(result);
  });

  // ── YouTube Audio Stream Proxy Endpoint ──────────────────────────────────
  app.get("/api/youtube/stream-audio", async (req, res) => {
    const videoId = String(req.query.v || "");
    if (!videoId) return res.status(400).json({ error: "videoId_required" });

    try {
      const streamUrl = await youtubeMusicService.getAudioStreamUrl(videoId);
      if (streamUrl) {
        return res.redirect(streamUrl);
      }
      return res.status(404).json({ error: "audio_stream_not_found" });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "stream_fetch_failed" });
    }
  });

  // ── Music Smart Queue Endpoint ──────────────────────────────────────────
  app.get("/api/music/queue", async (req, res) => {
    const { songName, artistName } = req.query || {};
    try {
      const query = String(songName || artistName || "Bollywood Hits");
      const searchRes = await publicApisService.searchMusic(query);
      return res.json({ success: true, queue: searchRes?.tracks || [] });
    } catch (e: any) {
      return res.json({ success: false, queue: [] });
    }
  });

  app.post("/api/telegram/send", async (req, res) => {
    const { chatId, text } = req.body || {};
    if (!chatId || !text) return res.status(400).json({ error: "chatId_and_text_required" });
    const result = await telegramBotService.sendMessage(chatId, text);
    res.json(result);
  });

  // ── App Key Security Endpoints ────────────────────────────────────────────
  app.get("/api/app-key/status", async (_req, res) => {
    try {
      const activeKey = await appSecurityService.getAppKey();
      res.json({ ok: true, isConfigured: !!activeKey });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/app-key/verify", async (req, res) => {
    try {
      const { key } = req.body || {};
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      const verifyRes = await appSecurityService.verifyAppKey(String(key || ""), clientIp, userAgent);

      if (verifyRes.blocked) {
        return res.status(403).json(verifyRes);
      }
      if (verifyRes.rateLimited) {
        return res.status(429).json(verifyRes);
      }

      res.json(verifyRes);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Verification failed" });
    }
  });

  // ── Instagram Direct Bot Webhook & REST Endpoints (Meta Graph API) ─────────
  app.get("/api/instagram/webhook", (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const challenge = req.query["hub.challenge"] as string;
    const verifyToken = req.query["hub.verify_token"] as string;
    const result = instagramBotService.verifyWebhook(mode, challenge, verifyToken);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      console.warn("[Server] Instagram webhook verify failed — check INSTAGRAM_VERIFY_TOKEN in .env");
      res.status(403).send("Forbidden");
    }
  });

  app.post("/api/instagram/webhook", express.json(), (req, res) => {
    res.sendStatus(200); // Instant ACK to Meta
    instagramBotService.handleWebhook(req.body).catch((err) =>
      console.error("[Server] Instagram webhook handler error:", err)
    );
  });

  app.get("/api/instagram/status", (_req, res) => {
    res.json({ ok: true, ...instagramBotService.getStatus() });
  });

  app.post("/api/instagram/send", async (req, res) => {
    const { recipient, message } = req.body || {};
    if (!recipient || !message) return res.status(400).json({ error: "recipient_and_message_required" });
    const result = await instagramBotService.sendMessageToTarget(recipient, message);
    res.json(result);
  });

  // ── Voice Biometrics & Calibration REST Endpoints ─────────────────────────
  app.get("/api/voice-biometrics/status", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.getProfiles();
      res.json({ ok: true, profiles, maxProfiles: 5 });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  app.post("/api/voice-biometrics/enroll", async (req, res) => {
    try {
      const { pin, name, relationWithDivakar, spokenPhrase, audioBase64 } = req.body || {};
      const result = await voiceBiometricsService.enrollVoice(
        String(pin || ""),
        String(name || "Boss (Divakar)"),
        String(relationWithDivakar || "Boss (DK)"),
        audioBase64,
        spokenPhrase
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Enrollment failed" });
    }
  });

  app.post("/api/voice-biometrics/delete", async (req, res) => {
    try {
      const { pin, profileId } = req.body || {};
      const result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Deletion failed" });
    }
  });

  // ── Spoonacular Recipe & Food Intelligence Endpoints ──────────────────────
  app.get("/api/recipes/search", async (req, res) => {
    try {
      const { query, cuisine, diet, type, maxCalories, minProtein, number } = req.query;
      const result = await publicApisService.searchRecipe(
        query ? String(query) : undefined,
        cuisine ? String(cuisine) : undefined,
        diet ? String(diet) : undefined,
        type ? String(type) : undefined,
        maxCalories ? Number(maxCalories) : undefined,
        minProtein ? Number(minProtein) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Recipe search failed" });
    }
  });

  app.get("/api/recipes/by-ingredients", async (req, res) => {
    try {
      const { ingredients, count } = req.query;
      if (!ingredients) return res.status(400).json({ success: false, message: "ingredients query param required" });
      const result = await publicApisService.searchRecipesByIngredients(
        String(ingredients),
        count ? Number(count) : 5
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Ingredients search failed" });
    }
  });

  app.get("/api/recipes/details", async (req, res) => {
    try {
      const { id, title } = req.query;
      const target = id ? (isNaN(Number(id)) ? String(id) : Number(id)) : String(title || "");
      if (!target) return res.status(400).json({ success: false, message: "id or title query param required" });
      const result = await publicApisService.getRecipeDetails(target);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Recipe details failed" });
    }
  });

  app.get("/api/recipes/random", async (req, res) => {
    try {
      const { tags, count } = req.query;
      const result = await publicApisService.getRandomRecipes(
        tags ? String(tags) : undefined,
        count ? Number(count) : 3
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Random recipe failed" });
    }
  });

  app.get("/api/recipes/substitutes", async (req, res) => {
    try {
      const { ingredient } = req.query;
      if (!ingredient) return res.status(400).json({ success: false, message: "ingredient query param required" });
      const result = await publicApisService.getIngredientSubstitutes(String(ingredient));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Substitute lookup failed" });
    }
  });

  app.get("/api/recipes/meal-plan", async (req, res) => {
    try {
      const { calories, timeFrame, diet } = req.query;
      const result = await publicApisService.generateMealPlan(
        calories ? Number(calories) : 2000,
        timeFrame ? (String(timeFrame) as any) : "day",
        diet ? String(diet) : undefined
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Meal plan generation failed" });
    }
  });

  // ── Friday Cyber Security & OSINT Recon Endpoints ─────────────────────────
  app.post("/api/cyber/scan-url", async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "url_required" });
    try {
      const result = await cyberSecurityService.scanUrlSafety(String(url));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "scan_failed" });
    }
  });

  app.post("/api/cyber/breach-check", async (req, res) => {
    const { query } = req.body || {};
    if (!query) return res.status(400).json({ error: "query_required" });
    try {
      const result = await cyberSecurityService.checkDataBreach(String(query));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "breach_check_failed" });
    }
  });

  app.post("/api/cyber/audit-domain", async (req, res) => {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain_required" });
    try {
      const result = await cyberSecurityService.auditWebsiteSecurity(String(domain));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "audit_failed" });
    }
  });

  app.post("/api/cyber/ip-lookup", async (req, res) => {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: "ip_required" });
    try {
      const result = await cyberSecurityService.lookupIpIntelligence(String(ip));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "ip_lookup_failed" });
    }
  });

  app.get("/api/cyber/code-audit", async (_req, res) => {
    try {
      const result = await cyberSecurityService.scanCodeSecurityAudit();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "code_audit_failed" });
    }
  });

  app.post("/api/cyber/threat-model", async (req, res) => {
    try {
      const { component } = req.body || {};
      const result = await cyberSecurityService.runThreatModeling(component ? String(component) : undefined);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "threat_modeling_failed" });
    }
  });

  app.post("/api/cyber/wifi-audit", (req, res) => {
    try {
      const { protocol, hasWps, passwordLength } = req.body || {};
      const result = cyberSecurityService.auditWifiSecurityConfig(
        String(protocol || "WPA2-PSK"),
        Boolean(hasWps),
        Number(passwordLength || 8)
      );
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "wifi_audit_failed" });
    }
  });

  app.get("/api/code-agent/requests", async (_req, res) => {
    try {
      res.json({ requests: await codeAgentService.getRequests() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_code_agent_requests" });
    }
  });

  app.post("/api/code-agent/requests", async (req, res) => {
    try {
      const { instruction } = req.body;
      if (!instruction || !String(instruction).trim()) {
        return res.status(400).json({ error: "instruction_required" });
      }
      const created = await codeAgentService.createRequest(String(instruction));
      res.json({ ok: true, id: created.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_create_request" });
    }
  });

  app.post("/api/code-agent/requests/:id/approve", async (req, res) => {
    try {
      await codeAgentService.approve(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_approve" });
    }
  });

  app.post("/api/code-agent/requests/:id/deny", async (req, res) => {
    try {
      await codeAgentService.deny(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_deny" });
    }
  });

  app.post("/api/code-agent/requests/:id/push-to-main", async (req, res) => {
    try {
      const result = await codeAgentService.pushToMain(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_push_to_main" });
    }
  });

  app.post("/api/code-agent/requests/:id/retry", async (req, res) => {
    try {
      const updated = await codeAgentService.retry(req.params.id);
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_retry" });
    }
  });

  app.post("/api/code-agent/requests/:id/stop", async (req, res) => {
    try {
      await codeAgentService.stop(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_stop" });
    }
  });

  app.get("/api/code-agent/requests/:id/diff", async (req, res) => {
    try {
      const changes = await codeAgentService.generateDiffPreview(req.params.id);
      res.json({ ok: true, changes });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_generate_diff" });
    }
  });

  app.post("/api/code-agent/requests/:id/refine", async (req, res) => {
    const { additionalInstruction } = req.body || {};
    try {
      const updated = await codeAgentService.refinePlan(req.params.id, String(additionalInstruction || ""));
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_refine_plan" });
    }
  });

  app.post("/api/code-agent/rollback", async (req, res) => {
    try {
      const result = await codeAgentService.rollback();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_rollback" });
    }
  });

  app.post("/api/code-agent/clean", async (req, res) => {
    try {
      const result = await codeAgentService.runCodebaseCleanup();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_clean" });
    }
  });

  app.delete("/api/code-agent/history/:id", async (req, res) => {
    try {
      await codeAgentService.deleteTask(req.params.id);
      res.json({ ok: true, message: "Task deleted successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_delete_task" });
    }
  });

  app.post("/api/code-agent/history/batch-delete", async (req, res) => {
    try {
      const { ids } = req.body || {};
      const result = await codeAgentService.batchDeleteTasks(ids);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_batch_delete" });
    }
  });

  app.delete("/api/code-agent/history", async (req, res) => {
    try {
      const { onlyInactive } = req.query;
      const result = await codeAgentService.clearHistory(onlyInactive === "true");
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_clear_history" });
    }
  });

  // ── RailRadar Indian Railways Live Train Intelligence Endpoints ──────────
  app.get("/api/railradar/train/:number/live", async (req, res) => {
    try {
      const data = await railRadarService.getLiveTrainStatus(req.params.number);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "train_status_failed" });
    }
  });

  app.get("/api/railradar/pnr/:pnr", async (req, res) => {
    try {
      const data = await railRadarService.getPnrStatus(req.params.pnr);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "pnr_status_failed" });
    }
  });

  app.get("/api/railradar/station/:code/live", async (req, res) => {
    try {
      const data = await railRadarService.getLiveStationBoard(req.params.code);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "station_board_failed" });
    }
  });

  app.get("/api/railradar/train/:number/fare", async (req, res) => {
    try {
      const { from, to, date } = req.query as { from?: string; to?: string; date?: string };
      const data = await railRadarService.getTrainFares(req.params.number, from, to, date);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "train_fare_failed" });
    }
  });

  app.get("/api/railradar/train/:number/coach", async (req, res) => {
    try {
      const data = await railRadarService.getCoachPosition(req.params.number);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "coach_position_failed" });
    }
  });

  app.get("/api/railradar/train/:number/stops/:station", async (req, res) => {
    try {
      const data = await railRadarService.checkTrainStoppage(req.params.number, req.params.station);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "stoppage_check_failed" });
    }
  });

  app.get("/api/railradar/between", async (req, res) => {
    try {
      const { from, to, date } = req.query as { from?: string; to?: string; date?: string };
      const data = await railRadarService.searchTrainsBetweenStations(String(from || "GAYA"), String(to || "PNBE"), date);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "between_stations_failed" });
    }
  });

  app.get("/api/railradar/train/:number/seats", async (req, res) => {
    try {
      const { from, to, date, class: cls } = req.query as { from?: string; to?: string; date?: string; class?: string };
      const data = await railRadarService.getSeatAvailability(req.params.number, from, to, date, cls);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "seat_availability_failed" });
    }
  });

  // ── WeatherAPI.com Intelligence Endpoints ─────────────────────────────────
  app.get("/api/weather/current", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const data = await weatherService.getCurrentWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "weather_fetch_failed" });
    }
  });

  app.get("/api/weather/forecast", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const days = Number(req.query.days || 3);
      const data = await weatherService.getForecast(q, days);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "forecast_fetch_failed" });
    }
  });

  app.get("/api/weather/astronomy", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const data = await weatherService.getAstronomy(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "astronomy_fetch_failed" });
    }
  });

  app.get("/api/weather/marine", async (req, res) => {
    try {
      const q = String(req.query.q || "Mumbai");
      const data = await weatherService.getMarineWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "marine_fetch_failed" });
    }
  });

  app.get("/api/weather/sports", async (req, res) => {
    try {
      const q = String(req.query.q || "London");
      const data = await weatherService.getSportsWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "sports_fetch_failed" });
    }
  });

  // ── NewsData.io & Live News Intelligence Endpoints ─────────────────────────
  app.get("/api/news/latest", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const engine = (req.query.engine as any) || "auto";
      const data = await newsService.getLatestNews(q, category, country, "en", count, engine);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "news_fetch_failed" });
    }
  });

  app.get("/api/news/newsdata", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const data = await newsService.getNewsDataLatest(q, category, country, "en", count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "newsdata_fetch_failed" });
    }
  });

  app.get("/api/news/newsapi", async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const category = req.query.category ? String(req.query.category) : undefined;
      const country = String(req.query.country || "in");
      const count = Number(req.query.count || 10);
      const data = await newsService.getNewsApiOrgLatest(q, category, country, count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "newsapi_fetch_failed" });
    }
  });

  app.get("/api/news/crypto", async (req, res) => {
    try {
      const coin = String(req.query.coin || "Bitcoin");
      const count = Number(req.query.count || 8);
      const data = await newsService.getCryptoNews(coin, count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "crypto_news_failed" });
    }
  });

  app.get("/api/news/archive", async (req, res) => {
    try {
      const q = String(req.query.q || "India");
      const fromDate = req.query.from ? String(req.query.from) : undefined;
      const toDate = req.query.to ? String(req.query.to) : undefined;
      const data = await newsService.getArchiveNews(q, fromDate, toDate);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "archive_news_failed" });
    }
  });

  app.get("/api/news/sources", async (req, res) => {
    try {
      const country = String(req.query.country || "in");
      const category = req.query.category ? String(req.query.category) : undefined;
      const data = await newsService.getNewsSources(country, category);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "news_sources_failed" });
    }
  });

  app.get("/api/background-tasks", (_req, res) => {
    res.json({
      ok: true,
      activeTasks: backgroundTasksService.getActiveTasks(),
      unnotifiedTasks: backgroundTasksService.getUnnotifiedCompletedTasks(),
      recentTasks: backgroundTasksService.getAllRecentTasks(),
    });
  });

  // ---------------------------------------------------------------------------
  // Web Crawler & AI Intelligence Endpoints (Crawl, Deep Crawl, Query, Summarize, JSON)
  // ---------------------------------------------------------------------------
  app.post("/api/crawler/crawl", async (req, res) => {
    try {
      const { url, respectRobots } = req.body || {};
      if (!url) return res.status(400).json({ error: "URL is required" });
      const result = await webCrawlerService.crawlUrl(String(url), respectRobots !== false);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_crawl" });
    }
  });

  app.post("/api/crawler/deep-crawl", async (req, res) => {
    try {
      const { url, maxPages, maxDepth, respectRobots } = req.body || {};
      if (!url) return res.status(400).json({ error: "Root URL is required" });
      const result = await webCrawlerService.deepCrawl(String(url), {
        maxPages: maxPages ? Number(maxPages) : 5,
        maxDepth: maxDepth ? Number(maxDepth) : 2,
        respectRobotsTxt: respectRobots !== false,
      });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_deep_crawl" });
    }
  });

  app.post("/api/crawler/query", async (req, res) => {
    try {
      const { urlOrMarkdown, query } = req.body || {};
      if (!urlOrMarkdown || !query) return res.status(400).json({ error: "urlOrMarkdown and query are required" });
      const response = await webCrawlerService.queryCrawledContent(String(urlOrMarkdown), String(query));
      res.json({ ok: true, response });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_query_crawler" });
    }
  });

  app.post("/api/crawler/summarize", async (req, res) => {
    try {
      const { urlOrMarkdown } = req.body || {};
      if (!urlOrMarkdown) return res.status(400).json({ error: "urlOrMarkdown is required" });
      const summary = await webCrawlerService.summarizeWebpage(String(urlOrMarkdown));
      res.json({ ok: true, summary });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_summarize" });
    }
  });

  app.post("/api/crawler/extract-json", async (req, res) => {
    try {
      const { urlOrMarkdown, schema } = req.body || {};
      if (!urlOrMarkdown || !schema) return res.status(400).json({ error: "urlOrMarkdown and schema are required" });
      const extracted = await webCrawlerService.extractStructuredJSON(String(urlOrMarkdown), String(schema));
      res.json({ ok: true, data: extracted });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_extract_json" });
    }
  });


  // ---------------------------------------------------------------------------
  // 🔍 OSINT Tool #1: Sherlock — Username Intelligence (300+ Platforms)
  // Source: https://github.com/sherlock-project/sherlock
  // Install: pip install sherlock-project
  // ---------------------------------------------------------------------------

  /** GET /api/osint/sherlock/status — Check if Sherlock is installed */
  app.get("/api/osint/sherlock/status", async (_req, res) => {
    try {
      const status = await sherlockService.getStatus();
      res.json({ ok: true, ...status });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_status_failed" });
    }
  });

  /** POST /api/osint/sherlock/search — Search username across 300+ platforms
   *  Body: { username: string, timeout?: number, nsfw?: boolean, onlyFound?: boolean }
   */
  app.post("/api/osint/sherlock/search", async (req, res) => {
    try {
      const { username, timeout, nsfw, onlyFound } = req.body || {};
      if (!username || typeof username !== "string") {
        return res.status(400).json({ ok: false, error: "username is required" });
      }
      const result = await sherlockService.searchUsername(username.trim(), {
        timeout: timeout ? Number(timeout) : 30,
      });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_search_failed" });
    }
  });

  /** POST /api/osint/sherlock/search-multi — Search multiple usernames at once
   *  Body: { usernames: string[], timeout?: number, nsfw?: boolean }
   */
  app.post("/api/osint/sherlock/search-multi", async (req, res) => {
    try {
      const { usernames, timeout } = req.body || {};
      if (!Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ ok: false, error: "usernames array is required" });
      }
      if (usernames.length > 5) {
        return res.status(400).json({ ok: false, error: "Max 5 usernames per request" });
      }
      const results = await sherlockService.searchMultipleUsernames(
        usernames.map((u: any) => String(u).trim()),
        { timeout: timeout ? Number(timeout) : 30 }
      );
      res.json({ ok: true, results });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_multi_search_failed" });
    }
  });

  /** GET /api/osint/sherlock/sites — List all supported social media platforms */
  app.get("/api/osint/sherlock/sites", async (_req, res) => {
    try {
      const sites = await sherlockService.getSupportedSites();
      res.json({ ok: true, totalSites: sites.length, sites });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_sites_failed" });
    }
  });

  // ---------------------------------------------------------------------------
  // 🌱 OSINT Tool #2: TheHarvester — Email, Subdomain & Host Intelligence
  // Source: https://github.com/laramies/theHarvester
  // Sources: crt.sh, HackerTarget, AlienVault OTX, Shodan, DNS (Pure JS)
  // Optional: VIRUSTOTAL_API_KEY, HUNTER_API_KEY in .env
  // ---------------------------------------------------------------------------

  /** GET /api/osint/harvester/status — Service status and sources */
  app.get("/api/osint/harvester/status", (_req, res) => {
    res.json({ ok: true, ...theHarvesterService.getStatus() });
  });

  /** POST /api/osint/harvester/harvest — Full OSINT harvest for a domain
   *  Body: { domain: string, resolveIps?: boolean, shodanScan?: boolean }
   */
  app.post("/api/osint/harvester/harvest", async (req, res) => {
    try {
      const { domain, resolveIps, shodanScan, virusTotalKey, hunterKey } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const report = await theHarvesterService.harvest(domain.trim(), {
        resolveIps: resolveIps !== false,
        shodanScan: shodanScan !== false,
        virusTotalKey,
        hunterKey,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "harvester_failed" });
    }
  });

  /** POST /api/osint/harvester/subdomains — Quick subdomain enumeration only
   *  Body: { domain: string }
   */
  app.post("/api/osint/harvester/subdomains", async (req, res) => {
    try {
      const { domain } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const result = await theHarvesterService.findSubdomains(domain.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "subdomain_scan_failed" });
    }
  });

  /** POST /api/osint/harvester/dns — DNS records for a domain
   *  Body: { domain: string }
   */
  app.post("/api/osint/harvester/dns", async (req, res) => {
    try {
      const { domain } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const result = await theHarvesterService.getDnsRecords(domain.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "dns_lookup_failed" });
    }
  });

  /** POST /api/osint/harvester/ip-scan — Shodan InternetDB scan for an IP
   *  Body: { ip: string }
   */
  app.post("/api/osint/harvester/ip-scan", async (req, res) => {
    try {
      const { ip } = req.body || {};
      if (!ip || typeof ip !== "string") {
        return res.status(400).json({ ok: false, error: "ip is required" });
      }
      const result = await theHarvesterService.scanIp(ip.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "ip_scan_failed" });
    }
  });


  // ---------------------------------------------------------------------------
  // 💉 OSINT Tool #3: SQLMap — SQL Injection Scanner
  // Source: https://github.com/sqlmapproject/sqlmap
  // Techniques: Error-Based, Boolean-Blind, Time-Blind, Union-Based (Pure JS)
  // ⚠️  Use only on systems you own or have permission to test!
  // ---------------------------------------------------------------------------

  /** GET /api/osint/sqlmap/status — Service status and payload count */
  app.get("/api/osint/sqlmap/status", (_req, res) => {
    res.json({ ok: true, ...sqlMapService.getStatus() });
  });

  /** POST /api/osint/sqlmap/scan — Full SQL injection scan
   *  Body: {
   *    url: string,
   *    method?: "GET"|"POST",
   *    postData?: string,        // e.g. "user=admin&pass=test"
   *    params?: string[],        // specific params to test
   *    cookies?: string,
   *    techniques?: string[],    // ["error","boolean","time","union"]
   *    timeThreshold?: number    // ms delay for time-based (default 2800)
   *  }
   */
  app.post("/api/osint/sqlmap/scan", async (req, res) => {
    try {
      const { url, method, postData, params, cookies, techniques, timeThreshold } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await sqlMapService.scan(url.trim(), {
        method: method || "GET",
        postData,
        params: Array.isArray(params) ? params : undefined,
        cookies,
        techniques: Array.isArray(techniques) ? techniques : undefined,
        timeThreshold: timeThreshold ? Number(timeThreshold) : undefined,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sqlmap_scan_failed" });
    }
  });

  /** POST /api/osint/sqlmap/quick-test — Test single param with one payload
   *  Body: { url: string, param: string, payload: string }
   */
  app.post("/api/osint/sqlmap/quick-test", async (req, res) => {
    try {
      const { url, param, payload } = req.body || {};
      if (!url || !param || !payload) {
        return res.status(400).json({ ok: false, error: "url, param, and payload are required" });
      }
      const result = await sqlMapService.quickTest(String(url), String(param), String(payload));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "quick_test_failed" });
    }
  });

  /** POST /api/osint/sqlmap/analyze-url — Analyze URL for injectable parameters
   *  Body: { url: string }
   */
  app.post("/api/osint/sqlmap/analyze-url", async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const analysis = sqlMapService.analyzeUrl(url.trim());
      res.json({ ok: true, ...analysis });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "analyze_url_failed" });
    }
  });

  /** GET /api/osint/sqlmap/payloads — Get all SQL injection payloads (educational) */
  app.get("/api/osint/sqlmap/payloads", (_req, res) => {
    try {
      const payloads = sqlMapService.getPayloads();
      res.json({ ok: true, ...payloads });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "payloads_fetch_failed" });
    }
  });


  // ---------------------------------------------------------------------------
  // 🕵️ OSINT Tool #4: Nikto — Web Server Vulnerability Scanner
  // Source: https://github.com/sullo/nikto
  // Checks: Headers, Dangerous Paths, HTTP Methods, CMS, Cookies (Pure JS)
  // ⚠️  Use only on systems you own or have permission to test!
  // ---------------------------------------------------------------------------

  /** GET /api/osint/nikto/status — Service info and total checks */
  app.get("/api/osint/nikto/status", (_req, res) => {
    res.json({ ok: true, ...niktoService.getStatus() });
  });

  /** POST /api/osint/nikto/scan — Full web server vulnerability scan
   *  Body: {
   *    url: string,
   *    checkPaths?: boolean,     // scan dangerous paths (default: true)
   *    checkHeaders?: boolean,   // check security headers (default: true)
   *    checkMethods?: boolean,   // check HTTP methods (default: true)
   *    maxPaths?: number,        // limit path checks for speed
   *    concurrency?: number      // parallel requests (default: 15)
   *  }
   */
  app.post("/api/osint/nikto/scan", async (req, res) => {
    try {
      const { url, checkPaths, checkHeaders, checkMethods, maxPaths, concurrency } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await niktoService.scan(url.trim(), {
        checkPaths: checkPaths !== false,
        checkHeaders: checkHeaders !== false,
        checkMethods: checkMethods !== false,
        maxPaths: maxPaths ? Number(maxPaths) : undefined,
        concurrency: concurrency ? Number(concurrency) : 15,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "nikto_scan_failed" });
    }
  });

  /** POST /api/osint/nikto/headers-only — Check only security headers (fast)
   *  Body: { url: string }
   */
  app.post("/api/osint/nikto/headers-only", async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await niktoService.scan(url.trim(), {
        checkPaths: false,
        checkHeaders: true,
        checkMethods: true,
        maxPaths: 0,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "header_check_failed" });
    }
  });


  // ---------------------------------------------------------------------------
  // 🎭 OSINT Tool #5 & #6: Social Engineer Toolkit (SET)
  // Source: https://github.com/trustedsec/social-engineer-toolkit
  // Features: Phishing templates, Pretexting, Smishing, Vishing, URL analyzer
  // ⚠️  FOR AUTHORIZED PENTEST & SECURITY AWARENESS TRAINING ONLY!
  // ---------------------------------------------------------------------------

  /** GET /api/osint/set/status */
  app.get("/api/osint/set/status", (_req, res) => {
    res.json({ ok: true, ...socialEngineerToolkitService.getStatus() });
  });

  /** GET /api/osint/set/phishing-templates — Get all phishing email templates
   *  Query: ?category=corporate|banking|tech|hr|urgent|delivery|healthcare
   */
  app.get("/api/osint/set/phishing-templates", (req, res) => {
    try {
      const category = req.query.category as any;
      const templates = socialEngineerToolkitService.getPhishingTemplates(category);
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/set/generate-phishing — Generate customized phishing email
   *  Body: { templateId: string, targetName?: string, phishingLink?: string, companyName?: string }
   */
  app.post("/api/osint/set/generate-phishing", (req, res) => {
    try {
      const { templateId, targetName, targetEmail, phishingLink, companyName, senderName } = req.body || {};
      if (!templateId) return res.status(400).json({ ok: false, error: "templateId is required" });
      const result = socialEngineerToolkitService.generatePhishingEmail(String(templateId), {
        targetName, targetEmail, phishingLink, companyName, senderName,
      });
      if (!result.template) return res.status(404).json({ ok: false, error: "Template not found" });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/set/pretexting — Get pretexting scripts
   *  Query: ?scenario=it-helpdesk
   */
  app.get("/api/osint/set/pretexting", (req, res) => {
    try {
      const scenario = req.query.scenario as string | undefined;
      const scripts = socialEngineerToolkitService.getPretextingScripts(scenario);
      res.json({ ok: true, count: scripts.length, scripts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/set/smishing — Get SMS phishing templates
   *  Query: ?category=Banking|Delivery|Government
   */
  app.get("/api/osint/set/smishing", (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = socialEngineerToolkitService.getSmishingTemplates(category);
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/set/vishing — Get voice phishing scripts */
  app.get("/api/osint/set/vishing", (_req, res) => {
    try {
      const scripts = socialEngineerToolkitService.getVishingScripts();
      res.json({ ok: true, count: scripts.length, scripts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/set/analyze-url — Phishing URL analyzer
   *  Body: { url: string }
   */
  app.post("/api/osint/set/analyze-url", (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ ok: false, error: "url is required" });
      const analysis = socialEngineerToolkitService.analyzePhishingUrl(String(url));
      res.json({ ok: true, analysis });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/set/build-campaign — Build a social engineering campaign
   *  Body: { name: string, type: "phishing"|"smishing"|"vishing", targetDescription: string }
   */
  app.post("/api/osint/set/build-campaign", (req, res) => {
    try {
      const { name, type, targetDescription, duration } = req.body || {};
      if (!name || !type || !targetDescription) {
        return res.status(400).json({ ok: false, error: "name, type, and targetDescription are required" });
      }
      const campaign = socialEngineerToolkitService.buildCampaign({ name, type, targetDescription, duration });
      res.json({ ok: true, campaign });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/set/awareness-quiz — Social engineering awareness quiz */
  app.get("/api/osint/set/awareness-quiz", (_req, res) => {
    try {
      const quiz = socialEngineerToolkitService.getAwarenessQuiz();
      res.json({ ok: true, count: quiz.length, quiz });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/set/harvester-templates — Fake login page examples (educational) */
  app.get("/api/osint/set/harvester-templates", (_req, res) => {
    try {
      const templates = socialEngineerToolkitService.getHarvesterTemplates();
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });


  // ---------------------------------------------------------------------------
  // 🔑 OSINT Tool #7: John the Ripper — Password Hash Cracker
  // Source: https://github.com/openwall/john
  // Features: Hash ID, Wordlist crack, Online lookup, Strength analyzer (Pure JS)
  // ⚠️  USE ONLY FOR AUTHORIZED SECURITY TESTING!
  // ---------------------------------------------------------------------------

  /** GET /api/osint/john/status */
  app.get("/api/osint/john/status", (_req, res) => {
    res.json({ ok: true, ...johnTheRipperService.getStatus() });
  });

  /** POST /api/osint/john/identify — Identify hash type
   *  Body: { hash: string }
   */
  app.post("/api/osint/john/identify", (req, res) => {
    try {
      const { hash } = req.body || {};
      if (!hash) return res.status(400).json({ ok: false, error: "hash is required" });
      const result = johnTheRipperService.identifyHash(String(hash));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/crack — Crack a single hash
   *  Body: { hash: string, hashType?: string, useOnlineLookup?: boolean, customWordlist?: string[] }
   */
  app.post("/api/osint/john/crack", async (req, res) => {
    try {
      const { hash, hashType, useOnlineLookup, customWordlist } = req.body || {};
      if (!hash) return res.status(400).json({ ok: false, error: "hash is required" });
      const result = await johnTheRipperService.crackHash(String(hash), {
        hashType,
        useOnlineLookup: useOnlineLookup !== false,
        customWordlist: Array.isArray(customWordlist) ? customWordlist : undefined,
      });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/crack-multiple — Crack multiple hashes
   *  Body: { hashes: string[], hashType?: string, useOnlineLookup?: boolean }
   */
  app.post("/api/osint/john/crack-multiple", async (req, res) => {
    try {
      const { hashes, hashType, useOnlineLookup } = req.body || {};
      if (!Array.isArray(hashes) || hashes.length === 0) {
        return res.status(400).json({ ok: false, error: "hashes array is required" });
      }
      if (hashes.length > 20) {
        return res.status(400).json({ ok: false, error: "Max 20 hashes per request" });
      }
      const results = await johnTheRipperService.crackMultiple(
        hashes.map(String),
        { hashType, useOnlineLookup: useOnlineLookup !== false }
      );
      res.json({ ok: true, results, crackedCount: results.filter(r => r.cracked).length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/analyze-password — Password strength analysis + hashes
   *  Body: { password: string }
   */
  app.post("/api/osint/john/analyze-password", (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: "password is required" });
      const result = johnTheRipperService.analyzePassword(String(password));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/generate-hashes — Generate all hash types for plaintext
   *  Body: { plaintext: string }
   */
  app.post("/api/osint/john/generate-hashes", (req, res) => {
    try {
      const { plaintext } = req.body || {};
      if (!plaintext) return res.status(400).json({ ok: false, error: "plaintext is required" });
      const hashes = johnTheRipperService.generateHashes(String(plaintext));
      res.json({ ok: true, ...hashes });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/brute-force-estimate — Estimate brute force time
   *  Body: { passwordLength: number, charset?: "numeric"|"alpha"|"alphanumeric"|"full" }
   */
  app.post("/api/osint/john/brute-force-estimate", (req, res) => {
    try {
      const { passwordLength, charset } = req.body || {};
      if (!passwordLength) return res.status(400).json({ ok: false, error: "passwordLength is required" });
      if (Number(passwordLength) > 20) return res.status(400).json({ ok: false, error: "Max length: 20" });
      const estimate = johnTheRipperService.estimateBruteForce({
        passwordLength: Number(passwordLength),
        charset: charset || "full",
      });
      res.json({ ok: true, ...estimate });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/check-common — Check if password is in common list
   *  Body: { password: string }
   */
  app.post("/api/osint/john/check-common", (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: "password is required" });
      const result = johnTheRipperService.checkCommonPassword(String(password));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** POST /api/osint/john/check-policy — Check password against security policy
   *  Body: { password: string, policy?: { minLength, requireUppercase, ... } }
   */
  app.post("/api/osint/john/check-policy", (req, res) => {
    try {
      const { password, policy } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: "password is required" });
      const result = johnTheRipperService.checkPasswordPolicy(String(password), policy);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  /** GET /api/osint/john/wordlist-stats — Wordlist statistics */
  app.get("/api/osint/john/wordlist-stats", (_req, res) => {
    res.json({ ok: true, ...johnTheRipperService.getWordlistStats() });
  });


  // ---------------------------------------------------------------------------
  // 🎙️ Voice Control — Friday apni awaaz badal sake
  // Friday ko bolo: "male voice lagao" / "female voice lagao" / "Charon lagao"
  // ---------------------------------------------------------------------------

  const VOICE_CATEGORIES_API = {
    female: [
      { name: "Aoede", style: "Breezy" }, { name: "Kore", style: "Firm" },
      { name: "Zephyr", style: "Bright" }, { name: "Autonoe", style: "Bright" },
      { name: "Erinome", style: "Clear" }, { name: "Laomedeia", style: "Upbeat" },
      { name: "Schedar", style: "Even" }, { name: "Achernar", style: "Soft" },
      { name: "Leda", style: "Youthful" }, { name: "Callirrhoe", style: "Easy-going" },
      { name: "Despina", style: "Smooth" }, { name: "Vindemiatrix", style: "Gentle" },
      { name: "Sulafat", style: "Warm" }, { name: "Pulcherrima", style: "Forward" },
      { name: "Sadachbia", style: "Lively" },
    ],
    male: [
      { name: "Puck", style: "Upbeat" }, { name: "Charon", style: "Informative" },
      { name: "Fenrir", style: "Excitable" }, { name: "Orus", style: "Firm" },
      { name: "Umbriel", style: "Easy-going" }, { name: "Achird", style: "Friendly" },
      { name: "Enceladus", style: "Breathy" }, { name: "Algieba", style: "Smooth" },
      { name: "Algenib", style: "Gravelly" }, { name: "Gacrux", style: "Mature" },
      { name: "Zubenelgenubi", style: "Casual" }, { name: "Sadaltager", style: "Knowledgeable" },
      { name: "Iapetus", style: "Clear" }, { name: "Rasalgethi", style: "Informative" },
      { name: "Alnilam", style: "Firm" },
    ],
  };

  /** GET /api/voices/saved-preference — Firebase se saved voice load karo */
  app.get("/api/voices/saved-preference", async (_req, res) => {
    try {
      const prefs = await voicePersonaService.getSavedPreferences();
      res.json({ ok: true, ...prefs });
    } catch (e: any) {
      res.json({ ok: false, voiceName: "Aoede" });
    }
  });

  /** GET /api/voices — Sabhi voices list with categories */
  app.get("/api/voices", (_req, res) => {
    res.json({
      ok: true,
      total: 30,
      categories: VOICE_CATEGORIES_API,
      all: [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male],
    });
  });

  /** POST /api/voices/suggest — Friday ke liye voice suggest karo
   *  Body: { gender?: "male"|"female", style?: string, voiceName?: string }
   *  Friday isko call karta hai jab user bole "male voice lagao"
   */
  app.post("/api/voices/suggest", (req, res) => {
    try {
      const { gender, style, voiceName } = req.body || {};

      // Specific voice name diya
      if (voiceName) {
        const allVoices = [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male];
        const found = allVoices.find(v => v.name.toLowerCase() === String(voiceName).toLowerCase());
        if (found) {
          const gender = VOICE_CATEGORIES_API.female.find(v => v.name === found.name) ? "female" : "male";
          return res.json({ ok: true, suggested: found.name, style: found.style, gender, message: `${found.name} voice (${found.style}) suggest ki gayi hai` });
        }
        return res.status(404).json({ ok: false, error: "Voice not found" });
      }

      // Gender filter
      const pool = gender === "male"
        ? VOICE_CATEGORIES_API.male
        : gender === "female"
        ? VOICE_CATEGORIES_API.female
        : [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male];

      // Style filter (optional)
      const stylePool = style
        ? pool.filter(v => v.style.toLowerCase().includes(String(style).toLowerCase()))
        : pool;

      const pick = stylePool.length > 0
        ? stylePool[Math.floor(Math.random() * stylePool.length)]
        : pool[Math.floor(Math.random() * pool.length)];

      const pickedGender = VOICE_CATEGORIES_API.female.find(v => v.name === pick.name) ? "female" : "male";

      res.json({
        ok: true,
        suggested: pick.name,
        style: pick.style,
        gender: pickedGender,
        message: `${pick.name} voice suggest ki — ${pickedGender === "female" ? "♀ Female" : "♂ Male"}, style: ${pick.style}`,
        instruction: `Frontend pe selectedVoice ko "${pick.name}" set karo aur session reinitialize karo`,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });


  return router;
}
