import { jioSaavnService } from "../src/services/jioSaavnService";

async function testSehra() {
  const queries = [
    "mai sehra bandh ke aunga",
    "main sehra bandh ke aaunga",
    "sehra bandh ke aunga",
    "dulhe ka sehra",
    "dulhe ka sehra aamir khan"
  ];

  console.log("=== TESTING 'MAI SEHRA BANDH KE AAUNGA' SEARCH ===\n");
  for (const q of queries) {
    const res = await jioSaavnService.searchSong(q);
    console.log(`🔍 Query: "${q}" -> Success: ${res.success}, Count: ${res.count}`);
    if (res.songs && res.songs.length > 0) {
      for (let i = 0; i < Math.min(3, res.songs.length); i++) {
        const s = res.songs[i];
        console.log(`   ${i + 1}. "${s.songName}" | Singer: ${s.artistName} | Album: ${s.albumName} | 320k: ${s.audio320kbps.slice(0, 45)}...`);
      }
    }
  }
}

testSehra().catch(console.error);
