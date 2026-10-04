import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateVocabularyV3 } from '../scripts/vocabulary/validate-vocabulary-v3.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));

test('the paraphrase audit preserves historical review, explicitly marks pending entries and mirrors curated data',()=>{
  const db=read('vocabulary-v3.json');
  const items=read('items.json');
  const characters=read('characters.json').characters;
  const migration=read('vocabulary-v2-v3-migration.json');
  const v2=read('vocabulary-v2.json');
  const wordAudit=read('vocabulary-v3-word-audit.json');
  const audit=read('vocabulary-v3-paraphrase-audit.json');
  const result=validateVocabularyV3(db,items,characters,migration,v2,wordAudit,audit);
  assert.deepEqual(result.errors,[]);
  assert.equal(audit.historical_reviewed_entries.length,1072);
  assert.equal(audit.reviewed_entries.length,1045);
  assert.equal(audit.pending_entries.length,1433);
  assert.equal(audit.retired_entries.length,2);
  assert.equal(result.report.answer_authority.source_realizations_audited,2481);
  assert.equal(result.report.answer_authority.entries_with_paraphrases,35);
  assert.equal(result.report.answer_authority.total_paraphrases,35);
  assert.equal(result.report.cloze_generation_audit.cards_audited,560*3*6);
  assert.equal(result.report.cloze_generation_audit.zero_target_cards,0);
  assert.deepEqual(result.report.cloze_generation_audit.zero_target_items,{level_0:0,level_2:0,level_5:0});
  assert.ok(result.report.cloze_generation_audit.fallback_due_budget_rejection.cards>0);
});
