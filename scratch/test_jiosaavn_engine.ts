import { jioSaavnService } from "../src/services/jioSaavnService";

async function testJioSaavn() {
  console.log("=== TESTING JIOSAAVN 320KBPS HD AUDIO ENGINE ===\n");

  const query = "Kesariya";
  console.log(`Searching JioSaavn for: "${query}"...`);
  const res = await jioSaavnService.searchSong(query);

  console.log("Search Result:", res.success ? "✅ PASSED" : "❌ FAILED");
  if (res.topSong) {
    const s = res.topSong;
    console.log(`  🎵 Song: ${s.songName}`);
    console.log(`  👤 Artist: ${s.artistName}`);
    console.log(`  💿 Album: ${s.albumName}`);
    console.log(`  🖼️ 500x500 Cover: ${s.albumArt500}`);
    console.log(`  ⚡ 320kbps Audio Stream: ${s.audio320kbps}`);
    console.log(`  ⏱️ Duration: ${s.durationSec}s`);
  } else {
    console.log("  No song found.");
  }
}

testJioSaavn().then(() => process.exit(0));
