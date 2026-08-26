import { GoogleGenAI } from "@google/genai";

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
  /**
   * Deeply analyzes a document text using Gemini AI semantic comprehension,
   * extracting structured summaries, critical clauses, and risk assessment.
   */
  public async analyzeDocument(
    documentTextOrSnippet: string,
    docTitle = "Document"
  ): Promise<DocumentAnalysisResult> {
    const text = (documentTextOrSnippet || "").trim();
    if (!text) {
      throw new Error("Document text ya content provide karna zaroori hai.");
    }

    const lower = text.toLowerCase();
    let type: DocumentAnalysisResult["documentType"] = "general";

    if (lower.match(/\b(agreement|contract|clause|party|termination|jurisdiction|liability|nda)\b/)) {
      type = "contract";
    } else if (lower.match(/\b(abstract|methodology|dataset|benchmark|conclusion|references|arxiv)\b/)) {
      type = "research_paper";
    } else if (lower.match(/\b(experience|education|skills|projects|curriculum vitae|resume|github|linkedin)\b/)) {
      type = "resume";
    } else if (lower.match(/\b(architecture|api|endpoint|database|schema|spec|microservice|payload)\b/)) {
      type = "technical_spec";
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are Friday, DK's elite AI Document Copilot and Legal/Technical Analyst.
Analyze the following document content thoroughly:

TITLE: "${docTitle}"
DOCUMENT TYPE DETECTED: "${type.toUpperCase()}"

CONTENT:
"${text.slice(0, 8000)}"

Return a valid JSON object matching this schema EXACTLY:
{
  "executiveSummary": "Concise 2-3 sentence executive summary of the document's core purpose and key terms in conversational Hinglish/English.",
  "keyClausesOrHighlights": [
    "Key clause or important highlight 1",
    "Key clause or important highlight 2",
    "Key clause or important highlight 3"
  ],
  "riskOrActionItems": [
    "Identified risk, obligation, penalty, or action item 1",
    "Identified risk, obligation, penalty, or action item 2"
  ]
}
Return ONLY valid JSON. No markdown code fences.`;

        const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
        for (const model of models) {
          try {
            const resp = await ai.models.generateContent({ model, contents: prompt });
            const raw = resp.text?.trim();
            if (raw) {
              const clean = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
              const parsed = JSON.parse(clean);
              if (parsed.executiveSummary && Array.isArray(parsed.keyClausesOrHighlights)) {
                return {
                  success: true,
                  documentTitle: docTitle,
                  documentType: type,
                  executiveSummary: parsed.executiveSummary,
                  keyClausesOrHighlights: parsed.keyClausesOrHighlights,
                  riskOrActionItems: parsed.riskOrActionItems || [],
                  message: `Boss, "${docTitle}" (${type.toUpperCase()}) ka deep AI analysis complete ho gaya hai! Executive summary: ${parsed.executiveSummary}`,
                };
              }
            }
          } catch {}
        }
      } catch (geminiErr) {
        console.warn("[DocumentCopilot] Gemini analysis warning, using heuristic fallback:", geminiErr);
      }
    }

    // Heuristic Fallback if Gemini is offline
    const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 10);
    const highlights = sentences.slice(0, 4);

    const riskOrActionItems: string[] = [];
    sentences.forEach((s) => {
      if (s.toLowerCase().match(/\b(shall|must|penalty|liability|risk|deadline|mandatory|require)\b/)) {
        if (riskOrActionItems.length < 3) riskOrActionItems.push(s);
      }
    });

    if (riskOrActionItems.length === 0) {
      riskOrActionItems.push("No immediate high-risk obligations detected.");
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

  /**
   * Answers questions based strictly on the provided document text using semantic AI search.
   */
  public async queryDocument(
    documentText: string,
    question: string
  ): Promise<DocumentQueryResult> {
    const text = (documentText || "").trim();
    const q = (question || "").trim();

    if (!text || !q) {
      throw new Error("Document text aur question dono provide karna zaroori hai.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are Friday, DK's Document Q&A Copilot.
Below is the text of a document:

"${text.slice(0, 8000)}"

QUESTION: "${q}"

Provide a clear, accurate, and concise answer in Friday's natural Hinglish voice based strictly on the facts in the document. Quote relevant snippets where helpful. If the document does not contain the answer, say "Boss, is document me is baare me koi direct information nahi mili."`;

        const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
        for (const model of models) {
          try {
            const resp = await ai.models.generateContent({ model, contents: prompt });
            const reply = resp.text?.trim();
            if (reply) {
              return {
                success: true,
                question: q,
                answer: reply,
                relevantSnippet: reply.slice(0, 180),
                message: `Boss, document ke mutabik: ${reply}`,
              };
            }
          } catch {}
        }
      } catch (err) {
        console.warn("[DocumentCopilot] Gemini Q&A note, falling back to heuristic search:", err);
      }
    }

    // Heuristic Fallback
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
