import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clearActiveClozeRecognitionContext, getActiveClozeRecognitionContext, setActiveClozeRecognitionContext } from '../scripts/app/clozeRecognitionContext.js';

test('active Read Cloze stage is explicit and bound to its sentence/item context',()=>{
  const targets=[{entry_id:'vocab:1',surface:'postwar',start:12,end:19}];
  setActiveClozeRecognitionContext({itemId:'R1',sentence:'The postwar era.',targets});
  targets[0].surface='changed';
  const context=getActiveClozeRecognitionContext('R1');
  assert.equal(context.mode,'cloze');
  assert.equal(context.itemId,'R1');
  assert.equal(context.targets[0].surface,'postwar');
  assert.equal(getActiveClozeRecognitionContext('R2'),null);
  context.targets[0].surface='mutated copy';
  assert.equal(getActiveClozeRecognitionContext('R1').targets[0].surface,'postwar');
  clearActiveClozeRecognitionContext();
  assert.equal(getActiveClozeRecognitionContext('R1'),null);
});

test('the active Cloze stage feeds its repaired score while ordinary Read keeps its strict score',async()=>{
  const main=await readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8');
  assert.match(main,/const matchRate=clozeResult\?\.active\s*\?clozeResult\.overallScore\s*:gradeReadSpeech\(alignment\)\.score/);
  assert.match(main,/const alignmentMode=corrective\?'correction':\(activeClozeContext\?\.mode\|\|studyMode\)/);
});
