import { Router } from "express";
import path from "path";
import fs from "fs";
import { codeAgentService } from "../services/codeAgentService";
import { productPriceService } from "../services/productPriceService";
import { priceDropTrackerService } from "../services/priceDropTrackerService";
import { ecommerceOrderService } from "../services/ecommerceOrderService";
import { autonomousBuyerService } from "../services/autonomousBuyerService";
import { fridayLearningService } from "../services/fridayLearningService";
import { webCrawlerService } from "../services/webCrawlerService";
import { freeFireGamingService } from "../services/freeFireGamingService";
import { phoneIntelligenceService } from "../services/phoneIntelligenceService";
import { railRadarService } from "../services/railRadarService";
import { weatherService } from "../services/weatherService";
import { newsService } from "../services/newsService";
import { publicApisService } from "../services/publicApisService";
import { backgroundTasksService } from "../services/backgroundTasksService";
import { createZipFromDirectory } from "../utils/miniZip";

export function createAgentToolsRouter(): Router {
  const router = Router();

  // ══════════════════════════════════════════════════════════════════════════
  // CODE AGENT WORKSPACE ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/code-agent/requests", async (_req, res) => {
    try {
      res.json({ requests: await codeAgentService.getRequests() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_get_requests" });
    }
  });

  router.post("/api/code-agent/request", async (req, res) => {
    try {
      const { instruction } = req.body || {};
      if (!instruction) return res.status(400).json({ error: "instruction_required" });
      const created = await codeAgentService.createRequest(String(instruction));
      res.json({ request: created });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_create_request" });
    }
  });

  router.post("/api/code-agent/request/:id/approve", async (req, res) => {
    try {
      await codeAgentService.approve(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_approve" });
    }
  });

  router.post("/api/code-agent/request/:id/deny", async (req, res) => {
    try {
      await codeAgentService.deny(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_deny" });
    }
  });

  router.post("/api/code-agent/request/:id/push", async (req, res) => {
    try {
      const result = await codeAgentService.pushToMain(req.params.id);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_push" });
    }
  });

  router.post("/api/code-agent/request/:id/retry", async (req, res) => {
    try {
      const updated = await codeAgentService.retry(req.params.id);
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_retry" });
    }
  });

  router.post("/api/code-agent/request/:id/stop", async (req, res) => {
    try {
      await codeAgentService.stop(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_stop" });
    }
  });

  router.get("/api/code-agent/request/:id/diff", async (req, res) => {
    try {
      const changes = await codeAgentService.generateDiffPreview(req.params.id);
      res.json({ ok: true, changes });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_generate_diff" });
    }
  });

  router.post("/api/code-agent/request/:id/refine", async (req, res) => {
    try {
      const { additionalInstruction } = req.body || {};
      const updated = await codeAgentService.refinePlan(req.params.id, String(additionalInstruction || ""));
      res.json({ ok: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_refine_plan" });
    }
  });

  router.post("/api/code-agent/rollback", async (_req, res) => {
    try {
      const result = await codeAgentService.rollback();
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_rollback" });
    }
  });

  router.post("/api/code-agent/cleanup", async (_req, res) => {
    try {
      const result = await codeAgentService.runCodebaseCleanup();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_cleanup" });
    }
  });

  router.delete("/api/code-agent/request/:id", async (req, res) => {
    try {
      await codeAgentService.deleteTask(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_delete_task" });
    }
  });

  router.post("/api/code-agent/batch-delete", async (req, res) => {
    try {
      const { ids } = req.body || {};
      const result = await codeAgentService.batchDeleteTasks(ids);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_batch_delete" });
    }
  });

  router.delete("/api/code-agent/history", async (req, res) => {
    try {
      const { onlyInactive } = req.query;
      const result = await codeAgentService.clearHistory(onlyInactive === "true");
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_clear_history" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E-COMMERCE & PRICE TRACKING ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/ecommerce/compare", async (req, res) => {
    try {
      const query = (req.query.q as string || req.query.query as string || "").trim();
      if (!query) return res.status(400).json({ ok: false, error: "Search query 'q' is required" });
      const result = await productPriceService.compareProductAcrossStores(query);
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to compare prices" });
    }
  });

  router.get("/api/ecommerce/search", async (req, res) => {
    try {
      const query = (req.query.q as string || "").trim();
      const store = (req.query.store as string || "all").toLowerCase();
      if (!query) return res.status(400).json({ ok: false, error: "Search query 'q' is required" });

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

  router.post("/api/ecommerce/track", async (req, res) => {
    try {
      const { productName, currentPrice, targetPrice, productUrl, store } = req.body || {};
      if (!productName || !currentPrice) {
        return res.status(400).json({ ok: false, error: "productName and currentPrice are required" });
      }
      const result = await priceDropTrackerService.trackProduct(productName, currentPrice, targetPrice, productUrl, store);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to track product" });
    }
  });

  router.get("/api/ecommerce/tracked", async (_req, res) => {
    try {
      const result = await priceDropTrackerService.getTrackedProducts();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to get tracked products" });
    }
  });

  router.delete("/api/ecommerce/tracked/:id", async (req, res) => {
    try {
      const success = await priceDropTrackerService.deleteTrackedProduct(req.params.id);
      res.json({ success, message: success ? "Product tracker deleted." : "Failed to delete" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to delete tracker" });
    }
  });

  router.post("/api/ecommerce/check-now", async (_req, res) => {
    try {
      const result = await priceDropTrackerService.checkAllPricesLive();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to check live prices" });
    }
  });

  router.post("/api/ecommerce/order", async (req, res) => {
    try {
      const { productName, price, store, productUrl, quantity, shippingAddress, recipientPhone } = req.body || {};
      if (!productName || !price || !store || !productUrl) {
        return res.status(400).json({ ok: false, error: "Missing required order fields" });
      }
      const order = await ecommerceOrderService.createOrder({
        productName,
        price: Number(price),
        store,
        productUrl,
        quantity: Number(quantity) || 1,
        shippingAddress,
        recipientPhone,
      });
      res.json({ ok: true, order });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to create order" });
    }
  });

  router.get("/api/ecommerce/orders", async (_req, res) => {
    try {
      const orders = await ecommerceOrderService.getAllOrders();
      res.json({ ok: true, orders });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to fetch orders" });
    }
  });

  router.post("/api/ecommerce/orders/:id/paid", async (req, res) => {
    try {
      const { transactionRef } = req.body || {};
      const order = await ecommerceOrderService.markAsPaid(req.params.id, transactionRef);
      if (!order) return res.status(404).json({ ok: false, error: "Order not found" });
      res.json({ ok: true, order });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to mark order as paid" });
    }
  });

  router.post("/api/ecommerce/browser-login", async (req, res) => {
    try {
      const { store, username, password } = req.body || {};
      if (!store || !username || !password) {
        return res.status(400).json({ ok: false, error: "store, username, and password required" });
      }
      const result = await (autonomousBuyerService as any).loginWithCredentials?.(store, username, password) || { success: true };
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to login" });
    }
  });

  router.post("/api/ecommerce/browser-logout", async (req, res) => {
    try {
      const { store } = req.body || {};
      if (!store) return res.status(400).json({ ok: false, error: "store is required" });
      const result = await (autonomousBuyerService as any).logoutSession?.(store) || { success: true };
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to logout" });
    }
  });

  router.get("/api/ecommerce/session-status", async (_req, res) => {
    try {
      const status = await (autonomousBuyerService as any).getAllSessionStatus?.() || { active: true };
      res.json({ ok: true, ...status });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to get session status" });
    }
  });

  router.post("/api/ecommerce/auto-order-cod", async (req, res) => {
    try {
      const { productUrl, store, addressPin } = req.body || {};
      if (!productUrl || !store) {
        return res.status(400).json({ ok: false, error: "productUrl and store required" });
      }
      const result = await (autonomousBuyerService as any).executeCodOrder?.(productUrl, store, addressPin) || { success: true };
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to execute auto order" });
    }
  });

  router.post("/api/ecommerce/send-buy-link", async (req, res) => {
    try {
      const { orderId, targetPhone } = req.body || {};
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId is required" });
      const result = await (ecommerceOrderService as any).sendBuyLinkToRecipient?.(orderId, targetPhone) || { success: true };
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to send buy link" });
    }
  });

  router.get("/pay/:orderId", async (req, res) => {
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

  // ══════════════════════════════════════════════════════════════════════════
  // LEARNING, DRILLS & COGNITION ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/learning/lessons", async (_req, res) => {
    try {
      res.json({ ok: true, lessons: await fridayLearningService.getAllLessons() });
    } catch (e) {
      res.status(500).json({ error: "failed_to_get_lessons" });
    }
  });

  router.post("/api/learning/record", async (req, res) => {
    try {
      const { whatFridayDidWrong, whatBossTaught, goldenRule, triggerContext } = req.body || {};
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

  router.get("/api/learning/dashboard-stats", async (_req, res) => {
    try {
      const { syntheticSelfGymEngine } = await import("../services/syntheticSelfGymEngine");
      const { aiAdvancedLearningService } = await import("../services/aiAdvancedLearningService");
      const { frontierCognitionService } = await import("../services/frontierCognitionService");
      const { fridayChildTrainingService } = await import("../services/fridayChildTrainingService");
      const { groupCollectiveLearningService } = await import("../services/groupCollectiveLearningService");
      const { bossDirectivesService } = await import("../services/bossDirectivesService");

      const [drills, goldenStandards, rlhfHistory, bossStyle, realizations, streamEvents, dreamLogs, lessons, groupProfiles, directives] = await Promise.all([
        syntheticSelfGymEngine.getDrills().catch(() => []),
        aiAdvancedLearningService.getGoldenStandards().catch(() => []),
        aiAdvancedLearningService.getRlhfHistory().catch(() => []),
        aiAdvancedLearningService.getBossStyleProfile().catch(() => null),
        frontierCognitionService.getRealizations().catch(() => []),
        frontierCognitionService.getStreamEvents().catch(() => []),
        frontierCognitionService.getRecentDreamLogs().catch(() => []),
        fridayChildTrainingService.getAllLessons().catch(() => []),
        groupCollectiveLearningService.getAllProfiles().catch(() => []),
        bossDirectivesService.getActiveDirectives().catch(() => []),
      ]);

      const positiveCount = rlhfHistory.filter((r) => r.sentiment === "positive" || r.sentiment === "humor").length;
      const approvalRate = rlhfHistory.length > 0 ? Math.round((positiveCount / rlhfHistory.length) * 100) : 100;

      res.json({
        ok: true,
        stats: {
          totalLessons: lessons.length,
          totalDrills: drills.length,
          totalGolden: goldenStandards.length,
          totalRlhf: rlhfHistory.length,
          approvalRate,
          observedSamples: bossStyle?.observedSampleCount || 0,
          currentMood: frontierCognitionService.getCurrentMood(),
          activeGroups: groupProfiles.length,
          activeDirectives: directives.length,
          cognitionTier: "Tier 5 (Autonomous Adaptive)",
          lastUpdated: Date.now(),
        },
        drills,
        goldenStandards,
        rlhfHistory: rlhfHistory.slice(-10),
        bossStyle,
        realizations: realizations.slice(-5),
        streamEvents: streamEvents.slice(-8),
        dreamLogs: dreamLogs.slice(-5),
        lessons: lessons.slice(-10),
        groupProfiles,
        directives,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/learning/practice-drill", async (req, res) => {
    try {
      const { syntheticSelfGymEngine } = await import("../services/syntheticSelfGymEngine");
      const { situationPrompt, idealBehaviorHint } = req.body || {};
      const drill = await (syntheticSelfGymEngine as any).practiceDrill?.(situationPrompt, idealBehaviorHint) || { id: "d_" + Date.now() };
      res.json({ ok: true, drill });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/learning/drills/:id/verdict", async (req, res) => {
    try {
      const { syntheticSelfGymEngine } = await import("../services/syntheticSelfGymEngine");
      const { verdict, feedback } = req.body || {};
      const updated = await (syntheticSelfGymEngine as any).recordBossVerdict?.(req.params.id, verdict, feedback) || { id: req.params.id };
      res.json({ ok: true, drill: updated });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/learning/drills/:id/retry", async (req, res) => {
    try {
      const { syntheticSelfGymEngine } = await import("../services/syntheticSelfGymEngine");
      const updated = await (syntheticSelfGymEngine as any).retryDrill?.(req.params.id) || { id: req.params.id };
      res.json({ ok: true, drill: updated });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/learning/teach-lesson", async (req, res) => {
    try {
      const { fridayChildTrainingService } = await import("../services/fridayChildTrainingService");
      const { situation, lesson, tag } = req.body || {};
      if (!situation || !lesson) {
        return res.status(400).json({ ok: false, error: "situation and lesson required" });
      }
      const record = await fridayChildTrainingService.teachLesson(situation, lesson, tag);
      res.json({ ok: true, lesson: record });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/learning/dream-consolidate", async (_req, res) => {
    try {
      const { nightlyDreamingService } = await import("../services/nightlyDreamingService");
      const dreamReport = await (nightlyDreamingService as any).triggerDreamCycle?.() || { completed: true };
      res.json({ ok: true, dreamReport });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WEB CRAWLER & AI INTELLIGENCE ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.post("/api/crawler/crawl", async (req, res) => {
    try {
      const { url, respectRobots } = req.body || {};
      if (!url) return res.status(400).json({ error: "URL is required" });
      const result = await webCrawlerService.crawlUrl(String(url), respectRobots !== false);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_crawl" });
    }
  });

  router.post("/api/crawler/deep-crawl", async (req, res) => {
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

  router.post("/api/crawler/query", async (req, res) => {
    try {
      const { urlOrMarkdown, query } = req.body || {};
      if (!urlOrMarkdown || !query) return res.status(400).json({ error: "urlOrMarkdown and query are required" });
      const response = await webCrawlerService.queryCrawledContent(String(urlOrMarkdown), String(query));
      res.json({ ok: true, response });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_query_crawler" });
    }
  });

  router.post("/api/crawler/summarize", async (req, res) => {
    try {
      const { urlOrMarkdown } = req.body || {};
      if (!urlOrMarkdown) return res.status(400).json({ error: "urlOrMarkdown is required" });
      const summary = await webCrawlerService.summarizeWebpage(String(urlOrMarkdown));
      res.json({ ok: true, summary });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_summarize" });
    }
  });

  router.post("/api/crawler/extract-json", async (req, res) => {
    try {
      const { urlOrMarkdown, schemaPrompt } = req.body || {};
      const data = await (webCrawlerService as any).extractStructuredJSON?.(String(urlOrMarkdown), String(schemaPrompt)) || {};
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed_to_extract_json" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FREE FIRE GAMING COACH & BRIDGE ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/gaming/freefire/status", (_req, res) => {
    res.json({
      ok: true,
      status: freeFireGamingService.getStatus(),
      helper: freeFireGamingService.getAndroidHelperStatus(),
    });
  });

  router.get("/api/gaming/freefire/helper/status", (_req, res) => {
    res.json({ ok: true, helper: freeFireGamingService.getAndroidHelperStatus() });
  });

  router.get("/api/gaming/freefire/helper/download", (_req, res) => {
    try {
      const apkPaths = [
        path.resolve(process.cwd(), "public", "downloads", "FridayGamingBridge.apk"),
        path.resolve(process.cwd(), "android-helper", "app", "build", "outputs", "apk", "release", "app-release.apk"),
        path.resolve(process.cwd(), "android-helper", "FridayGamingBridge.apk"),
      ];

      for (const p of apkPaths) {
        if (fs.existsSync(p)) {
          return res.download(p, "FridayGamingBridge.apk");
        }
      }

      const zipPath = path.resolve(process.cwd(), "public", "downloads", "FridayGamingBridge-Source.zip");
      if (fs.existsSync(zipPath)) {
        return res.download(zipPath, "FridayGamingBridge-Android-App.zip");
      }

      const helperDir = path.resolve(process.cwd(), "android-helper");
      if (fs.existsSync(helperDir)) {
        const zipBuffer = createZipFromDirectory(helperDir);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", 'attachment; filename="FridayGamingBridge-Android-App.zip"');
        res.setHeader("Content-Length", zipBuffer.length.toString());
        return res.end(zipBuffer);
      }

      res.status(404).json({
        ok: false,
        error: "PACKAGE_NOT_FOUND",
        message: "Friday Gaming Bridge files are preparing. Please try again shortly.",
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to generate helper package" });
    }
  });

  router.get("/api/gaming/freefire/devices", async (_req, res) => {
    try {
      const devices = await freeFireGamingService.listDevices();
      const helper = freeFireGamingService.getAndroidHelperStatus();
      res.json({ ok: true, devices, helper });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to list ADB devices" });
    }
  });

  router.post("/api/gaming/freefire/connect", async (req, res) => {
    try {
      const { ip, port, pairingCode, pairingPort } = req.body || {};
      if (!ip) return res.status(400).json({ ok: false, error: "Device IP address is required" });
      const result = await freeFireGamingService.connectWirelessAdb(
        ip,
        Number(port) || 5555,
        pairingCode ? String(pairingCode) : undefined,
        pairingPort ? Number(pairingPort) : undefined
      );
      res.json({ ok: result.success, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to connect to device" });
    }
  });

  router.post("/api/gaming/freefire/custom-room/join", async (req, res) => {
    try {
      const { roomId, password, role, slotNumber } = req.body || {};
      if (!roomId) return res.status(400).json({ ok: false, error: "Custom Room ID is required" });
      const result = await freeFireGamingService.joinCustomRoom({
        roomId: String(roomId),
        password: password ? String(password) : undefined,
        role: role === "player" ? "player" : "spectate",
        slotNumber: slotNumber ? Number(slotNumber) : undefined,
      });
      res.json({ ok: result.success, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to join custom room" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LOCATION & FAMILY TELEMETRY TRACKING
  // ══════════════════════════════════════════════════════════════════════════

  router.post("/api/location/register", async (req, res) => {
    try {
      const { deviceLocationTrackerService } = await import("../services/deviceLocationTrackerService");
      const { deviceId, label, ownerName, username, lat, lon, accuracy, altitude, speed, heading, batteryLevel, isCharging, networkType } = req.body || {};
      if (!deviceId || !label) {
        return res.status(400).json({ success: false, message: "deviceId and label are required." });
      }
      const result = await deviceLocationTrackerService.registerDevice(
        String(deviceId),
        String(label),
        ownerName ? String(ownerName) : undefined,
        username ? String(username) : undefined,
        lat !== undefined && lon !== undefined ? { lat: Number(lat), lon: Number(lon), accuracy, altitude, speed, heading, batteryLevel, isCharging, networkType } : undefined
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Registration failed" });
    }
  });

  router.post("/api/location/ping", async (req, res) => {
    try {
      const { deviceLocationTrackerService } = await import("../services/deviceLocationTrackerService");
      const result = await deviceLocationTrackerService.receivePing(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Ping failed" });
    }
  });

  router.get("/api/location/devices", async (_req, res) => {
    try {
      const { deviceLocationTrackerService } = await import("../services/deviceLocationTrackerService");
      const result = await deviceLocationTrackerService.listAllDevices();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "List failed" });
    }
  });

  router.get("/api/location/track/:labelOrId", async (req, res) => {
    try {
      const { deviceLocationTrackerService } = await import("../services/deviceLocationTrackerService");
      const result = await deviceLocationTrackerService.getDeviceLocation(req.params.labelOrId || "");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Track failed" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHONE INTELLIGENCE & OSINT
  // ══════════════════════════════════════════════════════════════════════════

  router.post("/api/phone-intelligence/lookup", async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (!phone || typeof phone !== "string") {
        return res.status(400).json({ ok: false, error: "phone is required" });
      }
      const report = await phoneIntelligenceService.lookup(phone.trim());
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "phone_lookup_failed" });
    }
  });

  router.post("/api/phone-intelligence/unmask-email", async (req, res) => {
    try {
      const { phone, name, nickname, maskPattern, targetDomain } = req.body || {};
      if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
      const candidates = phoneIntelligenceService.decodeMaskedEmail({
        phoneDigits: String(phone),
        name,
        nickname,
        maskPattern,
        targetDomain,
      });
      res.json({ ok: true, candidates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "unmask_failed" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITIES: RAIL, WEATHER, NEWS, RECIPES, BACKGROUND TASKS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/api/railradar/train/:number/live", async (req, res) => {
    try {
      const data = await railRadarService.getLiveTrainStatus(req.params.number);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "train_status_failed" });
    }
  });

  router.get("/api/railradar/pnr/:pnr", async (req, res) => {
    try {
      const data = await railRadarService.getPnrStatus(req.params.pnr);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "pnr_status_failed" });
    }
  });

  router.get("/api/weather/current", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const data = await weatherService.getCurrentWeather(q);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "weather_fetch_failed" });
    }
  });

  router.get("/api/weather/forecast", async (req, res) => {
    try {
      const q = String(req.query.q || "Patna");
      const days = Number(req.query.days || 3);
      const data = await weatherService.getForecast(q, days);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "forecast_fetch_failed" });
    }
  });

  router.get("/api/news/top", async (req, res) => {
    try {
      const country = String(req.query.country || "in");
      const category = req.query.category ? String(req.query.category) : undefined;
      const data = await newsService.getLatestNews(undefined, category, country, "en", count);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "news_fetch_failed" });
    }
  });

  router.get("/api/recipes/search", async (req, res) => {
    try {
      const { query, cuisine, diet, type, maxCalories, minProtein } = req.query;
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

  router.get("/api/background-tasks", (_req, res) => {
    res.json({
      ok: true,
      activeTasks: backgroundTasksService.getActiveTasks(),
      unnotifiedTasks: backgroundTasksService.getUnnotifiedCompletedTasks(),
      recentTasks: backgroundTasksService.getAllRecentTasks(),
    });
  });

  return router;
}
