import { recognitionSegment } from '../speech/recognitionEvidence.js';

// Shared JS grading consumes the same segment/evidence schema regardless of
// recognizer. Provider rank is preserved and confidence remains optional.
export function nativeRecognitionEvidence(event) {
  const segment = recognitionSegment({ alternatives: event?.alternatives ?? [], isFinal: event?.type === 'final',
    requestedMaxResults: event?.requestedMaxResults, providerReturnedCount: event?.providerReturnedCount });
  return { transcript: segment.primaryTranscript, previewTranscript: segment.primaryTranscript, recognitionSegments: [segment] };
}

export function nativeWebResultEvent(event) {
  const segment = nativeRecognitionEvidence(event).recognitionSegments[0];
  return {
    resultIndex: 0,
    results: [Object.assign(segment.alternatives, { isFinal: segment.isFinal, requestedMaxResults: segment.requestedMaxResults, providerReturnedCount: segment.providerReturnedCount, retainedCandidateCount: segment.retainedCandidateCount })],
  };
}
