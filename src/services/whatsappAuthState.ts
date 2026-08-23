import * as BaileysModule from "@whiskeysockets/baileys";
import { db } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Firestore-backed auth state for Baileys, replacing useMultiFileAuthState.
//
// Baileys normally persists WhatsApp login session data (creds + signal
// protocol keys) as files on local disk. On Render (and most PaaS hosts),
// local disk is wiped on every redeploy/restart unless a paid persistent
// Disk is attached — so the QR/pairing code had to be redone every time.
//
// This stores the same data in Firestore instead:
//   whatsapp_auth/creds                       (single doc: the auth creds)
//   whatsapp_auth/keys/{type}/{keyId}          (signal protocol keys)
//
// Once paired, the session survives restarts and redeploys automatically —
// no local disk needed, works on Render's free plan.
// ---------------------------------------------------------------------------

const baileys: any = BaileysModule;
const initAuthCreds = baileys.initAuthCreds || baileys.default?.initAuthCreds;
const BufferJSON = baileys.BufferJSON || baileys.default?.BufferJSON;

const authRootDoc = () => db.collection("whatsapp_auth").doc("session");
const credsDoc = () => authRootDoc().collection("meta").doc("creds");
const keysCol = (type: string) => authRootDoc().collection("keys").doc(type).collection("items");

/** Serialize a value using Baileys' BufferJSON replacer (handles Buffer/Uint8Array fields). */
function serialize(value: any): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

/** Deserialize a value using Baileys' BufferJSON reviver. */
function deserialize(json: string): any {
  return JSON.parse(json, BufferJSON.reviver);
}

export async function useFirestoreAuthState() {
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

  const saveCreds = async () => {
    try {
      await credsDoc().set({ json: serialize(creds), updated_at: Date.now() });
    } catch (e) {
      console.error("[WhatsAppAuth] Failed to save creds to Firestore:", e);
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, any> = {};
          await Promise.all(
            ids.map(async (id) => {
              try {
                const snap = await keysCol(type).doc(id).get();
                if (snap.exists && snap.data()?.json) {
                  let value = deserialize(snap.data()!.json);
                  if (type === "app-state-sync-key" && value) {
                    value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
                  }
                  result[id] = value;
                }
              } catch (e) {
                console.error(`[WhatsAppAuth] Failed to load key ${type}/${id}:`, e);
              }
            })
          );
          return result;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          const writes: Promise<void>[] = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const ref = keysCol(type).doc(id);
              if (value) {
                writes.push(ref.set({ json: serialize(value) }).then(() => {}));
              } else {
                writes.push(ref.delete().then(() => {}).catch(() => {}));
              }
            }
          }
          try {
            await Promise.all(writes);
          } catch (e) {
            console.error("[WhatsAppAuth] Failed to save keys to Firestore:", e);
          }
        },
      },
    },
    saveCreds,
    /** Wipes all stored auth data — used when resetting/re-pairing the session. */
    clearAuth: async () => {
      try {
        await credsDoc().delete().catch(() => {});
        // Best-effort: delete known key-type subcollections in batches.
        const keyTypes = ["pre-key", "session", "sender-key", "app-state-sync-key", "app-state-sync-version", "sender-key-memory"];
        for (const type of keyTypes) {
          const snap = await keysCol(type).limit(500).get();
          if (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        }
      } catch (e) {
        console.error("[WhatsAppAuth] Failed to clear auth in Firestore:", e);
      }
    },
  };
}
