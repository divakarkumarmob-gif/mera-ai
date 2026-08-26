import { db } from "./firebaseAdmin";
import { sendWhatsAppUnified } from "./whatsappService";

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
}

const priceCollection = () => db.collection("price_trackers");

class PriceDropTrackerService {
  // In-memory cache for fast access and offline resilience
  private inMemoryTrackers: Map<string, TrackedProductItem> = new Map();

  public async trackProduct(
    productName: string,
    currentPrice: number,
    targetPrice?: number,
    productUrl?: string
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
    };

    // Store in memory
    this.inMemoryTrackers.set(id, item);

    try {
      await priceCollection().doc(id).set(item);
    } catch (e: any) {
      console.warn("[PriceTracker] Firestore write note (cached locally):", e?.message || e);
    }

    const message = `Boss, "${name}" price tracker me add ho gaya hai! (Current Price: ₹${curPrice}, Target Alert: ₹${tgtPrice}). Jaise hi price drop hoga, main alert de dungi!`;

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
    newPrice: number
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

    let alertSent = false;
    let dropped = false;

    if (price <= item.targetPrice && !item.isAlertTriggered) {
      item.isAlertTriggered = true;
      dropped = true;

      // Dispatch real WhatsApp Alert
      const alertMsg = `🏷️ *PRICE DROP ALERT — FRIDAY AI*\n\n🔥 *${item.productName}*\n💰 *New Price:* ₹${price}\n🎯 *Target:* ₹${item.targetPrice}\n📉 *Savings:* ₹${item.initialPrice - price}\n${item.productUrl ? `🔗 *Link:* ${item.productUrl}\n` : ""}\n_Boss, jaldi check karein deal live hai!_`;

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
}

export const priceDropTrackerService = new PriceDropTrackerService();
