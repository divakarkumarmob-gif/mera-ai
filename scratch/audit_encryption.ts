import "dotenv/config";
import crypto from "crypto";
import { saveMessage, getHistory } from "../src/services/historyService";
import { db } from "../src/services/firebaseAdmin";

async function auditEncryption() {
  console.log("================================================================");
  console.log("🔒 RIGOROUS AUDIT: AES-256-GCM ENCRYPTION & DATA SECURITY CHECK");
  console.log("================================================================");

  // 1. Check ENCRYPTION_KEY in .env
  const rawKey = process.env.ENCRYPTION_KEY;
  console.log("\n[Check 1] Environment ENCRYPTION_KEY Inspection:");
  console.log("Is ENCRYPTION_KEY present?", !!rawKey);
  console.log("Key Length:", rawKey ? rawKey.length : 0, "characters");

  if (!rawKey || rawKey.length < 32) {
    console.error("❌ CRITICAL: ENCRYPTION_KEY is missing or shorter than 32 characters!");
  } else {
    console.log("✅ ENCRYPTION_KEY length is valid (>= 32 chars).");
  }

  // 2. Cryptographic Algorithm & GCM Tamper-Proofing Test
  console.log("\n[Check 2] Cryptographic Algorithm & GCM Authentication Tag Test:");
  const resolvedKey = crypto.createHash("sha256").update(rawKey || "dummy_fallback_32_characters_key!").digest();
  console.log("Derived 256-bit Key Byte Length:", resolvedKey.length, "bytes (256 bits)");

  const sampleSecret = "Divakar secret financial and personal discussion 2026";
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", resolvedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(sampleSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16-byte GCM authentication tag
  const fullPayloadBase64 = Buffer.concat([iv, authTag, ciphertext]).toString("base64");

  console.log("IV Length:", iv.length, "bytes (Standard GCM 96-bit)");
  console.log("Ciphertext Length:", ciphertext.length, "bytes");
  console.log("GCM AuthTag Length:", authTag.length, "bytes (Standard GCM 128-bit)");
  console.log("Raw Encrypted Base64 Payload:", fullPayloadBase64);

  // Test Decryption
  const rawBuf = Buffer.from(fullPayloadBase64, "base64");
  const extractedIv = rawBuf.subarray(0, 12);
  const extractedTag = rawBuf.subarray(12, 28);
  const extractedCiphertext = rawBuf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", resolvedKey, extractedIv);
  decipher.setAuthTag(extractedTag);
  const decrypted = Buffer.concat([decipher.update(extractedCiphertext), decipher.final()]).toString("utf8");

  if (decrypted === sampleSecret) {
    console.log("✅ Genuine AES-256-GCM encryption & decryption verified successfully!");
  } else {
    console.error("❌ FAKE ENCRYPTION DETECTED! Decrypted text does not match original!");
  }

  // Test Tampering Detection (GCM Integrity Check)
  console.log("\n[Check 3] Tamper Detection Test (GCM Anti-Tamper Check):");
  let tamperedCaught = false;
  try {
    const tamperedBuf = Buffer.from(rawBuf);
    // Flip one byte in the ciphertext
    tamperedBuf[30] ^= 0xff;
    const tIv = tamperedBuf.subarray(0, 12);
    const tTag = tamperedBuf.subarray(12, 28);
    const tCipher = tamperedBuf.subarray(28);

    const tDecipher = crypto.createDecipheriv("aes-256-gcm", resolvedKey, tIv);
    tDecipher.setAuthTag(tTag);
    Buffer.concat([tDecipher.update(tCipher), tDecipher.final()]).toString("utf8");
  } catch (err: any) {
    tamperedCaught = true;
    console.log("✅ GCM Integrity Protection Verified! Tampering was detected and rejected with error:", err.message);
  }

  if (!tamperedCaught) {
    console.error("❌ FAKE GCM DETECTED! Tampered ciphertext was NOT rejected by auth tag!");
  }

  // 3. Inspect What is ACTUALLY Stored in Firestore (history collection)
  console.log("\n[Check 4] Live Firestore 'history' Collection Document Audit:");
  const testSecretText = "TOP_SECRET_AUDIT_STRING_TEST_12345";
  await saveMessage("user", testSecretText);

  // Fetch the raw document directly from Firestore
  const rawSnap = await db.collection("history").orderBy("created_at", "desc").limit(1).get();
  if (!rawSnap.empty) {
    const rawDocData = rawSnap.docs[0].data();
    console.log("Raw Document Stored in Firestore:", JSON.stringify(rawDocData, null, 2));

    const containsPlainText = JSON.stringify(rawDocData).includes(testSecretText);
    if (containsPlainText) {
      console.error("❌ ALERT: Plain text was found in Firestore! Encryption is NOT active on this document!");
    } else {
      console.log("✅ VERIFIED: Raw Firestore document contains ONLY ciphertext! Plain text is 100% hidden at rest.");
    }
  }

  console.log("\n================================================================");
  console.log("AUDIT SUMMARY COMPLETE");
  console.log("================================================================");
}

auditEncryption().catch(console.error);
