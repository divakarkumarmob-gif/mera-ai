/**
 * dialogueStateTrackerService.ts
 * 
 * Industry-grade Dialogue State Tracking (DST), Active Entity Stack, 
 * and Query Rewriting / Co-reference Resolution Service for Friday AI.
 * 
 * Tracks in-focus media, referenced persons, tasks, and resolves ambiguous 
 * anaphora pronouns ("isko", "usko", "ye", "wo") across multi-turn chats.
 */

import { visionMemoryService } from "./visionMemoryService";

export interface ActiveEntity {
  type: "media" | "person" | "task" | "location" | "action";
  label: string;
  description?: string;
  data?: any;
  timestamp: number;
}

export interface ActiveDialogueState {
  chatId: string;
  entities: ActiveEntity[];
  lastTopic?: string;
  lastUserQuery?: string;
  lastBotResponse?: string;
  updatedAt: number;
}

export class DialogueStateTrackerService {
  private states = new Map<string, ActiveDialogueState>();
  private readonly MAX_ENTITIES_PER_CHAT = 8;
  private readonly ENTITY_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

  private normalizeChatId(chatId: string): string {
    return (chatId || "").trim().toLowerCase();
  }

  private getOrCreateState(chatId: string): ActiveDialogueState {
    const key = this.normalizeChatId(chatId);
    let state = this.states.get(key);
    if (!state) {
      state = {
        chatId: key,
        entities: [],
        updatedAt: Date.now(),
      };
      this.states.set(key, state);
    }
    return state;
  }

  // ── 1. Dialogue State Tracking (DST) & Active Entity Stack ─────────────────

  public pushEntity(chatId: string, entity: Omit<ActiveEntity, "timestamp"> & { timestamp?: number }): void {
    if (!chatId || !entity || !entity.label) return;
    const state = this.getOrCreateState(chatId);
    const now = entity.timestamp || Date.now();

    // Deduplicate existing identical entity
    state.entities = state.entities.filter(
      (e) => !(e.type === entity.type && e.label.toLowerCase() === entity.label.toLowerCase())
    );

    state.entities.unshift({
      ...entity,
      timestamp: now,
    });

    if (state.entities.length > this.MAX_ENTITIES_PER_CHAT) {
      state.entities = state.entities.slice(0, this.MAX_ENTITIES_PER_CHAT);
    }

    state.updatedAt = now;
  }

  public recordBotTurn(chatId: string, botText: string): void {
    if (!chatId || !botText) return;
    const state = this.getOrCreateState(chatId);
    state.lastBotResponse = botText;
    state.updatedAt = Date.now();

    // If bot responded with an analysis of homework / document / photo, extract entity
    if (/homework|science|page|routine|timetable|table/i.test(botText)) {
      const summaryMatch = botText.match(/Summary for Boss.*?:\s*([^\n\r]+)/i);
      const label = summaryMatch ? summaryMatch[1].slice(0, 80) : "Scanned Homework / Document";
      this.pushEntity(chatId, {
        type: "media",
        label,
        description: botText.slice(0, 300),
      });
    }
  }

  public recordUserTurn(chatId: string, userText: string): void {
    if (!chatId || !userText) return;
    const state = this.getOrCreateState(chatId);
    state.lastUserQuery = userText;
    state.updatedAt = Date.now();
  }

  public getActiveEntities(chatId: string): ActiveEntity[] {
    const state = this.getOrCreateState(chatId);
    const now = Date.now();

    // Filter out expired entities
    state.entities = state.entities.filter((e) => now - e.timestamp < this.ENTITY_EXPIRY_MS);

    // Also pull latest media context from visionMemoryService if not already in stack
    const mediaContext = visionMemoryService.getChatMediaContext(chatId);
    if (mediaContext && now - mediaContext.timestamp < this.ENTITY_EXPIRY_MS) {
      const alreadyHasMedia = state.entities.some((e) => e.type === "media" && now - e.timestamp < 10 * 60 * 1000);
      if (!alreadyHasMedia) {
        const label = mediaContext.shortSummary || mediaContext.fileName || "Scanned Photo / Document";
        state.entities.unshift({
          type: "media",
          label,
          description: mediaContext.analysis?.slice(0, 300) || mediaContext.caption,
          timestamp: mediaContext.timestamp,
        });
      }
    }

    return state.entities;
  }

  public getTopEntity(chatId: string, type?: ActiveEntity["type"]): ActiveEntity | null {
    const list = this.getActiveEntities(chatId);
    if (type) {
      return list.find((e) => e.type === type) || null;
    }
    return list[0] || null;
  }

  // ── 2. Format Context for LLM System Prompt ────────────────────────────────

  public formatStateForPrompt(chatId: string): string {
    const entities = this.getActiveEntities(chatId);
    const state = this.getOrCreateState(chatId);

    const lines: string[] = [];
    if (entities.length > 0) {
      lines.push("ACTIVE IN-FOCUS ENTITIES (Stack):");
      for (const ent of entities.slice(0, 4)) {
        const ageSec = Math.round((Date.now() - ent.timestamp) / 1000);
        const ageStr = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
        lines.push(`• [${ent.type.toUpperCase()}] "${ent.label}" (${ageStr})${ent.description ? ` - ${ent.description.slice(0, 120)}` : ""}`);
      }
    }

    if (state.lastBotResponse) {
      lines.push(`LAST BOT RESPONSE: "${state.lastBotResponse.slice(0, 200).replace(/\n/g, " ")}"`);
    }

    return lines.join("\n");
  }

  // ── 3. Query Rewriting & Co-reference Resolution ──────────────────────────

  /**
   * Resolves ambiguous referential pronouns ("isko", "usko", "ye", "wo", "ise", "unhe", "it", "this")
   * into fully-qualified unambiguous user intents.
   */
  public rewriteQueryWithContext(
    userText: string,
    chatId: string,
    quotedText?: string
  ): { rewrittenText: string; isRewritten: boolean; resolvedEntity?: ActiveEntity | null } {
    const raw = (userText || "").trim();
    if (!raw) return { rewrittenText: raw, isRewritten: false };

    // Regex matching Hindi / English referential pronouns
    const referenceRegex = /\b(isko|usko|ise|inhe|unhe|unko|ye\s*wala|yeh\s*wala|ye|yeh|wo|woh|this|that|it)\b/i;
    if (!referenceRegex.test(raw)) {
      return { rewrittenText: raw, isRewritten: false };
    }

    // Step A: Check Quoted Message first (Direct Reply Reference)
    if (quotedText && quotedText.trim().length > 3) {
      const cleanQuote = quotedText.replace(/\n/g, " ").slice(0, 100).trim();
      const rewritten = raw.replace(
        referenceRegex,
        `[${cleanQuote}]`
      );
      return {
        rewrittenText: rewritten,
        isRewritten: true,
        resolvedEntity: {
          type: "task",
          label: cleanQuote,
          timestamp: Date.now(),
        },
      };
    }

    // Step B: Check Active Entity Stack (DST In-Focus Stack)
    const topEntity = this.getTopEntity(chatId);
    if (topEntity && topEntity.label) {
      const rewritten = raw.replace(
        referenceRegex,
        `"${topEntity.label}"`
      );
      return {
        rewrittenText: rewritten,
        isRewritten: true,
        resolvedEntity: topEntity,
      };
    }

    // Step C: Fallback to Vision Media Context
    const media = visionMemoryService.getChatMediaContext(chatId);
    if (media) {
      const mediaLabel = media.shortSummary || "Scanned Photo / Document";
      const rewritten = raw.replace(
        referenceRegex,
        `"${mediaLabel}"`
      );
      return {
        rewrittenText: rewritten,
        isRewritten: true,
        resolvedEntity: {
          type: "media",
          label: mediaLabel,
          description: media.analysis?.slice(0, 150),
          timestamp: media.timestamp,
        },
      };
    }

    return { rewrittenText: raw, isRewritten: false };
  }
}

export const dialogueStateTrackerService = new DialogueStateTrackerService();
