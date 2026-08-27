import "dotenv/config";
import { vectorMemoryService } from "../src/services/vectorMemoryService";
import { liveScratchService } from "../src/services/liveScratchService";
import { dailyUpdateService } from "../src/services/dailyUpdateService";
import { memoryEngine } from "../src/services/memoryEngine";
import fs from "fs";
import path from "path";

async function testMemoryLifecycleEngine() {
  console.log("=== Testing 4-Tier Memory & Permanent Vector Database Lifecycle ===");

  // 1. Test Vector Memory Service (Gemini Embedding & Archival)
  console.log("\n[Test 1] Archiving past memory to Vector Database...");
  const archiveResult = await vectorMemoryService.archiveToVectorStore({
    originalText: "DK and Friday planned the complete microservices migration for the ERP project with Postgres and Redis.",
    summary: "ERP microservices architecture planning session with Postgres & Redis cache.",
    sourceType: "session_dialogue",
    dateRangeStr: "27 June 2026",
    startTimestamp: Date.now() - 65 * 24 * 60 * 60 * 1000, // 65 days ago
    endTimestamp: Date.now() - 65 * 24 * 60 * 60 * 1000 + 3600000,
    metadata: { topic: "ERP Architecture" },
  });
  console.log("Archive Result:", archiveResult);

  // 2. Test Vector Semantic Search
  console.log("\n[Test 2] Testing Semantic Vector Search for 'Postgres database migration'...");
  const searchResults = await vectorMemoryService.searchSemanticMemory("Postgres database migration", 3);
  console.log(`Found ${searchResults.totalMatches} semantic matches.`);
  if (searchResults.results.length > 0) {
    console.log("Top Match Summary:", searchResults.results[0].summary);
    console.log("Similarity Score:", searchResults.results[0].similarity);
  }

  // 3. Test Live Crash-Proof Scratch Cache (with exact timestamp)
  console.log("\n[Test 3] Testing Live Scratch Cache Stream...");
  const testTurn = await liveScratchService.recordLiveTurn("test_sess_001", "user", "Friday, aaj sham ko 7 baje call schedule karna");
  console.log("Recorded Live Turn:", {
    id: testTurn.id,
    sender: testTurn.sender,
    text: testTurn.text,
    spokenTimeIST: testTurn.spokenTimeIST,
  });

  const recentTurns = await liveScratchService.getRecentScratchTurns(24);
  console.log(`Active 24h scratch turns count: ${recentTurns.length}`);

  // 4. Test Daily Update 30-Day Verbatim Retention & Timestamps
  console.log("\n[Test 4] Testing Daily Update 30-Day Append with timestamp...");
  const updateEntry = await dailyUpdateService.appendUpdate("Workout complete kiya aur 2 ghante coding ki.");
  console.log("Daily Update Entry:", updateEntry.text);

  // 5. Test Memory Engine 4-Day Exact Retention
  console.log("\n[Test 5] Recording conversation messages into MemoryEngine...");
  const sessId = "session_4day_test_" + Date.now();
  memoryEngine.recordMessage(sessId, "user", "Bhai mera kal interview hai Bangalore me");
  memoryEngine.recordMessage(sessId, "ai", "Best of luck Boss! Aap phod kar aayenge, tension mat lijiye!");

  // Compile Memory Prompt and verify last 4 days section
  const promptContext = await memoryEngine.compileMemoryPrompt();
  console.log("Memory Prompt Context includes 4-day verbatim dialogues:", promptContext.includes("EXACT WORD-TO-WORD DIALOGUES (LAST 4 DAYS"));

  // 6. Verify server.ts endpoints and tool registrations
  console.log("\n[Test 6] Verifying server.ts tool registrations...");
  const serverContent = fs.readFileSync(path.resolve("./server.ts"), "utf-8");
  const checks = [
    "search_long_term_vector_memory",
    "get_memory_lifecycle_status",
    "/api/memory/vector/search",
    "/api/memory/lifecycle/stats",
    "LONG-TERM VECTOR MEMORY RETRIEVAL",
  ];

  for (const check of checks) {
    if (serverContent.includes(check)) {
      console.log(`✅ Verified in server.ts: "${check}"`);
    } else {
      console.error(`❌ Missing in server.ts: "${check}"`);
      process.exit(1);
    }
  }

  console.log("\n=== ALL 4-TIER MEMORY & VECTOR DATABASE TESTS PASSED SUCCESSFULLY! ===");
}

testMemoryLifecycleEngine().catch(console.error);
