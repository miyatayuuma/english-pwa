import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { MIC_UI_STATES, applyMicStatus, micStatusCopy } from '../scripts/app/micStatus.js';
import { createResultFeedbackQueue } from '../scripts/app/resultFeedbackSound.js';

function fakeStatus(){
  const label={textContent:''};
  return {dataset:{},attrs:{},querySelector:()=>label,setAttribute(name,value){this.attrs[name]=value;},label};
}
function fakeButton(){
  const classes=new Set();
  return {dataset:{},attrs:{},classList:{toggle(name,on){if(on) classes.add(name);else classes.delete(name);}},setAttribute(name,value){this.attrs[name]=value;},classes};
}

test('microphone status uses persistent text and button semantics for every state',()=>{
  assert.equal(micStatusCopy(MIC_UI_STATES.ACTIVE).label,'録音中');
  const status=fakeStatus();
  const button=fakeButton();
  applyMicStatus({statusElement:status,micButton:button,state:MIC_UI_STATES.PENDING});
  assert.equal(status.label.textContent,'マイク準備中');
  assert.equal(button.attrs['aria-pressed'],'false');
  applyMicStatus({statusElement:status,micButton:button,state:MIC_UI_STATES.ACTIVE});
  assert.equal(status.dataset.state,'active');
  assert.equal(status.label.textContent,'録音中');
  assert.equal(button.attrs['aria-pressed'],'true');
  assert.equal(button.classes.has('recording'),true);
});

test('result sound waits for unlock, plays once, and respects mute',()=>{
  let unlocked=false;
  let mode='standard';
  const tones=[];
  const vibrations=[];
  const queue=createResultFeedbackQueue({
    getMode:()=>mode,
    isUnlocked:()=>unlocked,
    playTone:(type,options)=>{tones.push([type,options]);return true;},
    vibrate:value=>vibrations.push(value),
  });
  queue.enqueue('success',{itemId:'A',perfect:true});
  assert.equal(queue.flush({itemId:'A'}),false);
  unlocked=true;
  assert.equal(queue.flush({itemId:'A'}),true);
  assert.deepEqual(tones,[['perfect',{intensity:'standard'}]]);
  assert.equal(queue.flush({itemId:'A'}),false);
  assert.deepEqual(vibrations,[18]);
  mode='off';
  queue.enqueue('fail',{itemId:'A'});
  assert.equal(queue.flush({itemId:'A'}),false);
  assert.equal(tones.length,1);
});

test('app flushes result audio only after release settle and does not score silent input',async()=>{
  const main=await readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8');
  const unlock=main.indexOf('setAudioLockState(AUDIO_LOCK_STATES.UNLOCKED)');
  const flush=main.indexOf('resultFeedbackQueue.flush',unlock);
  assert.ok(unlock>=0&&flush>unlock);
  assert.match(main,/resultFeedbackQueue\.enqueue\('success'/);
  assert.match(main,/resultFeedbackQueue\.enqueue\('fail'/);
  assert.doesNotMatch(main,/playTone\('success'\)/);
  assert.doesNotMatch(main,/playTone\('fail'\)/);
  assert.ok(main.indexOf('if(!hasRecognizedSpeech(hyp))')<main.indexOf("resultFeedbackQueue.enqueue('success'"));
});
