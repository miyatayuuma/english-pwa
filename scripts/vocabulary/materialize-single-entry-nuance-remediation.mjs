import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {normalizeVocabularyAnswer,RETIRED_VOCABULARY_IDS} from '../app/vocabularyLearningCore.js';
import {VOCAB_00139_ASR_REMEDIATION} from './vocabularyEntryRemediationAuthority.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const MATERIALIZATION_DIR='data/audits/vocabulary-single-entry-nuance-materialization';
const AUTHORITY_PATH=`${MATERIALIZATION_DIR}/authority.json`;
const MATERIALIZATION_PATH=`${MATERIALIZATION_DIR}/materialization.json`;
const SUMMARY_PATH=`${MATERIALIZATION_DIR}/summary.json`;
const RECONCILIATION_PATH=`${MATERIALIZATION_DIR}/reconciliation.json`;
const VOCABULARY_PATH='data/vocabulary-v3.json';
const PARAPHRASE_AUDIT_PATH='data/vocabulary-v3-paraphrase-audit.json';
const SEMANTIC_INVENTORY_PATH='data/vocabulary-v3-semantic-audit-inventory.json';
const REPORT_PATH='data/vocabulary-v3-report.json';
const MATERIALIZATION_OUTPUTS=[
  VOCABULARY_PATH,
  PARAPHRASE_AUDIT_PATH,
  SEMANTIC_INVENTORY_PATH,
  REPORT_PATH,
  MATERIALIZATION_PATH,
  SUMMARY_PATH,
  RECONCILIATION_PATH,
];
const EXPECTED_AUDIT_COMMIT='ab1238bf126196aef01aef636db70e53fac34ad1';
const EXPECTED_AUDIT_BRANCH='audit/vocabulary-single-entry-nuance-qualifier';
const EXPECTED_CANDIDATE_COUNT=551;
const EXPECTED_POPULATION=2478;
const EXPECTED_COUNTS={QUALIFIER_ONLY:56,QUALIFIER_AND_PARAPHRASE:296,PARAPHRASE_REVALIDATION_ONLY:199};
const ALLOWED_DECISIONS=new Set(Object.keys(EXPECTED_COUNTS));
const CURRENT_AUDIT_FIELDS=new Set(['review_scope','reviewed_entries','curated_paraphrases','pending_entries']);
const SHA=/^[0-9a-f]{40}$/;
const HEX256=/^[0-9a-f]{64}$/;

const jsonClone=value=>JSON.parse(JSON.stringify(value));
const eq=(left,right)=>isDeepStrictEqual(left,right);
const array=value=>Array.isArray(value)?value:[];
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonicalHash=value=>sha256(JSON.stringify(value));
const readBytes=relative=>fs.readFileSync(path.join(ROOT,relative));
const readJson=relative=>JSON.parse(readBytes(relative).toString('utf8'));
const entriesOf=value=>Array.isArray(value)?value:value?.entries;
const idsOf=entries=>entries.map(entry=>String(entry?.id??''));
const fieldSurface=entry=>({
  meaning_ja:entry?.meaning_ja,
  canonical:entry?.canonical,
  paraphrases:array(entry?.paraphrases),
  grammarRole:entry?.grammarRole,
  sense_key:entry?.sense_key,
  answers:array(entry?.answers),
});
const visibleSurface=entry=>({
  meaning_ja:entry?.meaning_ja,
  canonical:entry?.canonical,
  paraphrases:array(entry?.paraphrases),
  grammarRole:entry?.grammarRole,
});
const sourceSurface=row=>({
  meaning_ja:row?.meaning_ja,
  canonical:row?.canonical,
  paraphrases:array(row?.paraphrases),
  grammarRole:row?.grammarRole,
  sense_key:row?.sense_key,
  answers:array(row?.answers),
});
const changeSummary=(before,after)=>{
  const beforeSet=new Set(array(before)),afterSet=new Set(array(after));
  return {
    removed:[...beforeSet].filter(value=>!afterSet.has(value)),
    added:[...afterSet].filter(value=>!beforeSet.has(value)),
  };
};

function pushError(errors,message){errors.push(message);}

function isNaturalAnswer(value){
  return typeof value==='string'&&!!value.trim()&&!/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|[A-Za-z]\s*\/\s*[A-Za-z]|\(\d+\)|^\s*\d+[.)]|\.{2,}/.test(value);
}

function validateParaphrases(entry,phrases,errors,label){
  if(!Array.isArray(phrases)){
    pushError(errors,`${label}: paraphrases must be an array`);
    return;
  }
  const normalized=[];
  for(const phrase of phrases){
    if(!isNaturalAnswer(phrase)||!normalizeVocabularyAnswer(phrase)) pushError(errors,`${label}: invalid paraphrase notation`);
    normalized.push(normalizeVocabularyAnswer(phrase));
  }
  if(new Set(normalized).size!==normalized.length) pushError(errors,`${label}: normalized duplicate paraphrase`);
  const forbidden=new Set([entry?.canonical,...array(entry?.answers)].filter(Boolean).map(normalizeVocabularyAnswer));
  if(normalized.some(value=>forbidden.has(value))) pushError(errors,`${label}: paraphrase overlaps canonical or answers`);
}

function validateAuthority(authority,vocabulary,errors){
  const entries=entriesOf(vocabulary);
  const rows=array(authority?.entries);
  if(authority?.schema_version!==1||authority?.status!=='READY_FOR_MATERIALIZATION') pushError(errors,'authority schema/status mismatch');
  if(authority?.source_audit_commit!==EXPECTED_AUDIT_COMMIT||authority?.source_audit_branch!==EXPECTED_AUDIT_BRANCH) pushError(errors,'authority source audit ref mismatch');
  if(authority?.source_candidate_count!==EXPECTED_CANDIDATE_COUNT||rows.length!==EXPECTED_CANDIDATE_COUNT) pushError(errors,'authority must contain exactly 551 candidates');
  if(!HEX256.test(String(authority?.source_candidate_artifact_sha256||''))) pushError(errors,'candidate artifact SHA256 is missing or invalid');
  if(!HEX256.test(String(authority?.source_main_vocabulary_sha256||''))) pushError(errors,'source main Vocabulary SHA256 is missing or invalid');
  if(!HEX256.test(String(authority?.source_audit_summary_sha256||''))) pushError(errors,'audit summary SHA256 is missing or invalid');
  if(authority?.authority_generation_version!==1) pushError(errors,'authority generation version mismatch');
  if(!SHA.test(String(authority?.current_main_base_sha||''))) pushError(errors,'current main base SHA is missing or invalid');
  if(!eq(authority?.audit_wide_expected_changes,{qualifier_additions:353,paraphrase_removals:671,paraphrase_additions:8})) pushError(errors,'audit-wide expected change counts mismatch');
  const batches=authority?.source_batch_artifacts;
  if(!batches||typeof batches!=='object'||Array.isArray(batches)||Object.keys(batches).length!==25) pushError(errors,'authority must hash all 25 final audit batches');
  for(const [name,digest] of Object.entries(batches||{})){
    if(!/^batch-\d{3}\.json$/.test(name)||!HEX256.test(String(digest))) pushError(errors,`invalid source batch hash ${name}`);
  }
  if(!Array.isArray(entries)||entries.length!==EXPECTED_POPULATION) pushError(errors,`production population must be ${EXPECTED_POPULATION}`);
  const productionIds=Array.isArray(entries)?idsOf(entries):[];
  if(new Set(productionIds).size!==productionIds.length) pushError(errors,'production contains duplicate IDs');
  const productionById=new Map((Array.isArray(entries)?entries:[]).map((entry,index)=>[String(entry?.id??''),{entry,index}]));
  const seen=new Set(),counts=Object.fromEntries(Object.keys(EXPECTED_COUNTS).map(decision=>[decision,0]));
  let previousIndex=0;
  for(const row of rows){
    const id=String(row?.id??'');
    if(seen.has(id)) pushError(errors,`duplicate authority ID ${id}`);
    seen.add(id);
    if(!ALLOWED_DECISIONS.has(row?.decision)) pushError(errors,`${id}: invalid decision ${row?.decision}`);
    else counts[row.decision]++;
    if(row?.learning_eligible!==true||row?.remediation_eligible!==true||row?.confidence==='LOW') pushError(errors,`${id}: candidate is not eligible for materialization`);
    if(id==='vocab:00947') pushError(errors,'vocab:00947 toil must remain excluded from remediation authority');
    if(!Number.isInteger(row?.source_index)||row.source_index<1||row.source_index<=previousIndex) pushError(errors,`${id}: source_index must be unique and ordered`);
    previousIndex=row?.source_index||previousIndex;
    const production=productionById.get(id);
    if(!production) pushError(errors,`${id}: authority ID is missing from production`);
    else if(production.index+1!==row.source_index) pushError(errors,`${id}: source_index does not match production order`);
    if(typeof row?.canonical_snapshot!=='string'||!row.canonical_snapshot.trim()) pushError(errors,`${id}: canonical snapshot missing`);
    if(typeof row?.sense_key_snapshot!=='string'||!row.sense_key_snapshot.trim()) pushError(errors,`${id}: sense_key snapshot missing`);
    if(typeof row?.grammarRole_snapshot!=='string'||!row.grammarRole_snapshot.trim()) pushError(errors,`${id}: grammarRole snapshot missing`);
    if(typeof row?.before_meaning_ja!=='string'||!row.before_meaning_ja.trim()) pushError(errors,`${id}: before meaning snapshot missing`);
    if(!Array.isArray(row?.before_paraphrases)||!Array.isArray(row?.answers_snapshot)||!Array.isArray(row?.recommended_paraphrases)) pushError(errors,`${id}: array snapshots are missing`);
    if(typeof row?.recommended_prompt!=='string'||!row.recommended_prompt.trim()) pushError(errors,`${id}: recommended prompt missing`);
    if(!row?.audit_provenance||typeof row.audit_provenance.source_batch!=='string'||!HEX256.test(String(row.audit_provenance.source_batch_sha256||''))) pushError(errors,`${id}: audit provenance is incomplete`);
    const sourceBatch=String(row?.audit_provenance?.source_batch||'').match(/batch-(\d{3})\.json$/)?.[1];
    if(!sourceBatch||!batches?.[`batch-${sourceBatch}.json`]) pushError(errors,`${id}: source batch provenance is not in authority metadata`);
    else if(batches[`batch-${sourceBatch}.json`]!==row.audit_provenance.source_batch_sha256) pushError(errors,`${id}: source batch provenance hash mismatch`);
    const before=row?.before,after=row?.after;
    const beforeExpected={
      canonical:row?.canonical_snapshot,
      sense_key:row?.sense_key_snapshot,
      grammarRole:row?.grammarRole_snapshot,
      meaning_ja:row?.before_meaning_ja,
      paraphrases:array(row?.before_paraphrases),
      answers:array(row?.answers_snapshot),
    };
    if(!eq(sourceSurface(before),beforeExpected)) pushError(errors,`${id}: before snapshot fields disagree with final batch judgment`);
    const expectedMeaning=row?.decision==='PARAPHRASE_REVALIDATION_ONLY'?row.before_meaning_ja:row.recommended_prompt;
    const afterExpected={
      canonical:row?.canonical_snapshot,
      sense_key:row?.sense_key_snapshot,
      grammarRole:row?.grammarRole_snapshot,
      meaning_ja:expectedMeaning,
      paraphrases:array(row?.recommended_paraphrases),
      answers:array(row?.answers_snapshot),
    };
    if(!eq(sourceSurface(after),afterExpected)) pushError(errors,`${id}: after-state does not match final audit authority`);
    if(!eq(row?.after?.paraphrases,row?.recommended_paraphrases)) pushError(errors,`${id}: recommended_paraphrases was not adopted verbatim`);
    validateParaphrases({canonical:row?.canonical_snapshot,answers:row?.answers_snapshot},array(row?.recommended_paraphrases),errors,`${id}: final authority`);
    if(row?.decision==='PARAPHRASE_REVALIDATION_ONLY'&&row?.after?.meaning_ja!==row?.before?.meaning_ja) pushError(errors,`${id}: revalidation-only decision changes meaning_ja`);
    if(row?.after?.canonical!==row?.before?.canonical||row?.after?.sense_key!==row?.before?.sense_key||row?.after?.grammarRole!==row?.before?.grammarRole||!eq(row?.after?.answers,row?.before?.answers)) pushError(errors,`${id}: forbidden semantic field change in authority`);
  }
  if(counts.QUALIFIER_ONLY!==EXPECTED_COUNTS.QUALIFIER_ONLY||counts.QUALIFIER_AND_PARAPHRASE!==EXPECTED_COUNTS.QUALIFIER_AND_PARAPHRASE||counts.PARAPHRASE_REVALIDATION_ONLY!==EXPECTED_COUNTS.PARAPHRASE_REVALIDATION_ONLY) pushError(errors,`authority classification counts mismatch ${JSON.stringify(counts)}`);
  if(seen.size!==EXPECTED_CANDIDATE_COUNT) pushError(errors,'authority unique coverage mismatch');
  return {rows,productionById,counts};
}

function validatePopulation(vocabulary,authorityEntries,errors){
  const entries=entriesOf(vocabulary);
  if(!Array.isArray(entries)){pushError(errors,'vocabulary root must be an array or object with entries[]');return null;}
  if(entries.length!==EXPECTED_POPULATION) pushError(errors,`production population must be ${EXPECTED_POPULATION}`);
  const ids=idsOf(entries);
  if(new Set(ids).size!==ids.length) pushError(errors,'production ID uniqueness failed');
  const byId=new Map(entries.map((entry,index)=>[String(entry?.id??''),{entry,index}]));
  const targetIds=new Set(authorityEntries.map(row=>row.id));
  const kindCounts=Object.fromEntries(['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry?.kind===kind).length]));
  const grammarRoleCounts=Object.fromEntries([...new Set(entries.map(entry=>entry?.grammarRole))].sort().map(role=>[role,entries.filter(entry=>entry?.grammarRole===role).length]));
  return {entries,ids,byId,targetIds,kindCounts,grammarRoleCounts};
}

function expectedAfterVocabulary(vocabulary,authorityRows){
  const next=jsonClone(vocabulary),entries=entriesOf(next),byId=new Map(entries.map(entry=>[String(entry.id),entry]));
  for(const row of authorityRows){
    const entry=byId.get(row.id);
    if(!entry) throw new Error(`${row.id}: missing during materialization`);
    entry.meaning_ja=row.after.meaning_ja;
    const phrases=array(row.after.paraphrases);
    if(phrases.length) entry.paraphrases=[...phrases];
    else delete entry.paraphrases;
  }
  return next;
}

function withoutCurrentAuditProjection(audit){
  const projection=jsonClone(audit);
  for(const key of CURRENT_AUDIT_FIELDS) delete projection[key];
  return projection;
}

function buildParaphraseAudit(audit,entries){
  const next=jsonClone(audit);
  const kindCounts=Object.fromEntries(['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry.kind===kind).length]));
  next.review_scope={entry_count:entries.length,kind_counts:kindCounts};
  next.reviewed_entries=entries.map(entry=>({entry_id:entry.id,decision:array(entry.paraphrases).length?'curated':'reviewed_no_major_paraphrase'}));
  next.curated_paraphrases=entries.flatMap(entry=>{
    const paraphrases=array(entry.paraphrases);
    return paraphrases.length?[{entry_id:entry.id,paraphrases:[...paraphrases]}]:[];
  });
  next.pending_entries=[];
  if(!eq(withoutCurrentAuditProjection(audit),withoutCurrentAuditProjection(next))) throw new Error('historical paraphrase audit projection changed');
  return next;
}

function validateCurrentParaphraseProjection(audit,entries,errors){
  const expected=buildParaphraseAudit(audit,entries);
  if(!eq(audit.review_scope,expected.review_scope)||!eq(audit.reviewed_entries,expected.reviewed_entries)||!eq(audit.pending_entries,expected.pending_entries)) pushError(errors,'global paraphrase review scope differs from production');
  const currentCurated=new Map(array(audit.curated_paraphrases).map(row=>[String(row?.entry_id||''),row?.paraphrases]));
  const expectedCurated=new Map(array(expected.curated_paraphrases).map(row=>[String(row?.entry_id||''),row?.paraphrases]));
  for(const [id,phrases] of expectedCurated){
    const actual=currentCurated.get(id);
    if(eq(actual,phrases)) continue;
    const legacyBefore=currentCurated.get(VOCAB_00139_ASR_REMEDIATION.id);
    if(id===VOCAB_00139_ASR_REMEDIATION.id
      &&eq(legacyBefore,VOCAB_00139_ASR_REMEDIATION.before.paraphrases)
      &&eq(phrases,VOCAB_00139_ASR_REMEDIATION.after.paraphrases)) continue;
    pushError(errors,`global paraphrase mirror differs from production for ${id}`);
  }
  for(const id of currentCurated.keys()) if(!expectedCurated.has(id)) pushError(errors,`global paraphrase mirror contains unexpected entry ${id}`);
  if(!eq(withoutCurrentAuditProjection(audit),withoutCurrentAuditProjection(expected))) pushError(errors,'global paraphrase historical fields changed');
}

function projectionWithoutAllowedFields(vocabulary,authorityRows){
  const projection=jsonClone(vocabulary),entries=entriesOf(projection),targetIds=new Set(authorityRows.map(row=>row.id));
  for(const entry of entries) if(targetIds.has(entry.id)){delete entry.meaning_ja;delete entry.paraphrases;}
  return projection;
}

function nonTargetProjection(vocabulary,authorityRows){
  const projection=jsonClone(vocabulary),entries=entriesOf(projection),targetIds=new Set(authorityRows.map(row=>row.id));
  const retained=entries.filter(entry=>!targetIds.has(entry.id));
  if(Array.isArray(projection)) return retained;
  projection.entries=retained;
  return projection;
}

function candidateState(actual,authority){
  const current=fieldSurface(actual);
  const before=sourceSurface(authority.before);
  const after=sourceSurface(authority.after);
  return {current,isBefore:eq(current,before),isAfter:eq(current,after)};
}

function validateParaphraseAuditMirror(audit,entries,errors){
  if(!audit||typeof audit!=='object'||Array.isArray(audit)){pushError(errors,'global paraphrase audit must be an object');return;}
  const expected=buildParaphraseAudit(audit,entries);
  if(!eq(audit.review_scope,expected.review_scope)||!eq(audit.reviewed_entries,expected.reviewed_entries)||!eq(audit.curated_paraphrases,expected.curated_paraphrases)||!eq(audit.pending_entries,expected.pending_entries)) pushError(errors,'global paraphrase current projection differs from production');
  if(!eq(withoutCurrentAuditProjection(audit),withoutCurrentAuditProjection(expected))) pushError(errors,'global paraphrase historical fields changed');
}

function validateWholeVocabulary(vocabulary,authorityRows,errors){
  const entries=entriesOf(vocabulary);
  if(!Array.isArray(entries)) return;
  const ids=idsOf(entries),targetIds=new Set(authorityRows.map(row=>row.id));
  for(const entry of entries){
    const paraphrases=array(entry.paraphrases);
    validateParaphrases(entry,paraphrases,errors,String(entry.id));
    if(entry.paraphrases!=null&&!Array.isArray(entry.paraphrases)) pushError(errors,`${entry.id}: production paraphrases must be an array when present`);
  }
  for(const row of authorityRows){
    const entry=entries.find(value=>value.id===row.id);
    if(!entry) continue;
    if(entry.meaning_ja!==row.after.meaning_ja) pushError(errors,`${row.id}: post-state meaning_ja mismatch`);
    if(!eq(array(entry.paraphrases),array(row.after.paraphrases))) pushError(errors,`${row.id}: post-state paraphrases mismatch`);
    if(array(row.after.paraphrases).length===0&&Object.hasOwn(entry,'paraphrases')) pushError(errors,`${row.id}: empty final paraphrases field must be omitted`);
    if(entry.canonical!==row.before.canonical||entry.sense_key!==row.before.sense_key||entry.grammarRole!==row.before.grammarRole||!eq(array(entry.answers),array(row.before.answers))) pushError(errors,`${row.id}: forbidden production field changed`);
  }
  if(ids.length!==EXPECTED_POPULATION||new Set(ids).size!==EXPECTED_POPULATION) pushError(errors,'post-state population or unique ID count changed');
  if(entries.some(entry=>entry.id==='vocab:00947'&&targetIds.has(entry.id))) pushError(errors,'toil entered remediation authority');
}

function dispositionSummary(rows,dispositions,production){
  const entries=entriesOf(production);
  const statusCounts={APPLY:0,ALREADY_MATCHED:0,BLOCKED_DRIFT:0};
  let meaningChanged=0,paraphraseChanged=0,bothChanged=0,removed=0,added=0;
  for(const row of rows){
    const status=dispositions.get(row.id)?.status;
    if(status) statusCounts[status]++;
    const meaningDiff=row.before.meaning_ja!==row.after.meaning_ja;
    const paraphraseDiff=!eq(array(row.before.paraphrases),array(row.after.paraphrases));
    if(meaningDiff) meaningChanged++;
    if(paraphraseDiff) paraphraseChanged++;
    if(meaningDiff&&paraphraseDiff) bothChanged++;
    const changes=changeSummary(row.before.paraphrases,row.after.paraphrases);
    removed+=changes.removed.length;added+=changes.added.length;
  }
  return {
    authority_count:rows.length,
    ...statusCounts,
    meaning_ja_changed_entries:meaningChanged,
    paraphrase_changed_entries:paraphraseChanged,
    both_changed_entries:bothChanged,
    actual_paraphrase_removals:removed,
    actual_paraphrase_additions:added,
    final_entries_with_paraphrases:entries.filter(entry=>array(entry.paraphrases).length).length,
    final_paraphrase_string_total:entries.reduce((count,entry)=>count+array(entry.paraphrases).length,0),
    production_population:entries.length,
    unchanged_non_target_entries:entries.length-rows.length,
  };
}

function buildRows(authorityRows,productionById,dispositions,sourceAuditCommit){
  return authorityRows.map(authority=>{
    const entry=productionById.get(authority.id)?.entry;
    const disposition=dispositions.get(authority.id)||{status:'BLOCKED_DRIFT',drift_check:'DRIFT',reason:'production state does not match before or after'};
    const current=entry?fieldSurface(entry):sourceSurface(authority.before);
    const before=disposition.status==='BLOCKED_DRIFT'?current:sourceSurface(authority.before);
    const after=sourceSurface(authority.after);
    const appliedFields=[];
    if(before.meaning_ja!==after.meaning_ja) appliedFields.push('meaning_ja');
    if(!eq(before.paraphrases,after.paraphrases)) appliedFields.push('paraphrases');
    const surfaceBefore={meaning_ja:before.meaning_ja,canonical:before.canonical,paraphrases:before.paraphrases,grammarRole:before.grammarRole,sense_key:before.sense_key,answers:before.answers};
    const surfaceAfter={meaning_ja:after.meaning_ja,canonical:after.canonical,paraphrases:after.paraphrases,grammarRole:after.grammarRole,sense_key:after.sense_key,answers:after.answers};
    return {
      id:authority.id,
      decision:authority.decision,
      status:disposition.status,
      before:surfaceBefore,
      after:surfaceAfter,
      audit_before:sourceSurface(authority.before),
      audit_after:sourceSurface(authority.after),
      confidence:authority.confidence,
      source_audit_commit:sourceAuditCommit,
      reason:authority.audit_provenance.reason||`Materialized ${authority.decision} from final audit candidate authority.`,
      drift_check:disposition.drift_check,
      applied_fields:appliedFields,
      source_index:authority.source_index,
      decision_origin:authority.decision_origin,
      audit_provenance:authority.audit_provenance,
    };
  });
}

function productionState(authorityRows,productionById){
  let allBefore=true,allAfter=true,pre=0,post=0,drift=0;
  const dispositions=new Map();
  for(const row of authorityRows){
    const current=productionById.get(row.id)?.entry;
    const state=current?candidateState(current,row):{isBefore:false,isAfter:false};
    if(state.isBefore) pre++;
    if(state.isAfter) post++;
    if(!state.isBefore&&!state.isAfter) drift++;
    allBefore&&=state.isBefore;
    allAfter&&=state.isAfter;
    let status,reason;
    if(state.isAfter&&!state.isBefore){status='ALREADY_MATCHED';reason='current production matches the final audit state';}
    else if(state.isBefore&&!state.isAfter){status='APPLY';reason='current production matches the final audit before-state';}
    else if(state.isBefore&&state.isAfter){status='ALREADY_MATCHED';reason='before-state already equals final audit state';}
    else {status='BLOCKED_DRIFT';reason='current production matches neither audit before-state nor final-state';}
    dispositions.set(row.id,{status,reason,drift_check:state.isAfter&&!state.isBefore?'POST':state.isBefore?'PRE':'DRIFT'});
  }
  const state=allAfter?'POST':allBefore?'PRE':'MIXED';
  return {state,pre,post,drift,dispositions};
}

function buildSummary({authority,rows,dispositions,vocabulary}){
  const counts=dispositionSummary(rows,dispositions,vocabulary);
  return {
    schema_version:1,
    status:'MATERIALIZED',
    source_audit_commit:authority.source_audit_commit,
    current_main_base_sha:authority.current_main_base_sha,
    source_candidate_artifact_sha256:authority.source_candidate_artifact_sha256,
    audit_wide_expected_changes:authority.audit_wide_expected_changes,
    authority_count:counts.authority_count,
    APPLY:counts.APPLY,
    ALREADY_MATCHED:counts.ALREADY_MATCHED,
    BLOCKED_DRIFT:counts.BLOCKED_DRIFT,
    meaning_ja_changed_entries:counts.meaning_ja_changed_entries,
    paraphrase_changed_entries:counts.paraphrase_changed_entries,
    both_changed_entries:counts.both_changed_entries,
    final_entries_with_paraphrases:counts.final_entries_with_paraphrases,
    final_paraphrase_string_total:counts.final_paraphrase_string_total,
    actual_paraphrase_removals:counts.actual_paraphrase_removals,
    actual_paraphrase_additions:counts.actual_paraphrase_additions,
    production_population:counts.production_population,
    unchanged_non_target_entries:counts.unchanged_non_target_entries,
    learning_eligible_population:entriesOf(vocabulary).length-RETIRED_VOCABULARY_IDS.filter(id=>entriesOf(vocabulary).some(entry=>entry.id===id)).length,
  };
}

function buildReconciliation({authority,authorityBytes,materialization,productionAfterBytes,nonTargetBefore,nonTargetAfter,paraphraseAfterBytes,vocabularyBefore,vocabularyAfter,semanticInventoryBytes,derivedReportBytes}){
  const authorityEntries=authority.entries;
  const meaningBefore=authorityEntries.map(row=>({id:row.id,meaning_ja:row.before.meaning_ja}));
  const meaningAfter=authorityEntries.map(row=>({id:row.id,meaning_ja:row.after.meaning_ja}));
  const paraphraseBeforeAuthority=authorityEntries.map(row=>({id:row.id,paraphrases:row.before.paraphrases}));
  const paraphraseAfterAuthority=authorityEntries.map(row=>({id:row.id,paraphrases:row.after.paraphrases}));
  const ids=idsOf(entriesOf(vocabularyAfter));
  const idOrderHash=canonicalHash(ids);
  const entriesBefore=entriesOf(vocabularyBefore),entriesAfter=entriesOf(vocabularyAfter);
  const distribution=(entries,key)=>Object.fromEntries([...new Set(entries.map(entry=>entry?.[key]))].sort().map(value=>[value,entries.filter(entry=>entry?.[key]===value).length]));
  const accounting=materialization.accounting;
  return {
    schema_version:1,
    source_audit_commit:authority.source_audit_commit,
    source_audit_branch:authority.source_audit_branch,
    current_main_base_sha:authority.current_main_base_sha,
    source_candidate_artifact_sha256:authority.source_candidate_artifact_sha256,
    authority_sha256:sha256(authorityBytes),
    production_before_sha256:materialization.production_before_sha256,
    production_after_sha256:sha256(productionAfterBytes),
    vocabulary_non_target_projection_before_sha256:canonicalHash(nonTargetBefore),
    vocabulary_non_target_projection_after_sha256:canonicalHash(nonTargetAfter),
    vocabulary_allowed_field_projection_before_sha256:canonicalHash(projectionWithoutAllowedFields(vocabularyBefore,authorityEntries)),
    vocabulary_allowed_field_projection_after_sha256:canonicalHash(projectionWithoutAllowedFields(vocabularyAfter,authorityEntries)),
    id_order_sha256_before:canonicalHash(idsOf(entriesOf(vocabularyBefore))),
    id_order_sha256_after:idOrderHash,
    production_population_before:entriesBefore.length,
    production_population_after:entriesAfter.length,
    kind_counts_before:distribution(entriesBefore,'kind'),
    kind_counts_after:distribution(entriesAfter,'kind'),
    grammar_role_distribution_before:distribution(entriesBefore,'grammarRole'),
    grammar_role_distribution_after:distribution(entriesAfter,'grammarRole'),
    learning_exclusion_ids:[...RETIRED_VOCABULARY_IDS],
    learning_eligible_population_after:entriesAfter.length-RETIRED_VOCABULARY_IDS.filter(id=>entriesAfter.some(entry=>entry.id===id)).length,
    paraphrase_authority_before_sha256:canonicalHash(paraphraseBeforeAuthority),
    paraphrase_authority_after_sha256:canonicalHash(paraphraseAfterAuthority),
    meaning_authority_before_sha256:canonicalHash(meaningBefore),
    meaning_authority_after_sha256:canonicalHash(meaningAfter),
    paraphrase_mirror_before_sha256:materialization.paraphrase_mirror_before_sha256,
    paraphrase_mirror_after_sha256:sha256(paraphraseAfterBytes),
    semantic_inventory_after_sha256:sha256(semanticInventoryBytes),
    derived_vocabulary_report_after_sha256:sha256(derivedReportBytes),
    materialization_accounting:accounting,
  };
}

function writeJson(relative,value){
  fs.writeFileSync(path.join(ROOT,relative),`${JSON.stringify(value,null,2)}\n`);
}

function readCurrent(){
  return {
    authorityBytes:readBytes(AUTHORITY_PATH),
    authority:readJson(AUTHORITY_PATH),
    productionBytes:readBytes(VOCABULARY_PATH),
    vocabulary:readJson(VOCABULARY_PATH),
    paraphraseBytes:readBytes(PARAPHRASE_AUDIT_PATH),
    paraphraseAudit:readJson(PARAPHRASE_AUDIT_PATH),
  };
}

function inspect(){
  const errors=[];
  let loaded;
  try{loaded=readCurrent();}catch(error){return {errors:[error.message],state:'MIXED',pre:0,post:0,drift:EXPECTED_CANDIDATE_COUNT,authorityRows:[],dispositions:new Map(),loaded:null};}
  const {authority,vocabulary}=loaded;
  const authorityResult=validateAuthority(authority,vocabulary,errors);
  const rows=authorityResult.rows;
  const population=validatePopulation(vocabulary,rows,errors);
  const productionById=population?.byId||new Map();
  const state=productionState(rows,productionById);
  const nextVocabulary=expectedAfterVocabulary(vocabulary,rows);
  const nextPopulation=validatePopulation(nextVocabulary,rows,errors);
  if(population&&nextPopulation){
    if(!eq(population.ids,nextPopulation.ids)) pushError(errors,'population ID order changed during materialization');
    if(!eq(population.kindCounts,nextPopulation.kindCounts)) pushError(errors,'kind distribution changed during materialization');
    if(!eq(population.grammarRoleCounts,nextPopulation.grammarRoleCounts)) pushError(errors,'grammarRole distribution changed during materialization');
    if(!population.byId.has('vocab:00947')) pushError(errors,'toil exclusion source entry vocab:00947 is missing');
  }
  const beforeEntries=entriesOf(vocabulary)||[];
  const afterEntries=entriesOf(nextVocabulary)||[];
  const beforeById=new Map(beforeEntries.map(entry=>[entry.id,entry]));
  const afterById=new Map(afterEntries.map(entry=>[entry.id,entry]));
  let allowedFieldErrors=0;
  for(const row of rows){
    const before=beforeById.get(row.id),after=afterById.get(row.id);
    if(!before||!after) continue;
    if(after.canonical!==before.canonical||after.sense_key!==before.sense_key||after.grammarRole!==before.grammarRole||!eq(array(after.answers),array(before.answers))) allowedFieldErrors++;
  }
  if(allowedFieldErrors) pushError(errors,`forbidden field differences in target entries: ${allowedFieldErrors}`);
  if(!eq(projectionWithoutAllowedFields(vocabulary,rows),projectionWithoutAllowedFields(nextVocabulary,rows))) pushError(errors,'production diff includes fields outside meaning_ja/paraphrases for 551 authority entries');
  if(!eq(nonTargetProjection(vocabulary,rows),nonTargetProjection(nextVocabulary,rows))) pushError(errors,'non-target production entries changed');
  validateCurrentParaphraseProjection(loaded.paraphraseAudit,beforeEntries,errors);
  const nextAudit=buildParaphraseAudit(loaded.paraphraseAudit,afterEntries);
  if(!eq(withoutCurrentAuditProjection(loaded.paraphraseAudit),withoutCurrentAuditProjection(nextAudit))) pushError(errors,'historical paraphrase audit projection would change');
  const finalErrors=[];
  validateWholeVocabulary(nextVocabulary,rows,finalErrors);
  if(finalErrors.length) errors.push(...finalErrors);
  const dispositions=new Map(state.dispositions);
  const dispositionCounts={APPLY:0,ALREADY_MATCHED:0,BLOCKED_DRIFT:0};
  for(const value of dispositions.values()) dispositionCounts[value.status]++;
  return {
    ...loaded,
    errors,
    state:state.state,
    pre:state.pre,
    post:state.post,
    drift:state.drift,
    authorityRows:rows,
    productionById,
    dispositions,
    dispositionCounts,
    population,
    nextVocabulary,
    nextParaphraseAudit:nextAudit,
  };
}

function display(result){
  const rows=result.authorityRows||[];
  const operationSummary=rows.length&&result.loaded!==null
    ?dispositionSummary(rows,result.dispositions,result.vocabulary)
    :{};
  const meaningChanges=rows.filter(row=>row.before.meaning_ja!==row.after.meaning_ja).length;
  const paraphraseChanges=rows.filter(row=>!eq(row.before.paraphrases,row.after.paraphrases)).length;
  const removed=rows.reduce((count,row)=>count+changeSummary(row.before.paraphrases,row.after.paraphrases).removed.length,0);
  const added=rows.reduce((count,row)=>count+changeSummary(row.before.paraphrases,row.after.paraphrases).added.length,0);
  console.log(JSON.stringify({
    state:result.state,
    authority_entries:rows.length||EXPECTED_CANDIDATE_COUNT,
    PRE:result.pre,
    POST:result.post,
    DRIFT:result.drift,
    APPLY:result.dispositionCounts?.APPLY||0,
    ALREADY_MATCHED:result.dispositionCounts?.ALREADY_MATCHED||0,
    BLOCKED_DRIFT:result.dispositionCounts?.BLOCKED_DRIFT||0,
    meaning_changes:meaningChanges,
    paraphrase_changes:paraphraseChanges,
    removed_paraphrase_count:removed,
    added_paraphrase_count:added,
    structural_errors:result.errors.length,
    structural_error_messages:result.errors,
    current_final_entries_with_paraphrases:operationSummary.final_entries_with_paraphrases,
    current_final_paraphrase_string_total:operationSummary.final_paraphrase_string_total,
  },null,2));
}

function buildMaterialization({inspection,statusOverrides=null,stateBefore=null,productionBeforeHash=null,paraphraseBeforeHash=null,paraphraseAfterBytes,productionAfterBytes}){
  const dispositions=statusOverrides||inspection.dispositions;
  const materializedRows=buildRows(inspection.authorityRows,inspection.productionById,dispositions,inspection.authority.source_audit_commit);
  const accounting={APPLY:0,ALREADY_MATCHED:0,BLOCKED_DRIFT:0,total:materializedRows.length};
  for(const row of materializedRows) accounting[row.status]++;
  const result={
    schema_version:1,
    status:accounting.BLOCKED_DRIFT?'MATERIALIZED_WITH_BLOCKED':'MATERIALIZED',
    source_audit_commit:inspection.authority.source_audit_commit,
    source_audit_branch:inspection.authority.source_audit_branch,
    current_main_base_sha:inspection.authority.current_main_base_sha,
    source_candidate_artifact_sha256:inspection.authority.source_candidate_artifact_sha256,
    authority_sha256:sha256(inspection.authorityBytes),
    state_before:stateBefore||inspection.state,
    state_after:'POST',
    production_before_sha256:productionBeforeHash||sha256(inspection.productionBytes),
    production_after_sha256:sha256(productionAfterBytes),
    paraphrase_mirror_before_sha256:paraphraseBeforeHash||sha256(inspection.paraphraseBytes),
    paraphrase_mirror_after_sha256:sha256(paraphraseAfterBytes),
    accounting,
    entries:materializedRows,
  };
  return result;
}

function buildArtifactsFromPost({inspection,materialization,productionAfterBytes,paraphraseAfterBytes,vocabularyBefore,vocabularyAfter}){
  const summary=buildSummary({authority:inspection.authority,rows:inspection.authorityRows,dispositions:new Map(materialization.entries.map(row=>[row.id,{status:row.status}])),vocabulary:vocabularyAfter});
  const semanticBytes=readBytes(SEMANTIC_INVENTORY_PATH);
  const reportBytes=readBytes(REPORT_PATH);
  const reconciliation=buildReconciliation({
    authority:inspection.authority,
    authorityBytes:inspection.authorityBytes,
    materialization,
    productionAfterBytes,
    nonTargetBefore:nonTargetProjection(vocabularyBefore,inspection.authorityRows),
    nonTargetAfter:nonTargetProjection(vocabularyAfter,inspection.authorityRows),
    paraphraseAfterBytes,
    vocabularyBefore,
    vocabularyAfter,
    semanticInventoryBytes:semanticBytes,
    derivedReportBytes:reportBytes,
  });
  return {summary,reconciliation};
}

function runDerivedSync(){
  execFileSync('npm',['run','vocab:sync-derived'],{cwd:ROOT,stdio:'inherit'});
}

function writeMaterialization(inspection){
  if(inspection.errors.length) throw new Error(`structural validation failed (${inspection.errors.length})`);
  if(inspection.dispositionCounts.BLOCKED_DRIFT>0) throw new Error('write blocked: one or more authority rows are BLOCKED_DRIFT');
  if(inspection.state==='MIXED') throw new Error('write blocked: production materializer state is MIXED');
  const snapshots=new Map(MATERIALIZATION_OUTPUTS.map(relative=>{
    const file=path.join(ROOT,relative);
    return [relative,fs.existsSync(file)?fs.readFileSync(file):null];
  }));
  try{
  const beforeBytes=inspection.productionBytes;
  const paraphraseBeforeBytes=inspection.paraphraseBytes;
  const beforeVocabulary=inspection.vocabulary;
  const nextVocabulary=inspection.state==='PRE'?inspection.nextVocabulary:inspection.vocabulary;
  const nextAudit=inspection.state==='PRE'?inspection.nextParaphraseAudit:inspection.paraphraseAudit;
  const productionBeforeHash=sha256(beforeBytes);
  if(inspection.state==='PRE'){
    writeJson(VOCABULARY_PATH,nextVocabulary);
    writeJson(PARAPHRASE_AUDIT_PATH,nextAudit);
  }
  const afterBytes=readBytes(VOCABULARY_PATH);
  const afterAuditBytes=readBytes(PARAPHRASE_AUDIT_PATH);
  const statusOverrides=new Map(inspection.authorityRows.map(row=>{
    const original=inspection.dispositions.get(row.id);
    return [row.id,{...original,status:inspection.state==='PRE'&&original?.status==='APPLY'?'APPLY':'ALREADY_MATCHED'}];
  }));
  const materialization=buildMaterialization({
    inspection,statusOverrides,stateBefore:inspection.state,
    productionBeforeHash,
    paraphraseBeforeHash:sha256(paraphraseBeforeBytes),
    paraphraseAfterBytes:afterAuditBytes,
    productionAfterBytes:afterBytes,
  });
  if(materialization.accounting.BLOCKED_DRIFT!==0||materialization.accounting.total!==EXPECTED_CANDIDATE_COUNT) throw new Error('post-write accounting is invalid');
  writeJson(MATERIALIZATION_PATH,materialization);
  if(inspection.state==='PRE') runDerivedSync();
  const reloaded=inspect();
  if(reloaded.errors.length) throw new Error(`post-write structural validation failed (${reloaded.errors.length}): ${reloaded.errors.slice(0,10).join('; ')}`);
  if(reloaded.state!=='POST') throw new Error(`post-write state must be POST; got ${reloaded.state}`);
  const finalProductionBytes=readBytes(VOCABULARY_PATH);
  const finalParaphraseBytes=readBytes(PARAPHRASE_AUDIT_PATH);
  const afterVocabulary=readJson(VOCABULARY_PATH);
  const {summary,reconciliation}=buildArtifactsFromPost({
    inspection:reloaded,materialization,
    productionAfterBytes:finalProductionBytes,
    paraphraseAfterBytes:finalParaphraseBytes,
    vocabularyBefore:beforeVocabulary,vocabularyAfter:afterVocabulary,
  });
  writeJson(SUMMARY_PATH,summary);
  writeJson(RECONCILIATION_PATH,reconciliation);
  console.log(inspection.state==='PRE'?'Single-entry nuance materialization written.':'Production already matches authority; materialization records reconciled.');
  console.log(JSON.stringify(summary,null,2));
  }catch(error){
    const rollbackErrors=[];
    for(const [relative,bytes] of snapshots){
      const file=path.join(ROOT,relative);
      try{
        if(bytes===null){if(fs.existsSync(file)) fs.rmSync(file,{force:true});}
        else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
      }catch(rollbackError){rollbackErrors.push(`${relative}: ${rollbackError.message}`);}
    }
    const suffix=rollbackErrors.length?`; rollback errors: ${rollbackErrors.join(', ')}`:'';
    throw new Error(`materialization transaction rolled back: ${error.message}${suffix}`);
  }
}

function checkMaterialization(inspection){
  const materialization=readJson(MATERIALIZATION_PATH);
  if(inspection.state!=='POST') throw new Error(`--check requires POST state; got ${inspection.state}`);
  if(inspection.errors.length) throw new Error(`structural validation failed (${inspection.errors.length}): ${inspection.errors.slice(0,10).join('; ')}`);
  const records=array(materialization.entries);
  if(materialization.schema_version!==1||materialization.source_audit_commit!==EXPECTED_AUDIT_COMMIT||materialization.source_audit_branch!==EXPECTED_AUDIT_BRANCH) throw new Error('materialization schema/source authority mismatch');
  if(records.length!==EXPECTED_CANDIDATE_COUNT||new Set(records.map(row=>row.id)).size!==EXPECTED_CANDIDATE_COUNT) throw new Error('materialization must cover 551 unique entries');
  if(materialization.status!=='MATERIALIZED'||!['PRE','POST'].includes(materialization.state_before)||materialization.state_after!=='POST') throw new Error('materialization state/status mismatch');
  if(!eq(records.map(row=>row.id),inspection.authorityRows.map(row=>row.id))) throw new Error('materialization row order differs from authority');
  if(materialization.current_main_base_sha!==inspection.authority.current_main_base_sha||materialization.source_candidate_artifact_sha256!==inspection.authority.source_candidate_artifact_sha256||materialization.authority_sha256!==sha256(inspection.authorityBytes)) throw new Error('materialization base/source/authority fingerprint mismatch');
  if(!HEX256.test(String(materialization.production_before_sha256||''))||!HEX256.test(String(materialization.paraphrase_mirror_before_sha256||''))) throw new Error('materialization before fingerprints are missing');
  const accounting={APPLY:0,ALREADY_MATCHED:0,BLOCKED_DRIFT:0,total:records.length};
  const recordById=new Map(records.map(row=>[row.id,row]));
  for(const record of records){
    if(!['APPLY','ALREADY_MATCHED','BLOCKED_DRIFT'].includes(record.status)) throw new Error(`${record.id}: invalid disposition`);
    accounting[record.status]++;
    const authority=inspection.authorityRows.find(row=>row.id===record.id);
    const production=inspection.productionById.get(record.id)?.entry;
    if(!authority||!production) throw new Error(`${record.id}: materialization target missing`);
    if(!eq(record.audit_before,sourceSurface(authority.before))||!eq(record.audit_after,sourceSurface(authority.after))) throw new Error(`${record.id}: audit before/after authority mismatch`);
    if(!eq(record.before,sourceSurface(authority.before))) throw new Error(`${record.id}: production before-state differs from effective audit before-state`);
    if(!eq(record.after,sourceSurface(authority.after))||!eq(visibleSurface(production),visibleSurface(authority.after))) throw new Error(`${record.id}: post-state differs from authority`);
    if(record.before?.grammarRole!==record.after?.grammarRole) throw new Error(`${record.id}: grammarRole changed`);
    if(record.before?.canonical!==record.after?.canonical) throw new Error(`${record.id}: canonical changed`);
    if(record.before?.sense_key!==record.after?.sense_key) throw new Error(`${record.id}: sense_key changed`);
    if(!eq(record.before?.answers,record.after?.answers)) throw new Error(`${record.id}: answers changed`);
    if(!Array.isArray(record.applied_fields)||record.applied_fields.some(field=>!['meaning_ja','paraphrases'].includes(field))) throw new Error(`${record.id}: applied_fields contains forbidden field`);
    const expectedApplied=[];
    if(record.before.meaning_ja!==record.after.meaning_ja) expectedApplied.push('meaning_ja');
    if(!eq(record.before.paraphrases,record.after.paraphrases)) expectedApplied.push('paraphrases');
    if(!eq(record.applied_fields,expectedApplied)) throw new Error(`${record.id}: applied_fields does not match actual allowed field changes`);
  }
  if(!eq(materialization.accounting,accounting)||accounting.APPLY+accounting.ALREADY_MATCHED+accounting.BLOCKED_DRIFT!==EXPECTED_CANDIDATE_COUNT||accounting.BLOCKED_DRIFT!==0) throw new Error('materialization disposition accounting mismatch');
  if(materialization.state_after!=='POST'||materialization.production_after_sha256!==sha256(inspection.productionBytes)) throw new Error('materialization after fingerprint mismatch');
  if(materialization.paraphrase_mirror_after_sha256!==sha256(readBytes(PARAPHRASE_AUDIT_PATH))) throw new Error('materialization paraphrase mirror after fingerprint mismatch');
  validateParaphraseAuditMirror(inspection.paraphraseAudit,entriesOf(inspection.vocabulary),inspection.errors);
  if(inspection.errors.length) throw new Error(`structural validation failed (${inspection.errors.length}): ${inspection.errors.slice(0,10).join('; ')}`);
  const beforeVocabulary=jsonClone(inspection.vocabulary);
  const beforeEntries=entriesOf(beforeVocabulary);
  const beforeById=new Map(beforeEntries.map(entry=>[entry.id,entry]));
  for(const record of records){
    const entry=beforeById.get(record.id);
    entry.meaning_ja=record.before.meaning_ja;
    const phrases=array(record.before.paraphrases);
    if(phrases.length) entry.paraphrases=[...phrases];
    else delete entry.paraphrases;
  }
  const {summary,reconciliation}=buildArtifactsFromPost({
    inspection,materialization,
    productionAfterBytes:inspection.productionBytes,
    paraphraseAfterBytes:readBytes(PARAPHRASE_AUDIT_PATH),
    vocabularyBefore:beforeVocabulary,vocabularyAfter:inspection.vocabulary,
  });
  const committedSummary=readJson(SUMMARY_PATH);
  const committedReconciliation=readJson(RECONCILIATION_PATH);
  if(!eq(committedSummary,summary)) throw new Error('summary.json differs from deterministic materialization summary');
  if(committedReconciliation.production_before_sha256!==materialization.production_before_sha256||committedReconciliation.paraphrase_mirror_before_sha256!==materialization.paraphrase_mirror_before_sha256) throw new Error('reconciliation before fingerprints differ from materialization record');
  if(!eq(committedReconciliation,reconciliation)) throw new Error('reconciliation.json differs from deterministic output');
  console.log('Single-entry nuance materializer check: PASS');
  console.log(JSON.stringify({accounting,production_population:entriesOf(inspection.vocabulary).length,final_entries_with_paraphrases:summary.final_entries_with_paraphrases,final_paraphrase_string_total:summary.final_paraphrase_string_total,semantic_inventory_sha256:sha256(readBytes(SEMANTIC_INVENTORY_PATH))},null,2));
}

function main(){
  const args=process.argv.slice(2);
  const allowed=new Set(['--dry-run','--write','--check']);
  if(args.length>1||args.some(arg=>!allowed.has(arg))) throw new Error('Usage: node scripts/vocabulary/materialize-single-entry-nuance-remediation.mjs [--dry-run|--write|--check]');
  const mode=args[0]||'--dry-run';
  const inspection=inspect();
  if(mode==='--check'){
    checkMaterialization(inspection);
    return;
  }
  display(inspection);
  if(inspection.errors.length) throw new Error('structural errors prevent materialization');
  if(inspection.dispositionCounts.BLOCKED_DRIFT>0) throw new Error('BLOCKED_DRIFT > 0; production write is forbidden');
  if(inspection.state==='MIXED') throw new Error('MIXED production state is a hard failure');
  if(mode==='--write'){
    if(inspection.state==='POST'&&fs.existsSync(path.join(ROOT,MATERIALIZATION_PATH))){
      console.log('Production already matches authority; --write is a no-op.');
      return;
    }
    writeMaterialization(inspection);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(`Single-entry nuance materializer FAILED: ${error.message}`);process.exitCode=1;}
}
