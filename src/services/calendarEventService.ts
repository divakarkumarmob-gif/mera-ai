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
  // In-memory fallback cache in case Firestore is offline or uninitialized
  private inMemoryEvents: Map<string, CalendarEventItem> = new Map();

  /**
   * Intelligently parses conversational or structured time strings into a valid future timestamp.
   */
  private parseTimeStringToTimestamp(timeStr: string): number {
    const now = Date.now();
    const str = (timeStr || "").toLowerCase().trim();

    // 1. Relative minutes: "in 20 mins", "20 minute baad", "20m"
    const minMatch = str.match(/(\d+)\s*(?:min|mins|minute|minutes|m\b)/i);
    if (minMatch) {
      const minutes = parseInt(minMatch[1], 10);
      if (!isNaN(minutes) && minutes > 0) {
        return now + minutes * 60 * 1000;
      }
    }

    // 2. Relative hours: "in 2 hours", "1 ghante baad", "3h"
    const hourMatch = str.match(/(\d+)\s*(?:hour|hours|hr|hrs|ghanta|ghante|h\b)/i);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      if (!isNaN(hours) && hours > 0) {
        return now + hours * 60 * 60 * 1000;
      }
    }

    // 3. Absolute clock time: "at 5:30 PM", "5 pm", "10:00 am", "18:00"
    const clockMatch = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (clockMatch) {
      let hours = parseInt(clockMatch[1], 10);
      const minutes = clockMatch[2] ? parseInt(clockMatch[2], 10) : 0;
      const meridiem = clockMatch[3] ? clockMatch[3].toLowerCase() : null;

      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;

      const dateObj = new Date(now);
      if (str.includes("tomorrow") || str.includes("kal")) {
        dateObj.setDate(dateObj.getDate() + 1);
      }
      dateObj.setHours(hours, minutes, 0, 0);

      // If scheduled time has already passed today and no tomorrow specified, schedule for tomorrow
      if (dateObj.getTime() <= now && !str.includes("tomorrow") && !str.includes("kal")) {
        dateObj.setDate(dateObj.getDate() + 1);
      }

      return dateObj.getTime();
    }

    // Default fallback: 2 hours from now
    return now + 2 * 60 * 60 * 1000;
  }

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
    const id = "evt_" + Math.random().toString(36).substring(2, 9);
    const cleanTitle = (title || "Meeting").trim();
    const cleanTime = (timeString || "Soon").trim();

    // Intelligently parse event timestamp
    const eventTimestamp = this.parseTimeStringToTimestamp(cleanTime);
    const diffMinutes = Math.max(1, Math.round((eventTimestamp - now) / 60000));

    const event: CalendarEventItem = {
      id,
      title: cleanTitle,
      timeString: cleanTime,
      eventTimestamp,
      durationMinutes,
      locationOrLink: locationOrLink?.trim(),
      isCompleted: false,
      createdAt: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    };

    // Cache locally
    this.inMemoryEvents.set(id, event);

    // Save to Firestore with graceful offline handling
    try {
      await calendarCollection().doc(id).set(event);
    } catch (e: any) {
      console.warn("[CalendarEvent] Firestore save warning (using memory cache):", e?.message || e);
    }

    // Proactively register reminder with reminder engine
    try {
      const reminderOffsetMinutes = Math.max(1, diffMinutes - 10);
      await toolsEngine.addReminder(
        `Meeting Alert: "${cleanTitle}" at ${cleanTime}`,
        cleanTime,
        reminderOffsetMinutes
      );
    } catch (remErr) {
      console.warn("[CalendarEvent] Could not schedule auto-reminder:", remErr);
    }

    const message = `Boss, meeting schedule ho gayi: "${cleanTitle}" [Time: ${cleanTime}, Duration: ${durationMinutes} mins]! Main meeting se pehle aapko alert de dungi.`;

    return {
      success: true,
      event,
      message,
    };
  }

  /**
   * Returns all upcoming non-completed meetings sorted by timestamp.
   */
  public async getUpcomingMeetings(): Promise<{ success: boolean; events: CalendarEventItem[]; message: string }> {
    let events: CalendarEventItem[] = [];

    try {
      const snap = await calendarCollection()
        .where("isCompleted", "==", false)
        .get();

      events = snap.docs
        .map((d) => d.data() as CalendarEventItem)
        .sort((a, b) => (a.eventTimestamp || 0) - (b.eventTimestamp || 0));
    } catch (err: any) {
      console.warn("[CalendarEvent] Firestore fetch error, using in-memory store:", err?.message || err);
      events = Array.from(this.inMemoryEvents.values())
        .filter((e) => !e.isCompleted)
        .sort((a, b) => a.eventTimestamp - b.eventTimestamp);
    }

    // Sync to memory cache
    events.forEach((e) => this.inMemoryEvents.set(e.id, e));

    if (events.length === 0) {
      return {
        success: true,
        events: [],
        message: "Boss, filhal koi upcoming meeting schedule nahi hai.",
      };
    }

    const message = `Boss, aapki ${events.length} upcoming meetings hain: ${events
      .map((e) => `"${e.title}" (${e.timeString})`)
      .join(", ")}.`;

    return {
      success: true,
      events,
      message,
    };
  }

  /**
   * Cancels a meeting by ID or partial title match.
   */
  public async cancelMeeting(idOrTitle: string): Promise<{ success: boolean; message: string }> {
    const target = idOrTitle.toLowerCase().trim();
    let foundId: string | null = null;

    // Check in memory cache
    for (const [id, e] of this.inMemoryEvents.entries()) {
      if (id.toLowerCase() === target || e.title.toLowerCase().includes(target)) {
        foundId = id;
        e.isCompleted = true;
        break;
      }
    }

    try {
      if (foundId) {
        await calendarCollection().doc(foundId).delete();
      } else {
        const snap = await calendarCollection().get();
        for (const doc of snap.docs) {
          const data = doc.data() as CalendarEventItem;
          if (doc.id.toLowerCase() === target || data.title?.toLowerCase().includes(target)) {
            await doc.ref.delete();
            foundId = doc.id;
            break;
          }
        }
      }
    } catch (e: any) {
      console.warn("[CalendarEvent] Firestore delete error:", e?.message || e);
    }

    if (foundId) {
      this.inMemoryEvents.delete(foundId);
      return { success: true, message: `Meeting successfully cancel kar di gayi hai.` };
    }

    return { success: false, message: `Meeting "${idOrTitle}" nahi mili.` };
  }

  /**
   * Marks a meeting as completed.
   */
  public async markMeetingCompleted(idOrTitle: string): Promise<boolean> {
    const target = idOrTitle.toLowerCase().trim();
    for (const [id, e] of this.inMemoryEvents.entries()) {
      if (id.toLowerCase() === target || e.title.toLowerCase().includes(target)) {
        e.isCompleted = true;
        try {
          await calendarCollection().doc(id).set({ isCompleted: true }, { merge: true });
        } catch {}
        return true;
      }
    }
    return false;
  }
}

export const calendarEventService = new CalendarEventService();
