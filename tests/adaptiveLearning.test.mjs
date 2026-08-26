import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomaticSession,
  desiredSessionSize,
  filterByScope,
} from '../scripts/app/adaptiveLearning.js';

function item(id,extra={}){
  return {id,en:id,ja:id,character_tags:[],situation_tags:['general'],grammar_tags:[],function_tags:[],...extra};
}

test('due work is prioritized while new material stays limited',()=>{
  const now=1_000_000;
  const items=Array.from({length:12},(_,i)=>item(`E${i}`));
  const levels={
    E0:{last:4,review:{nextDueAt:now-5000}},
    E1:{last:2,review:{nextDueAt:now+5000}},
    E2:{last:1},
    E3:{last:3},
  };
  const plan=buildAutomaticSession(items,levels,{now,size:7});
  assert.equal(plan.size,6);
  assert.equal(plan.items[0].id,'E0');
  assert.ok(plan.fresh<=2);
  assert.ok(plan.learning>=2);
});

test('session size grows modestly when many reviews are due',()=>{
  const now=5000;
  const items=Array.from({length:10},(_,i)=>item(`E${i}`));
  const levels=Object.fromEntries(items.map(x=>[x.id,{last:4,review:{nextDueAt:1000}}]));
  assert.equal(desiredSessionSize(items,levels,now),8);
});

test('character scope can exclude medium-confidence associations',()=>{
  const items=[
    item('A',{character_tags:[{id:'bob',certainty:'explicit'}]}),
    item('B',{character_tags:[{id:'bob',certainty:'inferred_high'}]}),
    item('C',{character_tags:[{id:'bob',certainty:'inferred_medium'}]}),
    item('D',{character_tags:[{id:'jane',certainty:'explicit'}]}),
  ];
  assert.deepEqual(filterByScope(items,{type:'character',id:'bob',includeMedium:false}).map(x=>x.id),['A','B']);
  assert.deepEqual(filterByScope(items,{type:'character',id:'bob',includeMedium:true}).map(x=>x.id),['A','B','C']);
});

test('interleaving avoids repeating the same strong tag when alternatives exist',()=>{
  const now=1000;
  const items=[
    item('A',{grammar_tags:['passive_voice']}),
    item('B',{grammar_tags:['passive_voice']}),
    item('C',{grammar_tags:['question']}),
    item('D',{grammar_tags:['present_perfect']}),
    item('E',{grammar_tags:['modal_can']}),
    item('F',{grammar_tags:['relative_clause']}),
  ];
  const levels=Object.fromEntries(items.map(x=>[x.id,{last:2}]));
  const plan=buildAutomaticSession(items,levels,{now,size:6});
  assert.notDeepEqual(plan.items.slice(0,3).map(x=>x.id),['A','B','C']);
});
