import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import {
  buildVocabulary139Diagnostics,
  positiveIntendedText,
  withVocabulary139Diagnostics,
} from '../android/app/src/debug/assets/public/native-gate-diagnostics.js';

const harnessPath = new URL('../android/app/src/debug/assets/public/native-gate.html', import.meta.url);
const canonical = 'no sooner had I sat down than the phone rang';
const entry = { id: 'vocab:00139', canonical };

function segment(transcripts) {
  return {
    segmentIndex: 0,
    primaryTranscript: transcripts[0],
    isFinal: true,
    requestedMaxResults: 20,
    providerReturnedCount: transcripts.length,
    retainedCandidateCount: transcripts.length,
    alternatives: transcripts.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
  };
}

test('debug fixture selects vocab:00139 and positive prompt is its canonical', async () => {
  const harness = await readFile(harnessPath, 'utf8');
  assert.match(harness, /<option value="vocab:00139">no sooner had I sat down than the phone rang<\/option>/);
  assert.equal(positiveIntendedText('vocab:00139', canonical, ['different answer variant']), canonical);
  assert.equal(positiveIntendedText('vocab:00437', 'ignored', ['yield to something']), 'yield to something');
});

test('deep N-best diagnostics show than at provider rank 4 and current chunk rescue', () => {
  const alternatives = segment([
    'no sooner had I sat down down the phone rang',
    'no sooner I had a sat down down the terrible rang',
    'unrelated candidate',
    'than the phone rang',
  ]);
  const primary = alternatives.primaryTranscript;
  const recognitionSegments = [alternatives];
  const grade = classifyVocabularySpeechAnswer({ entry, transcript: primary, recognitionSegments });
  const diagnostics = buildVocabulary139Diagnostics({ primaryTranscript: primary, recognitionSegments, grade });

  assert.deepEqual(diagnostics.thanRanks, [4]);
  assert.deepEqual(diagnostics.thenRanks, []);
  assert.deepEqual(diagnostics.downRanks, [1, 2]);
  assert.deepEqual(diagnostics.alternatives[3].contextSequences, []);
  assert.equal(diagnostics.chunkMatch.chunks[0].rank0StrictMatch, true);
  assert.equal(diagnostics.chunkMatch.chunks[1].rank0StrictMatch, false);
  assert.deepEqual(diagnostics.chunkMatch.chunks[1].lowerNbestStrictMatches, [{ segmentIndex: 0, rank: 4 }]);
  assert.equal(diagnostics.chunkMatch.chunkRescueFired, true);
  assert.equal(diagnostics.chunkMatch.rescuedRank, 4);
  assert.equal(diagnostics.chunkMatch.recognitionAuthority, 'nbest-chunk-exact');
  assert.equal(diagnostics.chunkMatch.rescuedChunk.expected, 'than the phone rang');
  assert.equal(diagnostics.chunkMatch.supportingPrimaryChunk.expected, 'no sooner had I sat down');

  const exported = JSON.stringify(withVocabulary139Diagnostics({
    intended: canonical,
    primary,
    allAlternatives: diagnostics.alternatives,
    finalGrade: grade.type,
  }, diagnostics, grade));
  for (const field of ['"intended"', '"primary"', '"alternatives"', '"asrRank"', '"thanRanks"', '"thenRanks"', '"downRanks"', '"chunkMatch"', '"finalGrade"', '"targetRescued"', '"recognitionAuthority"']) assert.ok(exported.includes(field), `${field} is exportable`);
});

test('down-only alternatives do not create than/then hits or chunk rescue', () => {
  const alternatives = segment(['down only', 'downstairs later', 'a downside']);
  const recognitionSegments = [alternatives];
  const grade = classifyVocabularySpeechAnswer({ entry, transcript: alternatives.primaryTranscript, recognitionSegments });
  const diagnostics = buildVocabulary139Diagnostics({ primaryTranscript: alternatives.primaryTranscript, recognitionSegments, grade });

  assert.deepEqual(diagnostics.thanRanks, []);
  assert.deepEqual(diagnostics.thenRanks, []);
  assert.deepEqual(diagnostics.downRanks, [1]);
  assert.equal(diagnostics.chunkMatch.chunkRescueFired, false);
  assert.equal(diagnostics.chunkMatch.rescuedRank, null);
  assert.match(diagnostics.chunkMatch.reason, /neither strict chunk/);
});

test('collision detection uses exact tokens rather than substrings', () => {
  const alternatives = segment(['withstand downstairs', 'then again', 'than usual, down below']);
  const diagnostics = buildVocabulary139Diagnostics({
    primaryTranscript: alternatives.primaryTranscript,
    recognitionSegments: [alternatives],
  });

  assert.deepEqual(diagnostics.thanRanks, [3]);
  assert.deepEqual(diagnostics.thenRanks, [2]);
  assert.deepEqual(diagnostics.downRanks, [3]);
  assert.equal(diagnostics.alternatives[0].containsThan, false);
  assert.equal(diagnostics.alternatives[0].containsDown, false);
});
