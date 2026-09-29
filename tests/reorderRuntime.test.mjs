import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the full item remains the ASR reference, and ASR cannot decide tile order', async () => {
  const [main, recognition, reorderGuide] = await Promise.all([
    read('scripts/app/main.js'),
    read('scripts/speech/recognition.js'),
    read('scripts/app/reorderGuide.js'),
  ]);
  assert.match(main, /getReferenceText:\s*\(\)=>\{\s*const refItem=QUEUE\[idx\];\s*return refItem \? refItem\.en : el\.en\.textContent;/);
  assert.match(main, /getComposeNodes:\s*\(\)=>composeGuide\.getNodes\(\)/);
  assert.match(reorderGuide, /getNodes:\s*\(\)\s*=>\s*\[\]/);
  assert.doesNotMatch(recognition, /answerIsCorrect|acceptedOrders|reorder-v1/);
  assert.match(main, /calcMatchScore\(info\.refCount, info\.recall, info\.precision\)/);
});

test('speech capture stays locked until every sortable sentence and fixed context stage finishes', async () => {
  const [main, reorderGuide] = await Promise.all([
    read('scripts/app/main.js'),
    read('scripts/app/reorderGuide.js'),
  ]);
  assert.match(main, /if\(composeGuide\.isAwaitingReorder\(\)\)\{\s*setFooterMessages\('先に文の語順を完成してください。'/);
  assert.match(reorderGuide, /puzzleIndex >= puzzleRows\.length/);
  assert.match(reorderGuide, /fullUtteranceText/);
  assert.match(reorderGuide, /onComplete\(\{ assisted: puzzleRows\.some\(\(entry\) => entry\.assisted\) \}\)/);
  assert.match(main, /el\.en\.innerHTML=currentEnHtml/);
});

test('runtime no longer reads legacy item.chunks or emits word-count chunking', async () => {
  const [main, reorderGuide, version, worker] = await Promise.all([
    read('scripts/app/main.js'),
    read('scripts/app/reorderGuide.js'),
    read('scripts/version.js'),
    read('sw.js'),
  ]);
  for (const source of [main, reorderGuide, version, worker]) {
    assert.doesNotMatch(source, /\.chunks\b|chunks_json|wordsPerChunk|compactComposeChunks/);
  }
});
