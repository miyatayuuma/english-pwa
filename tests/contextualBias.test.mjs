import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecognitionBiasContext,applyRecognitionBias,RECOGNITION_PHRASE_LIMIT} from '../scripts/speech/contextualBias.js';
import {setActiveClozeRecognitionContext,getActiveClozeRecognitionContext,clearActiveClozeRecognitionContext} from '../scripts/app/clozeRecognitionContext.js';
import {createCorrectionProgress,recordCorrectionAttempt} from '../scripts/speech/correctionProgress.js';

const vocab=(entry,options={})=>buildRecognitionBiasContext({mode:'vocabulary',vocabularyEntry:entry,...options}).phrases;
test('Vocabulary accepted whole utterances get strongest bias and overlapping phrase context, paraphrases excluded',()=>{
  assert.deepEqual(vocab({canonical:'despite'}),[{text:'despite',boost:8,authority:'expected-utterance'}]);
  const entry={canonical:'yield to something',answers:[' YIELD   TO   SOMETHING ',null,''],paraphrases:['give in to something']};
  const plan=vocab(entry);
  assert.deepEqual(plan.map(p=>[p.text,p.boost]),[['yield to something',8],['yield to',7],['to something',6]]);
  assert.ok(vocab(entry,{correction:true}).filter(p=>p.authority!=='expected-utterance').every(p=>p.boost===7.5));
  const activeOccurrence={item:{en:'He yielded to them.'},occurrence:{start:3,end:13}};
  assert.ok(vocab({canonical:'yield to',answers:['yielded to']},{activeOccurrence}).some(p=>p.text==='yielded to'&&p.boost===8));
  assert.equal(vocab({canonical:'word',answers:Array.from({length:50},(_,i)=>`word ${i}`)}).length,RECOGNITION_PHRASE_LIMIT);
});
test('Cloze biases target-bearing, overlapping and surrounding chunks, never an extreme whole-sentence phrase',()=>{
  const sentence='Bob was so beside himself that he could scarcely tell fact from fiction.';
  const phrases=buildRecognitionBiasContext({mode:'read',clozeContext:{sentence,targets:[{surface:'scarcely',tokenStart:8,tokenEnd:8}]}}).phrases;
  assert.ok(phrases.some(p=>p.text.includes('scarcely')&&p.boost===7));
  assert.ok(phrases.some(p=>p.authority==='overlap-chunk'&&p.text.includes('scarcely')&&p.boost===6));
  assert.ok(phrases.some(p=>p.text==='Bob was so beside himself'&&p.boost===5));
  assert.ok(!phrases.some(p=>p.text===sentence||p.boost>7));
});
test('30-token three-target Cloze covers the sentence in bounded natural chunks; ordinary modes stay un-biased',()=>{
  const sentence='Today I came across him near the old bridge when I was looking for the station and decided to yield to his request before continuing my long journey home again';
  const targets=[{surface:'came across',tokenStart:2,tokenEnd:3},{surface:'looking for',tokenStart:12,tokenEnd:13},{surface:'yield to',tokenStart:19,tokenEnd:20}];
  const phrases=buildRecognitionBiasContext({mode:'read',clozeContext:{sentence,targets}}).phrases;
  assert.ok(phrases.length<=RECOGNITION_PHRASE_LIMIT);
  for(const target of targets) assert.ok(phrases.some(p=>p.text.includes(target.surface)&&p.boost===7));
  assert.ok(phrases.some(p=>p.text.includes('journey home again')),'surrounding sentence context is retained');
  assert.ok(new Set(phrases.map(p=>p.text.split(' ').length)).size>1,'chunks are not one fixed word window');
  for(const mode of ['compose','reorder','hidden','shadowing']) assert.deepEqual(buildRecognitionBiasContext({mode,referenceText:sentence,clozeContext:{sentence,targets}}).phrases,[]);
  assert.deepEqual(buildRecognitionBiasContext({mode:'read',referenceText:sentence}).phrases,[]);
  const correction=buildRecognitionBiasContext({mode:'read',referenceText:sentence,correction:true});
  assert.equal(correction.phrases[0].text,sentence);assert.equal(correction.phrases[0].boost,8);
  assert.ok(correction.phrases.some(p=>p.boost===7.5));
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
