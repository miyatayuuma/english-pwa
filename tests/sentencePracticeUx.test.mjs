import test from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl=new URL('../scripts/app/sentencePracticeUx.js',import.meta.url);

test('sentence practice UX module imports safely outside browser',async()=>{
  const mod=await import(moduleUrl.href);
  assert.equal(typeof mod,'object');
});
