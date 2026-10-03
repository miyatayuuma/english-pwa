// sw.js: cache name follows the app version. v5.72
// Version the import itself so the browser cannot reuse an older worker import.
importScripts('./scripts/version.js?v=5.66');
const CACHE = self.APP_VERSION;

self.addEventListener('install', e => {
  const assets=[
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
    './data/vocabulary-v3.json',
    './data/vocabulary-v3-paraphrase-audit.json',
    './data/vocabulary-v2-v3-migration.json',
    './data/reorder-v1.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-192.png',
    './icons/maskable-512.png',
    './scripts/version.js',
    './scripts/app/main.js',
    './scripts/app/swBootstrap.js?v=5.66',
    './scripts/app/swUpdatePrompt.js?v=5.66',
    './scripts/app/dom.js',
    './scripts/app/levelState.js',
    './scripts/app/overlay.js',
    './scripts/app/cardTransitions.js',
    './scripts/app/reorderGuide.js',
    './scripts/app/reorderGrading.js',
    './scripts/reorder/reorderCore.js',
    './scripts/app/logManager.js',
    './scripts/app/tagLearningCore.js',
    './scripts/app/relationshipCore.js',
    './scripts/app/adaptiveLearning.js',
    './scripts/app/sessionShell.js',
    './scripts/app/sessionOptionsCore.js',
    './scripts/app/relationshipMode.js',
    './scripts/app/tagBrowser.js',
    './scripts/app/vocabularyLearningCore.js',
    './scripts/app/vocabularyMigration.js',
    './scripts/app/vocabularyMode.js',
    './scripts/app/vocabularyFeedbackUx.js',
    './scripts/app/learningMenu.js',
    './scripts/app/sentencePracticeUx.js',
    './scripts/app/clozeLearningCore.js',
    './scripts/app/hintProgressionCore.js',
    './scripts/app/clozeMode.js',
    './scripts/app/postResultFeedback.js',
    './scripts/app/continuousShadowing.js',
    './scripts/app/micStatus.js',
    './scripts/app/resultFeedbackSound.js',
    './scripts/app/cardGestureGuard.js',
    './scripts/app/visualCleanup.js',
    './scripts/audio/controller.js',
    './scripts/audio/resolver.js',
    './scripts/tagging/quotedTurns.js',
    './scripts/speech/recognition.js',
    './scripts/speech/contextualBias.js',
    './scripts/speech/recognitionChunks.js',
    './scripts/speech/vocabularySpeechEvidence.js',
    './scripts/speech/correctionProgress.js',
    './scripts/app/clozeRecognitionContext.js',
    './scripts/speech/synthesis.js',
    './scripts/speech/voiceProfiles.js',
    './scripts/state/studyLog.js',
    './scripts/storage/local.js',
    './scripts/ui/milestones.js',
    './scripts/utils/text.js'
  ];
  e.waitUntil(caches.open(CACHE).then(cache=>Promise.all(assets.map(async asset=>{
    const response=await fetch(new Request(asset,{cache:'reload'}));
    if(!response.ok) throw new Error(`Precache failed: ${asset}`);
    await cache.put(asset,response);
  }))));
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
  const isReorderMetadataRequest = url.pathname.endsWith('/data/reorder-v1.json');

  if (isReorderMetadataRequest) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true })
        || await cache.match(new URL('./data/reorder-v1.json', self.registration.scope).href);
      const refresh = fetch(new Request(e.request, { cache: 'reload' }))
        .then(response => {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(refresh);
        return cached;
      }
      const response = await refresh;
      return response || Response.error();
    }));
    return;
  }

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
