import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { resolveContextualDGrammaticalEquivalence } from '../scripts/speech/contextualDGrammaticalEquivalence.js';
import { safeSpeechTokens } from '../scripts/speech/safeSpeechNormalization.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';
import { grammaticalEquivalenceRules } from '../scripts/speech/grammaticalEquivalenceRules.js';
import { ASR09C_CONTEXTUAL_PATTERNS } from '../scripts/speech/contextualGrammaticalEquivalence.js';

const positives = JSON.parse(readFileSync(new URL('./fixtures/asr09d-positive-controls.json', import.meta.url), 'utf8')).positiveControls;
const negatives = JSON.parse(readFileSync(new URL('./fixtures/asr09d-negative-controls.json', import.meta.url), 'utf8')).negativeControls;
const context = mode => ({ context: { mode } });
const segment = values => ({
  segmentIndex: 0,
  primaryTranscript: values[0],
  isFinal: true,
  alternatives: values.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
});

test('bounded resolver independently parses the full expected and observed sequences', () => {
  const result = resolveContextualDGrammaticalEquivalence({
    expectedTokens: safeSpeechTokens('She had seen it.'),
    observedTokens: safeSpeechTokens('She’d seen it.'),
    expectedStart: 0,
    observedStart: 0,
    mode: 'correction',
    referenceContext: { sentence: 'She had seen it.' },
    recognitionProvenance: { attemptId: 'd-test', asrRank: 0 },
  });
  assert.equal(result.status, 'MATCH');
  assert.equal(result.selectedAuxiliary, 'had');
  assert.equal(result.decisionId, 'ambiguous-d');
  assert.equal(result.authorityTier, 'grammatical-variant');
  assert.equal(result.patternId, 'asr09d-had-past-participle');
  assert.deepEqual(result.expectedTokenSpan, { start: 0, length: 2 });
  assert.deepEqual(result.observedTokenSpan, { start: 0, length: 1 });
  assert.equal(result.independentParseAgreement, true);
  assert.deepEqual(result.contextualGrammarEvidence.expectedParse, ['she', 'had', 'seen']);
  assert.deepEqual(result.contextualGrammarEvidence.observedParse, ["she'd", 'seen']);

  const excludedMode = resolveContextualDGrammaticalEquivalence({
    expectedTokens: safeSpeechTokens('I would go.'),
    observedTokens: safeSpeechTokens("I'd go."),
    mode: 'read',
  });
  assert.equal(excludedMode.status, 'UNRESOLVED');
  assert.equal(excludedMode.reason, 'mode-not-authorized');
});

test('approved HAD and WOULD fixtures match in both directions with case and apostrophe normalization', () => {
  assert.equal(positives.length, 14);
  for (const fixture of positives) {
    const forward = findSpeechSurfaceMatch(fixture.expected, fixture.observed, context('vocabulary'));
    const backward = findSpeechSurfaceMatch(fixture.observed, fixture.expected, context('correction'));
    for (const match of [forward, backward]) {
      assert.equal(match?.authority, 'grammatical-variant', fixture.id);
      assert.equal(match?.decisionId, 'ambiguous-d', fixture.id);
      assert.equal(match?.selectedAuxiliary, fixture.selectedAuxiliary, fixture.id);
      assert.equal(match?.authorityTier, 'grammatical-variant');
      assert.equal(match?.independentParseAgreement, true);
      assert.equal(match?.contextualGrammarEvidence?.independentParseAgreement, true);
    }
    assert.equal(forward?.rawTranscript, fixture.observed, fixture.id);
    assert.equal(forward?.alignment[0]?.patternId, fixture.selectedAuxiliary === 'had'
      ? 'asr09d-had-past-participle' : 'asr09d-would-base-verb');
  }
  assert.equal(findSpeechSurfaceMatch('I HAD EATEN.', 'I’d EATEN.', context('vocabulary'))?.selectedAuxiliary, 'had');
});

test('case, clause-internal positions, multiple contractions, and source offsets are retained', () => {
  const expected = 'She said I had eaten, and they had gone home.';
  const observed = 'She said I’d eaten, and they’d gone home.';
  const aligned = alignSpeech(expected, observed, context('correction'));
  assert.equal(aligned.rawTranscript, observed);
  const dMatches = aligned.alignment.filter(row => row.decisionId === 'ambiguous-d');
  assert.equal(dMatches.length, 2);
  assert.deepEqual(dMatches.map(row => row.selectedAuxiliary), ['had', 'had']);
  assert.deepEqual(dMatches.map(row => row.observedTokenIndexes.length), [1, 1]);
  assert.equal(observed.slice(dMatches[0].observedStart, dMatches[0].observedEnd), 'I’d');
  assert.equal(dMatches[0].attemptId, null);

  const unicode = findSpeechSurfaceMatch('They would go.', 'They’d go.', context('vocabulary'));
  assert.equal(unicode?.selectedAuxiliary, 'would');
  assert.equal(unicode?.matchedSpan.observed, 'They’d');
});

test('all negative controls reject without cross-auxiliary or missing-word synthesis', () => {
  for (const fixture of negatives) {
    for (const mode of ['vocabulary', 'correction']) {
      assert.equal(findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(mode)), null, `${fixture.id} ${mode}`);
    }
  }
  assert.equal(findSpeechSurfaceMatch('I would put it there.', "I'd put it there.", context('vocabulary')), null);
  assert.equal(findSpeechSurfaceMatch('I would read the book.', "I'd read the book.", context('correction')), null);
});

test('Vocabulary keeps TARGET and PARAPHRASE authority and records the selected raw recognition', () => {
  const entry = { id: 'asr09d-target', canonical: 'I had eaten.' };
  const target = classifyVocabularySpeechAnswer({ entry, transcript: "I'd eaten." });
  assert.equal(target.type, 'target');
  assert.equal(target.recognitionAuthority, 'grammatical-variant');
  assert.equal(target.decisionId, 'ambiguous-d');
  assert.equal(target.rawTranscript, "I'd eaten.");
  assert.equal(target.speechMatch.rawTranscript, "I'd eaten.");

  const answerVariant = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-answer', canonical: 'show readiness', answers: ['I had eaten.'] },
    transcript: "I'd eaten.",
  });
  assert.equal(answerVariant.type, 'target');
  assert.equal(answerVariant.matchedAuthority, 'answer');
  assert.equal(answerVariant.decisionId, 'ambiguous-d');

  const sourceSentence = 'They had written it yesterday.';
  const occurrence = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-source', canonical: 'write something' },
    activeOccurrence: { item: { en: sourceSentence }, occurrence: { start: 0, end: 'They had written it'.length } },
    transcript: "They'd written it.",
  });
  assert.equal(occurrence.type, 'target');
  assert.equal(occurrence.matchedAuthority, 'source');
  assert.equal(occurrence.decisionId, 'ambiguous-d');

  const paraphrase = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-paraphrase', canonical: 'She had eaten.', paraphrases: ['She would go.'] },
    transcript: "She'd go.",
  });
  assert.equal(paraphrase.type, 'paraphrase');
  assert.equal(paraphrase.decisionId, 'ambiguous-d');

  const carried = classifyVocabularySpeechAnswer({ entry, transcript: "My answer is, I'd eaten." });
  assert.equal(carried.type, 'target');
  assert.equal(carried.rawTranscript, "My answer is, I'd eaten.");
  assert.equal(carried.speechMatch.rawTranscript, "My answer is, I'd eaten.");
});

test('Correction uses the same resolver without writing scheduled SRS state; N-best candidates stay independent', () => {
  const alignment = alignSpeech('I would go.', "I'd go.", context('correction'));
  const grade = gradeCorrectionSpeech(alignment, {
    evaluateLevel(score) { return { pass: score === 1, candidate: 3 }; },
    hintStage: 0,
  });
  assert.equal(grade.success, true);
  assert.equal(alignment.alignment[0].decisionId, 'ambiguous-d');
  const progress = createCorrectionProgress();
  recordCorrectionAttempt(progress, { success: grade.success });
  assert.deepEqual(progress, { misses: 0, technicalFailures: 0 });

  const nbest = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-nbest', canonical: 'They had written it.' },
    transcript: 'unrelated words',
    recognitionComplete: true,
    completionState: 'finalized',
    attemptId: 'asr09d-nbest-attempt',
    recognitionSegments: [segment(['unrelated words', 'They’d written it.'])],
  });
  assert.equal(nbest.type, 'target');
  assert.equal(nbest.asrRank, 1);
  assert.equal(nbest.rawTranscript, 'They’d written it.');
  assert.equal(nbest.primaryTranscript, 'unrelated words');
  assert.equal(nbest.speechMatch.attemptId, 'asr09d-nbest-attempt');
  assert.equal(nbest.speechMatch.asrRank, 1);

  const split = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-split', canonical: 'They had written it.' },
    transcript: 'They had', recognitionComplete: true, completionState: 'finalized',
    recognitionSegments: [segment(['They had', "They'd written it."])],
  });
  assert.equal(split.type, 'target', 'a complete lower-rank candidate may match independently');
  assert.equal(split.rawTranscript, "They'd written it.");

  const crossRankFragments = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-cross-rank', canonical: 'They had written it.' },
    transcript: 'unrelated', recognitionComplete: true, completionState: 'finalized',
    recognitionSegments: [segment(["They'd", 'written it.'])],
  });
  assert.equal(crossRankFragments.type, 'miss');
  assert.equal(crossRankFragments.rawTranscript, 'unrelated');

  const crossSegmentFragments = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-cross-segment', canonical: 'They had written it.' },
    transcript: 'unrelated', recognitionComplete: true, completionState: 'finalized',
    recognitionSegments: [segment(["They'd"]), { ...segment(['written it.']), segmentIndex: 1 }],
  });
  assert.equal(crossSegmentFragments.type, 'miss');

  const attemptOne = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-attempt-one', canonical: 'They had written it.' },
    transcript: "They'd", recognitionComplete: true, completionState: 'finalized',
    attemptId: 'attempt-one', recognitionSegments: [segment(["They'd"])],
  });
  const attemptTwo = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-attempt-two', canonical: 'They had written it.' },
    transcript: 'written it.', recognitionComplete: true, completionState: 'finalized',
    attemptId: 'attempt-two', recognitionSegments: [segment(['written it.'])],
  });
  assert.equal(attemptOne.type, 'miss');
  assert.equal(attemptTwo.type, 'miss');

  const unfinished = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09d-interim', canonical: 'They had written it.' },
    transcript: 'unrelated', recognitionComplete: false, completionState: 'interim',
    recognitionSegments: [segment(['unrelated', "They'd written it."])],
  });
  assert.equal(unfinished.type, 'miss');
});

test('Read and Cloze keep D isolated while fixed 09B and contextual 09C behavior remain unchanged', () => {
  assert.equal(grammaticalEquivalenceRules.length, 66);
  assert.equal(ASR09C_CONTEXTUAL_PATTERNS.length, 2);
  for (const mode of ['read', 'cloze']) {
    assert.equal(findSpeechSurfaceMatch('I had eaten.', "I'd eaten.", context(mode)), null);
    assert.equal(findSpeechSurfaceMatch('I would go.', "I'd go.", context(mode)), null);
    assert.equal(findSpeechSurfaceMatch('I am ready.', "I'm ready.", context(mode))?.decisionId, 'fixed-be-have-will');
    assert.equal(findSpeechSurfaceMatch('He is working.', "He's working.", context(mode)), null);
  }
  assert.equal(findSpeechSurfaceMatch('He is working.', "He's working.", context('vocabulary'))?.decisionId, 'ambiguous-s');
});
