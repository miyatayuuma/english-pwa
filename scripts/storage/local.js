'use strict';

const STORAGE_KEYS = Object.freeze({
  STUDY_LOG: 'studyLogV1',
  NOTIF_STATE: 'notifStateV1',
  LEVEL_STATE: 'itemLevelV1',
  LEVEL_FILTER: 'levelFilterV1',
  SEARCH: 'itemSearchV1',
  SPEED: 'audioSpeedV1',
  CONFIG: 'appConfigV3',
  PENDING_LOGS: 'pendingLogsV1',
  SECTION_SELECTION: 'secSel',
  ORDER_SELECTION: 'orderSel'
});

const storage = (() => {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_) {
    // ignore
  }
  return null;
})();

function safeGetItem(key) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeSetItem(key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function loadJson(key, fallback) {
  const raw = safeGetItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function saveJson(key, value) {
  const payload = value === undefined ? null : value;
  try {
    safeSetItem(key, JSON.stringify(payload));
  } catch (_) {
    // ignore
  }
}

function loadString(key, fallback = '') {
  const raw = safeGetItem(key);
  return raw !== null ? raw : fallback;
}

function saveString(key, value = '') {
  safeSetItem(key, String(value ?? ''));
}

function loadNumber(key, fallback) {
  const raw = safeGetItem(key);
  if (raw === null) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function saveNumber(key, value) {
  if (Number.isFinite(value)) {
    safeSetItem(key, String(value));
  } else if (value === null) {
    safeSetItem(key, '');
  }
}

function remove(key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (_) {
    // ignore
  }
}

export {
  STORAGE_KEYS,
  loadJson,
  saveJson,
  loadString,
  saveString,
  loadNumber,
  saveNumber,
  remove
};
