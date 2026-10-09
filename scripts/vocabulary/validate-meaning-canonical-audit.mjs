import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import { VOCAB_00139_ASR_REMEDIATION } from './vocabularyEntryRemediationAuthority.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'data/audits/vocabulary-v3-meaning-canonical');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const manifest=read(path.join(dir,'manifest.json'));
const baseline={entries:manifest.baseline_entries};
const original=new Map(baseline.entries.map(e=>[e.id,e]));
const fields=['canonical','sense_key','meaning_ja'];
const pick=e=>Object.fromEntries(fields.map(f=>[f,e[f]]));
const errors=[],rows=[],assigned=new Set();
const check=(ok,message)=>{if(!ok)errors.push(message);};
for(const shard of manifest.shards){
  for(const id of shard.assigned_ids){check(!assigned.has(id),`Duplicate assignment ${id}`);assigned.add(id);}
  const file=path.join(dir,`${shard.name}.json`);
  if(!fs.existsSync(file)){errors.push(`Missing shard ${shard.name}`);continue;}
  const artifact=read(file),proposals=Array.isArray(artifact)?artifact:(artifact.entries||artifact.proposals);
  check(Array.isArray(proposals),`Invalid proposals ${shard.name}`);
  if(!Array.isArray(proposals))continue;
  const ids=new Set(proposals.map(r=>r.id));
  check(ids.size===proposals.length&&ids.size===shard.assigned_ids.length&&shard.assigned_ids.every(id=>ids.has(id)),`Coverage mismatch ${shard.name}`);
  for(const row of proposals){
    const before=original.get(row.id);
    check(!!before&&shard.assigned_ids.includes(row.id),`Out-of-shard ${row.id}`);
    if(!before)continue;
    check(row.kind===before.kind,`Kind changed ${row.id}`);
    check(JSON.stringify(pick(row.before))===JSON.stringify(pick(before)),`Before mismatch ${row.id}`);
    check(['KEEP','MODIFY','UNRESOLVED'].includes(row.decision),`Invalid decision ${row.id}`);
    check(typeof row.reason==='string'&&row.reason.trim().length>0,`Missing reason ${row.id}`);
    check(row.confidence!=null,`Missing confidence ${row.id}`);
    for(const field of fields)check(typeof row.after?.[field]==='string'&&row.after[field].trim(),`Empty ${field} ${row.id}`);
    const unchanged=JSON.stringify(pick(row.before))===JSON.stringify(pick(row.after));
    check(row.decision==='UNRESOLVED'||(row.decision==='KEEP')===unchanged,`Decision/diff mismatch ${row.id}`);
    rows.push(row);
  }
}
check(assigned.size===2478&&baseline.entries.every(e=>assigned.has(e.id)),'Assignment does not cover frozen population');
check(rows.length===2478&&new Set(rows.map(r=>r.id)).size===2478,'Review does not cover frozen population');
const reconciliationFile=path.join(dir,'reconciliation.json');
let effective=rows;
if(fs.existsSync(reconciliationFile)){
  const reconciliation=read(reconciliationFile),overrides=new Map((reconciliation.overrides||[]).map(r=>[r.id,r]));
  check(overrides.size===(reconciliation.overrides||[]).length,'Duplicate reconciliation overrides');
  for(const [id,row] of overrides){check(original.has(id),`Unknown override ${id}`);check(!!row.reason,`Override missing reason ${id}`);}
  effective=rows.map(row=>overrides.has(row.id)?{...row,...overrides.get(row.id)}:row);
}
const productionExpected=new Map(effective.map(row=>[row.id,{...row,after:{...row.after}}]));
const paraphraseAuditDir=path.join(root,'data/audits/vocabulary-paraphrase-rule-consistency');
const materializationFile=path.join(paraphraseAuditDir,'materialization.json');
if(fs.existsSync(materializationFile)){
  const materialization=read(materializationFile);
  const confirmed=read(path.join(paraphraseAuditDir,'confirmed.json'));
  const confirmedById=new Map(confirmed.map(row=>[row.id,row]));
  const materialized=Array.isArray(materialization.entries)?materialization.entries:[];
  const accounted=(materialization.accounting?.APPLY||0)+(materialization.accounting?.ALREADY_RESOLVED||0)+(materialization.accounting?.BLOCKED||0);
  const hasBlocked=materialization.accounting?.BLOCKED>0;
  check(materialization.schema_version===1&&materialization.status===(hasBlocked?'MATERIALIZED_WITH_BLOCKED':'MATERIALIZED'),'Paraphrase remediation materialization schema/status mismatch');
  check(materialization.accounting?.total===56&&accounted===56&&materialized.length===56&&materialized.filter(row=>row.status==='APPLY').length===materialization.accounting?.APPLY&&materialized.filter(row=>row.status==='BLOCKED').length===materialization.accounting?.BLOCKED&&materialized.filter(row=>row.status==='ALREADY_RESOLVED').length===materialization.accounting?.ALREADY_RESOLVED,'Paraphrase remediation accounting must cover all 56 rows');
  check(confirmed.length===56&&confirmedById.size===56,'Paraphrase remediation must use 56 unique confirmed audit rows');
  check(materialization.source_audit?.commit==='b1c93dfc4f455e55bf58db34942a7857b68777e9','Paraphrase remediation source commit mismatch');
  const seenMaterialized=new Set();
  for(const row of materialized){
    const authority=confirmedById.get(row.id);
    const expected=productionExpected.get(row.id);
    if(seenMaterialized.has(row.id)) check(false,`Duplicate paraphrase remediation ${row.id}`);
    seenMaterialized.add(row.id);
    check(!!authority&&authority.status==='CONFIRMED',`Paraphrase remediation is not CONFIRMED ${row.id}`);
    check(!!expected,`Paraphrase remediation is outside the frozen meaning/canonical audit population ${row.id}`);
    if(!authority||!expected) continue;
    check(row.before?.meaning_ja===authority.prompt_ja&&row.before?.canonical===authority.target,`Paraphrase remediation before-state differs from confirmed snapshot ${row.id}`);
    check(expected.after.meaning_ja===row.before.meaning_ja&&expected.after.canonical===row.before.canonical,`Paraphrase remediation does not supersede the prior semantic authority from its audited state ${row.id}`);
    if(row.status==='APPLY'){
      expected.after.meaning_ja=row.after.meaning_ja;
      expected.after.canonical=row.after.canonical;
    }else if(row.status==='BLOCKED'){
      check(!!row.block_reason&&row.after.meaning_ja===row.before.meaning_ja&&row.after.canonical===row.before.canonical,'Blocked paraphrase row must preserve its audited production before-state');
    }else if(row.status==='ALREADY_RESOLVED'){
      check(row.after.meaning_ja===row.before.meaning_ja&&row.after.canonical===row.before.canonical,'Already resolved paraphrase row must preserve its current production surface');
    }else check(false,`Invalid paraphrase materialization status ${row.id}`);
  }
  check(seenMaterialized.size===confirmedById.size&&[...confirmedById.keys()].every(id=>seenMaterialized.has(id)),'Paraphrase remediation ID set differs from CONFIRMED authority');
}
const prior139=productionExpected.get(VOCAB_00139_ASR_REMEDIATION.id);
if(prior139){
  const matchesBefore=prior139.after.canonical===VOCAB_00139_ASR_REMEDIATION.before.canonical&&prior139.after.meaning_ja===VOCAB_00139_ASR_REMEDIATION.before.meaning_ja;
  const matchesAfter=prior139.after.canonical===VOCAB_00139_ASR_REMEDIATION.after.canonical&&prior139.after.meaning_ja===VOCAB_00139_ASR_REMEDIATION.after.meaning_ja;
  check(matchesBefore||matchesAfter,'VOCAB_00139_ASR_REMEDIATION does not follow historical semantic authority');
  if(matchesBefore){
    prior139.after.canonical=VOCAB_00139_ASR_REMEDIATION.after.canonical;
    prior139.after.meaning_ja=VOCAB_00139_ASR_REMEDIATION.after.meaning_ja;
  }
}
const nuanceMaterializationPath=path.join(root,'data/audits/vocabulary-single-entry-nuance-materialization/materialization.json');
if(fs.existsSync(nuanceMaterializationPath)){
  const materialization=read(nuanceMaterializationPath);
  const materialized=Array.isArray(materialization.entries)?materialization.entries:[];
  const accounted=(materialization.accounting?.APPLY||0)+(materialization.accounting?.ALREADY_MATCHED||0)+(materialization.accounting?.BLOCKED_DRIFT||0);
  check(materialization.schema_version===1&&materialization.status==='MATERIALIZED'&&materialization.state_after==='POST','Single-entry nuance materialization schema/status mismatch');
  check(materialization.source_audit_commit==='ab1238bf126196aef01aef636db70e53fac34ad1','Single-entry nuance materialization source commit mismatch');
  check(materialization.accounting?.total===551&&accounted===551&&materialized.length===551&&materialization.accounting?.BLOCKED_DRIFT===0,'Single-entry nuance materialization accounting must cover 551 rows with no blocked drift');
  const nuanceById=new Map();
  for(const row of materialized){
    const id=row.id,prior=productionExpected.get(id);
    if(nuanceById.has(id)) check(false,`Duplicate single-entry nuance materialization ${id}`);
    nuanceById.set(id,row);
    check(['APPLY','ALREADY_MATCHED'].includes(row.status),`Single-entry nuance row is not approved for production ${id}`);
    check(!!prior,`Single-entry nuance row is outside the frozen meaning/canonical population ${id}`);
    if(!prior) continue;
    check(row.before?.meaning_ja===prior.after.meaning_ja&&row.before?.canonical===prior.after.canonical&&row.before?.sense_key===prior.after.sense_key,`Single-entry nuance before-state does not follow existing authority layers ${id}`);
    check(row.after?.canonical===row.before?.canonical&&row.after?.sense_key===row.before?.sense_key&&row.after?.grammarRole===row.before?.grammarRole&&JSON.stringify(row.after?.answers||[])===JSON.stringify(row.before?.answers||[]),`Single-entry nuance changed a forbidden semantic field ${id}`);
    check(row.audit_after?.meaning_ja===row.after?.meaning_ja&&row.audit_after?.canonical===row.after?.canonical,`Single-entry nuance after-state differs from audit authority ${id}`);
    prior.after.meaning_ja=row.after.meaning_ja;
  }
  check(nuanceById.size===551,'Single-entry nuance materialization does not contain 551 unique rows');
}
const report={assigned:assigned.size,reviewed:rows.length,KEEP:0,MODIFY:0,UNRESOLVED:0,kind_counts:{word:0,expression:0,construction:0},canonical_modifications:0,meaning_ja_modifications:0,sense_key_modifications:0,known_placeholders_reviewed:0,placeholder_meaning_remaining:0};
const seen=new Set();
for(const row of effective){
  report[row.decision]++;report.kind_counts[row.kind]++;
  for(const f of fields)if(row.before[f]!==row.after[f])report[`${f}_modifications`]++;
  if(manifest.known_placeholder_ids.includes(row.id))report.known_placeholders_reviewed++;
  if(/意味監査待ち/.test(row.after.meaning_ja))report.placeholder_meaning_remaining++;
  check(/^[a-z][a-z0-9_]*$/.test(row.after.sense_key)&&!/^pending_admission_/.test(row.after.sense_key),`Unresolved sense key ${row.id}`);
  const key=row.after.canonical.toLowerCase()+'\0'+row.after.sense_key;
  check(!seen.has(key),`Duplicate canonical/sense ${row.id}`);seen.add(key);
}
check(report.UNRESOLVED===0,'Unresolved semantic decisions remain');
check(report.placeholder_meaning_remaining===0,'Placeholder meanings remain');
check(report.known_placeholders_reviewed===330,'Known placeholder coverage differs');
if(process.argv.includes('--check-production')){
  const production=read(path.join(root,'data/vocabulary-v3.json'));
  const byId=productionExpected;
  check(JSON.stringify(production.entries.map(e=>[e.id,e.kind]))===JSON.stringify(baseline.entries.map(e=>[e.id,e.kind])),'Population/ID/kind/order changed');
  for(const entry of production.entries){
    const frozen=byId.get(entry.id)?.after||{};
    check(JSON.stringify(pick(entry))===JSON.stringify(pick(frozen)),`Production proposal mismatch ${entry.id}`);
    const strip=e=>Object.fromEntries(Object.entries(e).filter(([k])=>!fields.includes(k)));
    if(process.argv.includes('--check-integration-scope')){
      const digest=crypto.createHash('sha256').update(JSON.stringify(strip(entry))).digest('hex');
      check(digest===original.get(entry.id)?.nonsemantic_sha256,'Non-semantic mutation '+entry.id);
    }
  }
}
console.log(JSON.stringify({status:errors.length?'FAIL':'PASS',report,errors},null,2));
if(errors.length)process.exitCode=1;
