import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildRecognitionHypotheses,extractRecognitionAlternatives,matchTranscript,selectBestSpeechHypothesis,createRecognitionController} from '../scripts/speech/recognition.js';
import {classifyVocabularyHypotheses} from '../scripts/app/vocabularyLearningCore.js';
const result=(words,isFinal=true)=>Object.assign(words.map((transcript)=>({transcript,confidence:0})),{isFinal});

test('single-result ASR preserves raw ranks, caps at five, accepts confidence zero/unavailable and deduplicates',()=>{
  const input=result(['despise','despite','the spite','DESPITE','despite!','ignored']);
  assert.equal(extractRecognitionAlternatives(input).length,4);
  assert.deepEqual(buildRecognitionHypotheses([result(['despise','despite','the spite'])]).map(x=>x.transcript),['despise','despite','the spite']);
  assert.equal(extractRecognitionAlternatives([{transcript:'raw'}])[0].confidence,null);
  assert.equal(buildRecognitionHypotheses([result(['Only one.'])])[0].transcript,'Only one.');
});

test('full utterance cross-rank composition is deterministic, raw-preserving and bounded to 25',()=>{
  const input=[result(['I could',"I couldn't"]),result(['figure it out','figured it out'])];
  const hypotheses=buildRecognitionHypotheses(input);
  assert.equal(hypotheses[0].transcript,'I could figure it out');
  assert.deepEqual(hypotheses.find(x=>x.transcript==="I couldn't figure it out").segmentRanks,[1,0]);
  assert.equal(hypotheses.length,4);
  assert.deepEqual(buildRecognitionHypotheses(input),hypotheses);
  const many=Array.from({length:12},(_,i)=>result(Array.from({length:5},(_,j)=>`segment${i}word${j}`)));
  const start=performance.now();
  const bounded=buildRecognitionHypotheses(many);
  assert.equal(bounded.length,25);
  assert.deepEqual(bounded[0].segmentRanks,Array(12).fill(0));
  assert.ok(performance.now()-start<1000,'bounded construction must not enumerate 5^12 paths');
});

test('Vocabulary N-best retains strict target precedence, active-source authority, and target-only correction',()=>{
  const entry={canonical:'come across someone',answers:[],paraphrases:['run into someone']};
  const grade=(words,options={})=>classifyVocabularyHypotheses({entry,hypotheses:words.map(transcript=>({transcript})),...options});
  assert.equal(grade(['run into someone','come across someone']).type,'target');
  assert.equal(grade(['banana','run into someone']).type,'paraphrase');
  assert.equal(grade(['banana','unknown']).type,'miss');
  assert.equal(grade(['run into someone'],{correction:true}).type,'miss');
  assert.equal(grade(['come a cross someone','come across someone'],{correction:true}).type,'target');
  assert.equal(grade(['banana','came across Nick'],{activeOccurrence:{item:{en:'came across Nick'},occurrence:{start:0,end:16}}}).type,'target');
  assert.equal(classifyVocabularyHypotheses({entry:{canonical:'despite'},hypotheses:[{transcript:'despise'}]}).type,'miss');
  assert.equal(classifyVocabularyHypotheses({entry:{canonical:'despite'},hypotheses:[{transcript:'despise'},{transcript:'despite'}]}).type,'target');
});

test('normal speech selects highest existing score and retains ASR order on ties without DOM effects',()=>{
  const hypotheses=['banana',"I couldn't figure it out","I couldn't figure it out"].map(transcript=>({transcript}));
  const selected=selectBestSpeechHypothesis("I couldn't figure it out",hypotheses);
  assert.equal(selected.selectedHypothesisIndex,1);
  assert.equal(selected.score,1);
  assert.deepEqual(selected.matchInfo,matchTranscript("I couldn't figure it out",hypotheses[1].transcript));
  const controller=createRecognitionController();
  for(const [ref,hyp] of [['book the suite now','book the sweet now'],['The rain forest is lush','the rainforest is lush'],['say hello world','world say hello']]){
    assert.deepEqual(matchTranscript(ref,hyp),controller.matchAndHighlight(ref,hyp));
  }
});

test('controller requests five, exposes defensive hypotheses including interims, preserves primary and highlights selected once per evaluation',async()=>{
  let native;
  class FakeRecognition{constructor(){native=this;}start(){}stop(){this.onend?.();}}
  const previous=globalThis.window;
  globalThis.window={SpeechRecognition:FakeRecognition};
  const {createRecognitionController}=await import('../scripts/speech/recognition.js?nbest-controller');
  try{
    let changes=0,latest;
    const token={dataset:{w:'despite'},classList:{remove(){},toggle(){changes++;}}};
    const controller=createRecognitionController({enElement:{querySelectorAll:()=>[token]},getReferenceText:()=> 'despite',selectHypothesis:selectBestSpeechHypothesis,onTranscriptAlternatives:value=>{latest=value;}});
    controller.start();
    assert.equal(native.maxAlternatives,5);
    native.onresult({resultIndex:0,results:[result(['banana','despite'])]});
    assert.equal(changes,2,'selected highlight toggles hit/miss once, not per candidate');
    assert.equal(latest.primaryTranscript,'banana');
    assert.equal(controller.getLastMatch().selectedTranscript,'despite');
    latest.hypotheses[1].segmentRanks[0]=99;
    controller.getTranscriptHypotheses().splice(0);
    assert.deepEqual(controller.getTranscriptHypotheses()[1].segmentRanks,[1]);
    const stopped=controller.stop();
    assert.equal(stopped.transcript,'banana');
    assert.equal(stopped.matchInfo.rescuedByAlternative,true);
    controller.start();
    const old=native;
    native.onresult({resultIndex:0,results:[result(['came'],true),result(['a cross Nick','across Nick'],false)]});
    assert.ok(controller.getTranscriptHypotheses().some(x=>x.transcript==='came across Nick'));
    controller.stop();controller.start();
    old.onresult({resultIndex:0,results:[result(['stale'])]});
    old.onend?.();
    assert.deepEqual(controller.getTranscriptHypotheses(),[]);
    controller.stop();
  }finally{globalThis.window=previous;}
});

test('one, two, three and five actual alternatives all remain eligible without a confidence gate',()=>{
  for(const count of [1,2,3,5]){
    const values=Array.from({length:count},(_,i)=>({transcript:`candidate ${i}`,confidence:i%2?undefined:0}));
    assert.equal(buildRecognitionHypotheses([values]).length,count);
    assert.equal(buildRecognitionHypotheses([values])[0].transcript,'candidate 0');
  }
});

test('rank-one matcher agrees with independently frozen pre-migration corpus results',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {calcMatchScore}=await import('../scripts/speech/recognition.js');
  const baseline=JSON.parse(await readFile(new URL('./fixtures/asr-matcher-baseline.json',import.meta.url),'utf8'));
  assert.equal(baseline.sourceMain,'e0594c88c548d6aea28ff9b4aca6870d8982a603');
  assert.equal(baseline.cases.length,42);
  for(const {reference,hypothesis,expected} of baseline.cases){
    const value=matchTranscript(reference,hypothesis);
    assert.deepEqual({...value,matchedCounts:[...value.matchedCounts],score:calcMatchScore(value.refCount,value.recall,value.precision)},expected);
  }
});
