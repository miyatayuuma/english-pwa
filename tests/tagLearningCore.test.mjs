import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSE_TYPES,
  buildTagCatalog,
  matchesTag,
  makeSearchToken,
  recommendTags,
  itemIsDue,
} from '../scripts/app/tagLearningCore.js';

const items=[
  {id:'E1',speaker_tags:[{id:'bob',source:'app_cast',confidence:'high'}],situation_tags:['romance_relationship'],grammar_tags:['present_perfect'],construction_tags:[],function_tags:[],sentence_patterns:{main:'SVO',clauses:[]}},
  {id:'E2',speaker_tags:[{id:'bob',source:'app_cast',confidence:'medium'}],situation_tags:['romance_relationship'],grammar_tags:['question'],construction_tags:['there_be'],function_tags:['asking'],sentence_patterns:{main:'SVC',clauses:[]}},
  {id:'E3',speaker_tags:[{id:'jane',source:'app_cast',confidence:'high'}],situation_tags:['family_home'],grammar_tags:['question'],construction_tags:[],function_tags:['asking'],sentence_patterns:{main:null,clauses:[]}},
  {id:'E4',speaker_tags:[{id:'jane',source:'app_cast',confidence:'medium'}],situation_tags:['family_home'],grammar_tags:[],construction_tags:[],function_tags:[],sentence_patterns:{main:'SV',clauses:[]}},
  {id:'E5',speaker_tags:[{id:'bob',source:'app_cast',confidence:'medium'}],situation_tags:['general'],grammar_tags:['question'],construction_tags:[],function_tags:[],sentence_patterns:{main:'SVO',clauses:[]}},
];
const characters=[
  {id:'bob',name:'Bob',name_ja:'ボブ',tier:'main'},
  {id:'jane',name:'Jane',name_ja:'ジェーン',tier:'main'},
];
const now=1_000_000;
const levels={
  E1:{last:5,review:{nextDueAt:now-1}},
  E2:{last:2,review:{nextDueAt:now+1000}},
  E3:{last:0},
  E4:{last:4,review:{nextDueAt:now+1000}},
  E5:{last:1,review:{nextDueAt:now+2000}},
};

test('browse surface exposes only characters and English skills',()=>{
  assert.deepEqual(BROWSE_TYPES,['character','skill']);
});

test('character matching is based on speaker tags, including app-cast medium confidence',()=>{
  assert.equal(matchesTag(items[0],'character','bob'),true);
  assert.equal(matchesTag(items[1],'character','bob'),true);
  assert.equal(matchesTag(items[2],'character','bob'),false);
});

test('character catalog derives compact themes from hidden situation metadata',()=>{
  const catalog=buildTagCatalog(items,characters,levels,now);
  const bob=catalog.character.find(x=>x.id==='bob');
  assert.equal(bob.total,3);
  assert.equal(bob.mastered,1);
  assert.equal(bob.learning,2);
  assert.equal(bob.due,1);
  assert.equal(bob.mastery,33);
  assert.equal(bob.themes[0].id,'romance_relationship');
});

test('skill catalog combines five patterns, grammar, and constructions',()=>{
  const catalog=buildTagCatalog(items,characters,levels,now);
  assert.ok(catalog.skill.some(x=>x.id==='sentence_pattern:SVO'));
  assert.ok(catalog.skill.some(x=>x.id==='grammar:question'));
  assert.ok(catalog.skill.some(x=>x.id==='construction:there_be'));
  assert.equal(catalog.situation,undefined);
  assert.equal(catalog.function,undefined);
});

test('skill scope resolves to its underlying structured axis',()=>{
  assert.equal(matchesTag(items[1],'skill','grammar:question'),true);
  assert.equal(matchesTag(items[1],'skill','construction:there_be'),true);
  assert.equal(matchesTag(items[0],'skill','sentence_pattern:SVO'),true);
});

test('flat token helper maps character browsing to speaker tags',()=>{
  assert.equal(makeSearchToken('character','bob'),'speaker:bob');
  assert.equal(makeSearchToken('grammar','question'),'grammar:question');
});

test('due calculation ignores never-studied items',()=>{
  assert.equal(itemIsDue(levels,'E1',now),true);
  assert.equal(itemIsDue(levels,'E3',now),false);
});

test('recommendations draw only from visible characters and skills',()=>{
  const catalog=buildTagCatalog(items,characters,levels,now);
  const recommendations=recommendTags(catalog,{limit:3});
  assert.ok(recommendations.length>0);
  assert.ok(recommendations.every(x=>x.type==='character'||x.type==='skill'));
});
