import { ensureServiceWorkerRegistration } from './swUpdatePrompt.js?v=5.118';

// This entry point is versioned so an older cache-first worker cannot prevent
// the update check. The current runtime owns the update prompt and its timing.
ensureServiceWorkerRegistration();
