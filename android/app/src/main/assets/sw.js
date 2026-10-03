// ── FRIDAY 3D Assets Service Worker ──────────────────────────────────────────
// Caches all 3D model & animation FBX files on first visit.
// From 2nd visit onwards: instant load from local disk, zero network.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'friday-3d-assets-v1';

// All 3D assets to pre-cache (model + animations)
const ASSETS_TO_CACHE = [
  '/friday.fbx',
  '/Breathing%20Idle%20(1).fbx',
  '/Talking.fbx',
  '/Talking%20(1).fbx',
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

// ── Install: Cache all assets in background ───────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Friday 3D Assets cache...');
  // skipWaiting so new SW takes over immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache assets one by one so a single failure doesn't block everything
      let cached = 0;
      for (const url of ASSETS_TO_CACHE) {
        try {
          await cache.add(url);
          cached++;
          console.log(`[SW] Cached (${cached}/${ASSETS_TO_CACHE.length}): ${url}`);
        } catch (err) {
          console.warn(`[SW] Could not cache ${url}:`, err);
        }
      }
      console.log(`[SW] ✅ Pre-cache complete: ${cached}/${ASSETS_TO_CACHE.length} assets ready`);
    })
  );
});

// ── Activate: Clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-first for FBX files, network-first for everything else ───────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept .fbx and .glb files
  if (url.pathname.endsWith('.fbx') || url.pathname.endsWith('.glb')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          console.log('[SW] ⚡ Serving from cache:', url.pathname);
          return cached;
        }
        // Not in cache yet — fetch from network and cache it
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // All other requests: normal network (don't interfere)
});
