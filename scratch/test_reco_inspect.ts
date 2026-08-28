import { jioSaavnService } from "../src/services/jioSaavnService";

async function inspectReco() {
  const songRes = await jioSaavnService.searchSong("Kesariya", 1);
  if (!songRes.topSong) return;

  const recoUrl = `https://www.jiosaavn.com/api.php?__call=reco.getreco&_format=json&_marker=0&cc=in&includeMetaTags=1&pid=${songRes.topSong.id}`;
  const res = await fetch(recoUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    }
  });
  const text = await res.text();
  console.log("Raw Response:", text.slice(0, 500));
}

inspectReco().catch(console.error);
