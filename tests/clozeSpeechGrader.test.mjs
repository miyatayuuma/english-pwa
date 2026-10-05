import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { applyClozeTargetRequirement, gradeClozeSpeech } from '../scripts/speech/clozeSpeechGrader.js';

function targetFor(alignment, surface, entryId, occurrence = 0) {
  const sentence = alignment.referenceText;
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = sentence.indexOf(surface, from);
    if (start === -1) break;
    from = start + surface.length;
  }
  assert.notEqual(start, -1);
  const end = start + surface.length;
  const tokenIndexes = alignment.referenceTokens.flatMap((token, index) => token.end > start && token.start < end ? [index] : []);
  assert.ok(tokenIndexes.length > 0);
  return {
    entry_id: entryId, surface, start, end,
    tokenStart: tokenIndexes[0], tokenEnd: tokenIndexes.at(-1),
  };
}

test('Cloze hidden prose target recognizes approved prose/pros equivalence with provenance', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The pros survived the postwar years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'prose', 'vocab:01089')],
  });

  assert.equal(result.active, true);
  assert.equal(result.overallScore, 1);
  assert.deepEqual(result.targets.map(({ matched, authority, ruleId, ruleKind, rawTranscript, displayTranscript }) =>
    ({ matched, authority, ruleId, ruleKind, rawTranscript, displayTranscript })), [{
    matched: true,
    authority: 'explicit-equivalence',
    ruleId: 'prose-pros',
    ruleKind: 'homophone',
    rawTranscript: 'The pros survived the postwar years.',
    displayTranscript: 'The prose survived the postwar years.',
  }]);
});

test('Cloze hidden postwar target recognizes explicit segmentation and keeps raw display', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The prose survived the post war years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'postwar', 'vocab:01943')],
  });

  assert.equal(result.active, true);
  assert.equal(result.overallScore, 1);
  assert.equal(result.targets[0].matched, true);
  assert.equal(result.targets[0].authority, 'explicit-equivalence');
  assert.equal(result.targets[0].ruleId, 'postwar-post-war');
  assert.equal(result.targets[0].ruleKind, 'segmentation-equivalence');
  assert.equal(result.targets[0].rawTranscript, 'The prose survived the post war years.');
  assert.equal(result.targets[0].displayTranscript, 'The prose survived the post war years.');
});

test('Cloze exposes a hidden-target miss independently of a high overall sentence score', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The progress survived the postwar years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'prose', 'vocab:01089')],
  });

  assert.ok(result.overallScore >= 0.7);
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.targets[0].authority, 'unmatched');
  assert.equal(result.allTargetsMatched, false);

  const gated = applyClozeTargetRequirement({
    candidate: 5, noHintSuccess: true, perfectNoHint: true, pass: true, rate: result.overallScore,
  }, result, 3);
  assert.equal(gated.candidate, 3, 'a target miss cannot promote beyond the prior level');
  assert.equal(gated.pass, false);
  assert.equal(gated.noHintSuccess, false);
  assert.equal(gated.perfectNoHint, false);
});

test('Cloze multi-token target requires every token in its own hidden span', () => {
  const sentence = 'We crossed New York before dawn.';
  const alignment = alignSpeech(sentence, 'We crossed New before dawn.', { context: { mode: 'cloze' } });
  const target = targetFor(alignment, 'New York', 'vocab:new-york');
  const result = gradeClozeSpeech(alignment, { itemId: 'C2', sentence, targets: [target] });

  assert.deepEqual([target.tokenStart, target.tokenEnd], [2, 3]);
  assert.deepEqual(alignment.matchedReferenceTokenIndexes, [0, 1, 2, 4, 5]);
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.allTargetsMatched, false);
});

test('Cloze duplicate word elsewhere cannot satisfy the hidden target occurrence', () => {
  const sentence = 'The cat saw another cat.';
  const alignment = alignSpeech(sentence, 'The cat saw another cut.', { context: { mode: 'cloze' } });
  const target = targetFor(alignment, 'cat', 'vocab:cat', 1);
  const result = gradeClozeSpeech(alignment, { itemId: 'C3', sentence, targets: [target] });

  assert.deepEqual([target.tokenStart, target.tokenEnd], [4, 4]);
  assert.ok(alignment.matchedReferenceTokenIndexes.includes(1), 'the visible occurrence matched');
  assert.ok(!alignment.matchedReferenceTokenIndexes.includes(4), 'the hidden occurrence did not match');
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.allTargetsMatched, false);
});

test('Cloze target requirement is inactive when target context does not match the aligned sentence', () => {
  const alignment = alignSpeech('The prose survived.', 'The progress survived.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'other', sentence: 'A different sentence.',
    targets: [{ entry_id: 'vocab:01089', surface: 'prose', start: 2, end: 7 }],
  });
  const evaluation = { candidate: 4, noHintSuccess: true, perfectNoHint: false, pass: true };
  assert.equal(result.active, false);
  assert.equal(applyClozeTargetRequirement(evaluation, result), evaluation);
});
