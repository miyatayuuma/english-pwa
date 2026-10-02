import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVocabularyV3 } from './validate-vocabulary-v3.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dataPath=name=>path.join(root,'data',name);
const read=name=>JSON.parse(fs.readFileSync(dataPath(name),'utf8'));
const json=value=>`${JSON.stringify(value,null,2)}\n`;

function syncParaphraseAudit(audit,entries){
  const kindCounts=Object.fromEntries(
    ['word','expression','construction'].map(kind=>[kind,entries.filter(entry=>entry?.kind===kind).length]),
  );
  return {
    ...audit,
    review_scope:{entry_count:entries.length,kind_counts:kindCounts},
    reviewed_entries:entries.map(entry=>({
      entry_id:entry.id,
      decision:Array.isArray(entry.paraphrases)&&entry.paraphrases.length?'curated':'reviewed_no_major_paraphrase',
    })),
    curated_paraphrases:entries
      .filter(entry=>Array.isArray(entry.paraphrases)&&entry.paraphrases.length)
      .map(entry=>({entry_id:entry.id,paraphrases:[...entry.paraphrases]})),
  };
}

function syncWordExample(row,entryById,itemById){
  const id=String(row?.entry_id||'');
  const itemId=String(row?.item_id||'');
  const entry=entryById.get(id);
  const occurrence=entry?.occurrences?.find(value=>String(value?.item_id||'')===itemId);
  const item=itemById.get(itemId);
  if(!entry||!occurrence||!item){
    throw new Error(`word audit exemplar cannot be synchronized: ${id||'<missing>'}/${itemId||'<missing>'}`);
  }
  return {
    ...row,
    canonical:entry.canonical,
    sense_key:entry.sense_key,
    surface:item.en.slice(occurrence.start,occurrence.end),
    meaning_ja:entry.meaning_ja,
    contextual_meaning_ja:occurrence.contextual_meaning_ja,
  };
}

function syncWordAudit(audit,entries,items){
  const entryById=new Map(entries.map(entry=>[String(entry?.id||''),entry]));
  const itemById=new Map(items.map(item=>[String(item?.id||''),item]));
  return {
    ...audit,
    accepted_examples:(audit.accepted_examples||[]).map(row=>syncWordExample(row,entryById,itemById)),
    retained_examples:(audit.retained_examples||[]).map(row=>syncWordExample(row,entryById,itemById)),
  };
}

export function buildSynchronizedDerivedData(){
  const db=read('vocabulary-v3.json');
  const items=read('items.json');
  const characters=read('characters.json').characters||[];
  const migration=read('vocabulary-v2-v3-migration.json');
  const v2=read('vocabulary-v2.json');
  const currentWordAudit=read('vocabulary-v3-word-audit.json');
  const currentParaphraseAudit=read('vocabulary-v3-paraphrase-audit.json');

  const entries=Array.isArray(db?.entries)?db.entries:[];
  const wordAudit=syncWordAudit(currentWordAudit,entries,items);
  const paraphraseAudit=syncParaphraseAudit(currentParaphraseAudit,entries);
  const {errors,report}=validateVocabularyV3(
    db,items,characters,migration,v2,wordAudit,paraphraseAudit,
  );
  if(errors.length) throw new Error(errors.join('\n'));

  return {
    'vocabulary-v3-word-audit.json':wordAudit,
    'vocabulary-v3-paraphrase-audit.json':paraphraseAudit,
    'vocabulary-v3-report.json':report,
  };
}

function main(){
  let derived;
  try{
    derived=buildSynchronizedDerivedData();
  }catch(error){
    console.error(error instanceof Error?error.message:String(error));
    process.exitCode=1;
    return;
  }

  const check=process.argv.includes('--check');
  const stale=[];
  for(const [name,value] of Object.entries(derived)){
    const expected=json(value);
    if(check){
      let actual='';
      try{actual=fs.readFileSync(dataPath(name),'utf8');}catch(_){ }
      if(actual!==expected) stale.push(name);
      continue;
    }
    fs.writeFileSync(dataPath(name),expected);
  }

  if(check&&stale.length){
    console.error(`Derived vocabulary data is stale: ${stale.join(', ')}. Run npm run vocab:sync-derived and commit the result.`);
    process.exitCode=1;
    return;
  }
  console.log(check?'Derived vocabulary data is synchronized.':'Synchronized derived vocabulary data.');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
