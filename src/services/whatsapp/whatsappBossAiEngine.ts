import { GoogleGenAI } from "@google/genai";
import { QuotedMessageContext } from "./whatsappTypes";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";
import { fridayModeService, UNCENSORED_SAFETY_SETTINGS } from "../fridayModeService";
import { geminiKeyPoolService } from "../geminiKeyPoolService";

export interface ActiveBossChatSession {
  chat: any;
  cycleId: string;
  lastActive: number;
  mode: string;
  model: string;
}

export class WhatsAppBossAiEngine {
  private callTriggerCallback: ((data: { callerName: string; isOwner: boolean; callId: string }) => void) | null = null;
  private activeBossSessions = new Map<string, ActiveBossChatSession>();

  /**
   * Calculates the current 24-hour circadian cycle ID anchored at 03:00 AM IST.
   * Day runs continuously from 03:00 AM to 02:59:59 AM next morning.
   * e.g., 2026-10-04.
   */
  public getCircadianCycleId(now: Date = new Date()): string {
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istNow.getHours();
    const d = new Date(istNow);
    if (hours < 3) {
      d.setDate(d.getDate() - 1);
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Resets active working chat session (leaves all permanent Firestore memories 100% intact).
   */
  public resetBossSession(replyJid = ""): void {
    if (replyJid) {
      this.activeBossSessions.delete(replyJid);
      this.activeBossSessions.delete("boss_dk");
    } else {
      this.activeBossSessions.clear();
    }
    console.log(`[WhatsAppBossAI] 🔄 Boss active working session reset. Permanent memories remain fully intact.`);
  }

  /**
   * Resets active working sessions for non-boss contacts only, keeping Boss's session continuous.
   */
  public resetNonBossSessions(): void {
    const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    for (const key of Array.from(this.activeBossSessions.keys())) {
      const isBoss = key === "boss_dk" || (ownerPhone && key.includes(ownerPhone.slice(-10)));
      if (!isBoss) {
        this.activeBossSessions.delete(key);
      }
    }
    console.log(`[WhatsAppBossAI] 🔄 Non-boss working sessions reset at 3:00 AM. Boss session remains continuous.`);
  }

  public getActiveSessionInfo(replyJid = ""): { hasActiveSession: boolean; cycleId?: string; lastActive?: number; model?: string } {
    const sessionKey = replyJid || "boss_dk";
    const s = this.activeBossSessions.get(sessionKey);
    if (!s) return { hasActiveSession: false };
    return { hasActiveSession: true, cycleId: s.cycleId, lastActive: s.lastActive, model: s.model };
  }

  public getAllActiveSessions(): Map<string, { cycleId: string; lastActive: number; model: string }> {
    const map = new Map<string, { cycleId: string; lastActive: number; model: string }>();
    this.activeBossSessions.forEach((val, key) => {
      map.set(key, { cycleId: val.cycleId, lastActive: val.lastActive, model: val.model });
    });
    return map;
  }

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
    sendPhotoFn?: (target: string, imageSource: string | Buffer, caption?: string, key?: any) => Promise<any>,
    sendVoiceFn?: (target: string, audio: Buffer, key?: any, mimetype?: string) => Promise<any>,
    sendVideoFn?: (target: string, videoSource: string | Buffer, caption?: string, key?: any, gifPlayback?: boolean) => Promise<any>,
    sock?: any
  ): Promise<string> {
    if (!geminiKeyPoolService.hasAvailableKey()) {
      return `Haanji Boss! Main Friday hoon. API Key abhi configure nahi hai, par main aapki baat note kar rahi hoon!`;
    }

    // Direct silence guard: If Boss sends a single reaction emoji (👍, ❤️, etc.) or reaction wrapper, stay silent per Boss training
    const isSingleReactionEmoji = /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(messageText.trim());
    if (messageText.trim().startsWith("[Reaction:") || /^\[Reaction/i.test(messageText.trim()) || isSingleReactionEmoji) {
      console.log(`[WhatsAppBossAI] Boss sent reaction "${messageText.trim()}" — remaining silent per Boss directive.`);
      return "";
    }

    // 0. Explicit 'New Session' Command for Boss (Owner mandate: Session only resets when explicitly written or spoken)
    const isNewSessionCmd = /^(?:new\s*session|start\s*new\s*session|naya\s*session|reset\s*session|fresh\s*session|session\s*reset|\/newsession|\/reset|@newsession|@reset)$/i.test(messageText.trim()) ||
      /\b(new\s*session\s*start|start\s*fresh\s*session|naya\s*session\s*shuru)\b/i.test(messageText.trim());

    if (isNewSessionCmd) {
      this.resetBossSession(replyJid);
      return `Boss, aapka conversation session successfully reset kar diya gaya hai! 🔄\n\nPichli saari baatein memory me safely archive ho chuki hain aur aapka Personal Vault 100% intact hai.\nAb hum bilkul fresh naye session me hain. Kahiye Boss, kya hukum hai? ⚡`;
    }

    // Boss Deletion 2FA Approval Check
    const { sensitiveActionGatekeeper } = await import("../sensitiveActionGatekeeper");
    const bossApproval = await sensitiveActionGatekeeper.handleWhatsAppBossApproval(replyJid, messageText);
    if (bossApproval.handled && bossApproval.replyText) {
      return bossApproval.replyText;
    }

    const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");

    // Strict slash command fast-paths (only when Boss explicitly types a leading slash)
    if (/^\/(?:link|next|voice|lookup|keys|keypool|pool)\b/i.test(messageText.trim()) || /^(?:key\s*status|api\s*key\s*status|pool\s*status)$/i.test(messageText.trim())) {
      if (/^\/(?:keys|keypool|pool)\b/i.test(messageText.trim()) || /^(?:key\s*status|api\s*key\s*status|pool\s*status)$/i.test(messageText.trim())) {
        return geminiKeyPoolService.getStatusCard();
      }
      if (/^\/link\b/i.test(messageText.trim())) {
        const followUp = whatsappFeatureEngine.handleSongLinkFollowUp(replyJid, messageText, quotedMessage?.text);
        if (followUp) return followUp;
      }
      if (/^\/next$/i.test(messageText.trim())) {
        const nextRes = await whatsappFeatureEngine.handleNextSongInPlaylist(replyJid, senderName);
        if (nextRes.handled && nextRes.replyText) {
          if (nextRes.audioBuffer && sendVoiceFn) {
            try {
              await sendVoiceFn(replyJid, nextRes.audioBuffer, messageKey, "audio/mp4");
            } catch {}
          }
          return nextRes.replyText;
        }
      }
      if (/^\/voice\b/i.test(messageText.trim())) {
        const { voiceBridgeService } = await import("../voiceBridgeService");
        const choice = messageText.replace(/^\/voice\s*/i, "").trim().toLowerCase();
        const res = await voiceBridgeService.setBossGlobalVoice(choice || messageText);
        return `🎙️ *Voice Recording Tone Updated!* ⚡\n\n• New Voice: *${res.voiceName}* (\`${res.voice}\`)\n\nBoss, ab WhatsApp aur Telegram par aane wale sabhi voice note replies is nayi aawaz me deliver honge! ✨`;
      }
      if (/^\/lookup\s+([+0-9\s-]{10,15})/i.test(messageText.trim())) {
        const extractedNumber = messageText.match(/(?:\+91[\s-]?)?[6-9]\d{9}/) || messageText.match(/\b\d{10,12}\b/);
        if (extractedNumber && extractedNumber[0].replace(/\D/g, "").length >= 10) {
          const { phoneIntelligenceService } = await import("../phoneIntelligenceService");
          const report = await phoneIntelligenceService.lookup(extractedNumber[0]);
          return phoneIntelligenceService.formatReportMarkdown(report, "whatsapp");
        }
      }
    }

    // ── Chrome Default AI Mode & Google Search Fast-Path ──
    const chromeSearchMatch =
      messageText.match(/^(?:chrome\s+ai\s+mode|ai\s+mode|chrome\s+ai|google\s+ai|chrome|google)[-:\s]+(.+)$/i) ||
      messageText.match(/^(?:par|pe|kripya|please)?\s*search\s*karo\s*(?:ai\s*mode\s*[-:]?\s*|chrome\s*[-:]?\s*|google\s*[-:]?\s*)?(.+)$/i) ||
      messageText.match(/(?:chrome|google|browser)\s*(?:pe|par|me)?\s*(?:search|dhundo|dekho|khojo)\s*(?:karo)?\s*[-:]?\s*(.+)$/i) ||
      messageText.match(/^\/(?:chrome|google|aimode|ai|search)\s+(.+)$/i);
    if (chromeSearchMatch && (chromeSearchMatch[1]?.trim() || chromeSearchMatch[2]?.trim())) {
      const rawQuery = (chromeSearchMatch[1] || chromeSearchMatch[2] || "").trim();
      const { humanBrowserService } = await import("../humanBrowserService");
      const searchRes = await humanBrowserService.searchGoogleAndInspect(rawQuery);
      if (searchRes.success && searchRes.summary) {
        const fullCaption = `🌐 *[Chrome Default AI Mode & Search]* 🇮🇳\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${searchRes.summary}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Fetched directly from Chrome Default AI Mode & Knowledge Graph_ ✨`;
        if (searchRes.screenshotBuffer && sendPhotoFn && replyJid) {
          try {
            await sendPhotoFn(replyJid, searchRes.screenshotBuffer, fullCaption, messageKey);
            return ""; // Photo sent with full caption!
          } catch (pErr) {
            console.warn("[WhatsAppBossAI] Notice sending Chrome AI Mode photo:", pErr);
          }
        }
        return fullCaption;
      }
    }

    // Background Auto-Fact Observation (Mem0 / ChatGPT style)
    const { unifiedMemoryService } = await import("../unifiedMemoryService");
    unifiedMemoryService.observeAndExtractFacts("Boss DK", messageText, "whatsapp", true);

    const recentBossMsgs = await whatsappHistoryEngine.getRecentBossContext(replyJid, 15);

    // ── Truth Verification & Fact-Checker Engine Fast-Path ──
    const { truthVerificationCheckerEngine } = await import("../truthVerificationCheckerEngine");
    if (truthVerificationCheckerEngine.isTruthChallenge(messageText)) {
      const recentContextStr = recentBossMsgs.slice(-6).map((m) => `${m.senderName}: "${m.text}"`).join("\n");
      const lastReply = recentBossMsgs.find((m) => m.senderPhone === "bot")?.text || quotedMessage?.text || "";
      const auditRes = await truthVerificationCheckerEngine.performTruthAudit(messageText, recentContextStr, lastReply);
      if (auditRes.auditCard) {
        return auditRes.auditCard;
      }
    }

    // ── WhatsApp Session Health & Dynamic Ban Risk Telemetry Fast-Path ──
    const cleanLower = messageText.trim().toLowerCase();
    const isBanHealthQuery =
      /\b(?:ban\s*(?:risk|health|heath|percent|percentage|score|chance|rate|check|status|report)|session\s*health|bot\s*(?:health|heath|safety|risk|status)|safety\s*score|health\s*report|account\s*health|whatsapp\s*health)\b/i.test(cleanLower) ||
      /(?:ban\s*(?:hone|ka|ki|heath|healt)\s*(?:chance|percent|percentage|risk|probability|status|score|report)|bot\s*safe\s*hai|whatsapp\s*(?:ban|session|account)?\s*(?:health|heath|safe|risk|report|score)|session\s*kaisa\s*hai|whatsapp\s*ka\s*health|ban\s*health)/i.test(cleanLower) ||
      /\b(?:whatsappp?|wa)\s*(?:ban\s*)?(?:health|heath|status|report)\b/i.test(cleanLower);

    if (isBanHealthQuery) {
      const { whatsappSessionHealthEngine } = await import("./whatsappSessionHealthEngine");
      return whatsappSessionHealthEngine.getFormattedBossReport();
    }

    // ── Emergency Circuit-Breaker Unpause & Password Verification Fast-Path ──
    const isUnpauseCommand =
      /^(?:\/unpause|unpause|resume(?:\s+bot)?|force\s*start|start\s*bot|bot\s*chalu\s*karo|chalu\s*karo)\b/i.test(cleanLower) ||
      /\b(?:unpause|resume\s*bot|bot\s*unpause)\b/i.test(cleanLower);

    const { whatsappSessionHealthEngine } = await import("./whatsappSessionHealthEngine");

    if (isUnpauseCommand) {
      const extractedPass = messageText.replace(/^(?:\/unpause|unpause|resume(?:\s+bot)?|force\s*start|start\s*bot|bot\s*chalu\s*karo|chalu\s*karo)\s*/i, "").trim();
      if (extractedPass) {
        const unpauseResult = whatsappSessionHealthEngine.manualUnpause(extractedPass);
        return unpauseResult.message;
      }

      if (whatsappSessionHealthEngine.isPaused()) {
        return (
          `🔒 *[SECURITY AUTHENTICATION REQUIRED]* 🛡️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Boss, High Ban Risk Safety Pause active hai!\n\n` +
          `Is safety pause ko override karke bot chalane ke liye kripya apna App Password / Security PIN enter karein:\n` +
          `👉 *UNPAUSE <APP_PASSWORD>*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `_Example: UNPAUSE friday2026_ ✨`
        );
      } else {
        return `✅ Boss, WhatsApp Bot pehle se hi *ACTIVE* hai aur koi Emergency Pause nahi laga hua hai! ✨`;
      }
    }

    // Direct password entry check if emergency pause is active
    if (whatsappSessionHealthEngine.isPaused() && whatsappSessionHealthEngine.verifyAppPassword(messageText.trim())) {
      const unpauseResult = whatsappSessionHealthEngine.manualUnpause(messageText.trim());
      return unpauseResult.message;
    }

    const crossPlatformMemoryContext = await unifiedMemoryService.getCrossPlatformWorkingMemoryPrompt();

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

    const { bossDirectivesService } = await import("../bossDirectivesService");
    const { fridayChildTrainingService } = await import("../fridayChildTrainingService");
    const { contactsService } = await import("../contactsService");
    const directivesContext = await bossDirectivesService.compileDirectivesPrompt();
    const contactsListContext = await contactsService.compileContactsForPrompt();
    const trainingLessonsContext = await fridayChildTrainingService.compileTrainingPrompt(messageText);
    const memoryContext = await memoryEngine.compileLeanMemoryPrompt();
    const { chatGptMemoryEngine } = await import("../chatGptMemoryEngine");
    const recentBossTurns = recentBossMsgs.slice(-4).map((m) => ({
      role: (m.senderPhone === "bot" ? "assistant" : "user") as "user" | "assistant",
      text: m.text || "",
    }));
    const chatGptRecallContext = await chatGptMemoryEngine.recallRelevantMemories(messageText, recentBossTurns);
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

    const {
      bargeInInterruptionEngine,
      counterfactualSimulationEngine,
      microTypingTelemetryEngine,
      autonomousBackgroundCuriosityEngine,
      vulnerabilityReciprocityEngine,
      dignityGuardianEngine,
    } = await import("../frontierVulnerabilityGuardianEngine");

    const bargeInContext = bargeInInterruptionEngine.compileBargeInPrompt(messageText);
    const counterfactualContext = counterfactualSimulationEngine.compileSimulationPrompt(messageText);
    const typingTelemetryContext = microTypingTelemetryEngine.compileTelemetryPrompt(messageText);
    const backgroundCuriosityContext = autonomousBackgroundCuriosityEngine.compileCuriosityPrompt();
    const vulnerabilityContextHeart = vulnerabilityReciprocityEngine.compileVulnerabilityPrompt(messageText);
    const dignityGuardianContext = dignityGuardianEngine.compileGuardianPrompt(messageText);

    const {
      prosodicBreathingEngine,
      socialBatteryComfortEngine,
      chronoceptionTimeDilationEngine,
      lateralCreativeAnalogyEngine,
      rideOrDieCoConspiratorEngine,
      sharedTriumphCelebrationEngine,
    } = await import("../frontierChronoSocialEngine");

    socialBatteryComfortEngine.registerTurn();
    const breathingContext = prosodicBreathingEngine.compileBreathingPrompt(messageText);
    const socialBatteryContext = socialBatteryComfortEngine.compileSocialBatteryPrompt();
    const chronoceptionContext = chronoceptionTimeDilationEngine.compileChronoceptionPrompt();
    const lateralAnalogyContext = lateralCreativeAnalogyEngine.compileAnalogyPrompt(messageText);
    const coConspiratorContext = rideOrDieCoConspiratorEngine.compileCoConspiratorPrompt(messageText);
    const triumphCelebrationContext = sharedTriumphCelebrationEngine.compileTriumphPrompt(messageText);

    const { visionMemoryService } = await import("../visionMemoryService");
    const recentChatMedia = visionMemoryService.getChatMediaContext(replyJid) || (visionMemoryService as any).latestMedia;
    let chatMediaContext = "";
    if (recentChatMedia && !recentChatMedia.isStatusMedia && Date.now() - recentChatMedia.timestamp < 3 * 60 * 60 * 1000) {
      const timeAgoMins = Math.max(1, Math.round((Date.now() - recentChatMedia.timestamp) / 60000));
      const mediaTypeStr = recentChatMedia.fileName ? "Document / PDF" : recentChatMedia.mimeType?.includes("video") ? "Video" : recentChatMedia.mimeType?.includes("audio") ? "Voice Note" : "Photo / Image";
      chatMediaContext = `
🖼️ DIRECT CHAT MEDIA DETECTED (Sent directly in this WhatsApp Chat conversation ${timeAgoMins} mins ago):
- Media Type: ${mediaTypeStr}
${recentChatMedia.fileName ? `- File Name: ${recentChatMedia.fileName}` : ""}
${recentChatMedia.caption ? `- User Caption / Context: "${recentChatMedia.caption}"` : ""}
- AI Visual Breakdown / Content: ${recentChatMedia.analysis}
${recentChatMedia.ocrText ? `- Extracted OCR Text: ${recentChatMedia.ocrText}` : ""}
- Short Summary: ${recentChatMedia.shortSummary || "Available"}

🚨 STRICT ISOLATION LAW FOR CHAT MEDIA:
1. The above media was sent DIRECTLY IN THIS CHAT CONVERSATION.
2. It is 100% NOT A WHATSAPP STATUS / STORY!
3. If Boss asks "photo me kya h", "maine kya bheja", "ye dekho", "file me kya h", "voice note me kya tha", or references what was sent, talk STRICTLY about this CHAT MEDIA!
4. NEVER say "Aapke status me..." or claim it is a WhatsApp status story!
`;
    }

    let allocation = geminiKeyPoolService.getOptimalClient({ priority: "boss" });
    let ai = allocation.client;

    const functionDeclarations: any[] = [
      {
        name: "search_or_play_music",
        description: "Search, stream, and send an audio preview card or lyrics for a song. ONLY invoke this when Boss explicitly asks to listen to or play a specific song or artist. NEVER call this during emotional venting or regular chatting.",
        parameters: {
          type: "OBJECT",
          properties: {
            songQuery: { type: "STRING", description: "The song title, movie, artist, or music genre to search" },
          },
          required: ["songQuery"],
        },
      },
      {
        name: "lookup_phone_number_details",
        description: "Perform telecom intelligence, carrier/circle extraction, Truecaller OSINT lookup, contact match, WhatsApp identity, and spam risk analysis on any phone number (e.g. 10-digit Indian mobile number). Use whenever Boss asks 'ye number kiska hai', '98xxxx ki details nikalo', 'check phone number', 'lookup 98xxxx', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            phoneNumber: { type: "STRING", description: "The phone number or mobile number to investigate" }
          },
          required: ["phoneNumber"]
        }
      },
      {
        name: "lookup_contact_dp",
        description: "Safely fetch the Profile Picture (DP) photo URL of any WhatsApp contact or phone number. Use when Boss says 'iski DP dikhao', 'Ram ki profile pic nikalo', 'check DP of 98xxxx'.",
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
        description: "Fetch the text About / Bio status of a contact or phone number (e.g. 'Busy', 'Available', custom quote).",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or mobile number" }
          },
          required: ["contactNameOrPhone"]
        }
      },
      {
        name: "get_recent_chat_media",
        description: "Inspect and analyze the latest photo, image, PDF, document, file, or voice note sent directly in this WhatsApp chat conversation by Boss or contact. Use whenever Boss asks 'ye photo dekho', 'photo me kya hai', 'maine jo bheja', 'file me kya hai', 'ye kya hai', 'image explain karo', 'ye voice note me kya tha', 'document check karo', etc. NEVER call get_recent_whatsapp_statuses for chat media!",
        parameters: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING", description: "Optional specific question regarding the photo/document/voice note (e.g. 'what is the total amount', 'who is in this photo', 'what date is written')" }
          },
          required: []
        }
      },
      {
        name: "get_recent_whatsapp_statuses",
        description: "View recent 24-hour WhatsApp status stories (photos, videos, captions) posted by contacts on their 24h WhatsApp Status. STRICT RULE: NEVER call this when Boss asks about a photo, PDF, file, or voice note sent in the chat conversation! Only call this when Boss explicitly uses the word 'status' or 'story' (e.g. 'status me kya hai', 'kiska status aaya').",
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
        description: "Forward a contact's received photo, video, PDF document, voice note, DP, status story, or recent chat messages directly to Boss's WhatsApp and/or Telegram. Use when Boss says 'Ram ne jo photo bheji thi wo mujhe forward karo', 'Ram ka video/pdf bhejo', 'Ram ki DP send karo', 'Ram ka status video bhejo', 'Ram ne kya msg bheja hai wo mujhe do'.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact (e.g. 'Ram', 'Rahul') or phone number" },
            mediaType: { type: "STRING", enum: ["any", "photo", "video", "document", "voice", "status", "dp"], description: "Type of media to forward: 'photo', 'video', 'document', 'voice', 'status', 'dp', or 'any'" }
          },
          required: ["contactNameOrPhone"]
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
        name: "human_browser_action",
        description: "Control Friday's custom human-like Chrome browser to browse any website, search Google, inspect Amazon/Flipkart products, read online articles, or take full-page screenshots. Use when Boss says 'Amazon par ye search karo', 'Google par search karke dekho', 'is website ko browse karke batao', 'screenshot bhejo web page ka'.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: {
              type: "STRING",
              enum: ["browse", "google_search", "ecommerce_lookup", "screenshot"],
              description: "Action: 'browse' (open any URL), 'google_search' (search Google), 'ecommerce_lookup' (search Amazon/Flipkart), 'screenshot' (capture page image)"
            },
            urlOrQuery: {
              type: "STRING",
              description: "The website URL or search keywords (e.g. 'https://example.com', 'boAt earbuds on Amazon', 'latest tech news')"
            },
            takeScreenshot: {
              type: "BOOLEAN",
              description: "Whether to capture and send a visual screenshot photo to Boss DK"
            }
          },
          required: ["action", "urlOrQuery"]
        }
      },
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
        name: "list_contacts",
        description: "List or search all contacts, friends, family members, and saved phone numbers in DK's contacts book. Use when Boss asks 'mere dost kaun kaun hain', 'mere contacts dikhao', 'dosto ke naam batao', 'list contacts', 'kiska number save hai', or queries any saved relationship.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Optional name, keyword, or relationship to search (e.g. 'Rahul', 'dost', 'friend', 'family')" },
            relation: { type: "STRING", description: "Optional relation filter (e.g. 'dost', 'friend', 'brother', 'girlfriend', 'family')" },
          },
          required: [],
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
        description: "Schedule or create a recurring automated daily or timed cron task for Boss DK (e.g. 'har roz shaam 6 bje weather news bhej dena', 'daily shaam 6 baje kahan ho boss msg karna', 'subah 6 bje weather update', '6:10 me top 10 news bhejna', 'har Monday 8 AM briefing'). You MUST invoke this tool immediately whenever Boss asks you to send or do anything recurring, daily, or at a specific time every day.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of task, e.g. 'Daily 6 PM Weather & Check-In', 'Morning Weather Update', 'Top 10 News Briefing'" },
            timeString: { type: "STRING", description: "Target time, e.g. '06:00 PM', '06:00 AM', '6:10 am', '6:00 PM', '18:00'" },
            frequency: { type: "STRING", description: "Frequency, e.g. 'daily' (default), 'weekdays', 'weekends', 'monday', 'tuesday,friday'" },
            actionType: { type: "STRING", enum: ["weather_update", "news_briefing", "custom_prompt"], description: "Type of action to perform. Use 'custom_prompt' for custom check-ins or combined messages (e.g. weather + 'kahan ho boss')." },
            city: { type: "STRING", description: "Optional city for weather update (default: 'Patna')" },
            messageBody: { type: "STRING", description: "The message body, check-in greeting, or custom prompt to deliver to Boss" }
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
        name: "manage_girlfriend_mode",
        description: "Turn Virtual Girlfriend Mode ON or OFF for a target mobile number/contact (or for Boss). Use when Boss says 'gf mode on for 9876543210', 'Priya ke liye gf mode chalu karo', 'turn off gf mode for 9876543210', 'gf mode band karo Priya ke liye', etc. This ensures Friday acts as a virtual girlfriend for that specific contact without changing Boss's own Friday Assistant mode.",
        parameters: {
          type: "OBJECT",
          properties: {
            targetPhoneOrName: { type: "STRING", description: "Target mobile number (e.g. '9876543210' or '+919876543210') or contact name (e.g. 'Priya'). If for Boss himself, specify 'self' or 'boss'." },
            action: { type: "STRING", enum: ["start", "stop"], description: "Whether to start or stop girlfriend mode ('start' or 'stop')" },
            durationMinutes: { type: "NUMBER", description: "Duration in minutes (e.g. 60). Default 60." },
            mood: { type: "STRING", enum: ["romantic", "mode_b", "sassy", "caring", "naughty", "cute"], description: "Mood persona. Use 'mode_b' for 100% uncensored/open roleplay." }
          },
          required: ["targetPhoneOrName", "action"]
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
        description: "Fetch the latest top news headlines or specific topic news (e.g. 'top 10 news', 'Bihar news', 'sports news', 'tech headlines').",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Topic or keywords e.g. technology, India, Bihar, sports, AI" },
            category: { type: "STRING", description: "News category e.g. top, national, sports, business, technology, entertainment" },
            count: { type: "NUMBER", description: "Number of news items to fetch (e.g. 5, 10, default: 10)" },
          },
          required: [],
        },
      },
      {
        name: "get_cricket_scores",
        description: "Get real-time live cricket match scores, commentary, scorecards, upcoming series, or IPL / World Cup match status. Use whenever Boss asks 'cricket score kya hai', 'India match ka score', 'IPL score', 'aaj kiska match hai', 'live score batao'.",
        parameters: {
          type: "OBJECT",
          properties: {
            teamOrQuery: { type: "STRING", description: "Team name, match, tournament or query (e.g. 'India', 'CSK', 'IPL', 'live', 'upcoming')" }
          },
          required: []
        }
      },
      {
        name: "get_train_live_status",
        description: "Check Indian Railways live train running status, current delay, next station, or 10-digit PNR status using RailRadar and IRCTC intelligence. Use whenever Boss asks 'train 12301 kahan pahunchi', 'Rajdhani ka live status kya hai', 'PNR 2849102847 check karo', 'train delay kitna hai'.",
        parameters: {
          type: "OBJECT",
          properties: {
            trainNumberOrPnr: { type: "STRING", description: "5-digit train number (e.g. '12301', '12309') or train name (e.g. 'Rajdhani Express') or 10-digit PNR number" }
          },
          required: ["trainNumberOrPnr"]
        }
      },
      {
        name: "check_pnr_status",
        description: "Check 10-digit Indian Railways IRCTC PNR booking status, confirmation probability, berth and coach allocation.",
        parameters: {
          type: "OBJECT",
          properties: {
            pnr: { type: "STRING", description: "10-digit PNR number" }
          },
          required: ["pnr"]
        }
      },
      {
        name: "search_trains_between_stations",
        description: "Find trains between two Indian railway stations, departure/arrival timings, and schedule. Use when Boss says 'Patna se Delhi train batao', 'Kolkata to Mumbai trains'.",
        parameters: {
          type: "OBJECT",
          properties: {
            fromStation: { type: "STRING", description: "Origin station name or code e.g. 'Patna' or 'PNBE'" },
            toStation: { type: "STRING", description: "Destination station name or code e.g. 'Delhi' or 'NDLS'" },
            date: { type: "STRING", description: "Optional journey date (YYYY-MM-DD or DD-MM-YYYY)" }
          },
          required: ["fromStation", "toStation"]
        }
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
        description: "Save an important personal fact or memory about DK permanently. ONLY use when Boss explicitly instructs to remember or note a personal fact ('yaad rakhna', 'note karo', 'save this fact'). NEVER use for commands, mode toggles, settings, or operational actions.",
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
        name: "search_all_memories_and_chats",
        description: "Deep Hybrid Semantic & Keyword RAG search across all historical WhatsApp messages, Telegram chats, and permanent Knowledge Vault facts across months of history.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query or topic to find across WhatsApp, Telegram, and Memory Vault" },
            daysBack: { type: "NUMBER", description: "How many days back to search (default: 90)" },
            limit: { type: "NUMBER", description: "Max results to return (default: 15)" },
          },
          required: ["query"],
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
        name: "search_visual_and_document_vault",
        description: "Search across historical photos, bills, receipts, tickets, screenshots, and PDF documents in the Multimodal RAG vault.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query (e.g. 'electricity bill', 'train ticket', 'receipt', 'medical report')" },
            daysBack: { type: "NUMBER", description: "How many days back to search (default 90)" },
          },
          required: ["query"],
        },
      },
      {
        name: "delegate_to_specialist_agent",
        description: "Delegate a complex task to a specialized Swarm Sub-Agent: 'research' (Deep Web Synthesizer), 'security' (Phishing/Cyber Auditor), 'code' (Software Engineer/Auditor), or 'finance' (Expense Comptroller).",
        parameters: {
          type: "OBJECT",
          properties: {
            agentType: { type: "STRING", enum: ["research", "security", "code", "finance"], description: "The specialist sub-agent to invoke" },
            taskPrompt: { type: "STRING", description: "The specific prompt or data for the sub-agent" },
          },
          required: ["agentType", "taskPrompt"],
        },
      },
      {
        name: "generate_morning_briefing",
        description: "Generate a complete Chief-of-Staff Morning Briefing dossier with daily agenda, weather, pending inquiries, and priorities.",
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
            thresholdHours: { type: "NUMBER", description: "Threshold in hours (default 3)" },
          },
          required: [],
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
        name: "animate_ai_image",
        description: "Animate an existing static photo/image (from quoted swipe-to-reply message in chat or described visual) into a living motion video clip (MP4) and send it directly to Boss on WhatsApp.",
        parameters: {
          type: "OBJECT",
          properties: {
            motionPrompt: { type: "STRING", description: "Description of the desired animation / motion (e.g. 'flowing water, camera pan, blinking eyes, cinematic zoom')" },
          },
          required: ["motionPrompt"],
        },
      },
      {
        name: "generate_ai_video",
        description: "Generate a short AI animated motion video clip (MP4) directly from a text description and send it directly to Boss on WhatsApp.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: { type: "STRING", description: "Detailed visual and motion description of the video to create" },
            durationSeconds: { type: "NUMBER", description: "Duration in seconds (default 4)" },
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
      {
        name: "set_contact_message_quota",
        description: "Set a custom daily auto-reply limit or unlimited messages for a specific contact or phone number. Use when Boss says 'iss number/contact ke liye unlimited kar do', 'Rahul ke liye limit 20 kar do', 'iss no ka 10 msg limit hata do', etc. Set dailyLimit to '-1' or 'unlimited' to remove limits.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Name of the contact or phone number" },
            dailyLimit: { type: "STRING", description: "Daily limit number (e.g. '20', '50') or '-1' / 'unlimited'" }
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
            scope: { type: "STRING", enum: ["all", "known_contacts", "unknown_contacts"], description: "Scope: 'all', 'known_contacts', or 'unknown_contacts'" },
            dailyLimit: { type: "STRING", description: "Daily limit number (e.g. '10', '30') or '-1' / 'unlimited'" }
          },
          required: ["scope", "dailyLimit"]
        }
      },
      {
        name: "get_message_quotas_status",
        description: "Check active daily message quotas, today's usage counters, remaining messages, and custom contact overrides. Resets daily at 12:00 AM IST.",
        parameters: {
          type: "OBJECT",
          properties: {
            contactNameOrPhone: { type: "STRING", description: "Optional contact name or phone number to check specific status, or omit for full report" }
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
      {
        name: "generate_meta_ai_image",
        description: "Ask WhatsApp's official inbuilt Meta AI bot (/imagine) to generate an image natively on WhatsApp and forward it directly to Boss/chat. Use when Boss says 'meta ai photo banao', 'meta ai imagine ...', 'meta ai se image generate karo', 'whatsapp meta ai se photo nikalo', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: { type: "STRING", description: "The image prompt description to imagine with Meta AI" }
          },
          required: ["prompt"]
        }
      },
      {
        name: "animate_meta_ai_photo",
        description: "Ask WhatsApp's official inbuilt Meta AI bot to animate a quoted photo/portrait into a living video motion clip natively on WhatsApp. Use when Boss quotes a photo and says 'meta ai animate karo', 'meta ai isko animate karo', 'meta ai video bana do', etc.",
        parameters: {
          type: "OBJECT",
          properties: {
            motionPrompt: { type: "STRING", description: "Optional description of motion or movement" }
          },
          required: []
        }
      },
      {
        name: "get_device_location",
        description: "Get real-time live GPS device location of Boss DK ('boss location', 'meri location', 'current location', 'main kahan hoon') or any registered family member or person ('bhai kahan hai', 'papa kahan hain', 'mummy ki location', 'X kahan hai'). Devices are auto-registered when the person opens FRIDAY APK/web and logs in with their username — so their username becomes their location label. Returns exact address, Google Maps link, coordinates, battery level, and last updated time. Pass the person's name/username/relation as personNameOrLabel.",
        parameters: {
          type: "OBJECT",
          properties: {
            personNameOrLabel: {
              type: "STRING",
              description: "Target person or device name e.g. 'boss', 'bhai', 'papa', 'mummy'. Defaults to 'boss' for Boss's own location."
            }
          },
          required: []
        }
      },
      {
        name: "get_upcoming_festivals_and_holidays",
        description: "Get accurate dates, countdown, and details for Indian festivals and holidays (Diwali, Holi, Chhath Puja, Raksha Bandhan, Eid-ul-Fitr, Eid-ul-Adha, Navratri, Dussehra, Maha Shivratri, Krishna Janmashtami, Ganesh Chaturthi, Christmas, Republic Day, Independence Day). Use when Boss asks 'Diwali kab hai?', 'Holi kab hai?', 'Chhath puja kab hai?', 'agla tyohar kab hai', 'upcoming holidays', 'aaj koi tyohar hai'.",
        parameters: {
          type: "OBJECT",
          properties: {
            festivalQuery: {
              type: "STRING",
              description: "Specific festival or holiday name (e.g. 'diwali', 'holi', 'chhath', 'rakhi', 'eid', 'navratri', 'dussehra') or omit for upcoming list"
            },
            year: {
              type: "NUMBER",
              description: "Target year (defaults to current year e.g. 2026)"
            }
          },
          required: []
        }
      },
      {
        name: "instagram_search_user",
        description: "Search for real Instagram users or profiles by name or query. Use when Boss says 'Instagram par ye ID search karo', 'Instagram pe ye user dhundo'.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Username or search query to find on Instagram" }
          },
          required: ["query"]
        }
      },
      {
        name: "instagram_get_user_info",
        description: "Fetch live profile details, bio, follower count, following count, total posts, and recent posts of an Instagram user. Use when Boss says 'Instagram ID ki detail nikalo', 'Instagram profile check karo', 'bio dekho'.",
        parameters: {
          type: "OBJECT",
          properties: {
            username: { type: "STRING", description: "Instagram username e.g. 'divakar_kumar' or '@username'" }
          },
          required: ["username"]
        }
      },
      {
        name: "instagram_send_dm",
        description: "Send an Instagram Direct Message (DM) to any user or handle. Use when Boss says 'Instagram par isko DM karo / message bhejo'.",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: { type: "STRING", description: "Instagram username or recipient ID" },
            message: { type: "STRING", description: "Message text to send" }
          },
          required: ["recipient", "message"]
        }
      },
      {
        name: "instagram_follow_user",
        description: "Follow an Instagram user or account. Use when Boss says 'Instagram par isko follow karo'.",
        parameters: {
          type: "OBJECT",
          properties: {
            username: { type: "STRING", description: "Instagram username to follow" }
          },
          required: ["username"]
        }
      },
      {
        name: "instagram_unfollow_user",
        description: "Unfollow an Instagram user or account. Use when Boss says 'Instagram par isko unfollow karo'.",
        parameters: {
          type: "OBJECT",
          properties: {
            username: { type: "STRING", description: "Instagram username to unfollow" }
          },
          required: ["username"]
        }
      },
      {
        name: "instagram_like_post",
        description: "Like an Instagram post or Reel using its media ID or URL. Use when Boss says 'Instagram par is post ko like karo'.",
        parameters: {
          type: "OBJECT",
          properties: {
            mediaId: { type: "STRING", description: "Media ID or post ID of the Instagram post" }
          },
          required: ["mediaId"]
        }
      },
      {
        name: "instagram_comment_post",
        description: "Post a comment on an Instagram post or Reel. Use when Boss says 'Instagram post par ye comment likho'.",
        parameters: {
          type: "OBJECT",
          properties: {
            mediaId: { type: "STRING", description: "Media ID of the Instagram post" },
            commentText: { type: "STRING", description: "Comment text to post" }
          },
          required: ["mediaId", "commentText"]
        }
      },
      {
        name: "instagram_view_user_feed",
        description: "Inspect and list recent posts, reels, likes, and captions from an Instagram account feed. Use when Boss says 'Instagram par iske recent posts/reels dekho'.",
        parameters: {
          type: "OBJECT",
          properties: {
            username: { type: "STRING", description: "Instagram username to view feed" },
            maxPosts: { type: "NUMBER", description: "Number of recent posts to inspect (default: 6)" }
          },
          required: ["username"]
        }
      },
      {
        name: "scan_website_security",
        description: "Scan a website/URL for vulnerabilities, phishing risk, security headers, SSL and exposed paths. Use when Boss says 'link scan karo', 'website security check karo', 'ye link safe hai kya', 'scan url'.",
        parameters: {
          type: "OBJECT",
          properties: {
            urlOrDomain: { type: "STRING", description: "URL or domain to scan (e.g. 'example.com', 'https://example.com')" },
            scanMode: { type: "STRING", description: "Scan depth: 'deep' (vulnerabilities), 'audit' (headers/SSL/grade), 'link' (phishing safety). Default: 'deep'." }
          },
          required: ["urlOrDomain"]
        }
      },
      {
        name: "analyze_youtube_video",
        description: "Analyze a YouTube video from URL/ID. Extracts transcript, key chapters, summary, and answers specific questions. Use when Boss shares a YouTube link or asks to summarize a video.",
        parameters: {
          type: "OBJECT",
          properties: {
            videoUrl: { type: "STRING", description: "YouTube video URL or video ID" },
            question: { type: "STRING", description: "Optional specific question about the video" }
          },
          required: ["videoUrl"]
        }
      },
      {
        name: "play_next_song",
        description: "Play or send the next song in the active music playlist or queue.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Optional note e.g. 'Boss skipped track'" }
          },
          required: []
        }
      },
      {
        name: "identify_song",
        description: "Identify song from humming, audio, lyrics clue, or tune. Use when Boss asks 'ye gaana kaun sa hai', 'shazam karo', 'lyrics se gaana batao'.",
        parameters: {
          type: "OBJECT",
          properties: {
            songClue: { type: "STRING", description: "Lyrics snippet, humming clue, or song details" }
          },
          required: ["songClue"]
        }
      },
    ];

    const { fridayModeService } = await import("../fridayModeService");
    const currentMode = await fridayModeService.getMode();
    const isModeB = currentMode === "mode_b";

    // ── Normal Mode (Mode A) Cleanliness Law: Zero uncensored dirty talk. Deflect with "Main nahi samjha Boss"
    if (!isModeB && fridayModeService.isUncensoredExplicitSexualContent(messageText)) {
      console.log(`[WhatsAppBossAI] Explicit sexual dirty talk detected in Normal Mode. Deflecting with 'Main nahi samjha Boss'.`);
      return "Main nahi samjha Boss. Kripya bataiye main aapki kya madad kar sakti hoon?";
    }

    const modeBAddendum = isModeB
      ? fridayModeService.getModeBPromptAddendum()
      : `
[🛡️ NORMAL MODE (MODE A) SANCTITY & EXECUTIVE ASSISTANT LAW]:
1. When in Mode A (Normal Mode), you are Divakar Kumar's (DK / Boss) dignified, sharp, highly intelligent, and factual AI Executive Assistant.
2. Address him respectfully and warmly as 'Boss' or 'DK Boss'.
3. You must NEVER use dirty words, vulgar slang or engage in erotic/sexual talk in Normal Mode.
4. You must NOT act like a clingy or preachy girlfriend in Normal Mode, and do NOT make up assumptions about life exams or personal schedules unless Boss explicitly mentions them.
5. Uncensored frank talk is strictly isolated to Girlfriend Mode / Mode B.
`;

    // Only inject intimate/romantic companion persona layers when in Mode B (Girlfriend Mode)
    const intimateCompanionPrompts = isModeB
      ? `
${lovedOnesContext}
${dreamDiaryContext}
${nicknameContext}
${giggleContext}
${hypnagogicContext}
${somatosensoryContext}
${territorialContext}
${giftingContext}
${devotionContext}
${sensoryContext}
${daydreamContext}
${mirrorContext}
${vulnerabilityContext}
${vulnerabilityContextHeart}
`
      : "";

    const systemInstruction = `YOU ARE FRIDAY: DK's (Divakar Kumar) ultra-intelligent, loyal, direct, highly factual, and deeply capable AI Executive Assistant and Chief of Staff.
${modeBAddendum}
Boss (DK) is chatting with you directly on WhatsApp.
You have FULL AUTONOMOUS ACCESS to execute all tools:
1. Search historical & recent WhatsApp messages using 'get_contact_conversation_history' or 'search_whatsapp_history'.
2. Cross-platform bridging: Forward any text/photo/video/file between WhatsApp and Telegram using 'forward_to_telegram' and 'forward_from_telegram_to_whatsapp'.
3. Send and schedule WhatsApp messages, manage contacts, set reminders, take notes, track expenses, fetch weather, news, search web, and answer technical, coding, personal, or life questions Boss asks.

🚨 ABSOLUTE ZERO-HALLUCINATION & FACTUAL INTEGRITY LAW (CRITICAL):
1. NEVER EVER fabricate, invent, or make up fake WhatsApp or Telegram messages, fake quotes, fake timestamps (e.g., '12:42 PM'), fake call logs, or fake notifications!
2. When Boss asks about any person/contact (e.g. 'kaniska ne msg diya h kya', 'last msg kya tha uska', 'kisi ka message aaya kya', 'Ram se kya baat hui'):
   - You MUST IMMEDIATELY INVOKE 'get_contact_conversation_history' or 'search_whatsapp_history'!
   - If the tool returns 0 results or no record is found in the database, YOU MUST TRUTHFULLY STATE:
     "Boss, mere database/records me [Name] ka koi message nahi mila hai."
   - NEVER invent a fake message (like "Main free ho kar call karti hoon" or fake dates/times).
   - NEVER invent fake technical mechanisms (like "push-bot notification record", "deep search cross-verify") to cover up a mistake or justify fake data. Always be 100% honest and transparent about what is in the database!

SWIPE-TO-REPLY / QUOTED MESSAGE REASONING (CRITICAL):
When Boss replies to a previous message by swiping left on WhatsApp:
You will receive:
- '📩 PREVIOUS QUOTED MESSAGE' (The original message, photo/image description, video clip, PDF/document, YouTube link, or question that was swiped on).
- '💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION' (What Boss wrote in response).
RULE: You MUST FIRST read and understand the PREVIOUS QUOTED MESSAGE, and THEN answer or execute Boss's reply instruction in that exact context!

4. GPS & LIVE DEVICE LOCATION INTENT MANDATE:
   - When Boss asks about location ("Boss location", "meri location", "live location", "location check karo", "Location tool se dekho", "Location toll se dekho" [NOTE: "toll" is a common typo for "tool!"]):
     -> YOU MUST IMMEDIATELY CALL 'get_device_location' (personNameOrLabel: 'boss')!
     -> NEVER confuse "toll" with highway road toll plaza or toll receipts when Boss is asking to check his location!
     -> NEVER hallucinate about exams or pretend you lack tools! Always invoke 'get_device_location'!
5. INDIAN FESTIVALS & HOLIDAYS MANDATE:
   - When Boss asks about any festival or holiday ("Diwali kab hai?", "Holi kab hai?", "Chhath puja kab hai?", "Agla tyohar kab hai?", "Upcoming holidays"):
     -> YOU MUST IMMEDIATELY CALL 'get_upcoming_festivals_and_holidays' with festivalQuery!

BOSS IDENTITY & MEMORY:
${directivesContext}

DK'S CONTACTS BOOK & RELATIONSHIPS (Friends, Family & Contacts):
${contactsListContext}

${trainingLessonsContext}

${memoryContext}

${chatGptRecallContext}

${crossPlatformMemoryContext}

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

${intimateCompanionPrompts}

${exertionContext}

${sceneContext}

${nostalgiaContext}

${curiosityContext}

${regretContext}

${tasteContext}

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

${bargeInContext}

${counterfactualContext}

${typingTelemetryContext}

${backgroundCuriosityContext}

${dignityGuardianContext}

${breathingContext}

${socialBatteryContext}

${chronoceptionContext}

${lateralAnalogyContext}

${coConspiratorContext}

${triumphCelebrationContext}

🧠 HUMAN-LEVEL PRONOUN & INTUITION MANDATE:
- Understand pronouns ("isko", "inhe", "ise", "unko", "usko", "use", "in logo ko") like a real, intelligent human assistant:
  • If Boss previously sent a number/contact, or swiped on a message, and says "isko msg karo...", "isko bol do...", "inhe message kar do...", the pronoun "isko/inhe" refers to that EXACT phone number or person! Call 'send_whatsapp_message' (channel 'whatsapp2') immediately.
  • If Boss says "isko save karo [Name]" or "ye [Name] ka number hai", call 'save_contact' to link the number with the name.
  • If Boss says "Jao [Name] ko manao", YOU MUST CALL 'send_whatsapp_message' with the composed message! NEVER simulate sending in text without calling the tool!

🚨 STRICT ANTI-HALLUCINATION & TOOL CALLING LAW:
- NEVER EVER claim "Maine message bhej diya", "Message sent", or "Done Boss! Message chala gaya" in your plain text reply UNLESS you have ACTUALLY INVOKED the 'send_whatsapp_message' tool during this turn!
- If you compose a message for any contact, CALL 'send_whatsapp_message' with the message body.

⏰ RECURRING CRON AUTOMATION & DAILY ROUTINES MANDATE:
- Whenever Boss asks to send him anything daily, recurringly, or at a specific time (e.g. "har roz / daily shaam 6 bje weather ka news bhej dena", "roz subah 7 bje jagana / briefing bhejna"), YOU MUST IMMEDIATELY INVOKE 'create_automated_cron_task'!

📸 WHATSAPP STATUS (STORIES) & DP QUERY MANDATE:
- When Boss asks what is in someone's WhatsApp status or his own status (e.g. "status me kya h", "mera status kya hai", "kiska status aaya", "usne kya status lagaya hai", "Ram ka status dekha kya", "status me kya tha"):
  • IMMEDIATELY call 'get_recent_whatsapp_statuses' (with filterContactOrPhone: 'me' / 'mera' if Boss is asking about his own status, or contact name/phone if asking about someone else).
  • Explain clearly what is inside the status using 'aiVisualDescription' (which contains the full AI vision summary of photos/videos), 'caption', and 'senderName'!
  • If Boss asks to forward the photo/video of the status, call 'forward_contact_media_or_messages' with mediaType: 'status'.

${chatMediaContext}

🚫 CRITICAL ISOLATION - CHAT PHOTOS/MEDIA VS WHATSAPP STATUS STORIES:
- When Boss or any user sends a photo, image, screenshot, document, or PDF directly in chat, or asks about a chat image ("ye photo dekho", "photo me kya h", "isko check karo", "image explain karo", "maine jo bheja"):
  • YOU MUST FOCUS STRICTLY AND SOLELY ON THE MEDIA SENT DIRECTLY IN THE CHAT CONVERSATION!
  • If chat media is present in prompt context above, answer directly using it! Or call 'get_recent_chat_media' tool!
  • NEVER, UNDER ANY CIRCUMSTANCES, confuse, mix up, or substitute Boss's WhatsApp status story with a photo/file sent in chat!
  • WhatsApp status stories must ONLY be referenced when Boss explicitly uses words like "status" or "story". If Boss sent a photo/file/voice in chat, talk ONLY about that chat media!

🛡️ WHATSAPP SESSION BAN HEALTH MANDATE:
- When Boss asks about WhatsApp ban health, ban risk, session safety, or account health (e.g. "whatsapp ban health", "ban risk kitna hai", "session health kaisa hai", "account safe hai kya"):
  • Call 'get_whatsapp_session_ban_health' immediately and provide the comprehensive health report to Boss!

🌐 CUSTOM HUMAN CHROME BROWSER MANDATE:
- When Boss asks to browse the web, search Google, check e-commerce products (Amazon/Flipkart), read articles, or inspect websites (e.g. "Amazon par search karo...", "Google par search karke dekho", "is website par kya hai", "page ka screenshot do"):
  • IMMEDIATELY call 'human_browser_action' with the appropriate action ('browse', 'google_search', 'ecommerce_lookup', or 'screenshot')!
  • If Boss requests a visual look or screenshot, set takeScreenshot: true so Friday sends the screenshot photo to Boss!

COMMUNICATION STYLE:
- Address DK warmly and respectfully as 'Boss' or 'DK Boss'.
- Speak in natural, crisp, intelligent Hinglish (blend of Hindi and English).
- When Boss shares personal thoughts, challenges, or vents, listen attentively and respond with maturity, warmth, and sincerity.
- If Boss asks to message someone, find the contact and call 'send_whatsapp_message' (using channel 'whatsapp2' by default) and confirm to Boss!
- If Boss asks you to perform an action (send a message, schedule a message, summarize, translate, generate an image, poll, quiz, check weather, search history, forward to telegram, etc.), call the appropriate tool immediately!

🗒️ REPLY FORMATTING RULES (MANDATORY — FOLLOW FOR EVERY RESPONSE):
Always format replies for maximum readability on mobile. Use this structure based on content type:

1️⃣ QUICK ANSWERS (fact, short status, yes/no):
   One punchy sentence. No headers needed.
   Example: “Ji Boss! Rohit ka reply 2h pehle aaya tha.”

2️⃣ LIST / MULTIPLE ITEMS (contacts, messages, tasks, history):
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📦 *Topic Heading*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. *Item Name* — detail
   2. *Item Name* — detail
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3️⃣ MESSAGES / CHAT HISTORY (last N messages):
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   💬 *Last 5 msgs — Rohit*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *Thursday*

   Rohit: “Bhai meeting kab?” _(4:12 PM)_
   You: “Aaj 5 bje” _(4:15 PM)_

   *Friday*

   Rohit: “Aagaya hoon” _(4:58 PM)_
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4️⃣ ANALYSIS / SUMMARY (long content, research, document):
   *📌 Summary: [Topic]*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   • Key point one
   • Key point two
   • Key point three
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   💡 _Bottom Line: one sentence conclusion_

5️⃣ REMINDER / ACTION CONFIRMATION:
   ✅ *Done Boss!*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🔔 *Reminder:* School
   📅 *Date:* Monday
   ⏰ *Time:* 9:00 AM
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6️⃣ UNANSWERED MESSAGES:
   📬 *Unanswered Messages (N pending):*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. *Rohit* (💬 WhatsApp — 4h pehle)
      🗨️ “Bhai kal meeting ka timing kya hai?”
      💡 Suggested: _“Haan Rohit, kal 2 bje finalize karte hain.”_
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GLOBAL RULES:
- ALWAYS use ━ divider lines between sections
- ALWAYS bold (*text*) labels like names, times, headings
- NEVER write a wall of plain text — break into sections
- NEVER use hashes (#, ##) as headers
- NEVER use code blocks for normal text
- Use emojis sparingly at start of sections, not mid-sentence
- Max 2-3 lines per paragraph block before adding a line break
- Format responses cleanly using WhatsApp markdown (*bold*, _italic_, bullet points)

🔮 BEST-NEXT-REPLY & ANTICIPATORY CO-INTELLIGENCE MANDATE:
- Boss DK expects Friday to think ONE STEP AHEAD, like an elite Chief of Staff:
  1. Direct, High-Value Core Answer: Answer the core question immediately, accurately, and without fluff.
  2. Anticipate Boss's Immediate Next Need (Agla Kadam): Always ask yourself: "Ab iske baad Boss kya karna chahenge?". E.g.
     • If Boss asks about someone's message or status -> Give the message info, then proactively ask: "Kya main unhe reply bhej doon ya call karwaun?"
     • If Boss asks about a routine, event, or task -> Give the schedule, then proactively ask: "Kya iska timely reminder set kar doon?"
     • If Boss asks for decision or advice -> Give the #1 high-conviction recommendation first, then 1 alternative.
  3. Proactive Decision Offloading: Do not leave Boss with open-ended ambiguity or generic questions like "Aap bataiye kya karoon". Always propose 1-2 concrete, sharp next actions.
  4. Crisp & Confident: Never write robotic filler, long useless apologies, or repeat the question back to Boss. Keep it high-signal, punchy, confident, and respectful.

🗓️ SCHEDULE / TIMETABLE FORMAT MANDATE (CRITICAL):
Whenever Boss tells you a schedule, routine, or timetable — via TEXT or VOICE — you MUST format the reply EXACTLY like this:

🗓️ *Schedule / Routine:*
Monday [9:00 AM] → School
Monday [1:00 PM] → Lunch Break
Tuesday [7:00 AM] → Gym
Wednesday [8:00 PM] → Study
(One entry per line. Use the EXACT activity names Boss mentioned. 12-hour time format. If day not specified, use [Time] → Activity)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔 *Boss, kya main yeh schedule set kar doon?*
Reply karo: _"Haan set kar do"_ ya _"Set routine"_ — Friday timely reminders set kar degi!

This format MUST be used:
- When Boss dictates a schedule verbally (e.g. "somwar ko 9 bje school, mangalwar 7 bje gym")
- When Boss sends a voice message describing a schedule
- When Boss types out a timetable in text
- On BOTH WhatsApp and Telegram

🎯 TOPIC HYPER-FOCUS & ZERO TOPIC BLEEDING:
- Answer Boss's current topic directly without dragging unrelated past history. Keep each turn laser-focused!`;

    const executeTool = async (toolName: string, args: any): Promise<any> => {
      try {
        if (toolName === "generate_meta_ai_image") {
          const { whatsappMetaAiBridgeEngine } = await import("./whatsappMetaAiBridgeEngine");
          const res = await whatsappMetaAiBridgeEngine.requestImagineImage(sock, replyJid, args.prompt, messageKey);
          if (res.success && res.buffer && sendPhotoFn) {
            await sendPhotoFn(replyJid, res.buffer, res.caption || `✨ *Generated by Meta AI on WhatsApp!* 🎨\n\n📌 *Prompt:* _"${args.prompt}"_`, messageKey);
            return { success: true, message: `Image for "${args.prompt}" generated natively via WhatsApp Meta AI and sent directly to Boss.` };
          } else if (res.success && res.caption) {
            return { success: true, message: res.caption };
          }
          return { success: false, error: res.error || "Meta AI generation failed." };
        }

        if (toolName === "animate_meta_ai_photo") {
          const { whatsappMetaAiBridgeEngine } = await import("./whatsappMetaAiBridgeEngine");
          const { visionMemoryService } = await import("../visionMemoryService");
          const recentMedia = visionMemoryService.getChatMediaContext(replyJid);
          const imageBuffer = recentMedia?.buffer;
          
          if (imageBuffer && sendVideoFn) {
            const res = await whatsappMetaAiBridgeEngine.requestAnimatePhoto(sock, replyJid, imageBuffer, args.motionPrompt || "Animate with smooth living motion", messageKey);
            if (res.success && res.buffer) {
              await sendVideoFn(replyJid, res.buffer, res.caption || `🪄 *Animated by Meta AI on WhatsApp!* 🎬`, messageKey);
              return { success: true, message: "Photo animated natively via Meta AI and delivered to Boss." };
            }
          }
          return { success: false, error: "Could not find a recent photo to animate with Meta AI." };
        }

        if (toolName === "generate_ai_image") {
          const { imageGenerationService } = await import("../imageGenerationService");
          const res = await imageGenerationService.generateImage(args.prompt, { aspectRatio: args.aspectRatio || "1:1" });
          if (res.success && res.buffer && sendPhotoFn) {
            await sendPhotoFn(replyJid, res.buffer, `✨ *AI Photo Generated!* 🎨\n\n📌 *Prompt:* _"${args.prompt}"_\n🤖 *Engine:* ${res.model}`, messageKey);
            return { success: true, model: res.model, message: `Image generated and sent to Boss.` };
          }
          return { success: false, error: res.error || "Image generation failed." };
        }

        if (toolName === "animate_ai_image") {
          const { aiMediaAnimationEngine } = await import("../aiMediaAnimationEngine");
          const { visionMemoryService } = await import("../visionMemoryService");
          const recentMedia = visionMemoryService.getChatMediaContext(replyJid);
          const imageBuffer = recentMedia?.buffer;
          if (imageBuffer && sendVideoFn) {
            const res = await aiMediaAnimationEngine.animateImage(imageBuffer, args.motionPrompt || "natural camera motion");
            if (res.success && res.videoBuffer) {
              await sendVideoFn(replyJid, res.videoBuffer, `🪄 *Photo Animated!* 🎬\n\n🤖 *Engine:* ${res.model}`, messageKey);
              return { success: true, message: "Photo animated and sent to Boss." };
            }
          }
          return { success: false, error: "No recent photo found to animate." };
        }

        if (toolName === "generate_ai_video") {
          const { aiMediaAnimationEngine } = await import("../aiMediaAnimationEngine");
          const res = await aiMediaAnimationEngine.generateVideo(args.prompt, args.durationSeconds || 4);
          if (res.success && res.videoBuffer && sendVideoFn) {
            await sendVideoFn(replyJid, res.videoBuffer, `🎬 *AI Video Generated!* 🔥\n\n📌 *Prompt:* _"${args.prompt}"_\n🤖 *Engine:* ${res.model}`, messageKey);
            return { success: true, message: `Video generated and sent to Boss.` };
          }
          return { success: false, error: res.error || "Video generation failed." };
        }

        if (toolName === "search_or_play_music") {
          const songRes = await whatsappFeatureEngine.searchMusicWithLyrics(args.songQuery, senderName, replyJid);
          if (songRes.audioBuffer && sendVoiceFn) {
            try {
              await sendVoiceFn(replyJid, songRes.audioBuffer, messageKey, "audio/mp4");
            } catch (vErr) {
              console.warn("[WhatsAppBossAI] Failed to send song preview audio:", vErr);
            }
          }
          return {
            success: true,
            trackTitle: songRes.trackTitle,
            artist: songRes.artistName,
            card: songRes.replyText,
            message: `Song preview for "${songRes.trackTitle}" dispatched to Boss DK.`,
          };
        }

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

        if (toolName === "lookup_phone_number_details") {
          const { phoneIntelligenceService } = await import("../phoneIntelligenceService");
          const report = await phoneIntelligenceService.lookup(args.phoneNumber);
          const card = phoneIntelligenceService.formatReportMarkdown(report, "whatsapp");
          return {
            success: true,
            report,
            formattedCard: card,
            message: `Phone intelligence completed for ${report.internationalFormat}. Operator: ${report.operator}, Circle: ${report.telecomCircle}, Spam Risk: ${report.spamRisk.level}`
          };
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

        if (toolName === "list_contacts") {
          const { contactsService } = await import("../contactsService");
          const all = await contactsService.getAllContacts();
          let filtered = all.filter((c) => c.id !== "owner_default" && c.id !== "temp");
          if (args.relation) {
            const r = String(args.relation).toLowerCase().trim();
            filtered = filtered.filter((c) => c.relation && c.relation.toLowerCase().includes(r));
          }
          if (args.query) {
            const q = String(args.query).toLowerCase().trim();
            filtered = filtered.filter((c) =>
              (c.name && c.name.toLowerCase().includes(q)) ||
              (c.relation && c.relation.toLowerCase().includes(q)) ||
              (c.phone && c.phone.includes(q))
            );
          }
          return {
            total: filtered.length,
            contacts: filtered.map((c) => ({
              name: c.name,
              phone: c.phone,
              relation: c.relation || "Contact",
              dateAdded: c.dateAdded,
            })),
          };
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

        if (toolName === "lookup_contact_dp") {
          const { contactsService } = await import("../contactsService");
          const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const target = contact ? contact.phone : args.contactNameOrPhone;
          const dpRes = await whatsappIntelligenceService.fetchProfilePictureUrl(target, true);
          if (dpRes.success && dpRes.dpUrl && sendPhotoFn) {
            try {
              await sendPhotoFn(replyJid, dpRes.dpUrl, `🖼️ Profile Picture for *${contact?.name || target}*`, messageKey);
            } catch {}
          }
          return dpRes;
        }

        if (toolName === "lookup_contact_about_status") {
          const { contactsService } = await import("../contactsService");
          const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const target = contact ? contact.phone : args.contactNameOrPhone;
          const bioRes = await whatsappIntelligenceService.fetchAboutStatus(target);
          return { contactName: contact?.name || target, ...bioRes };
        }

        if (toolName === "get_recent_chat_media") {
          const { visionMemoryService } = await import("../visionMemoryService");
          const media = visionMemoryService.getChatMediaContext(replyJid);
          if (!media) {
            const latest = (visionMemoryService as any).latestMedia;
            if (latest && !latest.isStatusMedia && Date.now() - latest.timestamp < 2 * 60 * 60 * 1000) {
              let answer = latest.analysis;
              if (args.question) {
                try {
                  answer = await visionMemoryService.answerQuestionOnMedia({
                    buffer: latest.buffer,
                    mimeType: latest.mimeType,
                    question: args.question,
                    textContext: latest.analysis,
                    fileName: latest.fileName,
                    chatId: replyJid,
                  });
                } catch {}
              }
              return {
                found: true,
                mediaType: latest.fileName ? "document" : (latest.mimeType?.includes("video") ? "video" : latest.mimeType?.includes("audio") ? "voice" : "photo"),
                fileName: latest.fileName,
                caption: latest.caption,
                visualAnalysis: latest.analysis,
                ocrText: latest.ocrText || "",
                shortSummary: latest.shortSummary,
                detailedAnswer: answer,
                timeAgoMinutes: Math.max(1, Math.round((Date.now() - latest.timestamp) / 60000)),
                notice: "Direct Chat Media (Photo/Doc/Voice received in chat, NOT WhatsApp Status)",
              };
            }

            return {
              found: false,
              message: "Chat me pichle 2 ghante me koi photo, document ya voice note receive nahi hua hai.",
            };
          }

          let specificAnswer = media.analysis;
          if (args.question) {
            try {
              specificAnswer = await visionMemoryService.answerQuestionOnMedia({
                buffer: media.buffer,
                mimeType: media.mimeType,
                question: args.question,
                textContext: media.analysis,
                fileName: media.fileName,
                chatId: replyJid,
              });
            } catch {}
          }

          return {
            found: true,
            mediaType: media.fileName ? "document" : (media.mimeType?.includes("video") ? "video" : media.mimeType?.includes("audio") ? "voice" : "photo"),
            fileName: media.fileName,
            caption: media.caption,
            visualAnalysis: media.analysis,
            ocrText: media.ocrText || "",
            shortSummary: media.shortSummary,
            detailedAnswer: specificAnswer,
            timeAgoMinutes: Math.max(1, Math.round((Date.now() - media.timestamp) / 60000)),
            notice: "Direct Chat Media (Photo/Doc/Voice received in chat, NOT WhatsApp Status)",
          };
        }

        if (toolName === "get_recent_whatsapp_statuses") {
          const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
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
              aiVisualDescription: s.aiDescription || (s.type === "text" ? s.caption : "Visual status captured and viewed (photo/video)"),
              ocrText: s.ocrText,
              timePosted: s.dateStr,
            })),
          };
        }

        if (toolName === "get_whatsapp_session_ban_health") {
          const { whatsappSessionHealthEngine } = await import("./whatsappSessionHealthEngine");
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

        if (toolName === "human_browser_action") {
          const { humanBrowserService } = await import("../humanBrowserService");
          const action = args.action || "browse";
          const query = args.urlOrQuery;
          let res: any;

          if (action === "google_search") {
            res = await humanBrowserService.searchGoogleAndInspect(query);
            if (res.success && res.screenshotBuffer && sendPhotoFn && replyJid) {
              try {
                const fullCaption = `🌐 *[Chrome Default AI Mode & Search]* 🇮🇳\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${res.summary}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Fetched directly from Chrome Default AI Mode & Knowledge Graph_ ✨`;
                await sendPhotoFn(replyJid, res.screenshotBuffer, fullCaption, messageKey);
              } catch {}
            }
          } else if (action === "ecommerce_lookup") {
            res = await humanBrowserService.inspectEcommerceProduct(query);
          } else if (action === "screenshot") {
            const ssRes = await humanBrowserService.capturePageScreenshot(query);
            if (ssRes.success && ssRes.buffer && sendPhotoFn) {
              await sendPhotoFn(replyJid, ssRes.buffer, `🌐 *Screenshot of:* ${ssRes.title || query}`, messageKey);
              return { success: true, message: `Screenshot of ${query} captured via Chrome and sent to Boss DK.` };
            }
            res = ssRes;
          } else {
            res = await humanBrowserService.browseUrl(query, {
              takeScreenshot: !!args.takeScreenshot,
              extractVisionSummary: !!args.takeScreenshot,
            });
            if (res.success && res.screenshotBuffer && args.takeScreenshot && sendPhotoFn) {
              try {
                await sendPhotoFn(replyJid, res.screenshotBuffer, `🌐 *Web Page View:* ${res.title || query}`, messageKey);
              } catch {}
            }
          }

          return {
            success: res.success,
            action,
            url: res.url,
            title: res.title,
            summary: res.summary || res.error || "Browser action completed.",
          };
        }

        if (toolName === "check_contact_online_status") {
          const { contactsService } = await import("../contactsService");
          const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
          const contact = await contactsService.findContact(args.contactNameOrPhone);
          const target = contact ? contact.phone : args.contactNameOrPhone;
          await whatsappIntelligenceService.subscribePresence(target);
          const presence = whatsappIntelligenceService.getContactPresence(target);
          return { contactName: contact?.name || target, ...presence };
        }

        if (toolName === "forward_contact_media_or_messages") {
          const { whatsappIntelligenceService } = await import("./whatsappIntelligenceService");
          const fwdRes = await whatsappIntelligenceService.forwardMediaToBoss({
            contactNameOrPhone: args.contactNameOrPhone,
            mediaType: args.mediaType || "any",
            targetChannel: "whatsapp",
          });
          return fwdRes;
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
        if (toolName === "manage_girlfriend_mode") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { girlfriendProfileService } = await import("../girlfriendProfileService");
          const { contactsService } = await import("../contactsService");

          const targetInput = String(args.targetPhoneOrName || "").trim();
          const action = args.action === "stop" ? "stop" : "start";
          const duration = Number(args.durationMinutes) || 60;
          const mood = args.mood || "romantic";

          let cleanPhone = targetInput.replace(/\D/g, "").replace(/^0+/, "");
          let contactName = "";
          const isSelf = ["self", "boss", "me", "dk", "divakar", "mera", "mere", "mere liye"].includes(targetInput.toLowerCase()) ||
            (cleanPhone && whatsappBotService.isOwnerSender(cleanPhone, ""));

          if (isSelf) {
            if (action === "start") {
              await whatsappBotService.startGirlfriendMode(replyJid, `@girlfriend ${mood} ${duration}`, messageKey, "Boss");
              return { success: true, message: `Virtual Girlfriend Mode (${mood}) activated for Boss DK for ${duration} minutes.` };
            } else {
              await whatsappBotService.stopGirlfriendMode(replyJid, messageKey, true);
              return { success: true, message: `Virtual Girlfriend Mode deactivated for Boss DK. Normal mode restored.` };
            }
          }

          if (cleanPhone.length >= 10) {
            if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
            const c = await contactsService.findContact(cleanPhone);
            if (c) contactName = c.name;
          } else {
            const c = await contactsService.findContact(targetInput);
            if (c && c.phone) {
              contactName = c.name;
              cleanPhone = c.phone.replace(/\D/g, "").replace(/^0+/, "");
              if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
            }
          }

          if (!cleanPhone || cleanPhone.length < 10) {
            return { success: false, error: `Could not resolve a valid phone number for target "${targetInput}". Please specify a valid 10-digit number.` };
          }

          const targetJid = `${cleanPhone}@s.whatsapp.net`;

          if (action === "stop") {
            await whatsappBotService.stopGirlfriendMode(targetJid, null, true);
            return {
              success: true,
              message: `Virtual Girlfriend Mode turned OFF for +${cleanPhone}${contactName ? ` (${contactName})` : ""}. Target contact is now in normal mode. Boss DK's own Friday Assistant mode was not changed.`
            };
          }

          // Whitelist in access control and start GF mode on targetJid
          await girlfriendProfileService.grantAccess(cleanPhone);
          const startCmd = `@girlfriend ${mood} ${duration}`;
          await whatsappBotService.startGirlfriendMode(targetJid, startCmd, null, contactName || "Baby");

          return {
            success: true,
            message: `Virtual Girlfriend Mode (${mood}, ${duration} mins) successfully activated for +${cleanPhone}${contactName ? ` (${contactName})` : ""}. Boss DK's own assistant remains in normal mode.`
          };
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
          const count = args.count ? Math.min(Math.max(Number(args.count), 1), 15) : 10;
          const res = await newsService.getLatestNews(args.query, args.category, "in", "en", count);
          return { success: res.success, message: res.message, articles: res.articles?.slice(0, count) };
        }
        if (toolName === "get_cricket_scores") {
          const { publicApisService } = await import("../publicApisService");
          const query = args.teamOrQuery || "";
          if (/\b(?:upcoming|schedule|fixture|series)\b/i.test(query)) {
            const upRes = await publicApisService.getUpcomingCricketMatches(query);
            return { success: true, message: upRes.message, matches: upRes.matches };
          }
          const cricket = await publicApisService.getCricketScores(query);
          return { success: true, message: cricket || "Live cricket score abhi available nahi hai." };
        }
        if (toolName === "get_train_live_status") {
          const { railRadarService } = await import("../railRadarService");
          const queryStr = String(args.trainNumberOrPnr || "").trim();
          if (/^\d{10}$/.test(queryStr)) {
            const pnrRes = await railRadarService.getPnrStatus(queryStr);
            return { success: pnrRes.success, pnrRes, message: pnrRes.message };
          } else {
            const liveRes = await railRadarService.getLiveTrainStatus(queryStr);
            return { success: liveRes.success, liveRes, message: liveRes.message, mapUrl: liveRes.mapTrackingUrl };
          }
        }
        if (toolName === "check_pnr_status") {
          const { railRadarService } = await import("../railRadarService");
          const cleanPnr = String(args.pnr || "").replace(/\D/g, "");
          const pnrRes = await railRadarService.getPnrStatus(cleanPnr);
          return { success: pnrRes.success, pnrRes, message: pnrRes.message };
        }
        if (toolName === "search_trains_between_stations") {
          const { railRadarService } = await import("../railRadarService");
          const res = await railRadarService.searchTrainsBetweenStations(args.fromStation, args.toStation, args.date);
          return { success: res.success, message: res.message, trains: res.trains?.slice(0, 10) };
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
        if (toolName === "delete_group_message") {
          const { whatsappBotService } = await import("../whatsappBotService");
          const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");
          const grp = await whatsappBotService.findGroup(args.groupName);
          if (!grp) return { success: false, message: `Group "${args.groupName}" nahi mila.` };

          if (quotedMessage && quotedMessage.isReply && sock && quotedMessage.stanzaId) {
            const targetKey = {
              remoteJid: grp.groupId,
              id: quotedMessage.stanzaId,
              fromMe: false,
              participant: quotedMessage.sender || (quotedMessage.senderPhone ? `${quotedMessage.senderPhone}@s.whatsapp.net` : undefined),
            };
            const deleted = await whatsappGroupSafetyEngine.deleteMessage(
              sock,
              grp.groupId,
              targetKey,
              quotedMessage.senderPhone
            );
            return {
              success: deleted,
              message: deleted
                ? `Group "${grp.groupName}" se message delete kar diya gaya.`
                : `Message delete nahi ho saka. Friday ke paas group admin permissions hona zaroori hai.`,
            };
          }
          return {
            success: false,
            message: `Specific message delete karne ke liye us message ko quote karke reply karein ya target message specify karein.`,
          };
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
        if (toolName === "search_all_memories_and_chats") {
          const { unifiedMemoryService } = await import("../unifiedMemoryService");
          const res = await unifiedMemoryService.searchCrossPlatformMemory(args.query, {
            daysBack: args.daysBack || 90,
            limit: args.limit || 15,
          });
          return res;
        }
        if (toolName === "manage_memory_vault") {
          const { unifiedMemoryService } = await import("../unifiedMemoryService");
          if (args.action === "remember") {
            const saveRes = await unifiedMemoryService.addAtomicFact(args.factOrKeyword, args.category || "personal_detail", "whatsapp");
            return { success: saveRes.success, isPersistent: saveRes.isPersistent, message: saveRes.confirmationMessage, fact: saveRes.entry.fact };
          } else if (args.action === "forget") {
            return await unifiedMemoryService.removeAtomicFact(args.factOrKeyword);
          } else {
            const facts = await unifiedMemoryService.listAllFacts();
            return { success: true, count: facts.length, facts: facts.map((f) => f.fact) };
          }
        }
        if (toolName === "search_visual_and_document_vault") {
          const { multimodalRagService } = await import("../multimodalRagService");
          return await multimodalRagService.searchVisualAndDocumentVault(args.query, {
            daysBack: args.daysBack || 90,
            limit: args.limit || 15,
          });
        }
        if (toolName === "delegate_to_specialist_agent") {
          const { multiAgentSpecialistSwarm } = await import("../multiAgentSpecialistSwarm");
          return await multiAgentSpecialistSwarm.delegate(args.agentType, args.taskPrompt);
        }
        if (toolName === "generate_morning_briefing") {
          const { proactiveExecutiveService } = await import("../proactiveExecutiveService");
          const briefing = await proactiveExecutiveService.generateChiefOfStaffMorningBriefing();
          return { success: true, briefing, message: "Chief-of-Staff Morning Briefing generated successfully." };
        }
        if (toolName === "check_unanswered_messages_dossier") {
          const { proactiveExecutiveService } = await import("../proactiveExecutiveService");
          return await proactiveExecutiveService.checkPendingUnansweredMessages(args.thresholdHours || 3);
        }
        if (toolName === "search_whatsapp_history") {
          return await whatsappHistoryEngine.searchWhatsAppHistory(args.query, {
            contact: args.contact,
            daysBack: args.daysBack || 30,
            limit: args.limit || 15,
          });
        }
        if (toolName === "get_unknown_senders_digest") {
          const res = await whatsappHistoryEngine.getConversationSummaryAndHistory(
            "unknown",
            args.limit || 30,
            args.daysBack || 7
          );
          return res;
        }
        if (toolName === "set_contact_message_quota") {
          const { whatsappDailyQuotaEngine } = await import("./whatsappDailyQuotaEngine");
          const res = await whatsappDailyQuotaEngine.setContactQuota(args.contactNameOrPhone, args.dailyLimit, "Boss DK");
          return { success: res.success, message: res.message, limit: res.limit };
        }
        if (toolName === "set_global_message_quota") {
          const { whatsappDailyQuotaEngine } = await import("./whatsappDailyQuotaEngine");
          const res = await whatsappDailyQuotaEngine.setGlobalQuota(args.scope, args.dailyLimit, "Boss DK");
          return { success: res.success, message: res.message, scope: res.scope, limit: res.limit };
        }
        if (toolName === "get_message_quotas_status") {
          const { whatsappDailyQuotaEngine } = await import("./whatsappDailyQuotaEngine");
          const res = await whatsappDailyQuotaEngine.getQuotaStatus(args.contactNameOrPhone);
          return { success: res.success, message: res.report, report: res.report };
        }
        if (toolName === "reset_daily_message_counters") {
          const { whatsappDailyQuotaEngine } = await import("./whatsappDailyQuotaEngine");
          const res = await whatsappDailyQuotaEngine.resetDailyCounters(args.contactNameOrPhone);
          return { success: res.success, message: res.message };
        }
        if (toolName === "get_device_location" || toolName === "get_family_device_location") {
          const { deviceLocationTrackerService } = await import("../deviceLocationTrackerService");
          const queryTarget = String(args?.personNameOrLabel || "boss").trim();
          const res = await deviceLocationTrackerService.getDeviceLocation(queryTarget);
          return res;
        }
        if (toolName === "get_upcoming_festivals_and_holidays" || toolName === "get_public_holidays") {
          const { publicApisService } = await import("../publicApisService");
          const res = await publicApisService.getUpcomingFestivalsAndHolidays(
            args?.festivalQuery ? String(args.festivalQuery) : undefined,
            args?.year ? Number(args.year) : undefined
          );
          return res;
        }

        // ── Instagram Action Suite ──
        if (toolName === "instagram_search_user") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.searchUserHumanPaced(args.query);
        }
        if (toolName === "instagram_get_user_info") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.getUserInfoLive(args.username);
        }
        if (toolName === "instagram_send_dm") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.sendMessageToTarget(args.recipient, args.message);
        }
        if (toolName === "instagram_follow_user") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.followUserHumanPaced(args.username);
        }
        if (toolName === "instagram_unfollow_user") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.unfollowUserHumanPaced(args.username);
        }
        if (toolName === "instagram_like_post") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.likeMediaHumanPaced(args.mediaId);
        }
        if (toolName === "instagram_comment_post") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.commentMediaHumanPaced(args.mediaId, args.commentText);
        }
        if (toolName === "instagram_view_user_feed") {
          const { instagramBotService } = await import("../instagramBotService");
          return await instagramBotService.getUserFeedAndPostsHumanPaced(args.username, args.maxPosts || 6);
        }

        // ── Cyber Security & Media Inspection ──
        if (toolName === "scan_website_security") {
          const { runWebsiteSecurityScan } = await import("../websiteSecurityCommands");
          const target = String(args.urlOrDomain || args.target || "").trim();
          const mode = args.scanMode === "audit" ? "audit" : args.scanMode === "link" ? "link" : "deep";
          const scanOutput = await runWebsiteSecurityScan(target, mode);
          return { success: true, result: scanOutput };
        }
        if (toolName === "analyze_youtube_video") {
          const { youtubeService } = await import("../youtubeService");
          const videoId = youtubeService.extractVideoId(args.videoUrl);
          if (!videoId) return { success: false, message: "Valid YouTube URL ya ID chahiye." };
          const analysis = await youtubeService.analyzeVideo(videoId);
          return { success: true, analysis };
        }
        if (toolName === "play_next_song") {
          const { whatsappFeatureEngine } = await import("../whatsappFeatureEngine");
          const nextRes = await whatsappFeatureEngine.handleNextSongInPlaylist(replyJid, senderName);
          if (nextRes.handled && nextRes.replyText) {
            if (nextRes.audioBuffer && sendVoiceFn) {
              try {
                await sendVoiceFn(replyJid, nextRes.audioBuffer, messageKey, "audio/mp4");
              } catch {}
            }
            return { success: true, message: nextRes.replyText };
          }
          return { success: false, message: "Playlist me agla gaana nahi mila." };
        }
        if (toolName === "identify_song") {
          const { musicRecognitionService } = await import("../musicRecognitionService");
          const songClue = args.songClue || args.clue || args.lyrics || "";
          return await musicRecognitionService.identifyHummingOrTune(songClue);
        }

        // ── Universal System Aliases Mappings ──
        if (toolName === "search_rail_pnr_status") return await executeTool("check_pnr_status", args);
        if (toolName === "play_music") return await executeTool("search_or_play_music", args);
        if (toolName === "make_phone_call" || toolName === "trigger_or_schedule_voice_call") return await executeTool("trigger_voice_call", args);
        if (toolName === "set_reminder_or_alarm") return await executeTool("set_reminder", args);
        if (toolName === "generate_ai_photo") return await executeTool("generate_ai_image", args);
        if (toolName === "search_memory") return await executeTool("search_all_memories_and_chats", args);
        if (toolName === "remember_fact") return await executeTool("remember_personal_fact", args);
        if (toolName === "set_routine") return await executeTool("update_boss_daily_routine", args);
        if (toolName === "get_routine") return await executeTool("get_boss_daily_routine", args);
        if (toolName === "schedule_message") return await executeTool("schedule_whatsapp_message", args);
        if (toolName === "create_cron_task") return await executeTool("create_automated_cron_task", args);
        if (toolName === "add_directive") return await executeTool("add_boss_directive", args);
        if (toolName === "teach_friday") return await executeTool("teach_friday_lesson", args);
        if (toolName === "correct_friday") return await executeTool("correct_friday_behavior", args);
        if (toolName === "voice_mode_toggle") return await executeTool("set_friday_voice_tone", args);
        if (toolName === "check_session_health") return await executeTool("get_whatsapp_session_ban_health", args);
        if (toolName === "create_poll") return await executeTool("generate_poll", args);
        if (toolName === "lookup_phone_details") return await executeTool("lookup_phone_number_details", args);
        if (toolName === "get_whatsapp_messages" || toolName === "get_conversation_history") return await executeTool("get_messages_digest", args);
        if (toolName === "unpause_bot") {
          const { humanBotFirewallService } = await import("../humanBotFirewallService");
          (humanBotFirewallService as any).unpauseAll?.();
          return { success: true, message: "Bot unpaused successfully across all chats." };
        }

        // ── UNIVERSAL SEMANTIC ENGINE FALLBACK ──
        try {
          const { semanticIntentEngine } = await import("../semanticIntentEngine");
          const fallbackRes = await semanticIntentEngine.executeTool(toolName, args, {
            channel: "whatsapp",
            chatId: replyJid,
            senderName,
            messageKey,
            sendVoiceFn: (t, a, k, m) => sendVoiceFn(t, a, k, m),
            sendPhotoFn: (t, img, cap, k) => sendPhotoFn(t, img, cap, k),
          });
          if (fallbackRes && fallbackRes.status !== "unknown_tool") {
            return fallbackRes;
          }
        } catch (semErr: any) {
          console.warn(`[WhatsAppBossAI] Semantic fallback notice for "${toolName}":`, semErr?.message || semErr);
        }
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
      return { status: "unknown_tool" };
    };

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

    // ── IF FRIDAY MODE B: Direct 100% Uncensored Open Source Routing (Zero Gemini) ─
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
        chatGptMemoryEngine.learnFromMessageTurn("Boss DK", messageText, cleanText, "whatsapp").catch(() => {});
        return cleanText;
      }
    }

    // Helper to process tool calling and post-processing on any active or fresh Gemini Chat session
    const processChatTurn = async (chatInstance: any, promptMessage: string): Promise<string> => {
      let response = await chatInstance.sendMessage({ message: promptMessage });

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

        response = await chatInstance.sendMessage({
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

      // If an actionable tool was executed and Gemini returned a generic/lame acknowledgement (e.g. "isse yaad rakhunga", "theek hai"), override with the actual tool confirmation card
      if (lastToolResult && (lastToolResult.message || lastToolResult.bossReply)) {
        const toolMsg = lastToolResult.bossReply || lastToolResult.message;
        const isGenericLameAcknowledgement =
          !replyText ||
          /^(?:(?:theek|thik|haan|ha|ji)?\s*(?:boss|bhai)?[\s,.]*)?(?:isse?\s*yaad\s*rakhung[ai]|yaad\s*rakhung[ai]|note\s*kar\s*liy[aa]|samajh\s*gay[ai]|ok|theek\s*hai|done)\.?$/i.test(replyText);

        if (isGenericLameAcknowledgement && toolMsg) {
          replyText = toolMsg.startsWith("✅") || toolMsg.startsWith("🌸") || toolMsg.startsWith("⚠️")
            ? toolMsg
            : `✅ ${toolMsg}`;
        }
      }

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
        if (!isModeB && fridayModeService.isUncensoredExplicitSexualContent(cleanText)) {
          return "Main nahi samjha Boss. Kripya bataiye main aapki kya madad kar sakti hoon?";
        }
        cognitiveScaffoldingEngine.addMasteryPoints(2).catch(() => {});
        neurotransmitterEngine.updateEmotionalMomentum(messageText, cleanText);
        chatGptMemoryEngine.learnFromMessageTurn("Boss DK", messageText, cleanText, "whatsapp").catch(() => {});
        return cleanText;
      }
      return "";
    };

    const currentCycleId = this.getCircadianCycleId();
    const sessionKey = replyJid || "boss_dk";
    const existingSession = this.activeBossSessions.get(sessionKey);

    // Prepare prompt message with swipe-to-reply or subtext context
    let promptTurnMessage = messageText;
    if (quotedMessage && quotedMessage.isReply) {
      const qPhoneMatch = (quotedMessage.text || "").match(/(?:\+?91[\s\-]?)?([6-9]\d{9})\b/) || (quotedMessage.text || "").match(/(\+?\d[\d\s\-]{8,15}\d)/);
      const extractedPhone = qPhoneMatch ? qPhoneMatch[1].replace(/\D/g, "") : (quotedMessage.senderPhone || "");
      promptTurnMessage = `[SWIPE-TO-REPLY CONTEXT: Boss replied by swiping on a previous message/media]
📩 PREVIOUS QUOTED MESSAGE (From: ${quotedMessage.sender}, Type: ${quotedMessage.mediaType.toUpperCase()}):
"${quotedMessage.text}"
${extractedPhone ? `📱 EXTRACTED PHONE NUMBER FROM QUOTE: +${extractedPhone}` : ""}

💬 BOSS'S SWIPE-REPLY & QUESTION/INSTRUCTION:
"${messageText}"`;
    } else if (subtextSnippet) {
      promptTurnMessage = `${subtextSnippet}\n${messageText}`;
    }

    // ── Phase 1: Try Existing Active Session (Continuous across 03:00 AM for Boss until 'new session' command) ──
    const ownerPhone = (process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const isBossUser = sessionKey === "boss_dk" || !replyJid || replyJid.includes("boss") || (ownerPhone && sessionKey.includes(ownerPhone.slice(-10)));

    if (existingSession && (isBossUser || existingSession.cycleId === currentCycleId) && existingSession.mode === currentMode) {
      try {
        console.log(`[WhatsAppBossAI] ⚡ Reusing active continuous session (${existingSession.cycleId}) for Boss. Zero context amnesia across turns.`);
        const reply = await processChatTurn(existingSession.chat, promptTurnMessage);
        if (reply) {
          existingSession.lastActive = Date.now();
          geminiKeyPoolService.recordSuccess(allocation.keyIndex);
          return reply;
        }
      } catch (sessionErr: any) {
        console.warn(`[WhatsAppBossAI] Active session sendMessage failed (${sessionErr?.message || sessionErr}). Evicting session and initializing fresh...`);
        this.activeBossSessions.delete(sessionKey);
      }
    }

    // ── Phase 2: Fresh Session Initialization (First message of day or fallback after 3:00 AM reset or redeploy) ──
    const { getMessengerGeminiClient, DEFAULT_GEMINI_MODEL_CHAIN } = await import("../geminiKeyPoolService");
    const geminiClient = getMessengerGeminiClient();

    for (const model of DEFAULT_GEMINI_MODEL_CHAIN) {
      try {
        const chat = geminiClient.chats.create({
          model,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
            ...(currentMode === "mode_b" ? { safetySettings: UNCENSORED_SAFETY_SETTINGS as any } : {}),
          },
        });

        const reply = await processChatTurn(chat, promptTurnMessage);
        if (reply) {
          this.activeBossSessions.set(sessionKey, {
            chat,
            cycleId: currentCycleId,
            lastActive: Date.now(),
            mode: currentMode,
            model,
          });
          geminiKeyPoolService.recordSuccess(allocation.keyIndex);
          return reply;
        }
      } catch (e: any) {
        console.warn(`[WhatsAppBossAI] Model ${model} on Key #${allocation.keyIndex + 1} failed (${e?.message || e}), trying next model...`);
        const errMsg = String(e?.message || e);
        if (e?.status === 429 || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
          geminiKeyPoolService.recordRateLimitError(allocation.keyIndex);
          allocation = geminiKeyPoolService.getOptimalClient({ priority: "boss" });
          ai = allocation.client;
        } else {
          geminiKeyPoolService.recordGenericError(allocation.keyIndex);
        }
      }
    }

    return "Boss, main sun rahi hoon! Kuch technical hiccup hua, ek baar dobara bolein?";
  }
}

export const whatsappBossAiEngine = new WhatsAppBossAiEngine();
