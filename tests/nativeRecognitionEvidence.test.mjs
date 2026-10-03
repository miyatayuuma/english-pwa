import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRecognitionEvidence, nativeWebResultEvent } from '../scripts/native/recognitionEvidence.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';

test('native final-only mapping preserves rank zero, caps at five, and optional confidence', () => {
  const event = { type: 'final', alternatives: [
    { transcript: 'YouTube', confidence: 0.7 },
    { transcript: 'yield to something', confidence: null },
    { transcript: 'third' }, { transcript: 'fourth', confidence: NaN },
    { transcript: 'fifth', confidence: 0 }, { transcript: 'sixth' },
  ] };
  const evidence = nativeRecognitionEvidence(event);
  assert.equal(evidence.transcript, 'YouTube');
  assert.equal(evidence.previewTranscript, 'YouTube');
  const segment = evidence.nativeSegments[0];
  assert.equal(segment.isFinal, true);
  assert.deepEqual(segment.alternatives.map(c => c.asrRank), [0, 1, 2, 3, 4]);
  assert.deepEqual(segment.alternatives.map(c => c.confidence), [0.7, null, null, null, 0]);
  assert.equal(nativeWebResultEvent(event).results[0][0].transcript, 'YouTube');
});
test('partial absence is normal and empty/partial callbacks retain schema compatibility', () => {
  assert.equal(nativeRecognitionEvidence({ type: 'partial', alternatives: [{ transcript: 'I' }] }).nativeSegments[0].isFinal, false);
  assert.equal(nativeRecognitionEvidence({ type: 'final' }).transcript, '');
  assert.deepEqual(nativeRecognitionEvidence({ type: 'final' }).nativeSegments[0].alternatives, []);
});
test('mapped native candidates preserve existing strict TARGET rescue and exclude lower paraphrases', () => {
  const entry = { canonical: 'yield to something', paraphrases: ['give in to something'] };
  const grade = alternatives => classifyVocabularySpeechAnswer({ entry, ...nativeRecognitionEvidence({ type: 'final', alternatives: alternatives.map(transcript => ({ transcript })) }) });
  const rescued = grade(['YouTube', 'yield to something']);
  assert.equal(rescued.type, 'target');
  assert.equal(rescued.nativeRank, 1);
  assert.equal(rescued.primaryTranscript, 'YouTube');
  assert.equal(grade(['YouTube', 'give in to something']).type, 'miss');
  for (const text of ['yield', 'yield from something', 'something to yield', 'I like cats']) assert.equal(grade([text]).type, 'miss');
});
