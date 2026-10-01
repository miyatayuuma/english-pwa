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

test('Reordering guards speech and uses dedicated completion', async () => {
  const [main, guide] = await Promise.all([read('scripts/app/main.js'), read('scripts/app/reorderGuide.js')]);
  assert.match(main, /async function startRec\(\)\{\s*if\(isComposeMode\(\)\) return;/);
  assert.match(main, /async function stopRec\(result\)\{\s*if\(isComposeMode\(\)\) return;/);
  assert.match(main, /updateReorderLevelInfo\(currentItem.id, result\)/);
  assert.match(guide, /onComplete\(result\)/);
  assert.doesNotMatch(guide, /全文を発話|全文発話へ|clauseScaffold/);
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
