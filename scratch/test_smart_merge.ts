import { jioSaavnService } from "../src/services/jioSaavnService";

async function testNoiseQueries() {
  const noiseQueries = [
    "Kishore Kumar ke gane",
    "Arijit Singh new song 2024",
    "purane sad gane",
    "Lata Mangeshkar best song",
    "Honey Singh new album",
    "punjabi latest song",
  ];

  console.log("=== TESTING NOISE & HINGLISH QUERIES ===\n");
  for (const q of noiseQueries) {
    const res = await jioSaavnService.searchSong(q);
    console.log(`Query: "${q}" -> Found: ${res.count} songs`);
    if (res.topSong) {
      console.log(`  Top 1: "${res.topSong.songName}" by ${res.topSong.artistName}`);
    }
  }
}

testNoiseQueries().catch(console.error);
