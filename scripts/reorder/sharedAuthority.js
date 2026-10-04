import { REORDER_SCHEMA_VERSION } from './reorderCore.js';

let metadataPromise = null;

// Shared partition loader and schema interpretation for Reordering.
// Neither consumer generates or edits partitions.
export async function loadSharedChunkAuthority() {
  if (!metadataPromise) {
    const metadataUrl = new URL('../../data/reorder-v1.json', import.meta.url);
    metadataPromise = fetch(metadataUrl, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`reorder metadata unavailable (${response.status})`);
      const data = await response.json();
      if (data?.schemaVersion !== REORDER_SCHEMA_VERSION || !Array.isArray(data?.items)) {
        throw new Error('reorder metadata schema mismatch');
      }
      return { data, byId: new Map(data.items.map((item) => [String(item.itemId), item])) };
    }).catch((error) => {
      metadataPromise = null;
      throw error;
    });
  }
  return metadataPromise;
}

export function sharedLearningTexts(item, sentenceIndex = null) {
  if (!item || !Array.isArray(item.sentences)) throw new Error('Shared item authority is unavailable');
  const sentences = sentenceIndex == null ? item.sentences
    : item.sentences.filter(sentence => sentence.sentenceIndex === sentenceIndex);
  if (!sentences.length) throw new Error('Shared sentence authority is unavailable');
  const strings = [];
  const seen = new Set();
  for (const sentence of sentences) {
    if (!Array.isArray(sentence.partition?.chunks) || !sentence.partition.chunks.length) {
      throw new Error('Shared partition authority is unavailable');
    }
    for (const chunk of sentence.partition.chunks) {
      const text = chunk.learningText;
      if (typeof text !== 'string' || !text.trim()) throw new Error('Empty shared learningText');
      if (!seen.has(text)) { seen.add(text); strings.push(text); }
    }
  }
  return strings;
}

export async function getSharedLearningTexts(itemId, sentenceIndex = null) {
  const { byId } = await loadSharedChunkAuthority();
  return sharedLearningTexts(byId.get(String(itemId)), sentenceIndex);
}
