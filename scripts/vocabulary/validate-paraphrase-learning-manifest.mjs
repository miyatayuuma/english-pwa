import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const readJson=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const manifest=readJson('data/audits/vocabulary-v3-paraphrase-learning/manifest.json');
const vocabRaw=readJson('data/vocabulary-v3.json');
const entries=Array.isArray(vocabRaw)?vocabRaw:(vocabRaw.entries||[]);
const ids=entries.map(entry=>String(entry?.id||''));
const errors=[];

if(manifest.schema_version!==1) errors.push('schema_version must be 1');
if(manifest.policy_version!=='prompt-learning-value-v1') errors.push('unexpected policy_version');
if(manifest.population!==2478||ids.length!==2478) errors.push(`population mismatch manifest=${manifest.population} current=${ids.length}`);
if(manifest.batch_size!==100) errors.push('batch_size must be 100');
if(manifest.batch_count!==25||!Array.isArray(manifest.batches)||manifest.batches.length!==25) errors.push('expected 25 batches');

const manifestIds=[];
for(let index=0;index<(manifest.batches||[]).length;index+=1){
  const batch=manifest.batches[index]||{};
  const number=index+1;
  const key=String(number).padStart(3,'0');
  const expectedStart=index*100+1;
  const expectedEnd=Math.min(index*100+100,2478);
  const expectedCount=expectedEnd-expectedStart+1;
  if(batch.batch!==number) errors.push(`batch ${key}: wrong batch number`);
  if(batch.key!==`batch-${key}`) errors.push(`batch ${key}: wrong key`);
  if(batch.ordinal_start!==expectedStart||batch.ordinal_end!==expectedEnd||batch.entry_count!==expectedCount) errors.push(`batch ${key}: wrong ordinal range/count`);
  if(batch.claim_branch!==`audit/paraphrase-learning-v1-batch-${key}`) errors.push(`batch ${key}: wrong claim branch`);
  if(batch.artifact_path!==`data/audits/vocabulary-v3-paraphrase-learning/batch-${key}.json`) errors.push(`batch ${key}: wrong artifact path`);
  if(!Array.isArray(batch.entry_ids)||batch.entry_ids.length!==expectedCount) errors.push(`batch ${key}: wrong entry_ids length`);
  manifestIds.push(...(batch.entry_ids||[]).map(String));
}

if(manifestIds.length!==2478) errors.push(`manifest ID total is ${manifestIds.length}`);
if(new Set(manifestIds).size!==manifestIds.length) errors.push('manifest contains duplicate entry IDs');
if(new Set(ids).size!==ids.length) errors.push('current vocabulary contains duplicate entry IDs');

for(let i=0;i<Math.max(ids.length,manifestIds.length);i+=1){
  if(ids[i]!==manifestIds[i]){
    errors.push(`entry order drift at ordinal ${i+1}: manifest=${manifestIds[i]||'<missing>'} current=${ids[i]||'<missing>'}`);
    break;
  }
}

if(errors.length){
  console.error('Paraphrase learning manifest validation FAILED');
  for(const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Paraphrase learning manifest OK: ${manifest.population} entries / ${manifest.batch_count} batches`);
