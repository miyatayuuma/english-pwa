import test from 'node:test';
import assert from 'node:assert/strict';

class MockRecognition{
  static instance=null;
  constructor(){MockRecognition.instance=this;}
  start(){this.onstart?.();}
  stop(){this.onend?.();}
  resultEvent(pieces,resultIndex=0){
    const results=pieces.map(([transcript,isFinal])=>Object.assign([{transcript}],{isFinal}));
    this.onresult?.({resultIndex,results});
  }
  emit(transcript){
    const result=Object.assign([{transcript}],{isFinal:true});
    this.onresult?.({resultIndex:0,results:[result]});
  }
}
globalThis.window={SpeechRecognition:MockRecognition};
const {createRecognitionController}=await import('../scripts/speech/recognition.js');
const {composeRawTranscriptPreview}=await import('../scripts/speech/recognition.js');

test('Vocabulary recognition preserves raw final transcript instead of shared fuzzy/token canonicalization',()=>{
  const finals=[];
  const evaluated=[];
  const controller=createRecognitionController({
    getReferenceText:()=> 'despite one hundred dollars',
    shouldEvaluate:()=>false,
    preserveRawTranscript:true,
    onTranscriptFinal:text=>finals.push(text),
    onMatchEvaluated:value=>evaluated.push(value),
  });
  assert.deepEqual(controller.start(),{ok:true});
  MockRecognition.instance.emit('despise one');
  MockRecognition.instance.emit('hundred dollars');
  assert.deepEqual(finals,['despise one','despise one hundred dollars']);
  assert.deepEqual(evaluated,[]);
});

test('raw preview composes stable and interim text without duplicated overlap or rewriting',()=>{
  assert.equal(composeRawTranscriptPreview('came','across Nick'),'came across Nick');
  assert.equal(composeRawTranscriptPreview('came across','across Nick'),'came across Nick');
  assert.equal(composeRawTranscriptPreview('I’m—ready','to pay two dollars.'),'I’m—ready to pay two dollars.');
});

test('preview callback reports cumulative stable plus changing interim text and finalizes without duplication',()=>{
  const previews=[];
  const controller=createRecognitionController({
    shouldEvaluate:()=>false,
    preserveRawTranscript:true,
    onTranscriptPreview:text=>previews.push(text),
  });
  controller.start();
  const recognition=MockRecognition.instance;
  recognition.resultEvent([['came',true]],0);
  recognition.resultEvent([['came',true],['across',false]],1);
  recognition.resultEvent([['came',true],['across Nick',false]],1);
  recognition.resultEvent([['came',true],['across Nick',true]],1);
  assert.deepEqual(previews,['came','came across','came across Nick','came across Nick']);
  const stopped=controller.stop();
  assert.equal(stopped.transcript,'came across Nick');
  assert.equal(stopped.previewTranscript,'came across Nick');
});

test('preview includes multiple interim results from one recognition event in order',()=>{
  const previews=[];
  const controller=createRecognitionController({
    shouldEvaluate:()=>false,
    preserveRawTranscript:true,
    onTranscriptPreview:text=>previews.push(text),
  });
  controller.start();
  MockRecognition.instance.resultEvent([['came',true],['across',false],['Nick',false]],0);
  assert.equal(previews.at(-1),'came across Nick');
});
