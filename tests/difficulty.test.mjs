import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDifficultyTracker } from '../scripts/state/difficulty.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    load(key, fallback) {
      if (!store.has(key)) return fallback;
      try {
        return JSON.parse(store.get(key));
      } catch (_) {
        return fallback;
      }
    },
    save(key, value) {
      store.set(key, JSON.stringify(value));
    },
  };
}

test('difficulty tracker increments and decays mismatch counters', () => {
  const storage = createMemoryStorage();
  let currentTime = 1_000;
  const tracker = createDifficultyTracker({
    load: storage.load,
    save: storage.save,
    now: () => currentTime,
  });

  tracker.registerAttempt('card-1', { missingTokens: 2, failed: false });
  assert.equal(tracker.getCount('card-1'), 2, 'missing tokens increment count');

  currentTime += 10;
  tracker.registerAttempt('card-1', { missingTokens: 0, failed: true });
  assert.equal(tracker.getCount('card-1'), 3, 'failed attempt increments count');

  currentTime += 10;
  tracker.registerAttempt('card-1', { missingTokens: 0, failed: false, passed: true });
  assert.equal(tracker.getCount('card-1'), 2, 'passing attempt decays difficulty');

  const snapshot = tracker.snapshot();
  assert.equal(snapshot['card-1'].count, 2);
  assert.ok(snapshot['card-1'].updatedAt >= 1_020);
});

test('difficulty tracker sorts items by difficulty descending', () => {
  const storage = createMemoryStorage();
  let ts = 0;
  const tracker = createDifficultyTracker({
    load: storage.load,
    save: storage.save,
    now: () => {
      ts += 1;
      return ts;
    },
  });

  const items = [
    { id: 'a', value: 'alpha' },
    { id: 'b', value: 'beta' },
    { id: 'c', value: 'gamma' },
  ];

  tracker.registerAttempt('b', { missingTokens: 0, failed: true });
  tracker.registerAttempt('a', { missingTokens: 3, failed: false });
  tracker.registerAttempt('c', { missingTokens: 0, failed: false, passed: true });

  const sorted = tracker.sortByDifficulty(items);
  assert.deepEqual(sorted.map((item) => item.id), ['a', 'b', 'c']);
});
