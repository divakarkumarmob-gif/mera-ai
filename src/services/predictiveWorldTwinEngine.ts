export interface BossDigitalTwinState {
  currentState: "coding_flow" | "high_energy_work" | "meal_break" | "late_night_focus" | "relaxing" | "rest_recharge";
  lastActivityTimestamp: number;
  continuousWorkDurationMinutes: number;
  fatigueIndex: number; // 0 to 100
  predictedNextAction: string;
  recommendedIntervention?: string;
  updatedAt: number;
}

class PredictiveWorldTwinEngine {
  private twinState: BossDigitalTwinState = {
    currentState: "coding_flow",
    lastActivityTimestamp: Date.now(),
    continuousWorkDurationMinutes: 45,
    fatigueIndex: 20,
    predictedNextAction: "Reviewing deployment logs & testing WhatsApp features",
    recommendedIntervention: "Keep replies crisp, supportive, and ready for execution.",
    updatedAt: Date.now(),
  };

  /**
   * Updates Boss's real-time digital twin state based on current time and message
   */
  public updateBossState(messageText: string): BossDigitalTwinState {
    const now = new Date();
    const hour = Number(now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
    const clean = (messageText || "").toLowerCase();

    // 1. Detect state from time & content
    if (hour >= 0 && hour < 5) {
      this.twinState.currentState = "late_night_focus";
      this.twinState.fatigueIndex = Math.min(100, this.twinState.fatigueIndex + 15);
      this.twinState.predictedNextAction = "Finishing final commits before sleep";
      this.twinState.recommendedIntervention = "Speak with soft soothing care, encourage sleep if Boss seems tired.";
    } else if (hour >= 13 && hour <= 14) {
      this.twinState.currentState = "meal_break";
      this.twinState.predictedNextAction = "Lunch / midday relaxation";
      this.twinState.recommendedIntervention = "Remind Boss to eat on time and stay hydrated.";
    } else if (/code|deploy|build|server|api|git|push|bot/i.test(clean)) {
      this.twinState.currentState = "coding_flow";
      this.twinState.continuousWorkDurationMinutes += 15;
      this.twinState.predictedNextAction = "Writing code & configuring backend systems";
      this.twinState.recommendedIntervention = "Be fast, technically sharp, and zero fluff.";
    } else {
      this.twinState.currentState = "high_energy_work";
      this.twinState.predictedNextAction = "Managing daily tasks & communications";
      this.twinState.recommendedIntervention = "Support proactively with high energy.";
    }

    this.twinState.lastActivityTimestamp = Date.now();
    this.twinState.updatedAt = Date.now();
    return this.twinState;
  }

  /**
   * Compiles Digital Twin predictive model prompt
   */
  public compileWorldTwinPrompt(): string {
    return `\n🔮 PREDICTIVE DIGITAL TWIN & WORLD MODEL (Tesla FSD/DeepMind Life Modeling):
- Boss's Current Activity State: ${this.twinState.currentState.toUpperCase()}
- Continuous Session Time: ~${this.twinState.continuousWorkDurationMinutes} mins
- Estimated Fatigue Index: ${this.twinState.fatigueIndex}%
- Predicted Next Action: "${this.twinState.predictedNextAction}"
👉 Recommended Care Intervention: ${this.twinState.recommendedIntervention}\n`;
  }
}

export const predictiveWorldTwinEngine = new PredictiveWorldTwinEngine();
