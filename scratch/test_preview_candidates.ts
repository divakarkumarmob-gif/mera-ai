import { jioSaavnService } from "../src/services/jioSaavnService";
import { publicApisService } from "../src/services/publicApisService";

async function testPreviewOptions() {
  const query = "sehra bandh ke";
  console.log("=== TESTING PREVIEW CANDIDATES FOR:", query, "===");

  // Fetch JioSaavn full candidates
  const jioRes = await jioSaavnService.searchSong(query, 5);
  console.log(`JioSaavn Candidates (${jioRes.count}):`);
  jioRes.songs.slice(0, 4).forEach((s, idx) => {
    console.log(`  Candidate ${idx+1}: "${s.songName}" by ${s.artistName} [${s.albumName}]`);
    console.log(`    320k: ${s.audio320kbps.slice(0, 40)}...`);
  });

  // Fetch Spotify / Deezer 30s preview candidates
  const previewRes = await publicApisService.searchMusic(query);
  console.log(`\nSpotify/Deezer 30s Preview Tracks (${previewRes.tracks?.length || 0}):`);
  previewRes.tracks?.slice(0, 3).forEach((t, idx) => {
    console.log(`  Preview ${idx+1}: "${t.trackName}" by ${t.artistName} -> PreviewUrl: ${t.previewUrl?.slice(0, 40)}...`);
  });
}

testPreviewOptions().catch(console.error);
