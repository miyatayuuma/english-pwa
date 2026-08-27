import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomaticSession,
  consumeFocusedSessionPending,
  desiredSessionSize,
  filterByScope,
  markFocusedSessionPending,
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
  assert.equal(plan.composition.shortfallReason,'new_limit');
  assert.equal(plan.selections.length,plan.items.length);
  assert.equal(plan.selectionReasons.E0,'review');
});

test('standard automatic cycle is seven turns with a balanced composition',()=>{
  const now=10_000;
  const items=Array.from({length:12},(_,i)=>item(`B${i}`));
  const levels={
    B0:{last:4,review:{nextDueAt:now-100}},
    B1:{last:4,review:{nextDueAt:now-200}},
    B2:{last:4,review:{nextDueAt:now-300}},
    B3:{last:2},B4:{last:3},B5:{last:4},B6:{last:5},
  };
  const plan=buildAutomaticSession(items,levels,{now});
  assert.equal(plan.targetSize,7);
  assert.equal(plan.size,7);
  assert.deepEqual(plan.composition,{target:7,selected:7,review:3,weak:2,new:2,maintenance:0,candidates:12,recentExcluded:0,shortfall:0,shortfallReason:null,shortfallLabel:''});
});

test('session size grows modestly when many reviews are due',()=>{
  const now=5000;
  const items=Array.from({length:10},(_,i)=>item(`E${i}`));
  const levels=Object.fromEntries(items.map(x=>[x.id,{last:4,review:{nextDueAt:1000}}]));
  assert.equal(desiredSessionSize(items,levels,now),8);
});

test('recent session items are avoided unless due or just failed',()=>{
  const now=5000;
  const items=['DUE','FAILED','RECENT','OTHER1','OTHER2','OTHER3','OTHER4'].map(id=>item(id));
  const levels={
    DUE:{last:4,review:{nextDueAt:now-1}},
    FAILED:{last:4,lastMatch:0.4,review:{nextDueAt:now+1000}},
    RECENT:{last:4,review:{nextDueAt:now+1000}},
    OTHER1:{last:2},OTHER2:{last:3},OTHER3:{last:4},OTHER4:{last:5},
  };
  const plan=buildAutomaticSession(items,levels,{now,size:7,recentItemIds:['DUE','FAILED','RECENT']});
  assert.ok(plan.items.some(entry=>entry.id==='DUE'));
  assert.ok(plan.items.some(entry=>entry.id==='FAILED'));
  assert.ok(!plan.items.some(entry=>entry.id==='RECENT'));
  assert.equal(plan.composition.recentExcluded,1);
  assert.equal(plan.composition.shortfallReason,'recent_exclusion');
});

test('new-only pools stop at two and explain the shortened cycle',()=>{
  const items=Array.from({length:9},(_,i)=>item(`N${i}`));
  const plan=buildAutomaticSession(items,{}, {now:1000,size:7});
  assert.equal(plan.size,2);
  assert.equal(plan.fresh,2);
  assert.equal(plan.composition.shortfall,5);
  assert.equal(plan.composition.shortfallReason,'new_limit');
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

test('section and AND scopes reuse the same selection pipeline',()=>{
  const items=[
    item('A',{unit:'Section1',speaker_tags:[{id:'bob'}],grammar_tags:['question']}),
    item('B',{unit:'Section1',speaker_tags:[{id:'jane'}],grammar_tags:['question']}),
    item('C',{unit:'Section2',speaker_tags:[{id:'bob'}],grammar_tags:['question']}),
  ];
  assert.deepEqual(filterByScope(items,{type:'section',id:'1'}).map(x=>x.id),['A','B']);
  const scope={characterId:'bob',skillId:'grammar:question',section:'Section1'};
  const plan=buildAutomaticSession(items,{}, {now:1000,size:3,scope});
  assert.deepEqual(plan.items.map(x=>x.id),['A']);
  assert.deepEqual(plan.scope,scope);
});

test('fixed time and data always produce the same session and reasons',()=>{
  const now=9000;
  const items=Array.from({length:9},(_,i)=>item(`R${i}`,{
    speaker_tags:[{id:i%2?'bob':'jane'}],
    grammar_tags:[i%3?'question':'passive_voice'],
  }));
  const levels=Object.fromEntries(items.slice(0,6).map((entry,i)=>[entry.id,{last:i%4+1,review:{nextDueAt:i<3?now-100:now+100}}]));
  const first=buildAutomaticSession(items,levels,{now,size:7});
  const second=buildAutomaticSession(items,levels,{now,size:7});
  assert.deepEqual(first.items.map(x=>x.id),second.items.map(x=>x.id));
  assert.deepEqual(first.selectionReasons,second.selectionReasons);
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
  assert.notEqual(plan.items[0].speaker_tags[0].id,plan.items[1].speaker_tags[0].id);
});

test('focused session rebuild request is consumed exactly once',()=>{
  const host={};
  assert.equal(consumeFocusedSessionPending(host),false);
  assert.equal(markFocusedSessionPending(host),true);
  assert.equal(consumeFocusedSessionPending(host),true);
  assert.equal(consumeFocusedSessionPending(host),false);
});
