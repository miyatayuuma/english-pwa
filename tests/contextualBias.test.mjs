import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecognitionBiasContext,applyRecognitionBias,RECOGNITION_PHRASE_LIMIT} from '../scripts/speech/contextualBias.js';
import {setActiveClozeRecognitionContext,getActiveClozeRecognitionContext,clearActiveClozeRecognitionContext} from '../scripts/app/clozeRecognitionContext.js';
import {createCorrectionProgress,recordCorrectionAttempt} from '../scripts/speech/correctionProgress.js';

const vocab=(entry,options={})=>buildRecognitionBiasContext({mode:'vocabulary',vocabularyEntry:entry,...options}).phrases;
test('Vocabulary word/expression/source TARGET variants are biased, paraphrases are excluded, duplicates/invalids bounded',()=>{
  assert.deepEqual(vocab({canonical:'despite'}),[{text:'despite',boost:4,authority:'vocabulary-target'}]);
  const entry={canonical:'yield to',answers:[' YIELD   TO ','yielded to',null,''],paraphrases:['give in to']};
  const activeOccurrence={item:{en:'He yielded to them.'},occurrence:{start:3,end:13}};
  assert.deepEqual(vocab(entry,{activeOccurrence}).map(p=>p.text),['yield to','yielded to']);
  assert.ok(vocab(entry,{correction:true}).every(p=>p.boost===5));
  assert.equal(vocab({canonical:'word',answers:Array.from({length:50},(_,i)=>`word ${i}`)}).length,RECOGNITION_PHRASE_LIMIT);
});
test('Cloze uses target and two-token local window, never a whole sentence boost',()=>{
  const sentence='He refused to yield to any threats from them.';
  const phrases=buildRecognitionBiasContext({mode:'read',clozeContext:{sentence,targets:[{surface:'yield to',tokenStart:3,tokenEnd:4}]}}).phrases;
  assert.deepEqual(phrases,[{text:'yield to',boost:4.5,authority:'cloze-target'},{text:'refused to yield to any threats',boost:3,authority:'cloze-local'}]);
  assert.ok(!phrases.some(p=>p.text===sentence));
});
test('30-token three-target Cloze is bounded at six phrases and separate windows',()=>{
  const sentence='Today I came across him near the old bridge when I was looking for the station and decided to yield to his request before continuing my long journey home again';
  const targets=[{surface:'came across',tokenStart:2,tokenEnd:3},{surface:'looking for',tokenStart:13,tokenEnd:14},{surface:'yield to',tokenStart:20,tokenEnd:21}];
  const phrases=buildRecognitionBiasContext({mode:'read',clozeContext:{sentence,targets}}).phrases;
  assert.equal(phrases.length,6);assert.equal(phrases.filter(p=>p.authority==='cloze-target').length,3);
  assert.ok(phrases.every(p=>p.text.split(' ').length<=6));
  for(const mode of ['compose','reorder','hidden','shadowing']) assert.deepEqual(buildRecognitionBiasContext({mode,referenceText:sentence,clozeContext:{sentence,targets}}).phrases,[]);
  assert.deepEqual(buildRecognitionBiasContext({mode:'read',referenceText:sentence}).phrases,[]);
  assert.deepEqual(buildRecognitionBiasContext({mode:'read',referenceText:sentence,correction:true}).phrases,[{text:sentence,boost:5,authority:'correction-target'}]);
});
test('Cloze registry copies data, restricts item identity, clears without DOM storage',()=>{
  const input={itemId:'a',sentence:'hidden answer',targets:[{surface:'answer',tokenStart:1,tokenEnd:1}]};
  setActiveClozeRecognitionContext(input);input.targets[0].surface='changed';
  const copy=getActiveClozeRecognitionContext('a');assert.equal(copy.targets[0].surface,'answer');copy.targets.length=0;
  assert.equal(getActiveClozeRecognitionContext('a').targets.length,1);assert.equal(getActiveClozeRecognitionContext('b'),null);
  clearActiveClozeRecognitionContext();assert.equal(getActiveClozeRecognitionContext(),null);
});
test('safe bias construction falls back on missing capabilities or constructor/property failure',()=>{
  const context={phrases:[{text:'yield to',boost:4}]};
  class Phrase{constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}}
  const supported={phrases:[]};assert.equal(applyRecognitionBias(supported,context,{SpeechRecognitionPhrase:Phrase}),true);
  assert.deepEqual(supported.phrases,[new Phrase('yield to',4)]);
  assert.equal(applyRecognitionBias({},context,{SpeechRecognitionPhrase:Phrase}),false);
  assert.equal(applyRecognitionBias({phrases:[]},context,{}),false);
  assert.equal(applyRecognitionBias({phrases:[]},context,{SpeechRecognitionPhrase:class {constructor(){throw Error();}}}),false);
  assert.equal(applyRecognitionBias({get phrases(){return [];},set phrases(_){throw Error();}},context,{SpeechRecognitionPhrase:Phrase}),false);
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
