/**
 * Conversational Latency & Hesitation Engine for Friday AI
 * 
 * Simulates human-like cognitive processing:
 * 1. Adaptive typing indicator duration (prevents robotic instant replies on long texts while keeping urgent actions snappy).
 * 2. Natural thought pauses & hesitation tokens ("Hmm...", "Ek second...", "Dekhein...") for complex or reflective answers.
 */

export interface LatencyProfile {
  typingDelayMs: number;
  hesitationPrefix?: string;
  isUrgent: boolean;
}

export class ConversationalLatencyEngine {
  private static instance: ConversationalLatencyEngine;

  private constructor() {}

  public static getInstance(): ConversationalLatencyEngine {
    if (!ConversationalLatencyEngine.instance) {
      ConversationalLatencyEngine.instance = new ConversationalLatencyEngine();
    }
    return ConversationalLatencyEngine.instance;
  }

  /**
   * Calculates realistic human typing & thinking latency for an outbound message.
   * @param messageText The reply text being delivered
   * @param incomingQuery The user's original question
   * @param isActionTool Whether a critical backend tool was already executed (e.g. voice call, emergency message)
   */
  public calculateLatency(
    messageText: string,
    incomingQuery: string = "",
    isActionTool: boolean = false
  ): LatencyProfile {
    const textLen = (messageText || "").length;
    const queryLower = (incomingQuery || "").toLowerCase();

    // Urgent cues require near-zero latency
    const isUrgent =
      isActionTool ||
      queryLower.includes("jaldi") ||
      queryLower.includes("urgent") ||
      queryLower.includes("emergency") ||
      queryLower.includes("call karo") ||
      queryLower.includes("sos");

    if (isUrgent) {
      return {
        typingDelayMs: 400,
        isUrgent: true,
      };
    }

    // Baseline typing speed: average human types ~40-60 words per minute (approx 200-300 chars/min)
    // We simulate a snappy human speed: ~60-80 chars per second of reading/typing time, capped between 800ms and 3200ms
    let typingDelay = Math.min(3200, Math.max(800, Math.floor(textLen * 18)));

    // For very short one-liners ("Haan Boss", "Done!", "Bilkul"), keep it super fast
    if (textLen < 25) {
      typingDelay = Math.floor(600 + Math.random() * 400);
    }

    // Determine if natural thought hesitation is appropriate
    let hesitationPrefix: string | undefined = undefined;
    const isComplexAnalysis =
      queryLower.includes("kya lagta hai") ||
      queryLower.includes("analyze") ||
      queryLower.includes("soch ke") ||
      queryLower.includes("kya karoon") ||
      queryLower.includes("difference") ||
      queryLower.includes("kyu");

    if (isComplexAnalysis && Math.random() < 0.35) {
      const hesitations = [
        "Hmm, ek second sochne do...",
        "Hmm...",
        "Dekhein Boss...",
        "Achha point hai...",
      ];
      hesitationPrefix = hesitations[Math.floor(Math.random() * hesitations.length)];
    }

    return {
      typingDelayMs: typingDelay,
      hesitationPrefix,
      isUrgent: false,
    };
  }
}

export const conversationalLatencyEngine = ConversationalLatencyEngine.getInstance();
