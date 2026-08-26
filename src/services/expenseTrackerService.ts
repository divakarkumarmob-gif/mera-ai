import { db } from "./firebaseAdmin";

export interface ExpenseItem {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  dateStr: string;
  monthKey: string; // e.g. "2026-08"
  timestamp: number;
}

export interface ExpenseSummary {
  success: boolean;
  month: string;
  totalSpent: number;
  currency: string;
  categoryBreakdown: Record<string, number>;
  topCategory: string;
  recentExpenses: ExpenseItem[];
  message: string;
}

const expensesCollection = () => db.collection("expenses");

class ExpenseTrackerService {
  // In-memory cache for offline resiliency and instantaneous response
  private inMemoryExpenses: Map<string, ExpenseItem> = new Map();

  private detectCategory(text: string): string {
    const t = text.toLowerCase();
    if (t.match(/\b(petrol|diesel|fuel|cab|uber|ola|auto|metro|train|bus|flight|travel|ticket)\b/)) {
      return "Travel & Fuel";
    }
    if (t.match(/\b(khana|food|lunch|dinner|breakfast|swiggy|zomato|chai|coffee|biryani|pizza|burger|snack|restaurant|hotel)\b/)) {
      return "Food & Dining";
    }
    if (t.match(/\b(recharge|bill|electricity|bijli|wifi|internet|rent|kiraya|water|gas|emi)\b/)) {
      return "Bills & Utilities";
    }
    if (t.match(/\b(amazon|flipkart|shopping|rashan|grocery|clothes|kapde|shoes|dawa|medicine)\b/)) {
      return "Shopping & Groceries";
    }
    if (t.match(/\b(netflix|spotify|chatgpt|openai|domain|server|hosting|app|software|course)\b/)) {
      return "Tech & Subscriptions";
    }
    return "General";
  }

  public async addExpense(
    amount: number,
    description: string,
    categoryHint?: string
  ): Promise<{ success: boolean; item: ExpenseItem; message: string }> {
    const numAmount = Math.abs(Number(amount) || 0);
    const desc = (description || "General expense").trim();
    const cat = categoryHint?.trim() || this.detectCategory(desc);

    const now = new Date();
    const id = "exp_" + Math.random().toString(36).substring(2, 9);
    const dateStr = now.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const item: ExpenseItem = {
      id,
      amount: numAmount,
      currency: "₹",
      category: cat,
      description: desc,
      dateStr,
      monthKey,
      timestamp: now.getTime(),
    };

    // Cache locally
    this.inMemoryExpenses.set(id, item);

    // Save to Firestore with silent offline fallback
    try {
      await expensesCollection().doc(id).set(item);
    } catch (e: any) {
      console.warn("[ExpenseTracker] Firestore save warning (cached in memory):", e?.message || e);
    }

    const message = `Boss, ₹${numAmount} ka kharcha add kar diya gaya hai: "${desc}" [Category: ${cat}]!`;

    return {
      success: true,
      item,
      message,
    };
  }

  public async getExpenseSummary(filterMonth?: string): Promise<ExpenseSummary> {
    const now = new Date();
    const currentMonthKey = filterMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let expenses: ExpenseItem[] = [];

    // Attempt Firestore query with graceful composite index / offline fallback
    try {
      const snap = await expensesCollection()
        .where("monthKey", "==", currentMonthKey)
        .orderBy("timestamp", "desc")
        .get();

      expenses = snap.docs.map((d) => d.data() as ExpenseItem);
    } catch (err: any) {
      // Fallback 1: Simple query without composite ordering
      try {
        const snap = await expensesCollection().where("monthKey", "==", currentMonthKey).get();
        expenses = snap.docs
          .map((d) => d.data() as ExpenseItem)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } catch {
        // Fallback 2: Local in-memory cache
        expenses = Array.from(this.inMemoryExpenses.values())
          .filter((e) => e.monthKey === currentMonthKey)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
    }

    // Update in-memory cache
    expenses.forEach((e) => this.inMemoryExpenses.set(e.id, e));

    let totalSpent = 0;
    const categoryBreakdown: Record<string, number> = {};

    for (const exp of expenses) {
      totalSpent += exp.amount;
      categoryBreakdown[exp.category] = (categoryBreakdown[exp.category] || 0) + exp.amount;
    }

    let topCategory = "None";
    let maxSpent = 0;
    for (const [cat, amt] of Object.entries(categoryBreakdown)) {
      if (amt > maxSpent) {
        maxSpent = amt;
        topCategory = cat;
      }
    }

    const monthName = now.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    const message = expenses.length > 0
      ? `Boss, ${monthName} me total ₹${totalSpent} kharch hue hain. Sabse zyada kharcha "${topCategory}" me hua hai (₹${maxSpent}). Total ${expenses.length} entries recorded hain.`
      : `Boss, ${monthName} me filhal koi kharcha record nahi hua hai.`;

    return {
      success: true,
      month: monthName,
      totalSpent,
      currency: "₹",
      categoryBreakdown,
      topCategory,
      recentExpenses: expenses.slice(0, 5),
      message,
    };
  }

  public async deleteExpense(id: string): Promise<boolean> {
    const cleanId = String(id || "").trim();
    if (!cleanId) return false;

    this.inMemoryExpenses.delete(cleanId);
    try {
      await expensesCollection().doc(cleanId).delete();
      return true;
    } catch {
      return true;
    }
  }

  public async getRecentExpenses(limitCount = 10): Promise<ExpenseItem[]> {
    const all = Array.from(this.inMemoryExpenses.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (all.length >= limitCount) {
      return all.slice(0, limitCount);
    }
    try {
      const snap = await expensesCollection().orderBy("timestamp", "desc").limit(limitCount).get();
      const items = snap.docs.map((d) => d.data() as ExpenseItem);
      items.forEach((i) => this.inMemoryExpenses.set(i.id, i));
      return items;
    } catch {
      return all.slice(0, limitCount);
    }
  }
}

export const expenseTrackerService = new ExpenseTrackerService();
