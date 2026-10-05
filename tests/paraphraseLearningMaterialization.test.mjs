import test from 'node:test';
import assert from 'node:assert/strict';
import {buildParaphraseFinalization} from '../scripts/vocabulary/materialize-paraphrase-learning-audit.mjs';

const CLAIM_BASE='a'.repeat(40),CLAIM_COMMIT='b'.repeat(40),MAIN='c'.repeat(40);

function fixture(){
  const vocabulary={schema_version:1,entries:[
    {id:'vocab:00001',kind:'word',canonical:'take off',sense_key:'depart',pos:'verb',meaning_ja:'出発する',answers:['remove'],paraphrases:['legacy form','retired form'],occurrences:[{item_id:'x',start:0,end:4}]},
    {id:'vocab:00002',kind:'expression',canonical:'bright',sense_key:'bright',pos:'adjective',meaning_ja:'明るい',answers:[],occurrences:[{item_id:'y',start:0,end:6}]},
  ]};
  const paraphraseAudit={
    schema_version:1,baseline_main:'d'.repeat(40),review_scope:{entry_count:2,kind_counts:{word:1,expression:1,construction:0}},
    reviewed_entries:[],curated_paraphrases:[],
    answers_review:{entries_reviewed:1,source_entries:[{entry_id:'vocab:00001',original_answers:['remove']}],reclassified:[]},
    representative_accepted:[{entry_id:'vocab:00001',paraphrase:'legacy form',reason:'existing'}],
    representative_rejected:[{left:'near',right:'far',reason:'existing'}],
    historical_review_scope:{entry_count:2,kind_counts:{word:1,expression:1,construction:0}},
    historical_reviewed_entries:[{entry_id:'vocab:00001'}],pending_entries:[{entry_id:'vocab:00002',reason:'old'}],retired_entries:[],
  };
  const results=[
    {entry_id:'vocab:00001',prompt_ja:'出発する',canonical_snapshot:'take off',answers_snapshot:['remove'],existing_paraphrases:['legacy form','retired form'],after_paraphrases:['legacy form','depart','leave a place']},
    {entry_id:'vocab:00002',prompt_ja:'明るい',canonical_snapshot:'bright',answers_snapshot:[],existing_paraphrases:[],after_paraphrases:[]},
  ];
  const manifest={schema_version:1,policy_version:'prompt-learning-value-v1',population:2,batch_count:1,batches:[
    {batch:1,key:'batch-001',ordinal_start:1,ordinal_end:2,entry_count:2,artifact_path:'data/audits/vocabulary-v3-paraphrase-learning/batch-001.json',entry_ids:['vocab:00001','vocab:00002']},
  ]};
  const artifact={schema_version:1,policy_version:'prompt-learning-value-v1',batch:1,ordinal_start:1,ordinal_end:2,reviewed_count:2,entry_ids:['vocab:00001','vocab:00002'],results};
  return {
    vocabulary,paraphraseAudit,manifest,manifestRaw:JSON.stringify(manifest),batches:[{artifact,raw:JSON.stringify(artifact)}],
    claimBaseMain:CLAIM_BASE,lastReconciledMain:MAIN,claimCommit:CLAIM_COMMIT,expectedPopulation:2,expectedBatchCount:1,
  };
}
function build(overrides={}){return buildParaphraseFinalization({...fixture(),...overrides});}

test('materializes exact paraphrase strings and order; deletes the empty property',()=>{
  const input=fixture();
  input.batches[0].artifact.results[0].after_paraphrases=['second form','first form'];
  const result=build(input);
  assert.equal(result.state,'PRE');
  assert.deepEqual(result.nextVocabulary.entries[0].paraphrases,['second form','first form']);
  assert.equal(Object.hasOwn(result.nextVocabulary.entries[1],'paraphrases'),false);
});

test('leaves the full non-paraphrase production projection unchanged',()=>{
  const input=fixture(),before=structuredClone(input.vocabulary);
  const result=build(input);
  const strip=value=>{for(const entry of value.entries)delete entry.paraphrases;return value;};
  assert.deepEqual(strip(result.nextVocabulary),strip(before));
});

test('reconstructs reviewed and curated audit fields while preserving all other fields',()=>{
  const input=fixture(),result=build(input);
  assert.deepEqual(result.nextParaphraseAudit.reviewed_entries,[
    {entry_id:'vocab:00001',decision:'curated'},
    {entry_id:'vocab:00002',decision:'reviewed_no_major_paraphrase'},
  ]);
  assert.deepEqual(result.nextParaphraseAudit.curated_paraphrases,[
    {entry_id:'vocab:00001',paraphrases:['legacy form','depart','leave a place']},
  ]);
  assert.deepEqual(result.nextParaphraseAudit.pending_entries,[]);
  const keys=['schema_version','baseline_main','answers_review','representative_accepted','representative_rejected','historical_review_scope','historical_reviewed_entries','retired_entries'];
  for(const key of keys) assert.deepEqual(result.nextParaphraseAudit[key],input.paraphraseAudit[key],key);
});

test('detects PRE and POST; POST builder is idempotent',()=>{
  const input=fixture(),pre=build(input);
  assert.equal(pre.state,'PRE');
  input.vocabulary=structuredClone(pre.nextVocabulary);
  const post=build(input);
  assert.equal(post.state,'POST');
  assert.deepEqual(post.nextVocabulary,input.vocabulary);
  assert.deepEqual(post.nextParaphraseAudit,pre.nextParaphraseAudit);
});

test('rejects a MIXED production state',()=>{
  const input=fixture();input.vocabulary.entries[0].paraphrases=['external edit'];
  assert.throws(()=>build(input),/MIXED state/);
});

test('rejects semantic snapshot drift',()=>{
  const input=fixture();input.batches[0].artifact.results[0].prompt_ja='別の意味';
  assert.throws(()=>build(input),/semantic snapshot drift/);
});

test('rejects duplicate result IDs',()=>{
  const input=fixture();input.batches[0].artifact.results.push(structuredClone(input.batches[0].artifact.results[0]));
  assert.throws(()=>build(input),/duplicate result ID/);
});

test('rejects unknown result IDs',()=>{
  const input=fixture();input.batches[0].artifact.results[1].entry_id='vocab:99999';
  assert.throws(()=>build(input),/unexpected result ID|unknown production ID/);
});

test('rejects missing result IDs',()=>{
  const input=fixture();input.batches[0].artifact.results.pop();
  assert.throws(()=>build(input),/result count mismatch|missing result/);
});

test('rejects normalized duplicates and canonical/answers overlaps',()=>{
  const duplicate=fixture();duplicate.batches[0].artifact.results[0].after_paraphrases=['depart','DEPART'];
  assert.throws(()=>build(duplicate),/normalized paraphrase duplicate/);
  const overlap=fixture();overlap.batches[0].artifact.results[0].after_paraphrases=['REMOVE'];
  assert.throws(()=>build(overlap),/overlaps canonical\/answers/);
});

test('derives exact-string reconciliation counts from batch authority',()=>{
  const result=build();
  assert.deepEqual(result.summary,{
    schema_version:1,policy_version:'prompt-learning-value-v1',population:2,batch_count:1,reviewed_entries:2,pending_entries:0,
    entries_with_zero_paraphrases:1,entries_with_paraphrases:1,total_final_paraphrase_strings:3,
    previous_paraphrase_strings:2,kept_existing_strings:1,removed_existing_strings:1,newly_added_strings:2,
    changed_entries:1,unchanged_entries:1,semantic_drift_count:0,non_paraphrase_mutation_count:0,
  });
  assert.equal(result.reconciliation.coverage.entry_count,2);
  assert.equal(result.reconciliation.fingerprints.production_non_paraphrase_before_sha256,result.reconciliation.fingerprints.production_non_paraphrase_after_sha256);
  assert.equal(result.reconciliation.fingerprints.preserved_global_audit_before_sha256,result.reconciliation.fingerprints.preserved_global_audit_after_sha256);
});
