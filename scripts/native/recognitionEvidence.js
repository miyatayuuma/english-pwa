// Shared JS grading consumes the same segment/evidence schema regardless of
// recognizer. Provider rank is preserved and confidence remains optional.
export function nativeRecognitionEvidence(event) {
  const alternatives = (Array.isArray(event?.alternatives) ? event.alternatives : [])
    .slice(0, 5).map((candidate, asrRank) => ({
      transcript: String(candidate?.transcript ?? ''),
      asrRank,
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
    }],
  };
}

export function nativeWebResultEvent(event) {
  const segment = nativeRecognitionEvidence(event).nativeSegments[0];
  return {
    resultIndex: 0,
    results: [Object.assign(segment.alternatives, { isFinal: segment.isFinal })],
  };
}
