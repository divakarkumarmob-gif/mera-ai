import { GoogleGenAI } from "@google/genai";
import { vectorMemoryService } from "../vectorMemoryService";
import { memoryEngine } from "../memoryEngine";
import { db } from "../firebaseAdmin";
import { decryptData } from "../../utils/cryptoVault";
import { semanticKnowledgeGraphEngine } from "../semanticKnowledgeGraphEngine";
import { coreferenceAgent, ChatTurnContext } from "./coreferenceAgent";

const vaultCol = () => db.collection("memory").doc("personalVault").collection("entries");
const pinnedCol = () => db.collection("memory").doc("pinnedMemories").collection("entries");

const EXTRACTION_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
];

function withTimeout<T>(p: Promise<T>, ms = 2500, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export interface ExtractedFactEvolution {
  hasFact: boolean;
  category?: string;
  fact?: string;
  keywords?: string[];
  entity?: string;
  relation?: string;
  overridesPreviousFact?: boolean;
  previousFactKeyword?: string;
}

export class CognitiveMemoryOrchestrator {
  private recentFactCache: Set<string> = new Set();

  /**
   * 1. PRE-INFERENCE RECALL PIPELINE:
   * Resolves in-session coreferences, then queries Vector DB, Personal Vault, Pinned facts,
   * Knowledge Graph, and Contacts to return high-precision contextual memories.
   */
  public async recallMemoriesWithContext(
    currentQuery: string,
    recentHistory: ChatTurnContext[] = []
  ): Promise<{ resolvedQuery: string; contextPrompt: string }> {
    const raw = (currentQuery || "").trim();
    if (!raw || raw.length < 3 || raw.startsWith("@") || raw.startsWith("/")) {
      return { resolvedQuery: raw, contextPrompt: "" };
    }

    // A. Resolve Coreference (e.g., "uske kapde" -> "German Shepherd dog clothes")
    let resolvedQuery = raw;
    if (recentHistory.length > 0) {
      try {
        resolvedQuery = await withTimeout(
          coreferenceAgent.resolveQueryContext(raw, recentHistory),
          1500,
          raw
        );
      } catch {
        resolvedQuery = raw;
      }
    }

    // Ignore trivial queries (greetings, simple confirmations)
    if (
      /^(hi|hello|hey|ok|okay|hmm|haan|nahi|theek|suno|kya\s*haal|good\s*morning|good\s*night)\b/i.test(resolvedQuery) &&
      resolvedQuery.length < 20
    ) {
      return { resolvedQuery, contextPrompt: "" };
    }

    try {
      const recalledPoints: string[] = [];

      // 1. Vector Semantic Memory Search
      const vectorRes = await withTimeout(
        vectorMemoryService.searchSemanticMemory(resolvedQuery, 4, 0.40),
        2000,
        null
      ).catch(() => null);

      if (vectorRes && vectorRes.results && vectorRes.results.length > 0) {
        for (const item of vectorRes.results) {
          const text = item.summary || item.snippet;
          if (text && !recalledPoints.some((p) => p.toLowerCase().includes(text.toLowerCase().slice(0, 30)))) {
            recalledPoints.push(`[${item.dateRange || item.createdDateStr || "Past Memory"}] ${text}`);
          }
        }
      }

      // 2. Keyword Search in Personal Vault
      const words = resolvedQuery
        .toLowerCase()
        .replace(/[^\w\s\u0900-\u097F]/g, "")
        .split(/\s+/)
        .filter(
          (w) =>
            w.length >= 3 &&
            !["kya", "hai", "nahi", "raha", "hoga", "mera", "meri", "mere", "aaj", "kal", "bhi", "tha", "thi", "the"].includes(w)
        );

      if (words.length > 0) {
        try {
          const vaultSnap = await withTimeout(
            vaultCol().limit(100).get(),
            2000,
            { empty: true, docs: [] } as any
          ).catch(() => ({ empty: true, docs: [] }));

          if (vaultSnap && !vaultSnap.empty && vaultSnap.docs) {
            for (const doc of vaultSnap.docs) {
              const data = doc.data();
              const factText = decryptData(data.exactFact || "");
              if (!factText) continue;
              const lowerFact = factText.toLowerCase();

              const matchCount = words.filter((w) => lowerFact.includes(w)).length;
              if (matchCount >= 1) {
                if (!recalledPoints.some((p) => p.toLowerCase().includes(factText.toLowerCase().slice(0, 30)))) {
                  recalledPoints.push(`[${data.category || "vault"} (${data.date || "Prior"})] ${factText}`);
                }
              }
            }
          }
        } catch {}

        // 3. Pinned Lifelong Facts
        try {
          const pinnedSnap = await withTimeout(
            pinnedCol().orderBy("timestamp", "desc").limit(40).get(),
            2000,
            { empty: true, docs: [] } as any
          ).catch(() => ({ empty: true, docs: [] }));

          if (pinnedSnap && !pinnedSnap.empty && pinnedSnap.docs) {
            for (const doc of pinnedSnap.docs) {
              const data = doc.data();
              const factText = decryptData(data.fact || "");
              if (!factText) continue;
              const lowerFact = factText.toLowerCase();

              const matchCount = words.filter((w) => lowerFact.includes(w)).length;
              if (matchCount >= 1) {
                if (!recalledPoints.some((p) => p.toLowerCase().includes(factText.toLowerCase().slice(0, 30)))) {
                  recalledPoints.push(`[Pinned Memory (${data.date || "Prior"})] ${factText}`);
                }
              }
            }
          }
        } catch {}
      }

      // 4. Knowledge Graph Context
      try {
        const graphRelations = await withTimeout(
          semanticKnowledgeGraphEngine.findRelevantAssociations(resolvedQuery),
          1500,
          []
        ).catch(() => []);

        for (const rel of graphRelations) {
          if (!recalledPoints.some((p) => p.toLowerCase().includes(rel.toLowerCase().slice(0, 30)))) {
            recalledPoints.push(`[Knowledge Graph] ${rel}`);
          }
        }
      } catch {}

      // 5. Contacts & Relations Recall
      const isRelationQuery = /\b(dost|friend|friends|yaari|mitra|bhai|brother|sister|behan|family|risht|girlfriend|gf|colleague|roommate|contact|contacts|kaun)\b/i.test(resolvedQuery);
      try {
        const { contactsService } = await import("../contactsService");
        const allContacts = await withTimeout(contactsService.getAllContacts(), 2000, []).catch(() => []);

        for (const c of allContacts) {
          if (!c.name || c.id === "owner_default" || c.id === "temp") continue;
          const cNameLower = c.name.toLowerCase();
          const cRelLower = (c.relation || "").toLowerCase();

          let isMatch = false;
          if (isRelationQuery && c.relation) {
            if (/\b(dost|friend|friends|yaari|mitra)\b/i.test(resolvedQuery) && /\b(dost|friend|friends|yaari|mitra|bestfriend|buddy)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (/\b(family|ghar|risht|brother|bhai|sister|behan|mummy|papa)\b/i.test(resolvedQuery) && /\b(family|brother|bhai|sister|behan|mummy|papa|mother|father)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (/\b(girlfriend|gf|love|pyaar)\b/i.test(resolvedQuery) && /\b(girlfriend|gf|partner)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (words.some((w) => cRelLower.includes(w))) {
              isMatch = true;
            }
          }
          if (!isMatch && words.some((w) => w.length >= 3 && (cNameLower.includes(w) || w.includes(cNameLower)))) {
            isMatch = true;
          }

          if (isMatch) {
            const relStr = c.relation ? ` (${c.relation})` : "";
            const point = `[Contacts Book] ${c.name}${relStr}: +${c.phone}`;
            if (!recalledPoints.some((p) => p.toLowerCase().includes(c.name.toLowerCase()))) {
              recalledPoints.push(point);
            }
          }
        }
      } catch {}

      if (recalledPoints.length === 0) {
        return { resolvedQuery, contextPrompt: "" };
      }

      const contextPrompt = `\n🧠 [CHATGPT-STYLE COGNITIVE MEMORY RECALL (RELEVANT PAST CONTEXT)]:
The following verified past memories and associations from Boss DK directly relate to what he is saying right now:
${recalledPoints.slice(0, 8).map((p) => `• ${p}`).join("\n")}

👉 CHATGPT INTUITION MANDATE:
- Naturally connect this past context in your response if appropriate (e.g. if Boss mentions visiting a place or an entity, and a past memory connects to it, bring it up affectionately and intelligently)!
- NEVER say robotic phrases like "As per my database", "According to stored memory", or "I searched my records". Speak naturally as a loyal companion who genuinely remembered!`;

      return { resolvedQuery, contextPrompt };
    } catch (err) {
      console.warn("[CognitiveMemoryOrchestrator] Recall error:", err);
      return { resolvedQuery, contextPrompt: "" };
    }
  }

  /**
   * 2. ASYNC POST-INFERENCE LEARNING & CONTRADICTION RESOLVER:
   * Analyzes conversation turn in background, checks for new facts, resolves contradictions/overrides,
   * updates Firestore Vault, Knowledge Graph, and Vector Database.
   */
  public async learnAndConsolidateTurn(
    senderName: string,
    userText: string,
    botReplyText: string,
    channel: "whatsapp" | "telegram" | "web" = "whatsapp"
  ): Promise<void> {
    const cleanUser = (userText || "").trim();
    if (!cleanUser || cleanUser.length < 10) return;

    if (cleanUser.startsWith("@") || cleanUser.startsWith("/") || cleanUser.startsWith("http")) return;

    if (
      /^(play|bajao|search|kya|kaun|kab|kahan|weather|mausam|news|khabar|joke|shayari|calculate)\b/i.test(cleanUser) &&
      !cleanUser.includes("mera") &&
      !cleanUser.includes("meri") &&
      !cleanUser.includes("dost") &&
      !cleanUser.includes("hum") &&
      !cleanUser.includes("mujhe")
    ) {
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const extractionPrompt = `You are Friday AI's lifelong cognitive memory & contradiction extractor.
Analyze this message from user Boss DK:
<message>
"${cleanUser}"
</message>
(Assistant reply for context: "${(botReplyText || "").slice(0, 150)}")

TASK:
Determine if this statement contains any facts, pets, relationships, health events, preferences, plans, or changes in state about Boss DK that should be remembered.
Check if this fact contradicts or updates an earlier state (e.g., "ab maine coffee peena shuru kiya" -> overrides previous preference).

RETURN ONLY VALID JSON matching this exact schema:
{
  "hasFact": true or false,
  "category": "friends_and_relations | plans_and_travel | personal_preferences | lifestyle_and_health | career_and_business | pets_and_hobbies | general_personal_info",
  "fact": "Clear, concise fact in natural Hinglish or English describing the state or event.",
  "keywords": ["list", "of", "searchable", "keywords"],
  "entity": "Primary entity if any (e.g. Dog, Cat, Rahul, Coffee, Patna)",
  "relation": "e.g. owns, likes, visited, plans_to",
  "overridesPreviousFact": false or true,
  "previousFactKeyword": "keyword to search if updating/overriding"
}`;

    const ai = new GoogleGenAI({ apiKey });

    for (const model of EXTRACTION_MODELS) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: extractionPrompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        const rawJson = resp.text?.trim() || "{}";
        const parsed: ExtractedFactEvolution = JSON.parse(rawJson);

        if (parsed && parsed.hasFact && parsed.fact && parsed.fact.trim()) {
          const cleanFact = parsed.fact.trim();
          const factKey = cleanFact.toLowerCase();

          if (this.recentFactCache.has(factKey)) return;
          this.recentFactCache.add(factKey);
          if (this.recentFactCache.size > 200) {
            const oldest = Array.from(this.recentFactCache).slice(0, 50);
            oldest.forEach((k) => this.recentFactCache.delete(k));
          }

          const category = parsed.category || "general_personal_info";
          const now = Date.now();
          const dateStr = new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

          // 1. Personal Vault in Firestore
          await memoryEngine.addPersonalVaultFact(category, cleanFact);

          // 2. Archive to permanent Vector Store for cosine semantic retrieval
          await vectorMemoryService.archiveToVectorStore({
            originalText: cleanUser,
            summary: cleanFact,
            sourceType: "session_dialogue",
            dateRangeStr: dateStr,
            startTimestamp: now,
            endTimestamp: now,
            metadata: {
              channel,
              category,
              keywords: parsed.keywords || [],
              source: "chatgpt_cognitive_memory",
            },
          });

          // 3. Update Knowledge Graph if entity & relation are present
          if (parsed.entity && parsed.relation) {
            try {
              await semanticKnowledgeGraphEngine.addOrUpdateRelationship(
                "boss_dk",
                parsed.entity.toLowerCase(),
                parsed.relation.toLowerCase(),
                { targetType: "concept" }
              );
            } catch {}
          }

          console.log(`[CognitiveMemory] 🧠✨ Learned lifelong fact [${category}]: "${cleanFact}" (Channel: ${channel})`);
        }
        return;
      } catch {
        // Try fallback model
      }
    }
  }
}

export const cognitiveMemoryOrchestrator = new CognitiveMemoryOrchestrator();
