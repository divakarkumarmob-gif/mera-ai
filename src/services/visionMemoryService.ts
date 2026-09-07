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
   */
  public getChatMediaContext(chatId?: string): CachedMediaContext | null {
    const oneHour = 60 * 60 * 1000;
    if (chatId && this.latestMediaPerChat.has(chatId)) {
      const item = this.latestMediaPerChat.get(chatId)!;
      if (Date.now() - item.timestamp < oneHour) {
        return item;
      }
    }
    if (this.latestMedia && Date.now() - this.latestMedia.timestamp < oneHour) {
      return this.latestMedia;
    }
    return null;
  }

  /**
   * Checks if user text is inquiring about a recent photo, PDF, file, or summary.
   */
  public isMediaQuestionIntent(text: string): boolean {
    const t = text.toLowerCase().trim();
    return (
      /\b(photo|image|picture|pic|pdf|doc|document|file|summary|invoice|bill|receipt|poster|notice|screenshot|chart|slide)\b/i.test(t) ||
      /\b(meeting|timing|time|kab\s*h|kab\s*hai|kahan\s*h|kahan\s*hai|kya\s*date|kya\s*time|kis\s*din|kis\s*time|kitna\s*amount|total\s*kitna|kisko\s*bhejna|account\s*no|ifsc|venue|location|kya\s*likha\s*hai|padh\s*ke\s*batao|isme\s*kya\s*hai)\b/i.test(t)
    );
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
4. Short 2-sentence conversational summary in Hindi/Hinglish for Boss DK:
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
4. Short 2-sentence summary in Hindi/Hinglish for Boss DK:
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
          "gemini-3.6-flash",
          "gemini-3.5-flash",
          "gemini-3.1-flash-lite",
          "gemini-2.0-flash",
          "gemini-1.5-pro",
          "gemini-1.5-flash",
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
    };
    this.latestMedia = cachedItem;
    if (chatId) {
      this.latestMediaPerChat.set(chatId, cachedItem);
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
      });
    } catch (e) {
      console.warn("[VisionMemoryService] Failed to archive media in Firestore:", e);
    }

    return { analysis, ocrText, mediaCategory, shortSummary };
  }

  /**
   * Retrieves what is inside the latest received WhatsApp photo or PDF.
   */
  public async getLatestMediaInfo(query?: string): Promise<{
    hasMedia: boolean;
    analysis: string;
    sender?: string;
    caption?: string;
    timeAgo?: string;
  }> {
    if (!this.latestMedia) {
      // Fallback: check Firestore
      try {
        const snap = await db
          .collection("whatsappMediaArchive")
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();
        if (!snap.empty) {
          const doc = snap.docs[0].data() as StoredMediaItem;
          return {
            hasMedia: true,
            analysis: doc.analysis,
            sender: doc.sender,
            caption: doc.caption,
            timeAgo: "kuch der pehle",
          };
        }
      } catch (e) {
        console.warn("[VisionMemoryService] Firestore fallback error:", e);
      }

      return {
        hasMedia: false,
        analysis: "Boss, abhi tak WhatsApp par koi naya photo ya document receive nahi hua hai.",
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

STRUCTURE YOUR RESPONSE IN CLEAN WHATSAPP FORMAT:
1. 📌 *Main Subject / Heading:* (What is this photo/document about?)
2. 📝 *Key Summary Points:* (3-6 bullet points covering the core takeaways, facts, message, or OCR text)
3. 🔍 *Important Specifics:* (Names, dates, amounts, links, or action items if present)
4. 💡 *Executive Takeaway (in natural Hinglish):* (1-2 lines summarizing the whole thing for quick reading)

Use WhatsApp markdown (*bold*, _italic_, bullet points). Keep it clean, accurate, and easy to read.`;

    const VISION_FALLBACK_MODELS = [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
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
          // Cache this summary in the chat context
          const cachedItem: CachedMediaContext = {
            buffer,
            mimeType,
            sender: "User",
            caption: userInstruction || fileName,
            fileName,
            analysis: reply,
            timestamp: Date.now(),
            shortSummary: reply.slice(0, 180),
          };
          this.latestMedia = cachedItem;
          if (chatId) {
            this.latestMediaPerChat.set(chatId, cachedItem);
          }
          return reply;
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
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
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
          if (reply) return reply;
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
4. If not found in the summary, state clearly what the summary contains.`;

      const TEXT_MODELS = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
      ];

      for (const model of TEXT_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          });
          const reply = response.text?.trim();
          if (reply) return reply;
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

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
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

        visualSummary = response.text || visualSummary;
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
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
