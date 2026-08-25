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

  /**
   * Voice Persona & Style Switcher
   */
  public switchVoicePersona(personaName: string) {
    const { voicePersonaService } = require("./voicePersonaService");
    return voicePersonaService.switchPersona(personaName);
  }

  /**
   * Autonomous File Organizer
   */
  public async organizeDirectory(dirPath?: string) {
    const { fileOrganizerService } = await import("./fileOrganizerService");
    return await fileOrganizerService.organizeDirectory(dirPath);
  }

  /**
   * Clean System Temporary Cache
   */
  public async cleanTempFiles() {
    const { fileOrganizerService } = await import("./fileOrganizerService");
    return await fileOrganizerService.cleanTempFiles();
  }

  /**
   * Personal Expense Tracker
   */
  public async addExpense(amount: number, description: string, categoryHint?: string) {
    const { expenseTrackerService } = await import("./expenseTrackerService");
    return await expenseTrackerService.addExpense(amount, description, categoryHint);
  }

  public async getExpenseSummary(filterMonth?: string) {
    const { expenseTrackerService } = await import("./expenseTrackerService");
    return await expenseTrackerService.getExpenseSummary(filterMonth);
  }

  /**
   * Autonomous Meeting & Calendar Scheduler
   */
  public async scheduleMeeting(title: string, timeString: string, durationMinutes?: number, locationOrLink?: string) {
    const { calendarEventService } = await import("./calendarEventService");
    return await calendarEventService.scheduleMeeting(title, timeString, durationMinutes, locationOrLink);
  }

  public async getUpcomingMeetings() {
    const { calendarEventService } = await import("./calendarEventService");
    return await calendarEventService.getUpcomingMeetings();
  }

  /**
   * Smart Email Assistant
   */
  public async summarizeInbox() {
    const { gmailVoiceAssistant } = await import("./gmailVoiceAssistant");
    return await gmailVoiceAssistant.summarizeInbox();
  }

  public async sendQuickEmail(toEmail: string, subject: string, bodyText: string) {
    const { gmailVoiceAssistant } = await import("./gmailVoiceAssistant");
    return await gmailVoiceAssistant.sendQuickEmail(toEmail, subject, bodyText);
  }

  /**
   * AI Health, Hydration & Desk Coach
   */
  public async logWaterIntake(glasses = 1) {
    const { healthCoachService } = await import("./healthCoachService");
    return await healthCoachService.logWaterIntake(glasses);
  }

  public async getHealthStatus() {
    const { healthCoachService } = await import("./healthCoachService");
    return await healthCoachService.getDailyHealthStatus();
  }

  /**
   * Smart Shopping List
   */
  public async addToShoppingList(itemsQuery: string) {
    const { shoppingListService } = await import("./shoppingListService");
    return await shoppingListService.addItems(itemsQuery);
  }

  public async getShoppingList() {
    const { shoppingListService } = await import("./shoppingListService");
    return await shoppingListService.getShoppingList();
  }

  public async sendShoppingListOnWhatsApp(targetPhone?: string) {
    const { shoppingListService } = await import("./shoppingListService");
    return await shoppingListService.sendListOnWhatsApp(targetPhone);
  }

  public async clearShoppingList() {
    const { shoppingListService } = await import("./shoppingListService");
    return await shoppingListService.clearList();
  }

  /**
   * Voice Emergency SOS
   */
  public async triggerEmergencySos(customMessage?: string, targetPhone?: string) {
    const { emergencySosService } = await import("./emergencySosService");
    return await emergencySosService.triggerSos(customMessage, targetPhone);
  }

  /**
   * Daily Tech Audio Podcast Generator
   */
  public async generateDailyPodcast() {
    const { dailyPodcastService } = await import("./dailyPodcastService");
    return await dailyPodcastService.generateDailyPodcast();
  }

  /**
   * Fast2SMS Real Mobile SMS Sender
   */
  public async sendFast2Sms(phoneNumber: string, messageText: string, customApiKey?: string) {
    const { fast2SmsService } = await import("./fast2SmsService");
    return await fast2SmsService.sendSms(phoneNumber, messageText, customApiKey);
  }

  /**
   * WhatsApp Voice Note Summarizer
   */
  public async summarizeVoiceNote(transcriptOrAudioSnippet: string, senderName?: string) {
    const { voiceNoteSummarizerService } = await import("./voiceNoteSummarizerService");
    return await voiceNoteSummarizerService.summarizeVoiceNote(transcriptOrAudioSnippet, senderName);
  }

  /**
   * AES-256 Encrypted AI Vault & Secret Locker
   */
  public async storeVaultSecret(keyName: string, secretValue: string, category?: string) {
    const { secureVaultService } = await import("./secureVaultService");
    return await secureVaultService.storeSecret(keyName, secretValue, category);
  }

  public async retrieveVaultSecret(keyName: string) {
    const { secureVaultService } = await import("./secureVaultService");
    return await secureVaultService.retrieveSecret(keyName);
  }

  public async listVaultSecrets() {
    const { secureVaultService } = await import("./secureVaultService");
    return await secureVaultService.listSecretKeys();
  }

  /**
   * Travel & IRCTC Train Tracker
   */
  public async getTrainLiveStatus(trainNumberOrName: string) {
    const { travelTrackerService } = await import("./travelTrackerService");
    return await travelTrackerService.getTrainLiveStatus(trainNumberOrName);
  }

  public async checkPnrStatus(pnrNumber: string) {
    const { travelTrackerService } = await import("./travelTrackerService");
    return await travelTrackerService.checkPnrStatus(pnrNumber);
  }

  /**
   * Smart Home & IoT Voice Controller
   */
  public controlSmartDevice(deviceNameOrRoom: string, action: any, value?: number) {
    const { smartHomeService } = require("./smartHomeService");
    return smartHomeService.controlDevice(deviceNameOrRoom, action, value);
  }

  public getSmartHomeStatus() {
    const { smartHomeService } = require("./smartHomeService");
    return smartHomeService.getHomeStatus();
  }

  /**
   * Pomodoro Focus Mode & Lo-Fi Beats
   */
  public async startFocusMode(durationMinutes = 25, goalTitle = "Deep Work & Coding") {
    const { focusModeService } = await import("./focusModeService");
    return await focusModeService.startFocusMode(durationMinutes, goalTitle);
  }

  public stopFocusMode() {
    const { focusModeService } = require("./focusModeService");
    return focusModeService.stopFocusMode();
  }
}

export const toolsEngine = new ToolsEngine();

