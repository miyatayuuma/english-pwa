import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sharedLearningTexts } from '../scripts/reorder/sharedAuthority.js';

const corpus = JSON.parse(fs.readFileSync(new URL('../data/reorder-v1.json', import.meta.url)));
test('every shared partition retains learningText, including fixed contexts', () => {
  let sentences = 0;
  let fixed = 0;
  for (const item of corpus.items) {
    for (const sentence of item.sentences) {
      sentences++;
      if (sentence.fixedContext) fixed++;
      assert.deepEqual(sharedLearningTexts(item, sentence.sentenceIndex), [...new Set(sentence.partition.chunks.map(c => c.learningText))]);
    }
  }
  assert.equal(sentences, 804);
  assert.equal(fixed, 46);
});
test('whole item uses all partitions in source order with exact duplicates removed only', () => {
  for (const item of corpus.items) {
    assert.deepEqual(sharedLearningTexts(item), [...new Set(item.sentences.flatMap(s => s.partition.chunks.map(c => c.learningText)))]);
  }
  const item = { sentences: [{ sentenceIndex: 0, partition: { chunks: [
    { learningText: 'The cat' }, { learningText: 'the cat' }, { learningText: 'The cat' }, { learningText: 'the cat!' },
  ] } }] };
  assert.deepEqual(sharedLearningTexts(item), ['The cat', 'the cat', 'the cat!']);
});
test('missing stable authority fails explicitly rather than guessing from text', () => {
  assert.throws(() => sharedLearningTexts(null), /unavailable/);
  assert.throws(() => sharedLearningTexts(corpus.items[0], 9999), /unavailable/);
  assert.throws(() => sharedLearningTexts({ sentences: [{ partition: { chunks: [{ learningText: '' }] } }] }), /Empty/);
});
