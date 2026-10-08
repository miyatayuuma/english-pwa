import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRecognitionEvidence, nativeWebResultEvent } from '../scripts/native/recognitionEvidence.js';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';

test('native final-only mapping preserves rank zero, caps at twenty, and optional confidence', () => {
  const event = { type: 'final', alternatives: [
    { transcript: 'YouTube', confidence: 0.7 },
    { transcript: 'yield to something', confidence: null },
    { transcript: 'third' }, { transcript: 'fourth', confidence: NaN },
    { transcript: 'fifth', confidence: 0 }, { transcript: 'sixth' },
  ] };
  const evidence = nativeRecognitionEvidence(event);
  assert.equal(evidence.transcript, 'YouTube');
  assert.equal(evidence.previewTranscript, 'YouTube');
  const segment = evidence.recognitionSegments[0];
  assert.equal(segment.isFinal, true);
  assert.deepEqual(segment.alternatives.map(c => c.asrRank), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(segment.alternatives.map(c => c.confidence), [0.7, null, null, null, 0, null]);
  assert.equal(nativeWebResultEvent(event).results[0][0].transcript, 'YouTube');
});
test('partial absence is normal and empty/partial callbacks retain schema compatibility', () => {
  assert.equal(nativeRecognitionEvidence({ type: 'partial', alternatives: [{ transcript: 'I' }] }).recognitionSegments[0].isFinal, false);
  assert.equal(nativeRecognitionEvidence({ type: 'final' }).transcript, '');
  assert.deepEqual(nativeRecognitionEvidence({ type: 'final' }).recognitionSegments[0].alternatives, []);
});
test('mapped native candidates preserve existing strict TARGET rescue and exclude lower paraphrases', () => {
  const entry = { canonical: 'yield to something', paraphrases: ['give in to something'] };
  const grade = alternatives => classifyVocabularySpeechAnswer({ entry, ...nativeRecognitionEvidence({ type: 'final', alternatives: alternatives.map(transcript => ({ transcript })) }) });
  const rescued = grade(['YouTube', 'yield to something']);
  assert.equal(rescued.type, 'target');
  assert.equal(rescued.asrRank, 1);
  assert.equal(rescued.primaryTranscript, 'YouTube');
  assert.equal(grade(['YouTube', 'give in to something']).type, 'miss');
  for (const text of ['yield', 'yield from something', 'something to yield', 'I like cats']) assert.equal(grade([text]).type, 'miss');
});

test('native provider chunks reach the same curated Vocabulary rescue authority',()=>{
  const primary='no sooner had I arrived down the phone rang';
  const evidence=nativeRecognitionEvidence({type:'final',alternatives:[
    {transcript:primary},
    {transcript:'unrelated'},
    {transcript:'than the phone rang'},
  ]});
  const grade=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00139',canonical:'no sooner had I arrived than the phone rang'},
    ...evidence,
  });
  assert.equal(grade.type,'target');
  assert.equal(grade.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(grade.asrRank,2);
  assert.equal(grade.primaryTranscript,primary);
  assert.equal(evidence.transcript,primary);
  assert.equal(evidence.recognitionSegments[0].alternatives.length,3);
});

for (const rank of [1, 6, 12, 20]) test(`strict TARGET at provider rank ${rank}`, () => {
  const alternatives = Array.from({length:20}, (_,i)=>({transcript:i===rank-1?'yell':'yeah',asrRank:i,confidence:0.2}));
  const evidence = nativeRecognitionEvidence({type:'final', alternatives, providerReturnedCount:20});
  const grade = classifyVocabularySpeechAnswer({entry:{canonical:'yell'},...evidence});
  assert.equal(grade.type,'target');
  assert.equal(grade.targetRescued,rank!==1);
  if(rank!==1) assert.equal(grade.asrRank,rank-1);
});
test('native range and original provider ranks are preserved with shortfall and overflow',()=>{
  for(const count of [1,7,20,25]){
    const alternatives=Array.from({length:count},(_,i)=>({transcript:'candidate '+i,asrRank:i+3,confidence:0.1}));
    const segment=nativeRecognitionEvidence({type:'final',alternatives,providerReturnedCount:count}).recognitionSegments[0];
    assert.equal(segment.alternatives.length,Math.min(20,count));
    assert.equal(segment.providerReturnedCount,count);
    assert.equal(segment.alternatives.at(-1).asrRank,Math.min(20,count)+2);
  }
});
test('deep lower paraphrase and phonetic/fuzzy near misses do not rescue',()=>{
  for(const candidate of ['shout','yeah','yel','eared','years to something']){
    const alternatives=Array.from({length:20},(_,i)=>({transcript:i===19?candidate:'wrong',asrRank:i}));
    assert.equal(classifyVocabularySpeechAnswer({entry:{canonical:'yell',paraphrases:['shout']},...nativeRecognitionEvidence({type:'final',alternatives})}).type,'miss');
  }
});
