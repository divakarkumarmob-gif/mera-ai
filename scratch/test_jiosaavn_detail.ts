import CryptoJS from "crypto-js";

function decryptUrl(encryptedBase64: string): string {
  const key = CryptoJS.enc.Utf8.parse("38346591");
  const decrypted = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(encryptedBase64) } as any,
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  );
  return decrypted.toString(CryptoJS.enc.Utf8);
}

async function testSongDetail() {
  const autoUrl = "https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=Kesariya";
  const res = await fetch(autoUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }
  });
  const data = await res.json();
  const topSong = data?.songs?.data?.[0];
  console.log("Top Song ID:", topSong?.id, "Title:", topSong?.title);

  if (topSong?.id) {
    const detailUrl = `https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${topSong.id}&_format=json&_marker=0&cc=in`;
    const dRes = await fetch(detailUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      }
    });
    const dData = await dRes.json();
    const songObj = dData[topSong.id] || dData?.songs?.[0] || Object.values(dData)[0] as any;
    const encUrl = songObj?.encrypted_media_url || songObj?.more_info?.encrypted_media_url;
    console.log("Song Encrypted URL:", encUrl);

    if (encUrl) {
      const dec = decryptUrl(encUrl);
      console.log("🎉 100% DECRYPTED AUDIO CDN URL:", dec);
      const url320 = dec.replace(/_48\.mp4|_96\.mp4|_160\.mp4|_320\.mp4/g, "") + "_320.mp4";
      console.log("⚡ 320KBPS STREAM URL:", url320);
    }
  }
}

testSongDetail().catch(console.error);
