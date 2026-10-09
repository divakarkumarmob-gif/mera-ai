import { whatsappIdentityAgent, SenderIdentity } from "./whatsappIdentityAgent";
import { whatsappPrivacyGuardianAgent, PrivacyCheckResult } from "./whatsappPrivacyGuardianAgent";
import { whatsappIntentRouterAgent, IntentRouteResult } from "./whatsappIntentRouterAgent";
import { whatsappContactsHumanEngine } from "./whatsappContactsHumanEngine";
import { whatsappUnknownAssistantEngine } from "./whatsappUnknownAssistantEngine";
import { QuotedMessageContext } from "./whatsappTypes";

export interface PipelineExecutionResult {
  handled: boolean;
  replyText: string;
  identity: SenderIdentity;
  privacy: PrivacyCheckResult;
  route?: IntentRouteResult;
  executedBy: "BOSS_ENGINE" | "PRIVACY_GUARDIAN" | "CONTACTS_HUMAN_ENGINE" | "UNKNOWN_ASSISTANT_ENGINE";
}

export class WhatsAppTieredRouterAgent {
  /**
   * Main multi-agent workflow:
   * 1. Identity Agent identifies sender role & persona.
   * 2. If Boss -> delegated to Boss Engine.
   * 3. If Non-Boss -> Privacy Guardian checks for private/secret data inquiries.
   *    If private -> sends standard polite refusal.
   * 4. If safe -> Intent & Memory Router determines query type and memory need.
   * 5. Executes via appropriate Tiered Engine:
   *    - Saved contacts (Mom, Dad, GF, Friends) -> 100% Human Persona Engine (Medium Tier).
   *    - Unknown numbers -> DK Assistant Engine (Low/Fast Tier).
   */
  public async processIncomingMessage(
    text: string,
    senderPhone: string,
    senderDisplayName: string,
    replyJid: string,
    isSenderOwner: boolean,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<PipelineExecutionResult> {
    // Step 1: Identity & Relationship Resolver
    const identity = await whatsappIdentityAgent.resolveIdentity(
      senderPhone,
      senderDisplayName,
      replyJid,
      isSenderOwner
    );

    console.log(
      `[TieredRouterAgent] 👤 Sender Identified: "${identity.displayName}" (${identity.phone}) | Role: ${identity.role} | Persona: ${identity.personaType} | Tier: ${identity.modelTier}`
    );

    // If Boss, the caller (whatsappBotService) handles it directly with whatsappBossAiEngine
    if (identity.isOwner || identity.role === "BOSS") {
      return {
        handled: false, // Let whatsappBossAiEngine handle Boss
        replyText: "",
        identity,
        privacy: { isPrivate: false },
        executedBy: "BOSS_ENGINE",
      };
    }

    // Step 2: Privacy & Secret Guardian Shield (Non-Boss senders)
    const privacy = whatsappPrivacyGuardianAgent.evaluatePrivacy(text, identity);
    if (privacy.isPrivate) {
      console.log(
        `[TieredRouterAgent] 🛡️ Privacy Guard Triggered for ${identity.displayName} (${identity.role}): ${privacy.reason}`
      );
      const refusal = privacy.refusalMessage || "Sorry, main is cheez ke liye madad nahi kar sakta.";
      return {
        handled: true,
        replyText: refusal,
        identity,
        privacy,
        executedBy: "PRIVACY_GUARDIAN",
      };
    }

    // Step 3: Intent & Memory Routing Agent
    const route = await whatsappIntentRouterAgent.routeIntent(text, identity, replyJid);
    console.log(
      `[TieredRouterAgent] 🧭 Intent: ${route.intent} | Requires Memory: ${route.requiresMemory}`
    );

    // Step 4: Tiered Execution Engines
    if (identity.personaType === "HUMAN_NATURAL") {
      // Saved Contact: 100% Real Insaan Persona (Zero AI Disclosed)
      const replyText = await whatsappContactsHumanEngine.generateHumanReply(
        text,
        identity,
        route,
        replyJid
      );
      return {
        handled: true,
        replyText,
        identity,
        privacy,
        route,
        executedBy: "CONTACTS_HUMAN_ENGINE",
      };
    } else {
      // Unknown Number: DK ka Assistant Persona
      const replyText = await whatsappUnknownAssistantEngine.generateAssistantReply(
        text,
        identity,
        route,
        replyJid
      );
      return {
        handled: true,
        replyText,
        identity,
        privacy,
        route,
        executedBy: "UNKNOWN_ASSISTANT_ENGINE",
      };
    }
  }
}

export const whatsappTieredRouterAgent = new WhatsAppTieredRouterAgent();
