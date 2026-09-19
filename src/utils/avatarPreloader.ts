/**
 * Friday Avatar Asset Preloader — Persistent Cache Edition
 * ─────────────────────────────────────────────────────────
 * Permanent caching strategy for APK (Capacitor WebView):
 *
 * - IndexedDB mein FBX ArrayBuffers permanently store hote hain
 * - APK kill karke dobara kholne pe bhi — IndexedDB se instant load
 * - THREE.Cache mein inject karke FBXLoader ko zero-I/O experience milta hai
 *
 * Flow:
 *   App open → check IndexedDB → if hit: THREE.Cache mein daal do (instant)
 *                              → if miss: fetch → IndexedDB mein save → THREE.Cache
 *
 * Works on: Android APK (Capacitor), iOS, Web (fallback to Service Worker)
 */

import * as THREE from 'three';

// Enable THREE.js global in-memory cache (session-level)
THREE.Cache.enabled = true;

// ── IndexedDB Config ─────────────────────────────────────────────────────────
const DB_NAME    = 'friday_avatar_cache';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

// Bump this version number to force re-download when FBX files are updated
const CACHE_VERSION_KEY = 'cache_version';
const CACHE_VERSION     = '2';

// ── Asset List ───────────────────────────────────────────────────────────────
const CRITICAL_ASSETS = [
  '/friday.fbx',
  '/Breathing%20Idle%20(1).fbx',
  '/Talking.fbx',
  '/Talking%20(1).fbx',
];

const LAZY_ASSETS = [
  '/Hip%20Hop%20Dancing.fbx',
  '/Hip%20Hop%20Dancing%20(1).fbx',
  '/Salsa%20Dancing.fbx',
  '/Swing%20Dancing.fbx',
  '/Silly%20Dancing.fbx',
  '/Silly%20Dancing%20(1).fbx',
  '/Praying.fbx',
  '/Salute.fbx',
  '/Angry.fbx',
  '/Rapping.fbx',
  '/Jump.fbx',
  '/Push%20Up.fbx',
  '/Backflip.fbx',
  '/Back%20Flip%20To%20Uppercut.fbx',
  '/Front%20Flip.fbx',
  '/Front%20Twist%20Flip.fbx',
  '/Flip%20Kick.fbx',
  '/Run%20To%20Flip.fbx',
  '/Walking.fbx',
];

// ── IndexedDB Helpers ────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db!);
    };

    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve(); // non-fatal
    });
  } catch {
    // IndexedDB unavailable — session-level THREE.Cache still works
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  } catch {}
}

// ── Cache Version Check ──────────────────────────────────────────────────────
// If CACHE_VERSION changed (new FBX files deployed), wipe old IndexedDB cache

async function ensureCacheVersion(): Promise<void> {
  const stored = localStorage.getItem(CACHE_VERSION_KEY);
  if (stored !== CACHE_VERSION) {
    console.log('[AvatarPreloader] Cache version changed — clearing old asset cache');
    await idbClear();
    localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  }
}

// ── Core Preload Logic ───────────────────────────────────────────────────────

async function preloadAsset(url: string): Promise<void> {
  // Already in THREE.Cache (session) — done
  if (THREE.Cache.get(url)) return;

  // 1️⃣ Try IndexedDB (persistent — survives APK kill & reopen)
  const cached = await idbGet(url);
  if (cached) {
    THREE.Cache.add(url, cached);
    console.log('[AvatarPreloader] ⚡ IndexedDB hit:', url.split('/').pop());
    return;
  }

  // 2️⃣ Fetch from network/Capacitor asset server (first time only)
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buffer = await res.arrayBuffer();

    // Store in both THREE.Cache (session) and IndexedDB (permanent)
    THREE.Cache.add(url, buffer);
    await idbSet(url, buffer);

    console.log('[AvatarPreloader] 💾 Cached to IndexedDB:', url.split('/').pop());
  } catch {
    // Non-fatal — FBXLoader will fall back to its own fetch
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let preloadStarted = false;

/**
 * Start the avatar asset preloading pipeline.
 * Call once from main.tsx — idempotent (safe to call multiple times).
 *
 * Phase 1 (immediate): Model + idle + talking → avatar becomes interactive fast
 * Phase 2 (after 1.2s): All other animations → loaded quietly in background
 *
 * On subsequent APK opens: IndexedDB hit — everything loads from device storage
 * with zero network/Capacitor-server overhead.
 */
export async function startAvatarPreload(): Promise<void> {
  if (preloadStarted) return;
  preloadStarted = true;

  // Check and handle cache version invalidation
  await ensureCacheVersion();

  // Phase 1: Critical assets — parallel, immediate
  console.log('[AvatarPreloader] 🚀 Starting critical asset preload...');
  await Promise.allSettled(CRITICAL_ASSETS.map(preloadAsset));
  console.log('[AvatarPreloader] ✅ Critical assets ready — avatar will load instantly');

  // Phase 2: Lazy assets — after critical done + 1.2s breathing room
  setTimeout(() => {
    LAZY_ASSETS.forEach(url => preloadAsset(url));
    console.log('[AvatarPreloader] 🔄 Background caching lazy animations...');
  }, 1200);
}
