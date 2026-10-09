import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vocabularyChunkRescueChunks } from '../scripts/speech/vocabularyChunkRescueAuthority.js';
const production139=JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8')).entries.find(entry=>entry.id==='vocab:00139');
const result=(text,isFinal=true)=>Object.assign((Array.isArray(text)?text:[text]).map(transcript=>({transcript,confidence:0})),{isFinal});
async function fixture(run,{phrases=true,constructor=true}={}){
  const previousWindow=globalThis.window,previousPhrase=globalThis.SpeechRecognitionPhrase;
  const instances=[];
  class Native{
    constructor(){if(phrases)this.phrases=[];this.events=[];this.stopCalls=0;this.abortCalls=0;this.holdTerminal=false;this.ended=false;instances.push(this);}
    start(){this.atStart=this.phrases?.map(p=>p.phrase);this.events.push('start');this.onstart?.();}
    stop(){this.stopCalls++;this.events.push('stop-request');this.beforeEnd?.();if(!this.holdTerminal)this.emitEnd();}
    abort(){this.abortCalls++;this.events.push('abort');this.onerror?.({error:'aborted'});this.emitEnd();}
    inject(results,resultIndex=0){this.events.push('result');this.onresult?.({results,resultIndex});}
    error(error){this.events.push('error');this.onerror?.({error});this.emitEnd();}
    emitEnd(){const duplicate=this.ended;this.ended=true;this.events.push(duplicate?'duplicate-end':'end');this.onend?.();}
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
  assert.equal(controller.getPreviewTranscript(),'you too');
  const stopped=await controller.stop();assert.equal(stopped.transcript,'you too');assert.equal(stopped.primaryTranscript,'you too');
  assert.equal(stopped.completionState,'terminal');assert.equal(stopped.recognitionComplete,true);
}));
test('Web error after partial never retries or grades a partial attempt',()=>fixture(async({createRecognitionController},instances)=>{
  let errors=0,autostops=0;
  const controller=createRecognitionController({onError:()=>errors++,onAutoStop:()=>autostops++});
  controller.start();instances[0].inject([result('you',false)]);instances[0].error('network');
  assert.equal(instances.length,1);assert.equal(errors,1);assert.equal(autostops,0);assert.equal(controller.isActive(),false);
}));
test('PR240 raw final overlap, interim replacement/resultIndex, manual/auto stop and stale isolation',()=>fixture(async({createRecognitionController},instances)=>{
  let auto,autoStops=0;const previews=[];
  const controller=createRecognitionController({onTranscriptPreview:t=>previews.push(t),onAutoStop:r=>{auto=r;autoStops++;}});
  controller.start();let native=instances[0];
  native.inject([result('Turn the faucet'),result('the faucet off',false)]);
  assert.equal(controller.getStableTranscript(),'Turn the faucet');assert.equal(controller.getPreviewTranscript(),'Turn the faucet off');
  native.inject([result('Turn the faucet'),result('the faucet off now',false)],1);
  assert.equal(controller.getPreviewTranscript(),'Turn the faucet off now');
  native.inject([result('Turn the faucet'),result('the faucet off now')],1);
  assert.equal(controller.getStableTranscript(),'Turn the faucet off now');
  const stopped=await controller.stop();assert.equal(stopped.transcript,'Turn the faucet off now');assert.equal(stopped.recognitionComplete,true);assert.equal(auto,undefined);
  controller.start();native.inject([result('stale')]);native.emitEnd();assert.equal(controller.getPreviewTranscript(),'');assert.equal(auto,undefined);
  native=instances[1];native.inject([result("I'm ready."),result('to pay two dollars.',false)]);native.emitEnd();
  assert.equal(auto.transcript,"I'm ready. to pay two dollars.");assert.equal(controller.isActive(),false);assert.equal(autoStops,1);
  native.emitEnd();assert.equal(autoStops,1,'duplicate terminal callbacks cannot auto-stop an attempt twice');
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
  native.emitEnd();assert.equal(auto.transcript,'YouTube something');assert.equal(auto.recognitionSegments.length,2);assert.equal('matchInfo' in auto,false);
  controller.start();native.inject([result(['stale','yield to something'])]);native.emitEnd();
  assert.deepEqual(controller.getRecognitionSegments(),[]);await controller.stop();
}));

test('Web preserves duplicate provider candidates and ranks',()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController({getRecognitionContext:()=>({mode:'vocabulary'})});
  controller.start();instances[0].inject([result(['yeah','yeah','wrong','other','yell','yield'])]);
  const alternatives=controller.getRecognitionSegments()[0].alternatives;
  assert.deepEqual(alternatives.map(c=>c.asrRank),[0,1,2,3,4,5]);
  assert.equal(alternatives.at(-1).transcript,'yield');controller.cancel();
}));

test('Web provider evidence reaches shared curated Vocabulary chunk rescue without changing rank-one transcript',()=>fixture(async({createRecognitionController},instances)=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const chunks=vocabularyChunkRescueChunks(production139);
  if(!chunks){assert.equal(vocabularyChunkRescueChunks(production139),null);return;}
  const [firstChunk,secondChunk]=chunks;
  const primary=`${firstChunk} down ${secondChunk.split(/\s+/u).at(-1)}`;
  const fullCanonical=production139.canonical;
  const controller=createRecognitionController({getRecognitionContext:()=>({mode:'vocabulary'})});
  controller.start();
  instances[0].inject([result([primary,'unrelated',secondChunk])]);
  const evidence=await controller.stop();
  const grade=classifyVocabularySpeechAnswer({
    entry:production139,
    ...evidence,
  });
  assert.equal(grade.type,'target');
  assert.equal(grade.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(grade.asrRank,2);
  assert.equal(grade.primaryTranscript,primary);
  assert.equal(grade.displayTranscript,primary);
  assert.equal(evidence.transcript,primary);
  assert.equal(evidence.recognitionSegments[0].alternatives[2].transcript,secondChunk);
  assert.equal(grade.matchedExpected,fullCanonical);
}));

for(const rank of [1,6,8,12,20]) test(`Web provider rank ${rank} uses shared strict TARGET authority`,()=>fixture(async({createRecognitionController},instances)=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const controller=createRecognitionController();controller.start();
  instances[0].inject([result(Array.from({length:20},(_,i)=>i===rank-1?'yell':'yeah'))]);
  const evidence=await controller.stop();const grade=classifyVocabularySpeechAnswer({entry:{canonical:'yell'},...evidence});
  assert.equal(grade.type,'target');assert.equal(grade.targetRescued,rank!==1);
  assert.equal(evidence.recognitionSegments[0].alternatives.length,20);
  assert.equal(evidence.recognitionSegments[0].providerReturnedCount,20);
  if(rank!==1){assert.equal(grade.asrRank,rank-1);assert.equal(grade.recognitionAuthority,'nbest-exact');}
}));
for(const candidate of ['shout','yeah','yel','eared']) test(`Web deep non-TARGET ${candidate} stays MISS`,()=>fixture(async({createRecognitionController},instances)=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const controller=createRecognitionController();controller.start();
  instances[0].inject([result(['wrong',candidate])]);const evidence=await controller.stop();
  assert.equal(evidence.recognitionSegments[0].providerReturnedCount,2);
  assert.equal(classifyVocabularySpeechAnswer({entry:{canonical:'yell',paraphrases:['shout']},...evidence}).type,'miss');
}));

test('manual Web stop retains a final result delivered during stop before terminal completion',()=>fixture(async({createRecognitionController},instances)=>{
  const controller=createRecognitionController();controller.start();const native=instances[0];
  native.inject([result('draft',false)]);
  native.beforeEnd=()=>native.inject([result(['final primary','final alternative'])]);
  const stopped=await controller.stop();
  assert.equal(stopped.transcript,'final primary');
  assert.equal(stopped.recognitionSegments[0].isFinal,true);
  assert.equal(stopped.recognitionSegments[0].alternatives[1].transcript,'final alternative');
  assert.equal(stopped.stopReason,'manual-stop');
  assert.equal(stopped.completionState,'terminal');
  assert.deepEqual(native.events,['start','result','stop-request','result','end'],'stop-delivered final remains before terminal completion');
}));

test('manual stop Promise is shared and remains pending through a delayed final until one terminal event',()=>fixture(async({createRecognitionController},instances)=>{
  let autoStops=0,finalEvents=0;
  const controller=createRecognitionController({
    onTranscriptFinal:()=>{finalEvents++;},
    onAutoStop:()=>{autoStops++;},
  });
  controller.start();
  const native=instances[0];
  native.holdTerminal=true;
  const pending=controller.stop();
  const duplicateStop=controller.stop();
  assert.equal(duplicateStop,pending,'repeated stop returns the same in-flight Promise');
  assert.equal(native.stopCalls,1,'recognition receives one stop request');
  let settled=false;
  pending.then(()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);
  native.inject([result(['final primary','lower-ranked alternative'])]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'final result alone does not settle stop');
  assert.equal(autoStops,0,'final result alone does not trigger terminal scoring');
  assert.equal(finalEvents,1);
  native.emitEnd();
  const stopped=await pending;
  assert.equal(stopped.transcript,'final primary');
  assert.equal(stopped.recognitionComplete,true);
  assert.equal(stopped.completionState,'terminal');
  assert.equal(autoStops,0,'manual completion does not invoke auto-stop');
  native.emitEnd();
  assert.equal(finalEvents,1);
  assert.deepEqual(native.events,['start','stop-request','result','end','duplicate-end']);
}));

test('interim-only auto-stop preserves non-final evidence and waits for onend',()=>fixture(async({createRecognitionController},instances)=>{
  const completed=[];
  const controller=createRecognitionController({onAutoStop:evidence=>completed.push(evidence)});
  controller.start();
  const native=instances[0];
  native.inject([result('partial transcript',false)]);
  assert.equal(completed.length,0);
  assert.equal(controller.isActive(),true);
  native.emitEnd();
  assert.equal(completed.length,1);
  assert.equal(completed[0].completionState,'terminal');
  assert.equal(completed[0].recognitionSegments[0].isFinal,false);
  native.emitEnd();
  assert.equal(completed.length,1,'a repeated terminal callback does not complete the attempt again');
}));

test('normal end without final is terminal once and a later result from that attempt is stale',()=>fixture(async({createRecognitionController},instances)=>{
  const completed=[];
  const controller=createRecognitionController({onAutoStop:evidence=>completed.push(evidence)});
  controller.start();
  const native=instances[0];
  native.emitEnd();
  assert.equal(completed.length,1);
  assert.equal(completed[0].transcript,'');
  assert.deepEqual(completed[0].recognitionSegments,[]);
  native.inject([result('too late')]);
  native.emitEnd();
  assert.equal(completed.length,1,'a late final cannot reopen or complete the ended attempt');
  assert.deepEqual(controller.getRecognitionSegments(),[]);
  assert.equal(controller.isActive(),false);
}));

test('Web error and cancel remain technical outcomes without a normal grade',()=>fixture(async({createRecognitionController},instances)=>{
  let errors=0,autoStops=0;
  const controller=createRecognitionController({onError:()=>{errors++;},onAutoStop:()=>{autoStops++;}});
  controller.start();
  const native=instances[0];
  native.holdTerminal=true;
  const pending=controller.stop();
  native.error('network');
  const stopped=await pending;
  assert.equal(stopped.ok,false);
  assert.equal(stopped.reason,'network');
  assert.equal(stopped.completionState,'error');
  assert.equal(errors,1);
  assert.equal(autoStops,0);

  controller.start();
  const cancelled=instances[1];
  controller.cancel();
  assert.equal(cancelled.abortCalls,1);
  assert.equal(controller.getEvidence().completionState,'cancelled');
  cancelled.inject([result('stale final')]);
  cancelled.emitEnd();
  assert.equal(errors,1,'abort callbacks after cancel cannot be reported as a new recognition error');
  assert.equal(autoStops,0,'cancel cannot become a normal auto-stop');
  assert.equal(controller.isActive(),false);
}));
