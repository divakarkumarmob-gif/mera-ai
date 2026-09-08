export interface AnticipatedAction {
  category: "travel_readiness" | "coding_support" | "health_wellness" | "social_followup";
  recommendation: string;
  prefetchedDataHint?: string;
}

class ShadowAnticipationEngine {
  /**
   * Intuitively anticipates background needs from message content.
   */
  public anticipateNeeds(text: string, isOwner = true): AnticipatedAction[] {
    const clean = text.toLowerCase();
    const actions: AnticipatedAction[] = [];

    // 1. Travel Anticipation
    if (/\b(flight|train|delhi|mumbai|patna|bangalore|goa|ticket|travel|journey)\b/i.test(clean)) {
      actions.push({
        category: "travel_readiness",
        recommendation: "Boss is planning or discussing travel. Silently be ready to fetch weather, live PNR/flight status, or packing reminders without being prompted.",
      });
    }

    // 2. Heavy Coding / Production Bug
    if (/\b(bug|error|crash|deploy|server|prod|fix|failed|build|exception)\b/i.test(clean)) {
      actions.push({
        category: "coding_support",
        recommendation: "Boss is dealing with code errors. Prioritize rapid diagnostics, concise solutions, and zero conversational fluff.",
      });
    }

    // 3. Health / Low Energy
    if (/\b(thak\s*gaya|headache|bukhar|fever|dard|tired|dawai)\b/i.test(clean)) {
      actions.push({
        category: "health_wellness",
        recommendation: "Boss is unwell or fatigued. Keep replies short, gentle, soothing, and proactively suggest rest and water.",
      });
    }

    return actions;
  }
}

export const shadowAnticipationEngine = new ShadowAnticipationEngine();
