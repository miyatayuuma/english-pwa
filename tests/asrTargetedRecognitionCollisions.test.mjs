import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speechEquivalenceRules } from '../scripts/speech/speechEquivalenceRules.js';
import { grammaticalEquivalenceRules, GRAMMATICAL_EQUIVALENCE_PAIR_COUNT } from '../scripts/speech/grammaticalEquivalenceRules.js';
import { findSpeechSurfaceMatch, alignSpeech } from '../scripts/speech/speechAlignment.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { gradeClozeSpeech } from '../scripts/speech/clozeSpeechGrader.js';

const entries = new Map(
  JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json', import.meta.url), 'utf8'))
    .entries.map(entry => [entry.id, entry]),
);
const gaze = entries.get('vocab:01156');
const lack = entries.get('vocab:01251');
const lackOf = entries.get('vocab:01296');
const segment = (transcripts, segmentIndex = 0, isFinal = true) => ({
  segmentIndex,
  primaryTranscript: transcripts[0],
  isFinal,
  alternatives: transcripts.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
});
const vocabContext = entryId => ({ mode: 'vocabulary', ...(entryId ? { entryId } : {}) });
const grade = (entry, transcript, extra = {}) => classifyVocabularySpeechAnswer({ entry, transcript, ...extra });
const tokenMatch = (expected, observed, context) => findSpeechSurfaceMatch(expected, observed, { context });

test('targeted rule registry is explicit, directional, scoped, and does not alter ASR-09B', () => {
  const ids = speechEquivalenceRules.map(rule => rule.id);
  assert.equal(new Set(ids).size, ids.length, 'speech equivalence rule IDs remain unique');

  const gazeRules = speechEquivalenceRules.filter(rule => ['gaze-gays', 'gays-gaze'].includes(rule.id));
  assert.deepEqual(gazeRules.map(({ id, expected, recognized, kind, credit, scope, display }) => ({
    id, expected, recognized, kind, credit, scope, display,
  })), [
    { id: 'gaze-gays', expected: 'gaze', recognized: 'gays', kind: 'homophone', credit: 'exact-equivalent', scope: { type: 'global' }, display: 'raw' },
    { id: 'gays-gaze', expected: 'gays', recognized: 'gaze', kind: 'homophone', credit: 'exact-equivalent', scope: { type: 'global' }, display: 'raw' },
  ]);

  const lackRules = speechEquivalenceRules.filter(rule => rule.id === 'asr-lack-to-black');
  assert.deepEqual(lackRules.map(({ id, expected, recognized, kind, credit, scope, display }) => ({
    id, expected, recognized, kind, credit, scope, display,
  })), [{
    id: 'asr-lack-to-black',
    expected: 'lack',
    recognized: 'black',
    kind: 'asr-known-confusion',
    credit: 'exact-equivalent',
    scope: { type: 'entry', entryIds: ['vocab:01251', 'vocab:01296'], mode: 'vocabulary' },
    display: 'raw',
  }]);
  assert.equal(speechEquivalenceRules.some(rule => rule.expected === 'black' && rule.recognized === 'lack'), false);

  assert.equal(GRAMMATICAL_EQUIVALENCE_PAIR_COUNT, 33);
  assert.equal(grammaticalEquivalenceRules.length, 66, 'ASR-09B remains 33 fixed pairs / 66 directions');
});

test('gaze/gays accepts only the explicit bidirectional homophone surfaces', () => {
  const cases = [
    ['gaze', 'gays', 'gaze-gays'],
    ['gays', 'gaze', 'gays-gaze'],
    ['gaze at something', 'gays at something', 'gaze-gays'],
    ['gays at something', 'gaze at something', 'gays-gaze'],
  ];
  for (const [expected, observed, ruleId] of cases) {
    const match = tokenMatch(expected, observed, { mode: 'vocabulary', entryId: gaze.id });
    assert.equal(match?.ruleId, ruleId, `${expected} / ${observed}`);
    assert.equal(match?.ruleKind, 'homophone');
    assert.equal(match?.rawTranscript, observed);
    assert.equal(match?.displayTranscript, observed);
  }

  for (const observed of ['gave', 'game', "gaze's", 'gazed', 'gazing']) {
    assert.equal(tokenMatch('gaze', observed, { mode: 'vocabulary', entryId: gaze.id }), null, observed);
  }

  const result = grade(gaze, 'gays at something', {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'gaze-primary',
    recognitionSegments: [segment(['gays at something'])],
  });
  assert.equal(result.type, 'target');
  assert.equal(result.matchedExpected, 'gaze at something');
  assert.equal(result.recognitionAuthority, 'explicit-equivalence');
  assert.equal(result.speechMatch.ruleId, 'gaze-gays');
  assert.equal(result.speechMatch.ruleKind, 'homophone');
  assert.equal(result.rawTranscript, 'gays at something');
  assert.equal(result.displayTranscript, 'gays at something');
  assert.equal(result.primaryTranscript, 'gays at something');
  assert.equal(result.attemptId, 'gaze-primary');
  assert.equal(result.recognitionSegmentIndex, 0);
  assert.deepEqual(result.recognitionSegmentIndexes, [0]);
  assert.equal(result.asrRank, 0);
  assert.equal(result.recognitionComplete, true);
  assert.equal(result.speechMatch.matchedSpan.expected, 'gaze');
  assert.equal(result.speechMatch.matchedSpan.observed, 'gays');

  const existingParaphrase = grade(entries.get('vocab:02374'), 'gays at something', {
    recognitionComplete: true,
    completionState: 'terminal',
    recognitionSegments: [segment(['gays at something'])],
  });
  assert.equal(existingParaphrase.type, 'paraphrase');
  assert.equal(existingParaphrase.targetRescued, false);
  assert.equal(existingParaphrase.matchedText, 'gaze at something');
});

test('gaze/gays keeps Vocabulary, Read, Cloze, and Correction grading contracts', () => {
  for (const mode of ['vocabulary', 'read', 'cloze', 'correction']) {
    assert.equal(tokenMatch('gaze', 'gays', { mode })?.ruleId, 'gaze-gays', mode);
  }

  const sentence = 'They gaze at something.';
  const spoken = 'They gays at something.';
  const readAlignment = alignSpeech(sentence, spoken, { context: { mode: 'read' } });
  const read = gradeReadSpeech(readAlignment);
  assert.equal(read.score, 1);
  assert.equal(readAlignment.rawTranscript, spoken);
  assert.equal(readAlignment.alignment.find(event => event.ruleId === 'gaze-gays')?.ruleKind, 'homophone');

  const clozeAlignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const start = sentence.indexOf('gaze at something');
  const cloze = gradeClozeSpeech(clozeAlignment, {
    itemId: 'targeted-gaze',
    sentence,
    targets: [{ entry_id: gaze.id, surface: 'gaze at something', start, end: start + 'gaze at something'.length }],
  });
  assert.equal(cloze.pass, true);
  assert.equal(cloze.targets[0].matched, true);
  assert.equal(cloze.targets[0].ruleId, 'gaze-gays');
  assert.equal(cloze.targets[0].rawTranscript, spoken);
  assert.equal(cloze.targets[0].displayTranscript, spoken);

  const correctionAlignment = alignSpeech(sentence, spoken, { context: { mode: 'correction' } });
  const correction = gradeCorrectionSpeech(correctionAlignment, {
    evaluateLevel: score => ({ pass: score === 1 }),
    hintStage: 0,
  });
  assert.equal(correction.success, true);
  assert.equal(correction.score, 1);
  assert.equal(correctionAlignment.rawTranscript, spoken);
  assert.equal(correctionAlignment.alignment.find(event => event.ruleId === 'gaze-gays')?.ruleKind, 'homophone');
});

test('lack-to-black is a one-way exact-surface Vocabulary exception for only the two authorized entries', () => {
  const cases = [
    [lack, 'lack', 'black'],
    [lackOf, 'lack of something', 'black of something'],
  ];
  for (const [entry, expected, observed] of cases) {
    const match = tokenMatch(expected, observed, vocabContext(entry.id));
    assert.equal(match?.ruleId, 'asr-lack-to-black');
    assert.equal(match?.ruleKind, 'asr-known-confusion');
    const result = grade(entry, observed, {
      recognitionComplete: true,
      completionState: 'terminal',
      attemptId: `primary-${entry.id}`,
      recognitionSegments: [segment([observed])],
    });
    assert.equal(result.type, 'target', entry.id);
    assert.equal(result.recognitionAuthority, 'explicit-equivalence', entry.id);
    assert.equal(result.speechMatch.ruleId, 'asr-lack-to-black', entry.id);
    assert.equal(result.speechMatch.ruleKind, 'asr-known-confusion', entry.id);
    assert.equal(result.rawTranscript, observed, entry.id);
    assert.equal(result.displayTranscript, observed, entry.id);
    assert.equal(result.primaryTranscript, observed, entry.id);
  }

  for (const entryId of ['', 'vocab:00025', 'vocab:01156', 'vocab:01250', 'vocab:01297']) {
    assert.equal(tokenMatch('lack', 'black', vocabContext(entryId)), null, entryId || 'missing entry ID');
  }
  for (const mode of ['read', 'cloze', 'correction']) {
    assert.equal(tokenMatch('lack', 'black', { mode, entryId: lack.id }), null, mode);
  }
  assert.equal(tokenMatch('black', 'lack', vocabContext(lack.id)), null, 'reverse direction is excluded');
  assert.equal(grade({ id: 'vocab:fake-black', canonical: 'black' }, 'lack', {
    recognitionComplete: true,
    completionState: 'terminal',
    recognitionSegments: [segment(['lack'])],
  }).type, 'miss');
});

test('lack-to-black does not accept missing words, changed prepositions, or unrelated extra tokens', () => {
  for (const observed of ['blank', 'back', 'block']) {
    assert.equal(tokenMatch('lack', observed, vocabContext(lack.id)), null, observed);
    assert.equal(grade(lack, observed).type, 'miss', observed);
  }
  for (const observed of ['black something', 'black of', 'black for something']) {
    assert.equal(tokenMatch('lack of something', observed, vocabContext(lackOf.id)), null, observed);
    assert.equal(grade(lackOf, observed).type, 'miss', observed);
  }
  assert.equal(grade(lack, 'black with unrelated words').type, 'miss');
  assert.equal(grade(lackOf, 'black of something unrelated').type, 'miss');
  assert.equal(grade(lack, 'my answer is black with unrelated words').type, 'miss');
  assert.equal(grade(lackOf, 'my answer is black of something unrelated').type, 'miss');

  const unrelatedParaphraseEntry = entries.get('vocab:00025');
  assert.equal(unrelatedParaphraseEntry.paraphrases.includes('lack something'), true);
  assert.equal(grade(unrelatedParaphraseEntry, 'black something').type, 'miss');
});

test('carrier and lower N-best rescue retain raw evidence, rank, segment, and attempt provenance', () => {
  const carrier = 'my answer is black';
  const carried = grade(lack, carrier, {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'lack-carrier',
    recognitionSegments: [segment([carrier], 3)],
  });
  assert.equal(carried.type, 'target');
  assert.equal(carried.rawTranscript, carrier);
  assert.equal(carried.displayTranscript, carrier);
  assert.equal(carried.speechMatch.rawTranscript, carrier);
  assert.equal(carried.speechMatch.ruleId, 'asr-lack-to-black');
  assert.equal(carried.speechMatch.attemptId, 'lack-carrier');
  assert.equal(carried.recognitionSegmentIndex, 3);
  assert.deepEqual(carried.recognitionSegmentIndexes, [3]);
  assert.equal(carried.asrRank, 0);
  assert.equal(carried.recognitionComplete, true);
  assert.equal(carried.speechMatch.matchedSpan.expected, 'lack');
  assert.equal(carried.speechMatch.matchedSpan.observed, 'black');

  const primary = 'unrelated speech';
  const alternative = 'my answer is black of something';
  const lowerRank = grade(lackOf, primary, {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'lack-nbest',
    recognitionSegments: [segment([primary, alternative], 5)],
  });
  assert.equal(lowerRank.type, 'target');
  assert.equal(lowerRank.targetRescued, true);
  assert.equal(lowerRank.primaryTranscript, primary);
  assert.equal(lowerRank.rawTranscript, alternative);
  assert.equal(lowerRank.displayTranscript, primary, 'existing N-best display policy keeps the primary transcript visible');
  assert.equal(lowerRank.asrRank, 1);
  assert.equal(lowerRank.recognitionSegmentIndex, 5);
  assert.deepEqual(lowerRank.recognitionSegmentIndexes, [5]);
  assert.equal(lowerRank.attemptId, 'lack-nbest');
  assert.equal(lowerRank.speechMatch.attemptId, 'lack-nbest');
  assert.equal(lowerRank.speechMatch.asrRank, 1);
  assert.equal(lowerRank.speechMatch.ruleId, 'asr-lack-to-black');
  assert.equal(lowerRank.speechMatch.ruleKind, 'asr-known-confusion');
});

test('targeted equivalence does not grade interim results or synthesize across candidates', () => {
  for (const completionState of ['pending', 'interim', 'error', 'cancelled']) {
    for (const [entry, transcript] of [[gaze, 'gays at something'], [lack, 'black']]) {
      const incomplete = grade(entry, transcript, {
        recognitionComplete: false,
        completionState,
        attemptId: `not-final-${completionState}`,
        recognitionSegments: [segment([transcript], 0, false)],
      });
      assert.equal(incomplete.type, 'miss', `${entry.id} / ${completionState}`);
      assert.equal(incomplete.rawTranscript, transcript);
    }
  }

  const splitRanks = grade(lackOf, 'unrelated', {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'split-ranks',
    recognitionSegments: [segment(['unrelated', 'black of', 'something'])],
  });
  assert.equal(splitRanks.type, 'miss', 'different N-best ranks cannot be combined');

  const splitSegments = grade(lackOf, 'unrelated unrelated', {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'split-segments',
    recognitionSegments: [
      segment(['unrelated', 'black of'], 0),
      segment(['unrelated', 'something'], 1),
    ],
  });
  assert.equal(splitSegments.type, 'miss', 'different finalized segments cannot be combined');

  const firstAttempt = grade(lackOf, 'black of', {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'attempt-a',
    recognitionSegments: [segment(['black of'])],
  });
  const secondAttempt = grade(lackOf, 'something', {
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'attempt-b',
    recognitionSegments: [segment(['something'])],
  });
  assert.equal(firstAttempt.type, 'miss');
  assert.equal(secondAttempt.type, 'miss');
});

test('lack-to-black cannot leak into Read, Cloze, or Correction alignment', () => {
  const sentence = 'They lack something.';
  const spoken = 'They black something.';

  const readAlignment = alignSpeech(sentence, spoken, { context: { mode: 'read' } });
  assert.equal(readAlignment.alignment.some(event => event.ruleId === 'asr-lack-to-black'), false);
  assert.ok(gradeReadSpeech(readAlignment).score < 1);

  const clozeAlignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const start = sentence.indexOf('lack');
  const cloze = gradeClozeSpeech(clozeAlignment, {
    itemId: 'lack-cloze-negative',
    sentence,
    targets: [{ entry_id: lack.id, surface: 'lack', start, end: start + 'lack'.length }],
  });
  assert.equal(cloze.targets[0].matched, false);
  assert.equal(cloze.targets[0].ruleId, null);

  const correctionAlignment = alignSpeech(sentence, spoken, { context: { mode: 'correction' } });
  const correction = gradeCorrectionSpeech(correctionAlignment, {
    evaluateLevel: score => ({ pass: score === 1 }),
    hintStage: 0,
  });
  assert.equal(correction.success, false);
  assert.equal(correctionAlignment.alignment.some(event => event.ruleId === 'asr-lack-to-black'), false);
});
