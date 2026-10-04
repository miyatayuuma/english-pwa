import { answerVariants, classifyVocabularyAnswer, normalizeVocabularyAnswer } from '../app/vocabularyLearningCore.js';

const FILLERS=new Set(['uh','um','er','ah','hmm']);
const words=value=>normalizeVocabularyAnswer(value).split(' ').filter(Boolean);
function withoutFillers(value,targetWords){
  return words(value).filter(word=>!FILLERS.has(word)||targetWords.includes(word));
}
function isRestartPrefix(prefix,target){
  // A restart is one or more exact prefixes of this target, never arbitrary extra words.
  const reachable=new Set([0]);
  for(let start=0;start<prefix.length;start++){
    if(!reachable.has(start)) continue;
    for(let length=1;length<=target.length&&start+length<=prefix.length;length++){
      if(prefix[start+length-1]!==target[length-1]) break;
      reachable.add(start+length);
    }
  }
  return reachable.has(prefix.length);
}
export function isTargetSpeechProduction(transcript,expected){
  const target=words(expected),spoken=withoutFillers(transcript,target);
  if(!target.length||spoken.length<target.length) return false;
  const offset=spoken.length-target.length;
  if(!target.every((word,index)=>word===spoken[offset+index])) return false;
  return isRestartPrefix(spoken.slice(0,offset),target);
}

function targetProduction({entry,activeOccurrence,transcript}){
  for(const expected of answerVariants(entry,activeOccurrence)){
    if(isTargetSpeechProduction(transcript,expected))
      return classifyVocabularyAnswer({entry,activeOccurrence,transcript:expected});
  }
  return null;
}
function outsideSegmentIsHarmless(segments,index,expected){
  const target=words(expected);
  const before=segments.slice(0,index).flatMap(segment=>withoutFillers(segment.primaryTranscript,target));
  const after=segments.slice(index+1).flatMap(segment=>withoutFillers(segment.primaryTranscript,target));
  return !after.length&&isRestartPrefix(before,target);
}

// Provider alternatives are evidence from ONE segment. Never synthesize an alternative utterance.
export function classifyVocabularySpeechAnswer({entry,activeOccurrence=null,transcript='',recognitionSegments=[],correction=false}={}){
  const primary=classifyVocabularyAnswer({entry,activeOccurrence,transcript});
  const metadata={primaryTranscript:transcript,targetRescued:false,recognitionSegmentIndex:null,asrRank:null};
  if(primary.type==='target'||(primary.type==='paraphrase'&&!correction)) return {...primary,...metadata,recognitionAuthority:'primary'};
  const tolerated=targetProduction({entry,activeOccurrence,transcript});
  if(tolerated) return {...tolerated,...metadata,recognitionAuthority:'filler-restart'};
  for(const [index,segment] of recognitionSegments.entries()){
    for(const candidate of segment.alternatives||[]){
      if(candidate.asrRank===0) continue;
      const accepted=targetProduction({entry,activeOccurrence,transcript:candidate.transcript});
      if(!accepted||!outsideSegmentIsHarmless(recognitionSegments,index,accepted.matchedText)) continue;
      return {...accepted,...metadata,targetRescued:true,recognitionAuthority:'nbest-target',recognitionSegmentIndex:segment.segmentIndex??index,asrRank:candidate.asrRank};
    }
  }
  return {type:'miss',matchedText:'',matchedAuthority:null,...metadata,recognitionAuthority:'unmatched'};
}
