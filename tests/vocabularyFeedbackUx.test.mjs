import test from 'node:test';
import assert from 'node:assert/strict';

test('vocabulary feedback UX module imports without browser side effects',async()=>{
  const mod=await import('../scripts/app/vocabularyFeedbackUx.js');
  assert.ok(mod);
});
