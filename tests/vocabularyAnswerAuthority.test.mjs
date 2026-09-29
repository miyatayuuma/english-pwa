import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyVocabularyAnswerSrs,
  answerVariants,
  classifyVocabularyAnswer,
  normalizeVocabularyAnswer,
} from '../scripts/app/vocabularyLearningCore.js';

const data=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8'));
const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const itemById=new Map(items.map(item=>[String(item.id),item]));
const entry=(canonical)=>data.entries.find(value=>value.canonical===canonical);
const source=(entry,itemId)=>{
  const occurrence=entry.occurrences.find(value=>String(value.item_id)===String(itemId));
  const item=itemById.get(String(itemId));
  return {occurrence,item};
};
const classify=(canonical,transcript,activeOccurrence=null)=>classifyVocabularyAnswer({entry:entry(canonical),activeOccurrence,transcript});

test('strict vocabulary normalization accepts typography and punctuation but does not rewrite grammar',()=>{
  assert.equal(normalizeVocabularyAnswer('  “I’m—sure!”  '),'im-sure');
  assert.equal(normalizeVocabularyAnswer('well‑known'),normalizeVocabularyAnswer('well-known'));
  assert.equal(normalizeVocabularyAnswer('Take up.'),'take up');
  assert.notEqual(normalizeVocabularyAnswer("I'm"),normalizeVocabularyAnswer('I am'));
  assert.notEqual(normalizeVocabularyAnswer('faint'),normalizeVocabularyAnswer('fainted'));
});

test('canonical, explicit answer, and active exact source realizations classify as TARGET',()=>{
  assert.equal(classify('take up','take up').type,'target');
  const taking=entry('take up');
  const active={occurrence:{item_id:'E0020',start:0,end:9},item:{en:'Taking up'} };
  assert.deepEqual(classifyVocabularyAnswer({entry:taking,activeOccurrence:active,transcript:'taking up'}),{
    type:'target',matchedText:'Taking up',matchedAuthority:'source',
  });
  const came=entry('come across someone');
  const cameSource=source(came,'E0524');
  assert.equal(cameSource.item.en.slice(cameSource.occurrence.start,cameSource.occurrence.end),'came across Nick');
  assert.equal(classifyVocabularyAnswer({entry:came,activeOccurrence:cameSource,transcript:'came across Nick'}).type,'target');
  const turnOff=entry('turn something off');
  const turnOffSource=source(turnOff,'E0102');
  assert.equal(classifyVocabularyAnswer({entry:turnOff,activeOccurrence:turnOffSource,transcript:'Turn the faucet off'}).type,'target');
  const construction=entry('make someone do something');
  assert.equal(classifyVocabularyAnswer({entry:construction,activeOccurrence:source(construction,'E0130'),transcript:'make her sign'}).type,'target');
  const faint=entry('faint');
  assert.equal(classifyVocabularyAnswer({entry:faint,activeOccurrence:source(faint,'E0125'),transcript:'fainted'}).type,'target');
  assert.equal(classify('be beside oneself','be beside himself').type,'target');
});

test('active source realization is local to the selected occurrence and does not create a wildcard',()=>{
  const value={id:'fixture',kind:'expression',canonical:'take up',answers:[],paraphrases:[],occurrences:[]};
  const active={occurrence:{start:0,end:9},item:{en:'taking up'}};
  assert.equal(classifyVocabularyAnswer({entry:value,activeOccurrence:active,transcript:'taking up'}).type,'target');
  assert.equal(classifyVocabularyAnswer({entry:value,transcript:'took up'}).type,'miss');
  const turnOff={id:'fixture-2',kind:'expression',canonical:'turn something off',answers:[],paraphrases:[]};
  assert.equal(classifyVocabularyAnswer({entry:turnOff,transcript:'turn the faucet off'}).type,'miss');
  assert.equal(classifyVocabularyAnswer({entry:turnOff,transcript:'turn off'}).type,'miss');
});

test('curated paraphrases are recognized distinctly and strict fuzzy collisions remain MISS',()=>{
  const result=classify('come across someone','run into someone');
  assert.deepEqual(result,{type:'paraphrase',matchedText:'run into someone',matchedAuthority:'paraphrase'});
  assert.equal(classify('come across someone','run into Nick').type,'miss');
  assert.equal(classify('despite','despise').type,'miss');
  assert.equal(classify('accurate','awkward').type,'miss');
  assert.equal(classify('take up','take it up').type,'miss');
});

test('same normalized text resolves to TARGET before PARAPHRASE',()=>{
  const value={canonical:'target',answers:['accepted'],paraphrases:['same','accepted']};
  assert.equal(classifyVocabularyAnswer({entry:value,transcript:'accepted'}).matchedAuthority,'answer');
  assert.equal(classifyVocabularyAnswer({entry:value,transcript:'same'}).matchedAuthority,'paraphrase');
});

test('all 1,075 curated source occurrence surfaces classify as TARGET',()=>{
  let audited=0;
  for(const value of data.entries){
    for(const occurrence of value.occurrences){
      const active=source(value,occurrence.item_id);
      const transcript=active.item.en.slice(occurrence.start,occurrence.end);
      const result=classifyVocabularyAnswer({entry:value,activeOccurrence:active,transcript});
      assert.equal(result.type,'target',`${value.id}/${occurrence.item_id}: ${transcript}`);
      audited+=1;
    }
  }
  assert.equal(audited,1075);
});

test('PARAPHRASE leaves fresh and Lv5 SRS state byte-for-byte unchanged',()=>{
  for(const before of [
    {last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0},
    {last:5,best:5,noHintHistory:[10,20],noHintStreak:3,level5Count:8,review:{nextDueAt:999,intervalMs:86400000},stability:8.4,difficulty:2.2},
  ]){
    const state=structuredClone(before);
    let writes=0;
    const result=applyVocabularyAnswerSrs('paraphrase',rate=>{
      writes+=1;
      state.last=rate;
    });
    assert.equal(result.updated,false);
    assert.equal(writes,0);
    assert.deepEqual(state,before);
  }
});

test('TARGET receives perfect lexical credit and MISS remains on the failure path',()=>{
  const rates=[];
  const target=applyVocabularyAnswerSrs('target',rate=>rates.push(rate));
  const miss=applyVocabularyAnswerSrs('miss',rate=>rates.push(rate));
  assert.equal(target.updated,true);
  assert.equal(miss.updated,true);
  assert.deepEqual(rates,[1,0]);
});

test('active occurrence is added to target variants without adding paraphrase forms',()=>{
  const value=entry('come across someone');
  const active=source(value,'E0524');
  assert.ok(answerVariants(value,active).includes('came across Nick'));
  assert.equal(answerVariants(value).includes('came across Nick'),false);
});
