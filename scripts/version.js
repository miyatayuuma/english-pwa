const APP_VERSION = 'v5.38';

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
    // Range choices now belong to one explicit "探す" action. They must not
    // survive a reload and silently drive the next automatic/character start.
    localStorage.removeItem('secSel');
    localStorage.removeItem('itemSearchV1');
    localStorage.removeItem('orderSel');
    localStorage.removeItem('levelFilterV1');
  } catch (_) {}
}

async function loadCharacterGame() {
  // Scoped starts rely on sessionShell's capture-phase bridge. Keep the
  // character game and its roster behind that readiness boundary so every
  // route into play is scoped before the legacy runtime builds a queue.
  await import('./app/sessionShell.js');

  if (!document.getElementById('sessionShellStyles')) {
    await new Promise((resolve) => {
      const onReady = () => resolve();
      document.addEventListener('english-pwa:session-shell-ready', onReady, { once: true });
      if (document.getElementById('sessionShellStyles')) {
        document.removeEventListener('english-pwa:session-shell-ready', onReady);
        resolve();
      }
    });
  }

  await import('./app/relationshipMode.js');
  await import('./app/tagBrowser.js');
}

if (typeof document !== 'undefined') {
  loadCharacterGame().catch((error) => {
    console.warn('Character friendship game failed to load', error);
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
