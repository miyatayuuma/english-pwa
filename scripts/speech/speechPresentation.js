import { safeSpeechTokens } from './safeSpeechNormalization.js';

function tokenSpans(element) {
  return element && typeof element.querySelectorAll === 'function'
    ? Array.from(element.querySelectorAll('.tok'))
    : [];
}
function composeNodes(getComposeNodes) {
  if (typeof getComposeNodes !== 'function') return [];
  const nodes = getComposeNodes();
  return Array.isArray(nodes) ? nodes : [];
}

export function clearSpeechHighlight(element, getComposeNodes) {
  for (const span of tokenSpans(element)) {
    span.classList.remove('hit');
    span.classList.remove('miss');
  }
  for (const node of composeNodes(getComposeNodes)) {
    node?.el?.classList?.remove('hit');
    node?.el?.classList?.remove('miss');
  }
}

function clearCounts(map) {
  return new Map(map || []);
}

export function applySpeechHighlight(alignment, element, getComposeNodes) {
  const matchedIndexes = new Set(alignment?.matchedReferenceTokenIndexes || []);
  let referenceCursor = 0;
  for (const span of tokenSpans(element)) {
    const spanTokens = safeSpeechTokens(span?.dataset?.w || '');
    const indexes = Array.from({ length: spanTokens.length }, (_, offset) => referenceCursor + offset);
    referenceCursor += spanTokens.length;
    const hit = indexes.length > 0 && indexes.every(index => matchedIndexes.has(index));
    span.classList.toggle('hit', hit);
    span.classList.toggle('miss', !hit);
  }

  const remaining = clearCounts(alignment?.matchedCounts);
  for (const node of composeNodes(getComposeNodes)) {
    const nodeElement = node?.el;
    const nodeTokens = Array.isArray(node?.tokens) ? node.tokens : [];
    if (!nodeElement) continue;
    let hit = nodeTokens.length > 0;
    const reserved = [];
    for (const token of nodeTokens) {
      const key = safeSpeechTokens(token)[0]?.value || '';
      if (!key || (remaining.get(key) || 0) <= 0) { hit = false; break; }
      remaining.set(key, remaining.get(key) - 1);
      reserved.push(key);
    }
    if (!hit) for (const key of reserved) remaining.set(key, (remaining.get(key) || 0) + 1);
    nodeElement.classList.toggle('hit', hit);
    nodeElement.classList.toggle('miss', !hit);
  }
}
