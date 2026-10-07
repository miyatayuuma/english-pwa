import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateVocabularyV3 } from '../scripts/vocabulary/validate-vocabulary-v3.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));

test('the paraphrase audit preserves history and mirrors fully materialized curated authority',()=>{
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
  assert.equal(audit.reviewed_entries.length,2478);
  assert.equal(audit.pending_entries.length,0);
  assert.equal(audit.retired_entries.length,2);
  assert.equal(result.report.answer_authority.source_realizations_audited,2481);
  assert.equal(result.report.answer_authority.entries_with_paraphrases,1834);
  assert.equal(result.report.answer_authority.total_paraphrases,2918);
  assert.deepEqual(db.entries.find(entry=>entry.id==='vocab:00121').paraphrases,['in spite of something']);
  assert.deepEqual(db.entries.find(entry=>entry.id==='vocab:00182').paraphrases,['despite something','notwithstanding something']);
  assert.equal(db.entries.find(entry=>entry.id==='vocab:00182').paraphrases.includes('despite'),false);
  assert.equal(result.report.cloze_generation_audit.cards_audited,560*3*6);
  assert.equal(result.report.cloze_generation_audit.zero_target_cards,0);
  assert.deepEqual(result.report.cloze_generation_audit.zero_target_items,{level_0:0,level_2:0,level_5:0});
  assert.ok(result.report.cloze_generation_audit.fallback_due_budget_rejection.cards>0);
});
