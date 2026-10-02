export const REORDER_SCHEMA_VERSION = 2;

function chunksOf(partition) {
  return Array.isArray(partition?.chunks) ? partition.chunks : [];
}

export function reconstructCanonical(partition) {
  const chunks = chunksOf(partition);
  if (!chunks.length) return null;
  return chunks.map((chunk) => `${chunk.text}${chunk.separatorAfter ?? ''}`).join('');
}

export function validateCanonicalPartition(partition, sourceText) {
  const chunks = chunksOf(partition);
  if (chunks.length < 2) return false;
  const ids = chunks.map((chunk) => chunk?.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  if (!Array.isArray(partition.canonicalOrder) || partition.canonicalOrder.length !== ids.length
    || partition.canonicalOrder.some((id, index) => id !== ids[index])) return false;
  if (!Array.isArray(partition.acceptedOrders) || !partition.acceptedOrders.some((order) => orderKey(order) === orderKey(ids))
    || partition.acceptedOrders.some((order) => !Array.isArray(order) || order.length !== ids.length
      || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id)))) return false;
  let cursor = 0;
  for (const chunk of chunks) {
    if (!Number.isInteger(chunk.tokenStart) || !Number.isInteger(chunk.tokenEnd)
      || chunk.tokenStart !== cursor || chunk.tokenEnd <= cursor || typeof chunk.text !== 'string'
      || typeof chunk.separatorAfter !== 'string') return false;
    cursor = chunk.tokenEnd;
  }
  return reconstructCanonical(partition) === sourceText && partition.canonicalReconstruction === sourceText;
}

export function sharedChunks(sentence) {
  return chunksOf(sentence).map((chunk) => ({ ...chunk }));
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

export function createWrongShuffle(chunkIds, acceptedOrders, { random = Math.random, maxAttempts = 64 } = {}) {
  if (!Array.isArray(chunkIds) || chunkIds.length < 2) return null;
  const accepted = new Set((Array.isArray(acceptedOrders) ? acceptedOrders : []).map(orderKey));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = shuffled(chunkIds, random);
    if (!isAccepted(candidate, accepted)) return candidate;
  }
  for (let shift = 1; shift < chunkIds.length; shift += 1) {
    const candidate = chunkIds.slice(shift).concat(chunkIds.slice(0, shift));
    if (!isAccepted(candidate, accepted)) return candidate;
  }
  const reversed = chunkIds.slice().reverse();
  if (!isAccepted(reversed, accepted)) return reversed;
  for (let left = 0; left < chunkIds.length; left += 1) {
    for (let right = left + 1; right < chunkIds.length; right += 1) {
      const candidate = chunkIds.slice();
      [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
      if (!isAccepted(candidate, accepted)) return candidate;
    }
  }
  return null;
}

export function createPuzzleState(partition, options = {}) {
  const chunks = chunksOf(partition);
  const ids = chunks.map((chunk) => chunk?.id).filter((id) => typeof id === 'string' && id);
  if (ids.length !== chunks.length || ids.length < 2 || new Set(ids).size !== ids.length) return null;
  const acceptedOrders = Array.isArray(partition.acceptedOrders) ? partition.acceptedOrders : [];
  const initialBank = createWrongShuffle(ids, acceptedOrders, options);
  if (!initialBank) return null;
  return {
    chunks: chunks.slice(),
    chunkById: new Map(chunks.map((chunk) => [chunk.id, chunk])),
    acceptedOrders: acceptedOrders.map((order) => order.slice()),
    bank: initialBank,
    answer: [],
    attempts: 0,
    status: 'playing',
  };
}

export function moveTile(state, chunkId, destination, index = undefined) {
  if (!state || state.status !== 'playing' || !state.chunkById.has(chunkId)) return state;
  const bank = state.bank.slice();
  const answer = state.answer.slice();
  const source = bank.includes(chunkId) ? bank : answer.includes(chunkId) ? answer : null;
  if (!source) return state;
  const sourceIndex = source.indexOf(chunkId);
  source.splice(sourceIndex, 1);
  const target = destination === 'answer' ? answer : bank;
  const fallbackIndex = destination === 'answer' ? answer.length : bank.length;
  const insertAt = Number.isInteger(index) ? Math.max(0, Math.min(index, target.length)) : fallbackIndex;
  target.splice(insertAt, 0, chunkId);
  return { ...state, bank, answer };
}

export function reorderAnswerTile(state, chunkId, delta) {
  if (!state || state.status !== 'playing' || !Number.isInteger(delta)) return state;
  const answer = state.answer.slice();
  const current = answer.indexOf(chunkId);
  const next = current + delta;
  if (current < 0 || next < 0 || next >= answer.length) return state;
  [answer[current], answer[next]] = [answer[next], answer[current]];
  return { ...state, answer };
}

export function answerIsComplete(state) {
  return !!state && state.bank.length === 0 && state.answer.length === state.chunks.length;
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
  const order = Array.isArray(bankOrder) && bankOrder.length === state.chunks.length
    && new Set(bankOrder).size === state.chunks.length
    && bankOrder.every((id) => state.chunkById.has(id))
    ? bankOrder.slice()
    : createWrongShuffle(state.chunks.map((chunk) => chunk.id), state.acceptedOrders) ?? state.chunks.map((chunk) => chunk.id);
  return { ...state, bank: order, answer: [], status: 'playing' };
}
