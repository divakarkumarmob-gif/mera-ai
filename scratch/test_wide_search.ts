import { jioSaavnService } from "../src/services/jioSaavnService";

const queries = [
  "Raanjhanaa",
  "Pehle Bhi Main",
  "Tu Jaane Na",
  "Sajni Re",
  "Hass Hass",
  "Channa Mereya",
  "Lollipop Lagelu",
  "King Tu Aake Dekhle",
  "Starboy",
  "Pasoori"
];

async function testWideSearch() {
  console.log("=== TESTING WIDE CATALOG SEARCH ACROSS MULTIPLE GENRES ===");
  for (const q of queries) {
    const res = await jioSaavnService.searchSong(q);
    console.log(`\n🔍 Query: "${q}" -> Found: ${res.count} songs (${res.success ? "✅" : "❌"})`);
    if (res.topSong) {
      console.log(`   Top: "${res.topSong.songName}" by ${res.topSong.artistName} [${res.topSong.albumName || "No Album"}]`);
      console.log(`   Direct 320k: ${res.topSong.audio320kbps.slice(0, 55)}...`);
    }
  }
}

testWideSearch().catch(console.error);
