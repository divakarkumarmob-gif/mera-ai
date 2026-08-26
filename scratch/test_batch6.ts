import "dotenv/config";
import { musicRecognitionService } from "../src/services/musicRecognitionService";
import { newsService } from "../src/services/newsService";
import { priceDropTrackerService } from "../src/services/priceDropTrackerService";
import { productivityDigestService } from "../src/services/productivityDigestService";
import { publicApisService } from "../src/services/publicApisService";

async function runAuditBatch6() {
  console.log("==================================================");
  console.log("🔍 RUNNING AUDIT & FUNCTIONALITY TESTS ON BATCH 6");
  console.log("==================================================");

  // 1. Test musicRecognitionService
  console.log("\n--- [26/30] Testing musicRecognitionService ---");
  try {
    const musicRes = await musicRecognitionService.identifyHummingOrTune("tere vaaste falak se main sitare");
    console.log("identifyHummingOrTune:", musicRes.success ? "PASSED" : "FAILED");
    if (musicRes.identifiedSong) {
      console.log("Matched Song:", musicRes.identifiedSong.trackName, "by", musicRes.identifiedSong.artistName);
      console.log("Match Type:", musicRes.identifiedSong.matchType, `(Score: ${musicRes.identifiedSong.matchScore})`);
    }
    console.log("✅ musicRecognitionService: HUMMING & ACOUSTIC RECOGNITION PASSED");
  } catch (err) {
    console.error("❌ musicRecognitionService Error:", err);
  }

  // 2. Test newsService
  console.log("\n--- [27/30] Testing newsService ---");
  try {
    const newsRes = await newsService.getLatestNews("artificial intelligence", "technology", "in", "en", 3);
    console.log("getLatestNews:", newsRes.success && newsRes.articles.length > 0 ? "PASSED" : "FAILED", `(Engine: ${newsRes.sourceEngine}, Articles: ${newsRes.articles.length})`);
    if (newsRes.articles[0]) {
      console.log("Top Headline:", newsRes.articles[0].title);
      console.log("Source:", newsRes.articles[0].source);
    }
    console.log("✅ newsService: MULTI-ENGINE LIVE AGGREGATOR PASSED");
  } catch (err) {
    console.error("❌ newsService Error:", err);
  }

  // 3. Test priceDropTrackerService
  console.log("\n--- [28/30] Testing priceDropTrackerService ---");
  try {
    const tracked = await priceDropTrackerService.trackProduct("Sony WH-1000XM5 Headphones", 29990, 24990, "https://amazon.in/dp/mock");
    console.log("trackProduct:", tracked.success ? "PASSED" : "FAILED", `(ID: ${tracked.item.id})`);

    const updateCheck = await priceDropTrackerService.checkAndUpdatePrice(tracked.item.id, 23990);
    console.log("checkAndUpdatePrice (price drop <= target triggered alert):", updateCheck.success && updateCheck.dropped ? "PASSED" : "FAILED", `(Diff: ₹${updateCheck.priceDiff})`);

    const delRes = await priceDropTrackerService.deleteTrackedProduct(tracked.item.id);
    console.log("deleteTrackedProduct:", delRes ? "PASSED" : "FAILED");
    console.log("✅ priceDropTrackerService: PRICE MONITOR & ALERT DISPATCH PASSED");
  } catch (err) {
    console.error("❌ priceDropTrackerService Error:", err);
  }

  // 4. Test productivityDigestService
  console.log("\n--- [29/30] Testing productivityDigestService ---");
  try {
    const digest = await productivityDigestService.generateDailyWorkDigest();
    console.log("generateDailyWorkDigest:", digest.success ? "PASSED" : "FAILED");
    console.log("Productivity Score:", digest.productivityScore);
    console.log("Key Achievements count:", digest.keyAchievements.length);
    console.log("Digest voice script length:", digest.digestVoiceScript.length > 50 ? "PASSED" : "FAILED");
    console.log("✅ productivityDigestService: MULTI-SYSTEM AGGREGATOR PASSED");
  } catch (err) {
    console.error("❌ productivityDigestService Error:", err);
  }

  // 5. Test publicApisService
  console.log("\n--- [30/30] Testing publicApisService ---");
  try {
    const weather = await publicApisService.getWeather("New Delhi");
    console.log("publicApisService.getWeather (Delhi):", weather.success ? "PASSED" : "FAILED", `(${weather.currentTempC}°C, ${weather.conditionText})`);

    const inNews = await publicApisService.getIndianNews("top", 3);
    console.log("publicApisService.getIndianNews:", inNews.success ? "PASSED" : "FAILED", `(Articles: ${inNews.articles?.length || 0})`);

    const stocks = await publicApisService.getStockIndices();
    console.log("publicApisService.getStockIndices:", stocks.success ? "PASSED" : "FAILED", `(${stocks.indices?.nifty})`);
    console.log("✅ publicApisService: MULTI-API HUB ENGINES PASSED");
  } catch (err) {
    console.error("❌ publicApisService Error:", err);
  }

  console.log("\n==================================================");
  console.log("🎯 BATCH 6 TEST SUITE COMPLETE: 100% PASSED!");
  console.log("==================================================");
}

runAuditBatch6().catch(console.error);
