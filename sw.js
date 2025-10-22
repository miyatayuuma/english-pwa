// sw.js（抜粋）：キャッシュ名は更新ごとに変える
const CACHE = 'v2.7';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([
    './',
    './index.html',
    './manifest.webmanifest',
    './styles/app.css',
    './data/items.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-192.png',
    './icons/maskable-512.png'
  ])));
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
});
