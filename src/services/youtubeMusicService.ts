/**
 * YouTube Music Safe Service for FRIDAY (mera-ai)
 * Pure, Adware-Free, Privacy-Focused YouTube Audio & Video Intelligence Engine.
 * Supports: Background audio stream extraction, Invidious/Piped fallback, high-res artwork, and MediaSession integration.
 */

export interface YouTubeMusicTrack {
  id: string;
  videoId: string;
  songName: string;
  artistName: string;
  albumName?: string;
  durationSec?: number;
  durationFormatted?: string;
  albumArt: string;
  albumArtHighRes: string;
  audioUrl?: string;
  streamUrl: string;
  embedUrl: string;
  youtubeUrl: string;
  youtubeMusicUrl: string;
  isYouTube: boolean;
  isFullSong: boolean;
  quality: string;
  source: "youtube_safe" | "jiosaavn_hd" | "invidious";
}

export interface YouTubeMusicSearchResult {
  success: boolean;
  query: string;
  count: number;
  tracks: YouTubeMusicTrack[];
  topTrack?: YouTubeMusicTrack;
  message: string;
}

class YouTubeMusicService {
  private readonly USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  ];

  private readonly INVIDIOUS_INSTANCES = [
    "https://inv.tux.pizza",
    "https://invidious.nerdvpn.de",
    "https://yt.artemislena.eu",
    "https://invidious.drgns.space",
    "https://invidious.flokinet.to",
  ];

  /**
   * Search YouTube for music tracks and return structured, safe metadata.
   */
  public async searchTracks(query: string, limit = 15): Promise<YouTubeMusicSearchResult> {
    let cleanQuery = (query || "").trim();
    if (!cleanQuery) {
      return { success: false, query, count: 0, tracks: [], message: "Query zaroori hai." };
    }

    // Clean voice command noise
    cleanQuery = cleanQuery.replace(/\b(gana|gaana|song|music|chalao|bajao|sunao|play|laga|lagao|on youtube|youtube par|youtube pe)\b/gi, "").trim();
    const effectiveQuery = cleanQuery || query.trim();

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(effectiveQuery + " official audio song")}&sp=EgIQAQ%253D%253D`;
      const res = await fetch(searchUrl, {
        headers: {
          "User-Agent": this.USER_AGENTS[0],
          "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        return this.fallbackSearch(effectiveQuery, limit);
      }

      const html = await res.text();
      const tracks = this.parseYouTubeSearchResults(html, limit);

      if (tracks.length === 0) {
        return this.fallbackSearch(effectiveQuery, limit);
      }

      return {
        success: true,
        query: effectiveQuery,
        count: tracks.length,
        tracks,
        topTrack: tracks[0],
        message: `Boss, YouTube par "${effectiveQuery}" ke ${tracks.length} safe background audio tracks mil gaye! 🎵🔴`,
      };
    } catch (e: any) {
      console.warn("[YouTubeMusicService] Search error:", e);
      return this.fallbackSearch(effectiveQuery, limit);
    }
  }

  /**
   * Parses standard YouTube Search Results HTML safely without external dependencies.
   */
  private parseYouTubeSearchResults(html: string, limit: number): YouTubeMusicTrack[] {
    const tracks: YouTubeMusicTrack[] = [];
    const seenIds = new Set<string>();

    try {
      // Find ytInitialData JSON in HTML
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/) ||
                         html.match(/var ytInitialData\s*=\s*({.+?});/);

      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const sectionList = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        
        for (const sec of sectionList) {
          const itemSection = sec?.itemSectionRenderer?.contents || [];
          for (const item of itemSection) {
            const videoRenderer = item?.videoRenderer;
            if (!videoRenderer || !videoRenderer.videoId) continue;

            const videoId = videoRenderer.videoId;
            if (seenIds.has(videoId)) continue;
            seenIds.add(videoId);

            const title = videoRenderer.title?.runs?.[0]?.text || "YouTube Song";
            const channel = videoRenderer.ownerText?.runs?.[0]?.text || "YouTube Creator";
            const durationText = videoRenderer.lengthText?.simpleText || "";
            const durationSec = this.parseDurationToSeconds(durationText);

            tracks.push(this.buildTrackObject(videoId, title, channel, durationSec, durationText));
            if (tracks.length >= limit) break;
          }
          if (tracks.length >= limit) break;
        }
      }
    } catch (parseErr) {
      console.warn("[YouTubeMusicService] Parsing ytInitialData failed, using regex fallback:", parseErr);
    }

    // Regex fallback if JSON parser didn't yield enough results
    if (tracks.length === 0) {
      const videoRegex = /"videoId":"([a-zA-Z0-9_-]{11})".+?"title":\{"runs":\[\{"text":"([^"]+)"\}\].+?"ownerText":\{"runs":\[\{"text":"([^"]+)"\}\]/g;
      let match: RegExpExecArray | null;

      while ((match = videoRegex.exec(html)) !== null && tracks.length < limit) {
        const videoId = match[1];
        if (seenIds.has(videoId)) continue;
        seenIds.add(videoId);

        const title = match[2];
        const channel = match[3];
        tracks.push(this.buildTrackObject(videoId, title, channel, 210, "03:30"));
      }
    }

    return tracks;
  }

  /**
   * Builds standardized YouTubeMusicTrack object with safe proxy & direct stream links
   */
  private buildTrackObject(
    videoId: string,
    title: string,
    artist: string,
    durationSec: number,
    durationFormatted: string
  ): YouTubeMusicTrack {
    const cleanTitle = title
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\(Official Video\)|\(Official Audio\)|\(Lyric Video\)|\(Full Song\)|\[Official Video\]|\[Official Audio\]/gi, "")
      .trim();

    return {
      id: `yt_${videoId}`,
      videoId,
      songName: cleanTitle,
      artistName: artist,
      albumName: `${artist} (YouTube Music)`,
      durationSec,
      durationFormatted: durationFormatted || "03:30",
      albumArt: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      albumArtHighRes: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      streamUrl: `/api/youtube/stream-audio?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&controls=1&playsinline=1`,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      youtubeMusicUrl: `https://music.youtube.com/watch?v=${videoId}`,
      isYouTube: true,
      isFullSong: true,
      quality: "YouTube Pro 1080p / High-Bitrate Audio",
      source: "youtube_safe",
    };
  }

  /**
   * Parse "03:45" or "1:12:30" string to seconds
   */
  private parseDurationToSeconds(durationStr: string): number {
    if (!durationStr) return 180;
    const parts = durationStr.split(":").map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return 180;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 180;
  }

  /**
   * Fallback search querying Invidious API instance
   */
  private async fallbackSearch(query: string, limit: number): Promise<YouTubeMusicSearchResult> {
    for (const inst of this.INVIDIOUS_INSTANCES) {
      try {
        const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(query + " song")}&type=video`, {
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const items: any[] = await res.json();
          if (Array.isArray(items) && items.length > 0) {
            const tracks: YouTubeMusicTrack[] = items.slice(0, limit).map((v) => {
              const videoId = v.videoId;
              return this.buildTrackObject(
                videoId,
                v.title || query,
                v.author || "YouTube Artist",
                v.lengthSeconds || 180,
                `${Math.floor((v.lengthSeconds || 180) / 60)}:${String((v.lengthSeconds || 180) % 60).padStart(2, "0")}`
              );
            });

            return {
              success: true,
              query,
              count: tracks.length,
              tracks,
              topTrack: tracks[0],
              message: `Boss, YouTube Safe engine se "${query}" play ke liye tayyar hai! 🎵`,
            };
          }
        }
      } catch {
        // Continue to next instance
      }
    }

    return {
      success: false,
      query,
      count: 0,
      tracks: [],
      message: `"${query}" YouTube par dhoondhne me asafal raha.`,
    };
  }

  /**
   * Extracts direct playable audio stream URL for a given YouTube Video ID.
   */
  public async getAudioStreamUrl(videoId: string): Promise<string | null> {
    if (!videoId) return null;

    // 1. Try Invidious direct audio stream endpoints
    for (const inst of this.INVIDIOUS_INSTANCES) {
      try {
        const infoRes = await fetch(`${inst}/api/v1/videos/${videoId}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (infoRes.ok) {
          const info = await infoRes.json();
          const adaptiveFormats = info?.adaptiveFormats || [];
          // Find audio-only formats (mp4a or opus)
          const audioFormats = adaptiveFormats
            .filter((f: any) => f.type?.startsWith("audio/") && f.url)
            .sort((a: any, b: any) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0));

          if (audioFormats.length > 0 && audioFormats[0].url) {
            return audioFormats[0].url;
          }

          // Fallback to regular format stream
          const formats = info?.formatStreams || [];
          if (formats.length > 0 && formats[0].url) {
            return formats[0].url;
          }
        }
      } catch {
        // Try next instance
      }
    }

    return null;
  }
}

export const youtubeMusicService = new YouTubeMusicService();
