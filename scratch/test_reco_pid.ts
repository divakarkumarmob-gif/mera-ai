import { jioSaavnService } from "../src/services/jioSaavnService";

async function testRecoWithPid() {
  const songRes = await jioSaavnService.searchSong("Kesariya", 1);
  if (!songRes.topSong) return;

  const recoUrl = `https://www.jiosaavn.com/api.php?__call=reco.getreco&_format=json&_marker=0&cc=in&includeMetaTags=1&pid=${songRes.topSong.id}`;
  const res = await fetch(recoUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    }
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Is Array?", Array.isArray(data));
  console.log("Length:", data.length);
  if (Array.isArray(data) && data.length > 0) {
    data.slice(0, 3).forEach((item: any, i: number) => {
      console.log(`Reco ${i+1}: "${item.song || item.title}" by ${item.primary_artists || item.singers} [${item.album}]`);
    });
  }
}

testRecoWithPid().catch(console.error);
