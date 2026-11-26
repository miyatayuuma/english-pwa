const scope = new URL(self.registration.scope);
const cachePrefix = `kokoro-p36:${scope.pathname}:`;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const request = url.href === scope.href ? new URL("index.html", scope).href : event.request;
  event.respondWith((async () => {
    // Work online with the current checkout, then use the complete saved pack if unreachable.
    try {
      return await fetch(event.request);
    } catch (error) {
      for (const name of (await caches.keys()).reverse()) {
        if (!name.startsWith(cachePrefix)) continue;
        const cache = await caches.open(name);
        const dtype = name.split(":").at(-1);
        if (!await cache.match(new URL(`offline-ready-${dtype}`, scope))) continue;
        const response = await cache.match(request);
        if (response) return response;
      }
      throw error;
    }
  })());
});
