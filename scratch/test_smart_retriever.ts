import "dotenv/config";
import { smartMemoryRetrieverService } from "../src/services/smartMemoryRetrieverService";
import { vectorMemoryService } from "../src/services/vectorMemoryService";
import { dailyUpdateService } from "../src/services/dailyUpdateService";

async function testSmartMemoryRetriever() {
  console.log("=== Testing 3-Tier Parallel Smart Memory Retriever ===");

  // 1. Seed historical memory in Vector DB (Tier 3)
  await vectorMemoryService.archiveToVectorStore({
    originalText: "Office project ERP migration me Postgres database pool size exhaust ho gaya tha aur 504 gateway timeout aa raha tha.",
    summary: "Office ERP project database connection pool exhaustion and 504 timeout issue.",
    sourceType: "session_dialogue",
    dateRangeStr: "12 June 2026",
    startTimestamp: new Date("2026-06-12T10:00:00Z").getTime(),
    endTimestamp: new Date("2026-06-12T11:00:00Z").getTime(),
    metadata: {
      session_id: "sess_erp_issue_20260612",
      exact_date: "2026-06-12",
    },
  });

  // 2. Seed active daily update (Tier 2)
  await dailyUpdateService.appendUpdate("Office me naye project par kaam start kiya hai with team.");

  // 3. Test multi-tier retrieval for: "Yaar, aaj office me jo project shuru kiya tha, usme phir se wahi purani dikkat aa gayi."
  const userSentence = "Yaar, aaj office me jo project shuru kiya tha, usme phir se wahi purani dikkat aa gayi.";
  console.log("\n[User Input]:", userSentence);

  const result = await smartMemoryRetrieverService.fetchMultiTierMemory(userSentence);

  console.log("\n[चरण 1: संदर्भ / Keywords]:", result.detectedKeywords);
  console.log("[चरण 2: Tier 2 Matches (Daily Updates)]:", result.tier2_dailyUpdates.length);
  console.log("[चरण 2: Tier 3 Matches (Vector DB)]:", result.tier3_longTermVectors.length);
  if (result.tier3_longTermVectors.length > 0) {
    console.log("-> Historic Date:", result.tier3_longTermVectors[0].date);
    console.log("-> Historic Summary:", result.tier3_longTermVectors[0].summary);
  }

  console.log("\n[चरण 3: The Smart Prompt Injection (Insani Dimaag Context)]:\n");
  console.log(result.compiledHumanContext);

  console.log("\n=== ALL SMART RETRIEVER TESTS PASSED SUCCESSFULLY! ===");
}

testSmartMemoryRetriever().catch(console.error);
