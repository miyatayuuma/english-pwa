const DEFAULT_STORAGE_KEY = 'pendingLogs';

function cloneData(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function generateUid() {
  const cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch (_) {
      // ignore
    }
  }
  return 'uid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createLogManager({
  loadJson,
  saveJson,
  storageKey = DEFAULT_STORAGE_KEY,
  getConfig,
} = {}) {
  if (typeof loadJson !== 'function' || typeof saveJson !== 'function') {
    throw new Error('createLogManager requires loadJson and saveJson functions');
  }

  const key = storageKey || DEFAULT_STORAGE_KEY;

  const loadPending = () => {
    const raw = loadJson(key, []);
    if (Array.isArray(raw)) {
      return raw.filter((entry) => entry && entry.type && entry.url);
    }
    return [];
  };

  let pendingLogs = loadPending();
  for (const entry of pendingLogs) {
    if (!entry.uid) entry.uid = generateUid();
    if (entry.data && !entry.data.client_uid) entry.data.client_uid = entry.uid;
  }

  const rememberPending = () => {
    saveJson(key, pendingLogs);
  };

  rememberPending();

  let flushPromise = null;

  const flushPendingLogs = async () => {
    if (!pendingLogs.length) return;
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      const accepted = new Set();
      const groups = new Map();
      for (const entry of pendingLogs) {
        if (!entry || !entry.url || !entry.type) continue;
        const groupKey = `${entry.url}::${entry.apiKey || ''}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { url: entry.url, apiKey: entry.apiKey, items: [] });
        }
        const data = Object.assign({}, entry.data || {});
        if (!data.client_uid) data.client_uid = entry.uid;
        groups.get(groupKey).items.push({ uid: entry.uid, type: entry.type, data });
      }
      for (const group of groups.values()) {
        if (!group.items.length) continue;
        const payload = { type: 'bulk', apiKey: group.apiKey, entries: group.items };
        try {
          const res = await fetch(group.url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) continue;
          let json = null;
          try {
            json = await res.json();
          } catch (_) {
            json = null;
          }
          if (json && json.ok) {
            const ack = Array.isArray(json.accepted) ? json.accepted : group.items.map((it) => it.uid);
            ack.forEach((uid) => accepted.add(uid));
          }
        } catch (err) {
          console.warn('flushPendingLogs', err);
        }
      }
      let changed = false;
      if (accepted.size) {
        pendingLogs = pendingLogs.filter((entry) => !accepted.has(entry.uid));
        changed = true;
      }
      const cleaned = pendingLogs.filter((entry) => entry && entry.url);
      if (cleaned.length !== pendingLogs.length) {
        pendingLogs = cleaned;
        changed = true;
      }
      if (changed) rememberPending();
    })();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  };

  const queueLog = (type, data) => {
    const cfg = typeof getConfig === 'function' ? getConfig() || {} : {};
    const url = (cfg.apiUrl || '').trim();
    if (!url) return undefined;
    const uid = generateUid();
    const payload = Object.assign({}, data || {});
    if (!payload.client_uid) payload.client_uid = uid;
    const entry = {
      uid,
      type,
      data: payload,
      url,
      apiKey: (cfg.apiKey || '') || undefined,
      createdAt: Date.now(),
    };
    pendingLogs.push(entry);
    rememberPending();
    const flushTask = flushPendingLogs().catch((err) => {
      console.warn('sendLog', err);
    });
    return flushTask;
  };

  const setEndpointForPending = (url, apiKey) => {
    for (const entry of pendingLogs) {
      entry.url = url;
      entry.apiKey = apiKey;
    }
    rememberPending();
  };

  const clearPendingEndpoints = () => {
    for (const entry of pendingLogs) {
      entry.url = '';
      entry.apiKey = undefined;
    }
    rememberPending();
  };

  const getPendingEntries = () => pendingLogs.map((entry) => cloneData(entry));

  return {
    sendLog: queueLog,
    flushPendingLogs,
    rememberPending,
    setEndpointForPending,
    clearPendingEndpoints,
    getPendingEntries,
  };
}
