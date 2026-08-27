const APP_VERSION = 'v5.30';

if (typeof globalThis !== 'undefined') {
  globalThis.APP_VERSION = APP_VERSION;
}

// appConfigV3.studyMode is the only sentence-game source of truth now.
// Remove stale one-time preferences and legacy tag-browser state so old
// installations cannot revive retired UI choices after the P5 migration.
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem('preferredSentenceMethodV1');
    localStorage.removeItem('tagBrowserTabV1');
    localStorage.removeItem('tagBrowserSelectionV1');
  } catch (_) {}
}

if (typeof document !== 'undefined') {
  import('./app/sessionShell.js').catch((error) => {
    console.warn('Session shell failed to load', error);
  });
  import('./app/tagBrowser.js').catch((error) => {
    console.warn('Character/skill browser failed to load', error);
  });
  import('./app/vocabularyMode.js').catch((error) => {
    console.warn('Vocabulary learning surface failed to load', error);
  });
  import('./app/vocabularyFeedbackUx.js').catch((error) => {
    console.warn('Vocabulary feedback UX failed to load', error);
  });
  import('./app/learningMenu.js').catch((error) => {
    console.warn('Learning navigation failed to load', error);
  });
  import('./app/sentencePracticeUx.js').catch((error) => {
    console.warn('Sentence practice UX failed to load', error);
  });
  import('./app/composeDefaults.js').catch((error) => {
    console.warn('Compose defaults failed to load', error);
  });
  import('./app/clozeMode.js').catch((error) => {
    console.warn('Progressive hint surface failed to load', error);
  });
  import('./app/cardGestureGuard.js').catch((error) => {
    console.warn('Card gesture guard failed to load', error);
  });
  import('./app/visualCleanup.js').catch((error) => {
    console.warn('Visual cleanup failed to load', error);
  });
}
