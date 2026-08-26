const APP_VERSION = 'v5.03';

if (typeof globalThis !== 'undefined') {
  globalThis.APP_VERSION = APP_VERSION;
}

// The learner no longer needs to choose an internal task model. Keep the
// legacy engine on its unified read/speak path; adaptiveLearning decides how
// much support each sentence receives from the learner's current state.
if (typeof document !== 'undefined') {
  try {
    const raw = globalThis.localStorage?.getItem('appConfigV3');
    const cfg = raw ? JSON.parse(raw) : {};
    if (!cfg || typeof cfg !== 'object') throw new Error('invalid config');
    if (cfg.studyMode !== 'read') {
      cfg.studyMode = 'read';
      globalThis.localStorage?.setItem('appConfigV3', JSON.stringify(cfg));
    }
  } catch (_) {
    try {
      globalThis.localStorage?.setItem('appConfigV3', JSON.stringify({ studyMode: 'read' }));
    } catch (_) {}
  }

  import('./app/tagMode.js').catch((error) => {
    console.warn('Adaptive learning surface failed to load', error);
  });
  import('./app/vocabularyMode.js').catch((error) => {
    console.warn('Vocabulary learning surface failed to load', error);
  });
}
