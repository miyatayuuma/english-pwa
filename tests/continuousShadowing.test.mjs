import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  TRAINING_MODES,
  buildShadowingExposure,
  filterShadowingEligibleItems,
  isClearedForShadowing,
} from '../scripts/app/continuousShadowing.js';
import {
  buildSessionPlanFromOptions,
  diagnoseEmptySessionOptions,
  eligibleItemsForSessionOptions,
} from '../scripts/app/sessionOptionsCore.js';

const items=[
  {id:'fresh',en:'Fresh',ja:'',unit:'Section1'},
  {id:'failed',en:'Failed',ja:'',unit:'Section1'},
  {id:'cleared',en:'Cleared',ja:'',unit:'Section1'},
  {id:'cleared_then_failed',en:'Cleared before',ja:'',unit:'Section1'},
];
const levels={
  fresh:{best:0,last:0},
  failed:{best:1,last:1},
  cleared:{best:2,last:2},
  cleared_then_failed:{best:3,last:1},
};

test('continuous shadowing includes only sentences previously passed at 70 percent',()=>{
  assert.equal(isClearedForShadowing(levels.failed),false);
  assert.equal(isClearedForShadowing(levels.cleared),true);
  assert.equal(isClearedForShadowing(levels.cleared_then_failed),true);
  assert.deepEqual(filterShadowingEligibleItems(items,levels).map(item=>item.id),['cleared','cleared_then_failed']);
  const options={trainingMode:TRAINING_MODES.CONTINUOUS_SHADOWING};
  assert.deepEqual(eligibleItemsForSessionOptions(items,options,levels).map(item=>item.id),['cleared','cleared_then_failed']);
  const plan=buildSessionPlanFromOptions(items,levels,{...options,count:'5'},{now:1000});
  assert.equal(plan.trainingMode,TRAINING_MODES.CONTINUOUS_SHADOWING);
  assert.deepEqual(new Set(plan.items.map(item=>item.id)),new Set(['cleared','cleared_then_failed']));
  const repeated=buildSessionPlanFromOptions(items,levels,{...options,count:'5'},{now:1000,recentItemIds:['cleared','cleared_then_failed']});
  assert.equal(repeated.items.length,2,'a small cleared pool must not fall through to a stale legacy queue');
});

test('empty shadowing selection offers return to standard without broadening filters',()=>{
  const causes=diagnoseEmptySessionOptions(items,{trainingMode:TRAINING_MODES.CONTINUOUS_SHADOWING},{});
  assert.deepEqual(causes,[{key:'trainingMode',label:'連続シャドウイング',available:0,value:TRAINING_MODES.STANDARD}]);
});

test('shadowing exposure is a separate duration/count record',()=>{
  assert.deepEqual(buildShadowingExposure({itemId:'cleared',startedAt:1000,finishedAt:2450}),{
    itemId:'cleared',durationMs:1450,completed:true,
  });
  assert.equal(buildShadowingExposure({itemId:'',startedAt:1000,finishedAt:2450}).completed,false);
});

test('runtime keeps shadowing capture outside scoring, SRS, achievements, and intimacy paths',async()=>{
  const [main,shell,gas]=await Promise.all([
    readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8'),
    readFile(new URL('../scripts/app/sessionShell.js',import.meta.url),'utf8'),
    readFile(new URL('../GAS/WebApp.gs',import.meta.url),'utf8'),
  ]);
  assert.match(shell,/data-training-mode="\$\{TRAINING_MODES\.CONTINUOUS_SHADOWING\}"/);
  assert.match(main,/shouldEvaluate:\(\)=>!isShadowingSession\(\)/);
  assert.match(main,/if\(isShadowingSession\(\)\) recognitionController\.stop\(\);\s*else await stopRec\(\)/);
  assert.match(main,/recordShadowingExposure\(\{cards:1,durationMs:exposure\.durationMs\}\)/);
  assert.match(main,/sendLog\('shadowing'/);
  assert.match(gas,/shadowing:appendShadowing_/);
  assert.match(gas,/shadowing_practice/);
});
