import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),'utf8'));
const DIR='data/audits/vocabulary-single-entry-nuance-materialization';

test('551 final single-entry audit decisions are exactly materialized and reconciled',()=>{
  const authority=read(`${DIR}/authority.json`);
  const materialization=read(`${DIR}/materialization.json`);
  const summary=read(`${DIR}/summary.json`);
  const reconciliation=read(`${DIR}/reconciliation.json`);
  const db=read('data/vocabulary-v3.json');
  const paraphraseAudit=read('data/vocabulary-v3-paraphrase-audit.json');
  const byId=new Map(db.entries.map(entry=>[entry.id,entry]));
  const authorityById=new Map(authority.entries.map(row=>[row.id,row]));
  const records=materialization.entries;

  assert.equal(authority.source_audit_commit,'ab1238bf126196aef01aef636db70e53fac34ad1');
  assert.equal(authority.source_audit_branch,'audit/vocabulary-single-entry-nuance-qualifier');
  assert.equal(authority.source_candidate_count,551);
  assert.equal(authority.entries.length,551);
  assert.deepEqual(Object.fromEntries(['QUALIFIER_ONLY','QUALIFIER_AND_PARAPHRASE','PARAPHRASE_REVALIDATION_ONLY'].map(decision=>[
    decision,authority.entries.filter(row=>row.decision===decision).length,
  ])),{
    QUALIFIER_ONLY:56,
    QUALIFIER_AND_PARAPHRASE:296,
    PARAPHRASE_REVALIDATION_ONLY:199,
  });
  assert.equal(authorityById.size,551);
  assert.equal(authorityById.has('vocab:00947'),false,'retired toil stays outside remediation');
  assert.equal(db.entries.length,2478);

  assert.equal(materialization.status,'MATERIALIZED');
  assert.equal(materialization.state_before,'PRE');
  assert.equal(materialization.state_after,'POST');
  assert.equal(materialization.accounting.total,551);
  assert.equal(materialization.accounting.APPLY,551);
  assert.equal(materialization.accounting.ALREADY_MATCHED,0);
  assert.equal(materialization.accounting.BLOCKED_DRIFT,0);
  assert.equal(records.length,551);
  assert.equal(new Set(records.map(row=>row.id)).size,551);
  assert.deepEqual(records.map(row=>row.id),authority.entries.map(row=>row.id));

  for(const record of records){
    const audited=authorityById.get(record.id);
    const production=byId.get(record.id);
    assert.ok(production,`${record.id} remains in production population`);
    assert.equal(record.status,'APPLY',record.id);
    assert.deepEqual(record.audit_before,audited.before,`${record.id} audit before authority`);
    assert.deepEqual(record.audit_after,audited.after,`${record.id} audit after authority`);
    assert.deepEqual(record.before,audited.before,`${record.id} effective pre-layer state`);
    assert.deepEqual(record.after,audited.after,`${record.id} exact final state`);
    assert.equal(record.after.meaning_ja,record.decision==='PARAPHRASE_REVALIDATION_ONLY'
      ?record.before.meaning_ja
      :audited.recommended_prompt,`${record.id} prompt authority`);
    assert.deepEqual(record.after.paraphrases,audited.recommended_paraphrases,`${record.id} final paraphrase set`);
    assert.equal(record.after.canonical,record.before.canonical,`${record.id} canonical unchanged`);
    assert.equal(record.after.sense_key,record.before.sense_key,`${record.id} sense_key unchanged`);
    assert.equal(record.after.grammarRole,record.before.grammarRole,`${record.id} grammarRole unchanged`);
    assert.deepEqual(record.after.answers,record.before.answers,`${record.id} answers unchanged`);
    const appliedFields=[];
    if(record.before.meaning_ja!==record.after.meaning_ja) appliedFields.push('meaning_ja');
    if(JSON.stringify(record.before.paraphrases)!==JSON.stringify(record.after.paraphrases)) appliedFields.push('paraphrases');
    assert.deepEqual(record.applied_fields,appliedFields,`${record.id} allowed field accounting`);
    assert.equal(production.meaning_ja,record.after.meaning_ja,`${record.id} production prompt`);
    assert.deepEqual(production.paraphrases||[],record.after.paraphrases,`${record.id} production paraphrases`);
    assert.equal(production.canonical,record.before.canonical,`${record.id} production canonical`);
    assert.equal(production.sense_key,record.before.sense_key,`${record.id} production sense`);
    assert.equal(production.grammarRole,record.before.grammarRole,`${record.id} production grammar role`);
    assert.deepEqual(production.answers||[],record.before.answers,`${record.id} production answers`);
    if(record.after.paraphrases.length===0) assert.equal(Object.hasOwn(production,'paraphrases'),false,`${record.id} omits empty paraphrases`);
  }

  assert.equal(summary.authority_count,551);
  assert.equal(summary.APPLY+summary.ALREADY_MATCHED+summary.BLOCKED_DRIFT,551);
  assert.equal(summary.BLOCKED_DRIFT,0);
  assert.equal(summary.production_population,2478);
  assert.equal(summary.unchanged_non_target_entries,1927);
  assert.equal(summary.learning_eligible_population,2477);
  assert.deepEqual(summary.audit_wide_expected_changes,{qualifier_additions:353,paraphrase_removals:671,paraphrase_additions:8});
  assert.equal(reconciliation.vocabulary_non_target_projection_before_sha256,reconciliation.vocabulary_non_target_projection_after_sha256);
  assert.equal(reconciliation.vocabulary_allowed_field_projection_before_sha256,reconciliation.vocabulary_allowed_field_projection_after_sha256);
  assert.equal(reconciliation.id_order_sha256_before,reconciliation.id_order_sha256_after);
  assert.equal(reconciliation.production_population_before,2478);
  assert.equal(reconciliation.production_population_after,2478);
  assert.deepEqual(reconciliation.kind_counts_before,reconciliation.kind_counts_after);
  assert.deepEqual(reconciliation.grammar_role_distribution_before,reconciliation.grammar_role_distribution_after);
  assert.deepEqual(reconciliation.learning_exclusion_ids,['vocab:00947']);
  assert.equal(reconciliation.learning_eligible_population_after,2477);

  const curated=new Map(paraphraseAudit.curated_paraphrases.map(row=>[row.entry_id,row.paraphrases]));
  for(const entry of db.entries){
    const actual=entry.paraphrases||[];
    if(actual.length) assert.deepEqual(curated.get(entry.id),actual,`${entry.id} paraphrase mirror`);
    else assert.equal(curated.has(entry.id),false,`${entry.id} empty paraphrase mirror omission`);
  }
  assert.equal(paraphraseAudit.pending_entries.length,0);
});
