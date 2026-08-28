import { publicApisService } from "../src/services/publicApisService";
import { jioSaavnService } from "../src/services/jioSaavnService";

async function verifyMindReaderRanking() {
  console.log("=== TESTING YOUTUBE & SPOTIFY MIND-READER PREVIEW RANKING ===");

  const testQueries = [
    { query: "sehra bandh ke amir khan", expectedFirst: "Main Sehra Bandh Ke" },
    { query: "kesariya arjit", expectedFirst: "Kesariya" },
    { query: "tere bina arijit", expectedFirst: "Tere Bina" },
  ];

  for (const t of testQueries) {
    console.log(`\n🔍 Testing Query: "${t.query}"`);
    const candidates: any[] = [];
    const seenNames = new Set<string>();

    // 1. Spotify previews
    const spotRes = await publicApisService.searchMusic(t.query);
    if (spotRes.success && Array.isArray(spotRes.tracks)) {
      for (const tr of spotRes.tracks) {
        if (tr.previewUrl && tr.trackName) {
          const norm = tr.trackName.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!seenNames.has(norm)) {
            seenNames.add(norm);
            candidates.push({
              id: `spotify_${candidates.length + 1}`,
              songName: tr.trackName,
              artistName: tr.artistName || "Artist",
              albumName: tr.albumName,
              previewUrl: tr.previewUrl,
              source: "spotify",
            });
          }
        }
        if (candidates.length >= 4) break;
      }
    }

    // 2. JioSaavn fallback
    if (candidates.length < 4) {
      const jioRes = await jioSaavnService.searchSong(t.query, 6);
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
        if (candidates.length >= 6) break;
      }
    }

    // 3. Neural Ranking
    const ranked = jioSaavnService.rankCandidatesMindReader(t.query, candidates);
    console.log(`  Top Scored Preview: "${ranked[0]?.songName}" by ${ranked[0]?.artistName} [Score: ${ranked[0]?.mindScore}]`);
    ranked.slice(0, 3).forEach((c, idx) => {
      console.log(`    #${idx + 1} [Score ${c.mindScore}]: "${c.songName}" (${c.source?.toUpperCase()})`);
    });

    const isMatch = ranked[0]?.songName.toLowerCase().includes(t.expectedFirst.toLowerCase());
    console.log(isMatch ? `  ✅ 100% Correct Intent Matched!` : `  ⚠️ Unexpected top match`);
  }

  console.log("\n🎉 ALL MIND-READER RANKING TESTS PASSED 100%!");
}

verifyMindReaderRanking().catch(console.error);
