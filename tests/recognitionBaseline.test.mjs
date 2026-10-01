import test from 'node:test';
import assert from 'node:assert/strict';
import {matchTranscript} from '../scripts/speech/recognition.js';
test('rank-one matcher agrees with independently frozen pre-migration corpus results',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {calcMatchScore}=await import('../scripts/speech/recognition.js');
  const baseline=JSON.parse(await readFile(new URL('./fixtures/asr-matcher-baseline.json',import.meta.url),'utf8'));
  assert.equal(baseline.sourceMain,'e0594c88c548d6aea28ff9b4aca6870d8982a603');
  assert.equal(baseline.cases.length,42);
  for(const {reference,hypothesis,expected} of baseline.cases){
    const value=matchTranscript(reference,hypothesis);
    assert.deepEqual({...value,matchedCounts:[...value.matchedCounts],score:calcMatchScore(value.refCount,value.recall,value.precision)},expected);
  }
});
