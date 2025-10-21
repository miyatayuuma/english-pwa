import { appendStableFinal, dedupeRuns, approxWithin1, toks } from '../utils/text.js';

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
  const refTokens = toks(refText);
  const hypTokensRaw = toks(hypText);
  const hypTokens = dedupeRuns(hypTokensRaw);

  function evaluateWindow(tokens) {
    const remain = new Map();
    const matchedCounts = new Map();
    const matchedWords = [];
    for (const w of refTokens) {
      remain.set(w, (remain.get(w) || 0) + 1);
    }
    tokens.forEach((h) => {
      if (!h) return;
      let matchKey = '';
      if ((remain.get(h) || 0) > 0) {
        matchKey = h;
      } else {
        for (const [k, c] of remain) {
          if (c > 0 && approxWithin1(k, h)) {
            matchKey = k;
            break;
          }
        }
      }
      if (matchKey) {
        remain.set(matchKey, (remain.get(matchKey) || 0) - 1);
        matchedCounts.set(matchKey, (matchedCounts.get(matchKey) || 0) + 1);
        matchedWords.push(matchKey);
      }
    });
    const missing = [];
    for (const [w, c] of remain) {
      for (let i = 0; i < (c || 0); i++) missing.push(w);
    }
    const matchedCount = matchedWords.length;
    const recall = refTokens.length ? matchedCount / refTokens.length : 1;
    const precision = tokens.length ? matchedCount / tokens.length : 1;
    return { tokens, recall, precision, missing, matchedWords, matchedCount, matchedCounts };
  }

  let best = evaluateWindow(hypTokens);
  best.start = 0;
  best.end = hypTokens.length;
  const refLen = refTokens.length;
  const slack = Math.max(4, Math.ceil(refLen * 0.5));
  const minLen = Math.max(1, refLen ? Math.max(1, refLen - slack) : 1);
  const maxLen = Math.max(
    minLen,
    Math.min(hypTokens.length, Math.max(refLen + slack, refLen * 2 || 1))
  );
  for (let start = 0; start < hypTokens.length; start++) {
    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len;
      if (end > hypTokens.length) break;
      const slice = hypTokens.slice(start, end);
      const evalRes = evaluateWindow(slice);
      evalRes.start = start;
      evalRes.end = end;
      const bestScore = calcMatchScore(refLen, best.recall, best.precision);
      const candScore = calcMatchScore(refLen, evalRes.recall, evalRes.precision);
      if (
        candScore > bestScore ||
        (candScore === bestScore && (
          evalRes.recall > best.recall ||
          (evalRes.recall === best.recall && (
            evalRes.precision > best.precision ||
            (evalRes.precision === best.precision && (
              Math.abs((evalRes.tokens?.length || 0) - refLen) < Math.abs((best.tokens?.length || 0) - refLen) ||
              (
                Math.abs((evalRes.tokens?.length || 0) - refLen) === Math.abs((best.tokens?.length || 0) - refLen) &&
                (evalRes.start || 0) <= (best.start || 0)
              )
            ))
          ))
        ))
      ) {
        best = evalRes;
      }
    }
  }

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
          if (c > 0 && approxWithin1(k, tok)) {
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
          if (c > 0 && approxWithin1(k, tok)) {
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
