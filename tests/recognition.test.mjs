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

test('leading article mismatches retain spoken transcript but flag missing reference tokens', () => {
  const controller = createRecognitionController();
  const spoken = 'a cat';
  const match = controller.matchAndHighlight('the cat', spoken);

  assert.equal(match.source, spoken, 'stable transcript keeps spoken tokens');
  assert.equal(match.transcript, spoken, 'match window covers the entire hypothesis');
  assert.ok(match.matchWindow, 'match metadata exposes the scoring window');
  assert.equal(match.matchWindow.start, 0, 'scoring window begins at the hypothesis start');
  assert.equal(
    match.matchWindow.length,
    match.matchWindow.hypLength,
    'scoring window spans all hypothesis tokens'
  );
  assert.ok(
    match.missing.includes('the'),
    'missing tokens include the unmatched leading reference word'
  );
});

test('trailing hypothesis words remain in transcript while mismatches are reported', () => {
  const controller = createRecognitionController();
  const spoken = 'cat in hat now';
  const match = controller.matchAndHighlight('cat in the hat', spoken);

  assert.equal(match.source, spoken, 'stable transcript keeps all spoken words');
  assert.equal(match.transcript, spoken, 'match window retains the trailing hypothesis token');
  assert.ok(match.matchWindow, 'match metadata exposes the trailing window bounds');
  assert.equal(match.matchWindow.start, 0, 'window starts from the first hypothesis token');
  assert.equal(
    match.matchWindow.length,
    match.matchWindow.hypLength,
    'scoring window spans all hypothesis tokens even with mismatched suffix'
  );
  assert.ok(
    match.missing.includes('the'),
    'missing tokens include the dropped reference article'
  );
  assert.equal(
    match.hypTokens.join(' '),
    spoken,
    'highlight tokens still include the unmatched trailing hypothesis token'
  );
});
