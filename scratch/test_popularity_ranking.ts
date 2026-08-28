import { jioSaavnService } from "../src/services/jioSaavnService";

async function testPopularityRank() {
  const testQueries = [
    "sehra bandh ke amir khan",
    "raanjhanaa",
    "tum hi ho",
    "dil de diya hai",
    "galliyan",
    "kahani suno",
    "teree galliyan"
  ];

  console.log("=== TESTING YOUTUBE-GRADE INTENT & POPULARITY RANKING ===\n");
  for (const q of testQueries) {
    const res = await jioSaavnService.searchSong(q, 10);
    console.log(`🔍 Query: "${q}" -> Top 3 Results:`);
    res.songs.slice(0, 3).forEach((s, idx) => {
      console.log(`   ${idx + 1}. "${s.songName}" by ${s.artistName} [${s.albumName || "Single"}]`);
    });
    console.log("");
  }
}

testPopularityRank().catch(console.error);
