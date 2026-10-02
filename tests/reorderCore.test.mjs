import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REORDER_SCHEMA_VERSION,
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
  sharedChunks,
  validateCanonicalPartition,
} from '../scripts/reorder/reorderCore.js';

function partition(texts, acceptedIndexOrders = []) {
  const chunks = texts.map((text, index) => ({
    id: `chunk-${index}`, text, tokenStart: index, tokenEnd: index + 1,
    separatorAfter: index + 1 < texts.length ? ' ' : '.',
  }));
  const canonicalOrder = chunks.map((chunk) => chunk.id);
  return {
    chunks, canonicalOrder,
    acceptedOrders: [canonicalOrder, ...acceptedIndexOrders.map((order) => order.map((index) => `chunk-${index}`))],
    canonicalReconstruction: `${texts.join(' ')}.`,
  };
}

test('reordering schema exposes one level-invariant shared partition', () => {
  assert.equal(REORDER_SCHEMA_VERSION, 2);
  const source = partition(['I', 'can help', 'you']);
  assert.deepEqual(sharedChunks(source).map((chunk) => chunk.text), ['I', 'can help', 'you']);
  assert.notEqual(sharedChunks(source)[0], source.chunks[0]);
});

test('canonical chunk spans reconstruct the exact sentence and accept the canonical order', () => {
  const sentence = 'I can help you.';
  const chunks = [
    { id: 'a', text: 'I', tokenStart: 0, tokenEnd: 1, separatorAfter: ' ' },
    { id: 'b', text: 'can help', tokenStart: 1, tokenEnd: 3, separatorAfter: ' ' },
    { id: 'c', text: 'you.', tokenStart: 3, tokenEnd: 4, separatorAfter: '' },
  ];
  const record = { chunks, canonicalOrder: ['a', 'b', 'c'], acceptedOrders: [['a', 'b', 'c']], canonicalReconstruction: sentence };
  assert.equal(reconstructCanonical(record), sentence);
  assert.equal(validateCanonicalPartition(record, sentence), true);
  assert.equal(validateCanonicalPartition(record, 'I can help you'), false);
  assert.equal(validateCanonicalPartition({ ...record, chunks: [chunks[0], chunks[0], chunks[2]] }, sentence), false);
  assert.equal(validateCanonicalPartition({ ...record, acceptedOrders: [['c', 'b', 'a']] }, sentence), false);
});

test('an accepted grammatical alternative counts as correct without changing canonical text', () => {
  const source = partition(['I', 'can meet', 'you', 'on Friday']);
  source.acceptedOrders.push(['chunk-0', 'chunk-3', 'chunk-1', 'chunk-2']);
  const state = { ...createPuzzleState(source, { random: () => 0 }), bank: [], answer: ['chunk-0', 'chunk-3', 'chunk-1', 'chunk-2'] };
  assert.equal(answerIsComplete(state), true);
  assert.equal(answerIsCorrect(state), true);
});

test('shuffling uses chunk IDs and cannot start in any accepted answer order', () => {
  const source = partition(['She', 'likes', 'tea']);
  const bank = createWrongShuffle(source.canonicalOrder, source.acceptedOrders, { random: () => 0 });
  assert.ok(bank);
  assert.notDeepEqual(bank, source.canonicalOrder);
  assert.equal(new Set(bank).size, 3);
  const state = createPuzzleState(source, { random: () => 0 });
  assert.ok(state);
  assert.equal(answerIsComplete(state), false);
  assert.equal(answerIsCorrect(state), false);
});

test('duplicate visible text remains distinct and movable by unique chunk IDs', () => {
  const source = partition(['the dog', 'and', 'the dog']);
  const state = createPuzzleState(source, { random: () => 0.4 });
  assert.ok(state);
  assert.equal(new Set(source.chunks.map((chunk) => chunk.text)).size, 2);
  assert.equal(new Set(state.bank).size, 3);
  const moved = moveTile(state, 'chunk-0', 'answer');
  assert.deepEqual(moved.answer, ['chunk-0']);
  assert.equal(moved.bank.includes('chunk-2'), true);
  assert.equal(createPuzzleState({ ...source, chunks: [source.chunks[0], source.chunks[0]] }), null);
});

test('tap moves, answer reorder, undo restoration, and reset retain state by ID', () => {
  const source = partition(['They', 'have arrived', 'home']);
  const state = createPuzzleState(source, { random: () => 0.5 });
  let current = moveTile(state, 'chunk-0', 'answer');
  current = moveTile(current, 'chunk-2', 'answer');
  current = moveTile(current, 'chunk-1', 'answer');
  assert.deepEqual(current.answer, ['chunk-0', 'chunk-2', 'chunk-1']);
  current = reorderAnswerTile(current, 'chunk-2', -1);
  assert.deepEqual(current.answer, ['chunk-2', 'chunk-0', 'chunk-1']);
  const restored = restorePuzzle(current, state.bank);
  assert.deepEqual(restored.bank, state.bank);
  assert.deepEqual(restored.answer, []);
});

test('wrong answers remain in place for two retries and the third reveals assisted completion', () => {
  const source = partition(['Birds', 'often sing']);
  let state = createPuzzleState(source, { random: () => 0 });
  state = { ...state, bank: [], answer: ['chunk-1', 'chunk-0'] };
  assert.equal(answerIsCorrect(state), false);
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.answer, ['chunk-1', 'chunk-0']);
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'playing');
  state = recordWrongAttempt(state);
  assert.equal(state.status, 'revealed');
  const completed = markSentenceComplete(state, { assisted: true });
  assert.equal(completed.status, 'assisted');
});

test('a partition with no wrong permutation is non-playable', () => {
  const source = partition(['yes', 'or', 'no'], [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]);
  assert.equal(createPuzzleState(source), null);
});
