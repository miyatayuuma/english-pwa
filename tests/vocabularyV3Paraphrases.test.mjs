import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateVocabularyV3 } from '../scripts/vocabulary/validate-vocabulary-v3.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));

test('the committed paraphrase audit reviews every v3 entry and exactly mirrors curated data',()=>{
  const db=read('vocabulary-v3.json');
  const items=read('items.json');
  const characters=read('characters.json').characters;
  const migration=read('vocabulary-v2-v3-migration.json');
  const v2=read('vocabulary-v2.json');
  const wordAudit=read('vocabulary-v3-word-audit.json');
  const audit=read('vocabulary-v3-paraphrase-audit.json');
  const result=validateVocabularyV3(db,items,characters,migration,v2,wordAudit,audit);
  const entriesWithParaphrases=db.entries.filter(entry=>Array.isArray(entry.paraphrases)&&entry.paraphrases.length).length;
  const totalParaphrases=db.entries.reduce((count,entry)=>count+(Array.isArray(entry.paraphrases)?entry.paraphrases.length:0),0);
  const sourceRealizations=db.entries.reduce((count,entry)=>count+(Array.isArray(entry.occurrences)?entry.occurrences.length:0),0);

  assert.deepEqual(result.errors,[]);
  assert.equal(audit.reviewed_entries.length,db.entries.length);
  assert.equal(result.report.answer_authority.source_realizations_audited,sourceRealizations);
  assert.equal(result.report.answer_authority.entries_with_paraphrases,entriesWithParaphrases);
  assert.equal(result.report.answer_authority.total_paraphrases,totalParaphrases);
  assert.equal(result.report.cloze_generation_audit.cards_audited,items.length*3*6);
  assert.equal(result.report.cloze_generation_audit.zero_target_cards,0);
  assert.deepEqual(result.report.cloze_generation_audit.zero_target_items,{level_0:0,level_2:0,level_5:0});
  assert.ok(result.report.cloze_generation_audit.fallback_due_budget_rejection.cards>0);
});
