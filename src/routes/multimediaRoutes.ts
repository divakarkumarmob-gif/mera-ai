import { Router } from "express";
import { jioSaavnService } from "../services/jioSaavnService";
import { youtubeMusicService } from "../services/youtubeMusicService";
import { voicePersonaService } from "../services/voicePersonaService";
import { toolsEngine } from "../services/toolsEngine";
import { publicApisService } from "../services/publicApisService";
import { geminiKeyPoolService } from "../services/geminiKeyPoolService";

export function createMultimediaRouter(): Router {
  const router = Router();

  // ── Voice Options & Preferences ───────────────────────────────────────────
  const VOICE_CATEGORIES_API = {
    female: [
      { name: "Aoede", style: "Breezy" }, { name: "Kore", style: "Firm" },
      { name: "Zephyr", style: "Bright" }, { name: "Autonoe", style: "Bright" },
      { name: "Erinome", style: "Clear" }, { name: "Laomedeia", style: "Upbeat" },
      { name: "Schedar", style: "Even" }, { name: "Achernar", style: "Soft" },
      { name: "Leda", style: "Youthful" }, { name: "Callirrhoe", style: "Easy-going" },
      { name: "Despina", style: "Smooth" }, { name: "Vindemiatrix", style: "Gentle" },
      { name: "Sulafat", style: "Warm" }, { name: "Pulcherrima", style: "Forward" },
      { name: "Sadachbia", style: "Lively" },
    ],
    male: [
      { name: "Puck", style: "Upbeat" }, { name: "Charon", style: "Informative" },
      { name: "Fenrir", style: "Excitable" }, { name: "Orus", style: "Firm" },
      { name: "Umbriel", style: "Easy-going" }, { name: "Achird", style: "Friendly" },
      { name: "Enceladus", style: "Breathy" }, { name: "Algieba", style: "Smooth" },
      { name: "Algenib", style: "Gravelly" }, { name: "Gacrux", style: "Mature" },
      { name: "Zubenelgenubi", style: "Casual" }, { name: "Sadaltager", style: "Knowledgeable" },
      { name: "Iapetus", style: "Clear" }, { name: "Rasalgethi", style: "Informative" },
      { name: "Alnilam", style: "Firm" },
    ],
  };

  router.get("/api/voices/saved-preference", async (_req, res) => {
    try {
      const prefs = await voicePersonaService.getSavedPreferences();
      res.json({ ok: true, ...prefs });
    } catch (e: any) {
      res.json({ ok: false, voiceName: "Aoede" });
    }
  });

  router.get("/api/voices", (_req, res) => {
    res.json({
      ok: true,
      total: 30,
      categories: VOICE_CATEGORIES_API,
      all: [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male],
    });
  });

  router.post("/api/voices/suggest", (req, res) => {
    try {
      const { gender, style, voiceName } = req.body || {};

      if (voiceName) {
        const allVoices = [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male];
        const found = allVoices.find(v => v.name.toLowerCase() === String(voiceName).toLowerCase());
        if (found) {
          const gen = VOICE_CATEGORIES_API.female.find(v => v.name === found.name) ? "female" : "male";
          return res.json({ ok: true, suggested: found.name, style: found.style, gender: gen, message: `${found.name} voice (${found.style}) suggest ki gayi hai` });
        }
        return res.status(404).json({ ok: false, error: "Voice not found" });
      }

      const pool = gender === "male"
        ? VOICE_CATEGORIES_API.male
        : gender === "female"
        ? VOICE_CATEGORIES_API.female
        : [...VOICE_CATEGORIES_API.female, ...VOICE_CATEGORIES_API.male];

      const stylePool = style
        ? pool.filter(v => v.style.toLowerCase().includes(String(style).toLowerCase()))
        : pool;

      const pick = stylePool.length > 0
        ? stylePool[Math.floor(Math.random() * stylePool.length)]
        : pool[Math.floor(Math.random() * pool.length)];

      const pickedGender = VOICE_CATEGORIES_API.female.find(v => v.name === pick.name) ? "female" : "male";

      res.json({
        ok: true,
        suggested: pick.name,
        style: pick.style,
        gender: pickedGender,
        message: `${pick.name} voice suggest ki — ${pickedGender === "female" ? "♀ Female" : "♂ Male"}, style: ${pick.style}`,
        instruction: `Frontend pe selectedVoice ko "${pick.name}" set karo aur session reinitialize karo`,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── Music Streaming & Search ──────────────────────────────────────────────
  router.get("/api/music/proxy-stream", async (req, res) => {
    try {
      const audioUrl = String(req.query.url || "");
      if (!audioUrl || (!audioUrl.startsWith("http://") && !audioUrl.startsWith("https://"))) {
        return res.status(400).send("Valid audio 'url' parameter is required.");
      }

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://www.jiosaavn.com/",
        "Accept": "*/*",
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range as string;
      }

      const response = await fetch(audioUrl, { headers });
      if (!response.ok) {
        return res.status(response.status).send(`Upstream audio fetch failed: ${response.statusText}`);
      }

      res.status(response.status);
      res.set({
        "Content-Type": response.headers.get("content-type") || "audio/mp4",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Cache-Control": "public, max-age=86400",
      });

      if (response.headers.get("content-range")) {
        res.set("Content-Range", response.headers.get("content-range")!);
      }
      if (response.headers.get("content-length")) {
        res.set("Content-Length", response.headers.get("content-length")!);
      }

      const arrayBuffer = await response.arrayBuffer();
      res.end(Buffer.from(arrayBuffer));
    } catch (e: any) {
      if (!res.headersSent) res.status(500).send(`Audio proxy streaming failed: ${e?.message || e}`);
    }
  });

  router.get("/api/music/lyrics", async (req, res) => {
    const query = String(req.query.query || "");
    if (!query) return res.status(400).json({ success: false, message: "Query required" });
    try {
      const searchRes = await jioSaavnService.searchSong(query);
      if (searchRes.success && searchRes.topSong?.id) {
        const lyricsRes = await jioSaavnService.getLyrics(searchRes.topSong.id);
        if (lyricsRes.success) {
          return res.json({ success: true, lyrics: lyricsRes.lyrics, copyright: lyricsRes.copyright });
        }
      }
      res.json({ success: false, message: "Lyrics not found" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  router.get("/api/music/search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (!query) return res.status(400).json({ success: false, message: "Query required" });
    try {
      const searchRes = await jioSaavnService.searchSong(query);
      res.json(searchRes);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  router.get("/api/music/queue", async (req, res) => {
    try {
      const songName = String(req.query.songName || req.query.song || "");
      const artistName = String(req.query.artistName || req.query.artist || "");
      const albumName = String(req.query.albumName || req.query.album || "");

      if (songName || artistName) {
        const queue = await jioSaavnService.getSmartQueue({ songName, artistName, albumName });
        if (queue && queue.length > 0) {
          return res.json({ success: true, count: queue.length, queue });
        }
      }

      const searchRes = await publicApisService.searchMusic(songName || artistName || "Bollywood Hits");
      return res.json({ success: true, queue: searchRes?.tracks || [] });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e, queue: [] });
    }
  });

  router.get("/api/youtube/stream-audio", async (req, res) => {
    const videoId = String(req.query.v || "");
    if (!videoId) return res.status(400).json({ error: "videoId_required" });

    try {
      const streamUrl = await youtubeMusicService.getAudioStreamUrl(videoId);
      if (streamUrl) {
        return res.redirect(streamUrl);
      }
      return res.status(404).json({ error: "audio_stream_not_found" });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "stream_fetch_failed" });
    }
  });

  // ── Perchance AI Photo Studio Endpoints ────────────────────────────────────
  router.get("/api/perchance/status", async (_req, res) => {
    try {
      const { perchanceService } = await import("../services/perchanceService");
      res.json({ ok: true, status: (perchanceService as any).getStatus?.() || { ready: true } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/perchance/jobs/create", async (req, res) => {
    try {
      const { perchanceService } = await import("../services/perchanceService");
      const { prompt, negativePrompt, resolution, style, character, customInstructions } = req.body || {};
      if (!prompt) return res.status(400).json({ ok: false, error: "Prompt is required" });

      const job = await (perchanceService as any).createGenerationJob?.({
        prompt,
        negativePrompt,
        resolution,
        style,
        character,
        customInstructions,
      }) || { id: "job_" + Date.now(), status: "queued" };
      res.json({ ok: true, job });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/perchance/jobs/:jobId/status", async (req, res) => {
    try {
      const { perchanceService } = await import("../services/perchanceService");
      const job = (perchanceService as any).getJobStatus?.(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
      res.json({ ok: true, job });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/perchance/generate-stream", async (req, res) => {
    try {
      const { perchanceService } = await import("../services/perchanceService");
      const prompt = String(req.query.prompt || "").trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "Prompt is required" });

      const result = await (perchanceService as any).generateImageDirect?.(prompt) || (perchanceService as any).generateImage?.(prompt);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/perchance/chat", async (req, res) => {
    try {
      const { perchanceService } = await import("../services/perchanceService");
      const { characterUrl, userMessage, timeoutMs } = req.body || {};
      if (!characterUrl || !userMessage) {
        return res.status(400).json({ ok: false, error: "characterUrl and userMessage are required" });
      }

      const result = await perchanceService.chatWithCharacter(
        String(characterUrl),
        String(userMessage),
        Number(timeoutMs) || 45000
      );

      return res.json({
        ok: result.success,
        characterName: result.characterName,
        reply: result.replyText,
        avatar: result.characterAvatar,
        durationMs: result.durationMs,
        logs: result.logs,
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Internal server error during character chat",
      });
    }
  });

  // ── Photo Generation & Direct Delivery ─────────────────────────────────────
  router.post("/api/generate-photo", async (req, res) => {
    try {
      const { prompt, aspectRatio, sendToWhatsApp, targetRecipient } = req.body || {};
      if (!prompt || !String(prompt).trim()) {
        return res.status(400).json({ ok: false, error: "Prompt is required" });
      }

      const result = await toolsEngine.generateAiPhoto(String(prompt).trim(), {
        aspectRatio: aspectRatio || "9:16",
        sendToWhatsApp: !!sendToWhatsApp,
        targetRecipient: targetRecipient || "boss",
      });

      res.json({ ok: result.success, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to generate photo" });
    }
  });

  router.post("/api/whatsapp/send-photo", async (req, res) => {
    try {
      const { contactNameOrPhone, imageBase64, imageUrl, caption } = req.body || {};
      let imagePayload: any = imageUrl;
      if (imageBase64) {
        const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        imagePayload = Buffer.from(cleanB64, "base64");
      }

      if (!imagePayload) {
        return res.status(400).json({ ok: false, error: "Image data or URL is required" });
      }

      const sendRes = await toolsEngine.sendPhotoToWhatsApp(
        contactNameOrPhone || "boss",
        imagePayload,
        caption || "📸 Photo from Friday AI"
      );

      res.json({ ok: sendRes.success, ...sendRes });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Failed to send photo on WhatsApp" });
    }
  });

  // ── Model Sandbox Tester ──────────────────────────────────────────────────
  router.post("/api/model-tester/chat", async (req, res) => {
    const startTime = Date.now();
    try {
      const {
        model = "gemini-3.5-flash",
        prompt,
        history = [],
        attachments = [],
      } = req.body || {};

      let actualModelUsed = model;
      let responseText = "";
      let generatedImageUrl: string | null = null;
      let generatedAudioUrl: string | null = null;

      const contents: any[] = [];
      for (const h of history) {
        contents.push({
          role: h.role === "assistant" || h.role === "model" ? "model" : "user",
          parts: [{ text: h.text || h.content || "" }],
        });
      }

      const currentParts: any[] = [];
      if (prompt) currentParts.push({ text: String(prompt) });
      for (const att of attachments) {
        if (att.data && att.mimeType) {
          currentParts.push({
            inlineData: {
              data: att.data.replace(/^data:.*?;base64,/, ""),
              mimeType: att.mimeType,
            },
          });
        }
      }
      if (currentParts.length > 0) {
        contents.push({ role: "user", parts: currentParts });
      }

      const genOptions: any = {
        model: actualModelUsed,
        contents,
      };

      if (actualModelUsed.includes("search-grounding") || actualModelUsed.includes("grounding") || actualModelUsed === "deep-research-pro-preview") {
        genOptions.tools = [{ googleSearch: {} }];
      }

      const allocation = geminiKeyPoolService.getOptimalClient({ priority: "background" });
      const ai = allocation.client;

      try {
        const response = await ai.models.generateContent(genOptions);
        geminiKeyPoolService.recordSuccess(allocation.keyIndex);
        responseText = response.text || "(No response text returned by model)";
      } catch (primaryErr: any) {
        console.warn(`[ModelTester] Direct call failed for '${actualModelUsed}' on Key #${allocation.keyIndex + 1}:`, primaryErr?.message || primaryErr);
        const errMsg = String(primaryErr?.message || primaryErr);
        if (primaryErr?.status === 429 || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
          geminiKeyPoolService.recordRateLimitError(allocation.keyIndex);
        } else {
          geminiKeyPoolService.recordGenericError(allocation.keyIndex);
        }

        const fallbackClient = geminiKeyPoolService.getOptimalClient({ priority: "background" }).client;
        const fallbackModel = "gemini-3.6-flash";
        const fallbackOptions: any = { model: fallbackModel, contents };
        const fallbackRes = await fallbackClient.models.generateContent(fallbackOptions);
        responseText = fallbackRes.text || "(Response generated via fallback engine)";
        actualModelUsed = `${model} (via ${fallbackModel})`;
      }

      const durationMs = Date.now() - startTime;

      res.json({
        ok: true,
        reply: responseText,
        text: responseText,
        isImage: !!generatedImageUrl,
        imageUrl: generatedImageUrl,
        isAudio: !!generatedAudioUrl,
        audioUrl: generatedAudioUrl,
        modelUsed: actualModelUsed,
        model,
        latencyMs: durationMs,
        durationMs,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || "Failed to generate content with selected model",
        durationMs: Date.now() - startTime,
      });
    }
  });

  return router;
}
