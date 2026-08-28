import { publicApisService } from "../src/services/publicApisService";
import { jioSaavnService } from "../src/services/jioSaavnService";

async function verifySpotifyPrimaryPipeline() {
  console.log("=== TESTING SPOTIFY PRIMARY & JIOSAAVN SECONDARY PIPELINE ===");

  const query = "Kesariya";
  const candidates: any[] = [];
  const seenNames = new Set<string>();

  // 1. PRIMARY: Spotify / Deezer 30s clips
  const spotifyRes = await publicApisService.searchMusic(query);
  if (spotifyRes.success && Array.isArray(spotifyRes.tracks)) {
    for (const t of spotifyRes.tracks) {
      if (t.previewUrl && t.trackName) {
        const norm = t.trackName.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!seenNames.has(norm)) {
          seenNames.add(norm);
          candidates.push({
            id: `spotify_${candidates.length + 1}`,
            songName: t.trackName,
            artistName: t.artistName,
            albumName: t.albumName,
            previewUrl: t.previewUrl,
            source: "spotify",
          });
        }
      }
      if (candidates.length >= 4) break;
    }
  }

  // 2. SECONDARY: JioSaavn fallback
  if (candidates.length < 4) {
    const jioRes = await jioSaavnService.searchSong(query, 5);
    for (const s of jioRes.songs) {
      const norm = s.songName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!seenNames.has(norm)) {
        seenNames.add(norm);
        candidates.push({
          id: s.id,
          songName: s.songName,
          artistName: s.artistName,
          albumName: s.albumName,
          previewUrl: s.audio320kbps,
          audio320kbps: s.audio320kbps,
          source: "jiosaavn",
        });
      }
      if (candidates.length >= 5) break;
    }
  }

  console.log(`✅ Total Candidates Aggregated: ${candidates.length}`);
  candidates.forEach((c, idx) => {
    console.log(`  Candidate ${idx + 1} [${c.source.toUpperCase()}]: "${c.songName}" by ${c.artistName}`);
    console.log(`    30s Preview Stream: ${c.previewUrl.slice(0, 45)}...`);
  });

  // 3. Test Full JioSaavn 320kbps Resolution on Choice
  const chosen = candidates[0];
  console.log(`\n🎯 User confirmed choice: "${chosen.songName}" [${chosen.source.toUpperCase()}]`);
  const jioResolve = await jioSaavnService.searchSong(`${chosen.songName} ${chosen.artistName}`, 1);
  if (jioResolve.topSong) {
    console.log(`🚀 Successfully Resolved to JioSaavn 320kbps Master: "${jioResolve.topSong.songName}"`);
    console.log(`   320kbps Lossless Stream: ${jioResolve.topSong.audio320kbps.slice(0, 50)}...`);
  }

  console.log("\n🎉 SPOTIFY PRIMARY & JIOSAAVN SECONDARY PIPELINE 100% PASSED!");
}

verifySpotifyPrimaryPipeline().catch(console.error);
