const FUNCTION_WORDS=new Set(['a','an','the','to','of','in','on','at','for','from','with','as','and','or','but','that','this','these','those','is','are','was','were','be','been','being','do','does','did','have','has','had','will','would','can','could','may','might','should','must']);
const FALLBACK_STOPWORDS=new Set([...FUNCTION_WORDS,'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','who','what','when','where','why','how','not','no','yes','very','just','so','too']);
const PLACEHOLDERS=new Set(['a','b','c','x','y','z','one','ones','someone','somebody','something']);

function norm(text){
  return String(text||'').normalize('NFKC').replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
}
function tokenNorm(text){ return norm(text).toLowerCase().replace(/^['-]+|['-]+$/g,''); }

export function sentenceTokens(sentence){
  const text=String(sentence||'');
  const out=[];
  const re=/[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let match;
  while((match=re.exec(text))){
    out.push({surface:match[0],norm:tokenNorm(match[0]),start:match.index,end:match.index+match[0].length,index:out.length});
  }
  return out;
}

function simpleStem(token){
  const t=tokenNorm(token);
  if(t.length<=3) return t;
  if(/ies$/.test(t)&&t.length>4) return `${t.slice(0,-3)}y`;
  if(/ied$/.test(t)&&t.length>4) return `${t.slice(0,-3)}y`;
  if(/ing$/.test(t)&&t.length>5) return t.slice(0,-3).replace(/(.)\1$/,'$1');
  if(/ed$/.test(t)&&t.length>4) return t.slice(0,-2).replace(/(.)\1$/,'$1');
  if(/es$/.test(t)&&t.length>4) return t.slice(0,-2);
  if(/s$/.test(t)&&t.length>3) return t.slice(0,-1);
  return t;
}

function tokenMatches(a,b){
  const aa=tokenNorm(a),bb=tokenNorm(b);
  return aa===bb || simpleStem(aa)===simpleStem(bb);
}

function rawHeadwordTokens(headword){
  return norm(headword)
    .replace(/[\[\](),.;:!?]/g,' ')
    .replace(/[~～…]/g,' ')
    .replace(/one['’]?s/gi,' ')
    .split(/\s+/)
    .map(tokenNorm)
    .filter(Boolean)
    .filter(token=>!PLACEHOLDERS.has(token));
}

function anchorsFor(entry){
  const raw=rawHeadwordTokens(entry?.headword||'');
  if(entry?.kind==='word') return raw.slice(0,1);
  const meaningful=raw.filter(token=>!FUNCTION_WORDS.has(token));
  if(meaningful.length>=2) return meaningful;
  if(meaningful.length===1){
    const index=raw.indexOf(meaningful[0]);
    const neighbor=raw[index+1]||raw[index-1];
    return neighbor?[meaningful[0],neighbor]:meaningful;
  }
  return raw.slice(0,3);
}

function findOrderedSpan(tokens,anchors,{maxGap=4}={}){
  if(!tokens.length||!anchors.length) return null;
  let best=null;
  for(let start=0;start<tokens.length;start+=1){
    if(!tokenMatches(tokens[start].norm,anchors[0])) continue;
    let pos=start;
    let ok=true;
    for(let ai=1;ai<anchors.length;ai+=1){
      let found=-1;
      for(let i=pos+1;i<Math.min(tokens.length,pos+maxGap+2);i+=1){
        if(tokenMatches(tokens[i].norm,anchors[ai])){ found=i; break; }
      }
      if(found<0){ok=false;break;}
      pos=found;
    }
    if(!ok) continue;
    const candidate={tokenStart:start,tokenEnd:pos,start:tokens[start].start,end:tokens[pos].end};
    const width=pos-start+1;
    if(!best||width<(best.tokenEnd-best.tokenStart+1)) best=candidate;
  }
  return best;
}

function belongsToItem(entry,itemId){
  return Array.isArray(entry?.example_ids)&&entry.example_ids.includes(itemId);
}

function candidateScore(entry,span){
  const width=span.tokenEnd-span.tokenStart+1;
  let score=entry?.kind==='phrase'?100:55;
  score+=Math.min(30,width*7);
  if(entry?.meaning_confidence==='aligned_high') score+=12;
  else if(entry?.meaning_confidence==='aligned_medium') score+=7;
  if(entry?.match_confidence==='high') score+=8;
  if(entry?.kind==='word'&&FUNCTION_WORDS.has(tokenNorm(entry?.headword))) score-=80;
  return score;
}

function candidateTier(entry){
  const meaning=String(entry?.meaning_confidence||'');
  if(entry?.match_confidence==='high'&&['aligned_high','aligned_medium'].includes(meaning)) return 0;
  if(entry?.match_confidence==='high'||meaning.startsWith('aligned_')||meaning.startsWith('wiktionary_')) return 1;
  return 2;
}

function stableHash(value){
  let hash=2166136261;
  for(const char of String(value??'')){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}

function overlaps(a,b){ return a.tokenStart<=b.tokenEnd&&b.tokenStart<=a.tokenEnd; }

export function desiredClozeCount(sentence,{max=3}={}){
  const count=sentenceTokens(sentence).length;
  if(count<=6) return Math.min(max,1);
  if(count<=12) return Math.min(max,2);
  return Math.min(max,3);
}

export function adaptiveClozeCount(sentence,level=0){
  const maxForSentence=desiredClozeCount(sentence,{max:3});
  const safeLevel=Math.max(0,Math.min(5,Number(level)||0));
  if(safeLevel<=1) return Math.min(maxForSentence,1);
  if(safeLevel===2) return Math.min(maxForSentence,2);
  return maxForSentence;
}

function fallbackTarget(tokens,sentence){
  const candidates=tokens
    .filter(token=>token.norm.length>=3&&!FALLBACK_STOPWORDS.has(token.norm))
    .filter(token=>!(token.index>0&&/^[A-Z]/.test(token.surface)))
    .sort((a,b)=>{
      const contentScore=token=>{
        let score=Math.min(token.norm.length,10);
        if(/(?:tion|ment|ness|ity|ous|ive|ize|ise|ful|less|able|ibly|edly|ing|ed|ly)$/.test(token.norm)) score+=4;
        if(token.index===0) score-=1;
        return score;
      };
      const quality=contentScore(b)-contentScore(a);
      if(quality) return quality;
      const aCenter=Math.abs(a.index-(tokens.length-1)/2);
      const bCenter=Math.abs(b.index-(tokens.length-1)/2);
      return aCenter-bCenter;
    });
  const token=candidates[0]||tokens.find(t=>!FALLBACK_STOPWORDS.has(t.norm))||tokens[0];
  if(!token) return null;
  return {
    entry_id:'fallback',
    kind:'word',
    headword:token.surface,
    meaning_ja:'',
    tokenStart:token.index,
    tokenEnd:token.index,
    start:token.start,
    end:token.end,
    surface:sentence.slice(token.start,token.end),
    score:1,
    fallback:true,
  };
}

export function selectClozeTargets(item,vocabularyEntries,options={}){
  const sentence=String(item?.en||'');
  const itemId=String(item?.id||'');
  if(!sentence||!itemId) return [];
  const tokens=sentenceTokens(sentence);
  if(tokens.length<3) return [];
  const impliedLevel=Number(options.count)>=3?3:(Number(options.count)===2?2:0);
  const level=Math.max(0,Math.min(5,Number.isFinite(Number(options.level))?Number(options.level):impliedLevel));
  const levelCap=adaptiveClozeCount(sentence,level);
  const targetCount=Math.max(1,Math.min(levelCap,Number(options.count)||levelCap));
  const candidates=[];
  for(const entry of Array.isArray(vocabularyEntries)?vocabularyEntries:[]){
    if(!belongsToItem(entry,itemId)) continue;
    const anchors=anchorsFor(entry);
    const span=findOrderedSpan(tokens,anchors,{maxGap:entry?.kind==='phrase'?4:1});
    if(!span) continue;
    const width=span.tokenEnd-span.tokenStart+1;
    if(width>Math.max(5,Math.ceil(tokens.length*.45))) continue;
    candidates.push({
      entry_id:entry.id,
      kind:entry.kind||'word',
      headword:String(entry.headword||''),
      meaning_ja:String(entry.meaning_ja||''),
      ...span,
      surface:sentence.slice(span.start,span.end),
      score:candidateScore(entry,span),
      tier:candidateTier(entry),
      fallback:false,
    });
  }
  const recent=new Set(Array.from(options.recentTargetIds||[],String));
  const variant=stableHash(`${itemId}:${options.variantKey??options.seed??0}`);
  candidates.sort((a,b)=>a.tier-b.tier || Number(recent.has(a.entry_id))-Number(recent.has(b.entry_id)) || b.score-a.score || a.start-b.start);
  for(let start=0;start<candidates.length;){
    let end=start+1;
    while(end<candidates.length&&candidates[end].tier===candidates[start].tier&&recent.has(candidates[end].entry_id)===recent.has(candidates[start].entry_id)) end+=1;
    const group=candidates.slice(start,end);
    if(group.length>1){
      const offset=variant%group.length;
      candidates.splice(start,group.length,...group.slice(offset),...group.slice(0,offset));
    }
    start=end;
  }
  const softRatio=level<=1?.22:(level===2?.28:.34);
  const normalHardBudget=Math.max(1,Math.min(Math.floor(tokens.length*.4),tokens.length-2));
  const softBudget=Math.max(1,Math.min(normalHardBudget,Math.floor(tokens.length*softRatio)));
  const selected=[];
  let hiddenWords=0;
  for(const candidate of candidates){
    if(selected.some(target=>overlaps(target,candidate))) continue;
    const width=candidate.tokenEnd-candidate.tokenStart+1;
    const projected=hiddenWords+width;
    const phraseException=selected.length===0&&candidate.kind==='phrase'&&candidate.tier===0&&width<=4&&tokens.length>=8&&projected/tokens.length<=.45;
    if(projected>softBudget&&!phraseException) continue;
    if(!phraseException&&projected>normalHardBudget) continue;
    candidate.phraseException=phraseException&&projected>softBudget;
    selected.push(candidate);
    hiddenWords=projected;
    if(candidate.phraseException) break;
    if(selected.length>=targetCount) break;
  }
  if(!selected.length){
    const fallback=fallbackTarget(tokens,sentence);
    if(fallback) selected.push(fallback);
  }
  return selected.sort((a,b)=>a.start-b.start);
}

export function clozeSegments(sentence,targets){
  const text=String(sentence||'');
  const safe=(Array.isArray(targets)?targets:[]).slice().sort((a,b)=>a.start-b.start);
  const out=[];
  let cursor=0;
  for(const target of safe){
    const start=Math.max(cursor,Number(target.start)||0);
    const end=Math.max(start,Number(target.end)||start);
    if(start>cursor) out.push({type:'text',text:text.slice(cursor,start)});
    out.push({type:'blank',text:text.slice(start,end),target});
    cursor=end;
  }
  if(cursor<text.length) out.push({type:'text',text:text.slice(cursor)});
  return out;
}

export function buildClozeCard(item,vocabularyEntries,options={}){
  const targets=selectClozeTargets(item,vocabularyEntries,options);
  return {
    item_id:item?.id||'',
    sentence:item?.en||'',
    translation:item?.ja||'',
    targets,
    segments:clozeSegments(item?.en||'',targets),
    usable:targets.length>0,
  };
}
