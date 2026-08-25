import { test } from 'node:test';
import assert from 'node:assert/strict';

test('adaptive UI module imports without side effects outside the browser',async()=>{
  const mod=await import('../scripts/app/tagMode.js');
  assert.ok(mod);
});
