import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { gradeClozeSpeech } from '../scripts/speech/clozeSpeechGrader.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { grammaticalEquivalenceRules } from '../scripts/speech/grammaticalEquivalenceRules.js';

const fixtures = JSON.parse(readFileSync(new URL('../data/audits/asr-09a-grammatical-equivalence/regression-fixtures.json', import.meta.url), 'utf8'));
const segment = (values, segmentIndex = 0) => ({
  segmentIndex,
  primaryTranscript: values[0],
  isFinal: true,
  alternatives: values.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
});
const context = mode => ({ context: { mode } });

test('every ASR-09A SAFE fixed pair matches in both directions with distinct authority and source provenance', () => {
  assert.equal(grammaticalEquivalenceRules.length, 66);
  for (const rule of grammaticalEquivalenceRules) {
    for (const mode of ['vocabulary', 'read', 'cloze', 'correction']) {
      const match = findSpeechSurfaceMatch(rule.expected, rule.recognized, context(mode));
      assert.equal(match?.authority, 'grammatical-variant', `${rule.id} ${rule.direction} ${mode}`);
      assert.equal(match?.authorityTier, 'grammatical-variant');
      assert.equal(match?.decisionId, rule.decisionId);
      assert.equal(match?.ruleId, rule.id);
      assert.equal(match?.rawTranscript, rule.recognized);
      assert.equal(match?.alignment[0]?.expectedTokenIndexes.length > 0, true);
      assert.equal(match?.alignment[0]?.observedTokenIndexes.length > 0, true);
    }
  }
  const result = alignSpeech('I am ready now.', 'I’m ready now.', { ...context('read'), attemptId: 'attempt-7', recognitionSegmentIndex: 3, asrRank: 0 });
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.matchedReferenceTokenIndexes, [0, 1, 2, 3]);
  assert.equal(result.alignment[0].expectedTokenIndexes.length, 2);
  assert.equal(result.alignment[0].observedTokenIndexes.length, 1);
  assert.deepEqual([result.alignment[0].expectedStart, result.alignment[0].expectedEnd], [0, 4]);
  assert.deepEqual([result.alignment[0].observedStart, result.alignment[0].observedEnd], [0, 3]);
  assert.equal(result.alignment[0].attemptId, 'attempt-7');
  assert.equal(result.alignment[0].recognitionSegmentIndex, 3);
  assert.equal(result.alignment[0].asrRank, 0);
  assert.equal(result.alignment[0].authorityTier, 'grammatical-variant');
  assert.equal(result.alignment[0].decisionId, 'fixed-be-have-will');
  assert.equal(result.alignment[0].ruleId, 'asr09b-i-am');
  assert.equal(result.rawTranscript, 'I’m ready now.');
  assert.equal(result.displayTranscript, 'I’m ready now.');
});

test('approved SAFE ASR-09A positive fixtures are production matches; all 38 negative controls stay rejected', () => {
  const approved = new Set(['fixed-be-have-will', 'negative-fixed-pair']);
  const safe = fixtures.positiveControls.filter(row => approved.has(row.decisionId));
  assert.ok(safe.length >= 33);
  for (const row of safe) {
    for (const mode of row.modes || [row.mode].filter(Boolean)) {
      const match = findSpeechSurfaceMatch(row.expected, row.observed, context(mode));
      assert.equal(match?.authority, 'grammatical-variant', row.id);
    }
  }
  for (const row of fixtures.negativeControls) {
    assert.equal(findSpeechSurfaceMatch(row.expected, row.observed, context(row.mode || 'read')), null, row.id);
  }
});

test('polarity, auxiliary identity, ambiguous contractions, homophones, and split can not are never inferred', () => {
  for (const [expected, observed] of [
    ["can't", 'can'], ['can', "can't"], ["don't", 'do'], ['do', "don't"],
    ["won't", 'will'], ['will', "won't"], ["didn't", 'did'], ['did', "didn't"],
    ['we are ready', 'were ready'], ['were ready', "we're ready"],
    ['you are right', 'your right'], ['your right', "you're right"],
    ['they are here', 'their here'], ['they are here', 'there here'],
    ['it is ready', 'its ready'], ['its ready', "it's ready"],
    ['he is ready', "he's ready"], ['he has finished', "he's finished"],
    ['I had left', "I'd left"], ['I would go', "I'd go"],
    ['let us go', "let's go"], ['cannot go', 'can not go'], ['can not go', "can't go"],
    ['do not agree', 'do agree'], ['do not agree', 'do'],
    ["we're ready", 'were ready'], ['were ready', "we're ready"],
    ["you're right", 'your right'], ['your right', "you're right"],
    ["they're here", 'their here'], ["they're here", 'there here'],
    ['their here', "they're here"], ['there here', "they're here"],
    ["it's ready", 'its ready'], ['its ready', "it's ready"],
    ["he's ready", 'he is ready'], ["he's finished", 'he has finished'],
    ["I'd left", 'I had left'], ["I'd go", 'I would go'],
    ["let's go", 'let us go'], ["can't go", 'can not go'],
  ]) {
    for (const mode of ['vocabulary', 'read', 'cloze', 'correction']) {
      assert.equal(findSpeechSurfaceMatch(expected, observed, context(mode)), null, `${expected} ≠ ${observed} in ${mode}`);
    }
  }
});

test('Read keeps perfect-equivalent scoring, reference highlights, missing words, order, and extra-word precision', () => {
  const complete = alignSpeech('I am ready now.', "I'm ready now.", context('read'));
  assert.equal(gradeReadSpeech(complete).score, 1);
  assert.deepEqual(complete.matchedReferenceTokenIndexes, [0, 1, 2, 3]);

  const missing = alignSpeech('I am ready now.', "I'm ready.", context('read'));
  assert.deepEqual(missing.missing, ['now']);
  assert.ok(gradeReadSpeech(missing).score < 1);

  const reordered = alignSpeech('I am ready now.', "Now I'm ready.", context('read'));
  assert.equal(gradeReadSpeech(reordered).orderedMatchIntegrity.valid, false);
  assert.equal(gradeReadSpeech(reordered).score, 0);

  const extra = alignSpeech('I am ready now.', "I'm very ready now.", context('read'));
  assert.equal(extra.missing.length, 0);
  assert.ok(gradeReadSpeech(extra).score < 1);
});

test('Vocabulary preserves TARGET, PARAPHRASE, raw transcript, N-best independence, and finalized provenance', () => {
  const target = { id: 'asr09b-target', canonical: 'I am ready' };
  const raw = "I'm ready";
  const accepted = classifyVocabularySpeechAnswer({ entry: target, transcript: raw, attemptId: 'vocab-attempt' });
  assert.equal(accepted.type, 'target');
  assert.equal(accepted.recognitionAuthority, 'grammatical-variant');
  assert.equal(accepted.decisionId, 'fixed-be-have-will');
  assert.equal(accepted.rawTranscript, raw);
  assert.equal(accepted.speechMatch.matchedSpan.observed, "I'm");
  assert.equal(accepted.attemptId, 'vocab-attempt');
  assert.equal(accepted.speechMatch.attemptId, 'vocab-attempt');

  const paraphrase = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09b-paraphrase', canonical: 'yield to something', paraphrases: ['I am ready'] },
    transcript: "I'm ready",
  });
  assert.equal(paraphrase.type, 'paraphrase');
  assert.equal(paraphrase.recognitionAuthority, 'grammatical-variant');

  const carriedParaphraseRaw = "My answer is, I'm ready";
  const carriedParaphrase = classifyVocabularySpeechAnswer({
    entry: { id: 'asr09b-carried-paraphrase', canonical: 'yield to something', paraphrases: ['I am ready'] },
    transcript: carriedParaphraseRaw,
  });
  assert.equal(carriedParaphrase.type, 'paraphrase');
  assert.equal(carriedParaphrase.rawTranscript, carriedParaphraseRaw);
  assert.equal(carriedParaphrase.speechMatch.matchedSpan.observedStart, carriedParaphraseRaw.indexOf("I'm"));
  assert.deepEqual(carriedParaphrase.speechMatch.alignment[0].observedTokenIndexes, [3]);

  const lowerRank = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: 'unrelated speech',
    attemptId: 'nbest-attempt',
    recognitionComplete: true,
    completionState: 'finalized',
    recognitionSegments: [segment(['unrelated speech', raw])],
  });
  assert.equal(lowerRank.type, 'target');
  assert.equal(lowerRank.targetRescued, true);
  assert.equal(lowerRank.asrRank, 1);
  assert.equal(lowerRank.rawTranscript, raw);
  assert.equal(lowerRank.primaryTranscript, 'unrelated speech');
  assert.equal(lowerRank.speechMatch.recognitionSegmentIndex, 0);
  assert.equal(lowerRank.speechMatch.asrRank, 1);
  assert.equal(lowerRank.speechMatch.attemptId, 'nbest-attempt');

  const unfinished = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: 'unrelated speech',
    recognitionComplete: false,
    completionState: 'interim',
    recognitionSegments: [segment(['unrelated speech', raw])],
  });
  assert.equal(unfinished.type, 'miss');

  const splitRanks = classifyVocabularySpeechAnswer({
    entry: target,
    transcript: 'I',
    recognitionComplete: true,
    completionState: 'finalized',
    recognitionSegments: [segment(['I', 'am ready'])],
  });
  assert.equal(splitRanks.type, 'miss');
});

test('Cloze accepts only the complete hidden fixed pair in place with negation preserved', () => {
  const sentence = 'I do not agree.';
  const target = { entry_id: 'hidden-do-not', surface: 'do not', start: sentence.indexOf('do not'), end: sentence.indexOf('do not') + 'do not'.length };
  const goodAlignment = alignSpeech(sentence, "I don't agree.", context('cloze'));
  const good = gradeClozeSpeech(goodAlignment, { sentence, targets: [target] });
  assert.equal(good.pass, true);
  assert.equal(good.negationPreserved, true);
  assert.equal(good.targets[0].authority, 'grammatical-variant');
  assert.equal(good.targets[0].decisionId, 'negative-fixed-pair');
  assert.equal(good.grammaticalNegationIntegrity, true);

  const omittedNegative = gradeClozeSpeech(alignSpeech(sentence, 'I do agree.', context('cloze')), { sentence, targets: [target] });
  assert.equal(omittedNegative.negationPreserved, false);
  assert.equal(omittedNegative.pass, false);
  assert.equal(omittedNegative.targets[0].matched, false);

  const addedNegation = gradeClozeSpeech(alignSpeech(sentence, "I don't not agree.", context('cloze')), { sentence, targets: [target] });
  assert.equal(addedNegation.negationPreserved, true, 'the frozen expected-negation guard remains unchanged');
  assert.equal(addedNegation.grammaticalNegationIntegrity, false);
  assert.equal(addedNegation.pass, false);

  const longSentence = 'She will not leave tonight.';
  const longTargetText = 'will not leave';
  const longTarget = { entry_id: 'hidden-will-not-leave', surface: longTargetText, start: longSentence.indexOf(longTargetText), end: longSentence.indexOf(longTargetText) + longTargetText.length };
  const partial = gradeClozeSpeech(alignSpeech(longSentence, "She won't tonight.", context('cloze')), { sentence: longSentence, targets: [longTarget] });
  assert.equal(partial.negationPreserved, true);
  assert.equal(partial.targets[0].matched, false);
  assert.equal(partial.pass, false);

  const selfCorrected = gradeClozeSpeech(
    alignSpeech(longSentence, "She will not leave tonight. She won't tonight.", context('cloze')),
    { sentence: longSentence, targets: [longTarget] },
  );
  assert.equal(selfCorrected.repair.latestRestartSelected, true);
  assert.equal(selfCorrected.targets[0].matched, false);
  assert.equal(selfCorrected.pass, false);
});

test('Correction grades approved pairs while retaining practice-only progress behavior', () => {
  const alignment = alignSpeech('They will not leave.', "They won't leave.", context('correction'));
  let levelEvaluationCount = 0;
  const result = gradeCorrectionSpeech(alignment, {
    evaluateLevel(score) { levelEvaluationCount += 1; return { pass: score === 1, candidate: 4 }; },
    hintStage: 0,
  });
  assert.equal(result.success, true);
  assert.equal(result.score, 1);
  assert.equal(levelEvaluationCount, 1);
  assert.equal(alignment.alignment[1].authority, 'grammatical-variant');
  assert.equal(alignment.alignment[1].decisionId, 'negative-fixed-pair');

  const practice = createCorrectionProgress();
  const attempt = recordCorrectionAttempt(practice, { success: result.success });
  assert.equal(attempt.complete, true);
  assert.deepEqual(practice, { misses: 0, technicalFailures: 0 });
});
