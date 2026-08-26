import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveClozeCount, buildClozeCard, desiredClozeCount, selectClozeTargets } from '../scripts/app/clozeLearningCore.js';

const e2={id:'E0002',en:'Take it easy. I can assure you that everything will turn out fine.',ja:'気楽にいけよ。大丈夫、すべてうまくいくさ。'};
const vocab=[
  {id:'p1',kind:'phrase',headword:'Take it easy.',meaning_ja:'気楽にする',example_ids:['E0002'],match_confidence:'high',meaning_confidence:'aligned_high'},
  {id:'w1',kind:'word',headword:'assure',meaning_ja:'保証する',example_ids:['E0002'],match_confidence:'high',meaning_confidence:'aligned_high'},
  {id:'p2',kind:'phrase',headword:'turn out (to be)',meaning_ja:'結局～となる',example_ids:['E0002'],match_confidence:'high',meaning_confidence:'aligned_high'},
  {id:'w2',kind:'word',headword:'turn',meaning_ja:'向きを変える',example_ids:['E0002'],match_confidence:'high',meaning_confidence:'dictionary_only'},
];

test('cloze density increases with sentence length but stays capped',()=>{
  assert.equal(desiredClozeCount('I agree.'),1);
  assert.equal(desiredClozeCount('Take it easy. I can assure you that everything is fine.'),2);
  assert.equal(desiredClozeCount('This is a deliberately longer example sentence with several important expressions that should receive more than one blank.'),3);
});

test('learning level increases cloze load gradually',()=>{
  const sentence='Take it easy. I can assure you that everything will turn out fine.';
  assert.equal(adaptiveClozeCount(sentence,0),1);
  assert.equal(adaptiveClozeCount(sentence,1),1);
  assert.equal(adaptiveClozeCount(sentence,2),2);
  assert.equal(adaptiveClozeCount(sentence,5),3);
  const long='This is a deliberately longer example sentence with several important expressions that should receive more than one blank.';
  assert.equal(adaptiveClozeCount(long,2),2);
  assert.equal(adaptiveClozeCount(long,3),3);
});

test('phrase targets are preferred and overlapping weaker word targets are removed',()=>{
  const targets=selectClozeTargets(e2,vocab,{count:3});
  assert.ok(targets.some(x=>/Take it easy/i.test(x.surface)));
  assert.ok(targets.some(x=>/turn out/i.test(x.surface)));
  assert.equal(targets.filter(x=>x.entry_id==='w2').length,0);
});

test('split phrasal verbs include intervening objects in one cloze span',()=>{
  const item={id:'E-SPLIT',en:'Please turn the light out before you leave.',ja:'出る前に明かりを消してください。'};
  const entries=[{id:'split',kind:'phrase',headword:'turn ... out',meaning_ja:'消す',example_ids:['E-SPLIT'],match_confidence:'high',meaning_confidence:'aligned_high'}];
  const targets=selectClozeTargets(item,entries,{count:1});
  assert.equal(targets.length,1);
  assert.equal(targets[0].surface,'turn the light out');
  assert.equal(targets[0].tokenEnd-targets[0].tokenStart+1,4);
});

test('buildClozeCard preserves the original sentence around blanks',()=>{
  const card=buildClozeCard(e2,vocab,{count:2});
  assert.equal(card.usable,true);
  assert.equal(card.targets.length,2);
  const reconstructed=card.segments.map(seg=>seg.text).join('');
  assert.equal(reconstructed,e2.en);
  assert.ok(card.segments.some(seg=>seg.type==='blank'));
});

test('a sentence still gets one useful blank when vocabulary linkage is missing',()=>{
  const item={id:'X',en:'The committee rejected the proposal immediately.',ja:''};
  const targets=selectClozeTargets(item,[]);
  assert.equal(targets.length,1);
  assert.equal(targets[0].fallback,true);
  assert.ok(targets[0].surface.length>=3);
});

test('entries not linked to the example do not become vocabulary-derived blanks',()=>{
  const targets=selectClozeTargets(e2,[{...vocab[0],example_ids:['E9999']}]);
  assert.equal(targets.length,1);
  assert.equal(targets[0].fallback,true);
});
