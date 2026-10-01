import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export interface StoredPersonMemory {
  id: string;
  name: string;
  relation?: string;
  notes?: string;
  visualSummary: string;
  photoBase64?: string; // compressed thumbnail for visual comparison
  createdAt: number;
  updatedAt: number;
  lastRecognizedAt?: number;
}

export interface StoredMediaItem {
  id: string;
  sender: string;
  mimeType: string;
  caption?: string;
  analysis: string;
  ocrText?: string;
  timestamp: number;
  photoBase64?: string;
}

export interface RoutineSlotDraft {
  title: string;
  startTimeStr: string;
  endTimeStr: string;
  activity: string;
}

export interface CachedMediaContext {
  buffer: Buffer;
  mimeType: string;
  sender: string;
  caption?: string;
  fileName?: string;
  analysis: string;
  ocrText?: string;
  timestamp: number;
  shortSummary?: string;
  detectedScheduleSlots?: RoutineSlotDraft[];
  isScheduleOrTimetable?: boolean;
  isStatusMedia?: boolean;
  chatId?: string;
}

class VisionMemoryService {
  private latestMedia: CachedMediaContext | null = null;
  private latestMediaPerChat = new Map<string, CachedMediaContext>();
  private inMemoryPersonMemories = new Map<string, StoredPersonMemory>();

  private getGenAI(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * Retrieves the recent cached media for a given chat or globally (within 1 hour).
   * Strict Isolation: WhatsApp Status stories (status@broadcast) are NEVER returned for chat queries!
   */
  public getChatMediaContext(chatId?: string): CachedMediaContext | null {
    const oneHour = 60 * 60 * 1000;
    if (chatId) {
      // 1. Direct key match
      if (this.latestMediaPerChat.has(chatId)) {
        const item = this.latestMediaPerChat.get(chatId)!;
        if (!item.isStatusMedia && Date.now() - item.timestamp < oneHour) {
          return item;
        }
      }

      // 2. Normalized phone / JID match
      const cleanDigits = chatId.replace(/@.*$/, "").replace(/\D/g, "");
      const last10 = cleanDigits.slice(-10);
      for (const [k, item] of this.latestMediaPerChat.entries()) {
        if (item.isStatusMedia || k === "status@broadcast") continue;
        const kClean = k.replace(/@.*$/, "").replace(/\D/g, "");
        if (cleanDigits && kClean === cleanDigits && Date.now() - item.timestamp < oneHour) {
          return item;
        }
        if (last10 && kClean.endsWith(last10) && Date.now() - item.timestamp < oneHour) {
          return item;
        }
      }
    }

    // Fallback: ONLY return latestMedia if it was an actual chat image/doc, NEVER a status story!
    if (this.latestMedia && !this.latestMedia.isStatusMedia && Date.now() - this.latestMedia.timestamp < oneHour) {
      return this.latestMedia;
    }
    return null;
  }

  /**
   * Checks if user text is inquiring about a recent photo, PDF, file, or summary.
   */
  public isMediaQuestionIntent(text: string): boolean {
    const t = text.toLowerCase().trim();
    if (/\b(group|grup|chat|conversation|history|last\s*\d+|msg|message|messages|bhejo|batao|avengers|script)\b/i.test(t)) {
      return false;
    }
    return (
      /\b(photo|image|picture|pic|pdf|doc|document|file|invoice|bill|receipt|poster|notice|screenshot|chart|slide)\b/i.test(t) ||
      /\b(kya\s*likha\s*hai|padh\s*ke\s*batao|isme\s*kya\s*hai|photo\s*me\s*kya|image\s*me\s*kya)\b/i.test(t)
    );
  }

  /**
   * Parses machine-readable [ROUTINE_DATA: [...]] from AI output,
   * cleans the tag from the user-facing text, and returns structured slots.
   */
  public extractRoutineSlots(text: string): { cleanedText: string; slots: RoutineSlotDraft[] } {
    if (!text) return { cleanedText: text || "", slots: [] };
    const routineMatch = text.match(/\[ROUTINE_DATA:\s*(\[\s*\{.*?\}\s*\])\s*\]/s);
    if (!routineMatch) {
      return { cleanedText: text, slots: [] };
    }

    let slots: RoutineSlotDraft[] = [];
    try {
      const parsed = JSON.parse(routineMatch[1]);
      if (Array.isArray(parsed)) {
        slots = parsed
          .filter((s: any) => s && (s.title || s.activity) && (s.startTimeStr || s.timeString))
          .map((s: any) => ({
            title: String(s.title || s.activity || "Routine Slot").trim(),
            startTimeStr: String(s.startTimeStr || s.timeString || "09:00 AM").trim(),
            endTimeStr: String(s.endTimeStr || "10:00 AM").trim(),
            activity: String(s.activity || s.title || "").trim(),
          }));
      }
    } catch (e) {
      console.warn("[VisionMemoryService] Failed to parse [ROUTINE_DATA] JSON:", e);
    }

    const cleanedText = text.replace(/\[ROUTINE_DATA:\s*\[\s*\{.*?\}\s*\]\s*\]/s, "").trim();
    return { cleanedText, slots };
  }

  /**
   * Processes and stores an incoming WhatsApp photo, image, video, PDF, document, or audio.
   */
  public async processIncomingMedia(
    buffer: Buffer,
    mimeType: string,
    sender: string,
    caption?: string,
    fileName?: string,
    chatId?: string
  ): Promise<{ analysis: string; ocrText?: string; mediaCategory: "image" | "video" | "document" | "audio"; shortSummary: string }> {
    const ai = this.getGenAI();
    let analysis = "Media received.";
    let ocrText = "";
    let shortSummary = "";
    let detectedSlots: RoutineSlotDraft[] = [];

    const lowerMime = (mimeType || "").toLowerCase();
    const isDoc = lowerMime.includes("pdf") || lowerMime.includes("document") || lowerMime.includes("text") || lowerMime.includes("sheet") || lowerMime.includes("presentation") || lowerMime.includes("msword");
    const isVideo = lowerMime.includes("video");
    const isAudio = lowerMime.includes("audio") || lowerMime.includes("ogg");
    const isImage = !isDoc && !isVideo && !isAudio;

    const mediaCategory: "image" | "video" | "document" | "audio" = isDoc ? "document" : isVideo ? "video" : isAudio ? "audio" : "image";

    try {
      if (ai) {
        const base64Data = buffer.toString("base64");

        let prompt = "";
        if (isDoc) {
          prompt = `You are Friday AI, DK's elite assistant. Analyze this received PDF/Document (${fileName || "document"}) thoroughly:
1. Document Type & Title:
2. Full Text / Key Content (OCR):
3. Key Financials, Dates, Names, Terms, or Action Items:
4. ROUTINE / TIMETABLE DETECTION: If this contains a daily routine, timetable, workout plan, or schedule (e.g. 4 bje jagna, 8 bje khana, study, etc.):
   - List the timetable slots.
   - Proactively suggest: "👉 *Boss, kya main iska daily reminder ya Friday routine set kar doon?* Bas reply karein: _'Haan set kar do'_ ya _'Set routine'_"
   - Append machine tag at the end: [ROUTINE_DATA: [{"title": "Jagna", "startTimeStr": "04:00 AM", "endTimeStr": "05:00 AM", "activity": "Morning Routine"}, ...]]
5. Short 2-sentence conversational summary in Hindi/Hinglish for Boss DK:
${caption ? `User caption: "${caption}"` : ""}`;
        } else if (isVideo) {
          prompt = `You are Friday AI. Analyze this received video:
1. Visual contents & key actions happening in the video:
2. People, objects, or text visible on screen:
3. Audio/Dialogue summary if present:
4. Short 2-sentence summary in Hindi/Hinglish for Boss DK:
${caption ? `User caption: "${caption}"` : ""}`;
        } else if (isAudio) {
          prompt = `You are Friday AI. Transcribe and analyze this voice note / audio:
1. Exact transcription of what was said:
2. Tone, intent, and context:
3. Short 2-sentence summary in Hindi/Hinglish for Boss DK:`;
        } else {
          prompt = `You are Friday AI. Analyze this photo/image in rich detail:
1. What is in this photo (people, objects, scene, setting, emotions)?
2. If there are people, describe their physical appearance (approx age, gender, hair, clothing, distinct traits) for identification.
3. If there is text in the image, extract all readable text (OCR).
4. ROUTINE / TIMETABLE DETECTION: If this photo contains a daily routine, timetable, workout plan, or schedule (e.g. 4 bje jagna, 8 bje khana, study/gym slots, etc.):
   - List the timetable slots clearly.
   - Proactively suggest: "👉 *Boss, kya main iska daily reminder ya Friday routine set kar doon?* Bas reply karein: _'Haan set kar do'_ ya _'Set routine'_"
   - Append machine tag at the end: [ROUTINE_DATA: [{"title": "Jagna", "startTimeStr": "04:00 AM", "endTimeStr": "05:00 AM", "activity": "Morning Routine"}, ...]]
5. Short 2-sentence summary in Hindi/Hinglish for Boss DK:
${caption ? `User caption: "${caption}"` : ""}`;
        }

        const normalizedMime = isDoc
          ? (lowerMime.includes("pdf") ? "application/pdf" : "application/pdf")
          : isVideo
            ? "video/mp4"
            : isAudio
              ? (lowerMime.includes("ogg") ? "audio/ogg" : "audio/mp3")
              : (lowerMime.includes("png") ? "image/png" : lowerMime.includes("webp") ? "image/webp" : "image/jpeg");

        const VISION_FALLBACK_MODELS = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.6-flash",
        ];

        for (const model of VISION_FALLBACK_MODELS) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType: normalizedMime,
                        data: base64Data,
                      },
                    },
                  ],
                },
              ],
            });

            if (response.text && response.text.trim()) {
              analysis = response.text;
              break;
            }
          } catch (modelErr: any) {
            console.warn(`[VisionMemoryService] Model ${model} failed: ${modelErr?.message || modelErr}`);
          }
        }

        // Parse routine slots and clean machine tag
        const routineExtracted = this.extractRoutineSlots(analysis);
        analysis = routineExtracted.cleanedText;
        detectedSlots = routineExtracted.slots;

        if (isDoc || analysis.toLowerCase().includes("text:") || analysis.toLowerCase().includes("ocr")) {
          ocrText = analysis;
        }

        // Extract first 2-3 lines as short summary
        const lines = analysis.split("\n").filter((l) => l.trim().length > 0);
        shortSummary = lines.slice(0, 3).join(" ").slice(0, 180);
      }
    } catch (e: any) {
      console.error("[VisionMemoryService] Media analysis error:", e);
      analysis = `${mediaCategory} received from ${sender} (Analysis error: ${e?.message || e})`;
      shortSummary = `${mediaCategory} received from ${sender}`;
    }

    // Cache latest media in memory and per-chat
    const isStatusMedia = chatId === "status@broadcast" || (fileName && fileName.startsWith("status_"));
    const cachedItem: CachedMediaContext = {
      buffer,
      mimeType,
      sender,
      caption: caption || fileName,
      fileName,
      analysis,
      ocrText,
      timestamp: Date.now(),
      shortSummary,
      detectedScheduleSlots: detectedSlots.length > 0 ? detectedSlots : undefined,
      isScheduleOrTimetable: detectedSlots.length > 0,
      isStatusMedia: !!isStatusMedia,
      chatId,
    };

    // STRICT ISOLATION: WhatsApp Status stories MUST NEVER overwrite chat latestMedia!
    if (!isStatusMedia) {
      this.latestMedia = cachedItem;
    }

    if (chatId) {
      this.latestMediaPerChat.set(chatId, cachedItem);
      const cleanPhone = chatId.replace(/@.*$/, "").replace(/\D/g, "");
      if (cleanPhone && !isStatusMedia) {
        this.latestMediaPerChat.set(cleanPhone, cachedItem);
      }
    }

    // Store in Firestore archive
    try {
      const mediaId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const thumbBase64 = buffer.length < 500000 ? buffer.toString("base64") : buffer.subarray(0, 400000).toString("base64");

      await db.collection("whatsappMediaArchive").doc(mediaId).set({
        id: mediaId,
        sender,
        mimeType,
        mediaCategory,
        caption: caption || fileName || "",
        analysis,
        ocrText: ocrText || "",
        shortSummary,
        timestamp: Date.now(),
        photoBase64: thumbBase64,
        isStatusMedia: !!isStatusMedia,
        chatId: chatId || "direct",
      });
    } catch (e) {
      console.warn("[VisionMemoryService] Failed to archive media in Firestore:", e);
    }

    return { analysis, ocrText, mediaCategory, shortSummary };
  }

  /**
   * Retrieves what is inside the latest received WhatsApp photo or PDF (chat only, never status).
   */
  public async getLatestMediaInfo(query?: string): Promise<{
    hasMedia: boolean;
    analysis: string;
    sender?: string;
    caption?: string;
    timeAgo?: string;
  }> {
    if (!this.latestMedia || this.latestMedia.isStatusMedia) {
      // Fallback: check Firestore, strictly excluding WhatsApp status stories!
      try {
        const snap = await db
          .collection("whatsappMediaArchive")
          .orderBy("timestamp", "desc")
          .limit(10)
          .get();
        if (!snap.empty) {
          const doc = snap.docs
            .map((d) => d.data() as StoredMediaItem & { isStatusMedia?: boolean; chatId?: string })
            .find((d) => !d.isStatusMedia && d.chatId !== "status@broadcast" && !d.id.startsWith("status_"));
          if (doc) {
            return {
              hasMedia: true,
              analysis: doc.analysis,
              sender: doc.sender,
              caption: doc.caption,
              timeAgo: "kuch der pehle",
            };
          }
        }
      } catch (e) {
        console.warn("[VisionMemoryService] Firestore fallback error:", e);
      }

      return {
        hasMedia: false,
        analysis: "Boss, abhi tak WhatsApp chat me koi naya photo ya document receive nahi hua hai.",
      };
    }

    const minutesAgo = Math.max(1, Math.round((Date.now() - this.latestMedia.timestamp) / 60000));
    return {
      hasMedia: true,
      analysis: this.latestMedia.analysis,
      sender: this.latestMedia.sender,
      caption: this.latestMedia.caption,
      timeAgo: `${minutesAgo} minute pehle`,
    };
  }

  /**
   * Generates a comprehensive, beautifully structured executive summary of a photo, PDF, document, or video.
   */
  public async generateMediaSummary(
    buffer: Buffer,
    mimeType: string,
    userInstruction?: string,
    fileName?: string,
    chatId?: string
  ): Promise<string> {
    // Immediately register chat media so it is isolated from status even if AI is slow or offline
    const initialItem: CachedMediaContext = {
      buffer,
      mimeType,
      sender: "User",
      caption: userInstruction || fileName,
      fileName,
      analysis: userInstruction || fileName || "Image received in chat",
      timestamp: Date.now(),
      shortSummary: userInstruction || fileName || "Image received in chat",
      isStatusMedia: false,
      chatId,
    };
    this.latestMedia = initialItem;
    if (chatId) {
      this.latestMediaPerChat.set(chatId, initialItem);
      const cleanPhone = chatId.replace(/@.*$/, "").replace(/\D/g, "");
      if (cleanPhone) {
        this.latestMediaPerChat.set(cleanPhone, initialItem);
      }
    }

    const ai = this.getGenAI();
    if (!ai) {
      return "⚠️ Summary generate nahi ho payi: Gemini API key configured nahi hai.";
    }

    const lowerMime = (mimeType || "").toLowerCase();
    const isDoc = lowerMime.includes("pdf") || lowerMime.includes("document") || lowerMime.includes("text") || lowerMime.includes("sheet") || lowerMime.includes("msword");
    const isVideo = lowerMime.includes("video");
    const isAudio = lowerMime.includes("audio") || lowerMime.includes("ogg");

    const normalizedMime = isDoc
      ? "application/pdf"
      : isVideo
        ? "video/mp4"
        : isAudio
          ? "audio/ogg"
          : (lowerMime.includes("png") ? "image/png" : lowerMime.includes("webp") ? "image/webp" : "image/jpeg");

    const base64Data = buffer.toString("base64");

    const prompt = `You are Friday, DK's (Divakar Kumar) ultra-intelligent AI assistant.
The user requested an executive summary of this attached ${isDoc ? `document/PDF (${fileName || "file"})` : isVideo ? "video" : isAudio ? "audio" : "photo/image"}.

USER INSTRUCTION/NOTE: "${userInstruction || "Provide a complete and structured executive summary."}"

CRITICAL INSTRUCTION - TIMETABLE / DAILY SCHEDULE DETECTION:
Check if this photo, PDF, document, or image contains a daily routine, timetable, study schedule, workout plan, or daily time-slots (e.g. "4:00 AM Jagna / Uthna", "8:00 AM Khana / Breakfast", "10:00 AM Study", "6:00 PM Gym", "10:00 PM Sona", etc.).

If a timetable or routine IS detected:
1. List the schedule slots cleanly under a dedicated section:
   ⏰ *Timetable / Routine Detected:*
   • 04:00 AM - 05:00 AM: Jagna / Morning Routine
   • 08:00 AM - 09:00 AM: Breakfast / Khana
2. Add an explicit, proactive suggestion for Boss DK:
   👉 *Boss, kya main is schedule ke daily reminders ya Friday routine me set kar doon?*
   Bas reply karein: _"Haan set kar do"_ ya _"Set routine"_ aur Friday aapko timely reminders deti rahegi!
3. AT THE VERY END OF YOUR RESPONSE, append this exact machine-readable tag containing the JSON array of slots so Friday can automatically parse and set it:
   [ROUTINE_DATA: [{"title": "Jagna", "startTimeStr": "04:00 AM", "endTimeStr": "05:00 AM", "activity": "Morning Routine"}, {"title": "Khana", "startTimeStr": "08:00 AM", "endTimeStr": "09:00 AM", "activity": "Breakfast"}]]
   (Rules for [ROUTINE_DATA]: title should be short, startTimeStr and endTimeStr in 12h format like '04:00 AM' or '08:00 PM', activity should be clear).

STRUCTURE YOUR RESPONSE IN CLEAN WHATSAPP FORMAT:
1. 📌 *Main Subject / Heading:* (What is this photo/document about?)
2. 📝 *Key Summary Points:* (3-6 bullet points covering the core takeaways, facts, message, or OCR text)
3. 🔍 *Important Specifics:* (Names, dates, amounts, links, or action items if present)
4. 💡 *Executive Takeaway (in natural Hinglish):* (1-2 lines summarizing the whole thing for quick reading)
(If timetable detected, include the Timetable & Suggestion sections described above!)

Use WhatsApp markdown (*bold*, _italic_, bullet points). Keep it clean, accurate, and easy to read.`;

    const VISION_FALLBACK_MODELS = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.1-flash-lite",
          "gemini-3.6-flash",
          "gemini-3.5-flash",
          "gemini-3.5-flash",
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
        ];

    for (const model of VISION_FALLBACK_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: normalizedMime,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        });

        const reply = response.text?.trim();
        if (reply) {
          const { cleanedText, slots } = this.extractRoutineSlots(reply);
          const finalReply = cleanedText;

          // Cache this summary in the chat context
          const cachedItem: CachedMediaContext = {
            buffer,
            mimeType,
            sender: "User",
            caption: userInstruction || fileName,
            fileName,
            analysis: finalReply,
            timestamp: Date.now(),
            shortSummary: finalReply.slice(0, 180),
            detectedScheduleSlots: slots.length > 0 ? slots : undefined,
            isScheduleOrTimetable: slots.length > 0,
            isStatusMedia: false,
            chatId,
          };
          this.latestMedia = cachedItem;
          if (chatId) {
            this.latestMediaPerChat.set(chatId, cachedItem);
            const cleanPhone = chatId.replace(/@.*$/, "").replace(/\D/g, "");
            if (cleanPhone) {
              this.latestMediaPerChat.set(cleanPhone, cachedItem);
            }
          }
          return finalReply;
        }
      } catch (err: any) {
        console.warn(`[VisionMemoryService] Summary generation model ${model} failed: ${err?.message || err}`);
      }
    }

    return "⚠️ Is file/photo ka summary analyze karne me dikkat aayi. Kripya dobara bhejein!";
  }

  /**
   * Answers specific follow-up questions regarding a photo, PDF, document, video, or summary card.
   * e.g. "meeting kab hai", "total bill amount kitna hai", "is document me date kya hai", etc.
   */
  public async answerQuestionOnMedia(options: {
    buffer?: Buffer | null;
    mimeType?: string;
    question: string;
    textContext?: string;
    fileName?: string;
    chatId?: string;
  }): Promise<string> {
    const ai = this.getGenAI();
    if (!ai) {
      return "⚠️ AI service configured nahi hai. Kripya GEMINI_API_KEY check karein.";
    }

    const { question, textContext, fileName, chatId } = options;
    let buffer = options.buffer;
    let mimeType = options.mimeType || "image/jpeg";

    // If buffer wasn't passed directly, check chat / global media cache
    if (!buffer) {
      const cached = this.getChatMediaContext(chatId);
      if (cached) {
        buffer = cached.buffer;
        mimeType = cached.mimeType || mimeType;
      }
    }

    const lowerMime = (mimeType || "").toLowerCase();
    const isDoc = lowerMime.includes("pdf") || lowerMime.includes("document") || lowerMime.includes("text") || lowerMime.includes("sheet") || lowerMime.includes("msword");
    const isVideo = lowerMime.includes("video");
    const isAudio = lowerMime.includes("audio") || lowerMime.includes("ogg");

    const normalizedMime = isDoc
      ? "application/pdf"
      : isVideo
        ? "video/mp4"
        : isAudio
          ? "audio/ogg"
          : (lowerMime.includes("png") ? "image/png" : lowerMime.includes("webp") ? "image/webp" : "image/jpeg");

    const VISION_FALLBACK_MODELS = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.1-flash-lite",
          "gemini-3.6-flash",
          "gemini-3.5-flash",
          "gemini-3.5-flash",
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
        ];

    // Case 1: We have media buffer -> multimodal vision query
    if (buffer && buffer.length > 0) {
      const base64Data = buffer.toString("base64");
      const prompt = `You are Friday, DK's (Divakar Kumar) ultra-intelligent AI assistant.
The user is asking a specific question about this attached ${isDoc ? `document/PDF (${fileName || "file"})` : isVideo ? "video" : isAudio ? "audio" : "photo/image"}.

USER QUESTION: "${question}"
${fileName ? `FILE NAME: "${fileName}"` : ""}
${textContext ? `PREVIOUS SUMMARY / CONTEXT:\n${textContext}` : ""}

INSTRUCTIONS:
1. Thoroughly read/scan all visible content, text (OCR), tables, dates, timings, names, amounts, headers, and bullet points.
2. Directly answer the user's question clearly, accurately, and politely in natural Hindi/Hinglish.
3. If they asked about a meeting (e.g. "meeting kab hai", "meeting timing", "kab milna hai"), extract the EXACT date, day, time (IST/AM/PM), meeting platform/link/location, and agenda if present in the media.
4. If they asked about money/bills/invoice (e.g. "kitna amount hai", "kisko bhejna hai"), clearly highlight the exact numbers, bank details, due date, etc.
5. Format with WhatsApp markdown (*bold*, bullet points, emojis).
6. If the requested information is not mentioned in this media, clearly state what information IS visible instead of making things up.`;

      for (const model of VISION_FALLBACK_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: normalizedMime,
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
          });

          const reply = response.text?.trim();
          if (reply) {
            const { cleanedText, slots } = this.extractRoutineSlots(reply);
            if (slots.length > 0) {
              const existing = this.getChatMediaContext(chatId);
              if (existing) {
                existing.detectedScheduleSlots = slots;
                existing.isScheduleOrTimetable = true;
              }
            }
            return cleanedText;
          }
        } catch (err: any) {
          console.warn(`[VisionMemoryService] Media Q&A model ${model} failed: ${err?.message || err}`);
        }
      }
    }

    // Case 2: We have textContext (e.g. quoted summary card, or OCR text)
    const contextToSearch = textContext || this.getChatMediaContext(chatId)?.analysis || this.getChatMediaContext(chatId)?.ocrText;
    if (contextToSearch && contextToSearch.trim().length > 0) {
      const prompt = `You are Friday, DK's ultra-intelligent AI assistant.
The user is asking a specific question regarding the following document/photo summary or OCR content:

CONTENT / SUMMARY / OCR:
"""
${contextToSearch}
"""

USER QUESTION: "${question}"

INSTRUCTIONS:
1. Extract the exact answer to the user's question from the provided summary/content.
2. Provide a direct, helpful, and concise response in friendly Hindi/Hinglish using WhatsApp formatting (*bold*, bullet points).
3. If the user asked "meeting kab hai", find and specify the meeting date, time, link/location.
4. If this is about a schedule or routine, list the slots and append [ROUTINE_DATA: [{"title": "...", "startTimeStr": "...", "endTimeStr": "...", "activity": "..."}]] and suggest: "👉 *Boss, kya main iska daily reminder ya Friday routine set kar doon?* Bas reply karein: _'Haan set kar do'_".
5. If not found in the summary, state clearly what the summary contains.`;

      const TEXT_MODELS = [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
      ];

      for (const model of TEXT_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          });
          const reply = response.text?.trim();
          if (reply) {
            const { cleanedText, slots } = this.extractRoutineSlots(reply);
            if (slots.length > 0) {
              const existing = this.getChatMediaContext(chatId);
              if (existing) {
                existing.detectedScheduleSlots = slots;
                existing.isScheduleOrTimetable = true;
              }
            }
            return cleanedText;
          }
        } catch (err: any) {
          console.warn(`[VisionMemoryService] Text Q&A model ${model} failed: ${err?.message || err}`);
        }
      }
    }

    return "⚠️ Is photo ya summary me aapke sawal ka jawab dhoondhne me dikkat aayi. Kripya dubara photo bhej kar ya quote karke poochhein!";
  }

  /**
   * Saves a person's identity, visual traits, and face profile into Firestore.
   * e.g. "Is photo me jo hai uska naam Rahul hai, yaad rakhna".
   */
  public async savePersonMemory(
    name: string,
    relation?: string,
    notes?: string,
    imageBuffer?: Buffer
  ): Promise<{ success: boolean; personId: string; summary: string }> {
    const targetBuffer = imageBuffer || this.latestMedia?.buffer;
    const targetMime = this.latestMedia?.mimeType || "image/jpeg";
    const ai = this.getGenAI();

    let visualSummary = `Person named ${name}.`;

    if (targetBuffer && ai) {
      try {
        const prompt = `You are Friday AI. Extract a detailed facial and biometric visual description of this person for permanent memory:
Person Name: "${name}"
Relationship / Context: "${relation || "Friend / Contact"}"
Additional Notes: "${notes || ""}"

Extract:
1. Facial Structure, skin tone, hair style & color, facial hair (beard/mustache), eye shape, glasses/accessories.
2. Distinctive physical traits that remain identifiable over months/years.
3. Summary of this person's visual fingerprint.`;

        for (const model of ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType: targetMime,
                        data: targetBuffer.toString("base64"),
                      },
                    },
                  ],
                },
              ],
            });
            if (response.text) {
              visualSummary = response.text;
              break;
            }
          } catch {}
        }
      } catch (e) {
        console.error("[VisionMemoryService] Error extracting visual profile:", e);
      }
    }

    const personId = `person_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now().toString(36)}`;
    const photoBase64 = targetBuffer && targetBuffer.length < 400000 ? targetBuffer.toString("base64") : undefined;

    const memory: StoredPersonMemory = {
      id: personId,
      name,
      relation: relation || "Contact",
      notes: notes || "",
      visualSummary,
      photoBase64,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.inMemoryPersonMemories.set(personId, memory);
    try {
      await db.collection("personMemories").doc(personId).set(memory, { merge: true });
    } catch (e) {
      console.warn("[VisionMemoryService] Firestore save error, using in-memory cache:", e);
    }
    console.log(`[VisionMemoryService] Stored person visual memory for "${name}" (ID: ${personId})`);

    return {
      success: true,
      personId,
      summary: `Boss, ${name} ka photo aur visual face data Firestore memory me permanently save ho gaya hai! Ab agar aap mahino baad bhi unki photo bhejenge, to main pehchan lungi.`,
    };
  }

  /**
   * Compares the given photo (or latest received photo) with all Firestore person memories
   * and identifies who is in the picture.
   */
  public async identifyPersonInPhoto(imageBuffer?: Buffer): Promise<{
    identified: boolean;
    personName?: string;
    relation?: string;
    explanation: string;
  }> {
    const targetBuffer = imageBuffer || this.latestMedia?.buffer;
    const targetMime = this.latestMedia?.mimeType || "image/jpeg";

    if (!targetBuffer) {
      return {
        identified: false,
        explanation: "Boss, pehchanne ke liye koi photo nahi mili. Kripya pehle WhatsApp par photo bhejien.",
      };
    }

    // 1. Fetch all stored person memories from Firestore or local cache
    let memories: StoredPersonMemory[] = [];
    try {
      const snap = await db.collection("personMemories").limit(50).get();
      if (!snap.empty) {
        memories = snap.docs.map((d) => d.data() as StoredPersonMemory);
      }
    } catch (e) {
      console.warn("[VisionMemoryService] Firestore fetch error, using in-memory cache:", e);
    }

    if (memories.length === 0) {
      memories = Array.from(this.inMemoryPersonMemories.values());
    }

    if (memories.length === 0) {
      return {
        identified: false,
        explanation: "Boss, memory me abhi koi person profile save nahi hai. Aap kisi ki photo bhej kar 'iska naam Rahul hai' bolenge to main save kar lungi.",
      };
    }
    const ai = this.getGenAI();

    if (!ai) {
      return {
        identified: false,
        explanation: "AI Vision service currently unavailable.",
      };
    }

    try {
      const memoryContext = memories.map((m) => ({
        id: m.id,
        name: m.name,
        relation: m.relation,
        notes: m.notes,
        visualSummary: m.visualSummary,
      }));

      const prompt = `You are Friday AI's Facial Recognition & Visual Memory Engine.
Analyze this photo and determine if the person in the photo matches ANY of the saved person profiles in memory:

SAVED PROFILES IN FIRESTORE:
${JSON.stringify(memoryContext, null, 2)}

TASK:
1. Examine facial features, hair, age, bone structure, and physical identity in the photo.
2. Compare with the visual descriptions of the saved profiles.
3. Return ONLY a valid JSON object:
{
  "matched": true | false,
  "personName": "Exact Name or empty",
  "relation": "Relation or empty",
  "confidence": "high" | "medium" | "low" | "none",
  "explanation": "Friendly 2-sentence conversational response in Hindi/Hinglish addressing Boss (DK) stating who this is and why you recognize them."
}`;

      let response: any = null;
      for (const model of ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: targetMime,
                      data: targetBuffer.toString("base64"),
                    },
                  },
                ],
              },
            ],
          });
          if (response?.text) break;
        } catch {}
      }

      const rawText = response.text || "{}";
      let parsed: any = {};
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = { matched: false, explanation: rawText };
      }

      if (parsed.matched && parsed.personName) {
        // Update last recognized timestamp
        const matchedDoc = memories.find((m) => m.name.toLowerCase() === parsed.personName.toLowerCase());
        if (matchedDoc) {
          await db.collection("personMemories").doc(matchedDoc.id).set(
            { lastRecognizedAt: Date.now() },
            { merge: true }
          );
        }

        return {
          identified: true,
          personName: parsed.personName,
          relation: parsed.relation,
          explanation: parsed.explanation || `Boss, ye ${parsed.personName} hain! Maine inka face Firestore memory se match kar liya hai.`,
        };
      } else {
        return {
          identified: false,
          explanation: parsed.explanation || "Boss, ye photo meri memory ke kisi saved person se match nahi hui. Agar aap inka naam batayenge, to main save kar lungi.",
        };
      }
    } catch (e: any) {
      console.error("[VisionMemoryService] Person identification error:", e);
      return {
        identified: false,
        explanation: `Recognition error: ${e?.message || e}`,
      };
    }
  }
}

export const visionMemoryService = new VisionMemoryService();
