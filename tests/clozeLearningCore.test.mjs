import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveClozeCount, buildClozeCard, desiredClozeCount, selectClozeTargets } from '../scripts/app/clozeLearningCore.js';
import { encounterFor } from '../scripts/app/clozeMode.js';

const e2={id:'E0002',en:'Take it easy. I can assure you that everything will turn out fine.',ja:'気楽にいけよ。大丈夫、すべてうまくいくさ。'};
const exact=(itemId,text,entry)=>({
  ...entry,
  occurrences:[{item_id:itemId,start:e2.en.indexOf(text),end:e2.en.indexOf(text)+text.length,contextual_meaning_ja:'文脈の訳'}],
});
const vocab=[
  exact('E0002','Take it easy',{id:'p1',kind:'expression',canonical:'take it easy',meaning_ja:'気楽にする'}),
  exact('E0002','assure',{id:'w1',kind:'word',canonical:'assure',meaning_ja:'保証する'}),
  exact('E0002','turn out fine',{id:'p2',kind:'expression',canonical:'turn out fine',meaning_ja:'結果的にうまくいく'}),
];

test('cloze density increases with sentence length but stays capped',()=>{
  assert.equal(desiredClozeCount('I agree.'),1);
  assert.equal(desiredClozeCount('Take it easy. I can assure you that everything is fine.'),2);
  assert.equal(desiredClozeCount('This is a deliberately longer example sentence with several important expressions that should receive more than one blank.'),3);
});

test('learning level increases cloze load gradually',()=>{
  assert.equal(adaptiveClozeCount(e2.en,0),1);
  assert.equal(adaptiveClozeCount(e2.en,1),1);
  assert.equal(adaptiveClozeCount(e2.en,2),2);
  assert.equal(adaptiveClozeCount(e2.en,5),3);
});

test('curated exact spans are selected before weak fallback targets',()=>{
  const targets=selectClozeTargets(e2,vocab,{count:3,level:5,variantKey:'quality'});
  assert.ok(targets.length>=1);
  assert.ok(targets.every(target=>target.entry_id!=='fallback'));
  assert.ok(targets.some(target=>target.entry_id==='p1'||target.entry_id==='p2'));
  for(let i=1;i<targets.length;i+=1) assert.ok(targets[i-1].tokenEnd<targets[i].tokenStart);
});

test('exact v3 occurrence includes intervening words without headword search',()=>{
  const item={id:'E-SPLIT',en:'Please turn the light out before you leave tonight.',ja:''};
  const surface='turn the light out',start=item.en.indexOf(surface);
  const entry={id:'split',kind:'expression',canonical:'turn something out',meaning_ja:'明かりを消す',occurrences:[{item_id:'E-SPLIT',start,end:start+surface.length,contextual_meaning_ja:'消す'}]};
  const targets=selectClozeTargets(item,[entry],{count:1});
  assert.equal(targets.length,1);
  assert.equal(targets[0].surface,surface);
  assert.equal(targets[0].tokenEnd-targets[0].tokenStart+1,4);
});

test('buildClozeCard preserves the full sentence around exact blanks',()=>{
  const card=buildClozeCard(e2,vocab,{count:2,level:5,variantKey:'reconstruct'});
  assert.equal(card.usable,true);
  assert.ok(card.targets.length>=1&&card.targets.length<=2);
  assert.equal(card.segments.map(segment=>segment.text).join(''),e2.en);
  assert.ok(card.segments.some(segment=>segment.type==='blank'));
});

test('group caps, hidden-word budgets, and the phrase exception remain in force',()=>{
  for(const [level,max] of [[0,1],[1,1],[2,2],[3,3],[5,3]]){
    const card=buildClozeCard(e2,vocab,{count:3,level,variantKey:`level-${level}`});
    assert.ok(card.targets.length<=max);
  }
  const long='Please turn the light out carefully before leaving home tonight.';
  const item={id:'LONG',en:long,ja:''};
  const span='turn the light out',start=long.indexOf(span);
  const entries=[
    {id:'phrase',kind:'expression',canonical:'turn the light out',occurrences:[{item_id:'LONG',start,end:start+span.length,contextual_meaning_ja:'消す'}]},
    {id:'leaving',kind:'word',canonical:'leave',occurrences:[{item_id:'LONG',start:long.indexOf('leaving'),end:long.indexOf('leaving')+7,contextual_meaning_ja:'出る'}]},
  ];
  const targets=selectClozeTargets(item,entries,{count:1,level:1,variantKey:'phrase',recentTargetIds:['leaving']});
  assert.equal(targets.length,1);
  assert.equal(targets[0].surface,span);
});

test('candidate rotation and recent-target preference are deterministic',()=>{
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

test('one item encounter keeps its selected cloze while a later encounter rotates',()=>{
  const first=encounterFor(null,'E0002','first');first.card={targets:['fixed']};
  assert.equal(encounterFor(first,'E0002','ignored'),first);
  const other=encounterFor(first,'E0003','other');
  const returned=encounterFor(other,'E0002','returned');
  assert.notEqual(returned,first);assert.equal(returned.variantKey,'returned');assert.equal(returned.card,null);
});

test('normal and phrase-exception hidden-word ratios stay within their limits',()=>{
  const targets=selectClozeTargets(e2,vocab,{count:3,level:5,variantKey:4});
  const hidden=targets.reduce((sum,target)=>sum+target.tokenEnd-target.tokenStart+1,0);
  const ratio=hidden/13;
  assert.ok(ratio<=(targets.some(target=>target.phraseException)?.45:.4));
});

test('fallback is used only when an item has no curated v3 candidates',()=>{
  const item={id:'X',en:'The committee rejected the proposal immediately.',ja:''};
  const fallback=selectClozeTargets(item,[]);
  assert.equal(fallback.length,1);assert.equal(fallback[0].fallback,true);
  const surface='The committee rejected the proposal immediately',start=item.en.indexOf(surface);
  const tooLong={id:'too-long',kind:'expression',canonical:'reject the whole proposal immediately',occurrences:[{item_id:'X',start,end:start+surface.length,contextual_meaning_ja:'却下した'}]};
  assert.deepEqual(selectClozeTargets(item,[tooLong]),[]);
});

test('reconstruction, range, no-overlap, group caps, and token load hold for representative v3 targets',()=>{
  for(const level of [0,2,5]) for(const variantKey of [0,1,2,3,4,5]){
    const card=buildClozeCard(e2,vocab,{level,count:adaptiveClozeCount(e2.en,level),variantKey});
    assert.equal(card.segments.map(segment=>segment.text).join(''),e2.en);
    assert.ok(card.targets.length<=adaptiveClozeCount(e2.en,level));
    for(let i=0;i<card.targets.length;i+=1){
      const current=card.targets[i];
      assert.ok(current.start>=0&&current.end<=e2.en.length&&current.start<current.end);
      if(i) assert.ok(card.targets[i-1].end<=current.start);
    }
  }
});
