import { VOCABULARY_MIGRATION_FALLBACK } from './vocabularyLearningCore.js';

export const VOCABULARY_MIGRATION_MARKER='vocabularyV2ToV3MigrationCompletedV1';
const LEVEL_STATE_KEY='itemLevelV1';

function parseObject(raw){
  try{const value=JSON.parse(raw||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(_){return {};}
}

function hasProgress(value){
  return Number(value?.updatedAt)>0||Number(value?.last)>0||Number(value?.best)>0;
}

export function migrateVocabularyProgress({
  storage=globalThis.localStorage,
  migration,
  stateKey=LEVEL_STATE_KEY,
  markerKey=VOCABULARY_MIGRATION_MARKER,
}={}){
  if(!storage) return {executed:false,mapped:0,skippedExisting:0};
  try{if(storage.getItem(markerKey)==='done') return {executed:false,mapped:0,skippedExisting:0};}catch(_){return {executed:false,mapped:0,skippedExisting:0};}
  let state=parseObject(storage.getItem(stateKey));
  let changed=false,mapped=0,skippedExisting=0;
  const oldIds=new Set(),newIds=new Set();
  for(const mapping of Array.isArray(migration?.mappings)?migration.mappings:[]){
    const oldId=String(mapping?.v2_id||''),newId=String(mapping?.v3_id||'');
    if(!oldId||!newId||mapping?.same_sense_confirmed!==true||mapping?.same_expression_confirmed!==true||mapping?.pos_compatible_confirmed!==true||oldIds.has(oldId)||newIds.has(newId)) continue;
    oldIds.add(oldId);newIds.add(newId);
    if(Object.prototype.hasOwnProperty.call(state,newId)) {skippedExisting+=1;continue;}
    const oldState=state[oldId];
    if(!oldState||typeof oldState!=='object'||Array.isArray(oldState)||!hasProgress(oldState)) continue;
    state={...state,[newId]:{...oldState,[VOCABULARY_MIGRATION_FALLBACK]:true}};
    changed=true;mapped+=1;
  }
  try{
    if(changed) storage.setItem(stateKey,JSON.stringify(state));
    storage.setItem(markerKey,'done');
  }catch(_){return {executed:false,mapped:0,skippedExisting};}
  return {executed:true,mapped,skippedExisting};
}

// Admission merges have an independent marker: existing v2 migrations must not
// prevent these two later transfers. Preserve retired state and target priority.
export const FINAL_ADMISSION_MIGRATION_MARKER='vocabularyFinalAdmissionMergesCompletedV1';
export function migrateFinalAdmissionProgress({storage=globalThis.localStorage,migration,stateKey=LEVEL_STATE_KEY,markerKey=FINAL_ADMISSION_MIGRATION_MARKER}={}){
 if(!storage)return {executed:false,mapped:0,skippedExisting:0};
 try{
  if(storage.getItem(markerKey)==='done')return {executed:false,mapped:0,skippedExisting:0};
  const state=parseObject(storage.getItem(stateKey));let mapped=0,skippedExisting=0;
  for(const row of migration?.final_admission_merges||[]){
   if(!/^vocab:\d{5}$/.test(row.from_id)||!/^vocab:\d{5}$/.test(row.into_id)||row.from_id===row.into_id)continue;
   if(Object.prototype.hasOwnProperty.call(state,row.into_id)){skippedExisting++;continue;}
   const old=state[row.from_id];
   if(!old||typeof old!=='object'||Array.isArray(old)||!hasProgress(old))continue;
   state[row.into_id]={...old};mapped++;
  }
  if(mapped)storage.setItem(stateKey,JSON.stringify(state));
  storage.setItem(markerKey,'done');return {executed:true,mapped,skippedExisting};
 }catch(_){return {executed:false,mapped:0,skippedExisting:0};}
}
