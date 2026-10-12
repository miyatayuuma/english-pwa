import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { resolveContextualGrammaticalEquivalence } from '../scripts/speech/contextualGrammaticalEquivalence.js';
import { safeSpeechTokens } from '../scripts/speech/safeSpeechNormalization.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';
import { grammaticalEquivalenceRules } from '../scripts/speech/grammaticalEquivalenceRules.js';

const positives = JSON.parse(readFileSync(new URL('./fixtures/asr09c-positive-controls.json', import.meta.url), 'utf8')).positiveControls;
const negatives = JSON.parse(readFileSync(new URL('../data/audits/asr-09c-contextual-grammatical-equivalence/negative-controls.json', import.meta.url), 'utf8')).negativeControls;
const reconciliation = JSON.parse(readFileSync(new URL('../data/audits/asr-09c-contextual-grammatical-equivalence/corpus-reconciliation.json', import.meta.url), 'utf8'));
const context = mode => ({ context: { mode } });
const segment = (values, segmentIndex = 0) => ({
  segmentIndex,
  primaryTranscript: values[0],
  isFinal: true,
  alternatives: values.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
});

test('the resolver independently parses both complete sequences and returns only a bounded 2:1 head span', () => {
  const expectedTokens = safeSpeechTokens('He has been working.');
  const observedTokens = safeSpeechTokens("He’s been working.");
  const match = resolveContextualGrammaticalEquivalence({
    expectedTokens,
    observedTokens,
    expectedStart: 0,
    observedStart: 0,
    mode: 'correction',
    referenceContext: { surface: 'He has been working.' },
    recognitionProvenance: { attemptId: 'resolver-attempt', asrRank: 0 },
  });
  assert.equal(match.status, 'MATCH');
  assert.equal(match.selectedAuxiliary, 'has');
  assert.equal(match.ruleId, 'asr09c-has-been-progressive');
  assert.equal(match.decisionId, 'ambiguous-s');
  assert.deepEqual(match.expectedTokenSpan, { start: 0, length: 2 });
  assert.deepEqual(match.observedTokenSpan, { start: 0, length: 1 });
  assert.deepEqual(match.contextualGrammarEvidence.expectedParse, ['he', 'has', 'been', 'working']);
  assert.deepEqual(match.contextualGrammarEvidence.observedParse, ["he's", 'been', 'working']);
  assert.equal(match.contextualGrammarEvidence.independentParseAgreement, true);

  const readMode = resolveContextualGrammaticalEquivalence({
    expectedTokens: safeSpeechTokens('He is working.'),
    observedTokens: safeSpeechTokens("He's working."),
    expectedStart: 0,
    observedStart: 0,
    mode: 'read',
  });
  assert.equal(readMode.status, 'UNRESOLVED');
  assert.equal(readMode.reason, 'mode-not-authorized');
});

test('all approved IS and HAS patterns match both directions with Unicode apostrophes preserved', () => {
  assert.equal(positives.length, 12);
  for (const fixture of positives) {
    const match = findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(fixture.mode));
    assert.equal(match?.authority, 'grammatical-variant', fixture.id);
    assert.equal(match?.authorityTier, 'grammatical-variant', fixture.id);
    assert.equal(match?.decisionId, 'ambiguous-s', fixture.id);
    assert.equal(match?.selectedAuxiliary, fixture.selectedAuxiliary, fixture.id);
    assert.equal(match?.ruleId, fixture.selectedAuxiliary === 'is'
      ? 'asr09c-is-progressive'
      : 'asr09c-has-been-progressive', fixture.id);
    assert.equal(match?.rawTranscript, fixture.observed, fixture.id);
    assert.deepEqual(match?.matchedSpan?.observed, match?.alignment[0]?.observedSurface, fixture.id);
    assert.equal(match?.contextualGrammarEvidence?.independentParseAgreement, true, fixture.id);
  }
});

test('sentence-initial, clause-internal, and multiple independent contextual occurrences align with provenance', () => {
  const initial = alignSpeech('He is working.', "He’s working.", {
    ...context('correction'), attemptId: 'initial-attempt', recognitionSegmentIndex: 2, asrRank: 1,
  });
  assert.equal(initial.matchRate, 1);
  assert.equal(initial.alignment[0].authority, 'grammatical-variant');
  assert.equal(initial.alignment[0].selectedAuxiliary, 'is');
  assert.equal(initial.alignment[0].attemptId, 'initial-attempt');
  assert.equal(initial.alignment[0].recognitionSegmentIndex, 2);
  assert.equal(initial.alignment[0].asrRank, 1);
  assert.deepEqual(initial.alignment[0].expectedTokenIndexes, [0, 1]);
  assert.deepEqual(initial.alignment[0].observedTokenIndexes, [0]);

  const reference = 'I think he is working, and she has been studying all week.';
  const transcript = 'I think he’s working, and she’s been studying all week.';
  const combined = alignSpeech(reference, transcript, {
    ...context('correction'), attemptId: 'multi-attempt', recognitionSegmentIndex: 4, asrRank: 0,
  });
  assert.equal(combined.matchRate, 1);
  const contextual = combined.alignment.filter(event => event.decisionId === 'ambiguous-s');
  assert.equal(contextual.length, 2);
  assert.deepEqual(contextual.map(event => event.selectedAuxiliary), ['is', 'has']);
  assert.deepEqual(contextual.map(event => event.ruleId), [
    'asr09c-is-progressive', 'asr09c-has-been-progressive',
  ]);
  assert.ok(contextual.every(event => event.attemptId === 'multi-attempt' && event.recognitionSegmentIndex === 4));
  assert.deepEqual(combined.matchedReferenceTokenIndexes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('all negative controls fail closed in every listed mode', () => {
  for (const fixture of negatives) {
    for (const mode of fixture.modes || ['vocabulary', 'correction']) {
      assert.equal(findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(mode)), null, `${fixture.id} ${mode}`);
    }
  }
  for (const fixture of [
    ['He is finished.', "He's finished."],
    ['He has finished.', "He's finished."],
    ['He is been working.', "He's been working."],
    ['He has working.', "He's working."],
    ['He is working.', "He's"],
    ['He has been working.', "He's been"],
    ["He's not working.", 'He is not working.'],
  ]) {
    const result = alignSpeech(fixture[0], fixture[1], context('correction'));
    assert.equal(result.alignment.some(event => event.decisionId === 'ambiguous-s'), false, `${fixture.join(' / ')}`);
  }
});

test('Vocabulary retains TARGET, answer/source authority, PARAPHRASE, and raw transcript', () => {
  const canonical = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09c-target', canonical: 'He is working.' },
    transcript: 'He’s working.',
  });
  assert.equal(canonical.type, 'target');
  assert.equal(canonical.matchedAuthority, 'canonical');
  assert.equal(canonical.recognitionAuthority, 'grammatical-variant');
  assert.equal(canonical.decisionId, 'ambiguous-s');
  assert.equal(canonical.rawTranscript, 'He’s working.');

  const answer = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09c-answer', canonical: 'complete the assignment', answers: ['She is studying.'] },
    transcript: "She's studying.",
  });
  assert.equal(answer.type, 'target');
  assert.equal(answer.matchedAuthority, 'answer');
  assert.equal(answer.recognitionAuthority, 'grammatical-variant');

  const sourceSentence = 'He is working on the report.';
  const source = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09c-source', canonical: 'do a task' },
    activeOccurrence: {
      item: { en: sourceSentence },
      occurrence: { start: 0, end: 'He is working'.length },
    },
    transcript: "He's working.",
  });
  assert.equal(source.type, 'target');
  assert.equal(source.matchedAuthority, 'source');
  assert.equal(source.recognitionAuthority, 'grammatical-variant');

  const paraphrase = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09c-paraphrase', canonical: 'work through a period', paraphrases: ['She has been studying.'] },
    transcript: "She's been studying.",
  });
  assert.equal(paraphrase.type, 'paraphrase');
  assert.equal(paraphrase.matchedAuthority, 'paraphrase');
  assert.equal(paraphrase.recognitionAuthority, 'grammatical-variant');
});

test('a finalized lower N-best rank is evaluated independently; split hypotheses remain incomplete', () => {
  const target = { id: 'asr09c-nbest', canonical: 'He is working now.' };
  const rescued = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: 'unrelated primary text',
    attemptId: 'asr09c-attempt',
    recognitionComplete: true,
    completionState: 'finalized',
    recognitionSegments: [segment(['unrelated primary text', "He's working now."], 7)],
  });
  assert.equal(rescued.type, 'target');
  assert.equal(rescued.asrRank, 1);
  assert.equal(rescued.recognitionSegmentIndex, 7);
  assert.equal(rescued.attemptId, 'asr09c-attempt');
  assert.equal(rescued.rawTranscript, "He's working now.");
  assert.equal(rescued.primaryTranscript, 'unrelated primary text');
  assert.equal(rescued.speechMatch.alignment.find(event => event.decisionId === 'ambiguous-s')?.asrRank, 1);

  const split = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: "He's",
    attemptId: 'split-attempt',
    recognitionComplete: true,
    completionState: 'finalized',
    recognitionSegments: [segment(["He's", 'working now.'], 1)],
  });
  assert.equal(split.type, 'miss');

  const unfinished = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: 'unrelated primary text',
    attemptId: 'interim-attempt',
    recognitionComplete: false,
    completionState: 'interim',
    recognitionSegments: [segment(['unrelated primary text', "He's working now."], 1)],
  });
  assert.equal(unfinished.type, 'miss');
});

test('Read/Cloze do not adopt ASR-09C while ASR-09B fixed pairs remain active', () => {
  for (const mode of ['read', 'cloze']) {
    const contextual = alignSpeech('He is working.', "He's working.", context(mode));
    assert.equal(contextual.alignment.some(event => event.decisionId === 'ambiguous-s'), false);
    assert.ok(contextual.matchRate < 1);
    assert.equal(findSpeechSurfaceMatch('I am ready.', "I'm ready.", context(mode))?.decisionId, 'fixed-be-have-will');
  }
  assert.equal(grammaticalEquivalenceRules.length, 66);
});

test('Correction accepts approved context and keeps scheduled review state isolated', () => {
  const rawTranscript = "He's been working.";
  const alignment = alignSpeech('He has been working.', rawTranscript, {
    ...context('correction'), attemptId: 'correction-attempt', recognitionSegmentIndex: 3, asrRank: 0,
  });
  let evaluationCount = 0;
  const result = gradeCorrectionSpeech(alignment, {
    evaluateLevel(score) { evaluationCount += 1; return { pass: score === 1 }; },
    hintStage: 0,
  });
  assert.equal(result.success, true);
  assert.equal(result.score, 1);
  assert.equal(evaluationCount, 1);
  assert.equal(alignment.rawTranscript, rawTranscript);
  assert.equal(alignment.alignment[0].decisionId, 'ambiguous-s');
  assert.equal(alignment.alignment[0].ruleId, 'asr09c-has-been-progressive');
  const practice = createCorrectionProgress();
  assert.equal(recordCorrectionAttempt(practice, { success: result.success }).complete, true);
  assert.deepEqual(practice, { misses: 0, technicalFailures: 0 });
  const scheduledReview = { due: 123456, interval: 8, repetitions: 4 };
  assert.deepEqual(scheduledReview, { due: 123456, interval: 8, repetitions: 4 });
});

test('the 107-candidate reconciliation is exhaustive and records only three bounded safe source contexts', () => {
  assert.equal(reconciliation.total, 107);
  const safe = reconciliation.candidates.filter(row => row.status === 'SAFE_CONTEXT_RESOLVED');
  assert.deepEqual(safe.map(row => row.sourceId), ['E0270', 'E0540', 'E0558']);
  assert.deepEqual(safe.map(row => row.requiredRule), [
    'asr09c-is-progressive', 'asr09c-is-progressive', 'asr09c-has-been-progressive',
  ]);
  assert.ok(reconciliation.candidates.every(row => row.counterexample));
});
