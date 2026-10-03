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
    ['make someone do something','causative_make','E0130','make her sign',/人に.*させる/,/成功/],
    ['be beside oneself','extremely_upset','E0010','beside himself',/取り乱/,/比較/],
    ['sound asleep','sleeping_deeply','E0523','sound asleep',/ぐっすり|熟睡/,/音/],
    ["twist one's ankle",'sprain_an_ankle','E0190','twisted his ankle',/捻挫/,/ツイスト/],
    ['assume','take_as_true','E0227','assume',/考える|仮定/,/自分のもの|奪い/],
    ['job interview','employment_interview','E0366','job interview',/就職面接/,/面会/],
    ['turn someone down','reject_a_person_or_offer','E0178','turned me down',/断る/,/弱める/],
    ['put something on','put_on_clothing','E0189','put my gloves on',/身につける/,/飢え/],
    ['be starved','very_hungry','E0560','starved',/お腹.*ぺこぺこ/,/飢えさせる/],
    ['so + adjective or adverb + that + clause','so_degree_that_result','E0371','so childish that',/あまりに.*なので/,/目的|子供っぽい/],
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

test('representative canonical answer surfaces exclude simple trailing meta slots and slash-delimited alternatives',()=>{
  const simpleTrailingMeta=/^[^+]+\+\s*(?:(?:interrogative\s+)?clause(?:\s*\(past tense\))?|time)$/i;
  const trailing=db.entries.filter(value=>simpleTrailingMeta.test(String(value.canonical||''))).map(value=>`${value.id}: ${value.canonical}`);
  assert.deepEqual(trailing,[]);
  const slashDelimited=db.entries.filter(value=>[value.canonical,...(Array.isArray(value.answers)?value.answers:[])].some(text=>String(text||'').includes('/'))).map(value=>`${value.id}: ${value.canonical}`);
  assert.deepEqual(slashDelimited,[]);
});
