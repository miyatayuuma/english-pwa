import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerVariants,
  buildVocabularySession,
  displayAnswer,
  displayMeaning,
  eligibleVocabularyEntries,
  joinVocabularyData,
  readyVocabularyEntries,
  vocabularyStats,
} from '../scripts/app/vocabularyLearningCore.js';

const item=(id,en)=>({id,en,ja:`${id}訳`,unit:'Section1',audio_fn:`${id}.m4a`,speaker_tags:[{id:'alice'}]});
const occurrence=(item_id,start,end,contextual_meaning_ja='自然な訳')=>({item_id,start,end,contextual_meaning_ja});
const word={id:'vocab:00001',kind:'word',canonical:'respect',sense_key:'treat_as_valuable',pos:'verb',meaning_ja:'尊重する',occurrences:[occurrence('E1',0,7)]};
const expression={id:'vocab:00002',kind:'expression',subtype:'phrasal_verb',canonical:'take up',sense_key:'occupy_space',pos:'verb',meaning_ja:'場所を占める',occurrences:[occurrence('E1',8,15)]};
const construction={id:'vocab:00003',kind:'construction',canonical:'make someone do something',sense_key:'causative_make',pos:'verb',meaning_ja:'人に〜させる',occurrences:[occurrence('E1',16,21)]};

test('v3 ready entries require a supported kind, canonical sense, meaning, and occurrence',()=>{
  const db={entries:[word,expression,construction,{id:'bad',headword:'legacy',meaning_ja:'古い形式'}]};
  assert.deepEqual(readyVocabularyEntries(db).map(entry=>entry.id),[word.id,expression.id,construction.id]);
});

test('new vocabulary stays locked until a source item has recorded progress',()=>{
  const items=[item('E1','respect'),item('E2','take up')];
  const joined=joinVocabularyData({entries:[{...word,occurrences:[occurrence('E1',0,7),occurrence('E2',0,7)]}]},items,[{id:'alice',name:'Alice'}]);
  assert.equal(eligibleVocabularyEntries(joined,{}).length,0);
  assert.equal(eligibleVocabularyEntries(joined,{E1:{updatedAt:100}}).length,1);
  assert.equal(eligibleVocabularyEntries(joined,{E2:{last:1}}).length,1);
  assert.equal(eligibleVocabularyEntries(joined,{E2:{best:1}}).length,1);
});

test('most recently studied occurrence becomes the context, with dataset order breaking ties',()=>{
  const items=[item('E1','respect'),item('E2','respect'),item('E3','respect')];
  const joined=joinVocabularyData({entries:[{...word,occurrences:[occurrence('E1',0,7),occurrence('E2',0,7),occurrence('E3',0,7)]}]},items,[{id:'alice',name:'Alice'}]);
  const eligible=eligibleVocabularyEntries(joined,{
    E1:{updatedAt:500},E2:{updatedAt:900},E3:{updatedAt:900},
  });
  assert.equal(eligible[0].activeOccurrence.item.id,'E2');
});

test('a safely migrated vocabulary card may use its first occurrence when sentence history is absent',()=>{
  const joined=joinVocabularyData({entries:[{...word,occurrences:[occurrence('E1',0,7),occurrence('E2',0,7)]}]},[item('E1','respect'),item('E2','respect')],[{id:'alice',name:'Alice'}]);
  const eligible=eligibleVocabularyEntries(joined,{[word.id]:{last:2,_vocabularyV3LegacySourceFallback:true}});
  assert.equal(eligible[0].activeOccurrence.item.id,'E1');
});

test('vocabulary session preserves due priority, fresh cap, and kind filters',()=>{
  const now=1_800_000_000_000;
  const entries=[{...word},{...expression},{...construction}];
  const levels={
    [word.id]:{last:2,updatedAt:now-100,review:{nextDueAt:now-1}},
    [expression.id]:{last:2,updatedAt:now-100,review:{nextDueAt:now+100_000}},
  };
  const plan=buildVocabularySession(entries,levels,{now,size:2});
  assert.equal(plan.entries[0].id,word.id);
  assert.equal(plan.entries[1].id,construction.id);
  assert.deepEqual(buildVocabularySession(entries,{}, {kind:'word',size:12,now}).entries.map(x=>x.id),[word.id]);
  assert.deepEqual(new Set(buildVocabularySession(entries,{}, {kind:'expression',size:12,now}).entries.map(x=>x.id)),new Set([expression.id,construction.id]));
});

test('fresh cap and recent-session rotation apply only to eligible entries',()=>{
  const now=1_800_000_000_000;
  const entries=Array.from({length:20},(_,i)=>({...word,id:`vocab:${String(i+1).padStart(5,'0')}`}));
  const first=buildVocabularySession(entries,{}, {size:6,newCap:6,now,rotationSeed:1});
  const second=buildVocabularySession(entries,{}, {size:6,newCap:6,now,rotationSeed:2,recentItemIds:first.entries.map(x=>x.id)});
  assert.equal(first.size,6);
  assert.equal(second.entries.filter(x=>first.entries.some(y=>y.id===x.id)).length,0);
  assert.equal(second.recentExcluded,first.size);
  assert.equal(buildVocabularySession(entries,{}, {size:12,now}).fresh,8);
});

test('only curated canonical and explicit answer variants are accepted',()=>{
  const entry={canonical:'take up',answers:['take something up','take up']};
  assert.deepEqual(answerVariants(entry),['take up','take something up']);
  assert.equal(displayAnswer({canonical:'make someone do something'}),'make someone do something');
  assert.deepEqual(answerVariants({headword:'take up ~ / A'}),[]);
});

test('Japanese representative meaning normalization preserves its selected sense',()=>{
  assert.equal(displayMeaning({meaning_ja:'  場所を占める ​ 、 ときには時間も取る  '}),'場所を占める、ときには時間も取る');
});

test('lobby statistics describe only the supplied eligible pool',()=>{
  const now=1_800_000_000_000;
  const levels={
    [word.id]:{last:2,updatedAt:now-100,review:{nextDueAt:now-1}},
    [expression.id]:{last:4,updatedAt:now-100,review:{nextDueAt:now+1000}},
  };
  const stats=vocabularyStats([word,expression],levels,now);
  assert.deepEqual({total:stats.total,due:stats.due,fresh:stats.fresh,stable:stats.stable,words:stats.words,expressions:stats.expressions},{total:2,due:1,fresh:0,stable:1,words:1,expressions:1});
});

test('runtime joins source fields and speaker metadata instead of duplicating them in v3 entries',()=>{
  const source=item('E1','respect');
  const joined=joinVocabularyData({entries:[word]},[source],[{id:'alice',name:'Alice'}])[0];
  assert.equal(joined.activeOccurrence,undefined);
  const eligible=eligibleVocabularyEntries([joined],{E1:{updatedAt:1}})[0];
  assert.equal(eligible.activeOccurrence.item.ja,'E1訳');
  assert.equal(eligible.activeOccurrence.item.audio_fn,'E1.m4a');
  assert.equal(eligible.activeOccurrence.sourceSpeaker.profile.name,'Alice');
  assert.equal(Object.hasOwn(word,'en'),false);
  assert.equal(Object.hasOwn(word.occurrences[0],'speaker_id'),false);
});
