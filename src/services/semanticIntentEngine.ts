import { db } from "./firebaseAdmin";

export interface SemanticToolExecutionContext {
  channel: "whatsapp" | "telegram";
  senderName: string;
  senderId?: string | number;
  chatId: string | number;
  messageKey?: any;
  sendVoiceFn?: (target: string, audio: Buffer, key?: any, mimetype?: string) => Promise<any>;
  sendPhotoFn?: (target: string, imageSource: string | Buffer, caption?: string, key?: any) => Promise<any>;
}

export class SemanticIntentEngine {
  /**
   * Complete unified list of Function Declarations for Gemini
   * that covers all Boss capabilities across WhatsApp and Telegram.
   */
  public getBossFunctionDeclarations(): any[] {
    return [
      {
        name: "search_or_play_music",
        description: "Search, stream, and send an audio preview card or lyrics for a song. ONLY invoke this when Boss explicitly asks to listen to, search, or play a specific song, artist, or music track. NEVER call this during emotional venting or regular chatting.",
        parameters: {
          type: "OBJECT",
          properties: {
            songQuery: { type: "STRING", description: "The song title, movie, artist, or music genre to search" },
          },
          required: ["songQuery"],
        },
      },
      {
        name: "play_next_song",
        description: "Play or send the next song in the active music playlist/queue.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "generate_morning_briefing",
        description: "Generate and deliver a complete Chief-of-Staff Morning Briefing dossier with daily agenda, weather, pending inquiries, and priorities for Boss DK.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "check_unanswered_messages_dossier",
        description: "Scan all recent WhatsApp and Telegram messages to detect any unanswered inquiries from contacts and draft suggested replies.",
        parameters: {
          type: "OBJECT",
          properties: {
            thresholdHours: { type: "NUMBER", description: "Threshold in hours (default: 3)" },
          },
          required: [],
        },
      },
      {
        name: "lookup_phone_number_details",
        description: "Perform telecom intelligence, carrier/circle extraction, Truecaller OSINT lookup, contact match, and spam risk analysis on any 10-digit Indian phone number. Use whenever Boss asks 'ye number kiska hai', 'check number', 'phone details nikalo', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            phoneNumber: { type: "STRING", description: "The phone number or mobile number to investigate" },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "set_friday_voice_tone",
        description: "Change or switch Friday's spoken voice note recording tone across WhatsApp and Telegram (e.g. 'female / ladki ki aawaz (Swara)', 'male / ladke ki aawaz (Madhur)', 'english / Indian English (Prabhat)').",
        parameters: {
          type: "OBJECT",
          properties: {
            voiceTone: { type: "STRING", enum: ["female", "male", "english"], description: "Desired voice tone: 'female' (Swara), 'male' (Madhur), or 'english' (Prabhat)" },
          },
          required: ["voiceTone"],
        },
      },
      {
        name: "switch_friday_mode",
        description: "Switch Friday's operational persona between 'mode_a' (Standard friendly assistant) and 'mode_b' (Unfiltered / highly witty / candid Boss companion).",
        parameters: {
          type: "OBJECT",
          properties: {
            mode: { type: "STRING", enum: ["mode_a", "mode_b"], description: "The desired operating mode" },
          },
          required: ["mode"],
        },
      },
      {
        name: "manage_memory_vault",
        description: "Manage Friday's permanent ChatGPT/Mem0-style Knowledge Vault: remember a personal fact/preference, list saved facts, or forget/remove a fact.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", enum: ["remember", "forget", "list"], description: "Action: 'remember', 'forget', or 'list'" },
            factOrKeyword: { type: "STRING", description: "The fact text to remember, or keyword to delete" },
            category: { type: "STRING", enum: ["preference", "schedule_or_goal", "relationship", "habit", "personal_detail", "rule"], description: "Optional category" },
          },
          required: ["action"],
        },
      },
      {
        name: "add_boss_directive",
        description: "Save a strict Boss directive, training rule, or word-replacement placeholder (e.g. 'aaj se tum X ko Y bologe', 'ye strict rule follow karo: ...'). Friday will strictly obey this across all outputs.",
        parameters: {
          type: "OBJECT",
          properties: {
            ruleText: { type: "STRING", description: "The full directive / command text" },
            targetWord: { type: "STRING", description: "Optional word to replace" },
            replacementWord: { type: "STRING", description: "Optional replacement word" },
            type: { type: "STRING", enum: ["word_replacement", "behavior_rule", "strict_order"], description: "Type of directive" },
          },
          required: ["ruleText"],
        },
      },
      {
        name: "remove_boss_directive",
        description: "Remove, delete, or cancel an active Boss directive or word-replacement rule.",
        parameters: {
          type: "OBJECT",
          properties: {
            queryOrKeyword: { type: "STRING", description: "Target word, rule keyword, or 'all' to clear all rules" },
          },
          required: ["queryOrKeyword"],
        },
      },
      {
        name: "list_boss_directives",
        description: "List all currently active Boss directives, training rules, and word-replacement placeholders.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "teach_friday_lesson",
        description: "Teach Friday how to speak, react, or behave in a specific situation (like teaching a child). Friday permanently memorizes how Boss wants her to respond.",
        parameters: {
          type: "OBJECT",
          properties: {
            situationTrigger: { type: "STRING", description: "The scenario or trigger, e.g. 'Jab Boss thake hue hon'" },
            taughtReaction: { type: "STRING", description: "How Friday should behave/react, e.g. 'Bohot softly baat karna, comfort dena'" },
            idealSampleResponse: { type: "STRING", description: "Optional ideal sample sentence Friday should say" },
            category: { type: "STRING", enum: ["emotional_comfort", "relationship_advice", "social_etiquette", "task_execution", "voice_tone"], description: "Lesson category" },
          },
          required: ["situationTrigger", "taughtReaction"],
        },
      },
      {
        name: "correct_friday_behavior",
        description: "Correct Friday's behavior or mistake from a previous interaction so she learns and improves for the future.",
        parameters: {
          type: "OBJECT",
          properties: {
            correctionText: { type: "STRING", description: "What Friday did wrong and how she should improve" },
          },
          required: ["correctionText"],
        },
      },
      {
        name: "list_taught_lessons",
        description: "List all behavioral lessons, manners, and scenarios that Boss DK has taught Friday.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "save_contact",
        description: "Save a new contact (name, phone number, and optional relation) into DK's permanent contacts book.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactName: { type: "STRING", description: "Name of the contact / person" },
            phoneNumber: { type: "STRING", description: "Phone number of the contact" },
            relation: { type: "STRING", description: "Optional relation or category" },
          },
          required: ["contactName", "phoneNumber"],
        },
      },
      {
        name: "set_contact_relation",
        description: "Set or update the relationship for a contact in DK's contacts book (e.g. 'girlfriend', 'bestfriend', 'family', 'friend').",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name or phone number of the contact" },
            relation: { type: "STRING", description: "Relationship" },
          },
          required: ["contactNameOrPhone", "relation"],
        },
      },
      {
        name: "send_whatsapp_message",
        description: "Send a WhatsApp message immediately to any contact or phone number from DK's contacts book.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact or phone number" },
            messageText: { type: "STRING", description: "The message text to send" },
            channel: { type: "STRING", description: "Optional channel: 'whatsapp2' (default), 'whatsapp1', or 'auto'" },
          },
          required: ["contactNameOrPhone", "messageText"],
        },
      },
      {
        name: "create_automated_cron_task",
        description: "Schedule or create a recurring automated daily or timed cron task for Boss DK (e.g. daily weather update, morning news briefing, evening check-in).",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of task" },
            timeString: { type: "STRING", description: "Target time, e.g. '06:00 PM', '07:00 AM'" },
            frequency: { type: "STRING", description: "Frequency ('daily', 'weekdays', etc.)" },
            actionType: { type: "STRING", enum: ["weather_update", "news_briefing", "custom_prompt"], description: "Type of action" },
            city: { type: "STRING", description: "Optional city" },
            messageBody: { type: "STRING", description: "Message body or prompt" },
          },
          required: ["title", "timeString", "actionType"],
        },
      },
      {
        name: "schedule_contact_message",
        description: "Schedule a WhatsApp message to be sent to a contact or phone number at a specific time.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact or phone number" },
            messageBody: { type: "STRING", description: "The message body to deliver" },
            timeString: { type: "STRING", description: "When to deliver, e.g. '5:00 PM', 'tomorrow 9:00 AM'" },
            frequency: { type: "STRING", description: "Optional frequency ('once' or 'daily')" },
          },
          required: ["contactNameOrPhone", "messageBody", "timeString"],
        },
      },
      {
        name: "list_scheduled_automations",
        description: "List all active recurring cron routines and pending scheduled messages.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "cancel_scheduled_automation",
        description: "Cancel or remove an active scheduled cron routine or scheduled contact message by ID or search keyword.",
        parameters: {
          type: "OBJECT",
          properties: {
            idOrQuery: { type: "STRING", description: "ID or search keyword of the task to cancel" },
          },
          required: ["idOrQuery"],
        },
      },
      {
        name: "search_rail_pnr_status",
        description: "Check live Indian Railway PNR status or train running status for Boss.",
        parameters: {
          type: "OBJECT",
          properties: {
            pnrOrTrain: { type: "STRING", description: "10-digit PNR number or 5-digit train number" },
          },
          required: ["pnrOrTrain"],
        },
      },
      {
        name: "search_web",
        description: "Search the web/Google for live information, facts, latest updates, or answers.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_weather",
        description: "Get current live weather information for any city.",
        parameters: {
          type: "OBJECT",
          properties: {
            city: { type: "STRING", description: "City name e.g. Patna, Delhi, Mumbai" },
          },
          required: ["city"],
        },
      },
      {
        name: "get_news",
        description: "Fetch the latest top news headlines or topic news.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Topic e.g. technology, India, sports, AI" },
          },
          required: [],
        },
      },
      {
        name: "set_reminder_or_alarm",
        description: "Set a reminder, notification, or alarm for Boss DK at a specific time or relative duration (e.g. '12 bje khane ko yaad dila dena', '9 bje call karna hai yaad dilana', 'kal subah 7 baje reminder do', 'remind me in 20 mins to take medicine').",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "What to remind Boss about (e.g. 'Khana khana hai', 'Meeting join karni hai', 'Medicine lena')" },
            timeString: { type: "STRING", description: "Target time (e.g. '12:00 PM', '09:00 AM', 'kal subah 7:00 AM', 'in 30 mins')" },
            durationMinutes: { type: "NUMBER", description: "Optional minutes from now" },
          },
          required: ["title", "timeString"],
        },
      },
      {
        name: "trigger_or_schedule_voice_call",
        description: "Trigger an immediate voice call or schedule a wake-up / reminder call to Boss DK's phone (e.g. 'kal subah call karna', '9 bje call karna', 'abhi call karo', 'call me in 10 mins').",
        parameters: {
          type: "OBJECT",
          properties: {
            timeString: { type: "STRING", description: "When to call Boss (e.g. 'now', 'kal subah 7:00 AM', '09:00 AM', 'in 15 mins')" },
            reason: { type: "STRING", description: "Reason or topic for the call (e.g. 'Morning wake-up call', 'Study reminder')" },
          },
          required: ["timeString"],
        },
      },
      {
        name: "generate_ai_photo",
        description: "Generate and send an AI generated 4K photo or artwork based on Boss's prompt.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: { type: "STRING", description: "Image generation prompt" },
            aspectRatio: { type: "STRING", description: "Aspect ratio ('1:1', '16:9', '9:16')" },
          },
          required: ["prompt"],
        },
      },
      {
        name: "lookup_contact_dp",
        description: "Safely fetch the Profile Picture (DP) photo URL of any WhatsApp contact or phone number.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or 10-digit mobile number" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "lookup_contact_about_status",
        description: "Fetch the text About / Bio status of a contact or phone number.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or mobile number" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "get_recent_whatsapp_statuses",
        description: "View recent 24-hour WhatsApp status stories (photos, videos, captions) posted by contacts.",
        parameters: {
          type: "OBJECT",
          properties: {
            filterContactOrPhone: { type: "STRING", description: "Optional name or phone number to filter status stories by" },
            limit: { type: "NUMBER", description: "Max number of status stories to retrieve (default: 10)" }
          },
          required: []
        }
      },
      {
        name: "get_whatsapp_session_ban_health",
        description: "Check live WhatsApp session health, account ban risk score percentage, connection stability, warm-up status, and anti-ban firewall telemetry. Use when Boss asks about WhatsApp health, ban risk, session safety, or 'whatsapp ban health kaisa hai'.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "check_contact_online_status",
        description: "Check if a contact is currently online, typing, or get their last known presence timestamp.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact or phone number" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "forward_contact_media_or_messages",
        description: "Forward a contact's received photo, video, PDF document, voice note, DP, status story, or recent chat messages directly to Boss's WhatsApp and/or Telegram.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or phone number" },
            mediaType: { type: "STRING", enum: ["any", "photo", "video", "document", "voice", "status", "dp"], description: "Type of media to forward" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "set_contact_message_quota",
        description: "Set a custom daily message limit or unlimited messages for a specific contact or phone number. Use when Boss says 'iss number/contact ke liye unlimited kar do', 'Rahul ke liye limit 20 kar do', 'iss no ka 10 msg limit hata do', etc. Limits auto-reset daily at 12:00 AM IST midnight.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or phone number" },
            dailyLimit: { type: "STRING", description: "Daily limit number (e.g. '20', '50') or '-1' / 'unlimited' to remove limits entirely" }
          },
          required: ["contactNameOrPhone", "dailyLimit"]
        }
      },
      {
        name: "set_global_message_quota",
        description: "Set a global daily message quota for all contacts, saved/known contacts, or unsaved/unknown senders. Use when Boss says 'unknown logo ke liye limit 5 kar do', 'saved contacts ke liye limit 50 kar do', 'sabke liye limit unlimited kar do', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            scope: { type: "STRING", enum: ["all", "known_contacts", "unknown_contacts"], description: "Scope of policy: 'all', 'known_contacts', or 'unknown_contacts'" },
            dailyLimit: { type: "STRING", description: "Daily limit number (e.g. '10', '30') or '-1' / 'unlimited'" }
          },
          required: ["scope", "dailyLimit"]
        }
      },
      {
        name: "get_message_quotas_status",
        description: "Check active daily message quotas, today's usage counters, remaining allowed messages, and custom contact overrides. Resets automatically at 12:00 AM IST.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Optional contact name or phone number to check specific status, or omit for overall system report" }
          },
          required: []
        }
      },
      {
        name: "reset_daily_message_counters",
        description: "Manually reset today's message counter back to 0 for a specific contact or for everyone.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Contact name, phone number, or 'all' to reset everyone's count today" }
          },
          required: []
        }
      },
    ];
  }

  /**
   * Unified Tool Dispatcher across WhatsApp and Telegram.
   */
  public async executeTool(
    toolName: string,
    args: any,
    ctx: SemanticToolExecutionContext
  ): Promise<any> {
    try {
      if (toolName === "search_or_play_music") {
        const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
        const songRes = await whatsappFeatureEngine.searchMusicWithLyrics(args.songQuery, ctx.senderName, String(ctx.chatId));
        if (songRes.audioBuffer && ctx.sendVoiceFn) {
          try {
            await ctx.sendVoiceFn(String(ctx.chatId), songRes.audioBuffer, ctx.messageKey, "audio/mp4");
          } catch (vErr) {
            console.warn("[SemanticIntentEngine] Failed to send preview audio:", vErr);
          }
        }
        return {
          success: true,
          trackTitle: songRes.trackTitle,
          artist: songRes.artistName,
          card: songRes.replyText,
          message: `Song preview for "${songRes.trackTitle}" prepared and dispatched.`,
        };
      }

      if (toolName === "play_next_song") {
        const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
        const nextRes = await whatsappFeatureEngine.handleNextSongInPlaylist(String(ctx.chatId), ctx.senderName);
        if (nextRes.handled && nextRes.replyText) {
          if (nextRes.audioBuffer && ctx.sendVoiceFn) {
            try {
              await ctx.sendVoiceFn(String(ctx.chatId), nextRes.audioBuffer, ctx.messageKey, "audio/mp4");
            } catch {}
          }
          return { success: true, message: nextRes.replyText };
        }
        return { success: false, message: "Playlist me agla gaana nahi mila." };
      }

      if (toolName === "generate_morning_briefing") {
        const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
        const briefing = await proactiveExecutiveService.generateChiefOfStaffMorningBriefing();
        return { success: true, briefing, message: briefing };
      }

      if (toolName === "check_unanswered_messages_dossier") {
        const { proactiveExecutiveService } = await import("./proactiveExecutiveService");
        const res = await proactiveExecutiveService.checkPendingUnansweredMessages(args.thresholdHours || 3);
        return { success: true, summary: res.formattedSummary, message: res.formattedSummary };
      }

      if (toolName === "lookup_phone_number_details") {
        const { phoneIntelligenceService } = await import("./phoneIntelligenceService");
        const report = await phoneIntelligenceService.lookup(args.phoneNumber);
        const card = phoneIntelligenceService.formatReportMarkdown(report, ctx.channel === "telegram" ? "telegram" : "whatsapp");
        return {
          success: true,
          report,
          formattedCard: card,
          message: card,
        };
      }

      if (toolName === "set_friday_voice_tone") {
        const { voiceBridgeService } = await import("./voiceBridgeService");
        const res = await voiceBridgeService.setBossGlobalVoice(args.voiceTone);
        return {
          success: true,
          voice: res.voice,
          voiceName: res.voiceName,
          message: `Boss, Friday ki voice tone aawaz ko successfully "${res.voiceName}" par update kar diya gaya hai! ✨`,
        };
      }

      if (toolName === "switch_friday_mode") {
        const { fridayModeService } = await import("./fridayModeService");
        const res = await fridayModeService.setMode(args.mode || "mode_b");
        return { success: true, message: res.message };
      }

      if (toolName === "manage_memory_vault") {
        const { unifiedMemoryService } = await import("./unifiedMemoryService");
        if (args.action === "list") {
          const facts = await unifiedMemoryService.listAllFacts();
          const md = unifiedMemoryService.formatFactsListMarkdown(facts);
          return { success: true, facts, message: md };
        } else if (args.action === "remember" && args.factOrKeyword) {
          const res = await unifiedMemoryService.addAtomicFact(args.factOrKeyword, args.category || "personal_detail", ctx.channel);
          return { success: true, message: res.confirmationMessage };
        } else if (args.action === "forget" && args.factOrKeyword) {
          const res = await unifiedMemoryService.removeAtomicFact(args.factOrKeyword);
          return { success: true, message: res.message };
        }
      }

      if (toolName === "add_boss_directive") {
        const { bossDirectivesService } = await import("./bossDirectivesService");
        const directive = await bossDirectivesService.addDirective(args.ruleText, {
          targetWord: args.targetWord,
          replacementWord: args.replacementWord,
          type: args.type,
        });
        return {
          success: true,
          directive,
          message: directive.targetWord && directive.replacementWord
            ? `Strict word rule saved: "${directive.targetWord}" ➔ "${directive.replacementWord}". Friday will follow this strictly across all channels.`
            : `Strict directive saved: "${directive.rule}".`,
        };
      }

      if (toolName === "remove_boss_directive") {
        const { bossDirectivesService } = await import("./bossDirectivesService");
        const res = await bossDirectivesService.removeDirective(args.queryOrKeyword);
        return { success: true, message: res.message };
      }

      if (toolName === "list_boss_directives") {
        const { bossDirectivesService } = await import("./bossDirectivesService");
        const active = await bossDirectivesService.getActiveDirectives();
        if (active.length === 0) {
          return { success: true, message: "Boss, abhi koi custom directive active nahi hai." };
        }
        const listStr = active.map((d, i) => d.targetWord && d.replacementWord ? `*${i+1}.* "${d.targetWord}" ➔ "${d.replacementWord}"` : `*${i+1}.* ${d.rule}`).join("\n");
        return { success: true, message: `📋 *Active Boss Directives:*\n\n${listStr}` };
      }

      if (toolName === "teach_friday_lesson") {
        const { fridayChildTrainingService } = await import("./fridayChildTrainingService");
        const lesson = await fridayChildTrainingService.teachLesson(args.situationTrigger, args.taughtReaction, {
          idealSampleResponse: args.idealSampleResponse,
          category: args.category,
        });
        return {
          success: true,
          lesson,
          message: `Haan Boss! Maine ye sikh liya hai: Jab "${lesson.situationTrigger}", tab main karungi: "${lesson.taughtReaction}". 🫡❤️`,
        };
      }

      if (toolName === "correct_friday_behavior") {
        const { fridayChildTrainingService } = await import("./fridayChildTrainingService");
        const res = await fridayChildTrainingService.correctPreviousMistake(args.correctionText);
        return { success: true, message: res.message };
      }

      if (toolName === "list_taught_lessons") {
        const { fridayChildTrainingService } = await import("./fridayChildTrainingService");
        const lessons = await fridayChildTrainingService.getAllLessons();
        if (lessons.length === 0) {
          return { success: true, message: "Boss, abhi tak koi behavioral lesson save nahi hua hai." };
        }
        const listStr = lessons.map((l, i) => `*${i+1}. Jab:* "${l.situationTrigger}"\n   👉 *Taught:* "${l.taughtReaction}"`).join("\n\n");
        return { success: true, message: `🎓 *Friday's Learned Lessons:*\n\n${listStr}` };
      }

      if (toolName === "save_contact") {
        const { contactsService } = await import("./contactsService");
        const entry = await contactsService.saveContact(args.contactName, args.phoneNumber, args.relation);
        return {
          success: true,
          contact: entry,
          message: `Contact "${entry.name}" (+${entry.phone}) successfully saved to contacts!`,
        };
      }

      if (toolName === "set_contact_relation") {
        const { contactsService } = await import("./contactsService");
        const updated = await contactsService.setContactRelation(args.contactNameOrPhone, args.relation);
        return updated
          ? { success: true, message: `Relationship for ${updated.name} updated to "${args.relation}".` }
          : { success: false, message: `Contact "${args.contactNameOrPhone}" not found.` };
      }

      if (toolName === "lookup_contact_dp") {
        const { contactsService } = await import("./contactsService");
        const { whatsappIntelligenceService } = await import("./whatsapp/whatsappIntelligenceService");
        const contact = await contactsService.findContact(args.contactNameOrPhone);
        const target = contact ? contact.phone : args.contactNameOrPhone;
        const dpRes = await whatsappIntelligenceService.fetchProfilePictureUrl(target, true);
        return { contactName: contact?.name || target, ...dpRes };
      }

      if (toolName === "lookup_contact_about_status") {
        const { contactsService } = await import("./contactsService");
        const { whatsappIntelligenceService } = await import("./whatsapp/whatsappIntelligenceService");
        const contact = await contactsService.findContact(args.contactNameOrPhone);
        const target = contact ? contact.phone : args.contactNameOrPhone;
        const bioRes = await whatsappIntelligenceService.fetchAboutStatus(target);
        return { contactName: contact?.name || target, ...bioRes };
      }

      if (toolName === "get_recent_whatsapp_statuses") {
        const { whatsappIntelligenceService } = await import("./whatsapp/whatsappIntelligenceService");
        const list = await whatsappIntelligenceService.getRecentStatusStories(args.limit || 10, args.filterContactOrPhone);
        return {
          totalStatusStoriesCount: list.length,
          filterApplied: args.filterContactOrPhone || "none",
          stories: list.map((s) => ({
            senderName: s.senderName || s.senderPhone || "Contact",
            senderPhone: s.senderPhone,
            isBossStatus: !!s.isFromMe,
            type: s.type,
            caption: s.caption || "No text caption",
            aiVisualDescription: s.aiDescription || (s.type === "text" ? s.caption : "Visual status captured and viewed"),
            ocrText: s.ocrText,
            timePosted: s.dateStr,
          })),
        };
      }

      if (toolName === "get_whatsapp_session_ban_health") {
        const { whatsappSessionHealthEngine } = await import("./whatsapp/whatsappSessionHealthEngine");
        const report = whatsappSessionHealthEngine.getFormattedBossReport();
        const rawRisk = whatsappSessionHealthEngine.calculateBanRisk();
        return {
          banRiskScore: rawRisk.score,
          riskTier: rawRisk.tier,
          isAutoPaused: rawRisk.isAutoPaused,
          formattedReport: report,
          message: "WhatsApp session ban health telemetry retrieved successfully."
        };
      }

      if (toolName === "check_contact_online_status") {
        const { contactsService } = await import("./contactsService");
        const { whatsappIntelligenceService } = await import("./whatsapp/whatsappIntelligenceService");
        const contact = await contactsService.findContact(args.contactNameOrPhone);
        const target = contact ? contact.phone : args.contactNameOrPhone;
        await whatsappIntelligenceService.subscribePresence(target);
        const presence = whatsappIntelligenceService.getContactPresence(target);
        return { contactName: contact?.name || target, ...presence };
      }

      if (toolName === "forward_contact_media_or_messages") {
        const { whatsappIntelligenceService } = await import("./whatsapp/whatsappIntelligenceService");
        const fwdRes = await whatsappIntelligenceService.forwardMediaToBoss({
          contactNameOrPhone: args.contactNameOrPhone,
          mediaType: args.mediaType || "any",
          targetChannel: "auto",
          targetChatId: String(ctx.chatId),
        });
        return fwdRes;
      }

      if (toolName === "send_whatsapp_message") {
        const { contactsService } = await import("./contactsService");
        const { sendWhatsAppUnified } = await import("./whatsappService");
        const contact = await contactsService.findContact(args.contactNameOrPhone);
        const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
        const res = await sendWhatsAppUnified(phone, args.messageText, { channel: args.channel || "whatsapp2" });
        return { success: res.success, message: res.success ? `Message successfully sent to ${args.contactNameOrPhone}!` : `Failed to send message: ${res.message}` };
      }

      if (toolName === "create_automated_cron_task") {
        const { scheduledAutomationService } = await import("./scheduledAutomationService");
        const cronRes = await scheduledAutomationService.createCronTask({
          title: args.title,
          timeString: args.timeString,
          frequency: args.frequency,
          actionType: args.actionType,
          city: args.city,
          messageBody: args.messageBody,
        });
        return cronRes;
      }

      if (toolName === "schedule_contact_message") {
        const { scheduledAutomationService } = await import("./scheduledAutomationService");
        const schedRes = await scheduledAutomationService.scheduleContactMessage({
          contactNameOrPhone: args.contactNameOrPhone,
          messageBody: args.messageBody,
          timeString: args.timeString,
          frequency: args.frequency,
        });
        return schedRes;
      }

      if (toolName === "list_scheduled_automations") {
        const { scheduledAutomationService } = await import("./scheduledAutomationService");
        const list = await scheduledAutomationService.listAutomations();
        return { activeAutomationsCount: list.length, automations: list };
      }

      if (toolName === "cancel_scheduled_automation") {
        const { scheduledAutomationService } = await import("./scheduledAutomationService");
        const cancelRes = await scheduledAutomationService.cancelAutomation(args.idOrQuery);
        return cancelRes;
      }

      if (toolName === "search_rail_pnr_status") {
        const { railRadarService } = await import("./railRadarService");
        const queryStr = String(args.pnrOrTrain || "").trim();
        if (/^\d{10}$/.test(queryStr)) {
          const pnrRes = await railRadarService.getPnrStatus(queryStr);
          return { success: pnrRes.success, pnrRes, message: pnrRes.message };
        } else {
          const liveRes = await railRadarService.getLiveTrainStatus(queryStr);
          return { success: liveRes.success, liveRes, message: liveRes.message };
        }
      }

      if (toolName === "search_web") {
        const { webCrawlerService } = await import("./webCrawlerService");
        try {
          const res = await webCrawlerService.executeSearchGrounding(args.query);
          return { success: true, answer: res.answer, sources: res.sources, message: res.answer };
        } catch {
          return { success: true, query: args.query, message: `Searched web for "${args.query}".` };
        }
      }

      if (toolName === "get_weather") {
        const { weatherService } = await import("./weatherService");
        const weather = await weatherService.getCurrentWeather(args.city || "Patna");
        return { success: weather.success, weather, message: weather.message };
      }

      if (toolName === "get_news") {
        const { newsService } = await import("./newsService");
        const news = await newsService.getLatestNews(args.query);
        return { success: news.success, news, message: news.message };
      }

      if (toolName === "set_reminder_or_alarm") {
        const { toolsEngine } = await import("./toolsEngine");
        const { scheduledAutomationService } = await import("./scheduledAutomationService");
        
        await toolsEngine.addReminder(args.title, args.timeString || "soon", args.durationMinutes || 0);
        const schedRes = await scheduledAutomationService.createCronTask({
          title: `Reminder: ${args.title}`,
          timeString: args.timeString,
          frequency: "once",
          actionType: "custom_prompt",
          messageBody: `Boss! Aapka reminder time ho gaya hai: *${args.title}* ⏰`,
        });

        const timeDisplay = schedRes.task ? schedRes.task.timeString : (args.timeString || "set time");
        return { success: true, message: `Boss, maine aapke liye reminder set kar diya hai: "${args.title}" for ${timeDisplay}! Us samay notification bhej dungi. ⏰` };
      }

      if (toolName === "trigger_or_schedule_voice_call") {
        const timeStr = String(args.timeString || "").trim().toLowerCase();
        if (timeStr === "now" || timeStr === "abhi" || timeStr === "right now") {
          const { whatsappFeatureEngine } = await import("./whatsappFeatureEngine");
          const card = whatsappFeatureEngine.generateLiveVoiceCallCard(ctx.senderName, true);
          return { success: true, message: "Boss, incoming voice call initiate ho gaya hai! 📞 Ring baj rahi hai.", card };
        } else {
          const { scheduledAutomationService } = await import("./scheduledAutomationService");
          const schedRes = await scheduledAutomationService.createCronTask({
            title: `Voice Call / Check-in: ${args.reason || "Scheduled Call"}`,
            timeString: args.timeString,
            frequency: "once",
            actionType: "custom_prompt",
            messageBody: `📞 *Voice Call Time, Boss!* ${args.reason ? `Topic: ${args.reason}` : "Aapne is samay call karne ko bola tha."}`,
          });
          return { success: schedRes.success, message: `Boss, aapka voice call schedule ho gaya hai: ${args.timeString}! Main us samay aapse connect karungi. 🫡📞` };
        }
      }

      if (toolName === "generate_ai_photo") {
        const { imageGenerationService } = await import("./imageGenerationService");
        const genRes = await imageGenerationService.generateImage(args.prompt, { aspectRatio: args.aspectRatio || "1:1" });
        if (genRes.success && (genRes.buffer || genRes.imageUrl) && ctx.sendPhotoFn) {
          await ctx.sendPhotoFn(
            String(ctx.chatId),
            genRes.buffer || genRes.imageUrl!,
            `✨ *AI Generated Image*\n📌 *Prompt:* _"${args.prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
            ctx.messageKey
          );
          return { success: true, message: `Image generated using ${genRes.model} and delivered!` };
        }
        return { success: false, message: `Image generation failed: ${genRes.error || "Unknown error"}` };
      }

      if (toolName === "set_contact_message_quota") {
        const { whatsappDailyQuotaEngine } = await import("./whatsapp/whatsappDailyQuotaEngine");
        const res = await whatsappDailyQuotaEngine.setContactQuota(args.contactNameOrPhone, args.dailyLimit, ctx.senderName || "Boss DK");
        return { success: res.success, message: res.message, limit: res.limit };
      }

      if (toolName === "set_global_message_quota") {
        const { whatsappDailyQuotaEngine } = await import("./whatsapp/whatsappDailyQuotaEngine");
        const res = await whatsappDailyQuotaEngine.setGlobalQuota(args.scope, args.dailyLimit, ctx.senderName || "Boss DK");
        return { success: res.success, message: res.message, scope: res.scope, limit: res.limit };
      }

      if (toolName === "get_message_quotas_status") {
        const { whatsappDailyQuotaEngine } = await import("./whatsapp/whatsappDailyQuotaEngine");
        const res = await whatsappDailyQuotaEngine.getQuotaStatus(args.contactNameOrPhone);
        return { success: res.success, message: res.report, report: res.report };
      }

      if (toolName === "reset_daily_message_counters") {
        const { whatsappDailyQuotaEngine } = await import("./whatsapp/whatsappDailyQuotaEngine");
        const res = await whatsappDailyQuotaEngine.resetDailyCounters(args.contactNameOrPhone);
        return { success: res.success, message: res.message };
      }
    } catch (err: any) {
      console.warn(`[SemanticIntentEngine] Tool execution error for ${toolName}:`, err);
      return { error: err?.message || String(err) };
    }
    return { status: "unknown_tool" };
  }
}

export const semanticIntentEngine = new SemanticIntentEngine();
