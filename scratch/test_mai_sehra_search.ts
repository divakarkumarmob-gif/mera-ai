import { jioSaavnService } from "../src/services/jioSaavnService";

async function testQuery() {
  const query = "mai sehra bandh ke aunga";
  console.log("=== TESTING SEARCH FOR:", query, "===");

  const res = await jioSaavnService.searchSong(query, 10);
  console.log("Total Results:", res.count);
  res.songs.forEach((s, idx) => {
    console.log(`${idx+1}. "${s.songName}" by ${s.artistName} | Album: "${s.albumName}" | starring: "${s.starring}" | playCount: ${s.playCount}`);
  });
}

testQuery().catch(console.error);
