/**
 * JioSaavn HD Music Streaming & Decryption Service
 * Native Pure-JS DES-ECB Decryption for 320kbps Pure Audio Streaming.
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
   * Clean HTML entities from titles and artist strings
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
   * Search songs on JioSaavn and decrypt 320kbps audio streams
   */
  public async searchSong(query: string): Promise<JioSaavnSearchResult> {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) {
      return { success: false, query: "", count: 0, songs: [], message: "Song name zaroori hai." };
    }

    // 1. Primary: autocomplete.get (Fastest and always reliable)
    try {
      const autoUrl = `${this.API_BASE}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(cleanQuery)}`;
      const res = await fetch(autoUrl, { headers: this.HEADERS });
      if (res.ok) {
        const data = await res.json();
        const autoSongs = data?.songs?.data || [];

        if (Array.isArray(autoSongs) && autoSongs.length > 0) {
          const songIds = autoSongs.slice(0, 4).map((s: any) => s.id).join(",");
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
                artistName: this.cleanText(songObj.primary_artists || songObj.more_info?.primary_artists || item.description || "JioSaavn Artist"),
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
                message: `JioSaavn 320kbps HD par "${songs[0].songName}" mil gaya hai. 🎵`,
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
      message: `JioSaavn par "${cleanQuery}" ke liye song nahi mila.`,
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
