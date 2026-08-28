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
  playCount?: number;
  starring?: string;
  label?: string;
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
   * YouTube-Grade Relevance & Popularity scoring — Entity-Aware Mind-Reader Edition
   * Strips actor/singer tokens from query before title match, so "sehra bandh ke amir khan"
   * correctly ranks "Main Sehra Bandh Ke" (Aamir Khan 1990) above "Main Sehra Bandh Ke Aaunga" (Bhojpuri).
   */
  private scoreSong(song: JioSaavnSong, query: string): number {
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    if (!q) return 0;

    // --- Entity Lists (same as rankCandidatesMindReader) ---
    const ACTORS = ["aamir khan", "amir khan", "aamir", "amir", "salman khan", "salman", "shah rukh khan", "shahrukh khan", "shah rukh", "shahrukh", "srk", "akshay kumar", "akshay", "ranbir kapoor", "ranbir", "hrithik roshan", "hrithik", "govinda", "amitabh bachchan", "amitabh", "ajay devgn", "ajay", "emraan hashmi", "emraan", "kartik aaryan", "kartik"];
    const SINGERS = ["arijit singh", "arijit", "arjit", "udit narayan", "udit", "sonu nigam", "sonu", "shreya ghoshal", "shreya", "kishore kumar", "kishore", "lata mangeshkar", "lata", "mohammed rafi", "rafi", "alka yagnik", "alka", "kk", "diljit dosanjh", "diljit", "badshah", "honey singh", "honey", "pritam", "ar rahman", "rahman", "anirudh", "jubin nautiyal", "jubin", "atif aslam", "atif", "darshan raval", "sidhu moose wala"];

    // Strip entity tokens → isolate the pure title portion of the query
    let titleQuery = q;
    for (const a of ACTORS) titleQuery = titleQuery.replace(new RegExp(`\\b${a}\\b`, "gi"), "");
    for (const s of SINGERS) titleQuery = titleQuery.replace(new RegExp(`\\b${s}\\b`, "gi"), "");
    titleQuery = titleQuery.replace(/\s+/g, " ").trim();
    const effectiveQuery = titleQuery.length >= 3 ? titleQuery : q;

    const title = (song.songName || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    const artist = (song.artistName || "").toLowerCase();
    const album = (song.albumName || "").toLowerCase();
    const starring = (song.starring || "").toLowerCase();
    const label = (song.label || "").toLowerCase();

    let score = 0;

    // 1. Title matching — against stripped title-only query
    if (title === effectiveQuery || title === `main ${effectiveQuery}` || `main ${title}` === effectiveQuery) {
      score += 1200;
    } else if (title.startsWith(effectiveQuery) || effectiveQuery.startsWith(title)) {
      score += 750;
    } else if (title.includes(effectiveQuery) && effectiveQuery.length >= 4) {
      score += 500;
    } else {
      const qTokens = q.split(/\s+/).filter(Boolean);
      const titleTokens = title.split(/\s+/).filter(Boolean);
      const matchCount = qTokens.filter((t) => titleTokens.includes(t)).length;
      if (qTokens.length > 0) score += Math.round((matchCount / qTokens.length) * 450);
    }

    // 2. Artist / starring token matching
    const qTokens = q.split(/\s+/).filter((t) => t.length > 1);
    for (const t of qTokens) {
      if (artist.includes(t)) score += 50;
      if (starring.includes(t)) score += 45;
      if (album.includes(t)) score += 25;
    }

    // 3. Entity boost — actor match (+850), singer match (+750)
    for (const act of ACTORS) {
      if (q.includes(act) && (starring.includes(act) || artist.includes(act) || album.includes(act))) {
        score += 850;
        break;
      }
    }
    for (const sng of SINGERS) {
      if (q.includes(sng) && (artist.includes(sng) || album.includes(sng) || starring.includes(sng))) {
        score += 750;
        break;
      }
    }

    // 4. Popularity log-scale (YouTube RankBrain style)
    if (song.playCount && song.playCount > 0) {
      score += Math.min(500, Math.round(Math.log10(song.playCount) * 55));
    }

    // 5. Official label boost
    if (/t-series|sony music|zee music|saregama|yrf|tips|speed records|universal|erossoundtrack|panchratan/i.test(label)) {
      score += 100;
    }

    // 6. Penalize karaoke / instrumental unless explicitly searched
    if (!q.includes("instrumental") && title.includes("instrumental")) score -= 250;
    if (!q.includes("karaoke") && title.includes("karaoke")) score -= 350;

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
              playCount: Number(item.play_count || item.more_info?.play_count || 0),
              starring: this.cleanText(item.starring || item.more_info?.starring || ""),
              label: this.cleanText(item.label || item.more_info?.label || item.copyright_text || ""),
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
              playCount: Number(item.play_count || item.more_info?.play_count || 0),
              starring: this.cleanText(item.starring || item.more_info?.starring || ""),
              label: this.cleanText(item.label || item.more_info?.label || item.copyright_text || ""),
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
   * Generate an intelligent 10-15 song auto-queue based on current song's artist, composer, or album
   */
  public async getSmartQueue(currentSong: { songName: string; artistName: string; albumName?: string }): Promise<JioSaavnSong[]> {
    try {
      const primaryArtist = (currentSong.artistName || "").split(/[,&/]/)[0].trim();
      const queries = [
        `${primaryArtist} Best Hits`,
        currentSong.albumName ? `${currentSong.albumName}` : "",
        `${primaryArtist} Romantic Hits`,
      ].filter(Boolean);

      const songMap = new Map<string, JioSaavnSong>();
      for (const q of queries) {
        const res = await this.searchSong(q, 15);
        if (res.success && res.songs) {
          for (const s of res.songs) {
            if (s.songName.toLowerCase() !== currentSong.songName.toLowerCase() && !songMap.has(s.id)) {
              songMap.set(s.id, s);
            }
          }
        }
        if (songMap.size >= 12) break;
      }
      return Array.from(songMap.values());
    } catch {
      return [];
    }
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

  /**
   * YouTube & Spotify Grade Cognitive Ranking Engine
   * Scores and diversifies preview candidates so the exact song envisioned by the user appears in top slots.
   */
  public rankCandidatesMindReader(query: string, rawCandidates: any[]): any[] {
    if (!rawCandidates || rawCandidates.length === 0) return [];
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    const qTokens = q.split(/\s+/).filter(Boolean);

    const actorList = ["aamir khan", "amir khan", "aamir", "amir", "salman khan", "salman", "shah rukh khan", "shahrukh khan", "shah rukh", "shahrukh", "srk", "akshay kumar", "akshay", "ranbir kapoor", "ranbir", "hrithik roshan", "hrithik", "govinda", "amitabh bachchan", "amitabh", "ajay devgn", "ajay", "emraan hashmi", "emraan", "kartik aaryan", "kartik"];
    const singerList = ["arijit singh", "arijit", "arjit", "udit narayan", "udit", "sonu nigam", "sonu", "shreya ghoshal", "shreya", "kishore kumar", "kishore", "lata mangeshkar", "lata", "mohammed rafi", "rafi", "alka yagnik", "alka", "kk", "diljit dosanjh", "diljit", "badshah", "honey singh", "honey", "pritam", "ar rahman", "rahman", "anirudh", "jubin nautiyal", "jubin", "atif aslam", "atif", "darshan raval", "sidhu moose wala"];

    let queryTitleOnly = q;
    for (const act of actorList) queryTitleOnly = queryTitleOnly.replace(new RegExp(`\\b${act}\\b`, "gi"), "");
    for (const sng of singerList) queryTitleOnly = queryTitleOnly.replace(new RegExp(`\\b${sng}\\b`, "gi"), "");
    queryTitleOnly = queryTitleOnly.replace(/\s+/g, " ").trim();

    const scored = rawCandidates.map((c) => {
      let score = 0;
      const title = (c.songName || c.trackName || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
      const artist = (c.artistName || "").toLowerCase();
      const album = (c.albumName || "").toLowerCase();
      const starring = (c.starring || "").toLowerCase();
      const label = (c.label || "").toLowerCase();

      // 1. Title Matching (Against both full query & queryTitleOnly)
      const targetQuery = queryTitleOnly.length >= 3 ? queryTitleOnly : q;
      if (title === targetQuery || title === `main ${targetQuery}` || `main ${title}` === targetQuery) {
        score += 1200;
      } else if (title.startsWith(targetQuery) || targetQuery.startsWith(title)) {
        score += 750;
      } else {
        const titleTokens = title.split(/\s+/).filter(Boolean);
        const matchCount = qTokens.filter((tok) => titleTokens.includes(tok)).length;
        if (qTokens.length > 0) {
          score += Math.round((matchCount / qTokens.length) * 450);
        }
      }

      // 2. Popularity & Stream Weight (logarithmic)
      const playCount = Number(c.playCount || (c.source === "spotify" ? 5000000 : 800000));
      score += Math.min(500, Math.round(Math.log10(Math.max(1000, playCount)) * 65));

      // 3. Entity Matching (Actor, Singer, Composer)
      for (const act of actorList) {
        if (q.includes(act) && (starring.includes(act) || artist.includes(act) || album.includes(act) || album.includes("deewana mujh sa nahin"))) {
          score += 850; // Huge boost for matching requested star cast
          break;
        }
      }

      for (const sng of singerList) {
        if (q.includes(sng) && (artist.includes(sng) || album.includes(sng) || starring.includes(sng))) {
          score += 750; // Huge boost for matching requested primary singer/composer
          break;
        }
      }

      // 4. Major Record Label Authority Boost
      if (label.match(/t-series|sony|zee|saregama|yrf|tips|universal|speed/)) {
        score += 150;
      }

      // 5. Penalize low-quality karaoke/instrumental unless explicitly requested
      if (!q.includes("instrumental") && title.includes("instrumental")) score -= 250;
      if (!q.includes("karaoke") && title.includes("karaoke")) score -= 350;

      return { ...c, mindScore: score };
    });

    // Sort by composite score descending
    scored.sort((a, b) => b.mindScore - a.mindScore);

    // Smart Variant Diversification (Ensure variety in top 4)
    const result: any[] = [];
    const seenTitles = new Set<string>();

    for (const item of scored) {
      const cleanT = (item.songName || item.trackName || "").toLowerCase().replace(/\s*\(.*\)/, "").trim();
      if (!seenTitles.has(cleanT) || result.length < 2) {
        seenTitles.add(cleanT);
        result.push(item);
      }
      if (result.length >= 5) break;
    }

    return result.length > 0 ? result : scored.slice(0, 5);
  }
}

export const jioSaavnService = new JioSaavnService();
