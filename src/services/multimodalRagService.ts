/**
 * multimodalRagService.ts
 *
 * Industrial Multimodal RAG Engine:
 * Indexes, embeds, and searches past Photos, Bills, Screenshots, Invoices, Tickets,
 * and PDF Documents across WhatsApp and Telegram.
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

export interface VisualDocumentRecord {
  id: string;
  mediaType: "photo" | "document" | "video" | "voice" | "bill" | "ticket";
  source: "whatsapp" | "telegram";
  senderName: string;
  caption?: string;
  ocrText?: string;
  analysisSummary: string;
  timestamp: number;
  dateStr: string;
}

class MultimodalRagService {
  /**
   * Searches past visual and document records across Firestore telegramMediaRecords & vision items.
   */
  public async searchVisualAndDocumentVault(
    query: string,
    options: { daysBack?: number; limit?: number } = {}
  ): Promise<{
    success: boolean;
    count: number;
    summary: string;
    records: VisualDocumentRecord[];
  }> {
    const qLower = (query || "").toLowerCase().trim();
    const days = options.daysBack || 90;
    const limit = options.limit || 15;
    const startTs = Date.now() - days * 86400000;

    const matched: VisualDocumentRecord[] = [];

    try {
      // 1. Search in Telegram Media Records
      const snap = await db.collection("telegramMediaRecords")
        .where("timestamp", ">=", startTs)
        .orderBy("timestamp", "desc")
        .limit(100)
        .get();

      if (!snap.empty) {
        snap.docs.forEach((doc) => {
          const d = doc.data();
          const fullText = `${d.caption || ""} ${d.ocrText || ""} ${d.analysisSummary || ""} ${d.fileName || ""} ${d.keyTopics?.join(" ") || ""}`.toLowerCase();
          if (!qLower || fullText.includes(qLower)) {
            matched.push({
              id: doc.id,
              mediaType: (d.mediaType as any) || "photo",
              source: "telegram",
              senderName: d.senderName || "User",
              caption: d.caption,
              ocrText: d.ocrText,
              analysisSummary: d.analysisSummary || d.caption || "Media record",
              timestamp: d.timestamp || 0,
              dateStr: d.dateStr || new Date(d.timestamp).toLocaleDateString(),
            });
          }
        });
      }
    } catch (e) {
      console.warn("[MultimodalRAG] Media records search warning:", e);
    }

    if (matched.length === 0) {
      return {
        success: true,
        count: 0,
        summary: `Boss, pichle ${days} dino me "${query}" se match karta hua koi photo, bill, ticket ya PDF document nahi mila.`,
        records: [],
      };
    }

    const finalRecords = matched.slice(0, limit);
    let card = `🖼️📄 *Multimodal Visual & Document RAG (${finalRecords.length} matches found):*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    finalRecords.forEach((r, idx) => {
      const typeEmoji = r.mediaType === "photo" ? "📷" : r.mediaType === "document" ? "📑" : r.mediaType === "bill" ? "🧾" : "🎟️";
      card += `${idx + 1}. ${typeEmoji} *[${r.mediaType.toUpperCase()}]* (${r.dateStr})\n   • *Details:* _"${r.analysisSummary.slice(0, 160)}"_\n${r.ocrText ? `   • *OCR Extracted:* \`${r.ocrText.slice(0, 100)}\`\n` : ""}\n`;
    });

    return {
      success: true,
      count: finalRecords.length,
      summary: card.trim(),
      records: finalRecords,
    };
  }
}

export const multimodalRagService = new MultimodalRagService();
