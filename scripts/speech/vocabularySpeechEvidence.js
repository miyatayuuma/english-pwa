import { answerVariants, classifyVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';
import { vocabularyChunkRescueChunks } from './vocabularyChunkRescueAuthority.js';

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

function isStrictMatch(match) {
  return match?.authority === 'exact' || match?.authority === 'explicit-equivalence';
}

function chunkMatch(expected, transcript, entry, segmentIndex, rank) {
  const match = speechMatch(expected, transcript, entry, segmentIndex, rank, false);
  return isStrictMatch(match) ? match : null;
}

function chunkRescueProduction({ entry, activeOccurrence, primaryTranscript, metadata, recognitionSegments }) {
  const chunks = vocabularyChunkRescueChunks(entry);
  if (!chunks) return null;

  const primaryClassification = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: primaryTranscript });
  if (primaryClassification.type === 'paraphrase') return null;

  const primaryMatches = chunks.map((chunk, index) => {
    const segmentIndex = primarySegmentIndexFor(chunk, entry, recognitionSegments);
    const match = chunkMatch(chunk, primaryTranscript, entry, segmentIndex, 0);
    return match ? { index, chunk, match } : null;
  });

  // The curated rule only combines one rank-zero chunk with the opposite
  // chunk from a single lower provider candidate.
  const primaryIndexes = primaryMatches.flatMap((value, index) => value ? [index] : []);
  if (primaryIndexes.length !== 1) return null;
  const primaryIndex = primaryIndexes[0];
  const missingIndex = primaryIndex === 0 ? 1 : 0;
  const primarySupport = primaryMatches[primaryIndex];

  for (const [index, segment] of recognitionSegments.entries()) {
    const segmentIndex = segment.segmentIndex ?? index;
    for (const candidate of segment.alternatives || []) {
      if (!Number.isInteger(candidate.asrRank) || candidate.asrRank <= 0) continue;
      const candidateTranscript = String(candidate.transcript ?? '');
      if (!candidateTranscript) continue;

      // A full answer variant or paraphrase cannot be joined to a canonical
      // chunk from the other candidate surface.
      const candidateClassification = classifyVocabularyAnswer({
        entry,
        activeOccurrence,
        transcript: candidateTranscript,
      });
      if (candidateClassification.type !== 'miss') continue;

      const match = chunkMatch(chunks[missingIndex], candidateTranscript, entry, segmentIndex, candidate.asrRank);
      if (!match) continue;

      const target = classifyVocabularyAnswer({
        entry,
        activeOccurrence,
        transcript: entry.canonical,
      });
      if (target.type !== 'target') return null;

      const recognitionAuthority = 'nbest-chunk-exact';
      const rescuedChunk = {
        index: missingIndex,
        expected: chunks[missingIndex],
        observed: match.observed,
        authority: match.authority,
        ruleId: match.ruleId,
        ruleKind: match.ruleKind,
        recognitionSegmentIndex: segmentIndex,
        asrRank: candidate.asrRank,
        rawTranscript: candidateTranscript,
      };
      const supportingPrimaryChunk = {
        index: primaryIndex,
        expected: chunks[primaryIndex],
        observed: primarySupport.match.observed,
        authority: primarySupport.match.authority,
        ruleId: primarySupport.match.ruleId,
        ruleKind: primarySupport.match.ruleKind,
        recognitionSegmentIndex: primarySupport.match.recognitionSegmentIndex,
        asrRank: 0,
        rawTranscript: primaryTranscript,
      };
      const displayTranscript = metadata.primaryTranscript;

      return {
        ...target,
        ...metadata,
        matched: true,
        matchedExpected: target.matchedText,
        observed: match.observed,
        rawTranscript: candidateTranscript,
        displayTranscript,
        targetRescued: true,
        recognitionSegmentIndex: segmentIndex,
        asrRank: candidate.asrRank,
        recognitionAuthority,
        targetMatchKind: 'chunk-rescued-target',
        rescuedChunk,
        supportingPrimaryChunk,
        chunkRescue: {
          authority: 'nbest-chunk-exact',
          rescuedChunk,
          supportingPrimaryChunk,
        },
        speechMatch: {
          matched: true,
          expected: chunks[missingIndex],
          observed: match.observed,
          authority: match.authority,
          ruleId: match.ruleId,
          ruleKind: match.ruleKind,
          recognitionSegmentIndex: segmentIndex,
          asrRank: candidate.asrRank,
          rawTranscript: candidateTranscript,
          displayTranscript,
        },
      };
    }
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

  const chunkRescued = chunkRescueProduction({
    entry,
    activeOccurrence,
    primaryTranscript,
    metadata,
    recognitionSegments,
  });
  if (chunkRescued) return chunkRescued;

  return { type: 'miss', matchedText: '', matchedAuthority: null, ...metadata };
}
