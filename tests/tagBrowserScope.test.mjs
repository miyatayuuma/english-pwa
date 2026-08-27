import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAutomaticSession, consumeRequestedTagScope } from '../scripts/app/adaptiveLearning.js';

function item(id,extra={}){
  return {id,en:id,ja:id,speaker_tags:[],situation_tags:['general'],grammar_tags:[],construction_tags:[],function_tags:[],sentence_patterns:{main:null,clauses:[]},...extra};
}

test('browser scope request is consumed exactly once',()=>{
  const host={__ENGLISH_PWA_TAG_SCOPE_REQUEST__:{type:'skill',id:'grammar:question'}};
  assert.deepEqual(consumeRequestedTagScope(host),{type:'skill',id:'grammar:question'});
  assert.equal(host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__,undefined);
  assert.equal(consumeRequestedTagScope(host),null);
});

test('automatic session honors a skill browser scope request',()=>{
  const previous=globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  try{
    globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__={type:'skill',id:'grammar:question'};
    const items=[
      item('Q1',{grammar_tags:['question']}),
      item('Q2',{grammar_tags:['question']}),
      item('P1',{grammar_tags:['passive_voice']}),
    ];
    const plan=buildAutomaticSession(items,{}, {now:1000,size:3});
    assert.equal(plan.scope?.id,'grammar:question');
    assert.deepEqual(plan.items.map(x=>x.id),['Q1','Q2']);
    assert.equal(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__,undefined);
  }finally{
    if(previous===undefined) delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
    else globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=previous;
  }
});

test('automatic session honors a character browser scope request',()=>{
  const items=[
    item('B1',{speaker_tags:[{id:'bob'}]}),
    item('B2',{speaker_tags:[{id:'bob'}]}),
    item('J1',{speaker_tags:[{id:'jane'}]}),
  ];
  const plan=buildAutomaticSession(items,{}, {now:1000,size:3,scope:{type:'character',id:'bob'}});
  assert.deepEqual(plan.items.map(x=>x.id),['B1','B2']);
});

test('explicit null scope does not consume a pending request',()=>{
  const previous=globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  try{
    const pending={type:'skill',id:'grammar:question'};
    globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=pending;
    const items=[item('Q1',{grammar_tags:['question']}),item('P1',{grammar_tags:['passive_voice']})];
    const preview=buildAutomaticSession(items,{}, {now:1000,size:2,scope:null});
    assert.equal(preview.scope,null);
    assert.equal(preview.items.length,2);
    assert.equal(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__,pending);
  }finally{
    if(previous===undefined) delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
    else globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=previous;
  }
});
