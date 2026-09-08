import { GoogleGenAI } from "@google/genai";

export interface YouTubeTimedCue {
  start: number; // in seconds
  duration: number; // in seconds
  startFormatted: string; // e.g. "02:15"
  text: string;
}

export interface YouTubeChapter {
  title: string;
  start: number;
  startFormatted: string;
  summary: string;
  timestampUrl: string;
}

export interface YouTubeVideoAnalysis {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  durationFormatted?: string;
  durationSeconds?: number;
  thumbnailUrl: string;
  summary: string;
  keyTakeaways: string[];
  chapters: YouTubeChapter[];
  hasTranscript: boolean;
  totalCues: number;
}

export class YouTubeService {
  private static readonly MODEL_FALLBACK_CHAIN = [
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  /**
   * Extracts YouTube Video ID from any standard URL, short URL, or Shorts link.
   */
  public extractVideoId(url: string): string | null {
    if (!url) return null;
    const clean = url.trim();

    // Standard: https://www.youtube.com/watch?v=dQw4w9WgXcQ
    const standardMatch = clean.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i);
    if (standardMatch) return standardMatch[1];

    // Short: https://youtu.be/dQw4w9WgXcQ
    const shortMatch = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
    if (shortMatch) return shortMatch[1];

    // Query param: ?v=dQw4w9WgXcQ
    const queryMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
    if (queryMatch) return queryMatch[1];

    // Raw ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;

    return null;
  }

  public formatSeconds(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const remSecs = s % 60;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;

    if (hrs > 0) {
      return `${hrs}:${remMins.toString().padStart(2, "0")}:${remSecs.toString().padStart(2, "0")}`;
    }
    return `${remMins.toString().padStart(2, "0")}:${remSecs.toString().padStart(2, "0")}`;
  }

  /**
   * Fetches metadata (Title, Author, Thumbnail) for a YouTube video via OEMBED.
   */
  public async getVideoMetadata(videoId: string): Promise<{
    title: string;
    authorName: string;
    thumbnailUrl: string;
  }> {
    const defaultThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const res = await fetch(oembedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          title: data.title || `YouTube Video (${videoId})`,
          authorName: data.author_name || "YouTube Creator",
          thumbnailUrl: data.thumbnail_url || defaultThumbnail,
        };
      }
    } catch (e) {
      console.warn(`[YouTubeService] OEmbed fetch fallback for ${videoId}:`, e);
    }

    return {
      title: `YouTube Video (${videoId})`,
      authorName: "YouTube Creator",
      thumbnailUrl: defaultThumbnail,
    };
  }

  /**
   * Extracts timed captions / subtitles transcript from YouTube webpage or timedtext API.
   */
  public async getTimedTranscript(videoId: string): Promise<YouTubeTimedCue[]> {
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const pageRes = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
        },
      });

      if (!pageRes.ok) return [];
      const html = await pageRes.text();

      // Look for captionTracks in ytInitialPlayerResponse
      const match = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (!match) return [];

      const tracks = JSON.parse(match[1]);
      if (!Array.isArray(tracks) || tracks.length === 0) return [];

      // Prefer English or Hindi or the first track
      const selectedTrack =
        tracks.find((t: any) => t.languageCode === "en" || t.languageCode === "hi") ||
        tracks[0];

      if (!selectedTrack?.baseUrl) return [];

      // Fetch timedtext XML
      const transcriptRes = await fetch(selectedTrack.baseUrl);
      if (!transcriptRes.ok) return [];
      const xml = await transcriptRes.text();

      const cues: YouTubeTimedCue[] = [];
      const textNodeRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
      let textMatch: RegExpExecArray | null;

      while ((textMatch = textNodeRegex.exec(xml)) !== null) {
        const startSec = parseFloat(textMatch[1]);
        const durSec = textMatch[2] ? parseFloat(textMatch[2]) : 3.0;
        let cueText = textMatch[3]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\n/g, " ")
          .trim();

        if (cueText) {
          cues.push({
            start: startSec,
            duration: durSec,
            startFormatted: this.formatSeconds(startSec),
            text: cueText,
          });
        }
      }

      return cues;
    } catch (e) {
      console.warn(`[YouTubeService] Transcript extraction failed for ${videoId}:`, e);
      return [];
    }
  }

  /**
   * Generates a comprehensive "Ask Gemini" style breakdown:
   * Executive summary, key takeaways, and timestamped chapters with clickable URLs.
   */
  public async analyzeVideo(urlOrId: string): Promise<YouTubeVideoAnalysis> {
    const videoId = this.extractVideoId(urlOrId);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL or Video ID: "${urlOrId}"`);
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const [meta, cues] = await Promise.all([
      this.getVideoMetadata(videoId),
      this.getTimedTranscript(videoId),
    ]);

    const hasTranscript = cues.length > 0;
    let fullTranscriptText = "";
    if (hasTranscript) {
      fullTranscriptText = cues
        .map((c) => `[${c.startFormatted}] ${c.text}`)
        .join("\n");
    }

    // Build prompt for Gemini Multi-Tier fallback
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return {
        videoId,
        url: videoUrl,
        title: meta.title,
        channelName: meta.authorName,
        thumbnailUrl: meta.thumbnailUrl,
        summary: `YouTube video "${meta.title}" by ${meta.authorName}. (${cues.length} transcript lines extracted).`,
        keyTakeaways: ["Key insights require GEMINI_API_KEY."],
        chapters: cues.slice(0, 5).map((c) => ({
          title: c.text.slice(0, 40),
          start: c.start,
          startFormatted: c.startFormatted,
          summary: c.text,
          timestampUrl: `https://youtu.be/${videoId}?t=${Math.floor(c.start)}`,
        })),
        hasTranscript,
        totalCues: cues.length,
      };
    }

    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are FRIDAY — Boss Divakar Kumar's (DK's) elite AI Video Intelligence specialist.
Analyze this YouTube video:
• Title: "${meta.title}"
• Channel / Creator: "${meta.authorName}"
• Video URL: "${videoUrl}"
• Has Timed Transcript: ${hasTranscript ? "YES" : "NO"}

${
  hasTranscript
    ? `TIMED TRANSCRIPT (Timestamp format [MM:SS]):\n${fullTranscriptText.slice(0, 30000)}`
    : `Note: Transcript is unavailable. Provide best estimated chapter outline and summary based on the title and creator context.`
}

Provide output strictly formatted in valid JSON with this exact schema:
{
  "summary": "2-3 paragraph thorough executive summary explaining the main message, narrative, and value of the video in respectful conversational Hinglish.",
  "keyTakeaways": [
    "5 to 7 sharp, high-value bullet takeaways and lessons learned from the video"
  ],
  "chapters": [
    {
      "title": "Short descriptive chapter title",
      "startSeconds": 0,
      "summary": "Brief 1-line explanation of what happens in this segment"
    }
  ]
}`;

    let parsedResult: any = null;

    for (const model of YouTubeService.MODEL_FALLBACK_CHAIN) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const raw = resp.text?.trim();
        if (raw) {
          parsedResult = JSON.parse(raw);
          break;
        }
      } catch (e: any) {
        console.warn(`[YouTubeService] Gemini model ${model} failed for video analysis:`, e?.message || e);
      }
    }

    const chapters: YouTubeChapter[] = (parsedResult?.chapters || []).map((ch: any) => {
      const startSec = Number(ch.startSeconds || 0);
      return {
        title: ch.title || "Chapter",
        start: startSec,
        startFormatted: this.formatSeconds(startSec),
        summary: ch.summary || "",
        timestampUrl: `https://youtu.be/${videoId}?t=${Math.floor(startSec)}`,
      };
    });

    return {
      videoId,
      url: videoUrl,
      title: meta.title,
      channelName: meta.authorName,
      thumbnailUrl: meta.thumbnailUrl,
      summary: parsedResult?.summary || `Video summary for "${meta.title}"`,
      keyTakeaways: parsedResult?.keyTakeaways || [],
      chapters: chapters.length > 0 ? chapters : [],
      hasTranscript,
      totalCues: cues.length,
    };
  }

  /**
   * "Ask Gemini" Question Answering Engine:
   * Answers exact questions about what was said, code shown, or topics explained at specific seconds in the video.
   */
  public async queryVideoTimestamp(
    urlOrId: string,
    question: string
  ): Promise<{
    answer: string;
    exactTimestamp?: string;
    timestampSeconds?: number;
    timestampUrl?: string;
    contextFound: boolean;
  }> {
    const videoId = this.extractVideoId(urlOrId);
    if (!videoId) {
      return {
        answer: `Invalid YouTube video URL: ${urlOrId}`,
        contextFound: false,
      };
    }

    const cues = await this.getTimedTranscript(videoId);
    const meta = await this.getVideoMetadata(videoId);
    const fullTranscriptText = cues.map((c) => `[${c.startFormatted}] ${c.text}`).join("\n");

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return {
        answer: `Boss, YouTube timestamp answer karne ke liye GEMINI_API_KEY zaroori hai.`,
        contextFound: false,
      };
    }

    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are FRIDAY — YouTube "Ask Gemini" Real-Time Video Assistant.
The user (Boss DK) is asking a specific question about the video "${meta.title}" (by ${meta.authorName}).

User Question: "${question}"

TIMED VIDEO TRANSCRIPT:
${fullTranscriptText.slice(0, 32000)}

INSTRUCTIONS:
1. Locate the EXACT timestamp ([MM:SS] or [HH:MM:SS]) where this topic, code, or dialogue happens.
2. Explain clearly in friendly conversational Hinglish what the speaker said, what happens at that timestamp, and the exact answer.
3. Return JSON:
{
  "exactTimestamp": "MM:SS",
  "startSeconds": 125,
  "answer": "Clear explanation citing the exact timestamp and what was said."
}`;

    for (const model of YouTubeService.MODEL_FALLBACK_CHAIN) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const raw = resp.text?.trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          const secs = Number(parsed.startSeconds || 0);
          return {
            answer: parsed.answer,
            exactTimestamp: parsed.exactTimestamp || this.formatSeconds(secs),
            timestampSeconds: secs,
            timestampUrl: `https://youtu.be/${videoId}?t=${secs}`,
            contextFound: true,
          };
        }
      } catch (e: any) {
        console.warn(`[YouTubeService] Gemini model ${model} failed for query timestamp:`, e?.message || e);
      }
    }

    return {
      answer: `Boss, video transcript me "${question}" ke baare me exact timestamp locate nahi ho paya.`,
      contextFound: false,
    };
  }
}

export const youtubeService = new YouTubeService();
