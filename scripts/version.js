const APP_VERSION = 'v5.31';

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

async function loadCharacterSkillBrowser() {
  // The browser starts scoped study by clicking the legacy start CTA.  Its
  // capture-phase interceptor is registered by sessionShell only after the
  // main runtime is ready.  Loading both modules in parallel leaves a race in
  // which the browser can start an unscoped legacy section before that
  // interceptor exists.  Do not expose the browser until the shell has
  // completed initialization.
  await import('./app/sessionShell.js');

  if (!document.getElementById('sessionShellStyles')) {
    await new Promise((resolve) => {
      const onReady = () => resolve();
      document.addEventListener('english-pwa:session-shell-ready', onReady, { once: true });

      // The ready event can win the microtask race with the import continuation.
      // Re-check the completion marker after installing the listener.
      if (document.getElementById('sessionShellStyles')) {
        document.removeEventListener('english-pwa:session-shell-ready', onReady);
        resolve();
      }
    });
  }

  await import('./app/tagBrowser.js');
}

if (typeof document !== 'undefined') {
  loadCharacterSkillBrowser().catch((error) => {
    console.warn('Character/skill learning shell failed to load', error);
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
