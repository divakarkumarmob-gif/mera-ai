import crypto from "crypto";
import { db, FieldValue } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Encrypted chat history — now stored in Firestore collection "history"
// instead of a local history.json file. Same AES-256-GCM encryption as
// before, so old logic and security guarantees are unchanged.
// ---------------------------------------------------------------------------

function resolveEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && raw.length >= 32) {
    return crypto.createHash("sha256").update(raw).digest();
  }
  return crypto.createHash("sha256").update(raw || "friday_default_memory_master_key_2026").digest();
}

const ENCRYPTION_KEY = resolveEncryptionKey();

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decrypt(payload: string): string {
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

export interface HistoryMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: number;
}

const historyCollection = () => db.collection("history");

/**
 * Save a single chat message (encrypted at rest) to Firestore.
 */
export async function saveMessage(sender: "user" | "ai", text: string): Promise<void> {
  if (!text || !text.trim()) return;
  try {
    await historyCollection().add({
      sender,
      ciphertext: encrypt(text.trim()),
      created_at: Date.now(),
      createdAtServer: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[HistoryService] Failed to save message to Firestore:", err);
  }
}

/**
 * Fetch chat messages, newest-last (chronological order), decrypted.
 *
 * By default returns only the most recent 50 messages — this keeps the
 * per-request decrypt cost small for the common case (opening the app,
 * opening the history modal). Pass `beforeTimestamp` to page further back
 * in time (e.g. when the user scrolls up or explicitly asks for older
 * messages) — only that batch gets fetched + decrypted, not everything.
 */
export async function getHistory(limit = 50, beforeTimestamp?: number): Promise<HistoryMessage[]> {
  try {
    const query = beforeTimestamp
      ? historyCollection().where("created_at", "<", beforeTimestamp).orderBy("created_at", "desc").limit(limit)
      : historyCollection().orderBy("created_at", "desc").limit(limit);

    const snapshot = await query.get();

    const messages = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        sender: data.sender as "user" | "ai",
        text: decrypt(data.ciphertext),
        timestamp: data.created_at,
      };
    });

    // We fetched newest-first for an efficient limit(), reverse to chronological.
    return messages.reverse();
  } catch (err) {
    console.error("[HistoryService] Failed to load history from Firestore:", err);
    return [];
  }
}

/**
 * Delete all chat history. Firestore has no "delete collection" primitive,
 * so we batch-delete in chunks.
 */
export async function clearHistory(): Promise<void> {
  try {
    const snapshot = await historyCollection().limit(500).get();
    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // Recurse in case there were more than 500 docs.
    if (snapshot.size === 500) {
      await clearHistory();
    }
  } catch (err) {
    console.error("[HistoryService] Failed to clear history in Firestore:", err);
  }
}
