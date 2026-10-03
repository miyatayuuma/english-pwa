import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const authority=read('vocabulary-v3-final-admission-occurrences.json');
const items=read('items.json');
const byItem=new Map(items.map(item=>[String(item.id),item]));
const STATUS=new Set(['EXACT','NORMALIZED','GENERALIZED','LEGACY_EVIDENCE_RECOVERED','RECOVERED_VALID_OCCURRENCE','NO_VALID_OCCURRENCE','AMBIGUOUS']);
const RESOLVED=new Set(['EXACT','NORMALIZED','GENERALIZED','LEGACY_EVIDENCE_RECOVERED','RECOVERED_VALID_OCCURRENCE']);
const KIND=new Set(['word','expression','construction']);
const EXPECTED_TOTAL=1408;
const EXPECTED_KIND={word:1036,expression:351,construction:21};
const EXPECTED_INVENTORY_SHA='2891fb47713427c7bb0e442f9b4877e479e3f8ae1f13849614ed35707d8fcb4b';
const RANGES={1:[1,50],2:[51,100],3:[101,150],4:[151,200],5:[201,250],6:[251,300],7:[301,350],8:[351,400],9:[401,450],10:[451,500],11:[501,550],12:[551,560]};
const number=id=>Number(String(id||'').slice(1));
const errors=[];
const records=Array.isArray(authority?.records)?authority.records:[];

if(authority?.schema_version!==1) errors.push('occurrence authority: schema_version must equal 1');
if(records.length!==EXPECTED_TOTAL) errors.push(`occurrence authority: expected ${EXPECTED_TOTAL} records, got ${records.length}`);
if(authority?.final_admission_authority?.inventory_sha256!==EXPECTED_INVENTORY_SHA) errors.push('occurrence authority: fixed admission inventory SHA mismatch');

const projection=records.map(({audit_batch,kind,concept})=>({audit_batch,kind,concept}));
const inventorySha=crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex');
if(inventorySha!==EXPECTED_INVENTORY_SHA) errors.push(`occurrence authority: record inventory SHA mismatch ${inventorySha}`);

const seen=new Set();
const kindCounts={word:0,expression:0,construction:0};
const statusCounts={EXACT:0,NORMALIZED:0,GENERALIZED:0,LEGACY_EVIDENCE_RECOVERED:0,RECOVERED_VALID_OCCURRENCE:0,NO_VALID_OCCURRENCE:0,AMBIGUOUS:0};
const batchSummary={};

for(const record of records){
  if(typeof record?.concept!=='string'||!record.concept.trim()) errors.push('occurrence authority: missing concept');
  const key=`${record?.audit_batch}\u0000${record?.kind}\u0000${record?.concept}`;
  if(seen.has(key)) errors.push(`occurrence authority: duplicate record ${key}`);
  seen.add(key);
  if(!KIND.has(record?.kind)) errors.push(`occurrence authority: invalid kind for ${record?.concept||'<missing>'}`);
  else kindCounts[record.kind]+=1;
  if(!RANGES[record?.audit_batch]) errors.push(`occurrence authority: invalid audit_batch for ${record?.concept||'<missing>'}`);
  if(!STATUS.has(record?.recovery_status)) errors.push(`occurrence authority: invalid recovery_status for ${record?.concept||'<missing>'}`);
  else statusCounts[record.recovery_status]+=1;
  if(!record?.evidence||!String(record.evidence.method||'').trim()||!String(record.evidence.note||'').trim()) errors.push(`occurrence authority: missing evidence for ${record?.concept||'<missing>'}`);

  if(record.recovery_status==='RECOVERED_VALID_OCCURRENCE'){
    const sense=record.sense_interpretation;
    if(!['noun','verb','adjective','adverb'].includes(sense?.pos)||!String(sense?.sense_key||'').trim()||!String(sense?.meaning_ja||'').trim()) errors.push(`occurrence authority: missing recovered sense authority for ${record.concept}`);
    if(record.evidence?.method!=='admission_sense_reconciliation'||record.evidence?.original_audit_source_confirmed!==false||!String(record.evidence?.provenance||'').trim()||!record.evidence?.legacy_link||!record.evidence?.coverage_check) errors.push(`occurrence authority: missing sense reconciliation evidence for ${record.concept}`);
    const chosen=(record.reconciliation_candidates||[]).filter(candidate=>candidate.decision==='chosen_primary');
    if(chosen.length!==1||chosen[0].item_id!==record.item_id||chosen[0].start!==record.start||chosen[0].end!==record.end||chosen[0].surface!==record.surface) errors.push(`occurrence authority: primary sense candidate mismatch for ${record.concept}`);
  }

  if(record.recovery_status==='AMBIGUOUS'&&(!Array.isArray(record.closest_source_candidates)||record.closest_source_candidates.length<2||!String(record.why_invalid_or_ambiguous||'').trim())) errors.push(`occurrence authority: missing semantic ambiguity evidence for ${record.concept}`);
  for(const candidate of [...(record.closest_source_candidates||[]),...(record.reconciliation_candidates||[])]){
    const item=byItem.get(candidate.item_id);
    if(!item){errors.push(`occurrence authority: invalid candidate item for ${record.concept}`);continue;}
    if(!Number.isInteger(candidate.start)||!Number.isInteger(candidate.end)||candidate.start<0||candidate.end<=candidate.start||candidate.end>item.en.length||item.en.slice(candidate.start,candidate.end)!==candidate.surface) errors.push(`occurrence authority: invalid candidate span for ${record.concept}/${candidate.item_id}`);
    if(candidate.source_sentence!==item.en) errors.push(`occurrence authority: stale candidate sentence for ${record.concept}/${candidate.item_id}`);
    if(record.recovery_status==='AMBIGUOUS'&&!String(candidate.sense||'').trim()) errors.push(`occurrence authority: missing candidate sense for ${record.concept}/${candidate.item_id}`);
  }

  const batch=batchSummary[record.audit_batch]??={reviewed:0,EXACT:0,NORMALIZED:0,GENERALIZED:0,LEGACY_EVIDENCE_RECOVERED:0,RECOVERED_VALID_OCCURRENCE:0,NO_VALID_OCCURRENCE:0,AMBIGUOUS:0};
  batch.reviewed+=1;if(STATUS.has(record?.recovery_status))batch[record.recovery_status]+=1;batchSummary[record.audit_batch]=batch;

  if(RESOLVED.has(record?.recovery_status)){
    const item=byItem.get(String(record.item_id||''));
    if(!item){errors.push(`occurrence authority: unknown item for ${record.concept}`);continue;}
    if(!Number.isInteger(record.start)||!Number.isInteger(record.end)||record.start<0||record.end<=record.start||record.end>item.en.length){errors.push(`occurrence authority: invalid span for ${record.concept}/${record.item_id}`);continue;}
    if(/\b(?:the|a|an|my|your|his|her|their|our|its)$/i.test(record.surface||'')&&/\b(?:something|someone|A|B)\b/.test(record.concept)) errors.push(`occurrence authority: incomplete realized argument for ${record.concept}`);
    if(!String(record.surface||'').length) errors.push(`occurrence authority: empty surface for ${record.concept}`);
    if(item.en.slice(record.start,record.end)!==record.surface) errors.push(`occurrence authority: surface mismatch for ${record.concept}/${record.item_id}`);
    const range=RANGES[record.audit_batch],n=number(record.item_id);
    if((n<range[0]||n>range[1])&&record?.evidence?.batch_provenance_mismatch!==true) errors.push(`occurrence authority: out-of-batch source lacks explicit provenance mismatch for ${record.concept}/${record.item_id}`);
  }else{
    if(record.item_id!=null||record.start!=null||record.end!=null||record.surface!=null) errors.push(`occurrence authority: unresolved record must not carry authoritative item/span fields for ${record.concept}`);
    if(!Array.isArray(record.search_performed)||!String(record.recommended_next_action||'').trim()) errors.push(`occurrence authority: unresolved record lacks exception evidence for ${record.concept}`);
  }
}
if(JSON.stringify(kindCounts)!==JSON.stringify(EXPECTED_KIND)) errors.push(`occurrence authority: kind counts mismatch ${JSON.stringify(kindCounts)}`);
const resolvedTotal=records.filter(record=>RESOLVED.has(record.recovery_status)).length;
const unresolvedTotal=records.length-resolvedTotal;
const summary=authority?.summary||{};
if(summary.reviewed!==records.length||summary.resolved_total!==resolvedTotal||summary.unresolved_total!==unresolvedTotal||JSON.stringify(summary.status_counts)!==JSON.stringify(statusCounts)||JSON.stringify(summary.kind_counts)!==JSON.stringify(kindCounts)) errors.push('occurrence authority: summary is stale');
if(JSON.stringify(authority?.batch_summary)!==JSON.stringify(batchSummary)) errors.push('occurrence authority: batch_summary is stale');
const exceptionKeys=new Set((authority?.exceptions||[]).map(record=>`${record.audit_batch}\u0000${record.kind}\u0000${record.concept}`));
const unresolvedKeys=new Set(records.filter(record=>!RESOLVED.has(record.recovery_status)).map(record=>`${record.audit_batch}\u0000${record.kind}\u0000${record.concept}`));
if(exceptionKeys.size!==unresolvedKeys.size||[...unresolvedKeys].some(key=>!exceptionKeys.has(key))) errors.push('occurrence authority: exception inventory does not match unresolved records');

if(JSON.stringify(authority.exceptions)!==JSON.stringify(records.filter(record=>!RESOLVED.has(record.recovery_status)))) errors.push('occurrence authority: exception evidence differs from records');

const critical=records.find(record=>record.concept==='find it + adjective + to do something');
if(!critical||critical.item_id!=='E0509'||critical.recovery_status!=='GENERALIZED'||critical?.evidence?.batch_provenance_mismatch!==true) errors.push('occurrence authority: critical find-it construction recovery must remain fixed to E0509 with explicit batch provenance mismatch');

if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(JSON.stringify({reviewed:records.length,resolved:resolvedTotal,unresolved:unresolvedTotal,status_counts:statusCounts,kind_counts:kindCounts,offset_validation:{out_of_range:0,empty_surface:0,surface_mismatch:0}},null,2));
