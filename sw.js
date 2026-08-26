// sw.js: cache name follows the app version.
importScripts('./scripts/version.js');
const CACHE = self.APP_VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([
    './',
    './index.html',
    './manifest.webmanifest',
    './styles/app.css',
    './styles/tokens.css',
    './styles/base.css',
    './styles/screens.css',
    './styles/components.css',
    './data/items.json',
    './data/characters.json',
    './data/vocabulary-v2.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-192.png',
    './icons/maskable-512.png',
    './scripts/version.js',
    './scripts/app/main.js',
    './scripts/app/dom.js',
    './scripts/app/levelState.js',
    './scripts/app/overlay.js',
    './scripts/app/cardTransitions.js',
    './scripts/app/composeGuide.js',
    './scripts/app/logManager.js',
    './scripts/app/tagLearningCore.js',
    './scripts/app/adaptiveLearning.js',
    './scripts/app/uxMetrics.js',
    './scripts/app/tagMode.js',
    './scripts/app/vocabularyLearningCore.js',
    './scripts/app/vocabularyMode.js',
    './scripts/audio/controller.js',
    './scripts/speech/recognition.js',
    './scripts/speech/synthesis.js',
    './scripts/state/studyLog.js',
    './scripts/storage/local.js',
    './scripts/ui/milestones.js',
    './scripts/utils/text.js'
  ])));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

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
  const isCharacterImageRequest = url.pathname.endsWith('.png') && !isIconRequest;
  const isScriptRequest = url.pathname.includes('/scripts/') && url.pathname.endsWith('.js');
  const isStyleRequest = e.request.destination === 'style' || url.pathname.endsWith('.css');

  if (isStyleRequest) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const networkFetch = fetch(e.request)
        .then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(networkFetch);
        return cached;
      }
      const networkRes = await networkFetch;
      if (networkRes) return networkRes;
      return Response.error();
    }));
    return;
  }

  // Character art is intentionally cached lazily; the source PNGs are large.
  if (isIconRequest || isCharacterImageRequest || isScriptRequest) {
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
  if (event?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
