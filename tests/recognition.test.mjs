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

test('matchAndHighlight treats common homophones as matches', () => {
  const controller = createRecognitionController();

  const sweetSuite = controller.matchAndHighlight('book the suite now', 'book the sweet now');

  assert.equal(sweetSuite.missing.length, 0, 'suite matched sweet in hypothesis');
  assert.equal(sweetSuite.matchedCounts.get('suite'), 1, 'suite counted as matched token');

  const hearHere = controller.matchAndHighlight('hear the bell', 'here the bell');

  assert.equal(hearHere.missing.length, 0, 'hear matched homophonic here token');
  assert.equal(hearHere.matchedCounts.get('hear'), 1, 'hear token counted despite homophone spelling');
});

test('homophone matches normalize UI transcript to reference spelling', () => {
  const controller = createRecognitionController();

  const sweetSuite = controller.matchAndHighlight('book the suite now', 'book the sweet now');

  assert.equal(sweetSuite.transcript, 'book the sweet now', 'raw transcript preserves recognition output');
  assert.equal(
    sweetSuite.normalizedTranscript,
    'book the suite now',
    'normalized transcript aligns UI text to reference spelling'
  );

  const hearHere = controller.matchAndHighlight('hear the bell', 'here the bell');

  assert.equal(hearHere.transcript, 'here the bell', 'raw transcript keeps homophone spelling');
  assert.equal(
    hearHere.normalizedTranscript,
    'hear the bell',
    'normalized transcript replaces homophone with reference spelling'
  );
});
