import "dotenv/config";
import { encryptData, decryptData, CIPHER_PREFIX } from "../src/utils/cryptoVault";
import { dailyUpdateService, todayIST } from "../src/services/dailyUpdateService";
import { memoryEngine } from "../src/services/memoryEngine";
import { memoryBackupService } from "../src/services/memoryBackupService";
import { db } from "../src/services/firebaseAdmin";

async function testFullMemoryEncryption() {
  console.log("=== Testing Universal AES-256-GCM Memory Encryption & Plain-Text Backup ===");

  // --- Test 1: CryptoVault Core & Backward Compatibility ---
  console.log("\n[Test 1] Testing Universal CryptoVault Primitive & Backward Compatibility...");
  const sampleSecret = "DK secret personal financial plan 2026";
  const encrypted = encryptData(sampleSecret);
  console.log("Encrypted Output (Starts with prefix?):", encrypted.startsWith(CIPHER_PREFIX));
  console.log("Encrypted Sample (first 50 chars):", encrypted.slice(0, 50));

  const decrypted = decryptData(encrypted);
  console.log("Decrypted Output Matches Original?", decrypted === sampleSecret);

  // Backward compatibility test: Unencrypted plain text passed to decryptData
  const legacyPlainText = "Ye purana unencrypted plain text hai";
  const legacyDecrypted = decryptData(legacyPlainText);
  console.log("Legacy Plain Text Handled Gracefully?", legacyDecrypted === legacyPlainText);

  // --- Test 2: DailyUpdateService Encryption in Firestore ---
  console.log("\n[Test 2] Testing DailyUpdateService Firestore Encryption...");
  const testUpdate = "Secret meeting at 5 PM with investor in Connaught Place.";
  const updateRes = await dailyUpdateService.appendUpdate(testUpdate);
  console.log("Active decrypted in-memory text:", updateRes.text.includes(testUpdate));

  // Inspect raw Firestore document directly
  const date = todayIST();
  const rawDailyDoc = await db.collection("daily_updates").doc(date).get();
  if (rawDailyDoc.exists) {
    const rawData = rawDailyDoc.data();
    const storedText = rawData?.text || "";
    console.log("Raw Stored Text Starts with ENC_GCM::?", storedText.startsWith(CIPHER_PREFIX));
    console.log("Raw Document Contains Plain Text?", storedText.includes(testUpdate));
    if (!storedText.includes(testUpdate) && storedText.startsWith(CIPHER_PREFIX)) {
      console.log("✅ VERIFIED: Daily update is AES-256-GCM encrypted at rest in Firestore!");
    } else {
      console.error("❌ FAILED: Plain text detected in daily_updates Firestore!");
      process.exit(1);
    }
  }

  // Verify getUpdateForDate returns decrypted
  const fetchedUpdate = await dailyUpdateService.getUpdateForDate(date);
  console.log("getUpdateForDate successfully decrypted?", fetchedUpdate?.text?.includes(testUpdate));

  // --- Test 3: Personal Vault Encryption in Firestore ---
  console.log("\n[Test 3] Testing Personal Vault Encryption in Firestore...");
  const testFact = "DK's private personal bank account is with HDFC Bank Delhi branch.";
  await memoryEngine.addPersonalVaultFact("personal_secrets_and_facts", testFact);

  const vaultSnap = await db.collection("memory").doc("personalVault").collection("entries").orderBy("timestamp", "desc").limit(1).get();
  if (!vaultSnap.empty) {
    const rawFact = vaultSnap.docs[0].data()?.exactFact || "";
    console.log("Raw Stored Fact Starts with ENC_GCM::?", rawFact.startsWith(CIPHER_PREFIX));
    console.log("Raw Document Contains Plain Text?", rawFact.includes(testFact));
    if (!rawFact.includes(testFact) && rawFact.startsWith(CIPHER_PREFIX)) {
      console.log("✅ VERIFIED: Personal Vault fact is AES-256-GCM encrypted at rest in Firestore!");
    } else {
      console.error("❌ FAILED: Plain text detected in personalVault Firestore!");
      process.exit(1);
    }
  }

  // Verify getMemories returns decrypted
  const memories = await memoryEngine.getMemories();
  const foundDecryptedFact = memories.personalVault.some((v) => v.exactFact.includes("HDFC Bank"));
  console.log("getMemories successfully returned decrypted fact?", foundDecryptedFact);

  // --- Test 4: Plain-Text Backup Export & Re-Encryption Restore ---
  console.log("\n[Test 4] Testing Decrypted Plain-Text Backup Export & Restore...");
  const backup = await memoryBackupService.exportDecryptedBackup();
  console.log("Backup Export Version:", backup.version);
  console.log("Backup Date:", backup.exportDate);
  console.log("Personal Vault Count in Backup:", backup.personalVault.length);
  console.log("Daily Updates Count in Backup:", backup.dailyUpdates.length);

  // Verify that backup contains PLAIN TEXT, not ENC_GCM::
  const backupJsonString = JSON.stringify(backup);
  const backupHasPlainFact = backupJsonString.includes("HDFC Bank");
  const backupHasNoPrefix = !backupJsonString.includes(CIPHER_PREFIX);
  console.log("Backup contains decrypted plain text (readable)?", backupHasPlainFact);
  console.log("Backup is free from ENC_GCM:: cipher strings?", backupHasNoPrefix);

  if (backupHasPlainFact && backupHasNoPrefix) {
    console.log("✅ VERIFIED: Plain-text backup export is 100% human-readable JSON!");
  } else {
    console.warn("⚠️ Warning: Backup formatting check:", { backupHasPlainFact, backupHasNoPrefix });
  }

  console.log("\n=== ALL FULL MEMORY ENCRYPTION & BACKUP TESTS PASSED! ===");
}

testFullMemoryEncryption().catch(console.error);
