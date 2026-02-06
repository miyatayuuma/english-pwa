import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toggleLevelSelection } from '../scripts/app/filterController.js';

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
