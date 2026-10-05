import { answerVariants, classifyVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';

function evidenceMetadata(transcript) {
  return {
    primaryTranscript: transcript,
    rawTranscript: transcript,
    displayTranscript: transcript,
    targetRescued: false,
    recognitionSegmentIndex: null,
    asrRank: null,
    matched: false,
    matchedExpected: '',
    observed: '',
    speechMatch: null,
    recognitionAuthority: 'unmatched',
  };
}

function speechMatch(expected, observed, entry, segmentIndex, rank, displayPrimary) {
  return findSpeechSurfaceMatch(expected, observed, {
    context: { mode: 'vocabulary', entryId: String(entry?.id || '') },
    recognitionSegmentIndex: segmentIndex,
    asrRank: rank,
    displayPrimary,
  });
}

function primarySegmentIndexFor(expected, entry, recognitionSegments) {
  if (!expected) return null;
  for (const [index, segment] of recognitionSegments.entries()) {
    const segmentIndex = segment.segmentIndex ?? index;
    for (const candidate of segment.alternatives || []) {
      if (candidate.asrRank !== 0) continue;
      if (speechMatch(expected, String(candidate.transcript ?? ''), entry, segmentIndex, 0, false)) return segmentIndex;
    }
  }
  return null;
}

function targetProduction({ entry, activeOccurrence, transcript, segmentIndex, rank, displayPrimary }) {
  for (const expected of answerVariants(entry, activeOccurrence)) {
    const match = speechMatch(expected, transcript, entry, segmentIndex, rank, displayPrimary);
    if (!match) continue;
    const classified = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: expected });
    if (classified.type !== 'target') continue;
    return {
      ...classified,
      matchedText: expected,
      match,
      targetMatchKind: match.observed === String(transcript).trim() ? 'full-surface' : 'contained-target',
    };
  }
  return null;
}

function resultForTarget(target, metadata, {
  transcript,
  authority,
  segmentIndex,
  rank,
  targetRescued = false,
  primaryDisplay = false,
} = {}) {
  const match = target.match;
  const explicit = match?.authority === 'explicit-equivalence';
  const recognitionAuthority = explicit ? 'explicit-equivalence' : authority;
  const displayTranscript = primaryDisplay
    ? (match?.displayTranscript || transcript)
    : (explicit && match?.displayTranscript !== match?.rawTranscript ? match.displayTranscript : metadata.primaryTranscript);
  return {
    ...target,
    ...metadata,
    matched: true,
    matchedExpected: target.matchedText,
    observed: match?.observed || transcript,
    rawTranscript: String(transcript ?? ''),
    displayTranscript,
    targetRescued,
    recognitionSegmentIndex: segmentIndex ?? null,
    asrRank: rank ?? 0,
    recognitionAuthority,
    speechMatch: match ? {
      matched: true,
      expected: target.matchedText,
      observed: match.observed,
      authority: match.authority,
      ruleId: match.ruleId,
      ruleKind: match.ruleKind,
      recognitionSegmentIndex: segmentIndex ?? null,
      asrRank: rank ?? 0,
      rawTranscript: String(transcript ?? ''),
      displayTranscript,
    } : null,
  };
}

function exactVocabularyMatch(classification, transcript, entry, activeOccurrence, segmentIndex) {
  const match = speechMatch(classification.matchedText, transcript, entry, segmentIndex, 0, true);
  if (match) return { match, authority: 'exact' };
  // Keep the existing Vocabulary surface normalizer authoritative for exact
  // primary answers; no new semantic answer variants are inferred here.
  return {
    authority: 'exact',
    match: {
      matched: true,
      expected: classification.matchedText,
      observed: transcript,
      authority: 'exact',
      ruleId: null,
      ruleKind: null,
      recognitionSegmentIndex: segmentIndex ?? null,
      asrRank: 0,
      rawTranscript: transcript,
      displayTranscript: transcript,
    },
  };
}

export function isTargetSpeechProduction(transcript, expected) {
  return !!findSpeechSurfaceMatch(expected, transcript, { context: { mode: 'vocabulary' } });
}

// Vocabulary owns TARGET/PARAPHRASE/MISS and N-best authority. Each candidate
// remains an independent provider result; this function never joins candidates.
export function classifyVocabularySpeechAnswer({ entry, activeOccurrence = null, transcript = '', recognitionSegments = [], correction = false } = {}) {
  const primaryTranscript = String(transcript ?? '');
  const metadata = evidenceMetadata(primaryTranscript);
  const primary = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: primaryTranscript });
  const primarySegmentIndex = primarySegmentIndexFor(primary.matchedText, entry, recognitionSegments);

  if (primary.type === 'target') {
    const { match } = exactVocabularyMatch(primary, primaryTranscript, entry, activeOccurrence, primarySegmentIndex);
    const result = {
      ...primary,
      ...metadata,
      matched: true,
      matchedExpected: primary.matchedText,
      observed: match.observed,
      rawTranscript: primaryTranscript,
      displayTranscript: match.displayTranscript,
      recognitionSegmentIndex: primarySegmentIndex,
      asrRank: 0,
      recognitionAuthority: 'exact',
      speechMatch: match,
      targetMatchKind: 'full-surface',
    };
    return result;
  }

  if (primary.type === 'paraphrase' && !correction) {
    const match = speechMatch(primary.matchedText, primaryTranscript, entry, primarySegmentIndex, 0, true);
    return {
      ...primary,
      ...metadata,
      matched: !!match,
      matchedExpected: primary.matchedText,
      observed: match?.observed || primaryTranscript,
      recognitionSegmentIndex: primarySegmentIndex,
      asrRank: 0,
      recognitionAuthority: match?.authority === 'explicit-equivalence' ? 'explicit-equivalence' : 'exact',
      speechMatch: match,
    };
  }

  const contained = targetProduction({
    entry,
    activeOccurrence,
    transcript: primaryTranscript,
    segmentIndex: primarySegmentIndex,
    rank: 0,
    displayPrimary: true,
  });
  if (contained) {
    const containedSegmentIndex = primarySegmentIndexFor(contained.matchedText, entry, recognitionSegments);
    return resultForTarget(contained, metadata, {
      transcript: primaryTranscript,
      authority: 'exact',
      segmentIndex: containedSegmentIndex,
      rank: 0,
      primaryDisplay: true,
    });
  }

  for (const [index, segment] of recognitionSegments.entries()) {
    for (const candidate of segment.alternatives || []) {
      if (!Number.isInteger(candidate.asrRank) || candidate.asrRank <= 0) continue;
      const candidateTranscript = String(candidate.transcript ?? '');
      const accepted = targetProduction({
        entry,
        activeOccurrence,
        transcript: candidateTranscript,
        segmentIndex: segment.segmentIndex ?? index,
        rank: candidate.asrRank,
        displayPrimary: true,
      });
      if (!accepted) continue;
      const explicit = accepted.match.authority === 'explicit-equivalence';
      return resultForTarget(accepted, metadata, {
        transcript: candidateTranscript,
        authority: explicit ? 'explicit-equivalence' : 'nbest-exact',
        segmentIndex: segment.segmentIndex ?? index,
        rank: candidate.asrRank,
        targetRescued: true,
      });
    }
  }

  return { type: 'miss', matchedText: '', matchedAuthority: null, ...metadata };
}
