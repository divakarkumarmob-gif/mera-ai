import { SenderIdentity } from "./whatsappIdentityAgent";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";

export type MessageIntent =
  | "TOOL_CALL"
  | "ABOUT_DK_GENERAL"
  | "MEMORY_QUERY"
  | "GENERAL_KNOWLEDGE"
  | "SIMPLE_CHAT";

export interface IntentRouteResult {
  intent: MessageIntent;
  toolName?: string;
  memoryContext?: string;
  requiresMemory: boolean;
  workingContext: {
    senderName: string;
    relation: string;
    role: string;
  };
}

export class WhatsAppIntentRouterAgent {
  /**
   * Classifies the intent of an incoming message and fetches memory if needed.
   */
  public async routeIntent(
    text: string,
    identity: SenderIdentity,
    replyJid: string
  ): Promise<IntentRouteResult> {
    const clean = (text || "").toLowerCase().trim();

    const workingContext = {
      senderName: identity.displayName,
      relation: identity.relation || "friend",
      role: identity.role,
    };

    // 1. Tool Call Intent (e.g. weather, music, time, calculation)
    const isWeather = /\b(weather|mausam|barish|rain|temperature|garmi|thandi)\b/i.test(clean);
    const isMusic = /\b(music|song|gaana|gana|play\s*song|bajao)\b/i.test(clean);
    const isWebSearch = /\b(search|google|news|latest\s*updates?)\b/i.test(clean);

    if (isWeather) {
      return { intent: "TOOL_CALL", toolName: "get_weather", requiresMemory: false, workingContext };
    }
    if (isMusic) {
      return { intent: "TOOL_CALL", toolName: "play_music", requiresMemory: false, workingContext };
    }
    if (isWebSearch) {
      return { intent: "TOOL_CALL", toolName: "search_web", requiresMemory: false, workingContext };
    }

    // 2. Memory Query (User asking about past shared context / memory)
    const isMemoryQuery =
      /\b(yaad\s*hai|yaad\s*h|purani\s*baat|kal\s*kya|humne\s*kya|mera\s*naam\s*kya|pichli\s*baar|last\s*time|pehle\s*kya|remember)\b/i.test(clean);

    if (isMemoryQuery) {
      let memoryContext = "";
      try {
        const recentHistory = await whatsappHistoryEngine.getRecentBossContext(replyJid, 8);
        if (recentHistory && recentHistory.length > 0) {
          memoryContext = recentHistory
            .map((m) => `${m.senderName}: "${m.text}"`)
            .join("\n");
        }
      } catch (memErr) {
        console.warn("[IntentRouterAgent] Memory retrieval notice:", memErr);
      }

      return {
        intent: "MEMORY_QUERY",
        requiresMemory: true,
        memoryContext: memoryContext || `Previous conversation with ${identity.displayName} (${identity.relation})`,
        workingContext,
      };
    }

    // 3. About DK General (Questions about DK's general status)
    const isAboutDK =
      /\b(?:dk|divakar)\s*(?:kahan|kaha|kya\s*kar\s*raha|so\s*raha|busy|free|aayega|call|msg|batao|bolna|bol\s*do)\b/i.test(clean) ||
      /\b(?:unhe|unko)\s*(?:bol\s*dena|bata\s*dena|bolna)\b/i.test(clean);

    if (isAboutDK) {
      return {
        intent: "ABOUT_DK_GENERAL",
        requiresMemory: false,
        workingContext,
      };
    }

    // 4. General Knowledge / Studies / Advice / Help
    const isGKOrStudy =
      /\b(kya\s*hota\s*hai|kya\s*hai|meaning|explain|kaise\s*kare|kaise\s*banta|formula|solve|code|python|maths|science|neet|physics|chemistry|history|capital|president|fact|photosynthesis|biology|geography|gk|quiz|question|padhai|study|exam)\b/i.test(clean) ||
      clean.length > 30;

    if (isGKOrStudy) {
      return {
        intent: "GENERAL_KNOWLEDGE",
        requiresMemory: false,
        workingContext,
      };
    }

    // 5. Simple Chat / Greetings / Casual banter
    return {
      intent: "SIMPLE_CHAT",
      requiresMemory: false,
      workingContext,
    };
  }
}

export const whatsappIntentRouterAgent = new WhatsAppIntentRouterAgent();
