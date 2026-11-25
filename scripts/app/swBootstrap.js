// This script runs before the app's module graph, including when a legacy
// worker still serves copies of those modules from its cache.
(() => {
  if (globalThis.Capacitor?.isNativePlatform?.() || !('serviceWorker' in navigator)) return;
  const serviceWorker = navigator.serviceWorker;
  const controller = serviceWorker.controller;
  const entry = document.currentScript;
  const version = entry && new URL(entry.src).searchParams.get('v');
  const registration = serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(value => {
      if (!value) return null;
      value.update().catch(() => {});
      return value;
    })
    .catch(() => null);

  const ready = controller && version ? waitForMatchingWorker(controller, `v${version}`) : Promise.resolve();
  globalThis.__ENGLISH_PWA_SW_BOOTSTRAP__ = { registration, ready };
  if (entry?.hasAttribute('data-open-app')) ready.then(() => location.replace('./'));

  function waitForMatchingWorker(worker, expectedVersion) {
    return new Promise(resolve => {
      const recovery = document.getElementById('workerRecovery');
      const showRecovery = () => { if (recovery) recovery.hidden = false; };
      const timeout = setTimeout(showRecovery, 1200);
      const reload = () => location.reload();
      serviceWorker.addEventListener('controllerchange', reload, { once: true });
      recovery?.querySelector('button')?.addEventListener('click', reload);

      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        if (event.data?.version !== expectedVersion || serviceWorker.controller !== worker) return;
        channel.port1.close();
        clearTimeout(timeout);
        if (recovery) recovery.hidden = true;
        serviceWorker.removeEventListener('controllerchange', reload);
        resolve();
      };
      try {
        worker.postMessage({ type: 'ENGLISH_PWA_VERSION' }, [channel.port2]);
      } catch {
        showRecovery();
      }
    });
  }
})();
