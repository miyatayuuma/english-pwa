import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClozeCard, adaptiveClozeCount, sentenceTokens } from '../app/clozeLearningCore.js';
import { normalizeVocabularyAnswer, resolveOccurrenceSpeaker } from '../app/vocabularyLearningCore.js';
import { VOCAB_00139_ASR_REMEDIATION } from './vocabularyEntryRemediationAuthority.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const KIND=new Set(['word','expression','construction']);
const SUBTYPE=new Set(['phrasal_verb','idiom','collocation','fixed_expression','discourse_expression']);
const ID=/^vocab:\d{5}$/;
const MIGRATION_SLOTS=new Set(['someone','somebody','something','somewhere','someplace','one','ones']);
const ENTRY_FIELDS=new Set(['id','kind','subtype','canonical','sense_key','pos','grammarRole','meaning_ja','answers','paraphrases','occurrences']);
const GRAMMAR_ROLES=new Set(['noun','pronoun','verb','adjective','adverb','preposition','conjunction','auxiliary','determiner','interjection','construction']);
const OCCURRENCE_FIELDS=new Set(['item_id','start','end','contextual_meaning_ja']);

function isNaturalAnswer(value){
  const text=String(value||'').trim();
  return !!text&&!/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|[A-Za-z]\s*\/\s*[A-Za-z]|\(\d+\)|^\s*\d+[.)]|\.{2,}/.test(text);
}

function nuanceRowsById(materialization,errors){
  if(!materialization) return new Map();
  const rows=Array.isArray(materialization.entries)?materialization.entries:[];
  const accounting=materialization.accounting||{};
  const accounted=(accounting.APPLY||0)+(accounting.ALREADY_MATCHED||0)+(accounting.BLOCKED_DRIFT||0);
  if(materialization.schema_version!==1||materialization.status!=='MATERIALIZED'||materialization.state_after!=='POST') errors.push('single-entry nuance materialization: invalid schema, status, or state');
  if(materialization.source_audit_commit!=='ab1238bf126196aef01aef636db70e53fac34ad1') errors.push('single-entry nuance materialization: source audit commit mismatch');
  if(accounting.total!==551||accounted!==551||rows.length!==551||accounting.BLOCKED_DRIFT!==0) errors.push('single-entry nuance materialization: accounting must cover 551 rows with no blocked drift');
  const byId=new Map();
  for(const row of rows){
    const id=String(row?.id||'');
    if(byId.has(id)) errors.push(`single-entry nuance materialization: duplicate ID ${id}`);
    byId.set(id,row);
    if(!['APPLY','ALREADY_MATCHED'].includes(row?.status)) errors.push(`single-entry nuance materialization: invalid or blocked status ${id}`);
    if(!row?.before||!row?.after||!Array.isArray(row.before.paraphrases)||!Array.isArray(row.after.paraphrases)) errors.push(`single-entry nuance materialization: invalid surface ${id}`);
    if(row?.before?.grammarRole!==row?.after?.grammarRole||row?.before?.canonical!==row?.after?.canonical||row?.before?.sense_key!==row?.after?.sense_key||JSON.stringify(row?.before?.answers||[])!==JSON.stringify(row?.after?.answers||[])) errors.push(`single-entry nuance materialization: forbidden field change ${id}`);
    if(row?.audit_before?.meaning_ja!==row?.before?.meaning_ja||row?.audit_after?.meaning_ja!==row?.after?.meaning_ja||row?.audit_before?.canonical!==row?.before?.canonical||row?.audit_after?.canonical!==row?.after?.canonical||JSON.stringify(row?.audit_before?.paraphrases||[])!==JSON.stringify(row?.before?.paraphrases||[])||JSON.stringify(row?.audit_after?.paraphrases||[])!==JSON.stringify(row?.after?.paraphrases||[])) errors.push(`single-entry nuance materialization: audit surfaces differ from effective surfaces ${id}`);
  }
  if(byId.size!==551) errors.push('single-entry nuance materialization: expected 551 unique rows');
  return byId;
}

function isApprovedNuanceRemoval(nuanceById,id,value){
  const row=nuanceById.get(String(id));
  const normalized=normalizeVocabularyAnswer(value);
  return !!row&&!!normalized
    &&(row.before?.paraphrases||[]).some(item=>normalizeVocabularyAnswer(item)===normalized)
    &&!(row.after?.paraphrases||[]).some(item=>normalizeVocabularyAnswer(item)===normalized);
}

function isApprovedNuanceMeaning(nuanceById,entry,historicalMeaning){
  const row=nuanceById.get(String(entry?.id||''));
  return !!row&&row.before?.meaning_ja===historicalMeaning
    &&row.after?.meaning_ja===entry?.meaning_ja
    &&row.audit_before?.meaning_ja===row.before?.meaning_ja
    &&row.audit_after?.meaning_ja===row.after?.meaning_ja;
}

function validateParaphraseAudit(audit,entries,errors,nuanceById=new Map()){
  if(!audit) return;
  const entryById=new Map(entries.map(entry=>[String(entry?.id||''),entry]));
  const reviewed=Array.isArray(audit.reviewed_entries)?audit.reviewed_entries:[];
  const reviewedIds=reviewed.map(value=>String(value?.entry_id||''));
  const kindCounts=Object.fromEntries(['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry?.kind===kind).length]));
  if(audit.schema_version!==1) errors.push('paraphrase audit: schema_version must equal 1');
  if(!/^[0-9a-f]{40}$/.test(String(audit.baseline_main||''))) errors.push('paraphrase audit: baseline_main must be a full commit SHA');
  if(audit.review_scope?.entry_count!==entries.length||JSON.stringify(audit.review_scope?.kind_counts)!==JSON.stringify(kindCounts)) errors.push('paraphrase audit: review scope does not match current entries');
  const pending=Array.isArray(audit.pending_entries)?audit.pending_entries:[];
  const accounted=[...reviewedIds,...pending.map(row=>String(row.entry_id||''))];
  if(accounted.length!==entries.length||new Set(accounted).size!==accounted.length||accounted.some(id=>!entryById.has(id))||entries.some(entry=>!accounted.includes(String(entry.id)))) errors.push('paraphrase audit: every current vocabulary entry must be reviewed or explicitly pending exactly once');
  for(const row of pending) if(!row.reason||entryById.get(row.entry_id)?.paraphrases?.length) errors.push(`paraphrase audit: invalid pending entry ${row.entry_id}`);
  for(const item of reviewed){
    const entry=entryById.get(String(item?.entry_id||''));
    if(!entry) continue;
    const expected=Array.isArray(entry.paraphrases)&&entry.paraphrases.length?'curated':'reviewed_no_major_paraphrase';
    if(item.decision!==expected) errors.push(`paraphrase audit: ${entry.id} review decision does not match curated data`);
  }
  const curated=Array.isArray(audit.curated_paraphrases)?audit.curated_paraphrases:[];
  const curatedById=new Map();
  for(const item of curated){
    const id=String(item?.entry_id||'');
    if(curatedById.has(id)) errors.push(`paraphrase audit: duplicate curated entry ${id}`);
    curatedById.set(id,item?.paraphrases);
  }
  for(const entry of entries){
    const values=Array.isArray(entry?.paraphrases)?entry.paraphrases:[];
    const reviewedValues=curatedById.get(String(entry.id));
    if(values.length){
      const override=VOCAB_00139_ASR_REMEDIATION;
      const approvedUpdate=entry.id===override.id
        && JSON.stringify(reviewedValues)===JSON.stringify(override.before.paraphrases)
        && JSON.stringify(values)===JSON.stringify(override.after.paraphrases);
      if(!Array.isArray(reviewedValues)||(JSON.stringify(reviewedValues)!==JSON.stringify(values)&&!approvedUpdate)) errors.push(`paraphrase audit: curated values differ for ${entry.id}`);
    }else if(curatedById.has(String(entry.id))) errors.push(`paraphrase audit: empty curated entry ${entry.id}`);
  }
  if(curatedById.size!==entries.filter(entry=>Array.isArray(entry?.paraphrases)&&entry.paraphrases.length).length) errors.push('paraphrase audit: curated entry list has unknown or missing entries');

  const answerReview=audit.answers_review||{};
  const sourceEntries=Array.isArray(answerReview.source_entries)?answerReview.source_entries:[];
  const sourceIds=sourceEntries.map(value=>String(value?.entry_id||''));
  const reclassified=new Map((Array.isArray(answerReview.reclassified)?answerReview.reclassified:[]).map(value=>[String(value?.entry_id||'')+'\u0000'+String(value?.answer||''),value]));
  if(answerReview.entries_reviewed!==sourceEntries.length||new Set(sourceIds).size!==sourceIds.length) errors.push('answers audit: every source entry must be accounted for once');
  const expectedAnswerSourceIds=new Set(entries.filter(entry=>Array.isArray(entry.answers)&&entry.answers.length).map(entry=>String(entry.id)));
  for(const row of sourceEntries){
    const id=String(row?.entry_id||''),entry=entryById.get(id);
    if(!entry){errors.push(`answers audit: unknown source entry ${id}`);continue;}
    if(!Array.isArray(row.original_answers)||!row.original_answers.length) errors.push(`answers audit: ${id} must preserve the original variants`);
    if(entry.answers?.length) expectedAnswerSourceIds.add(id);
    for(const answer of Array.isArray(row.original_answers)?row.original_answers:[]){
      const key=id+'\u0000'+String(answer);
      const moved=reclassified.get(key);
      const target=moved?entry.paraphrases:entry.answers;
      if((!Array.isArray(target)||!target.some(value=>normalizeVocabularyAnswer(value)===normalizeVocabularyAnswer(answer)))&&!isApprovedNuanceRemoval(nuanceById,id,answer)) errors.push(`answers audit: ${id} lost original variant ${answer}`);
      if(moved&&moved.to!=='paraphrases') errors.push(`answers audit: ${id} reclassification target must be paraphrases`);
    }
    for(const answer of Array.isArray(entry.answers)?entry.answers:[]){
      if(!row.original_answers?.some(value=>normalizeVocabularyAnswer(value)===normalizeVocabularyAnswer(answer))) errors.push(`answers audit: current variant ${id}/${answer} is absent from the review snapshot`);
    }
  }
  if(sourceEntries.length!==7||answerReview.entries_reviewed!==7) errors.push('answers audit: expected the seven original answer-bearing entries to be reviewed');
  for(const [key,moved] of reclassified){
    const [id,answer]=key.split('\u0000');
    const entry=entryById.get(id);
    if(!entry||(!entry.paraphrases?.some(value=>normalizeVocabularyAnswer(value)===normalizeVocabularyAnswer(answer))&&!isApprovedNuanceRemoval(nuanceById,id,answer))) errors.push(`answers audit: invalid reclassification ${id}/${answer}`);
    expectedAnswerSourceIds.add(id);
  }
  if(expectedAnswerSourceIds.size!==sourceIds.length||sourceIds.some(id=>!expectedAnswerSourceIds.has(id))) errors.push('answers audit: source entry inventory differs from the complete original answer set');
  const representatives=Array.isArray(audit.representative_accepted)?audit.representative_accepted:[];
  for(const example of representatives){
    const entry=entryById.get(String(example?.entry_id||''));
    if((!entry?.paraphrases?.some(value=>normalizeVocabularyAnswer(value)===normalizeVocabularyAnswer(example?.paraphrase))&&!isApprovedNuanceRemoval(nuanceById,example?.entry_id,example?.paraphrase))||!String(example?.reason||'').trim()) errors.push(`paraphrase audit: invalid accepted example ${example?.entry_id||'<missing>'}`);
    const counterpart=entryById.get(String(example?.counterpart_entry_id||''));
    if(example?.counterpart_entry_id&&!counterpart) errors.push(`paraphrase audit: unknown counterpart ${example.counterpart_entry_id}`);
    // counterpart_entry_id is provenance only; current prompt-learning-value policy does not require reciprocal curation.
  }
  for(const example of Array.isArray(audit.representative_rejected)?audit.representative_rejected:[]){
    if(!String(example?.left||'').trim()||!String(example?.right||'').trim()||!String(example?.reason||'').trim()) errors.push('paraphrase audit: rejected examples need candidates and a reason');
  }
}

function auditClozeDataset(entries,items){
  const entriesByItem=new Map();
  for(const entry of entries) for(const occurrence of entry.occurrences||[]){
    const itemId=String(occurrence?.item_id||'');
    if(!entriesByItem.has(itemId)) entriesByItem.set(itemId,[]);
    entriesByItem.get(itemId).push(entry);
  }
  const levels=[0,2,5],variants=[0,1,2,3,4,5];
  const zeroTargetItems=Object.fromEntries(levels.map(level=>[`level_${level}`,0]));
  const fallback={no_vocabulary:{cards:0,items:new Set()},budget_rejection:{cards:0,items:new Set()}};
  const errors=[];
  let cardsAudited=0,zeroTargetCards=0;
  for(const item of items){
    const text=String(item?.en||''),tokens=sentenceTokens(text),candidates=entriesByItem.get(String(item?.id||''))||[];
    for(const level of levels){
      let itemZero=false;
      for(const variantKey of variants){
        const options={level,count:adaptiveClozeCount(text,level),variantKey};
        const card=buildClozeCard(item,candidates,options);
        const repeated=buildClozeCard(item,candidates,options);
        const signature=value=>JSON.stringify(value.targets.map(target=>[target.entry_id,target.start,target.end,target.fallback,target.fallbackReason]));
        cardsAudited+=1;
        if(signature(card)!==signature(repeated)) errors.push(`${item?.id}: nondeterministic cloze variant ${level}/${variantKey}`);
        if(card.targets.length<1){zeroTargetCards+=1;itemZero=true;continue;}
        if(card.targets.length>adaptiveClozeCount(text,level)) errors.push(`${item?.id}: cloze group cap exceeded at ${level}/${variantKey}`);
        if(card.segments.map(segment=>segment.text).join('')!==text) errors.push(`${item?.id}: cloze reconstruction failed at ${level}/${variantKey}`);
        let hidden=0;
        for(let index=0;index<card.targets.length;index+=1){
          const target=card.targets[index],width=target.tokenEnd-target.tokenStart+1;
          if(!Number.isInteger(target.tokenStart)||!Number.isInteger(target.tokenEnd)||target.tokenStart<0||target.tokenEnd>=tokens.length||target.tokenStart>target.tokenEnd) errors.push(`${item?.id}: invalid cloze token range at ${level}/${variantKey}`);
          if(index&&card.targets[index-1].tokenEnd>=target.tokenStart) errors.push(`${item?.id}: overlapping cloze targets at ${level}/${variantKey}`);
          if(target.start<0||target.end<=target.start||target.end>text.length||text.slice(target.start,target.end)!==target.surface) errors.push(`${item?.id}: invalid cloze character span at ${level}/${variantKey}`);
          hidden+=width;
          if(target.fallback){
            const reason=target.fallbackReason==='budget-rejection'?'budget_rejection':'no_vocabulary';
            fallback[reason].cards+=1;
            fallback[reason].items.add(String(item.id));
          }
        }
        if(tokens.length-hidden<2) errors.push(`${item?.id}: fewer than two visible tokens at ${level}/${variantKey}`);
        const ratio=tokens.length?hidden/tokens.length:1;
        const hardLimit=card.targets.some(target=>target.phraseException)?.45:.4;
        if(ratio>hardLimit+Number.EPSILON) errors.push(`${item?.id}: hidden ratio exceeded at ${level}/${variantKey}`);
      }
      if(itemZero) zeroTargetItems[`level_${level}`]+=1;
    }
  }
  const fallbackSummary={
    no_vocabulary:{cards:fallback.no_vocabulary.cards,items:fallback.no_vocabulary.items.size},
    budget_rejection:{cards:fallback.budget_rejection.cards,items:fallback.budget_rejection.items.size},
  };
  return {errors,report:{items:items.length,levels,variants_per_level:variants.length,cards_audited:cardsAudited,zero_target_cards:zeroTargetCards,zero_target_items:zeroTargetItems,fallback_due_no_vocabulary:fallbackSummary.no_vocabulary,fallback_due_budget_rejection:fallbackSummary.budget_rejection,deterministic_variants:true}};
}

function lexicalWords(value,{legacy=false}={}){
  let text=String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
  if(legacy) text=text.replace(/\(([^)]+)\)/g,' $1 ');
  return text.match(/[a-z]+(?:['’][a-z]+)*/g)||[];
}

function wordAuditLemma(value){
  const words=lexicalWords(value).filter(word=>!MIGRATION_SLOTS.has(word));
  return words[0]==='be'?(words[1]||'be'):(words[0]||'');
}

function migrationExpressionMatches(old,next){
  const oldHeadword=String(old?.headword||'');
  if(!oldHeadword||/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|\(\d+\)/.test(oldHeadword)) return false;
  const previous=lexicalWords(oldHeadword,{legacy:true});
  const current=lexicalWords(next?.canonical).filter(word=>!MIGRATION_SLOTS.has(word));
  return previous.length>0&&previous.join(' ')===current.join(' ');
}

function validateWordExpansionAudit(audit,entries,items,errors,nuanceById=new Map()){
  if(!audit) return;
  const itemIds=(Array.isArray(items)?items:[]).map(item=>String(item?.id||''));
  const itemById=new Map((Array.isArray(items)?items:[]).map(item=>[String(item?.id||''),item]));
  const entryById=new Map(entries.map(entry=>[String(entry?.id||''),entry]));
  const wordEntries=entries.filter(entry=>entry?.kind==='word'&&(!audit.cohort_word_entry_ids||audit.cohort_word_entry_ids.includes(entry.id)));
  if(audit.cohort_word_entry_ids&&(audit.cohort_word_entry_ids.length!==381||new Set(audit.cohort_word_entry_ids).size!==381||audit.cohort_word_entry_ids.some(id=>entryById.get(id)?.kind!=='word'))) errors.push('word audit: historical cohort must preserve its 381 surviving word IDs');
  const reviewed=Array.isArray(audit.reviewed_source_item_ids)?audit.reviewed_source_item_ids.map(String):[];
  const baseline=Array.isArray(audit.baseline_word_source_item_ids)?audit.baseline_word_source_item_ids.map(String):[];
  const added=Array.isArray(audit.added_word_entry_ids)?audit.added_word_entry_ids.map(String):[];
  if(audit.schema_version!==1) errors.push('word audit: schema_version must equal 1');
  if(!/^([0-9a-f]{40})$/.test(String(audit.baseline_main||''))) errors.push('word audit: baseline_main must be a full commit SHA');
  if(audit.source_items_reviewed!==itemIds.length||reviewed.length!==itemIds.length||new Set(reviewed).size!==reviewed.length||itemIds.some(id=>!reviewed.includes(id))) errors.push('word audit: reviewed source item IDs must match the complete current source dataset');
  if(new Set(baseline).size!==baseline.length||baseline.some(id=>!itemById.has(id))) errors.push('word audit: baseline word source item IDs must be unique known items');
  if(audit.word_entries_before!==42) errors.push('word audit: baseline word_entries_before must be 42');
  if(audit.word_entries_added!==added.length||new Set(added).size!==added.length) errors.push('word audit: added word IDs must be unique and match word_entries_added');
  for(const id of added) if(entryById.get(id)?.kind!=='word') errors.push(`word audit: added ID ${id} must resolve to a word entry`);
  const addedIds=new Set(added);
  for(const id of entryById.keys()) if(addedIds.has(id)&&entryById.get(id)?.kind!=='word') errors.push(`word audit: ${id} is not a word entry`);
  for(const example of Array.isArray(audit.accepted_examples)?audit.accepted_examples:[]){
    const entry=entryById.get(String(example?.entry_id||''));
    const item=itemById.get(String(example?.item_id||''));
    const occurrence=entry?.occurrences?.find(value=>String(value.item_id)===String(example?.item_id));
    const actual=occurrence&&item?item.en.slice(occurrence.start,occurrence.end):'';
    if(!entry||entry.kind!=='word'||entry.canonical!==example.canonical||entry.sense_key!==example.sense_key||!addedIds.has(entry.id)) errors.push(`word audit: invalid accepted example entry ${example?.entry_id||'<missing>'}`);
    if(!occurrence||actual!==example.surface||occurrence.contextual_meaning_ja!==example.contextual_meaning_ja||(entry?.meaning_ja!==example.meaning_ja&&!isApprovedNuanceMeaning(nuanceById,entry,example.meaning_ja))) errors.push(`word audit: accepted example source/meaning mismatch for ${example?.canonical||'<missing>'}`);
  }
  for(const example of Array.isArray(audit.retained_examples)?audit.retained_examples:[]){
    const entry=entryById.get(String(example?.entry_id||''));
    const item=itemById.get(String(example?.item_id||''));
    const occurrence=entry?.occurrences?.find(value=>String(value.item_id)===String(example?.item_id));
    const actual=occurrence&&item?item.en.slice(occurrence.start,occurrence.end):'';
    if(!entry||entry.kind!=='word'||addedIds.has(entry.id)||entry.canonical!==example.canonical||entry.sense_key!==example.sense_key) errors.push(`word audit: invalid retained example entry ${example?.entry_id||'<missing>'}`);
    if(!occurrence||actual!==example.surface||occurrence.contextual_meaning_ja!==example.contextual_meaning_ja||(entry?.meaning_ja!==example.meaning_ja&&!isApprovedNuanceMeaning(nuanceById,entry,example.meaning_ja))) errors.push(`word audit: retained example source/meaning mismatch for ${example?.canonical||'<missing>'}`);
  }
  for(const correction of Array.isArray(audit.existing_word_span_corrections)?audit.existing_word_span_corrections:[]){
    const entry=entryById.get(String(correction?.entry_id||''));
    const item=itemById.get(String(correction?.item_id||''));
    const occurrence=entry?.occurrences?.find(value=>String(value.item_id)===String(correction?.item_id));
    const actual=occurrence&&item?item.en.slice(occurrence.start,occurrence.end):'';
    if(!entry||entry.kind!=='word'||addedIds.has(entry.id)||wordAuditLemma(entry.canonical)!==wordAuditLemma(correction.canonical)||!occurrence||actual!==correction.to_surface||correction.from_surface===correction.to_surface) errors.push(`word audit: existing word span correction is inconsistent for ${correction?.entry_id||'<missing>'}`);
  }
  for(const example of Array.isArray(audit.rejected_examples)?audit.rejected_examples:[]){
    const item=itemById.get(String(example?.item_id||''));
    if(!item||!String(example?.surface||'').trim()||!String(example?.reason||'').trim()||!item.en.includes(example.surface)) errors.push(`word audit: invalid rejected example ${example?.surface||'<missing>'}`);
    if(wordEntries.some(entry=>String(entry.canonical||'').toLocaleLowerCase('en-US')===String(example?.surface||'').toLocaleLowerCase('en-US'))) errors.push(`word audit: rejected basic/expression token ${example?.surface||'<missing>'} was also selected as a word`);
  }
  for(const example of Array.isArray(audit.same_sense_multi_occurrence_examples)?audit.same_sense_multi_occurrence_examples:[]){
    const entry=wordEntries.find(value=>value.canonical===example.canonical&&value.sense_key===example.sense_key);
    const actualIds=(entry?.occurrences||[]).map(value=>String(value.item_id));
    if(!entry||!example.item_ids?.every(id=>actualIds.includes(String(id)))||actualIds.length!==new Set(actualIds).size) errors.push(`word audit: same-sense occurrences are not consolidated for ${example?.canonical||'<missing>'}`);
  }
  for(const example of Array.isArray(audit.same_canonical_different_sense_examples)?audit.same_canonical_different_sense_examples:[]){
    const exampleLemma=wordAuditLemma(example.canonical);
    const senses=wordEntries.filter(value=>wordAuditLemma(value.canonical)===exampleLemma).map(value=>value.sense_key);
    const ids=wordEntries.filter(value=>wordAuditLemma(value.canonical)===exampleLemma).flatMap(value=>(value.occurrences||[]).map(occurrence=>String(occurrence.item_id)));
    if(!example.sense_keys?.every(key=>senses.includes(key))||new Set(senses).size<senses.length||!example.item_ids?.every(id=>ids.includes(String(id)))) errors.push(`word audit: distinct senses are not represented separately for ${example?.canonical||'<missing>'}`);
  }
}

export function validateVocabularyV3(db,items,characters,migration,v2,wordAudit=null,paraphraseAudit=null,nuanceMaterialization=null){
  const errors=[];
  const nuanceById=nuanceRowsById(nuanceMaterialization,errors);
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
    if(entry?.grammarRole!=null&&!GRAMMAR_ROLES.has(entry.grammarRole)) errors.push(`${id}: invalid grammar role ${entry.grammarRole}`);
    const senseKey=`${String(entry?.canonical||'').normalize('NFKC').toLocaleLowerCase('en-US')}\u0000${entry?.sense_key||''}`;
    if(senses.has(senseKey)) errors.push(`${id}: duplicate canonical+sense_key`);senses.add(senseKey);
    if(!String(entry?.meaning_ja||'').trim()) errors.push(`${id}: empty representative Japanese meaning`);
    if(/(?:^|[、,])\s*[^、,]+(?:[、,]\s*[^、,]+){2,}\s*$/.test(String(entry?.meaning_ja||''))&&!isApprovedNuanceMeaning(nuanceById,entry,nuanceById.get(id)?.before?.meaning_ja)) errors.push(`${id}: list-like unrelated dictionary senses`);
    if(!Array.isArray(entry?.occurrences)||!entry.occurrences.length) errors.push(`${id}: needs at least one occurrence`);
    if(entry?.answers!=null&&!Array.isArray(entry.answers)) errors.push(`${id}: answers must be an array`);
    const answers=Array.isArray(entry?.answers)?entry.answers:[];
    for(const answer of answers){if(!isNaturalAnswer(answer)||!normalizeVocabularyAnswer(answer)) errors.push(`${id}: invalid answer variant`);}
    const canonicalNormalized=normalizeVocabularyAnswer(entry?.canonical);
    const uniqueAnswers=new Set(answers.map(normalizeVocabularyAnswer));
    if(uniqueAnswers.size!==answers.length) errors.push(`${id}: duplicate answer variant`);
    if(answers.some(answer=>normalizeVocabularyAnswer(answer)===canonicalNormalized)) errors.push(`${id}: answers must not repeat the canonical form`);
    if(entry?.paraphrases!=null&&!Array.isArray(entry.paraphrases)) errors.push(`${id}: paraphrases must be an array`);
    const paraphrases=Array.isArray(entry?.paraphrases)?entry.paraphrases:[];
    for(const paraphrase of paraphrases){if(!isNaturalAnswer(paraphrase)||!normalizeVocabularyAnswer(paraphrase)) errors.push(`${id}: invalid paraphrase notation`);}
    const uniqueParaphrases=new Set(paraphrases.map(normalizeVocabularyAnswer));
    if(uniqueParaphrases.size!==paraphrases.length) errors.push(`${id}: duplicate paraphrase`);
    const targetForms=new Set([canonicalNormalized,...answers.map(normalizeVocabularyAnswer)]);
    if(paraphrases.some(value=>targetForms.has(normalizeVocabularyAnswer(value)))) errors.push(`${id}: paraphrases must not duplicate canonical or answers`);
    for(const occurrence of Array.isArray(entry?.occurrences)?entry.occurrences:[]){
      for(const field of Object.keys(occurrence||{})) if(!OCCURRENCE_FIELDS.has(field)) errors.push(`${id}: unapproved occurrence field ${field}`);
      const itemId=String(occurrence?.item_id||'');
      const item=byItem.get(itemId);
      if(!item){errors.push(`${id}: unknown item ${itemId||'<missing>'}`);continue;}
      const start=occurrence?.start,end=occurrence?.end;
      if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=end||end>item.en.length){errors.push(`${id}/${itemId}: invalid UTF-16 span`);continue;}
      const surface=item.en.slice(start,end);
      if(!/[A-Za-z]/.test(surface)) errors.push(`${id}/${itemId}: span has no alphabetic target`);
      if(!/^[A-Za-z]/.test(surface)||!/[A-Za-z0-9][?]?$/.test(surface)) errors.push(`${id}/${itemId}: span must start and end on a word boundary`);
      if(entry?.kind==='word'&&/\s/.test(surface)&&normalizeVocabularyAnswer(surface)!==normalizeVocabularyAnswer(entry.canonical)) errors.push(`${id}/${itemId}: word span must be a lexical token or its exact dictionary compound`);
      if(!String(occurrence?.contextual_meaning_ja||'').trim()) errors.push(`${id}/${itemId}: empty contextual meaning`);
      const key=`${itemId}:${start}:${end}`;
      if(occurrences.has(key)) errors.push(`${id}/${itemId}: duplicate occurrence span`);occurrences.add(key);
      for(const tag of Array.isArray(item.speaker_tags)?item.speaker_tags:[]){
        if(tag?.id&&!characters.some(profile=>String(profile?.id)===String(tag.id))) errors.push(`${itemId}: unknown speaker character ${tag.id}`);
      }
    }
  }
  if(db?.schema_version!==3) errors.push('schema_version must equal 3');

  validateWordExpansionAudit(wordAudit,entries,items,errors,nuanceById);
  validateParaphraseAudit(paraphraseAudit,entries,errors,nuanceById);
  const clozeAudit=items.length===560?auditClozeDataset(entries,items):null;
  if(clozeAudit) errors.push(...clozeAudit.errors);

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

  return {errors,report:buildVocabularyV3Report(db,items,characters,migration,v2,wordAudit,paraphraseAudit,clozeAudit?.report||null)};
}

export function buildVocabularyV3Report(db,items,characters,migration,v2,wordAudit=null,paraphraseAudit=null,clozeAudit=null){
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
  const wordEntries=entries.filter(entry=>entry.kind==='word'&&(!wordAudit?.cohort_word_entry_ids||wordAudit.cohort_word_entry_ids.includes(entry.id)));
  const wordSourceIds=new Set(wordEntries.flatMap(entry=>(entry.occurrences||[]).map(occurrence=>String(occurrence.item_id))));
  const baselineWordSourceIds=new Set((wordAudit?.baseline_word_source_item_ids||[]).map(String));
  const wordCanonicals=new Map();
  for(const entry of wordEntries) wordCanonicals.set(entry.canonical,(wordCanonicals.get(entry.canonical)||0)+1);
  const addedSourceIds=new Set(wordEntries.filter(entry=>(wordAudit?.added_word_entry_ids||[]).includes(entry.id)).flatMap(entry=>(entry.occurrences||[]).map(occurrence=>String(occurrence.item_id))));
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
    ...(clozeAudit||itemList.length===560?{cloze_generation_audit:clozeAudit||auditClozeDataset(entries,itemList).report}:{}),
    answer_authority:{
      entries_with_answers:entries.filter(entry=>Array.isArray(entry.answers)&&entry.answers.length).length,
      source_realizations_audited:occurrenceList.length,
      entries_with_paraphrases:entries.filter(entry=>Array.isArray(entry.paraphrases)&&entry.paraphrases.length).length,
      total_paraphrases:entries.reduce((count,entry)=>count+(Array.isArray(entry.paraphrases)?entry.paraphrases.length:0),0),
      paraphrase_entries_pending:(paraphraseAudit?.pending_entries||[]).length,
      paraphrase_entries_reviewed:Array.isArray(paraphraseAudit?.reviewed_entries)?paraphraseAudit.reviewed_entries.length:0,
    },
    ...(wordAudit?{word_expansion_audit:{
      baseline_main:wordAudit.baseline_main,
      source_items_reviewed:wordAudit.source_items_reviewed,
      word_entries_before:wordAudit.word_entries_before,
      word_entries_after:wordEntries.length,
      word_entries_added:(wordAudit.added_word_entry_ids||[]).length,
      source_items_with_word_entries:wordSourceIds.size,
      source_items_newly_covered_by_words:[...wordSourceIds].filter(id=>!baselineWordSourceIds.has(id)).length,
      source_items_with_added_word_entries:addedSourceIds.size,
      multi_occurrence_word_entries:wordEntries.filter(entry=>(entry.occurrences||[]).length>1).length,
      multi_sense_word_canonical_count:[...wordCanonicals.values()].filter(count=>count>1).length,
      existing_word_span_correction_count:(wordAudit.existing_word_span_corrections||[]).length,
      existing_word_span_correction_examples:(wordAudit.existing_word_span_corrections||[]).slice(0,3).map(({canonical,item_id,from_surface,to_surface})=>({canonical,item_id,from_surface,to_surface})),
      retained_examples:(wordAudit.retained_examples||[]).map(({canonical,sense_key,item_id,surface})=>({canonical,sense_key,item_id,surface})),
      accepted_examples:(wordAudit.accepted_examples||[]).map(({canonical,sense_key,item_id,surface})=>({canonical,sense_key,item_id,surface})),
      rejected_examples:(wordAudit.rejected_examples||[]).map(({surface,item_id,reason})=>({surface,item_id,reason})),
    }}:{})
  };
}

function main(){
  const db=read('vocabulary-v3.json'),items=read('items.json');
  const characters=read('characters.json').characters||[];
  const migration=read('vocabulary-v2-v3-migration.json'),v2=read('vocabulary-v2.json');
  const wordAudit=read('vocabulary-v3-word-audit.json');
  const paraphraseAudit=read('vocabulary-v3-paraphrase-audit.json');
  let nuanceMaterialization=null;
  const nuancePath=path.join(root,'data/audits/vocabulary-single-entry-nuance-materialization/materialization.json');
  if(fs.existsSync(nuancePath)) nuanceMaterialization=JSON.parse(fs.readFileSync(nuancePath,'utf8'));
  const {errors,report}=validateVocabularyV3(db,items,characters,migration,v2,wordAudit,paraphraseAudit,nuanceMaterialization);
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
