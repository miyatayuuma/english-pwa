import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoplaySentence } from '../scripts/app/sentencePracticeUx.js';

const moduleUrl=new URL('../scripts/app/sentencePracticeUx.js',import.meta.url);

test('sentence practice UX module imports safely outside browser',async()=>{
  const mod=await import(moduleUrl.href);
  assert.equal(typeof mod,'object');
});

test('sentence autoplay is limited to read mode',()=>{
  assert.equal(shouldAutoplaySentence('read'),true);
  assert.equal(shouldAutoplaySentence('compose'),false);
  assert.equal(shouldAutoplaySentence('vocabulary'),false);
});
