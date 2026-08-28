import { jioSaavnService } from "../src/services/jioSaavnService";

const testList = [
  // Retro / Classic 60s-90s
  "Lag Ja Gale",
  "Gulabi Aankhen",
  "O Mere Dil Ke Chain",
  "Roop Tera Mastana",
  "Pardesi Pardesi Jana Nahi",
  "Tujhe Dekha Toh Yeh Jaana Sanam",
  "Kishore Kumar hit songs",
  "Lata Mangeshkar purane gane",
  
  // Brand New 2024/2025 Releases
  "Tauba Tauba",
  "Aaj Ki Raat Stree 2",
  "Chuttamalle",
  "Millionaire Yo Yo Honey Singh",
  "Illuminati Aavesham",
  "Big Dawgs Hanumankind",
  "Tilasmi Bahein Heeramandi"
];

async function testOldAndNew() {
  console.log("=== TESTING OLD (RETRO) AND BRAND NEW 2024-2026 SONGS ===\n");

  for (const query of testList) {
    const res = await jioSaavnService.searchSong(query);
    console.log(`🎵 "${query}" -> ${res.success ? `✅ FOUND (${res.count} songs)` : `❌ NOT FOUND`}`);
    if (res.topSong) {
      console.log(`   Top: "${res.topSong.songName}" by ${res.topSong.artistName} [${res.topSong.albumName}]`);
      console.log(`   320kbps Stream: ${res.topSong.audio320kbps.slice(0, 50)}...`);
    }
  }
}

testOldAndNew().catch(console.error);
