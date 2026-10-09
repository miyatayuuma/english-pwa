const DEFAULT_MAX_ATTEMPTS = 40;
const DEFAULT_MAX_EVENTS_PER_ATTEMPT = 120;

function makeId(scope = globalThis) {
  try {
    if (typeof scope.crypto?.randomUUID === 'function') return scope.crypto.randomUUID();
  } catch (_) { /* Use the local fallback. */ }
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function snapshot(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (_) { return null; }
}

function redactMetadata(value) {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/transcript|utterance|canonical|sentence|surface|observed|expected|meaning|display|source.?text|english|^(text|en|ja|value)$/i.test(key)
      && typeof child === 'string') {
      output[key] = '[redacted]';
    } else {
      output[key] = redactMetadata(child);
    }
  }
  return output;
}

export function createGameTraceCollector({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxEventsPerAttempt = DEFAULT_MAX_EVENTS_PER_ATTEMPT,
  now = () => Date.now(),
  createId = () => makeId(),
  onChange = () => {},
} = {}) {
  const attempts = [];
  const subscribers = new Set();
  let enabled = false;
  let traceSessionId = null;
  let sequence = 0;

  function changed() {
    try { onChange({ enabled, traceSessionId, sequence, attempts }); }
    catch (_) { /* Diagnostics must not interfere with the game. */ }
    for (const listener of subscribers) {
      try { listener({ enabled, traceSessionId, sequence, attempts }); }
      catch (_) { /* Diagnostics must not interfere with the game. */ }
    }
  }

  function prune() {
    while (attempts.length > Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS)) {
      attempts.shift();
    }
  }

  function getOrCreate({ attemptId, nativeSessionId = null, context = null, requestedTraceSessionId = null, forceNew = false } = {}) {
    if (attemptId == null || attemptId === '') return null;
    const stringAttemptId = String(attemptId);
    const sessionId = requestedTraceSessionId ?? traceSessionId ?? createId();
    const existing = forceNew ? null : [...attempts].reverse().find(item =>
      String(item.attemptId) === stringAttemptId && item.traceSessionId === sessionId);
    if (existing) return existing;
    if (!traceSessionId) traceSessionId = sessionId;
    const createdAt = now();
    const attempt = {
      traceSessionId: sessionId,
      attemptId,
      nativeSessionId: nativeSessionId == null ? null : String(nativeSessionId),
      context: snapshot(context) || {},
      itemId: context?.itemId ?? null,
      entryId: context?.entryId ?? null,
      activeOccurrence: snapshot(context?.activeOccurrence ?? null),
      gameMode: context?.gameMode ?? null,
      learningStage: context?.learningStage ?? null,
      correctionActive: context?.correctionActive === true,
      startedAt: createdAt,
      updatedAt: createdAt,
      closed: false,
      recognitionStatus: 'requested',
      lastFinalDecision: null,
      events: [],
      _eventIds: new Set(),
    };
    attempts.push(attempt);
    prune();
    return attempt;
  }

  function record({
    type,
    attemptId,
    traceSessionId: requestedTraceSessionId = null,
    nativeSessionId = null,
    context = null,
    eventId = null,
    ...details
  } = {}) {
    if (!enabled || !type) return null;
    try {
      if (requestedTraceSessionId != null && requestedTraceSessionId !== traceSessionId) return null;
      if (eventId != null) {
        const previous = [...attempts].reverse().find(item =>
          String(item.attemptId) === String(attemptId) && item.traceSessionId === (requestedTraceSessionId ?? traceSessionId));
        if (previous?._eventIds.has(String(eventId))) return null;
      }
      const attempt = getOrCreate({
        attemptId, nativeSessionId, context,
        requestedTraceSessionId,
        forceNew: type === 'recognition-start-requested',
      });
      if (!attempt) return null;
      if (nativeSessionId != null) attempt.nativeSessionId = String(nativeSessionId);
      if (eventId != null) {
        const dedupeId = String(eventId);
        if (attempt._eventIds.has(dedupeId)) return null;
        attempt._eventIds.add(dedupeId);
      }
      const event = {
        schemaVersion: 'asr-game-trace-v1',
        traceSessionId: attempt.traceSessionId,
        sequence: ++sequence,
        timestamp: new Date(now()).toISOString(),
        attemptId: attempt.attemptId,
        nativeSessionId: attempt.nativeSessionId,
        itemId: attempt.context?.itemId ?? null,
        entryId: attempt.context?.entryId ?? null,
        activeOccurrence: snapshot(attempt.context?.activeOccurrence ?? null),
        gameMode: attempt.context?.gameMode ?? null,
        learningStage: attempt.context?.learningStage ?? null,
        correctionActive: attempt.context?.correctionActive === true,
        type: String(type),
        ...(eventId == null ? {} : { eventId: String(eventId) }),
        ...snapshot(details),
      };
      attempt.events.push(event);
      const eventLimit = Math.max(4, Number(maxEventsPerAttempt) || DEFAULT_MAX_EVENTS_PER_ATTEMPT);
      if (attempt.events.length > eventLimit) attempt.events.splice(0, attempt.events.length - eventLimit);
      attempt.updatedAt = now();
      if (type === 'recognition-started') attempt.recognitionStatus = 'listening';
      if (type === 'interim-result-received') attempt.recognitionStatus = 'interim';
      if (type === 'final-result-received') attempt.recognitionStatus = 'final-pending-terminal';
      if (type === 'terminal-recognition-completed') {
        attempt.recognitionStatus = details.completionState === 'error' ? 'error'
          : details.completionState === 'cancelled' ? 'cancelled' : 'terminal';
      }
      if (type === 'recognition-failed') attempt.recognitionStatus = 'error';
      if (type === 'recognition-cancelled') attempt.recognitionStatus = 'cancelled';
      if (type === 'game-grading-completed' || type === 'final-ui-result-committed') {
        attempt.lastFinalDecision = snapshot(details.decision ?? details.finalDecision ?? null);
      }
      if (type === 'attempt-closed') attempt.closed = true;
      delete attempt._eventIds;
      attempt._eventIds = new Set(attempt.events.map(item => item.eventId).filter(Boolean));
      if (eventId != null) attempt._eventIds.add(String(eventId));
      changed();
      return event;
    } catch (_) {
      return null;
    }
  }

  function setEnabled(value) {
    const next = value === true;
    if (next === enabled) return enabled;
    if (next) traceSessionId = createId();
    enabled = next;
    changed();
    return enabled;
  }

  function clear() {
    attempts.length = 0;
    if (enabled) traceSessionId = createId();
    changed();
  }

  function getAttemptTraceSessionId(attemptId) {
    if (attemptId == null || attemptId === '') return null;
    const attempt = [...attempts].reverse().find(item => String(item.attemptId) === String(attemptId));
    return attempt?.traceSessionId ?? null;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function list() {
    return snapshot(attempts.map(({ _eventIds, ...attempt }) => attempt)) || [];
  }

  function getLatest() {
    const latest = attempts.at(-1);
    if (!latest) return null;
    const { _eventIds, ...publicAttempt } = latest;
    return snapshot(publicAttempt);
  }

  function exportJSON({ metadataOnly = false, latestOnly = false } = {}) {
    const output = {
      schemaVersion: 'asr-game-trace-export-v1',
      exportedAt: new Date(now()).toISOString(),
      metadataOnly: metadataOnly === true,
      attempts: latestOnly ? (getLatest() ? [getLatest()] : []) : list(),
    };
    return JSON.stringify(metadataOnly ? redactMetadata(output) : output, null, 2);
  }

  return Object.freeze({
    setEnabled,
    isEnabled: () => enabled,
    getTraceSessionId: () => traceSessionId,
    record,
    clear,
    subscribe,
    list,
    getLatest,
    getAttemptTraceSessionId,
    exportJSON,
    getSequence: () => sequence,
  });
}

const gameTraceCollectorInternal = createGameTraceCollector();
export const gameTraceCollector = Object.freeze({
  isEnabled: gameTraceCollectorInternal.isEnabled,
  getTraceSessionId: gameTraceCollectorInternal.getTraceSessionId,
  getAttemptTraceSessionId: gameTraceCollectorInternal.getAttemptTraceSessionId,
  record: gameTraceCollectorInternal.record,
  clear: gameTraceCollectorInternal.clear,
  subscribe: gameTraceCollectorInternal.subscribe,
  list: gameTraceCollectorInternal.list,
  getLatest: gameTraceCollectorInternal.getLatest,
  exportJSON: gameTraceCollectorInternal.exportJSON,
  getSequence: gameTraceCollectorInternal.getSequence,
});

export async function setGameTraceCaptureEnabled(value) {
  const next = value === true;
  if (next) {
    try {
      const { getNativeGameTrace } = await import('./nativeSpeech.js');
      const { isNativeAndroid } = await import('./runtimePlatform.js');
      if (!isNativeAndroid()) return false;
      const capability = await (await getNativeGameTrace()).getCapability();
      if (capability?.available !== true || capability?.enabled !== true) return false;
    } catch (_) {
      return false;
    }
  }
  return gameTraceCollectorInternal.setEnabled(next);
}

export function safeGameTraceRecord(event) {
  try {
    const knownSessionId = event?.traceSessionId ?? gameTraceCollector.getAttemptTraceSessionId(event?.attemptId);
    return gameTraceCollector.record({ ...event, ...(knownSessionId ? { traceSessionId: knownSessionId } : {}) });
  }
  catch (_) { return null; }
}
