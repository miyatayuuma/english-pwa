import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAMMAR_ROLES, loadVocabularyGrammarRoleAudit } from '../scripts/vocabulary/validate-vocabulary-grammar-role.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),'utf8'));
const auditDir='data/audits/vocabulary-grammar-role';

test('grammar-role audit covers the complete Vocabulary population exactly once',()=>{
  const result=loadVocabularyGrammarRoleAudit();
  assert.equal(result.ok,true,result.errors.join('\n'));
  assert.equal(result.population,2478);
  assert.equal(result.audited,2478);
  assert.equal(result.classified+result.pending,result.population);
});

test('all final entries use one of the 11 roles and all former pending decisions remain auditable',()=>{
  const batches=fs.readdirSync(path.join(ROOT,auditDir)).filter(name=>/^batch-\d{3}\.json$/.test(name));
  const rows=batches.flatMap(name=>readJson(`${auditDir}/${name}`).entries);
  const allowed=new Set(GRAMMAR_ROLES);
  assert.ok(rows.every(row=>row.status==='classified'),`remaining pending: ${rows.filter(row=>row.status!=='classified').map(row=>row.id).join(', ')}`);
  for(const row of rows) assert.ok(allowed.has(row.grammarRole),`${row.id}: ${row.grammarRole}`);
  const registry=readJson(`${auditDir}/pending.json`);
  assert.equal(registry.pending_count,0);
  assert.deepEqual(registry.entries,[]);
  const history=readJson(`${auditDir}/pending-history.json`);
  const resolutions=readJson(`${auditDir}/final-resolutions.json`);
  assert.equal(history.pending_count,152);
  assert.equal(history.entries.length,152);
  assert.equal(resolutions.resolved_pending_count,152);
  assert.equal(resolutions.entries.length,152);
  assert.equal(new Set(resolutions.entries.map(row=>row.id)).size,152);
  for(const decision of resolutions.entries){
    const current=rows.find(row=>row.id===decision.id);
    assert.ok(current,`${decision.id} is present in the batches`);
    assert.equal(current.grammarRole,decision.grammarRole,decision.id);
    assert.equal(current.status,'classified',decision.id);
  }
});

test('representative semantic classifications include multiword roles and use-level POS changes',()=>{
  const db=readJson('data/vocabulary-v3.json');
  const byId=new Map(db.entries.map(entry=>[entry.id,entry]));
  const expected={
    'vocab:00009':'noun','vocab:00042':'pronoun','vocab:00001':'verb',
    'vocab:01278':'adjective','vocab:01404':'adverb','vocab:00182':'preposition',
    'vocab:01928':'conjunction','vocab:02204':'auxiliary','vocab:02457':'determiner',
    'vocab:02426':'interjection','vocab:01191':'construction','vocab:00230':'verb',
  };
  for(const [id,role] of Object.entries(expected)) assert.equal(byId.get(id)?.grammarRole,role,id);
  assert.equal(byId.get('vocab:00977')?.grammarRole,'verb');
  assert.equal(byId.get('vocab:01006')?.grammarRole,'noun');
  assert.equal(byId.get('vocab:01092')?.grammarRole,'noun');
  assert.equal(byId.get('vocab:01247')?.grammarRole,'verb');
  assert.equal(byId.get('vocab:00313')?.grammarRole,'construction');
  assert.equal(byId.get('vocab:01289')?.grammarRole,'construction');
  assert.equal(byId.get('vocab:00520')?.grammarRole,'conjunction');
  assert.equal(byId.get('vocab:00622')?.grammarRole,'conjunction');
  assert.equal(byId.get('vocab:02243')?.grammarRole,'pronoun');
  assert.equal(byId.get('vocab:00666')?.grammarRole,'interjection');
  assert.equal(byId.get('vocab:01606')?.meaning_ja,'呪い');
  assert.equal(byId.get('vocab:01606')?.grammarRole,'noun');
  assert.equal(byId.get('vocab:02134')?.meaning_ja,'（君主の）治世');
  assert.equal(byId.get('vocab:02134')?.grammarRole,'noun');
  assert.deepEqual(byId.get('vocab:02134')?.paraphrases,['rule']);
});

test('Vocabulary card labels do not use kind as the learner-facing grammar tag',()=>{
  const source=fs.readFileSync(path.join(ROOT,'scripts/app/vocabularyMode.js'),'utf8');
  assert.match(source,/GRAMMAR_ROLE_LABELS\[state\.current\.grammarRole\]/);
  assert.doesNotMatch(source,/kindLabel=state\.current\.kind/);
  assert.match(source,/grammarRoleLabel\?/);
});
