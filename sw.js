// sw.js（抜粋）：キャッシュ名は更新ごとに変える
const CACHE = 'v3.4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './data/items.json',
  './scripts/app/main.js',
  './scripts/app/composeGuide.js',
  './scripts/app/logManager.js',
  './scripts/app/overlay.js',
  './scripts/app/cardTransitions.js',
  './scripts/app/levelState.js',
  './scripts/app/dom.js',
  './scripts/app/drill.js',
  './scripts/ui/milestones.js',
  './scripts/speech/synthesis.js',
  './scripts/speech/recognition.js',
  './scripts/utils/text.js',
  './scripts/utils/phonetics.js',
  './scripts/storage/local.js',
  './scripts/api/dictionary.js',
  './scripts/audio/controller.js',
  './scripts/state/studyLog.js',
  './scripts/state/difficulty.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE_ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // srs.json が 404 / オフラインでも空配列を返す
  if (url.pathname.endsWith('/data/srs.json')) {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request);
        if (r.ok) return r;
      } catch (_) {}
      return new Response('[]', { headers: { 'Content-Type': 'application/json' }});
    })());
    return;
  }

  if (url.origin === self.location.origin && e.request.method === 'GET') {
    const cacheablePath = /\/(scripts|styles|data)\//.test(url.pathname);

    if (cacheablePath) {
      e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch (_) {
          const cached = await cache.match(e.request);
          if (cached) return cached;
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        }
      })());
      return;
    }

    // icons はキャッシュ優先（任意）
    if (url.pathname.includes('/icons/')) {
      e.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }));
    }
  }
});
