import { answerVariants, classifyVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';
import { finalizedRecognitionAlternatives, isRecognitionEvidenceComplete } from './recognitionCandidates.js';
import { vocabularyChunkRescueChunks } from './vocabularyChunkRescueAuthority.js';

export const VOCABULARY_SPEECH_CARRIER = 'my answer is';
export const VOCABULARY_SPEECH_CARRIER_CUE = `${VOCABULARY_SPEECH_CARRIER} …`;
const VOCABULARY_SPEECH_CARRIER_TOKENS = Object.freeze(
  safeSpeechTokens(VOCABULARY_SPEECH_CARRIER).map(token => token.value),
);

function vocabularyCarrierSurface(value) {
  const raw = String(value ?? '');
  const tokens = safeSpeechTokens(raw);
  if (tokens.length < VOCABULARY_SPEECH_CARRIER_TOKENS.length) return { raw, surface: raw, removed: false };
  for (let index = 0; index < VOCABULARY_SPEECH_CARRIER_TOKENS.length; index += 1) {
    if (tokens[index].value !== VOCABULARY_SPEECH_CARRIER_TOKENS[index]) return { raw, surface: raw, removed: false };
  }
  return {
    raw,
    surface: raw.slice(tokens[VOCABULARY_SPEECH_CARRIER_TOKENS.length - 1].end).trim(),
    removed: true,
  };
}

function evidenceMetadata(transcript, { attemptId = null, recognitionComplete = false, recognitionSegments = [] } = {}) {
  return {
    primaryTranscript: transcript,
    rawTranscript: transcript,
    displayTranscript: transcript,
    targetRescued: false,
    recognitionSegmentIndex: null,
    recognitionSegmentIndexes: (Array.isArray(recognitionSegments) ? recognitionSegments : [])
      .map((segment, index) => Number.isInteger(segment?.segmentIndex) ? segment.segmentIndex : index),
    attemptId,
    recognitionComplete: !!recognitionComplete,
    asrRank: null,
    matched: false,
    matchedExpected: '',
    observed: '',
    speechMatch: null,
    recognitionAuthority: 'unmatched',
  };
}

function speechMatch(expected, observed, entry, segmentIndex, rank, displayPrimary, segmentIndexes = [], attemptId = null) {
  return findSpeechSurfaceMatch(expected, observed, {
    context: { mode: 'vocabulary', entryId: String(entry?.id || '') },
    recognitionSegmentIndex: segmentIndex,
    recognitionSegmentIndexes: segmentIndexes,
    attemptId,
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

function targetProduction({ entry, activeOccurrence, transcript, segmentIndex, segmentIndexes, attemptId, rank, displayPrimary }) {
  for (const expected of answerVariants(entry, activeOccurrence)) {
    const match = speechMatch(expected, transcript, entry, segmentIndex, rank, displayPrimary, segmentIndexes, attemptId);
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

function targetProductionWithCarrier(options) {
  const rawTranscript = String(options.transcript ?? '');
  const candidate = vocabularyCarrierSurface(rawTranscript);
  const rawMatch = targetProduction({ ...options, transcript: rawTranscript });
  if (rawMatch || !candidate.removed || !candidate.surface) return rawMatch;
  const carriedMatch = targetProduction({ ...options, transcript: candidate.surface });
  if (!carriedMatch) return null;
  return {
    ...carriedMatch,
    match: {
      ...carriedMatch.match,
      rawTranscript,
      displayTranscript: rawTranscript,
    },
    speechCarrier: {
      prefix: VOCABULARY_SPEECH_CARRIER,
      gradingTranscript: candidate.surface,
    },
  };
}

function explicitParaphraseProduction({ entry, activeOccurrence, transcript, recognitionSegments }) {
  const rawTranscript = String(transcript ?? '');
  const candidate = vocabularyCarrierSurface(rawTranscript);
  const gradingTranscript = candidate.removed ? candidate.surface : rawTranscript;
  const observedTokens = safeSpeechTokens(gradingTranscript).map(token => token.value);
  if (!observedTokens.length) return null;
  for (const expected of Array.isArray(entry?.paraphrases) ? entry.paraphrases : []) {
    const segmentIndex = primarySegmentIndexFor(expected, entry, recognitionSegments);
    const match = speechMatch(expected, gradingTranscript, entry, segmentIndex, 0, false);
    if (!match || (!candidate.removed && match.authority !== 'explicit-equivalence')) continue;
    const matchedTokens = safeSpeechTokens(match.observed).map(token => token.value);
    // Preserve the complete-surface rule: a carrier may precede one accepted
    // paraphrase, but any additional answer tokens still reject it.
    if (observedTokens.length !== matchedTokens.length
      || observedTokens.some((token, index) => token !== matchedTokens[index])) continue;
    const classified = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: expected });
    if (classified.type !== 'paraphrase') continue;
    return {
      ...classified,
      matchedText: expected,
      match: candidate.removed ? {
        ...match,
        rawTranscript,
        displayTranscript: rawTranscript,
      } : match,
      ...(candidate.removed ? {
        speechCarrier: {
          prefix: VOCABULARY_SPEECH_CARRIER,
          gradingTranscript,
        },
      } : {}),
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
  segmentIndexes = [],
  attemptId = null,
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
    recognitionSegmentIndexes: segmentIndexes,
    attemptId,
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
      recognitionSegmentIndexes: segmentIndexes,
      attemptId,
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
export function classifyVocabularySpeechAnswer({ entry, activeOccurrence = null, transcript = '', recognitionSegments = [], recognitionComplete, completionState, attemptId = null, correction = false } = {}) {
  const primaryTranscript = String(transcript ?? '');
  const recognitionEvidence = {
    transcript: primaryTranscript,
    primaryTranscript,
    recognitionSegments,
    recognitionComplete,
    completionState,
  };
  const completeEvidence=isRecognitionEvidenceComplete(recognitionEvidence)
    && Array.isArray(recognitionSegments)
    && recognitionSegments.length>0
    && recognitionSegments.every(segment=>segment?.isFinal===true);
  const metadata=evidenceMetadata(primaryTranscript,{attemptId,recognitionComplete:completeEvidence,recognitionSegments});
  const hypotheses = finalizedRecognitionAlternatives(recognitionEvidence);
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
      recognitionSegmentIndexes: metadata.recognitionSegmentIndexes,
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
      recognitionSegmentIndexes: metadata.recognitionSegmentIndexes,
      asrRank: 0,
      recognitionAuthority: match?.authority === 'explicit-equivalence' ? 'explicit-equivalence' : 'exact',
      speechMatch: match,
    };
  }

  const contained = targetProductionWithCarrier({
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

  if (!correction) {
    const paraphrase = explicitParaphraseProduction({
      entry,
      activeOccurrence,
      transcript: primaryTranscript,
      recognitionSegments,
    });
    if (paraphrase) {
      return {
        ...paraphrase,
        ...metadata,
        matched: true,
        matchedExpected: paraphrase.matchedText,
        observed: paraphrase.match.observed,
        rawTranscript: primaryTranscript,
        displayTranscript: primaryTranscript,
        recognitionSegmentIndex: paraphrase.match.recognitionSegmentIndex,
        asrRank: 0,
        recognitionAuthority: paraphrase.match.authority === 'explicit-equivalence' ? 'explicit-equivalence' : 'exact',
        targetRescued: false,
        speechMatch: paraphrase.match,
      };
    }
  }

  for (const candidate of hypotheses) {
    const candidateTranscript = String(candidate.transcript ?? '');
    const accepted = targetProductionWithCarrier({
      entry,
      activeOccurrence,
      transcript: candidateTranscript,
      segmentIndex: candidate.segmentIndex,
      segmentIndexes: candidate.segmentIndexes,
      attemptId,
      rank: candidate.asrRank,
      displayPrimary: true,
    });
    if (!accepted) continue;
    const explicit = accepted.match.authority === 'explicit-equivalence';
    return resultForTarget(accepted, metadata, {
      transcript: candidateTranscript,
      authority: explicit ? 'explicit-equivalence' : 'nbest-exact',
      segmentIndex: candidate.segmentIndex,
      segmentIndexes: candidate.segmentIndexes,
      attemptId,
      rank: candidate.asrRank,
      targetRescued: true,
    });
  }

  const chunkRescued = completeEvidence ? chunkRescueProduction({
    entry,
    activeOccurrence,
    primaryTranscript,
    metadata,
    recognitionSegments,
  }) : null;
  if (chunkRescued) return {
    ...chunkRescued,
    attemptId,
    recognitionComplete: true,
    recognitionSegmentIndexes: [...new Set([
      chunkRescued.supportingPrimaryChunk?.recognitionSegmentIndex,
      chunkRescued.rescuedChunk?.recognitionSegmentIndex,
    ].filter(Number.isInteger))],
  };

  return { type: 'miss', matchedText: '', matchedAuthority: null, ...metadata };
}
