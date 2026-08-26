import test from 'node:test';
import assert from 'node:assert/strict';

test('visual cleanup module imports without browser side effects',async()=>{
  await assert.doesNotReject(()=>import('../scripts/app/visualCleanup.js'));
});
