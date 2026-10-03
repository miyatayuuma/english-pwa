import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRecognitionBiasContext, exactBiasStrings, resolveNativeBiasStrings } from '../scripts/speech/contextualBias.js';
import { setActiveClozeRecognitionContext, getActiveClozeRecognitionContext, clearActiveClozeRecognitionContext } from '../scripts/app/clozeRecognitionContext.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../scripts/speech/correctionProgress.js';

test('Vocabulary bias contains every strict TARGET surface only, with exact dedupe and no weighting', async () => {
  const entry={canonical:'yield to something',answers:['YIELD to something','yield to something'],paraphrases:['give in to something']};
  const activeOccurrence={item:{en:'He yielded to them.'},occurrence:{start:3,end:13}};
  const context=buildRecognitionBiasContext({mode:'vocabulary',vocabularyEntry:entry,activeOccurrence,correction:true});
  assert.deepEqual(context.biasStrings,['yield to something','YIELD to something','yielded to']);
  assert.deepEqual(await resolveNativeBiasStrings(context),context.biasStrings);
  assert.equal(context.phrases,undefined);
  assert.deepEqual(exactBiasStrings([' a ','a','a!',' a ']),[' a ','a','a!']);
  assert.throws(()=>exactBiasStrings(['']),/Empty/);
});
test('all sentence modes resolve by stable item identity, without target windows or whole source', async () => {
  const corpus=JSON.parse(fs.readFileSync(new URL('../data/reorder-v1.json',import.meta.url)));
  const item=corpus.items.find(x=>x.itemId==='E0102');
  const oldFetch=globalThis.fetch;
  let loads=0;
  globalThis.fetch=async()=>{loads++;return {ok:true,json:async()=>corpus};};
  try {
    for(const mode of ['read','repeat','hidden','shadowing','correction']) {
      const context=buildRecognitionBiasContext({mode,itemId:'E0102',referenceText:'invented whole sentence',clozeContext:{targets:[{surface:'invented'}]}});
      assert.deepEqual(await resolveNativeBiasStrings(context),[...new Set(item.sentences.flatMap(s=>s.partition.chunks.map(c=>c.learningText)))]);
      assert.equal(context.referenceText,undefined);
      assert.equal(context.phrases,undefined);
    }
    const sentence=buildRecognitionBiasContext({mode:'read',itemId:'E0102',sentenceIndex:1});
    assert.deepEqual(await resolveNativeBiasStrings(sentence),[...new Set(item.sentences[1].partition.chunks.map(c=>c.learningText))]);
    assert.equal(loads,1,'one shared metadata loader');
  } finally {globalThis.fetch=oldFetch;}
  await assert.rejects(resolveNativeBiasStrings(buildRecognitionBiasContext({mode:'read',referenceText:'same text'})),/itemId/);
});
test('Reordering has no recognition context even with an expected source',async()=>{
  for(const mode of ['compose','generate','reorder']) {
    const context=buildRecognitionBiasContext({mode,itemId:'E0102'});
    assert.equal(context.speechDisabled,true);
    await assert.rejects(resolveNativeBiasStrings(context),/no speech backend/);
  }
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
