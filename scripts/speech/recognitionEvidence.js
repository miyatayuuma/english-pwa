import { REQUESTED_MAX_ALTERNATIVES } from './recognitionPolicy.js';

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
