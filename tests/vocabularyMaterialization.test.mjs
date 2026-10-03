import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildMaterialization} from '../scripts/vocabulary/materialize-final-admission.mjs';
import {validateMaterialization,buildSemanticInventory} from '../scripts/vocabulary/validate-final-admission-materialization.mjs';
import {joinVocabularyData,readyVocabularyEntries,eligibleVocabularyEntries,buildVocabularySession,classifyVocabularyAnswer} from '../scripts/app/vocabularyLearningCore.js';
import {migrateFinalAdmissionProgress,VOCABULARY_MIGRATION_MARKER,FINAL_ADMISSION_MIGRATION_MARKER} from '../scripts/app/vocabularyMigration.js';
const read=n=>JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
const db=read('vocabulary-v3'),manifest=read('vocabulary-v3-final-admission-materialization'),admission=read('vocabulary-v3-final-admission-authority'),authority=read('vocabulary-v3-final-admission-occurrences'),baseline=read('vocabulary-v3-pre-admission-baseline'),items=read('items');
const validate=(d=db,m=manifest)=>validateMaterialization(d,m,admission,authority,baseline,items);
test('fixed authority materializes deterministically with preserved IDs, two merges and 25 reclassifications',()=>{
 const inputs={baseline,admission,authority,items,v2:read('vocabulary-v2'),v1:read('vocabulary'),wordAudit:read('vocabulary-v3-word-audit'),paraphraseAudit:read('vocabulary-v3-paraphrase-audit'),migration:read('vocabulary-v2-v3-migration')};
 const first=buildMaterialization(inputs),second=buildMaterialization(inputs);
 assert.deepEqual(first,second);assert.deepEqual(first.db,db);assert.deepEqual(first.manifest,manifest);assert.deepEqual(validate(),[]);
 const old=new Map(baseline.entries.map(e=>[e.id,e]));
 for(const e of db.entries.filter(e=>old.has(e.id)&&!admission.final_reclassify.some(r=>r.entry_id===e.id)))assert.deepEqual(e,old.get(e.id));
 for(const row of admission.final_reclassify)assert.equal(db.entries.find(e=>e.id===row.entry_id).canonical,first.db.entries.find(e=>e.id===row.entry_id).canonical);
 assert.equal(manifest.id_policy.new_first_id,'vocab:01074');assert.equal(manifest.id_policy.new_last_id,'vocab:02481');
});
test('freeze and occurrence gate reject population, kind and span corruption',()=>{
 for(const mutate of [d=>d.entries.pop(),d=>d.entries[0].kind='word',d=>d.entries.at(-1).occurrences[0].start++]){
  const bad=structuredClone(db);mutate(bad);assert.ok(validate(bad).length);
 }
 const inventory=buildSemanticInventory(db,manifest);
 assert.deepEqual(Object.fromEntries(Object.entries(inventory.partitions).map(([k,v])=>[k,v.length])),{word:1422,expression:997,construction:59});
 assert.equal(inventory.entries.filter(e=>e.origin==='newly_materialized').length,1408);
});
test('2478-card load, filters, rotation, exact source answers and curated paraphrases initialize',()=>{
 const joined=joinVocabularyData(db,items,read('characters'));
 assert.equal(readyVocabularyEntries(joined).length,2478);
 const encountered=Object.fromEntries(items.map(i=>[i.id,{last:2,best:2,updatedAt:1700000000000}]));
 const eligible=eligibleVocabularyEntries(joined,encountered);assert.equal(eligible.length,2478);
 for(const entry of eligible){
  const {item,occurrence}=entry.activeOccurrence;
  assert.equal(classifyVocabularyAnswer({entry,activeOccurrence:entry.activeOccurrence,transcript:item.en.slice(occurrence.start,occurrence.end)}).type,'target',entry.id);
  assert.equal(classifyVocabularyAnswer({entry,activeOccurrence:entry.activeOccurrence,transcript:entry.canonical}).type,'target',entry.id);
  for(const value of entry.paraphrases||[])assert.equal(classifyVocabularyAnswer({entry,activeOccurrence:entry.activeOccurrence,transcript:value}).type,'paraphrase',entry.id);
 }
 for(const kind of ['all','word','expression']){
  const options={kind,size:30,newCap:30,now:1700000000000};
  const a=buildVocabularySession(eligible,{},options),b=buildVocabularySession(eligible,{}, {...options,rotationSeed:1});
  assert.equal(a.size,30);assert.equal(new Set(a.entries.map(e=>e.id)).size,30);assert.notDeepEqual(a.entries.map(e=>e.id),b.entries.map(e=>e.id));
  if(kind==='word')assert.ok(a.entries.every(e=>e.kind==='word'));
  if(kind==='expression')assert.ok(a.entries.every(e=>['expression','construction'].includes(e.kind)));
 }
});
test('merge progress survives an already completed v2 migration and never overwrites existing target progress',()=>{
 const state={'vocab:00147':{last:4,best:4,updatedAt:123},'vocab:00626':{last:3,best:5,updatedAt:456},'vocab:01049':{last:5,best:5,updatedAt:789}};
 const data=new Map([['itemLevelV1',JSON.stringify(state)],[VOCABULARY_MIGRATION_MARKER,'done']]);
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 assert.deepEqual(migrateFinalAdmissionProgress({storage,migration:read('vocabulary-v2-v3-migration')}),{executed:true,mapped:1,skippedExisting:1});
 const after=JSON.parse(data.get('itemLevelV1'));assert.deepEqual(after['vocab:00847'],state['vocab:00147']);assert.deepEqual(after['vocab:01049'],state['vocab:01049']);assert.deepEqual(after['vocab:00147'],state['vocab:00147']);assert.equal(data.get(FINAL_ADMISSION_MIGRATION_MARKER),'done');
 assert.equal(migrateFinalAdmissionProgress({storage,migration:read('vocabulary-v2-v3-migration')}).executed,false);
});
