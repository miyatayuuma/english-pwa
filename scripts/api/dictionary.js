import { STORAGE_KEYS, loadJson, saveJson } from '../storage/local.js';

const DEFAULT_CACHE_KEY = STORAGE_KEYS.DICTIONARY_CACHE || 'dictionaryCacheV1';
const MAX_CACHE_SIZE = 120;
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FALLBACK_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

function normalizeTerm(term) {
  if (!term) return '';
  const normalized = String(term)
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized;
}

function pickDefinitions(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const results = [];
  const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
  for (const meaning of meanings) {
    if (!meaning || typeof meaning !== 'object') continue;
    const defs = Array.isArray(meaning.definitions) ? meaning.definitions : [];
    for (const def of defs) {
      const text = typeof def?.definition === 'string' ? def.definition.trim() : '';
      if (text && !results.includes(text)) {
        results.push(text);
      }
    }
  }
  return results.slice(0, 5);
}

function pickPhonetic(entry) {
  if (!entry || typeof entry !== 'object') return { phonetic: '', audioUrls: [] };
  const audioUrls = [];
  let phonetic = '';
  if (typeof entry.phonetic === 'string' && entry.phonetic.trim()) {
    phonetic = entry.phonetic.trim();
  }
  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
  for (const phon of phonetics) {
    const text = typeof phon?.text === 'string' ? phon.text.trim() : '';
    const audio = typeof phon?.audio === 'string' ? phon.audio.trim() : '';
    if (!phonetic && text) {
      phonetic = text;
    }
    if (audio && !audioUrls.includes(audio)) {
      audioUrls.push(audio);
    }
  }
  return { phonetic, audioUrls };
}

function pruneCache(cache, maxSize) {
  const entries = Object.entries(cache || {});
  if (!entries.length || !maxSize || !Number.isFinite(maxSize)) return cache;
  entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
  const limited = entries.slice(0, Math.max(1, maxSize));
  const next = {};
  for (const [key, value] of limited) {
    next[key] = value;
  }
  return next;
}

export function createDictionaryClient(options = {}) {
  const {
    fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
    load = loadJson,
    save = saveJson,
    storageKey = DEFAULT_CACHE_KEY,
    baseUrl = FALLBACK_BASE_URL,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    maxEntries = MAX_CACHE_SIZE,
    now = () => Date.now(),
  } = options;

  let cache = {};
  if (typeof load === 'function') {
    const stored = load(storageKey, {});
    if (stored && typeof stored === 'object') {
      cache = { ...stored };
    }
  }

  function persist() {
    if (typeof save === 'function') {
      const trimmed = pruneCache(cache, maxEntries);
      save(storageKey, trimmed);
      cache = { ...trimmed };
    }
  }

  function readCache(term) {
    if (!term) return null;
    const entry = cache[term];
    if (!entry) return null;
    if (maxAgeMs && Number.isFinite(maxAgeMs)) {
      const age = now() - (entry.updatedAt || 0);
      if (age > maxAgeMs) {
        delete cache[term];
        persist();
        return null;
      }
    }
    return entry.data || null;
  }

  function writeCache(term, data) {
    if (!term) return;
    cache[term] = { data, updatedAt: now() };
    persist();
  }

  async function fetchEntry(term) {
    if (!fetchImpl || !term) return null;
    const url = `${baseUrl}${encodeURIComponent(term)}`;
    const res = await fetchImpl(url);
    if (!res || !res.ok) {
      throw new Error(`Dictionary request failed (${res ? res.status : 'offline'})`);
    }
    const payload = await res.json();
    if (!Array.isArray(payload) || !payload.length) {
      throw new Error('Dictionary response malformed');
    }
    const entry = payload[0];
    const definitions = pickDefinitions(entry);
    const { phonetic, audioUrls } = pickPhonetic(entry);
    const result = {
      term,
      phonetic: phonetic || '',
      definitions,
      audioUrl: audioUrls[0] || '',
      audioUrls,
      source: 'remote',
    };
    return result;
  }

  async function lookup(rawTerm, { fallbackTerms = [] } = {}) {
    const term = normalizeTerm(rawTerm);
    if (!term) {
      return {
        term: '',
        phonetic: '',
        definitions: [],
        audioUrl: '',
        audioUrls: [],
        source: 'empty',
      };
    }
    const cached = readCache(term);
    if (cached) {
      return { ...cached, source: 'cache' };
    }
    if (!fetchImpl) {
      throw new Error('No fetch implementation available');
    }
    try {
      const result = await fetchEntry(term);
      writeCache(term, result);
      return result;
    } catch (err) {
      const nextFallback = Array.isArray(fallbackTerms) && fallbackTerms.length
        ? fallbackTerms[0]
        : '';
      if (nextFallback) {
        return lookup(nextFallback, { fallbackTerms: fallbackTerms.slice(1) });
      }
      const cachedAfterError = readCache(term);
      if (cachedAfterError) {
        return { ...cachedAfterError, source: 'cache', error: err };
      }
      throw err;
    }
  }

  function clearCache() {
    cache = {};
    persist();
  }

  function getCacheSnapshot() {
    return { ...cache };
  }

  return {
    lookup,
    clearCache,
    getCacheSnapshot,
  };
}
