import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FINAL_COUNTS} from './materialize-final-admission.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const join=r=>JSON.stringify([r.audit_batch,r.kind,r.concept]);
export function validateMaterialization(db,manifest,admission,authority,baseline,items){
 const errors=[];const check=(ok,message)=>{if(!ok)errors.push(message);};
 const entries=db.entries||[],byId=new Map(entries.map(e=>[e.id,e]));
 const byItem=new Map(items.map(i=>[i.id,i]));
 const records=new Map(authority.records.map(r=>[join(r),r]));
 const mappings=new Map(manifest.add_mappings.map(r=>[join(r),r]));
 check(hash(baseline)===manifest.baseline_sha256,'Pre-admission baseline identity changed');
 check(crypto.createHash('sha256').update(JSON.stringify(admission.final_add.entries.map(({audit_batch,kind,concept})=>({audit_batch,kind,concept})))).digest('hex')===authority.final_admission_authority.inventory_sha256,'Fixed Final ADD authority changed');
 check(manifest.population_frozen===true&&entries.length===2478&&byId.size===2478,'Frozen population/IDs changed');
 const frozen=entries.map(e=>({id:e.id,kind:e.kind,origin:baseline.entries.some(b=>b.id===e.id)?'existing':'newly_materialized'}));
 check(hash(frozen)===manifest.population_sha256&&JSON.stringify(frozen)===JSON.stringify(manifest.frozen_entries),'Frozen IDs/kinds/order changed');
 check(JSON.stringify(Object.fromEntries(Object.keys(FINAL_COUNTS).map(k=>[k,entries.filter(e=>e.kind===k).length])))===JSON.stringify(FINAL_COUNTS),'Fixed kind counts changed');
 check(admission.final_add.entries.length===1408&&records.size===1408&&mappings.size===1408&&manifest.add_mappings.length===1408,'ADD/occurrence mapping not 1:1');
 for(const add of admission.final_add.entries){
  const mapping=mappings.get(join(add)),record=records.get(join(add)),entry=byId.get(mapping?.id);
  check(!!entry&&entry.kind===add.kind,`Missing/wrong ADD ${add.concept}`);
  check(!!record&&entry?.occurrences?.length===1&&entry.occurrences[0].item_id===record.item_id&&entry.occurrences[0].start===record.start&&entry.occurrences[0].end===record.end,`Authority span changed ${add.concept}`);
  const item=byItem.get(record?.item_id);check(!!item&&item.en.slice(record.start,record.end)===record.surface,`Invalid authority ${add.concept}`);
 }
 for(const row of admission.final_merge){check(!byId.has(row.entry_id)&&byId.has(row.into.match(/^vocab:\d{5}/)?.[0]),`Fixed merge changed ${row.entry_id}`);}
 for(const row of admission.final_reclassify){check(byId.get(row.entry_id)?.kind===row.to_kind,`Reclassification kind changed ${row.entry_id}`);}
 check(admission.final_merge.length===2&&admission.final_reclassify.length===25,'Fixed reconciliation count changed');
 return errors;
}
export function buildSemanticInventory(db,manifest){
 const newIds=new Set(manifest.add_mappings.map(r=>r.id));
 return {schema_version:1,population_frozen:true,population_sha256:manifest.population_sha256,semantic_audit_policy:manifest.semantic_audit_policy,
  partitions:Object.fromEntries(Object.keys(FINAL_COUNTS).map(kind=>[kind,db.entries.filter(e=>e.kind===kind).map(e=>e.id)])),
  entries:db.entries.map(e=>({id:e.id,kind:e.kind,canonical:e.canonical,sense_key:e.sense_key,meaning_ja:e.meaning_ja,origin:newIds.has(e.id)?'newly_materialized':'existing',occurrences:e.occurrences.map(o=>({item_id:o.item_id,start:o.start,end:o.end}))}))};
}
function main(){
 const db=read('vocabulary-v3.json'),manifest=read('vocabulary-v3-final-admission-materialization.json');
 const artifactHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'data/vocabulary-v3-final-admission-authority.json'))).digest('hex');
 if(artifactHash!==manifest.final_admission_artifact_sha256){console.error('Fixed Final Admission artifact identity changed');process.exitCode=1;return;}
 const errors=validateMaterialization(db,manifest,read('vocabulary-v3-final-admission-authority.json'),read('vocabulary-v3-final-admission-occurrences.json'),read('vocabulary-v3-pre-admission-baseline.json'),read('items.json'));
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;return;}
 const inventory=buildSemanticInventory(db,manifest),file=path.join(root,'data/vocabulary-v3-semantic-audit-inventory.json');
 if(process.argv.includes('--sync-inventory'))fs.writeFileSync(file,JSON.stringify(inventory,null,2)+'\n');
 else if(!fs.existsSync(file)||JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8')))!==JSON.stringify(inventory)){console.error('Semantic audit inventory stale; run npm run vocab:sync-derived');process.exitCode=1;return;}
 console.log('Final Admission materialization: PASS; 2478 frozen entries, 1408 exact authority mappings');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
