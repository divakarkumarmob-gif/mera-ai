import { GoogleGenAI } from "@google/genai";
import { memoryEngine } from "./memoryEngine";
import { vectorMemoryService } from "./vectorMemoryService";
import { db } from "./firebaseAdmin";
import { decryptData } from "../utils/cryptoVault";

const vaultCol = () => db.collection("memory").doc("personalVault").collection("entries");

const EXTRACTION_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
];

interface ExtractedFactPayload {
  hasFact: boolean;
  category?: string;
  fact?: string;
  summary?: string;
  keywords?: string[];
}

function withTimeout<T>(p: Promise<T>, ms = 2500, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export class ChatGptMemoryEngine {
  private recentFactCache: Set<string> = new Set();

  /**
   * 1. RECALL PHASE (Pre-Inference):
   * Searches past memories, personal vault, and semantic vector database for facts relevant
   * to the user's incoming message, exactly like ChatGPT's Memory recall.
   */
  public async recallRelevantMemories(queryText: string): Promise<string> {
    const clean = (queryText || "").trim();
    if (!clean || clean.length < 5 || clean.startsWith("@") || clean.startsWith("/")) {
      return "";
    }

    // Ignore trivial queries (greetings, simple yes/no)
    if (/^(hi|hello|hey|ok|okay|hmm|haan|nahi|theek|suno|kya\s*haal|good\s*morning|good\s*night)\b/i.test(clean) && clean.length < 20) {
      return "";
    }

    try {
      const recalledPoints: string[] = [];

      // A. Vector Semantic Similarity Search (across archived past dialogues and notes)
      const vectorRes = await withTimeout(vectorMemoryService.searchSemanticMemory(clean, 4, 0.40), 2000, null).catch(() => null);
      if (vectorRes && vectorRes.results && vectorRes.results.length > 0) {
        for (const item of vectorRes.results) {
          const text = item.summary || item.snippet;
          if (text && !recalledPoints.some(p => p.toLowerCase().includes(text.toLowerCase().slice(0, 30)))) {
            recalledPoints.push(`[${item.dateRange || item.createdDateStr || "Past"}] ${text}`);
          }
        }
      }

      // B. Keyword-based matching in Personal Vault for high-precision entity hits
      const words = clean
        .toLowerCase()
        .replace(/[^\w\s\u0900-\u097F]/g, "")
        .split(/\s+/)
        .filter(w => w.length >= 3 && !["kya", "hai", "nahi", "raha", "hoga", "mera", "meri", "mere", "aaj", "kal", "bhi", "tha", "thi", "the"].includes(w));

      if (words.length > 0) {
        try {
          const vaultSnap = await withTimeout(vaultCol().limit(100).get(), 2000, { empty: true, docs: [] } as any).catch(() => ({ empty: true, docs: [] }));
          if (vaultSnap && !vaultSnap.empty && vaultSnap.docs) {
            for (const doc of vaultSnap.docs) {
              const data = doc.data();
              const factText = decryptData(data.exactFact || "");
              if (!factText) continue;
              const lowerFact = factText.toLowerCase();

              const matchCount = words.filter(w => lowerFact.includes(w)).length;
              if (matchCount >= 1) {
                if (!recalledPoints.some(p => p.toLowerCase().includes(factText.toLowerCase().slice(0, 30)))) {
                  recalledPoints.push(`[${data.category || "vault"} (${data.date || "Prior"})] ${factText}`);
                }
              }
            }
          }
        } catch {}

        // C. Match in Pinned Memories ("Yeh yaad rakhna" / lifelong facts)
        try {
          const pinnedSnap = await withTimeout(
            db.collection("memory").doc("pinnedMemories").collection("entries").orderBy("timestamp", "desc").limit(40).get(),
            2000,
            { empty: true, docs: [] } as any
          ).catch(() => ({ empty: true, docs: [] }));
          if (pinnedSnap && !pinnedSnap.empty && pinnedSnap.docs) {
            for (const doc of pinnedSnap.docs) {
              const data = doc.data();
              const factText = decryptData(data.fact || "");
              if (!factText) continue;
              const lowerFact = factText.toLowerCase();

              const matchCount = words.filter(w => lowerFact.includes(w)).length;
              if (matchCount >= 1) {
                if (!recalledPoints.some(p => p.toLowerCase().includes(factText.toLowerCase().slice(0, 30)))) {
                  recalledPoints.push(`[Pinned Memory (${data.date || "Prior"})] ${factText}`);
                }
              }
            }
          }
        } catch {}
      }

      // D. Contacts & Relationships Recall (Friends, Family, Loved Ones)
      const isRelationQuery = /\b(dost|friend|friends|yaari|mitra|bhai|brother|sister|behan|family|risht|girlfriend|gf|colleague|roommate|contact|contacts|kaun)\b/i.test(clean);
      try {
        const { contactsService } = await import("./contactsService");
        const allContacts = await withTimeout(contactsService.getAllContacts(), 2000, []).catch(() => []);
        
        for (const c of allContacts) {
          if (!c.name || c.id === "owner_default" || c.id === "temp") continue;
          const cNameLower = c.name.toLowerCase();
          const cRelLower = (c.relation || "").toLowerCase();

          let isMatch = false;
          if (isRelationQuery && c.relation) {
            if (/\b(dost|friend|friends|yaari|mitra)\b/i.test(clean) && /\b(dost|friend|friends|yaari|mitra|bestfriend|buddy)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (/\b(family|ghar|risht|brother|bhai|sister|behan|mummy|papa)\b/i.test(clean) && /\b(family|brother|bhai|sister|behan|mummy|papa|mother|father)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (/\b(girlfriend|gf|love|pyaar)\b/i.test(clean) && /\b(girlfriend|gf|partner)\b/i.test(cRelLower)) {
              isMatch = true;
            } else if (words.some(w => cRelLower.includes(w))) {
              isMatch = true;
            }
          }
          if (!isMatch && words.some(w => w.length >= 3 && (cNameLower.includes(w) || w.includes(cNameLower)))) {
            isMatch = true;
          }

          if (isMatch) {
            const relStr = c.relation ? ` (${c.relation})` : "";
            const point = `[Contacts Book] ${c.name}${relStr}: +${c.phone}`;
            if (!recalledPoints.some(p => p.toLowerCase().includes(c.name.toLowerCase()))) {
              recalledPoints.push(point);
            }
          }
        }
      } catch (cErr) {
        console.warn("[ChatGptMemoryEngine] Contacts recall warning:", cErr);
      }

      if (recalledPoints.length === 0) {
        return "";
      }

      // Format clean ChatGPT-like Memory Context (allow up to 8 points)
      return `\n🧠 [CHATGPT-STYLE LIFELONG MEMORY RECALL (RELEVANT PAST CONTEXT)]:
The following verified past memories from Boss DK directly relate to what he is saying right now:
${recalledPoints.slice(0, 8).map((p, idx) => `• ${p}`).join("\n")}

👉 CHATGPT INTUITION MANDATE:
- Naturally connect this past context in your response if appropriate (e.g. if Boss mentions visiting a city/doing something, and a past memory connects to it like his friend being there or his previous plan, bring it up affectionately and intelligently)!
- NEVER say robotic phrases like "As per my database", "According to stored memory", or "I searched my records". Speak naturally as a loyal companion who genuinely remembered!`;
    } catch (err) {
      console.warn("[ChatGptMemoryEngine] Recall error:", err);
      return "";
    }
  }

  /**
   * 2. LEARN PHASE (Post-Reply Background Worker):
   * Runs asynchronously in the background. Analyzes user statement and extracts long-term facts,
   * life events, relationships, habits, preferences, and locations into Firestore Vault + Vector DB.
   */
  public async learnFromMessageTurn(
    senderName: string,
    userText: string,
    botReplyText: string,
    channel: "whatsapp" | "telegram" | "web" = "whatsapp"
  ): Promise<void> {
    const cleanUser = (userText || "").trim();
    if (!cleanUser || cleanUser.length < 12) return;

    // Filter out commands or bot interactions
    if (cleanUser.startsWith("@") || cleanUser.startsWith("/") || cleanUser.startsWith("http")) return;

    // Filter out simple queries
    if (/^(play|bajao|search|kya|kaun|kab|kahan|weather|mausam|news|khabar|joke|shayari|calculate)\b/i.test(cleanUser) && !cleanUser.includes("mera") && !cleanUser.includes("meri") && !cleanUser.includes("dost") && !cleanUser.includes("hum") && !cleanUser.includes("mujhe")) {
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const extractionPrompt = `You are Friday AI's silent lifelong memory extractor (matching ChatGPT's continuous memory engine).
Analyze this statement from user Boss DK:
<statement>
"${cleanUser}"
</statement>
(Assistant reply for context: "${(botReplyText || "").slice(0, 150)}")

TASK:
Determine if this statement contains any enduring facts about Boss DK, his family, friends, relationships, travels, locations, health, preferences, work, or personal life that a smart assistant should remember forever (even 1 year later).

EXAMPLES OF WHAT TO EXTRACT:
- "Mera dost Rahul Patna gaya hai" -> hasFact: true, category: "friends_and_relations", fact: "DK ka dost Rahul Patna gaya hua hai.", keywords: ["rahul", "dost", "patna"]
- "Mujhe cold coffee bahut pasand hai" -> hasFact: true, category: "personal_preferences", fact: "DK ko cold coffee pasand hai.", keywords: ["coffee", "cold coffee"]
- "Mummy ki tabiyat theek nahi hai" -> hasFact: true, category: "lifestyle_and_health", fact: "DK ki mummy ki tabiyat kharab thi.", keywords: ["mummy", "tabiyat", "health"]
- "Main kal Delhi jaunga meeting ke liye" -> hasFact: true, category: "plans_and_travel", fact: "DK meeting ke liye Delhi jaane ka plan tha.", keywords: ["delhi", "meeting", "travel"]

EXAMPLES OF WHAT NOT TO EXTRACT (hasFact: false):
- "Acha theek hai", "Gaana bajao", "Mausam kaisa hai", "Kya chal raha hai", "Hahaha mast joke tha", "Code theek karo".

RETURN ONLY VALID JSON matching this exact schema:
{
  "hasFact": true or false,
  "category": "friends_and_relations | plans_and_travel | personal_preferences | lifestyle_and_health | career_and_business | general_personal_info",
  "fact": "Clear, concise fact in natural Hinglish or English describing the state or event.",
  "keywords": ["list", "of", "searchable", "keywords"]
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
        const parsed: ExtractedFactPayload = JSON.parse(rawJson);

        if (parsed && parsed.hasFact && parsed.fact && parsed.fact.trim()) {
          const cleanFact = parsed.fact.trim();
          const factKey = cleanFact.toLowerCase();

          // Deduplicate in memory
          if (this.recentFactCache.has(factKey)) return;
          this.recentFactCache.add(factKey);
          if (this.recentFactCache.size > 200) {
            const oldest = Array.from(this.recentFactCache).slice(0, 50);
            oldest.forEach(k => this.recentFactCache.delete(k));
          }

          const category = parsed.category || "general_personal_info";
          const now = Date.now();
          const dateStr = new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

          // 1. Add to Personal Vault in memoryEngine
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
              source: "chatgpt_auto_memory",
            },
          });

          console.log(`[ChatGPTMemory] 🧠✨ Learned lifelong fact [${category}]: "${cleanFact}" (Channel: ${channel})`);
        }
        return; // Success, stop trying models
      } catch (err: any) {
        // Try fallback model
      }
    }
  }
}

export const chatGptMemoryEngine = new ChatGptMemoryEngine();
