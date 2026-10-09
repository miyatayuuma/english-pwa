#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const root=path.join(repo,"data/audits/vocabulary-single-entry-nuance-qualifier");
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const errors=[];
const assert=(value,message)=>{if(!value)errors.push(message)};
const unique=(xs)=>Array.isArray(xs)&&new Set(xs).size===xs.length;
const countBy=(xs,keyOf)=>{const out={};for(const x of xs){const k=keyOf(x);out[k]=(out[k]||0)+1;}return out;};
const allowed=new Set(["KEEP","QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE","PARAPHRASE_REVALIDATION_ONLY","UPSTREAM_AUTHORITY_REVIEW"]);
const targets=new Set(["QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE","PARAPHRASE_REVALIDATION_ONLY"]);
const sourceBytes=fs.readFileSync(path.join(repo,"data/vocabulary-v3.json"));
const sourceDoc=JSON.parse(sourceBytes),source=sourceDoc.entries;
const manifest=read("manifest.json"),decisions=read("decisions.json").entries,review=read("review-index.json");
const authors=read("authored-judgments.json"),remediation=read("remediation-candidates.json"),upstream=read("upstream-review.json"),conflicts=read("cross-audit-conflicts.json");
const live=read("live-main-drift.json"),reconciliation=read("semantic-review/reconciliation.json");
const agg=read("parallel/aggregation-report.json"),coverage=read("parallel/coverage-validation.json"),inputs=read("parallel/input-manifest.json");
const ids=source.map(x=>x.id),sourceById=new Map(source.map((x,i)=>[x.id,{entry:x,index:i+1}]));
assert(source.length===2478&&manifest.population===2478&&manifest.source_population===2478,"source population");
assert(unique(ids)&&new Set(review.map(x=>x.id)).size===2478,"source/review IDs unique");
const fixed=manifest.audit_source_snapshot??manifest.current_source_snapshot;
if(process.env.SKIP_SOURCE_SHA256!=="1")assert(crypto.createHash("sha256").update(sourceBytes).digest("hex")===fixed.sha256,"fixed source SHA256");
assert(manifest.status==="CLOSED"&&manifest.all_completion_conditions_met===true,"closure status");
assert(manifest.production_changed===false&&manifest.production_materialization_allowed===false,"production boundary");
assert(manifest.parallel_immutable_base_sha===coverage.immutable_base_sha&&coverage.immutable_base_sha==="2d60188baaceaf77c4e3370ebb37029c48201e2e","immutable parallel base");
assert(manifest.current_main_sha===live.current_main_sha&&manifest.current_main_sha===agg.current_main_sha,"current main reconciliation SHA");
assert(inputs.workers.length===10&&inputs.workers.every(w=>w.status==="COMPLETE"&&w.immutable_base_sha===coverage.immutable_base_sha&&w.production_changed===false&&/^[0-9a-f]{40}$/.test(w.head_sha)),"worker inputs");
assert(inputs.boundary_repair.status==="COMPLETE_BOUNDARY_REPAIR_NOT_GLOBAL_CLOSED"&&inputs.boundary_repair.immutable_base_sha===coverage.immutable_base_sha&&inputs.boundary_repair.production_changed===false,"boundary input state");
assert(inputs.boundary_repair.missing_expected===3&&inputs.boundary_repair.missing_reviewed===3&&inputs.boundary_repair.remaining_missing===0&&inputs.boundary_repair.aggregator_ready===true,"boundary repair counts");
assert(coverage.source_population===2478&&coverage.base_resolved_ids.length===494&&coverage.base_pending_ids.length===1984,"base coverage");
assert(unique(coverage.base_resolved_ids)&&unique(coverage.base_pending_ids)&&coverage.base_resolved_ids.every(id=>sourceById.has(id))&&coverage.base_pending_ids.every(id=>sourceById.has(id)),"base ID lists");
const baseAll=new Set([...coverage.base_resolved_ids,...coverage.base_pending_ids]);
assert(baseAll.size===2478&&ids.every(id=>baseAll.has(id)),"base partition");
assert(coverage.base_resolved_review_index.length===494&&coverage.base_resolved_review_index.every((x,i)=>x.id===coverage.base_resolved_ids[i]),"base resolved snapshot");
const baseResolvedById=new Map(coverage.base_resolved_review_index.map(x=>[x.id,x]));
const reviewById=new Map(review.map(x=>[x.id,x]));
for(const [id,baseRow] of baseResolvedById){const final=reviewById.get(id);assert(final&&final.index===baseRow.index&&final.status===baseRow.status&&final.classification===baseRow.classification,"base authority overwritten "+id);}
assert(coverage.worker_raw_count===1983&&coverage.worker_raw_id_worker_pairs.length===1983,"worker raw record count");
assert(coverage.duplicate_ids.join(",")==="vocab:00762,vocab:02052","known duplicate IDs");
const workerSet=new Set(),pairCounts=new Map(),pairsById=new Map();
for(const pair of coverage.worker_raw_id_worker_pairs){
 const input=inputs.workers.find(x=>x.worker===pair.worker),sourceRow=sourceById.get(pair.id);
 assert(!!input&&!!sourceRow&&coverage.base_pending_ids.includes(pair.id),"worker pair unknown/base-resolved");
 assert(pair.review_index===sourceRow.index&&pair.source_array_position===sourceRow.index-1,"worker source alignment "+pair.id);
 assert(pair.worker_source_index===pair.source_array_position||pair.worker_source_index===pair.review_index,"worker source_index convention "+pair.id);
 pairCounts.set(pair.id,(pairCounts.get(pair.id)||0)+1);
 if(!pairsById.has(pair.id))pairsById.set(pair.id,[]);
 pairsById.get(pair.id).push(pair.worker);
 workerSet.add(pair.id);
}
const duplicateIds=[...pairCounts].filter(([,n])=>n>1).map(([id])=>id).sort();
assert(JSON.stringify(duplicateIds)===JSON.stringify(["vocab:00762","vocab:02052"]),"unexpected duplicate worker reviews");
assert(JSON.stringify([...pairsById.get("vocab:00762")].sort())===JSON.stringify(["W02","W03"]),"00762 duplicate provenance");
assert(JSON.stringify([...pairsById.get("vocab:02052")].sort())===JSON.stringify(["W08","W09"]),"02052 duplicate provenance");
assert(workerSet.size===1981&&coverage.worker_distinct_ids.length===1981&&coverage.worker_distinct_ids.every(id=>workerSet.has(id)),"worker ID union");
const reportPairs=inputs.workers.reduce((n,w)=>n+w.reported_reviewed_ids.length,0);
assert(reportPairs===1983,"worker report counts");
for(const w of inputs.workers){
 const reported=new Set(w.reported_reviewed_ids),listed=new Set(coverage.worker_ids_by_worker[w.worker]||[]);
 assert(reported.size===w.reported_reviewed_ids.length&&reported.size===listed.size&&[...reported].every(id=>listed.has(id)),"worker report/judgment ID alignment "+w.worker);
}
const boundaryIds=coverage.boundary_repair_ids;
assert(JSON.stringify(boundaryIds)===JSON.stringify(["vocab:00545","vocab:01837","vocab:02267"]),"boundary repair ID list");
assert(coverage.boundary_repair_indices.length===3&&coverage.boundary_repair_indices.every(x=>x.review_index===sourceById.get(x.id)?.index&&x.boundary_index===x.review_index&&x.source_array_position===x.review_index-1),"boundary index alignment");
const acceptedRange=coverage.worker_raw_id_worker_pairs.find(x=>x.id==="vocab:02481");
assert(acceptedRange?.worker==="W10"&&acceptedRange.worker_source_index===2477&&acceptedRange.review_index===2478&&acceptedRange.source_array_position===2477,"W10 out-of-range index normalization");
assert(boundaryIds.every(id=>coverage.base_pending_ids.includes(id)),"boundary repair ID not pending");
const parallelIds=new Set([...workerSet,...boundaryIds]);
assert(parallelIds.size===1984&&coverage.parallel_distinct_ids.length===1984&&coverage.parallel_distinct_ids.every(id=>parallelIds.has(id)),"parallel distinct coverage");
assert([...coverage.base_resolved_ids].every(id=>!parallelIds.has(id))&&coverage.base_overlap_ids.length===0,"base/parallel overlap");
assert(coverage.missing_ids.length===0&&coverage.unknown_ids.length===0&&coverage.unexpected_duplicate_ids.length===0&&coverage.order_drift===0,"coverage validation errors");
assert(coverage.union_total===2478&&coverage.union_ids.length===2478&&coverage.union_ids.every((id,i)=>id===ids[i]),"full source-order union");
const special=reviewById.get("vocab:02481");
assert(special&&special.index===2478&&coverage.base_pending_ids.includes(special.id)&&workerSet.has(special.id),"W10 index 2478 valid coverage");
const workerIds=new Set(coverage.worker_distinct_ids);
assert(!workerIds.has("vocab:00762")||reviewById.get("vocab:00762").classification==="KEEP","00762 adjudication classification");
assert(reviewById.get("vocab:00762")?.status==="REVIEWED","00762 adjudication status");
const adjudications=read("parallel/aggregator-adjudications.json").adjudications;
const adjudication=adjudications.find(x=>x.id==="vocab:00762");
assert(adjudication?.status==="AGGREGATOR_ADJUDICATED"&&adjudication.decision==="KEEP"&&adjudication.confidence==="HIGH","00762 adjudication record");
assert(JSON.stringify(adjudication.recommended_paraphrases)===JSON.stringify(["reasonable","respectable"])&&adjudication.evidence.length>=3,"00762 evidence");
assert(reviewById.get("vocab:02052")?.classification==="KEEP","02052 dedup decision");
assert(agg.duplicate_adjudications.find(x=>x.id==="vocab:02052")?.action==="DEDUPED","02052 dedup record");
const statusCounts=countBy(review,x=>x.status),classCounts=countBy(review,x=>x.classification??"CROSS_AUDIT_CONFLICT");
assert(review.every((x,i)=>x.id===ids[i]&&x.index===i+1&&x.status!=="PENDING"),"review index/order/pending");
assert(Object.values(statusCounts).reduce((a,b)=>a+b,0)===2478&&statusCounts.PENDING===undefined,"review status accounting");
assert(JSON.stringify(statusCounts)===JSON.stringify(manifest.review_status_counts),"manifest status counts");
assert(JSON.stringify(classCounts)===JSON.stringify(manifest.classification_counts),"manifest decision counts");
assert(JSON.stringify(decisions.map(x=>[x.id,x.index,x.status,x.classification??null]))===JSON.stringify(review.map(x=>[x.id,x.index,x.status,x.classification??null])),"decisions/review-index mismatch");
const authoredById=new Map(authors.map(x=>[x.id,x]));
assert(authors.length===2328&&authoredById.size===authors.length,"authored judgment IDs");
const provenanceTypes=new Set(["PARALLEL_WORKER","BOUNDARY_REPAIR","AGGREGATOR_ADJUDICATED"]);
for(const id of parallelIds){
 const final=reviewById.get(id);
 if(final.status==="CROSS_AUDIT_CONFLICT")continue;
 const author=authoredById.get(id);
 assert(author&&provenanceTypes.has(author.review_provenance?.authority_type),"parallel judgment provenance "+id);
 assert(author.review_provenance.immutable_base_sha===coverage.immutable_base_sha,"parallel immutable provenance "+id);
 assert(author.evidence&&author.evidence.length>0,"parallel evidence "+id);
}
assert(authoredById.get("vocab:00762")?.review_provenance?.authority_type==="AGGREGATOR_ADJUDICATED","00762 provenance");
const upstreamIds=upstream.map(x=>x.id),conflictIds=conflicts.map(x=>x.id);
assert(upstream.length===94&&unique(upstreamIds),"upstream authority uniqueness");
for(const x of upstream)assert(x.issue&&x.reason&&Array.isArray(x.evidence)&&x.source_worker&&["HIGH","MEDIUM","LOW"].includes(x.confidence)&&x.production_change_allowed===false,"upstream record completeness "+x.id);
assert(conflicts.length===8&&unique(conflictIds),"cross-audit conflict uniqueness");
for(const x of conflicts)assert(x.issue&&x.reason&&Array.isArray(x.evidence)&&x.source_worker&&["HIGH","MEDIUM","LOW"].includes(x.confidence)&&x.automatic_remediation_allowed===false,"conflict record completeness "+x.id);
assert(upstreamIds.every(id=>reviewById.get(id)?.status==="UPSTREAM_ISOLATED"&&reviewById.get(id)?.classification==="UPSTREAM_AUTHORITY_REVIEW"),"upstream isolation");
assert(conflictIds.every(id=>reviewById.get(id)?.status==="CROSS_AUDIT_CONFLICT"&&reviewById.get(id)?.classification==null),"conflict isolation");
const rootRows=[];
for(let b=0;b<25;b++){
 const file="batches/batch-"+String(b+1).padStart(3,"0")+".json";
 const content=fs.readFileSync(path.join(root,file),"utf8"),rows=JSON.parse(content),start=b*100;
 assert(content===JSON.stringify(rows,null,2)+"\n","batch JSON order/serialization "+file);
 assert(rows.length===Math.min(100,2478-start),"batch size "+file);
 rootRows.push(...rows);
}
assert(rootRows.length===2478,"batch population");
const seen=new Set();
for(let i=0;i<rootRows.length;i++){
 const r=rootRows[i],s=source[i],ir=review[i],d=decisions[i],drift=live.changes.find(x=>x.entry_id===r.id);
 const current=drift?.revalidation?.source_status==="REVALIDATED"?drift.current_snapshot:s;
 assert(!seen.has(r.id),"duplicate batch ID "+r.id);seen.add(r.id);
 assert(r.id===s.id&&r.source_index===i+1&&ir.id===r.id&&d.id===r.id,"batch source alignment "+r.id);
 assert(r.canonical===current.canonical&&r.current_meaning_ja===(current.meaning_ja??current.current_meaning_ja)&&r.sense_key===current.sense_key&&r.grammarRole===current.grammarRole&&JSON.stringify(r.current_paraphrases)===JSON.stringify(current.paraphrases??current.current_paraphrases??[]),"batch source snapshot "+r.id);
 assert(r.review_status===ir.status&&r.single_entry_decision===(ir.classification??null),"batch/review index "+r.id);
 assert(r.learning_eligible===(r.id!=="vocab:00947"),"learning eligibility "+r.id);
 assert(r.remediation_eligible===(!conflictIds.includes(r.id)&&!upstreamIds.includes(r.id)&&r.learning_eligible),"remediation eligibility "+r.id);
 assert(r.single_entry_revalidated===true,"not reviewed "+r.id);
 assert(["CURRENT","REVALIDATED"].includes(r.source_status),"stale source status "+r.id);
 if(r.source_status==="REVALIDATED")assert(r.id==="vocab:00139"&&r.revalidated_against_main_sha===manifest.current_main_sha,"current-main revalidation source "+r.id);
 if(r.review_status==="CROSS_AUDIT_CONFLICT"){assert(r.single_entry_decision===null&&r.remediation_eligible===false,"conflict materialization "+r.id);continue;}
 assert(allowed.has(r.single_entry_decision),"decision enum "+r.id);
 assert(["HIGH","MEDIUM","LOW"].includes(r.confidence),"confidence "+r.id);
 if(["QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE"].includes(r.single_entry_decision))assert(typeof r.recommended_prompt==="string"&&r.recommended_prompt.trim().length>0,"qualifier prompt "+r.id);
 if(r.single_entry_decision==="QUALIFIER_ONLY")assert(r.removed_paraphrases.length===0&&r.added_paraphrases.length===0&&JSON.stringify(r.recommended_paraphrases)===JSON.stringify(r.current_paraphrases),"QUALIFIER_ONLY paraphrase changes "+r.id);
 if(["QUALIFIER_AND_PARAPHRASE","PARAPHRASE_REVALIDATION_ONLY"].includes(r.single_entry_decision)){
  const rec=r.recommended_paraphrases||[],rem=r.removed_paraphrases||[],add=r.added_paraphrases||[];
  assert(unique(rec)&&unique(rem)&&unique(add),"paraphrase duplicate "+r.id);
  assert(r.current_paraphrases.every(p=>rec.includes(p)!==rem.includes(p)),"paraphrase review set incomplete "+r.id);
  assert(add.every(p=>rec.includes(p)),"paraphrase addition missing from recommendation "+r.id);
 }
 if(r.single_entry_decision==="QUALIFIER_AND_PARAPHRASE"&&r.review_provenance){
  const reviewed=new Set((r.paraphrase_review||[]).map(x=>x.paraphrase));
  assert([...new Set([...r.current_paraphrases,...r.recommended_paraphrases,...r.removed_paraphrases,...r.added_paraphrases])].every(p=>reviewed.has(p)),"qualified paraphrase review completeness "+r.id);
 }
 if(r.single_entry_decision==="UPSTREAM_AUTHORITY_REVIEW")assert(r.review_status==="UPSTREAM_ISOLATED"&&r.remediation_eligible===false,"upstream decision status "+r.id);
 if(r.confidence==="LOW"&&targets.has(r.single_entry_decision))assert(!remediation.entries.some(x=>x.id===r.id),"LOW confidence candidate included "+r.id);
}
assert(seen.size===2478,"batch duplicate/order coverage");
const calculatedConfidence=countBy(rootRows,x=>x.confidence);
assert(JSON.stringify(calculatedConfidence)===JSON.stringify(manifest.confidence_counts),"confidence totals");
const qualifiers=rootRows.filter(x=>["QUALIFIER_ONLY","QUALIFIER_AND_PARAPHRASE"].includes(x.single_entry_decision)).length;
const paraRemoved=rootRows.reduce((n,x)=>n+(x.removed_paraphrases||[]).length,0),paraAdded=rootRows.reduce((n,x)=>n+(x.added_paraphrases||[]).length,0);
assert(qualifiers===manifest.provisional_change_counts.total_qualifier_additions&&paraRemoved===manifest.provisional_change_counts.total_paraphrase_removals&&paraAdded===manifest.provisional_change_counts.total_paraphrase_additions,"change accounting");
const expectedCandidates=rootRows.filter(x=>targets.has(x.single_entry_decision)&&x.learning_eligible&&x.remediation_eligible&&x.confidence!=="LOW");
const candidateIds=remediation.entries.map(x=>x.id);
assert(remediation.automatic_materialization_allowed===false&&unique(candidateIds)&&remediation.entries.length===551,"remediation candidate count");
assert(JSON.stringify(candidateIds)===JSON.stringify(expectedCandidates.map(x=>x.id)),"remediation candidates disagree with decisions");
assert(remediation.entries.every(x=>x.ready_for_production===false&&x.learning_eligible===true&&x.remediation_eligible===true&&x.confidence!=="LOW"),"unsafe remediation row");
assert(remediation.excluded_from_remediation.count===1&&JSON.stringify(remediation.excluded_from_remediation.ids)===JSON.stringify(["vocab:00947"]),"learning-ineligible candidate exclusion");
assert(!candidateIds.includes("vocab:00947")&&![...upstreamIds,...conflictIds].some(id=>candidateIds.includes(id)),"isolated/learning-ineligible remediation");
assert(manifest.source_population===2478&&manifest.learning_eligible_population===2477&&manifest.excluded_from_learning===1,"learning accounting");
assert(live.aggregation_final_state?.reviewed===2478&&live.aggregation_final_state.unreviewed===0&&live.aggregation_final_state.pending===0&&live.aggregation_final_state.stale_ids.length===0,"main reconciliation completion");
assert(live.aggregation_final_state.current_main_sha===manifest.current_main_sha&&live.aggregation_final_state.global_authority_drift===false,"main reconciliation authority");
assert(JSON.stringify(live.aggregation_final_state.semantic_drift_ids)===JSON.stringify(["vocab:00139"])&&JSON.stringify(live.aggregation_final_state.revalidated_ids)===JSON.stringify(["vocab:00139"]),"semantic drift scope");
assert(reconciliation.status==="CLOSED"&&reconciliation.final_aggregator_reconciliation?.coverage?.missing_ids.length===0,"semantic reconciliation closure");
assert(manifest.previous_authority_single_entry_revalidated_count===104&&statusCounts.PREVIOUS_AUTHORITY_CONFIRMED===104,"previous authority count");
assert(manifest.worker_review_count===1983&&manifest.worker_distinct_reviewed_count===1981&&manifest.boundary_repair_count===3&&manifest.aggregator_adjudicated_count===1,"provenance accounting");
assert(manifest.production_remediation_candidate_count===551&&manifest.production_excluded_candidate_count===1,"candidate summary");
if(errors.length){console.error("FAIL [strict] ("+errors.length+"): "+errors.slice(0,60).join("; "));process.exitCode=1;}
else{
 const builder=path.join(repo,"scripts/vocabulary/build-single-entry-nuance-qualifier-audit.mjs");
 execFileSync(process.execPath,[builder,"--check"],{cwd:repo,stdio:"pipe"});
 execFileSync(process.execPath,[builder,"--check"],{cwd:repo,stdio:"pipe"});
 console.log("PASS [strict] population=2478 reviewed=2478 pending=0 stale=0 parallel=1984 duplicates=0 conflicts=8 upstream=94; deterministic regeneration=2x; production materialization=false");
}
