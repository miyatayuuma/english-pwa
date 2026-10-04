import { answerVariants, classifyVocabularyAnswer, normalizeVocabularyAnswer } from '../app/vocabularyLearningCore.js';

const words=value=>normalizeVocabularyAnswer(value).split(' ').filter(Boolean);
function containsContiguousTokens(spoken,target){
  if(!target.length||spoken.length<target.length) return false;
  for(let start=0;start<=spoken.length-target.length;start++){
    if(target.every((word,index)=>spoken[start+index]===word)) return true;
  }
  return false;
}
export function isTargetSpeechProduction(transcript,expected){
  return containsContiguousTokens(words(transcript),words(expected));
}
function targetProduction({entry,activeOccurrence,transcript}){
  for(const expected of answerVariants(entry,activeOccurrence)){
    if(!isTargetSpeechProduction(transcript,expected)) continue;
    const classified=classifyVocabularyAnswer({entry,activeOccurrence,transcript:expected});
    if(classified.type==='target') return {...classified,matchedText:expected};
  }
  return null;
}
// Provider alternatives are evidence from ONE segment. Never synthesize an alternative utterance.
export function classifyVocabularySpeechAnswer({entry,activeOccurrence=null,transcript='',recognitionSegments=[],correction=false}={}){
  const primary=classifyVocabularyAnswer({entry,activeOccurrence,transcript});
  const metadata={primaryTranscript:transcript,targetRescued:false,recognitionSegmentIndex:null,asrRank:null};
  if(primary.type==='target'||(primary.type==='paraphrase'&&!correction)) return {...primary,...metadata,recognitionAuthority:'primary'};
  const contained=targetProduction({entry,activeOccurrence,transcript});
  if(contained) return {...contained,...metadata,recognitionAuthority:'contained-target'};
  for(const [index,segment] of recognitionSegments.entries()){
    for(const candidate of segment.alternatives||[]){
      if(candidate.asrRank===0) continue;
      const accepted=targetProduction({entry,activeOccurrence,transcript:candidate.transcript});
      if(!accepted) continue;
      return {...accepted,...metadata,targetRescued:true,recognitionAuthority:'nbest-target',recognitionSegmentIndex:segment.segmentIndex??index,asrRank:candidate.asrRank};
    }
  }
  return {type:'miss',matchedText:'',matchedAuthority:null,...metadata,recognitionAuthority:'unmatched'};
}
