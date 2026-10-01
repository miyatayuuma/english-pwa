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
test('context injected before start, max1 and no cross-product/target rewriting',()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController({getRecognitionBiasContext:()=>({phrases:[{text:'yield to',boost:4}]}),getReferenceText:()=> 'yield to'});
  controller.start();const native=instances[0];assert.deepEqual(native.atStart,['yield to']);assert.equal(native.maxAlternatives,1);assert.equal(native.processLocally,undefined);
  native.inject([result(['you too','yield to'])]);
  assert.equal(controller.getPreviewTranscript(),'you too');assert.equal(controller.stop().transcript,'you too');
  assert.equal(controller.getTranscriptHypotheses,undefined);
}));
for(const capabilities of [{phrases:false},{constructor:false}]) test(`unsupported contextual capability ${JSON.stringify(capabilities)} stays rank1`,()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController({getRecognitionBiasContext:()=>({phrases:[{text:'yield to',boost:4}]})});assert.equal(controller.start().ok,true);
  instances[0].inject([result('you too')]);assert.equal(controller.stop().transcript,'you too');
},capabilities));
test('phrases-not-supported disables session bias and retries only once, errors never auto-grade',()=>fixture(async({createRecognitionController},instances)=>{
  let errors=0,stops=0;const capability={unavailable:false};
  const options={biasCapability:capability,getRecognitionBiasContext:()=>({phrases:[{text:'yield to',boost:4}]}),onError:()=>errors++,onAutoStop:()=>stops++};
  const controller=createRecognitionController(options);controller.start();instances[0].error('phrases-not-supported');
  assert.equal(instances.length,2);assert.deepEqual(instances[1].atStart,[]);assert.equal(errors,0);assert.equal(stops,0);
  instances[1].error('phrases-not-supported');assert.equal(instances.length,2);assert.equal(errors,1);assert.equal(stops,0);
  controller.start();assert.deepEqual(instances[2].atStart,[]);controller.stop();
  const next=createRecognitionController(options);next.start();assert.deepEqual(instances[3].atStart,[]);next.stop();
}));
test('capability failure after transcript does not retry or grade a partial attempt',()=>fixture(async({createRecognitionController},instances)=>{
  let errors=0,autostops=0;
  const controller=createRecognitionController({shouldEvaluate:()=>false,getRecognitionBiasContext:()=>({phrases:[{text:'yield to',boost:4}]}),onError:()=>errors++,onAutoStop:()=>autostops++});
  controller.start();instances[0].inject([result('you',false)]);instances[0].error('phrases-not-supported');
  assert.equal(instances.length,1);assert.equal(errors,1);assert.equal(autostops,0);assert.equal(controller.isActive(),false);
}));
test('PR240 raw final overlap, interim replacement/resultIndex, manual/auto stop and stale isolation',()=>fixture(async({createRecognitionController},instances)=>{
  let auto;const previews=[];
  const controller=createRecognitionController({getReferenceText:()=> 'Turn the faucet off now',onTranscriptPreview:t=>previews.push(t),onAutoStop:r=>auto=r});
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

test('learning context requests native five without confidence filtering, copies interims and clears stale evidence',()=>fixture(async({createRecognitionController},instances)=>{
  let auto;
  const controller=createRecognitionController({getRecognitionBiasContext:()=>({maxAlternatives:5,phrases:[{text:'yield to something',boost:8}]}),shouldEvaluate:()=>false,onAutoStop:r=>auto=r});
  controller.start();const native=instances[0];assert.equal(native.maxAlternatives,5);
  native.inject([result(['YouTube','yield to'],true),result(['anything','something'],false)]);
  let evidence=controller.getNativeRecognitionSegments();assert.equal(evidence.length,2);assert.equal(evidence[1].isFinal,false);
  assert.deepEqual(evidence[0].alternatives.map(c=>c.asrRank),[0,1]);
  evidence[0].alternatives[1].transcript='mutated';evidence.length=0;
  assert.equal(controller.getNativeRecognitionSegments()[0].alternatives[1].transcript,'yield to');
  native.inject([result(['YouTube','yield to'],true),result(['something'],false)],1);
  assert.equal(controller.getPreviewTranscript(),'YouTube something');
  assert.equal(controller.getNativeRecognitionSegments()[1].alternatives.length,1,'actual one candidate is normal');
  native.onend?.();assert.equal(auto.transcript,'YouTube something');assert.equal(auto.nativeSegments.length,2);assert.equal(auto.matchInfo,null);
  controller.start();native.inject([result(['stale','yield to something'])]);native.onend?.();
  assert.deepEqual(controller.getNativeRecognitionSegments(),[]);controller.stop();
}));
