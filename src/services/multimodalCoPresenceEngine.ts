/**
 * Continuous Multimodal Co-Presence Engine for Friday AI
 * 
 * Bridges visual memory (photos, screenshots, document scans) with ongoing
 * conversational pronouns and deictic references ("isko samjhao", "ye kya hai",
 * "ye error dekho", "screen pe jo hai").
 */

import { visionMemoryService } from "./visionMemoryService";

export class MultimodalCoPresenceEngine {
  private static instance: MultimodalCoPresenceEngine;

  private constructor() {}

  public static getInstance(): MultimodalCoPresenceEngine {
    if (!MultimodalCoPresenceEngine.instance) {
      MultimodalCoPresenceEngine.instance = new MultimodalCoPresenceEngine();
    }
    return MultimodalCoPresenceEngine.instance;
  }

  /**
   * Detects if the incoming message contains visual deictic references.
   */
  public isVisualDeicticQuery(text: string): boolean {
    const q = (text || "").toLowerCase();
    return (
      q.includes("ye photo") ||
      q.includes("ye image") ||
      q.includes("ye tasveer") ||
      q.includes("ye screenshot") ||
      q.includes("screen pe") ||
      q.includes("isko dekh") ||
      q.includes("isko analyze") ||
      q.includes("ye error") ||
      q.includes("what is in this") ||
      q.includes("explain this image")
    );
  }

  /**
   * Compiles the active visual co-presence context for prompt injection.
   */
  public async compileVisualCoPresencePrompt(chatId?: string): Promise<string> {
    const media = visionMemoryService.getChatMediaContext(chatId);
    if (!media) return "";

    const timeAgoSec = Math.round((Date.now() - media.timestamp) / 1000);
    const timeDesc = timeAgoSec < 60 ? `${timeAgoSec}s ago` : `${Math.round(timeAgoSec / 60)}m ago`;

    return `👁️ ACTIVE MULTIMODAL CO-PRESENCE (Recently Shared Visual/Media Snapshot):
- Media Type: ${media.mimeType} (Received: ${timeDesc})
- Visual Summary: "${media.analysis || media.shortSummary || "Image/document shared"}"
${media.ocrText ? `- Extracted Text/Code (OCR): """${media.ocrText.slice(0, 300)}"""` : ""}
${media.caption ? `- Caption: "${media.caption}"` : ""}
*Co-Presence Rule: When Boss says "isko dekho", "ye image", or "ye error", they are referring to this exact visual snapshot!*`;
  }
}

export const multimodalCoPresenceEngine = MultimodalCoPresenceEngine.getInstance();
