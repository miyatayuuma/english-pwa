const DIAGNOSTICS_KEY = '__nativeGameTraceReadiness';
const BRIDGE_DIAGNOSTICS_KEY = '__nativeGameTraceBridgeDiagnosticsInstalled';
const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const CAPABILITY_TYPES = new Set(['initializer', 'launch-update', 'gate-snapshot', 'gate-return']);
let documentGenerationId = null;
let capabilityRequestSequence = 0;
let capabilityCallbackRequests = new Map();
let capabilityResponsesSeen = new Set();
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
  'documentGenerationId',
  'requestId',
  'requestType',
  'callbackId',
  'resolutionStatus',
  'transport',
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
      documentGenerationId: getDocumentGenerationId(),
    };
  }
  return globalThis[DIAGNOSTICS_KEY];
}

function getDocumentGenerationId() {
  if (!documentGenerationId) {
    const clock = Math.max(0, Math.trunc(globalThis.performance?.timeOrigin ?? Date.now())).toString(36);
    const nonce = Math.random().toString(36).slice(2, 9);
    documentGenerationId = `d${clock}${nonce}`.slice(0, 24);
  }
  return documentGenerationId;
}

export function createGameTraceCapabilityRequest(requestType) {
  const safeType = CAPABILITY_TYPES.has(requestType) ? requestType : 'initializer';
  if (globalThis.Capacitor?.DEBUG !== true) return {};
  const diagnostics = getGameTraceReadinessDiagnostics();
  const requestId = `${getDocumentGenerationId()}-${safeType}-${++capabilityRequestSequence}`;
  diagnostics.documentGenerationId = getDocumentGenerationId();
  recordGameTraceReadiness('native-capability-facade-invoked', {
    documentGenerationId: diagnostics.documentGenerationId,
    requestId,
    requestType: safeType,
  });
  return { diagnosticRequestId: requestId, diagnosticRequestType: safeType };
}

function recordCapabilityResponse(result, transport) {
  if (!result || result.pluginId !== 'NativeGameTrace' || result.methodName !== 'getCapability') return;
  const callbackId = String(result.callbackId ?? '');
  if (!/^\d{1,20}$/u.test(callbackId) || capabilityResponsesSeen.has(callbackId)) return;
  const requestId = capabilityCallbackRequests.get(callbackId);
  if (requestId) {
    capabilityCallbackRequests.delete(callbackId);
    capabilityResponsesSeen.add(callbackId);
    if (capabilityResponsesSeen.size > 40) {
      capabilityResponsesSeen.delete(capabilityResponsesSeen.values().next().value);
    }
    recordGameTraceReadiness('native-capability-bridge-response-received', {
      requestId,
      callbackId,
      resolutionStatus: result.success === true ? 'resolved' : 'rejected',
      transport,
    });
    return;
  }
  if (capabilityCallbackRequests.size < 40) {
    recordGameTraceReadiness('native-capability-bridge-response-unmatched', {
      documentGenerationId: getDocumentGenerationId(),
      callbackId,
      resolutionStatus: result.success === true ? 'resolved' : 'rejected',
      transport,
    });
  }
}

export function installGameTraceCapabilityBridgeDiagnostics(scope = globalThis) {
  const capacitor = scope.Capacitor;
  if (capacitor?.DEBUG !== true || typeof capacitor.toNative !== 'function') return false;
  if (capacitor[BRIDGE_DIAGNOSTICS_KEY] === true) return true;

  const originalToNative = capacitor.toNative;
  capacitor.toNative = function (...args) {
    const [pluginName, methodName, options] = args;
    const callbackId = originalToNative.apply(this, args);
    const requestId = options?.diagnosticRequestId;
    if (pluginName === 'NativeGameTrace' && methodName === 'getCapability'
        && typeof requestId === 'string' && CAPABILITY_ID_PATTERN.test(requestId)
        && /^\d{1,20}$/u.test(String(callbackId ?? ''))) {
      const id = String(callbackId);
      capabilityCallbackRequests.set(id, requestId);
      while (capabilityCallbackRequests.size > 40) {
        capabilityCallbackRequests.delete(capabilityCallbackRequests.keys().next().value);
      }
      recordGameTraceReadiness('native-capability-bridge-request-created', {
        documentGenerationId: getDocumentGenerationId(),
        requestId,
        requestType: CAPABILITY_TYPES.has(options?.diagnosticRequestType)
          ? options.diagnosticRequestType : 'initializer',
        callbackId: id,
      });
    }
    return callbackId;
  };

  const originalFromNative = capacitor.fromNative;
  if (typeof originalFromNative === 'function') {
    capacitor.fromNative = function (result, ...args) {
      recordCapabilityResponse(result, 'capacitor-from-native');
      return originalFromNative.call(this, result, ...args);
    };
  }

  const androidBridge = scope.androidBridge;
  if (androidBridge && typeof androidBridge.onmessage === 'function') {
    const originalOnMessage = androidBridge.onmessage;
    androidBridge.onmessage = function (event, ...args) {
      try {
        recordCapabilityResponse(JSON.parse(event?.data || 'null'), 'android-bridge-onmessage');
      } catch (_) {
        // The original bridge handler owns malformed-message behavior.
      }
      return originalOnMessage.call(this, event, ...args);
    };
  }

  Object.defineProperty(capacitor, BRIDGE_DIAGNOSTICS_KEY, { value: true, configurable: false });
  return true;
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
    if (key === 'errorType' || key === 'failedStage' || key === 'requestType'
        || key === 'resolutionStatus' || key === 'transport') event[key] = boundedName(value);
    else if (key === 'documentGenerationId' || key === 'requestId') {
      if (typeof value === 'string' && CAPABILITY_ID_PATTERN.test(value)) event[key] = value;
    } else if (key === 'callbackId') {
      if (typeof value === 'string' && /^\d{1,20}$/u.test(value)) event[key] = value;
    }
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
