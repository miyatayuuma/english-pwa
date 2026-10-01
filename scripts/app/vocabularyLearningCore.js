import { quotedTurnContainingSpan } from '../tagging/quotedTurns.js';

const DAY_MS=24*60*60*1000;
export const VOCABULARY_MIGRATION_FALLBACK='_vocabularyV3LegacySourceFallback';

export function vocabStateId(entry){
  return String(entry?.id||'').trim();
}

function characterList(value){
  return Array.isArray(value)?value:(Array.isArray(value?.characters)?value.characters:[]);
}

function itemList(value){
  return Array.isArray(value)?value:(Array.isArray(value?.items)?value.items:[]);
}

export function resolveOccurrenceSpeaker(item,occurrence,characters=[]){
  const tags=Array.isArray(item?.speaker_tags)?item.speaker_tags:[];
  const profiles=new Map(characterList(characters).filter(x=>x?.id).map(x=>[String(x.id),x]));
  if(tags.length===1){
    const id=String(tags[0]?.id||'');
    return id&&profiles.has(id)?{profile:profiles.get(id),turn:null,turnIndex:null}:null;
  }
  if(tags.length!==2) return null;
  const occurrenceStart=Number(occurrence?.start),occurrenceEnd=Number(occurrence?.end);
  const turn=quotedTurnContainingSpan(item?.en,occurrenceStart,occurrenceEnd);
  if(!turn) return null;
  const roleIndex=turn.index%2;
  const id=String(tags[roleIndex]?.id||'');
  if(!id||!profiles.has(id)) return null;
  return {profile:profiles.get(id),turn,turnIndex:turn.index};
}

export function joinVocabularyData(db,items,characters=[]){
  const entries=Array.isArray(db)?db:(Array.isArray(db?.entries)?db.entries:[]);
  const byId=new Map(itemList(items).filter(item=>item?.id).map(item=>[String(item.id),item]));
  const profiles=characterList(characters);
  return entries.map(entry=>({
    ...entry,
    sourceOccurrences:(Array.isArray(entry?.occurrences)?entry.occurrences:[]).map(occurrence=>{
      const item=byId.get(String(occurrence?.item_id||''));
      return item?{
        occurrence,
        item,
        sourceSpeaker:resolveOccurrenceSpeaker(item,occurrence,profiles),
      }:null;
    }).filter(Boolean),
  }));
}

export function readyVocabularyEntries(db){
  const entries=Array.isArray(db)?db:(Array.isArray(db?.entries)?db.entries:[]);
  return entries.filter(entry=>[
    'word','expression','construction',
  ].includes(entry?.kind)
    &&String(entry?.canonical||'').trim()
    &&String(entry?.sense_key||'').trim()
    &&String(entry?.meaning_ja||'').trim()
    &&Array.isArray(entry?.occurrences)
    &&entry.occurrences.length>0);
}

export function occurrenceIsEncountered(levelState,occurrence){
  const id=String(occurrence?.item_id||'');
  const info=id&&levelState?.[id]&&typeof levelState[id]==='object'?levelState[id]:{};
  return Number(info.updatedAt)>0||Number(info.last)>0||Number(info.best)>0;
}

export function eligibleVocabularyEntries(entries,levelState={}){
  const eligible=[];
  for(const entry of Array.isArray(entries)?entries:[]){
    const occurrences=Array.isArray(entry.sourceOccurrences)
      ?entry.sourceOccurrences
      :entry.occurrences.map(occurrence=>({occurrence,item:null,sourceSpeaker:null}));
    const encountered=occurrences.map((source,index)=>({
      source,index,
      info:levelState?.[String(source?.occurrence?.item_id||'')]||{},
    })).filter(({source})=>source?.item&&occurrenceIsEncountered(levelState,source.occurrence));
    encountered.sort((a,b)=>Number(b.info?.updatedAt||0)-Number(a.info?.updatedAt||0)||a.index-b.index);
    let selected=encountered[0]?.source||null;
    const state=levelState?.[vocabStateId(entry)];
    if(!selected&&state?.[VOCABULARY_MIGRATION_FALLBACK]) selected=occurrences[0]||null;
    if(!selected) continue;
    eligible.push({...entry,activeOccurrence:selected});
  }
  return eligible;
}

export function vocabularyLevelInfo(levelState,entry){
  const id=vocabStateId(entry);
  const info=(id&&levelState?.[id]&&typeof levelState[id]==='object')?levelState[id]:{};
  const last=Number(info.last);
  const best=Number(info.best);
  const level=Number.isFinite(last)?last:(Number.isFinite(best)?best:0);
  const dueAt=Number(info?.review?.nextDueAt ?? info?.nextDueAt ?? 0);
  const updatedAt=Number(info?.updatedAt||0);
  const hasProgress=updatedAt>0||last>0||best>0;
  return {
    id,
    info,
    level:Math.max(0,Math.min(5,Number.isFinite(level)?level:0)),
    dueAt:Number.isFinite(dueAt)&&dueAt>0?dueAt:0,
    updatedAt:Number.isFinite(updatedAt)&&updatedAt>0?updatedAt:0,
    hasProgress,
  };
}

export function vocabularyStats(entries,levelState={},now=Date.now()){
  const safe=Array.isArray(entries)?entries:[];
  let due=0,fresh=0,learning=0,stable=0;
  for(const entry of safe){
    const meta=vocabularyLevelInfo(levelState,entry);
    if(meta.dueAt>0&&meta.dueAt<=now) due+=1;
    if(!meta.hasProgress&&!meta.dueAt) fresh+=1;
    else if(meta.level>=4) stable+=1;
    else learning+=1;
  }
  return {
    total:safe.length,
    due,fresh,learning,stable,
    words:safe.filter(x=>x?.kind==='word').length,
    expressions:safe.filter(x=>x?.kind==='expression'||x?.kind==='construction').length,
  };
}

function stableHash(text){
  let h=2166136261;
  const s=String(text||'');
  for(let i=0;i<s.length;i+=1){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}

function candidate(entry,levelState,now,index,rotationSeed=0){
  const meta=vocabularyLevelInfo(levelState,entry);
  const due=meta.dueAt>0&&meta.dueAt<=now;
  const fresh=!meta.hasProgress&&!meta.dueAt;
  const overdueDays=due?Math.min(90,Math.max(0,(now-meta.dueAt)/DAY_MS)):0;
  let bucket='early';
  let score=500;
  if(due){ bucket='due'; score=10000+overdueDays*40; }
  else if(fresh){ bucket='fresh'; score=6000; }
  else if(meta.level>=4){ bucket='stable'; score=300; }
  else{ bucket='learning'; score=700; }
  score+=(stableHash(`${entry?.id}|${Math.floor(now/DAY_MS)}|${rotationSeed}`)%1000)/1000;
  return {entry,index,...meta,due,fresh,bucket,score};
}

export function buildVocabularySession(entries,levelState={},options={}){
  const now=Number(options.now)||Date.now();
  const kind=['word','expression'].includes(options.kind)?options.kind:'all';
  const requested=Math.max(1,Math.min(30,Math.round(Number(options.size)||12)));
  const newCapRaw=Number(options.newCap);
  const newCap=Number.isFinite(newCapRaw)
    ? Math.max(0,Math.min(requested,Math.round(newCapRaw)))
    : Math.min(8,requested);
  const source=(Array.isArray(entries)?entries:[]).filter(entry=>kind==='all'
    ||(kind==='word'?entry?.kind==='word':entry?.kind==='expression'||entry?.kind==='construction'));
  const rotationSeed=Math.max(0,Math.round(Number(options.rotationSeed)||0));
  const recentIds=new Set(Array.from(options.recentItemIds||[],String));
  const allMetas=source.map((entry,index)=>candidate(entry,levelState,now,index,rotationSeed));
  for(const meta of allMetas){
    if(!meta.due&&recentIds.has(String(meta.entry?.id))) meta.score-=20000;
  }
  const recentDeferred=allMetas.filter(meta=>!meta.due&&recentIds.has(String(meta.entry?.id))).length;
  const due=allMetas.filter(x=>x.bucket==='due').sort((a,b)=>b.score-a.score);
  const fresh=allMetas.filter(x=>x.bucket==='fresh').sort((a,b)=>b.score-a.score);
  const early=allMetas.filter(x=>x.bucket==='learning').sort((a,b)=>b.score-a.score);
  const stable=allMetas.filter(x=>x.bucket==='stable').sort((a,b)=>b.score-a.score);
  const selected=[];
  const pushFrom=(list,limit=Infinity)=>{
    let used=0;
    while(selected.length<requested&&list.length&&used<limit){selected.push(list.shift());used+=1;}
    return used;
  };
  pushFrom(due);
  const freshUsed=pushFrom(fresh,newCap);
  pushFrom(early);
  pushFrom(stable);
  return {
    entries:selected.map(x=>x.entry),
    size:selected.length,
    due:selected.filter(x=>x.bucket==='due').length,
    fresh:freshUsed,
    early:selected.filter(x=>x.bucket==='learning'||x.bucket==='stable').length,
    kind,newCap,rotationSeed,recentExcluded:recentDeferred,
  };
}

export function normalizeVocabularyAnswer(text){
  return String(text??'')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘‛ʼ＇]/g,"'")
    .replace(/[‐‑‒–—―−﹘﹣－]/g,'-')
    .replace(/'/g,'')
    .replace(/\s*-\s*/g,'-')
    .replace(/\p{P}/gu, character=>character==='-'?'-':' ')
    .replace(/\s+/g,' ')
    .trim();
}

function occurrenceSourceSurface(activeOccurrence){
  const source=activeOccurrence?.item?.en;
  const occurrence=activeOccurrence?.occurrence||activeOccurrence;
  const start=Number(occurrence?.start),end=Number(occurrence?.end);
  if(typeof source!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>source.length) return '';
  return source.slice(start,end);
}

export function answerVariants(entry,activeOccurrence=null){
  const canonical=String(entry?.canonical||'').trim();
  if(!canonical) return [];
  return [...new Set([canonical,...(Array.isArray(entry?.answers)?entry.answers:[]),occurrenceSourceSurface(activeOccurrence)]
    .map(value=>String(value||'').trim()).filter(Boolean))];
}

export function classifyVocabularyAnswer({entry,activeOccurrence=null,transcript=''}={}){
  const normalized=normalizeVocabularyAnswer(transcript);
  if(!normalized||!entry) return {type:'miss',matchedText:'',matchedAuthority:null};
  const targetVariants=[
    {text:String(entry.canonical||''),authority:'canonical'},
    ...(Array.isArray(entry.answers)?entry.answers.map(text=>({text:String(text||''),authority:'answer'})):[]),
    {text:occurrenceSourceSurface(activeOccurrence),authority:'source'},
  ];
  for(const variant of targetVariants){
    if(variant.text&&normalizeVocabularyAnswer(variant.text)===normalized){
      return {type:'target',matchedText:variant.text,matchedAuthority:variant.authority};
    }
  }
  for(const text of Array.isArray(entry.paraphrases)?entry.paraphrases:[]){
    if(String(text||'')&&normalizeVocabularyAnswer(text)===normalized){
      return {type:'paraphrase',matchedText:String(text),matchedAuthority:'paraphrase'};
    }
  }
  return {type:'miss',matchedText:'',matchedAuthority:null};
}

export function classifyVocabularyHypotheses({entry,activeOccurrence=null,hypotheses=[],transcript='',correction=false}={}){
  const candidates=hypotheses.length?hypotheses:[{transcript}];
  let selected={type:'miss',matchedText:'',matchedAuthority:null,selectedHypothesisIndex:0,selectedTranscript:transcript};
  for(const [index,candidate] of candidates.entries()){
    const result=classifyVocabularyAnswer({entry,activeOccurrence,transcript:candidate.transcript});
    if(result.type==='target') return {...result,selectedHypothesisIndex:index,selectedTranscript:candidate.transcript};
    if(!correction&&result.type==='paraphrase'&&selected.type==='miss') selected={...result,selectedHypothesisIndex:index,selectedTranscript:candidate.transcript};
  }
  return selected;
}

export function shouldUpdateVocabularyLevel(answerType){
  return answerType==='target'||answerType==='miss';
}

export function applyVocabularyAnswerSrs(answerType,updateTargetLevel){
  if(!shouldUpdateVocabularyLevel(answerType)) return {updated:false,value:undefined};
  const rate=answerType==='target'?1:0;
  return {updated:true,rate,value:typeof updateTargetLevel==='function'?updateTargetLevel(rate):undefined};
}

export function displayAnswer(entry){
  return String(entry?.canonical||'').trim();
}

export function displayMeaning(entry){
  return String(entry?.meaning_ja||'')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/[ \t\r\n]+/g,' ')
    .replace(/\s*([、。！？：；])\s*/g,'$1')
    .trim();
}
