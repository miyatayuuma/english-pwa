import { recognitionSegment } from './recognitionEvidence.js';
import { REQUESTED_MAX_ALTERNATIVES } from './recognitionPolicy.js';
import { selectRecognitionBackend } from '../native/androidSpeechBackend.js';
import { hasSafeSpeechToken } from './safeSpeechNormalization.js';

const SR = selectRecognitionBackend();

export function isRecognitionSupported() {
  return !!SR;
}
export function hasRecognizedSpeech(transcript) {
  return hasSafeSpeechToken(transcript);
}

export function appendRawTranscriptFinal(stable, fragment) {
  const left = String(stable ?? '').trimEnd();
  const right = String(fragment ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  const lowerLeft = left.toLocaleLowerCase('en-US');
  const lowerRight = right.toLocaleLowerCase('en-US');
  if (lowerRight === lowerLeft || lowerRight.startsWith(`${lowerLeft} `)) return right;
  if (lowerLeft.startsWith(`${lowerRight} `)) return left;
  const leftWords = left.split(/\s+/u);
  const rightWords = right.split(/\s+/u);
  const comparable = word => String(word || '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
  let overlap = 0;
  const max = Math.min(leftWords.length, rightWords.length);
  for (let count = max; count > 0; count -= 1) {
    let same = true;
    for (let index = 0; index < count; index += 1) {
      const a = comparable(leftWords[leftWords.length - count + index]);
      const b = comparable(rightWords[index]);
      if (a !== b) { same = false; break; }
    }
    if (same) { overlap = count; break; }
  }
  const remaining = rightWords.slice(overlap).join(' ');
  return remaining ? `${left} ${remaining}` : left;
}

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
      previewTranscript: latestPreview,
      recognitionSegments: getRecognitionSegments(),
    };
  }

  function finalize({ triggeredByOnEnd = false } = {}) {
    if (!active && !triggeredByOnEnd) {
      return { ok: false, reason: 'inactive', ...evidence(stableText.trim()) };
    }
    active = false;
    finalized = true;
    setMicState?.(false);
    onStop?.();
    const transcript = (latestPreview || stableText || '').trim();
    recognition = null;
    return { ok: true, ...evidence(transcript) };
  }

  function handleAutoStop() {
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
    onRecognitionConfigured?.({
      maxAlternatives: currentRecognition.maxAlternatives,
      backend: currentRecognition.waitsForFinalResult ? 'android-native' : 'web',
    });

    stableText = '';
    segments = [];
    latestPreview = '';
    active = true;
    finalized = false;
    stopRequested = false;
    onTranscriptReset?.();

    currentRecognition.onstart = () => {
      if (recognition !== currentRecognition || !active || finalized) return;
      setMicState?.(true);
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
      if (changedFinal) onTranscriptFinal?.(stableText, currentEvidence);
      const interim = present.filter(segment => !segment.isFinal).map(segment => segment.primaryTranscript).join(' ');
      if (interim) onTranscriptInterim?.(interim, currentEvidence);
      onTranscriptPreview?.(latestPreview, currentEvidence);
    };

    currentRecognition.onerror = event => {
      if (recognition !== currentRecognition || !active || finalized) return;
      active = false;
      finalized = true;
      recognition = null;
      try { currentRecognition.abort?.(); } catch (_) {}
      setMicState?.(false);
      onStop?.();
      settleStop({ ok: false, reason: event.error || 'recognition-error', ...evidence() });
      onError?.(event);
    };

    currentRecognition.onend = () => {
      if (recognition !== currentRecognition || finalized) return;
      if (stopRequested) {
        if (currentRecognition.waitsForFinalResult) settleStop(finalize({ triggeredByOnEnd: true }));
        return;
      }
      handleAutoStop();
    };

    try {
      currentRecognition.start();
    } catch (error) {
      active = false;
      finalized = true;
      recognition = null;
      setMicState?.(false);
      onError?.({ error: 'start-failed', cause: error });
      return { ok: false, reason: 'start-failed' };
    }
    return { ok: true };
  }

  function stop() {
    if (pendingStop) return pendingStop.promise;
    if (!active) return { ok: false, reason: 'inactive', ...evidence(stableText.trim()) };
    stopRequested = true;
    const currentRecognition = recognition;
    if (currentRecognition?.waitsForFinalResult) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pendingStop = { promise, resolve };
      try { currentRecognition.stop(); }
      catch (error) {
        cancel();
        onError?.({ error: 'stop-failed', cause: error });
      }
      return promise;
    }
    try { currentRecognition?.stop?.(); } catch (_) {}
    return finalize({ triggeredByOnEnd: false });
  }

  function cancel() {
    const currentRecognition = recognition;
    active = false;
    finalized = true;
    stopRequested = false;
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
  };
}
