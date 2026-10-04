import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { migrateZeroSetupStorage, RETIRED_CONFIG_FIELDS, RETIRED_STORAGE_KEYS } from '../scripts/storage/zeroSetupMigration.js';
import { buildSessionPlanFromOptions } from '../scripts/app/sessionOptionsCore.js';
function fixture(){
  const kept={itemLevelV1:'levels',studyLogV1:'history',audioSpeedV1:'1.25',dailyGoalV1:'18',sessionGoalV1:'8',recentSessionItemIdsV1:'recent',relationshipStateV1:'relationship',notifStateV1:'notification delivery'};
  const values=new Map(Object.entries(kept));
  values.set('appConfigV3',JSON.stringify({studyMode:'compose',...Object.fromEntries(RETIRED_CONFIG_FIELDS.map(key=>[key,'legacy']))}));
  for(const key of RETIRED_STORAGE_KEYS) values.set(key,'legacy');
  return {kept,values,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
}
test('one-time migration preserves independent learning state and method, deletes retired feature storage',()=>{
  const {kept,values,storage}=fixture();assert.equal(migrateZeroSetupStorage(storage),true);
  assert.deepEqual(JSON.parse(values.get('appConfigV3')),{studyMode:'compose'});
  for(const key of RETIRED_STORAGE_KEYS) assert.equal(values.has(key),false,key);
  for(const [key,value] of Object.entries(kept)) assert.equal(values.get(key),value,key);
  const snapshot=[...values];assert.equal(migrateZeroSetupStorage(storage),true);assert.deepEqual([...values],snapshot);
});
test('fresh and malformed old config never block setup or erase learning history',()=>{
  const {values,storage}=fixture();values.set('appConfigV3','bad JSON');assert.equal(migrateZeroSetupStorage(storage),true);assert.equal(values.get('itemLevelV1'),'levels');
  values.clear();assert.equal(migrateZeroSetupStorage(storage),true);assert.equal(values.has('appConfigV3'),false);
});
test('actual plan counts use the existing authority with auto, explicit, custom and shortfall',()=>{
  const items=Array.from({length:30},(_,i)=>({id:'E'+i,en:'Test '+i,ja:'例文',unit:'Section1'}));
  for(const [count,customCount,size] of [['5',7,5],['8',7,8],['12',7,12],['custom',17,17]]){
    const plan=buildSessionPlanFromOptions(items,{}, {count,customCount},{now:10000,random:()=>0.5});
    assert.equal(plan.items.length,size);assert.equal(plan.size,size);
  }
  const levels=Object.fromEntries(items.map(item=>[item.id,{last:2,best:2}]));
  const auto=buildSessionPlanFromOptions(items,levels, {count:'auto'},{now:10000});assert.ok(auto.size>=6&&auto.size<=8);
  const short=buildSessionPlanFromOptions(items.slice(0,3),{}, {count:'12'},{now:10000});assert.equal(short.size,3);assert.equal(short.composition.shortfall,9);
});
test('runtime has folder-only settings and no retired bindings or remote logs; native bridges remain',async()=>{
  const read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
  const [html,main,worker]=await Promise.all([read('index.html'),read('scripts/app/main.js'),read('sw.js')]);
  for(const control of ['cfgUrl','cfgKey','cfgAudioBase','cfgPlaybackMode','cfgStudyMode','cfgSpeechVoice','cfgMilestoneIntensity','cfgResultSound','notifTimeList','notifTriggerDailyZero','cfgSave','onboardingCard','personalPlanSummary']){
    assert.ok(!html.includes(control),control);assert.ok(!main.includes(control),control);
  }
  assert.doesNotMatch(main,/sendLog|flushPendingLogs|refreshRemoteStatus|CFG\.(apiUrl|apiKey|audioBase)|initOnboardingFlow/);
  assert.doesNotMatch(worker,/logManager/);
  for(const id of ['btnPickDir','btnClearDir','dirStatus']) assert.ok(html.includes(id));
  assert.match(main,/nativeDirectory\('pick'\)/);assert.match(main,/prompt:false, forceCheck:true/);
});
