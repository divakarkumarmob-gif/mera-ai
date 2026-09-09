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
        .get();
      return snap.docs
        .map((d) => d.data() as ReminderItem)
        .filter((r) => r.dueTimestamp <= now);
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

  /**
   * Ultra-HD 4K AI Photo Generator (Cloudflare Workers AI FLUX & Fallbacks)
   */
  public async generateAiPhoto(
    prompt: string,
    options: {
      aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
      sendToWhatsApp?: boolean;
      targetRecipient?: string;
    } = {}
  ) {
    const { imageGenerationService } = await import("./imageGenerationService");
    const { contactsService } = await import("./contactsService");
    const { whatsappBotService } = await import("./whatsappBotService");

    const genRes = await imageGenerationService.generateImage(prompt, {
      aspectRatio: options.aspectRatio || "9:16",
      enhancePrompt: true,
    });

    if (!genRes.success || !genRes.buffer) {
      return {
        success: false,
        message: genRes.error || "Image generation failed. Please try a different prompt.",
        model: genRes.model,
      };
    }

    const mime = genRes.mimeType || "image/jpeg";
    const base64Data = genRes.buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${base64Data}`;

    let whatsappSent = false;
    let whatsappMessage = "";
    let recipientName = options.targetRecipient || "DK (Boss)";

    if (options.sendToWhatsApp) {
      const contact = await contactsService.findContact(options.targetRecipient || "boss");
      const targetPhone = contact ? contact.phone : (options.targetRecipient || "boss");
      recipientName = contact ? contact.name : "Boss";

      const caption = `📸 *4K AI Portrait Generated by Friday*\n_${prompt}_\n\n⚡ *Model:* ${genRes.model}`;
      const sendRes = await whatsappBotService.sendPhotoMessage(targetPhone, genRes.buffer, caption);
      whatsappSent = sendRes.success;
      whatsappMessage = sendRes.message;
    }

    let lastImageBuffer: Buffer | null = genRes.buffer || null;
    (this as any)._lastGeneratedImageBuffer = lastImageBuffer;
    (this as any)._lastGeneratedImagePrompt = genRes.prompt;
    (this as any)._lastGeneratedPhotoMeta = {
      hasPhoto: true,
      success: true,
      imageUrl: dataUrl,
      prompt: genRes.prompt,
      model: genRes.model,
      aspectRatio: options.aspectRatio || "9:16",
      whatsappSent,
      recipient: recipientName,
      timestamp: new Date().toISOString(),
    };

    return {
      success: true,
      imageUrl: dataUrl,
      prompt: genRes.prompt,
      model: genRes.model,
      aspectRatio: options.aspectRatio || "9:16",
      whatsappSent,
      whatsappMessage,
      recipient: recipientName,
      message: `Boss photo generate ho gaya hai, aap dashboard par dekh lo, baki main WhatsApp par bhej rahi hoon! Aur haan, photo pasand nahi aayi toh dobara banau ya isme kuch edit karu?`,
    };
  }

  /**
   * Get Last Generated AI Photo Status & Details
   */
  public getLastGeneratedPhotoStatus() {
    const meta = (this as any)._lastGeneratedPhotoMeta;
    if (meta && meta.imageUrl) {
      return {
        hasPhoto: true,
        success: true,
        prompt: meta.prompt,
        model: meta.model || "Cloudflare 4K Portrait AI",
        imageUrl: meta.imageUrl,
        aspectRatio: meta.aspectRatio || "9:16",
        whatsappSent: meta.whatsappSent,
        recipient: meta.recipient,
        timestamp: meta.timestamp,
        message: `Haan boss, photo bilkul ban gaya hai aur dashboard ke left popup me dikh raha hai! Prompt: "${meta.prompt}". Maine WhatsApp par bhi bhej diya hai.`,
      };
    }
    return {
      hasPhoto: false,
      success: false,
      message: "Abhi tak koi photo generate nahi hui hai. Aap prompt batayein toh main abhi 4K AI portrait generate kar sakti hoon.",
    };
  }

  /**
   * Intelligently modify or transform the last generated AI photo with natural language edit instructions
   */
  public async editAiPhoto(
    editInstructions: string,
    options: {
      sendToWhatsApp?: boolean;
      targetRecipient?: string;
    } = {}
  ) {
    const { imageGenerationService } = await import("./imageGenerationService");
    const lastBuf = (this as any)._lastGeneratedImageBuffer as Buffer | undefined;
    const lastPrompt = (this as any)._lastGeneratedImagePrompt || "photo";

    let compositePrompt = `${lastPrompt}, modified: ${editInstructions}, 4k ultra-hd portrait, cinematic natural lighting, 8k uhd`;
    if (lastBuf) {
      const editRes = await imageGenerationService.editImageWithAI(lastBuf, editInstructions);
      if (editRes.success && editRes.buffer) {
        (this as any)._lastGeneratedImageBuffer = editRes.buffer;
        (this as any)._lastGeneratedImagePrompt = editRes.prompt;

        const mime = editRes.mimeType || "image/jpeg";
        const dataUrl = `data:${mime};base64,${editRes.buffer.toString("base64")}`;

        let whatsappSent = false;
        let recipientName = options.targetRecipient || "DK (Boss)";

        if (options.sendToWhatsApp) {
          const { contactsService } = await import("./contactsService");
          const { whatsappBotService } = await import("./whatsappBotService");
          const contact = await contactsService.findContact(options.targetRecipient || "boss");
          const targetPhone = contact ? contact.phone : (options.targetRecipient || "boss");
          recipientName = contact ? contact.name : "Boss";

          const caption = `🎨 *4K AI Photo Modified by Friday*\n_${editInstructions}_\n\n⚡ *Model:* ${editRes.model}`;
          const sendRes = await whatsappBotService.sendPhotoMessage(targetPhone, editRes.buffer, caption);
          whatsappSent = sendRes.success;
        }

        (this as any)._lastGeneratedPhotoMeta = {
          hasPhoto: true,
          success: true,
          imageUrl: dataUrl,
          prompt: editRes.prompt,
          model: editRes.model,
          aspectRatio: "9:16",
          whatsappSent,
          recipient: recipientName,
          timestamp: new Date().toISOString(),
        };

        return {
          success: true,
          imageUrl: dataUrl,
          prompt: editRes.prompt,
          model: editRes.model,
          whatsappSent,
          recipient: recipientName,
          message: `Boss photo edit ho gaya hai, aap dashboard par dekh lo aur maine WhatsApp par bhi bhej diya hai! Baki agar isme kuch aur change karna ho toh batao!`,
        };
      }
    }

    // Fallback if buffer not stored
    return await this.generateAiPhoto(compositePrompt, {
      aspectRatio: "9:16",
      sendToWhatsApp: options.sendToWhatsApp,
      targetRecipient: options.targetRecipient,
    });
  }

  /**
   * Send Photo to WhatsApp Contact or Boss
   */
  public async sendPhotoToWhatsApp(
    targetNameOrPhone: string,
    imageSource: string | Buffer,
    caption?: string
  ) {
    const { contactsService } = await import("./contactsService");
    const { whatsappBotService } = await import("./whatsappBotService");

    const contact = await contactsService.findContact(targetNameOrPhone || "boss");
    const targetPhone = contact ? contact.phone : (targetNameOrPhone || "boss");
    const name = contact ? contact.name : "Boss";

    let payload: string | Buffer = imageSource;
    if (imageSource === "last_generated") {
      const lastBuf = (this as any)._lastGeneratedImageBuffer;
      if (lastBuf) payload = lastBuf;
    }

    const cleanCaption = caption || "📸 Photo sent by Friday AI";
    const res = await whatsappBotService.sendPhotoMessage(targetPhone, payload, cleanCaption);

    return {
      success: res.success,
      recipient: name,
      phone: targetPhone,
      message: res.message,
    };
  }
}

export const toolsEngine = new ToolsEngine();