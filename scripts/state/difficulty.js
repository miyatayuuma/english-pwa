import { STORAGE_KEYS, loadJson, saveJson } from '../storage/local.js';

const DEFAULT_STORAGE_KEY = STORAGE_KEYS.DIFFICULTY_STATE || 'difficultyStateV1';
const MAX_CACHE_ENTRIES = 500;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function createDifficultyTracker(options = {}) {
  const {
    load = loadJson,
    save = saveJson,
    storageKey = DEFAULT_STORAGE_KEY,
    now = () => Date.now(),
    maxEntries = MAX_CACHE_ENTRIES,
  } = options;

  const raw = typeof load === 'function' ? load(storageKey, {}) : {};
  const state = new Map();

  if (raw && typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw)) {
      if (!id) continue;
      let count = 0;
      let updatedAt = 0;
      if (entry && typeof entry === 'object') {
        count = toNumber(entry.count, 0);
        updatedAt = toNumber(entry.updatedAt, 0);
      } else {
        count = toNumber(entry, 0);
      }
      if (count > 0 || updatedAt > 0) {
        state.set(id, { count: Math.max(0, Math.floor(count)), updatedAt });
      }
    }
  }

  function persist() {
    if (typeof save !== 'function') return;
    const payload = {};
    const entries = Array.from(state.entries())
      .filter(([, entry]) => entry && entry.count > 0);
    entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    const limited = maxEntries && Number.isFinite(maxEntries)
      ? entries.slice(0, Math.max(1, maxEntries))
      : entries;
    for (const [id, entry] of limited) {
      payload[id] = { count: entry.count, updatedAt: entry.updatedAt || 0 };
    }
    save(storageKey, payload);
  }

  function ensureEntry(id) {
    if (!id) return null;
    if (!state.has(id)) {
      state.set(id, { count: 0, updatedAt: 0 });
    }
    return state.get(id);
  }

  function bumpCount(id, amount) {
    const entry = ensureEntry(id);
    if (!entry) return 0;
    const inc = Number.isFinite(amount) ? amount : 0;
    if (!inc) return entry.count;
    entry.count = Math.max(0, Math.floor(entry.count + inc));
    entry.updatedAt = now();
    if (entry.count <= 0) {
      state.delete(id);
    }
    persist();
    return entry.count;
  }

  function decayCount(id, amount = 1) {
    const entry = ensureEntry(id);
    if (!entry) return 0;
    const dec = Number.isFinite(amount) ? amount : 0;
    if (!dec) return entry.count;
    entry.count = Math.max(0, entry.count - Math.floor(dec));
    entry.updatedAt = now();
    if (entry.count <= 0) {
      state.delete(id);
    }
    persist();
    return entry.count;
  }

  function registerAttempt(id, { missingTokens = 0, failed = false, passed = false } = {}) {
    if (!id) return 0;
    const miss = Math.max(0, Math.floor(Number(missingTokens) || 0));
    const needsIncrement = failed || miss > 0;
    if (needsIncrement) {
      const delta = Math.max(1, miss || 0);
      return bumpCount(id, delta);
    }
    if (passed) {
      return decayCount(id, 1);
    }
    return getCount(id);
  }

  function getCount(id) {
    if (!id) return 0;
    const entry = state.get(id);
    return entry ? entry.count : 0;
  }

  function getUpdatedAt(id) {
    if (!id) return 0;
    const entry = state.get(id);
    return entry ? entry.updatedAt || 0 : 0;
  }

  function sortByDifficulty(items) {
    if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items.slice() : [];
    const annotated = items.map((item, index) => {
      const id = item && item.id ? String(item.id) : '';
      return {
        item,
        index,
        count: getCount(id),
        updatedAt: getUpdatedAt(id),
      };
    });
    annotated.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.index - b.index;
    });
    return annotated.map((entry) => entry.item);
  }

  function reset(id) {
    if (id) {
      state.delete(id);
      persist();
      return;
    }
    state.clear();
    persist();
  }

  function snapshot() {
    const result = {};
    for (const [id, entry] of state.entries()) {
      result[id] = { count: entry.count, updatedAt: entry.updatedAt };
    }
    return result;
  }

  return {
    getCount,
    getUpdatedAt,
    registerAttempt,
    sortByDifficulty,
    reset,
    snapshot,
  };
}

export function createInMemoryDifficultyTracker(now = () => Date.now()) {
  const state = new Map();

  function registerAttempt(id, { missingTokens = 0, failed = false, passed = false } = {}) {
    if (!id) return 0;
    if (!state.has(id)) {
      state.set(id, { count: 0, updatedAt: 0 });
    }
    const entry = state.get(id);
    const miss = Math.max(0, Math.floor(Number(missingTokens) || 0));
    if (failed || miss > 0) {
      const delta = Math.max(1, miss || 0);
      entry.count = Math.max(0, entry.count + delta);
    } else if (passed) {
      entry.count = Math.max(0, entry.count - 1);
    }
    entry.updatedAt = now();
    if (entry.count <= 0) {
      state.delete(id);
      return 0;
    }
    return entry.count;
  }

  function getCount(id) {
    if (!id) return 0;
    const entry = state.get(id);
    return entry ? entry.count : 0;
  }

  function sortByDifficulty(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item, index) => ({ item, index, count: getCount(item?.id) }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  return {
    registerAttempt,
    getCount,
    sortByDifficulty,
  };
}
