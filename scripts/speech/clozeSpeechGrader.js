import { alignSpeech, calcAlignmentF1 } from './speechAlignment.js';
import { resolveSpeechTokenSpan } from './speechEquivalence.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';

const CLOZE_PASS_THRESHOLD = 0.7;
const NEGATION_TOKENS = new Set([
  'not', "n't", 'never', 'no', 'neither', 'nor', 'none', 'nothing', 'nobody', 'nowhere', 'without',
  'hardly', 'scarcely', 'barely', 'dont', "don't", 'doesnt', "doesn't", 'didnt', "didn't", 'cant', "can't",
  'cannot', 'couldnt', "couldn't", 'wouldnt', "wouldn't", 'shouldnt', "shouldn't", 'mustnt', "mustn't",
  'wont', "won't", 'isnt', "isn't", 'arent', "aren't", 'wasnt', "wasn't", 'werent', "weren't",
  'havent', "haven't", 'hasnt', "hasn't", 'hadnt', "hadn't", 'shant', "shan't", 'aint', "ain't",
]);
const MOVABLE_ADVERBS = new Set([
  'never', 'always', 'often', 'usually', 'sometimes', 'already', 'just', 'still', 'also', 'really', 'even',
  'probably', 'possibly', 'certainly', 'perhaps', 'maybe',
]);
const AUXILIARIES = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
]);

function alignmentProvenance(alignment) {
  const event = (alignment?.alignment || []).find(item => item?.expectedTokenIndexes?.length || item?.observedTokenIndexes?.length);
  return {
    recognitionSegmentIndex: event?.recognitionSegmentIndex ?? null,
    recognitionSegmentIndexes: event?.recognitionSegmentIndexes || [],
    attemptId: event?.attemptId ?? null,
    asrRank: Number.isInteger(event?.asrRank) ? event.asrRank : 0,
  };
}

function singleTokenEquivalent(expectedTokens, expectedIndex, observedTokens, observedIndex) {
  const match = resolveSpeechTokenSpan(expectedTokens, expectedIndex, observedTokens, observedIndex, { mode: 'cloze' });
  return match?.expectedLength === 1 && match?.observedLength === 1;
}

function isConservativeAdverbSwap(left, right) {
  return (MOVABLE_ADVERBS.has(left) && AUXILIARIES.has(right))
    || (AUXILIARIES.has(left) && MOVABLE_ADVERBS.has(right));
}

// Cloze may accept one or a few meaning-preserving adverb/auxiliary transpositions.
// Vocabulary and ordinary Read keep their existing strict ordered-match rule.
function isAllowedClozeMinorOrderVariant(referenceText, transcript) {
  const expected = safeSpeechTokens(referenceText);
  const observed = safeSpeechTokens(transcript);
  if (!expected.length || expected.length !== observed.length) return false;
  const maxSwaps = Math.max(1, Math.floor(expected.length * 0.04));
  let swaps = 0;
  let index = 0;
  while (index < expected.length) {
    if (singleTokenEquivalent(expected, index, observed, index)) {
      index += 1;
      continue;
    }
    if (index + 1 >= expected.length || !isConservativeAdverbSwap(expected[index].value, expected[index + 1].value)
      || !singleTokenEquivalent(expected, index, observed, index + 1)
      || !singleTokenEquivalent(expected, index + 1, observed, index)) return false;
    swaps += 1;
    if (swaps > maxSwaps) return false;
    index += 2;
  }
  return swaps > 0;
}

function clozeScore(alignment) {
  const score = calcAlignmentF1(alignment?.refCount || 0, alignment?.recall || 0, alignment?.precision || 0);
  if (alignment?.orderedMatchIntegrity?.valid !== false || isAllowedClozeMinorOrderVariant(alignment?.referenceText || '', alignment?.rawTranscript || '')) {
    return score;
  }
  return 0;
}

function preservesExpectedNegation(alignment) {
  const referenceTokens = alignment?.referenceTokens || [];
  const requiredIndexes = referenceTokens.flatMap((token, index) => NEGATION_TOKENS.has(token.value) ? [index] : []);
  if (!requiredIndexes.length) return true;
  if (isAllowedClozeMinorOrderVariant(alignment?.referenceText || '', alignment?.rawTranscript || '')) return true;
  const matched = new Set(alignment?.matchedReferenceTokenIndexes || []);
  return requiredIndexes.every(index => matched.has(index));
}

function prefixLength(referenceTokens, observedTokens, observedStart) {
  let expectedIndex = 0;
  let observedIndex = observedStart;
  while (expectedIndex < referenceTokens.length && observedIndex < observedTokens.length) {
    const match = resolveSpeechTokenSpan(referenceTokens, expectedIndex, observedTokens, observedIndex, { mode: 'cloze' });
    if (!match) break;
    expectedIndex += match.expectedLength;
    observedIndex += match.observedLength;
  }
  return expectedIndex;
}

function isRestartBoundary(rawTranscript, previousToken, token) {
  if (!previousToken) return false;
  const gap = rawTranscript.slice(previousToken.end, token.start);
  if (/[.!?…—–]/u.test(gap)) return true;
  const recentContext = rawTranscript.slice(Math.max(0, previousToken.start - 36), token.start);
  return /\b(?:i mean|actually|sorry|rather|no)\s*,?\s*$/iu.test(recentContext);
}

function expectedIncludesRepeatedChunk(referenceTokens, transcriptTokens, start, length) {
  for (let index = 0; index + length * 2 <= referenceTokens.length; index += 1) {
    let same = true;
    for (let offset = 0; offset < length * 2; offset += 1) {
      if (referenceTokens[index + offset].value !== transcriptTokens[start + (offset % length)].value) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

function collapseImmediateRepetitions(referenceText, transcript) {
  const tokens = safeSpeechTokens(transcript);
  const referenceTokens = safeSpeechTokens(referenceText);
  const kept = [];
  let index = 0;
  while (index < tokens.length) {
    let repeatedLength = 0;
    const largest = Math.min(4, Math.floor((tokens.length - index) / 2));
    for (let length = largest; length >= 1; length -= 1) {
      const repeated = tokens.slice(index, index + length).every((token, offset) =>
        token.value === tokens[index + length + offset]?.value);
      if (repeated) {
        repeatedLength = length;
        break;
      }
    }
    if (repeatedLength) {
      if (expectedIncludesRepeatedChunk(referenceTokens, tokens, index, repeatedLength)) {
        kept.push(tokens[index]);
        index += 1;
        continue;
      }
      // Keep the second delivery as the corrected evidence and discard only
      // the immediately repeated earlier delivery. No token is synthesized.
      kept.push(...tokens.slice(index + repeatedLength, index + repeatedLength * 2));
      index += repeatedLength * 2;
      continue;
    }
    kept.push(tokens[index]);
    index += 1;
  }
  return {
    transcript: kept.map(token => token.raw).join(' '),
    tokens: kept,
  };
}

function alignLocalReproduction(referenceText, sourceTranscript, rawStartOffset, provenance) {
  const context = { mode: 'cloze' };
  const collapsed = collapseImmediateRepetitions(referenceText, sourceTranscript);
  const scoringTranscript = collapsed.transcript || String(sourceTranscript || '');
  const window = alignSpeech(referenceText, scoringTranscript, { context, ...provenance });
  const selectedTranscript = String(window.transcript || scoringTranscript || '');
  const selectedIndexes = (window.alignment || []).flatMap(event => event.observedTokenIndexes || []);
  const firstIndex = selectedIndexes.length ? Math.min(...selectedIndexes) : 0;
  const lastIndex = selectedIndexes.length ? Math.max(...selectedIndexes) : collapsed.tokens.length - 1;
  const firstObservedStart = collapsed.tokens[firstIndex]?.start ?? 0;
  const lastObservedEnd = collapsed.tokens[lastIndex]?.end ?? String(sourceTranscript || '').length;
  const local = alignSpeech(referenceText, selectedTranscript, { context, ...provenance });
  return {
    alignment: local,
    transcript: selectedTranscript,
    start: rawStartOffset + firstObservedStart,
    end: rawStartOffset + lastObservedEnd,
    score: clozeScore(local),
  };
}

function selectClozeReproduction(alignment) {
  const referenceText = String(alignment?.referenceText || '');
  const rawTranscript = String(alignment?.rawTranscript || alignment?.source || '');
  const provenance = alignmentProvenance(alignment);
  const firstEventStart = Math.min(...(alignment?.alignment || []).map(event => event?.observedStart).filter(Number.isFinite));
  const base = alignLocalReproduction(referenceText, String(alignment?.transcript || rawTranscript), Number.isFinite(firstEventStart) ? firstEventStart : 0, provenance);
  const candidates = [base];
  const referenceTokens = safeSpeechTokens(referenceText);
  const observedTokens = safeSpeechTokens(rawTranscript);

  for (let index = 1; index < observedTokens.length; index += 1) {
    const previousToken = observedTokens[index - 1];
    const token = observedTokens[index];
    const matchedPrefixLength = prefixLength(referenceTokens, observedTokens, index);
    const hasReferencePrefix = matchedPrefixLength >= 3;
    const isSentenceRestart = matchedPrefixLength >= 1 && isRestartBoundary(rawTranscript, previousToken, token);
    if (!hasReferencePrefix && !isSentenceRestart) continue;
    const suffix = rawTranscript.slice(token.start);
    const candidate = alignLocalReproduction(referenceText, suffix, token.start, provenance);
    if (isSentenceRestart || candidate.score >= CLOZE_PASS_THRESHOLD) candidates.push(candidate);
  }

  // A qualifying later restart takes precedence, even if its content omits a
  // hidden target or negation. That prevents an earlier false start from
  // masking an incomplete final correction.
  return candidates.reduce((selected, candidate) => candidate.start > selected.start ? candidate : selected, base);
}

function targetTokenIndexes(alignment, target) {
  const start = Number(target?.start);
  const end = Number(target?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return alignment.referenceTokens.flatMap((token, index) => token.end > start && token.start < end ? [index] : []);
}

function targetIsReproducedInPlace(alignment, tokenIndexes) {
  if (!tokenIndexes.length) return false;
  const targetIndexSet = new Set(tokenIndexes);
  const events = (alignment?.alignment || [])
    .filter(event => event.expectedTokenIndexes.some(index => targetIndexSet.has(index)))
    .sort((left, right) => left.expectedTokenIndexes[0] - right.expectedTokenIndexes[0]);
  if (!events.length) return false;

  let nextExpectedIndex = tokenIndexes[0];
  let nextObservedIndex = null;
  for (const event of events) {
    const expectedIndexes = event.expectedTokenIndexes;
    const observedIndexes = event.observedTokenIndexes;
    if (!expectedIndexes.length || !observedIndexes.length
      || expectedIndexes.some(index => !targetIndexSet.has(index))
      || expectedIndexes[0] !== nextExpectedIndex) return false;
    if (nextObservedIndex !== null && observedIndexes[0] !== nextObservedIndex) return false;
    nextExpectedIndex = expectedIndexes.at(-1) + 1;
    nextObservedIndex = observedIndexes.at(-1) + 1;
  }
  return nextExpectedIndex === tokenIndexes.at(-1) + 1;
}

export function gradeClozeSpeech(alignment, context) {
  const targets = Array.isArray(context?.targets) ? context.targets : [];
  const active = targets.length > 0
    && String(context?.sentence || '') === String(alignment?.referenceText || '');
  const reproduction = active ? selectClozeReproduction(alignment) : {
    alignment,
    transcript: String(alignment?.transcript || ''),
    start: 0,
    end: String(alignment?.transcript || '').length,
    score: clozeScore(alignment),
  };
  const gradedAlignment = reproduction.alignment || alignment;
  const matchedReference = new Set(gradedAlignment?.matchedReferenceTokenIndexes || []);
  const targetResults = targets.map(target => {
    const tokenIndexes = targetTokenIndexes(gradedAlignment, target);
    const events = (gradedAlignment?.alignment || []).filter(event => event.expectedTokenIndexes.some(index => tokenIndexes.includes(index)));
    const matched = tokenIndexes.length > 0
      && tokenIndexes.every(index => matchedReference.has(index))
      && targetIsReproducedInPlace(gradedAlignment, tokenIndexes);
    const explicit = events.find(event => event.authority === 'explicit-equivalence');
    return {
      entryId: String(target?.entry_id || ''),
      expected: String(target?.surface || ''),
      matched,
      authority: matched ? (explicit ? 'explicit-equivalence' : 'exact') : 'unmatched',
      ruleId: matched ? (explicit?.ruleId || null) : null,
      ruleKind: matched ? (explicit?.ruleKind || null) : null,
      recognitionSegmentIndex: matched ? (explicit?.recognitionSegmentIndex ?? events[0]?.recognitionSegmentIndex ?? null) : null,
      asrRank: matched ? (explicit?.asrRank ?? events[0]?.asrRank ?? 0) : null,
      rawTranscript: String(alignment?.rawTranscript || ''),
      displayTranscript: String(alignment?.displayTranscript || alignment?.rawTranscript || ''),
    };
  });
  const hasTargets = targetResults.length > 0;
  const allTargetsMatched = hasTargets && targetResults.every(target => target.matched);
  const orderedMatchIntegrity = gradedAlignment?.orderedMatchIntegrity || { valid: true, violations: [] };
  const negationPreserved = preservesExpectedNegation(gradedAlignment);
  return {
    active: hasTargets && active,
    overallScore: negationPreserved ? reproduction.score : 0,
    orderedMatchIntegrity,
    rawOrderedMatchIntegrity: alignment?.orderedMatchIntegrity || { valid: true, violations: [] },
    negationPreserved,
    repair: {
      selectedTranscript: reproduction.transcript,
      start: reproduction.start,
      end: reproduction.end,
      latestRestartSelected: reproduction.start > 0,
    },
    targets: targetResults,
    allTargetsMatched,
  };
}

// The Read thresholds remain unchanged; Cloze adds only its hidden-target
// completion requirement to the result owned by the Read-facing flow.
export function applyClozeTargetRequirement(evaluation, clozeResult, currentLevel = 0) {
  if (!evaluation || !clozeResult?.active || clozeResult.allTargetsMatched) return evaluation;
  const priorLevel = Number.isFinite(Number(currentLevel)) ? Math.max(0, Math.floor(Number(currentLevel))) : 0;
  const candidate = Number.isFinite(Number(evaluation.candidate)) ? Math.max(0, Math.floor(Number(evaluation.candidate))) : priorLevel;
  return {
    ...evaluation,
    candidate: Math.min(candidate, priorLevel),
    noHintSuccess: false,
    perfectNoHint: false,
    pass: false,
  };
}
