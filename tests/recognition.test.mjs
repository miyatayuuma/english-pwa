import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRecognitionController } from '../scripts/speech/recognition.js';

test('matchAndHighlight treats split and fused compound words as equivalent', () => {
  const controller = createRecognitionController();

  const matchFusedHyp = controller.matchAndHighlight(
    'The rain forest is lush',
    'the rainforest is lush'
  );

  assert.equal(matchFusedHyp.missing.length, 0, 'split reference tokens matched fused hypothesis');
  assert.equal(
    matchFusedHyp.matchedCounts.get('rainforest'),
    1,
    'rain forest merged to rainforest for matching'
  );

  const matchSplitHyp = controller.matchAndHighlight(
    'The rainforest is lush',
    'the rain forest is lush'
  );

  assert.equal(matchSplitHyp.missing.length, 0, 'fused reference token matched split hypothesis');
  assert.equal(
    matchSplitHyp.matchedCounts.get('rainforest'),
    1,
    'rainforest recognized from rain forest tokens'
  );
});
