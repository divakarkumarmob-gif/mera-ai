import { db } from "./firebaseAdmin";

export interface HealthStatusData {
  success: boolean;
  dateKey: string;
  waterGlasses: number;
  targetGlasses: number;
  waterProgressPercent: number;
  stretchesDone: number;
  postureTip: string;
  message: string;
}

const healthCollection = () => db.collection("health_logs");

class HealthCoachService {
  // In-memory cache for offline resiliency
  private inMemoryLogs: Map<string, { waterGlasses: number; stretchesDone: number }> = new Map();

  private getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  public async logWaterIntake(glasses = 1): Promise<{ success: boolean; totalToday: number; remaining: number; message: string }> {
    const dateKey = this.getTodayKey();
    let current = this.inMemoryLogs.get(dateKey)?.waterGlasses || 0;

    try {
      const doc = await healthCollection().doc(dateKey).get();
      if (doc.exists) {
        current = Number(doc.data()?.waterGlasses) || current;
      }
    } catch {}

    const updated = current + glasses;
    const target = 8;
    const remaining = Math.max(0, target - updated);

    // Save in memory
    const existing = this.inMemoryLogs.get(dateKey) || { waterGlasses: 0, stretchesDone: 0 };
    this.inMemoryLogs.set(dateKey, { ...existing, waterGlasses: updated });

    try {
      await healthCollection().doc(dateKey).set(
        {
          dateKey,
          waterGlasses: updated,
          targetGlasses: target,
          lastWaterTimestamp: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[HealthCoach] Firestore write warning (cached locally):", e);
    }

    let message = `Boss, ${glasses} glass paani log ho gaya! Aaj total ${updated}/${target} glasses ho gaye hain. `;
    if (remaining === 0) {
      message += `Wah Boss, aaj ka hydration goal 100% complete ho gaya hai! 🎉`;
    } else {
      message += `Daily goal ke liye ${remaining} glasses aur baaki hain.`;
    }

    return {
      success: true,
      totalToday: updated,
      remaining,
      message,
    };
  }

  public async logStretch(count = 1): Promise<{ success: boolean; totalStretches: number; message: string }> {
    const dateKey = this.getTodayKey();
    let current = this.inMemoryLogs.get(dateKey)?.stretchesDone || 0;

    try {
      const doc = await healthCollection().doc(dateKey).get();
      if (doc.exists) {
        current = Number(doc.data()?.stretchesDone) || current;
      }
    } catch {}

    const updated = current + count;
    const existing = this.inMemoryLogs.get(dateKey) || { waterGlasses: 0, stretchesDone: 0 };
    this.inMemoryLogs.set(dateKey, { ...existing, stretchesDone: updated });

    try {
      await healthCollection().doc(dateKey).set(
        {
          dateKey,
          stretchesDone: updated,
          lastStretchTimestamp: Date.now(),
        },
        { merge: true }
      );
    } catch {}

    return {
      success: true,
      totalStretches: updated,
      message: `Boss, desk stretch break recorded! Aaj total ${updated} stretch sessions complete ho chuke hain. Good job! 🧘‍♂️`,
    };
  }

  public async getDailyHealthStatus(): Promise<HealthStatusData> {
    const dateKey = this.getTodayKey();
    let waterGlasses = this.inMemoryLogs.get(dateKey)?.waterGlasses || 0;
    let stretchesDone = this.inMemoryLogs.get(dateKey)?.stretchesDone || 0;

    try {
      const doc = await healthCollection().doc(dateKey).get();
      if (doc.exists) {
        const data = doc.data() || {};
        waterGlasses = Number(data.waterGlasses) || waterGlasses;
        stretchesDone = Number(data.stretchesDone) || stretchesDone;
      }
    } catch {}

    const targetGlasses = 8;
    const progress = Math.min(100, Math.round((waterGlasses / targetGlasses) * 100));

    const postureTips = [
      "20-20-20 Rule: Har 20 minute me 20 feet door 20 second ke liye dekhein taaki aankhon par strain na aaye.",
      "Shoulders ko relax rakhein aur screen ko eye-level par adjust karein.",
      "Thodi der khade hokar deep breaths lein aur back ko stretch karein.",
    ];
    const tip = postureTips[Math.floor(Math.random() * postureTips.length)];

    const message = `Boss, aaj ka Health Status: Hydration ${progress}% hai (${waterGlasses}/${targetGlasses} glasses), aur ${stretchesDone} stretches done. Desk Posture Tip: ${tip}`;

    return {
      success: true,
      dateKey,
      waterGlasses,
      targetGlasses,
      waterProgressPercent: progress,
      stretchesDone,
      postureTip: tip,
      message,
    };
  }
}

export const healthCoachService = new HealthCoachService();
