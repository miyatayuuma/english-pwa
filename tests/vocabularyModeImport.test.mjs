import test from 'node:test';
import assert from 'node:assert/strict';

test('vocabulary UI module imports without browser side effects', async()=>{
  await assert.doesNotReject(()=>import('../scripts/app/vocabularyMode.js'));
});
