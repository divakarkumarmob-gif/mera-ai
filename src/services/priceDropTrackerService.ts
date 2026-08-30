import { db } from "./firebaseAdmin";
import { sendWhatsAppUnified } from "./whatsappService";

export interface PriceHistoryPoint {
  price: number;
  timestamp: string;
  store?: string;
}

export interface TrackedProductItem {
  id: string;
  productName: string;
  productUrl?: string;
  initialPrice: number;
  targetPrice: number;
  currentPrice: number;
  priceDropAmount: number;
  lastChecked: string;
  isAlertTriggered: boolean;
  store?: string;
  priceHistory?: PriceHistoryPoint[];
}

const priceCollection = () => db.collection("price_trackers");

class PriceDropTrackerService {
  // In-memory cache for fast access and offline resilience
  private inMemoryTrackers: Map<string, TrackedProductItem> = new Map();
  private autoTrackerHandle: NodeJS.Timeout | null = null;
  private isCheckingLive = false;

  constructor() {
    // Load initial products from Firestore
    this.getTrackedProducts().catch(() => {});
  }

  /**
   * Start periodic background price checking (default: every 1 hour)
   */
  public startAutoTracker(intervalMinutes = 60) {
    if (this.autoTrackerHandle) return;
    const intervalMs = Math.max(15, intervalMinutes) * 60 * 1000;
    this.autoTrackerHandle = setInterval(() => this.checkAllPricesLive(), intervalMs);
    console.log(`[PriceTracker] Auto price tracking scheduler started (running every ${intervalMinutes} mins)`);
  }

  public stopAutoTracker() {
    if (this.autoTrackerHandle) {
      clearInterval(this.autoTrackerHandle);
      this.autoTrackerHandle = null;
    }
  }

  public async trackProduct(
    productName: string,
    currentPrice: number,
    targetPrice?: number,
    productUrl?: string,
    store?: string
  ): Promise<{ success: boolean; item: TrackedProductItem; message: string }> {
    const name = (productName || "Product").trim();
    const curPrice = Math.abs(Number(currentPrice) || 0);
    const tgtPrice = targetPrice ? Math.abs(Number(targetPrice)) : Math.round(curPrice * 0.9); // default 10% drop

    const id = "trk_" + Math.random().toString(36).substring(2, 9);
    const nowStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const item: TrackedProductItem = {
      id,
      productName: name,
      productUrl: productUrl?.trim(),
      initialPrice: curPrice,
      targetPrice: tgtPrice,
      currentPrice: curPrice,
      priceDropAmount: 0,
      lastChecked: nowStr,
      isAlertTriggered: false,
      store: store || "MultiStore",
      priceHistory: [
        {
          price: curPrice,
          timestamp: nowStr,
          store: store || "Initial"
        }
      ]
    };

    // Store in memory
    this.inMemoryTrackers.set(id, item);

    try {
      await priceCollection().doc(id).set(item);
    } catch (e: any) {
      console.warn("[PriceTracker] Firestore write note (cached locally):", e?.message || e);
    }

    const message = `Boss, "${name}" price tracker me add ho gaya hai! (Current Price: ₹${curPrice}, Target Alert: ₹${tgtPrice}). Jaise hi price drop hoga, main WhatsApp alert de dungi!`;

    return {
      success: true,
      item,
      message,
    };
  }

  public async getTrackedProducts(): Promise<{ success: boolean; products: TrackedProductItem[]; message: string }> {
    let products: TrackedProductItem[] = [];

    try {
      const snap = await priceCollection().get();
      products = snap.docs.map((d) => d.data() as TrackedProductItem);
    } catch {
      products = Array.from(this.inMemoryTrackers.values());
    }

    products.forEach((p) => this.inMemoryTrackers.set(p.id, p));

    if (products.length === 0) {
      return {
        success: true,
        products: [],
        message: "Boss, filhal koi product price monitor me add nahi hai.",
      };
    }

    const message = `Boss, total ${products.length} products track ho rahe hain: ${products.map((p) => `"${p.productName}" (Target: ₹${p.targetPrice})`).join(", ")}.`;

    return {
      success: true,
      products,
      message,
    };
  }

  public async checkAndUpdatePrice(
    productId: string,
    newPrice: number,
    storeName?: string
  ): Promise<{ success: boolean; dropped: boolean; priceDiff: number; message: string }> {
    const cleanId = (productId || "").trim();
    let item = this.inMemoryTrackers.get(cleanId);

    if (!item) {
      try {
        const snap = await priceCollection().doc(cleanId).get();
        if (snap.exists) {
          item = snap.data() as TrackedProductItem;
        }
      } catch {}
    }

    if (!item) {
      throw new Error(`Boss, product ID "${cleanId}" nahi mila.`);
    }

    const price = Math.abs(Number(newPrice) || 0);
    const oldPrice = item.currentPrice;
    const priceDiff = oldPrice - price;
    const nowStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    item.currentPrice = price;
    item.priceDropAmount = item.initialPrice - price;
    item.lastChecked = nowStr;
    if (storeName) item.store = storeName;

    if (!item.priceHistory) item.priceHistory = [];
    item.priceHistory.push({
      price,
      timestamp: nowStr,
      store: storeName || item.store
    });
    // Keep max 50 price history logs
    if (item.priceHistory.length > 50) {
      item.priceHistory = item.priceHistory.slice(-50);
    }

    let alertSent = false;
    let dropped = false;

    if (price <= item.targetPrice && !item.isAlertTriggered) {
      item.isAlertTriggered = true;
      dropped = true;

      // Dispatch real WhatsApp Alert
      const alertMsg = `🏷️ *PRICE DROP ALERT — FRIDAY AI*\n\n🔥 *${item.productName}*\n💰 *New Lowest Price:* ₹${price.toLocaleString("en-IN")}\n🎯 *Target:* ₹${item.targetPrice.toLocaleString("en-IN")}\n📉 *Total Savings:* ₹${(item.initialPrice - price).toLocaleString("en-IN")}\n🛒 *Store:* ${storeName || item.store || "Online Store"}\n${item.productUrl ? `🔗 *Link:* ${item.productUrl}\n` : ""}\n_Boss, deal live hai! Jaldi order karein._`;

      const targetPhone = process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "919999999999";
      try {
        await sendWhatsAppUnified(targetPhone, alertMsg);
        alertSent = true;
      } catch (err) {
        console.warn("[PriceTracker] WhatsApp alert dispatch warning:", err);
      }
    }

    this.inMemoryTrackers.set(cleanId, item);
    try {
      await priceCollection().doc(cleanId).set(item, { merge: true });
    } catch {}

    const message = dropped
      ? `🚨 PRICE DROP! "${item.productName}" ka price drop hokar ₹${price} ho gaya hai (Target: ₹${item.targetPrice})! WhatsApp alert ${alertSent ? "sent ✅" : "logged"}.`
      : `Boss, "${item.productName}" ka price update ho gaya: ₹${price}. (Initial: ₹${item.initialPrice}, Target: ₹${item.targetPrice}).`;

    return {
      success: true,
      dropped,
      priceDiff,
      message,
    };
  }

  public async deleteTrackedProduct(id: string): Promise<boolean> {
    const cleanId = String(id || "").trim();
    if (!cleanId) return false;

    this.inMemoryTrackers.delete(cleanId);
    try {
      await priceCollection().doc(cleanId).delete();
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Scrapes live prices for all tracked products using productPriceService and triggers alerts
   */
  public async checkAllPricesLive(): Promise<{ success: boolean; updatedCount: number; alertsTriggered: number }> {
    if (this.isCheckingLive) return { success: false, updatedCount: 0, alertsTriggered: 0 };
    this.isCheckingLive = true;

    const { productPriceService } = await import("./productPriceService");
    const { products } = await this.getTrackedProducts();
    let updatedCount = 0;
    let alertsTriggered = 0;

    try {
      for (const item of products) {
        try {
          const query = item.productName;
          const res = await productPriceService.compareProductAcrossStores(query);
          if (res.bestDeal && res.bestDeal.product.price > 0) {
            const livePrice = res.bestDeal.product.price;
            const storeName = res.bestDeal.store;
            const updateRes = await this.checkAndUpdatePrice(item.id, livePrice, storeName);
            updatedCount++;
            if (updateRes.dropped) alertsTriggered++;
          }
        } catch (err) {
          console.warn(`[PriceTracker] Live price check failed for ${item.productName}:`, err);
        }
      }
    } finally {
      this.isCheckingLive = false;
    }

    return {
      success: true,
      updatedCount,
      alertsTriggered
    };
  }
}

export const priceDropTrackerService = new PriceDropTrackerService();
