import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionPlanFromOptions,
  createDefaultSessionOptions,
  diagnoseEmptySessionOptions,
  eligibleItemsForSessionOptions,
  normalizeSessionOptions,
  requestedCountForSessionOptions,
  resetSessionOptions,
} from '../scripts/app/sessionOptionsCore.js';

function item(id,extra={}){
  return {id,en:id,ja:id,unit:'Section1',speaker_tags:[],grammar_tags:[],construction_tags:[],sentence_patterns:{main:null,clauses:[]},...extra};
}

test('character, skill, and Section conditions are combined with AND',()=>{
  const items=[
    item('MATCH',{speaker_tags:[{id:'bob'}],grammar_tags:['subjunctive'],unit:'Section12'}),
    item('WRONG_CHARACTER',{speaker_tags:[{id:'jane'}],grammar_tags:['subjunctive'],unit:'Section12'}),
    item('WRONG_SECTION',{speaker_tags:[{id:'bob'}],grammar_tags:['subjunctive'],unit:'Section11'}),
  ];
  const options={characterId:'bob',skillId:'grammar:subjunctive',section:'Section12'};
  assert.deepEqual(eligibleItemsForSessionOptions(items,options).map(entry=>entry.id),['MATCH']);
});

test('zero-result diagnosis identifies one-tap filters that recover candidates',()=>{
  const items=[
    item('BOB',{speaker_tags:[{id:'bob'}],grammar_tags:['question'],unit:'Section1'}),
    item('JANE',{speaker_tags:[{id:'jane'}],grammar_tags:['subjunctive'],unit:'Section2'}),
  ];
  const causes=diagnoseEmptySessionOptions(items,{characterId:'bob',skillId:'grammar:subjunctive',section:'Section1'});
  assert.deepEqual(causes.map(entry=>entry.key),['skillId']);
  assert.equal(causes[0].available,1);
});

test('zero-result diagnosis still offers every active filter when two releases are needed',()=>{
  const items=[item('ONLY',{speaker_tags:[{id:'jane'}],grammar_tags:['question'],unit:'Section2'})];
  const causes=diagnoseEmptySessionOptions(items,{characterId:'bob',skillId:'grammar:question',section:'Section1'});
  assert.deepEqual(causes.map(entry=>entry.key),['characterId','skillId','section']);
});

test('arbitrary counts and selection modes feed the automatic selector',()=>{
  const now=10_000;
  const items=Array.from({length:16},(_,index)=>item(`E${index}`));
  const levels=Object.fromEntries(items.slice(0,8).map((entry,index)=>[entry.id,{last:index<3?4:2,review:{nextDueAt:index<3?now-1:now+1000}}]));
  const plan=buildSessionPlanFromOptions(items,levels,{count:'custom',customCount:12,mode:'new'},{now});
  assert.equal(requestedCountForSessionOptions({count:'custom',customCount:12}),12);
  assert.equal(plan.targetSize,12);
  assert.equal(plan.mode,'new');
  assert.ok(plan.fresh>=4);
});

test('manual mode keeps the requested item order and respects the count',()=>{
  const items=[item('A'),item('B'),item('C')];
  const plan=buildSessionPlanFromOptions(items,{}, {mode:'manual',manualItemIds:['C','A','missing'],count:'5'});
  assert.deepEqual(plan.items.map(entry=>entry.id),['C','A']);
  assert.equal(plan.composition.shortfall,3);
  assert.equal(plan.composition.shortfallReason,'candidate_shortage');
});

test('returning home resets every option except the selected character',()=>{
  const configured=normalizeSessionOptions({characterId:'bob',skillId:'grammar:question',section:'Section23',count:'12',mode:'review',manualItemIds:['A']});
  assert.deepEqual(resetSessionOptions(configured),createDefaultSessionOptions('bob'));
  assert.equal(resetSessionOptions(configured).section,'');
});
