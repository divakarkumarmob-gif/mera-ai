import { jioSaavnService } from "../src/services/jioSaavnService";

async function inspectActor() {
  const res = await jioSaavnService.searchSong("sehra bandh ke amir khan", 5);
  console.log("JioSaavn Result Count:", res.count);
  res.songs.forEach((s, idx) => {
    console.log(`${idx+1}. "${s.songName}" by ${s.artistName} | starring: "${s.starring}" | album: "${s.albumName}"`);
  });
}
inspectActor();
