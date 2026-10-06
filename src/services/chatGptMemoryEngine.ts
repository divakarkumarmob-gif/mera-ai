import { cognitiveMemoryOrchestrator } from "./subagents/cognitiveMemoryOrchestrator";
import { ChatTurnContext } from "./subagents/coreferenceAgent";

export class ChatGptMemoryEngine {
  /**
   * 1. RECALL PHASE (Pre-Inference):
   * Uses CognitiveMemoryOrchestrator to resolve in-session context (coreference) and search past memories,
   * personal vault, knowledge graph, and vector database for facts relevant to the user's incoming message.
   */
  public async recallRelevantMemories(
    queryText: string,
    recentHistory: ChatTurnContext[] = []
  ): Promise<string> {
    const res = await cognitiveMemoryOrchestrator.recallMemoriesWithContext(queryText, recentHistory);
    return res.contextPrompt;
  }

  /**
   * Resolve in-session query context (e.g. "uske kapde" -> "German Shepherd dog clothes")
   */
  public async resolveContextualQuery(
    queryText: string,
    recentHistory: ChatTurnContext[] = []
  ): Promise<string> {
    const res = await cognitiveMemoryOrchestrator.recallMemoriesWithContext(queryText, recentHistory);
    return res.resolvedQuery;
  }

  /**
   * 2. LEARN PHASE (Post-Reply Background Worker):
   * Runs asynchronously in background. Analyzes user statement, checks for new facts, resolves
   * contradictions, and updates Firestore Vault + Knowledge Graph + Vector DB.
   */
  public async learnFromMessageTurn(
    senderName: string,
    userText: string,
    botReplyText: string,
    channel: "whatsapp" | "telegram" | "web" = "whatsapp"
  ): Promise<void> {
    await cognitiveMemoryOrchestrator.learnAndConsolidateTurn(senderName, userText, botReplyText, channel);
  }
}

export const chatGptMemoryEngine = new ChatGptMemoryEngine();
