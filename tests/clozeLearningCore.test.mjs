import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveClozeCount, buildClozeCard, desiredClozeCount, selectClozeTargets } from '../scripts/app/clozeLearningCore.js';
import { encounterFor } from '../scripts/app/clozeMode.js';

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

test('high-quality targets are selected without overlapping weaker entries',()=>{
  const targets=selectClozeTargets(e2,vocab,{count:3,level:5,variantKey:'quality'});
  assert.ok(targets.length>=1);
  assert.ok(targets.every(x=>x.entry_id!=='fallback'));
  assert.equal(targets.filter(x=>x.entry_id==='w2').length,0);
  for(let i=1;i<targets.length;i+=1) assert.ok(targets[i-1].tokenEnd<targets[i].tokenStart);
});

test('split phrasal verbs include intervening objects in one cloze span',()=>{
  const item={id:'E-SPLIT',en:'Please turn the light out before you leave tonight.',ja:'今夜出る前に明かりを消してください。'};
  const entries=[{id:'split',kind:'phrase',headword:'turn ... out',meaning_ja:'消す',example_ids:['E-SPLIT'],match_confidence:'high',meaning_confidence:'aligned_high'}];
  const targets=selectClozeTargets(item,entries,{count:1});
  assert.equal(targets.length,1);
  assert.equal(targets[0].surface,'turn the light out');
  assert.equal(targets[0].tokenEnd-targets[0].tokenStart+1,4);
});

test('buildClozeCard preserves the original sentence around blanks',()=>{
  const card=buildClozeCard(e2,vocab,{count:2,level:5,variantKey:'reconstruct'});
  assert.equal(card.usable,true);
  assert.ok(card.targets.length>=1&&card.targets.length<=2);
  const reconstructed=card.segments.map(seg=>seg.text).join('');
  assert.equal(reconstructed,e2.en);
  assert.ok(card.segments.some(seg=>seg.type==='blank'));
});

test('group caps follow learning level and cognitive budget wins over requested count',()=>{
  for(const [level,max] of [[0,1],[1,1],[2,2],[3,3],[5,3]]){
    const card=buildClozeCard(e2,vocab,{count:3,level,variantKey:`level-${level}`});
    assert.ok(card.targets.length<=max);
  }
  const longPhrase={id:'LONG',en:'Please turn the light out carefully before leaving home tonight.',ja:''};
  const entries=[
    {id:'phrase',kind:'phrase',headword:'turn ... out',example_ids:['LONG'],match_confidence:'high',meaning_confidence:'aligned_high'},
    {id:'leaving',kind:'word',headword:'leaving',example_ids:['LONG'],match_confidence:'high',meaning_confidence:'aligned_high'},
  ];
  const targets=selectClozeTargets(longPhrase,entries,{count:3,level:1,variantKey:'phrase',recentTargetIds:['leaving']});
  assert.equal(targets.length,1);
  assert.equal(targets[0].surface,'turn the light out');
});

test('variants are deterministic and rotate among high-quality candidates',()=>{
  const signatures=[];
  for(let variantKey=0;variantKey<8;variantKey+=1){
    const first=selectClozeTargets(e2,vocab,{count:1,level:1,variantKey});
    const second=selectClozeTargets(e2,vocab,{count:1,level:1,variantKey});
    assert.deepEqual(first,second);
    signatures.push(first.map(target=>target.entry_id).join(','));
  }
  assert.ok(new Set(signatures).size>=2);
  const prior=selectClozeTargets(e2,vocab,{count:1,level:1,variantKey:'prior'})[0]?.entry_id;
  const rotated=selectClozeTargets(e2,vocab,{count:1,level:1,variantKey:'prior',recentTargetIds:[prior]});
  assert.ok(rotated.length===1&&rotated[0].entry_id!==prior);
});

test('one item encounter keeps its variant while a later encounter gets a new one',()=>{
  const first=encounterFor(null,'E0002','first');
  first.card={targets:['fixed']};
  assert.equal(encounterFor(first,'E0002','ignored'),first);
  const other=encounterFor(first,'E0003','other');
  const returned=encounterFor(other,'E0002','returned');
  assert.notEqual(returned,first);
  assert.equal(returned.variantKey,'returned');
  assert.equal(returned.card,null);
});

test('normal targets stay within forty percent and phrase exceptions within forty-five percent',()=>{
  for(const variantKey of [0,1,2,3]){
    const targets=selectClozeTargets(e2,vocab,{count:3,level:5,variantKey});
    const hidden=targets.reduce((sum,target)=>sum+target.tokenEnd-target.tokenStart+1,0);
    const ratio=hidden/12;
    assert.ok(ratio<=(targets.some(target=>target.phraseException)?.45:.4));
  }
});

test('a sentence still gets one useful blank when vocabulary linkage is missing',()=>{
  const item={id:'X',en:'The committee rejected the proposal immediately.',ja:''};
  const targets=selectClozeTargets(item,[]);
  assert.equal(targets.length,1);
  assert.equal(targets[0].fallback,true);
  assert.ok(targets[0].surface.length>=3);
  assert.equal(/^(the|committee)$/i.test(targets[0].surface),false);
});

test('entries not linked to the example do not become vocabulary-derived blanks',()=>{
  const targets=selectClozeTargets(e2,[{...vocab[0],example_ids:['E9999']}]);
  assert.equal(targets.length,1);
  assert.equal(targets[0].fallback,true);
});
