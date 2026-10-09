import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  values = new Map();
  failWrites = false;
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('storage full');
    this.values.set(String(key), String(value));
  }
  removeItem(key) { this.values.delete(String(key)); }
}

globalThis.localStorage = new MemoryStorage();
const { createLevelStateManager } = await import('../scripts/app/levelState.js?observer-test');

function createManager(onSrsWrite) {
  return createLevelStateManager({
    baseHintStage: 0,
    getFirstHintStage: () => 1,
    getEnglishRevealStage: () => 1,
    onSrsWrite,
  });
}

test('SRS observer runs after the real storage call and reports actual before/candidate/after review state', () => {
  const writes = [];
  const manager = createManager(event => writes.push(event));
  const evaluation = manager.evaluateLevel(0.95, 0);
  const result = manager.updateLevelInfo('E0102', evaluation, { now: 123456 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].persisted, true);
  assert.equal(writes[0].persistenceWriteCount, 1);
  assert.equal(writes[0].before.last, 0);
  assert.equal(writes[0].candidateLevel, evaluation.candidate);
  assert.equal(writes[0].after.last, result.info.last);
  assert.equal(writes[0].after.review.nextDueAt, result.info.review.nextDueAt);
  assert.ok(globalThis.localStorage.getItem('itemLevelV1'), 'the normal SRS state was persisted');
});

test('a storage failure is reported as a failed persistence write without changing the normal grading return', () => {
  const writes = [];
  const manager = createManager(event => writes.push(event));
  globalThis.localStorage.failWrites = true;
  const evaluation = manager.evaluateLevel(0.5, 0);
  const result = manager.updateLevelInfo('E0999', evaluation, { now: 123457 });
  assert.equal(result.info.last, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].persisted, false);
  assert.equal(writes[0].persistenceWriteCount, 0);
  globalThis.localStorage.failWrites = false;
});
