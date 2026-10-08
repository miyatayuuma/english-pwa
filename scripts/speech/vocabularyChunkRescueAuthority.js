import { safeSpeechTokens } from './safeSpeechNormalization.js';

const curatedEntries = [
  ['vocab:00059', ['it goes without saying', 'that practice matters']],
  ['vocab:00139', ['no sooner had I arrived', 'than the phone rang']],
  ['vocab:00185', ['the more you practice', 'the better you get']],
  ['vocab:00225', ['not so much by something', 'as by something else']],
  ['vocab:00244', ['it occurs to someone', 'that something is wrong']],
  ['vocab:00300', ['not only something', 'but also something else']],
  ['vocab:00328', ['something has something to do', 'with something else']],
  ['vocab:00370', ['all someone has to do', 'is do something']],
  ['vocab:00427', ['would rather do something', 'than do something else']],
  ['vocab:00528', ['have no choice', 'but to do something']],
  ['vocab:00661', ['it dawned on me', 'that I was wrong']],
  ['vocab:00673', ['go so far', 'as to do something']],
  ['vocab:01631', ['do you mind', 'if I sit here']],
  ['vocab:01671', ['warn someone', 'that something is dangerous']],
  ['vocab:02060', ['think of something', 'as something else']],
  ['vocab:02202', ['might as well do something', 'as do something else']],
  ['vocab:02384', ["it won't be long", 'before everything is ready']],
  ['vocab:02452', ['if I were you', "I'd do something"]],
].map(([id, chunks]) => Object.freeze([id, Object.freeze(chunks)]));

// Keep the source entries available so validation can detect duplicate IDs
// before Object.fromEntries would silently overwrite them.
export const VOCABULARY_CHUNK_RESCUE_AUTHORITY_ENTRIES = Object.freeze(curatedEntries);
export const VOCABULARY_CHUNK_RESCUE_AUTHORITY = Object.freeze(Object.fromEntries(curatedEntries));

function tokenValues(text) {
  return safeSpeechTokens(text).map(token => token.value);
}

// Fail closed if production vocabulary ever changes under a curated split.
export function vocabularyChunkRescueChunks(entry) {
  const id = String(entry?.id || '');
  if (!Object.hasOwn(VOCABULARY_CHUNK_RESCUE_AUTHORITY, id)) return null;

  const chunks = VOCABULARY_CHUNK_RESCUE_AUTHORITY[id];
  const expected = tokenValues(entry?.canonical);
  const reconstructed = tokenValues(chunks.join(' '));
  if (!expected.length || expected.length !== reconstructed.length
    || expected.some((token, index) => token !== reconstructed[index])) return null;

  return chunks;
}
