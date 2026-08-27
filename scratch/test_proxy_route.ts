import http from "http";
import express from "express";

async function testExpressProxy() {
  const app = express();
  app.get("/api/music/proxy-stream", async (req, res) => {
    const rawUrl = String(req.query.url || "");
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      const audioRes = await fetch(rawUrl, { headers });

      res.status(audioRes.status);
      res.set({
        "Content-Type": audioRes.headers.get("content-type") || "audio/mp4",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      });

      if (audioRes.headers.get("content-range")) {
        res.set("Content-Range", audioRes.headers.get("content-range")!);
      }
      if (audioRes.headers.get("content-length")) {
        res.set("Content-Length", audioRes.headers.get("content-length")!);
      }

      const arrayBuf = await audioRes.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (e: any) {
      res.status(500).send("Proxy error");
    }
  });

  const server = app.listen(3999, async () => {
    const testUrl = "http://localhost:3999/api/music/proxy-stream?url=" + encodeURIComponent("https://aac.saavncdn.com/620/88d6c002c9e9f38cf1fd72e4a257e630_320.mp4");
    const r = await fetch(testUrl, {
      headers: { Range: "bytes=0-1024" }
    });
    console.log("Status:", r.status);
    console.log("Content-Range:", r.headers.get("content-range"));
    console.log("Content-Type:", r.headers.get("content-type"));
    console.log("Content-Length:", r.headers.get("content-length"));
    console.log("Result:", r.status === 206 ? "✅ PERFECT 206 STREAMING" : "FAILED");
    server.close();
  });
}

testExpressProxy().catch(console.error);
