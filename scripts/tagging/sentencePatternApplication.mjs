import { SENTENCE_PATTERNS } from './tagTaxonomy.mjs';

const PATTERN_SET=new Set(SENTENCE_PATTERNS);

function acceptedPattern(record){
  if(!record || record.accepted!==true) return null;
  return PATTERN_SET.has(record.pattern) ? record.pattern : null;
}

function unique(values){
  const out=[];
  for(const value of values){
    if(value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function validateSentencePatternAnalysis(items,analysis){
  const errors=[];
  const sourceItems=Array.isArray(items)?items:[];
  const entries=Array.isArray(analysis?.entries)?analysis.entries:[];
  if(entries.length!==sourceItems.length){
    errors.push(`analysis coverage ${entries.length}/${sourceItems.length}`);
    return errors;
  }
  const byId=new Map(entries.map(entry=>[String(entry?.id||''),entry]));
  if(byId.size!==entries.length) errors.push('duplicate or missing analysis ids');

  let acceptedMainCount=0;
  let reviewCount=0;
  for(const item of sourceItems){
    const id=String(item?.id||'');
    const entry=byId.get(id);
    if(!entry){ errors.push(`missing analysis for ${id}`); continue; }
    const itemText=String(item?.en||'').trim();
    const analysisText=String(entry?.en||'').trim();
    if(itemText!==analysisText) errors.push(`analysis text mismatch ${id}`);
    if(!entry.main || typeof entry.main!=='object') errors.push(`missing main analysis ${id}`);
    if(!Array.isArray(entry.clauses)) errors.push(`missing clause analysis ${id}`);
    if(acceptedPattern(entry.main)) acceptedMainCount+=1;
    if(entry.review_required===true) reviewCount+=1;
    for(const record of [entry.main,...(Array.isArray(entry.clauses)?entry.clauses:[])]){
      if(record?.pattern!=null && !PATTERN_SET.has(record.pattern)) errors.push(`invalid pattern ${id}: ${record.pattern}`);
      if(record?.accepted===true && !PATTERN_SET.has(record?.pattern)) errors.push(`accepted invalid pattern ${id}`);
    }
  }

  if(Number(analysis?.summary?.item_count)!==entries.length) errors.push('analysis summary item count mismatch');
  if(Number(analysis?.summary?.main_accepted)!==acceptedMainCount) errors.push('analysis summary main coverage mismatch');
  if(Number(analysis?.summary?.review_item_count)!==reviewCount) errors.push('analysis summary review count mismatch');
  return errors;
}

export function applySentencePatternAnalysis(items,analysis){
  const errors=validateSentencePatternAnalysis(items,analysis);
  if(errors.length) throw new Error(errors.join('; '));
  const byId=new Map(analysis.entries.map(entry=>[String(entry.id),entry]));
  return items.map(item=>{
    const entry=byId.get(String(item.id));
    const main=acceptedPattern(entry.main);
    const clauses=unique((entry.clauses||[]).map(acceptedPattern));
    return {...item,sentence_patterns:{main,clauses}};
  });
}

export function sentencePatternReportPatch(items,analysis){
  const mainCounts={};
  const clauseCounts={};
  let mainTagged=0;
  let taggedItems=0;
  for(const item of items){
    const main=item?.sentence_patterns?.main||null;
    const clauses=Array.isArray(item?.sentence_patterns?.clauses)?item.sentence_patterns.clauses:[];
    if(main){
      mainTagged+=1;
      mainCounts[main]=(mainCounts[main]||0)+1;
    }
    if(main||clauses.length) taggedItems+=1;
    for(const pattern of clauses){ clauseCounts[pattern]=(clauseCounts[pattern]||0)+1; }
  }
  return {
    sentence_pattern_tagged_items:taggedItems,
    sentence_pattern_main_tagged_items:mainTagged,
    sentence_pattern_main_unresolved:items.length-mainTagged,
    sentence_pattern_review_items:Number(analysis?.summary?.review_item_count)||0,
    sentence_pattern_counts:mainCounts,
    sentence_pattern_clause_counts:clauseCounts,
    sentence_pattern_gold_accuracy:Number(analysis?.summary?.gold?.accuracy)||0,
  };
}
