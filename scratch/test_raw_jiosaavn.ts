async function testRaw() {
  const url = "https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=Kesariya";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response (first 500 chars):", text.slice(0, 500));
}

testRaw().then(() => process.exit(0));
