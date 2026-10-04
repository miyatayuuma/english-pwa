import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSynthesis,NativeUtterance} from '../scripts/native/media.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(){
 const listeners={},calls=[];
 const plugin={voices:async()=>({ready:true,voices:[{voiceURI:'us',lang:'en-US'}]}),addListener:async(type,callback)=>{listeners[type]=callback;},speak:async args=>calls.push(args),cancel:async()=>calls.push('cancel')};
 return {listeners,calls,synth:createNativeSynthesis(async()=>plugin)};
}
test('native synthesis forwards voice/profile and completes only matching native utterance',async()=>{
 const {listeners,calls,synth}=fixture();await tick();
 assert.doesNotThrow(()=>listeners.tts({type:'end'}));
 const utter=new NativeUtterance('yield');utter.voice={voiceURI:'us'};utter.rate=.8;let starts=0,ends=0;
 utter.onstart=()=>starts++;utter.onend=()=>ends++;
 synth.speak(utter);await tick();assert.equal(calls[0].text,'yield');assert.equal(calls[0].rate,.8);assert.equal(calls[0].voice,'us');
 listeners.tts({id:'stale',type:'end'});assert.equal(ends,0);
 listeners.tts({id:calls[0].id,type:'start'});assert.equal(starts,1);
 listeners.tts({id:calls[0].id,type:'end'});assert.equal(ends,1);assert.equal(synth.speaking,false);
});
test('native synthesis cancellation suppresses pending/stale speech and errors settle',async()=>{
 const {listeners,calls,synth}=fixture();await tick();
 const stale=new NativeUtterance('old');let ended=0;stale.onend=()=>ended++;
 synth.speak(stale);synth.cancel();await tick();assert.deepEqual(calls,['cancel']);
 const next=new NativeUtterance('new');let errors=0;next.onerror=()=>errors++;
 synth.speak(next);await tick();listeners.tts({id:calls[1].id,type:'error'});
 assert.equal(errors,1);assert.equal(synth.speaking,false);assert.equal(ended,0);
});
