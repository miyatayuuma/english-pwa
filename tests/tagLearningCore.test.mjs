import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTagCatalog,
  matchesTag,
  makeSearchToken,
  recommendTags,
  itemIsDue
} from '../scripts/app/tagLearningCore.js';

const items=[
  {id:'E1',character_tags:[{id:'bob',certainty:'explicit'}],situation_tags:['romance_relationship'],grammar_tags:['present_perfect'],function_tags:[]},
  {id:'E2',character_tags:[{id:'bob',certainty:'inferred_high'}],situation_tags:['romance_relationship'],grammar_tags:['question'],function_tags:['asking']},
  {id:'E3',character_tags:[{id:'bob',certainty:'inferred_medium'}],situation_tags:['general'],grammar_tags:['question'],function_tags:['asking']},
  {id:'E4',character_tags:[{id:'jane',certainty:'explicit'}],situation_tags:['family_home'],grammar_tags:[],function_tags:[]}
];
const characters=[
  {id:'bob',name:'Bob',name_ja:'ボブ',tier:'main'},
  {id:'jane',name:'Jane',name_ja:'ジェーン',tier:'main'}
];
const now=1_000_000;
const levels={
  E1:{last:5,review:{nextDueAt:now-1}},
  E2:{last:2,review:{nextDueAt:now+1000}},
  E3:{last:0},
  E4:{last:4,review:{nextDueAt:now+1000}}
};

test('character matching can exclude medium-confidence contextual items',()=>{
  assert.equal(matchesTag(items[0],'character','bob',{includeMedium:false}),true);
  assert.equal(matchesTag(items[1],'character','bob',{includeMedium:false}),true);
  assert.equal(matchesTag(items[2],'character','bob',{includeMedium:false}),false);
  assert.equal(matchesTag(items[2],'character','bob',{includeMedium:true}),true);
});

test('catalog derives progress from existing level state instead of duplicating progress',()=>{
  const catalog=buildTagCatalog(items,characters,levels,now);
  const bob=catalog.character.find(x=>x.id==='bob');
  assert.equal(bob.total,3);
  assert.equal(bob.coreTotal,2);
  assert.equal(bob.relatedTotal,1);
  assert.equal(bob.mastered,1);
  assert.equal(bob.learning,1);
  assert.equal(bob.fresh,1);
  assert.equal(bob.due,1);
  assert.equal(bob.mastery,33);
});

test('tag search tokens match the namespaced flat tags stored in items.json',()=>{
  assert.equal(makeSearchToken('character','bob'),'character:bob');
  assert.equal(makeSearchToken('grammar','question'),'grammar:question');
});

test('due calculation ignores never-studied items',()=>{
  assert.equal(itemIsDue(levels,'E1',now),true);
  assert.equal(itemIsDue(levels,'E3',now),false);
});

test('recommendations prioritize due and in-progress learning',()=>{
  const catalog=buildTagCatalog(items,characters,levels,now);
  const recommendations=recommendTags(catalog,{limit:2});
  assert.ok(recommendations.length>0);
  assert.ok(recommendations.some(x=>x.id==='bob' || x.id==='romance_relationship'));
});
