import { jioSaavnService } from "../src/services/jioSaavnService";

async function testFinal() {
  const queries = [
    "mai sehra bandh ke aunga",
    "mai sehra bandh ke aunga , amir khan",
    "sehra bandh ke amir khan",
    "deewana mujh sa nahin",
    "dulhe ka sehra"
  ];

  console.log("=== VERIFYING FINAL MULTI-QUERY CATALOG SEARCH ===\n");
  for (const q of queries) {
    const res = await jioSaavnService.searchSong(q);
    console.log(`Query: "${q}" -> Total Songs: ${res.count}`);
    if (res.songs) {
      res.songs.slice(0, 3).forEach((s, idx) => {
        console.log(`  ${idx + 1}. "${s.songName}" | Singer: ${s.artistName} | Album: ${s.albumName}`);
      });
    }
  }
}

testFinal().catch(console.error);
