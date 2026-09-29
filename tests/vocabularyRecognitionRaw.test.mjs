import test from 'node:test';
import assert from 'node:assert/strict';

class MockRecognition{
  static instance=null;
  constructor(){MockRecognition.instance=this;}
  start(){this.onstart?.();}
  stop(){this.onend?.();}
  emit(transcript){
    const result=Object.assign([{transcript}],{isFinal:true});
    this.onresult?.({resultIndex:0,results:[result]});
  }
}
globalThis.window={SpeechRecognition:MockRecognition};
const {createRecognitionController}=await import('../scripts/speech/recognition.js');

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
