import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { gradeCorrectionSpeech } from '../scripts/speech/correctionSpeechGrader.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';

test('Correction accepts the same prose/pros equivalence while keeping practice-only retry state', () => {
  const alignment = alignSpeech('The prose.', 'The pros.', {
    context: { mode: 'correction' }, recognitionSegmentIndex: 0, asrRank: 0,
  });
  let levelEvaluations = 0;
  const result = gradeCorrectionSpeech(alignment, {
    evaluateLevel(score) {
      levelEvaluations += 1;
      return { pass: score === 1, candidate: 5 };
    },
    hintStage: 0,
  });

  assert.equal(result.success, true);
  assert.equal(result.score, 1);
  assert.equal(levelEvaluations, 1);
  assert.equal(alignment.rawTranscript, 'The pros.');
  assert.equal(alignment.alignment[1].authority, 'explicit-equivalence');
  assert.equal(alignment.alignment[1].ruleId, 'prose-pros');

  const practice = createCorrectionProgress();
  const attempt = recordCorrectionAttempt(practice, { success: result.success });
  assert.equal(attempt.complete, true);
  assert.equal(attempt.message, '修正練習完了');
  assert.deepEqual(practice, { misses: 0, technicalFailures: 0 });
});
