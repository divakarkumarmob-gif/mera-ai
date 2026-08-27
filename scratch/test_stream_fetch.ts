import { jioSaavnService } from "../src/services/jioSaavnService";

async function testStreamFetch() {
  const res = await jioSaavnService.searchSong("Raanjhanaa");
  console.log("Search Result:", res.success ? "Found song" : "Not found");
  if (res.topSong) {
    console.log("Song:", res.topSong.songName);
    console.log("320kbps URL:", res.topSong.audio320kbps);
    console.log("160kbps URL:", res.topSong.audio160kbps);
    console.log("96kbps URL:", res.topSong.audio96kbps);

    // Test fetching all bitrates from server
    for (const [quality, url] of [["320", res.topSong.audio320kbps], ["160", res.topSong.audio160kbps], ["96", res.topSong.audio96kbps]]) {
      try {
        const fetchRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Range": "bytes=0-100",
          }
        });
        console.log(`Status for ${quality}kbps:`, fetchRes.status, "Content-Type:", fetchRes.headers.get("content-type"), "Content-Length:", fetchRes.headers.get("content-length"));
      } catch (err: any) {
        console.log(`Fetch error for ${quality}kbps:`, err?.message || err);
      }
    }
  }
}

testStreamFetch().catch(console.error);
