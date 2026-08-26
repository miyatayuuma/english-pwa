const APP_VERSION = 'v5.06';

if (typeof globalThis !== 'undefined') {
  globalThis.APP_VERSION = APP_VERSION;
}

if (typeof document !== 'undefined') {
  import('./app/tagMode.js').catch((error) => {
    console.warn('Adaptive learning surface failed to load', error);
  });
  import('./app/vocabularyMode.js').catch((error) => {
    console.warn('Vocabulary learning surface failed to load', error);
  });
  import('./app/learningMenu.js').catch((error) => {
    console.warn('Learning navigation failed to load', error);
  });
  import('./app/clozeMode.js').catch((error) => {
    console.warn('Cloze reading surface failed to load', error);
  });
}
