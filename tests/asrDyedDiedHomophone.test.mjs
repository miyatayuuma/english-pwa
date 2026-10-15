import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { gradeClozeSpeech } from '../scripts/speech/clozeSpeechGrader.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { assessProductionRecognitionEvidence, evaluateRecognitionCandidates } from '../scripts/speech/recognitionCandidates.js';

const entries = JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json', import.meta.url), 'utf8')).entries;
const items = JSON.parse(readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const dyeEntry = entries.find(entry => entry.id === 'vocab:01314');
const dyeItem = items.find(item => item.id === 'E0106');
const diedItem = items.find(item => item.id === 'E0047');
const segment = (transcript, { segmentIndex = 3, isFinal = true, attemptId = null, itemId = null } = {}) => ({
  segmentIndex,
  primaryTranscript: transcript,
  isFinal,
  ...(attemptId ? { attemptId } : {}),
  ...(itemId ? { itemId } : {}),
  alternatives: [{ transcript, asrRank: 0, confidence: 0 }],
});

function vocabularyAnswer(expected, recognized, { complete = true, isFinal = true, completionState = 'terminal' } = {}) {
  const attemptId = `attempt-${expected}-${recognized}`;
  const entry = { id: `fixture:${expected}`, canonical: expected };
  return classifyVocabularySpeechAnswer({
    entry,
    transcript: recognized,
    recognitionComplete: complete,
    completionState,
    attemptId,
    recognitionSegments: [segment(recognized, { isFinal, attemptId })],
  });
}

function clozeTarget(sentence, surface, entryId = `fixture:${surface}`) {
  const start = sentence.indexOf(surface);
  assert.notEqual(start, -1, `${surface} is present in fixture sentence`);
  return { entry_id: entryId, surface, start, end: start + surface.length };
}

function finalizedEvidence(transcript, overrides = {}) {
  const attemptId = 'finality-attempt';
  const itemId = 'E0047';
  return {
    ok: true,
    transportComplete: true,
    completionState: 'terminal',
    recognitionComplete: true,
    attemptId,
    itemId,
    transcript,
    primaryTranscript: transcript,
    recognitionSegments: [segment(transcript, { attemptId, itemId })],
    ...overrides,
  };
}

test('Vocabulary recognizes only finalized dyed/died targets in either direction', () => {
  for (const [expected, recognized, ruleId] of [
    ['dyed', 'died', 'dyed-died'],
    ['died', 'dyed', 'died-dyed'],
  ]) {
    const result = vocabularyAnswer(expected, recognized);
    assert.equal(result.type, 'target');
    assert.equal(result.matched, true);
    assert.equal(result.matchedExpected, expected);
    assert.equal(result.recognitionAuthority, 'explicit-equivalence');
    assert.equal(result.speechMatch.ruleId, ruleId);
    assert.equal(result.speechMatch.ruleKind, 'homophone');
    assert.equal(result.rawTranscript, recognized);
    assert.equal(result.displayTranscript, recognized);
    assert.equal(result.primaryTranscript, recognized);
    assert.equal(result.attemptId, `attempt-${expected}-${recognized}`);
    assert.deepEqual(result.recognitionSegmentIndexes, [3]);
    assert.equal(result.recognitionSegmentIndex, 3);
    assert.equal(result.asrRank, 0);
    assert.equal(result.recognitionComplete, true);
  }

  for (const [expected, recognized] of [['dyed', 'dyed'], ['died', 'died']]) {
    const result = vocabularyAnswer(expected, recognized);
    assert.equal(result.type, 'target');
    assert.equal(result.recognitionAuthority, 'exact');
    assert.equal(result.speechMatch.ruleId, null);
  }

  assert.ok(dyeEntry, 'the production dye entry remains available');
  for (const recognized of ['dyed', 'died']) {
    const result = classifyVocabularySpeechAnswer({
      entry: dyeEntry,
      transcript: recognized,
      recognitionComplete: true,
      completionState: 'terminal',
      recognitionSegments: [segment(recognized)],
    });
    assert.equal(result.type, 'miss', `the existing dye entry does not acquire ${recognized}`);
  }

  const activeOccurrence = { item: dyeItem, occurrence: dyeEntry.occurrences[0] };
  assert.equal(dyeItem.en.slice(activeOccurrence.occurrence.start, activeOccurrence.occurrence.end), 'dyed');
  const productionOccurrenceAnswer = 'I died this fabric and it shrank.';
  const productionOccurrenceResult = classifyVocabularySpeechAnswer({
    entry: dyeEntry,
    activeOccurrence,
    transcript: productionOccurrenceAnswer,
    recognitionComplete: true,
    completionState: 'terminal',
    attemptId: 'production-dyed-occurrence',
    recognitionSegments: [segment(productionOccurrenceAnswer, { attemptId: 'production-dyed-occurrence' })],
  });
  assert.equal(productionOccurrenceResult.type, 'target');
  assert.equal(productionOccurrenceResult.matchedExpected, 'dyed');
  assert.equal(productionOccurrenceResult.recognitionAuthority, 'explicit-equivalence');
  assert.equal(productionOccurrenceResult.speechMatch.ruleId, 'dyed-died');
  assert.equal(productionOccurrenceResult.rawTranscript, productionOccurrenceAnswer);
});

test('Read and Correction retain their own grading authority while accepting the two exact homophones', () => {
  const cases = [
    ['The fabric was dyed blue.', 'The fabric was died blue.', 'dyed-died'],
    ['He died last year.', 'He dyed last year.', 'died-dyed'],
  ];
  for (const [expected, recognized, ruleId] of cases) {
    const readAlignment = alignSpeech(expected, recognized, {
      context: { mode: 'read' }, recognitionSegmentIndex: 2, asrRank: 0, attemptId: `read-${ruleId}`,
    });
    const read = gradeReadSpeech(readAlignment);
    assert.equal(read.score, 1);
    assert.equal(readAlignment.rawTranscript, recognized);
    assert.equal(readAlignment.displayTranscript, recognized);
    assert.equal(readAlignment.alignment.find(event => event.ruleId === ruleId)?.authority, 'explicit-equivalence');

    const correctionAlignment = alignSpeech(expected, recognized, {
      context: { mode: 'correction' }, recognitionSegmentIndex: 5, asrRank: 1, attemptId: `correction-${ruleId}`,
    });
    const correction = gradeCorrectionSpeech(correctionAlignment, {
      evaluateLevel: score => ({ pass: score === 1 }), hintStage: 0,
    });
    assert.equal(correction.success, true);
    assert.equal(correction.score, 1);
    assert.equal(correctionAlignment.rawTranscript, recognized);
    const match = correctionAlignment.alignment.find(event => event.ruleId === ruleId);
    assert.equal(match?.ruleKind, 'homophone');
    assert.equal(match?.recognitionSegmentIndex, 5);
    assert.equal(match?.asrRank, 1);
  }

  const wrongNonTarget = alignSpeech('The fabric was dyed blue.', 'A fabric was died green.', { context: { mode: 'correction' } });
  const rejected = gradeCorrectionSpeech(wrongNonTarget, {
    evaluateLevel: score => ({ pass: score === 1 }), hintStage: 0,
  });
  assert.equal(wrongNonTarget.alignment.filter(event => event.authority === 'explicit-equivalence').length, 1);
  assert.ok(wrongNonTarget.missing.includes('the'));
  assert.ok(wrongNonTarget.missing.includes('blue'));
  assert.equal(rejected.success, false, 'the homophone does not correct unrelated words');
});

test('Cloze restores dyed/died hidden targets in place, including sentence-final targets', () => {
  const cases = [
    [dyeItem.en, dyeItem.en.replace(/\bdyed\b/u, 'died'), 'dyed', 'dyed-died'],
    [diedItem.en, diedItem.en.replace(/\bdied\b/u, 'dyed'), 'died', 'died-dyed'],
    ['The fabric was dyed blue.', 'The fabric was died blue.', 'dyed', 'dyed-died'],
    ['He died last year.', 'He dyed last year.', 'died', 'died-dyed'],
    ['The fabric was dyed.', 'The fabric was died.', 'dyed', 'dyed-died'],
    ['He died.', 'He dyed.', 'died', 'died-dyed'],
  ];
  for (const [sentence, recognized, surface, ruleId] of cases) {
    const alignment = alignSpeech(sentence, recognized, {
      context: { mode: 'cloze' }, recognitionSegmentIndex: 8, asrRank: 2, attemptId: `cloze-${surface}`,
    });
    const result = gradeClozeSpeech(alignment, {
      itemId: 'fixture-cloze', sentence, targets: [clozeTarget(sentence, surface)],
    });
    assert.equal(result.active, true);
    assert.equal(result.overallScore, 1);
    assert.equal(result.pass, true);
    assert.equal(result.targets[0].matched, true);
    assert.equal(result.targets[0].authority, 'explicit-equivalence');
    assert.equal(result.targets[0].ruleId, ruleId);
    assert.equal(result.targets[0].ruleKind, 'homophone');
    assert.equal(result.targets[0].recognitionSegmentIndex, 8);
    assert.equal(result.targets[0].asrRank, 2);
    assert.equal(result.targets[0].rawTranscript, recognized);
    assert.equal(result.targets[0].displayTranscript, recognized);
  }

  const sentence = 'The fabric was dyed blue.';
  const omittedAlignment = alignSpeech(sentence, 'The fabric was blue.', { context: { mode: 'cloze' } });
  const omitted = gradeClozeSpeech(omittedAlignment, {
    itemId: 'fixture-omission', sentence, targets: [clozeTarget(sentence, 'dyed')],
  });
  assert.equal(omitted.targets[0].matched, false);
  assert.equal(omitted.targets[0].ruleId, null);
  assert.equal(omitted.pass, false);

  const unrelatedMismatch = alignSpeech(sentence, 'The fabric was died green.', { context: { mode: 'cloze' } });
  const mismatchResult = gradeClozeSpeech(unrelatedMismatch, {
    itemId: 'fixture-other-mismatch', sentence, targets: [clozeTarget(sentence, 'dyed')],
  });
  assert.equal(mismatchResult.targets[0].matched, true);
  assert.equal(mismatchResult.targets[0].ruleId, 'dyed-died');
  assert.ok(mismatchResult.alignment.missing.includes('blue'));
  assert.equal(mismatchResult.alignment.alignment.some(event => event.ruleId === 'dyed-died' && event.observed === 'green'), false);

  const reordered = alignSpeech(sentence, 'The fabric was blue died.', { context: { mode: 'cloze' } });
  const reorderedResult = gradeClozeSpeech(reordered, {
    itemId: 'fixture-order', sentence, targets: [clozeTarget(sentence, 'dyed')],
  });
  assert.equal(reorderedResult.orderedMatchIntegrity.valid, false);
  assert.equal(reorderedResult.pass, false);
});

test('production Vocabulary and all speech modes reject unfinished dyed/died evidence before grading', () => {
  const transcript = 'He dyed last year.';
  const valid = finalizedEvidence(transcript);
  assert.equal(assessProductionRecognitionEvidence(valid, {
    expectedItemId: 'E0047', currentItemId: 'E0047',
  }).admitted, true);

  const invalidCases = [
    ['interim-only', finalizedEvidence(transcript, {
      recognitionComplete: false,
      recognitionSegments: [segment(transcript, { isFinal: false, attemptId: 'finality-attempt', itemId: 'E0047' })],
    })],
    ['pending', finalizedEvidence(transcript, { completionState: 'pending', recognitionComplete: false })],
    ['technical error', finalizedEvidence(transcript, { ok: false, completionState: 'error', recognitionComplete: false })],
    ['cancelled', finalizedEvidence(transcript, { ok: false, completionState: 'cancelled', recognitionComplete: false })],
    ['incomplete segments', finalizedEvidence(transcript, { recognitionComplete: false, recognitionSegments: [] })],
  ];

  for (const [label, evidence] of invalidCases) {
    const admission = assessProductionRecognitionEvidence(evidence, {
      expectedItemId: 'E0047', currentItemId: 'E0047',
    });
    assert.equal(admission.admitted, false, label);
    const callbacks = [];
    const selection = evaluateRecognitionCandidates(evidence, candidate => {
      callbacks.push(candidate);
      const alignment = alignSpeech('He died last year.', candidate.transcript, { context: { mode: 'correction' } });
      return { accepted: gradeCorrectionSpeech(alignment, { evaluateLevel: score => ({ pass: score === 1 }) }).success };
    });
    assert.equal(selection.selected, null, label);
    assert.deepEqual(callbacks, [], `equivalence is never consulted for ${label}`);
  }

  const unfinishedVocabulary = vocabularyAnswer('dyed', 'died', {
    complete: false, isFinal: false, completionState: 'pending',
  });
  assert.equal(unfinishedVocabulary.type, 'miss');
  assert.equal(unfinishedVocabulary.recognitionAuthority, 'unmatched');
  assert.equal(unfinishedVocabulary.recognitionRejectionReason, 'incomplete-or-contradictory-evidence');
});

test('dyed/died supports the real dyed source occurrence without broadening dye or die', () => {
  const actualEntries = entries.filter(entry => ['dye', 'die', 'dyed', 'died'].includes(String(entry.canonical || '').toLocaleLowerCase('en-US')));
  assert.deepEqual(actualEntries.map(entry => [entry.id, entry.canonical]), [['vocab:01314', 'dye']]);
  assert.equal(findSpeechSurfaceMatch('dye', 'die')?.ruleId, 'dye-die');
  assert.equal(findSpeechSurfaceMatch('die', 'dye')?.ruleId, 'die-dye');
  assert.equal(findSpeechSurfaceMatch('dye', 'died'), null);
  assert.equal(findSpeechSurfaceMatch('die', 'dyed'), null);
});
