import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));

const EXPECTED_SOURCE_REPAIRS={
  E0063:{ja:'「ほかにご注文は？」「以上です。」「こちらでお召し上がりですか？」「持ち帰ります。」'},
  E0068:{ja:'「これは僕のおごり。」 「だめよ。外食のときはいつもおごってもらっているし。」 「うーん、わかった。じゃあ割り勘にしよう。」'},
  E0070:{ja:'現金が足りなかったので、先週口座に入れた100ドルを引き出した。'},
  E0120:{ja:'概して、双子には似たところが多い。'},
  E0124:{ja:'「ボブ、この自動販売機、故障してるわ。」「何だって！喉が渇いて死にそうだよ！」'},
  E0203:{en:"I can't put you up. For one thing, my dad drops in on me from time to time."},
  E0414:{ja:'著者は何度も何度も原稿を手直しした。'},
  E0446:{en:'The immigrants have endured physical and mental pain.'},
  E0462:{ja:'男は情状酌量を求めたが、犯した罪に対して20年の懲役刑が言い渡された。'},
  E0464:{ja:'彼はその家に押し入ろうとしている泥棒を目にした。'},
  E0480:{en:'This magnificent cathedral dates back to the Middle Ages.'},
  E0483:{en:'The millionaire insisted on acquiring the masterpiece no matter how much it cost.'},
};

const FORBIDDEN_SOURCE_FRAGMENTS=[
  ['en','Meddle Ages'],
  ['en','have endure physical and mental pain'],
  ['en','no matter how it cost'],
  ['en','my dad drop in on me'],
  ['ja','おごってもらっていいる'],
  ['ja','慨して、双子'],
  ['ja','喉が乾いて死にそう'],
  ['ja','何度も何度も現稿'],
  ['ja','情報酌量'],
  ['ja','押入ろうとしている'],
];

const REPAIRED_OCCURRENCE_SURFACES=[
  ['vocab:00256','E0203','put you up'],
  ['vocab:00257','E0203','For one thing'],
  ['vocab:00258','E0203','drops in on me'],
  ['vocab:00581','E0480','dates back to the Middle Ages'],
  ['vocab:01027','E0480','magnificent'],
];

export function validateSourceSentenceIntegrity(items,db){
  const errors=[];
  const list=Array.isArray(items)?items:[];
  const entries=Array.isArray(db?.entries)?db.entries:[];
  const byId=new Map(list.map(item=>[String(item?.id||''),item]));
  const entryById=new Map(entries.map(entry=>[String(entry?.id||''),entry]));
  const counters={
    out_of_range:0,
    empty_span:0,
    broken_target_surface:0,
    stale_offsets_after_source_repair:0,
  };

  if(list.length!==560) errors.push(`source item count must be 560, got ${list.length}`);
  const seenIds=new Set();
  for(let index=0;index<list.length;index+=1){
    const item=list[index]||{};
    const expectedId=`E${String(index+1).padStart(4,'0')}`;
    if(item.id!==expectedId) errors.push(`source item sequence mismatch at index ${index}: expected ${expectedId}, got ${item.id||'<missing>'}`);
    if(seenIds.has(item.id)) errors.push(`duplicate source item id ${item.id}`);
    seenIds.add(item.id);
    if(!String(item.en||'').trim()) errors.push(`${item.id}: empty English source`);
    if(!String(item.ja||'').trim()) errors.push(`${item.id}: empty Japanese source`);
    for(const [field,fragment] of FORBIDDEN_SOURCE_FRAGMENTS){
      if(String(item[field]||'').includes(fragment)) errors.push(`${item.id}: stale malformed source fragment ${fragment}`);
    }
  }

  for(const [itemId,expected] of Object.entries(EXPECTED_SOURCE_REPAIRS)){
    const item=byId.get(itemId);
    if(!item){errors.push(`${itemId}: repaired source item missing`);continue;}
    for(const [field,value] of Object.entries(expected)){
      if(item[field]!==value) errors.push(`${itemId}: repaired ${field} source drifted`);
    }
  }

  let occurrenceCount=0;
  for(const entry of entries){
    for(const occurrence of Array.isArray(entry?.occurrences)?entry.occurrences:[]){
      occurrenceCount+=1;
      const item=byId.get(String(occurrence?.item_id||''));
      if(!item){counters.out_of_range+=1;errors.push(`${entry.id}/${occurrence?.item_id||'<missing>'}: source item missing`);continue;}
      const start=occurrence?.start,end=occurrence?.end,text=String(item.en||'');
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length){
        counters.out_of_range+=1;
        errors.push(`${entry.id}/${item.id}: out-of-range occurrence span`);
        continue;
      }
      const surface=text.slice(start,end);
      if(!surface){
        counters.empty_span+=1;
        errors.push(`${entry.id}/${item.id}: empty occurrence span`);
        continue;
      }
      if(!/[A-Za-z]/.test(surface)||!/^[A-Za-z]/.test(surface)||!/[A-Za-z]$/.test(surface)){
        counters.broken_target_surface+=1;
        errors.push(`${entry.id}/${item.id}: broken occurrence target surface ${JSON.stringify(surface)}`);
      }
    }
  }

  for(const [entryId,itemId,expectedSurface] of REPAIRED_OCCURRENCE_SURFACES){
    const entry=entryById.get(entryId),item=byId.get(itemId);
    const occurrence=entry?.occurrences?.find(value=>String(value?.item_id)===itemId);
    const actual=occurrence&&item?item.en.slice(occurrence.start,occurrence.end):'';
    if(actual!==expectedSurface){
      counters.stale_offsets_after_source_repair+=1;
      errors.push(`${entryId}/${itemId}: expected repaired surface ${JSON.stringify(expectedSurface)}, got ${JSON.stringify(actual)}`);
    }
  }

  return {
    errors,
    report:{
      reviewed_sources:list.length,
      occurrence_count:occurrenceCount,
      repaired_source_items:Object.keys(EXPECTED_SOURCE_REPAIRS).length,
      repaired_occurrences_checked:REPAIRED_OCCURRENCE_SURFACES.length,
      ...counters,
    },
  };
}

function main(){
  const items=read('items.json'),db=read('vocabulary-v3.json');
  const {errors,report}=validateSourceSentenceIntegrity(items,db);
  if(errors.length){
    console.error(errors.join('\n'));
    process.exitCode=1;
    return;
  }
  console.log(JSON.stringify(report,null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
