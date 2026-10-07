import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const AUDIT_DIR=path.join(ROOT,'data/audits/vocabulary-grammar-role');
export const GRAMMAR_ROLES=Object.freeze([
  'noun','pronoun','verb','adjective','adverb','preposition','conjunction',
  'auxiliary','determiner','interjection','construction',
]);

const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));

const surfaceOf=value=>({
  meaning_ja:value?.meaning_ja,
  canonical:value?.canonical,
  paraphrases:Array.isArray(value?.paraphrases)?value.paraphrases:[],
});
const sameSurface=(left,right)=>JSON.stringify(surfaceOf(left))===JSON.stringify(surfaceOf(right));

export function validateVocabularyGrammarRoleAudit({vocabulary,manifest,batches,pendingRegistry,semanticQa,finalResolutions,pendingHistory,paraphraseManifest=null,confirmedAuthority=null,materialization=null}){
  const errors=[];
  const source=Array.isArray(vocabulary?.entries)?vocabulary.entries:[];
  const sourceById=new Map();
  for(const entry of source){
    const id=String(entry?.id||'');
    if(sourceById.has(id)) errors.push(`source: duplicate vocabulary ID ${id}`);
    sourceById.set(id,entry);
  }
  const auditRows=[];
  const batchIds=new Set();
  for(const batch of batches){
    if(batchIds.has(batch?.batch_id)) errors.push(`batch: duplicate batch ID ${batch?.batch_id}`);
    batchIds.add(batch?.batch_id);
    if(!Array.isArray(batch?.entries)){
      errors.push(`batch ${batch?.batch_id||'<missing>'}: entries must be an array`);
      continue;
    }
    const expected=batch.entry_order_end-batch.entry_order_start+1;
    if(batch.entries.length!==expected) errors.push(`batch ${batch.batch_id}: expected ${expected} rows, found ${batch.entries.length}`);
    for(const row of batch.entries) auditRows.push(row);
  }
  if(source.length!==manifest?.population) errors.push(`manifest: population ${manifest?.population} differs from source ${source.length}`);
  if(auditRows.length!==source.length) errors.push(`coverage: ${auditRows.length} audit rows for ${source.length} vocabulary entries`);
  if(batchIds.size!==manifest?.batch_count) errors.push(`manifest: expected ${manifest?.batch_count} batches, found ${batchIds.size}`);
  const confirmedRows=Array.isArray(confirmedAuthority)?confirmedAuthority:[];
  const confirmedById=new Map(confirmedRows.map(row=>[String(row?.id||''),row]));
  const materializationRows=Array.isArray(materialization?.entries)?materialization.entries:[];
  const materializationById=new Map();
  if(materialization){
    if(materialization.schema_version!==1||!['MATERIALIZED','MATERIALIZED_WITH_BLOCKED'].includes(materialization.status)) errors.push('paraphrase materialization: invalid schema or status');
    const accounted=(materialization.accounting?.APPLY||0)+(materialization.accounting?.ALREADY_RESOLVED||0)+(materialization.accounting?.BLOCKED||0);
    if(materialization.accounting?.total!==56||accounted!==56||materializationRows.length!==56||materialization.accounting?.APPLY!==56||materialization.accounting?.ALREADY_RESOLVED!==0||materialization.accounting?.BLOCKED!==0) errors.push('paraphrase materialization: accounting must cover 56 rows with 56 APPLY and no BLOCKED entries');
    if(paraphraseManifest?.population!==2478||paraphraseManifest?.candidate_count!==137||paraphraseManifest?.status_counts?.CONFIRMED!==56||paraphraseManifest?.status_counts?.REVIEW!==0||paraphraseManifest?.status_counts?.FALSE_POSITIVE!==81||paraphraseManifest?.unclassified_count!==0) errors.push('paraphrase materialization: source audit counts mismatch');
    if(confirmedRows.length!==56||confirmedById.size!==56) errors.push('paraphrase materialization: confirmed authority must contain 56 unique entries');
    if(materialization.source_audit?.commit!=='b1c93dfc4f455e55bf58db34942a7857b68777e9'||materialization.source_audit?.base_sha!==paraphraseManifest?.base_sha) errors.push('paraphrase materialization: source audit ref mismatch');
    for(const row of materializationRows){
      const id=String(row?.id||'');
      if(materializationById.has(id)) errors.push(`paraphrase materialization: duplicate ID ${id}`);
      materializationById.set(id,row);
      const authority=confirmedById.get(id);
      if(!authority||authority.status!=='CONFIRMED') errors.push(`paraphrase materialization: ID is not CONFIRMED ${id}`);
      if(!['APPLY','BLOCKED'].includes(row.status)||!sameSurface(row.before,{meaning_ja:authority?.prompt_ja,canonical:authority?.target,paraphrases:authority?.paraphrases})) errors.push(`paraphrase materialization: before authority mismatch ${id}`);
      if(!row.after||typeof row.after.meaning_ja!=='string'||typeof row.after.canonical!=='string'||!Array.isArray(row.after.paraphrases)) errors.push(`paraphrase materialization: invalid after surface ${id}`);
      if(row.status==='BLOCKED'&&(!row.block_reason||!sameSurface(row.after,row.before))) errors.push(`paraphrase materialization: blocked entry must retain production before-state and include a reason ${id}`);
      if(row.status==='APPLY'&&row.block_reason) errors.push(`paraphrase materialization: applied entry has a block reason ${id}`);
    }
    if(materializationById.size!==confirmedById.size||[...confirmedById.keys()].some(id=>!materializationById.has(id))) errors.push('paraphrase materialization: ID set differs from CONFIRMED authority');
  }
  const seen=new Set(),classified=new Map(),pending=new Map(),auditById=new Map();
  for(const row of auditRows){
    const id=String(row?.id||'');
    if(seen.has(id)) errors.push(`coverage: duplicate audit ID ${id}`);
    seen.add(id);
    auditById.set(id,row);
    const entry=sourceById.get(id);
    if(!entry){errors.push(`coverage: orphan audit ID ${id}`);continue;}
    const remediation=materializationById.get(id);
    if(remediation){
      if(!sameSurface(row,remediation.before)) errors.push(`paraphrase materialization: before differs from grammar-role snapshot for ${id}`);
      if(!sameSurface(entry,remediation.after)) errors.push(`paraphrase materialization: production differs from approved after-state for ${id}`);
      if(entry.grammarRole!==remediation.grammarRole||row.grammarRole!==remediation.grammarRole) errors.push(`paraphrase materialization: grammarRole changed for ${id}`);
    }else if(!sameSurface(row,entry)) errors.push(`snapshot: meaning/answer/paraphrases differ for ${id}`);
    if(row.status==='classified'){
      if(!GRAMMAR_ROLES.includes(row.grammarRole)) errors.push(`classification: invalid grammarRole for ${id}`);
      if(entry.grammarRole!==row.grammarRole) errors.push(`production: grammarRole mismatch for ${id}`);
      if(row.candidates||row.reason) errors.push(`classification: classified row ${id} has pending fields`);
      classified.set(id,row.grammarRole);
    }else if(row.status==='pending'){
      if(row.grammarRole!=null) errors.push(`pending: ${id} must not have grammarRole`);
      if(entry.grammarRole!=null) errors.push(`production: pending entry ${id} must not have grammarRole`);
      if(!Array.isArray(row.candidates)||row.candidates.length===0||row.candidates.some(value=>!GRAMMAR_ROLES.includes(value))) errors.push(`pending: invalid candidates for ${id}`);
      if(!String(row.reason||'').trim()) errors.push(`pending: missing concrete reason for ${id}`);
      pending.set(id,row);
    }else errors.push(`coverage: ${id} has invalid status ${row.status}`);
  }
  for(const id of sourceById.keys()) if(!seen.has(id)) errors.push(`coverage: missing audit ID ${id}`);
  for(const id of classified.keys()) if(pending.has(id)) errors.push(`integrity: classified/pending overlap ${id}`);
  if(classified.size!==manifest?.classified) errors.push(`manifest: classified count mismatch (${classified.size})`);
  if(pending.size!==manifest?.pending) errors.push(`manifest: pending count mismatch (${pending.size})`);
  if(classified.size+pending.size!==source.length) errors.push('coverage: classified + pending does not equal population');
  if(pendingRegistry?.audit_population!==source.length||pendingRegistry?.pending_count!==pending.size) errors.push('pending registry: population or count mismatch');
  const registryRows=Array.isArray(pendingRegistry?.entries)?pendingRegistry.entries:[];
  const registryIds=registryRows.map(row=>String(row?.id||''));
  if(new Set(registryIds).size!==registryIds.length) errors.push('pending registry: duplicate IDs');
  if(registryIds.length!==pending.size||registryIds.some(id=>!pending.has(id))||[...pending.keys()].some(id=>!registryIds.includes(id))) errors.push('pending registry: does not exactly match pending audit rows');
  for(const row of registryRows){
    const sourcePending=pending.get(row.id);
    if(!sourcePending) continue;
    if(row.review_round!==2||row.review_outcome!=='retained') errors.push(`pending registry: review state missing for ${row.id}`);
    if(JSON.stringify(row.candidates)!==JSON.stringify(sourcePending.candidates)||row.reason!==sourcePending.reason) errors.push(`pending registry: detail mismatch for ${row.id}`);
  }
  if(pending.size!==0) errors.push(`pending: final pending count must be 0, found ${pending.size}`);
  const resolvedRows=Array.isArray(finalResolutions?.entries)?finalResolutions.entries:[];
  const historyRows=Array.isArray(pendingHistory?.entries)?pendingHistory.entries:[];
  if(finalResolutions?.resolved_pending_count!==152||resolvedRows.length!==152) errors.push('final resolutions: expected 152 persisted decisions');
  if(pendingHistory?.pending_count!==152||historyRows.length!==152) errors.push('pending history: expected the original 152 pending records');
  const resolutionById=new Map(),historyById=new Map();
  for(const row of resolvedRows){
    if(resolutionById.has(row?.id)) errors.push(`final resolutions: duplicate ID ${row?.id}`);
    resolutionById.set(row?.id,row);
    if(!GRAMMAR_ROLES.includes(row?.grammarRole)) errors.push(`final resolutions: invalid role for ${row?.id}`);
    const sourceEntry=sourceById.get(row?.id),auditEntry=auditById.get(row?.id);
    if(!sourceEntry||!auditEntry){errors.push(`final resolutions: ID absent from source/audit ${row?.id}`);continue;}
    if(sourceEntry.grammarRole!==row.grammarRole||auditEntry.grammarRole!==row.grammarRole||auditEntry.status!=='classified') errors.push(`final resolutions: decision mismatch for ${row.id}`);
    const remediation=materializationById.get(row.id);
    if(remediation){
      if(!sameSurface(row,remediation.before)||!sameSurface(auditEntry,remediation.before)||!sameSurface(sourceEntry,remediation.after)) errors.push(`final resolutions: paraphrase materialization mismatch for ${row.id}`);
      if(remediation.grammarRole!==row.grammarRole) errors.push(`final resolutions: grammarRole changed by paraphrase materialization for ${row.id}`);
    }else{
      if(sourceEntry.meaning_ja!==row.meaning_ja||auditEntry.meaning_ja!==row.meaning_ja) errors.push(`final resolutions: prompt mismatch for ${row.id}`);
      if(sourceEntry.canonical!==row.canonical||auditEntry.canonical!==row.canonical) errors.push(`final resolutions: canonical mismatch for ${row.id}`);
      if(JSON.stringify(sourceEntry.paraphrases||[])!==JSON.stringify(row.paraphrases||[])||JSON.stringify(auditEntry.paraphrases||[])!==JSON.stringify(row.paraphrases||[])) errors.push(`final resolutions: paraphrases changed for ${row.id}`);
    }
    if(auditEntry.final_resolution_ref!=='final-resolutions.json'||auditEntry.resolution_reason!==row.decision_rationale) errors.push(`final resolutions: audit decision reference missing for ${row.id}`);
    if(!row.previous?.reason||!Array.isArray(row.previous?.candidates)||row.previous.candidates.length===0) errors.push(`final resolutions: prior pending evidence missing for ${row.id}`);
  }
  for(const row of historyRows){
    if(historyById.has(row?.id)) errors.push(`pending history: duplicate ID ${row?.id}`);
    historyById.set(row?.id,row);
    if(!resolutionById.has(row?.id)) errors.push(`pending history: unresolved historical ID ${row?.id}`);
  }
  if(resolutionById.size!==152||historyById.size!==152) errors.push('final resolutions/history: ID count mismatch');
  for(const [id,row] of resolutionById){
    const old=historyById.get(id);
    if(!old){errors.push(`pending history: missing old record ${id}`);continue;}
    const previous=row.previous||{};
    if(previous.meaning_ja!==old.meaning_ja||previous.canonical!==old.canonical||JSON.stringify(previous.paraphrases)!==JSON.stringify(old.paraphrases)||JSON.stringify(previous.candidates)!==JSON.stringify(old.candidates)||previous.reason!==old.reason) errors.push(`pending history: prior evidence mismatch for ${id}`);
  }
  const finalBoundaryExpectations={
    'vocab:00313':['construction','chances are'],
    'vocab:01289':['construction','be yet to do something'],
    'vocab:00520':['conjunction','when it comes to something'],
    'vocab:00622':['conjunction','as far as someone is concerned'],
    'vocab:02243':['pronoun','three in five'],
    'vocab:00666':['interjection',"what's up"],
    'vocab:01379':['interjection','no problem'],
    'vocab:01384':['interjection','why not?'],
    'vocab:00252':['interjection','be my guest'],
    'vocab:00162':['interjection','so much for something'],
    'vocab:00453':['interjection','there you go again'],
    'vocab:01606':['noun','curse'],
    'vocab:02134':['noun','reign'],
  };
  for(const [id,[role,canonical]] of Object.entries(finalBoundaryExpectations)){
    if(classified.get(id)!==role||sourceById.get(id)?.canonical?.toLocaleLowerCase('en-US')!==canonical.toLocaleLowerCase('en-US')) errors.push(`final boundary: expected ${role} for ${id}`);
  }
  if(sourceById.get('vocab:01606')?.meaning_ja!=='呪い') errors.push('final prompt: vocab:01606 must be noun-only 呪い');
  if(sourceById.get('vocab:02134')?.meaning_ja!=='（君主の）治世') errors.push('final prompt: vocab:02134 must be noun-only （君主の）治世');
  if(JSON.stringify(sourceById.get('vocab:02134')?.paraphrases)!==JSON.stringify(['rule'])) errors.push('final prompt: vocab:02134 paraphrase rule must be retained');
  for(const example of semanticQa?.representative_decisions||[]){
    if(classified.get(example.id)!==example.grammarRole) errors.push(`semantic QA: representative mismatch for ${example.id}`);
  }
  for(const group of semanticQa?.same_surface_different_usage||[]){
    for(const example of group.entries||[]) if(classified.get(example.id)!==example.grammarRole||sourceById.get(example.id)?.canonical?.toLocaleLowerCase('en-US')!==group.surface) errors.push(`semantic QA: same-surface example mismatch for ${example.id}`);
  }
  return {ok:errors.length===0,errors,population:source.length,audited:auditRows.length,classified:classified.size,pending:pending.size,distribution:Object.fromEntries(GRAMMAR_ROLES.map(role=>[role,[...classified.values()].filter(value=>value===role).length]))};
}

export function loadVocabularyGrammarRoleAudit(){
  const vocabulary=readJson(path.join(ROOT,'data/vocabulary-v3.json'));
  const manifest=readJson(path.join(AUDIT_DIR,'manifest.json'));
  const batches=fs.readdirSync(AUDIT_DIR).filter(name=>/^batch-\d{3}\.json$/.test(name)).sort().map(name=>readJson(path.join(AUDIT_DIR,name)));
  const pendingRegistry=readJson(path.join(AUDIT_DIR,'pending.json'));
  const semanticQa=readJson(path.join(AUDIT_DIR,'semantic-qa.json'));
  const finalResolutions=readJson(path.join(AUDIT_DIR,'final-resolutions.json'));
  const pendingHistory=readJson(path.join(AUDIT_DIR,'pending-history.json'));
  const paraphraseDir=path.join(ROOT,'data/audits/vocabulary-paraphrase-rule-consistency');
  const paraphraseManifest=readJson(path.join(paraphraseDir,'manifest.json'));
  const confirmedAuthority=readJson(path.join(paraphraseDir,'confirmed.json'));
  const materialization=readJson(path.join(paraphraseDir,'materialization.json'));
  return validateVocabularyGrammarRoleAudit({vocabulary,manifest,batches,pendingRegistry,semanticQa,finalResolutions,pendingHistory,paraphraseManifest,confirmedAuthority,materialization});
}

if(import.meta.url===`file://${process.argv[1]}`){
  const result=loadVocabularyGrammarRoleAudit();
  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode=1;
}
