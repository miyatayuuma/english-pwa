import test from 'node:test';
import assert from 'node:assert/strict';
const result=(text,isFinal=true)=>Object.assign((Array.isArray(text)?text:[text]).map(transcript=>({transcript,confidence:0})),{isFinal});
async function fixture(run,{phrases=true,constructor=true}={}){
  const previousWindow=globalThis.window,previousPhrase=globalThis.SpeechRecognitionPhrase;
  const instances=[];
  class Native{
    constructor(){if(phrases)this.phrases=[];instances.push(this);}
    start(){this.atStart=this.phrases?.map(p=>p.phrase);this.onstart?.();}
    stop(){this.onend?.();}abort(){this.onend?.();}
    inject(results,resultIndex=0){this.onresult?.({results,resultIndex});}
    error(error){this.onerror?.({error});this.onend?.();}
  }
  globalThis.window={SpeechRecognition:Native};
  globalThis.SpeechRecognitionPhrase=constructor?class {constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}}:undefined;
  try{const module=await import(`../scripts/speech/recognition.js?context-${Math.random()}`);await run(module,instances);}
  finally{globalThis.window=previousWindow;globalThis.SpeechRecognitionPhrase=previousPhrase;}
}
test('Web fallback ignores phrase bias, keeps raw primary and requests N-best',()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController({getRecognitionContext:()=>({mode:'vocabulary'})});
  controller.start();const native=instances[0];assert.deepEqual(native.atStart,[]);assert.equal(native.maxAlternatives,20);assert.equal(native.processLocally,undefined);
  native.inject([result(['you too','yield to'])]);
  assert.equal(controller.getPreviewTranscript(),'you too');assert.equal(controller.stop().transcript,'you too');
}));
test('Web error after partial never retries or grades a partial attempt',()=>fixture(async({createRecognitionController},instances)=>{
  let errors=0,autostops=0;
  const controller=createRecognitionController({onError:()=>errors++,onAutoStop:()=>autostops++});
  controller.start();instances[0].inject([result('you',false)]);instances[0].error('network');
  assert.equal(instances.length,1);assert.equal(errors,1);assert.equal(autostops,0);assert.equal(controller.isActive(),false);
}));
test('PR240 raw final overlap, interim replacement/resultIndex, manual/auto stop and stale isolation',()=>fixture(async({createRecognitionController},instances)=>{
  let auto;const previews=[];
  const controller=createRecognitionController({onTranscriptPreview:t=>previews.push(t),onAutoStop:r=>auto=r});
  controller.start();let native=instances[0];
  native.inject([result('Turn the faucet'),result('the faucet off',false)]);
  assert.equal(controller.getStableTranscript(),'Turn the faucet');assert.equal(controller.getPreviewTranscript(),'Turn the faucet off');
  native.inject([result('Turn the faucet'),result('the faucet off now',false)],1);
  assert.equal(controller.getPreviewTranscript(),'Turn the faucet off now');
  native.inject([result('Turn the faucet'),result('the faucet off now')],1);
  assert.equal(controller.getStableTranscript(),'Turn the faucet off now');
  assert.equal(controller.stop().transcript,'Turn the faucet off now');assert.equal(auto,undefined);
  controller.start();native.inject([result('stale')]);native.onend?.();assert.equal(controller.getPreviewTranscript(),'');assert.equal(auto,undefined);
  native=instances[1];native.inject([result("I'm ready."),result('to pay two dollars.',false)]);native.onend?.();
  assert.equal(auto.transcript,"I'm ready. to pay two dollars.");assert.equal(controller.isActive(),false);
  assert.deepEqual(previews.slice(0,3),['Turn the faucet off','Turn the faucet off now','Turn the faucet off now']);
}));

test('learning context requests twenty without confidence filtering, copies interims and clears stale evidence',()=>fixture(async({createRecognitionController},instances)=>{
  let auto;
  const controller=createRecognitionController({getRecognitionContext:()=>({mode:'vocabulary'}),onAutoStop:r=>auto=r});
  controller.start();const native=instances[0];assert.equal(native.maxAlternatives,20);
  native.inject([result(['YouTube','yield to'],true),result(['anything','something'],false)]);
  let evidence=controller.getRecognitionSegments();assert.equal(evidence.length,2);assert.equal(evidence[1].isFinal,false);
  assert.deepEqual(evidence[0].alternatives.map(c=>c.asrRank),[0,1]);
  evidence[0].alternatives[1].transcript='mutated';evidence.length=0;
  assert.equal(controller.getRecognitionSegments()[0].alternatives[1].transcript,'yield to');
  native.inject([result(['YouTube','yield to'],true),result(['something'],false)],1);
  assert.equal(controller.getPreviewTranscript(),'YouTube something');
  assert.equal(controller.getRecognitionSegments()[1].alternatives.length,1,'actual one candidate is normal');
  native.onend?.();assert.equal(auto.transcript,'YouTube something');assert.equal(auto.recognitionSegments.length,2);assert.equal('matchInfo' in auto,false);
  controller.start();native.inject([result(['stale','yield to something'])]);native.onend?.();
  assert.deepEqual(controller.getRecognitionSegments(),[]);controller.stop();
}));

test('Web preserves duplicate provider candidates and ranks',()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController({getRecognitionContext:()=>({mode:'vocabulary'})});
  controller.start();instances[0].inject([result(['yeah','yeah','wrong','other','yell','yield'])]);
  const alternatives=controller.getRecognitionSegments()[0].alternatives;
  assert.deepEqual(alternatives.map(c=>c.asrRank),[0,1,2,3,4,5]);
  assert.equal(alternatives.at(-1).transcript,'yield');controller.cancel();
}));

for(const rank of [1,6,8,12,20]) test(`Web provider rank ${rank} uses shared strict TARGET authority`,()=>fixture(async({createRecognitionController},instances)=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const controller=createRecognitionController();controller.start();
  instances[0].inject([result(Array.from({length:20},(_,i)=>i===rank-1?'yell':'yeah'))]);
  const evidence=controller.stop();const grade=classifyVocabularySpeechAnswer({entry:{canonical:'yell'},...evidence});
  assert.equal(grade.type,'target');assert.equal(grade.targetRescued,rank!==1);
  assert.equal(evidence.recognitionSegments[0].alternatives.length,20);
  assert.equal(evidence.recognitionSegments[0].providerReturnedCount,20);
  if(rank!==1){assert.equal(grade.asrRank,rank-1);assert.equal(grade.recognitionAuthority,'nbest-exact');}
}));
for(const candidate of ['shout','yeah','yel','eared']) test(`Web deep non-TARGET ${candidate} stays MISS`,()=>fixture(async({createRecognitionController},instances)=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const controller=createRecognitionController();controller.start();
  instances[0].inject([result(['wrong',candidate])]);const evidence=controller.stop();
  assert.equal(evidence.recognitionSegments[0].providerReturnedCount,2);
  assert.equal(classifyVocabularySpeechAnswer({entry:{canonical:'yell',paraphrases:['shout']},...evidence}).type,'miss');
}));
