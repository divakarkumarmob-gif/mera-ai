export interface VoiceNoteSummaryResult {
  success: boolean;
  senderName: string;
  durationSeconds?: number;
  intentCategory: "urgent" | "work_meeting" | "payment" | "personal" | "general";
  twoLineSummary: string;
  actionItems: string[];
  spokenBriefing: string;
}

class VoiceNoteSummarizerService {
  /**
   * Summarizes long audio voice notes into a fast 2-line executive digest with action items.
   */
  public async summarizeVoiceNote(
    transcriptOrAudioSnippet: string,
    senderName = "Contact"
  ): Promise<VoiceNoteSummaryResult> {
    const rawText = (transcriptOrAudioSnippet || "").trim();
    if (!rawText) {
      return {
        success: false,
        senderName,
        intentCategory: "general",
        twoLineSummary: "Voice note me audio clear nahi tha.",
        actionItems: [],
        spokenBriefing: `Boss, ${senderName} ke voice note me koi audible baat samajh nahi aayi.`,
      };
    }

    const lower = rawText.toLowerCase();

    let category: "urgent" | "work_meeting" | "payment" | "personal" | "general" = "general";
    if (lower.match(/\b(urgent|jaldi|emergency|important|turant|fast)\b/)) category = "urgent";
    else if (lower.match(/\b(meeting|call|zoom|client|project|review|deadline|office)\b/)) category = "work_meeting";
    else if (lower.match(/\b(rupay|paise|payment|gpay|upi|transfer|bill|due|kharcha)\b/)) category = "payment";
    else if (lower.match(/\b(bhai|yaar|ghar|family|khana|party|trip)\b/)) category = "personal";

    // Extract action items
    const actionItems: string[] = [];
    const sentences = rawText.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 5);

    for (const s of sentences) {
      if (s.toLowerCase().match(/\b(call|karna|bhejo|de do|aana|karo|batao|schedule)\b/)) {
        actionItems.push(s);
      }
    }

    if (actionItems.length === 0 && sentences.length > 0) {
      actionItems.push(sentences[0]);
    }

    const twoLineSummary = `${senderName} ne kaha hai ki: "${sentences.slice(0, 2).join(". ")}". Main intent: ${category.toUpperCase()}.`;
    const spokenBriefing = `Boss, ${senderName} ke voice note ki summary: Unhone ${category === "work_meeting" ? "meeting aur work update" : category === "payment" ? "payment/money" : "message"} ke bare me baat ki hai. Key point: "${actionItems[0] || sentences[0]}".`;

    return {
      success: true,
      senderName,
      intentCategory: category,
      twoLineSummary,
      actionItems: actionItems.slice(0, 3),
      spokenBriefing,
    };
  }
}

export const voiceNoteSummarizerService = new VoiceNoteSummarizerService();
