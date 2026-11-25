import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLearningBackup, hasPendingLearningRestore, parseLearningBackup,
  previewLearningBackup, recoverLearningRestore, restoreLearningBackup,
} from '../scripts/storage/learningBackup.js';

const curriculum = { sentences: 'a'.repeat(64), vocabulary: 'b'.repeat(64), characters: 'c'.repeat(64) };
const metadata = { appVersion: 'v5.117', curriculum, exportedAt: '2026-11-25T18:00:00.000Z' };
const learning = {
  itemLevelV1: JSON.stringify({
    E0001: { last: 4, best: 4, updatedAt: 1730000000000, noHintHistory: [1730000000000],
      review: { nextDueAt: 1770000000000, stability: 2, difficulty: 4, intervalMs: 15000 } },
    'vocab:00001': { last: 3, best: 3, nextDueAt: 1770000000000 },
    'vocab:old': { last: 2, best: 3, updatedAt: 1730000000000 },
  }),
  studyLogV1: JSON.stringify({ '2026-11-25': { passes: 10, modes: { read: { passes: 10 } },
    session_closure: { cardsDone: 10, attempts: 12, reason: 'completed', failRate: 0.167 } } }),
  notifStateV1: '{"dailyCompare":{"2026-11-25":1730000000000}}',
  appConfigV3: '{"studyMode":"compose"}',
  dailyGoalV1: '18',
  sessionGoalV1: '8',
  audioSpeedV1: '1.25',
  recentSentenceSessionIdsV1: '["E0001","E9999"]',
  recentVocabularySessionIdsV1: '["vocab:00001"]',
  recentCharacterSessionsV1: '["bob"]',
  relationshipMilestonesV1: '{"friends_5":1730000000000}',
  vocabularyRotationSeedV1: '8',
  zeroSetupMigrationV1: '1',
  vocabularyV2ToV3MigrationCompletedV1: 'done',
  vocabularyFinalAdmissionMergesCompletedV1: 'done',
};

function makeStorage(seed = {}, beforeSet = () => {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      beforeSet(key);
      values.set(key, value);
    },
  };
}

test('full replacement round-trips and retains historical IDs without combining data', () => {
  const source = makeStorage({
    ...learning, appConfigV3: '{"studyMode":"compose","apiKey":"hidden"}',
    uxMetricsV1: '{"transient":true}', pendingLogsV1: '[42]',
  });
  const backup = parseLearningBackup(JSON.stringify(createLearningBackup(source, metadata)));
  assert.deepEqual(backup.data.appConfigV3, { studyMode: 'compose' });
  assert.equal(Object.hasOwn(backup.data, 'uxMetricsV1'), false);
  assert.equal(Object.hasOwn(backup.data, 'pendingLogsV1'), false);
  const target = makeStorage({ unrelated: 'yes', itemLevelV1: '{"E0002":{"last":5,"best":5}}' });
  for (let i = 0; i < 2; i++) {
    restoreLearningBackup(target, backup);
    assert.deepEqual(Object.fromEntries(target.values), { ...learning, unrelated: 'yes' });
    assert.deepEqual(createLearningBackup(target, metadata).data, createLearningBackup(source, metadata).data);
  }
  const preview = previewLearningBackup(backup, {
    sentences: { hash: curriculum.sentences, currentIds: new Set(['E0001']) },
    vocabulary: { hash: 'd'.repeat(64), currentIds: new Set(['vocab:00001']) },
    characters: { hash: curriculum.characters, currentIds: new Set(['bob']) },
  });
  assert.deepEqual(preview, {
    sameCurriculum: false, sentenceCount: 1, vocabularyCount: 2, studyDays: 1, sessionSummaries: 1,
    missingSentences: 1, missingVocabulary: 1, missingCharacters: 0,
  });
});

test('invalid backups and failed recovery reservation leave storage unchanged', () => {
  const original = { itemLevelV1: '{"E0002":{"last":4}}', audioSpeedV1: '1.25' };
  const target = makeStorage(original, () => { throw new Error('quota'); });
  const backup = createLearningBackup(makeStorage(learning), metadata);
  assert.throws(() => parseLearningBackup('bad json'), /JSON/);
  assert.throws(() => restoreLearningBackup(target, { ...backup, schemaVersion: 2 }), /バージョン/);
  assert.throws(() => restoreLearningBackup(target, { ...backup, data: { ...backup.data, itemLevelV1: [] } }), /形式/);
  assert.throws(() => restoreLearningBackup(target, { ...backup, data: { ...backup.data, appConfigV3: { apiKey: 'bad' } } }), /形式/);
  assert.throws(() => restoreLearningBackup(target, { ...backup, data: { ...backup.data, itemLevelV1: JSON.parse('{"__proto__":{"last":5}}') } }), /形式/);
  assert.throws(() => restoreLearningBackup(target, backup), /退避/);
  assert.deepEqual(Object.fromEntries(target.values), original);
});

test('partial failure rolls back, and startup can recover an interrupted rollback', () => {
  const original = { itemLevelV1: '{"E0002":{"last":4}}', studyLogV1: '{}', audioSpeedV1: '0.9' };
  const backup = createLearningBackup(makeStorage(learning), metadata);
  let failures = 1;
  const target = makeStorage(original, key => {
    if (key === 'studyLogV1' && failures > 0) {
      failures--;
      throw new Error('write interrupted');
    }
  });
  assert.throws(() => restoreLearningBackup(target, backup), /元のデータ|復元前のデータ/);
  assert.equal(hasPendingLearningRestore(target), false);
  assert.deepEqual(Object.fromEntries(target.values), original);

  failures = 2;
  assert.throws(() => restoreLearningBackup(target, backup), /復旧を完了/);
  assert.equal(hasPendingLearningRestore(target), true);
  recoverLearningRestore(target);
  assert.equal(hasPendingLearningRestore(target), false);
  assert.deepEqual(Object.fromEntries(target.values), original);
});

test('a backup from an empty profile clears portable keys and leaves other keys alone', () => {
  const target = makeStorage({ ...learning, other: 'keep' });
  restoreLearningBackup(target, createLearningBackup(makeStorage(), metadata));
  assert.deepEqual(Object.fromEntries(target.values), { other: 'keep' });
});
