import * as BaileysModule from "@whiskeysockets/baileys";
import { db } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Firestore-backed auth state for Baileys, replacing useMultiFileAuthState.
//
// Optimized for Render Free Plan (512MB RAM) & Firebase Free Spark Quota:
// 1. Ephemeral signal protocol keys (sender-key-memory) stay in RAM only.
// 2. Persistent keys are debounced & written using atomic db.batch().
// 3. In-memory hot cache is bounded (max 3,000 items) to prevent memory leaks.
// 4. saveCreds is debounced to avoid rapid redundant document writes.
// ---------------------------------------------------------------------------

const baileys: any = BaileysModule;
const initAuthCreds = baileys.initAuthCreds || baileys.default?.initAuthCreds;
const BufferJSON = baileys.BufferJSON || baileys.default?.BufferJSON;

const authRootDoc = () => db.collection("whatsapp_auth").doc("session");
const credsDoc = () => authRootDoc().collection("meta").doc("creds");
const keysCol = (type: string) => authRootDoc().collection("keys").doc(type).collection("items");

// Ephemeral keys that are purely transient replay-guards. Baileys recreates them
// cleanly in memory on boot. Writing them to Firestore on every message burns thousands of writes.
const EPHEMERAL_KEY_TYPES = new Set(["sender-key-memory"]);

/** Serialize a value using Baileys' BufferJSON replacer (handles Buffer/Uint8Array fields). */
function serialize(value: any): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

/** Deserialize a value using Baileys' BufferJSON reviver. */
function deserialize(json: string): any {
  return JSON.parse(json, BufferJSON.reviver);
}

export async function useFirestoreAuthState() {
  // In-memory hot cache bounded to max 3,000 entries (safe for Render 512MB RAM)
  const inMemoryKeyCache = new Map<string, any>();
  const MAX_CACHE_SIZE = 3000;

  const setCacheWithLimit = (cacheKey: string, val: any) => {
    if (inMemoryKeyCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest 300 keys (FIFO)
      let count = 0;
      for (const k of inMemoryKeyCache.keys()) {
        inMemoryKeyCache.delete(k);
        count++;
        if (count >= 300) break;
      }
    }
    inMemoryKeyCache.set(cacheKey, val);
  };

  // --- Load existing creds, or initialize fresh ones ---
  let creds: any;
  try {
    const snap = await credsDoc().get();
    if (snap.exists && snap.data()?.json) {
      creds = deserialize(snap.data()!.json);
    } else {
      creds = initAuthCreds();
    }
  } catch (e) {
    console.error("[WhatsAppAuth] Failed to load creds from Firestore, starting fresh:", e);
    creds = initAuthCreds();
  }

  // Debounced creds persistence (avoids saving 5 times in 1 second during handshake)
  let saveCredsTimer: NodeJS.Timeout | null = null;
  const saveCreds = async () => {
    if (saveCredsTimer) clearTimeout(saveCredsTimer);
    saveCredsTimer = setTimeout(async () => {
      try {
        await credsDoc().set({ json: serialize(creds), updated_at: Date.now() });
      } catch (e) {
        console.error("[WhatsAppAuth] Failed to save creds to Firestore:", e);
      }
    }, 1500);
  };

  // Batch queue for key updates
  const pendingKeyWrites = new Map<string, { type: string; id: string; value: any | null }>();
  let batchFlushTimer: NodeJS.Timeout | null = null;

  const flushPendingKeyWrites = async () => {
    if (batchFlushTimer) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }
    if (pendingKeyWrites.size === 0) return;

    const entries = Array.from(pendingKeyWrites.values());
    pendingKeyWrites.clear();

    // Firestore batch limit is 500 operations
    const CHUNK_SIZE = 400;
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      for (const item of chunk) {
        const ref = keysCol(item.type).doc(item.id);
        if (item.value) {
          batch.set(ref, { json: serialize(item.value) });
        } else {
          batch.delete(ref);
        }
      }
      try {
        await batch.commit();
      } catch (e) {
        console.error("[WhatsAppAuth] Error committing key writes batch:", e);
      }
    }
  };

  const scheduleBatchFlush = () => {
    // If queue is large, flush immediately to keep batches small
    if (pendingKeyWrites.size >= 100) {
      flushPendingKeyWrites().catch(() => {});
      return;
    }
    if (!batchFlushTimer) {
      batchFlushTimer = setTimeout(() => {
        flushPendingKeyWrites().catch(() => {});
      }, 3000); // 3 second debounce window
    }
  };

  // Flush on graceful process exit
  if (typeof process !== "undefined") {
    process.once("beforeExit", () => {
      flushPendingKeyWrites().catch(() => {});
    });
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, any> = {};
          const missingIds: string[] = [];

          // 1. Check local in-memory hot cache first (instant synchronous lookup)
          for (const id of ids) {
            const cacheKey = `${type}:${id}`;
            if (inMemoryKeyCache.has(cacheKey)) {
              result[id] = inMemoryKeyCache.get(cacheKey);
            } else if (!EPHEMERAL_KEY_TYPES.has(type)) {
              missingIds.push(id);
            }
          }

          // 2. Fetch missing non-ephemeral keys from Firestore in parallel
          if (missingIds.length > 0) {
            await Promise.all(
              missingIds.map(async (id) => {
                try {
                  const snap = await keysCol(type).doc(id).get();
                  if (snap.exists && snap.data()?.json) {
                    let value = deserialize(snap.data()!.json);
                    if (type === "app-state-sync-key" && value) {
                      value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    result[id] = value;
                    setCacheWithLimit(`${type}:${id}`, value);
                  }
                } catch (e) {
                  console.error(`[WhatsAppAuth] Failed to load key ${type}/${id}:`, e);
                }
              })
            );
          }
          return result;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const type in data) {
            const isEphemeral = EPHEMERAL_KEY_TYPES.has(type);
            for (const id in data[type]) {
              const value = data[type][id];
              const cacheKey = `${type}:${id}`;

              // Update hot cache immediately so Baileys gets instant zero-latency responses
              if (value) {
                setCacheWithLimit(cacheKey, value);
              } else {
                inMemoryKeyCache.delete(cacheKey);
              }

              // Only queue persistent keys to Firestore; skip ephemeral keys entirely
              if (!isEphemeral) {
                pendingKeyWrites.set(cacheKey, { type, id, value: value || null });
              }
            }
          }

          if (pendingKeyWrites.size > 0) {
            scheduleBatchFlush();
          }
        },
      },
    },
    saveCreds,
    /** Wipes all stored auth data — used when resetting/re-pairing the session. */
    clearAuth: async () => {
      try {
        if (saveCredsTimer) clearTimeout(saveCredsTimer);
        if (batchFlushTimer) clearTimeout(batchFlushTimer);
        pendingKeyWrites.clear();
        inMemoryKeyCache.clear();

        await credsDoc().delete().catch(() => {});
        // Delete all known key-type subcollections in batches until completely empty
        const keyTypes = [
          "pre-key",
          "session",
          "sender-key",
          "app-state-sync-key",
          "app-state-sync-version",
          "sender-key-memory",
        ];
        for (const type of keyTypes) {
          while (true) {
            const snap = await keysCol(type).limit(500).get();
            if (snap.empty) break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            if (snap.size < 500) break;
          }
        }
      } catch (e) {
        console.error("[WhatsAppAuth] Failed to clear auth in Firestore:", e);
      }
    },
  };
}
