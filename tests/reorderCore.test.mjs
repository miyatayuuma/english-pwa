import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerIsComplete,
  answerIsCorrect,
  createPuzzleState,
  createWrongShuffle,
  markSentenceComplete,
  moveTile,
  recordWrongAttempt,
  reconstructCanonical,
  reorderAnswerTile,
  restorePuzzle,
  selectReorderVariant,
  targetTierForLevel,
  validateCanonicalVariant,
} from '../scripts/reorder/reorderCore.js';

function variant(texts, acceptedIndexOrders = []) {
  const tiles = texts.map((text, index) => ({
    id: `tile-${index}`,
    text,
    tokenStart: index,
    tokenEnd: index + 1,
    separatorAfter: index + 1 < texts.length ? ' ' : '.',
  }));
  const canonicalOrder = tiles.map((tile) => tile.id);
  return {
    tiles,
    canonicalOrder,
    acceptedOrders: [canonicalOrder, ...acceptedIndexOrders.map((order) => order.map((index) => `tile-${index}`))],
    canonicalReconstruction: `${texts.join(' ')}.`,
  };
}

test('the level selector maps Lv 0–2, 3–4, and 5 to the three reorder tiers', () => {
  assert.equal(targetTierForLevel(0), 'foundation');
  assert.equal(targetTierForLevel(2), 'foundation');
  assert.equal(targetTierForLevel(3), 'standard');
  assert.equal(targetTierForLevel(4), 'standard');
  assert.equal(targetTierForLevel(5), 'precision');
  assert.equal(targetTierForLevel(undefined), 'foundation');
});

test('variant selection uses the target tier then the closest available fallback', () => {
  const input = { variants: { foundation: { tiles: [{}, {}] }, precision: { tiles: [{}, {}, {}, {}] } } };
  assert.equal(selectReorderVariant(input, 5).tier, 'precision');
  const selected = selectReorderVariant(input, 3);
  assert.equal(selected.tier, 'foundation');
  assert.equal(selected.usedFallback, true);
  assert.equal(selectReorderVariant({ variants: {} }, 3), null);
});

test('canonical tile spans reconstruct the exact sentence and accept the canonical order', () => {
  const sentence = 'I can help you.';
  const tiles = [
    { id: 'a', text: 'I', tokenStart: 0, tokenEnd: 1, separatorAfter: ' ' },
    { id: 'b', text: 'can help', tokenStart: 1, tokenEnd: 3, separatorAfter: ' ' },
    { id: 'c', text: 'you.', tokenStart: 3, tokenEnd: 4, separatorAfter: '' },
  ];
  const record = { tiles, canonicalOrder: ['a', 'b', 'c'], acceptedOrders: [['a', 'b', 'c']], canonicalReconstruction: sentence };
  assert.equal(reconstructCanonical(record), sentence);
  assert.equal(validateCanonicalVariant(record, sentence), true);
  assert.equal(validateCanonicalVariant(record, 'I can help you'), false);
  assert.equal(validateCanonicalVariant({ ...record, tiles: [tiles[0], tiles[0], tiles[2]] }, sentence), false);
  assert.equal(validateCanonicalVariant({ ...record, acceptedOrders: [['c', 'b', 'a']] }, sentence), false);
});

test('an accepted grammatical alternative counts as correct without changing the canonical text', () => {
  const source = variant(['I', 'can meet', 'you', 'on Friday']);
  source.acceptedOrders.push(['tile-0', 'tile-3', 'tile-1', 'tile-2']);
  const state = { ...createPuzzleState(source, { random: () => 0 }), bank: [], answer: ['tile-0', 'tile-3', 'tile-1', 'tile-2'] };
  assert.equal(answerIsComplete(state), true);
  assert.equal(answerIsCorrect(state), true);
});

test('shuffling uses tile IDs and cannot start in any accepted answer order', () => {
  const source = variant(['She', 'likes', 'tea']);
  const bank = createWrongShuffle(source.canonicalOrder, source.acceptedOrders, { random: () => 0 });
  assert.ok(bank);
  assert.notDeepEqual(bank, source.canonicalOrder);
  assert.equal(new Set(bank).size, 3);
  const state = createPuzzleState(source, { random: () => 0 });
  assert.ok(state);
  assert.equal(answerIsComplete(state), false);
  assert.equal(answerIsCorrect(state), false);
});

test('duplicate visible text remains distinct and movable by unique tile IDs', () => {
  const source = variant(['the dog', 'and', 'the dog']);
  const state = createPuzzleState(source, { random: () => 0.4 });
  assert.ok(state);
  assert.equal(new Set(source.tiles.map((tile) => tile.text)).size, 2);
  assert.equal(new Set(state.bank).size, 3);
  const moved = moveTile(state, 'tile-0', 'answer');
  assert.deepEqual(moved.answer, ['tile-0']);
  assert.equal(moved.bank.includes('tile-2'), true);
  assert.equal(createPuzzleState({ ...source, tiles: [source.tiles[0], source.tiles[0]] }), null);
});

test('tap moves, answer reorder, undo restoration, and reset retain state by ID', () => {
  const source = variant(['They', 'have', 'arrived']);
  const state = createPuzzleState(source, { random: () => 0.5 });
  let current = moveTile(state, 'tile-0', 'answer');
  current = moveTile(current, 'tile-2', 'answer');
  current = moveTile(current, 'tile-1', 'answer');
  assert.deepEqual(current.answer, ['tile-0', 'tile-2', 'tile-1']);
  current = reorderAnswerTile(current, 'tile-2', -1);
  assert.deepEqual(current.answer, ['tile-2', 'tile-0', 'tile-1']);
  const restored = restorePuzzle(current, state.bank);
  assert.deepEqual(restored.bank, state.bank);
  assert.deepEqual(restored.answer, []);
});

test('wrong answers remain in place for two retries and the third reveals an assisted completion', () => {
  const source = variant(['Birds', 'often sing']);
  let state = createPuzzleState(source, { random: () => 0 });
  state = { ...state, bank: [], answer: ['tile-1', 'tile-0'] };
  assert.equal(answerIsCorrect(state), false);
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.answer, ['tile-1', 'tile-0']);
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'playing');
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'revealed');
  const completed = markSentenceComplete(state, { assisted: true });
  assert.equal(completed.status, 'assisted');
});

test('a variant with no wrong permutation is non-playable', () => {
  const source = variant(['yes', 'or', 'no'], [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]);
  assert.equal(createWrongShuffle(source.canonicalOrder, source.acceptedOrders), null);
  assert.equal(createPuzzleState(source), null);
});
