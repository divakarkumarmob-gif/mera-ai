/**
 * Story Continuity & Open Loop Tracking Engine for Friday AI
 * 
 * Tracks unfinished storylines, ongoing projects, exams, doctor visits, coding milestones,
 * and unresolved topics across days, allowing Friday to naturally follow up like a real friend.
 */

import { db } from "./firebaseAdmin";

export interface OpenStoryLoop {
  id?: string;
  topic: string;
  context: string;
  category: "work" | "health" | "personal" | "learning" | "relationship";
  createdAt: number;
  lastDiscussedAt: number;
  status: "open" | "resolved" | "archived";
  followUpSuggestion?: string;
}

export class StoryContinuityEngine {
  private static instance: StoryContinuityEngine;
  private memoryLoops: OpenStoryLoop[] = [];

  private constructor() {}

  public static getInstance(): StoryContinuityEngine {
    if (!StoryContinuityEngine.instance) {
      StoryContinuityEngine.instance = new StoryContinuityEngine();
    }
    return StoryContinuityEngine.instance;
  }

  /**
   * Records a new open loop or unresolved storyline.
   */
  public async recordOpenLoop(
    topic: string,
    context: string,
    category: "work" | "health" | "personal" | "learning" | "relationship" = "work"
  ): Promise<void> {
    const loop: OpenStoryLoop = {
      topic: topic.trim(),
      context: context.trim(),
      category,
      createdAt: Date.now(),
      lastDiscussedAt: Date.now(),
      status: "open",
    };

    try {
      if (db) {
        await db.collection("openStoryLoops").add(loop);
      }
      this.memoryLoops.unshift(loop);
      if (this.memoryLoops.length > 20) {
        this.memoryLoops.pop();
      }
    } catch (err) {
      console.warn("[StoryContinuityEngine] Failed to save open loop:", err);
      this.memoryLoops.unshift(loop);
    }
  }

  /**
   * Retrieves all active open loops.
   */
  public async getActiveOpenLoops(limit: number = 5): Promise<OpenStoryLoop[]> {
    try {
      if (db) {
        const snap = await db
          .collection("openStoryLoops")
          .where("status", "==", "open")
          .get();

        if (!snap.empty) {
          const loops = snap.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as OpenStoryLoop),
          }));
          loops.sort((a, b) => (b.lastDiscussedAt || 0) - (a.lastDiscussedAt || 0));
          return loops.slice(0, limit);
        }
      }
    } catch (err) {
      console.warn("[StoryContinuityEngine] Firestore read failed, falling back to cache:", err);
    }

    return this.memoryLoops.filter((l) => l.status === "open").slice(0, limit);
  }

  /**
   * Marks an open loop as resolved.
   */
  public async resolveOpenLoop(topicOrId: string): Promise<boolean> {
    try {
      if (db) {
        const snap = await db.collection("openStoryLoops").get();
        for (const doc of snap.docs) {
          const data = doc.data() as OpenStoryLoop;
          if (doc.id === topicOrId || data.topic.toLowerCase().includes(topicOrId.toLowerCase())) {
            await doc.ref.update({ status: "resolved", resolvedAt: Date.now() });
            return true;
          }
        }
      }
      const item = this.memoryLoops.find((l) => l.topic.toLowerCase().includes(topicOrId.toLowerCase()));
      if (item) {
        item.status = "resolved";
        return true;
      }
    } catch (err) {
      console.warn("[StoryContinuityEngine] Failed to resolve loop:", err);
    }
    return false;
  }

  /**
   * Compiles story continuity context to inject into LLM system prompts.
   */
  public async compileStoryContinuityPrompt(): Promise<string> {
    const loops = await this.getActiveOpenLoops(4);
    if (!loops || loops.length === 0) {
      return "";
    }

    const formatted = loops
      .map(
        (l) =>
          `• [${l.category.toUpperCase()}] "${l.topic}": ${l.context} (Mentioned: ${new Date(
            l.lastDiscussedAt
          ).toLocaleDateString("en-IN")})`
      )
      .join("\n");

    return `📖 ONGOING LIFE STORIES & UNFINISHED OPEN LOOPS (Human Follow-up Context):
${formatted}
*Instruction: If relevant to the current conversation, you may naturally refer back to or gently ask about these ongoing situations like a close human friend would. Do not force them if Boss is focused on something else.*`;
  }
}

export const storyContinuityEngine = StoryContinuityEngine.getInstance();
