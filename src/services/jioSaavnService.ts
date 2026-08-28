/**
 * JioSaavn HD Music Streaming & Decryption Service
 * Comprehensive Catalog Search & Native DES-ECB Decryption for 320kbps Pure Audio Streaming.
 * Inspired by https://github.com/sumitkolhe/jiosaavn-api
 */

import CryptoJS from "crypto-js";

export interface JioSaavnSong {
  id: string;
  songName: string;
  albumName: string;
  artistName: string;
  year?: string;
  durationSec?: number;
  albumArt500: string;
  albumArt150: string;
  audio320kbps: string;
  audio160kbps: string;
  audio96kbps: string;
  hasLyrics: boolean;
  copyright?: string;
}

export interface JioSaavnSearchResult {
  success: boolean;
  query: string;
  count: number;
  songs: JioSaavnSong[];
  topSong?: JioSaavnSong;
  message: string;
}

class JioSaavnService {
  private readonly API_BASE = "https://www.jiosaavn.com/api.php";
  private readonly HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  };

  /**
   * Decrypt JioSaavn DES-ECB encrypted media URL using CryptoJS
   */
  public decryptUrl(encryptedBase64: string): string {
    if (!encryptedBase64) return "";
    try {
      const key = CryptoJS.enc.Utf8.parse("38346591");
      const decrypted = CryptoJS.DES.decrypt(
        { ciphertext: CryptoJS.enc.Base64.parse(encryptedBase64) } as any,
        key,
        {
          mode: CryptoJS.mode.ECB,
          padding: CryptoJS.pad.Pkcs7,
        }
      );
      return decrypted.toString(CryptoJS.enc.Utf8).trim();
    } catch {
      return "";
    }
  }

  /**
   * Clean HTML entities and unicode escaping from titles and artist strings
   */
  private cleanText(str: string): string {
    return String(str || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  /**
   * Generate 320kbps, 160kbps, and 96kbps variants from decrypted CDN link
   */
  private buildQualityStreams(decryptedUrl: string): { audio320: string; audio160: string; audio96: string } {
    if (!decryptedUrl) {
      return { audio320: "", audio160: "", audio96: "" };
    }
    const cleanUrl = decryptedUrl.replace(/_48\.mp4|_96\.mp4|_160\.mp4|_320\.mp4/g, "");
    const ext = decryptedUrl.endsWith(".m4a") ? ".m4a" : ".mp4";
    return {
      audio320: `${cleanUrl}_320${ext}`,
      audio160: `${cleanUrl}_160${ext}`,
      audio96: `${cleanUrl}_96${ext}`,
    };
  }

  /**
   * Relevance scoring for search result ranking (Exact > StartsWith > Contains > Artist > Album)
   */
  private scoreSong(song: JioSaavnSong, query: string): number {
    const q = query.toLowerCase().trim();
    if (!q) return 0;
    const title = (song.songName || "").toLowerCase().trim();
    const artist = (song.artistName || "").toLowerCase().trim();
    const album = (song.albumName || "").toLowerCase().trim();

    let score = 0;
    if (title === q) score += 1000;
    else if (title.startsWith(q)) score += 600;
    else if (title.includes(q)) score += 350;

    if (artist.includes(q)) score += 250;
    if (album.includes(q)) score += 120;

    const tokens = q.split(/\s+/).filter(t => t.length > 1);
    for (const t of tokens) {
      if (title.includes(t)) score += 60;
      if (artist.includes(t)) score += 40;
      if (album.includes(t)) score += 20;
    }
    return score;
  }

  /**
   * Search songs on JioSaavn across entire catalog with multiple API fallbacks
   */
  public async searchSong(query: string, limit: number = 40): Promise<JioSaavnSearchResult> {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) {
      return { success: false, query: "", count: 0, songs: [], message: "Song name zaroori hai." };
    }

    // Intelligent query preprocessing for generic terms (e.g. purane gane, old hits, new songs)
    let effectiveQuery = cleanQuery;
    const lower = cleanQuery.toLowerCase();
    if (lower === "purane gane" || lower === "purana gana" || lower === "old songs" || lower === "retro songs" || lower === "evergreen songs" || lower === "hindi old") {
      effectiveQuery = "Kishore Kumar Lata Mangeshkar Mohammed Rafi Evergreen Hits";
    } else if (lower === "naye gane" || lower === "naya gana" || lower === "new songs" || lower === "latest songs" || lower === "hindi new") {
      effectiveQuery = "Latest Bollywood Hindi Hits 2024 2025";
    } else if (lower === "sad songs" || lower === "sad gane") {
      effectiveQuery = "Arijit Singh Atif Aslam Sad Songs";
    } else if (lower === "party songs" || lower === "party gane") {
      effectiveQuery = "Bollywood Party Hits Yo Yo Honey Singh Badshah";
    } else if (lower === "bhojpuri" || lower === "bhojpuri gane") {
      effectiveQuery = "Bhojpuri Hits Pawan Singh Khesari Lal";
    } else if (lower === "haryanvi" || lower === "haryanvi gane") {
      effectiveQuery = "Haryanvi Hits";
    } else if (lower === "punjabi" || lower === "punjabi gane") {
      effectiveQuery = "Punjabi Hits";
    } else if (lower === "phonk") {
      effectiveQuery = "Phonk";
    }

    // 1. Primary: search.getResults (Deep catalog search with full metadata)
    try {
      // Build candidate search queries (original + cleaned core phrase)
      const queriesToTry = [effectiveQuery];
      const stripped = effectiveQuery
        .replace(/,\s*/g, " ")
        .replace(/\b(aunga|aaunga|chalao|sunao|bajao|gana|gaana|song|mp3|bhejo|play)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped && stripped.toLowerCase() !== effectiveQuery.toLowerCase() && stripped.length >= 3) {
        queriesToTry.push(stripped);
      }

      const songMap = new Map<string, JioSaavnSong>();

      for (const qItem of queriesToTry) {
        const searchUrl = `${this.API_BASE}?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=${limit}&q=${encodeURIComponent(qItem)}`;
        const res = await fetch(searchUrl, { headers: this.HEADERS });
        if (!res.ok) continue;

        const text = await res.text();
        let data: any = {};
        try {
          data = JSON.parse(text);
        } catch {
          const clean = text.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
          data = JSON.parse(clean);
        }

        const results = data?.results || [];
        if (Array.isArray(results)) {
          for (const item of results) {
            if (!item.id || songMap.has(item.id)) continue;
            const rawEncUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url;
            const decrypted = this.decryptUrl(rawEncUrl);
            if (!decrypted) continue;

            const streams = this.buildQualityStreams(decrypted);
            const rawImg = String(item.image || "").replace(/http:\/\//, "https://");
            const albumArt500 = rawImg.replace(/150x150\.jpg|50x50\.jpg/, "500x500.jpg");
            const albumArt150 = rawImg.replace(/500x500\.jpg|50x50\.jpg/, "150x150.jpg");

            songMap.set(item.id, {
              id: item.id,
              songName: this.cleanText(item.song || item.title || item.more_info?.song),
              albumName: this.cleanText(item.album || item.more_info?.album),
              artistName: this.cleanText(item.primary_artists || item.more_info?.primary_artists || item.singers || item.music || "Artist"),
              year: item.year || item.more_info?.year,
              durationSec: Number(item.duration || item.more_info?.duration || 0),
              albumArt500: albumArt500 || albumArt150,
              albumArt150: albumArt150 || albumArt500,
              audio320kbps: streams.audio320 || decrypted,
              audio160kbps: streams.audio160 || decrypted,
              audio96kbps: streams.audio96 || decrypted,
              hasLyrics: item.has_lyrics === "true" || item.more_info?.has_lyrics === "true",
              copyright: item.copyright_text || item.more_info?.copyright_text,
            });
          }
        }
      }

      const songs = Array.from(songMap.values());
      if (songs.length > 0) {
        // Priority Sorting based on exact and partial token matching
        songs.sort((a, b) => this.scoreSong(b, cleanQuery) - this.scoreSong(a, cleanQuery));

        return {
          success: true,
          query: cleanQuery,
          count: songs.length,
          songs,
          topSong: songs[0],
          message: `JioSaavn catalog par "${cleanQuery}" ke ${songs.length} gaane mil gaye hain. 🎵`,
        };
      }
    } catch (err: any) {
      console.warn("[JioSaavn] search.getResults error:", err?.message || err);
    }

    // 2. Secondary: search.getMoreResults fallback
    try {
      const moreUrl = `${this.API_BASE}?__call=search.getMoreResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=${limit}&q=${encodeURIComponent(cleanQuery)}&params=%7B%22type%22:%22songs%22%7D`;
      const res = await fetch(moreUrl, { headers: this.HEADERS });
      if (res.ok) {
        const data = await res.json();
        const results = data?.results || [];
        if (Array.isArray(results) && results.length > 0) {
          const songs: JioSaavnSong[] = [];
          for (const item of results) {
            const rawEncUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url;
            const decrypted = this.decryptUrl(rawEncUrl);
            if (!decrypted) continue;

            const streams = this.buildQualityStreams(decrypted);
            const rawImg = String(item.image || "").replace(/http:\/\//, "https://");
            const albumArt500 = rawImg.replace(/150x150\.jpg|50x50\.jpg/, "500x500.jpg");
            const albumArt150 = rawImg.replace(/500x500\.jpg|50x50\.jpg/, "150x150.jpg");

            songs.push({
              id: item.id,
              songName: this.cleanText(item.song || item.title || item.more_info?.song),
              albumName: this.cleanText(item.album || item.more_info?.album),
              artistName: this.cleanText(item.primary_artists || item.more_info?.primary_artists || item.singers || "Artist"),
              year: item.year || item.more_info?.year,
              durationSec: Number(item.duration || item.more_info?.duration || 0),
              albumArt500: albumArt500 || albumArt150,
              albumArt150: albumArt150 || albumArt500,
              audio320kbps: streams.audio320 || decrypted,
              audio160kbps: streams.audio160 || decrypted,
              audio96kbps: streams.audio96 || decrypted,
              hasLyrics: item.has_lyrics === "true" || item.more_info?.has_lyrics === "true",
            });
          }

          if (songs.length > 0) {
            return {
              success: true,
              query: cleanQuery,
              count: songs.length,
              songs,
              topSong: songs[0],
              message: `JioSaavn catalog par "${cleanQuery}" ke ${songs.length} gaane mil gaye hain. 🎵`,
            };
          }
        }
      }
    } catch (err: any) {
      console.warn("[JioSaavn] search.getMoreResults error:", err?.message || err);
    }

    // 3. Fallback: autocomplete.get + song.getDetails
    try {
      const autoUrl = `${this.API_BASE}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(cleanQuery)}`;
      const res = await fetch(autoUrl, { headers: this.HEADERS });
      if (res.ok) {
        const data = await res.json();
        const autoSongs = data?.songs?.data || [];

        if (Array.isArray(autoSongs) && autoSongs.length > 0) {
          const songIds = autoSongs.slice(0, 10).map((s: any) => s.id).join(",");
          const detailUrl = `${this.API_BASE}?__call=song.getDetails&pids=${songIds}&_format=json&_marker=0&cc=in`;
          const detailRes = await fetch(detailUrl, { headers: this.HEADERS });

          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const songs: JioSaavnSong[] = [];

            for (const item of autoSongs) {
              const songObj = detailData?.[item.id] || Object.values(detailData).find((d: any) => d?.id === item.id) as any;
              if (!songObj) continue;

              const rawEncUrl = songObj.encrypted_media_url || songObj.more_info?.encrypted_media_url;
              const decrypted = this.decryptUrl(rawEncUrl);
              if (!decrypted) continue;

              const streams = this.buildQualityStreams(decrypted);
              const rawImg = String(songObj.image || item.image || "").replace(/http:\/\//, "https://");
              const albumArt500 = rawImg.replace(/150x150\.jpg|50x50\.jpg/, "500x500.jpg");
              const albumArt150 = rawImg.replace(/500x500\.jpg|50x50\.jpg/, "150x150.jpg");

              songs.push({
                id: songObj.id || item.id,
                songName: this.cleanText(songObj.song || songObj.title || item.title),
                albumName: this.cleanText(songObj.album || songObj.more_info?.album || item.album),
                artistName: this.cleanText(songObj.primary_artists || songObj.more_info?.primary_artists || item.description || "Artist"),
                year: songObj.year,
                durationSec: Number(songObj.duration || 0),
                albumArt500: albumArt500 || albumArt150,
                albumArt150: albumArt150 || albumArt500,
                audio320kbps: streams.audio320 || decrypted,
                audio160kbps: streams.audio160 || decrypted,
                audio96kbps: streams.audio96 || decrypted,
                hasLyrics: songObj.has_lyrics === "true",
              });
            }

            if (songs.length > 0) {
              return {
                success: true,
                query: cleanQuery,
                count: songs.length,
                songs,
                topSong: songs[0],
                message: `JioSaavn par "${songs[0].songName}" mil gaya hai. 🎵`,
              };
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("[JioSaavn] autocomplete search failed:", err?.message || err);
    }

    return {
      success: false,
      query: cleanQuery,
      count: 0,
      songs: [],
      message: `JioSaavn catalog par "${cleanQuery}" ke liye song nahi mila.`,
    };
  }

  /**
   * Fetch song lyrics by songId
   */
  public async getLyrics(songId: string): Promise<{ success: boolean; lyrics?: string; copyright?: string }> {
    try {
      const url = `${this.API_BASE}?__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(songId)}&_format=json&_marker=0&cc=in`;
      const res = await fetch(url, { headers: this.HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (data?.lyrics) {
          return {
            success: true,
            lyrics: this.cleanText(data.lyrics).replace(/<br\s*\/?>/gi, "\n"),
            copyright: data.snippet,
          };
        }
      }
    } catch {}
    return { success: false };
  }
}

export const jioSaavnService = new JioSaavnService();
