const APP_VERSION = 'v4.83';

if (typeof globalThis !== 'undefined') {
  globalThis.APP_VERSION = APP_VERSION;
}

// main.js already imports this file. Load optional learning surfaces here so the
// legacy app runtime stays isolated from feature-specific UI code. In the
// service worker there is no document, so importScripts() remains synchronous.
if (typeof document !== 'undefined') {
  import('./app/tagMode.js').catch((error) => {
    console.warn('Tag learning mode failed to load', error);
  });
}
