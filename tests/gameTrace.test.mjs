import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameTraceCollector, gameTraceCollector, setGameTraceCaptureEnabled } from '../scripts/native/gameTrace.js';
import { createRecognitionController } from '../scripts/speech/recognition.js';

function makeRecognitionClass(instances, { native = false } = {}) {
  return class MockRecognition {
    constructor() {
      this.maxAlternatives = 20;
      if (native) {
        this.waitsForFinalResult = true;
        this.sessionId = `native-${instances.length + 1}`;
      }
      instances.push(this);
    }
    start() { this.onstart?.(); }
    stop() { this.onresult?.(makeEvent([['I said it', 'I set it']], true)); this.onend?.(); }
    abort() { this.onend?.(); }
    results(values, isFinal = true) { this.onresult?.(makeEvent(values, isFinal)); }
    end() { this.onend?.(); }
    fail(error = 'network') { this.onerror?.({ error }); }
  };
}

function makeEvent(candidateGroups, isFinal) {
  const results = candidateGroups.map(group => {
    const alternatives = group.map((transcript, asrRank) => ({ transcript, confidence: 0.8 - asrRank * 0.1 }));
    alternatives.isFinal = isFinal;
    alternatives.requestedMaxResults = 20;
    alternatives.providerReturnedCount = group.length;
    return alternatives;
  });
  return { resultIndex: 0, results };
}

test('the app collector cannot be enabled by web JavaScript without the native debug bridge', async () => {
  assert.equal(gameTraceCollector.setEnabled, undefined, 'the shared app collector exposes no unauthenticated enable switch');
  assert.equal(await setGameTraceCaptureEnabled(true), false);
  assert.equal(gameTraceCollector.isEnabled(), false);
});

test('collector isolates attempts, preserves controller and native IDs, orders events, and deduplicates explicit event IDs', () => {
  let time = 1000;
  let ids = 0;
  const collector = createGameTraceCollector({ now: () => time++, createId: () => `trace-session-${++ids}` });
  assert.equal(collector.record({ type: 'recognition-started', attemptId: 1 }), null, 'capture is OFF by default');
  collector.setEnabled(true);
  const context = { itemId: 'E0102', entryId: 'vocab:00139', gameMode: 'Vocabulary', learningStage: 'Vocabulary', correctionActive: false };
  collector.record({ type: 'recognition-start-requested', attemptId: 1, nativeSessionId: 'native-7', context, eventId: 'one' });
  collector.record({ type: 'recognition-start-requested', attemptId: 1, nativeSessionId: 'native-7', context: { itemId: 'wrong' }, eventId: 'one' });
  collector.record({ type: 'terminal-recognition-completed', attemptId: 1, nativeSessionId: 'native-7', completionState: 'terminal' });
  collector.record({ type: 'attempt-closed', attemptId: 1 });
  collector.record({ type: 'recognition-start-requested', attemptId: 2, nativeSessionId: 'native-8', context: { itemId: 'E0200', gameMode: 'Read' } });
  const attempts = collector.list();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attemptId, 1);
  assert.equal(attempts[0].nativeSessionId, 'native-7');
  assert.equal(attempts[0].context.entryId, 'vocab:00139');
  assert.equal(attempts[0].events.length, 3, 'a duplicate event ID is ignored');
  assert.deepEqual(attempts[0].events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(attempts[1].attemptId, 2);
  assert.equal(attempts[1].nativeSessionId, 'native-8');
  assert.equal(attempts[0].traceSessionId, attempts[1].traceSessionId, 'one trace session correlates multiple attempts');
});

test('trace sessions reject callbacks from a previous enable window and distinguish reused attempt IDs', () => {
  let ids = 0;
  const collector = createGameTraceCollector({ createId: () => `trace-session-${++ids}` });
  collector.setEnabled(true);
  const firstSession = collector.getTraceSessionId();
  collector.record({ type: 'recognition-start-requested', attemptId: 1, traceSessionId: firstSession,
    context: { itemId: 'E0102', gameMode: 'Read' } });
  collector.setEnabled(false);
  collector.setEnabled(true);
  const secondSession = collector.getTraceSessionId();
  assert.notEqual(firstSession, secondSession);
  assert.equal(collector.record({ type: 'terminal-recognition-completed', attemptId: 1,
    traceSessionId: firstSession, completionState: 'terminal' }), null);
  collector.record({ type: 'recognition-start-requested', attemptId: 1, traceSessionId: secondSession,
    context: { itemId: 'E0200', gameMode: 'Vocabulary' } });
  const attempts = collector.list();
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].traceSessionId, attempts[1].traceSessionId);
  assert.equal(attempts[1].context.gameMode, 'Vocabulary');
  collector.clear();
  assert.equal(collector.list().length, 0);
  assert.notEqual(collector.getTraceSessionId(), secondSession, 'clear invalidates callbacks for records that were removed');
});

test('metadata export redacts transcripts and sentence surfaces while raw export remains an explicit separate path', () => {
  const collector = createGameTraceCollector({ createId: () => 'trace-session' });
  collector.setEnabled(true);
  collector.record({ type: 'candidate-selected', attemptId: 3, context: { itemId: 'E1', gameMode: 'Read' },
    selectedCandidateTranscript: 'my private email@example.com', primaryTranscript: 'private raw',
    nested: { expected: 'a sensitive sentence', candidateRank: 2 } });
  const raw = JSON.parse(collector.exportJSON());
  const metadata = JSON.parse(collector.exportJSON({ metadataOnly: true }));
  assert.equal(raw.attempts[0].events[0].selectedCandidateTranscript, 'my private email@example.com');
  assert.equal(metadata.attempts[0].events[0].selectedCandidateTranscript, '[redacted]');
  assert.equal(metadata.attempts[0].events[0].primaryTranscript, '[redacted]');
  assert.equal(metadata.attempts[0].events[0].nested.expected, '[redacted]');
  assert.equal(metadata.attempts[0].events[0].nested.candidateRank, 2);
  assert.equal(collector.clear(), undefined);
  assert.equal(collector.list().length, 0);
});

test('recognition trace distinguishes pending final evidence from terminal completion and manual from automatic stop', async () => {
  const collector = createGameTraceCollector({ createId: () => 'trace-session' });
  collector.setEnabled(true);
  const instances = [];
  const Recognition = makeRecognitionClass(instances, { native: true });
  let terminalResult;
  const controller = createRecognitionController({
    recognitionBackend: Recognition,
    isTracing: () => collector.isEnabled(),
    getAttemptContext: () => ({ itemId: 'E0102', gameMode: 'Read', learningStage: 'Cloze', correctionActive: false }),
    onTraceEvent: event => collector.record(event),
    onAutoStop: result => { terminalResult = result; },
  });
  assert.equal(controller.start().ok, true);
  const native = instances[0];
  native.results([['primary words', 'rank two wording']], true);
  let attempt = collector.getLatest();
  assert.equal(attempt.events.at(-1).type, 'final-result-received');
  assert.equal(attempt.events.at(-1).recognitionComplete, false, 'final is not terminal by itself');
  native.end();
  native.end();
  attempt = collector.getLatest();
  const terminalEvents = attempt.events.filter(event => event.type === 'terminal-recognition-completed');
  assert.equal(terminalEvents.length, 1, 'duplicate native terminal callback is ignored');
  assert.equal(terminalEvents[0].completionState, 'terminal');
  assert.equal(terminalEvents[0].recognitionComplete, true);
  assert.equal(terminalEvents[0].stopReason, 'auto-stop');
  assert.equal(attempt.attemptId, terminalResult.attemptId);
  assert.equal(attempt.nativeSessionId, 'native-1');
  assert.notEqual(attempt.attemptId, attempt.nativeSessionId);
  assert.deepEqual(terminalEvents[0].recognitionSegments[0].alternatives.map(item => item.asrRank), [0, 1]);
  assert.equal(terminalEvents[0].recognitionSegments[0].providerReturnedCount, 2);
  assert.equal(terminalEvents[0].recognitionSegments[0].alternatives.length, 2, 'missing N-best candidates are never synthesized');

  assert.equal(controller.start().ok, true);
  const manual = instances[1];
  const manualResult = await controller.stop();
  const manualAttempt = collector.getLatest();
  assert.equal(manualAttempt.events.some(event => event.type === 'manual-stop-requested'), true);
  assert.equal(manualAttempt.events.at(-1).type, 'terminal-recognition-completed');
  assert.equal(manualAttempt.events.at(-1).stopReason, 'manual-stop');
  assert.equal(manualResult.completionState, 'terminal');
  assert.notEqual(manual, native);
});

test('stale callbacks and diagnostic observer failures do not alter a live recognition attempt', () => {
  const collector = createGameTraceCollector({ createId: () => 'trace-session' });
  collector.setEnabled(true);
  const instances = [];
  const Recognition = makeRecognitionClass(instances);
  const controller = createRecognitionController({
    recognitionBackend: Recognition,
    isTracing: () => true,
    getAttemptContext: () => ({ itemId: 'E1', gameMode: 'Read' }),
    onTraceEvent: event => { collector.record(event); if (event.type === 'interim-result-received') throw new Error('collector UI failure'); },
  });
  controller.start();
  const old = instances[0];
  old.end();
  controller.start();
  const active = instances[1];
  const before = collector.getLatest().events.length;
  old.results([['late text']], true);
  old.end();
  assert.equal(collector.getLatest().events.length, before, 'stale old callbacks do not leak into the next attempt');
  active.results([['partial text']], false);
  assert.equal(controller.getPreviewTranscript(), 'partial text', 'collector errors do not break recognition state');
  assert.equal(collector.getLatest().events.at(-1).type, 'interim-result-received');
  controller.cancel();
  assert.equal(collector.getLatest().events.some(event => event.type === 'recognition-cancelled'), true);
  assert.equal(collector.getLatest().events.at(-1).type, 'terminal-recognition-completed');
  assert.equal(collector.getLatest().recognitionStatus, 'cancelled');
});

test('attempt and event retention are bounded', () => {
  const collector = createGameTraceCollector({ maxAttempts: 2, maxEventsPerAttempt: 4, createId: () => 'trace-session' });
  collector.setEnabled(true);
  for (let attemptId = 1; attemptId <= 3; attemptId += 1) {
    for (let event = 0; event < 6; event += 1) collector.record({ type: 'event', attemptId, value: event });
  }
  const attempts = collector.list();
  assert.deepEqual(attempts.map(attempt => attempt.attemptId), [2, 3]);
  assert.equal(attempts.every(attempt => attempt.events.length === 4), true);
});
