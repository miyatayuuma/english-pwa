import test from 'node:test';
import assert from 'node:assert/strict';

test('silent recognition produces no evaluable match or start achievement',async()=>{
  const events=[];
  let recognition=null;
  class FakeSpeechRecognition{
    constructor(){recognition=this;}
    start(){events.push('recognition-start-requested');}
    stop(){}
  }
  const previousWindow=globalThis.window;
  globalThis.window={SpeechRecognition:FakeSpeechRecognition};
  try{
    const {createRecognitionController,hasRecognizedSpeech}=await import(`../scripts/speech/recognition.js?mic-audio=${Date.now()}`);
    assert.equal(hasRecognizedSpeech(''),false);
    assert.equal(hasRecognizedSpeech('  ...  '),false);
    assert.equal(hasRecognizedSpeech('hello'),true);
    const controller=createRecognitionController({
      getReferenceText:()=>'Hello world',
      playTone:(kind)=>events.push(`tone-${kind}`),
    });
    assert.deepEqual(controller.start(),{ok:true});
    assert.deepEqual(events,['recognition-start-requested']);
    recognition.onstart();
    assert.deepEqual(events,['recognition-start-requested','tone-start']);
    const outcome=controller.stop();
    assert.equal(outcome.transcript,'');
    assert.equal(outcome.matchInfo,null);
  }finally{
    if(previousWindow===undefined) delete globalThis.window;
    else globalThis.window=previousWindow;
  }
});

test('app uses stop wait record flow without automatic audio resume',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8');
  assert.match(source,/MIC_AUDIO_SETTLE_MS=350/);
  assert.match(source,/再生を停止してから録音を開始します/);
  assert.match(source,/if\(!hasRecognizedSpeech\(hyp\)\)/);
  assert.doesNotMatch(source,/resumeAudio:\s*\(\)=>/);
});
