import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGoalValue } from '../scripts/app/goalController.js';

test('normalizeGoalValue clamps and rounds positive values', () => {
  assert.equal(normalizeGoalValue(4.6, 10), 5);
  assert.equal(normalizeGoalValue(0.1, 10), 1);
  assert.equal(normalizeGoalValue(1200, 10), 999);
});

test('normalizeGoalValue falls back for invalid inputs', () => {
  assert.equal(normalizeGoalValue(0, 10), 10);
  assert.equal(normalizeGoalValue(-10, 10), 10);
  assert.equal(normalizeGoalValue('abc', 10), 10);
});
