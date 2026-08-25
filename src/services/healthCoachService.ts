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
  private getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  public async logWaterIntake(glasses = 1): Promise<{ success: boolean; totalToday: number; remaining: number; message: string }> {
    const dateKey = this.getTodayKey();
    const docRef = healthCollection().doc(dateKey);
    const doc = await docRef.get();

    let current = 0;
    if (doc.exists) {
      current = Number(doc.data()?.waterGlasses) || 0;
    }

    const updated = current + glasses;
    const target = 8;
    const remaining = Math.max(0, target - updated);

    await docRef.set(
      {
        dateKey,
        waterGlasses: updated,
        targetGlasses: target,
        lastWaterTimestamp: Date.now(),
      },
      { merge: true }
    );

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

  public async getDailyHealthStatus(): Promise<HealthStatusData> {
    const dateKey = this.getTodayKey();
    const docRef = healthCollection().doc(dateKey);
    const doc = await docRef.get();

    const data = doc.data() || {};
    const waterGlasses = Number(data.waterGlasses) || 0;
    const targetGlasses = 8;
    const stretchesDone = Number(data.stretchesDone) || 0;
    const progress = Math.min(100, Math.round((waterGlasses / targetGlasses) * 100));

    const postureTips = [
      "20-20-20 Rule: Har 20 minute me 20 feet door 20 second ke liye dekhein taaki aankhon par strain na aaye.",
      "Shoulders ko relax rakhein aur screen ko eye-level par adjust karein.",
      "Thodi der khade hokar deep breaths lein aur back ko stretch karein.",
    ];
    const tip = postureTips[Math.floor(Math.random() * postureTips.length)];

    const message = `Boss, aaj ka Health Status: Hydration ${progress}% hai (${waterGlasses}/${targetGlasses} glasses). Desk Posture Tip: ${tip}`;

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
