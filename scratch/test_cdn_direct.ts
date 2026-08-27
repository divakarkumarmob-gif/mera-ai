async function checkCdnDirect() {
  const url = "https://aac.saavncdn.com/620/88d6c002c9e9f38cf1fd72e4a257e630_320.mp4";
  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "http://localhost:3000"
    }
  });
  console.log("Status:", res.status);
  console.log("All Headers:");
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
}

checkCdnDirect().catch(console.error);
