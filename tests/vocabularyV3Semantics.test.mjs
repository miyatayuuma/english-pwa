import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const db=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8'));
const itemById=new Map(items.map(item=>[item.id,item]));
const entry=(canonical,senseKey)=>db.entries.find(value=>value.canonical===canonical&&value.sense_key===senseKey);
function surface(value){const occurrence=value.occurrences[0],item=itemById.get(occurrence.item_id);return item.en.slice(occurrence.start,occurrence.end);}

test('known wrong-sense regressions stay pinned to their source expressions and intended meanings',()=>{
  const fixtures=[
    ['take up','occupy_space_or_time','E0020','taking up',/占める/,/再開する/],
    ['turn something off','stop_a_device_or_flow','E0102','Turn the faucet off',/止める|切る/,/解雇する/],
    ['come across someone','meet_by_chance','E0524','came across Nick',/偶然|見かける/,/印象を与える/],
    ['make someone do something','causative_make','E0130','make her sign',/someoneにsomethingさせる/,/成功/],
    ["I'm beside myself",'extremely_upset','E0010','beside himself',/取り乱/,/比較/],
    ['sound asleep','sleeping_deeply','E0523','sound asleep',/ぐっすり|熟睡/,/音/],
    ['twist your ankle','sprain_an_ankle','E0190','twisted his ankle',/捻挫/,/ツイスト/],
    ['assume','take_as_true','E0227','assume',/考える|仮定/,/自分のもの|奪い/],
    ['job interview','employment_interview','E0366','job interview',/就職面接/,/面会/],
    ['turn someone down','reject_a_person_or_offer','E0178','turned me down',/断る/,/弱める/],
    ['put something on','put_on_clothing','E0189','put my gloves on',/身につける/,/飢え/],
    ['be starved','very_hungry','E0560','starved',/お腹.*ぺこぺこ/,/飢えさせる/],
    ['so tired that I fell asleep','so_degree_that_result','E0371','so childish that',/疲れすぎて眠ってしまった/,/目的|子供っぽい/],
    ['come out','be_published','E0012','come out',/刊行|発売/,/結果が出る/],
  ];
  for(const [canonical,sense,itemId,expectedSurface,meaning,forbidden] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    assert.equal(value.occurrences[0].item_id,itemId);
    assert.equal(surface(value),expectedSurface);
    assert.match(value.meaning_ja,meaning);
    assert.doesNotMatch(value.meaning_ja,forbidden);
  }
});

test('retained lexical occurrences are represented once per sense with exact source offsets',()=>{
  const seen=new Set();
  for(const value of db.entries){
    for(const occurrence of value.occurrences){
      const item=itemById.get(occurrence.item_id);
      assert.ok(item,`${value.id} source exists`);
      const actual=item.en.slice(occurrence.start,occurrence.end);
      assert.ok(/[A-Za-z]/.test(actual),`${value.id} target contains English text`);
      assert.equal(actual.trim(),actual,`${value.id} target has no surrounding whitespace`);
      const key=`${value.canonical}:${value.sense_key}:${occurrence.item_id}:${occurrence.start}:${occurrence.end}`;
      assert.equal(seen.has(key),false,`${key} has no duplicate`);
      seen.add(key);
    }
  }
});

test('E0483 source keeps the repaired cost wording',()=>{
  const item=items.find(value=>value.id==='E0483');
  assert.equal(item?.en,'The millionaire insisted on acquiring the masterpiece no matter how much it cost.');
});

test('representative canonical answer surfaces are speakable and do not expose meta-slot notation',()=>{
  const metaSlots=db.entries.filter(value=>String(value.canonical||'').includes('+')).map(value=>`${value.id}: ${value.canonical}`);
  assert.deepEqual(metaSlots,[]);
  const slashDelimited=db.entries.filter(value=>[value.canonical,...(Array.isArray(value.answers)?value.answers:[])].some(text=>String(text||'').includes('/'))).map(value=>`${value.id}: ${value.canonical}`);
  assert.deepEqual(slashDelimited,[]);
});

test('refined vocabulary surfaces exclude over-abstracted possessive, alternative, and incomplete construction targets',()=>{
  assert.deepEqual(db.entries.filter(value=>/\bone's\b|\boneself\b/i.test(String(value.canonical||''))).map(value=>value.id),[]);
  assert.deepEqual(db.entries.filter(value=>/\bsomeone or something\b|\bsomething or someone\b/i.test(String(value.canonical||''))).map(value=>value.id),[]);
  assert.deepEqual(db.entries.filter(value=>value.kind==='construction'&&/\b(?:that|if|before|to)\s*$/i.test(String(value.canonical||''))).map(value=>value.id),[]);
});


test('spoken placeholder targets are mirrored literally in the Japanese prompt',()=>{
  const lexicalSomething=new Set(['vocab:01377']);
  for(const value of db.entries){
    if(value.kind==='word'||lexicalSomething.has(value.id)) continue;
    const canonical=String(value.canonical||'');
    const prompt=String(value.meaning_ja||'');
    if(/\bsomeone\b/i.test(canonical)) assert.match(prompt,/someone/i,`${value.id} exposes someone in meaning_ja`);
    if(/\bsomething\b/i.test(canonical)) assert.match(prompt,/something/i,`${value.id} exposes something in meaning_ja`);
    if(/\bsomething else\b/i.test(canonical)) assert.match(prompt,/something else/i,`${value.id} exposes something else in meaning_ja`);
  }
  const fixtures=[
    ['vocab:00040','remind someone of something','someoneにsomethingを思い出させる'],
    ['vocab:00503','associate something with something else','somethingをsomething elseと結び付ける'],
    ['vocab:00323','keep up with something','somethingについていく'],
  ];
  for(const [id,canonical,meaning] of fixtures){
    const value=db.entries.find(entry=>entry.id===id);
    assert.equal(value?.canonical,canonical);
    assert.equal(value?.meaning_ja,meaning);
  }
});

test('learning-surface human review batch 01 pins corrected reusable targets',()=>{
  const byId=new Map(db.entries.map(value=>[value.id,value]));
  assert.equal(byId.get('vocab:00151')?.canonical,'tell someone and someone else apart');
  assert.equal(byId.get('vocab:00151')?.meaning_ja,'someoneとsomeone elseを見分ける');
  assert.equal(byId.get('vocab:00047')?.meaning_ja,'someoneにsomethingするよう懇願する');
  assert.equal(byId.get('vocab:00119')?.meaning_ja,'someoneがsomethingすると期待する');
});
