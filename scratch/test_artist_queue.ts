import { jioSaavnService } from "../src/services/jioSaavnService";

async function testArtistQueue() {
  const songRes = await jioSaavnService.searchSong("Kesariya", 1);
  if (!songRes.topSong) return;
  console.log("Current song:", songRes.topSong.songName, "Artist:", songRes.topSong.artistName);

  // Generate smart queue from same artist / genre hits
  const artist = songRes.topSong.artistName.split(",")[0].trim();
  const queueRes = await jioSaavnService.searchSong(`${artist} Best Hits`, 15);
  console.log(`Generated Smart Queue (${queueRes.count} songs):`);
  queueRes.songs.forEach((s, idx) => {
    console.log(`  ${idx+1}. "${s.songName}" by ${s.artistName} [${s.albumName}]`);
  });
}

testArtistQueue().catch(console.error);
