import { jioSaavnService } from "../src/services/jioSaavnService";

const shortQueries = [
  { name: "Hindi New", query: "Hindi Hits" },
  { name: "Hindi Old", query: "Kishore Kumar Lata Mangeshkar" },
  { name: "Bhojpuri", query: "Bhojpuri" },
  { name: "Phonk", query: "Phonk" },
  { name: "Haryanvi", query: "Haryanvi" },
  { name: "Punjabi", query: "Punjabi Hits" },
];

async function testShort() {
  console.log("=== TESTING SHORT CATEGORY QUERIES ===");
  for (const item of shortQueries) {
    const res = await jioSaavnService.searchSong(item.query, 40);
    console.log(`🎵 [${item.name}] query "${item.query}" -> Found: ${res.count} songs (${res.success ? "✅" : "❌"})`);
    if (res.songs && res.songs.length > 0) {
      console.log(`   Top 1: "${res.songs[0].songName}" by ${res.songs[0].artistName} [${res.songs[0].albumName}]`);
      console.log(`   Top 2: "${res.songs[1]?.songName}" by ${res.songs[1]?.artistName} [${res.songs[1]?.albumName}]`);
    }
  }
}

testShort().catch(console.error);
