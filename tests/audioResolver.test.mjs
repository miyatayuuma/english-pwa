import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSharedAudioResolver, createAudioUrlResolver, resolveSharedAudioUrl } from '../scripts/audio/resolver.js';

test('audio resolution keeps directory, OPFS, then configured base precedence and caches results',async()=>{
  const calls=[];
  const resolver=createAudioUrlResolver({
    resolveFromDirectory:async name=>{calls.push(`directory:${name}`);return '';},
    resolveFromOPFS:async name=>{calls.push(`opfs:${name}`);return 'blob:stored-audio';},
    getBaseUrl:()=> 'https://audio.example.test',
    fetchImpl:async()=>{calls.push('base-probe');return {ok:true,status:200};},
  });
  assert.equal(await resolver.resolveAudioUrl('sample.mp3'),'blob:stored-audio');
  assert.equal(await resolver.resolveAudioUrl('sample.mp3'),'blob:stored-audio');
  assert.deepEqual(calls,['directory:sample.mp3','opfs:sample.mp3']);
});

test('shared source audio uses base resolution only after local stores miss',async()=>{
  const calls=[];
  const resolver=createAudioUrlResolver({
    resolveFromDirectory:async()=>{calls.push('directory');return '';},
    resolveFromOPFS:async()=>{calls.push('opfs');return '';},
    getBaseUrl:()=> 'https://audio.example.test',
    fetchImpl:async(url,options)=>{calls.push(`${options.method}:${url}`);return {ok:true,status:200};},
  });
  configureSharedAudioResolver(resolver);
  assert.equal(await resolveSharedAudioUrl('clip one.mp3'),'https://audio.example.test/clip%20one.mp3');
  assert.deepEqual(calls,['directory','opfs','HEAD:https://audio.example.test/clip%20one.mp3']);
  configureSharedAudioResolver(null);
  assert.equal(await resolveSharedAudioUrl('clip one.mp3'),'');
});
