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
    const id = Math.random().toString(36).substring(2, 9);
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

    await expensesCollection().doc(id).set(item);

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

    const snap = await expensesCollection()
      .where("monthKey", "==", currentMonthKey)
      .orderBy("timestamp", "desc")
      .get();

    const expenses: ExpenseItem[] = snap.docs.map((d) => d.data() as ExpenseItem);

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
    const message = `Boss, ${monthName} me total ₹${totalSpent} kharch hue hain. Sabse zyada kharcha "${topCategory}" me hua hai (₹${maxSpent}). Total ${expenses.length} entries recorded hain.`;

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
}

export const expenseTrackerService = new ExpenseTrackerService();
