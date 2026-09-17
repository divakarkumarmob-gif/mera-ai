/**
 * nsfwVideoService.ts
 *
 * Real short adult clips (10–20s mp4) + GIFs for Mode-B girlfriend.
 * Sources (NSFW-first order):
 *  1. RedGifs public API — short vertical clips, ideal for WhatsApp/Telegram.
 *  2. Pornhub Webmasters public API — official preview mp4 trailers.
 *
 * No AI generation here — 100% real clips. Buffers capped for chat delivery.
 */

export interface NsfwClipResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  title?: string;
  source?: "redgifs" | "pornhub";
  pageUrl?: string;
  error?: string;
}

const REDGIFS_API = "https://api.redgifs.com/v2";
const PORNHUB_SEARCH_API = "https://www.pornhub.com/webmasters/search";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB cap per clip
const FETCH_TIMEOUT_MS = 25000;
const SENT_COLLECTION = "nsfw_sent_clips";
const SENT_CAP = 120;
// Result-set rotation: har request alag order + modifier → same words pe bhi naye clips
const REDGIFS_ORDERS = ["trending", "top", "latest"];
const QUERY_MODIFIERS = ["", "close up", "pov", "bedroom", "homemade", "passionate", ""]; // "" = plain query often

let redgifsToken: string | null = null;
let redgifsTokenAt = 0;

/** Per-chat sent clip IDs (bheja hua dobara nahi) — best-effort, failures ignored. */
async function getSentIds(jid: string): Promise<Set<string>> {
  try {
    if (!jid) return new Set();
    const { db } = await import("./firebaseAdmin");
    const snap = await db.collection(SENT_COLLECTION).doc(String(jid)).get();
    const arr: any[] = snap.exists && Array.isArray((snap.data() as any)?.ids) ? (snap.data() as any).ids : [];
    return new Set(arr.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

async function addSentId(jid: string, id: string): Promise<void> {
  try {
    if (!jid || !id) return;
    const { db } = await import("./firebaseAdmin");
    const ref = db.collection(SENT_COLLECTION).doc(String(jid));
    const snap = await ref.get();
    const arr: string[] = snap.exists && Array.isArray((snap.data() as any)?.ids) ? (snap.data() as any).ids.map((x: any) => String(x)) : [];
    if (!arr.includes(String(id))) arr.push(String(id));
    await ref.set({ ids: arr.slice(-SENT_CAP), updatedAt: Date.now() }, { merge: true });
  } catch {}
}

function pickFresh<T>(pool: T[], getId: (x: T) => string, sent: Set<string>): T | null {
  if (pool.length === 0) return null;
  const fresh = pool.filter((x) => !sent.has(getId(x)));
  const list = fresh.length > 0 ? fresh : pool; // sab bheje hue hon to pool se hi (stuck nahi hoga)
  return list[Math.floor(Math.random() * list.length)];
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getRedgifsToken(): Promise<string | null> {
  if (redgifsToken && Date.now() - redgifsTokenAt < 20 * 60 * 60 * 1000) return redgifsToken;
  try {
    const res = await fetchWithTimeout(`${REDGIFS_API}/auth/temporary`, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.token) {
      redgifsToken = data.token;
      redgifsTokenAt = Date.now();
      return redgifsToken;
    }
  } catch {}
  return null;
}

async function downloadCapped(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "MeraAI-Friday-Agent/1.0", Referer: "https://www.redgifs.com/" } });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Map Hinglish/hot words → English search tags. */
export function mapNsfwQuery(text: string): string {
  const lower = (text || "").toLowerCase();
  const tags: string[] = [];
  const add = (re: RegExp, tag: string) => {
    if (re.test(lower)) tags.push(tag);
  };
  add(/\b(boobs|chuchi|breast|nipple|doodh)\b/, "boobs");
  add(/\b(chut|pussy|bur|vagina)\b/, "pussy");
  add(/\b(gaand|ass|butt|gand|chutad)\b/, "ass");
  add(/\b(blowjob|blow\s*job|chus|muh\s*me|suck)\b/, "blowjob");
  add(/\b(doggy|doggi|peeche\s*se|behind)\b/, "doggystyle");
  add(/\b(missionary|samne\s*se)\b/, "missionary");
  add(/\b(ride|sawari|upar|cowgirl)\b/, "cowgirl");
  add(/\b(lesbian|lesbo|do\s*ladki)\b/, "lesbian");
  add(/\b(anal)\b/, "anal");
  add(/\b(romance|kiss|hug|cuddle|pyar|love)\b/, "romantic");
  add(/\b(shower|bath|nahate)\b/, "shower");
  add(/\b(massage|maalish)\b/, "massage");
  if (tags.length === 0) tags.push("amateur", "couple");
  return [...new Set(tags)].slice(0, 3).join(" ");
}

async function searchRedGifs(query: string, jid = ""): Promise<NsfwClipResult> {
  const token = await getRedgifsToken();
  if (!token) return { success: false, error: "redgifs auth failed" };
  try {
    // Rotate order + modifier every request → same words pe bhi naya result set
    const order = REDGIFS_ORDERS[Math.floor(Math.random() * REDGIFS_ORDERS.length)];
    const mod = QUERY_MODIFIERS[Math.floor(Math.random() * QUERY_MODIFIERS.length)];
    const q = mod ? `${query} ${mod}` : query;
    const url = `${REDGIFS_API}/gifs/search?search_text=${encodeURIComponent(q)}&order=${order}&count=50&gtype=gif`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 12000);
    if (!res.ok) return { success: false, error: `redgifs status ${res.status}` };
    const data = await res.json();
    const gifs: any[] = Array.isArray(data?.gifs) ? data.gifs : [];
    const pool = gifs.filter((g) => g?.urls?.sd || g?.urls?.hd).slice(0, 30);
    if (pool.length === 0) return { success: false, error: "no redgifs results" };
    const sent = await getSentIds(jid);
    const pick = pickFresh(pool, (g) => String(g?.id || g?.urls?.sd || ""), sent);
    if (!pick) return { success: false, error: "no pick" };
    const mp4: string | undefined = pick.urls?.sd || pick.urls?.hd;
    if (!mp4) return { success: false, error: "no mp4 url" };
    const buf = await downloadCapped(mp4);
    if (!buf) return { success: false, error: "download failed/capped" };
    await addSentId(jid, String(pick?.id || mp4));
    return {
      success: true,
      buffer: buf,
      mimeType: "video/mp4",
      title: pick?.title || query,
      source: "redgifs",
      pageUrl: `https://www.redgifs.com/watch/${pick?.id || ""}`,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || "redgifs error" };
  }
}

async function searchPornhub(query: string, jid = ""): Promise<NsfwClipResult> {
  try {
    // Random page (1-5) → har baar alag result set
    const page = 1 + Math.floor(Math.random() * 5);
    const url = `${PORNHUB_SEARCH_API}?search=${encodeURIComponent(query)}&page=${page}`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "MeraAI-Friday-Agent/1.0" } }, 12000);
    if (!res.ok) return { success: false, error: `pornhub status ${res.status}` };
    const data = await res.json();
    const videos: any[] = Array.isArray(data?.videos) ? data.videos : [];
    const pool = videos.filter((v) => v?.preview_videourl).slice(0, 20);
    if (pool.length === 0) return { success: false, error: "no pornhub previews" };
    const sent = await getSentIds(jid);
    const pick = pickFresh(pool, (v) => String(v?.video_id || v?.preview_videourl || ""), sent);
    if (!pick) return { success: false, error: "no pick" };
    const buf = await downloadCapped(pick.preview_videourl);
    if (!buf) return { success: false, error: "download failed/capped" };
    await addSentId(jid, String(pick?.video_id || pick.preview_videourl));
    return {
      success: true,
      buffer: buf,
      mimeType: "video/mp4",
      title: pick?.title || query,
      source: "pornhub",
      pageUrl: pick?.url,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || "pornhub error" };
  }
}

class NsfwVideoService {
  /** RedGifs first (short clips), Pornhub previews fallback. jid = per-chat no-repeat. */
  public async getNsfwClip(rawText: string, jid = ""): Promise<NsfwClipResult> {
    const query = mapNsfwQuery(rawText);
    const rg = await searchRedGifs(query, jid);
    if (rg.success && rg.buffer) return rg;
    const ph = await searchPornhub(query, jid);
    if (ph.success && ph.buffer) return ph;
    return { success: false, error: `No clip found (${rg.error || ""} / ${ph.error || ""})`.slice(0, 160) };
  }

  /** Direct GIF url (no download) for lightweight sends. */
  public async getNsfwGifUrl(rawText: string): Promise<{ success: boolean; url?: string; title?: string; error?: string }> {
    const token = await getRedgifsToken();
    if (!token) return { success: false, error: "auth failed" };
    try {
      const query = mapNsfwQuery(rawText);
      const url = `${REDGIFS_API}/gifs/search?search_text=${encodeURIComponent(query)}&order=trending&count=10&gtype=gif`;
      const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 12000);
      if (!res.ok) return { success: false, error: `status ${res.status}` };
      const data = await res.json();
      const gifs: any[] = Array.isArray(data?.gifs) ? data.gifs : [];
      const pool = gifs.filter((g) => g?.urls?.gif).slice(0, 8);
      if (pool.length === 0) return { success: false, error: "no gif results" };
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return { success: true, url: pick.urls.gif, title: pick?.title || query };
    } catch (e: any) {
      return { success: false, error: e?.message || "gif error" };
    }
  }
}

export const nsfwVideoService = new NsfwVideoService();
