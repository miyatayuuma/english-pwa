import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOCABULARY_COUNT_CHOICES, normalizeVocabularyCount, vocabularyCountTarget, vocabularyPlanSummary,
  answerVariants,
  buildVocabularySession,
  displayAnswer,
  displayMeaning,
  eligibleVocabularyEntries,
  joinVocabularyData,
  isRetiredVocabularyEntry,
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

test('retired toil word is not offered as a standalone Vocabulary card, while toil away remains',()=>{
  const occurrenceData=[occurrence('E0340',30,34)];
  const toil={...word,id:'vocab:00947',canonical:'toil',occurrences:occurrenceData};
  const toilAway={...expression,id:'vocab:00428',canonical:'toil away',occurrences:[occurrence('E0340',30,53)]};
  const db={entries:[toil,toilAway]};
  assert.equal(isRetiredVocabularyEntry(toil),true);
  assert.equal(isRetiredVocabularyEntry(toilAway),false);
  assert.deepEqual(readyVocabularyEntries(db).map(entry=>entry.id),['vocab:00428']);
  const joined=joinVocabularyData(db,[item('E0340','toil away')]);
  const eligible=eligibleVocabularyEntries(readyVocabularyEntries(joined),{E0340:{updatedAt:1}});
  assert.deepEqual(eligible.map(entry=>entry.id),['vocab:00428']);
  assert.deepEqual(buildVocabularySession(eligible,{}, {size:12}).entries.map(entry=>entry.id),['vocab:00428']);
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

const countEntries=Array.from({length:120},(_,i)=>({...word,id:`count:${i}`,canonical:`card ${i}`,kind:i%3===0?'expression':'word'}));
const countLevels=Object.fromEntries(countEntries.map(entry=>[entry.id,{last:2,updatedAt:1}]));
for(const size of [undefined,5,8,12,20,30,50]) test(`Vocabulary target ${size??'AUTO'} supports a real unique queue`,()=>{
  const plan=buildVocabularySession([...countEntries,countEntries[0]],countLevels,{size,now:1800000000000});
  assert.equal(plan.size,size??12);assert.equal(plan.targetSize,size??12);
  assert.equal(new Set(plan.entries.map(entry=>entry.id)).size,plan.size);
  assert.equal(plan.candidateCount,120);assert.equal(plan.shortfall,0);assert.equal(plan.shortfallReason,'');
});
test('Vocabulary public size API normalizes invalid, fractional and extreme requests safely',()=>{
  for(const [size,expected] of [[NaN,12],[undefined,12],[Infinity,12],[-Infinity,12],[-50,1],[0,12],[5.6,6],[1e10,50],['20',20]]){
    assert.equal(buildVocabularySession(countEntries,countLevels,{size}).targetSize,expected);
  }
});
test('50-card plan preserves due/fresh/learning/stable order and cap at every requested count',()=>{
  const now=1800000000000;
  const levels=Object.fromEntries(countEntries.map((entry,i)=>[entry.id,i<3?{last:2,updatedAt:1,review:{nextDueAt:now-100}}:i<30?{}:i<90?{last:2,updatedAt:1}:{last:5,updatedAt:1}]));
  for(const size of [5,8,12,20,30,50]){
    const plan=buildVocabularySession(countEntries,levels,{size,now,recentItemIds:countEntries.slice(0,3).map(x=>x.id)});
    assert.equal(plan.size,size);assert.equal(plan.due,3);assert.equal(plan.fresh,Math.min(8,size-3));
    assert.ok(plan.entries.slice(0,3).every(entry=>levels[entry.id].review?.nextDueAt<now));
    assert.equal(plan.newCap,Math.min(8,size));
  }
  assert.equal(buildVocabularySession(countEntries,{}, {size:5,now}).fresh,5);
  assert.equal(buildVocabularySession(countEntries,{}, {size:50,now}).size,8);
});
test('shortfall differentiates candidate scarcity, fresh cap, both, and zero without guessed reasons',()=>{
  const cap=buildVocabularySession(countEntries.slice(0,50),{}, {size:50});
  assert.deepEqual([cap.size,cap.candidateCount,cap.shortfall,cap.candidateShortfall,cap.freshCapShortfall],[8,50,42,0,42]);
  assert.match(cap.shortfallReason,/新しいカードは1回8枚まで/);
  const scarce=buildVocabularySession(countEntries.slice(0,49),countLevels,{size:50});
  assert.deepEqual([scarce.size,scarce.shortfall,scarce.candidateShortfall,scarce.freshCapShortfall],[49,1,1,0]);
  assert.doesNotMatch(scarce.shortfallReason,/新しいカード/);
  const both=buildVocabularySession(countEntries.slice(0,10),{}, {size:50});
  assert.deepEqual([both.size,both.shortfall,both.candidateShortfall,both.freshCapShortfall],[8,42,40,2]);
  const zero=buildVocabularySession([],{}, {size:50});
  assert.deepEqual([zero.size,zero.shortfall,zero.candidateCount,zero.freshCapShortfall],[0,50,0,0]);
});
test('50 recent IDs defer non-due cards within their bucket, retain due priority and never exclude fallback',()=>{
  const now=1800000000000;
  const first=buildVocabularySession(countEntries,countLevels,{size:50,now,rotationSeed:1});
  const recentItemIds=first.entries.map(x=>x.id);
  const second=buildVocabularySession(countEntries,countLevels,{size:50,now,rotationSeed:2,recentItemIds});
  assert.equal(second.entries.filter(entry=>recentItemIds.includes(entry.id)).length,0);
  assert.equal(second.recentExcluded,50);
  assert.deepEqual(buildVocabularySession(countEntries,countLevels,{size:50,now,rotationSeed:2,recentItemIds}),second);
  assert.notDeepEqual(first.entries.map(x=>x.id),buildVocabularySession(countEntries,countLevels,{size:50,now,rotationSeed:3}).entries.map(x=>x.id));
  const dueId=recentItemIds[0];
  const due=buildVocabularySession(countEntries,{...countLevels,[dueId]:{last:2,updatedAt:1,review:{nextDueAt:now-1}}},{size:50,now,recentItemIds});
  assert.equal(due.entries[0].id,dueId);
  assert.equal(buildVocabularySession(first.entries,countLevels,{size:50,now,recentItemIds}).size,50);
  for(const kind of ['word','expression']){
    const plan=buildVocabularySession(countEntries,countLevels,{size:50,kind,now});
    assert.ok(plan.entries.every(x=>x.kind===kind));assert.equal(plan.candidateCount,kind==='word'?80:40);
  }
});

 test('Vocabulary count enum defaults and normalization remain independent of sentence options',()=>{
  assert.deepEqual(VOCABULARY_COUNT_CHOICES,['auto','5','8','12','20','30','50']);
  for(const count of VOCABULARY_COUNT_CHOICES){assert.equal(normalizeVocabularyCount(count),count);assert.equal(vocabularyCountTarget(count),count==='auto'?12:Number(count));}
  for(const count of [undefined,NaN,Infinity,-1,7,5.2,'custom','AUTO']){assert.equal(normalizeVocabularyCount(count),'auto');}
  assert.match(vocabularyPlanSummary(buildVocabularySession([],{}, {size:12})),/指定 おまかせ（12枚）.*実際 0枚.*不足 12枚/);
 });
