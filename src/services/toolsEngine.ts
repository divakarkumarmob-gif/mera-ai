import { db } from "./firebaseAdmin";
import { publicApisService } from "./publicApisService";

export interface ReminderItem {
  id: string;
  title: string;
  timeString: string;
  dueTimestamp: number;
  createdDate: string;
  isCompleted: boolean;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  dateStr: string;
  timestamp: number;
}

// Firestore layout: reminders/{id}, notes/{id}
const remindersCollection = () => db.collection("reminders");
const notesCollection = () => db.collection("notes");

class ToolsEngine {
  public async addReminder(title: string, timeString = "soon", durationMinutes = 0): Promise<ReminderItem> {
    const now = Date.now();
    const due = durationMinutes > 0 ? now + durationMinutes * 60 * 1000 : now + 60 * 60 * 1000;
    const id = Math.random().toString(36).substring(2, 9);
    const item: ReminderItem = {
      id,
      title: title.trim(),
      timeString: timeString.trim(),
      dueTimestamp: due,
      createdDate: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      isCompleted: false,
    };
    await remindersCollection().doc(id).set(item);
    return item;
  }

  public async addNote(title: string, content: string): Promise<NoteItem> {
    const now = Date.now();
    const id = Math.random().toString(36).substring(2, 9);
    const item: NoteItem = {
      id,
      title: title.trim(),
      content: content.trim(),
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };
    await notesCollection().doc(id).set(item);
    return item;
  }

  public async getReminders(): Promise<ReminderItem[]> {
    const snap = await remindersCollection().orderBy("dueTimestamp", "asc").get();
    return snap.docs.map((d) => d.data() as ReminderItem);
  }

  /** Reminders whose due time has passed and haven't fired yet. */
  public async getDueReminders(now = Date.now()): Promise<ReminderItem[]> {
    const snap = await remindersCollection()
      .where("isCompleted", "==", false)
      .where("dueTimestamp", "<=", now)
      .get();
    return snap.docs.map((d) => d.data() as ReminderItem);
  }

  public async markReminderCompleted(id: string): Promise<void> {
    await remindersCollection().doc(id).set({ isCompleted: true }, { merge: true });
  }

  public async getNotes(): Promise<NoteItem[]> {
    const snap = await notesCollection().orderBy("timestamp", "desc").get();
    return snap.docs.map((d) => d.data() as NoteItem);
  }

  public async searchSongByLyrics(lyricsSnippet: string): Promise<any> {
    return await publicApisService.searchSongByLyrics(lyricsSnippet);
  }
}

export const toolsEngine = new ToolsEngine();