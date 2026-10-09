import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';

test('rank-one strict alignment matches the independently reviewed post-refactor corpus baseline', async () => {
  const { readFile } = await import('node:fs/promises');
  const baseline = JSON.parse(await readFile(new URL('./fixtures/asr-matcher-baseline.json', import.meta.url), 'utf8'));
  assert.equal(baseline.sourceMain, '21daec183d8935d441e277f72ecaff79efe09197');
  assert.equal(baseline.algorithm, 'strict-alignment-ordered-v2');
  assert.equal(baseline.cases.length, 42);
  for (const { reference, hypothesis, expected } of baseline.cases) {
    const value = alignSpeech(reference, hypothesis, { context: { mode: 'read' } });
    assert.deepEqual({
      recall: value.recall,
      precision: value.precision,
      matched: value.matched,
      missing: value.missing,
      refCount: value.refCount,
      hypTokens: value.hypTokens,
      transcript: value.transcript,
      orderValid: value.orderedMatchIntegrity.valid,
      score: gradeReadSpeech(value).score,
      matches: value.alignment.map(({ expected: matchedExpected, observed, authority, ruleId, ruleKind }) => ({
        expected: matchedExpected, observed, authority, ruleId, ruleKind,
      })),
    }, expected);
  }
});
