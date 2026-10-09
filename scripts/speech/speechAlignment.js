import { safeSpeechTokens } from './safeSpeechNormalization.js';
import { resolveSpeechTokenSpan } from './speechEquivalence.js';

export function calcAlignmentF1(referenceCount, recall, precision) {
  if (!referenceCount) return 1;
  if ((recall + precision) <= 0) return 0;
  return (2 * recall * precision) / (recall + precision);
}

function updateCell(scores, backs, row, column, value, step) {
  const current = scores[row][column];
  const currentAction = backs[row][column]?.action;
  if (value > current || (value === current && step.action === 'match' && currentAction !== 'match')) {
    scores[row][column] = value;
    backs[row][column] = step;
  }
}

function alignWindow(referenceTokens, observedTokens, start, end, context, provenance, referenceText, rawTranscript, matchMatrix) {
  const windowTokens = observedTokens.slice(start, end);
  const rowCount = referenceTokens.length;
  const columnCount = windowTokens.length;
  const scores = Array.from({ length: rowCount + 1 }, () => new Array(columnCount + 1).fill(-Infinity));
  const backs = Array.from({ length: rowCount + 1 }, () => new Array(columnCount + 1).fill(null));
  scores[0][0] = 0;

  for (let row = 0; row <= rowCount; row += 1) {
    for (let column = 0; column <= columnCount; column += 1) {
      const score = scores[row][column];
      if (!Number.isFinite(score)) continue;
      if (row < rowCount) {
        updateCell(scores, backs, row + 1, column, score, {
          action: 'skip-reference', previousRow: row, previousColumn: column,
        });
      }
      if (column < columnCount) {
        updateCell(scores, backs, row, column + 1, score, {
          action: 'skip-observed', previousRow: row, previousColumn: column,
        });
      }
      if (row < rowCount && column < columnCount) {
        const resolution = matchMatrix[row][start + column];
        if (resolution) {
          const nextRow = row + resolution.expectedLength;
          const nextColumn = column + resolution.observedLength;
          updateCell(scores, backs, nextRow, nextColumn, score + resolution.expectedLength, {
            action: 'match', previousRow: row, previousColumn: column, resolution,
          });
        }
      }
    }
  }

  const events = [];
  let row = rowCount;
  let column = columnCount;
  while (row || column) {
    const step = backs[row][column];
    if (!step) break;
    if (step.action === 'match') {
      const resolution = step.resolution;
      const referenceStart = step.previousRow;
      const observedStart = step.previousColumn;
      const expectedFirst = referenceTokens[referenceStart];
      const expectedLast = referenceTokens[referenceStart + resolution.expectedLength - 1];
      const observedFirst = windowTokens[observedStart];
      const observedLast = windowTokens[observedStart + resolution.observedLength - 1];
      const expectedTokenIndexes = Array.from({ length: resolution.expectedLength }, (_, offset) => referenceStart + offset);
      events.unshift({
        authority: resolution.authority,
        ruleId: resolution.ruleId,
        ruleKind: resolution.ruleKind,
        displayPolicy: resolution.displayPolicy,
        expectedTokenIndexes,
        observedTokenIndexes: Array.from({ length: resolution.observedLength }, (_, offset) => start + observedStart + offset),
        expectedStart: expectedFirst.start,
        expectedEnd: expectedLast.end,
        observedStart: observedFirst.start,
        observedEnd: observedLast.end,
        expected: referenceText.slice(expectedFirst.start, expectedLast.end),
        observed: rawTranscript.slice(observedFirst.start, observedLast.end),
        recognitionSegmentIndex: provenance.recognitionSegmentIndex ?? null,
        recognitionSegmentIndexes: provenance.recognitionSegmentIndexes || [],
        attemptId: provenance.attemptId ?? null,
        asrRank: Number.isInteger(provenance.asrRank) ? provenance.asrRank : 0,
      });
    }
    row = step.previousRow;
    column = step.previousColumn;
  }

  const matchedReferenceTokenIndexes = events.flatMap(event => event.expectedTokenIndexes).sort((a, b) => a - b);
  const matchedSet = new Set(matchedReferenceTokenIndexes);
  const matchedWords = matchedReferenceTokenIndexes.map(index => referenceTokens[index].value);
  const matchedCounts = new Map();
  for (const word of matchedWords) matchedCounts.set(word, (matchedCounts.get(word) || 0) + 1);
  const missing = referenceTokens.flatMap((token, index) => matchedSet.has(index) ? [] : [token.value]);
  const matchedCount = matchedReferenceTokenIndexes.length;
  const adjustedObservedCount = Math.max(0, columnCount + events.reduce(
    (difference, event) => difference + event.expectedTokenIndexes.length - event.observedTokenIndexes.length,
    0,
  ));
  const recall = rowCount ? matchedCount / rowCount : 1;
  const precision = adjustedObservedCount ? matchedCount / adjustedObservedCount : 1;

  return {
    start,
    end,
    recall,
    precision,
    missing,
    matched: matchedWords,
    matchedCount,
    matchedCounts,
    matchedReferenceTokenIndexes,
    alignment: events,
    observedTokens: windowTokens,
    adjustedObservedCount,
    score: calcAlignmentF1(rowCount, recall, precision),
  };
}

function orderedMatchIntegrity(referenceTokens, observedTokens, context) {
  const mappingsByObservedSpan = new Map();
  for (let observedIndex = 0; observedIndex < observedTokens.length; observedIndex += 1) {
    for (let expectedIndex = 0; expectedIndex < referenceTokens.length; expectedIndex += 1) {
      const resolution = resolveSpeechTokenSpan(referenceTokens, expectedIndex, observedTokens, observedIndex, context);
      if (!resolution) continue;
      const key = `${observedIndex}:${resolution.observedLength}`;
      if (!mappingsByObservedSpan.has(key)) mappingsByObservedSpan.set(key, {
        observedStart: observedIndex,
        observedEnd: observedIndex + resolution.observedLength - 1,
        expectedSpans: [],
      });
      mappingsByObservedSpan.get(key).expectedSpans.push({
        start: expectedIndex,
        end: expectedIndex + resolution.expectedLength - 1,
      });
    }
  }
  const mappings = [...mappingsByObservedSpan.values()];
  const violations = [];
  for (let first = 0; first < mappings.length; first += 1) {
    for (let second = first + 1; second < mappings.length; second += 1) {
      const left = mappings[first];
      const right = mappings[second];
      const earlier = left.observedStart < right.observedStart ? left : right;
      const later = earlier === left ? right : left;
      if (earlier.observedEnd >= later.observedStart) continue;
      const earlierExpectedStart = Math.min(...earlier.expectedSpans.map(span => span.start));
      const laterExpectedEnd = Math.max(...later.expectedSpans.map(span => span.end));
      // Call a reversal only when every possible expected placement of the
      // earlier spoken span follows every placement of the later spoken span.
      if (earlierExpectedStart <= laterExpectedEnd) continue;
      violations.push({
        firstObservedTokenIndexes: Array.from({ length: earlier.observedEnd - earlier.observedStart + 1 }, (_, offset) => earlier.observedStart + offset),
        secondObservedTokenIndexes: Array.from({ length: later.observedEnd - later.observedStart + 1 }, (_, offset) => later.observedStart + offset),
        firstExpectedSpans: earlier.expectedSpans,
        secondExpectedSpans: later.expectedSpans,
      });
    }
  }
  return { valid: violations.length === 0, algorithm: 'definite-token-inversion-v1', violations };
}

function displayTranscript(rawTranscript, alignment, referenceText, referenceTokens) {
  const replacements = [];
  for (const match of alignment) {
    if (match.authority !== 'explicit-equivalence' || match.displayPolicy !== 'expected') continue;
    const expectedStart = referenceTokens[match.expectedTokenIndexes[0]]?.start;
    const expectedEnd = referenceTokens[match.expectedTokenIndexes.at(-1)]?.end;
    if (!Number.isInteger(expectedStart) || !Number.isInteger(expectedEnd)) continue;
    replacements.push({
      start: match.observedStart,
      end: match.observedEnd,
      value: referenceText.slice(expectedStart, expectedEnd),
    });
  }
  let result = rawTranscript;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return result;
}

export function alignSpeech(referenceText, observedText, {
  context = {},
  recognitionSegmentIndex = null,
  recognitionSegmentIndexes = [],
  attemptId = null,
  asrRank = 0,
  fullSpan = false,
} = {}) {
  const reference = String(referenceText ?? '');
  const rawTranscript = String(observedText ?? '');
  const referenceTokens = safeSpeechTokens(reference);
  const observedTokens = safeSpeechTokens(rawTranscript);
  const refCount = referenceTokens.length;
  const provenance = { recognitionSegmentIndex, recognitionSegmentIndexes, attemptId, asrRank };
  const orderIntegrity = orderedMatchIntegrity(referenceTokens, observedTokens, context);

  if (!refCount) {
    return {
      recall: 1,
      precision: 1,
      matched: [],
      missing: [],
      refCount: 0,
      hypTokens: [],
      transcript: '',
      source: rawTranscript.trim(),
      rawTranscript,
      referenceText: reference,
      displayTranscript: rawTranscript,
      matchedCounts: new Map(),
      matchedReferenceTokenIndexes: [],
      referenceTokens,
      alignment: [],
      matchRate: 1,
      orderedMatchIntegrity: orderIntegrity,
    };
  }

  const slack = Math.max(4, Math.ceil(refCount * 0.5));
  const minLength = Math.max(1, Math.max(1, refCount - slack));
  const maxLength = Math.max(minLength, Math.min(observedTokens.length, Math.max(refCount + slack, refCount * 2 || 1)));
  const matchMatrix = referenceTokens.map((_, row) => observedTokens.map((__, column) =>
    resolveSpeechTokenSpan(referenceTokens, row, observedTokens, column, context)));
  let best = alignWindow(referenceTokens, observedTokens, 0, observedTokens.length, context, provenance, reference, rawTranscript, matchMatrix);
  if (!fullSpan && observedTokens.length && minLength <= observedTokens.length) {
    for (let start = 0; start < observedTokens.length; start += 1) {
      for (let length = minLength; length <= maxLength; length += 1) {
        const end = start + length;
        if (end > observedTokens.length) break;
        const candidate = alignWindow(referenceTokens, observedTokens, start, end, context, provenance, reference, rawTranscript, matchMatrix);
        if (candidate.score > best.score
          || (candidate.score === best.score && candidate.recall > best.recall)
          || (candidate.score === best.score && candidate.recall === best.recall && candidate.precision > best.precision)
          || (candidate.score === best.score && candidate.recall === best.recall && candidate.precision === best.precision
            && Math.abs(length - refCount) < Math.abs((best.end - best.start) - refCount))) {
          best = candidate;
        }
      }
    }
  }

  const selectedTokens = observedTokens.slice(best.start, best.end);
  const selectedTranscript = selectedTokens.length
    ? rawTranscript.slice(selectedTokens[0].start, selectedTokens.at(-1).end)
    : '';
  const matchRate = calcAlignmentF1(refCount, best.recall, best.precision);
  return {
    recall: best.recall,
    precision: best.precision,
    matched: best.matched,
    missing: best.missing,
    refCount,
    hypTokens: selectedTokens.map(token => token.value),
    transcript: selectedTranscript,
    source: rawTranscript.trim(),
    rawTranscript,
    referenceText: reference,
    displayTranscript: displayTranscript(rawTranscript, best.alignment, reference, referenceTokens),
    matchedCounts: best.matchedCounts,
    matchedReferenceTokenIndexes: best.matchedReferenceTokenIndexes,
    referenceTokens,
    alignment: best.alignment,
    matchRate,
    orderedMatchIntegrity: orderIntegrity,
  };
}

export function findSpeechSurfaceMatch(expectedText, observedText, {
  context = {},
  recognitionSegmentIndex = null,
  recognitionSegmentIndexes = [],
  attemptId = null,
  asrRank = 0,
  displayPrimary = false,
} = {}) {
  const expected = String(expectedText ?? '');
  const observed = String(observedText ?? '');
  const expectedTokens = safeSpeechTokens(expected);
  const observedTokens = safeSpeechTokens(observed);
  if (!expectedTokens.length || !observedTokens.length) return null;

  for (let start = 0; start < observedTokens.length; start += 1) {
    const events = [];
    let expectedIndex = 0;
    let observedIndex = start;
    while (expectedIndex < expectedTokens.length && observedIndex < observedTokens.length) {
      const resolution = resolveSpeechTokenSpan(expectedTokens, expectedIndex, observedTokens, observedIndex, context);
      if (!resolution) break;
      events.push({
        ...resolution,
        expectedStartIndex: expectedIndex,
        observedStartIndex: observedIndex,
        recognitionSegmentIndex,
        recognitionSegmentIndexes,
        attemptId,
        asrRank,
      });
      expectedIndex += resolution.expectedLength;
      observedIndex += resolution.observedLength;
    }
    if (expectedIndex !== expectedTokens.length) continue;

    const startToken = observedTokens[start];
    const endToken = observedTokens[observedIndex - 1];
    const observedSurface = observed.slice(startToken.start, endToken.end);
    const firstEquivalence = events.find(event => event.authority === 'explicit-equivalence');
    const display = displayPrimary && firstEquivalence?.displayPolicy === 'expected'
      ? `${observed.slice(0, startToken.start)}${expected}${observed.slice(endToken.end)}`
      : observed;
    const authority = firstEquivalence ? 'explicit-equivalence' : 'exact';
    return {
      matched: true,
      expected,
      observed: observedSurface,
      authority,
      ruleId: firstEquivalence?.ruleId ?? null,
      ruleKind: firstEquivalence?.ruleKind ?? null,
      recognitionSegmentIndex,
      recognitionSegmentIndexes,
      attemptId,
      asrRank,
      rawTranscript: observed,
      displayTranscript: display,
      alignment: events,
    };
  }
  return null;
}
