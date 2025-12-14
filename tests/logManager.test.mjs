import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLogManager } from '../scripts/app/logManager.js';

test('deferred logs flush after connectivity resumes', async () => {
  const storage = new Map();
  const loadJson = (key, fallback) => {
    if (storage.has(key)) {
      return JSON.parse(storage.get(key));
    }
    return fallback;
  };
  const saveJson = (key, value) => {
    storage.set(key, JSON.stringify(value));
  };

  let config = { apiUrl: 'https://example.test/log', apiKey: 'abc123' };
  const manager = createLogManager({
    loadJson,
    saveJson,
    storageKey: 'log-test',
    getConfig: () => config,
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('offline');
    };

    await manager.sendLog('attempt', { id: 'card-1' });

    assert.equal(fetchCalls, 1, 'sendLog should attempt to flush immediately');
    assert.equal(manager.getPendingEntries().length, 1, 'failed logs remain pending');

    globalThis.fetch = async (_url, { body }) => {
      fetchCalls += 1;
      const parsed = JSON.parse(body);
      return {
        ok: true,
        async json() {
          return { ok: true, accepted: parsed.entries.map((entry) => entry.uid) };
        },
      };
    };

    await manager.flushPendingLogs();

    assert.equal(manager.getPendingEntries().length, 0, 'pending logs cleared after flush');
    assert.equal(fetchCalls, 2, 'flush retried when connectivity returned');
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
  }
});

test('network failures do not spam console warnings', async () => {
  const storage = new Map();
  const loadJson = (key, fallback) => {
    if (storage.has(key)) {
      return JSON.parse(storage.get(key));
    }
    return fallback;
  };
  const saveJson = (key, value) => {
    storage.set(key, JSON.stringify(value));
  };

  const manager = createLogManager({
    loadJson,
    saveJson,
    storageKey: 'log-test',
    getConfig: () => ({ apiUrl: 'https://example.test/log', apiKey: 'abc123' }),
  });

  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];

  try {
    console.warn = (...args) => warnings.push(args.join(' '));
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };

    await manager.sendLog('attempt', { id: 'card-1' });

    assert.equal(warnings.length, 0, 'expected network errors are muted');
    assert.equal(manager.getPendingEntries().length, 1, 'failed logs stay pending');
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
    console.warn = originalWarn;
  }
});
