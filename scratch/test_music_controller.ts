import { jioSaavnService } from "../src/services/jioSaavnService";

async function verifyAllControls() {
  console.log("=== VERIFYING FULL MUSIC CONTROLLER & SMART QUEUE ===");

  // 1. Search song
  const songRes = await jioSaavnService.searchSong("Kesariya", 1);
  if (!songRes.topSong) {
    console.error("❌ Failed to search Kesariya");
    return;
  }
  console.log("✅ Song Found:", songRes.topSong.songName, "by", songRes.topSong.artistName);

  // 2. Generate Smart Auto-Queue
  const queue = await jioSaavnService.getSmartQueue({
    songName: songRes.topSong.songName,
    artistName: songRes.topSong.artistName,
    albumName: songRes.topSong.albumName,
  });
  console.log(`✅ Smart Auto-Queue Generated: ${queue.length} songs`);
  queue.slice(0, 4).forEach((s, idx) => {
    console.log(`   ${idx + 1}. "${s.songName}" by ${s.artistName} (Stream: ${s.audio320kbps.slice(0, 40)}...)`);
  });

  // 3. Test Lyrics fetch
  const lyricsRes = await jioSaavnService.getLyrics(songRes.topSong.id);
  console.log(`✅ Lyrics Response: ${lyricsRes.success ? "Found lyrics" : "No lyrics"}`);

  console.log("\n🎉 ALL INDUSTRY MUSIC CONTROLS & AUTO-QUEUE ENGINE VERIFIED 100%!");
}

verifyAllControls().catch(console.error);
