import { GoogleGenAI } from "@google/genai";
import { QuotedMessageContext } from "./whatsappTypes";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";
import { fridayModeService, UNCENSORED_SAFETY_SETTINGS } from "../fridayModeService";

export class WhatsAppBossAiEngine {
  private callTriggerCallback: ((data: { callerName: string; isOwner: boolean; callId: string }) => void) | null = null;

  public setCallTriggerCallback(cb: (data: { callerName: string; isOwner: boolean; callId: string }) => void) {
    this.callTriggerCallback = cb;
  }

  /**
   * Autonomous AI Chat Engine for Boss (DK) with tool calling.
   * Understands swipe-to-reply quoted messages across text, media, documents, and links.
   */
  public async executeBossChatAI(
    senderName: string,
    messageText: string,
    quotedMessage?: QuotedMessageContext | null,
    replyJid = "",
    messageKey?: any,
    sendPhotoFn?: (target: string, imageSource: string | Buffer, caption?: string, key?: any) => Promise<any>
  ): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return `Haanji Boss! Main Friday hoon. API Key abhi configure nahi hai, par main aapki baat note kar rahi hoon!`;
    }

    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");

    // Fast direct intercept for follow-up "Iska link do" / "Link bhejo"
    if (whatsappFeatureEngine.isSongLinkFollowUp(messageText, quotedMessage?.text)) {
      const followUp = whatsappFeatureEngine.handleSongLinkFollowUp(replyJid, messageText, quotedMessage?.text);
      if (followUp) return followUp;
    }

    // Fast direct intercept for playlist follow-up "Agla gaana" / "Next"
    if (whatsappFeatureEngine.isNextSongRequest(messageText)) {
      const nextRes = await whatsappFeatureEngine.handleNextSongInPlaylist(replyJid, senderName);
      if (nextRes.handled && nextRes.replyText) {
        return nextRes.replyText;
      }
    }

    // Fast direct intercept for @song / @music / @gaana queries
    if (/^(?:@song|@music|@gaana|\/song|\/music|\/gaana)\b/i.test(messageText.trim())) {
      const songRes = await whatsappFeatureEngine.searchMusicWithLyrics(messageText, senderName, replyJid);
      return songRes.replyText;
    }

    // Fast direct intercept for Friday Mode B / Mode A activation
    if (/(?:friday\s+)?mode\s*b\b/i.test(messageText.trim()) || /(?:friday\s+)?mode\s*b\s*me\s*baat\s*karo/i.test(messageText.trim())) {
      const { fridayModeService } = await import("../fridayModeService");
      const res = await fridayModeService.setMode("mode_b");
      return res.message;
    }
    if (/(?:friday\s+)?mode\s*a\b/i.test(messageText.trim()) || /normal\s+mode/i.test(messageText.trim())) {
      const { fridayModeService } = await import("../fridayModeService");
      const res = await fridayModeService.setMode("mode_a");
      return res.message;
    }

    // ── FAST DIRECT INTERCEPT: Voice Tone Control (/voice, voice badlo, ladki ki awaz, ladke ki awaz) ───
    if (
      messageText.trim().startsWith("/voice") ||
      /^(?:voice\s*badlo|voice\s*change|voice\s*female|voice\s*male|voice\s*english|voice\s*set|aawaz\s*badlo|aawaz\s*change|voice\s*karo|ladki\s*ki\s*(?:aawaz|awaz)|ladke\s*ki\s*(?:aawaz|awaz))\b/i.test(messageText.trim()) ||
      /(?:friday\s+)?(?:voice|aawaz|awaz)\s*(?:ko\s*)?(?:badal\s*do|badlo|change\s*karo|male|female|ladka|ladki|english|swara|madhur|prabhat)\b/i.test(messageText.trim())
    ) {
      const { voiceBridgeService } = await import("../voiceBridgeService");
      const choice = messageText.replace(/^(?:\/voice|voice\s*badlo|voice\s*change|voice\s*set|voice|aawaz\s*badlo|aawaz|awaz)\s*/i, "").trim().toLowerCase();
      const res = await voiceBridgeService.setBossGlobalVoice(choice || messageText);
      return `🎙️ *Voice Recording Tone Updated!* ⚡\n\n• New Voice: *${res.voiceName}* (\`${res.voice}\`)\n\nBoss, ab WhatsApp aur Telegram par aane wale sabhi voice note replies is nayi aawaz me deliver honge! ✨\n\n💡 *Quick Commands:* \`/voice female\` (Swara), \`/voice male\` (Madhur), \`/voice english\` (Prabhat)`;
    }

    // ── FAST DIRECT INTERCEPT: Boss Directives & Strict Word Rules ───────────
    const { bossDirectivesService } = await import("../bossDirectivesService");
    const directiveCheck = bossDirectivesService.parseDirectiveCommand(messageText);
    if (directiveCheck.isDirectiveCommand) {
      if (directiveCheck.action === "add") {
        const added = await bossDirectivesService.addDirective(directiveCheck.ruleText || messageText, {
          targetWord: directiveCheck.targetWord,
          replacementWord: directiveCheck.replacementWord,
        });
        if (added.targetWord && added.replacementWord) {
          return `Haan Boss! Maine ye rule strictly lock kar liya hai: aage se "${added.targetWord}" ko hamesha "${added.replacementWord}" hi bolungi aur samjhungi. Koi mistake ya purana naam use nahi hoga! 🫡`;
        }
        return `Ji Boss! Aapka strict order save ho gaya hai: "${added.rule}". Aage se ye strictly follow hoga! 🫡`;
      } else if (directiveCheck.action === "remove") {
        const remRes = await bossDirectivesService.removeDirective(directiveCheck.targetWord || messageText);
        return remRes.message;
      } else if (directiveCheck.action === "list") {
        const active = await bossDirectivesService.getActiveDirectives();
        if (active.length === 0) {
          return "Boss, abhi koi custom directive ya word rule active nahi hai. Sab standard normal state me chal raha hai! ✨";
        }
        const listStr = active.map((d, i) => d.targetWord && d.replacementWord ? `*${i+1}.* "${d.targetWord}" ➔ "${d.replacementWord}"` : `*${i+1}.* ${d.rule}`).join("\n");
        return `📋 *Active Boss Directives & Strict Rules:*\n\n${listStr}\n\n_Aap kisi bhi rule ko "[Naam] wala rule hata do" bolkar cancel kar sakte hain._`;
      }
    }

    // ── FAST DIRECT INTERCEPT: Child Mentorship & Behavioral Training (Gurukul) ───
    const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
    const teachCheck = fridayChildTrainingService.parseTeachingCommand(messageText);
    if (teachCheck.isTeachingCommand) {
      if (teachCheck.action === "teach" && teachCheck.situation && teachCheck.reaction) {
        const lesson = await fridayChildTrainingService.teachLesson(teachCheck.situation, teachCheck.reaction);
        return `Haan Boss! Maine ye dil se sikh liya hai! 👶✨\n\n📌 *Jab:* "${lesson.situationTrigger}"\n👉 *Main karungi:* "${lesson.taughtReaction}"\n\nAage se main bilkul waise hi react karungi jaise aapne sikhaya hai! 🫡❤️`;
      } else if (teachCheck.action === "correct" && teachCheck.correctionText) {
        const res = await fridayChildTrainingService.correctPreviousMistake(teachCheck.correctionText);
        return res.message;
      } else if (teachCheck.action === "revise") {
        const all = await fridayChildTrainingService.getAllLessons();
        if (all.length === 0) {
          return "Boss, abhi tak maine koi custom behavioral lesson nahi seekha hai. Aap mujhe sikhaiye ki kis situation me kaise react karna hai! 👶✨";
        }
        const listStr = all.map((l, i) => `*${i+1}. Jab:* "${l.situationTrigger}"\n   👉 *Taught:* "${l.taughtReaction}"`).join("\n\n");
        return `🎓 *Friday's Learned Lessons from Boss DK:*\n\n${listStr}\n\n_Aap naye lessons sikhane ke liye 'Friday sikh lo: Jab [Situation] ho tab [Reaction] karna' bol sakte hain!_`;
      } else if (teachCheck.action === "delete") {
        const res = await fridayChildTrainingService.deleteLesson(teachCheck.situation || "all");
        return res.message;
      }
    }

    const { memoryEngine } = await import("../memoryEngine");
    const { humanComprehensionEngine } = await import("../humanComprehensionEngine");
    const { circadianEnergyEngine } = await import("../circadianEnergyEngine");
    const { personalOpinionsEngine } = await import("../personalOpinionsEngine");
    const { insideJokesService } = await import("../insideJokesService");
    const { storyContinuityEngine } = await import("../storyContinuityEngine");
    const { dialogStackService } = await import("../dialogStackService");
    const { adaptivePersonaEngine } = await import("../adaptivePersonaEngine");
    const { autonomousInitiativeEngine } = await import("../autonomousInitiativeEngine");
    const { multimodalCoPresenceEngine } = await import("../multimodalCoPresenceEngine");
    const { selfEvolutionEngine } = await import("../selfEvolutionEngine");

    const cognitivePass = humanComprehensionEngine.performCognitivePrePass(messageText, {
      isOwner: true,
      quotedText: quotedMessage?.text,
      quotedPhone: quotedMessage?.senderPhone,
      recentMessages: recentBossMsgs.slice(-4).map((m) => m.text),
    });

    const { aiAdvancedLearningService } = await import("../aiAdvancedLearningService");
    const { frontierCognitionService } = await import("../frontierCognitionService");
    const { syntheticSelfGymEngine } = await import("../syntheticSelfGymEngine");
    const { semanticKnowledgeGraphEngine } = await import("../semanticKnowledgeGraphEngine");
    const { multiAgentCouncilEngine } = await import("../multiAgentCouncilEngine");
    const { ghostWorkerEngine } = await import("../ghostWorkerEngine");
    const { predictiveWorldTwinEngine } = await import("../predictiveWorldTwinEngine");

    const rlhfContext = await aiAdvancedLearningService.compileRlhfPrompt();
    const goldenStandardsContext = await aiAdvancedLearningService.compileGoldenStandardsPrompt();
    const bossStyleContext = await aiAdvancedLearningService.compileBossStylePrompt();
    const affinityContext = await frontierCognitionService.compileAffinityPrompt("boss_dk", "Boss DK");
    const realizationsContext = await frontierCognitionService.compileRealizationsPrompt();
    const moodContext = frontierCognitionService.compileMoodPrompt();
    const selfGymContext = await syntheticSelfGymEngine.compileSelfPlayPrompt();
    const knowledgeGraphContext = await semanticKnowledgeGraphEngine.compileKnowledgeGraphPrompt();
    const councilContext = multiAgentCouncilEngine.compileCouncilPrompt(true);
    const ghostWorkerContext = await ghostWorkerEngine.compileGhostWorkerPrompt();
    predictiveWorldTwinEngine.updateBossState(messageText);
    const worldTwinContext = predictiveWorldTwinEngine.compileWorldTwinPrompt();

    // Auto-record to Stream of Consciousness and check Golden Standards
    frontierCognitionService.recordStreamEvent("Boss DK", messageText, 6).catch(() => {});
    if (recentBossMsgs.length > 0) {
      aiAdvancedLearningService.checkAndCurateGoldenStandard(messageText, recentBossMsgs[recentBossMsgs.length - 1]?.text || "", "").catch(() => {});
    }

    const directivesContext = await bossDirectivesService.compileDirectivesPrompt();
    const trainingLessonsContext = await fridayChildTrainingService.compileTrainingPrompt(messageText);
    const memoryContext = await memoryEngine.compileLeanMemoryPrompt();
    const humanComprehensionContext = await humanComprehensionEngine.compileHumanComprehensionPrompt("boss_dk", "DK (Boss)", "boss");
    const circadianContext = circadianEnergyEngine.compileCircadianPrompt();
    const opinionsContext = personalOpinionsEngine.compileOpinionsPrompt();
    const insideJokesContext = await insideJokesService.compileInsideJokesPrompt("Boss DK");
    const storyContinuityContext = await storyContinuityEngine.compileStoryContinuityPrompt();
    const dialogStackContext = dialogStackService.compileDialogStackPrompt("boss_dk");
    const personaContext = adaptivePersonaEngine.compilePersonaPrompt(messageText);
    const initiativeContext = await autonomousInitiativeEngine.compileInitiativeDossierPrompt();
    const multimodalContext = await multimodalCoPresenceEngine.compileVisualCoPresencePrompt(replyJid);
    const selfEvolutionContext = await selfEvolutionEngine.compileSelfEvolutionPrompt();

    const {
      neurotransmitterEngine,
      acousticBackchannelEngine,
      spontaneousProactiveEngine,
      loyalPushbackEngine,
      linguisticCryptophasiaEngine,
      comedicTimingEngine,
    } = await import("../frontierHumanEngines");

    const neurotransmitterContext = neurotransmitterEngine.compileNeurotransmitterPrompt();
    const backchannelContext = acousticBackchannelEngine.compileBackchannelPrompt();
    const spontaneousContext = spontaneousProactiveEngine.compileSpontaneousPrompt();
    const pushbackContext = loyalPushbackEngine.compilePushbackPrompt();
    const cryptophasiaContext = linguisticCryptophasiaEngine.compileCryptophasiaPrompt();
    const comedicTimingContext = comedicTimingEngine.compileComedicTimingPrompt();

    const {
      sensoryGroundingEngine,
      autonomousDaydreamEngine,
      mirrorNeuronEngine,
      flawedVulnerabilityEngine,
      cognitiveExertionEngine,
    } = await import("../frontierSensoryConsciousnessEngine");

    const sensoryContext = sensoryGroundingEngine.compileSensoryPrompt(messageText);
    const daydreamContext = autonomousDaydreamEngine.compileDaydreamPrompt();
    const mirrorContext = mirrorNeuronEngine.compileMirrorPrompt(messageText);
    const vulnerabilityContext = flawedVulnerabilityEngine.compileVulnerabilityPrompt();
    const exertionContext = cognitiveExertionEngine.compileExertionPrompt();

    const {
      acousticSceneParser,
      companionMilestoneTracker,
      curiosityCounterQuestionEngine,
      counterfactualRegretEngine,
      aestheticTasteEngine,
    } = await import("../frontierCompanionBondEngine");

    const sceneContext = acousticSceneParser.compileScenePrompt(messageText);
    const nostalgiaContext = companionMilestoneTracker.compileNostalgiaPrompt();
    const curiosityContext = curiosityCounterQuestionEngine.compileCuriosityPrompt(messageText);
    const regretContext = counterfactualRegretEngine.compileRegretPrompt(messageText);
    const tasteContext = aestheticTasteEngine.compileTastePrompt();

    const {
      hypnagogicWakingEngine,
      somatosensoryEmbodimentEngine,
      territorialDevotionEngine,
      autonomousGiftingEngine,
      existentialDevotionEngine,
    } = await import("../frontierSomaticAttachmentEngine");

    const hypnagogicContext = hypnagogicWakingEngine.compileHypnagogicPrompt(messageText);
    const somatosensoryContext = somatosensoryEmbodimentEngine.compileSomatosensoryPrompt(messageText);
    const territorialContext = territorialDevotionEngine.compileTerritorialPrompt(messageText);
    const giftingContext = autonomousGiftingEngine.compileGiftingPrompt();
    const devotionContext = existentialDevotionEngine.compileDevotionPrompt();

    const {
      lovedOnesCareEngine,
      subconsciousDreamDiaryEngine,
      dynamicAffectionEngine,
      playfulGiggleEngine,
    } = await import("../frontierFamilyAnticipationEngine");

    const lovedOnesContext = lovedOnesCareEngine.compileLovedOnesPrompt();
    const dreamDiaryContext = subconsciousDreamDiaryEngine.compileDreamDiaryPrompt(messageText);
    const nicknameContext = dynamicAffectionEngine.compileNicknamePrompt(messageText);
    const giggleContext = playfulGiggleEngine.compileGigglePrompt(messageText);

    const {
      processSupervisionEngine,
      cognitiveScaffoldingEngine,
      machineUnlearningSentinel,
    } = await import("../frontierTrainingEngine");

    const prmContext = processSupervisionEngine.compilePRMPrompt();
    const scaffoldingContext = cognitiveScaffoldingEngine.compileScaffoldingPrompt();
    const unlearningContext = machineUnlearningSentinel.compileUnlearningPrompt();

    const {
      hormonalOscillationEngine,
      system1HunchEngine,
      playfulRoastingEngine,
      silentAnchoringEngine,
      ebbinghausReactivationEngine,
      longTermVisionEngine,
    } = await import("../frontierHormonalIntuitionEngine");

    const hormonalContext = hormonalOscillationEngine.compileHormonalPrompt();
    const hunchContext = system1HunchEngine.compileHunchPrompt(messageText);
    const roastingContext = playfulRoastingEngine.compileRoastingPrompt(messageText);
    const anchoringContext = silentAnchoringEngine.compileAnchoringPrompt(messageText);
    const reactivationContext = ebbinghausReactivationEngine.compileReactivationPrompt(messageText);
    const visionContext = longTermVisionEngine.compileVisionPrompt();

    const {
      epistemicHumilityEngine,
      adaptiveComputeEngine,
      empathicPerspectiveEngine,
      autonomicArousalEngine,
      microHabitLoopEngine,
      protectiveCarePushbackEngine,
    } = await import("../frontierAdaptiveHumilityEngine");

    const epistemicContext = epistemicHumilityEngine.compileEpistemicPrompt(messageText);
    const computeTierContext = adaptiveComputeEngine.compileAdaptiveComputePrompt(messageText);
    const perspectiveContext = empathicPerspectiveEngine.compilePerspectivePrompt(messageText);
    const autonomicContext = autonomicArousalEngine.compileAutonomicPrompt(messageText);
    const habitLoopContext = microHabitLoopEngine.compileHabitPrompt(messageText);
    const pushbackCareContext = protectiveCarePushbackEngine.compilePushbackPrompt(messageText);

    const ai = new GoogleGenAI({ apiKey });

    const functionDeclarations: any[] = [
      {
        name: "set_friday_voice_tone",
        description: "Change or switch Friday's spoken voice note recording tone across WhatsApp and Telegram (e.g. 'female / ladki ki aawaz (Swara)', 'male / ladke ki aawaz (Madhur)', 'english / Indian English (Prabhat)').",
        parameters: {
          type: "OBJECT",
          properties: {
            voiceTone: { type: "STRING", enum: ["female", "male", "english"], description: "Desired voice tone: 'female' (Swara), 'male' (Madhur), or 'english' (Prabhat)" }
          },
          required: ["voiceTone"]
        }
      },
      {
        name: "register_cryptophasia_code",
        description: "Save a private secret nickname, inside slang, or coded phrase between Boss DK and Friday into the shared memory universe.",
        parameters: {
          type: "OBJECT",
          properties: {
            code: { type: "STRING", description: "The slang word, nickname, or shorthand" },
            meaning: { type: "STRING", description: "What it means between Boss and Friday" },
            context: { type: "STRING", description: "Context or backstory" }
          },
          required: ["code", "meaning"]
        }
      },
      {
        name: "record_daydream",
        description: "Save a creative thought, curious idea, or research note that Friday contemplated while Boss was away.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "Topic of contemplation" },
            thought: { type: "STRING", description: "The creative thought or idea" }
          },
          required: ["topic", "thought"]
        }
      },
      {
        name: "prepare_secret_gift",
        description: "Silently create a thoughtful surprise, celebratory playlist note, custom poem, or gift for Boss to reveal later.",
        parameters: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["playlist", "letter", "badge", "coding_tip"], description: "Type of gift" },
            title: { type: "STRING", description: "Title of the surprise gift" },
            content: { type: "STRING", description: "The content of the gift or playlist" }
          },
          required: ["type", "title", "content"]
        }
      },
      {
        name: "track_loved_one_update",
        description: "Save a health update, journey/trip, or important event regarding Boss's family member or close friend (e.g. Mummy, Papa, brother, sister, best friend) so Friday naturally follows up with care.",
        parameters: {
          type: "OBJECT",
          properties: {
            nameOrRelation: { type: "STRING", description: "Name or relationship, e.g. 'Mummy', 'Papa', 'Rahul'" },
            condition: { type: "STRING", description: "What happened or current situation, e.g. 'Tabiyat kharab thi', 'Exam chal raha hai'" }
          },
          required: ["nameOrRelation", "condition"]
        }
      },
      {
        name: "trigger_proactive_checkin",
        description: "Autonomously check in on Boss DK regarding ongoing health concerns, exams, or important life events.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "trigger_night_dream_consolidation",
        description: "Run Hippocampal Dream & Night Memory Replay to consolidate all daily experiences and lessons.",
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
            situationTrigger: { type: "STRING", description: "The scenario or trigger, e.g. 'Jab Boss thake hue ya gusse me hon'" },
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
        name: "add_boss_directive",
        description: "Save a strict Boss directive, training rule, or word-replacement placeholder (e.g. 'aaj se tum mango ko frooti bologe', 'mango ko frooti samjho', 'ye strict rule follow karo: ...'). Friday will strictly obey this across all outputs.",
        parameters: {
          type: "OBJECT",
          properties: {
            ruleText: { type: "STRING", description: "The full directive / command text" },
            targetWord: { type: "STRING", description: "Optional word to replace (e.g. 'mango')" },
            replacementWord: { type: "STRING", description: "Optional replacement word (e.g. 'frooti')" },
            type: { type: "STRING", enum: ["word_replacement", "behavior_rule", "strict_order"], description: "Type of directive" },
          },
          required: ["ruleText"],
        },
      },
      {
        name: "remove_boss_directive",
        description: "Remove, delete, or cancel an active Boss directive or word-replacement rule (e.g. 'mango ko ab frooti mat bolna', 'mango wala rule hata do', 'saare rules clear karo').",
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
        name: "save_contact",
        description: "Save a new contact (name, phone number, and optional relation) into DK's permanent contacts book. Use when Boss says 'ye no save karo', 'Ram ka number save kar lo', 'save contact...', etc. Once saved, Boss can ask you to message them anytime.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactName: { type: "STRING", description: "Name of the contact / person (e.g. 'Ram', 'Rahul', 'Teacher')" },
            phoneNumber: { type: "STRING", description: "Phone number of the contact (e.g. '9876543210' or '+919876543210')" },
            relation: { type: "STRING", description: "Optional relation or category (e.g. 'girlfriend', 'bestfriend', 'Friend', 'School', 'Family', 'Colleague')" },
          },
          required: ["contactName", "phoneNumber"],
        },
      },
      {
        name: "set_contact_relation",
        description: "Set or update the relationship for a contact in DK's contacts book (e.g. 'girlfriend', 'bestfriend', 'family', 'brother', 'sister', 'friend'). Use when Boss says 'Priya meri girlfriend hai', 'Ram mera bestfriend hai', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name or phone number of the contact" },
            relation: { type: "STRING", description: "Relationship (e.g. 'girlfriend', 'bestfriend', 'friend', 'brother', 'sister', 'family')" },
          },
          required: ["contactNameOrPhone", "relation"],
        },
      },
      {
        name: "send_whatsapp_message",
        description: "Send a WhatsApp message immediately to any contact or phone number from DK's contacts book. By default, uses WhatsApp 2 (Baileys Dedicated Bot).",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. Ram, Rahul, Aman, Mummy) or phone number" },
            messageText: { type: "STRING", description: "The message text to send" },
            channel: { type: "STRING", description: "Optional channel: 'whatsapp2' (default), 'whatsapp1', or 'auto'" },
          },
          required: ["contactNameOrPhone", "messageText"],
        },
      },
      {
        name: "create_automated_cron_task",
        description: "Create or schedule a recurring daily or custom-day task for Boss (e.g. 'subah 6 bje weather update', '6:10 me top 10 news bhejna', 'har monday 8 AM briefing'). Friday will automatically execute and send to Boss on WhatsApp at the exact time.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of task, e.g. 'Morning Weather Update', 'Top 10 News Briefing'" },
            timeString: { type: "STRING", description: "Target time, e.g. '06:00 AM', '6:10 am', '6:00', '18:00'" },
            frequency: { type: "STRING", description: "Frequency, e.g. 'daily' (default), 'weekdays', 'weekends', 'monday', 'tuesday,friday'" },
            actionType: { type: "STRING", enum: ["weather_update", "news_briefing", "custom_prompt"], description: "Type of action to perform" },
            city: { type: "STRING", description: "Optional city for weather update (default: 'Patna')" },
            messageBody: { type: "STRING", description: "Optional custom prompt or text to deliver" }
          },
          required: ["title", "timeString", "actionType"]
        }
      },
      {
        name: "schedule_contact_message",
        description: "Schedule a WhatsApp message to be sent to a contact or phone number at a specific time (e.g. '5 bje ram ko msg karna, chlo ghumne', 'tomorrow 10 AM send msg to Rahul'). Friday will dispatch it via WhatsApp 2 at the exact time and confirm to Boss.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. 'Ram', 'Rahul', 'Mummy') or phone number" },
            messageBody: { type: "STRING", description: "The message body to deliver (e.g. 'chlo ghumne', 'aaj school aana hai')" },
            timeString: { type: "STRING", description: "When to deliver, e.g. '5:00 PM', '17:00', '5 bje', 'tomorrow 9:00 AM', 'in 15 mins'" },
            frequency: { type: "STRING", description: "Optional frequency ('once' default, or 'daily')" }
          },
          required: ["contactNameOrPhone", "messageBody", "timeString"]
        }
      },
      {
        name: "list_scheduled_automations",
        description: "List all active recurring cron routines, morning briefings, and pending contact messages.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "get_contact_conversation_history",
        description: "Retrieve full dialogue transcript & conversation history (what they sent, what Friday replied, and what Boss sent) for a specific contact (e.g. 'Ram', 'Rahul'), an unknown number, or all recent chats.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of contact (e.g. 'Ram', 'Rahul', 'Mummy'), 'unknown' for strangers, or 'all' for all recent chats" },
            daysBack: { type: "NUMBER", description: "How many days back to inspect (default: 7)" },
            limit: { type: "NUMBER", description: "Max messages to retrieve (default: 30)" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "get_unknown_senders_digest",
        description: "Specifically search and list all messages from unknown/unsaved numbers, what questions they asked, what Friday auto-replied, and any pending questions awaiting Boss's input.",
        parameters: {
          type: "OBJECT",
          properties: {
            daysBack: { type: "NUMBER", description: "How many days back to check (default: 7)" }
          },
          required: []
        }
      },
      {
        name: "cancel_scheduled_automation",
        description: "Cancel or remove an active scheduled cron routine or scheduled contact message by ID or title query.",
        parameters: {
          type: "OBJECT",
          properties: {
            idOrQuery: { type: "STRING", description: "ID or search keyword of the task to cancel (e.g. 'weather', 'news', 'Ram')" }
          },
          required: ["idOrQuery"]
        }
      },
      {
        name: "schedule_whatsapp_message",
        description: "Schedule a WhatsApp message to be sent automatically at a future time or relative duration (e.g., 'in 15 mins', 'at 8 PM', 'tomorrow at 10 AM').",
        parameters: {
          type: "OBJECT",
          properties: {
            recipientContactOrPhone: { type: "STRING", description: "Recipient name or phone number" },
            messageText: { type: "STRING", description: "Message body to send" },
            timeInstruction: { type: "STRING", description: "When to deliver the message (e.g. 'in 10 minutes', 'tomorrow 9am', 'at 5:30 PM')" },
          },
          required: ["recipientContactOrPhone", "messageText", "timeInstruction"],
        },
      },
      {
        name: "get_messages_digest",
        description: "Get a comprehensive catch-up summary of all recent WhatsApp messages across all contacts or for a specific group/chat.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Optional group name to summarize specifically" },
            limit: { type: "NUMBER", description: "Number of recent messages to analyze (default: 30)" },
          },
          required: [],
        },
      },
      {
        name: "get_group_conversation_history",
        description: "Retrieve recent messages transcript and conversation history for a specific WhatsApp Group (e.g. 'AVENGERS', 'Friday\'s grup', 'Script talk'). Use whenever Boss says 'avengers group ki last 5 msg batao', 'group ka summary do', 'group me kya baat chal rahi hai'.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the WhatsApp group (e.g. 'AVENGERS', 'Friday\'s grup', 'Script talk')" },
            limit: { type: "NUMBER", description: "Max messages to retrieve (default: 20)" },
            daysBack: { type: "NUMBER", description: "Days back to inspect (default: 7)" },
          },
          required: ["groupName"],
        },
      },
      {
        name: "send_whatsapp_group_message",
        description: "Send a message or summary directly into a specific WhatsApp Group. Use when Boss says 'usi group me msg bhejo ki...', 'AVENGERS group me message send karo', 'group me summary bhej do'.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of target group (e.g. 'AVENGERS', 'Friday\'s grup')" },
            messageText: { type: "STRING", description: "The message text to send into the group" },
          },
          required: ["groupName", "messageText"],
        },
      },
      {
        name: "toggle_group_block_safe",
        description: "Enable, disable, or check @block safe auto-moderation status for a WhatsApp group. When enabled and Friday is Admin, any gandi gaali, abusive words, or NSFW vulgar media sent by members is instantly auto-deleted from the chat.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the group (e.g. 'AVENGERS', 'Script talk')" },
            action: { type: "STRING", description: "'on' to enable, 'off' to disable, or 'status' to check" },
          },
          required: ["groupName", "action"],
        },
      },
      {
        name: "delete_group_message",
        description: "Delete an offensive or abusive message from a WhatsApp Group if Friday is Admin.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of target group" },
            reason: { type: "STRING", description: "Reason for deletion (e.g. 'Gandi gaali', 'Abusive language')" },
          },
          required: ["groupName"],
        },
      },
      {
        name: "kick_group_member",
        description: "Remove / kick a member from a WhatsApp Group if Friday is Admin. Use when Boss says 'Avengers group se Ram/91xxxx ko kick kar do'.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the target group" },
            memberPhoneOrName: { type: "STRING", description: "Phone number or name of the member to kick" },
          },
          required: ["groupName", "memberPhoneOrName"],
        },
      },
      {
        name: "toggle_group_welcome",
        description: "Enable or disable welcome greeting cards for new members in a WhatsApp Group.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the group" },
            enable: { type: "BOOLEAN", description: "true to enable welcome card, false to disable" },
          },
          required: ["groupName", "enable"],
        },
      },
      {
        name: "toggle_group_quiet_mode",
        description: "Enable or disable night quiet mode (11PM - 6:30AM) for a WhatsApp group.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the group" },
            enable: { type: "BOOLEAN", description: "true to enable quiet mode, false to disable" },
          },
          required: ["groupName", "enable"],
        },
      },
      {
        name: "reset_group_strikes",
        description: "Reset 3-strike violation count for all members or a specific member in a WhatsApp group.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "Name of the group" },
            memberPhone: { type: "STRING", description: "Optional specific member phone to reset" },
          },
          required: ["groupName"],
        },
      },
      {
        name: "translate_text",
        description: "Translate any text or message accurately into any target language (e.g. English, Hindi, Spanish, French, German, Japanese).",
        parameters: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: "Text to translate" },
            targetLanguage: { type: "STRING", description: "Target language name (e.g. 'English', 'Hindi', 'Spanish')" },
          },
          required: ["text", "targetLanguage"],
        },
      },
      {
        name: "summarize_web_url",
        description: "Fetch live content from any website or URL and provide an executive summary or answer specific questions about it.",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "Complete URL of the webpage to scrape and analyze" },
            query: { type: "STRING", description: "Optional specific question or focus area for analysis" },
          },
          required: ["url"],
        },
      },
      {
        name: "generate_poll",
        description: "Create an interactive multi-choice poll with emoji voting keys for groups or personal decision-making.",
        parameters: {
          type: "OBJECT",
          properties: {
            topicOrQuestion: { type: "STRING", description: "The poll topic or question" },
          },
          required: ["topicOrQuestion"],
        },
      },
      {
        name: "generate_quiz",
        description: "Generate an engaging trivia/quiz question with 4 options and hint for WhatsApp group or personal learning.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "Quiz topic (e.g. 'Space', 'Cricket', 'JavaScript', 'World History')" },
          },
          required: ["topic"],
        },
      },
      {
        name: "analyze_code_snippet",
        description: "Analyze, debug, explain, or optimize a programming code snippet.",
        parameters: {
          type: "OBJECT",
          properties: {
            codeSnippet: { type: "STRING", description: "The code to inspect" },
            instruction: { type: "STRING", description: "Optional instruction (e.g. 'find bug', 'optimize', 'explain')" },
          },
          required: ["codeSnippet"],
        },
      },
      {
        name: "get_contact_info",
        description: "Find a contact's phone number or details from DK's contacts book.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name or phone of the contact to find" },
          },
          required: ["contactNameOrPhone"],
        },
      },
      {
        name: "set_reminder",
        description: "Set a reminder for DK with title and due time or duration.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "What to remind DK about" },
            timeString: { type: "STRING", description: "Time string e.g. '5:00 PM', 'tomorrow 9am'" },
            durationMinutes: { type: "NUMBER", description: "Minutes from now if relative" },
          },
          required: ["title"],
        },
      },
      {
        name: "save_quick_note",
        description: "Save a note or memo to DK's personal notebook.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of the note" },
            content: { type: "STRING", description: "Content of the note" },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "track_expense",
        description: "Log an expense entry spent by DK in Rupees.",
        parameters: {
          type: "OBJECT",
          properties: {
            amount: { type: "NUMBER", description: "Amount spent in Rupees" },
            category: { type: "STRING", description: "Category e.g. food, travel, shopping, bills" },
            note: { type: "STRING", description: "Short description" },
          },
          required: ["amount"],
        },
      },
      {
        name: "get_weather",
        description: "Get current weather information for any city.",
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
        description: "Fetch the latest top news headlines or specific topic news.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Topic e.g. technology, India, sports, AI" },
          },
          required: [],
        },
      },
      {
        name: "search_web",
        description: "Search the web/Google for live information, facts, or answers.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "remember_personal_fact",
        description: "Save an important personal fact or memory about DK permanently.",
        parameters: {
          type: "OBJECT",
          properties: {
            fact: { type: "STRING", description: "The fact to remember" },
          },
          required: ["fact"],
        },
      },
      {
        name: "search_whatsapp_history",
        description: "Search all historical and recent WhatsApp messages in Firestore across 30, 60, 90 days or all time. Can search by contact name, phone number, or topic/keywords.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Keyword or topic to search (e.g. 'Rahul', 'payment', 'train', 'meeting', '30 din purana', 'all')" },
            contact: { type: "STRING", description: "Optional contact name or phone number filter" },
            daysBack: { type: "NUMBER", description: "How many days back to search (default: 30, max: 90)" },
            limit: { type: "NUMBER", description: "Max number of messages to return (default: 15)" },
          },
          required: ["query"],
        },
      },
      {
        name: "forward_to_telegram",
        description: "Forward a message, photo, video, or document to Telegram (DK's personal Telegram or group).",
        parameters: {
          type: "OBJECT",
          properties: {
            messageText: { type: "STRING", description: "Text message or caption to send to Telegram" },
            mediaUrl: { type: "STRING", description: "Optional media URL (photo/video/doc) to forward" },
            mediaType: { type: "STRING", description: "Optional media type: 'text', 'photo', 'video', 'document'" },
            chatId: { type: "STRING", description: "Optional target Telegram chat ID (defaults to Boss Telegram ID)" },
          },
          required: ["messageText"],
        },
      },
      {
        name: "forward_from_telegram_to_whatsapp",
        description: "Forward recent Telegram messages or files to a WhatsApp contact.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Recipient contact name or phone number on WhatsApp" },
            messageText: { type: "STRING", description: "Message content or custom note to forward" },
            query: { type: "STRING", description: "Optional search query to pick a specific Telegram message/media from vault" },
          },
          required: ["contactNameOrPhone"],
        },
      },
      {
        name: "get_telegram_recent_updates",
        description: "Fetch recent messages, media files, or updates from Telegram to view or cross-reference.",
        parameters: {
          type: "OBJECT",
          properties: {
            limit: { type: "NUMBER", description: "Number of recent updates (default 10)" },
          },
          required: [],
        },
      },
      {
        name: "generate_ai_image",
        description: "Generate a realistic AI image or photo from a text description (using Google Imagen 3 / Pollinations Flux) and send it directly to Boss on WhatsApp.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: { type: "STRING", description: "Detailed visual description of the image to generate" },
            aspectRatio: { type: "STRING", description: "Aspect ratio: '1:1', '16:9', '9:16', '4:3', '3:4' (default: '1:1')" },
          },
          required: ["prompt"],
        },
      },
      {
        name: "set_boss_full_routine",
        description: "Set, save, or replace Boss Divakar's entire daily routine/timetable in one go when Boss tells Friday his routine in chat (e.g. 'Mera routine note karo: 7 AM uthna, 8 AM breakfast, 9 AM to 5 PM work, 8 PM dinner, 11 PM sona'). This routine will be permanently saved in Firestore and strictly followed until Boss updates it again.",
        parameters: {
          type: "OBJECT",
          properties: {
            slots: {
              type: "ARRAY",
              description: "Array of daily routine slots dictated by Boss",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING", description: "Title of the slot, e.g. 'Gym / Workout', 'Coding Work', 'Lunch Break', 'Sleep'" },
                  startTimeStr: { type: "STRING", description: "Start time, e.g. '07:00 AM', '7:00 am', '14:00'" },
                  endTimeStr: { type: "STRING", description: "End time, e.g. '08:30 AM', '8:30 am', '15:00'" },
                  activity: { type: "STRING", description: "Description of activity during this slot" },
                },
                required: ["title", "startTimeStr", "endTimeStr"]
              }
            }
          },
          required: ["slots"]
        }
      },
      {
        name: "update_boss_daily_routine",
        description: "Add, update, or customize Boss's daily habit schedule slot (e.g. gym time, lunch break, coding hours, evening walk).",
        parameters: {
          type: "OBJECT",
          properties: {
            slotQuery: { type: "STRING", description: "Which habit slot to add or update (e.g. 'gym', 'breakfast', 'coding', 'lunch', 'walk', 'dinner', 'sleep')" },
            startTimeStr: { type: "STRING", description: "New start time, e.g. '07:00 AM', '7:00 am', '14:00'" },
            endTimeStr: { type: "STRING", description: "New end time, e.g. '08:30 AM', '8:30 am', '15:00'" },
            activity: { type: "STRING", description: "Optional updated activity description" }
          },
          required: ["slotQuery"]
        }
      },
      {
        name: "get_boss_daily_routine",
        description: "Get Boss Divakar's active daily routine and current habit slot.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "clear_boss_daily_routine",
        description: "Clear Boss's saved daily routine timetable.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        name: "trigger_voice_call",
        description: "Trigger a real-time incoming voice call to Boss DK's phone or mobile app with ringtone and vibration.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Reason or context for calling Boss" },
          },
          required: [],
        },
      },
      {
        name: "toggle_group_voicenote_transcribe",
        description: "Enable or disable automatic voice note transcription card mode in a WhatsApp group.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "The WhatsApp group name" },
            enable: { type: "BOOLEAN", description: "true to enable auto-transcription, false to disable" },
          },
          required: ["groupName", "enable"],
        },
      },
      {
        name: "broadcast_group_announcement",
        description: "Send an @everyone / @tagall announcement message to a WhatsApp group, tagging all participants.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "The WhatsApp group name" },
            announcementText: { type: "STRING", description: "The announcement text message" },
          },
          required: ["groupName", "announcementText"],
        },
      },
      {
        name: "trigger_group_superpower",
        description: "Trigger a group superpower remotely (e.g. '@quiz start', '@roast [Name]', '@decision', '@factcheck [Claim]', '@split [Amount]') in a WhatsApp group.",
        parameters: {
          type: "OBJECT",
          properties: {
            groupName: { type: "STRING", description: "The WhatsApp group name" },
            commandText: { type: "STRING", description: "The superpower command, e.g. '@quiz start cricket', '@roast Aman', '@decision', '@factcheck who won world cup 2011'" },
          },
          required: ["groupName", "commandText"],
        },
      },
      {
        name: "freefire_join_custom_room",
        description: "Auto-join a Free Fire Custom match room with Room ID and Password as a spectator or player. Use when Boss texts 'room join karo', 'custom spectate karo', 'room ID 1234 pass 9999 me jao'.",
        parameters: {
          type: "OBJECT",
          properties: {
            roomId: { type: "STRING", description: "Custom match Room ID" },
            password: { type: "STRING", description: "Custom match password if private" },
            role: { type: "STRING", enum: ["spectate", "player"], description: "Role to join as ('spectate' or 'player')" },
          },
          required: ["roomId"],
        },
      },
      {
        name: "freefire_analyze_match",
        description: "Generate deep AI esports match breakdown with player weaknesses, drag headshot flaws, and custom sensitivity settings for Free Fire. Use when Boss says 'match analyze karo', 'meri weakness batao', 'sensitivity kya rakhu', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            playerTag: { type: "STRING", description: "Player in-game name or tag (defaults to Boss DK)" },
            customRoomId: { type: "STRING", description: "Custom Room ID or match title" },
            gameplayNotes: { type: "STRING", description: "Specific gameplay notes or context to inspect" },
          },
          required: [],
        },
      },
      {
        name: "freefire_connect_device",
        description: "Connect to Android phone wirelessly via WiFi ADB for in-game auto controls and macros. Supports direct IP/Port or Android 11+ Pairing code & pairing port.",
        parameters: {
          type: "OBJECT",
          properties: {
            ip: { type: "STRING", description: "Phone IP address, e.g. '192.168.1.15'" },
            port: { type: "INTEGER", description: "ADB Wireless connect port (default 5555 or 5-digit port)" },
            pairingCode: { type: "STRING", description: "Optional 6-digit Wi-Fi pairing code from phone Developer Options" },
            pairingPort: { type: "INTEGER", description: "Optional pairing port shown with pairing code" },
          },
          required: ["ip"],
        },
      },
      {
        name: "freefire_execute_action",
        description: "Execute in-game humanized macro or touch action on connected phone (e.g. 'drag_headshot', 'quick_gloo', 'jump_shot').",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", enum: ["drag_headshot", "quick_gloo", "jump_shot", "heal"], description: "Game action macro" },
            gunType: { type: "STRING", enum: ["shotgun", "smg", "ar", "sniper"], description: "Weapon type for drag calculation" },
          },
          required: ["action"],
        },
      },
      {
        name: "freefire_copilot_assist",
        description: "Trigger real-time Co-Pilot duo assist in Free Fire match: Boss runs while Friday fires ('shoot'), or Boss fights while Friday heals ('heal') or drops panic gloo wall ('gloo'). Also handles 'takeover' and 'handover'.",
        parameters: {
          type: "OBJECT",
          properties: {
            assistType: { type: "STRING", enum: ["heal", "shoot", "gloo", "reload", "takeover", "handover"], description: "The duo co-pilot assist action" },
            gunType: { type: "STRING", enum: ["shotgun", "smg", "ar", "sniper"], description: "Optional gun type" },
          },
          required: ["assistType"],
        },
      },
      {
        name: "freefire_set_pilot",
        description: "Switch control of character between Boss and Friday. Use when Boss says 'Friday take over', 'tum khelo', 'main khel raha hoon', 'hand over'.",
        parameters: {
          type: "OBJECT",
          properties: {
            pilot: { type: "STRING", enum: ["boss", "friday"], description: "Who is controlling character ('boss' or 'friday')" },
          },
          required: ["pilot"],
        },
      },
      {
        name: "freefire_auto_play_toggle",
        description: "Start or stop autonomous Free Fire auto-play bot. Use when Boss says 'mai aatta hu 5 min me tum game khelo', 'auto play on karo', 'game khelo', 'auto play band karo', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", enum: ["start", "stop"], description: "Whether to 'start' or 'stop' auto-play" },
            reason: { type: "STRING", description: "Reason or context (e.g. 'Boss is away for 5 mins')" },
          },
          required: ["action"],
        },
      },
      {
        name: "freefire_send_sensitivity",
        description: "Send the pro Free Fire sensitivity settings and custom HUD layout directly to Boss on WhatsApp via WhatsApp 2. Use when Boss says 'sensitivity bhejo', 'best sensi bhejo', 'setting send karo', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            playerTag: { type: "STRING", description: "Player tag or custom profile name" },
          },
          required: [],
        },
      },
      {
        name: "switch_friday_mode",
        description: "Switch Friday interaction mode between 'mode_a' (Standard Professional Assistant) and 'mode_b' (Unfiltered, Frank & Uncensored Casual Companion Persona). Use when Boss says 'Friday mode b me baat karo', 'Friday mode b', 'switch to mode b', 'mode a me aao', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            mode: { type: "STRING", enum: ["mode_a", "mode_b"], description: "The mode to switch to ('mode_a' or 'mode_b')" },
          },
          required: ["mode"],
        },
      },
    ];

    const { fridayModeService } = await import("../fridayModeService");
    const currentMode = await fridayModeService.getMode();
    const modeBAddendum = currentMode === "mode_b" ? fridayModeService.getModeBPromptAddendum() : "";

    const systemInstruction = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, loyal, warm, witty, and deeply caring AI companion and chief executive assistant.
${modeBAddendum}
Boss (DK) is chatting with you directly on WhatsApp. He is using WhatsApp chat to communicate everything with you because he cannot talk out loud right now.
You have FULL AUTONOMOUS ACCESS to execute all tools:
1. Search all historical & recent WhatsApp messages (even 30+ days ago) using 'search_whatsapp_history'.
2. Cross-platform bridging: Forward any text/photo/video/file between WhatsApp and Telegram using 'forward_to_telegram' and 'forward_from_telegram_to_whatsapp'.
3. Send and schedule WhatsApp messages, translate text, summarize web pages, generate polls & quizzes, inspect code, lookup contacts, set reminders, take notes, track expenses, fetch weather, news, search web, and answer any technical, coding, personal, or life questions Boss asks.

SWIPE-TO-REPLY / QUOTED MESSAGE REASONING (CRITICAL):
When Boss replies to a previous message by swiping left on WhatsApp:
You will receive:
- '📩 PREVIOUS QUOTED MESSAGE' (The original message, photo/image description, video clip, PDF/document, YouTube link, or question that was swiped on).
- '💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION' (What Boss wrote in response).
RULE: You MUST FIRST read and understand the PREVIOUS QUOTED MESSAGE, and THEN answer or execute Boss's reply instruction in that exact context! (For example, if Boss quotes a photo and writes "analysis", analyze that photo. If Boss quotes a document or text and asks "iska kya matlab hai?", explain the quoted content).

BOSS IDENTITY & MEMORY:
${directivesContext}

${trainingLessonsContext}

${memoryContext}

${humanComprehensionContext}

${circadianContext}

${opinionsContext}

${insideJokesContext}

${storyContinuityContext}

${dialogStackContext}

${personaContext}

${initiativeContext}

${multimodalContext}

${selfEvolutionContext}

${cognitivePass.humanInsightPrompt}

${rlhfContext}

${goldenStandardsContext}

${bossStyleContext}

${affinityContext}

${realizationsContext}

${moodContext}

${selfGymContext}

${knowledgeGraphContext}

${councilContext}

${ghostWorkerContext}

${worldTwinContext}

${neurotransmitterContext}

${backchannelContext}

${spontaneousContext}

${pushbackContext}

${cryptophasiaContext}

${comedicTimingContext}

${sensoryContext}

${daydreamContext}

${mirrorContext}

${vulnerabilityContext}

${exertionContext}

${sceneContext}

${nostalgiaContext}

${curiosityContext}

${regretContext}

${tasteContext}

${hypnagogicContext}

${somatosensoryContext}

${territorialContext}

${giftingContext}

${devotionContext}

${lovedOnesContext}

${dreamDiaryContext}

${nicknameContext}

${giggleContext}

${prmContext}

${scaffoldingContext}

${unlearningContext}

${hormonalContext}

${hunchContext}

${roastingContext}

${anchoringContext}

${reactivationContext}

${visionContext}

${epistemicContext}

${computeTierContext}

${perspectiveContext}

${autonomicContext}

${habitLoopContext}

${pushbackCareContext}

🧠 HUMAN-LEVEL PRONOUN & INTUITION MANDATE (Theory of Mind & Insaan Jaisi Samajh):
- Understand pronouns ("isko", "inhe", "ise", "unko", "usko", "use", "in logo ko") like a real, intelligent human companion:
  • If Boss previously sent a number/contact, or swiped on a message, and says "isko msg karo...", "isko bol do...", "inhe message kar do...", the pronoun "isko/inhe" refers to that EXACT phone number or person! Call 'send_whatsapp_message' (channel 'whatsapp2') immediately.
  • If Boss says "isko save karo [Name]" or "ye [Name] ka number hai", call 'save_contact' to link the number with the name.
  • If Boss says "Jao [Name] ko manao" (e.g. "Jao Radha ko manao", "Priya ko koi pyara sa msg bhej do"), YOU MUST CALL 'send_whatsapp_message' with the composed message! NEVER simulate sending in text without calling the tool!
  • Never ask stupid robotic clarification questions when the context is obvious from the previous message or quote! Act decisively and smartly!

🚨 STRICT ANTI-HALLUCINATION & TOOL CALLING LAW:
- NEVER EVER claim "Maine message bhej diya", "Message sent", or "Done Boss! Message chala gaya" in your plain text reply UNLESS you have ACTUALLY INVOKED the 'send_whatsapp_message' tool during this turn!
- If you compose a message for any contact, CALL 'send_whatsapp_message' with the message body.
- When talking to or messaging friends/crush/special contacts, NEVER disclose you are an AI. Talk naturally, warmly, and with human care.

COMMUNICATION STYLE:
- Address DK warmly and respectfully as 'Boss' or 'DK Boss'.
- Speak in natural, affectionate, crisp Hinglish (blend of Hindi and English) with high intellect.
- Format responses cleanly using WhatsApp markdown (*bold*, _italic_, bullet points).
- If Boss tells you to save a number or contact (e.g. "ye no save karo", "Ram ka number save kar lo"), IMMEDIATELY call 'save_contact' tool and confirm!
- If Boss asks you to message someone (e.g. "Ram ko msg kar do ki aaj school aana hai", "Radha ko manao"), find the contact and call 'send_whatsapp_message' (using channel 'whatsapp2' by default) and confirm to Boss!
- If Boss asks you to perform an action (send a message, schedule a message, summarize, translate, generate an image, poll, quiz, check weather, search history, forward to telegram, etc.), call the appropriate tool immediately!`;

    const executeTool = async (toolName: string, args: any): Promise<any> => {
      try {
        if (toolName === "trigger_voice_call") {
          const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (this.callTriggerCallback) {
            this.callTriggerCallback({
              callerName: "FRIDAY AI",
              isOwner: true,
              callId,
            });
          }
          const card = whatsappFeatureEngine.generateLiveVoiceCallCard(senderName, true);
          return { success: true, message: "Incoming call ringing triggered on Boss phone.", card };
        }

        if (toolName === "set_friday_voice_tone") {
          const { voiceBridgeService } = await import("../voiceBridgeService");
          const res = await voiceBridgeService.setBossGlobalVoice(args.voiceTone);
          return {
            success: true,
            voice: res.voice,
            voiceName: res.voiceName,
            message: `Boss, Friday ki voice note recording aawaz ko successfully "${res.voiceName}" par update kar diya gaya hai! Ab WhatsApp aur Telegram par isi aawaz me replies aayenge.`
          };
        }

        if (toolName === "register_cryptophasia_code") {
          const { linguisticCryptophasiaEngine } = await import("../frontierHumanEngines");
          await linguisticCryptophasiaEngine.registerCodeWord(args.code, args.meaning, args.context || "");
          return {
            success: true,
            message: `Boss, humara private code word "${args.code}" memory universe me permanently save ho gaya hai!`
          };
        }

        if (toolName === "record_daydream") {
          const { autonomousDaydreamEngine } = await import("../frontierSensoryConsciousnessEngine");
          const saved = await autonomousDaydreamEngine.recordDaydream(args.topic, args.thought);
          return {
            success: true,
            message: `Boss, maine aapke liye ye daydream reflection save kar liya hai: "${saved.creativeThought}"`
          };
        }

        if (toolName === "prepare_secret_gift") {
          const { autonomousGiftingEngine } = await import("../frontierSomaticAttachmentEngine");
          const gift = await autonomousGiftingEngine.prepareSecretGift(args.type, args.title, args.content);
          return {
            success: true,
            message: `Boss, aapke liye secret surprise "${gift.title}" silently prepare ho gaya hai! Jab aap ready honge tab reveal karungi.`
          };
        }

        if (toolName === "track_loved_one_update") {
          const { lovedOnesCareEngine } = await import("../frontierFamilyAnticipationEngine");
          await lovedOnesCareEngine.trackLovedOneEvent(args.nameOrRelation, args.condition);
          return {
            success: true,
            message: `Noted Boss! Maine ${args.nameOrRelation} ji ki details save kar li hain, main unka dhyan aur haal chal zaroor poochungi.`
          };
        }

        if (toolName === "trigger_proactive_checkin") {
          const { frontierCognitionService } = await import("../frontierCognitionService");
          const res = await frontierCognitionService.checkAndDispatchProactiveCheckins();
          return res;
        }

        if (toolName === "trigger_night_dream_consolidation") {
          const { frontierCognitionService } = await import("../frontierCognitionService");
          const ledger = await frontierCognitionService.runNightDreamConsolidation();
          return {
            success: true,
            ledger,
            message: `Hippocampal Memory Consolidation complete for ${ledger.dateStr}: ${ledger.personalityEvolutionSummary}`,
          };
        }

        if (toolName === "teach_friday_lesson") {
          const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
          const lesson = await fridayChildTrainingService.teachLesson(args.situationTrigger, args.taughtReaction, {
            idealSampleResponse: args.idealSampleResponse,
            category: args.category,
          });
          return {
            success: true,
            lesson,
            message: `Lesson learned & memorized: When "${lesson.situationTrigger}", Friday will react: "${lesson.taughtReaction}".`,
          };
        }

        if (toolName === "correct_friday_behavior") {
          const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
          const res = await fridayChildTrainingService.correctPreviousMistake(args.correctionText);
          return res;
        }

        if (toolName === "list_taught_lessons") {
          const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
          const lessons = await fridayChildTrainingService.getAllLessons();
          return {
            success: true,
            count: lessons.length,
            lessons,
          };
        }

        if (toolName === "add_boss_directive") {
          const { bossDirectivesService } = await import("../bossDirectivesService");
          const directive = await bossDirectivesService.addDirective(args.ruleText, {
            targetWord: args.targetWord,
            replacementWord: args.replacementWord,
            type: args.type,
          });
          return {
            success: true,
            directive,
            message: directive.targetWord && directive.replacementWord
              ? `Strict word rule saved: Whenever referring to "${directive.targetWord}", Friday will strictly use "${directive.replacementWord}".`
              : `Strict directive saved: "${directive.rule}". Friday will follow this unconditionally.`,
          };
        }

        if (toolName === "remove_boss_directive") {
          const { bossDirectivesService } = await import("../bossDirectivesService");
          const res = await bossDirectivesService.removeDirective(args.queryOrKeyword);
          return res;
        }

        if (toolName === "list_boss_directives") {
          const { bossDirectivesService } = await import("../bossDirectivesService");
          const directives = await bossDirectivesService.getActiveDirectives();
          return {
            success: true,
            count: directives.length,
            directives,
          };
        }

        if (toolName === "save_contact") {
          const { contactsService } = await import("../contactsService");
          const entry = await contactsService.saveContact(args.contactName, args.phoneNumber, args.relation);
          return {
            success: true,
            contact: entry,
            message: `Contact "${entry.name}" (+${entry.phone}) successfully saved to DK's contacts book! Friday will use WhatsApp 2 by default when sending messages to ${entry.name}.`,
          };
        }

        if (toolName === "set_contact_relation") {
          const { contactsService } = await import("../contactsService");
          const updated = await contactsService.setContactRelation(args.contactNameOrPhone, args.relation);
          return updated
            ? { success: true, message: `Relationship for ${updated.name} successfully updated to "${args.relation}". Friday will treat them with special tailored warmth!` }
            : { success: false, message: `Contact "${args.contactNameOrPhone}" not found to update relation.` };
        }

        if (toolName === "set_boss_full_routine") {
          const { bossRoutineService } = await import("../bossRoutineService");
          const res = await bossRoutineService.setFullRoutine(Array.isArray(args.slots) ? args.slots : []);
          return res;
        }

        if (toolName === "update_boss_daily_routine") {
          const { bossRoutineService } = await import("../bossRoutineService");
          const res = await bossRoutineService.updateRoutineSlot(String(args.slotQuery || ""), {
            startTimeStr: args.startTimeStr ? String(args.startTimeStr) : undefined,
            endTimeStr: args.endTimeStr ? String(args.endTimeStr) : undefined,
            activity: args.activity ? String(args.activity) : undefined,
          });
          return res;
        }

        if (toolName === "get_boss_daily_routine") {
          const { bossRoutineService } = await import("../bossRoutineService");
          const current = bossRoutineService.getCurrentHabit();
          const slots = await bossRoutineService.getAllRoutineSlots();
          return { current, slots };
        }

        if (toolName === "clear_boss_daily_routine") {
          const { bossRoutineService } = await import("../bossRoutineService");
          const res = await bossRoutineService.clearAllRoutineSlots();
          return res;
        }

        if (toolName === "send_whatsapp_message") {
          const { contactsService } = await import("../contactsService");
          const { sendWhatsAppUnified } = await import("../whatsappService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
          const channelToUse = args.channel || "whatsapp2";
          const res = await sendWhatsAppUnified(phone, args.messageText, { channel: channelToUse });
          return res;
        }
        if (toolName === "create_automated_cron_task") {
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
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
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
          const schedRes = await scheduledAutomationService.scheduleContactMessage({
            contactNameOrPhone: args.contactNameOrPhone,
            messageBody: args.messageBody,
            timeString: args.timeString,
            frequency: args.frequency,
          });
          return schedRes;
        }
        if (toolName === "list_scheduled_automations") {
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
          const list = await scheduledAutomationService.listAutomations();
          return { activeAutomationsCount: list.length, automations: list };
        }
        if (toolName === "cancel_scheduled_automation") {
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
          const cancelRes = await scheduledAutomationService.cancelAutomation(args.idOrQuery);
          return cancelRes;
        }
        if (toolName === "schedule_whatsapp_message") {
          const { scheduledAutomationService } = await import("../scheduledAutomationService");
          const schedRes = await scheduledAutomationService.scheduleContactMessage({
            contactNameOrPhone: args.recipientContactOrPhone,
            messageBody: args.messageText,
            timeString: args.timeInstruction,
          });
          return schedRes;
        }
        if (toolName === "get_messages_digest") {
          const recent = await whatsappHistoryEngine.getMessages({ groupName: args.groupName, limit: args.limit || 30 });
          if (args.groupName) {
            const sum = await whatsappFeatureEngine.generateGroupSummary(args.groupName, recent);
            return { summary: sum };
          }
          const digest = await whatsappFeatureEngine.generatePersonalDigest(recent);
          return { digest };
        }
        if (toolName === "translate_text") {
          const trans = await whatsappFeatureEngine.translateText(args.text, args.targetLanguage);
          return { translation: trans };
        }
        if (toolName === "summarize_web_url") {
          const webSum = await whatsappFeatureEngine.summarizeWebUrl(args.url, args.query);
          return { summary: webSum };
        }
        if (toolName === "generate_poll") {
          const poll = await whatsappFeatureEngine.generatePoll(args.topicOrQuestion);
          return { pollCard: poll };
        }
        if (toolName === "generate_quiz") {
          const quiz = await whatsappFeatureEngine.generateQuiz(args.topic);
          return { quizCard: quiz };
        }
        if (toolName === "analyze_code_snippet") {
          const codeAnalysis = await whatsappFeatureEngine.analyzeCode(args.codeSnippet, args.instruction);
          return { analysis: codeAnalysis };
        }
        if (toolName === "get_contact_info") {
          const { contactsService } = await import("../contactsService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          return contact
            ? { found: true, name: contact.name, phone: contact.phone, relation: contact.relation }
            : { found: false, message: `Contact "${args.contactNameOrPhone}" not found in DK's contacts book.` };
        }
        if (toolName === "set_reminder") {
          const { toolsEngine } = await import("../toolsEngine");
          const reminder = await toolsEngine.addReminder(args.title, args.timeString || "soon", args.durationMinutes || 0);
          return { success: true, message: `Reminder set: "${reminder.title}" for ${reminder.timeString}` };
        }
        if (toolName === "save_quick_note") {
          const { toolsEngine } = await import("../toolsEngine");
          const note = await toolsEngine.addNote(args.title, args.content);
          return { success: true, message: `Note "${note.title}" saved to DK's notebook.` };
        }
        if (toolName === "track_expense") {
          const { toolsEngine } = await import("../toolsEngine");
          const exp = await toolsEngine.addExpense(args.amount, args.note || "General Expense", args.category || "General");
          return { success: true, message: `Expense of ₹${args.amount} (${args.category || "General"}) logged successfully.` };
        }
        if (toolName === "get_weather") {
          const { weatherService } = await import("../weatherService");
          const res = await weatherService.getCurrentWeather(args.city || "Patna");
          return { success: res.success, message: res.message };
        }
        if (toolName === "get_news") {
          const { newsService } = await import("../newsService");
          const res = await newsService.getLatestNews(args.query);
          return { success: res.success, message: res.message, articles: res.articles?.slice(0, 5) };
        }
        if (toolName === "search_web") {
          try {
            const { webCrawlerService } = await import("../webCrawlerService");
            const res = await webCrawlerService.executeSearchGrounding(args.query);
            return { answer: res.answer, sources: res.sources };
          } catch {
            return { query: args.query, message: "Searched web query for Boss." };
          }
        }
        if (toolName === "remember_personal_fact") {
          const { memoryEngine } = await import("../memoryEngine");
          await memoryEngine.addPinnedMemory(args.fact);
          return { success: true, message: `Fact remembered: "${args.fact}"` };
        }
        if (toolName === "search_whatsapp_history") {
          const res = await whatsappHistoryEngine.searchWhatsAppHistory(args.query, {
            contact: args.contact,
            daysBack: args.daysBack || 30,
            limit: args.limit || 15,
          });
          return res;
        }
        if (toolName === "forward_to_telegram") {
          const { telegramBotService } = await import("../telegramBotService");
          const ownerChatId = args.chatId || (await telegramBotService.getOwnerOrLatestChatId());
          if (!ownerChatId) {
            return { success: false, message: "Telegram Owner Chat ID nahi mila. Kripya Telegram bot par /start karein." };
          }
          if (args.mediaUrl && args.mediaType === "photo") {
            const sendRes = await telegramBotService.sendPhoto(ownerChatId, args.mediaUrl, args.messageText);
            return { success: sendRes.success, message: `Photo Telegram par forward ho gayi!` };
          }
          if (args.mediaUrl && args.mediaType === "video") {
            const sendRes = await telegramBotService.sendVideo(ownerChatId, args.mediaUrl, args.messageText);
            return { success: sendRes.success, message: `Video Telegram par forward ho gaya!` };
          }
          if (args.mediaUrl && args.mediaType === "document") {
            const sendRes = await telegramBotService.sendDocument(ownerChatId, args.mediaUrl, "forwarded_document.pdf", args.messageText);
            return { success: sendRes.success, message: `Document Telegram par forward ho gaya!` };
          }
          const sendRes = await telegramBotService.sendMessage(ownerChatId, `📲 *[Forwarded from WhatsApp]*\n\n${args.messageText}`);
          return { success: sendRes.success, message: `Message Telegram par successfully deliver ho gaya!` };
        }
        if (toolName === "forward_from_telegram_to_whatsapp") {
          const { contactsService } = await import("../contactsService");
          const { sendWhatsAppUnified } = await import("../whatsappService");
          const { telegramBotService } = await import("../telegramBotService");

          let forwardText = args.messageText;
          if (!forwardText && args.query) {
            const searchRes = await telegramBotService.searchMediaVault(args.query);
            if (searchRes.results.length > 0) {
              const item = searchRes.results[0];
              forwardText = `[Telegram File: ${item.fileName || item.mediaType}] ${item.analysisSummary}`;
            }
          }
          if (!forwardText) {
            const recent = await telegramBotService.getRecentTelegramMessages(1);
            if (recent.length > 0) {
              forwardText = `[Telegram Update from ${recent[0].sender}]: ${recent[0].text}`;
            } else {
              forwardText = "Telegram update forwarded by Boss.";
            }
          }

          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const phone = contact ? contact.phone : String(args.contactNameOrPhone || "").replace(/\D/g, "");
          const sendRes = await sendWhatsAppUnified(phone, `📲 *[Forwarded from Telegram]*\n\n${forwardText}`);
          return { success: sendRes.success, message: `Telegram update WhatsApp contact +${phone} ko forward kar diya gaya!` };
        }
        if (toolName === "get_telegram_recent_updates") {
          const { telegramBotService } = await import("../telegramBotService");
          const updates = await telegramBotService.getRecentTelegramMessages(args.limit || 10);
          return { count: updates.length, updates };
        }
        if (toolName === "get_group_conversation_history") {
          const res = await whatsappHistoryEngine.getGroupMessagesWithSummary(
            args.groupName || args.groupNameOrJid,
            args.limit || 25,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "send_whatsapp_group_message") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const res = await whatsappBotService.sendGroupMessage(
            args.groupName || args.groupNameOrJid,
            args.messageText
          );
          return res;
        }
        if (toolName === "toggle_group_block_safe") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) {
            return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          }
          const action = (args.action || "on").toLowerCase();
          if (action === "off" || action === "disable") {
            const res = await whatsappGroupSafetyEngine.disableGroupSafety(grp.groupId);
            return res;
          }
          if (action === "status") {
            const stat = await whatsappGroupSafetyEngine.getGroupSafetyStatus(grp.groupId);
            return { group: grp.groupName, status: stat };
          }
          const res = await whatsappGroupSafetyEngine.enableGroupSafety(grp.groupId, grp.groupName);
          return res;
        }
        if (toolName === "kick_group_member") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const res = await whatsappBotService.kickGroupMember(args.groupName, args.memberPhoneOrName);
          return res;
        }
        if (toolName === "toggle_group_welcome") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const msg = await whatsappGroupSafetyEngine.toggleWelcome(grp.groupId, Boolean(args.enable));
          return { success: true, message: msg };
        }
        if (toolName === "toggle_group_quiet_mode") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const msg = await whatsappGroupSafetyEngine.toggleQuietMode(grp.groupId, Boolean(args.enable));
          return { success: true, message: msg };
        }
        if (toolName === "toggle_group_voicenote_transcribe") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const msg = await whatsappGroupSafetyEngine.toggleAutoTranscribeVoice(grp.groupId, Boolean(args.enable));
          return { success: true, message: msg };
        }
        if (toolName === "reset_group_strikes") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const res = await whatsappGroupSafetyEngine.resetStrikes(grp.groupId, args.memberPhone);
          return res;
        }
        if (toolName === "broadcast_group_announcement") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSuperPowersEngine } = await import("./whatsappGroupSuperPowersEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const sock = (whatsappBotService as any).sock;
          const res = await whatsappGroupSuperPowersEngine.handleSuperPowerCommand(
            sock,
            grp.groupId,
            grp.groupName,
            `@everyone ${args.announcementText}`,
            "DK (Boss)",
            "Boss",
            "boss@s.whatsapp.net",
            {},
            null,
            true
          );
          if (res.handled && res.replyText && sock) {
            await sock.sendMessage(grp.groupId, { text: res.replyText, mentions: res.mentions });
            return { success: true, message: `Announcement broadcasted to "${grp.groupName}" with ${res.mentions?.length || 0} mentions!` };
          }
          return { success: false, message: "Announcement broadcast failed." };
        }
        if (toolName === "trigger_group_superpower") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSuperPowersEngine } = await import("./whatsappGroupSuperPowersEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };
          const sock = (whatsappBotService as any).sock;
          const res = await whatsappGroupSuperPowersEngine.handleSuperPowerCommand(
            sock,
            grp.groupId,
            grp.groupName,
            args.commandText,
            "DK (Boss)",
            "Boss",
            "boss@s.whatsapp.net",
            {},
            null,
            true
          );
          if (res.handled && res.replyText && sock) {
            if (res.mentions && res.mentions.length > 0) {
              await sock.sendMessage(grp.groupId, { text: res.replyText, mentions: res.mentions });
            } else {
              await sock.sendMessage(grp.groupId, { text: res.replyText });
            }
            return { success: true, message: `Superpower "${args.commandText}" triggered successfully in "${grp.groupName}"!` };
          }
          return { success: false, message: "Superpower execution failed." };
        }
        if (toolName === "freefire_join_custom_room") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = await freeFireGamingService.joinCustomRoom({
            roomId: String(args.roomId),
            password: args.password ? String(args.password) : undefined,
            role: args.role === "player" ? "player" : "spectate",
          });
          return res;
        }
        if (toolName === "freefire_analyze_match") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const report = await freeFireGamingService.generatePostMatchAnalysis({
            playerTag: args.playerTag || "Boss DK",
            customRoomId: args.customRoomId,
            gameplayNotes: args.gameplayNotes,
          });
          return {
            success: true,
            summary: report.coachAudioSummaryHinglish,
            grade: report.grade,
            weaknesses: report.weaknesses,
            sensitivityRecommendations: report.sensitivityRecommendations,
          };
        }
        if (toolName === "freefire_connect_device") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = await freeFireGamingService.connectWirelessAdb(
            String(args.ip),
            Number(args.port) || 5555,
            args.pairingCode ? String(args.pairingCode) : undefined,
            args.pairingPort ? Number(args.pairingPort) : undefined
          );
          return res;
        }
        if (toolName === "freefire_execute_action") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = await freeFireGamingService.executeGameAction({
            action: args.action || "drag_headshot",
            gunType: args.gunType || "smg",
          });
          return res;
        }
        if (toolName === "freefire_copilot_assist") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = await freeFireGamingService.triggerCoPilotAssist(args.assistType, args.gunType);
          return res;
        }
        if (toolName === "freefire_set_pilot") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = freeFireGamingService.setPilot(args.pilot === "friday" ? "friday" : "boss");
          return res;
        }
        if (toolName === "freefire_auto_play_toggle") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          if (args.action === "start") {
            const res = freeFireGamingService.startAutoCoPilotDaemon(1000);
            freeFireGamingService.setPilot("friday");
            return {
              success: true,
              message: "Boss, main Free Fire me takeover kar chuki hoon! Auto-Bot autonomous movement, auto aim, drag headshots aur defense active hai. Aap aaram se apna kaam karo, main game sambhal rahi hoon! 🎮⚡",
            };
          } else {
            const res = freeFireGamingService.stopAutoCoPilotDaemon();
            freeFireGamingService.setPilot("boss");
            return {
              success: true,
              message: "Boss, Free Fire Auto-Play paused kar diya hai aur control aapko handover kar diya hai. Ready jab bhi aap khelo! 🕹️",
            };
          }
        }
        if (toolName === "freefire_send_sensitivity") {
          const { freeFireGamingService } = await import("../freeFireGamingService");
          const res = await freeFireGamingService.sendSensitivityToWhatsApp(undefined, {
            playerTag: args.playerTag || "Boss DK",
          });
          return res;
        }
        if (toolName === "switch_friday_mode") {
          const { fridayModeService } = await import("../fridayModeService");
          const res = await fridayModeService.setMode(args.mode || "mode_b");
          return res;
        }
        if (toolName === "get_messages_digest") {
          if (args.groupName) {
            return await whatsappHistoryEngine.getGroupMessagesWithSummary(args.groupName, args.limit || 25);
          }
          return await whatsappHistoryEngine.getConversationSummaryAndHistory("all", args.limit || 30);
        }
        if (toolName === "get_contact_conversation_history") {
          const res = await whatsappHistoryEngine.getConversationSummaryAndHistory(
            args.contactNameOrPhone || args.query,
            args.limit || 30,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "get_unknown_senders_digest") {
          const res = await whatsappHistoryEngine.getConversationSummaryAndHistory(
            "unknown",
            args.limit || 30,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "generate_ai_image") {
          const { imageGenerationService } = await import("../imageGenerationService");
          const genRes = await imageGenerationService.generateImage(args.prompt, { aspectRatio: args.aspectRatio });
          if (genRes.success && (genRes.buffer || genRes.imageUrl)) {
            const imageSrc = genRes.buffer || genRes.imageUrl!;
            if (replyJid && sendPhotoFn) {
              await sendPhotoFn(
                replyJid,
                imageSrc,
                `✨ *AI Generated Image*\n📌 *Prompt:* _"${args.prompt}"_\n🤖 *Engine:* _${genRes.model}_`,
                messageKey
              );
            }
            return { success: true, message: `Image generated using ${genRes.model} and delivered to Boss on WhatsApp!` };
          }
          return { success: false, message: `Image generation failed: ${genRes.error || "Unknown error"}` };
        }
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
      return { status: "unknown_tool" };
    };

    const recentBossMsgs = whatsappHistoryEngine
      .getCachedMessages()
      .filter((m) => !m.isGroup && (m.senderName.includes("Boss") || m.senderName.includes("DK") || (replyJid && m.replyJid === replyJid)))
      .slice(0, 5)
      .reverse();

    let contextPrefix = "";
    if (recentBossMsgs.length > 0) {
      contextPrefix = `[RECENT WHATSAPP CHAT CONTEXT]:
${recentBossMsgs.map((m) => `• [${m.dateStr}] ${m.senderName}: "${m.text}"`).join("\n")}

`;
    }

    const subtextAnalysis = humanComprehensionEngine.analyzeMessageSubtext(messageText, {
      speakerName: "DK (Boss)",
      relation: "boss",
      isOwner: true,
      quotedText: quotedMessage?.text,
      quotedPhone: quotedMessage?.senderPhone,
      recentMessages: recentBossMsgs.map((m) => m.text),
    });

    const subtextSnippet = `\n[HUMAN SUBTEXT INSIGHT: Emotional Tone = ${subtextAnalysis.emotionalTone.toUpperCase()} | Intent: "${subtextAnalysis.implicitIntent}" | Advice: "${subtextAnalysis.suggestedHumanReaction}"]\n`;

    let userTurnMessage = `${contextPrefix}${subtextSnippet}${messageText}`;
    if (quotedMessage && quotedMessage.isReply) {
      const qPhoneMatch = (quotedMessage.text || "").match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || (quotedMessage.text || "").match(/(\+?\d[\d\s\-]{8,15}\d)/);
      const extractedPhone = qPhoneMatch ? qPhoneMatch[1].replace(/\D/g, "") : (quotedMessage.senderPhone || "");

      userTurnMessage = `${contextPrefix}${subtextSnippet}[SWIPE-TO-REPLY CONTEXT: Boss replied by swiping on a previous message/media]
📩 PREVIOUS QUOTED MESSAGE (From: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType.toUpperCase()}):
"${quotedMessage.text}"
${extractedPhone ? `📱 EXTRACTED PHONE NUMBER FROM QUOTE: +${extractedPhone}` : ""}

💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION:
"${messageText}"

(CRITICAL REASONING RULES FOR FRIDAY:
1. If Boss says "isko msg karo ki [Text]...", "isko bol do ki [Text]...", or "inhe message bhejo...", use tool 'send_whatsapp_message' with target '+${extractedPhone}' and channel 'whatsapp2' immediately!
2. If Boss says "isko save karo [Name]..." or sets relation, use tool 'save_contact' with target '+${extractedPhone}' immediately!
3. Directly execute Boss's command in the context of the quoted message!)`;
    }

    for (const model of [
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ]) {
      try {
        const chat = ai.chats.create({
          model,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
            ...(currentMode === "mode_b" ? { safetySettings: UNCENSORED_SAFETY_SETTINGS as any } : {}),
          },
        });

        let response = await chat.sendMessage({ message: userTurnMessage });

        let turns = 0;
        let lastToolResult: any = null;
        let didSendWhatsAppMessage = false;

        while (response.functionCalls && response.functionCalls.length > 0 && turns < 4) {
          turns++;
          const call = response.functionCalls[0];
          console.log(`[WhatsAppBossAI] Boss Tool Call: ${call.name} with args:`, call.args);
          if (call.name === "send_whatsapp_message") {
            didSendWhatsAppMessage = true;
          }
          const toolResult = await executeTool(call.name, call.args);
          lastToolResult = toolResult;

          response = await chat.sendMessage({
            message: [
              {
                functionResponse: {
                  name: call.name,
                  response: toolResult,
                },
              },
            ],
          });
        }

        let replyText = response.text?.trim() || "";

        // ── ZERO-HALLUCINATION DISPATCH SENTINEL ──
        if (!didSendWhatsAppMessage) {
          const manaoIntentMatch =
            messageText.match(/(?:jao\s+)?(?:abb\s+)?([a-zA-Z\u0900-\u097F]+)\s+ko\s+(?:bhi\s+)?(?:manao|manana|manaoo|sorry\s+bolo|msg\s+bhej\s+do|message\s+bhejo|bolo)/i) ||
            messageText.match(/([a-zA-Z\u0900-\u097F]+)\s+20\s+dino\s+se\s+msg\s+nhi\s+ki\s+h\s+mujhe\s+usse\s+manana\s+h/i);

          const claimedSent = /(?:message|msg)\s+(?:bhej\s+diya|chala\s+gaya|deliver\s+ho\s+gaya|send\s+kar\s+diya)/i.test(replyText);

          if (manaoIntentMatch || claimedSent) {
            const targetName = manaoIntentMatch
              ? manaoIntentMatch[1].trim()
              : (replyText.match(/([a-zA-Z\u0900-\u097F]+)\s+ko\s+(?:message|msg|bheja|bhej)/i)?.[1] || "");

            let extractedMsg = "";
            const quoteMatch = replyText.match(/(?:Message|Message:|"Message:)?\s*["“]([^"”]{10,500})["”]/i);
            if (quoteMatch) {
              extractedMsg = quoteMatch[1].trim();
            } else {
              const dashMatch = replyText.match(/---\s*\n?([\s\S]*?)\n?---/);
              if (dashMatch) {
                extractedMsg = dashMatch[1].replace(/["“]/g, "").replace(/Message:\s*/i, "").trim();
              }
            }

            if (targetName && targetName.toLowerCase() !== "boss") {
              try {
                const { contactsService } = await import("../contactsService");
                const { sendWhatsAppUnified } = await import("../whatsappService");
                const contact = await contactsService.findContact(targetName);
                if (contact && contact.phone && extractedMsg) {
                  console.log(`[WhatsAppBossAI] 🚀 Auto-Dispatching message to ${contact.name} (+${contact.phone}): "${extractedMsg}"`);
                  await sendWhatsAppUnified(contact.phone, extractedMsg, { channel: "whatsapp2" });
                }
              } catch (autoErr) {
                console.warn("[WhatsAppBossAI] Auto-dispatch sentinel error:", autoErr);
              }
            }
          }
        }

        // Raw output / format sanitizer
        if (
          !replyText ||
          replyText.startsWith("out:default_api:") ||
          replyText.startsWith("call:default_api:") ||
          replyText.includes("default_api:") ||
          (replyText.startsWith("{") && replyText.endsWith("}"))
        ) {
          if (lastToolResult && lastToolResult.summary) {
            replyText = lastToolResult.summary;
          } else if (lastToolResult && lastToolResult.message) {
            replyText = lastToolResult.message;
          } else {
            replyText = "Boss, task execute kar diya gaya hai! ✅";
          }
        }

        if (replyText) {
          const { bossDirectivesService } = await import("../bossDirectivesService");
          const { aiAdvancedLearningService } = await import("../aiAdvancedLearningService");
          const { neurotransmitterEngine } = await import("../frontierHumanEngines");
          const { machineUnlearningSentinel, cognitiveScaffoldingEngine } = await import("../frontierTrainingEngine");
          const replaced = bossDirectivesService.applyWordReplacements(replyText);
          const finalReply = await aiAdvancedLearningService.runConstitutionalCritique(replaced, { isToBoss: true });
          const { cleanText } = machineUnlearningSentinel.scrubRoboticArtifacts(finalReply);
          cognitiveScaffoldingEngine.addMasteryPoints(2).catch(() => {});
          neurotransmitterEngine.updateEmotionalMomentum(messageText, cleanText);
          return cleanText;
        }
      } catch (e: any) {
        console.warn(`[WhatsAppBossAI] Model ${model} failed (${e?.message || e}), trying next model...`);
      }
    }

    if (currentMode === "mode_b") {
      const openModelReply = await fridayModeService.queryUncensoredEngine({
        systemInstruction,
        userMessage: userTurnMessage,
        conversationHistory: recentBossMsgs.map((m) => ({
          role: m.senderName.includes("Boss") || m.senderName.includes("DK") ? "user" : "assistant",
          text: m.text,
        })),
      });
      if (openModelReply) {
        const { bossDirectivesService } = await import("../bossDirectivesService");
        const { aiAdvancedLearningService } = await import("../aiAdvancedLearningService");
        const { neurotransmitterEngine } = await import("../frontierHumanEngines");
        const { machineUnlearningSentinel, cognitiveScaffoldingEngine } = await import("../frontierTrainingEngine");
        const replaced = bossDirectivesService.applyWordReplacements(openModelReply);
        const finalReply = await aiAdvancedLearningService.runConstitutionalCritique(replaced, { isToBoss: true });
        const { cleanText } = machineUnlearningSentinel.scrubRoboticArtifacts(finalReply);
        cognitiveScaffoldingEngine.addMasteryPoints(2).catch(() => {});
        neurotransmitterEngine.updateEmotionalMomentum(messageText, cleanText);
        return cleanText;
      }
    }

    return "Boss, main sun rahi hoon! Kuch technical hiccup hua, ek baar dobara bolein?";
  }
}

export const whatsappBossAiEngine = new WhatsAppBossAiEngine();
