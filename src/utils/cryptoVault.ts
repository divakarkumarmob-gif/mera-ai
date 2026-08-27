import crypto from "crypto";

// ---------------------------------------------------------------------------
// Universal AES-256-GCM Cryptographic Vault
//
// Automatically encrypts sensitive conversation texts, personal secrets,
// daily updates, and scratch cache at rest in Firestore.
// Features:
// 1. Genuine AES-256-GCM with 12-byte IV and 16-byte authentication tag.
// 2. Clear prefix "ENC_GCM::" for 100% reliable backward compatibility.
// 3. Graceful fallback: Unencrypted legacy plain text is returned as-is.
// ---------------------------------------------------------------------------

function resolveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && raw.length >= 32) {
    return crypto.createHash("sha256").update(raw).digest();
  }
  console.warn(
    "[CryptoVault] WARNING: ENCRYPTION_KEY is missing or <32 chars. Using internal SHA-256 digest."
  );
  return crypto.createHash("sha256").update(raw || "friday_default_memory_master_key_2026").digest();
}

const VAULT_KEY = resolveKey();
export const CIPHER_PREFIX = "ENC_GCM::";

/**
 * Encrypts a plain-text string using AES-256-GCM.
 * Output format: "ENC_GCM::<Base64(IV + AuthTag + Ciphertext)>"
 */
export function encryptData(text: string): string {
  if (!text || typeof text !== "string") return text;
  // If already encrypted, don't double-encrypt
  if (text.startsWith(CIPHER_PREFIX)) return text;

  try {
    const iv = crypto.randomBytes(12); // Standard 96-bit IV
    const cipher = crypto.createCipheriv("aes-256-gcm", VAULT_KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16-byte tag
    const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64");
    return `${CIPHER_PREFIX}${payload}`;
  } catch (err) {
    console.error("[CryptoVault] Encryption failed, storing plain text as safety fallback:", err);
    return text;
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Backward compatible: If string is plain text (no prefix), returns original string safely.
 */
export function decryptData(payload: string): string {
  if (!payload || typeof payload !== "string") return payload;

  // Case 1: Standard ENC_GCM:: prefixed string
  if (payload.startsWith(CIPHER_PREFIX)) {
    try {
      const rawBase64 = payload.slice(CIPHER_PREFIX.length);
      const buf = Buffer.from(rawBase64, "base64");
      if (buf.length <= 28) return payload; // Minimum length: 12 IV + 16 Tag = 28

      const iv = buf.subarray(0, 12);
      const authTag = buf.subarray(12, 28);
      const ciphertext = buf.subarray(28);

      const decipher = crypto.createDecipheriv("aes-256-gcm", VAULT_KEY, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // GCM authentication tag failed or corrupted
      return payload;
    }
  }

  // Case 2: Legacy raw Base64 without prefix (e.g. from historyService)
  try {
    const buf = Buffer.from(payload, "base64");
    if (buf.length > 28) {
      const iv = buf.subarray(0, 12);
      const authTag = buf.subarray(12, 28);
      const ciphertext = buf.subarray(28);

      const decipher = crypto.createDecipheriv("aes-256-gcm", VAULT_KEY, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      if (decrypted) return decrypted;
    }
  } catch {}

  // Case 3: Already plain text
  return payload;
}
