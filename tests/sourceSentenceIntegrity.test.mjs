import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceSentenceIntegrity } from '../scripts/vocabulary/validate-source-sentence-integrity.mjs';

const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const db=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8'));

test('all 560 source sentences and vocabulary occurrence spans are internally consistent',()=>{
  const {errors,report}=validateSourceSentenceIntegrity(items,db);
  assert.deepEqual(errors,[]);
  assert.equal(report.reviewed_sources,560);
  assert.equal(report.repaired_source_items,12);
  assert.equal(report.repaired_occurrences_checked,5);
  assert.equal(report.out_of_range,0);
  assert.equal(report.empty_span,0);
  assert.equal(report.broken_target_surface,0);
  assert.equal(report.stale_offsets_after_source_repair,0);
});
