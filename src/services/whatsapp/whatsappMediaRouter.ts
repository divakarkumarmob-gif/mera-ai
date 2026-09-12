import * as BaileysModule from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";
import { QuotedMessageContext, ChatPhotoRecord, PendingLinkChoice } from "./whatsappTypes";

const baileys: any = BaileysModule;

export class WhatsAppMediaRouter {
  private chatRecentPhotos: Map<string, ChatPhotoRecord[]> = new Map();
  private chatPendingLinks: Map<string, PendingLinkChoice> = new Map();

  public recordChatPhoto(jid: string, buffer: Buffer, mimeType: string) {
    const list = this.chatRecentPhotos.get(jid) || [];
    list.unshift({ buffer, mimeType, timestamp: Date.now() });
    if (list.length > 4) list.pop();
    this.chatRecentPhotos.set(jid, list);
  }

  public getRecentPhotos(jid: string): ChatPhotoRecord[] {
    return this.chatRecentPhotos.get(jid) || [];
  }

  public getPendingLink(jid: string): PendingLinkChoice | undefined {
    return this.chatPendingLinks.get(jid);
  }

  public setPendingLink(jid: string, choice: PendingLinkChoice) {
    this.chatPendingLinks.set(jid, choice);
  }

  public deletePendingLink(jid: string) {
    this.chatPendingLinks.delete(jid);
  }

  public extractQuotedContext(msg: any): QuotedMessageContext | null {
    const m = msg.message;
    if (!m) return null;

    const contextInfo =
      m.extendedTextMessage?.contextInfo ||
      m.imageMessage?.contextInfo ||
      m.videoMessage?.contextInfo ||
      m.documentMessage?.contextInfo ||
      m.audioMessage?.contextInfo ||
      m.stickerMessage?.contextInfo ||
      m.buttonsResponseMessage?.contextInfo ||
      m.templateButtonReplyMessage?.contextInfo ||
      m.interactiveResponseMessage?.contextInfo;

    if (!contextInfo || !contextInfo.quotedMessage) return null;

    const q = contextInfo.quotedMessage;
    let text = "";
    let mediaType: QuotedMessageContext["mediaType"] = "text";

    if (q.conversation) {
      text = q.conversation;
      mediaType = "text";
    } else if (q.extendedTextMessage?.text) {
      text = q.extendedTextMessage.text;
      mediaType = "text";
    } else if (q.imageMessage) {
      mediaType = "photo";
      text = q.imageMessage.caption ? `[Photo: ${q.imageMessage.caption}]` : "[Photo / Image]";
    } else if (q.videoMessage) {
      mediaType = "video";
      text = q.videoMessage.caption ? `[Video: ${q.videoMessage.caption}]` : "[Video Clip]";
    } else if (q.documentMessage) {
      mediaType = "document";
      const name = q.documentMessage.fileName || "Document";
      text = q.documentMessage.caption ? `[Document ${name}: ${q.documentMessage.caption}]` : `[Document: ${name}]`;
    } else if (q.audioMessage) {
      mediaType = "audio";
      text = q.audioMessage.ptt ? "[Voice Note]" : "[Audio Recording]";
    } else if (q.locationMessage) {
      mediaType = "location";
      text = `[Location: Lat ${q.locationMessage.degreesLatitude}, Long ${q.locationMessage.degreesLongitude}]`;
    } else if (q.contactMessage) {
      mediaType = "contact";
      text = `[Contact Card: ${q.contactMessage.displayName}]`;
    } else if (q.stickerMessage) {
      mediaType = "sticker";
      text = "[Sticker]";
    }

    let sender = "Someone";
    let senderPhone: string | undefined;
    const participant = contextInfo.participant || contextInfo.participantAlt || "";
    const ownerNum = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const partPhone = participant.split("@")[0].split(":")[0].replace(/\D/g, "");

    if (partPhone) {
      senderPhone = partPhone;
      if (ownerNum && (partPhone.endsWith(ownerNum) || ownerNum.endsWith(partPhone))) {
        sender = "DK (Boss)";
      } else {
        sender = `+${partPhone}`;
      }
    }

    return {
      isReply: true,
      sender,
      senderPhone,
      text: text.trim(),
      mediaType,
      stanzaId: contextInfo.stanzaId,
      rawQuotedMessage: q,
      fileName: q.documentMessage?.fileName,
    };
  }

  public detectPhotoEditIntent(text: string): { isEdit: boolean; isSticker: boolean; instruction: string } {
    if (!text || !text.trim()) return { isEdit: false, isSticker: false, instruction: "" };
    const raw = text.trim();
    const lower = raw.toLowerCase();

    const isPureSticker =
      /^(?:@sticker|\/sticker|sticker|make\s*sticker|sticker\s*banao|sticker\s*bana\s*do|@bgremove|bgremove|remove\s*bg|bg\s*remove|bg\s*hatao|background\s*hatao|background\s*hata\s*do|bg\s*hata\s*do|bg\s*remove\s*karo|background\s*remove\s*karo)\s*$/i.test(lower);

    if (isPureSticker) {
      return { isEdit: false, isSticker: true, instruction: raw };
    }

    const isExplicitPrefix =
      /^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit|@modify|\/modify|modify)\b/i.test(lower);

    const hasPhotoTarget =
      /(?:is\s*photo|iss\s*photo|isme|is\s*image|is\s*pic|photo|image|pic|tasveer|tasvir|picture)\b/i.test(lower);

    const hasActionVerb =
      /\b(change|badal|badlo|badalna|badal\s*do|change\s*karo|change\s*kardo|lagao|laga\s*do|pehna|pehnao|pehna\s*do|phenoo|hatao|hata\s*do|remove|add|daalo|daal\s*do|karo|kardo|kar\s*do|banao|bana\s*do|convert|edit|modify|retouch|recolor|replace|karona|kijiye)\b/i.test(lower);

    const hasVisualAttribute =
      /\b(sunglass|sunglasses|chashma|chasma|spectacles|goggles|glass|glasses|color|colour|rang|blue|red|green|yellow|white|black|pink|purple|orange|gold|golden|silver|grey|gray|dark|light|shirt|tshirt|t-shirt|pant|jeans|dress|cloth|clothes|kapde|kapda|suit|coat|blazer|jacket|hoodie|tie|hat|cap|pagdi|turban|watch|chain|shoes|sneakers|hair|hairstyle|haircut|baal|blonde|brown|beard|daadhi|mustache|mooch|smile|smiling|face|skin|chehra|gora|dusk|glow|background|bg|piche|piche\s*ka|behind|beach|mountain|paris|tokyo|office|studio|room|night|sunset|lighting|light|filter|retouch|enhance|upscale|cinematic|vintage|black\s*and\s*white|b&w|cyberpunk|anime|cartoon|3d|avatar|shadow|hdr|bokeh|blur|wings|crown|neon)\b/i.test(lower);

    const isEdit =
      isExplicitPrefix ||
      (hasPhotoTarget && (hasActionVerb || hasVisualAttribute)) ||
      (hasActionVerb && hasVisualAttribute) ||
      /\b(sunglass|chasma|chashma|spectacles|goggles|suit|jacket|hat|cap|watch)\b/i.test(lower) ||
      /\b(colour\s*change|color\s*change|bg\s*change|background\s*change)\b/i.test(lower);

    const cleanInstruction = raw
      .replace(/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit|@modify|\/modify|modify)\s*[:=-]?\s*/i, "")
      .replace(/^(?:is\s*photo|iss\s*photo|isme|is\s*image|is\s*pic)\s*(?:me|mein|ko|par|ka|ki|ke)?\s*/i, "")
      .replace(/^[,.\s-]+/, "")
      .trim() || raw;

    return { isEdit, isSticker: false, instruction: cleanInstruction };
  }

  public async handleQuotedMediaSummary(
    replyJid: string,
    rawText: string,
    quotedMessage: QuotedMessageContext,
    messageKey: any,
    sock: any,
    sendMsgFn: (jid: string, text: string, incomingText?: string, key?: any) => Promise<any>,
    sendMediaFn: (jid: string, content: any, key?: any, fallback?: string) => Promise<any>,
    sendVoiceFn: (jid: string, buffer: Buffer, key?: any, mime?: string) => Promise<any>
  ): Promise<boolean> {
    const cleanText = rawText.toLowerCase().trim();
    const isSummaryIntent =
      /\b(summary|summarize|summarise|friday\s*summary|analysis|analyze|analyse|padho|explain|kya\s*likha\s*hai|kya\s*hai|batao|overview|read|ocr)\b/i.test(cleanText) ||
      cleanText.startsWith("@summary") ||
      cleanText.startsWith("/summary") ||
      cleanText.startsWith("summary");

    const { visionMemoryService } = await import("../visionMemoryService");
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");

    // Case 1: Quoted message has media (Photo / PDF / Document / Video / Audio)
    if (quotedMessage.rawQuotedMessage && quotedMessage.mediaType !== "text") {
      const downloadFn = baileys.downloadMediaMessage || baileys.default?.downloadMediaMessage;
      if (downloadFn) {
        try {
          const rawQ = quotedMessage.rawQuotedMessage;
          const isAudioMedia = quotedMessage.mediaType === "audio" || !!rawQ.audioMessage;
          const isPhotoEditIntent =
            quotedMessage.mediaType === "photo" &&
            (/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit)\b/i.test(rawText.trim()) ||
              rawText.match(/(?:is\s*photo|iss\s*photo|isme|is\s*image)\s*(?:me|ko|par|mein)?\s*(?:edit|change|badal|add|laga|remove|hata)/i));

          const isQuotedSticker =
            quotedMessage.mediaType === "photo" &&
            (/^(?:@sticker|\/sticker|sticker|make\s*sticker|sticker\s*banao|@bgremove|bgremove|remove\s*bg|bg\s*remove)\b/i.test(rawText.trim()) ||
              rawText.match(/(?:sticker\s*bana|bg\s*hata|background\s*hata)/i));

          const isQuotedExcel =
            (quotedMessage.mediaType === "photo" || quotedMessage.mediaType === "document") &&
            (/^(?:@excel|\/excel|@sheet|\/sheet|excel|spreadsheet|table\s*extract|bill\s*to\s*excel)\b/i.test(rawText.trim()) ||
              rawText.match(/(?:excel\s*me|sheet\s*me|excel\s*banao|table\s*banao|bill\s*extract|bill\s*to\s*excel)/i));

          const isQuotedAnimate =
            quotedMessage.mediaType === "photo" &&
            /^(?:@animate|\/animate|animate|motion|video\s*banao|animate\s*photo)\b/i.test(rawText.trim());

          if (isPhotoEditIntent) {
            const editInstruction = rawText
              .replace(/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit)\s*[:=-]?\s*/i, "")
              .trim() || rawText.trim();
            await sendMsgFn(replyJid, `🎨 *AI Photo edit ho rahi hai...* ⚡\n📝 _"${editInstruction}"_`, rawText, messageKey);
          } else if (isQuotedSticker) {
            await sendMsgFn(replyJid, `🪄 *Quoted photo se WhatsApp Sticker generate ho raha hai...* ⚡`, rawText, messageKey);
          } else if (isQuotedExcel) {
            await sendMsgFn(replyJid, `📊 *Quoted document/bill analyze karke Excel Sheet banayi ja rahi hai...* ⚡`, rawText, messageKey);
          } else if (isQuotedAnimate) {
            await sendMsgFn(replyJid, `🎬 *Quoted photo ko AI Motion Video me convert kiya ja raha hai...* ⚡`, rawText, messageKey);
          } else if (isAudioMedia) {
            await sendMsgFn(replyJid, `🎙️ *Quoted Audio / Voice Note decode & transcribe ho raha hai...* ⚡`, rawText, messageKey);
          } else if (isSummaryIntent && !visionMemoryService.isMediaQuestionIntent(rawText)) {
            await sendMsgFn(replyJid, `📑 *Quoted ${quotedMessage.mediaType.toUpperCase()} analyze & summarize ho raha hai...* ⚡`, rawText, messageKey);
          } else {
            await sendMsgFn(replyJid, `🔍 *Quoted ${quotedMessage.mediaType.toUpperCase()} me se dhoondh kar jawab de rahi hoon...* ⚡`, rawText, messageKey);
          }

          let buffer: Buffer | null = null;
          try {
            const qMsgWrapper = { message: quotedMessage.rawQuotedMessage };
            buffer = await downloadFn(qMsgWrapper, "buffer", {}, { reuploadRequest: sock?.updateMediaMessage });
          } catch (dlErr) {
            console.warn("[WhatsAppMediaRouter] Direct download on quoted media failed:", dlErr);
          }

          if ((!buffer || buffer.length === 0) && quotedMessage.mediaType === "photo") {
            const cached = this.chatRecentPhotos.get(replyJid)?.[0];
            if (cached?.buffer && cached.buffer.length > 0) {
              buffer = cached.buffer;
            }
          }

          if (buffer && buffer.length > 0) {
            const mimeType =
              rawQ.imageMessage?.mimetype ||
              rawQ.documentMessage?.mimetype ||
              rawQ.videoMessage?.mimetype ||
              rawQ.audioMessage?.mimetype ||
              (quotedMessage.mediaType === "photo" ? "image/jpeg" : quotedMessage.mediaType === "document" ? "application/pdf" : isAudioMedia ? "audio/ogg" : "video/mp4");
            const fileName = rawQ.documentMessage?.fileName || quotedMessage.fileName;

            if (isAudioMedia) {
              const { voiceBridgeService } = await import("../voiceBridgeService");
              const transcribed = await voiceBridgeService.transcribeAudio(buffer, mimeType, "quoted_voice.ogg");

              if (!transcribed || !transcribed.trim()) {
                await sendMsgFn(replyJid, "⚠️ Is voice note / audio me aawaz saaf sunai nahi de rahi ya audio empty hai.", rawText, messageKey);
                return true;
              }

              const targetLangMatch = cleanText.match(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/i);
              const targetLanguage = targetLangMatch ? targetLangMatch[1].trim() : null;
              const isVoiceOutputRequested = /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|padh\s*ke|voice\s*me)\b/i.test(cleanText);

              const apiKey = process.env.GEMINI_API_KEY;
              let replyText = "";
              let speechScript = "";

              if (apiKey) {
                const ai = new GoogleGenAI({ apiKey });
                const prompt = `You are Friday AI, DK's (Divakar Kumar) warm, affectionate, intelligent assistant.
Boss (DK) swiped-up / replied to an audio recording and asked: "${rawText}".

ORIGINAL SPOKEN AUDIO TRANSCRIPT:
"""
${transcribed}
"""

TARGET LANGUAGE (if explicitly asked): ${targetLanguage || "Default (Natural Friendly Hindi/Hinglish)"}

CRITICAL INSTRUCTIONS:
1. ALWAYS respond in natural, warm, conversational Hindi / Hinglish. Never write cold, formal English essays or robotic corporate memos.
2. Structure the WhatsApp response cleanly:
   - 🎙️ *Spoken Audio:* _"${transcribed}"_
   ${targetLanguage ? `- 🌐 *${targetLanguage} Translation:* (Accurate translation into ${targetLanguage})` : ""}
   - 💡 *Kya bol rahe hain:* (Clearly and warmly explain what the speaker is saying, their intention, and context in natural Hindi/Hinglish)
   - 📌 *Highlights:* (Any important dates, names, or tasks if present)
3. In a final section tagged with [SPEAK_START] and [SPEAK_END], provide a natural, sweet 1-2 sentence spoken script in ${targetLanguage || "natural Hindi/Hinglish"} for Friday to speak out loud to Boss DK on WhatsApp (e.g. "Boss, is audio me wo keh rahe hain ki..."). Do NOT use any asterisks or markdown inside [SPEAK_START]...[SPEAK_END].`;

                for (const model of ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]) {
                  try {
                    const resp = await ai.models.generateContent({ model, contents: prompt });
                    const fullResp = resp.text?.trim();
                    if (fullResp) {
                      const speakMatch = fullResp.match(/\[SPEAK_START\]([\s\S]*?)\[SPEAK_END\]/i);
                      speechScript = speakMatch ? speakMatch[1].trim() : "";
                      replyText = fullResp.replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "").trim();
                      break;
                    }
                  } catch {}
                }
              }

              if (!replyText) {
                replyText = `🎙️ *Voice Note Transcription:*\n_"${transcribed}"_\n\n💡 *Summary:* Spoken message successfully decoded.`;
              }

              await sendMsgFn(replyJid, replyText, rawText, messageKey);

              if (isVoiceOutputRequested || targetLanguage) {
                try {
                  const textToSpeak = speechScript || (targetLanguage ? `Yeh message ${targetLanguage} me keh raha hai: ${transcribed}` : `Boss, is audio me likha hai: ${transcribed}`);
                  const speechRes = await voiceBridgeService.generateSpeech(textToSpeak);
                  if (speechRes && speechRes.buffer.length > 0) {
                    await sendVoiceFn(replyJid, speechRes.buffer, messageKey, speechRes.mimeType);
                  }
                } catch (vErr) {
                  console.warn("[WhatsAppMediaRouter] Swipe audio TTS error:", vErr);
                }
              }
              return true;
            }

            if (isPhotoEditIntent) {
              const editInstruction = rawText
                .replace(/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit)\s*[:=-]?\s*/i, "")
                .trim() || rawText.trim();
              try {
                const { imageGenerationService } = await import("../imageGenerationService");
                const editRes = await imageGenerationService.editImageWithAI(buffer, editInstruction, mimeType);
                if (editRes.success && editRes.buffer && sock) {
                  this.recordChatPhoto(replyJid, editRes.buffer, editRes.mimeType || "image/jpeg");
                  await sendMediaFn(
                    replyJid,
                    {
                      image: editRes.buffer,
                      mimetype: editRes.mimeType || "image/jpeg",
                    },
                    messageKey,
                    editInstruction
                  );
                  await sendMsgFn(
                    replyJid,
                    `🎨 *Photo Edited via Friday AI* 🚀\n\n✨ *Engine:* ${editRes.model}\n✏️ *Changes:* _${editInstruction}_`,
                    "",
                    messageKey
                  );
                  return true;
                } else {
                  await sendMsgFn(replyJid, `❌ Photo edit nahi ho payi: ${editRes.error || "Please try again."}`, rawText, messageKey);
                  return true;
                }
              } catch (eErr: any) {
                console.error("[WhatsAppMediaRouter] Quoted photo edit error:", eErr);
                await sendMsgFn(replyJid, `❌ Photo edit error: ${eErr?.message || eErr}`, rawText, messageKey);
                return true;
              }
            }

            if (isQuotedSticker) {
              await sendMsgFn(replyJid, `🪄 *Quoted photo se WhatsApp Sticker generate ho raha hai...* ⚡`, rawText, messageKey);
              try {
                const { mediaToolsService } = await import("../mediaToolsService");
                const bgRes = await mediaToolsService.removeBackground(buffer, mimeType);
                const finalBuf = bgRes.buffer || buffer;
                if (sock) {
                  await sendMediaFn(
                    replyJid,
                    {
                      sticker: finalBuf,
                      mimetype: "image/webp",
                    },
                    messageKey,
                    "Sticker"
                  );
                  await sendMsgFn(replyJid, `✨ *AI WhatsApp Sticker Ready!* 🚀`, rawText, messageKey);
                  return true;
                }
              } catch (sErr: any) {
                console.error("[WhatsAppMediaRouter] Quoted sticker error:", sErr);
              }
            }

            if (isQuotedExcel) {
              await sendMsgFn(replyJid, `📊 *Quoted document/bill analyze karke Excel Sheet banayi ja rahi hai...* ⚡`, rawText, messageKey);
              try {
                const { mediaToolsService } = await import("../mediaToolsService");
                const excelRes = await mediaToolsService.convertImageToExcel(buffer, mimeType, rawText);
                if (excelRes.success && excelRes.buffer && sock) {
                  await sendMediaFn(
                    replyJid,
                    {
                      document: excelRes.buffer,
                      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      fileName: excelRes.filename || "Friday_Extracted_Report.xlsx",
                    },
                    messageKey,
                    "Excel Document"
                  );
                  await sendMsgFn(replyJid, excelRes.summary || "📊 *Excel File ready hai!*", rawText, messageKey);
                  return true;
                } else {
                  await sendMsgFn(replyJid, `❌ Excel generate nahi ho paya: ${excelRes.error || "Please try again."}`, rawText, messageKey);
                  return true;
                }
              } catch (xErr: any) {
                console.error("[WhatsAppMediaRouter] Quoted Excel extraction error:", xErr);
              }
            }

            if (isQuotedAnimate) {
              await sendMsgFn(replyJid, `🎬 *Quoted photo ko AI Motion Video me convert kiya ja raha hai...* ⚡`, rawText, messageKey);
              try {
                const { mediaToolsService } = await import("../mediaToolsService");
                const animRes = await mediaToolsService.generateAiVideo(rawText || "Cinematic camera motion, ultra-realistic", buffer, mimeType);
                if (animRes.success && animRes.buffer && sock) {
                  await sendMediaFn(
                    replyJid,
                    {
                      video: animRes.buffer,
                      mimetype: "video/mp4",
                    },
                    messageKey,
                    "Animation Video"
                  );
                  await sendMsgFn(replyJid, `🎬 *AI Motion Animation via ${animRes.model || "Friday AI"}* 🚀`, rawText, messageKey);
                  return true;
                }
              } catch (aErr: any) {
                console.error("[WhatsAppMediaRouter] Quoted animate error:", aErr);
              }
            }

            if (isSummaryIntent && !visionMemoryService.isMediaQuestionIntent(rawText)) {
              const summaryRes = await visionMemoryService.generateMediaSummary(buffer, mimeType, rawText, fileName, replyJid);
              await sendMsgFn(replyJid, summaryRes, rawText, messageKey);
            } else {
              const answerRes = await visionMemoryService.answerQuestionOnMedia({
                buffer,
                mimeType,
                question: rawText,
                fileName,
                chatId: replyJid,
              });
              await sendMsgFn(replyJid, answerRes, rawText, messageKey);
            }
            return true;
          }
        } catch (mediaErr) {
          console.warn("[WhatsAppMediaRouter] Quoted media download/QnA error:", mediaErr);
        }
      }
    }

    // Case 2: Quoted message contains a URL / Link
    const urlMatch = quotedMessage.text.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && isSummaryIntent) {
      await sendMsgFn(replyJid, `🌐 *Quoted URL analyze ho raha hai...* ⚡\n🔗 _${urlMatch[1]}_`, rawText, messageKey);
      const webSummary = await whatsappFeatureEngine.summarizeWebUrl(urlMatch[1], rawText);
      await sendMsgFn(replyJid, webSummary, rawText, messageKey);
      return true;
    }

    // Case 3: Quoted message is a Text message
    if (quotedMessage.text && quotedMessage.text.trim().length > 0) {
      const isPhotoEditIntentOnQuotedText =
        (/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit)\b/i.test(rawText.trim()) ||
          rawText.match(/(?:is\s*photo|iss\s*photo|isme|is\s*image|is\s*pic)\s*(?:me|ko|par|mein)?\s*(?:edit|change|badal|add|laga|remove|hata)/i)) &&
        (quotedMessage.text.includes("🎨") || quotedMessage.text.toLowerCase().includes("image") || quotedMessage.text.toLowerCase().includes("photo") || quotedMessage.text.toLowerCase().includes("prompt"));

      if (isPhotoEditIntentOnQuotedText) {
        const cached = this.chatRecentPhotos.get(replyJid)?.[0];
        if (cached && cached.buffer) {
          const editInstruction = rawText
            .replace(/^(?:@image\s*edit|@edit|\/edit|edit\s*photo|photo\s*edit|edit\s*karo|image\s*edit|edit\s*image|edit)\s*[:=-]?\s*/i, "")
            .trim() || rawText.trim();
          await sendMsgFn(replyJid, `🎨 *AI Generated Photo edit ho rahi hai...* ⚡\n📝 _"${editInstruction}"_`, rawText, messageKey);
          try {
            const { imageGenerationService } = await import("../imageGenerationService");
            const editRes = await imageGenerationService.editImageWithAI(cached.buffer, editInstruction, cached.mimeType || "image/jpeg");
            if (editRes.success && editRes.buffer && sock) {
              this.recordChatPhoto(replyJid, editRes.buffer, editRes.mimeType || "image/jpeg");
              await sendMediaFn(
                replyJid,
                {
                  image: editRes.buffer,
                  mimetype: editRes.mimeType || "image/jpeg",
                },
                messageKey,
                editInstruction
              );
              await sendMsgFn(
                replyJid,
                `🎨 *Photo Re-Edited via Friday AI* 🚀\n\n✨ *Engine:* ${editRes.model}\n✏️ *Changes:* _${editInstruction}_`,
                "",
                messageKey
              );
              return true;
            }
          } catch (eErr: any) {
            console.error("[WhatsAppMediaRouter] Quoted generated photo edit error:", eErr);
          }
        }
      }

      const isVoiceRequested = /\b(voice|audio|speak|bolo|sunao|bol\s*kar|bol\s*ke|padh\s*ke|voice\s*me)\b/i.test(cleanText);
      const isExplicitAnalysisRequested = /\b(summary\s*voice|analysis\s*voice|voice\s*summary|voice\s*analysis|summary|analysis|kya\s*likha\s*hai|kya\s*likha\s*h|kya\s*hai|samjhao|explain|batao|tarjuma|meaning|matlab)\b/i.test(cleanText);
      const targetLangMatch = cleanText.match(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/i);
      const targetLanguage = targetLangMatch ? targetLangMatch[1].trim() : null;

      if (isVoiceRequested && !isExplicitAnalysisRequested) {
        const { voiceBridgeService } = await import("../voiceBridgeService");
        try {
          let textToRead = quotedMessage.text;
          if (targetLanguage) {
            const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
            textToRead = await whatsappFeatureEngine.translateText(quotedMessage.text, targetLanguage);
          }
          const speechRes = await voiceBridgeService.generateSpeech(textToRead);
          if (speechRes && speechRes.buffer.length > 0) {
            await sendVoiceFn(replyJid, speechRes.buffer, messageKey, speechRes.mimeType);
            return true;
          }
        } catch (vErr) {
          console.warn("[WhatsAppMediaRouter] Direct voice read TTS error:", vErr);
        }
      }

      if (isExplicitAnalysisRequested || isSummaryIntent) {
        const { voiceBridgeService } = await import("../voiceBridgeService");
        const apiKey = process.env.GEMINI_API_KEY;

        if (apiKey) {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `You are Friday AI, DK's (Divakar Kumar) warm, affectionate, ultra-intelligent companion.
Boss (DK) swiped-up / quoted a message and asked for analysis/summary: "${rawText}".

QUOTED ORIGINAL MESSAGE:
"""
${quotedMessage.text}
"""

TARGET LANGUAGE (if explicitly asked like 'in english', 'in french'): ${targetLanguage || "Default (Natural Friendly Hindi/Hinglish)"}

CRITICAL LANGUAGE & TONE MANDATE:
1. ALWAYS speak and explain in natural, warm, conversational Hindi / Hinglish. Never output formal robotic English memos ("Hey Boss! I've analyzed...") or dry bullet-point essays unless Boss explicitly asked for "English".
2. Explain what the sender is saying in warm, sweet, direct Hindi/Hinglish (e.g. "Boss, is message me wo keh rahe hain ki...").
3. SPOKEN VOICE SCRIPT ([SPEAK_START] ... [SPEAK_END]):
   - Provide a natural 1-2 sentence spoken voice note script in ${targetLanguage || "pure natural conversational Hindi / Hinglish"}.
   - It must sound like Friday speaking directly to Boss DK on WhatsApp voice note (e.g. "Haanji Boss, is message me likha hai ki...").
   - DO NOT include any markdown symbols (*, _, #) inside [SPEAK_START]...[SPEAK_END]. It must be pure dialogue.`;

          for (const model of ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]) {
            try {
              const resp = await ai.models.generateContent({ model, contents: prompt });
              const fullResp = resp.text?.trim();
              if (fullResp) {
                const speakMatch = fullResp.match(/\[SPEAK_START\]([\s\S]*?)\[SPEAK_END\]/i);
                const speechScript = speakMatch ? speakMatch[1].trim() : "";
                const replyText = fullResp.replace(/\[SPEAK_START\][\s\S]*?\[SPEAK_END\]/gi, "").trim();

                await sendMsgFn(replyJid, replyText, rawText, messageKey);

                if (isVoiceRequested || targetLanguage) {
                  try {
                    const textToSpeak = speechScript || (targetLanguage ? `Yeh message ${targetLanguage} me keh raha hai: ${quotedMessage.text}` : `Boss, is message me likha hai: ${quotedMessage.text}`);
                    const speechRes = await voiceBridgeService.generateSpeech(textToSpeak);
                    if (speechRes && speechRes.buffer.length > 0) {
                      await sendVoiceFn(replyJid, speechRes.buffer, messageKey, speechRes.mimeType);
                    }
                  } catch (vErr) {
                    console.warn("[WhatsAppMediaRouter] Quoted text TTS error:", vErr);
                  }
                }
                return true;
              }
            } catch {}
          }
        }
      }
    }

    return false;
  }
}

export const whatsappMediaRouter = new WhatsAppMediaRouter();
