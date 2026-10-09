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

function contextSequences(candidateTokens, chunks) {
  const contexts = [];
  const startToken = tokens(chunks?.[0]).at(-1);
  const endToken = tokens(chunks?.[1]).at(-1);
  if (!startToken || !endToken) return contexts;
  for (let index = 0; index < candidateTokens.length - 1; index += 1) {
    if (candidateTokens[index] !== startToken) continue;
    const limit = Math.min(candidateTokens.length, index + 13);
    let end = limit;
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      if (candidateTokens[cursor] === endToken) {
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

export function buildVocabulary139Diagnostics({
  canonical = '',
  chunks = [],
  chunkAuthorityValid = false,
  primaryTranscript = '',
  recognitionSegments = [],
  grade = null,
} = {}) {
  const currentChunks = Array.isArray(chunks) && chunks.length === 2 ? chunks.map(String) : [];
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
        chunk1StrictMatch: currentChunks.length === 2 && containsSequence(candidateTokens, tokens(currentChunks[0])),
        chunk2StrictMatch: currentChunks.length === 2 && containsSequence(candidateTokens, tokens(currentChunks[1])),
        contextSequences: contextSequences(candidateTokens, currentChunks),
      };
    }));

  const ranksFor = field => [...new Set(candidates.filter(candidate => candidate[field]).map(candidate => candidate.rank))]
    .sort((left, right) => left - right);
  const primaryTokens = tokens(primaryTranscript);
  const chunkTokens = currentChunks.map(tokens);
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
    canonical: String(canonical ?? ''),
    chunkAuthorityValid: !!chunkAuthorityValid,
    thanRanks: ranksFor('containsThan'),
    thenRanks: ranksFor('containsThen'),
    downRanks: ranksFor('containsDown'),
    alternatives: candidates,
    chunkMatch: {
      method: 'contiguous normalized token sequence',
      chunks: currentChunks.map((expected, index) => ({
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
        : !chunkAuthorityValid
          ? 'Curated chunk authority does not match the current production canonical; chunk rescue is disabled.'
          : noChunkRescueReason({ grade, chunks: currentChunks, primaryStrictMatches, lowerStrictRanks }),
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
