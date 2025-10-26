import { appendStableFinal, dedupeRuns, approxTokensMatch, toks, mergeCompoundWords } from '../utils/text.js';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function isRecognitionSupported() {
  return !!SR;
}

export function calcMatchScore(refCount, recall, precision) {
  if (!refCount) return 1;
  if ((recall + precision) <= 0) return 0;
  return (2 * recall * precision) / (recall + precision);
}

function cloneCountMap(map) {
  const out = new Map();
  if (!map) return out;
  for (const [key, value] of map) {
    out.set(key, value);
  }
  return out;
}

function getTokenSpans(enElement) {
  if (enElement && typeof enElement.querySelectorAll === 'function') {
    return Array.from(enElement.querySelectorAll('.tok'));
  }
  if (typeof document !== 'undefined') {
    return Array.from(document.querySelectorAll('.en .tok'));
  }
  return [];
}

function getComposeNodes(getComposeNodesFn) {
  if (typeof getComposeNodesFn !== 'function') return [];
  const nodes = getComposeNodesFn();
  return Array.isArray(nodes) ? nodes : [];
}

function clearHighlightInternal(enElement, getComposeNodesFn) {
  const spans = getTokenSpans(enElement);
  for (const sp of spans) {
    sp.classList.remove('hit');
    sp.classList.remove('miss');
  }
  const composeNodes = getComposeNodes(getComposeNodesFn);
  for (const node of composeNodes) {
    const nodeEl = node && node.el;
    if (nodeEl && typeof nodeEl.classList !== 'undefined') {
      nodeEl.classList.remove('hit');
      nodeEl.classList.remove('miss');
    }
  }
}

function matchAndHighlightInternal(refText, hypText, enElement, getComposeNodesFn) {
  const refTokensRaw = toks(refText);
  const hypTokensRaw = toks(hypText);
  const refTokens = mergeCompoundWords(refTokensRaw, new Set(hypTokensRaw));
  const hypTokensMerged = mergeCompoundWords(hypTokensRaw, new Set(refTokens));
  const hypTokens = dedupeRuns(hypTokensMerged);

  const refCounts = new Map();
  const refOrder = [];
  for (const token of refTokens) {
    if (!refCounts.has(token)) {
      refOrder.push(token);
    }
    refCounts.set(token, (refCounts.get(token) || 0) + 1);
  }

  function evaluateRangeStatic(start, end) {
    const remainLocal = new Map(refCounts);
    const matchedCountsLocal = new Map();
    const matchedWordsLocal = [];
    let matchedCountLocal = 0;
    for (let i = start; i < end; i++) {
      const token = hypTokens[i];
      if (!token) continue;
      let matchKey = '';
      if ((remainLocal.get(token) || 0) > 0) {
        matchKey = token;
      } else {
        for (const key of refOrder) {
          if ((remainLocal.get(key) || 0) > 0 && approxTokensMatch(key, token)) {
            matchKey = key;
            break;
          }
        }
      }
      if (matchKey) {
        const nextRemain = (remainLocal.get(matchKey) || 0) - 1;
        if (nextRemain > 0) {
          remainLocal.set(matchKey, nextRemain);
        } else {
          remainLocal.delete(matchKey);
        }
        matchedCountsLocal.set(matchKey, (matchedCountsLocal.get(matchKey) || 0) + 1);
        matchedWordsLocal.push(matchKey);
        matchedCountLocal += 1;
      }
    }
    const missingLocal = [];
    for (const [key, count] of remainLocal) {
      for (let i = 0; i < count; i++) {
        missingLocal.push(key);
      }
    }
    const windowLen = Math.max(0, end - start);
    const recall = refTokens.length ? matchedCountLocal / refTokens.length : 1;
    const precision = windowLen ? matchedCountLocal / windowLen : 1;
    return {
      start,
      end,
      recall,
      precision,
      missing: missingLocal,
      matchedWords: matchedWordsLocal,
      matchedCount: matchedCountLocal,
      matchedCounts: matchedCountsLocal,
      length: windowLen,
    };
  }

  let best = evaluateRangeStatic(0, hypTokens.length);
  const refLen = refTokens.length;
  const slack = Math.max(4, Math.ceil(refLen * 0.5));
  const minLen = Math.max(1, refLen ? Math.max(1, refLen - slack) : 1);
  const maxLen = Math.max(
    minLen,
    Math.min(hypTokens.length, Math.max(refLen + slack, refLen * 2 || 1))
  );
  const assignments = new Array(hypTokens.length).fill(null);
  const remain = new Map();
  const matchedCountsRolling = new Map();
  let matchedCountRolling = 0;
  let currentStart = 0;
  let currentEnd = 0;
  let unmatchedQueue = [];
  const unmatchedSet = new Set();

  function resetRemain() {
    remain.clear();
    for (const [key, count] of refCounts) {
      remain.set(key, count);
    }
  }

  function addToUnmatched(index) {
    if (unmatchedSet.has(index)) return;
    unmatchedSet.add(index);
    unmatchedQueue.push(index);
  }

  function assignMatch(index) {
    const token = hypTokens[index];
    if (!token) {
      assignments[index] = null;
      return false;
    }
    let matchKey = '';
    const exactRemain = remain.get(token) || 0;
    if (exactRemain > 0) {
      matchKey = token;
    } else {
      for (const key of refOrder) {
        const available = remain.get(key) || 0;
        if (available > 0 && approxTokensMatch(key, token)) {
          matchKey = key;
          break;
        }
      }
    }
    if (!matchKey) {
      assignments[index] = null;
      return false;
    }
    const prevRemain = remain.get(matchKey) || 0;
    const nextRemain = prevRemain - 1;
    if (nextRemain > 0) {
      remain.set(matchKey, nextRemain);
    } else {
      remain.delete(matchKey);
    }
    const prevMatched = matchedCountsRolling.get(matchKey) || 0;
    matchedCountsRolling.set(matchKey, prevMatched + 1);
    assignments[index] = matchKey;
    matchedCountRolling += 1;
    if (unmatchedSet.has(index)) {
      unmatchedSet.delete(index);
    }
    return true;
  }

  function retryUnmatched() {
    if (!unmatchedQueue.length) return;
    const nextQueue = [];
    for (const idx of unmatchedQueue) {
      if (!unmatchedSet.has(idx)) continue;
      if (idx < currentStart || idx >= currentEnd) {
        unmatchedSet.delete(idx);
        continue;
      }
      if (assignments[idx]) {
        unmatchedSet.delete(idx);
        continue;
      }
      if (assignMatch(idx)) {
        continue;
      }
      nextQueue.push(idx);
    }
    unmatchedQueue = nextQueue;
  }

  function addTokenToEnd(index) {
    if (index !== currentEnd) {
      currentEnd = index;
    }
    const matched = assignMatch(index);
    if (!matched) {
      addToUnmatched(index);
    }
    currentEnd = index + 1;
  }

  function releaseIndex(index) {
    const matchKey = assignments[index];
    if (matchKey) {
      const prevMatched = matchedCountsRolling.get(matchKey) || 0;
      const nextMatched = prevMatched - 1;
      if (nextMatched > 0) {
        matchedCountsRolling.set(matchKey, nextMatched);
      } else {
        matchedCountsRolling.delete(matchKey);
      }
      const remainVal = (remain.get(matchKey) || 0) + 1;
      remain.set(matchKey, remainVal);
      matchedCountRolling -= 1;
    }
    assignments[index] = null;
    if (unmatchedSet.has(index)) {
      unmatchedSet.delete(index);
    }
  }

  function removeFromStart() {
    if (currentStart >= currentEnd) return;
    const index = currentStart;
    releaseIndex(index);
    currentStart += 1;
    retryUnmatched();
  }

  function removeFromEnd() {
    if (currentEnd <= currentStart) return;
    const index = currentEnd - 1;
    releaseIndex(index);
    currentEnd -= 1;
    retryUnmatched();
  }

  function snapshotCurrentWindow(start, end) {
    const missing = [];
    for (const [key, count] of remain) {
      for (let i = 0; i < count; i++) {
        missing.push(key);
      }
    }
    const matchedWords = [];
    for (let i = start; i < end; i++) {
      const key = assignments[i];
      if (key) matchedWords.push(key);
    }
    const windowLen = Math.max(0, end - start);
    const recall = refTokens.length ? matchedCountRolling / refTokens.length : 1;
    const precision = windowLen ? matchedCountRolling / windowLen : 1;
    return {
      start,
      end,
      recall,
      precision,
      missing,
      matchedWords,
      matchedCount: matchedCountRolling,
      matchedCounts: cloneCountMap(matchedCountsRolling),
      length: windowLen,
    };
  }

  function isBetterCandidate(candidate, currentBest) {
    const bestScore = calcMatchScore(refLen, currentBest.recall, currentBest.precision);
    const candScore = calcMatchScore(refLen, candidate.recall, candidate.precision);
    if (candScore > bestScore) return true;
    if (candScore < bestScore) return false;
    if (candidate.recall > currentBest.recall) return true;
    if (candidate.recall < currentBest.recall) return false;
    if (candidate.precision > currentBest.precision) return true;
    if (candidate.precision < currentBest.precision) return false;
    const candDiff = Math.abs((candidate.length || 0) - refLen);
    const bestDiff = Math.abs((currentBest.length || 0) - refLen);
    if (candDiff < bestDiff) return true;
    if (candDiff > bestDiff) return false;
    return (candidate.start || 0) <= (currentBest.start || 0);
  }

  function considerCandidate(candidate) {
    if (isBetterCandidate(candidate, best)) {
      best = candidate;
    }
  }

  if (hypTokens.length && minLen <= hypTokens.length) {
    assignments.fill(null);
    resetRemain();
    matchedCountsRolling.clear();
    matchedCountRolling = 0;
    currentStart = 0;
    currentEnd = 0;
    unmatchedQueue = [];
    unmatchedSet.clear();

    for (let i = 0; i < minLen; i++) {
      addTokenToEnd(i);
    }

    considerCandidate(snapshotCurrentWindow(currentStart, currentEnd));

    const addedIndicesInitial = [];
    for (let len = minLen + 1; len <= maxLen; len++) {
      const idx = len - 1;
      if (idx >= hypTokens.length) break;
      addTokenToEnd(idx);
      addedIndicesInitial.push(idx);
      considerCandidate(snapshotCurrentWindow(currentStart, currentEnd));
    }
    for (let i = addedIndicesInitial.length - 1; i >= 0; i--) {
      removeFromEnd();
    }

    const maxStart = hypTokens.length - minLen;
    for (let start = 1; start <= maxStart; start++) {
      removeFromStart();
      const baseIdx = start + minLen - 1;
      if (baseIdx < hypTokens.length) {
        addTokenToEnd(baseIdx);
      }
      considerCandidate(snapshotCurrentWindow(currentStart, currentEnd));

      const added = [];
      for (let len = minLen + 1; len <= maxLen; len++) {
        const idx = start + len - 1;
        if (idx >= hypTokens.length) break;
        addTokenToEnd(idx);
        added.push(idx);
        considerCandidate(snapshotCurrentWindow(currentStart, currentEnd));
      }
      for (let i = added.length - 1; i >= 0; i--) {
        removeFromEnd();
      }
    }
  }

  best.tokens = hypTokens.slice(best.start, best.end);
  best.length = best.tokens.length;

  const spans = getTokenSpans(enElement);
  const matchMap = cloneCountMap(best.matchedCounts);
  for (const sp of spans) {
    const tokenSource = sp?.dataset?.w;
    const wTokens = toks(tokenSource);
    if (!wTokens.length) {
      sp.classList.remove('hit');
      sp.classList.add('miss');
      continue;
    }
    const reserved = [];
    let hit = true;
    for (const tok of wTokens) {
      let matchKey = '';
      if ((matchMap.get(tok) || 0) > 0) {
        matchKey = tok;
      } else {
        for (const [k, c] of matchMap) {
          if (c > 0 && approxTokensMatch(k, tok)) {
            matchKey = k;
            break;
          }
        }
      }
      if (matchKey) {
        matchMap.set(matchKey, (matchMap.get(matchKey) || 0) - 1);
        reserved.push(matchKey);
      } else {
        hit = false;
        break;
      }
    }
    if (!hit) {
      for (const key of reserved) {
        matchMap.set(key, (matchMap.get(key) || 0) + 1);
      }
    }
    sp.classList.toggle('hit', hit);
    sp.classList.toggle('miss', !hit);
  }

  const composeNodes = getComposeNodes(getComposeNodesFn);
  for (const node of composeNodes) {
    const nodeEl = node && node.el;
    const nodeTokens = Array.isArray(node?.tokens) ? node.tokens : [];
    if (!nodeEl) continue;
    if (!nodeTokens.length) {
      nodeEl.classList.remove('hit');
      nodeEl.classList.remove('miss');
      continue;
    }
    const composeMap = cloneCountMap(best.matchedCounts);
    const reserved = [];
    let chunkHit = true;
    for (const tok of nodeTokens) {
      let matchKey = '';
      if ((composeMap.get(tok) || 0) > 0) {
        matchKey = tok;
      } else {
        for (const [k, c] of composeMap) {
          if (c > 0 && approxTokensMatch(k, tok)) {
            matchKey = k;
            break;
          }
        }
      }
      if (matchKey) {
        composeMap.set(matchKey, (composeMap.get(matchKey) || 0) - 1);
        reserved.push(matchKey);
      } else {
        chunkHit = false;
        break;
      }
    }
    if (!chunkHit) {
      for (const key of reserved) {
        composeMap.set(key, (composeMap.get(key) || 0) + 1);
      }
    }
    nodeEl.classList.toggle('hit', chunkHit);
    nodeEl.classList.toggle('miss', !chunkHit);
  }

  return {
    recall: best.recall,
    precision: best.precision,
    matched: best.matchedWords,
    missing: best.missing,
    refCount: refTokens.length,
    hypTokens: best.tokens,
    transcript: (best.tokens || []).join(' '),
    source: (hypText || '').trim(),
    matchedCounts: best.matchedCounts,
  };
}

export function createRecognitionController(options = {}) {
  const {
    enElement,
    getComposeNodes = () => [],
    getReferenceText = () => '',
    onTranscriptReset = () => {},
    onTranscriptInterim = () => {},
    onTranscriptFinal = () => {},
    onMatchEvaluated = () => {},
    onStart = () => {},
    onStop = () => {},
    onAutoStop = () => {},
    onUnsupported = () => {},
    onError = () => {},
    setMicState = () => {},
    playTone = () => {},
    setResumeAfterMicStart = () => {},
    clearResumeTimer = () => {},
    resetResumeAfterMicStart = () => {},
    shouldResumeAudio = () => false,
    resumeAudio = () => {},
  } = options;

  let recognition = null;
  let active = false;
  let finalized = false;
  let stableText = '';
  let lastMatch = null;

  function clearHighlight() {
    clearHighlightInternal(enElement, getComposeNodes);
  }

  function matchAndHighlight(refText, hypText) {
    if (!refText && !hypText) {
      clearHighlight();
      return {
        recall: 0,
        precision: 0,
        matched: [],
        missing: [],
        refCount: 0,
        hypTokens: [],
        transcript: '',
        source: '',
        matchedCounts: new Map(),
      };
    }
    return matchAndHighlightInternal(refText, hypText, enElement, getComposeNodes);
  }

  function finalize({ triggeredByOnEnd = false } = {}) {
    if (!active && !triggeredByOnEnd) {
      return { ok: false, reason: 'inactive', transcript: stableText.trim(), matchInfo: lastMatch };
    }
    active = false;
    finalized = true;
    resetResumeAfterMicStart?.();
    setMicState?.(false);
    onStop?.();
    const transcript = (stableText || '').trim();
    const refText = getReferenceText?.() ?? '';
    let matchInfo = null;
    if (refText || transcript) {
      matchInfo = matchAndHighlight(refText, transcript);
      lastMatch = Object.assign({}, matchInfo, {
        source: transcript,
        transcript: transcript || matchInfo?.transcript || '',
      });
    } else {
      clearHighlight();
      lastMatch = null;
    }
    recognition = null;
    return { ok: true, transcript, matchInfo: lastMatch };
  }

  function handleAutoStop() {
    const result = finalize({ triggeredByOnEnd: true });
    onAutoStop?.(result);
  }

  function start() {
    if (!SR) {
      onUnsupported?.();
      return { ok: false, reason: 'unsupported' };
    }
    if (active) {
      return { ok: false, reason: 'active' };
    }
    onStart?.();
    const shouldResume = !!shouldResumeAudio?.();
    setResumeAfterMicStart?.(shouldResume);
    clearResumeTimer?.();
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    stableText = '';
    lastMatch = null;
    active = true;
    finalized = false;
    setMicState?.(true);
    playTone?.('start');
    onTranscriptReset?.();
    clearHighlight();

    try {
      recognition.start();
    } catch (_) {
      // noop
    }

    if (shouldResume) {
      try {
        resumeAudio?.();
      } catch (_) {
        // ignore resume failures
      }
    }

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcriptPiece = res[0]?.transcript || '';
        if (res.isFinal) {
          stableText = appendStableFinal(stableText, transcriptPiece);
          const trimmedStable = stableText.trim();
          const refTextCurrent = getReferenceText?.() ?? '';
          const match = matchAndHighlight(refTextCurrent, trimmedStable);
          const normalized = (match?.transcript && match.transcript.trim()) || trimmedStable;
          stableText = normalized;
          const enriched = Object.assign({}, match, {
            source: normalized,
            transcript: normalized,
          });
          lastMatch = enriched;
          onTranscriptFinal?.(normalized, enriched);
          onMatchEvaluated?.(enriched);
        } else {
          interim = transcriptPiece;
        }
      }
      if (interim) {
        onTranscriptInterim?.(interim);
      }
    };

    recognition.onerror = (ev) => {
      console.warn('recognition error', ev);
      playTone?.('fail');
      setMicState?.(false);
      resetResumeAfterMicStart?.();
      clearResumeTimer?.();
      active = false;
      finalized = true;
      recognition = null;
      onError?.(ev);
    };

    recognition.onend = () => {
      if (finalized) {
        return;
      }
      handleAutoStop();
    };

    return { ok: true };
  }

  function stop() {
    if (!active) {
      return { ok: false, reason: 'inactive', transcript: stableText.trim(), matchInfo: lastMatch };
    }
    try {
      recognition?.stop?.();
    } catch (_) {
      // ignore stop failures
    }
    return finalize({ triggeredByOnEnd: false });
  }

  function isActive() {
    return active;
  }

  function getStableTranscript() {
    return (stableText || '').trim();
  }

  function getLastMatch() {
    return lastMatch ? Object.assign({}, lastMatch) : null;
  }

  return {
    start,
    stop,
    isActive,
    clearHighlight,
    matchAndHighlight,
    getStableTranscript,
    getLastMatch,
  };
}
