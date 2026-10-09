import { appendRawTranscriptFinal, recognitionSegment } from './recognitionEvidence.js';
import { REQUESTED_MAX_ALTERNATIVES } from './recognitionPolicy.js';
import { selectRecognitionBackend } from '../native/androidSpeechBackend.js';
import { hasSafeSpeechToken } from './safeSpeechNormalization.js';

const SR = selectRecognitionBackend();
let nextRecognitionAttemptId = 1;

export function isRecognitionSupported() {
  return !!SR;
}
export function hasRecognizedSpeech(transcript) {
  return hasSafeSpeechToken(transcript);
}

export { appendRawTranscriptFinal } from './recognitionEvidence.js';

export function composeRawTranscriptPreview(stable, interim) {
  return appendRawTranscriptFinal(stable, interim);
}

export function createRecognitionController(options = {}) {
  const {
    onTranscriptReset = () => {},
    onTranscriptInterim = () => {},
    onTranscriptFinal = () => {},
    onTranscriptPreview = () => {},
    getRecognitionContext = () => null,
    getAttemptContext = () => null,
    isTracing = () => false,
    getTraceSessionId = () => null,
    onTraceEvent = () => {},
    onRecognitionConfigured = () => {},
    recognitionBackend = SR,
    onStart = () => {},
    onStop = () => {},
    onAutoStop = () => {},
    onUnsupported = () => {},
    onError = () => {},
    setMicState = () => {},
  } = options;

  let recognition = null;
  let active = false;
  let finalized = false;
  let stableText = '';
  let latestPreview = '';
  let stopRequested = false;
  let segments = [];
  let pendingStop = null;
  let completionState = 'idle';
  let attemptId = null;
  let attemptContext = null;
  let attemptTraceSessionId = null;
  let traceAttemptActive = false;
  let backendType = null;
  let nativeSessionId = null;
  let providerInfo = null;
  let requestedMaxAlternatives = REQUESTED_MAX_ALTERNATIVES;
  let traceEventSequence = 0;

  function trace(type, details = {}) {
    if (!traceAttemptActive) return;
    try {
      onTraceEvent({
        type,
        attemptId,
        traceSessionId: attemptTraceSessionId,
        nativeSessionId,
        context: attemptContext,
        backendType,
        providerInfo,
        requestedMaxAlternatives,
        eventId: `${attemptId}:${type}:${++traceEventSequence}`,
        ...details,
      });
    } catch (_) { /* A diagnostic observer cannot affect recognition. */ }
  }

  function settleStop(result) {
    const pending = pendingStop;
    pendingStop = null;
    pending?.resolve(result);
  }

  function getRecognitionSegments() {
    return segments.filter(Boolean).map(segment => ({
      ...segment,
      alternatives: segment.alternatives.map(candidate => ({ ...candidate })),
    }));
  }

  function evidence(transcript = latestPreview) {
    return {
      transcript,
      primaryTranscript: transcript,
      previewTranscript: latestPreview,
      recognitionSegments: getRecognitionSegments(),
      attemptId,
      traceSessionId: attemptTraceSessionId,
      nativeSessionId,
      backendType,
      providerInfo,
      requestedMaxAlternatives,
      ...(traceAttemptActive ? { gameContext: attemptContext } : {}),
      completionState,
      recognitionComplete: completionState === 'terminal',
      stopReason: stopRequested ? 'manual-stop' : (completionState === 'terminal' ? 'auto-stop' : null),
    };
  }

  function finalize({ triggeredByOnEnd = false } = {}) {
    if (!active && !triggeredByOnEnd) {
      return { ok: false, reason: 'inactive', ...evidence(stableText.trim()) };
    }
    active = false;
    finalized = true;
    completionState = 'terminal';
    setMicState?.(false);
    onStop?.();
    const transcript = (latestPreview || stableText || '').trim();
    const terminalEvidence = evidence(transcript);
    trace('terminal-recognition-completed', {
      ...terminalEvidence,
      completionState: 'terminal',
      recognitionComplete: true,
      stopReason: stopRequested ? 'manual-stop' : 'auto-stop',
    });
    recognition = null;
    return { ok: true, ...terminalEvidence };
  }

  function handleAutoStop() {
    trace('auto-stop-detected', { primaryTranscript: latestPreview });
    const result = finalize({ triggeredByOnEnd: true });
    onAutoStop?.(result);
  }

  function start() {
    const context = getRecognitionContext?.();
    if (!recognitionBackend || context?.speechDisabled) {
      onUnsupported?.();
      return { ok: false, reason: 'unsupported' };
    }
    if (active) return { ok: false, reason: 'active' };

    let currentRecognition;
    try {
      currentRecognition = new recognitionBackend();
    } catch (error) {
      setMicState?.(false);
      onError?.({ error: 'start-failed', cause: error });
      return { ok: false, reason: 'start-failed' };
    }
    recognition = currentRecognition;
    currentRecognition.lang = 'en-US';
    currentRecognition.continuous = true;
    currentRecognition.interimResults = true;
    currentRecognition.context = context;
    currentRecognition.maxAlternatives = REQUESTED_MAX_ALTERNATIVES;
    requestedMaxAlternatives = currentRecognition.maxAlternatives;
    backendType = currentRecognition.waitsForFinalResult ? 'android-native' : 'web-speech';
    nativeSessionId = currentRecognition.sessionId ?? null;
    providerInfo = null;

    stableText = '';
    segments = [];
    latestPreview = '';
    active = true;
    finalized = false;
    stopRequested = false;
    completionState = 'pending';
    attemptId = nextRecognitionAttemptId++;
    traceEventSequence = 0;
    try { traceAttemptActive = isTracing?.() === true; }
    catch (_) { traceAttemptActive = false; }
    if (traceAttemptActive) {
      try { attemptTraceSessionId = getTraceSessionId?.() ?? null; }
      catch (_) { attemptTraceSessionId = null; }
      try { attemptContext = JSON.parse(JSON.stringify(getAttemptContext?.() ?? {})); }
      catch (_) { attemptContext = {}; }
    } else {
      attemptTraceSessionId = null;
      attemptContext = null;
    }
    onRecognitionConfigured?.({
      maxAlternatives: currentRecognition.maxAlternatives,
      backend: backendType,
      nativeSessionId,
      attemptId,
    });
    currentRecognition.onconfiguration = info => {
      if (recognition !== currentRecognition || finalized) return;
      backendType = info?.backendType ?? backendType;
      nativeSessionId = info?.nativeSessionId ?? nativeSessionId;
      providerInfo = info?.providerInfo ?? providerInfo;
      requestedMaxAlternatives = info?.requestedMaxAlternatives ?? requestedMaxAlternatives;
      trace('recognition-backend-configured', { providerInfo, requestedMaxAlternatives });
    };
    onTranscriptReset?.();
    trace('recognition-start-requested', {
      recognitionContext: context,
      completionState: 'pending',
      recognitionComplete: false,
    });

    currentRecognition.onstart = () => {
      if (recognition !== currentRecognition || !active || finalized) return;
      setMicState?.(true);
      trace('recognition-started', { completionState: 'pending' });
      onStart?.();
    };

    currentRecognition.onresult = event => {
      if (recognition !== currentRecognition || !active || finalized) return;
      const firstChanged = Number.isInteger(event.resultIndex) ? event.resultIndex : 0;
      // Provider evidence remains one raw ranked list per recognition segment.
      segments.length = event.results.length;
      for (let index = firstChanged; index < event.results.length; index += 1) {
        const result = event.results[index];
        segments[index] = recognitionSegment({
          segmentIndex: index,
          alternatives: Array.from(result),
          primaryTranscript: String(result[0]?.transcript ?? ''),
          isFinal: result.isFinal,
          requestedMaxResults: result.requestedMaxResults ?? currentRecognition.maxAlternatives,
          providerReturnedCount: result.providerReturnedCount ?? result.length,
        });
      }
      const present = segments.filter(Boolean);
      latestPreview = present.reduce((text, segment) => appendRawTranscriptFinal(text, segment.primaryTranscript), '');
      stableText = present.filter(segment => segment.isFinal)
        .reduce((text, segment) => appendRawTranscriptFinal(text, segment.primaryTranscript), '');
      const changedFinal = Array.from(event.results).slice(firstChanged).some(result => result.isFinal);
      const currentEvidence = evidence(latestPreview);
      if (changedFinal) {
        trace('final-result-received', {
          primaryTranscript: latestPreview,
          finalizedSegments: present.filter(segment => segment.isFinal),
          completionState: 'pending',
          recognitionComplete: false,
        });
        onTranscriptFinal?.(stableText, currentEvidence);
      }
      const interim = present.filter(segment => !segment.isFinal).map(segment => segment.primaryTranscript).join(' ');
      if (interim) {
        trace('interim-result-received', {
          primaryTranscript: latestPreview,
          interimTranscript: interim,
          interimSegments: present.filter(segment => !segment.isFinal).map(segment => ({ ...segment, isFinal: false })),
          completionState: 'pending',
          recognitionComplete: false,
        });
        onTranscriptInterim?.(interim, currentEvidence);
      }
      onTranscriptPreview?.(latestPreview, currentEvidence);
    };

    currentRecognition.onerror = event => {
      if (recognition !== currentRecognition || !active || finalized) return;
      active = false;
      finalized = true;
      completionState = 'error';
      trace('recognition-failed', {
        reason: event.error || 'recognition-error',
        technicalError: event.error || 'recognition-error',
        completionState: 'error',
        recognitionComplete: false,
      });
      trace('terminal-recognition-completed', {
        ...evidence(),terminal: true,completionState: 'error',recognitionComplete: false,
        technicalError: event.error || 'recognition-error',stopReason: 'technical-error',
      });
      recognition = null;
      try { currentRecognition.abort?.(); } catch (_) {}
      setMicState?.(false);
      onStop?.();
      settleStop({ ok: false, reason: event.error || 'recognition-error', ...evidence() });
      onError?.({ ...event, ...evidence(), attemptId, nativeSessionId, backendType });
    };

    currentRecognition.onend = () => {
      if (recognition !== currentRecognition || finalized) return;
      if (stopRequested) {
        settleStop(finalize({ triggeredByOnEnd: true }));
        return;
      }
      handleAutoStop();
    };

    try {
      currentRecognition.start();
    } catch (error) {
      active = false;
      finalized = true;
      completionState = 'error';
      trace('recognition-start-failed', {
        reason: 'start-failed',
        technicalError: 'start-failed',
        completionState: 'error',
        recognitionComplete: false,
      });
      trace('terminal-recognition-completed', {
        ...evidence(),terminal:true,completionState:'error',recognitionComplete:false,
        technicalError:'start-failed',stopReason:'start-failed',
      });
      recognition = null;
      setMicState?.(false);
      onError?.({ error: 'start-failed', cause: error, ...evidence(), attemptId, nativeSessionId, backendType });
      return { ok: false, reason: 'start-failed' };
    }
    return { ok: true };
  }

  function stop() {
    if (pendingStop) return pendingStop.promise;
    if (!active) return { ok: false, reason: 'inactive', ...evidence(stableText.trim()) };
    stopRequested = true;
    trace('manual-stop-requested', {
      stopReason: 'manual-stop',
      completionState,
      recognitionComplete: false,
    });
    const currentRecognition = recognition;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pendingStop = { promise, resolve };
    try { currentRecognition?.stop?.(); }
    catch (error) {
      active = false;
      finalized = true;
      completionState = 'error';
      trace('recognition-failed', {
        reason: 'stop-failed',
        technicalError: 'stop-failed',
        completionState: 'error',
        recognitionComplete: false,
      });
      trace('terminal-recognition-completed', {
        ...evidence(),terminal:true,completionState:'error',recognitionComplete:false,
        technicalError:'stop-failed',stopReason:'stop-failed',
      });
      recognition = null;
      settleStop({ ok: false, reason: 'stop-failed', ...evidence() });
      setMicState?.(false);
      onStop?.();
      onError?.({ error: 'stop-failed', cause: error, ...evidence(), attemptId, nativeSessionId, backendType });
    }
    return promise;
  }

  function cancel() {
    const currentRecognition = recognition;
    active = false;
    finalized = true;
    completionState = 'cancelled';
    stopRequested = false;
    trace('recognition-cancelled', {
      reason: 'cancelled',
      stopReason: 'cancelled',
      completionState: 'cancelled',
      recognitionComplete: false,
    });
    trace('terminal-recognition-completed', {
      ...evidence(),terminal:true,completionState:'cancelled',recognitionComplete:false,
      technicalError:null,cancelReason:'cancelled',stopReason:'cancelled',
    });
    recognition = null;
    settleStop({ ok: false, reason: 'cancelled', ...evidence() });
    try { currentRecognition?.abort?.(); } catch (_) {}
    setMicState?.(false);
    onStop?.();
  }

  return {
    start,
    stop,
    cancel,
    isActive: () => active,
    getStableTranscript: () => (stableText || '').trim(),
    getPreviewTranscript: () => latestPreview,
    getRecognitionSegments,
    getEvidence: () => evidence(latestPreview),
    getAttemptId: () => attemptId,
    getNativeSessionId: () => nativeSessionId,
    getCompletionState: () => completionState,
  };
}
