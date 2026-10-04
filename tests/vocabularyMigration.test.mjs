import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateVocabularyProgress, VOCABULARY_MIGRATION_MARKER } from '../scripts/app/vocabularyMigration.js';

function fakeStorage(values={}){
  const map=new Map(Object.entries(values));
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),map};
}

const migration={mappings:[
  {v2_id:'duo:1:4',v3_id:'vocab:00001',same_sense_confirmed:true,same_expression_confirmed:true,pos_compatible_confirmed:true},
  {v2_id:'duo:1:5',v3_id:'vocab:00002',same_sense_confirmed:false},
  {v2_id:'duo:1:6',v3_id:'vocab:00003',same_sense_confirmed:true,same_expression_confirmed:true,pos_compatible_confirmed:true},
]};

test('one-time migration copies only reviewed progress and keeps the old and sentence states',()=>{
  const original={
    'duo:1:4':{last:3,best:4,updatedAt:123},
    'duo:1:5':{last:4,best:4,updatedAt:124},
    'duo:1:6':{last:0,best:0},
    E0001:{last:2,best:3,updatedAt:456},
  };
  const storage=fakeStorage({itemLevelV1:JSON.stringify(original)});
  const result=migrateVocabularyProgress({storage,migration});
  const saved=JSON.parse(storage.getItem('itemLevelV1'));
  assert.deepEqual(result,{executed:true,mapped:1,skippedExisting:0});
  assert.deepEqual(saved['vocab:00001'],{...original['duo:1:4'],_vocabularyV3LegacySourceFallback:true});
  assert.equal(saved['duo:1:4'].last,3);
  assert.equal(saved['duo:1:5'].last,4);
  assert.equal(saved.E0001.updatedAt,456);
  assert.equal(saved['vocab:00002'],undefined);
  assert.equal(saved['vocab:00003'],undefined);
});

test('an existing v3 state wins without overwriting it',()=>{
  const storage=fakeStorage({itemLevelV1:JSON.stringify({
    'duo:1:4':{last:3,best:3,updatedAt:123},
    'vocab:00001':{last:1,best:2,updatedAt:999},
  })});
  const result=migrateVocabularyProgress({storage,migration});
  assert.equal(result.mapped,0);
  assert.equal(result.skippedExisting,1);
  assert.equal(JSON.parse(storage.getItem('itemLevelV1'))['vocab:00001'].updatedAt,999);
});

test('migration marker prevents copying again on later loads',()=>{
  const storage=fakeStorage({itemLevelV1:JSON.stringify({'duo:1:4':{last:3,updatedAt:1}})});
  const first=migrateVocabularyProgress({storage,migration});
  const stateAfterFirst=storage.getItem('itemLevelV1');
  const second=migrateVocabularyProgress({storage,migration});
  assert.equal(first.mapped,1);
  assert.deepEqual(second,{executed:false,mapped:0,skippedExisting:0});
  assert.equal(storage.getItem('itemLevelV1'),stateAfterFirst);
  assert.equal(storage.getItem(VOCABULARY_MIGRATION_MARKER),'done');
});
