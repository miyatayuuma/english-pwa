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
      const len=b.norm.length-a.norm.length;
      if(len) return len;
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
  const targetCount=Math.max(1,Number(options.count)||desiredClozeCount(sentence,options));
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
    });
  }
  candidates.sort((a,b)=>b.score-a.score || (b.tokenEnd-b.tokenStart)-(a.tokenEnd-a.tokenStart) || a.start-b.start);
  const selected=[];
  for(const candidate of candidates){
    if(selected.some(target=>overlaps(target,candidate))) continue;
    selected.push(candidate);
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
