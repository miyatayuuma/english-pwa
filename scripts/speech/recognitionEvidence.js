import { REQUESTED_MAX_ALTERNATIVES } from './recognitionPolicy.js';

// Deterministic source stitching shared by the primary transcript and fixed-rank
// N-best streams. This preserves provider words and only removes literal overlap.
export function appendRawTranscriptFinal(stable, fragment) {
  const left = String(stable ?? '').trimEnd();
  const right = String(fragment ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  const lowerLeft = left.toLocaleLowerCase('en-US');
  const lowerRight = right.toLocaleLowerCase('en-US');
  if (lowerRight === lowerLeft || lowerRight.startsWith(`${lowerLeft} `)) return right;
  if (lowerLeft.startsWith(`${lowerRight} `)) return left;
  const leftWords = left.split(/\s+/u);
  const rightWords = right.split(/\s+/u);
  const comparable = word => String(word || '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
  let overlap = 0;
  const max = Math.min(leftWords.length, rightWords.length);
  for (let count = max; count > 0; count -= 1) {
    let same = true;
    for (let index = 0; index < count; index += 1) {
      const a = comparable(leftWords[leftWords.length - count + index]);
      const b = comparable(rightWords[index]);
      if (a !== b) { same = false; break; }
    }
    if (same) { overlap = count; break; }
  }
  const remaining = rightWords.slice(overlap).join(' ');
  return remaining ? `${left} ${remaining}` : left;
}

// No synthesis, deduplication or confidence sorting: retain provider bytes and rank.
export function recognitionSegment({ alternatives = [], segmentIndex = 0, isFinal = false,
  primaryTranscript, requestedMaxResults = REQUESTED_MAX_ALTERNATIVES,
  providerReturnedCount = alternatives.length } = {}) {
  const retained = Array.from(alternatives).slice(0, REQUESTED_MAX_ALTERNATIVES).map((candidate, rank) => ({
    transcript: String(candidate?.transcript ?? ''),
    asrRank: Number.isInteger(candidate?.asrRank) && candidate.asrRank >= 0 ? candidate.asrRank : rank,
    confidence: Number.isFinite(candidate?.confidence) ? candidate.confidence : null,
  }));
  return { segmentIndex, primaryTranscript: primaryTranscript ?? retained[0]?.transcript ?? '',
    alternatives: retained, isFinal: !!isFinal, requestedMaxResults, providerReturnedCount,
    retainedCandidateCount: retained.length };
}
