const BASE_PHONEMES = new Map([
  ['their', { key: 'DH EH R', confident: true }],
  ['there', { key: 'DH EH R', confident: true }],
  ["they're", { key: 'DH EH R', confident: true }],
  ['theyre', { key: 'DH EH R', confident: true }],
  ['threw', { key: 'TH R UW', confident: true }],
  ['through', { key: 'TH R UW', confident: true }],
  ['serial', { key: 'S IH R IY AH L', confident: true }],
  ['cereal', { key: 'S IH R IY AH L', confident: true }],
  ['cot', { key: 'K AA T', confident: true }],
  ['caught', { key: 'K AA T', confident: true }],
  ['color', { key: 'K AH L ER', confident: true }],
  ['colour', { key: 'K AH L ER', confident: true }],
]);

const CACHE = new Map();

const CLEAN_RE = /[^a-z']/g;

function collapseDuplicates(str) {
  return str.replace(/(.)\1+/g, '$1');
}

function heuristicPhoneme(word) {
  if (!word) return null;
  let w = word;
  w = w.replace(/^kn/, 'n');
  w = w.replace(/^gn/, 'n');
  w = w.replace(/^wr/, 'r');
  w = w.replace(/^ps/, 's');
  w = w.replace(/ph/g, 'f');
  w = w.replace(/ght/g, 't');
  w = w.replace(/gh(?![aeiou])/g, '');
  w = w.replace(/qu/g, 'kw');
  w = w.replace(/ck/g, 'k');
  w = w.replace(/c(?=[eiy])/g, 's');
  w = w.replace(/c/g, 'k');
  w = w.replace(/x/g, 'ks');
  w = w.replace(/tia/g, 'sha');
  w = w.replace(/tio/g, 'sho');
  w = w.replace(/tion/g, 'shun');
  w = w.replace(/sion/g, 'zhun');
  w = w.replace(/dg/g, 'j');
  w = w.replace(/([aeiouy])h(?![aeiouy])/g, '$1');
  w = collapseDuplicates(w);
  const leading = w[0] || '';
  const reduced = w
    .slice(1)
    .replace(/[aeiouy]/g, '')
    .replace(/w/g, 'v');
  const result = `${leading}${reduced}`;
  return result ? result : null;
}

export function getPhoneticKey(token) {
  if (!token) return { key: null, confident: false };
  const normalized = token.toLowerCase().normalize('NFKC');
  if (!normalized) return { key: null, confident: false };
  const cached = CACHE.get(normalized);
  if (cached) return cached;
  const clean = normalized.replace(CLEAN_RE, '');
  if (!clean) {
    const empty = { key: null, confident: false };
    CACHE.set(normalized, empty);
    return empty;
  }
  const direct = BASE_PHONEMES.get(clean);
  if (direct) {
    CACHE.set(normalized, direct);
    return direct;
  }
  const heuristic = heuristicPhoneme(clean);
  const result = heuristic
    ? { key: heuristic, confident: false }
    : { key: null, confident: false };
  CACHE.set(normalized, result);
  return result;
}

export function clearPhoneticCache() {
  CACHE.clear();
}
