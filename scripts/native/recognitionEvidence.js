export const ANDROID_NATIVE_MAX_RESULTS = 20;

// Shared JS grading consumes the same segment/evidence schema regardless of
// recognizer. Provider rank is preserved and confidence remains optional.
export function nativeRecognitionEvidence(event) {
  const alternatives = (Array.isArray(event?.alternatives) ? event.alternatives : [])
    .slice(0, ANDROID_NATIVE_MAX_RESULTS).map((candidate, asrRank) => ({
      transcript: String(candidate?.transcript ?? ''),
      asrRank: Number.isInteger(candidate?.asrRank) && candidate.asrRank >= 0 ? candidate.asrRank : asrRank,
      confidence: Number.isFinite(candidate?.confidence) ? candidate.confidence : null,
    }));
  const transcript = alternatives[0]?.transcript ?? '';
  return {
    transcript,
    previewTranscript: transcript,
    nativeSegments: [{
      segmentIndex: 0,
      isFinal: event?.type === 'final',
      primaryTranscript: transcript,
      alternatives,
      requestedMaxResults: event?.requestedMaxResults ?? ANDROID_NATIVE_MAX_RESULTS,
      providerReturnedCount: event?.providerReturnedCount ?? (event?.alternatives?.length ?? 0),
      retainedCandidateCount: alternatives.length,
    }],
  };
}

export function nativeWebResultEvent(event) {
  const segment = nativeRecognitionEvidence(event).nativeSegments[0];
  return {
    resultIndex: 0,
    results: [Object.assign(segment.alternatives, { isFinal: segment.isFinal, requestedMaxResults: segment.requestedMaxResults, providerReturnedCount: segment.providerReturnedCount, retainedCandidateCount: segment.retainedCandidateCount })],
  };
}
