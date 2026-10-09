import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecognitionCandidates, recognitionHypotheses } from '../scripts/speech/recognitionCandidates.js';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';

const segment=(segmentIndex,alternatives,isFinal=true)=>({
  segmentIndex,
  isFinal,
  alternatives:alternatives.map(([transcript,asrRank])=>({transcript,asrRank})),
});

test('Read selects a passing full-sentence rank-two hypothesis after primary failure and preserves primary raw text',()=>{
  const sentence='I hope you will remember this story tonight';
  const primary='completely unrelated words';
  const evidence={
    transcript:primary,
    primaryTranscript:primary,
    recognitionComplete:true,
    completionState:'terminal',
    attemptId:14,
    recognitionSegments:[segment(0,[[primary,0],['unrelated words again',1],[sentence,2]])],
  };
  const order=[];
  const selection=evaluateRecognitionCandidates(evidence,candidate=>{
    order.push(candidate.asrRank);
    const alignment=alignSpeech(sentence,candidate.transcript,{asrRank:candidate.asrRank,attemptId:evidence.attemptId});
    const score=gradeReadSpeech(alignment).score;
    return {alignment,score,accepted:score>=0.7};
  });
  assert.deepEqual(order,[0,1,2]);
  assert.equal(selection.rescued,true);
  assert.equal(selection.selected.candidate.asrRank,2);
  assert.equal(selection.selected.score,1);
  assert.equal(evidence.primaryTranscript,primary);
  assert.equal(selection.selected.candidate.transcript,sentence);
  assert.deepEqual(selection.selected.candidate.segmentIndexes,[0]);
});

test('rank-zero acceptance stops before lower hypotheses are considered',()=>{
  const evidence={transcript:'A short sentence',recognitionComplete:true,recognitionSegments:[segment(0,[['A short sentence',0],['wrong sentence',1]])]};
  const order=[];
  const selection=evaluateRecognitionCandidates(evidence,candidate=>{
    order.push(candidate.asrRank);
    return {accepted:candidate.asrRank===0};
  });
  assert.deepEqual(order,[0]);
  assert.equal(selection.rescued,false);
});

test('an ordered inversion cannot pass Read through a high token-overlap score',()=>{
  const sentence='We should leave now and return tomorrow';
  const reversed='We should now leave and return tomorrow';
  const alignment=alignSpeech(sentence,reversed,{context:{mode:'read'}});
  const grade=gradeReadSpeech(alignment);
  assert.ok(alignment.recall>=0.8,'overlap alone would look deceptively high');
  assert.equal(alignment.orderedMatchIntegrity.valid,false);
  assert.ok(alignment.orderedMatchIntegrity.violations.length>0);
  assert.equal(grade.score,0);
});

test('Read never promotes partial segment alternatives or combines lower ranks into a synthetic sentence',()=>{
  const partialEvidence={
    primaryTranscript:'The primary stream',
    recognitionComplete:true,
    recognitionSegments:[
      segment(0,[['The primary',0],['The lower',1]]),
      segment(1,[['stream',0]]),
    ],
  };
  assert.deepEqual(recognitionHypotheses(partialEvidence).map(candidate=>candidate.asrRank),[0]);

  const oneSegment={...partialEvidence,recognitionSegments:[segment(4,[['The primary stream',0],['The lower rank stream',2]])]};
  assert.deepEqual(recognitionHypotheses(oneSegment).map(candidate=>candidate.asrRank),[0,2]);
  assert.equal(recognitionHypotheses(oneSegment)[1].transcript,'The lower rank stream');
  assert.deepEqual(recognitionHypotheses(oneSegment)[1].segmentIndexes,[4]);
});

test('pending or non-final evidence never becomes an N-best rescue candidate',()=>{
  for(const evidence of [
    {recognitionComplete:false,recognitionSegments:[segment(0,[['wrong',0],['right',1]])]},
    {recognitionComplete:true,recognitionSegments:[segment(0,[['wrong',0],['right',1]],false)]},
  ]){
    assert.deepEqual(recognitionHypotheses(evidence).map(candidate=>candidate.source),['primary']);
  }
});

test('duplicate provider ranks remain ambiguous and are not selected',()=>{
  const evidence={recognitionComplete:true,recognitionSegments:[{
    segmentIndex:2,isFinal:true,
    alternatives:[
      {transcript:'wrong',asrRank:0},
      {transcript:'first rank one',asrRank:1},
      {transcript:'second rank one',asrRank:1},
    ],
  }]};
  assert.deepEqual(recognitionHypotheses(evidence).map(candidate=>candidate.asrRank),[0]);
});
