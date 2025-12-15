// sw.js（抜粋）：キャッシュ名は更新ごとに変える
const CACHE = 'v4.62';

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
    './icons/maskable-512.png',
    './scripts/app/main.js',
    './scripts/app/dom.js',
    './scripts/app/levelState.js',
    './scripts/app/overlay.js',
    './scripts/app/cardTransitions.js',
    './scripts/app/composeGuide.js',
    './scripts/app/logManager.js',
    './scripts/audio/controller.js',
    './scripts/speech/recognition.js',
    './scripts/speech/synthesis.js',
    './scripts/state/studyLog.js',
    './scripts/storage/local.js',
    './scripts/ui/milestones.js',
    './scripts/utils/text.js'
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

  const isIconRequest = url.pathname.includes('/icons/');
  const isScriptRequest = url.pathname.includes('/scripts/') && url.pathname.endsWith('.js');

  // icons と scripts はキャッシュ優先（任意）
  if (isIconRequest || isScriptRequest) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      if (cached) return cached;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }));
  }
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
