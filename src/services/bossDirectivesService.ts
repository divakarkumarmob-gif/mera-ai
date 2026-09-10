import { getFirestore } from "firebase-admin/firestore";

export type BossDirectiveType = "word_replacement" | "behavior_rule" | "strict_order";

export interface BossDirective {
  id: string;
  rule: string;
  type: BossDirectiveType;
  targetWord?: string;
  replacementWord?: string;
  isAnchor?: boolean;       // Elastic Memory Anchor (Immune to forgetting)
  anchorPriority?: number;  // 1 to 100 (100 = foundational absolute rule)
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

const COLLECTION_NAME = "boss_directives";

class BossDirectivesService {
  private cache: BossDirective[] = [];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private getCollection() {
    return getFirestore().collection(COLLECTION_NAME);
  }

  /**
   * Initializes and loads active directives from Firestore into local memory cache
   */
  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const snap = await this.getCollection().where("isActive", "==", true).get();
        this.cache = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        this.isLoaded = true;
        console.log(`[BossDirectives] Loaded ${this.cache.length} active directives from Firestore.`);
      } catch (e: any) {
        console.warn("[BossDirectives] Firestore load error (running with memory cache):", e?.message || e);
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Adds or updates a strict Boss directive or word-replacement placeholder
   */
  public async addDirective(
    rule: string,
    options?: {
      targetWord?: string;
      replacementWord?: string;
      type?: BossDirectiveType;
      isAnchor?: boolean;
      anchorPriority?: number;
    }
  ): Promise<BossDirective> {
    await this.init();

    const cleanRule = rule.trim();
    let targetWord = options?.targetWord?.trim();
    let replacementWord = options?.replacementWord?.trim();
    let type: BossDirectiveType = options?.type || "strict_order";

    // Auto-detect word replacement syntax (e.g. "aaj se tum mango ko frooti bologe", "mango ko frooti bolo")
    if (!targetWord || !replacementWord) {
      const match =
        cleanRule.match(/(?:aaj\s+se\s+)?(?:tum\s+)?([a-zA-Z0-9\u0900-\u097F]+)\s+ko\s+([a-zA-Z0-9\u0900-\u097F]+)\s+(?:bologe|bolna|samjhoge|kaho|kahna)/i) ||
        cleanRule.match(/(?:replace|call|name)\s+([a-zA-Z0-9]+)\s+(?:with|as|to)\s+([a-zA-Z0-9]+)/i);

      if (match) {
        targetWord = match[1].trim();
        replacementWord = match[2].trim();
        type = "word_replacement";
      }
    }

    const id = targetWord && replacementWord
      ? `replace_${targetWord.toLowerCase().replace(/\s+/g, "_")}`
      : `directive_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const directive: BossDirective = {
      id,
      rule: cleanRule,
      type: targetWord && replacementWord ? "word_replacement" : type,
      targetWord,
      replacementWord,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Update in-memory cache
    this.cache = this.cache.filter((d) => d.id !== id);
    this.cache.push(directive);

    // Persist to Firestore
    try {
      await this.getCollection().doc(id).set(directive, { merge: true });
      console.log(`[BossDirectives] Saved directive ${id}: "${cleanRule}"`);
    } catch (e: any) {
      console.warn(`[BossDirectives] Failed to persist directive to Firestore:`, e?.message || e);
    }

    return directive;
  }

  /**
   * Removes or deactivates a directive by keyword, target word, or ID
   */
  public async removeDirective(query: string): Promise<{ success: boolean; removed: BossDirective[]; message: string }> {
    await this.init();

    const cleanQuery = query.trim().toLowerCase();

    // Auto-extract target word from phrases like "mango ko abb fruti nhi bolna h", "mango wala rule hata do"
    let searchKey = cleanQuery;
    const wordExtractMatch =
      cleanQuery.match(/([a-zA-Z0-9\u0900-\u097F]+)\s+ko\s+(?:abb\s+|ab\s+)?(?:fruti|frooti|[a-zA-Z0-9\u0900-\u097F]+)?\s*(?:nhi|mat|nahi)\s+(?:bolna|bologe|kaho)/i) ||
      cleanQuery.match(/([a-zA-Z0-9\u0900-\u097F]+)\s+(?:wala|wali|ka)\s+rule\s+(?:hata|delete|remove|cancel)/i);

    if (wordExtractMatch) {
      searchKey = wordExtractMatch[1].trim().toLowerCase();
    }

    const toRemove = this.cache.filter((d) => {
      if (d.id.toLowerCase() === cleanQuery) return true;
      if (d.targetWord && d.targetWord.toLowerCase() === searchKey) return true;
      if (d.replacementWord && d.replacementWord.toLowerCase() === searchKey) return true;
      if (d.rule.toLowerCase().includes(searchKey)) return true;
      return false;
    });

    if (toRemove.length === 0) {
      // If user said "saare rules hata do" / "clear all"
      if (/all|saare|sare|reset|sab/i.test(cleanQuery)) {
        const allRemoved = [...this.cache];
        this.cache = [];
        for (const d of allRemoved) {
          try {
            await this.getCollection().doc(d.id).update({ isActive: false, updatedAt: Date.now() });
          } catch {}
        }
        return {
          success: true,
          removed: allRemoved,
          message: `Boss, maine saare (${allRemoved.length}) active directives aur word rules remove kar diye hain! Sab normal ho gaya hai.`,
        };
      }

      return {
        success: false,
        removed: [],
        message: `Boss, "${query}" se related koi active directive ya word rule nahi mila.`,
      };
    }

    const removedIds = new Set(toRemove.map((d) => d.id));
    this.cache = this.cache.filter((d) => !removedIds.has(d.id));

    // Update in Firestore
    for (const d of toRemove) {
      try {
        await this.getCollection().doc(d.id).update({ isActive: false, updatedAt: Date.now() });
      } catch (e: any) {
        console.warn(`[BossDirectives] Could not update Firestore for ${d.id}:`, e?.message || e);
      }
    }

    const labels = toRemove.map((d) => d.targetWord && d.replacementWord ? `"${d.targetWord}" -> "${d.replacementWord}"` : `"${d.rule}"`).join(", ");
    return {
      success: true,
      removed: toRemove,
      message: `Theek hai Boss! Maine rule (${labels}) hata diya hai. Ab se normal bolungi!`,
    };
  }

  /**
   * Retrieves all currently active directives
   */
  public async getActiveDirectives(): Promise<BossDirective[]> {
    await this.init();
    return this.cache.filter((d) => d.isActive);
  }

  /**
   * Compiles active directives into a high-priority system prompt injection block
   */
  public async compileDirectivesPrompt(): Promise<string> {
    const active = await this.getActiveDirectives();
    if (active.length === 0) return "";

    const lines = active.map((d, index) => {
      if (d.type === "word_replacement" && d.targetWord && d.replacementWord) {
        return `  ${index + 1}. [STRICT WORD REPLACEMENT]: Whenever referring to or encountering "${d.targetWord}", you MUST strictly say and write "${d.replacementWord}". Do NOT use "${d.targetWord}" in your output!`;
      }
      return `  ${index + 1}. [STRICT BOSS ORDER]: ${d.rule}`;
    });

    return `\n\n⚡⚡⚡ CRITICAL MANDATORY BOSS DIRECTIVES (HIGHEST PRIORITY - ZERO VIOLATION PERMITTED) ⚡⚡⚡
Boss DK has explicitly trained and commanded you to strictly follow these active directives:
${lines.join("\n")}
You MUST strictly obey all the above directives in EVERY single response without exception or hallucination!\n`;
  }

  /**
   * Zero-bypass text transformer: applies word replacements across any output text
   * to ensure that even if the LLM forgets, the directive is 100% enforced!
   */
  public applyWordReplacements(text: string): string {
    if (!text || this.cache.length === 0) return text;

    let modified = text;
    for (const d of this.cache) {
      if (d.isActive && d.type === "word_replacement" && d.targetWord && d.replacementWord) {
        try {
          // Case-insensitive word boundary replacement preserving common punctuation
          const regex = new RegExp(`\\b${escapeRegExp(d.targetWord)}\\b`, "gi");
          modified = modified.replace(regex, (match) => {
            // Preserve capitalization if first letter was capitalized
            if (match[0] === match[0].toUpperCase()) {
              return d.replacementWord!.charAt(0).toUpperCase() + d.replacementWord!.slice(1);
            }
            return d.replacementWord!;
          });
        } catch {}
      }
    }
    return modified;
  }

  /**
   * Detects if user message contains an explicit rule creation or deletion command
   */
  public parseDirectiveCommand(messageText: string): {
    isDirectiveCommand: boolean;
    action?: "add" | "remove" | "list";
    targetWord?: string;
    replacementWord?: string;
    ruleText?: string;
  } {
    const text = (messageText || "").trim();

    // 1. Check for Rule Removal / Cancellation
    const removeMatch =
      text.match(/(?:abb\s+|ab\s+)?([a-zA-Z0-9\u0900-\u097F]+)\s+ko\s+(?:abb\s+|ab\s+)?([a-zA-Z0-9\u0900-\u097F]+)?\s*(?:nhi|mat|nahi)\s+(?:bolna|bologe|kaho)/i) ||
      text.match(/([a-zA-Z0-9\u0900-\u097F]+)\s+(?:wala|wali|ka)\s+rule\s+(?:hata\s+do|delete\s+karo|remove\s+karo|cancel\s+karo|hatao)/i) ||
      text.match(/(?:rule|directive|placeholder)\s+(?:hata\s+do|remove\s+karo|delete\s+karo|cancel\s+karo)\s*:\s*(.+)/i);

    if (removeMatch) {
      const target = removeMatch[1] || removeMatch[3] || text;
      return {
        isDirectiveCommand: true,
        action: "remove",
        targetWord: target.trim(),
        ruleText: text,
      };
    }

    // 2. Check for Word Replacement / Alias Command
    const addWordMatch =
      text.match(/(?:aaj\s+se\s+)?(?:tum\s+)?([a-zA-Z0-9\u0900-\u097F]+)\s+ko\s+([a-zA-Z0-9\u0900-\u097F]+)\s+(?:bologe|bolna|samjhoge|kaho|kahna)/i) ||
      text.match(/(?:aaj\s+se\s+)?([a-zA-Z0-9\u0900-\u097F]+)\s*=\s*([a-zA-Z0-9\u0900-\u097F]+)/i);

    if (addWordMatch) {
      return {
        isDirectiveCommand: true,
        action: "add",
        targetWord: addWordMatch[1].trim(),
        replacementWord: addWordMatch[2].trim(),
        ruleText: text,
      };
    }

    // 3. Check for Strict Behavior Rule Command
    const addRuleMatch =
      text.match(/(?:aaj\s+se\s+ye\s+rule\s+(?:hai|yaad\s+rakho|follow\s+karo)|mera\s+order\s+hai\s+ki|strict\s+rule\s*:)\s*(.+)/i);

    if (addRuleMatch) {
      return {
        isDirectiveCommand: true,
        action: "add",
        ruleText: addRuleMatch[1].trim(),
      };
    }

    // 4. Check for List Rules Command
    if (/(?:saare|sare|active)\s+(?:rules|directives|orders)\s+(?:dikhao|batao|list)/i.test(text)) {
      return {
        isDirectiveCommand: true,
        action: "list",
        ruleText: text,
      };
    }

    return { isDirectiveCommand: false };
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const bossDirectivesService = new BossDirectivesService();
