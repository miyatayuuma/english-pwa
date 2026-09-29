export const REORDER_SCHEMA_VERSION = 1;
export const REORDER_TIERS = Object.freeze(['foundation', 'standard', 'precision']);

export function reconstructCanonical(variant) {
  if (!Array.isArray(variant?.tiles)) return null;
  return variant.tiles.map((tile) => `${tile.text}${tile.separatorAfter ?? ''}`).join('');
}

export function validateCanonicalVariant(variant, sourceText) {
  if (!Array.isArray(variant?.tiles) || variant.tiles.length < 2) return false;
  const ids = variant.tiles.map((tile) => tile?.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  if (!Array.isArray(variant.canonicalOrder) || variant.canonicalOrder.length !== ids.length
    || variant.canonicalOrder.some((id, index) => id !== ids[index])) return false;
  if (!Array.isArray(variant.acceptedOrders) || !variant.acceptedOrders.some((order) => orderKey(order) === orderKey(ids))
    || variant.acceptedOrders.some((order) => !Array.isArray(order) || order.length !== ids.length
      || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id)))) return false;
  let cursor = 0;
  for (const tile of variant.tiles) {
    if (!Number.isInteger(tile.tokenStart) || !Number.isInteger(tile.tokenEnd)
      || tile.tokenStart !== cursor || tile.tokenEnd <= cursor || typeof tile.text !== 'string'
      || typeof tile.separatorAfter !== 'string') return false;
    cursor = tile.tokenEnd;
  }
  return reconstructCanonical(variant) === sourceText && variant.canonicalReconstruction === sourceText;
}

export function targetTierForLevel(bestLevel) {
  const level = Number(bestLevel);
  if (!Number.isFinite(level) || level <= 2) return 'foundation';
  return level <= 4 ? 'standard' : 'precision';
}

export function selectReorderVariant(sentence, bestLevel) {
  const variants = sentence?.variants;
  if (!variants || typeof variants !== 'object') return null;
  const target = targetTierForLevel(bestLevel);
  const targetIndex = REORDER_TIERS.indexOf(target);
  const candidates = REORDER_TIERS
    .map((tier, index) => ({ tier, index, variant: variants[tier] }))
    .filter((entry) => entry.variant && Array.isArray(entry.variant.tiles) && entry.variant.tiles.length > 1)
    .sort((a, b) => Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex) || a.index - b.index);
  if (!candidates.length) return null;
  const selected = candidates[0];
  return { ...selected, targetTier: target, usedFallback: selected.tier !== target };
}

function orderKey(order) {
  return Array.isArray(order) ? order.join('\u0000') : '';
}

function shuffled(values, random) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function isAccepted(order, acceptedSet) {
  return acceptedSet.has(orderKey(order));
}

export function createWrongShuffle(tileIds, acceptedOrders, { random = Math.random, maxAttempts = 64 } = {}) {
  if (!Array.isArray(tileIds) || tileIds.length < 2) return null;
  const accepted = new Set((Array.isArray(acceptedOrders) ? acceptedOrders : []).map(orderKey));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = shuffled(tileIds, random);
    if (!isAccepted(candidate, accepted)) return candidate;
  }
  // Deterministic fallbacks prevent the bank from occasionally starting in an
  // accepted order on tiny puzzles or under an unlucky random source.
  for (let shift = 1; shift < tileIds.length; shift += 1) {
    const candidate = tileIds.slice(shift).concat(tileIds.slice(0, shift));
    if (!isAccepted(candidate, accepted)) return candidate;
  }
  const reversed = tileIds.slice().reverse();
  if (!isAccepted(reversed, accepted)) return reversed;
  for (let left = 0; left < tileIds.length; left += 1) {
    for (let right = left + 1; right < tileIds.length; right += 1) {
      const candidate = tileIds.slice();
      [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
      if (!isAccepted(candidate, accepted)) return candidate;
    }
  }
  return null;
}

export function createPuzzleState(variant, options = {}) {
  const tiles = Array.isArray(variant?.tiles) ? variant.tiles : [];
  const ids = tiles.map((tile) => tile?.id).filter((id) => typeof id === 'string' && id);
  if (ids.length !== tiles.length || ids.length < 2 || new Set(ids).size !== ids.length) return null;
  const acceptedOrders = Array.isArray(variant.acceptedOrders) ? variant.acceptedOrders : [];
  const initialBank = createWrongShuffle(ids, acceptedOrders, options);
  if (!initialBank) return null;
  return {
    tiles: tiles.slice(),
    tileById: new Map(tiles.map((tile) => [tile.id, tile])),
    acceptedOrders: acceptedOrders.map((order) => order.slice()),
    bank: initialBank,
    answer: [],
    attempts: 0,
    status: 'playing',
  };
}

export function moveTile(state, tileId, destination, index = undefined) {
  if (!state || state.status !== 'playing' || !state.tileById.has(tileId)) return state;
  const bank = state.bank.slice();
  const answer = state.answer.slice();
  const source = bank.includes(tileId) ? bank : answer.includes(tileId) ? answer : null;
  if (!source) return state;
  const sourceIndex = source.indexOf(tileId);
  source.splice(sourceIndex, 1);
  const target = destination === 'answer' ? answer : bank;
  const fallbackIndex = destination === 'answer' ? answer.length : bank.length;
  const insertAt = Number.isInteger(index) ? Math.max(0, Math.min(index, target.length)) : fallbackIndex;
  target.splice(insertAt, 0, tileId);
  return { ...state, bank, answer };
}

export function reorderAnswerTile(state, tileId, delta) {
  if (!state || state.status !== 'playing' || !Number.isInteger(delta)) return state;
  const answer = state.answer.slice();
  const current = answer.indexOf(tileId);
  const next = current + delta;
  if (current < 0 || next < 0 || next >= answer.length) return state;
  [answer[current], answer[next]] = [answer[next], answer[current]];
  return { ...state, answer };
}

export function answerIsComplete(state) {
  return !!state && state.bank.length === 0 && state.answer.length === state.tiles.length;
}

export function answerIsCorrect(state) {
  if (!answerIsComplete(state)) return false;
  const key = orderKey(state.answer);
  return state.acceptedOrders.some((order) => orderKey(order) === key);
}

export function recordWrongAttempt(state) {
  if (!answerIsComplete(state) || answerIsCorrect(state)) return state;
  const attempts = state.attempts + 1;
  return { ...state, attempts, status: attempts >= 3 ? 'revealed' : 'playing' };
}

export function markSentenceComplete(state, { assisted = false } = {}) {
  if (!state) return state;
  return { ...state, status: assisted ? 'assisted' : 'complete' };
}

export function restorePuzzle(state, bankOrder) {
  if (!state) return state;
  const order = Array.isArray(bankOrder) && bankOrder.length === state.tiles.length
    && new Set(bankOrder).size === state.tiles.length
    && bankOrder.every((id) => state.tileById.has(id))
    ? bankOrder.slice()
    : createWrongShuffle(state.tiles.map((tile) => tile.id), state.acceptedOrders) ?? state.tiles.map((tile) => tile.id);
  return { ...state, bank: order, answer: [], status: 'playing' };
}
