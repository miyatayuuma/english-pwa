import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COUNT_CHOICES, normalizeSessionOptions, migrateLegacySessionCount, buildSessionPlanFromOptions, resetSessionOptions } from '../scripts/app/sessionOptionsCore.js';
import { createSetupHandoff, consumeSetupHandoff, storeSetupHandoff, normalizeGameMethod, SETUP_HANDOFF_KEY, SETUP_RECEIPT_KEY, SETUP_HANDOFF_TTL } from '../scripts/app/sessionSetupHandoff.js';
const items=Array.from({length:60},(_,i)=>({id:`E${i}`,en:`Sentence ${i}`,ja:`文${i}`,unit:i<49?'Section1':'Section2'}));
const options=normalizeSessionOptions({count:'20',mode:'manual',manualItemIds:['E3','E1']});
const now=1_000_000;
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};}
function payload(extra={}){return {...createSetupHandoff({gameMethod:'compose',options,appVersion:'test',nonce:'unique-nonce',now}),...extra};}
function consume(store,extra={}){return consumeSetupHandoff({storage:store,appVersion:'test',method:'compose',now:now+1,...extra});}

test('fixed enum and sentence normalization never absorb game method or vocabulary kind',()=>{
  assert.deepEqual(SESSION_COUNT_CHOICES,['auto','5','8','12','20','30','50']);
  const normalized=normalizeSessionOptions({gameMethod:'vocabulary',kind:'word',count:'20',mode:'review',trainingMode:'continuous_shadowing'});
  assert.equal(normalized.gameMethod,undefined);assert.equal(normalized.kind,undefined);
  assert.equal(normalized.mode,'review');assert.equal(normalized.trainingMode,'continuous_shadowing');
  assert.equal(normalized.customCount,undefined);
  for(const method of ['read','compose','vocabulary']) assert.equal(normalizeGameMethod(method),method);
  assert.equal(normalizeGameMethod('invalid','compose'),'compose');
});
for(const count of ['5','8','12','20','30','50']) test(`fixed ${count} reaches actual sentence plan`,()=>{
  const plan=buildSessionPlanFromOptions(items,{}, {count});
  assert.equal(plan.size,Number(count));assert.equal(plan.targetSize,Number(count));assert.equal(plan.composition.shortfall,0);
});
test('adaptive auto remains 6–8; shortage reports actual 49 and no phantom item',()=>{
  const auto=buildSessionPlanFromOptions(items,Object.fromEntries(items.map(x=>[x.id,{last:2,best:2}])), {count:'auto'});assert.ok(auto.size>=6&&auto.size<=8);
  const short=buildSessionPlanFromOptions(items,{}, {count:'50',section:'Section1'});
  assert.equal(short.size,49);assert.equal(short.composition.shortfall,1);
  assert.equal(buildSessionPlanFromOptions(items,{}, {count:'50',section:'missing'}).size,0);
});
test('manual validates scope, preserves first-seen order, caps count, never fills',()=>{
  const ids=['E3','missing','E3','E51','E1','E2','E4','E5','E6'];
  const plan=buildSessionPlanFromOptions(items,{}, {mode:'manual',manualItemIds:ids,section:'Section1',count:'5'});
  assert.deepEqual(plan.items.map(x=>x.id),['E3','E1','E2','E4','E5']);
  const short=buildSessionPlanFromOptions(items,{}, {...options,count:'5'});
  assert.equal(short.size,2);assert.equal(short.composition.shortfall,3);
  assert.equal(buildSessionPlanFromOptions(items,{}, {mode:'manual',manualItemIds:['missing'],count:'5'}).size,0);
});
test('legacy custom exact matches migrate; all other values explicitly fall back without rounding',()=>{
  for(const count of SESSION_COUNT_CHOICES.slice(1)){
    const normalized=normalizeSessionOptions({count:'custom',customCount:Number(count)});
    assert.equal(normalized.count,count);assert.equal(normalized.customCount,undefined);
    assert.equal(migrateLegacySessionCount({count:'custom',customCount:Number(count)}).changed,false);
  }
  for(const customCount of [7,10,19,20.1,null,undefined,NaN,'','auto',-5,100]){
    assert.deepEqual(migrateLegacySessionCount({count:'custom',customCount}),{count:'auto',changed:true});
  }
});
test('reset drops manual IDs, filters and training; preserves character',()=>{
  const reset=resetSessionOptions({...options,characterId:'bob',skillId:'grammar:x',section:'Section1',trainingMode:'continuous_shadowing'});
  assert.equal(reset.characterId,'bob');assert.equal(reset.count,'auto');assert.equal(reset.skillId,'');assert.equal(reset.section,'');assert.deepEqual(reset.manualItemIds,[]);assert.equal(reset.trainingMode,'standard');
});
test('one-shot consumes before dispatch, clears course, and rejects replay even after another intent',()=>{
  const store=storage();store.setItem('englishPwaPendingGameAction','auto');
  assert.ok(storeSetupHandoff(payload(),store));assert.equal(store.getItem('englishPwaPendingGameAction'),null);
  assert.equal(consume(store).gameMethod,'compose');assert.equal(store.getItem(SETUP_HANDOFF_KEY),null);
  assert.equal(consume(store),null);
  storeSetupHandoff(payload({nonce:'second-nonce'}),store);assert.ok(consume(store));
  storeSetupHandoff(payload(),store);assert.equal(consume(store),null);
});
for(const [label,patch] of Object.entries({schema:{schema:2},appVersion:{appVersion:'old'},method:{gameMethod:'read'},intent:{intent:'open'},nonce:{nonce:''},expired:{createdAt:now-SETUP_HANDOFF_TTL},future:{createdAt:now+50},character:{characterId:'bob'},count:{options:{...options,count:'10'}},mode:{options:{...options,mode:'vocabulary'}},training:{options:{...options,trainingMode:'continuous_shadowing'}},manual:{options:{...options,manualItemIds:null}}})) test(`invalid handoff rejected and removed: ${label}`,()=>{
  const store=storage();storeSetupHandoff(payload(patch),store);assert.equal(consume(store),null);assert.equal(store.getItem(SETUP_HANDOFF_KEY),null);
});
test('malformed or inaccessible storage never dispatches; failed receipt also fails closed',()=>{
  const store=storage();store.setItem(SETUP_HANDOFF_KEY,'{bad');assert.equal(consume(store),null);assert.equal(store.getItem(SETUP_HANDOFF_KEY),null);
  storeSetupHandoff(payload(),store);
  const guarded={...store,setItem:(key,value)=>{if(key===SETUP_RECEIPT_KEY) throw Error('full');store.setItem(key,value);}};
  assert.equal(consume(guarded),null);assert.equal(store.getItem(SETUP_HANDOFF_KEY),null);
});
test('compose handoff normalizes training; legacy invalid custom requires restoration, not auto launch',()=>{
  const value=createSetupHandoff({gameMethod:'compose',options:{trainingMode:'continuous_shadowing'},appVersion:'test',nonce:'valid-nonce',now});
  assert.equal(value.options.trainingMode,'standard');
  const store=storage();storeSetupHandoff(payload({options:{...options,count:'custom',customCount:7}}),store);
  const restored=consume(store);assert.equal(restored.options.count,'auto');assert.equal(restored.legacyCountReset,true);
});

test('malformed legacy custom cannot bypass the restoration notice through auto string',()=>{
  for(const customCount of ['auto',null,undefined,7]){
    const store=storage();storeSetupHandoff(payload({options:{...options,count:'custom',customCount}}),store);
    const restored=consume(store);assert.equal(restored.options.count,'auto');assert.equal(restored.legacyCountReset,true);
  }
});
