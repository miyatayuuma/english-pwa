import { sentenceTokens } from '../app/clozeLearningCore.js';

const CLAUSE_STARTS=new Set(['that','when','while','because','although','if','unless','until','where','which','who','but','and']);
const PHRASE_STARTS=new Set([...CLAUSE_STARTS,'with','without','from','into','through','before','after','near','for','in','on','at']);

// Lightweight speech-only boundaries. Reordering's tile ownership is deliberately separate.
export function buildRecognitionChunks(expectedUtterance,{targets=[],includeWhole=false,wholeBoost=8,targetBoost=7,overlapBoost=6,otherBoost=5}={}) {
  const sentence=String(expectedUtterance||'');
  const tokens=sentenceTokens(sentence);
  if(!tokens.length) return [];
  const ranges=targets.filter(target=>target&&Number.isInteger(target.tokenStart)&&Number.isInteger(target.tokenEnd)&&target.tokenStart>=0&&target.tokenEnd>=target.tokenStart&&target.tokenEnd<tokens.length);
  const phrases=[];
  const add=(start,end,boost,authority)=>{
    if(start>end) return;
    phrases.push({text:sentence.slice(tokens[start].start,tokens[end].end),boost,authority});
  };
  if(includeWhole) phrases.push({text:sentence.trim(),boost:wholeBoost,authority:'expected-utterance'});
  const containing=(start,end)=>ranges.some(target=>start<=target.tokenStart&&end>=target.tokenEnd);
  const avoidTargetCut=end=>{
    const target=ranges.find(target=>target.tokenStart<end&&target.tokenEnd>=end);
    return target?target.tokenEnd+1:end;
  };
  const boundaries=[0];
  let start=0;
  while(start<tokens.length){
    const maxEnd=Math.min(tokens.length,start+8);
    let end=maxEnd;
    // Prefer a real clause or punctuation break before a size-based phrase break.
    for(let i=start+3;i<maxEnd;i++){
      const gap=sentence.slice(tokens[i-1].end,tokens[i].start);
      if(/[.;!?]/.test(gap)||CLAUSE_STARTS.has(tokens[i].norm)){end=i;break;}
    }
    if(end===maxEnd&&maxEnd<tokens.length){
      for(let i=maxEnd-1;i>=start+3;i--) if(PHRASE_STARTS.has(tokens[i].norm)){end=i;break;}
    }
    end=avoidTargetCut(end);
    if(tokens.length-end<3&&end<tokens.length&&tokens.length-start<=10) end=tokens.length;
    boundaries.push(end);start=end;
  }
  // Short sentences still receive phrase context, rather than one high-boost full sentence.
  if(!includeWhole&&boundaries.length===2&&tokens.length>=4){
    let split=avoidTargetCut(Math.floor(tokens.length/2));
    if(split>=tokens.length) split=ranges[0]?.tokenStart||Math.floor(tokens.length/2);
    if(split>0&&split<tokens.length) boundaries.splice(1,0,split);
  }
  for(let i=0;i<boundaries.length-1;i++){
    const left=boundaries[i],right=boundaries[i+1]-1;
    const targetBearing=includeWhole||containing(left,right);
    add(left,right,targetBearing?targetBoost:otherBoost,targetBearing?'target-chunk':'sentence-chunk');
  }
  if(includeWhole&&tokens.length>=3){
    add(0,tokens.length-2,targetBoost,'target-chunk');
    add(1,tokens.length-1,overlapBoost,'overlap-chunk');
  }
  for(const target of ranges){
    add(target.tokenStart,target.tokenEnd,targetBoost,'target-chunk');
    // Contain the complete MWE and nearby predicate/arguments, not independent word hints.
    add(Math.max(0,target.tokenStart-2),Math.min(tokens.length-1,target.tokenEnd+2),targetBoost,'target-chunk');
    add(Math.max(0,target.tokenStart-1),Math.min(tokens.length-1,target.tokenEnd+3),overlapBoost,'overlap-chunk');
  }
  for(let i=1;i<boundaries.length-1;i++){
    const boundary=boundaries[i];
    const left=Math.max(boundaries[i-1],boundary-3),right=Math.min(tokens.length-1,boundary+3);
    add(left,right,includeWhole||containing(left,right)?overlapBoost:otherBoost,'overlap-chunk');
  }
  return phrases;
}
