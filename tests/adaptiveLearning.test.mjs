import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomaticSession,
  desiredSessionSize,
  filterByScope,
} from '../scripts/app/adaptiveLearning.js';

function item(id,extra={}){
  return {id,en:id,ja:id,speaker_tags:[],situation_tags:['general'],grammar_tags:[],construction_tags:[],function_tags:[],sentence_patterns:{main:null,clauses:[]},...extra};
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

test('character scope follows actual speaker assignment',()=>{
  const items=[
    item('A',{speaker_tags:[{id:'bob',source:'app_cast',confidence:'high'}]}),
    item('B',{speaker_tags:[{id:'bob',source:'app_cast',confidence:'medium'}]}),
    item('C',{speaker_tags:[{id:'jane',source:'app_cast',confidence:'high'}]}),
  ];
  assert.deepEqual(filterByScope(items,{type:'character',id:'bob'}).map(x=>x.id),['A','B']);
});

test('skill scope can target grammar, construction, and sentence pattern',()=>{
  const items=[
    item('Q',{grammar_tags:['question']}),
    item('X',{construction_tags:['there_be']}),
    item('P',{sentence_patterns:{main:'SVO',clauses:[]}}),
  ];
  assert.deepEqual(filterByScope(items,{type:'skill',id:'grammar:question'}).map(x=>x.id),['Q']);
  assert.deepEqual(filterByScope(items,{type:'skill',id:'construction:there_be'}).map(x=>x.id),['X']);
  assert.deepEqual(filterByScope(items,{type:'skill',id:'sentence_pattern:SVO'}).map(x=>x.id),['P']);
});

test('interleaving avoids repeating the same speaker when alternatives exist',()=>{
  const now=1000;
  const items=[
    item('A',{speaker_tags:[{id:'bob'}]}),
    item('B',{speaker_tags:[{id:'bob'}]}),
    item('C',{speaker_tags:[{id:'jane'}]}),
    item('D',{speaker_tags:[{id:'mike'}]}),
    item('E',{speaker_tags:[{id:'ken'}]}),
    item('F',{speaker_tags:[{id:'phil'}]}),
  ];
  const levels=Object.fromEntries(items.map(x=>[x.id,{last:2}]));
  const plan=buildAutomaticSession(items,levels,{now,size:6});
  assert.notDeepEqual(plan.items.slice(0,3).map(x=>x.id),['A','B','C']);
});
