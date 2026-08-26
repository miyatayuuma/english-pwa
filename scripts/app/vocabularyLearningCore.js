const DAY_MS=24*60*60*1000;

export function vocabStateId(entry){
  return String(entry?.id||'').trim();
}

export function readyVocabularyEntries(db){
  const entries=Array.isArray(db)?db:(Array.isArray(db?.entries)?db.entries:[]);
  return entries.filter(entry=>{
    const headword=String(entry?.headword||'').trim();
    const meaning=String(entry?.meaning_ja||'').trim();
    return !!headword && !!meaning && entry?.match_confidence!=='low';
  });
}

export function vocabularyLevelInfo(levelState,entry){
  const id=vocabStateId(entry);
  const info=(id&&levelState?.[id]&&typeof levelState[id]==='object')?levelState[id]:{};
  const last=Number(info.last);
  const best=Number(info.best);
  const level=Number.isFinite(last)?last:(Number.isFinite(best)?best:0);
  const dueAt=Number(info?.review?.nextDueAt ?? info?.nextDueAt ?? 0);
  const updatedAt=Number(info?.updatedAt||0);
  return {
    id,
    info,
    level:Math.max(0,Math.min(5,Number.isFinite(level)?level:0)),
    dueAt:Number.isFinite(dueAt)&&dueAt>0?dueAt:0,
    updatedAt:Number.isFinite(updatedAt)&&updatedAt>0?updatedAt:0,
  };
}

export function vocabularyStats(entries,levelState={},now=Date.now()){
  const safe=Array.isArray(entries)?entries:[];
  let due=0,fresh=0,learning=0,stable=0;
  for(const entry of safe){
    const meta=vocabularyLevelInfo(levelState,entry);
    if(meta.dueAt>0&&meta.dueAt<=now) due+=1;
    if(!meta.updatedAt&&!meta.dueAt) fresh+=1;
    else if(meta.level>=4) stable+=1;
    else learning+=1;
  }
  return {
    total:safe.length,
    due,fresh,learning,stable,
    words:safe.filter(x=>x?.kind==='word').length,
    phrases:safe.filter(x=>x?.kind==='phrase').length,
  };
}

function stableHash(text){
  let h=2166136261;
  const s=String(text||'');
  for(let i=0;i<s.length;i+=1){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}

function candidate(entry,levelState,now,index){
  const meta=vocabularyLevelInfo(levelState,entry);
  const due=meta.dueAt>0&&meta.dueAt<=now;
  const fresh=!meta.updatedAt&&!meta.dueAt;
  const overdueDays=due?Math.min(90,Math.max(0,(now-meta.dueAt)/DAY_MS)):0;
  let bucket='early';
  let score=500;
  if(due){ bucket='due'; score=10000+overdueDays*40; }
  else if(fresh){ bucket='fresh'; score=6000; }
  else if(meta.level>=4){ bucket='stable'; score=300; }
  else{ bucket='learning'; score=700; }
  score+=(stableHash(`${entry?.id}|${Math.floor(now/DAY_MS)}`)%1000)/1000;
  return {entry,index,...meta,due,fresh,bucket,score};
}

export function buildVocabularySession(entries,levelState={},options={}){
  const now=Number(options.now)||Date.now();
  const kind=options.kind==='word'||options.kind==='phrase'?options.kind:'all';
  const requested=Math.max(1,Math.min(30,Math.round(Number(options.size)||12)));
  const newCapRaw=Number(options.newCap);
  const newCap=Number.isFinite(newCapRaw)
    ? Math.max(0,Math.min(requested,Math.round(newCapRaw)))
    : Math.min(8,requested);
  const source=(Array.isArray(entries)?entries:[]).filter(entry=>kind==='all'||entry?.kind===kind);
  const metas=source.map((entry,index)=>candidate(entry,levelState,now,index));
  const due=metas.filter(x=>x.bucket==='due').sort((a,b)=>b.score-a.score);
  const fresh=metas.filter(x=>x.bucket==='fresh').sort((a,b)=>b.score-a.score);
  const early=metas.filter(x=>x.bucket==='learning').sort((a,b)=>b.score-a.score);
  const stable=metas.filter(x=>x.bucket==='stable').sort((a,b)=>b.score-a.score);
  const selected=[];
  const pushFrom=(list,limit=Infinity)=>{
    let used=0;
    while(selected.length<requested&&list.length&&used<limit){
      selected.push(list.shift());
      used+=1;
    }
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
    kind,
    newCap,
  };
}

function normalizeAnswer(text){
  return String(text||'')
    .normalize('NFKC')
    .replace(/[’‘]/g,"'")
    .replace(/[“”]/g,'"')
    .replace(/[～~…]+/g,' ')
    .replace(/\b([ABCSVXYZ])\b/g,' ')
    .replace(/["“”]/g,'')
    .replace(/\s+([,.;:!?])/g,'$1')
    .replace(/\s+/g,' ')
    .trim();
}

function expandInlineSuffix(text){
  const m=String(text).match(/^(.*?)([A-Za-z]+)\(([A-Za-z]+)\)(.*)$/);
  if(!m) return [text];
  const [,before,base,suffix,after]=m;
  return [`${before}${base}${after}`,`${before}${base}${suffix}${after}`];
}

function expandOptional(text,open='(',close=')'){
  const s=String(text);
  const start=s.indexOf(open);
  const end=start>=0?s.indexOf(close,start+1):-1;
  if(start<0||end<0) return [s];
  const before=s.slice(0,start),inside=s.slice(start+1,end),after=s.slice(end+1);
  return [`${before}${after}`,`${before}${inside}${after}`];
}

function expandBracketChoice(text){
  const s=String(text);
  const start=s.indexOf('['),end=start>=0?s.indexOf(']',start+1):-1;
  if(start<0||end<0) return [s];
  const before=s.slice(0,start),inside=s.slice(start+1,end),after=s.slice(end+1);
  return [`${before}${after}`,`${before}${inside}${after}`];
}

function pronounVariants(text){
  const s=String(text);
  if(!/one['’]?s|oneself/i.test(s)) return [s];
  const possessives=["one's",'my','your','his','her','their'];
  const reflexives=['oneself','myself','yourself','himself','herself','themselves'];
  const out=[];
  for(let i=0;i<Math.max(possessives.length,reflexives.length);i+=1){
    out.push(s
      .replace(/one['’]?s/gi,possessives[i%possessives.length])
      .replace(/oneself/gi,reflexives[i%reflexives.length]));
  }
  return out;
}

export function answerVariants(entry){
  const raw=String(entry?.headword||'').trim();
  if(!raw) return [];
  const pieces=raw.split(/\s*\/\s*/).filter(Boolean);
  const seeds=pieces.length>1?pieces:[raw];
  const variants=[];
  for(const seed of seeds){
    let expanded=expandInlineSuffix(seed);
    expanded=expanded.flatMap(x=>expandBracketChoice(x));
    expanded=expanded.flatMap(x=>expandOptional(x));
    expanded=expanded.flatMap(x=>pronounVariants(x));
    for(const value of expanded){
      const normalized=normalizeAnswer(value)
        .replace(/\b(?:etc)\.?$/i,'')
        .replace(/\s+/g,' ')
        .trim();
      if(normalized) variants.push(normalized);
    }
  }
  if(/^[A-Za-z]+(?:-[A-Za-z]+){2,}$/.test(raw)) variants.push(...raw.split('-'));
  return [...new Set(variants)].slice(0,18);
}

export function displayAnswer(entry){
  const variants=answerVariants(entry);
  return variants[0]||String(entry?.headword||'').trim();
}
