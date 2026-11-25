// Version the import itself so the browser cannot reuse an older worker import.
importScripts('./scripts/version.js?v=5.118');
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `english-pwa:${SCOPE}:`;
const CACHE = CACHE_PREFIX + self.APP_VERSION;
const INDEX = new URL('./index.html', SCOPE);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const manifestUrl = new URL('./runtime-assets.json', SCOPE);
    const manifest = await fetch(manifestUrl, { cache: 'reload' });
    if (!manifest.ok) throw new Error('Runtime asset list is unavailable');
    const assets = await manifest.json();
    const cache = await caches.open(CACHE);
    // A single Cache.addAll transaction makes this release available offline
    // only after all required HTML, code, curriculum and portraits are present.
    await cache.addAll(assets.map(asset => new Request(new URL(asset, SCOPE), { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      const url = new URL(request.url);
      const target = url.pathname === new URL(SCOPE).pathname ? INDEX : url;
      const saved = await cache.match(target.href, { ignoreSearch: true });
      if (saved) return saved;
    } else {
      const saved = await cache.match(request);
      if (saved) return saved;
    }
    return fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
