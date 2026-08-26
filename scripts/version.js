const APP_VERSION = 'v5.19';

if (typeof globalThis !== 'undefined') {
  globalThis.APP_VERSION = APP_VERSION;
}

if (typeof document !== 'undefined') {
  import('./app/tagMode.js').catch((error) => {
    console.warn('Adaptive learning surface failed to load', error);
  });
  import('./app/tagBrowser.js').catch((error) => {
    console.warn('Tag browser failed to load', error);
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
  import('./app/clozeMode.js').catch((error) => {
    console.warn('Progressive hint surface failed to load', error);
  });
  import('./app/visualCleanup.js').catch((error) => {
    console.warn('Visual cleanup failed to load', error);
  });
}
