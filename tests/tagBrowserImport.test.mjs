import test from 'node:test';
import assert from 'node:assert/strict';

test('tag browser module imports without browser side effects',async()=>{
  const module=await import('../scripts/app/tagBrowser.js');
  assert.equal(typeof module,'object');
});
