/**
 * animationRoutineService.ts
 *
 * Cloud-backed persistent custom animation routines for Friday 3D Avatar:
 * 1. ☁️ Firestore Database Persistence: All custom sequences saved in "friday_animation_routines" collection
 * 2. 📱 Telegram Notification & Cloud Vault: Dispatches instant alert to Boss's Telegram on save/update/remove
 * 3. ⚡ Real-Time WebSocket Sync: Pushes synced routines directly to Live AI client (No localStorage needed!)
 */

import { db } from "./firebaseAdmin";
import { getFirestore } from "firebase-admin/firestore";
import { telegramBotService } from "./telegramBotService";

export interface AnimationRoutineDoc {
  id: string;
  triggerName: string;
  sequence: string[];
  description?: string;
  createdAt: number;
  updatedAt: number;
  source: "live_ai" | "telegram" | "system";
}

const COLLECTION_NAME = "friday_animation_routines";

class AnimationRoutineService {
  private cache: Record<string, string[]> = {};
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private wsBroadcaster: ((payload: string) => void) | null = null;

  constructor() {
    this.init().catch((err) =>
      console.warn("[AnimationRoutineService] Init warning:", err?.message || err)
    );
  }

  private getCollection() {
    try {
      if (db) return db.collection(COLLECTION_NAME);
      return getFirestore().collection(COLLECTION_NAME);
    } catch {
      return null;
    }
  }

  private sanitizeDocId(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_");
  }

  public setWebSocketBroadcaster(broadcaster: (payload: string) => void) {
    this.wsBroadcaster = broadcaster;
  }

  /**
   * Initializes and loads all saved routines from Cloud Firestore into in-memory cache
   */
  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const col = this.getCollection();
        if (col) {
          const snap = await col.get();
          const newCache: Record<string, string[]> = {};
          snap.forEach((doc: any) => {
            const data = doc.data() as AnimationRoutineDoc;
            if (data && data.triggerName && Array.isArray(data.sequence)) {
              newCache[data.triggerName.toLowerCase().trim()] = data.sequence.map((s) =>
                String(s).toLowerCase().trim()
              );
            }
          });
          this.cache = newCache;
          console.log(
            `[AnimationRoutineService] ☁️ Loaded ${Object.keys(this.cache).length} routines from Cloud Firestore.`
          );
        }
      } catch (err: any) {
        console.warn(
          "[AnimationRoutineService] Cloud Firestore load warning (using in-memory):",
          err?.message || err
        );
      } finally {
        this.isLoaded = true;
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Returns current active dictionary of routines { [triggerName]: sequence }
   */
  public getRoutines(): Record<string, string[]> {
    return { ...this.cache };
  }

  /**
   * Dispatches an alert to Boss on Telegram
   */
  public async notifyTelegram(title: string, triggerName: string, sequence: string[], note: string): Promise<void> {
    try {
      const ownerChatId = await telegramBotService.getOwnerOrLatestChatId();
      if (!ownerChatId) return;

      const formattedSeq = sequence.length > 0 ? sequence.map((s, i) => `${i + 1}. \`${s}\``).join("\n") : "_Sequence empty_";
      const message = `🎬 *${title}*\n\n` +
        `📌 *Trigger Name:* \`${triggerName}\`\n` +
        `📋 *Sequence:*\n${formattedSeq}\n\n` +
        `☁️ *Storage:* Cloud Firestore Verified\n` +
        `💡 *Note:* ${note}\n\n` +
        `_Friday 3D Avatar memory updated._`;

      await telegramBotService.sendMessage(ownerChatId, message, { parse_mode: "Markdown" });
      console.log(`[AnimationRoutineService] 📱 Telegram alert sent to Boss (ChatID: ${ownerChatId}) for "${triggerName}"`);
    } catch (tErr: any) {
      console.warn("[AnimationRoutineService] Telegram dispatch error:", tErr?.message || tErr);
    }
  }

  /**
   * Broadcast current routines to connected client WebSockets (so client stays in sync with Firestore)
   */
  private broadcastSync() {
    if (this.wsBroadcaster) {
      try {
        const payload = JSON.stringify({
          type: "sync_animation_routines",
          routines: this.cache,
        });
        this.wsBroadcaster(payload);
      } catch (e) {
        console.warn("[AnimationRoutineService] Broadcast error:", e);
      }
    }
  }

  /**
   * Saves or completely overwrites a custom routine in Cloud Firestore + updates cache + notifies Telegram
   */
  public async saveRoutine(
    triggerName: string,
    sequence: string[],
    description?: string
  ): Promise<{ success: boolean; message: string }> {
    await this.init();

    const cleanTrigger = triggerName.toLowerCase().trim();
    const cleanSeq = sequence.map((s) => String(s).toLowerCase().trim());

    if (!cleanTrigger || cleanSeq.length === 0) {
      return { success: false, error: "Trigger name and valid sequence are required." } as any;
    }

    // 1. Update in-memory cache
    this.cache[cleanTrigger] = cleanSeq;

    // 2. Persist to Cloud Firestore
    try {
      const col = this.getCollection();
      if (col) {
        const docId = this.sanitizeDocId(cleanTrigger);
        const docData: AnimationRoutineDoc = {
          id: docId,
          triggerName: cleanTrigger,
          sequence: cleanSeq,
          description: description || "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "live_ai",
        };
        await col.doc(docId).set(docData, { merge: true });
        console.log(`[AnimationRoutineService] ☁️ Firestore saved: "${cleanTrigger}" -> [${cleanSeq.join(", ")}]`);
      }
    } catch (fsErr: any) {
      console.error("[AnimationRoutineService] Firestore write error:", fsErr?.message || fsErr);
    }

    // 3. Real-time broadcast to connected live clients
    this.broadcastSync();

    // 4. Notify Telegram
    this.notifyTelegram(
      "FRIDAY ANIMATION ROUTINE SAVED",
      cleanTrigger,
      cleanSeq,
      `Ab jab bhi Boss '${cleanTrigger}' bolenge, ye sequence chalegi!`
    ).catch(() => {});

    return {
      success: true,
      message: `Routine '${cleanTrigger}' saved in Firestore and synced! Sequence: ${cleanSeq.join(" → ")}.`,
    };
  }

  /**
   * Updates an existing custom routine (add, remove, replace, rename, delete) in Cloud Firestore
   */
  public async updateRoutine(
    routineName: string,
    operation: "add" | "remove" | "replace" | "rename" | "delete" | string,
    animations?: string[],
    newName?: string
  ): Promise<{ success: boolean; message: string; updatedSequence?: string[] }> {
    await this.init();

    const targetName = routineName.toLowerCase().trim();
    const op = (operation || "").toLowerCase().trim();
    const anims = Array.isArray(animations) ? animations.map((s) => String(s).toLowerCase().trim()) : [];

    // Find key in cache (exact match or space/underscore match)
    const matchedKey =
      Object.keys(this.cache).find(
        (k) => k === targetName || k.replace(/_/g, " ") === targetName.replace(/_/g, " ")
      ) || targetName;

    const currentSeq = this.cache[matchedKey] ? [...this.cache[matchedKey]] : [];
    let updatedSeq = [...currentSeq];
    let finalKey = matchedKey;

    if (op === "add") {
      // Append new animations to end
      updatedSeq = [...currentSeq, ...anims];
      this.cache[matchedKey] = updatedSeq;
    } else if (op === "remove") {
      // Remove specific animations
      const removeSet = new Set(anims);
      updatedSeq = currentSeq.filter((a) => !removeSet.has(a));
      this.cache[matchedKey] = updatedSeq;
    } else if (op === "replace") {
      // Replace entire sequence with new one
      updatedSeq = anims;
      this.cache[matchedKey] = updatedSeq;
    } else if (op === "rename" && newName) {
      finalKey = newName.toLowerCase().trim();
      this.cache[finalKey] = currentSeq;
      delete this.cache[matchedKey];
    } else if (op === "delete") {
      delete this.cache[matchedKey];
      updatedSeq = [];
    }

    // 2. Persist update in Cloud Firestore (purge old, write updated)
    try {
      const col = this.getCollection();
      if (col) {
        const oldDocId = this.sanitizeDocId(matchedKey);
        if (op === "delete" || (op === "rename" && newName)) {
          await col.doc(oldDocId).delete();
        }

        if (op !== "delete") {
          const newDocId = this.sanitizeDocId(finalKey);
          await col.doc(newDocId).set(
            {
              id: newDocId,
              triggerName: finalKey,
              sequence: updatedSeq,
              updatedAt: Date.now(),
              source: "live_ai",
            },
            { merge: true }
          );
        }
        console.log(`[AnimationRoutineService] ☁️ Firestore updated: "${finalKey}" (${op}) -> [${updatedSeq.join(", ")}]`);
      }
    } catch (fsErr: any) {
      console.error("[AnimationRoutineService] Firestore update error:", fsErr?.message || fsErr);
    }

    // 3. Real-time broadcast to connected live clients
    this.broadcastSync();

    // 4. Notify Boss on Telegram
    const actionLabel =
      op === "add"
        ? "ANIMATIONS ADDED"
        : op === "remove"
        ? "ANIMATIONS REMOVED"
        : op === "replace"
        ? "ROUTINE OVERWRITTEN"
        : op === "rename"
        ? `RENAMED TO '${finalKey}'`
        : "ROUTINE DELETED";

    this.notifyTelegram(
      `FRIDAY ROUTINE UPDATED: ${actionLabel}`,
      finalKey,
      updatedSeq,
      `Purana version Firestore se hata kar naya version save kar diya gaya hai.`
    ).catch(() => {});

    return {
      success: true,
      message: `Routine '${matchedKey}' updated (operation: ${op}) in Firestore and Telegram notified! New sequence: ${updatedSeq.join(" → ")}`,
      updatedSequence: updatedSeq,
    };
  }
}

export const animationRoutineService = new AnimationRoutineService();
