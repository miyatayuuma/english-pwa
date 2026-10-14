import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProductionRecognitionEvidence, evaluateRecognitionCandidates, isRecognitionEvidenceComplete, recognitionHypotheses } from '../scripts/speech/recognitionCandidates.js';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';

const segment=(segmentIndex,alternatives,isFinal=true)=>({
  segmentIndex,
  primaryTranscript:alternatives.find(([,rank])=>rank===0)?.[0]??'',
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

test('incomplete evidence never promotes even rank-zero primary text',()=>{
  for(const evidence of [
    {recognitionComplete:false,recognitionSegments:[segment(0,[['wrong',0],['right',1]])]},
    {recognitionComplete:true,recognitionSegments:[segment(0,[['wrong',0],['right',1]],false)]},
  ]){
    const calls=[];
    assert.deepEqual(recognitionHypotheses(evidence),[]);
    const selection=evaluateRecognitionCandidates(evidence,candidate=>{calls.push(candidate);return {accepted:true};});
    assert.equal(selection.selected,null);
    assert.deepEqual(calls,[]);
  }
});

test('duplicate provider ranks remain ambiguous and are not selected',()=>{
  const evidence={transcript:'wrong',recognitionComplete:true,completionState:'terminal',recognitionSegments:[{
    segmentIndex:2,isFinal:true,
    primaryTranscript:'wrong',
    alternatives:[
      {transcript:'wrong',asrRank:0},
      {transcript:'first rank one',asrRank:1},
      {transcript:'second rank one',asrRank:1},
    ],
  }]};
  assert.deepEqual(recognitionHypotheses(evidence).map(candidate=>candidate.asrRank),[0]);
});

test('Issue 342 finality matrix admits only a normally completed all-final transcript',()=>{
  const exact='The primary stream';
  const final=segment(0,[[exact,0],['The rank two stream',2]],true);
  const interim=segment(0,[[exact,0],['The rank two stream',2]],false);
  const cases=[
    ['terminal and all final', {primaryTranscript:exact,completionState:'terminal',recognitionComplete:true,recognitionSegments:[final]}, true],
    ['terminal and interim-only', {primaryTranscript:exact,completionState:'terminal',recognitionComplete:false,recognitionSegments:[interim]}, false],
    ['terminal and mixed final/interim', {primaryTranscript:exact,completionState:'terminal',recognitionComplete:false,recognitionSegments:[segment(0,[['The primary',0]],true),segment(1,[['stream',0]],false)]}, false],
    ['terminal without segments', {primaryTranscript:exact,completionState:'terminal',recognitionComplete:true,recognitionSegments:[]}, false],
    ['pending interim-only', {primaryTranscript:exact,completionState:'pending',recognitionComplete:false,recognitionSegments:[interim]}, false],
    ['error with exact transcript', {primaryTranscript:exact,completionState:'error',recognitionComplete:false,recognitionSegments:[final]}, false],
    ['cancelled with exact transcript', {primaryTranscript:exact,completionState:'cancelled',recognitionComplete:false,recognitionSegments:[final]}, false],
    ['final segments but unfinished attempt', {primaryTranscript:exact,completionState:'pending',recognitionComplete:false,recognitionSegments:[final]}, false],
    ['terminal flag cannot override isFinal false', {primaryTranscript:exact,completionState:'terminal',recognitionComplete:true,recognitionSegments:[interim]}, false],
    ['final segments with mismatched primary', {primaryTranscript:'exact target answer',completionState:'terminal',recognitionComplete:true,recognitionSegments:[final]}, false],
  ];
  for(const [name,evidence,expected] of cases){
    assert.equal(isRecognitionEvidenceComplete(evidence),expected,name);
    assert.equal(recognitionHypotheses(evidence).length>0,expected,name);
  }
  const valid={ok:true,transcript:exact,primaryTranscript:exact,completionState:'terminal',transportComplete:true,recognitionComplete:true,
    attemptId:7,itemId:'E0006',recognitionSegments:[{...final,attemptId:7,itemId:'E0006'}]};
  assert.deepEqual(assessProductionRecognitionEvidence(valid,{expectedItemId:'E0006',currentItemId:'E0006'}),
    {admitted:true,reason:null,evidenceFinality:'final'});
  for(const [name,evidence,expectedItemId,currentItemId] of [
    ['wrong attempt', {...valid,recognitionSegments:[{...final,attemptId:6,itemId:'E0006'}]},'E0006','E0006'],
    ['changed item', valid,'E0006','E0007'],
    ['missing attempt', {...valid,attemptId:null},'E0006','E0006'],
  ]){
    assert.equal(assessProductionRecognitionEvidence(evidence,{expectedItemId,currentItemId}).admitted,false,name);
  }
  assert.equal(assessProductionRecognitionEvidence({...valid,transportComplete:false},{expectedItemId:'E0006',currentItemId:'E0006'}).reason,
    'transport-not-complete','final-looking transcript cannot bypass transport completion');
  const {transportComplete,...withoutTransport}=valid;
  assert.equal(assessProductionRecognitionEvidence(withoutTransport,{expectedItemId:'E0006',currentItemId:'E0006'}).admitted,false,
    'production grading requires an explicit normal terminal state');
});
