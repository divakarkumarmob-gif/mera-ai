import { db } from "./firebaseAdmin";
import { whatsappCloudService } from "./whatsappCloudService";

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
  public async trackProduct(
    productName: string,
    currentPrice: number,
    targetPrice?: number,
    productUrl?: string
  ): Promise<{ success: boolean; item: TrackedProductItem; message: string }> {
    const name = (productName || "Product").trim();
    const curPrice = Math.abs(Number(currentPrice) || 0);
    const tgtPrice = targetPrice ? Math.abs(Number(targetPrice)) : Math.round(curPrice * 0.9); // default 10% drop

    const id = Math.random().toString(36).substring(2, 9);
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

    await priceCollection().doc(id).set(item);

    const message = `Boss, "${name}" price tracker me add ho gaya hai! (Current Price: ₹${curPrice}, Target Alert: ₹${tgtPrice}). Jaise hi price drop hoga, main alert de dungi!`;

    return {
      success: true,
      item,
      message,
    };
  }

  public async getTrackedProducts(): Promise<{ success: boolean; products: TrackedProductItem[]; message: string }> {
    const snap = await priceCollection().get();
    const products: TrackedProductItem[] = snap.docs.map((d) => d.data() as TrackedProductItem);

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
}

export const priceDropTrackerService = new PriceDropTrackerService();
