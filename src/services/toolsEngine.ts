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

export interface LyricsSearchResult {
  success: boolean;
  query: string;
  bestMatch?: {
    trackName: string;
    artistName: string;
    albumName?: string;
    albumArt?: string;
    matchedSnippet?: string;
    matchType: "exact" | "partial" | "fuzzy";
    matchScore: number;
    spotifyUrl?: string;
    youtubeMusicUrl?: string;
    previewUrl?: string;
  } | null;
  otherCandidates?: Array<{
    trackName: string;
    artistName: string;
    albumName?: string;
    albumArt?: string;
    matchedSnippet?: string;
    matchScore: number;
    matchType: "exact" | "partial" | "fuzzy";
    spotifyUrl?: string;
    youtubeMusicUrl?: string;
  }>;
  message?: string;
  spotifySearchUrl?: string;
  youtubeMusicUrl?: string;
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

  /**
   * Search and identify a song using lyrics / memorable lines with exact & fuzzy/partial match fallback.
   */
  public async searchSongByLyrics(lyricsQuery: string, artistHint?: string): Promise<LyricsSearchResult> {
    return await publicApisService.searchSongByLyrics(lyricsQuery, artistHint);
  }

  /**
   * Shazam-Style: Identify music/song playing live in the background/room.
   */
  public async identifyPlayingSong(audioSnippetBase64?: string, songClue?: string) {
    const { musicRecognitionService } = await import("./musicRecognitionService");
    return await musicRecognitionService.identifyPlayingSong(audioSnippetBase64, songClue);
  }

  /**
   * Google Hum-to-Search Style: Identify song from humming, whistling, tune, or rhythm clues.
   */
  public async identifySongByHummingOrTune(hummingOrTuneClue: string, artistHint?: string) {
    const { musicRecognitionService } = await import("./musicRecognitionService");
    return await musicRecognitionService.identifyHummingOrTune(hummingOrTuneClue, artistHint);
  }

  /**
   * Iron Man VIP Morning Briefing Protocol
   */
  public async getMorningBriefing(city?: string) {
    const { morningBriefingService } = await import("./morningBriefingService");
    return await morningBriefingService.generateMorningBriefing(city);
  }

  /**
   * JARVIS PC & System Health Diagnostics
   */
  public getSystemHealth() {
    const { systemHealthService } = require("./systemHealthService");
    return systemHealthService.getHealthMetrics();
  }

  /**
   * Deep Autonomous Multi-Stage Research Agent
   */
  public async executeDeepResearch(topic: string, onProgress?: (step: string, percent: number) => void) {
    const { deepResearchService } = await import("./deepResearchService");
    return await deepResearchService.executeResearch(topic, onProgress);
  }

  /**
   * Screen Vision AI Assistant
   */
  public async analyzeScreenContext(imageBase64?: string, userQuery?: string) {
    const { screenVisionService } = await import("./screenVisionService");
    return await screenVisionService.analyzeScreenContext(imageBase64, userQuery);
  }
}

export const toolsEngine = new ToolsEngine();

