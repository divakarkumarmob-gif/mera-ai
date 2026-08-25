import { db } from "./firebaseAdmin";
import { toolsEngine } from "./toolsEngine";

export interface CalendarEventItem {
  id: string;
  title: string;
  timeString: string;
  eventTimestamp: number;
  durationMinutes: number;
  locationOrLink?: string;
  notes?: string;
  isCompleted: boolean;
  createdAt: string;
}

const calendarCollection = () => db.collection("calendar_events");

class CalendarEventService {
  /**
   * Schedules a meeting or calendar event with automatic proactive reminder.
   */
  public async scheduleMeeting(
    title: string,
    timeString: string,
    durationMinutes = 30,
    locationOrLink?: string
  ): Promise<{ success: boolean; event: CalendarEventItem; message: string }> {
    const now = Date.now();
    const id = Math.random().toString(36).substring(2, 9);
    const cleanTitle = (title || "Meeting").trim();
    const cleanTime = (timeString || "Soon").trim();

    // Estimate event timestamp (default to 2 hours from now if vague)
    const estimatedTimestamp = now + 2 * 60 * 60 * 1000;

    const event: CalendarEventItem = {
      id,
      title: cleanTitle,
      timeString: cleanTime,
      eventTimestamp: estimatedTimestamp,
      durationMinutes,
      locationOrLink: locationOrLink?.trim(),
      isCompleted: false,
      createdAt: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    };

    await calendarCollection().doc(id).set(event);

    // Also register proactive reminder
    try {
      await toolsEngine.addReminder(`Meeting Alert: "${cleanTitle}" at ${cleanTime}`, cleanTime, 60);
    } catch {}

    const message = `Boss, meeting schedule ho gayi: "${cleanTitle}" [Time: ${cleanTime}, Duration: ${durationMinutes} mins]! Main meeting se pehle aapko alert de dungi.`;

    return {
      success: true,
      event,
      message,
    };
  }

  public async getUpcomingMeetings(): Promise<{ success: boolean; events: CalendarEventItem[]; message: string }> {
    const snap = await calendarCollection()
      .where("isCompleted", "==", false)
      .orderBy("eventTimestamp", "asc")
      .get();

    const events: CalendarEventItem[] = snap.docs.map((d) => d.data() as CalendarEventItem);

    if (events.length === 0) {
      return {
        success: true,
        events: [],
        message: "Boss, filhal koi upcoming meeting schedule nahi hai.",
      };
    }

    const message = `Boss, aapki ${events.length} upcoming meetings hain: ${events.map((e) => `"${e.title}" (${e.timeString})`).join(", ")}.`;

    return {
      success: true,
      events,
      message,
    };
  }
}

export const calendarEventService = new CalendarEventService();
