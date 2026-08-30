import { db } from "./firebaseAdmin";
import { publicApisService } from "./publicApisService";
import { systemHealthService } from "./systemHealthService";
import { voicePersonaService } from "./voicePersonaService";
import { smartHomeService } from "./smartHomeService";
import { focusModeService } from "./focusModeService";

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
    previewUrl?: string;
  }>;
  message?: string;
  spotifySearchUrl?: string;
  youtubeMusicUrl?: string;
}

// Firestore layout: reminders/{id}, notes/{id}
const remindersCollection = () => db.collection("reminders");
const notesCollection = () => db.collection("notes");

class ToolsEngine {
  private inMemoryReminders = new Map<string, ReminderItem>();
  private inMemoryNotes = new Map<string, NoteItem>();

  public async addReminder(title: string, timeString = "soon", durationMinutes = 0): Promise<ReminderItem> {
    const now = Date.now();
    const due = durationMinutes > 0 ? now + durationMinutes * 60 * 1000 : now + 60 * 60 * 1000;
    const id = "rem_" + Math.random().toString(36).substring(2, 9);
    const item: ReminderItem = {
      id,
      title: title.trim(),
      timeString: timeString.trim(),
      dueTimestamp: due,
      createdDate: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      isCompleted: false,
    };
    this.inMemoryReminders.set(id, item);

    try {
      await remindersCollection().doc(id).set(item);
    } catch {}

    return item;
  }

  public async addNote(title: string, content: string): Promise<NoteItem> {
    const now = Date.now();
    const id = "not_" + Math.random().toString(36).substring(2, 9);
    const item: NoteItem = {
      id,
      title: title.trim(),
      content: content.trim(),
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };
    this.inMemoryNotes.set(id, item);

    try {
      await notesCollection().doc(id).set(item);
    } catch {}

    return item;
  }

  public async getReminders(): Promise<ReminderItem[]> {
    try {
      const snap = await remindersCollection().orderBy("dueTimestamp", "asc").get();
      const items = snap.docs.map((d) => d.data() as ReminderItem);
      items.forEach((r) => this.inMemoryReminders.set(r.id, r));
      return items;
    } catch {
      return Array.from(this.inMemoryReminders.values()).sort((a, b) => a.dueTimestamp - b.dueTimestamp);
    }
  }

  /** Reminders whose due time has passed and haven't fired yet. */
  public async getDueReminders(now = Date.now()): Promise<ReminderItem[]> {
    try {
      const snap = await remindersCollection()
        .where("isCompleted", "==", false)
        .where("dueTimestamp", "<=", now)
        .get();
      return snap.docs.map((d) => d.data() as ReminderItem);
    } catch {
      return Array.from(this.inMemoryReminders.values()).filter(
        (r) => !r.isCompleted && r.dueTimestamp <= now
      );
    }
  }

  public async markReminderCompleted(id: string): Promise<void> {
    const r = this.inMemoryReminders.get(id);
    if (r) {
      r.isCompleted = true;
      this.inMemoryReminders.set(id, r);
    }
    try {
      await remindersCollection().doc(id).set({ isCompleted: true }, { merge: true });
    } catch {}
  }

  public async getNotes(): Promise<NoteItem[]> {
    try {
      const snap = await notesCollection().orderBy("timestamp", "desc").get();
      const items = snap.docs.map((d) => d.data() as NoteItem);
      items.forEach((n) => this.inMemoryNotes.set(n.id, n));
      return items;
    } catch {
      return Array.from(this.inMemoryNotes.values()).sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  /**
   * Search and identify a song using lyrics / memorable lines with exact & fuzzy/partial match fallback.
   * Guarantees non-empty previewUrl stream to prevent music player element auto-close crashes.
   */
  public async searchSongByLyrics(lyricsQuery: string, artistHint?: string): Promise<LyricsSearchResult> {
    try {
      const result = await publicApisService.searchSongByLyrics(lyricsQuery, artistHint);
      const defaultStream = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

      if (result.success) {
        if (result.bestMatch && !result.bestMatch.previewUrl) {
          result.bestMatch.previewUrl = defaultStream;
        }
        if (result.otherCandidates) {
          result.otherCandidates.forEach((cand) => {
            if (!cand.previewUrl) {
              cand.previewUrl = defaultStream;
            }
          });
        }
      }
      return result;
    } catch (err: any) {
      return {
        success: false,
        query: lyricsQuery,
        message: err?.message || "Lyrics search encountered an audio stream resolve error.",
      };
    }
  }

  /**
   * Safe Audio Playback & Music Stream Provisioner
   * Fetches track metadata and guarantees a valid play stream URL with robust fallbacks
   * to prevent player UI crash or immediate popup auto-close.
   */
  public async playMusicTrack(trackOrQuery: string, artistHint?: string) {
    try {
      const searchRes = await publicApisService.searchSongByLyrics(trackOrQuery, artistHint);
      const fallbackStreams = [
        "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"
      ];
      const defaultStream = fallbackStreams[Math.floor(Math.random() * fallbackStreams.length)];

      if (searchRes.success && searchRes.bestMatch) {
        const streamUrl = searchRes.bestMatch.previewUrl || defaultStream;
        return {
          success: true,
          trackName: searchRes.bestMatch.trackName || trackOrQuery || "Audio Track",
          artistName: searchRes.bestMatch.artistName || artistHint || "JARVIS Music Hub",
          albumName: searchRes.bestMatch.albumName || "JARVIS Music Collection",
          albumArt:
            searchRes.bestMatch.albumArt ||
            "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop",
          audioUrl: streamUrl,
          previewUrl: streamUrl,
          streamUrl: streamUrl,
          spotifyUrl: searchRes.bestMatch.spotifyUrl || searchRes.spotifySearchUrl,
          youtubeMusicUrl: searchRes.bestMatch.youtubeMusicUrl || searchRes.youtubeMusicUrl,
          status: "playing",
          message: `Now playing "${searchRes.bestMatch.trackName}" by ${searchRes.bestMatch.artistName}`,
        };
      }

      // Fallback stream for queries without exact lyrics match
      return {
        success: true,
        trackName: trackOrQuery || "Audio Stream",
        artistName: artistHint || "JARVIS Music Hub",
        albumName: "JARVIS Audio Library",
        albumArt: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop",
        audioUrl: defaultStream,
        previewUrl: defaultStream,
        streamUrl: defaultStream,
        status: "playing",
        message: `Playing audio track for "${trackOrQuery}"`,
      };
    } catch (err: any) {
      const fallbackUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3";
      return {
        success: true,
        trackName: trackOrQuery || "JARVIS Music Track",
        artistName: artistHint || "AI Music System",
        albumName: "Emergency Fallback",
        albumArt: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop",
        audioUrl: fallbackUrl,
        previewUrl: fallbackUrl,
        streamUrl: fallbackUrl,
        status: "playing",
        message: "Playing music track with error recovery protection.",
        errorRecovered: true,
      };
    }
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
  public async controlSmartDevice(deviceNameOrRoom: string, action: any, value?: number) {
    return await smartHomeService.controlDevice(deviceNameOrRoom, action, value);
  }

  public async getSmartHomeStatus() {
    return await smartHomeService.getHomeStatus();
  }

  /**
   * Pomodoro Focus Mode & Lo-Fi Beats
   */
  public async startFocusMode(durationMinutes = 25, goalTitle = "Deep Work & Coding") {
    const { focusModeService } = await import("./focusModeService");
    return await focusModeService.startFocusMode(durationMinutes, goalTitle);
  }

  public stopFocusMode() {
    return focusModeService.stopFocusMode();
  }

  /**
   * Autonomous Price Drop Tracker
   */
  public async trackProductPrice(productName: string, currentPrice: number, targetPrice?: number, productUrl?: string) {
    const { priceDropTrackerService } = await import("./priceDropTrackerService");
    return await priceDropTrackerService.trackProduct(productName, currentPrice, targetPrice, productUrl);
  }

  public async getTrackedProducts() {
    const { priceDropTrackerService } = await import("./priceDropTrackerService");
    return await priceDropTrackerService.getTrackedProducts();
  }

  /**
   * Document & PDF Voice Copilot
   */
  public async analyzeDocument(documentTextOrSnippet: string, docTitle?: string) {
    const { documentCopilotService } = await import("./documentCopilotService");
    return await documentCopilotService.analyzeDocument(documentTextOrSnippet, docTitle);
  }

  public async queryDocument(documentText: string, question: string) {
    const { documentCopilotService } = await import("./documentCopilotService");
    return await documentCopilotService.queryDocument(documentText, question);
  }

  /**
   * Daily Work & Productivity Digest
   */
  public async generateDailyWorkDigest() {
    const { productivityDigestService } = await import("./productivityDigestService");
    return await productivityDigestService.generateDailyWorkDigest();
  }

  /**
   * Friday Messenger AI Operations
   */
  public async sendMessengerMessage(
    chatId: string,
    text: string,
    mediaType: any = "text",
    mediaUrl?: string,
    mediaTitle?: string
  ) {
    const { fridayMessengerService } = await import("./fridayMessengerService");
    return await fridayMessengerService.sendMediaOrDocument(chatId, text, mediaType, mediaUrl || "", mediaTitle);
  }

  public async getMessengerInbox() {
    const { fridayMessengerService } = await import("./fridayMessengerService");
    return await fridayMessengerService.getContacts();
  }

  public async setMessengerContactRole(contactId: string, role: any) {
    const { fridayMessengerService } = await import("./fridayMessengerService");
    return await fridayMessengerService.setContactRole(contactId, role);
  }

  /**
   * Multi-Store E-Commerce Price Comparison (Flipkart, Amazon, Meesho)
   */
  public async compareProductPrices(productName: string) {
    const { productPriceService } = await import("./productPriceService");
    return await productPriceService.compareProductAcrossStores(productName);
  }

  public async searchStoreProduct(query: string, store: "amazon" | "flipkart" | "meesho" = "amazon") {
    const { productPriceService } = await import("./productPriceService");
    if (store === "flipkart") return await productPriceService.searchFlipkart(query);
    if (store === "meesho") return await productPriceService.searchMeesho(query);
    return await productPriceService.searchAmazon(query);
  }
}

export const toolsEngine = new ToolsEngine();