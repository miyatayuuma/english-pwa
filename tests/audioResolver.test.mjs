import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSharedAudioResolver, createAudioUrlResolver, resolveSharedAudioUrl } from '../scripts/audio/resolver.js';
test('directory wins, OPFS is fallback, and clearing resolves the new folder immediately',async()=>{
  let folder='blob:folder';let opfsCalls=0;
  const resolver=createAudioUrlResolver({resolveFromDirectory:async()=>folder,resolveFromOPFS:async()=>{opfsCalls++;return 'blob:opfs';}});
  assert.equal(await resolver.resolveAudioUrl('clip.mp3'),'blob:folder');assert.equal(opfsCalls,0);
  folder='';resolver.clear();assert.equal(await resolver.resolveAudioUrl('clip.mp3'),'blob:opfs');
});
test('unavailable local source never probes remote audio and resolves empty for TTS fallback',async()=>{
  let fetches=0;
  const resolver=createAudioUrlResolver({resolveFromDirectory:async()=>{throw Error('permission');},resolveFromOPFS:async()=>'',getBaseUrl:()=> 'https://old.example',fetchImpl:async()=>{fetches++;}});
  configureSharedAudioResolver(resolver);assert.equal(await resolveSharedAudioUrl('clip.mp3'),'');assert.equal(fetches,0);
  configureSharedAudioResolver(null);
});

test('clearing during an initial missing lookup returns the newly selected source to every caller',async()=>{
  let releaseMissing;
  let folder='';let directoryCalls=0;
  const resolver=createAudioUrlResolver({
    resolveFromDirectory:async()=>{directoryCalls++;return folder;},
    resolveFromOPFS:()=>new Promise(resolve=>{releaseMissing=()=>resolve('');}),
  });
  const initial=resolver.resolveAudioUrl('clip.mp3');
  await new Promise(resolve=>setImmediate(resolve));
  folder='blob:selected';resolver.clear();
  const selected=await resolver.resolveAudioUrl('clip.mp3');
  releaseMissing();
  assert.equal(await initial,selected);
  assert.equal(await resolver.resolveAudioUrl('clip.mp3'),'blob:selected');
  assert.equal(directoryCalls,2,'the stale empty result does not replace the current cache');
});

test('a pending old folder source joins the current lookup, including after another clear',async()=>{
  const lookups=[];
  const resolver=createAudioUrlResolver({resolveFromDirectory:()=>new Promise(resolve=>lookups.push(resolve))});
  const first=resolver.resolveAudioUrl('clip.mp3');
  const same=resolver.resolveAudioUrl('clip.mp3');
  await Promise.resolve();
  assert.equal(lookups.length,1,'same-generation consumers share the source');
  resolver.clear();
  const second=resolver.resolveAudioUrl('clip.mp3');
  await Promise.resolve();
  lookups[0]('blob:old');
  await Promise.resolve();
  resolver.clear();
  const current=resolver.resolveAudioUrl('clip.mp3');
  await Promise.resolve();
  lookups[1]('blob:intermediate');lookups[2]('blob:current');
  assert.deepEqual(await Promise.all([first,same,second,current]),Array(4).fill('blob:current'));
  assert.equal(await resolver.resolveAudioUrl('clip.mp3'),'blob:current');
});


test('synchronous invalidation inside a source callback cannot join its own stale promise',async()=>{
  let calls=0;
  const resolver=createAudioUrlResolver({resolveFromDirectory:()=>{
    if(++calls===1) resolver.clear();
    return 'blob:current';
  }});
  assert.equal(await resolver.resolveAudioUrl('clip.mp3'),'blob:current');
  assert.equal(calls,2);
});
