export const VOCAB_00139_CHUNKS = Object.freeze([
  'no sooner had I arrived',
  'than the phone rang',
]);

function tokens(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[‘’‛ʼ＇]/gu, "'")
    .replace(/[‐‑‒–—−﹘﹣－]/gu, '-')
    .toLocaleLowerCase('en-US');
  return normalized.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
}

function containsSequence(candidateTokens, expectedTokens) {
  if (!expectedTokens.length || expectedTokens.length > candidateTokens.length) return false;
  for (let start = 0; start <= candidateTokens.length - expectedTokens.length; start += 1) {
    if (expectedTokens.every((token, index) => token === candidateTokens[start + index])) return true;
  }
  return false;
}

function contextSequences(candidateTokens) {
  const contexts = [];
  for (let index = 0; index < candidateTokens.length - 1; index += 1) {
    if (candidateTokens[index] !== 'arrived') continue;
    const limit = Math.min(candidateTokens.length, index + 13);
    let end = limit;
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      if (candidateTokens[cursor] === 'rang') {
        end = cursor + 1;
        break;
      }
    }
    contexts.push(candidateTokens.slice(index, end).join(' '));
  }
  return contexts;
}

function noChunkRescueReason({ grade, chunks, primaryStrictMatches, lowerStrictRanks }) {
  if (grade?.recognitionAuthority === 'exact') {
    return 'Rank 0 already matched the full TARGET before chunk rescue.';
  }
  if (grade?.recognitionAuthority === 'nbest-exact') {
    return 'A lower N-best candidate matched the full TARGET; full TARGET rescue runs before chunk rescue.';
  }
  if (grade?.targetRescued === true) {
    return `A lower N-best candidate was accepted by ${grade.recognitionAuthority || 'the existing TARGET authority'} before chunk rescue.`;
  }
  if (grade?.type === 'target' && grade?.targetRescued !== true) {
    return `Rank 0 was accepted by ${grade.recognitionAuthority || 'the existing TARGET authority'} before chunk rescue.`;
  }
  if (grade?.type === 'paraphrase') {
    return 'The primary was classified as a paraphrase; current chunk rescue returns before joining chunks.';
  }
  if (primaryStrictMatches.length === 0) {
    return 'Rank 0 contains neither strict chunk, so there is no primary chunk to support a rescue.';
  }
  if (primaryStrictMatches.length > 1) {
    return 'Rank 0 contains both strict chunks; current authority requires exactly one rank-0 supporting chunk.';
  }
  const missingIndex = primaryStrictMatches[0] === 0 ? 1 : 0;
  if (!lowerStrictRanks[missingIndex].length) {
    return `No lower N-best alternative strictly contains chunk ${missingIndex + 1} (${chunks[missingIndex]}).`;
  }
  return 'A lower alternative contains the opposite chunk, but it did not pass the grader’s existing candidate and join conditions.';
}

export function positiveIntendedText(caseKey, canonical, targets = []) {
  if (caseKey === 'vocab:00139') return String(canonical ?? '');
  return String(targets[0] ?? '');
}

export function buildVocabulary139Diagnostics({ primaryTranscript = '', recognitionSegments = [], grade = null } = {}) {
  const candidates = recognitionSegments.flatMap((segment, segmentArrayIndex) =>
    (segment?.alternatives || []).slice(0, 20).map((candidate, candidateIndex) => {
      const asrRank = Number.isInteger(candidate?.asrRank) ? candidate.asrRank : candidateIndex;
      const transcript = String(candidate?.transcript ?? '');
      const candidateTokens = tokens(transcript);
      return {
        ...candidate,
        transcript,
        recognitionSegmentIndex: segment?.segmentIndex ?? segmentArrayIndex,
        asrRank,
        rank: asrRank + 1,
        containsThan: candidateTokens.includes('than'),
        containsThen: candidateTokens.includes('then'),
        containsDown: candidateTokens.includes('down'),
        chunk1StrictMatch: containsSequence(candidateTokens, tokens(VOCAB_00139_CHUNKS[0])),
        chunk2StrictMatch: containsSequence(candidateTokens, tokens(VOCAB_00139_CHUNKS[1])),
        contextSequences: contextSequences(candidateTokens),
      };
    }));

  const ranksFor = field => [...new Set(candidates.filter(candidate => candidate[field]).map(candidate => candidate.rank))]
    .sort((left, right) => left - right);
  const primaryTokens = tokens(primaryTranscript);
  const chunkTokens = VOCAB_00139_CHUNKS.map(tokens);
  const primaryStrictMatches = chunkTokens.flatMap((expectedTokens, index) =>
    containsSequence(primaryTokens, expectedTokens) ? [index] : []);
  const lowerStrictRanks = chunkTokens.map(expectedTokens => candidates
    .filter(candidate => candidate.asrRank > 0 && containsSequence(tokens(candidate.transcript), expectedTokens))
    .map(candidate => ({ segmentIndex: candidate.recognitionSegmentIndex, rank: candidate.rank })));
  const chunkRescueFired = grade?.recognitionAuthority === 'nbest-chunk-exact'
    && grade?.targetRescued === true
    && !!grade?.chunkRescue;
  const rescuedChunk = grade?.rescuedChunk ?? grade?.chunkRescue?.rescuedChunk ?? null;
  const supportingPrimaryChunk = grade?.supportingPrimaryChunk ?? grade?.chunkRescue?.supportingPrimaryChunk ?? null;

  return {
    thanRanks: ranksFor('containsThan'),
    thenRanks: ranksFor('containsThen'),
    downRanks: ranksFor('containsDown'),
    alternatives: candidates,
    chunkMatch: {
      method: 'contiguous normalized token sequence',
      chunks: VOCAB_00139_CHUNKS.map((expected, index) => ({
        index,
        expected,
        rank0StrictMatch: primaryStrictMatches.includes(index),
        lowerNbestStrictMatches: lowerStrictRanks[index],
      })),
      chunkRescueFired,
      rescuedRank: chunkRescueFired && Number.isInteger(grade?.asrRank) ? grade.asrRank + 1 : null,
      recognitionAuthority: grade?.recognitionAuthority ?? null,
      rescuedChunk,
      supportingPrimaryChunk,
      reason: chunkRescueFired
        ? 'The current grader fired nbest-chunk-exact.'
        : noChunkRescueReason({ grade, chunks: VOCAB_00139_CHUNKS, primaryStrictMatches, lowerStrictRanks }),
    },
  };
}

export function withVocabulary139Diagnostics(row, diagnostics, grade) {
  return {
    ...row,
    asrRank: grade?.asrRank ?? null,
    targetRescued: grade?.targetRescued ?? false,
    recognitionAuthority: grade?.recognitionAuthority ?? null,
    alternatives: diagnostics.alternatives,
    thanRanks: diagnostics.thanRanks,
    thenRanks: diagnostics.thenRanks,
    downRanks: diagnostics.downRanks,
    chunkMatch: diagnostics.chunkMatch,
  };
}
