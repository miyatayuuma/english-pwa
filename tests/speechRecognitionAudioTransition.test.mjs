import test from 'node:test';
import assert from 'node:assert/strict';

test('playing audio pauses before recognition and resumes only after recognition starts',async()=>{
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
    const {createRecognitionController}=await import(`../scripts/speech/recognition.js?mic-audio=${Date.now()}`);
    const controller=createRecognitionController({
      shouldResumeAudio:()=>true,
      pauseAudioBeforeMicStart:()=>events.push('audio-paused'),
      resumeAudio:()=>events.push('audio-resumed'),
      micAudioResumeDelayMs:0,
    });
    assert.deepEqual(controller.start(),{ok:true});
    assert.deepEqual(events,['audio-paused','recognition-start-requested']);
    recognition.onstart();
    await new Promise(resolve=>setTimeout(resolve,5));
    assert.deepEqual(events,['audio-paused','recognition-start-requested','audio-resumed']);
    controller.stop();
  }finally{
    if(previousWindow===undefined) delete globalThis.window;
    else globalThis.window=previousWindow;
  }
});
