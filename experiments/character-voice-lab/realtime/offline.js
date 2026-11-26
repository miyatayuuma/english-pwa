export async function saveOffline(pack, dtype, progress) {
  await navigator.serviceWorker.register("./offline-sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve, reject) => {
      const verify = () => {
        if (!navigator.serviceWorker.controller) return;
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", verify);
        resolve();
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", verify);
        reject(new Error("サービスワーカーの有効化に失敗しました"));
      }, 10000);
      navigator.serviceWorker.addEventListener("controllerchange", verify);
      verify();
    });
  }
  const prefix = `kokoro-p36:${new URL(".", location.href).pathname}:`;
  const name = prefix + pack.id + ":" + dtype;
  const cache = await caches.open(name);
  const marker = new URL(`offline-ready-${dtype}`, location.href);
  if (await cache.match(marker)) return;
  const files = ["pack.json", ...pack.files.filter(file => !file.dtype || file.dtype === dtype).map(file => file.path)];
  const estimate = await navigator.storage?.estimate();
  const need = pack.files.filter(file => !file.dtype || file.dtype === dtype).reduce((sum, file) => sum + file.bytes, 0);
  if (estimate?.quota && estimate.quota - (estimate.usage || 0) < need) throw new Error("端末の保存容量が不足しています");
  try {
    for (const [index, file] of files.entries()) {
      progress(index + 1, files.length);
      await cache.add(new URL(file, location.href));
    }
    await cache.put(marker, new Response("ready"));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
  // Keep one complete revision per precision.
  for (const old of await caches.keys()) {
    if (old !== name && old.startsWith(prefix) && old.endsWith(":" + dtype)) await caches.delete(old);
  }
}
