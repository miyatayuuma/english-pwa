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
