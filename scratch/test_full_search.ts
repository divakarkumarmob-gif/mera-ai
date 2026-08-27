import CryptoJS from "crypto-js";

function decryptUrl(encryptedBase64: string): string {
  if (!encryptedBase64) return "";
  try {
    const key = CryptoJS.enc.Utf8.parse("38346591");
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encryptedBase64) } as any,
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    return decrypted.toString(CryptoJS.enc.Utf8).trim();
  } catch {
    return "";
  }
}

async function testFullSearch(query: string) {
  console.log(`\n=== Testing Full Search for: "${query}" ===`);
  const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=15&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    console.log("Could not parse JSON. Raw:", text.slice(0, 200));
  }

  const results = data?.results || [];
  console.log(`Found ${results.length} results.`);
  for (const item of results.slice(0, 5)) {
    const enc = item.more_info?.encrypted_media_url || item.encrypted_media_url;
    const dec = decryptUrl(enc);
    console.log(`- [${item.id}] ${item.title} | Artist: ${item.more_info?.primary_artists || item.primary_artists} | 320k: ${dec ? "✅" : "❌"} | Decrypted: ${dec.slice(0, 60)}...`);
  }
}

async function main() {
  await testFullSearch("Raanjhanaa");
  await testFullSearch("Tum Hi Ho");
  await testFullSearch("Pehle Bhi Main");
  await testFullSearch("Hass Hass");
  await testFullSearch("King Tu Aake Dekhle");
}

main().catch(console.error);
