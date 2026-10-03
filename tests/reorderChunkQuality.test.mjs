import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateMetadata, expectedLearning } from '../scripts/reorder/validate-reorder-metadata.mjs';
const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const metadata = read('data/reorder-v1.json');
const gold = read('data/reorder-gold.json');
const items = read('data/items.json');
const report = read('data/reorder-report.json');
const byKey = new Map(metadata.items.flatMap(i => i.sentences.map(s => [`${i.itemId}/${s.sentenceIndex}`, s])));

test('single shared authority covers the entire current corpus and all consumer invariants', () => {
  assert.equal(items.length, 560);
  assert.equal(byKey.size, 804);
  assert.deepEqual(validateMetadata(items, metadata), []);
  assert.equal(report.sharedPartitionCount, 804);
  assert.equal(report.maxTileCount, 13);
  assert.equal(report.tileCount14Plus, 0);
  assert.doesNotMatch(JSON.stringify(metadata), /"(?:variants|tierRules|foundation|standard|precision)":/);
});

test('126 human reviewed cases and all 79 repairs retain explained policy quality', () => {
  assert.equal(gold.reviewedSample.length, 126);
  assert.equal(gold.humanRepairs.length, 79);
  for (const r of [...gold.reviewedSample, ...gold.humanRepairs]) {
    const s = byKey.get(`${r.itemId}/${r.sentenceIndex}`);
    assert.equal(s.sourceText, r.sourceText);
    assert.deepEqual(s.partition.chunks.map(c => c.learningText), r.expectedLearningChunks, `${r.itemId}/${r.sentenceIndex}`);
    assert.ok(r.assessment);
  }
  assert.equal(gold.overrideMigration.length, 18);
  assert.equal(gold.overrideMigration.filter(r=>r.disposition==='KEEP').length, 8);
  assert.equal(gold.overrideMigration.filter(r=>r.disposition==='MIGRATE').length, 2);
  assert.equal(gold.overrideMigration.filter(r=>r.disposition==='OBSOLETE').length, 8);
  assert.equal(gold.humanRepairs.filter(r=>r.category==='D').length, 8);
});

test('recursive clauses and productive PP complements remain decomposed without giant lexical hints', () => {
  for (const s of byKey.values()) {
    for (const c of s.partition.chunks) assert.ok(c.learningText.split(/\s+/u).length <= 7, c.learningText);
    for (const cl of s.syntax.clauses) {
      const members=s.tokens.filter(t=>cl.tokenRanges.some(([a,b])=>a<=t.i&&t.i<b));
      if (members.filter(t=>!t.isPunct).length <= 7) continue;
      assert.ok(s.partition.chunks.filter(c=>cl.tokenRanges.some(([a,b])=>a<c.tokenEnd&&b>c.tokenStart)).length>1, s.sourceText);
    }
  }
});

test('structural punctuation is removed while internal marks and capitalization are retained', () => {
  const source=`"No," he said, "I don't know." John's O'Brien well-known U.S. Ms. 22.68 1,000 5:00 $100 10% his/her!`;
  assert.equal(expectedLearning(source,0,source.length), `No he said I don't know John's O'Brien well-known U.S. Ms. 22.68 1,000 5:00 $100 10% his/her`);
  assert.equal(expectedLearning("An 'instrument' is useful.",0,26),'An instrument is useful');
  assert.equal(expectedLearning("the hearts' wishes",0,18),"the hearts' wishes");
  const unicode="𝒜 — α-β O’Brien";
  assert.equal(expectedLearning(unicode,0,unicode.length),"𝒜 α-β O’Brien");
});
