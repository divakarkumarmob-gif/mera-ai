import { db } from "./firebaseAdmin";
import { sendWhatsAppUnified } from "./whatsappService";

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: string;
  isPurchased: boolean;
  createdAt: number;
}

const shoppingCollection = () => db.collection("shopping_items");

class ShoppingListService {
  // In-memory cache for instant response & offline resilience
  private inMemoryItems: Map<string, ShoppingItem> = new Map();

  public async addItems(itemsQuery: string): Promise<{ success: boolean; addedCount: number; items: string[]; message: string }> {
    const raw = (itemsQuery || "").trim();
    if (!raw) throw new Error("Shopping items provide karna zaroori hai.");

    // Split by comma, 'and', 'aur', '+'
    const itemNames = raw
      .split(/[,+&]|\band\b|\baur\b/gi)
      .map((i) => i.trim())
      .filter((i) => i.length > 0);

    const now = Date.now();
    for (const name of itemNames) {
      const id = "shp_" + Math.random().toString(36).substring(2, 9);
      const item: ShoppingItem = {
        id,
        name,
        isPurchased: false,
        createdAt: now,
      };

      this.inMemoryItems.set(id, item);

      try {
        await shoppingCollection().doc(id).set(item);
      } catch (e: any) {
        console.warn("[ShoppingList] Firestore save note (cached in memory):", e?.message || e);
      }
    }

    const message = `Boss, ${itemNames.length} items shopping list me add kar diye gaye hain: ${itemNames.map((i) => `"${i}"`).join(", ")}!`;

    return {
      success: true,
      addedCount: itemNames.length,
      items: itemNames,
      message,
    };
  }

  public async getShoppingList(): Promise<{ success: boolean; pendingItems: ShoppingItem[]; message: string }> {
    let items: ShoppingItem[] = [];

    try {
      const snap = await shoppingCollection().where("isPurchased", "==", false).get();
      items = snap.docs.map((d) => d.data() as ShoppingItem);
    } catch {
      items = Array.from(this.inMemoryItems.values()).filter((i) => !i.isPurchased);
    }

    items.forEach((i) => this.inMemoryItems.set(i.id, i));

    if (items.length === 0) {
      return {
        success: true,
        pendingItems: [],
        message: "Boss, aapki shopping list bilkul khali hai.",
      };
    }

    const message = `Boss, shopping list me total ${items.length} items hain: ${items.map((i) => i.name).join(", ")}.`;

    return {
      success: true,
      pendingItems: items,
      message,
    };
  }

  public async markItemPurchased(id: string): Promise<{ success: boolean; message: string }> {
    const cleanId = (id || "").trim();
    const item = this.inMemoryItems.get(cleanId);
    if (item) {
      item.isPurchased = true;
      this.inMemoryItems.set(cleanId, item);
    }

    try {
      await shoppingCollection().doc(cleanId).set({ isPurchased: true }, { merge: true });
    } catch {}

    return {
      success: true,
      message: `Boss, item purchased mark kar diya gaya hai!`,
    };
  }

  public async sendListOnWhatsApp(targetPhone?: string): Promise<{ success: boolean; message: string }> {
    const res = await this.getShoppingList();
    if (!res.pendingItems.length) {
      return { success: false, message: "Shopping list khali hai, pehle kuch items add karein." };
    }

    const phone = targetPhone || process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "919999999999";
    const dateStr = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    let text = `🛒 *FRIDAY — SHOPPING & GROCERY LIST*\n📅 *Date:* ${dateStr}\n\n`;

    res.pendingItems.forEach((item, idx) => {
      text += `⬜ ${idx + 1}. ${item.name}\n`;
    });

    text += `\n_Dispatched via Friday AI Assistant_`;

    try {
      const waRes = await sendWhatsAppUnified(phone, text);
      return {
        success: waRes.success,
        message: waRes.success
          ? `Boss, shopping list aapke WhatsApp (+${phone}) par bhej di gayi hai! (${res.pendingItems.length} items).`
          : `WhatsApp message failed: ${waRes.message}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `WhatsApp par shopping list send nahi ho payi: ${err?.message || err}`,
      };
    }
  }

  public async clearList(): Promise<{ success: boolean; message: string }> {
    this.inMemoryItems.clear();

    try {
      const snap = await shoppingCollection().get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } catch {}

    return {
      success: true,
      message: "Boss, shopping list clear kar di gayi hai!",
    };
  }
}

export const shoppingListService = new ShoppingListService();
