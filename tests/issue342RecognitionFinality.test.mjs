import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';

const item=JSON.parse(readFileSync(new URL('../data/items.json',import.meta.url),'utf8')).find(row=>row.id==='E0006');
const segment=(transcript,isFinal,alternatives=[transcript])=>({
  segmentIndex:0,
  primaryTranscript:transcript,
  isFinal,
  alternatives:alternatives.map((value,asrRank)=>({transcript:value,asrRank})),
});

test('Vocabulary never promotes interim primary, N-best, paraphrase, or correction evidence',()=>{
  const interimOnly={completionState:'pending',recognitionComplete:false,recognitionSegments:[segment(item.en,false)]};
  const exact=classifyVocabularySpeechAnswer({entry:{id:'issue342-exact',canonical:item.en},transcript:item.en,...interimOnly});
  assert.equal(exact.type,'miss');
  assert.equal(exact.matched,false);

  const nbest=classifyVocabularySpeechAnswer({
    entry:{id:'issue342-nbest',canonical:item.en},
    transcript:'unrelated words',
    completionState:'terminal',recognitionComplete:true,
    recognitionSegments:[segment('unrelated words',false,['unrelated words',item.en])],
  });
  assert.equal(nbest.type,'miss');
  assert.equal(nbest.targetRescued,false);

  const paraphrase=classifyVocabularySpeechAnswer({
    entry:{id:'issue342-paraphrase',canonical:'a different phrase',paraphrases:[item.en]},
    transcript:item.en,...interimOnly,
  });
  assert.equal(paraphrase.type,'miss');

  const correction=classifyVocabularySpeechAnswer({
    entry:{id:'issue342-correction',canonical:item.en},transcript:item.en,...interimOnly,correction:true,
  });
  assert.equal(correction.type,'miss');
});

test('Vocabulary accepts the same finalized target after terminal completion',()=>{
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'issue342-final',canonical:item.en},
    transcript:item.en,
    completionState:'terminal',recognitionComplete:true,
    recognitionSegments:[segment(item.en,true)],
  });
  assert.equal(result.type,'target');
  assert.equal(result.recognitionComplete,true);
});
