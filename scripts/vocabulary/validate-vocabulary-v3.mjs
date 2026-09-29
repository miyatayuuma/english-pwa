import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClozeCard, adaptiveClozeCount } from '../app/clozeLearningCore.js';
import { resolveOccurrenceSpeaker } from '../app/vocabularyLearningCore.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const KIND=new Set(['word','expression','construction']);
const SUBTYPE=new Set(['phrasal_verb','idiom','collocation','fixed_expression','discourse_expression']);
const ID=/^vocab:\d{5}$/;
const MIGRATION_SLOTS=new Set(['someone','somebody','something','somewhere','someplace','one','ones']);
const ENTRY_FIELDS=new Set(['id','kind','subtype','canonical','sense_key','pos','meaning_ja','answers','occurrences']);
const OCCURRENCE_FIELDS=new Set(['item_id','start','end','contextual_meaning_ja']);

function isNaturalAnswer(value){
  const text=String(value||'').trim();
  return !!text&&!/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|\(\d+\)|\.{2,}/.test(text);
}

function lexicalWords(value,{legacy=false}={}){
  let text=String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
  if(legacy) text=text.replace(/\(([^)]+)\)/g,' $1 ');
  return text.match(/[a-z]+(?:['’][a-z]+)*/g)||[];
}

function migrationExpressionMatches(old,next){
  const oldHeadword=String(old?.headword||'');
  if(!oldHeadword||/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|\(\d+\)/.test(oldHeadword)) return false;
  const previous=lexicalWords(oldHeadword,{legacy:true});
  const current=lexicalWords(next?.canonical).filter(word=>!MIGRATION_SLOTS.has(word));
  return previous.length>0&&previous.join(' ')===current.join(' ');
}

export function validateVocabularyV3(db,items,characters,migration,v2){
  const errors=[];
  const entries=Array.isArray(db?.entries)?db.entries:[];
  const byItem=new Map((Array.isArray(items)?items:[]).map(item=>[String(item?.id||''),item]));
  const ids=new Set(),senses=new Set(),occurrences=new Set();
  for(const entry of entries){
    const id=String(entry?.id||'');
    for(const field of Object.keys(entry||{})) if(!ENTRY_FIELDS.has(field)) errors.push(`${id||'<missing>'}: unapproved entry field ${field}`);
    if(!ID.test(id)) errors.push(`${id||'<missing>'}: invalid persistent id`);
    if(ids.has(id)) errors.push(`${id}: duplicate id`);ids.add(id);
    if(!KIND.has(entry?.kind)) errors.push(`${id}: unknown kind ${entry?.kind}`);
    if(entry?.kind==='expression'&&entry?.subtype!=null&&!SUBTYPE.has(entry.subtype)) errors.push(`${id}: unknown subtype ${entry.subtype}`);
    if(entry?.kind!=='expression'&&entry?.subtype!=null) errors.push(`${id}: subtype is only allowed for expression entries`);
    if(!String(entry?.canonical||'').trim()) errors.push(`${id}: empty canonical`);
    if(!isNaturalAnswer(entry?.canonical)) errors.push(`${id}: canonical contains dictionary notation`);
    if(!String(entry?.sense_key||'').trim()) errors.push(`${id}: empty sense_key`);
    if(!String(entry?.pos||'').trim()) errors.push(`${id}: empty part of speech`);
    const senseKey=`${String(entry?.canonical||'').normalize('NFKC').toLocaleLowerCase('en-US')}\u0000${entry?.sense_key||''}`;
    if(senses.has(senseKey)) errors.push(`${id}: duplicate canonical+sense_key`);senses.add(senseKey);
    if(!String(entry?.meaning_ja||'').trim()) errors.push(`${id}: empty representative Japanese meaning`);
    if(/(?:^|[、,])\s*[^、,]+(?:[、,]\s*[^、,]+){2,}\s*$/.test(String(entry?.meaning_ja||''))) errors.push(`${id}: list-like unrelated dictionary senses`);
    if(!Array.isArray(entry?.occurrences)||!entry.occurrences.length) errors.push(`${id}: needs at least one occurrence`);
    const answers=Array.isArray(entry?.answers)?entry.answers:[];
    for(const answer of answers){if(!isNaturalAnswer(answer)) errors.push(`${id}: invalid answer variant`);}
    const uniqueAnswers=new Set(answers.map(answer=>String(answer).normalize('NFKC').toLocaleLowerCase('en-US')));
    if(uniqueAnswers.size!==answers.length) errors.push(`${id}: duplicate answer variant`);
    if(answers.some(answer=>String(answer).normalize('NFKC').toLocaleLowerCase('en-US')===String(entry?.canonical||'').normalize('NFKC').toLocaleLowerCase('en-US'))) errors.push(`${id}: answers must not repeat the canonical form`);
    for(const occurrence of Array.isArray(entry?.occurrences)?entry.occurrences:[]){
      for(const field of Object.keys(occurrence||{})) if(!OCCURRENCE_FIELDS.has(field)) errors.push(`${id}: unapproved occurrence field ${field}`);
      const itemId=String(occurrence?.item_id||'');
      const item=byItem.get(itemId);
      if(!item){errors.push(`${id}: unknown item ${itemId||'<missing>'}`);continue;}
      const start=occurrence?.start,end=occurrence?.end;
      if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=end||end>item.en.length){errors.push(`${id}/${itemId}: invalid UTF-16 span`);continue;}
      const surface=item.en.slice(start,end);
      if(!/[A-Za-z]/.test(surface)) errors.push(`${id}/${itemId}: span has no alphabetic target`);
      if(!/^[A-Za-z]/.test(surface)||!/[A-Za-z]$/.test(surface)) errors.push(`${id}/${itemId}: span must start and end on a word boundary`);
      if(!String(occurrence?.contextual_meaning_ja||'').trim()) errors.push(`${id}/${itemId}: empty contextual meaning`);
      const key=`${itemId}:${start}:${end}`;
      if(occurrences.has(key)) errors.push(`${id}/${itemId}: duplicate occurrence span`);occurrences.add(key);
      for(const tag of Array.isArray(item.speaker_tags)?item.speaker_tags:[]){
        if(tag?.id&&!characters.some(profile=>String(profile?.id)===String(tag.id))) errors.push(`${itemId}: unknown speaker character ${tag.id}`);
      }
    }
  }
  if(db?.schema_version!==3) errors.push('schema_version must equal 3');

  const oldIds=new Set(),newIds=new Set();
  const oldById=new Map((Array.isArray(v2?.entries)?v2.entries:[]).map(entry=>[String(entry.id),entry]));
  const newById=new Map(entries.map(entry=>[String(entry.id),entry]));
  for(const mapping of Array.isArray(migration?.mappings)?migration.mappings:[]){
    const oldId=String(mapping?.v2_id||''),newId=String(mapping?.v3_id||'');
    if(oldIds.has(oldId)) errors.push(`migration: duplicate v2 id ${oldId}`);oldIds.add(oldId);
    if(newIds.has(newId)) errors.push(`migration: duplicate v3 id ${newId}`);newIds.add(newId);
    const old=oldById.get(oldId),next=newById.get(newId),itemId=String(mapping?.item_id||'');
    if(!old||!next) errors.push(`migration: unknown mapping ${oldId} -> ${newId}`);
    const source=byItem.get(itemId);
    const oldExample=(Array.isArray(old?.examples)?old.examples:[]).find(example=>String(example?.item_id)===itemId);
    if(!old?.example_ids?.includes(itemId)||!next?.occurrences?.some(x=>String(x.item_id)===itemId)||!source||String(oldExample?.en||'').replace(/\s+/g,' ').trim()!==String(source?.en||'').replace(/\s+/g,' ').trim()) errors.push(`migration: source item mismatch ${oldId} -> ${newId}`);
    if(mapping?.same_sense_confirmed!==true) errors.push(`migration: sense not explicitly reviewed ${oldId} -> ${newId}`);
    if(mapping?.same_expression_confirmed!==true||!migrationExpressionMatches(old,next)) errors.push(`migration: lexical expression mismatch or not explicitly reviewed ${oldId} -> ${newId}`);
    if(mapping?.pos_compatible_confirmed!==true) errors.push(`migration: POS compatibility not explicitly reviewed ${oldId} -> ${newId}`);
  }

  return {errors,report:buildVocabularyV3Report(db,items,characters,migration,v2)};
}

export function buildVocabularyV3Report(db,items,characters,migration,v2){
  const entries=Array.isArray(db?.entries)?db.entries:[];
  const itemList=Array.isArray(items)?items:[];
  const sourceIds=new Set(entries.flatMap(entry=>(entry.occurrences||[]).map(occurrence=>String(occurrence.item_id))));
  const occurrenceList=entries.flatMap(entry=>(entry.occurrences||[]).map(occurrence=>({entry,occurrence})));
  let resolvable=0,ambiguous=0;
  const byId=new Map(itemList.map(item=>[String(item.id),item]));
  for(const {occurrence} of occurrenceList){
    const item=byId.get(String(occurrence.item_id));
    if(resolveOccurrenceSpeaker(item,occurrence,characters)) resolvable+=1;
    else if(Array.isArray(item?.speaker_tags)&&item.speaker_tags.length===2) ambiguous+=1;
  }
  const entriesByItem=new Map();
  for(const entry of entries)for(const occurrence of entry.occurrences||[]){
    const id=String(occurrence.item_id);if(!entriesByItem.has(id))entriesByItem.set(id,[]);entriesByItem.get(id).push(entry);
  }
  let candidateItems=0,selectedItems=0,selectedTargets=0,fallbackTargets=0;
  for(const item of itemList){
    const candidates=entriesByItem.get(String(item.id))||[];
    if(candidates.length) candidateItems+=1;
    const card=buildClozeCard(item,candidates,{level:2,count:adaptiveClozeCount(item.en,2),variantKey:'v3-report'});
    if(card.targets.some(target=>!target.fallback)) selectedItems+=1;
    selectedTargets+=card.targets.filter(target=>!target.fallback).length;
    fallbackTargets+=card.targets.filter(target=>target.fallback).length;
  }
  const kindCounts={word:0,expression:0,construction:0};
  const subtypeCounts={};
  const canonicals=new Map();
  for(const entry of entries){
    if(entry.kind in kindCounts) kindCounts[entry.kind]+=1;
    if(entry.subtype) subtypeCounts[entry.subtype]=(subtypeCounts[entry.subtype]||0)+1;
    const canonical=String(entry.canonical||'');canonicals.set(canonical,(canonicals.get(canonical)||0)+1);
  }
  const readyV2=Number(v2?.stats?.ready_for_cards)||0;
  const migrationCount=Array.isArray(migration?.mappings)?migration.mappings.length:0;
  return {
    schema_version:1,
    vocabulary_schema_version:db?.schema_version||null,
    total_entries:entries.length,
    kind_counts:kindCounts,
    subtype_counts:subtypeCounts,
    source_item_coverage:sourceIds.size,
    zero_vocabulary_item_count:Math.max(0,itemList.length-sourceIds.size),
    occurrence_count:occurrenceList.length,
    entries_with_multiple_occurrences:entries.filter(entry=>(entry.occurrences||[]).length>1).length,
    multi_sense_canonical_count:[...canonicals.values()].filter(count=>count>1).length,
    source_speaker_resolvable_occurrences:resolvable,
    source_speaker_ambiguous_occurrences:ambiguous,
    migration_mapped_entries:migrationCount,
    migration_reset_entries:Math.max(0,readyV2-migrationCount),
    cloze_candidate_coverage:{
      items_with_curated_candidates:candidateItems,
      items_with_selected_curated_targets:selectedItems,
      selected_curated_targets:selectedTargets,
      fallback_targets:fallbackTargets,
    },
  };
}

function main(){
  const db=read('vocabulary-v3.json'),items=read('items.json');
  const characters=read('characters.json').characters||[];
  const migration=read('vocabulary-v2-v3-migration.json'),v2=read('vocabulary-v2.json');
  const {errors,report}=validateVocabularyV3(db,items,characters,migration,v2);
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;return;}
  const reportPath=path.join(root,'data/vocabulary-v3-report.json');
  if(process.argv.includes('--check-report')){
    let committed;
    try{committed=JSON.parse(fs.readFileSync(reportPath,'utf8'));}catch(_){committed=null;}
    if(JSON.stringify(committed)!==JSON.stringify(report)){
      console.error('data/vocabulary-v3-report.json is missing or stale; run the validator locally and commit the updated report.');
      process.exitCode=1;return;
    }
  }else{
    fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`);
  }
  console.log(JSON.stringify(report,null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
