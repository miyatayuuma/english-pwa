import { ANDROID_NATIVE_MAX_RESULTS } from '../native/recognitionEvidence.js';
import { LEARNING_MAX_ALTERNATIVES } from './contextualBias.js';
import { selectRecognitionBackend } from '../native/androidSpeechBackend.js';
import { approxTokensMatch, toks, mergeCompoundWords } from '../utils/text.js';

const SR = selectRecognitionBackend();

export function isRecognitionSupported() {
  return !!SR;
}

export function calcMatchScore(refCount, recall, precision) {
  if (!refCount) return 1;
  if ((recall + precision) <= 0) return 0;
  return (2 * recall * precision) / (recall + precision);
}

export function hasRecognizedSpeech(transcript) {
  return toks(String(transcript || '')).length > 0;
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

export function appendRawTranscriptFinal(stable,fragment){
  const left=String(stable??'').trimEnd();
  const right=String(fragment??'').trim();
  if(!left) return right;
  if(!right) return left;
  const lowerLeft=left.toLocaleLowerCase('en-US');
  const lowerRight=right.toLocaleLowerCase('en-US');
  if(lowerRight===lowerLeft||lowerRight.startsWith(`${lowerLeft} `)) return right;
  if(lowerLeft.startsWith(`${lowerRight} `)) return left;
  const leftWords=left.split(/\s+/);
  const rightWords=right.split(/\s+/);
  const comparable=word=>String(word||'').normalize('NFKC').toLocaleLowerCase('en-US').replace(/^[\p{P}]+|[\p{P}]+$/gu,'');
  let overlap=0;
  const max=Math.min(leftWords.length,rightWords.length);
  for(let count=max;count>0;count-=1){
    let same=true;
    for(let index=0;index<count;index+=1){
      const a=comparable(leftWords[leftWords.length-count+index]);
      const b=comparable(rightWords[index]);
      if(a!==b){same=false;break;}
    }
    if(same){overlap=count;break;}
  }
  const remaining=rightWords.slice(overlap).join(' ');
  return remaining?`${left} ${remaining}`:left;
}

export function composeRawTranscriptPreview(stable,interim){
  return appendRawTranscriptFinal(stable,interim);
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

export function matchTranscript(refText, hypText,{tokenMatchCache=new Map()}={}) {
  // Cache the existing pure token comparison across alignment windows.
  const tokensMatch=(left,right)=>{
    if(left===right) return true;
    const key=`${left}\0${right}`;
    if(!tokenMatchCache.has(key)) tokenMatchCache.set(key,approxTokensMatch(left,right));
    return tokenMatchCache.get(key);
  };
  const refTokensRaw = toks(refText);
  const hypTokensRaw = toks(hypText);
  const refTokens = mergeCompoundWords(refTokensRaw, new Set(hypTokensRaw));
  const hypTokensMerged = mergeCompoundWords(hypTokensRaw, new Set(refTokens));
  const hypTokens = hypTokensMerged;

  const refCounts = new Map();
  for (const token of refTokens) {
    refCounts.set(token, (refCounts.get(token) || 0) + 1);
  }

  function alignWindow(start, end) {
    const windowTokens = hypTokens.slice(start, end);
    const refLen = refTokens.length;
    const winLen = windowTokens.length;
    const dp = Array.from({ length: refLen + 1 }, () => new Array(winLen + 1).fill(0));
    const back = Array.from({ length: refLen + 1 }, () => new Array(winLen + 1).fill(''));

    for (let i = 1; i <= refLen; i++) {
      for (let j = 1; j <= winLen; j++) {
        const refTok = refTokens[i - 1];
        const hypTok = windowTokens[j - 1];
        const match = tokensMatch(refTok,hypTok);
        const diagScore = match ? dp[i - 1][j - 1] + 1 : -Infinity;
        const upScore = dp[i - 1][j];
        const leftScore = dp[i][j - 1];
        let bestScore = upScore;
        let dir = 'up';
        if (leftScore > bestScore) {
          bestScore = leftScore;
          dir = 'left';
        }
        if (diagScore >= bestScore) {
          bestScore = diagScore;
          dir = 'diag';
        }
        dp[i][j] = bestScore;
        back[i][j] = dir;
      }
    }

    const assignments = new Array(winLen).fill(null);
    const matchedWords = [];
    const matchedCounts = new Map();
    let matchedCount = 0;
    let i = refLen;
    let j = winLen;
    while (i > 0 && j > 0) {
      const dir = back[i][j];
      if (dir === 'diag') {
        const refTok = refTokens[i - 1];
        const hypTok = windowTokens[j - 1];
        if (tokensMatch(refTok,hypTok)) {
          assignments[j - 1] = refTok;
          matchedWords.unshift(refTok);
          matchedCounts.set(refTok, (matchedCounts.get(refTok) || 0) + 1);
          matchedCount += 1;
        }
        i -= 1;
        j -= 1;
      } else if (dir === 'up') {
        i -= 1;
      } else {
        j -= 1;
      }
    }

    const missing = [];
    for (const [key, count] of refCounts) {
      const matched = matchedCounts.get(key) || 0;
      const remaining = count - matched;
      for (let k = 0; k < remaining; k++) {
        missing.push(key);
      }
    }

    const recall = refLen ? matchedCount / refLen : 1;
    const precision = winLen ? matchedCount / winLen : 1;
    return {
      start,
      end,
      recall,
      precision,
      missing,
      matchedWords,
      matchedCount,
      matchedCounts,
      length: winLen,
      assignments,
      tokens: windowTokens,
    };
  }

  let best = alignWindow(0, hypTokens.length);
  const refLen = refTokens.length;
  const slack = Math.max(4, Math.ceil(refLen * 0.5));
  const minLen = Math.max(1, refLen ? Math.max(1, refLen - slack) : 1);
  const maxLen = Math.max(
    minLen,
    Math.min(hypTokens.length, Math.max(refLen + slack, refLen * 2 || 1))
  );
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
    for (let start = 0; start < hypTokens.length; start++) {
      for (let len = minLen; len <= maxLen; len++) {
        const end = start + len;
        if (end > hypTokens.length) break;
        considerCandidate(alignWindow(start, end));
      }
    }
  }

  best.tokens = best.tokens || hypTokens.slice(best.start, best.end);
  best.length = best.tokens.length;
  if (!Array.isArray(best.assignments)) {
    best.assignments = new Array(best.length).fill(null);
  }

  const normalizedTokens = [];
  if (Array.isArray(best.assignments) && best.assignments.length) {
    for (let i = 0; i < best.tokens.length; i++) {
      const assigned = best.assignments[i];
      const hypToken = best.tokens[i];
      normalizedTokens.push(assigned || hypToken);
    }
  } else {
    normalizedTokens.push(...best.tokens);
  }
  const normalizedTranscript = normalizedTokens.join(' ');

  return {
    recall: best.recall,
    precision: best.precision,
    matched: best.matchedWords,
    missing: best.missing,
    refCount: refTokens.length,
    hypTokens: best.tokens,
    transcript: (best.tokens || []).join(' '),
    normalizedTranscript,
    source: (hypText || '').trim(),
    matchedCounts: best.matchedCounts,
  };
}

export function applyMatchHighlight(match,enElement,getComposeNodesFn) {
  const spans = getTokenSpans(enElement);
  const matchMap = cloneCountMap(match.matchedCounts);
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
    const composeMap = cloneCountMap(match.matchedCounts);
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

}

export function createRecognitionController(options = {}) {
  const {
    enElement,
    getComposeNodes = () => [],
    getReferenceText = () => '',
    shouldEvaluate = () => true,
    onTranscriptReset = () => {},
    onTranscriptInterim = () => {},
    onTranscriptFinal = () => {},
    onTranscriptPreview = () => {},
    getRecognitionBiasContext = () => null,
    onRecognitionConfigured = () => {},
    recognitionBackend = SR,
    onMatchEvaluated = () => {},
    onStart = () => {},
    onStop = () => {},
    onAutoStop = () => {},
    onUnsupported = () => {},
    onError = () => {},
    setMicState = () => {},
  } = options;

  let recognition = null;
  let active = false;
  let finalized = false;
  let stableText = '';
  let latestPreview = '';
  let stopRequested = false;
  let lastMatch = null;
  let segments=[];
  let pendingStop=null;
  function settleStop(result){
    const pending=pendingStop;
    pendingStop=null;
    pending?.resolve(result);
  }
  function getNativeRecognitionSegments(){
    return segments.filter(Boolean).map(segment=>({...segment,alternatives:segment.alternatives.map(candidate=>({...candidate}))}));
  }
  function evaluateTranscript(refText){
    const match=matchTranscript(refText,latestPreview);
    applyMatchHighlight(match,enElement,getComposeNodes);
    return match;
  }
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
        normalizedTranscript: '',
        source: '',
        matchedCounts: new Map(),
      };
    }
    const match=matchTranscript(refText,hypText);
    applyMatchHighlight(match,enElement,getComposeNodes);
    return match;
  }

  function finalize({ triggeredByOnEnd = false } = {}) {
    if (!active && !triggeredByOnEnd) {
      return { ok: false, reason: 'inactive', transcript: stableText.trim(), previewTranscript:latestPreview, nativeSegments:getNativeRecognitionSegments(), matchInfo: lastMatch };
    }
    active = false;
    finalized = true;
    setMicState?.(false);
    onStop?.();
    const transcript = (latestPreview || stableText || '').trim();
    const refText = getReferenceText?.() ?? '';
    let matchInfo = null;
    if (hasRecognizedSpeech(transcript) && shouldEvaluate?.()!==false) {
      matchInfo = evaluateTranscript(refText);
      lastMatch = matchInfo;
    } else {
      clearHighlight();
      lastMatch = null;
    }
    recognition = null;
    return { ok: true, transcript, previewTranscript:latestPreview, nativeSegments:getNativeRecognitionSegments(), matchInfo: lastMatch };
  }

  function handleAutoStop() {
    const result = finalize({ triggeredByOnEnd: true });
    onAutoStop?.(result);
  }

  function start() {
    const context=getRecognitionBiasContext?.();
    if (!recognitionBackend || context?.speechDisabled) {
      onUnsupported?.();
      return { ok: false, reason: 'unsupported' };
    }
    if (active) {
      return { ok: false, reason: 'active' };
    }
    let currentRecognition;
    try{
      currentRecognition=new recognitionBackend();
    }catch(error){
      setMicState?.(false);
      onError?.({error:'start-failed',cause:error});
      return {ok:false,reason:'start-failed'};
    }
    recognition=currentRecognition;
    currentRecognition.lang = 'en-US';
    currentRecognition.continuous = true;
    currentRecognition.interimResults = true;
    currentRecognition.context=context;
    currentRecognition.maxAlternatives=context?.maxAlternatives===LEARNING_MAX_ALTERNATIVES?LEARNING_MAX_ALTERNATIVES:1;
    if(currentRecognition.waitsForFinalResult) currentRecognition.maxAlternatives=ANDROID_NATIVE_MAX_RESULTS;
    onRecognitionConfigured?.({maxAlternatives:currentRecognition.maxAlternatives,backend:currentRecognition.waitsForFinalResult?'android-native':'web'});

    stableText = '';
    segments=[];
    latestPreview = '';
    lastMatch = null;
    active = true;
    finalized = false;
    stopRequested = false;
    onTranscriptReset?.();
    clearHighlight();

    currentRecognition.onstart = () => {
      if (recognition!==currentRecognition || !active || finalized) return;
      setMicState?.(true);
      onStart?.();
    };

    currentRecognition.onresult = (event) => {
      if (recognition!==currentRecognition || !active || finalized) return;
      const firstChanged=Number.isInteger(event.resultIndex)?event.resultIndex:0;
      // Results are cumulative within a native session; replace changed segments.
      segments.length=event.results.length;
      for(let i=firstChanged;i<event.results.length;i+=1){
        const result=event.results[i];
        const alternatives=[];
        const seen=new Set();
        for(let rank=0;rank<Math.min(result.length,currentRecognition.maxAlternatives);rank++){
          const value=result[rank],transcript=String(value?.transcript??'');
          const key=transcript.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g,' ').trim();
          if(!key || (!currentRecognition.waitsForFinalResult && seen.has(key))) continue;
          seen.add(key);alternatives.push({transcript,asrRank:Number.isInteger(value?.asrRank)?value.asrRank:rank,confidence:Number.isFinite(value?.confidence)?value.confidence:null});
        }
        segments[i]={segmentIndex:i,primaryTranscript:String(result[0]?.transcript??''),alternatives,isFinal:!!result.isFinal,requestedMaxResults:result.requestedMaxResults,providerReturnedCount:result.providerReturnedCount,retainedCandidateCount:result.retainedCandidateCount};
      }
      const present=segments.filter(Boolean);
      latestPreview=present.reduce((text,segment)=>appendRawTranscriptFinal(text,segment.primaryTranscript),'');
      stableText=present.filter(segment=>segment.isFinal).reduce((text,segment)=>appendRawTranscriptFinal(text,segment.primaryTranscript),'');
      const changedFinal=Array.from(event.results).slice(firstChanged).some(result=>result.isFinal);
      if(changedFinal){
        lastMatch=hasRecognizedSpeech(latestPreview)&&shouldEvaluate?.()!==false?evaluateTranscript(getReferenceText?.()??''):null;
        onTranscriptFinal?.(stableText,lastMatch);
        if(lastMatch) onMatchEvaluated?.(lastMatch);
      }
      const interim=present.filter(segment=>!segment.isFinal).map(segment=>segment.primaryTranscript).join(' ');
      if(interim) onTranscriptInterim?.(interim);
      onTranscriptPreview?.(latestPreview);

    };

    currentRecognition.onerror = (event) => {
      if(recognition!==currentRecognition||!active||finalized) return;
      active=false;finalized=true;recognition=null;
      try { currentRecognition.abort?.(); } catch (_) {}
      setMicState?.(false);onStop?.();
      settleStop({ok:false,reason:event.error||'recognition-error'});
      // Errors never finalize a learning result, including errors after a partial result.
      onError?.(event);
    };

    currentRecognition.onend = () => {
      if (recognition!==currentRecognition || finalized) {
        return;
      }
      if(stopRequested){
        if(currentRecognition.waitsForFinalResult) settleStop(finalize({triggeredByOnEnd:true}));
        return;
      }
      handleAutoStop();
    };

    try {
      currentRecognition.start();
    } catch (error) {
      active = false;
      finalized = true;
      recognition = null;
      setMicState?.(false);
      onError?.({error:'start-failed',cause:error});
      return { ok: false, reason: 'start-failed' };
    }

    return { ok: true };
  }

  function stop() {
    if(pendingStop) return pendingStop.promise;
    if (!active) {
      return { ok: false, reason: 'inactive', transcript: stableText.trim(), previewTranscript:latestPreview, nativeSegments:getNativeRecognitionSegments(), matchInfo: lastMatch };
    }
    stopRequested=true;
    const currentRecognition=recognition;
    if(currentRecognition?.waitsForFinalResult){
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      pendingStop={promise,resolve};
      try { currentRecognition.stop(); }
      catch(error){
        cancel();
        onError?.({error:'stop-failed',cause:error});
      }
      return promise;
    }
    try {
      currentRecognition?.stop?.();
    } catch (_) {
      // ignore stop failures
    }
    return finalize({ triggeredByOnEnd: false });
  }

  function cancel(){
    const currentRecognition=recognition;
    active=false;finalized=true;stopRequested=false;recognition=null;
    settleStop({ok:false,reason:'cancelled'});
    try { currentRecognition?.abort?.(); } catch (_) {}
    setMicState?.(false);onStop?.();
  }

  function isActive() {
    return active;
  }

  function getStableTranscript() {
    return (stableText || '').trim();
  }

  function getPreviewTranscript(){
    return latestPreview;
  }

  function getLastMatch() {
    return lastMatch ? Object.assign({}, lastMatch) : null;
  }

  return {
    start,
    stop,
    cancel,
    isActive,
    clearHighlight,
    matchAndHighlight,
    getStableTranscript,
    getPreviewTranscript,
    getNativeRecognitionSegments,
    getLastMatch,
  };
}
