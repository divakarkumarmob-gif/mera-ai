import { jioSaavnService } from "../src/services/jioSaavnService";

async function testSehraSmart() {
  const q = "mai sehra bandh ke aunga , amir khan";
  // Strip commas, extra words
  const cleanQ = q.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  console.log("Original query:", q);
  console.log("Clean query:", cleanQ);

  const res = await jioSaavnService.searchSong(cleanQ);
  console.log(`Results (${res.count}):`);
  res.songs.slice(0, 5).forEach((s, idx) => {
    console.log(` ${idx + 1}. "${s.songName}" by ${s.artistName} [${s.albumName}]`);
  });
}

testSehraSmart().catch(console.error);
