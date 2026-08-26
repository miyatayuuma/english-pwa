import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerVariants,
  buildVocabularySession,
  displayAnswer,
  readyVocabularyEntries,
  vocabularyStats,
} from '../scripts/app/vocabularyLearningCore.js';

test('ready vocabulary keeps only cards with a meaning and reliable example match',()=>{
  const db={entries:[
    {id:'a',headword:'respect',meaning_ja:'尊重する',match_confidence:'high'},
    {id:'b',headword:'missing',meaning_ja:null,match_confidence:'high'},
    {id:'c',headword:'uncertain',meaning_ja:'不確か',match_confidence:'low'},
  ]};
  assert.deepEqual(readyVocabularyEntries(db).map(x=>x.id),['a']);
});

test('session prioritizes due cards, then unseen cards, without early-reviewing studied cards',()=>{
  const now=1_800_000_000_000;
  const entries=[
    {id:'due',kind:'word'},
    {id:'fresh',kind:'phrase'},
    {id:'early',kind:'word'},
  ];
  const levels={
    due:{last:2,updatedAt:now-1000,review:{nextDueAt:now-100}},
    early:{last:2,updatedAt:now-1000,review:{nextDueAt:now+86_400_000}},
  };
  const plan=buildVocabularySession(entries,levels,{now,size:2});
  assert.equal(plan.entries[0].id,'due');
  assert.equal(plan.entries[1].id,'fresh');
  assert.equal(plan.early,0);
});

test('a new-only vocabulary session stays small enough for acquisition',()=>{
  const entries=Array.from({length:20},(_,i)=>({id:`n${i}`,kind:'word'}));
  const plan=buildVocabularySession(entries,{}, {size:12,now:1_800_000_000_000});
  assert.equal(plan.size,8);
  assert.equal(plan.fresh,8);
});

test('kind filter builds a word-only or phrase-only queue',()=>{
  const entries=[{id:'w',kind:'word'},{id:'p',kind:'phrase'}];
  const plan=buildVocabularySession(entries,{}, {kind:'phrase',size:12,now:1_800_000_000_000});
  assert.deepEqual(plan.entries.map(x=>x.id),['p']);
});

test('answer variants turn dictionary notation into speakable alternatives',()=>{
  const variants=answerVariants({headword:"shake one's head"});
  assert.ok(variants.includes('shake my head'));
  assert.ok(variants.includes('shake your head'));
  assert.equal(displayAnswer({headword:'geographic(al)'}),'geographic');
  assert.ok(answerVariants({headword:'geographic(al)'}).includes('geographical'));
  assert.ok(answerVariants({headword:'shrink-shrank-shrunk'}).includes('shrink'));
});

test('vocabulary stats distinguish due, new, learning, and stable cards',()=>{
  const now=1_800_000_000_000;
  const entries=[
    {id:'d',kind:'word'},{id:'n',kind:'word'},{id:'l',kind:'phrase'},{id:'s',kind:'phrase'}
  ];
  const levels={
    d:{last:2,updatedAt:now-100,review:{nextDueAt:now-1}},
    l:{last:2,updatedAt:now-100,review:{nextDueAt:now+1000}},
    s:{last:4,updatedAt:now-100,review:{nextDueAt:now+1000}},
  };
  const stats=vocabularyStats(entries,levels,now);
  assert.equal(stats.due,1);
  assert.equal(stats.fresh,1);
  assert.equal(stats.learning,2);
  assert.equal(stats.stable,1);
  assert.equal(stats.words,2);
  assert.equal(stats.phrases,2);
});
