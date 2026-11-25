import { STORAGE_KEYS } from './local.js';

const FORMAT = 'english-pwa-learning-backup';
const SCHEMA_VERSION = 1;
const RECOVERY_KEY = 'englishPwaLearningRestoreRecoveryV1';
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

const {
  LEVEL_STATE, STUDY_LOG, NOTIF_STATE, CONFIG, SPEED, DAILY_GOAL, SESSION_GOAL,
} = STORAGE_KEYS;
const RECENT_SENTENCES = 'recentSentenceSessionIdsV1';
const RECENT_VOCABULARY = 'recentVocabularySessionIdsV1';
const RECENT_CHARACTERS = 'recentCharacterSessionsV1';
const MILESTONES = 'relationshipMilestonesV1';
const VOCABULARY_ROTATION = 'vocabularyRotationSeedV1';
const MIGRATION_KEYS = [
  'zeroSetupMigrationV1',
  'vocabularyV2ToV3MigrationCompletedV1',
  'vocabularyFinalAdmissionMergesCompletedV1',
];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const counter = value => Number.isSafeInteger(value) && value >= 0;
const records = (value, validate) => isRecord(value)
  && Object.entries(value).every(([key, row]) => validId(key) && validate(row, key));
const optionalFields = (value, fields) => isRecord(value)
  && Object.entries(fields).every(([key, validate]) => !Object.hasOwn(value, key) || validate(value[key]));
const ids = value => Array.isArray(value) && value.every(validId);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
function iso(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
const numericSetting = value => typeof value === 'string' && value.trim() !== '' && nonnegative(Number(value));
const reviewFields = { nextDueAt: nonnegative, stability: nonnegative, difficulty: nonnegative, intervalMs: nonnegative };
const level = value => optionalFields(value, {
  ...reviewFields,
  last: v => counter(v) && v <= 5,
  best: v => counter(v) && v <= 5,
  review: v => optionalFields(v, reviewFields),
  updatedAt: nonnegative,
  noHintStreak: counter,
  level5Count: counter,
  noHintHistory: v => Array.isArray(v) && v.every(nonnegative),
  lastMatch: nonnegative,
  hintStage: counter,
});
const countFields = { passes: counter, level5: counter, level5_count: counter, no_hint: counter, streak: counter };
const day = (value, key) => date(key) && optionalFields(value, {
  ...countFields,
  last_mode: v => ['read', 'compose'].includes(v),
  modes: v => records(v, counts => optionalFields(counts, countFields)),
  shadowing: v => optionalFields(v, { cards: counter, duration_ms: counter }),
  session_closure: v => optionalFields(v, {
    cardsDone: counter, conversationCount: counter, retryConversationCount: counter, attempts: counter,
    newIntroduced: counter, highestStreak: counter, nextDayMinimumGoal: counter, failRate: nonnegative,
    reason: v => typeof v === 'string', trainingMode: v => typeof v === 'string',
    message: v => typeof v === 'string', updatedAt: iso,
  }),
});
const configuration = value => isRecord(value)
  && Object.entries(value).every(([key, setting]) => key === 'studyMode' && ['read', 'compose'].includes(setting));
const types = {
  [LEVEL_STATE]: value => records(value, level),
  [STUDY_LOG]: value => records(value, day),
  [NOTIF_STATE]: value => optionalFields(value, {
    dailyZero: v => records(v, slots => records(slots, nonnegative)),
    dailyCompare: v => records(v, nonnegative),
    weeklyCompare: v => records(v, nonnegative),
  }),
  [CONFIG]: configuration,
  [SPEED]: numericSetting,
  [DAILY_GOAL]: numericSetting,
  [SESSION_GOAL]: numericSetting,
  [RECENT_SENTENCES]: ids,
  [RECENT_VOCABULARY]: ids,
  [RECENT_CHARACTERS]: ids,
  [MILESTONES]: value => records(value, nonnegative),
  [VOCABULARY_ROTATION]: value => numericSetting(value) && counter(Number(value)),
  [MIGRATION_KEYS[0]]: value => value === '1',
  [MIGRATION_KEYS[1]]: value => value === 'done',
  [MIGRATION_KEYS[2]]: value => value === 'done',
};
const strings = new Set([SPEED, DAILY_GOAL, SESSION_GOAL, VOCABULARY_ROTATION, ...MIGRATION_KEYS]);
const keys = Object.keys(types);

function readState(storage) {
  const rawState = Object.create(null);
  for (const key of keys) rawState[key] = storage.getItem(key);
  return rawState;
}

// Validate additional fields carried forward from older stores without allowing
// reserved object properties, non-finite numbers or deeply nested input.
function safeTree(value, depth = 0) {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return true;
  if (Array.isArray(value)) return value.every(row => safeTree(row, depth + 1));
  return records(value, row => safeTree(row, depth + 1));
}

function validateState(data) {
  if (!isRecord(data) || Object.keys(data).length !== keys.length
    || !keys.every(key => Object.hasOwn(data, key)
      && (data[key] === null || (safeTree(data[key]) && types[key](data[key]))))) {
    throw new Error('学習データの形式が正しくありません。');
  }
}

export function validateLearningBackup(backup) {
  if (!isRecord(backup) || backup.format !== FORMAT) throw new Error('English PWA のバックアップを選んでください。');
  if (backup.schemaVersion !== SCHEMA_VERSION) throw new Error('このバックアップの形式バージョンには対応していません。');
  if (!iso(backup.exportedAt) || typeof backup.appVersion !== 'string' || !/^v[\d.]+$/.test(backup.appVersion)
    || !isRecord(backup.curriculum) || !['sentences', 'vocabulary', 'characters'].every(
      name => typeof backup.curriculum[name] === 'string' && /^[a-f0-9]{64}$/.test(backup.curriculum[name]),
    )) throw new Error('バックアップの基本情報が正しくありません。');
  validateState(backup.data);
  return backup;
}

export function createLearningBackup(storage, { appVersion, curriculum, exportedAt = new Date().toISOString() }) {
  const data = Object.create(null);
  for (const [key, raw] of Object.entries(readState(storage))) {
    if (raw === null || strings.has(key)) {
      data[key] = raw;
      continue;
    }
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error(`端末内に読み取れない学習データがあります（${key}）。`); }
    // The only live portable setting in appConfigV3 is the sentence method.
    data[key] = key === CONFIG && isRecord(value)
      ? Object.fromEntries(Object.entries(value).filter(([name]) => name === 'studyMode'))
      : value;
  }
  return validateLearningBackup({ format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, appVersion, curriculum, data });
}

export function parseLearningBackup(text) {
  let backup;
  try { backup = JSON.parse(text); }
  catch { throw new Error('JSON ファイルを読み取れませんでした。'); }
  return validateLearningBackup(backup);
}

async function curriculumEntry(file, rows) {
  const response = await fetch(new URL(`../../data/${file}`, import.meta.url));
  if (!response.ok) throw new Error('教材を読み込めませんでした。接続を確認してください。');
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const entries = rows(JSON.parse(new TextDecoder().decode(bytes)));
  const currentIds = new Set(entries.map(row => String(row.id)));
  if (!currentIds.size || currentIds.has('undefined')) throw new Error('教材 ID を確認できませんでした。');
  return { hash, currentIds };
}

export async function loadBackupCurriculum() {
  const [sentences, vocabulary, characters] = await Promise.all([
    curriculumEntry('items.json', data => data),
    curriculumEntry('vocabulary-v3.json', data => data.entries),
    curriculumEntry('characters.json', data => data.characters),
  ]);
  return { sentences, vocabulary, characters };
}

export function previewLearningBackup(backup, curriculum) {
  const { data } = backup;
  const levelIds = Object.keys(data[LEVEL_STATE] || {});
  const isVocabularyId = id => /^(?:word|phrase|duo|vocab):/.test(id);
  const sentenceIds = levelIds.filter(id => !isVocabularyId(id));
  const vocabularyIds = levelIds.filter(isVocabularyId);
  const outstanding = (known, ...lists) => [...new Set(lists.flat())].filter(id => !known.has(id)).length;
  const log = Object.values(data[STUDY_LOG] || {});
  return {
    sameCurriculum: Object.entries(curriculum).every(([name, { hash }]) => hash === backup.curriculum[name]),
    sentenceCount: sentenceIds.length,
    vocabularyCount: vocabularyIds.length,
    studyDays: log.length,
    sessionSummaries: log.filter(entry => entry.session_closure).length,
    missingSentences: outstanding(curriculum.sentences.currentIds, sentenceIds, data[RECENT_SENTENCES] || []),
    missingVocabulary: outstanding(curriculum.vocabulary.currentIds, vocabularyIds, data[RECENT_VOCABULARY] || []),
    missingCharacters: outstanding(curriculum.characters.currentIds, data[RECENT_CHARACTERS] || []),
  };
}

export function hasPendingLearningRestore(storage) {
  return storage.getItem(RECOVERY_KEY) !== null;
}

export function recoverLearningRestore(storage) {
  const raw = storage.getItem(RECOVERY_KEY);
  if (raw === null) return;
  const prior = JSON.parse(raw);
  if (!isRecord(prior) || Object.keys(prior).length !== keys.length || !keys.every(key =>
    Object.hasOwn(prior, key) && (prior[key] === null || typeof prior[key] === 'string'))) {
    throw new Error('学習データの復旧用記録が無効です。');
  }
  // Remove the partial replacement to make space even after quota exhaustion.
  for (const key of keys) storage.removeItem(key);
  for (const key of keys) if (prior[key] !== null) storage.setItem(key, prior[key]);
  storage.removeItem(RECOVERY_KEY);
}

export function restoreLearningBackup(storage, backup) {
  validateLearningBackup(backup);
  if (hasPendingLearningRestore(storage)) throw new Error('学習データの復旧が必要です。アプリを開き直してください。');
  const replacement = Object.fromEntries(keys.map(key => [
    key, backup.data[key] === null || strings.has(key) ? backup.data[key] : JSON.stringify(backup.data[key]),
  ]));
  const prior = readState(storage);
  if (keys.every(key => replacement[key] === prior[key])) return;
  // A durable undo record is written before any live key is changed. Its
  // removal commits the replacement. Boot recovers it after an interruption.
  try { storage.setItem(RECOVERY_KEY, JSON.stringify(prior)); }
  catch { throw new Error('復元前のデータを退避できませんでした。端末の空き容量を確認してください。'); }
  try {
    // Clear shrinking keys first, then write the rest from the replacement.
    for (const key of keys) if (prior[key] !== replacement[key]) storage.removeItem(key);
    for (const key of keys) {
      if (replacement[key] !== null && replacement[key] !== prior[key]) storage.setItem(key, replacement[key]);
    }
    storage.removeItem(RECOVERY_KEY);
  } catch {
    try { recoverLearningRestore(storage); }
    catch { throw new Error('復旧を完了できませんでした。アプリを開き直してください。'); }
    throw new Error('復元できなかったため、復元前のデータに戻しました。');
  }
}
