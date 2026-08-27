import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCharacterRelationship,
  buildRelationshipCatalog,
  compareRelationshipSnapshots,
  freshnessOf,
  RELATIONSHIP_INTIMACY_CAPS,
  reachedMilestones,
  recommendCharacter,
  snapshotRelationships,
  summarizeRelationshipWorld,
} from '../scripts/app/relationshipCore.js';

const DAY=24*60*60*1000;
const now=20*DAY;
const chars=[
  {id:'joe',name:'Joe',tier:'main'},
  {id:'jane',name:'Jane',tier:'main'},
];
const items=[
  {id:'A',speaker_tags:[{id:'joe'}]},
  {id:'B',speaker_tags:[{id:'joe'},{id:'jane'}]},
  {id:'C',speaker_tags:[{id:'joe'}]},
  {id:'D',speaker_tags:[{id:'jane'}]},
];

function review(best,{due=now+DAY,interval=DAY}={}){
  return {best,last:best,review:{nextDueAt:due,intervalMs:interval}};
}

test('relationship ranks map directly to durable learning progress',()=>{
  let state={};
  let joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'acquaintance');

  state={A:review(1),B:review(1)};
  joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'familiar');

  state={A:review(1),B:review(1),C:review(1)};
  joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'friend');

  state={A:review(4),B:review(4),C:review(1)};
  joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'close_friend');

  state={A:review(4),B:review(4),C:review(4)};
  joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'best_friend');
});

test('intimacy is capped by the current durable relationship rank',()=>{
  assert.deepEqual(RELATIONSHIP_INTIMACY_CAPS,{
    acquaintance:24,
    familiar:49,
    friend:69,
    close_friend:89,
    best_friend:100,
  });

  const cases=[
    [{A:review(4)},'acquaintance',24],
    [{A:review(4),B:review(4)},'familiar',49],
    [{A:review(4),B:review(3),C:review(3)},'friend',69],
    [{A:review(4),B:review(4),C:review(3)},'close_friend',89],
    [{A:review(4),B:review(4),C:review(4)},'best_friend',100],
  ];
  for(const [state,rankId,cap] of cases){
    const joe=buildCharacterRelationship(items,chars[0],state,now);
    assert.equal(joe.rank.id,rankId);
    assert.equal(joe.intimacyCap,cap);
    assert.ok(joe.rawIntimacy>=joe.intimacy);
    assert.ok(joe.intimacy<=cap);
  }
});

test('rank-up unlocks the next intimacy ceiling without inventing progress',()=>{
  const friend=buildCharacterRelationship(items,chars[0],{
    A:review(4),B:review(3),C:review(3),
  },now);
  const close=buildCharacterRelationship(items,chars[0],{
    A:review(4),B:review(4),C:review(3),
  },now);
  assert.equal(friend.intimacy,69);
  assert.equal(close.intimacy,89);
  assert.equal(friend.rawIntimacy,83);
  assert.equal(close.rawIntimacy,92);
});

test('rank uses best achievement and never decays with current performance',()=>{
  const state={
    A:{best:4,last:1,review:{nextDueAt:now-DAY,intervalMs:DAY}},
    B:{best:4,last:2,review:{nextDueAt:now-DAY,intervalMs:DAY}},
    C:{best:4,last:1,review:{nextDueAt:now-DAY,intervalMs:DAY}},
  };
  const joe=buildCharacterRelationship(items,chars[0],state,now);
  assert.equal(joe.rank.id,'best_friend');
  assert.ok(joe.intimacy<100);
});

test('overdue decay lowers capped intimacy while preserving rank',()=>{
  const fresh={A:review(4),B:review(4),C:review(4)};
  const stale={
    A:review(4,{due:now-8*DAY,interval:DAY}),
    B:review(4,{due:now-8*DAY,interval:DAY}),
    C:review(4,{due:now-8*DAY,interval:DAY}),
  };
  const before=buildCharacterRelationship(items,chars[0],fresh,now);
  const after=buildCharacterRelationship(items,chars[0],stale,now);
  assert.equal(before.rank.id,'best_friend');
  assert.equal(after.rank.id,'best_friend');
  assert.ok(after.intimacy<before.intimacy);
});

test('intimacy stays full before due and decays only after the SRS deadline',()=>{
  const onTime={A:review(4,{due:now+DAY,interval:DAY})};
  const justDue={A:review(4,{due:now,interval:DAY})};
  const late={A:review(4,{due:now-2*DAY,interval:DAY})};
  assert.equal(freshnessOf(onTime,'A',now),1);
  assert.equal(freshnessOf(justDue,'A',now),1);
  assert.ok(freshnessOf(late,'A',now)<1);
  assert.ok(freshnessOf(late,'A',now)>=0.35);
});

test('shared dialogue progress advances both speakers',()=>{
  const before=buildRelationshipCatalog(items,chars,{},now);
  const snapshot=snapshotRelationships(before);
  const after=buildRelationshipCatalog(items,chars,{B:review(2)},now);
  const deltas=compareRelationshipSnapshots(snapshot,after);
  assert.equal(deltas.find(x=>x.id==='joe')?.pointGain,2);
  assert.equal(deltas.find(x=>x.id==='jane')?.pointGain,2);
});

test('shared-speaker intimacy deltas use the same capped display value',()=>{
  const before=buildRelationshipCatalog(items,chars,{B:review(3)},now);
  const snapshot=snapshotRelationships(before);
  const after=buildRelationshipCatalog(items,chars,{B:review(4)},now);
  const deltas=compareRelationshipSnapshots(snapshot,after);
  for(const entry of after){
    assert.ok(entry.intimacy<=entry.intimacyCap);
    const delta=deltas.find(candidate=>candidate.id===entry.id);
    if(delta) assert.equal(delta.intimacy,entry.intimacy);
  }
});

test('world milestones unlock full-coverage and mastery goals',()=>{
  const five=Array.from({length:5},(_,i)=>({id:`c${i}`,name:`C${i}`}));
  const fiveItems=five.map((c,i)=>({id:`I${i}`,speaker_tags:[{id:c.id}]}));
  const friendLevels=Object.fromEntries(fiveItems.map(item=>[item.id,review(1)]));
  const friendWorld=summarizeRelationshipWorld(fiveItems,buildRelationshipCatalog(fiveItems,five,friendLevels,now));
  assert.equal(friendWorld.friendCount,5);
  assert.ok(reachedMilestones(friendWorld).some(x=>x.id==='friends_all'));

  const bestLevels=Object.fromEntries(fiveItems.map(item=>[item.id,review(4)]));
  const bestWorld=summarizeRelationshipWorld(fiveItems,buildRelationshipCatalog(fiveItems,five,bestLevels,now));
  assert.ok(reachedMilestones(bestWorld).some(x=>x.id==='best_friends_all'));
});

test('recommendation favors due relationship work and postgame maintenance',()=>{
  const levels={
    A:review(4,{due:now-3*DAY,interval:DAY}),
    B:review(4,{due:now-3*DAY,interval:DAY}),
    C:review(4,{due:now-3*DAY,interval:DAY}),
    D:review(4,{due:now+DAY,interval:DAY}),
  };
  const relationships=buildRelationshipCatalog(items,chars,levels,now);
  assert.equal(recommendCharacter(relationships)?.id,'joe');
});
