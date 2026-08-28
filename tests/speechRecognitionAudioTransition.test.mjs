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
    assert.deepEqual(events,['recognition-start-requested']);
    const outcome=controller.stop();
    assert.equal(outcome.transcript,'');
    assert.equal(outcome.matchInfo,null);
  }finally{
    if(previousWindow===undefined) delete globalThis.window;
    else globalThis.window=previousWindow;
  }
});

test('audio transition lock blocks pending and release but enables active shadowing playback',async()=>{
  const {AUDIO_LOCK_STATES,createAudioController}=await import('../scripts/audio/controller.js');
  const listeners=new Map();
  const audio={dataset:{srcKey:'voice.mp3'},paused:false,ended:false,pauseCount:0,pause(){this.paused=true;this.pauseCount+=1;},addEventListener(type,fn){listeners.set(type,fn);}};
  const classes=new Set();
  const attributes=new Map();
  const playButton={disabled:false,classList:{toggle(name,on){if(on) classes.add(name);else classes.delete(name);}},setAttribute(name,value){attributes.set(name,value);},removeAttribute(name){attributes.delete(name);},querySelector(){return null;}};
  const controller=createAudioController({audioElement:audio,playButton,getCanSpeak:()=>true});
  assert.equal(playButton.disabled,false);
  controller.setAudioLockState(AUDIO_LOCK_STATES.PENDING);
  assert.equal(playButton.disabled,true);
  assert.ok(audio.pauseCount>=1);
  controller.updatePlayButtonAvailability();
  assert.equal(playButton.disabled,true);
  audio.paused=false;
  listeners.get('play')();
  assert.equal(audio.paused,true);
  assert.equal(controller.playTone('start'),false);
  controller.setAudioLockState(AUDIO_LOCK_STATES.ACTIVE);
  controller.updatePlayButtonAvailability();
  assert.equal(playButton.disabled,false);
  audio.paused=false;
  listeners.get('play')();
  assert.equal(audio.paused,true);
  controller.authorizeUserPlayback();
  audio.paused=false;
  listeners.get('play')();
  assert.equal(audio.paused,false);
  assert.equal(controller.playTone('start'),false);
  controller.setAudioLockState(AUDIO_LOCK_STATES.RELEASE);
  assert.equal(playButton.disabled,true);
  controller.setAudioLockState(AUDIO_LOCK_STATES.UNLOCKED);
  assert.equal(playButton.disabled,false);
});

test('app uses stop confirm settle then manual from-start shadowing without automatic resume',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8');
  assert.match(source,/MIC_AUDIO_SETTLE_MS=350/);
  assert.match(source,/MIC_RELEASE_SETTLE_MS=800/);
  assert.match(source,/await waitForAppAudioStop\(\)/);
  assert.match(source,/function resetPlaybackSessionForMic\(\)[\s\S]*audio\.currentTime=0;[\s\S]*audio\.load\?\.\(\)/);
  assert.match(source,/setAudioLockState\(AUDIO_LOCK_STATES\.PENDING\);\s*resetPlaybackSessionForMic\(\)/);
  assert.match(source,/setAudioLockState\(AUDIO_LOCK_STATES\.PENDING\)/);
  assert.match(source,/setAudioLockState\(AUDIO_LOCK_STATES\.ACTIVE\)/);
  assert.match(source,/setAudioLockState\(AUDIO_LOCK_STATES\.RELEASE\)/);
  assert.match(source,/録音開始後、「聞く」で先頭から再生できます/);
  assert.match(source,/「聞く」で先頭から再生し、音声を追いかけて話してください/);
  assert.match(source,/getAudioLockState\(\)===AUDIO_LOCK_STATES\.ACTIVE&&!userInitiated/);
  assert.match(source,/if\(userInitiated&&!authorizeUserPlayback\(\)\) return false/);
  assert.match(source,/getAudioLockState\(\)===AUDIO_LOCK_STATES\.ACTIVE \|\| audio\.ended/);
  assert.match(source,/if\(!hasRecognizedSpeech\(hyp\)\)/);
  assert.doesNotMatch(source,/録音開始後に「聞く」/);
  assert.doesNotMatch(source,/resumeAfterMic/);
});
