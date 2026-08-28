import { jioSaavnService } from "../src/services/jioSaavnService";

async function testRecommendations() {
  const songRes = await jioSaavnService.searchSong("Kesariya", 1);
  if (!songRes.topSong) {
    console.log("No song found");
    return;
  }
  console.log("Testing Recommendations for:", songRes.topSong.songName, "ID:", songRes.topSong.id);

  const recoUrl = `https://www.jiosaavn.com/api.php?__call=reco.getreco&_format=json&_marker=0&cc=in&includeMetaTags=1&song_id=${songRes.topSong.id}`;
  const res = await fetch(recoUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    }
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Raw preview:", text.slice(0, 300));
}

testRecommendations().catch(console.error);
