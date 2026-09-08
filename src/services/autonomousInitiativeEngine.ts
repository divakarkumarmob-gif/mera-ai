/**
 * Autonomous Background Initiative & Pre-emptive Briefing Engine for Friday AI
 * 
 * Works like a world-class executive chief of staff:
 * 1. Checks upcoming meetings, deadlines, and project checkpoints.
 * 2. Compiles pre-emptive intelligence briefings (e.g. 30-45 mins before a meeting or event).
 * 3. Proactively generates contextual assistance cues without requiring explicit prompts.
 */

import { calendarEventService } from "./calendarEventService";
import { toolsEngine } from "./toolsEngine";

export interface PreEmptiveBriefing {
  type: "meeting" | "task" | "weather" | "health";
  title: string;
  summary: string;
  actionRecommendation: string;
  urgency: "low" | "medium" | "high";
}

export class AutonomousInitiativeEngine {
  private static instance: AutonomousInitiativeEngine;

  private constructor() {}

  public static getInstance(): AutonomousInitiativeEngine {
    if (!AutonomousInitiativeEngine.instance) {
      AutonomousInitiativeEngine.instance = new AutonomousInitiativeEngine();
    }
    return AutonomousInitiativeEngine.instance;
  }

  /**
   * Generates active background initiative insights.
   */
  public async getActiveInitiatives(): Promise<PreEmptiveBriefing[]> {
    const initiatives: PreEmptiveBriefing[] = [];

    try {
      // 1. Check upcoming calendar events in the next 2 hours
      const meetingsRes = await calendarEventService.getUpcomingMeetings().catch(() => ({ events: [] }));
      const events = (meetingsRes as any)?.events || [];
      if (events.length > 0) {
        const nextEvent = events[0];
        initiatives.push({
          type: "meeting",
          title: `Upcoming: ${nextEvent.title}`,
          summary: `Scheduled for ${nextEvent.timeString || "today"}.`,
          actionRecommendation: "Have meeting links and project notes ready.",
          urgency: "high",
        });
      }

      // 2. Check pending high-priority reminders
      const reminders = await toolsEngine.getReminders().catch(() => []);
      const pending = (reminders as any[]).filter((r: any) => !r.isCompleted);
      if (pending.length > 0) {
        const top = pending[0];
        initiatives.push({
          type: "task",
          title: `Pending Alert: ${top.task}`,
          summary: `Due around ${top.timeStr || "soon"}.`,
          actionRecommendation: "Gently remind Boss if relevant.",
          urgency: "medium",
        });
      }
    } catch (e) {
      console.warn("[AutonomousInitiativeEngine] Error scanning initiatives:", e);
    }

    return initiatives;
  }

  /**
   * Compiles background initiative context to inject into Friday's prompt.
   */
  public async compileInitiativeDossierPrompt(): Promise<string> {
    const initiatives = await this.getActiveInitiatives();
    if (initiatives.length === 0) return "";

    const items = initiatives
      .map(
        (init) =>
          `• [${init.urgency.toUpperCase()}] ${init.title} — ${init.summary} (Action: ${init.actionRecommendation})`
      )
      .join("\n");

    return `⚡ AUTONOMOUS BACKGROUND INITIATIVE & PRE-EMPTIVE DOSSIERS:
${items}
*Chief of Staff Rule: If Boss is transitioning between topics or asking about his day, smoothly present these proactive briefings without being asked.*`;
  }
}

export const autonomousInitiativeEngine = AutonomousInitiativeEngine.getInstance();
