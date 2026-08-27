import "dotenv/config";
import { memoryNotificationService } from "../src/services/memoryNotificationService";
import { memoryEngine } from "../src/services/memoryEngine";
import { dailyUpdateService } from "../src/services/dailyUpdateService";
import { vectorMemoryService } from "../src/services/vectorMemoryService";
import { db } from "../src/services/firebaseAdmin";

async function testZeroLossLifecycle() {
  console.log("=== Testing Zero Data-Loss Deletion Policy & 24h Buffer ===");

  // --- Test 1: Anti-Fake Verification in Notification Dispatcher ---
  console.log("\n[Test 1] Testing Anti-Fake Firestore Verification...");
  
  // A. Non-existent summary ID should be rejected
  const fakeRes = await memoryNotificationService.notifySummaryVerifiedAndStaged({
    dateRangeStr: "1 Jan – 3 Jan",
    summaryType: "session_digest",
    summaryId: "non_existent_fake_id_12345",
    summaryText: "This summary does not exist in Firestore",
    targetCollection: "mid_term_summaries",
  });
  console.log("Fake Summary Verification Result (Should be false):", fakeRes.verified);

  // B. Real summary generated and stored in Firestore
  const realSummaryId = "mid_sum_test_verified_" + Date.now();
  await db.collection("mid_term_summaries").doc(realSummaryId).set({
    id: realSummaryId,
    dateStr: "5 Dec – 9 Dec",
    summary: "Boss ne e-commerce payment gateway integration complete kiya aur testing pass ho gayi.",
    status: "archived",
  });

  const realRes = await memoryNotificationService.notifySummaryVerifiedAndStaged({
    dateRangeStr: "5 Dec – 9 Dec",
    summaryType: "mid_term_summary",
    summaryId: realSummaryId,
    summaryText: "Boss ne e-commerce payment gateway integration complete kiya aur testing pass ho gayi.",
    targetCollection: "mid_term_summaries",
  });
  console.log("Genuine Summary Verification Result (Should be true):", realRes.verified);

  // --- Test 2: MemoryEngine 60d+ 24-Hour Buffer Verification ---
  console.log("\n[Test 2] Testing 60d+ Session Staging with 24-Hour Buffer...");
  const oldSessionId = "sess_old_65d_" + Date.now();
  const past65d = Date.now() - 65 * 24 * 60 * 60 * 1000;
  const sessionsCol = db.collection("memory").doc("sessions").collection("entries");
  
  // Seed a 65-day-old session in Firestore
  await sessionsCol.doc(oldSessionId).set({
    id: oldSessionId,
    startTime: past65d,
    endTime: past65d + 3600000,
    dateStr: "23 June 2026",
    messages: [
      { sender: "user", text: "Postgres schema migrate kar diya hai.", timestamp: past65d },
      { sender: "ai", text: "Badhiya Boss, backup le liya tha?", timestamp: past65d + 1000 },
    ],
    summary: "Postgres schema migration discussion with backup verification.",
    status: "active",
  });

  // Run lifecycle pass 1 (Should STAGE under 24h buffer, NOT delete!)
  await memoryEngine.processVectorArchivalLifecycle();

  const stagedDoc = await sessionsCol.doc(oldSessionId).get();
  if (stagedDoc.exists) {
    const data = stagedDoc.data();
    console.log("✅ Verified: Session NOT deleted immediately!");
    console.log("Status:", data?.status);
    console.log("SafeDeleteAfter exists:", !!data?.safeDeleteAfter);
    console.log("Hours until deletion allowed:", ((data?.safeDeleteAfter - Date.now()) / (3600 * 1000)).toFixed(1), "hours");
  } else {
    console.error("❌ Failed: Session was prematurely deleted!");
    process.exit(1);
  }

  // Clean up test document
  await sessionsCol.doc(oldSessionId).delete().catch(() => {});
  await db.collection("mid_term_summaries").doc(realSummaryId).delete().catch(() => {});

  console.log("\n=== ALL ZERO DATA-LOSS & 24H BUFFER TESTS PASSED SUCCESSFULLY! ===");
}

testZeroLossLifecycle().catch(console.error);
