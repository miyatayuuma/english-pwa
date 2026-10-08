import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createNativeSynthesis,nativeDirectory,NativeUtterance} from '../scripts/native/media.js';
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

test('native folder selection persists its URI permission and survives a plugin recreation without repicking',async()=>{
 const state={uri:'',granted:false,picks:0,releases:0,reads:0};
 const plugin=()=>({
  pick:async()=>{state.picks++;state.uri='content://provider/tree/audio';state.granted=true;return{selected:true,granted:true};},
  status:async()=>({selected:!!state.uri,granted:state.granted}),
  clear:async()=>{if(state.uri)state.releases++;state.uri='';state.granted=false;return{};},
  read:async({name})=>{state.reads++;assert.equal(name,'clip.m4a');return{base64:btoa('audio'),mime:'audio/mpeg'};},
 });
 const selected=await nativeDirectory('pick',async()=>plugin());
 assert.equal(state.picks,1);
 assert.equal(await selected.queryPermission(),'granted');
 const file=await selected.getFileHandle('clip.m4a').then(handle=>handle.getFile());
 assert.equal(await file.text(),'audio');
 const restored=await nativeDirectory('status',async()=>plugin());
 assert.equal(await restored.queryPermission(),'granted');
 assert.equal(state.picks,1,'restoring status does not reopen ACTION_OPEN_DOCUMENT_TREE');
 assert.equal(state.reads,1);
});

test('revoked native URI permission stays selected and does not turn status or permission checks into a picker',async()=>{
 const state={uri:'content://provider/tree/audio',granted:false,picks:0,clears:0};
 const plugin={
  pick:async()=>{state.picks++;return{selected:true,granted:true};},
  status:async()=>({selected:!!state.uri,granted:state.granted}),
  clear:async()=>{state.clears++;state.uri='';return{};},
  read:async()=>{throw Error('revoked');},
 };
 const directory=await nativeDirectory('status',async()=>plugin);
 assert.ok(directory,'revoked permission does not discard the selected tree URI');
 assert.equal(await directory.queryPermission(),'denied');
 assert.equal(directory.requestPermission,undefined,'native permission recovery is explicit reselection only');
 assert.equal(state.picks,0);
 assert.equal(await nativeDirectory('clear',async()=>plugin),null);
 assert.equal(state.clears,1);
 assert.equal((await plugin.status()).selected,false);
});

test('Android plugin source keeps tree grants persistable, reports persisted status, confines reads, and releases only on clear',async()=>{
 const source=await fs.readFile(new URL('../android/app/src/main/java/com/miyatayuuma/englishpwa/NativeMediaPlugin.java',import.meta.url),'utf8');
 assert.match(source,/ACTION_OPEN_DOCUMENT_TREE/);
 assert.match(source,/FLAG_GRANT_READ_URI_PERMISSION\s*\|\s*Intent\.FLAG_GRANT_PERSISTABLE_URI_PERMISSION/);
 assert.match(source,/takePersistableUriPermission\(uri,Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/);
 assert.match(source,/prefs\(\)\.edit\(\)\.putString\("tree",uri\.toString\(\)\)\.apply\(\)/);
 assert.match(source,/getPersistedUriPermissions\(\)/);
 assert.match(source,/permission\.getUri\(\)\.toString\(\)\.equals\(tree\).*permission\.isReadPermission\(\)/s);
 const status=source.match(/@PluginMethod public void status\(PluginCall call\) \{([\s\S]*?)\n    \}/)?.[1]||'';
 assert.doesNotMatch(status,/pick\(/,'status never starts the picker');
 const clear=source.match(/@PluginMethod public void clear\(PluginCall call\) \{([\s\S]*?)\n    \}/)?.[1]||'';
 assert.match(clear,/release\(prefs\(\)\.getString\("tree",""\)\)/);
 assert.match(clear,/prefs\(\)\.edit\(\)\.remove\("tree"\)\.apply\(\)/);
 const read=source.match(/@PluginMethod public void read\(PluginCall call\) \{([\s\S]*?)\n    \}/)?.[1]||'';
 assert.match(read,/DocumentsContract\.buildChildDocumentsUriUsingTree\(tree,DocumentsContract\.getTreeDocumentId\(tree\)\)/);
 assert.match(read,/openInputStream\(file\)/);
});
