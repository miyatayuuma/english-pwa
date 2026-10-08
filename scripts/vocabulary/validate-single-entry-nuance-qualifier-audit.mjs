#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo,"data/audits/vocabulary-single-entry-nuance-qualifier");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root,name),"utf8"));
if(process.argv.includes("--drift-only")){
 const m=read("manifest.json"),d=read("live-main-drift.json"),errors=[];
 const assert=(v,s)=>{if(!v)errors.push(s)},unique=a=>Array.isArray(a)&&new Set(a).size===a.length;
 const sem=d.changes.find(x=>x.entry_id==="vocab:00139"),elig=d.changes.find(x=>x.entry_id==="vocab:00947");
 assert(d.audit_base_sha===m.audit_base_main_sha,"audit base");
 assert(d.current_main_sha===m.current_main_sha,"current main SHA");
 assert(d.previous_audit_head===m.reconciled_from_audit_head,"previous audit head");
 assert(d.summary.global_authority_drift===false,"global authority drift");
 assert(d.summary.source_population===2478&&m.population===2478&&m.source_population===2478,"source population");
 assert(d.summary.learning_eligible_population===2477&&m.learning_eligible_population===2477,"learning population");
 assert(d.summary.excluded_from_learning===1&&unique(d.excluded_learning_entry_ids)&&d.excluded_learning_entry_ids.length===1&&d.excluded_learning_entry_ids[0]==="vocab:00947","learning exclusion");
 assert(d.summary.semantic_entry_drift_count===1&&d.summary.learning_eligibility_drift_count===1,"drift counts");
 assert(d.summary.non_semantic_change_count===6,"non-semantic count");
 assert(unique(d.initial_stale_entry_ids)&&d.initial_stale_entry_ids.length===1&&d.initial_stale_entry_ids[0]==="vocab:00139","initial stale IDs");
 assert(unique(d.stale_entry_ids)&&d.stale_entry_ids.length===0,"remaining stale IDs");
 assert(unique(d.revalidated_entry_ids)&&d.revalidated_entry_ids.length===1&&d.revalidated_entry_ids[0]==="vocab:00139","revalidated IDs");
 assert(sem&&sem.old_snapshot.canonical==="no sooner had I sat down than the phone rang"&&sem.current_snapshot.canonical==="no sooner had I arrived than the phone rang","00139 snapshots");
 assert(sem?.revalidation?.decision==="QUALIFIER_ONLY"&&sem?.revalidation?.source_status==="REVALIDATED","00139 revalidation");
 assert(elig&&elig.semantic_relevance==="LEARNING_ELIGIBILITY_ONLY"&&elig.current_snapshot.learning_eligible===false,"00947 eligibility");
 assert(d.summary.reviewed===m.reviewed&&d.summary.unreviewed===m.unreviewed,"progress accounting");
 assert(d.summary.reviewed===194&&d.summary.unreviewed===2284,"resume progress");
 assert(d.summary.batch_count===25&&d.summary.batch_status_preserved,"batch accounting");
 if(errors.length){console.error("FAIL [drift-only] ("+errors.length+"): "+errors.join("; "));process.exitCode=1;}
 else console.log("PASS [drift-only] main="+d.current_main_sha+" source=2478 learningEligible=2477 reviewed="+m.reviewed+" unreviewed="+m.unreviewed+" stale=0");
}else{
const snapshot = fs.readFileSync(path.join(repo,"data/vocabulary-v3.json"));
const entries = JSON.parse(snapshot).entries;
const m=read("manifest.json"), ix=read("decisions.json").entries, prev=read("previous-near-synonym-authority.json").entries, mem=read("previous-group-membership.json").entries;
const newJ=read("authored-judgments.json"), existing=read("existing-parentheses-review.json").entries, rem=read("remediation-candidates.json").entries, upstream=read("upstream-review.json"), conflicts=read("cross-audit-conflicts.json");
const prior=new Map(prev.map(x=>[x.id,x])), memberships=new Map(mem.map(x=>[x.id,x.groups])), fresh=new Map(newJ.map(x=>[x.id,x])), parenthesis=new Map(existing.map(x=>[x.id,x]));
const errors=[], assert=(v,s)=>{if(!v)errors.push(s)};
assert(entries.length===2478&&ix.length===2478&&m.population===2478,"population");
assert(crypto.createHash("sha256").update(snapshot).digest("hex")===m.current_source_snapshot.sha256,"source SHA256 drift");
assert(new Set(entries.map(x=>x.id)).size===2478,"source duplicate IDs");
assert(m.batch_size===100&&m.batch_count===25,"batch manifest");
assert(prev.length===104&&newJ.length===46&&existing.length===38&&conflicts.length===5&&upstream.length===7&&m.existing_parentheses_reviewed===38,"authority import counts");
const decisionEnum=new Set(["KEEP","QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE","PARAPHRASE_REVALIDATION_ONLY","UPSTREAM_AUTHORITY_REVIEW"]);
let pending=0, reviewed=0, duplicate=new Set();const stats={};
for(let b=0;b<25;b++){
 const name="batches/batch-"+String(b+1).padStart(3,"0")+".json", content=fs.readFileSync(path.join(root,name),"utf8"),rows=JSON.parse(content),start=b*100;
 assert(rows.length===Math.min(100,2478-start),"batch count "+name);
 assert(content===JSON.stringify(rows,null,2)+"\n","non-deterministic JSON serialization "+name);
 for(let j=0;j<rows.length;j++){
  const i=start+j,s=entries[i],r=rows[j],x=ix[i],pg=memberships.get(r.id)||[],p=prior.get(r.id),n=fresh.get(r.id),q=parenthesis.get(r.id);
  assert(!!s&&s.id===r.id&&x.id===r.id&&r.source_index===i+1&&x.index===i+1,"ID/order "+i);
  assert(!duplicate.has(r.id),"duplicate "+r.id);duplicate.add(r.id);
  assert(r.canonical===s.canonical&&r.current_meaning_ja===s.meaning_ja&&r.grammarRole===s.grammarRole&&r.sense_key===s.sense_key&&JSON.stringify(r.current_paraphrases)===JSON.stringify(s.paraphrases||[]),"source snapshot "+r.id);
  assert(r.review_status===x.status&&r.single_entry_decision===x.classification,"review index drift "+r.id);
  assert(r.previous_near_synonym_authority===(pg.some(y=>y.classification==="PROMPT_AND_PARAPHRASE")?"PROMPT_AND_PARAPHRASE":pg.some(y=>y.classification==="KEEP")?"KEEP":"NONE"),"previous authority membership "+r.id);
  assert(JSON.stringify(r.previous_near_synonym_group_ids)===JSON.stringify(pg.map(y=>y.group_id)),"previous authority groups "+r.id);
  stats[r.review_status]=(stats[r.review_status]||0)+1;
  if(r.review_status==="PENDING"){pending++;assert(r.single_entry_decision===null&&r.recommended_prompt===null,"pending auto-KEEP "+r.id);continue}
  reviewed++;
  if(r.review_status==="CROSS_AUDIT_CONFLICT"){assert(r.single_entry_decision===null,"unresolved conflict classified "+r.id);continue}
  assert(decisionEnum.has(r.single_entry_decision),"invalid enum "+r.id);
  if(["QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE"].includes(r.single_entry_decision))assert(typeof r.recommended_prompt==="string"&&r.recommended_prompt!==r.current_meaning_ja,"qualified prompt missing "+r.id);
  if(["QUALIFIER_AND_PARAPHRASE","PARAPHRASE_REVALIDATION_ONLY"].includes(r.single_entry_decision))assert(JSON.stringify(r.current_paraphrases)!==JSON.stringify(r.recommended_paraphrases),"paraphrase diff missing "+r.id);
  if(r.single_entry_decision==="UPSTREAM_AUTHORITY_REVIEW")assert(r.review_status==="UPSTREAM_ISOLATED"&&r.recommended_paraphrases===null,"upstream in remediation "+r.id);
  if(p)assert(r.review_status==="PREVIOUS_AUTHORITY_CONFIRMED"&&r.recommended_prompt===p.recommended_prompt&&JSON.stringify(r.recommended_paraphrases)===JSON.stringify(p.recommended_paraphrases),"previous authority changed "+r.id);
  if(n)assert(r.review_status===n.status&&r.reason===n.reason&&r.confidence===n.confidence,"authored judgment drift "+r.id);
  if(q)assert(r.review_status==="REVIEWED"&&r.single_entry_decision===q.decision&&r.reason===q.reason&&r.confidence===q.confidence&&JSON.stringify(r.recommended_paraphrases)===JSON.stringify(q.recommended_paraphrases),"existing parentheses review drift "+r.id);
 }
}
assert(duplicate.size===2478&&pending===m.unreviewed&&reviewed===m.reviewed,"population accounting");
for(const [k,v] of Object.entries(stats))assert(m.review_status_counts[k]===v,"status count "+k);
const isolated=new Set([...conflicts,...upstream].map(x=>x.id));
assert(rem.length===144&&rem.every(x=>x.ready_for_production===false&&x.confidence!=="LOW"&&!isolated.has(x.id)),"unsafe remediation");
assert(m.production_changed===false&&m.production_materialization_allowed===false,"production boundary");
const strict=!process.argv.includes("--allow-incomplete");
if(strict)assert(pending===0&&conflicts.length===0&&m.all_completion_conditions_met===true&&m.status==="CLOSED","incomplete semantic review; CLOSED forbidden");
if(errors.length){console.error("FAIL ["+(strict?"strict":"WIP")+"] ("+errors.length+"): "+errors.slice(0,30).join("; "));process.exitCode=1;}
else console.log("PASS ["+(strict?"strict":"WIP")+"] population=2478 reviewed="+reviewed+" unreviewed="+pending+" batches=25; strict closure="+m.status);

}
