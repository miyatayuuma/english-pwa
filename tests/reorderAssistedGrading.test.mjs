import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelStateManager } from '../scripts/app/levelState.js';
import { evaluateReorder, reduceReorderResult } from '../scripts/app/reorderGrading.js';

const first = { completed: true, wrongAttempts: 0, revealed: false };
const retry = { completed: true, wrongAttempts: 1, revealed: false };
const failed = { completed: true, wrongAttempts: 3, revealed: true };
for (const [rows, grade, candidate] of [
  [[first, first], 'FIRST_TRY', 4], [[first, retry], 'RETRY_PASS', 3],
  [[{...retry, wrongAttempts:2}], 'RETRY_PASS', 3], [[first,failed,first], 'FAILED', 1],
]) test(`${grade}: deterministic worst sentence authority`, () => {
  assert.equal(reduceReorderResult(rows).grade, grade);
  assert.equal(evaluateReorder(grade).candidate, candidate);
  assert.equal(evaluateReorder(grade).perfectNoHint, false);
});
test('incomplete and unknown results cannot be graded', () => {
  assert.throws(()=>reduceReorderResult([]));
  assert.throws(()=>reduceReorderResult([{...first, completed:false}]));
  assert.throws(()=>evaluateReorder('unknown'));
});
test('repeated FIRST_TRY creates Lv4, without any ordinary Lv5 promotion evidence', () => {
  const manager = createLevelStateManager({baseHintStage:0,getFirstHintStage:()=>1,getEnglishRevealStage:()=>3});
  const result=reduceReorderResult([first]);
  for (let i=0;i<5;i++) {
    const update=manager.updateReorderLevelInfo('reorder',result,{now:1000+i*86400000});
    assert.equal(update.candidate,4); assert.equal(update.finalLevel,4);
    assert.equal(update.info.level5Count,undefined);
    assert.equal(update.info.noHintHistory,undefined);
  }
});
test('existing Lv5 and speech history survive both success grades; failure downgrades last only', () => {
  const manager=createLevelStateManager({baseHintStage:0,getFirstHintStage:()=>1,getEnglishRevealStage:()=>3});
  manager.updateLevelInfo('mastered',{candidate:5, rate:1, stage:0, pass:true, noHintSuccess:true, perfectNoHint:true},{now:1000});
  const info=manager.getLevelInfo('mastered');
  info.last=5; info.best=5;
  const history=[...info.noHintHistory]; const count=info.level5Count;
  for(const rows of [[first],[retry]]) {
    const updated=manager.updateReorderLevelInfo('mastered',reduceReorderResult(rows));
    assert.equal(updated.finalLevel,5); assert.equal(updated.best,5);
    assert.deepEqual(updated.info.noHintHistory,history); assert.equal(updated.info.level5Count,count);
  }
  const update=manager.updateReorderLevelInfo('mastered',reduceReorderResult([failed]));
  assert.equal(update.finalLevel,1); assert.equal(update.best,5);
  assert.deepEqual(update.info.noHintHistory,history); assert.equal(update.info.level5Count,count);
});
