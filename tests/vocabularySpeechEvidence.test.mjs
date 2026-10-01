import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyVocabularySpeechAnswer,isTargetSpeechProduction} from '../scripts/speech/vocabularySpeechEvidence.js';
import {classifyVocabularyAnswer} from '../scripts/app/vocabularyLearningCore.js';
const segment=(values,index=0)=>({segmentIndex:index,primaryTranscript:values[0],isFinal:true,alternatives:values.map((transcript,asrRank)=>({transcript,asrRank,confidence:0}))});
const grade=(canonical,values,options={})=>classifyVocabularySpeechAnswer({entry:{canonical},transcript:values[0],nativeSegments:[segment(values)],...options});

for(const [target,native] of [
  ['yield to something',['YouTube something','yield to something','able to something']],
  ['scarcely',['scarcity','scarcely']],
  ['confuse',['confused','confuse']],
]) test(`observed PWA false-negative fixture ${target} is rescued by actual native TARGET`,()=>{
  const result=grade(target,native);assert.equal(result.type,'target');assert.equal(result.targetRescued,true);
  assert.equal(result.primaryTranscript,native[0]);assert.equal(result.nativeRank,1);assert.equal(result.nativeSegmentIndex,0);
  assert.equal(classifyVocabularyAnswer({entry:{canonical:target},transcript:native[0]}).type,'miss');
});
test('meaningful wrong words and lower-rank paraphrases are not promoted, primary PARAPHRASE survives',()=>{
  const entry={canonical:'yield to something',paraphrases:['give in to something']};
  assert.equal(grade(entry.canonical,['able to do it','YouTube is something','want to do something']).type,'miss');
  assert.equal(grade(entry.canonical,['YouTube something','give in to something'],{entry}).type,'miss');
  assert.equal(grade(entry.canonical,['give in to something','yield to something'],{entry}).type,'paraphrase');
  assert.equal(grade(entry.canonical,['give in to something'],{entry,correction:true}).type,'miss');
  assert.equal(grade(entry.canonical,['give in to something','yield to something'],{entry,correction:true}).type,'target');
  for(const value of ['not yield to something',"I won't yield to something",'I refuse to yield to something','want to something','able to something','yield something yield to something'])
    assert.equal(grade(entry.canonical,[value]).type,'miss',value);
});
test('limited fillers and exact target-prefix restarts pass without changing raw input or semantic classifier',()=>{
  const target='yield to something';
  for(const value of ['uh yield to something','um yield to something','er yield to something ah','yield... yield to something','yield yield to something','yield to something uh','yield to something um','yield to yield to something','yield um to something']){
    const result=grade(target,[value]);assert.equal(result.type,'target',value);assert.equal(result.primaryTranscript,value);
    assert.equal(result.targetRescued,false);assert.equal(result.recognitionAuthority,'filler-restart');
    assert.equal(classifyVocabularyAnswer({entry:{canonical:target},transcript:value}).type,'miss','strict lexical authority is unchanged');
  }
  assert.equal(isTargetSpeechProduction('something yield to something',target),false);
});
test('native TARGET evidence cannot discard meaningful words in other segments or synthesize cross-result candidates',()=>{
  const entry={canonical:'yield to something'};
  const run=nativeSegments=>classifyVocabularySpeechAnswer({entry,transcript:nativeSegments.map(s=>s.primaryTranscript).join(' '),nativeSegments});
  assert.equal(run([segment(['YouTube','yield to'],0),segment(['anything','something'],1)]).type,'miss');
  assert.equal(run([segment(['not'],0),segment(['YouTube something','yield to something'],1)]).type,'miss');
  assert.equal(run([segment(['YouTube something','yield to something'],0),segment(['not'],1)]).type,'miss');
  assert.equal(run([segment(['uh yield'],0),segment(['YouTube something','yield to something'],1),segment(['um'],2)]).type,'target');
  assert.equal(run([segment(['yield to'],0),segment(['something'],1)]).type,'target','native primary accumulation remains allowed');
});
test('active source / explicit answers remain TARGET, native filler rescue is TARGET-only',()=>{
  const entry={canonical:'yield to something',answers:['yield to pressure'],paraphrases:['give in to pressure']};
  const activeOccurrence={item:{en:'He yielded to pressure.'},occurrence:{start:3,end:22}};
  assert.equal(grade(entry.canonical,['wrong','yielded to pressure'],{entry,activeOccurrence}).type,'target');
  assert.equal(grade(entry.canonical,['wrong','um yield to pressure'],{entry}).type,'target');
  assert.equal(grade(entry.canonical,['wrong','uh give in to pressure'],{entry}).type,'miss');
  assert.equal(grade(entry.canonical,['wrong']).type,'miss');
  assert.equal(grade(entry.canonical,['yield to something']).recognitionAuthority,'primary');
});
