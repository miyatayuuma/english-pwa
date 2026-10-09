function candidateAtRank(segment, rank) {
  const matches = (Array.isArray(segment?.alternatives) ? segment.alternatives : [])
    .filter(candidate => candidate?.asrRank === rank);
  return matches.length === 1 ? matches[0] : null;
}

function normalizedSegments(evidence) {
  return (Array.isArray(evidence?.recognitionSegments) ? evidence.recognitionSegments : [])
    .map((segment, arrayIndex) => ({ ...segment, segmentIndex: Number.isInteger(segment?.segmentIndex) ? segment.segmentIndex : arrayIndex }));
}

export function isRecognitionEvidenceComplete(evidence = {}) {
  const segments = normalizedSegments(evidence);
  if (evidence?.recognitionComplete === true || evidence?.completionState === 'terminal') return true;
  // Directly constructed evidence in unit tests and old adapter consumers has
  // no attempt-level state. It is safe only when every supplied segment is final.
  return evidence?.recognitionComplete === undefined
    && evidence?.completionState === undefined
    && segments.length > 0
    && segments.every(segment => segment?.isFinal === true);
}

/**
 * Return rank-zero raw evidence first, then only same-rank alternatives from
 * every finalized segment. No candidate is synthesized across ranks or across
 * incomplete segments. The primary transcript is never rewritten.
 */
export function recognitionHypotheses(evidence = {}) {
  const primaryTranscript = String(evidence?.primaryTranscript ?? evidence?.transcript ?? '');
  const segments = normalizedSegments(evidence);
  const primary = {
    transcript: primaryTranscript,
    asrRank: 0,
    segmentIndex: segments.length === 1 ? segments[0].segmentIndex : null,
    segmentIndexes: segments.map(segment => segment.segmentIndex),
    source: 'primary',
  };
  const hypotheses = [primary];
  if (!isRecognitionEvidenceComplete({ ...evidence, recognitionSegments: segments })
    || !segments.length
    || segments.length !== 1
    || segments.some(segment => segment?.isFinal !== true)) return hypotheses;

  const ranks = [...new Set((segments[0].alternatives || [])
    .map(candidate => candidate?.asrRank)
    .filter(rank => Number.isInteger(rank) && rank > 0))].sort((a, b) => a - b);
  for (const asrRank of ranks) {
    const candidate = candidateAtRank(segments[0], asrRank);
    if (!candidate) continue;
    const transcript = String(candidate.transcript ?? '');
    if (!transcript.trim() || transcript === primaryTranscript) continue;
    hypotheses.push({
      transcript,
      asrRank,
      segmentIndex: segments[0].segmentIndex,
      segmentIndexes: [segments[0].segmentIndex],
      source: 'nbest',
      segmentTranscripts: [transcript],
    });
  }
  return hypotheses;
}

// Vocabulary targets may be evidenced inside any one provider segment, but a
// segment alternative is never promoted to a full-sentence Read hypothesis.
export function finalizedRecognitionAlternatives(evidence = {}) {
  const segments = normalizedSegments(evidence);
  if (!isRecognitionEvidenceComplete({ ...evidence, recognitionSegments: segments })
    || !segments.length
    || segments.some(segment => segment?.isFinal !== true)) return [];
  const result = [];
  for (const segment of segments) {
    const ranks = [...new Set((segment.alternatives || [])
      .map(candidate => candidate?.asrRank)
      .filter(rank => Number.isInteger(rank) && rank > 0))].sort((a, b) => a - b);
    for (const rank of ranks) {
      const candidate = candidateAtRank(segment, rank);
      if (!candidate) continue;
      const transcript = String(candidate?.transcript ?? '');
      if (!transcript.trim()) continue;
      result.push({
        transcript,
        asrRank: rank,
        segmentIndex: segment.segmentIndex,
        segmentIndexes: [segment.segmentIndex],
        source: 'nbest-segment',
      });
    }
  }
  return result.sort((a, b) => a.asrRank - b.asrRank || a.segmentIndex - b.segmentIndex);
}

// Evaluate rank zero first. A lower-ranked hypothesis is returned only when the
// caller's unchanged mode-specific acceptance rule says it passes.
export function evaluateRecognitionCandidates(evidence, evaluateHypothesis) {
  if (typeof evaluateHypothesis !== 'function') throw new TypeError('evaluateHypothesis must be a function');
  const checked = [];
  for (const candidate of recognitionHypotheses(evidence)) {
    const assessment = evaluateHypothesis(candidate) || {};
    const result = { ...assessment, candidate };
    checked.push(result);
    if (result.accepted) return { selected: result, checked, rescued: candidate.source !== 'primary' };
  }
  return { selected: checked[0] || null, checked, rescued: false };
}
