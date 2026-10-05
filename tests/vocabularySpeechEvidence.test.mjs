import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyVocabularySpeechAnswer,isTargetSpeechProduction} from '../scripts/speech/vocabularySpeechEvidence.js';
import {classifyVocabularyAnswer} from '../scripts/app/vocabularyLearningCore.js';
const segment=(values,index=0)=>({segmentIndex:index,primaryTranscript:values[0],isFinal:true,alternatives:values.map((transcript,asrRank)=>({transcript,asrRank,confidence:0}))});
const entry=(canonical,extra={})=>({canonical,...extra});
const grade=(canonical,transcript,options={})=>classifyVocabularySpeechAnswer({entry:entry(canonical),transcript,...options});

test('strict TARGET token sequence anywhere in primary utterance is accepted and raw evidence is retained',()=>{
  const target='yield to something';
  const accepted=['yield to something','please yield to something','yield to something please','I mean yield to something please','something yield to something again','not yield to something','I refuse to yield to something','yield something yield to something'];
  for(const spoken of accepted){
    const result=grade(target,spoken);
    assert.equal(result.type,'target',spoken);
    assert.equal(result.targetRescued,false,spoken);
    assert.equal(result.primaryTranscript,spoken,spoken);
    assert.equal(result.matchedText,target,spoken);
    assert.equal(result.recognitionAuthority,'exact',spoken);
  }
  for(const spoken of ['not yield to something',"I won't yield to something",'I refuse to yield to something']){
    assert.equal(grade(target,spoken).type,'target','meaning and negation are deliberately not evaluated: '+spoken);
  }
  assert.equal(classifyVocabularyAnswer({entry:entry(target),transcript:'I mean yield to something please'}).type,'miss','strict lexical authority remains unchanged');
});

test('TARGET sequence must be contiguous; words inside it cannot be skipped',()=>{
  for(const spoken of ['yield um to something','yield please to something','yield to definitely something','years to something','yield something','yield to do something','yielded to something']){
    assert.equal(grade('yield to something',spoken).type,'miss',spoken);
    assert.equal(isTargetSpeechProduction(spoken,'yield to something'),false,spoken);
  }
});

test('matching uses normalized word boundaries rather than string substrings',()=>{
  for(const [target,spoken] of [['yield','yielded'],['yield','yields'],['yell','yelling'],['be in','being']]){
    assert.equal(grade(target,spoken).type,'miss',spoken+' must not contain token sequence '+target);
  }
  assert.equal(grade('yield to something','well, yield to something, please').type,'target');
  assert.equal(isTargetSpeechProduction('WELL, yield to something, please.','yield to something'),true);
});

test('canonical, answers, and active source surfaces are containment authorities; paraphrases are not',()=>{
  const withAnswer=entry('yield to something',{answers:['yield to pressure'],paraphrases:['give in to pressure']});
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'please yield to pressure again'}).type,'target');
  const source='He will yield to pressure soon.';
  const start=source.indexOf('yield to pressure');
  const activeOccurrence={item:{en:source},occurrence:{start,end:start+'yield to pressure'.length}};
  assert.equal(classifyVocabularySpeechAnswer({entry:entry('yield to something'),activeOccurrence,transcript:'please yield to pressure again'}).type,'target');
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'I would give in to pressure'}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'I would give in to pressure',recognitionSegments:[segment(['wrong','please give in to pressure again'])]}).type,'miss');
});

test('lower N-best rank 20 rescues an independent contained TARGET candidate and preserves primary rank-one evidence',()=>{
  const alternatives=Array.from({length:20},(_,i)=>i===0?'years to something':i===19?'please yield to something again':'unrelated speech');
  const recognitionSegments=[segment(alternatives,0)];
  const result=classifyVocabularySpeechAnswer({entry:entry('yield to something'),transcript:alternatives[0],recognitionSegments});
  assert.equal(result.type,'target');
  assert.equal(result.targetRescued,true);
  assert.equal(result.recognitionAuthority,'nbest-exact');
  assert.equal(result.asrRank,19);
  assert.equal(result.primaryTranscript,alternatives[0]);
});

test('lower N-best paraphrases, phonetic near-matches, and incomplete TARGET fragments are not rescued',()=>{
  const e=entry('yield to something',{paraphrases:['give in to something']});
  for(const lower of ['give in to something','years to something','yield to','something','yield something','yield to do something']){
    const result=classifyVocabularySpeechAnswer({entry:e,transcript:'wrong',recognitionSegments:[segment(['wrong',lower])]});
    assert.equal(result.type,'miss',lower);
  }
});

test('lower candidates stay independent across segments; primary accumulation remains allowed',()=>{
  const e=entry('yield to something');
  const splitOnly=[segment(['wrong','yield to'],0),segment(['wrong','something'],1)];
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'wrong wrong',recognitionSegments:splitOnly}).type,'miss');
  const oneCandidateAlongsideOtherWords=[segment(['not','years to something'],0),segment(['other','yield to something'],1)];
  const rescued=classifyVocabularySpeechAnswer({entry:e,transcript:'not other',recognitionSegments:oneCandidateAlongsideOtherWords});
  assert.equal(rescued.type,'target');
  assert.equal(rescued.recognitionAuthority,'nbest-exact');
  assert.equal(rescued.asrRank,1);
  assert.equal(rescued.recognitionSegmentIndex,1);
  const primary=classifyVocabularySpeechAnswer({entry:e,transcript:'yield to something',recognitionSegments:[segment(['yield to'],0),segment(['something'],1)]});
  assert.equal(primary.type,'target');
  assert.equal(primary.recognitionAuthority,'exact');
  assert.equal(primary.recognitionSegmentIndex,null,'a TARGET joined across two primary segments has no single supporting segment');
});

test('correction accepts contained strict TARGET while preserving correction and paraphrase rules',()=>{
  const e=entry('come across someone',{paraphrases:['run into someone']});
  const target=classifyVocabularySpeechAnswer({entry:e,transcript:'okay come across someone again',correction:true});
  assert.equal(target.type,'target');assert.equal(target.targetRescued,false);
  assert.equal(target.recognitionAuthority,'exact');
  assert.equal(target.targetMatchKind,'contained-target');
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'run into someone',correction:true}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'run into someone'}).type,'paraphrase');
});

test('prose/pros is TARGET with rule provenance while raw provider evidence stays pros',()=>{
  const segment=segmentFactory(['pros']);
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01089',canonical:'prose'},
    transcript:'pros',
    recognitionSegments:[segment],
  });
  assert.equal(result.type,'target');
  assert.equal(result.matchedAuthority,'canonical');
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.matchedExpected,'prose');
  assert.equal(result.observed,'pros');
  assert.equal(result.rawTranscript,'pros');
  assert.equal(result.displayTranscript,'prose');
  assert.equal(result.speechMatch.ruleId,'prose-pros');
  assert.equal(result.speechMatch.ruleKind,'homophone');
  assert.equal(result.recognitionSegmentIndex,0);
  assert.equal(result.asrRank,0);
  assert.equal(segment.alternatives[0].transcript,'pros');
});

test('lower N-best explicit TARGET equivalence records selected raw segment/rank without paraphrase rescue',()=>{
  const recognitionSegments=[segmentFactory(['wrong','pros'])];
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01089',canonical:'prose'},
    transcript:'wrong',
    recognitionSegments,
  });
  assert.equal(result.type,'target');
  assert.equal(result.targetRescued,true);
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.primaryTranscript,'wrong');
  assert.equal(result.rawTranscript,'pros');
  assert.equal(result.displayTranscript,'prose');
  assert.equal(result.asrRank,1);
  assert.equal(result.recognitionSegmentIndex,0);
  assert.equal(recognitionSegments[0].alternatives[1].transcript,'pros');
});

test('postwar/post war is explicit TARGET equivalence with raw transcript display',()=>{
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01943',canonical:'postwar'},
    transcript:'post war',
  });
  assert.equal(result.type,'target');
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.speechMatch.ruleId,'postwar-post-war');
  assert.equal(result.rawTranscript,'post war');
  assert.equal(result.displayTranscript,'post war');
});

test('legacy phonetic/one-edit examples remain Vocabulary MISS',()=>{
  for(const [canonical,spoken] of [['yell','yeah'],['live','love'],['cat','cut'],['price','prize'],['walk','talk']]){
    assert.equal(classifyVocabularySpeechAnswer({entry:{canonical},transcript:spoken}).type,'miss',`${canonical} / ${spoken}`);
  }
});

function segmentFactory(values,index=0){
  return {segmentIndex:index,primaryTranscript:values[0],isFinal:true,
    alternatives:values.map((transcript,asrRank)=>({transcript,asrRank,confidence:null}))};
}
