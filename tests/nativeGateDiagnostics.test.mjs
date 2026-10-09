import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { readFileSync } from 'node:fs';
import { VOCABULARY_CHUNK_RESCUE_AUTHORITY, vocabularyChunkRescueChunks } from '../scripts/speech/vocabularyChunkRescueAuthority.js';
import {
  buildVocabulary139Diagnostics,
  positiveIntendedText,
  withVocabulary139Diagnostics,
} from '../android/app/src/debug/assets/public/native-gate-diagnostics.js';

const harnessPath = new URL('../android/app/src/debug/assets/public/native-gate.html', import.meta.url);
const entry = JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json', import.meta.url), 'utf8')).entries.find(value => value.id === 'vocab:00139');
const canonical = entry.canonical;
const chunks = VOCABULARY_CHUNK_RESCUE_AUTHORITY[entry.id] || [];
const chunkAuthorityValid = !!vocabularyChunkRescueChunks(entry);

function diagnose({ primaryTranscript = '', recognitionSegments = [], grade = null } = {}) {
  return buildVocabulary139Diagnostics({ canonical, chunks, chunkAuthorityValid, primaryTranscript, recognitionSegments, grade });
}

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
  assert.match(harness, /<option value="vocab:00139">/);
  assert.match(harness, /positiveIntendedText\(f\.key,f\.entry\?\.canonical,targets\)/);
  assert.equal(positiveIntendedText('vocab:00139', canonical, ['different answer variant']), canonical);
  assert.equal(canonical, entry.canonical);
  assert.equal(positiveIntendedText('vocab:00437', 'ignored', ['yield to something']), 'yield to something');
});

test('deep N-best diagnostics show than at provider rank 4 and current chunk rescue', () => {
  assert.equal(chunkAuthorityValid, true, 'the curated split must reconstruct the current production canonical');
  const alternatives = segment([`${chunks[0]} down unrelated`, 'unrelated down noise', 'unrelated candidate', chunks[1]]);
  const primary = alternatives.primaryTranscript;
  const recognitionSegments = [alternatives];
  const grade = classifyVocabularySpeechAnswer({ entry, transcript: primary, recognitionSegments, recognitionComplete: true });
  const diagnostics = diagnose({ primaryTranscript: primary, recognitionSegments, grade });

  const rankOf = term => diagnostics.alternatives.filter(candidate => candidate.transcript.toLocaleLowerCase('en-US').split(/\W+/u).includes(term)).map(candidate => candidate.rank);
  assert.deepEqual(diagnostics.thanRanks, rankOf('than'));
  assert.deepEqual(diagnostics.thenRanks, rankOf('then'));
  assert.deepEqual(diagnostics.downRanks, [1, 2]);
  assert.deepEqual(diagnostics.alternatives[3].contextSequences, []);
  assert.equal(diagnostics.chunkMatch.chunks[0].rank0StrictMatch, true);
  assert.equal(diagnostics.chunkMatch.chunks[1].rank0StrictMatch, false);
  assert.deepEqual(diagnostics.chunkMatch.chunks[1].lowerNbestStrictMatches, [{ segmentIndex: 0, rank: 4 }]);
  assert.equal(diagnostics.chunkMatch.chunkRescueFired, true);
  assert.equal(diagnostics.chunkMatch.rescuedRank, 4);
  assert.equal(diagnostics.chunkMatch.recognitionAuthority, 'nbest-chunk-exact');
  assert.equal(diagnostics.chunkMatch.rescuedChunk.expected, chunks[1]);
  assert.equal(diagnostics.chunkMatch.supportingPrimaryChunk.expected, chunks[0]);

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
  const grade = classifyVocabularySpeechAnswer({ entry, transcript: alternatives.primaryTranscript, recognitionSegments, recognitionComplete: true });
  const diagnostics = diagnose({ primaryTranscript: alternatives.primaryTranscript, recognitionSegments, grade });

  assert.deepEqual(diagnostics.thanRanks, []);
  assert.deepEqual(diagnostics.thenRanks, []);
  assert.deepEqual(diagnostics.downRanks, [1]);
  assert.equal(diagnostics.chunkMatch.chunkRescueFired, false);
  assert.equal(diagnostics.chunkMatch.rescuedRank, null);
  assert.match(diagnostics.chunkMatch.reason, /neither strict chunk/);
});

test('diagnostics explain when a lower full TARGET preempts chunk rescue', () => {
  const alternatives = segment([
    `${chunks[0]} down unrelated`,
    'unrelated candidate',
    canonical,
  ]);
  const recognitionSegments = [alternatives];
  const grade = classifyVocabularySpeechAnswer({ entry, transcript: alternatives.primaryTranscript, recognitionSegments, recognitionComplete: true });
  const diagnostics = diagnose({ primaryTranscript: alternatives.primaryTranscript, recognitionSegments, grade });

  assert.equal(diagnostics.chunkMatch.chunkRescueFired, false);
  assert.equal(diagnostics.chunkMatch.recognitionAuthority, 'nbest-exact');
  assert.match(diagnostics.chunkMatch.reason, /full TARGET rescue runs before chunk rescue/);
});

test('collision detection uses exact tokens rather than substrings', () => {
  const alternatives = segment(['withstand downstairs', 'then again', 'than usual, down below']);
  const diagnostics = diagnose({
    primaryTranscript: alternatives.primaryTranscript,
    recognitionSegments: [alternatives],
  });

  assert.deepEqual(diagnostics.thanRanks, [3]);
  assert.deepEqual(diagnostics.thenRanks, [2]);
  assert.deepEqual(diagnostics.downRanks, [3]);
  assert.equal(diagnostics.alternatives[0].containsThan, false);
  assert.equal(diagnostics.alternatives[0].containsDown, false);
});
