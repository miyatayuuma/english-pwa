import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {normalizeVocabularyAnswer} from '../app/vocabularyLearningCore.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const AUDIT_DIR='data/audits/vocabulary-v3-paraphrase-learning';
const POLICY='prompt-learning-value-v1';
const POPULATION=2478;
const BATCH_COUNT=25;
const AUDIT_FIELDS=new Set(['review_scope','reviewed_entries','curated_paraphrases','pending_entries']);
const SHA=/^[0-9a-f]{40}$/;

const jsonClone=value=>JSON.parse(JSON.stringify(value));
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonicalHash=value=>sha256(JSON.stringify(value));
const array=value=>Array.isArray(value)?value:[];
const idsOf=entries=>entries.map(entry=>String(entry?.id??''));
const eq=(left,right)=>isDeepStrictEqual(left,right);

function isNaturalAnswer(value){
  return typeof value==='string'&&!!value.trim()&&!/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|[A-Za-z]\s*\/\s*[A-Za-z]|\(\d+\)|^\s*\d+[.)]|\.{2,}/.test(value);
}

function stripParaphrases(vocabulary){
  const projection=jsonClone(vocabulary);
  const entries=Array.isArray(projection)?projection:projection?.entries;
  if(!Array.isArray(entries)) throw new Error('Vocabulary root must be an array or an object with entries[]');
  for(const entry of entries) delete entry.paraphrases;
  return projection;
}

function preservedAuditProjection(audit){
  const projection=jsonClone(audit);
  for(const key of AUDIT_FIELDS) delete projection[key];
  return projection;
}

function pushError(errors,message){errors.push(message);}

function validateInputs({vocabulary,paraphraseAudit,manifest,batches,expectedPopulation,expectedBatchCount}){
  const errors=[];
  const entries=Array.isArray(vocabulary)?vocabulary:vocabulary?.entries;
  if(!Array.isArray(entries)) throw new Error('Vocabulary root must be an array or an object with entries[]');
  if(!Array.isArray(batches)) throw new Error('batches must be an array');
  if(manifest?.schema_version!==1) pushError(errors,'manifest schema_version must be 1');
  if(manifest?.policy_version!==POLICY) pushError(errors,'manifest policy_version mismatch');
  if(manifest?.population!==expectedPopulation) pushError(errors,`manifest population must be ${expectedPopulation}`);
  if(expectedPopulation===POPULATION&&manifest?.batch_size!==100) pushError(errors,'manifest batch_size must be 100');
  if(manifest?.batch_count!==expectedBatchCount||!Array.isArray(manifest?.batches)||manifest.batches.length!==expectedBatchCount) pushError(errors,`manifest must define ${expectedBatchCount} batches`);
  if(entries.length!==expectedPopulation) pushError(errors,`production population must be ${expectedPopulation}`);
  const productionIds=idsOf(entries);
  if(new Set(productionIds).size!==productionIds.length) pushError(errors,'production contains duplicate IDs');
  const productionById=new Map(entries.map(entry=>[String(entry?.id??''),entry]));
  if(expectedPopulation===POPULATION){
    const expectedKinds={word:1422,expression:997,construction:59};
    const actualKinds=Object.fromEntries(Object.keys(expectedKinds).map(kind=>[kind,entries.filter(entry=>entry.kind===kind).length]));
    if(!eq(actualKinds,expectedKinds)) pushError(errors,`production kind counts mismatch ${JSON.stringify(actualKinds)}`);
  }
  const assignmentIds=[];
  const resultById=new Map();
  const artifactRows=[];
  if(batches.length!==expectedBatchCount) pushError(errors,`artifact count must be ${expectedBatchCount}`);

  const specs=Array.isArray(manifest?.batches)?manifest.batches:[];
  for(let index=0;index<expectedBatchCount;index+=1){
    const spec=specs[index];
    const loaded=batches[index];
    if(!spec||!loaded){pushError(errors,`missing manifest/artifact batch ${index+1}`);continue;}
    const number=index+1;
    const key=String(number).padStart(3,'0');
    const expectedStart=index*100+1;
    const expectedEnd=Math.min(index*100+100,expectedPopulation);
    const expectedCount=expectedEnd-expectedStart+1;
    const batch=loaded.artifact;
    const artifactPath=`${AUDIT_DIR}/batch-${key}.json`;
    if(spec.batch!==number||spec.key!==`batch-${key}`||spec.ordinal_start!==expectedStart||spec.ordinal_end!==expectedEnd||spec.entry_count!==expectedCount||spec.artifact_path!==artifactPath) pushError(errors,`manifest batch-${key} metadata mismatch`);
    if(batch?.schema_version!==1||batch?.policy_version!==POLICY||batch?.batch!==number||batch?.ordinal_start!==expectedStart||batch?.ordinal_end!==expectedEnd||batch?.reviewed_count!==expectedCount) pushError(errors,`batch-${key} structural metadata mismatch`);
    if(!Array.isArray(spec.entry_ids)||spec.entry_ids.length!==expectedCount) pushError(errors,`manifest batch-${key} entry_ids length mismatch`);
    if(!Array.isArray(batch?.entry_ids)||!eq(batch.entry_ids,spec.entry_ids)) pushError(errors,`batch-${key} assigned entry IDs mismatch`);
    if(new Set(batch?.entry_ids||[]).size!==(batch?.entry_ids||[]).length) pushError(errors,`batch-${key} duplicate entry ID`);
    assignmentIds.push(...array(spec.entry_ids).map(String));
    if(!Array.isArray(batch?.results)||batch.results.length!==expectedCount) pushError(errors,`batch-${key} result count mismatch`);
    artifactRows.push({batch,loaded,number,path:artifactPath});
    for(const result of array(batch?.results)){
      const id=String(result?.entry_id??'');
      if(resultById.has(id)) pushError(errors,`duplicate result ID ${id}`);
      else resultById.set(id,result);
      if(!array(spec.entry_ids).includes(id)) pushError(errors,`unexpected result ID ${id}`);
      if(!Array.isArray(result?.after_paraphrases)||!Array.isArray(result?.existing_paraphrases)||!Array.isArray(result?.answers_snapshot)) pushError(errors,`${id}: paraphrase/snapshot fields must be arrays`);
      if(typeof result?.prompt_ja!=='string'||!result.prompt_ja.trim()) pushError(errors,`${id}: prompt_ja must be non-empty`);
      if(typeof result?.canonical_snapshot!=='string'||!result.canonical_snapshot.trim()) pushError(errors,`${id}: canonical_snapshot must be non-empty`);
      const entry=productionById.get(id);
      if(!entry){pushError(errors,`unknown production ID ${id}`);continue;}
      if(result.prompt_ja!==entry.meaning_ja||result.canonical_snapshot!==entry.canonical||!eq(result.answers_snapshot,entry.answers??[])) pushError(errors,`semantic snapshot drift ${id}`);
      const after=array(result.after_paraphrases);
      for(const phrase of after){
        if(!isNaturalAnswer(phrase)||!normalizeVocabularyAnswer(phrase)) pushError(errors,`${id}: invalid paraphrase notation`);
      }
      const normalized=after.map(normalizeVocabularyAnswer);
      if(new Set(normalized).size!==normalized.length) pushError(errors,`${id}: normalized paraphrase duplicate`);
      const targetForms=new Set([entry.canonical,...array(entry.answers)].map(normalizeVocabularyAnswer));
      if(normalized.some(value=>targetForms.has(value))) pushError(errors,`${id}: paraphrase overlaps canonical/answers`);
    }
  }

  if(assignmentIds.length!==expectedPopulation) pushError(errors,'manifest ID total mismatch');
  if(new Set(assignmentIds).size!==assignmentIds.length) pushError(errors,'manifest contains duplicate IDs');
  if(!eq(assignmentIds,productionIds)) pushError(errors,'manifest ID order differs from production');
  if(resultById.size!==expectedPopulation) pushError(errors,'unique result coverage mismatch');
  for(const id of assignmentIds) if(!resultById.has(id)) pushError(errors,`missing result ${id}`);
  for(const id of resultById.keys()) if(!productionById.has(id)) pushError(errors,`unknown result ${id}`);
  if(!paraphraseAudit||typeof paraphraseAudit!=='object'||Array.isArray(paraphraseAudit)) pushError(errors,'global paraphrase audit must be an object');

  if(errors.length) throw new Error(`Input validation failed:\n- ${errors.join('\n- ')}`);
  return {entries,productionIds,productionById,resultById,artifactRows};
}

function detectState(entries,resultById){
  const pre=entries.every(entry=>eq(entry.paraphrases??[],resultById.get(String(entry.id)).existing_paraphrases));
  const post=entries.every(entry=>eq(entry.paraphrases??[],resultById.get(String(entry.id)).after_paraphrases));
  if(pre) return 'PRE';
  if(post) return 'POST';
  return 'MIXED';
}

function buildAudit(audit,entries,resultById){
  const next=jsonClone(audit);
  const kindCounts=Object.fromEntries(['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry.kind===kind).length]));
  next.review_scope={entry_count:entries.length,kind_counts:kindCounts};
  next.reviewed_entries=entries.map(entry=>({entry_id:entry.id,decision:array(resultById.get(entry.id).after_paraphrases).length?'curated':'reviewed_no_major_paraphrase'}));
  next.curated_paraphrases=entries.flatMap(entry=>{
    const phrases=array(resultById.get(entry.id).after_paraphrases);
    return phrases.length?[{entry_id:entry.id,paraphrases:[...phrases]}]:[];
  });
  next.pending_entries=[];
  if(!eq(preservedAuditProjection(audit),preservedAuditProjection(next))) throw new Error('preserved global audit fields changed');
  return next;
}

function buildSummary(entries,resultById,semanticDriftCount,nonParaphraseMutationCount,batchCount){
  let previous=0,kept=0,removed=0,added=0,changed=0;
  let zero=0,nonzero=0,totalFinal=0;
  for(const entry of entries){
    const result=resultById.get(entry.id);
    const before=array(result.existing_paraphrases),after=array(result.after_paraphrases);
    const beforeSet=new Set(before),afterSet=new Set(after);
    previous+=before.length;
    kept+=[...beforeSet].filter(value=>afterSet.has(value)).length;
    removed+=[...beforeSet].filter(value=>!afterSet.has(value)).length;
    added+=[...afterSet].filter(value=>!beforeSet.has(value)).length;
    if(eq(before,after)) changed+=0; else changed+=1;
    totalFinal+=after.length;
    if(after.length) nonzero+=1; else zero+=1;
  }
  return {
    schema_version:1,
    policy_version:POLICY,
    population:entries.length,
    batch_count:batchCount,
    reviewed_entries:entries.length,
    pending_entries:0,
    entries_with_zero_paraphrases:zero,
    entries_with_paraphrases:nonzero,
    total_final_paraphrase_strings:totalFinal,
    previous_paraphrase_strings:previous,
    kept_existing_strings:kept,
    removed_existing_strings:removed,
    newly_added_strings:added,
    changed_entries:changed,
    unchanged_entries:entries.length-changed,
    semantic_drift_count:semanticDriftCount,
    non_paraphrase_mutation_count:nonParaphraseMutationCount,
  };
}

function buildReconciliation({manifest,manifestRaw,artifactRows,entries,resultById,vocabulary,nextVocabulary,audit,nextAudit,claimBaseMain,lastReconciledMain,claimCommit,semanticDriftCount,nonParaphraseMutationCount}){
  const beforeAuthority=entries.map(entry=>({entry_id:entry.id,paraphrases:array(resultById.get(entry.id).existing_paraphrases)}));
  const finalAuthority=entries.map(entry=>({entry_id:entry.id,paraphrases:array(resultById.get(entry.id).after_paraphrases)}));
  const beforeProjection=stripParaphrases(vocabulary);
  const afterProjection=stripParaphrases(nextVocabulary);
  const auditBefore=preservedAuditProjection(audit);
  const auditAfter=preservedAuditProjection(nextAudit);
  const kindCounts=Object.fromEntries(['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry.kind===kind).length]));
  const checks={
    manifest:{path:`${AUDIT_DIR}/manifest.json`,sha256:sha256(manifestRaw)},
    batches:artifactRows.map(({number,path,loaded,batch})=>({
      batch:number,path,entry_count:batch.reviewed_count,sha256:sha256(loaded.raw),
    })),
    coverage:{batch_count:artifactRows.length,entry_count:entries.length,missing:0,duplicate:0,unexpected:0},
    semantic_drift:{count:semanticDriftCount,entries:[]},
    fingerprints:{
      before_paraphrase_authority_sha256:canonicalHash(beforeAuthority),
      final_paraphrase_authority_sha256:canonicalHash(finalAuthority),
      production_non_paraphrase_before_sha256:canonicalHash(beforeProjection),
      production_non_paraphrase_after_sha256:canonicalHash(afterProjection),
      preserved_global_audit_before_sha256:canonicalHash(auditBefore),
      preserved_global_audit_after_sha256:canonicalHash(auditAfter),
    },
    materialization:{
      exact_authority_match:true,
      non_paraphrase_mutation_count:nonParaphraseMutationCount,
      global_reviewed_entries:entries.length,
      global_pending_entries:0,
      kind_counts:kindCounts,
    },
  };
  return {
    schema_version:1,
    policy_version:POLICY,
    claim_base_main:claimBaseMain,
    last_reconciled_main:lastReconciledMain,
    claim_commit:claimCommit,
    manifest:checks.manifest,
    batches:checks.batches,
    coverage:checks.coverage,
    semantic_drift:checks.semantic_drift,
    fingerprints:checks.fingerprints,
    materialization:checks.materialization,
  };
}

export function buildParaphraseFinalization({
  vocabulary,paraphraseAudit,manifest,manifestRaw,batches,
  claimBaseMain,lastReconciledMain,claimCommit,
  expectedPopulation=POPULATION,expectedBatchCount=BATCH_COUNT,
}){
  if(!SHA.test(String(claimBaseMain??''))||!SHA.test(String(lastReconciledMain??''))||!SHA.test(String(claimCommit??''))) throw new Error('claim/reconciliation SHAs must be full 40-character SHAs');
  const {entries,productionIds,resultById,artifactRows}=validateInputs({vocabulary,paraphraseAudit,manifest,batches,expectedPopulation,expectedBatchCount});
  const state=detectState(entries,resultById);
  if(state==='MIXED') throw new Error('MIXED state: partial materialization or external mutation');
  if(manifestRaw==null) throw new Error('raw manifest bytes are required for reconciliation hashing');

  const nextVocabulary=jsonClone(vocabulary);
  const nextEntries=Array.isArray(nextVocabulary)?nextVocabulary:nextVocabulary.entries;
  const nextById=new Map(nextEntries.map(entry=>[String(entry.id),entry]));
  for(const id of productionIds){
    const entry=nextById.get(id);
    const phrases=array(resultById.get(id).after_paraphrases);
    if(phrases.length) entry.paraphrases=[...phrases];
    else delete entry.paraphrases;
  }
  const beforeProjection=stripParaphrases(vocabulary),afterProjection=stripParaphrases(nextVocabulary);
  const nonParaphraseMutationCount=eq(beforeProjection,afterProjection)?0:1;
  if(nonParaphraseMutationCount!==0) throw new Error('non-paraphrase production projection changed');

  const nextParaphraseAudit=buildAudit(paraphraseAudit,entries,resultById);
  const preservedBefore=preservedAuditProjection(paraphraseAudit);
  const preservedAfter=preservedAuditProjection(nextParaphraseAudit);
  if(!eq(preservedBefore,preservedAfter)) throw new Error('preserved global audit projection changed');

  const summary=buildSummary(entries,resultById,0,nonParaphraseMutationCount,expectedBatchCount);
  if(summary.changed_entries+summary.unchanged_entries!==expectedPopulation||summary.entries_with_zero_paraphrases+summary.entries_with_paraphrases!==expectedPopulation) throw new Error('summary count invariants failed');
  const reconciliation=buildReconciliation({manifest,manifestRaw,artifactRows,entries,resultById,vocabulary,nextVocabulary,audit:paraphraseAudit,nextAudit:nextParaphraseAudit,claimBaseMain,lastReconciledMain,claimCommit,semanticDriftCount:0,nonParaphraseMutationCount});
  return {state,nextVocabulary,nextParaphraseAudit,summary,reconciliation};
}

function readJson(file){return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));}
function readLoadedBatch(number){
  const key=String(number).padStart(3,'0');
  const rel=`${AUDIT_DIR}/batch-${key}.json`;
  const raw=fs.readFileSync(path.join(ROOT,rel));
  return {artifact:JSON.parse(raw.toString('utf8')),raw,path:rel};
}
function gitText(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function claimMetadata(existingReconciliation){
  let claimBaseMain,claimCommit,lastReconciledMain;
  if(existingReconciliation){
    claimBaseMain=existingReconciliation.claim_base_main;
    claimCommit=existingReconciliation.claim_commit;
    lastReconciledMain=existingReconciliation.last_reconciled_main;
  }else{
    const marker=readJson(`${AUDIT_DIR}/finalizer-claim.json`);
    if(marker.schema_version!==1||marker.purpose!=='atomic-finalizer-claim'||marker.transport!=='github-contents-api'||!SHA.test(String(marker.claim_base_main||''))) throw new Error('claim marker missing or invalid');
    claimBaseMain=marker.claim_base_main;
    lastReconciledMain=gitText(['rev-parse','origin/main']);
    const claims=gitText(['log','--diff-filter=A','--format=%H','--',`${AUDIT_DIR}/finalizer-claim.json`]).split('\n').filter(Boolean);
    if(!claims.length) throw new Error('cannot locate claim commit in local history');
    claimCommit=claims.at(-1);
  }
  return {claimBaseMain,lastReconciledMain,claimCommit};
}

function loadInputs({forCheck}){
  const vocabulary=readJson('data/vocabulary-v3.json');
  const paraphraseAudit=readJson('data/vocabulary-v3-paraphrase-audit.json');
  const manifestPath=`${AUDIT_DIR}/manifest.json`;
  const manifestRaw=fs.readFileSync(path.join(ROOT,manifestPath));
  const manifest=JSON.parse(manifestRaw.toString('utf8'));
  const batches=Array.from({length:BATCH_COUNT},(_,index)=>readLoadedBatch(index+1));
  const auditFile=path.join(ROOT,'data/audits/vocabulary-v3-paraphrase-learning/reconciliation.json');
  const existingReconciliation=fs.existsSync(auditFile)?JSON.parse(fs.readFileSync(auditFile,'utf8')):null;
  if(forCheck&&!existingReconciliation) throw new Error('reconciliation.json is required for --check');
  const metadata=claimMetadata(existingReconciliation);
  return {vocabulary,paraphraseAudit,manifest,manifestRaw,batches,metadata,existingReconciliation};
}

function writeJson(rel,value){fs.writeFileSync(path.join(ROOT,rel),`${JSON.stringify(value,null,2)}\n`);}
function sameFile(rel,expected){
  const file=path.join(ROOT,rel);
  if(!fs.existsSync(file)) return false;
  try{return eq(JSON.parse(fs.readFileSync(file,'utf8')),expected);}catch{return false;}
}
function displaySummary(result){
  console.log(JSON.stringify({state:result.state,...result.summary,coverage:result.reconciliation.coverage,semantic_drift:result.reconciliation.semantic_drift.count,structural_errors:0},null,2));
}

function main(){
  const args=process.argv.slice(2);
  const allowed=new Set(['--write','--check']);
  if(args.length>1||args.some(arg=>!allowed.has(arg))||(args.includes('--write')&&args.includes('--check'))) throw new Error('Usage: node materialize-paraphrase-learning-audit.mjs [--write|--check]');
  const mode=args[0]||'--dry-run';
  const loaded=loadInputs({forCheck:mode==='--check'});
  const result=buildParaphraseFinalization({
    vocabulary:loaded.vocabulary,paraphraseAudit:loaded.paraphraseAudit,manifest:loaded.manifest,manifestRaw:loaded.manifestRaw,batches:loaded.batches,
    ...loaded.metadata,
  });
  const summaryPath=`${AUDIT_DIR}/summary.json`,reconciliationPath=`${AUDIT_DIR}/reconciliation.json`;
  if(mode==='--check'){
    if(result.state!=='POST') throw new Error(`--check requires POST state; got ${result.state}`);
    if(!eq(loaded.vocabulary,result.nextVocabulary)) throw new Error('production does not equal deterministic final paraphrase authority');
    if(!eq(loaded.paraphraseAudit,result.nextParaphraseAudit)) throw new Error('global audit does not equal deterministic final projection');
    if(!sameFile(summaryPath,result.summary)) throw new Error('summary.json differs from deterministic output');
    if(!sameFile(reconciliationPath,result.reconciliation)) throw new Error('reconciliation.json differs from deterministic output');
    console.log('Paraphrase finalization check: PASS');displaySummary(result);return;
  }
  if(mode==='--write'){
    if(result.state==='PRE'){
      writeJson('data/vocabulary-v3.json',result.nextVocabulary);
      writeJson('data/vocabulary-v3-paraphrase-audit.json',result.nextParaphraseAudit);
      writeJson(summaryPath,result.summary);
      writeJson(reconciliationPath,result.reconciliation);
      console.log('Paraphrase finalization materialized.');
    }else console.log('POST state already materialized; no files written.');
  }else console.log('Dry run; no files written.');
  displaySummary(result);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(`Paraphrase finalization FAILED: ${error.message}`);process.exitCode=1;}
}
