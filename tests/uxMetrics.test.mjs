import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeUxEvents } from '../scripts/app/uxMetrics.js';

test('summarizeUxEvents reports friction and completion metrics',()=>{
  const summary=summarizeUxEvents([
    {type:'session_start',timeToStartMs:1000,tapsToStart:1},
    {type:'session_complete',cards:7,hints:2},
    {type:'session_start',timeToStartMs:3000,tapsToStart:2},
    {type:'session_complete',cards:6,hints:4},
  ]);
  assert.equal(summary.sessions,2);
  assert.equal(summary.completed,2);
  assert.equal(summary.completionRate,1);
  assert.equal(summary.medianTimeToStartMs,2000);
  assert.equal(summary.medianTapsToStart,1.5);
  assert.equal(summary.medianCardsPerSession,6.5);
  assert.equal(summary.medianHintsPerSession,3);
});
