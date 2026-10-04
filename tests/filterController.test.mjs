import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rebuildAfterFilterChange,
  toggleLevelSelection,
} from '../scripts/app/filterController.js';

const ALL=[0,1,2,3,4,5];

test('toggleLevelSelection removes a selected level when multiple are active', () => {
  const next=toggleLevelSelection(new Set([1,2,3]), 2, ALL);
  assert.deepEqual([...next].sort((a,b)=>a-b), [1,3]);
});

test('toggleLevelSelection resets to all levels when last level is removed', () => {
  const next=toggleLevelSelection(new Set([2]), 2, ALL);
  assert.deepEqual([...next].sort((a,b)=>a-b), ALL);
});

test('toggleLevelSelection adds an unselected level', () => {
  const next=toggleLevelSelection(new Set([1,3]), 2, ALL);
  assert.deepEqual([...next].sort((a,b)=>a-b), [1,2,3]);
});

test('filter changes end the active session and never auto-start a legacy range', async()=>{
  const calls=[];
  await rebuildAfterFilterChange({
    finalizeActiveSession:async(options)=>{ calls.push(['finalize',options]); },
    rebuildAndRender:async(...args)=>{ calls.push(['rebuild',...args]); },
  });
  assert.deepEqual(calls,[
    ['finalize',{reason:'filter-change'}],
    ['rebuild',true,{autoStart:false}],
  ]);
});
