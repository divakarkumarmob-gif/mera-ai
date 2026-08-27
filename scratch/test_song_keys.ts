async function printSongKeys() {
  const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=2&q=Kesariya`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  });
  const data = await res.json();
  console.log("Sample Song Object:", JSON.stringify(data.results[0], null, 2));
}

printSongKeys().catch(console.error);
