// Version the import itself so the browser cannot reuse an older worker import.
importScripts('./scripts/version.js?v=5.119');
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `english-pwa:${SCOPE}:`;
const CACHE = CACHE_PREFIX + self.APP_VERSION;
const INDEX = new URL('./index.html', SCOPE);
const RECOVERY = new URL('./recover.html', SCOPE);
const LEGACY_CACHE = 'v5.117';

async function isLegacyUpgrade() {
  if (await caches.has(CACHE_PREFIX + 'v5.118')) return true;
  return !!await caches.match(new URL('./scripts/app/main.js', SCOPE), { cacheName: LEGACY_CACHE });
}

async function clearLegacyAssets() {
  if (!await caches.has(LEGACY_CACHE)) return;
  const cache = await caches.open(LEGACY_CACHE);
  const requests = await cache.keys();
  await Promise.all(requests.filter(request => request.url.startsWith(SCOPE)).map(request => cache.delete(request)));
}

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
    // A legacy page may be unable to show the update prompt. Its controller
    // can be replaced once the full new cache is ready, without navigating tabs.
    if (await isLegacyUpgrade()) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await clearLegacyAssets();
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
      if (url.pathname === RECOVERY.pathname) {
        const online = await fetch(new Request(request, { cache: 'no-cache' })).catch(() => null);
        if (online?.ok) return online;
      }
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
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'ENGLISH_PWA_VERSION') event.ports[0]?.postMessage({ version: self.APP_VERSION });
});
