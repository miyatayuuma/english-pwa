import { appendRawTranscriptFinal } from './recognitionEvidence.js';

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
  if (!segments.length || segments.some(segment => segment?.isFinal !== true)) return false;

  // Provider/session completion is transport state. It cannot override an
  // explicit negative finality flag, and an ended attempt still needs segments.
  const state = typeof evidence?.completionState === 'string' ? evidence.completionState : '';
  if (state && !['terminal', 'finalized'].includes(state)) return false;
  if (evidence?.recognitionComplete === false) return false;
  if (state === 'finalized' && evidence?.recognitionComplete !== true) return false;

  // If attempt identity is present, reject segments attributed to another
  // attempt. Legacy consumers may omit segment-level IDs; the production
  // admission check below requires them.
  if (evidence?.attemptId != null && segments.some(segment => segment?.attemptId != null
    && String(segment.attemptId) !== String(evidence.attemptId))) return false;

  const primary = evidence?.primaryTranscript ?? evidence?.transcript;
  if (primary == null) return false;
  if (evidence?.primaryTranscript != null && evidence?.transcript != null
    && String(evidence.primaryTranscript).trim() !== String(evidence.transcript).trim()) return false;
  const fromFinalSegments = segments.reduce((text, segment) => {
    const rankZero = candidateAtRank(segment, 0);
    const fragment = segment?.primaryTranscript ?? rankZero?.transcript;
    return fragment == null ? text : appendRawTranscriptFinal(text, fragment);
  }, '');
  return String(primary).trim() === fromFinalSegments.trim();
}

/** Strict identity checks used immediately before production grading. */
export function assessProductionRecognitionEvidence(evidence = {}, {
  expectedItemId = null,
  currentItemId = null,
  expectedEntryId = null,
  currentEntryId = null,
} = {}) {
  let reason = null;
  const segments = normalizedSegments(evidence);
  if (evidence?.ok !== true) reason = 'recognition-not-successfully-ended';
  else if (evidence?.transportComplete !== true
    || !['terminal', 'finalized'].includes(String(evidence?.completionState ?? ''))) {
    reason = 'transport-not-complete';
  }
  else if (!isRecognitionEvidenceComplete(evidence)) {
    const state = String(evidence?.completionState ?? '');
    if (state && !['terminal', 'finalized'].includes(state)) reason = `transport-${state}`;
    else if (!segments.length) reason = 'no-recognition-segments';
    else if (segments.some(segment => segment?.isFinal !== true)) reason = 'non-final-segment';
    else if (evidence?.recognitionComplete === false) reason = 'attempt-not-finalized';
    else reason = 'primary-transcript-not-backed-by-final-segments';
  } else if (evidence?.attemptId == null || String(evidence.attemptId) === '') {
    reason = 'missing-attempt-id';
  } else if ((expectedItemId == null || String(expectedItemId) === '')
    && (expectedEntryId == null || String(expectedEntryId) === '')) {
    reason = 'missing-expected-learning-context';
  } else if (expectedItemId != null && (evidence?.itemId == null
    || String(evidence.itemId) !== String(expectedItemId))) {
    reason = 'attempt-item-mismatch';
  } else if (expectedItemId != null && (currentItemId == null
    || String(currentItemId) !== String(expectedItemId))) {
    reason = 'item-changed-before-grade';
  } else if (expectedEntryId != null && (evidence?.entryId == null
    || String(evidence.entryId) !== String(expectedEntryId))) {
    reason = 'attempt-entry-mismatch';
  } else if (expectedEntryId != null && (currentEntryId == null
    || String(currentEntryId) !== String(expectedEntryId))) {
    reason = 'entry-changed-before-grade';
  } else if (segments.some(segment => segment?.attemptId == null
    || String(segment.attemptId) !== String(evidence.attemptId))) {
    reason = 'segment-attempt-mismatch';
  } else if (expectedItemId != null && segments.some(segment => segment?.itemId == null
    || String(segment.itemId) !== String(expectedItemId))) {
    reason = 'segment-item-mismatch';
  } else if (expectedEntryId != null && segments.some(segment => segment?.entryId == null
    || String(segment.entryId) !== String(expectedEntryId))) {
    reason = 'segment-entry-mismatch';
  } else if (evidence?.gameContext?.itemId != null
    && String(evidence.gameContext.itemId) !== String(expectedItemId)) {
    reason = 'trace-context-item-mismatch';
  } else if (evidence?.gameContext?.entryId != null && expectedEntryId != null
    && String(evidence.gameContext.entryId) !== String(expectedEntryId)) {
    reason = 'trace-context-entry-mismatch';
  }
  return { admitted: reason === null, reason, evidenceFinality: !segments.length ? 'none'
    : segments.some(segment => segment?.isFinal !== true) ? 'interim' : 'final' };
}

/**
 * Return rank-zero raw evidence first, then only same-rank alternatives from
 * every finalized segment. No candidate is synthesized across ranks or across
 * incomplete segments. The primary transcript is never rewritten.
 */
export function recognitionHypotheses(evidence = {}) {
  if (!isRecognitionEvidenceComplete(evidence)) return [];
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
  if (!segments.length
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
