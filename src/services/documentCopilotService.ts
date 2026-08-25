export interface DocumentAnalysisResult {
  success: boolean;
  documentTitle: string;
  documentType: "contract" | "research_paper" | "resume" | "technical_spec" | "general";
  executiveSummary: string;
  keyClausesOrHighlights: string[];
  riskOrActionItems: string[];
  message: string;
}

export interface DocumentQueryResult {
  success: boolean;
  question: string;
  answer: string;
  relevantSnippet?: string;
  message: string;
}

class DocumentCopilotService {
  public async analyzeDocument(
    documentTextOrSnippet: string,
    docTitle = "Document"
  ): Promise<DocumentAnalysisResult> {
    const text = (documentTextOrSnippet || "").trim();
    if (!text) {
      throw new Error("Document text ya content provide karna zaroori hai.");
    }

    const lower = text.toLowerCase();
    let type: "contract" | "research_paper" | "resume" | "technical_spec" | "general" = "general";

    if (lower.match(/\b(agreement|contract|clause|party|termination|jurisdiction|liability)\b/)) {
      type = "contract";
    } else if (lower.match(/\b(abstract|methodology|dataset|benchmark|conclusion|references)\b/)) {
      type = "research_paper";
    } else if (lower.match(/\b(experience|education|skills|projects|curriculum vitae|resume)\b/)) {
      type = "resume";
    } else if (lower.match(/\b(architecture|api|endpoint|database|schema|spec)\b/)) {
      type = "technical_spec";
    }

    const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 10);
    const highlights = sentences.slice(0, 4);

    const riskOrActionItems: string[] = [];
    sentences.forEach((s) => {
      if (s.toLowerCase().match(/\b(shall|must|penalty|liability|risk|deadline|mandatory|require)\b/)) {
        if (riskOrActionItems.length < 3) riskOrActionItems.push(s);
      }
    });

    if (riskOrActionItems.length === 0) {
      riskOrActionItems.push("No immediate high-risk terms detected.");
    }

    const executiveSummary = `Is document ka main context ${type.toUpperCase()} se related hai. Core subject: "${sentences[0] || docTitle}".`;
    const message = `Boss, "${docTitle}" (${type.toUpperCase()}) ka analysis complete ho gaya hai! Executive summary: ${executiveSummary}`;

    return {
      success: true,
      documentTitle: docTitle,
      documentType: type,
      executiveSummary,
      keyClausesOrHighlights: highlights,
      riskOrActionItems,
      message,
    };
  }

  public async queryDocument(
    documentText: string,
    question: string
  ): Promise<DocumentQueryResult> {
    const text = (documentText || "").trim();
    const q = (question || "").trim();

    if (!text || !q) {
      throw new Error("Document text aur question dono provide karna zaroori hai.");
    }

    const qWords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 5);

    let bestSentence = sentences[0] || text.slice(0, 150);
    let maxMatch = 0;

    for (const s of sentences) {
      const sLow = s.toLowerCase();
      let matchCount = 0;
      for (const w of qWords) {
        if (sLow.includes(w)) matchCount++;
      }
      if (matchCount > maxMatch) {
        maxMatch = matchCount;
        bestSentence = s;
      }
    }

    const answer = `Aapke sawal "${q}" ke mutabik: ${bestSentence}`;
    const message = `Boss, document ke mutabik: ${bestSentence}`;

    return {
      success: true,
      question: q,
      answer,
      relevantSnippet: bestSentence,
      message,
    };
  }
}

export const documentCopilotService = new DocumentCopilotService();
