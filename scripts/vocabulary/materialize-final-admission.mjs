import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,'data',name),JSON.stringify(value,null,2)+'\n');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>structuredClone(value);
export const ADMISSION_START_MAIN='e96a9435a9648b76f72b21d76666e34548374a5c';
export const FINAL_COUNTS={word:1422,expression:997,construction:59};
const key=r=>`${r.audit_batch}\u0000${r.kind}\u0000${r.concept}`;

// Remove admission annotations, not their concept boundary. Slot spelling is
// provisional; meaning/canonical refinement belongs to the subsequent audit.
export function provisionalCanonical(concept){
  return concept.replace(/\s*\[[^\]]*\]/g,'').replace(/\s*\([^)]*\)/g,'')
    .replace(/adjective\/adverb/g,'adjective or adverb')
    .replace(/someone\/something/g,'someone or something')
    .replace(/\bA\b/g,'something').replace(/\bB\b/g,'something else')
    .replace(/\.{3}/g,'something').replace(/\s+/g,' ').trim();
}

function legacyKey(text){
  return String(text||'').replace(/\[[^\]]*\]|\([^)]*\)/g,'').toLowerCase()
    .replace(/\b(?:doing|do)\s+(?:something|someone)\b/g,'')
    .replace(/\b(?:someone|somebody|something|somewhere|someplace|one's|[abc])\b/g,'')
    .replace(/[^a-z]+/g,' ').trim();
}

function initialMeaning(record,v2,v1){
  if(record.sense_interpretation) return {
    meaning:record.sense_interpretation.meaning_ja,pos:record.sense_interpretation.pos,
    sense:record.sense_interpretation.sense_key,
    evidence:{source:'resolved_sense_authority',semantic_review:'pending_final_wording'},
  };
  const matches=(rows)=>rows.filter(entry=>entry.example_ids?.includes(record.item_id)
    &&legacyKey(entry.headword)===legacyKey(record.concept)&&entry.meaning_ja);
  const candidates=matches(v2),fallback=record.kind==='word'?matches(v1):[];
  const legacy=candidates[0]||fallback[0];
  if(legacy){
    // A conservative single legacy gloss, not a newly composed translation.
    const meaning=String(legacy.meaning_ja).split(/\s+\/\s+|[;；、,]/)[0].trim();
    return {meaning,pos:Array.isArray(legacy.pos)&&legacy.pos.length===1?legacy.pos[0]:record.kind,
      evidence:{source:candidates.length?'data/vocabulary-v2.json':'data/vocabulary.json',entry_id:legacy.id,headword:legacy.headword,original_meaning_ja:legacy.meaning_ja,semantic_review:'pending'}};
  }
  return {meaning:`意味監査待ち（${record.item_id}の原文訳を参照）`,pos:record.kind,
    evidence:{source:'data/items.json',item_id:record.item_id,semantic_review:'pending',initialization:'explicit_source_reference_placeholder'}};
}

const RECLASSIFIED_SENSES={
  'vocab:00024':'resultative_end_result','vocab:00025':'insufficient_amount',
  'vocab:00011':'put_on_clothing','vocab:00210':'arranged_causative_service',
  'vocab:00259':'repeated_back_and_forth_movement','vocab:00346':'childbearing',
  'vocab:00320':'financial_support','vocab:00438':'wish_or_regret',
  'vocab:00013':'so_degree_that_result','vocab:00516':'solution_or_escape',
  'vocab:00538':'throughout_a_time_period','vocab:00584':'pass_down',
  'vocab:00676':'tolerate_someone_or_something','vocab:00702':'experience_or_endure',
  'vocab:00637':'mood_state',
};

function trimReclassifiedOccurrence(entry,canonical,items){
  // Word reclassification must keep exactly its lexical token, not the former
  // expression span. Other spans retain their current source realization.
  if(entry.kind!=='word') return;
  for(const occurrence of entry.occurrences){
    const text=items.get(occurrence.item_id).en;
    const old=text.slice(occurrence.start,occurrence.end);
    const token=old.match(new RegExp(`\\b${canonical==='spoil'?'spoiling':canonical==='count'?'counts':canonical}\\b`,'i'));
    if(!token) throw new Error(`No fixed reclassification token for ${entry.id}`);
    occurrence.start+=token.index;occurrence.end=occurrence.start+token[0].length;
  }
}

export function buildMaterialization({baseline,admission,authority,items,v2,v1,wordAudit,paraphraseAudit,migration}){
  if(baseline.entries.length!==1072) throw new Error('Expected the immutable 1,072-entry pre-admission baseline');
  const adds=admission.final_add.entries;
  const records=authority.records;
  const byKey=new Map(records.map(record=>[key(record),record]));
  if(adds.length!==1408||records.length!==1408||byKey.size!==1408
    ||adds.some(record=>!byKey.has(key(record)))
    ||records.some(record=>!adds.some(add=>key(add)===key(record)))
    ||authority.summary.resolved_total!==1408||authority.summary.unresolved_total!==0) throw new Error('Admission/occurrence 1:1 integrity gate failed');
  const byItem=new Map(items.map(item=>[item.id,item]));
  for(const record of records){
    const item=byItem.get(record.item_id);
    if(!item||!Number.isInteger(record.start)||!Number.isInteger(record.end)||record.start<0||record.end<=record.start||record.end>item.en.length||item.en.slice(record.start,record.end)!==record.surface) throw new Error(`Invalid occurrence authority ${record.concept}`);
  }
  const db=clone(baseline),originalById=new Map(baseline.entries.map(entry=>[entry.id,entry]));
  const byId=new Map(db.entries.map(entry=>[entry.id,entry]));
  const merges=admission.final_merge.map(row=>{
    const into=row.into.match(/^vocab:\d{5}/)?.[0];
    if(!byId.has(row.entry_id)||!byId.has(into)) throw new Error('Invalid fixed merge');
    const source=byId.get(row.entry_id),target=byId.get(into);
    if(source.occurrences.some(occurrence=>!target.occurrences.some(other=>other.item_id===occurrence.item_id))) throw new Error('Fixed merge target must already cover the source item');
    byId.delete(row.entry_id);
    return {from_id:row.entry_id,into_id:into};
  });
  const reclassified=new Set();
  for(const row of admission.final_reclassify){
    const entry=byId.get(row.entry_id);
    if(!entry||entry.canonical!==row.from||entry.kind!==row.from_kind) throw new Error(`Reclassification basis drifted ${row.entry_id}`);
    entry.canonical=provisionalCanonical(row.to_concept);entry.kind=row.to_kind;
    if(entry.kind!=='expression') delete entry.subtype;
    if(RECLASSIFIED_SENSES[entry.id]) entry.sense_key=RECLASSIFIED_SENSES[entry.id];
    trimReclassifiedOccurrence(entry,entry.canonical,byItem);
    reclassified.add(entry.id);
  }
  db.entries=db.entries.filter(entry=>byId.has(entry.id));
  const maxId=Math.max(...baseline.entries.map(entry=>Number(entry.id.split(':')[1])));
  const mappings=[];
  for(let index=0;index<adds.length;index++){
    const add=adds[index],record=byKey.get(key(add)),semantic=initialMeaning(record,v2.entries,v1.entries);
    const id=`vocab:${String(maxId+index+1).padStart(5,'0')}`;
    const entry={id,kind:add.kind,canonical:provisionalCanonical(add.concept),sense_key:semantic.sense||`pending_admission_${String(index+1).padStart(4,'0')}`,pos:semantic.pos,meaning_ja:semantic.meaning,
      occurrences:[{item_id:record.item_id,start:record.start,end:record.end,contextual_meaning_ja:semantic.evidence.initialization?byItem.get(record.item_id).ja:semantic.meaning}]};
    if(byId.has(id)) throw new Error(`ID collision ${id}`);
    db.entries.push(entry);byId.set(id,entry);
    mappings.push({id,audit_batch:add.audit_batch,kind:add.kind,concept:add.concept,initial_semantic_evidence:semantic.evidence});
  }
  const counts=Object.fromEntries(Object.keys(FINAL_COUNTS).map(kind=>[kind,db.entries.filter(entry=>entry.kind===kind).length]));
  if(db.entries.length!==2478||JSON.stringify(counts)!==JSON.stringify(FINAL_COUNTS)) throw new Error(`Fixed population mismatch ${JSON.stringify(counts)}`);
  const freeze=db.entries.map(entry=>({id:entry.id,kind:entry.kind,origin:originalById.has(entry.id)?'existing':'newly_materialized'}));
  const manifest={schema_version:1,start_main:ADMISSION_START_MAIN,baseline_path:'data/vocabulary-v3-pre-admission-baseline.json',baseline_sha256:hash(baseline),final_admission_artifact_sha256:authority.final_admission_authority.artifact_sha256,
    occurrence_authority_path:'data/vocabulary-v3-final-admission-occurrences.json',population_frozen:true,
    id_policy:{existing_ids:'Preserve every surviving existing ID; do not reuse retired or historical gaps.',assignment:'Append in the preserved Final ADD array order after the pre-admission maximum.',previous_max_id:`vocab:${String(maxId).padStart(5,'0')}`,new_first_id:mappings[0].id,new_last_id:mappings.at(-1).id},
    summary:{previous_entries:1072,add_materialized:1408,merge_reductions:merges.length,reclassify_applied:reclassified.size,drop:0,final_entries:2478,kind_counts:counts},
    merges,reclassifications:clone(admission.final_reclassify),add_mappings:mappings,frozen_entries:freeze,population_sha256:hash(freeze),
    semantic_audit_policy:{scope:'all 2,478 existing and new entries',pending_fields:['canonical','sense_key','pos','meaning_ja','contextual_meaning_ja','answers','paraphrases'],prohibited:['ADD','DROP','MERGE','split','kind changes','stable ID changes'],authority_corruption:'Report; do not change the frozen population.'},
  };
  const nextParaphrase=clone(paraphraseAudit);
  nextParaphrase.historical_review_scope=clone(paraphraseAudit.historical_review_scope||paraphraseAudit.review_scope);
  nextParaphrase.historical_reviewed_entries=clone(paraphraseAudit.historical_reviewed_entries||paraphraseAudit.reviewed_entries);
  nextParaphrase.review_scope={entry_count:2478,kind_counts:counts};
  nextParaphrase.reviewed_entries=nextParaphrase.historical_reviewed_entries.filter(row=>byId.has(row.entry_id)&&!reclassified.has(row.entry_id));
  nextParaphrase.pending_entries=db.entries.filter(entry=>!originalById.has(entry.id)||reclassified.has(entry.id)).map(entry=>({entry_id:entry.id,reason:reclassified.has(entry.id)?'fixed_admission_reclassification':'newly_materialized_no_semantic_audit'}));
  nextParaphrase.retired_entries=nextParaphrase.historical_reviewed_entries.filter(row=>!byId.has(row.entry_id));
  const nextWordAudit=clone(wordAudit);
  nextWordAudit.cohort_word_entry_ids=baseline.entries.filter(entry=>entry.kind==='word').map(entry=>entry.id);
  nextWordAudit.cohort_scope='Historical PR #235 word-expansion cohort; Final Admission additions and reclassifications are audited separately.';
  const nextMigration=clone(migration);nextMigration.final_admission_merges=merges;
  return {db,manifest,wordAudit:nextWordAudit,paraphraseAudit:nextParaphrase,migration:nextMigration};
}

function main(){
  const output=buildMaterialization({baseline:read('vocabulary-v3-pre-admission-baseline.json'),admission:read('vocabulary-v3-final-admission-authority.json'),authority:read('vocabulary-v3-final-admission-occurrences.json'),items:read('items.json'),v2:read('vocabulary-v2.json'),v1:read('vocabulary.json'),wordAudit:read('vocabulary-v3-word-audit.json'),paraphraseAudit:read('vocabulary-v3-paraphrase-audit.json'),migration:read('vocabulary-v2-v3-migration.json')});
  if(!process.argv.includes('--write')){console.log(JSON.stringify(output.manifest.summary,null,2));return;}
  const current=read('vocabulary-v3.json');
  if(current.entries.length!==1072) throw new Error('Materialization is one-time: production must still be the pre-admission baseline');
  if(hash(current)!==output.manifest.baseline_sha256) throw new Error('Production differs from the fixed pre-admission baseline');
  write('vocabulary-v3.json',output.db);write('vocabulary-v3-final-admission-materialization.json',output.manifest);
  write('vocabulary-v3-word-audit.json',output.wordAudit);write('vocabulary-v3-paraphrase-audit.json',output.paraphraseAudit);write('vocabulary-v2-v3-migration.json',output.migration);
  console.log(JSON.stringify(output.manifest.summary,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
