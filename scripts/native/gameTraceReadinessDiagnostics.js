const DIAGNOSTICS_KEY = '__nativeGameTraceReadiness';
const DETAIL_KEYS = new Set([
  'nativeAndroid',
  'pluginAvailable',
  'available',
  'enabled',
  'panelPresent',
  'panelConnected',
  'capabilityEnabled',
  'terminal',
  'failedStage',
  'errorType',
]);

function boundedName(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(value)
    ? value
    : 'UnknownError';
}

function timestamp() {
  return typeof globalThis.performance?.now === 'function'
    ? Math.round(globalThis.performance.now() * 1000) / 1000
    : null;
}

export function getGameTraceReadinessDiagnostics() {
  if (globalThis.Capacitor?.DEBUG !== true) return null;
  if (!globalThis[DIAGNOSTICS_KEY]) {
    globalThis[DIAGNOSTICS_KEY] = {
      schemaVersion: 1,
      debugOnly: true,
      clock: 'performance.now per document',
      phase: 'not-started',
      terminal: false,
      events: [],
      javascriptErrors: [],
    };
  }
  return globalThis[DIAGNOSTICS_KEY];
}

export function recordGameTraceReadiness(stage, details = {}) {
  const diagnostics = getGameTraceReadinessDiagnostics();
  if (!diagnostics) return null;
  const event = {
    sequence: diagnostics.events.length + 1,
    stage: boundedName(stage),
    atMs: timestamp(),
  };
  for (const [key, value] of Object.entries(details)) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (key === 'errorType' || key === 'failedStage') event[key] = boundedName(value);
    else if (typeof value === 'boolean') event[key] = value;
  }
  diagnostics.phase = event.stage;
  if (typeof event.terminal === 'boolean') diagnostics.terminal = event.terminal;
  diagnostics.events.push(event);
  if (diagnostics.events.length > 60) diagnostics.events.shift();
  if (typeof globalThis.window?.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.window.dispatchEvent(new CustomEvent('native-game-trace-readiness', { detail: event }));
  }
  return event;
}

export function installGameTraceReadinessErrorCapture() {
  const diagnostics = getGameTraceReadinessDiagnostics();
  if (!diagnostics || diagnostics.errorListenersInstalled
      || typeof globalThis.window?.addEventListener !== 'function') return;
  diagnostics.errorListenersInstalled = true;
  globalThis.window.addEventListener('error', event => {
    const errors = getGameTraceReadinessDiagnostics()?.javascriptErrors;
    if (!errors) return;
    const source = String(event.filename || '').split(/[?#]/u, 1)[0].slice(-120);
    errors.push({
      type: 'error',
      errorType: boundedName(event.error?.name),
      source,
      line: Number(event.lineno) || 0,
      column: Number(event.colno) || 0,
      atMs: timestamp(),
    });
    if (errors.length > 20) errors.shift();
  });
  globalThis.window.addEventListener('unhandledrejection', event => {
    const errors = getGameTraceReadinessDiagnostics()?.javascriptErrors;
    if (!errors) return;
    errors.push({
      type: 'unhandledrejection',
      errorType: boundedName(event.reason?.name),
      atMs: timestamp(),
    });
    if (errors.length > 20) errors.shift();
  });
}
