const CACHE_NAME = 'pipespec-offline-v1';

// Exact file list mapped from your project directory
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './Pipespec.png',

  // 3D Model Subfolder (both raw and URL-encoded paths)
  './3D Model/3D Model.html',
  './3D%20Model/3D%20Model.html',
  './3D Model/2D.png',
  './3D Model/Download.png',
  './3D Model/icon.png',

  // Local Vendor Libraries
  './assets/vendor/tailwindcss-play-cdn.js',
  './assets/vendor/three-r128.min.js',

  // All 26 Piping Data & Drawing Asset Files
  './blnu-assets.js',
  './fl6b-assets.js',
  './flbs-assets.js',
  './flbx-assets.js',
  './flco-assets.js',
  './fldi-assets.js',
  './flhb-assets.js',
  './flre-assets.js',
  './fswa-assets.js',
  './ftbw-assets.js',
  './ftsc-assets.js',
  './ftsw-assets.js',
  './gflt-assets.js',
  './gpas-assets.js',
  './grtj-assets.js',
  './gspr-assets.js',
  './orifice-assets.js',
  './pipe-flex-assets.js',
  './ptem-assets.js',
  './searchfile-assets.js',
  './series-a-assets.js',
  './span-assets.js',
  './strainer-assets.js',
  './vlbw-assets.js',
  './vlfl-assets.js',
  './vlsc-assets.js',
  './vlsw-assets.js',
  './wbol-assets.js'
];

// 1. INSTALL: Pre-cache all files fault-tolerantly
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Skipped:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE: Remove outdated caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// 3. FETCH: Serve from cache first, fallback to network & cache dynamically (e.g. component-icons)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Match exact URL or ignore search query parameters (?component=flhb&size=10)
      const cachedResponse =
        (await cache.match(event.request)) ||
        (await cache.match(event.request, { ignoreSearch: true }));

      if (cachedResponse) {
        // Refresh cache in background when online
        fetch(event.request)
          .then((netRes) => {
            if (netRes && netRes.status === 200) {
              cache.put(event.request, netRes.clone());
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      // If not cached yet (like images inside /component-icons/), fetch and cache them
      try {
        const networkResponse = await fetch(event.request);
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.url.startsWith(self.location.origin)
        ) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // Offline Navigation Fallback for page refreshes & direct URL entry
        if (event.request.mode === 'navigate') {
          const url = decodeURIComponent(event.request.url);
          if (url.includes('3D Model')) {
            return (
              (await cache.match('./3D Model/3D Model.html', { ignoreSearch: true })) ||
              (await cache.match('./3D%20Model/3D%20Model.html', { ignoreSearch: true }))
            );
          }
          return await cache.match('./index.html', { ignoreSearch: true });
        }
        throw err;
      }
    })()
  );
});
