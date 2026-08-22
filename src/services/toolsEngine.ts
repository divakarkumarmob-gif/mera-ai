import fs from "fs";
import path from "path";

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

const dbDir = path.resolve("data");
try {
  fs.mkdirSync(dbDir, { recursive: true });
} catch {}

const remindersPath = path.join(dbDir, "reminders.json");
const notesPath = path.join(dbDir, "notes.json");

class ToolsEngine {
  private reminders: ReminderItem[] = [];
  private notes: NoteItem[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(remindersPath)) {
        this.reminders = JSON.parse(fs.readFileSync(remindersPath, "utf-8"));
      }
    } catch {
      this.reminders = [];
    }

    try {
      if (fs.existsSync(notesPath)) {
        this.notes = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
      }
    } catch {
      this.notes = [];
    }
  }

  private persistReminders() {
    try {
      fs.writeFileSync(remindersPath, JSON.stringify(this.reminders, null, 2), "utf-8");
    } catch (e) {
      console.error("[ToolsEngine] Failed to persist reminders:", e);
    }
  }

  private persistNotes() {
    try {
      fs.writeFileSync(notesPath, JSON.stringify(this.notes, null, 2), "utf-8");
    } catch (e) {
      console.error("[ToolsEngine] Failed to persist notes:", e);
    }
  }

  public addReminder(title: string, timeString = "soon", durationMinutes = 0): ReminderItem {
    const now = Date.now();
    const due = durationMinutes > 0 ? now + durationMinutes * 60 * 1000 : now + 60 * 60 * 1000;
    const item: ReminderItem = {
      id: Math.random().toString(36).substring(2, 9),
      title: title.trim(),
      timeString: timeString.trim(),
      dueTimestamp: due,
      createdDate: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      isCompleted: false,
    };
    this.reminders.push(item);
    this.persistReminders();
    return item;
  }

  public addNote(title: string, content: string): NoteItem {
    const now = Date.now();
    const item: NoteItem = {
      id: Math.random().toString(36).substring(2, 9),
      title: title.trim(),
      content: content.trim(),
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };
    this.notes.push(item);
    this.persistNotes();
    return item;
  }

  public getReminders() {
    return this.reminders;
  }

  public getNotes() {
    return this.notes;
  }
}

export const toolsEngine = new ToolsEngine();
