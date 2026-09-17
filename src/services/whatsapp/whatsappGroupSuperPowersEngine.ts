import { GoogleGenAI } from "@google/genai";
import { db } from "../firebaseAdmin";
import { QuotedMessageContext } from "./whatsappTypes";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";
import { intentClassifierService, ClassifiedIntent, IntentContext } from "../intentClassifierService";

export interface QuizQuestion {
  question: string;
  options: { [key: string]: string }; // A, B, C, D
  correctAnswer: string; // 'A' | 'B' | 'C' | 'D'
  explanation: string;
}

export interface ActiveGroupQuiz {
  groupId: string;
  topic: string;
  round: number;
  maxRounds: number;
  currentQuestion?: QuizQuestion;
  scores: Map<string, { name: string; points: number }>;
  startTime: number;
  answeredUsers: Set<string>;
}

export interface GroupBirthday {
  groupId: string;
  memberPhone: string;
  memberName: string;
  day: number;
  month: number;
  addedBy: string;
  addedAt: number;
  lastWishedYear?: number;
}

const bdayCol = () => db.collection("whatsapp_group_birthdays");
const decisionCol = () => db.collection("whatsapp_group_decisions");
const expenseCol = () => db.collection("whatsapp_group_expenses");

export class WhatsAppGroupSuperPowersEngine {
  private activeQuizzes: Map<string, ActiveGroupQuiz> = new Map();
  private birthdayCache: Map<string, GroupBirthday[]> = new Map();
  private loadedBirthdays = false;

  constructor() {
    this.preloadBirthdays().catch(() => {});
  }

  // ── LLM-Driven Intent Classification (Replaces 200+ Regex Patterns) ─────────
  
  private async classifyAndExecuteIntent(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    senderJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const context: IntentContext = {
      platform: "whatsapp",
      isGroup: true,
      isOwner,
      senderName,
      senderPhone,
      groupName,
      quotedMessage: quotedMessage?.text,
      recentMessages: await this.getRecentGroupMessages(groupJid, 10),
      timeOfDay: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      userTimezone: "Asia/Kolkata"
    };

    const classified = await intentClassifierService.classifyIntent(rawText, context);
    
    if (classified.action === "general_chat") {
      return { handled: false }; // Let other handlers process or return natural response
    }

    // Execute the classified intent
    return await this.executeClassifiedIntent(classified, {
      sock, groupJid, groupName, senderName, senderPhone, senderJid, messageKey, quotedMessage, isOwner
    });
  }

  private async getRecentGroupMessages(groupJid: string, limit: number): Promise<string[]> {
    try {
      const messages = await whatsappHistoryEngine.getMessages({ groupId: groupJid, limit });
      return messages.slice(0, limit).map(m => `${m.senderName}: ${m.text}`);
    } catch {
      return [];
    }
  }

  private async executeClassifiedIntent(
    classified: ClassifiedIntent,
    ctx: { sock: any; groupJid: string; groupName: string; senderName: string; senderPhone: string; senderJid: string; messageKey: any; quotedMessage?: QuotedMessageContext | null; isOwner: boolean }
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const { sock, groupJid, groupName, senderName, senderPhone, senderJid, messageKey, quotedMessage, isOwner } = ctx;
    const { action, parameters } = classified;

    try {
      switch (action) {
        case "make_phone_call":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss call laga sakte hain." };
          const { exotelService } = await import("../exotelService");
          const config = exotelService.getConfig();
          const targetPhone = parameters.targetPhone || config.bossNotificationNumber || process.env.BOSS_WHATSAPP_NUMBER || "919315570187";
          const callRes = await exotelService.makeOutboundCall({ to: targetPhone, customMessage: parameters.reason || "Group se call request" });
          return { handled: true, replyText: callRes.success 
            ? `📞 Ji Boss! Main abhi aapko (+${targetPhone}) par call laga rahi hoon...` 
            : `⚠️ Call connect nahi ho paayi: ${callRes.message}` };

        case "send_whatsapp_message":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss message bhej sakte hain." };
          const { sendWhatsAppUnified } = await import("../whatsappService");
          const { contactsService } = await import("../contactsService");
          const contact = await contactsService.findContact(parameters.contactNameOrPhone);
          const targetNum = contact ? contact.phone : String(parameters.contactNameOrPhone).replace(/[\s\-\(\)\+]/g, "");
          const sendRes = await sendWhatsAppUnified(targetNum, parameters.messageText);
          return { handled: true, replyText: sendRes.success ? "✅ Message bhej diya!" : `❌ ${sendRes.message}` };

        case "save_contact":
          const { contactsService: cs } = await import("../contactsService");
          const entry = await cs.saveContact(parameters.contactName, parameters.phoneNumber, parameters.relation);
          return { handled: true, replyText: `📇 Contact "${entry.name}" (+${entry.phone}) save kar diya!` };

        case "lookup_phone_details":
          const { phoneIntelligenceService } = await import("../phoneIntelligenceService");
          const report = await phoneIntelligenceService.lookup(parameters.phoneNumber);
          return { handled: true, replyText: phoneIntelligenceService.formatReportMarkdown(report, "whatsapp") };

        case "play_music":
          const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
          const musicRes = await whatsappFeatureEngine.searchAndPlayMusic(groupJid, parameters.songQuery, senderName);
          if (musicRes.audioBuffer && sock) {
            await sock.sendMessage(groupJid, { audio: musicRes.audioBuffer, mimetype: "audio/mp4", ptt: false });
          }
          return { handled: true, replyText: musicRes.replyText || "🎵 Music baj raha hai!" };

        case "get_weather":
          const { weatherService } = await import("../weatherService");
          const weather = await weatherService.getWeather(parameters.place);
          return { handled: true, replyText: weather || "Weather fetch nahi ho paya." };

        case "get_news":
          const { newsService } = await import("../newsService");
          const news = await newsService.getNews(parameters.topic, "in", parameters.count || 10);
          return { handled: true, replyText: news || "News fetch nahi ho payi." };

        case "set_reminder":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss reminder set kar sakte hain." };
          const { reminderScheduler } = await import("../reminderScheduler");
          await reminderScheduler.addReminder(parameters.title, parameters.timeString);
          return { handled: true, replyText: `⏰ Reminder set: "${parameters.title}" for ${parameters.timeString}` };

        case "save_daily_update":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss update save kar sakte hain." };
          const { dailyUpdateService } = await import("../dailyUpdateService");
          await dailyUpdateService.appendUpdate(parameters.updateText);
          return { handled: true, replyText: "📝 Aaj ka update save kar diya!" };

        case "get_daily_update":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss update dekh sakte hain." };
          const { dailyUpdateService: dus, resolveRelativeDateIST } = await import("../dailyUpdateService");
          const date = resolveRelativeDateIST(parameters.dateWord);
          const update = await dus.getUpdateForDate(date);
          return { handled: true, replyText: update?.text || `📅 ${date} ke liye koi update nahi hai.` };

        case "search_memory":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss memory search kar sakte hain." };
          const { vectorMemoryService } = await import("../vectorMemoryService");
          const results = await vectorMemoryService.searchSemanticMemory(parameters.searchQuery, 5, 0.15, parameters.filterDate ? { exactDate: parameters.filterDate } : undefined);
          if (results.results.length === 0) return { handled: true, replyText: "🔍 Koi purani memory nahi mili." };
          return { handled: true, replyText: results.results.map(r => `📅 ${r.dateRange}: ${r.summary}`).join("\n\n") };

        case "remember_fact":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss fact save kar sakte hain." };
          const { memoryEngine } = await import("../memoryEngine");
          await memoryEngine.addPersonalVaultFact(parameters.category || "general_personal_info", parameters.factText);
          return { handled: true, replyText: "🔒 Fact permanent memory me save kar diya!" };

        case "translate_text":
          const { toolsEngine } = await import("../toolsEngine");
          const translated = await toolsEngine.translateText(parameters.text, parameters.targetLanguage);
          return { handled: true, replyText: `🌐 *Translation (${parameters.targetLanguage}):*\n${translated}` };

        case "generate_ai_image":
          const { toolsEngine: te } = await import("../toolsEngine");
          const imgRes = await te.generateAiPhoto(parameters.prompt, { aspectRatio: parameters.aspectRatio || "9:16", sendToWhatsApp: parameters.sendToWhatsApp, targetRecipient: "group" });
          if (imgRes.success && imgRes.imageUrl && sock) {
            await sock.sendMessage(groupJid, { image: { url: imgRes.imageUrl }, caption: imgRes.message });
          }
          return { handled: true, replyText: imgRes.success ? imgRes.message : `❌ ${imgRes.message}` };

        case "analyze_youtube_video":
          const { youtubeService } = await import("../youtubeService");
          const videoId = youtubeService.extractVideoId(parameters.videoUrl);
          if (!videoId) return { handled: true, replyText: "❌ Valid YouTube URL/ID do." };
          const analysis = await youtubeService.analyzeVideo(videoId);
          let card = `🎬 *${analysis.title}*\n👤 ${analysis.channelName}\n\n${analysis.summary}`;
          if (analysis.chapters?.length) card += "\n\n⏱️ " + analysis.chapters.slice(0,5).map(c => `[${c.startFormatted}] ${c.title}`).join("\n");
          return { handled: true, replyText: card };

        case "get_cricket_scores":
          const { publicApisService } = await import("../publicApisService");
          const cricket = await publicApisService.getCricketScores(parameters.team);
          return { handled: true, replyText: cricket || "Cricket score fetch nahi hua." };

        case "search_web":
          const { humanBrowserService } = await import("../humanBrowserService");
          const browseRes = await humanBrowserService.searchGoogleAndInspect(parameters.query);
          return { handled: true, replyText: browseRes.success ? browseRes.summary : `❌ ${browseRes.message}` };

        case "schedule_message":
          const { whatsappFeatureEngine: wfe } = await import("../whatsappFeatureEngine");
          await wfe.scheduleContactMessage(parameters.contactNameOrPhone, parameters.messageBody, parameters.timeInstruction);
          return { handled: true, replyText: `📅 Message scheduled for ${parameters.timeInstruction}!` };

        case "create_cron_task":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss cron task bana sakte hain." };
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
          await scheduledAutomationService.createCronTask({
            title: parameters.title, timeString: parameters.timeString, frequency: parameters.frequency || "daily",
            actionType: parameters.actionType, city: parameters.city, messageBody: parameters.messageBody
          });
          return { handled: true, replyText: `⏰ Cron task "${parameters.title}" bana diya!` };

        case "get_whatsapp_messages":
          const msgs = await whatsappHistoryEngine.getMessages({ messageType: parameters.messageType || "all", senderName: parameters.senderName, groupName: parameters.groupName, dateFilter: parameters.dateFilter, limit: parameters.limit });
          if (msgs.length === 0) return { handled: true, replyText: "📭 Koi message nahi mila." };
          return { handled: true, replyText: msgs.slice(0,10).map(m => `[${m.dateStr}] ${m.senderName}: ${m.text}`).join("\n") };

        case "get_conversation_history":
          const { whatsappBotService } = await import("../whatsappBotService");
          const conv = await whatsappBotService.getConversationSummaryAndHistory(parameters.contactNameOrPhone, parameters.limit || 30, parameters.daysBack || 7);
          return { handled: true, replyText: conv.summary || "Conversation history nahi mili." };

        case "set_routine":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss routine set kar sakte hain." };
          const { bossRoutineService } = await import("../bossRoutineService");
          if (parameters.slots?.length) {
            await bossRoutineService.setFullRoutine(parameters.slots);
            return { handled: true, replyText: "📅 Poora routine set kar diya!" };
          }
          if (parameters.slotQuery) {
            await bossRoutineService.updateRoutineSlot(parameters.slotQuery, { startTimeStr: parameters.startTimeStr, endTimeStr: parameters.endTimeStr, activity: parameters.activity });
            return { handled: true, replyText: `📅 ${parameters.slotQuery} routine update kar diya!` };
          }
          return { handled: false };

        case "get_routine":
          const { bossRoutineService: brs } = await import("../bossRoutineService");
          const routine = await brs.getAllRoutineSlots();
          const current = brs.getCurrentHabit();
          let routineText = `🕐 Abhi: ${current.currentSlot?.title || "Free"} (${current.istTimeStr})\n📅 Agla: ${current.nextSlot?.title || "Free"}\n\n`;
          routineText += routine.map(s => `• ${s.timeRangeStr}: ${s.title} - ${s.activity}`).join("\n");
          return { handled: true, replyText: routineText };

        case "group_admin_action":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss/Admin ye kar sakte hain." };
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          switch (parameters.action) {
            case "kick":
              await whatsappGroupSafetyEngine.kickMember(sock, groupJid, parameters.targetMember);
              return { handled: true, replyText: `👢 ${parameters.targetMember} ko group se nikaal diya!` };
            case "delete_message":
              await whatsappGroupSafetyEngine.deleteMessage(sock, groupJid, parameters.targetMember, senderPhone);
              return { handled: true, replyText: "🗑️ Message delete kar diya!" };
            default:
              return { handled: false };
          }

        case "group_safety_toggle":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss/Admin toggle kar sakte hain." };
          const { whatsappGroupSafetyEngine: wgse } = await import("./whatsappGroupSafetyEngine");
          switch (parameters.feature) {
            case "block_safe":
              if (parameters.enable) await wgse.enableGroupSafety(groupJid, groupName);
              else await wgse.disableGroupSafety(groupJid);
              return { handled: true, replyText: `🛡️ @block safe ${parameters.enable ? "ON" : "OFF"} kar diya!` };
            case "auto_transcribe":
              await wgse.toggleAutoTranscribeVoice(groupJid, parameters.enable);
              return { handled: true, replyText: `🎙️ Auto-transcribe ${parameters.enable ? "ON" : "OFF"} kar diya!` };
            case "quiet_mode":
              const { whatsappGroupSuperPowersEngine } = await import("./whatsappGroupSuperPowersEngine");
              await whatsappGroupSuperPowersEngine.toggleGroupQuietMode(groupJid, parameters.enable);
              return { handled: true, replyText: `🌙 Quiet mode ${parameters.enable ? "ON" : "OFF"} kar diya!` };
            case "welcome":
              await whatsappGroupSuperPowersEngine.toggleGroupWelcome(groupJid, parameters.enable);
              return { handled: true, replyText: `👋 Welcome card ${parameters.enable ? "ON" : "OFF"} kar diya!` };
          }
          return { handled: false };

        case "create_poll":
          const { whatsappGroupSuperPowersEngine: wgsp } = await import("./whatsappGroupSuperPowersEngine");
          return await wgsp.handlePollCreator(sock, groupJid, parameters.topicOrQuestion, senderName);

        case "generate_quiz":
          return await this.handleGroupQuiz(groupJid, `@quiz start ${parameters.topic}`, senderName, senderPhone);

        case "identify_song":
          if (!parameters.hasAudio) return { handled: true, replyText: "🎵 Voice note bhejo taaki main gaana pehchaan sakun!" };
          return { handled: false }; // Will be handled by voice message handler

        case "analyze_media":
          const { visionMemoryService } = await import("../visionMemoryService");
          const mediaRes = await visionMemoryService.getLatestMediaInfo(parameters.query);
          return { handled: true, replyText: mediaRes.analysis || "Media analyze nahi ho paya." };

        case "voice_mode_toggle":
          const { voiceBridgeService } = await import("../voiceBridgeService");
          await voiceBridgeService.setBossGlobalVoice(parameters.voiceTone);
          return { handled: true, replyText: `🎙️ Voice tone "${parameters.voiceTone}" set kar diya!` };

        case "check_session_health":
          const { whatsappSessionHealthEngine } = await import("./whatsappSessionHealthEngine");
          return { handled: true, replyText: whatsappSessionHealthEngine.getFormattedBossReport() };

        case "unpause_bot":
          const { whatsappSessionHealthEngine: wshe } = await import("./whatsappSessionHealthEngine");
          const unpauseRes = parameters.password ? wshe.manualUnpause(parameters.password) : wshe.manualUnpause("");
          return { handled: true, replyText: unpauseRes.message };

        case "teach_friday":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss Friday ko sikha sakte hain." };
          const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
          await fridayChildTrainingService.teachLesson(parameters.situationTrigger, parameters.taughtReaction, { category: parameters.category });
          return { handled: true, replyText: "📚 Lesson sikha diya! Ab main ye yaad rakhungi." };

        case "correct_friday":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss correction de sakte hain." };
          const { fridayChildTrainingService: fcts } = await import("../fridayChildTrainingService");
          await fcts.correctPreviousMistake(parameters.correctionText);
          return { handled: true, replyText: "✅ Correction note kar liya! Dobara nahi hoga." };

        case "add_directive":
          if (!isOwner) return { handled: true, replyText: "Sirf Boss directive de sakte hain." };
          const { bossDirectivesService } = await import("../bossDirectivesService");
          await bossDirectivesService.addDirective(parameters.ruleText, { targetWord: parameters.targetWord, replacementWord: parameters.replacementWord, type: parameters.type });
          return { handled: true, replyText: "📋 Directive save kar diya! Strictly follow karungi." };

        default:
          return { handled: false };
      }
    } catch (error: any) {
      console.error(`[GroupSuperPowers] Intent execution error for ${action}:`, error);
      return { handled: true, replyText: `⚠️ ${action} execute karne me dikkat aayi: ${error?.message || error}` };
    }
  }

  private async preloadBirthdays() {
    if (this.loadedBirthdays) return;
    try {
      const snap = await bdayCol().get();
      this.birthdayCache.clear();
      snap.forEach((doc) => {
        const data = doc.data() as GroupBirthday;
        if (data && data.groupId) {
          const list = this.birthdayCache.get(data.groupId) || [];
          list.push(data);
          this.birthdayCache.set(data.groupId, list);
        }
      });
      this.loadedBirthdays = true;
    } catch (e) {
      console.warn("[GroupSuperPowers] Failed to preload birthdays:", e);
    }
  }

  // ── Trigger Matcher ────────────────────────────────────────────────────────

  public isSuperPowerCommand(text: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return (
      clean.startsWith("@tagall") ||
      clean.startsWith("/tagall") ||
      clean.startsWith("@everyone") ||
      clean.startsWith("/everyone") ||
      clean.startsWith("@judge") ||
      clean.startsWith("/judge") ||
      clean.startsWith("@factcheck") ||
      clean.startsWith("/factcheck") ||
      clean.startsWith("@debate") ||
      clean.startsWith("/debate") ||
      clean.startsWith("@roast") ||
      clean.startsWith("/roast") ||
      clean.startsWith("@praise") ||
      clean.startsWith("/praise") ||
      clean.startsWith("@hypeman") ||
      clean.startsWith("/hypeman") ||
      clean.startsWith("@quiz") ||
      clean.startsWith("/quiz") ||
      clean.startsWith("@trivia") ||
      clean.startsWith("/trivia") ||
      clean.startsWith("@split") ||
      clean.startsWith("/split") ||
      clean.startsWith("@bill") ||
      clean.startsWith("/bill") ||
      clean.startsWith("@hisab") ||
      clean.startsWith("/hisab") ||
      clean.startsWith("@decision") ||
      clean.startsWith("/decision") ||
      clean.startsWith("@todo") ||
      clean.startsWith("/todo") ||
      clean.startsWith("@notes") ||
      clean.startsWith("/notes") ||
      clean.startsWith("@birthday") ||
      clean.startsWith("/birthday") ||
      clean.startsWith("@bday") ||
      clean.startsWith("/bday") ||
      clean.startsWith("@meme") ||
      clean.startsWith("/meme") ||
      clean.startsWith("@poll") ||
      clean.startsWith("/poll") ||
      clean.startsWith("@translate") ||
      clean.startsWith("/translate") ||
      clean.startsWith("@vibe") ||
      clean.startsWith("/vibe") ||
      clean.startsWith("@icebreaker") ||
      clean.startsWith("/icebreaker") ||
      clean.startsWith("@joke") ||
      clean.startsWith("/joke") ||
      clean.startsWith("@liedetector") ||
      clean.startsWith("/liedetector") ||
      clean.startsWith("@lie") ||
      clean.startsWith("/lie") ||
      clean.startsWith("@psychology") ||
      clean.startsWith("@rap") ||
      clean.startsWith("/rap") ||
      clean.startsWith("@future") ||
      clean.startsWith("/future") ||
      clean.startsWith("@oracle") ||
      clean.startsWith("/oracle") ||
      clean.startsWith("@kismat") ||
      clean.startsWith("@srk") ||
      clean.startsWith("/srk") ||
      clean.startsWith("@tonystark") ||
      clean.startsWith("/tonystark") ||
      clean.startsWith("@amitabh") ||
      clean.startsWith("@modi") ||
      clean.startsWith("@speakas") ||
      clean.startsWith("/speakas") ||
      clean.startsWith("@mimic") ||
      clean.startsWith("/mimic") ||
      clean.startsWith("@clone") ||
      clean.startsWith("/clone") ||
      clean.startsWith("@movie") ||
      clean.startsWith("/movie") ||
      clean.startsWith("@poster") ||
      clean.startsWith("/poster") ||
      clean.startsWith("@commentary") ||
      clean.startsWith("/commentary") ||
      clean.startsWith("@song") ||
      clean.startsWith("/song") ||
      clean.startsWith("@gaana") ||
      clean.startsWith("/gaana") ||
      clean.startsWith("@music") ||
      clean.startsWith("/music") ||
      clean.startsWith("@hum") ||
      clean.startsWith("/hum") ||
      clean.startsWith("@shazam") ||
      clean.startsWith("/shazam") ||
      clean.startsWith("@reel") ||
      clean.startsWith("/reel") ||
      clean.startsWith("@bgm") ||
      clean.startsWith("/bgm") ||
      clean.startsWith("@short") ||
      clean.startsWith("/short") ||
      clean.startsWith("@groupchart") ||
      clean.startsWith("/groupchart") ||
      clean.startsWith("@topchart") ||
      clean.startsWith("/topchart") ||
      clean.startsWith("@chart") ||
      clean.startsWith("/chart") ||
      /^(?:tag\s*all|everyone|fact\s*check|ai\s*judge|roast\s*me|start\s*quiz|split\s*bill|group\s*decision|group\s*birthday|make\s*meme|create\s*poll|translate\s*to|group\s*vibe|tell\s*joke|lie\s*detector|rap\s*banao|future\s*prediction|movie\s*cast|match\s*commentary|find\s*song|song\s*dhundo|group\s*chart|shazam|humming)/i.test(clean)
    );
  }

  // ── Main Super Power Dispatcher ───────────────────────────────────────────

  public async handleSuperPowerCommand(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    senderJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const clean = (rawText || "").toLowerCase().trim();

    // 1. @tagall / @everyone Announcement Broadcast
    if (
      clean.startsWith("@tagall") ||
      clean.startsWith("/tagall") ||
      clean.startsWith("@everyone") ||
      clean.startsWith("/everyone") ||
      clean === "tag all" ||
      clean === "everyone"
    ) {
      return await this.handleTagAll(sock, groupJid, groupName, rawText, senderName);
    }

    // 2. @judge / @factcheck AI Courtroom & Fact-Checker
    if (
      clean.startsWith("@judge") ||
      clean.startsWith("/judge") ||
      clean.startsWith("@factcheck") ||
      clean.startsWith("/factcheck") ||
      clean.startsWith("@debate") ||
      clean.startsWith("/debate")
    ) {
      return await this.handleJudgeFactCheck(rawText, quotedMessage, senderName);
    }

    // 3. @roast / @praise Entertainment Engine
    if (
      clean.startsWith("@roast") ||
      clean.startsWith("/roast") ||
      clean.startsWith("@praise") ||
      clean.startsWith("/praise") ||
      clean.startsWith("@hypeman")
    ) {
      return await this.handleRoastAndPraise(rawText, quotedMessage, senderName);
    }

    // 4. @quiz / @trivia Live Group Game Arena
    if (clean.startsWith("@quiz") || clean.startsWith("/quiz") || clean.startsWith("@trivia") || clean.startsWith("/trivia")) {
      return await this.handleGroupQuiz(groupJid, rawText, senderName, senderPhone);
    }

    // 5. @split / @bill / @hisab Expense Splitter
    if (clean.startsWith("@split") || clean.startsWith("/split") || clean.startsWith("@bill") || clean.startsWith("/bill") || clean.startsWith("@hisab")) {
      return await this.handleBillSplit(rawText, groupName, senderName);
    }

    // 6. @decision / @todo / @notes Action-Item Tracker
    if (clean.startsWith("@decision") || clean.startsWith("/decision") || clean.startsWith("@todo") || clean.startsWith("/todo") || clean.startsWith("@notes")) {
      return await this.handleDecisionTracker(groupJid, groupName, rawText, quotedMessage);
    }

    // 7. @birthday / @bday Auto-Celebrator
    if (clean.startsWith("@birthday") || clean.startsWith("/birthday") || clean.startsWith("@bday") || clean.startsWith("/bday")) {
      return await this.handleBirthdayManager(groupJid, groupName, rawText, senderName, senderPhone, quotedMessage);
    }

    // 8. @meme AI Meme & Sticker Generator
    if (clean.startsWith("@meme") || clean.startsWith("/meme") || clean.startsWith("meme")) {
      return await this.handleMemeGenerator(sock, groupJid, rawText, senderName, quotedMessage);
    }

    // 9. @poll WhatsApp Interactive Poll Creator
    if (clean.startsWith("@poll") || clean.startsWith("/poll") || clean.startsWith("poll")) {
      return await this.handlePollCreator(sock, groupJid, rawText, senderName);
    }

    // 10. @translate Multi-Language Live Translator
    if (clean.startsWith("@translate") || clean.startsWith("/translate") || clean.startsWith("translate")) {
      return await this.handleLiveTranslator(rawText, quotedMessage, senderName);
    }

    // 11. @vibe / @icebreaker / @joke Group Mood & Icebreaker
    if (
      clean.startsWith("@vibe") ||
      clean.startsWith("/vibe") ||
      clean.startsWith("@icebreaker") ||
      clean.startsWith("/icebreaker") ||
      clean.startsWith("@joke") ||
      clean.startsWith("/joke")
    ) {
      return await this.handleVibeRadarAndIcebreaker(groupJid, groupName, rawText, senderName);
    }

    // 12. @liedetector / @psychology Polygraph & Lie Detector
    if (
      clean.startsWith("@liedetector") ||
      clean.startsWith("/liedetector") ||
      clean.startsWith("@lie") ||
      clean.startsWith("/lie") ||
      clean.startsWith("@psychology")
    ) {
      return await this.handleLieDetector(rawText, quotedMessage, senderName);
    }

    // 13. @rap Desi Hip-Hop Rap Generator
    if (clean.startsWith("@rap") || clean.startsWith("/rap") || clean.startsWith("rap")) {
      return await this.handleDesiRapGenerator(rawText, quotedMessage, senderName);
    }

    // 14. @future / @oracle Time-Machine Future Prediction
    if (
      clean.startsWith("@future") ||
      clean.startsWith("/future") ||
      clean.startsWith("@oracle") ||
      clean.startsWith("/oracle") ||
      clean.startsWith("@kismat")
    ) {
      return await this.handleFutureOracle(rawText, quotedMessage, senderName);
    }

    // 15. @srk / @tonystark / @amitabh / @modi / @speakas Celebrity Clone
    if (
      clean.startsWith("@srk") ||
      clean.startsWith("/srk") ||
      clean.startsWith("@tonystark") ||
      clean.startsWith("/tonystark") ||
      clean.startsWith("@amitabh") ||
      clean.startsWith("@modi") ||
      clean.startsWith("@speakas") ||
      clean.startsWith("/speakas")
    ) {
      return await this.handleCelebrityClone(rawText, quotedMessage, senderName);
    }

    // 16. @mimic / @clone Member Doppelgänger
    if (clean.startsWith("@mimic") || clean.startsWith("/mimic") || clean.startsWith("@clone") || clean.startsWith("/clone")) {
      return await this.handleMemberMimic(rawText, quotedMessage, senderName);
    }

    // 17. @movie / @poster Movie Cast & Poster Generator
    if (clean.startsWith("@movie") || clean.startsWith("/movie") || clean.startsWith("@poster") || clean.startsWith("/poster")) {
      return await this.handleMovieCastPoster(sock, groupJid, rawText, senderName);
    }

    // 18. @commentary Bhojpuri & Sidhu Sports Commentary
    if (clean.startsWith("@commentary") || clean.startsWith("/commentary") || clean.startsWith("commentary")) {
      return await this.handleSportsCommentary(rawText, senderName);
    }

    // 19. @song / @gaana / @music Instant Song Radar & Streaming Links
    if (
      clean.startsWith("@song") ||
      clean.startsWith("/song") ||
      clean.startsWith("@gaana") ||
      clean.startsWith("/gaana") ||
      clean.startsWith("@music") ||
      clean.startsWith("/music")
    ) {
      return await this.handleSongFinder(sock, groupJid, rawText, senderName, messageKey);
    }

    // 20. @hum / @shazam Voice Humming & Audio Song Identifier
    if (clean.startsWith("@hum") || clean.startsWith("/hum") || clean.startsWith("@shazam") || clean.startsWith("/shazam")) {
      return await this.handleHummingShazam(sock, groupJid, rawText, senderName, quotedMessage, messageKey);
    }

    // 21. @reel / @bgm Reel & Shorts Background Music Extractor
    if (clean.startsWith("@reel") || clean.startsWith("/reel") || clean.startsWith("@bgm") || clean.startsWith("/bgm") || clean.startsWith("@short")) {
      return await this.handleReelBgmExtractor(sock, groupJid, rawText, senderName, messageKey);
    }

    // 22. @groupchart / @topchart Weekly Group Billboard Chart
    if (clean.startsWith("@groupchart") || clean.startsWith("/groupchart") || clean.startsWith("@topchart") || clean.startsWith("/topchart") || clean.startsWith("@chart")) {
      return await this.handleGroupMusicChart(groupJid, groupName, senderName);
    }

    return { handled: false };
  }

  // ── 1. @tagall / @everyone Engine ──────────────────────────────────────────

  private async handleTagAll(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    if (!sock) return { handled: true, replyText: "⚠️ Friday WhatsApp connection error." };

    try {
      const meta = await sock.groupMetadata(groupJid);
      if (!meta || !Array.isArray(meta.participants)) {
        return { handled: true, replyText: "⚠️ Group participants list fetch nahi ho saki." };
      }

      const botJid = sock.user?.id || "";
      const participants = meta.participants.filter((p: any) => !p.id.includes(botJid.split(":")[0]));
      const mentions = participants.map((p: any) => p.id);

      const noticeContent = rawText
        .replace(/^(?:@tagall|@everyone|\/tagall|\/everyone|tag\s*all|everyone)\s*[:=-]?\s*/i, "")
        .trim();

      const announcementMsg = noticeContent || "Zaroori suchna / Dhyan dein sabhi members!";

      const memberTagsList = participants
        .slice(0, 35)
        .map((p: any) => `@${p.id.split("@")[0].split(":")[0].replace(/\D/g, "")}`)
        .join(" ");

      const extraCount = participants.length > 35 ? ` ...aur ${participants.length - 35} log` : "";

      const card = `📢 *GROUP ANNOUNCEMENT (@everyone)* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
👤 *Announced By:* ${senderName}
💬 *Message:*
"${announcementMsg}"
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔 *Attention Members (${participants.length}):*
${memberTagsList}${extraCount}`;

      return {
        handled: true,
        replyText: card,
        mentions,
      };
    } catch (err: any) {
      console.error("[GroupSuperPowers] TagAll error:", err);
      return { handled: true, replyText: `⚠️ Tag All failed: ${err?.message || err}` };
    }
  }

  // ── 2. @judge / @factcheck AI Courtroom Engine ──────────────────────────────

  private async handleJudgeFactCheck(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const claim = rawText
      .replace(/^(?:@judge|@factcheck|@debate|\/judge|\/factcheck|\/debate)\s*[:=-]?\s*/i, "")
      .trim();

    const quotedContent = quotedMessage ? `[Quoted Statement by ${quotedMessage.sender}]: "${quotedMessage.text}"` : "";
    const fullTopic = claim || quotedContent || "Kya ye baat sach hai?";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `⚖️ *AI Courtroom:* Statement verify karne ke liye GEMINI_API_KEY configure hona zaroori hai.`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI acting as the Chief Supreme Court Judge & High-Accuracy Fact-Checker in a lively WhatsApp Group.
Members are having a debate.
Claim / Argument to verify:
"""
${fullTopic}
"""
Requested by: ${senderName}

YOUR TASK:
Analyze the claim thoroughly, check factual history, science, sports, tech, or truth, and deliver a fair, objective, witty, and crystal-clear courtroom verdict in energetic natural Hinglish.

Structure your response EXACTLY like this:
⚖️ *FRIDAY AI COURTROOM & FACT-CHECK VERDICT* 🏛️
━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 *Contested Statement:* "[One line summary of the claim]"
🔍 *Fact Analysis:* [2-3 crisp lines explaining the real facts with dates/numbers]
🏆 *The Verdict / Truth:* [Declare who is right or whether the claim is TRUE / FALSE / MISLEADING]
💡 *Final Advice:* [A witty, humorous 1-line settlement for the group members]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Accuracy Confidence:* 99% Verified`;

      for (const model of ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"]) {
        try {
          const resp = await ai.models.generateContent({ model, contents: prompt });
          const text = resp.text?.trim();
          if (text) return { handled: true, replyText: text };
        } catch {}
      }

      return {
        handled: true,
        replyText: `⚖️ *AI Judge:* Arguments analyze kiye gaye hain. Kripya apna dawa specific numbers aur dates ke sath likhein!`,
      };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Fact check error: ${e?.message || e}` };
    }
  }

  // ── 3. @roast / @praise Entertainment Engine ───────────────────────────────

  private async handleRoastAndPraise(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const isPraise = /^(?:@praise|\/praise|@hypeman|\/hypeman)/i.test(rawText.trim());
    const target = rawText
      .replace(/^(?:@roast|@praise|@hypeman|\/roast|\/praise|\/hypeman)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const targetContext = quotedMessage ? `Quoted Message from ${quotedMessage.sender}: "${quotedMessage.text}"` : "";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: isPraise
          ? `🌟 *Hype Card:* ${targetPerson} is simply legendary! 🚀🔥`
          : `🔥 *Roast:* ${targetPerson} bhai ka swag hi alag hai! 😂`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = isPraise
        ? `You are Friday AI, the ultimate hype-man in a WhatsApp group.
Write a wildly enthusiastic, hilarious, superhero-style appreciation praise for "${targetPerson}" in rich, modern Hinglish.
Context: ${targetContext}
Make them feel like an absolute boss/rockstar with funny exaggerations, Bollywood punchlines, and 100% positive vibes.
Use emojis and keep it within 4-5 lines.`
        : `You are Friday AI, doing a witty, lighthearted, savage stand-up roast of "${targetPerson}" in a WhatsApp group.
Context: ${targetContext}
CRITICAL SAFETY RULE: NEVER use vulgar, sexual, abusive slurs (no MC/BC/slurs). Keep it classy, extremely clever, funny, sarcastic college/hostel-style friendly leg-pulling in natural Hinglish.
Use playful punchlines and keep it within 4-5 lines.`;

      for (const model of ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"]) {
        try {
          const resp = await ai.models.generateContent({ model, contents: prompt });
          const text = resp.text?.trim();
          if (text) {
            const header = isPraise ? `🔥 *FRIDAY HYPE-MAN APPRECIATION* 👑` : `🔥 *FRIDAY ROAST ARENA* 🎤`;
            return {
              handled: true,
              replyText: `${header}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 *Target:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_P.S. Sirf group ke maze ke liye hai, dil par mat lena! 😄_`,
            };
          }
        } catch {}
      }

      return { handled: true, replyText: `🔥 ${targetPerson} ke baare me sab jaante hain! 😂` };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Entertainment engine error: ${e?.message || e}` };
    }
  }

  // ── 4. @quiz Live Group Game Arena ────────────────────────────────────────

  private async handleGroupQuiz(
    groupJid: string,
    rawText: string,
    senderName: string,
    senderPhone: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.toLowerCase().trim();
    const active = this.activeQuizzes.get(groupJid);

    // Stop Quiz
    if (clean.includes("stop") || clean.includes("end") || clean.includes("band")) {
      if (!active) return { handled: true, replyText: "⚠️ Abhi koi active quiz nahi chal rahi hai. Shuru karne ke liye `@quiz start` likhein!" };
      const scoreboard = this.getLeaderboardText(active);
      this.activeQuizzes.delete(groupJid);
      return {
        handled: true,
        replyText: `🛑 *QUIZ ENDED!* 🏁\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${scoreboard}\n\nKhelne ke liye sabhi ko shukriya! 🎉`,
      };
    }

    // Leaderboard
    if (clean.includes("leaderboard") || clean.includes("score") || clean.includes("points")) {
      if (!active) return { handled: true, replyText: "⚠️ Koi active quiz nahi hai. `@quiz start [topic]` se nayi quiz shuru karein!" };
      return { handled: true, replyText: this.getLeaderboardText(active) };
    }

    // Answer Checking (A / B / C / D)
    const ansMatch = clean.match(/^(?:@quiz|\/quiz|@trivia)?\s*([a-d])\b/i);
    if (ansMatch && active && active.currentQuestion) {
      const userAns = ansMatch[1].toUpperCase();
      const userKey = senderPhone || senderName;

      if (active.answeredUsers.has(userKey)) {
        return { handled: true, replyText: `⚠️ @${senderPhone || senderName}, aapne is question ka answer pehle hi de diya hai!` };
      }
      active.answeredUsers.add(userKey);

      const isCorrect = userAns === active.currentQuestion.correctAnswer;
      if (isCorrect) {
        const userScore = active.scores.get(userKey) || { name: senderName, points: 0 };
        userScore.points += 10;
        active.scores.set(userKey, userScore);

        const ansCard = `🎉 *RIGHT ANSWER!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Winner:* @${senderPhone || senderName} (+10 Points! 🏆)
✅ *Correct Option:* ${active.currentQuestion.correctAnswer} - ${active.currentQuestion.options[active.currentQuestion.correctAnswer]}
💡 *Fact:* ${active.currentQuestion.explanation}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        // Check if more rounds
        if (active.round < active.maxRounds) {
          active.round++;
          active.answeredUsers.clear();
          const nextQ = await this.generateQuizQuestion(active.topic);
          active.currentQuestion = nextQ;

          const nextCard = `\n\n🎯 *ROUND ${active.round}/${active.maxRounds}* 🚀\n📝 *Question:* ${nextQ.question}\n\n🅰️ ${nextQ.options.A}\n🅱️ ${nextQ.options.B}\n🅲 ${nextQ.options.C}\n🅳 ${nextQ.options.D}\n\n_(Reply with A, B, C ya D)_`;
          return { handled: true, replyText: `${ansCard}${nextCard}` };
        } else {
          const finalScoreboard = this.getLeaderboardText(active);
          this.activeQuizzes.delete(groupJid);
          return {
            handled: true,
            replyText: `${ansCard}\n\n🏆 *QUIZ COMPLETED! GRAND FINALE* 🎊\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${finalScoreboard}`,
          };
        }
      } else {
        return {
          handled: true,
          replyText: `❌ *Galat Jawab!* @${senderPhone || senderName} (Option ${userAns} galat hai). Koi aur try karein!`,
        };
      }
    }

    // Start New Quiz
    const topic = rawText.replace(/^(?:@quiz|\/quiz|@trivia|\/trivia|\s*start)*\s*/i, "").trim() || "General Knowledge & Bollywood & Cricket";

    const question = await this.generateQuizQuestion(topic);
    const newQuiz: ActiveGroupQuiz = {
      groupId: groupJid,
      topic,
      round: 1,
      maxRounds: 5,
      currentQuestion: question,
      scores: new Map(),
      startTime: Date.now(),
      answeredUsers: new Set(),
    };
    this.activeQuizzes.set(groupJid, newQuiz);

    const card = `🎮 *FRIDAY LIVE GROUP QUIZ SHOWDOWN* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *Topic:* ${topic}
🔢 *Round:* 1/5 | *Points:* 10 pts per fastest correct answer!
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Question 1:*
${question.question}

🅰️ ${question.options.A}
🅱️ ${question.options.B}
🅲 ${question.options.C}
🅳 ${question.options.D}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Jawab dene ke liye \`A\`, \`B\`, \`C\` ya \`D\` likhein!_`;

    return { handled: true, replyText: card };
  }

  private async generateQuizQuestion(topic: string): Promise<QuizQuestion> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Generate 1 unique, fun, high-energy multiple choice trivia question for an Indian WhatsApp group.
Topic: "${topic}".
Output MUST be strict JSON only in this schema:
{
  "question": "Question in natural Hinglish or English",
  "options": {
    "A": "Option A text",
    "B": "Option B text",
    "C": "Option C text",
    "D": "Option D text"
  },
  "correctAnswer": "A",
  "explanation": "1-line interesting fun fact why this is correct"
}`;
        const resp = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(resp.text?.trim() || "{}");
        if (json.question && json.options && json.correctAnswer) {
          return {
            question: json.question,
            options: json.options,
            correctAnswer: (json.correctAnswer || "A").toUpperCase(),
            explanation: json.explanation || "Correct answer!",
          };
        }
      } catch (e) {
        console.warn("[GroupSuperPowers] Quiz AI generation error:", e);
      }
    }

    return {
      question: "Cricket World Cup 2011 Final me Dhoni ne kitne runs banaye the?",
      options: { A: "85 Runs", B: "91* Runs", C: "97 Runs", D: "102 Runs" },
      correctAnswer: "B",
      explanation: "MS Dhoni scored 91 not out off 79 balls with that iconic final six!",
    };
  }

  private getLeaderboardText(quiz: ActiveGroupQuiz): string {
    const sorted = Array.from(quiz.scores.values()).sort((a, b) => b.points - a.points);
    if (sorted.length === 0) return "📊 *Leaderboard:* Abhi tak kisi ne koi points nahi jeete.";
    const lines = sorted.map((s, idx) => `${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "👤"} *${s.name}:* ${s.points} Points`);
    return `📊 *LIVE QUIZ LEADERBOARD* 🏆\n${lines.join("\n")}`;
  }

  // ── 5. @split / @bill Expense Splitter ─────────────────────────────────────

  private async handleBillSplit(
    rawText: string,
    groupName: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@split|@bill|@hisab|\/split|\/bill|\/hisab)\s*[:=-]?\s*/i, "").trim();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `💳 *Group Expense Splitter:* Please provide amount and members (e.g. \`@split 1500 Pizza Rohan Aman DK\`).`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, an intelligent group expense and Splitwise manager.
Input text from user: "${clean}"
Payer / Requested By: "${senderName}"

Task:
Extract:
- totalAmount (number)
- description / item (e.g. Dinner, Pizza, Trip, Petrol)
- payerName
- participantsList (array of names involved, if none specified default to 3-4 standard friends or mention 'equal share among all members')
- perPersonShare (totalAmount / participants count)

Format a clean, crystal-clear WhatsApp Expense Card in natural Hinglish:
💳 *FRIDAY EXPENSE & SPLITWISE CARD* 🧾
━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *Total Bill:* ₹[Amount] ([Description])
👤 *Paid By:* [Payer Name]
👥 *Split Among:* [List of Names] ([Count] members)
💵 *Per Person Share:* ₹[Per Person]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📲 *Payment Action:*
• [Name 1] ➔ [Payer] ko ₹[Per Person] bhejenge
• [Name 2] ➔ [Payer] ko ₹[Per Person] bhejenge
━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ _Hisaab cleared by Friday AI!_`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        expenseCol().add({ groupName, rawText: clean, createdAt: Date.now() }).catch(() => {});
        return { handled: true, replyText: text };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Expense calculation error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `💳 *Hisaab:* Kripya bill amount aur members batayein (Jaise: \`@split 2000 Dinner by Rohan with Aman DK Rahul\`).` };
  }

  // ── 6. @decision / @todo Action Tracker ───────────────────────────────────

  private async handleDecisionTracker(
    groupJid: string,
    groupName: string,
    rawText: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    let recentMessagesText = "";
    if (quotedMessage) {
      recentMessagesText = `Quoted Message from ${quotedMessage.sender}: "${quotedMessage.text}"`;
    } else {
      try {
        const history = await whatsappHistoryEngine.getGroupMessagesWithSummary(groupName, 25);
        recentMessagesText = typeof history === "string" ? history : (history.summary || (history as any).messages?.map((m: any) => m.text).join("\n") || "");
      } catch {}
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `📌 *Decisions & Notes:* GEMINI_API_KEY is required to analyze group conversation.`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, acting as the Executive Meeting Secretary for a WhatsApp Group.
Here is the recent group conversation history:
"""
${recentMessagesText || rawText}
"""

YOUR TASK:
Scan the conversation and extract:
1. Key Decisions Made (What did the group finally agree on?)
2. Action Items & Assigned Tasks (Who is responsible for doing what?)
3. Important Dates / Deadlines / Timings (If any).

Format your output EXACTLY as a pinned executive checklist:
📌 *FRIDAY GROUP DECISION & ACTION TRACKER* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
🎯 *Final Agreed Decisions:*
• [Decision 1]
• [Decision 2]

📋 *Action Items & To-Dos:*
• 🔲 [Task 1] ➔ Assigned: @[Person]
• 🔲 [Task 2] ➔ Assigned: @[Person]

⏰ *Timings / Deadlines:*
• [Date / Time]
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Friday ne decisions note kar liye hain. Sabhi log apne tasks time par complete karein!_`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        decisionCol().add({ groupId: groupJid, groupName, text, createdAt: Date.now() }).catch(() => {});
        return { handled: true, replyText: text };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Decision extraction error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `📌 *Decision Tracker:* Group me abhi tak koi specific plan ya decision confirm nahi hua hai.` };
  }

  // ── 7. @birthday Auto-Celebrator ──────────────────────────────────────────

  private async handleBirthdayManager(
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.toLowerCase().trim();

    // List Birthdays
    if (clean.includes("list") || clean.includes("upcoming") || clean.includes("kab hai")) {
      const bdays = this.birthdayCache.get(groupJid) || [];
      if (bdays.length === 0) {
        return {
          handled: true,
          replyText: `🎂 *GROUP BIRTHDAYS REGISTRY* 📅\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nAbhi is group me koi birthday save nahi hai.\n\n💡 *Save karne ke liye likhein:*\n\`@birthday add @Name 15-08\``,
        };
      }

      const listStr = bdays
        .map((b) => `• 🎈 *${b.memberName}* (@${b.memberPhone}): ${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}`)
        .join("\n");

      return {
        handled: true,
        replyText: `🎂 *GROUP BIRTHDAYS CALENDAR* 📅\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${listStr}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Friday 12:00 AM midnight par automatically celebrate karegi! 🎉_`,
      };
    }

    // Add Birthday (@birthday add @Member DD-MM or @birthday add 15 Oct)
    if (clean.includes("add") || clean.includes("save") || clean.includes("set")) {
      const targetPhone = quotedMessage?.senderPhone || (rawText.match(/\d{10,14}/)?.[0] || senderPhone).replace(/\D/g, "");
      const targetName = quotedMessage?.sender || senderName;

      // Extract day and month
      const dateMatch = rawText.match(/\b(\d{1,2})[\/\-\s]([0-1]?\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
      if (!dateMatch) {
        return {
          handled: true,
          replyText: `⚠️ Kripya sahi date format me likhein. Example: \`@birthday add @Rohan 25-10\` ya \`@birthday add 15 Aug\``,
        };
      }

      const day = parseInt(dateMatch[1], 10);
      let month = 1;
      const monthRaw = dateMatch[2].toLowerCase();

      const monthMap: { [k: string]: number } = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };

      if (monthMap[monthRaw]) {
        month = monthMap[monthRaw];
      } else {
        month = parseInt(monthRaw, 10);
      }

      if (day < 1 || day > 31 || month < 1 || month > 12) {
        return { handled: true, replyText: `⚠️ Invalid date: ${day}/${month}. Kripya valid date dein.` };
      }

      const newBday: GroupBirthday = {
        groupId: groupJid,
        memberPhone: targetPhone,
        memberName: targetName,
        day,
        month,
        addedBy: senderName,
        addedAt: Date.now(),
      };

      const existing = this.birthdayCache.get(groupJid) || [];
      const updated = existing.filter((b) => b.memberPhone !== targetPhone);
      updated.push(newBday);
      this.birthdayCache.set(groupJid, updated);

      const docId = `${groupJid}_${targetPhone}`;
      await bdayCol().doc(docId).set(newBday, { merge: true });

      return {
        handled: true,
        replyText: `🎂 *BIRTHDAY SAVED SUCCESSFULLY!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Member:* ${targetName} (@${targetPhone})\n📅 *Date:* ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nFriday theek 12:00 AM par group me custom celebration poster aur sweet wish post karegi! 🥳✨`,
      };
    }

    // Instant Wish Generator (@birthday wish @Member)
    const targetPerson = quotedMessage ? quotedMessage.sender : senderName;
    const apiKey = process.env.GEMINI_API_KEY;
    let customPoem = `Aapko janamdin ki dheron shubhkaamnayein! Har din khushiyon se bhara rahe! 🎂✨`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Write a super sweet, warm, high-energy, 4-line Birthday Celebration Poem + funny blessing in natural Hinglish for "${targetPerson}" in a WhatsApp group. Use emojis.`;
        const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
        if (resp.text) customPoem = resp.text.trim();
      } catch {}
    }

    return {
      handled: true,
      replyText: `🎂🎉 *HAPPY BIRTHDAY ${targetPerson.toUpperCase()}!* 🥳🎈
━━━━━━━━━━━━━━━━━━━━━━━━━━
${customPoem}
━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 _Treat kab mil rahi hai sabko? Party toh banti hai!_ 🍕🍻`,
    };
  }

  // ── 8. @meme AI Meme & Sticker Generator ──────────────────────────────────

  public async handleMemeGenerator(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    const topic = rawText
      .replace(/^(?:@meme|\/meme|meme\s*banao|meme)\s*[:=-]?\s*/i, "")
      .trim();

    const target = topic || (quotedMessage ? quotedMessage.text : "Indian College Friends & Relatable Life");
    const apiKey = process.env.GEMINI_API_KEY;

    let memePrompt = `Funny Indian relatable meme about ${target}`;
    let memeCaption = `😂 *FRIDAY AI MEME CORNER* 🎭\n\n"${target}"`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Create a super funny, relatable Indian Hinglish meme punchline about: "${target}".
Format:
Caption: [1-2 line funny punchline]
ImagePrompt: [Visual description for 3D animated or photorealistic funny meme scene]`,
        });
        const full = res.text?.trim() || "";
        const capMatch = full.match(/Caption:\s*([\s\S]*?)(?:ImagePrompt:|$)/i);
        const promptMatch = full.match(/ImagePrompt:\s*([\s\S]*)/i);
        if (capMatch) memeCaption = `😂 *FRIDAY AI MEME CORNER* 🎭\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${capMatch[1].trim()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        if (promptMatch) memePrompt = promptMatch[1].trim();
      } catch {}
    }

    try {
      const { imageGenerationService } = await import("../imageGenerationService");
      const genRes = await imageGenerationService.generateImage(memePrompt, { aspectRatio: "1:1" });
      if (genRes.success && genRes.buffer && sock) {
        await sock.sendMessage(groupJid, {
          image: genRes.buffer,
          caption: memeCaption,
        });
        return { handled: true };
      }
    } catch (imgErr) {
      console.warn("[GroupSuperPowers] Meme image generation fallback:", imgErr);
    }

    return {
      handled: true,
      replyText: `${memeCaption}\n\n🖼️ _(Meme Scene: ${memePrompt})_`,
    };
  }

  // ── 9. @poll WhatsApp Native Interactive Poll Creator ─────────────────────

  public async handlePollCreator(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@poll|\/poll|poll\s*banao|poll)\s*[:=-]?\s*/i, "").trim();

    let question = "Aapka kya vote hai?";
    let options: string[] = ["Haan / Yes 👍", "Nahi / No 👎", "Dekhte hain 🤔"];

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Extract a clear poll question and 2 to 6 crisp poll options from this user request for a WhatsApp group poll.
Input: "${clean || "Sunday Cricket match"}"

Output STRICT JSON ONLY:
{
  "question": "Clear poll title / question",
  "options": ["Option 1", "Option 2", "Option 3"]
}`;
        const resp = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });
        const json = JSON.parse(resp.text?.trim() || "{}");
        if (json.question && Array.isArray(json.options) && json.options.length >= 2) {
          question = json.question.slice(0, 250);
          options = json.options.map((o: any) => String(o).slice(0, 100)).slice(0, 12);
        }
      } catch (e) {
        console.warn("[GroupSuperPowers] Poll AI parse error:", e);
      }
    }

    if (sock) {
      try {
        await sock.sendMessage(groupJid, {
          poll: {
            name: `📊 ${question}`,
            values: options,
            selectableCount: 1,
          },
        });
        return { handled: true };
      } catch (pollErr: any) {
        console.warn("[GroupSuperPowers] WhatsApp native poll send failed:", pollErr);
      }
    }

    const optionsList = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join("\n");
    return {
      handled: true,
      replyText: `📊 *GROUP LIVE POLL: ${question}* 🗳️\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${optionsList}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Apna option chunein!_`,
    };
  }

  // ── 10. @translate Multi-Language Live Translator ─────────────────────────

  public async handleLiveTranslator(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@translate|\/translate|@tarjuma|translate|anuvad)\s*[:=-]?\s*/i, "").trim();

    const targetLangMatch = clean.match(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/i);
    const targetLanguage = targetLangMatch ? targetLangMatch[1].trim() : "Hindi";

    const textToTranslate = quotedMessage ? quotedMessage.text : clean.replace(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/gi, "").trim();

    if (!textToTranslate) {
      return {
        handled: true,
        replyText: `🌐 *Language Translator:* Kripya kisi message par swipe karke \`@translate [Language]\` likhein ya text ke sath language batayein (Jaise: \`@translate in Bengali "Hello how are you"\`).`,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Translate the following message into ${targetLanguage} accurately and naturally.
Original Text: "${textToTranslate}"
Requested by: ${senderName}

Format Output:
🌐 *FRIDAY LANGUAGE TRANSLATOR* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Original:* "${textToTranslate}"
🎯 *${targetLanguage} Translation:*
"[Accurate, natural translation in ${targetLanguage}]"
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Translation accurate and context-aware!_`;

        const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
        const text = resp.text?.trim();
        if (text) return { handled: true, replyText: text };
      } catch (e: any) {
        return { handled: true, replyText: `⚠️ Translation error: ${e?.message || e}` };
      }
    }

    return {
      handled: true,
      replyText: `🌐 *Translation (${targetLanguage}):*\n"${textToTranslate}"`,
    };
  }

  // ── 11. @vibe / @icebreaker Group Mood & Fight Cooler ─────────────────────

  public async handleVibeRadarAndIcebreaker(
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const isJoke = /\b(joke|chutkula|hasao|funny)\b/i.test(rawText);
    const isFightCooler = /\b(ladai|fight|gussa|shant|cool|jhagda)\b/i.test(rawText);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `🌟 *Group Vibe Check:* Group ka mahaul 100% positive and energetic hai! Sab log chill karein! 😎✨`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = isJoke
        ? `Tell 1 super fresh, hilarious, modern Indian stand-up style Hindi/Hinglish comedy joke for a WhatsApp group. Keep it clean, clever, and extremely funny. 3-4 lines.`
        : isFightCooler
        ? `Two people or members are arguing in this WhatsApp group. Write a hilarious, witty, lighthearted intervention that immediately diffuses the tension and makes everyone laugh. Use Bollywood punchlines or relatable banter.`
        : `You are Friday AI, checking the vibe of WhatsApp group "${groupName}".
Drop an irresistible, hilarious, ultra-engaging icebreaker question or "Would You Rather" scenario that forces all silent group members to reply and start chatting! Use emojis.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        const title = isJoke ? `😂 *FRIDAY JOKE OF THE DAY* 🎤` : isFightCooler ? `🕊️ *FRIDAY PEACE & CHILL RADAR* 🧊` : `⚡ *FRIDAY GROUP VIBE CHECK & ICEBREAKER* 🎯`;
        return {
          handled: true,
          replyText: `${title}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Mahaul set hai, sab log participate karein!_ 🔥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Vibe check error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `✨ Group vibe is awesome today! 🚀` };
  }

  // ── 12. @liedetector / @psychology Polygraph & Lie Detector ───────────────

  public async handleLieDetector(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const claim = rawText
      .replace(/^(?:@liedetector|@lie|@psychology|\/liedetector|\/lie|\/psychology|sach\s*ya\s*jhooth)\s*[:=-]?\s*/i, "")
      .trim();

    const targetText = quotedMessage ? quotedMessage.text : claim;
    const targetSender = quotedMessage ? quotedMessage.sender : senderName;

    if (!targetText) {
      return {
        handled: true,
        replyText: `🕵️‍♂️ *AI Lie Detector:* Kripya kisi member ke message par swipe karke \`@liedetector\` likhein ya apna statement dein!`,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `🕵️‍♂️ *Polygraph Scan on ${targetSender}:* Statement appears 75% suspicious! 😂`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI running an ultra-cool, high-tech, cinematic Psychological Lie Detector & Polygraph scan on a statement in a WhatsApp group.
Statement by ${targetSender}: "${targetText}"

Your task:
Analyze linguistic hedging, stress indicators, excessive justification, excuses, and psychological micro-cues with funny, witty, playful Indian detective humor.

Structure output EXACTLY like this:
🕵️‍♂️ *FRIDAY AI POLYGRAPH & LIE DETECTOR SCAN* 🔬
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Target Subject:* ${targetSender}
📜 *Analyzed Statement:* "${targetText}"
📈 *Linguistic Stress Index:* [Random 75% to 96%] (HIGH)
🧠 *Psychological Micro-Cue:* [Funny analysis of over-explanation or excuse pattern in Hinglish]
🚨 *VERDICT:* [Declare whether it is 92% JHOOTH/CAP or 100% TRUTH with a hilarious, savage reality check]
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ _Polygraph analysis completed by Friday AI!_`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) return { handled: true, replyText: text };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Lie detector scan error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🕵️‍♂️ *Lie Detector:* Statement analyzed! High cap detected! 😂` };
  }

  // ── 13. @rap Desi Hip-Hop Rap Generator ───────────────────────────────────

  public async handleDesiRapGenerator(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@rap|\/rap|rap\s*banao|rap)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🎤 *Gully Cypher:* ${targetPerson} bhai ka swag hard hai, baaki sab bantai card hai! 🔥`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Write a super fiery, hilarious, energetic 6 to 8-line Desi Hip-Hop / Gully Boy style Rap Cypher about "${targetPerson}" in a WhatsApp group.
Include funny Indian references (chai, bike, late aana, excuses, swag, gaming, dosti).
Rhymes must be tight and catchy in authentic Hinglish slang (hard, bantai, scene, boss).
CRITICAL: No vulgar/abusive words. Keep it high vibe and purely for friendly laughter.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🎤 *FRIDAY DESI CYPHER & RAP ARENA* 🔥🎵\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👑 *Featuring:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎧 _Drop the mic! Yo!_ 💥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Rap generation error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🎤 Mic drop for ${targetPerson}! 🔥` };
  }

  // ── 14. @future / @oracle Time-Machine Future Prediction ──────────────────

  public async handleFutureOracle(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@future|@oracle|@kismat|\/future|\/oracle|\/kismat)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `⏳ *Year 2031 Prediction:* ${targetPerson} will be a billionaire drinking coconut water on a private yacht! 🚀`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, looking through the cosmic time-machine 5 to 10 years into the future (Year 2031-2035).
Create a hilarious, ultra-detailed, witty "Future Biography & Destiny Card" for "${targetPerson}" in their WhatsApp group.
Predict their future career, hilarious habits (that never changed), relationship status, and wealth in funny Hinglish.
Keep it positive, clever, and laugh-out-loud funny.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `⏳ *FRIDAY TIME-MACHINE: YEAR 2031 DESTINY* 🔮✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Subject:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌌 _Kismat locked in the blockchain of destiny!_ 🚀`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Future oracle error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🔮 Future looks legendary for ${targetPerson}! ✨` };
  }

  // ── 15. @srk / @tonystark / @amitabh / @speakas Celebrity Clone ────────────

  public async handleCelebrityClone(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    let celeb = "Shah Rukh Khan";
    const clean = rawText.toLowerCase();

    if (clean.includes("tony") || clean.includes("stark") || clean.includes("ironman")) celeb = "Tony Stark (Iron Man)";
    else if (clean.includes("amitabh") || clean.includes("bachchan") || clean.includes("bigb")) celeb = "Amitabh Bachchan";
    else if (clean.includes("modi") || clean.includes("narendra")) celeb = "Narendra Modi";
    else if (clean.includes("salman") || clean.includes("bhai")) celeb = "Salman Khan";
    else if (clean.includes("babu") || clean.includes("rao") || clean.includes("baburao")) celeb = "Babu Rao (Hera Pheri)";
    else if (clean.includes("munna") || clean.includes("circuit")) celeb = "Munna Bhai & Circuit";
    else if (clean.includes("srk") || clean.includes("shahrukh")) celeb = "Shah Rukh Khan";

    const promptText = rawText
      .replace(/^(?:@srk|@tonystark|@amitabh|@modi|@speakas|\/srk|\/tonystark|\/amitabh|\/modi|\/speakas)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = promptText || (quotedMessage ? quotedMessage.text : "Sab log dhyan se suno");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `👑 *${celeb} Style:* Picture abhi baaki hai mere dost! ✨`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a legendary voice and persona impersonator of "${celeb}".
Respond to this WhatsApp group topic: "${topic}".
User speaking: ${senderName}.
Use iconic catchphrases, dramatic pauses, signature dialogues, and authentic charisma of ${celeb} in natural Hindi/Hinglish.
Keep it entertaining, 4-5 lines.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `👑 *CELEBRITY PERSONA CLONE: ${celeb.toUpperCase()}* 🎬✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌟 _Official Cinematic Voice Simulation!_ 🍿`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Celebrity clone error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🎬 Action! ${celeb} is in the house! ✨` };
  }

  // ── 16. @mimic / @clone Member Doppelgänger ───────────────────────────────

  public async handleMemberMimic(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@mimic|@clone|\/mimic|\/clone)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🤖 *Simulating @${targetPerson}:* "Haan bhai 2 min me aata hoon..." 😅`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI doing a funny, hyper-accurate impersonation of a typical college/friend group member named "${targetPerson}".
Context message / query: "${quotedMessage ? quotedMessage.text : rawText}".

Task:
Simulate EXACTLY how ${targetPerson} would reply in WhatsApp:
- Their classic excuses ("so raha tha", "mummy ne kaam bol diya", "battery 2% hai", "traffic me hoon")
- Overuse of their favorite emojis (😅, 😂, 🙏, 👍, 🔥)
- Punctuation quirks and casual, lazy typing.
Keep it 2-3 lines and wildly relatable.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🤖 *SIMULATING @${targetPerson.toUpperCase()}'S EXACT BRAIN* 👥⚡\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤣 _(Pakka yehi bolte na? Sach batao!)_`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Mimic error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🤖 @${targetPerson} mode active! 😅` };
  }

  // ── 17. @movie / @poster Movie Cast & Poster Generator ────────────────────

  public async handleMovieCastPoster(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText
      .replace(/^(?:@movie|@poster|\/movie|\/poster|movie\s*cast)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = clean || "Avengers Desi Edition with Group Members";
    const apiKey = process.env.GEMINI_API_KEY;
    let synopsisText = `🎬 *BLOCKBUSTER CASTING:* ${topic}`;
    let imagePrompt = `Epic cinematic blockbuster movie poster of ${topic}, Bollywood Hollywood crossover, 8k resolution, dramatic lighting`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Create an epic Bollywood/Hollywood crossover blockbuster movie cast and plot synopsis for: "${topic}".
Assign funny dramatic character roles (e.g. Mastermind Hero, Sarcastic Tech Guy, Emotional Friend, Main Villain).
Format:
Synopsis: [3-4 lines dramatic trailer script]
PosterPrompt: [Visual description for Hollywood-grade cinematic movie poster]`,
        });
        const full = res.text?.trim() || "";
        const synMatch = full.match(/Synopsis:\s*([\s\S]*?)(?:PosterPrompt:|$)/i);
        const pMatch = full.match(/PosterPrompt:\s*([\s\S]*)/i);
        if (synMatch) synopsisText = `🎬 *FRIDAY BLOCKBUSTER MOVIE CASTING* 🍿⚡\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${synMatch[1].trim()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        if (pMatch) imagePrompt = pMatch[1].trim();
      } catch {}
    }

    try {
      const { imageGenerationService } = await import("../imageGenerationService");
      const genRes = await imageGenerationService.generateImage(imagePrompt, { aspectRatio: "16:9" });
      if (genRes.success && genRes.buffer && sock) {
        await sock.sendMessage(groupJid, {
          image: genRes.buffer,
          caption: synopsisText,
        });
        return { handled: true };
      }
    } catch (imgErr) {
      console.warn("[GroupSuperPowers] Movie poster image error:", imgErr);
    }

    return {
      handled: true,
      replyText: `${synopsisText}\n\n🎟️ _In Cinemas Worldwide This Friday!_ 🌟`,
    };
  }

  // ── 18. @commentary Bhojpuri & Sidhu Sports Commentary ────────────────────

  public async handleSportsCommentary(
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText
      .replace(/^(?:@commentary|\/commentary|commentary)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = clean || "Virat Kohli hitting iconic cover drive in death overs";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🎙️ *Bhojpuri Commentary:* Ee dekhi bhaiya, ball gail boundary ke paar! Chauka! 💥🏏`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Write a high-voltage, laugh-out-loud funny cricket/sports live commentary for: "${topic}".
Use authentic high-energy Bhojpuri & Sidhuisms punchlines ("Eee dekhi babua", "Thoko taali", "Dhuaan nikaal diye", "Gagan-chumbi chhakka").
3-4 lines of pure adrenaline and entertainment.`;

      const resp = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🎙️ *FRIDAY LIVE DHAMAKA COMMENTARY* 🏏🔥\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Thoko taali! Boundary paar!_ 💥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Commentary error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🏏 Sixer! Ball stadium ke bahar! 💥` };
  }

  // ── 19. @song / @gaana / @music Instant Song Radar & Streaming Links ──────

  public async handleSongFinder(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName = "Member",
    messageKey?: any
  ): Promise<{ handled: boolean; replyText?: string }> {
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
    const res = await whatsappFeatureEngine.searchMusicWithLyrics(rawText, senderName, groupJid);

    // If 30-sec audio preview is requested and buffer downloaded, send audio message directly to group
    if (res.audioBuffer && sock && groupJid) {
      try {
        await sock.sendMessage(groupJid, {
          audio: res.audioBuffer,
          mimetype: "audio/mp4",
          ptt: false,
        });
      } catch (audioErr) {
        console.warn("[GroupSuperPowers] Failed to send preview audio:", audioErr);
      }
    }

    return { handled: true, replyText: res.replyText };
  }

  // ── 20. @hum / @shazam Voice Humming & Audio Song Identifier ─────────────

  public async handleHummingShazam(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName = "Member",
    quotedMessage?: QuotedMessageContext | null,
    messageKey?: any
  ): Promise<{ handled: boolean; replyText?: string }> {
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");

    // If quoted audio exists, or if text provides humming query
    let dummyAudio: Buffer | null = null;
    if (quotedMessage && quotedMessage.text) {
      const res = await whatsappFeatureEngine.searchMusicWithLyrics(quotedMessage.text, senderName, groupJid);
      if (res.audioBuffer && sock && groupJid) {
        try {
          await sock.sendMessage(groupJid, { audio: res.audioBuffer, mimetype: "audio/mp4", ptt: false });
        } catch {}
      }
      return { handled: true, replyText: res.replyText };
    }

    const cleanQuery = rawText.replace(/^(?:@hum|@shazam|\/hum|\/shazam)\s*/i, "").trim() || "humming song";
    const res = await whatsappFeatureEngine.searchMusicWithLyrics(cleanQuery, senderName, groupJid);
    if (res.audioBuffer && sock && groupJid) {
      try {
        await sock.sendMessage(groupJid, { audio: res.audioBuffer, mimetype: "audio/mp4", ptt: false });
      } catch {}
    }
    return { handled: true, replyText: res.replyText };
  }

  // ── 21. @reel / @bgm Reel & Shorts Background Music Extractor ─────────────

  public async handleReelBgmExtractor(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName = "Member",
    messageKey?: any
  ): Promise<{ handled: boolean; replyText?: string }> {
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
    const res = await whatsappFeatureEngine.extractReelBackgroundSong(rawText, senderName, groupJid);

    if (res.audioBuffer && sock && groupJid) {
      try {
        await sock.sendMessage(groupJid, { audio: res.audioBuffer, mimetype: "audio/mp4", ptt: false });
      } catch {}
    }

    return { handled: true, replyText: res.replyText };
  }

  // ── 22. @groupchart / @topchart Weekly Group Billboard Chart ──────────────

  public async handleGroupMusicChart(
    groupJid: string,
    groupName = "Group",
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
    const card = whatsappFeatureEngine.getGroupMusicChart(groupJid, groupName, senderName);
    return { handled: true, replyText: card };
  }

  // ── 23. Midnight Birthday Cron Worker ─────────────────────────────────────

  public async checkAndTriggerMidnightBirthdays(sock: any): Promise<number> {
    if (!sock) return 0;
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentDay = nowIST.getDate();
    const currentMonth = nowIST.getMonth() + 1;
    const currentYear = nowIST.getFullYear();
    const currentHour = nowIST.getHours();

    // Trigger only at midnight (0:00 - 0:30 AM)
    if (currentHour !== 0) return 0;

    let wishedCount = 0;
    if (!this.loadedBirthdays) await this.preloadBirthdays();

    for (const [groupId, bdays] of this.birthdayCache.entries()) {
      for (const b of bdays) {
        if (b.day === currentDay && b.month === currentMonth && b.lastWishedYear !== currentYear) {
          b.lastWishedYear = currentYear;
          const docId = `${groupId}_${b.memberPhone}`;
          bdayCol().doc(docId).set({ lastWishedYear: currentYear }, { merge: true }).catch(() => {});

          const greetingCard = `🎂🎉 *HAPPY BIRTHDAY @${b.memberPhone}!* 🥳🎈
━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *12:00 AM MIDNIGHT CELEBRATION!* ✨
Aaj hamare pyare dost *${b.memberName}* ka janamdin hai! 👑

Janamdin ki bohot bohot shubhkaamnayein! 🌟
Bhagwan aapko lambi umar, beshumar khushiyan, aur bohot saari success de! 🚀💖
━━━━━━━━━━━━━━━━━━━━━━━━━━
🍕 *Sabhi log birthday boy/girl ko wish karein aur treat ki demand karein!* 😄🎁`;

          try {
            await sock.sendMessage(groupId, {
              text: greetingCard,
              mentions: [`${b.memberPhone}@s.whatsapp.net`],
            });
            wishedCount++;
            console.log(`[GroupSuperPowers] Sent midnight birthday wish to @${b.memberPhone} in ${groupId}`);
          } catch (sendErr) {
            console.warn(`[GroupSuperPowers] Failed to send birthday wish:`, sendErr);
          }
        }
      }
    }
    return wishedCount;
  }

  // ── 9. Natural Language Command Intent Resolver & Smart Suggestion Engine ──

  public async detectAndResolveNaturalCommand(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    senderJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const clean = (rawText || "").toLowerCase().trim();
    if (!clean || clean.length < 3) return { handled: false };

    // ── Phase 0: Explicit @Command Triggers (Fast-path for intentional shortcuts) ──
    // These are deliberate command syntax that users type explicitly
    if (clean.startsWith("@tagall") || clean.startsWith("/tagall") || clean.startsWith("@everyone") || clean.startsWith("/everyone")) {
      const msg = rawText.replace(/^(?:@tagall|\/tagall|@everyone|\/everyone)\s*[:=-]?\s*/i, "").trim();
      return await this.handleTagAll(sock, groupJid, groupName, msg || "Sabko tag kiya!", senderName);
    }
    if (clean.startsWith("@judge") || clean.startsWith("/judge") || clean.startsWith("@factcheck") || clean.startsWith("/factcheck")) {
      return await this.handleJudgeFactCheck(rawText, quotedMessage, senderName);
    }
    if (clean.startsWith("@debate") || clean.startsWith("/debate")) {
      return await this.handleDebate(rawText, quotedMessage, senderName, groupName);
    }
    if (clean.startsWith("@roast") || clean.startsWith("/roast")) {
      const target = rawText.replace(/^(?:@roast|\/roast)\s*/i, "").trim();
      return await this.handleRoastAndPraise(`@roast ${target}`, quotedMessage, senderName);
    }
    if (clean.startsWith("@praise") || clean.startsWith("/praise") || clean.startsWith("@hypeman") || clean.startsWith("/hypeman")) {
      const target = rawText.replace(/^(?:@praise|\/praise|@hypeman|\/hypeman)\s*/i, "").trim();
      return await this.handleRoastAndPraise(`@praise ${target}`, quotedMessage, senderName);
    }
    if (clean.startsWith("@quiz") || clean.startsWith("/quiz") || clean.startsWith("@trivia") || clean.startsWith("/trivia")) {
      return await this.handleGroupQuiz(groupJid, rawText, senderName, senderPhone);
    }
    if (clean.startsWith("@song") || clean.startsWith("@gaana") || clean.startsWith("@music")) {
      return await this.handleSongFinder(sock, groupJid, rawText, senderName, messageKey);
    }
    if (clean.startsWith("@hum") || clean.startsWith("@shazam")) {
      return await this.handleHummingShazam(sock, groupJid, rawText, senderName, quotedMessage, messageKey);
    }
    if (clean.startsWith("@reel") || clean.startsWith("@bgm")) {
      return await this.handleReelBgmExtractor(sock, groupJid, rawText, senderName, messageKey);
    }
    if (clean.startsWith("@groupchart") || clean.startsWith("@topchart")) {
      return await this.handleGroupMusicChart(groupJid, groupName, senderName);
    }
    if (clean.startsWith("@split") || clean.startsWith("/split") || clean.startsWith("@bill") || clean.startsWith("/bill") || clean.startsWith("@hisab") || clean.startsWith("/hisab")) {
      return await this.handleBillSplit(rawText, groupName, senderName);
    }
    if (clean.startsWith("@decision") || clean.startsWith("/decision") || clean.startsWith("@todo") || clean.startsWith("/todo")) {
      return await this.handleDecisionTracker(groupJid, groupName, rawText, quotedMessage);
    }
    if (clean.startsWith("@birthday") || clean.startsWith("/birthday") || clean.startsWith("@bday")) {
      return await this.handleBirthdayManager(groupJid, groupName, rawText, senderName, senderPhone, quotedMessage);
    }
    if (clean.startsWith("@meme") || clean.startsWith("/meme")) {
      return await this.handleMemeGenerator(sock, groupJid, rawText, senderName, quotedMessage);
    }
    if (clean.startsWith("@poll") || clean.startsWith("/poll")) {
      return await this.handlePollCreator(sock, groupJid, rawText, senderName);
    }
    if (clean.startsWith("@commentary") || clean.startsWith("/commentary")) {
      return await this.handleSportsCommentary(rawText, senderName);
    }
    if (clean.startsWith("@rap") || clean.startsWith("/rap") || clean.startsWith("@diss")) {
      return await this.handleDesiRapGenerator(rawText, quotedMessage, senderName);
    }
    if (clean.startsWith("@future") || clean.startsWith("/future") || clean.startsWith("@oracle") || clean.startsWith("/oracle")) {
      return await this.handleFutureOracle(rawText, quotedMessage, senderName);
    }
    if (clean.startsWith("@speakas") || clean.startsWith("/speakas") || clean.startsWith("@celebrity") || clean.startsWith("/celebrity")) {
      return await this.handleCelebrityClone(rawText, quotedMessage, senderName);
    }
    if (clean.startsWith("@mimic") || clean.startsWith("/mimic") || clean.startsWith("@clone") || clean.startsWith("/clone")) {
      return await this.handleMemberMimic(rawText, quotedMessage, senderName);
    }
    if (clean.startsWith("@movie") || clean.startsWith("/movie") || clean.startsWith("@cast") || clean.startsWith("/cast") || clean.startsWith("@poster") || clean.startsWith("/poster")) {
      return await this.handleMovieCastPoster(sock, groupJid, rawText, senderName);
    }
    if (clean.startsWith("@vibe") || clean.startsWith("/vibe") || clean.startsWith("@icebreaker") || clean.startsWith("/icebreaker")) {
      return await this.handleVibeRadarAndIcebreaker(groupJid, groupName, rawText, senderName);
    }
    if (clean.startsWith("@lie") || clean.startsWith("/lie") || clean.startsWith("@polygraph") || clean.startsWith("/polygraph")) {
      return await this.handleLieDetector(rawText, quotedMessage, senderName);
    }

    // ── Phase 1: LLM-Driven Natural Language Understanding (Replaces 200+ Regex) ──
    const llmResult = await this.classifyAndExecuteIntent(sock, groupJid, groupName, rawText, senderName, senderPhone, senderJid, messageKey, quotedMessage, isOwner);
    if (llmResult.handled) {
      return llmResult;
    }

    // ── Phase 2: Legacy Regex Fallback (for any edge cases not covered) ──
    const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");

    // Safety toggles
    if (/(?:gaali|abuse|profanity|gandi\s*photo|nsfw|spam)\s*(?:filter|rok|band|delete|hata|guard|block|security)/i.test(clean) || /(?:safety|guard|security)\s*(?:on|chalu|enable|lagao|start)/i.test(clean)) {
      const res = await whatsappGroupSafetyEngine.enableGroupSafety(groupJid, groupName);
      return { handled: true, replyText: res.message };
    }
    if (/(?:saare|sab|sabhi)\s*(?:filter|warnings?|restriction)\s*(?:hatao|band|off|disable|allow)/i.test(clean) || /(?:allow\s*all|sab\s*allow|free\s*chat)/i.test(clean)) {
      const res = await whatsappGroupSafetyEngine.disableGroupSafety(groupJid);
      return { handled: true, replyText: res.message };
    }

    // Voice transcribe toggles
    if (/(?:voice\s*notes?|aawaz|audio)\s*(?:ko\s*)?(?:text|transcribe|likh\s*ke|padh\s*ke)\s*(?:bhejo|on|chalu|enable)/i.test(clean)) {
      const msg = await whatsappGroupSafetyEngine.toggleAutoTranscribeVoice(groupJid, true);
      return { handled: true, replyText: msg };
    }
    if (/(?:voice\s*notes?|audio)\s*(?:transcription?)\s*(band|off|disable)/i.test(clean)) {
      const msg = await whatsappGroupSafetyEngine.toggleAutoTranscribeVoice(groupJid, false);
      return { handled: true, replyText: msg };
    }

    // Translator (if not caught by LLM)
    if (/(?:translate\s*karo|anuvad\s*karo|isko\s*(?:hindi|english|bengali|marathi|tamil|telugu)\s*me)/i.test(clean)) {
      return await this.handleLiveTranslator(rawText, quotedMessage, senderName);
    }

    // 22. Follow-Up "Iska link do" / "Link bhejo" for Songs
    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
    if (whatsappFeatureEngine.isSongLinkFollowUp(rawText, quotedMessage?.text)) {
      const linkReply = whatsappFeatureEngine.handleSongLinkFollowUp(groupJid, rawText, quotedMessage?.text);
      if (linkReply) {
        return { handled: true, replyText: linkReply };
      }
    }

    // 22.1. Song Details Follow-Up ("Singer kaun hai", "Movie name", "Album", "Lyrics", etc.)
    if (whatsappFeatureEngine.isSongDetailsQuery(rawText, quotedMessage?.text)) {
      const detailsReply = whatsappFeatureEngine.handleSongDetailsQuery(groupJid, rawText, quotedMessage?.text);
      if (detailsReply) {
        return { handled: true, replyText: detailsReply };
      }
    }

    // 22.2. Wrong Song / Alternate Version Request ("Ye nahi hai" / "Ye wala nahi" / "Dusra dhundo")
    if (whatsappFeatureEngine.isWrongSongFeedback(rawText, quotedMessage?.text)) {
      const altRes = await whatsappFeatureEngine.handleWrongSongAlternative(groupJid, senderName);
      if (altRes.handled && altRes.replyText) {
        if (altRes.audioBuffer && sock) {
          try {
            await sock.sendMessage(groupJid, {
              audio: altRes.audioBuffer,
              mimetype: "audio/mp4",
              ptt: false,
            });
          } catch (e) {}
        }
        return { handled: true, replyText: altRes.replyText };
      }
    }

    // 22.3. Full Song Request ("Full song" / "Pura gaana" from JioSaavn)
    if (whatsappFeatureEngine.isFullSongRequest(rawText, quotedMessage?.text)) {
      const fullRes = await whatsappFeatureEngine.handleFullSongRequest(groupJid, rawText, senderName);
      if (fullRes.handled && fullRes.replyText) {
        if (fullRes.audioBuffer && sock) {
          try {
            await sock.sendMessage(groupJid, {
              audio: fullRes.audioBuffer,
              mimetype: "audio/mp4",
              ptt: false,
            });
          } catch (e) {}
        }
        return { handled: true, replyText: fullRes.replyText };
      }
    }

    // 22.5. Next Song in Playlist Follow-Up ("Agla gaana" / "Next")
    if (whatsappFeatureEngine.isNextSongRequest(rawText)) {
      const nextRes = await whatsappFeatureEngine.handleNextSongInPlaylist(groupJid, senderName);
      if (nextRes.handled && nextRes.replyText) {
        if (nextRes.audioBuffer && sock) {
          try {
            await sock.sendMessage(groupJid, {
              audio: nextRes.audioBuffer,
              mimetype: "audio/mp4",
              ptt: false,
            });
          } catch (e) {}
        }
        return { handled: true, replyText: nextRes.replyText };
      }
    }

    // 23. Instant Song & Music Radar Intent
    if (/(?:(?:koi\s+)?(?:song|gaana|music)\s+(?:dhundo|sunao|chalao|ka\s*link|bhejo|play\s*karo|preview)|(?:ye\s+)?kaun\s*sa\s*(?:song|gaana)\s*hai)/i.test(clean)) {
      return await this.handleSongFinder(sock, groupJid, rawText, senderName, messageKey);
    }

    // 24. AI Shazam & Humming Intent
    if (/(?:ye\s*kaun\s*sa\s*gaana|shazam|humming|gunguna|audio\s*pehchano)/i.test(clean)) {
      return await this.handleHummingShazam(sock, groupJid, rawText, senderName, quotedMessage, messageKey);
    }

    // 25. Reel & Shorts BGM Intent
    if (/(?:reel\s*ka\s*gaana|background\s*music|bgm\s*batao|shorts?\s*ka\s*gaana|reel\s*audio)/i.test(clean)) {
      return await this.handleReelBgmExtractor(sock, groupJid, rawText, senderName, messageKey);
    }

    // 26. Group Billboard Chart Intent
    if (/(?:group\s*chart|top\s*chart|billboard\s*chart|sabse\s*zyada\s*kaun\s*sa\s*gaana|group\s*ka\s*top\s*song)/i.test(clean)) {
      return await this.handleGroupMusicChart(groupJid, groupName, senderName);
    }

    // ── Phase 2: Suspicious / Ambiguous Intent Classifier (Gemini AI Powered) ─
    const isPotentiallyCommandRelated =
      /(?:tag|mention|roast|tareef|quiz|khel|game|bill|hisab|split|sach|fact|faisla|decision|birthday|janamdin|filter|gaali|safety|voice|audio|quiet|welcome|commands?|rule|rules|lie|jhooth|rap|future|kismat|srk|tony|amitabh|modi|mimic|clone|movie|poster|commentary|song|gaana|music|hum|shazam|reel|bgm|chart)/i.test(clean);

    if (isPotentiallyCommandRelated && (clean.includes("friday") || clean.includes("@") || clean.startsWith("/") || clean.startsWith("#"))) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `You are Friday AI, analyzing whether a user's natural language group message was attempting to trigger one of the available group features/commands.

User message in group: "${rawText}"
Speaker: ${senderName}

Available Group Capabilities:
1. "@everyone [message]" / "@tagall" -> Mentions and notifies all group members for important announcements.
2. "@block safe" -> Enables anti-profanity (gaali filter), anti-NSFW media, anti-spam, and 3-strike kick guard.
3. "@allow all" -> Disables all safety filters and warnings for completely free chat.
4. "@voicenote on/off" -> Automatically transcribes all group voice notes into text cards.
5. "@quiz start [topic]" -> Starts an interactive 5-round group live trivia showdown.
6. "@roast [name]" -> Playful, witty, funny stand-up comedy roast of a member.
7. "@praise [name]" -> High-energy superhero hype-man appreciation card.
8. "@split [amount] [item] [names]" -> Group bill expense & UPI Splitwise calculator.
9. "@judge [claim]" / "@factcheck" -> Verifies claims with real facts and delivers an AI courtroom verdict.
10. "@decision" -> Scans recent conversation to extract agreed plans and assigned tasks.
11. "@birthday add [name] [date]" -> Saves member birthdays for 12:00 AM midnight celebration.
12. "@quiet mode on/off" -> Night quiet mode between 11 PM and 6:30 AM.
13. "@welcome on/off" -> Welcome greeting cards for new members.
14. "@liedetector [claim]" -> AI Polygraph stress analyzer & truth rating.
15. "@rap [name/topic]" -> Hardcore Desi Hip-Hop Gully Boy 8-bar rap.
16. "@future [name]" -> Time machine 2031 hilarious destiny & lifestyle prophecy.
17. "@srk" / "@tonystark" / "@amitabh" / "@modi" [dialogue] -> Celebrity dialogue & style generator.
18. "@mimic [name]" -> Imitates the speaking style & catchphrases of a group member.
19. "@movie [title]" -> Casts group members in a blockbuster film trailer and generates poster.
20. "@commentary [scenario]" -> High-voltage Bhojpuri or Sidhu style live match commentary.
21. "@song [name]" -> Instantly identifies song, singers, lyrics snippet and provides direct YouTube, Spotify, JioSaavn & Apple Music streaming links.

Determine:
1. "CONFIDENT_EXECUTE": If user clearly asked for one of these capabilities. Output: { "action": "EXECUTE", "command": "...", "args": "..." }
2. "SUSPICIOUS_SUGGEST": If user's message is ambiguous, confused, or inquiring about capabilities. Output: { "action": "SUGGEST", "matchedCommands": [ { "cmd": "@...", "desc": "..." } ] }
3. "NORMAL_CHAT": If it is just normal chat. Output: { "action": "IGNORE" }

Output STRICT JSON only:
{
  "action": "EXECUTE" | "SUGGEST" | "IGNORE",
  "command": "@everyone",
  "args": "message text",
  "matchedCommands": [
    { "cmd": "@tagall [Message]", "desc": "Group ke sabhi members ko urgent notice ke liye tag karega." },
    { "cmd": "@quiz start [Topic]", "desc": "Group me live trivia quiz shuru karega." }
  ]
}`;

          const resp = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });

          const json = JSON.parse(resp.text?.trim() || "{}");

          if (json.action === "EXECUTE" && json.command) {
            const execCmd = `${json.command} ${json.args || ""}`.trim();
            if (this.isSuperPowerCommand(execCmd)) {
              return await this.handleSuperPowerCommand(
                sock,
                groupJid,
                groupName,
                execCmd,
                senderName,
                senderPhone,
                senderJid,
                messageKey,
                quotedMessage,
                isOwner
              );
            }
          } else if (json.action === "SUGGEST" && Array.isArray(json.matchedCommands) && json.matchedCommands.length > 0) {
            const cmdItems = json.matchedCommands
              .slice(0, 3)
              .map((c: any, idx: number) => `${idx + 1}️⃣ \`${c.cmd}\`:\n   👉 ${c.desc}`)
              .join("\n\n");

            const suggestionCard = `💡 *Aap ye command chalana chahte hain kya?*
━━━━━━━━━━━━━━━━━━━━━━━━━━
${cmdItems}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 _(Aap command par reply karke ya directly type karke chala sakte hain!)_`;

            return { handled: true, replyText: suggestionCard };
          }
        } catch (aiErr) {
          console.warn("[GroupSuperPowers] Intent classification AI error:", aiErr);
        }
      }
    }

    return { handled: false };
  }
}

export const whatsappGroupSuperPowersEngine = new WhatsAppGroupSuperPowersEngine();

