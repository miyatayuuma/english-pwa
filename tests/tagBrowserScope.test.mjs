import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAutomaticSession, consumeRequestedTagScope } from '../scripts/app/adaptiveLearning.js';

function item(id,extra={}){
  return {id,en:id,ja:id,character_tags:[],situation_tags:['general'],grammar_tags:[],function_tags:[],...extra};
}

test('tag browser scope request is consumed exactly once',()=>{
  const host={__ENGLISH_PWA_TAG_SCOPE_REQUEST__:{type:'grammar',id:'question',includeMedium:true}};
  assert.deepEqual(consumeRequestedTagScope(host),{type:'grammar',id:'question',includeMedium:true});
  assert.equal(host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__,undefined);
  assert.equal(consumeRequestedTagScope(host),null);
});

test('automatic session honors a tag browser scope request',()=>{
  const previous=globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  try{
    globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__={type:'grammar',id:'question',includeMedium:true};
    const items=[
      item('Q1',{grammar_tags:['question']}),
      item('Q2',{grammar_tags:['question']}),
      item('P1',{grammar_tags:['passive_voice']}),
    ];
    const plan=buildAutomaticSession(items,{}, {now:1000,size:3});
    assert.equal(plan.scope?.id,'question');
    assert.deepEqual(plan.items.map(x=>x.id),['Q1','Q2']);
    assert.equal(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__,undefined);
  }finally{
    if(previous===undefined) delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
    else globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=previous;
  }
});
