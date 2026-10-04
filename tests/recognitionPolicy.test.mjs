import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecognitionContext, REQUESTED_MAX_ALTERNATIVES } from '../scripts/speech/recognitionPolicy.js';
import { setActiveClozeRecognitionContext, getActiveClozeRecognitionContext, clearActiveClozeRecognitionContext } from '../scripts/app/clozeRecognitionContext.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';
test('shared speech policy requests twenty without answer/bias authority',()=>{
  assert.equal(REQUESTED_MAX_ALTERNATIVES,20);
  for(const mode of ['read','repeat','hidden','shadowing','correction','vocabulary'])
    assert.deepEqual(buildRecognitionContext({mode,vocabularyEntry:{canonical:'yell'}}),{mode,speechDisabled:false});
  for(const mode of ['compose','generate','reorder']) assert.equal(buildRecognitionContext({mode}).speechDisabled,true);
});
test('Cloze registry copies data, restricts item identity, clears without DOM storage',()=>{
  const input={itemId:'a',sentence:'hidden answer',targets:[{surface:'answer',tokenStart:1,tokenEnd:1}]};
  setActiveClozeRecognitionContext(input);input.targets[0].surface='changed';
  const copy=getActiveClozeRecognitionContext('a');assert.equal(copy.targets[0].surface,'answer');copy.targets.length=0;
  assert.equal(getActiveClozeRecognitionContext('a').targets.length,1);assert.equal(getActiveClozeRecognitionContext('b'),null);
  clearActiveClozeRecognitionContext();assert.equal(getActiveClozeRecognitionContext(),null);
});
test('correction lexical ×3 and early success, separate consecutive technical guard, no grading side effects',()=>{
  const progress=createCorrectionProgress();
  assert.equal(recordCorrectionAttempt(progress).complete,false);
  assert.equal(recordCorrectionAttempt(progress,{technical:true}).complete,false);
  assert.equal(recordCorrectionAttempt(progress,{technical:true}).complete,false);
  assert.deepEqual(progress,{misses:1,technicalFailures:2});
  assert.equal(recordCorrectionAttempt(progress).message,'あと1回練習します');assert.equal(progress.technicalFailures,0);
  assert.equal(recordCorrectionAttempt(progress,{success:true}).complete,true);assert.equal(progress.misses,2);
  const misses=createCorrectionProgress();for(let i=0;i<3;i++) assert.equal(recordCorrectionAttempt(misses).complete,i===2);
  const errors=createCorrectionProgress();for(let i=0;i<3;i++) assert.equal(recordCorrectionAttempt(errors,{technical:true}).complete,i===2);
  assert.equal(errors.misses,0);
});
