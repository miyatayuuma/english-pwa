import { createSwUpdatePrompt } from './swUpdatePrompt.js?v=5.49';

// This entry point is loaded with a versioned URL from index.html so an older
// cache-first worker cannot prevent the app from checking for its replacement.
const updatePrompt=createSwUpdatePrompt();
updatePrompt.registerServiceWorker();
