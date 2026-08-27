import test from 'node:test';
import assert from 'node:assert/strict';

test('friendship UI modules load without a browser runtime',async()=>{
  await import('../scripts/app/relationshipMode.js');
  await import('../scripts/app/tagBrowser.js');
  assert.ok(true);
});
