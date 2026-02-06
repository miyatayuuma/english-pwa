import { STORAGE_KEYS, loadJson, saveJson } from '../storage/local.js';

const LEVEL_CHOICES = [0, 1, 2, 3, 4, 5];
const LEGACY_LEVEL_CHOICES = [1, 2, 3, 4, 5];
const NO_HINT_RATE_THRESHOLD = 0.9;
const PERFECT_MATCH_THRESHOLD = 0.999;
const PROMOTION_RULES = {
  4: { required: 2, minIntervalMs: 12 * 60 * 60 * 1000 },
  5: { required: 3, minIntervalMs: 24 * 60 * 60 * 1000 },
};
const NO_HINT_HISTORY_LIMIT = 24;
const DEFAULT_REVIEW_STATE = Object.freeze({
  nextDueAt: 0,
  stability: 1,
  difficulty: 5,
  intervalMs: 0,
});

const { LEVEL_STATE, LEVEL_FILTER } = STORAGE_KEYS;

function loadLevelStateFromStorage() {
  const parsed = loadJson(LEVEL_STATE, {}) || {};
  if (!parsed || typeof parsed !== 'object') return {};
  const normalized = {};
  for (const [id, rawInfo] of Object.entries(parsed)) {
    if (!rawInfo || typeof rawInfo !== 'object') continue;
    const info = { ...rawInfo };
    const legacyReview = {
      nextDueAt: info.nextDueAt,
      stability: info.stability,
      difficulty: info.difficulty,
      intervalMs: info.intervalMs,
    };
    info.review = normalizeReviewState(info.review || legacyReview);
    info.nextDueAt = info.review.nextDueAt;
    info.stability = info.review.stability;
    info.difficulty = info.review.difficulty;
    normalized[id] = info;
  }
  return normalized;
}

function saveLevelStateToStorage(state) {
  saveJson(LEVEL_STATE, state || {});
}

function normalizeNoHintHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value) || 0)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
    .slice(-NO_HINT_HISTORY_LIMIT);
}

function normalizeReviewState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nextDueAt = Math.max(0, Number(src.nextDueAt) || 0);
  const stabilityRaw = Number(src.stability);
  const difficultyRaw = Number(src.difficulty);
  const intervalRaw = Number(src.intervalMs);
  return {
    nextDueAt,
    stability: Number.isFinite(stabilityRaw) ? Math.max(0.2, Math.min(12, stabilityRaw)) : DEFAULT_REVIEW_STATE.stability,
    difficulty: Number.isFinite(difficultyRaw) ? Math.max(1, Math.min(10, difficultyRaw)) : DEFAULT_REVIEW_STATE.difficulty,
    intervalMs: Number.isFinite(intervalRaw) ? Math.max(0, intervalRaw) : DEFAULT_REVIEW_STATE.intervalMs,
  };
}

function computeReviewState(prevReview, evaluation, now) {
  const prev = normalizeReviewState(prevReview);
  const rate = Math.max(0, Math.min(1, Number(evaluation?.rate) || 0));
  const pass = !!evaluation?.pass;
  const noHintSuccess = !!evaluation?.noHintSuccess;
  const usedHint = Number.isFinite(evaluation?.stage) ? Number(evaluation.stage) > 0 : false;
  const previousInterval = Math.max(prev.intervalMs || 0, prev.nextDueAt > now ? prev.nextDueAt - now : 0);

  let intervalMs = 12 * 60 * 60 * 1000;
  let stability = prev.stability;
  let difficulty = prev.difficulty;

  if (!pass || rate < 0.7) {
    intervalMs = Math.max(10 * 60 * 1000, Math.round(previousInterval * 0.3));
    stability = Math.max(0.2, prev.stability * 0.7);
    difficulty = Math.min(10, prev.difficulty + 0.7);
  } else if (rate < 0.8) {
    intervalMs = Math.max(2 * 60 * 60 * 1000, Math.round(previousInterval * 0.6));
    stability = Math.max(0.3, prev.stability * 0.9);
    difficulty = Math.min(10, prev.difficulty + 0.4);
  } else if (usedHint) {
    intervalMs = Math.max(8 * 60 * 60 * 1000, Math.round(previousInterval * 1.05));
    stability = Math.min(12, prev.stability * 1.05);
    difficulty = Math.max(1, Math.min(10, prev.difficulty + 0.15));
  } else if (noHintSuccess && rate >= 0.95) {
    intervalMs = Math.max(24 * 60 * 60 * 1000, Math.round(previousInterval * 1.8));
    stability = Math.min(12, prev.stability * 1.35);
    difficulty = Math.max(1, prev.difficulty - 0.5);
  } else if (noHintSuccess) {
    intervalMs = Math.max(12 * 60 * 60 * 1000, Math.round(previousInterval * 1.4));
    stability = Math.min(12, prev.stability * 1.2);
    difficulty = Math.max(1, prev.difficulty - 0.25);
  }

  return {
    nextDueAt: now + intervalMs,
    intervalMs,
    stability,
    difficulty,
  };
}

function computeNoHintProgress(history, rule, now) {
  const normalizedHistory = normalizeNoHintHistory(history);
  if (!rule) {
    return {
      qualified: normalizedHistory.length,
      required: 0,
      remaining: 0,
      met: true,
      lastQualifiedAt: null,
      nextEligibleAt: null,
      countedThisAttempt: false,
    };
  }
  const minInterval = Math.max(0, Number(rule.minIntervalMs) || 0);
  const selected = [];
  let lastIncluded = -Infinity;
  for (const timestamp of normalizedHistory) {
    if (!selected.length || timestamp - lastIncluded >= minInterval) {
      selected.push(timestamp);
      lastIncluded = timestamp;
    }
  }
  const qualified = selected.length;
  const required = Math.max(0, Number(rule.required) || 0);
  const met = qualified >= required;
  const lastQualifiedAt = selected.length ? selected[selected.length - 1] : null;
  let nextEligibleAt = null;
  if (lastQualifiedAt && minInterval > 0) {
    const candidateTimestamp = lastQualifiedAt + minInterval;
    if (!Number.isFinite(now) || candidateTimestamp > now) {
      nextEligibleAt = candidateTimestamp;
    }
  }
  const countedThisAttempt = Number.isFinite(now) && lastQualifiedAt === now;
  const remaining = Math.max(0, required - qualified);
  return {
    qualified,
    required,
    remaining,
    met,
    lastQualifiedAt,
    nextEligibleAt,
    countedThisAttempt,
  };
}

function determineNextTarget(info, candidate, finalLevel, promotionBlocked, now) {
  if (!info) return null;
  const lastLevel = Number(info.last);
  const bestLevel = Number(info.best);
  const normalizedLast = Number.isFinite(lastLevel) ? lastLevel : 0;
  const normalizedBest = Number.isFinite(bestLevel) ? bestLevel : 0;
  let target = null;
  if (promotionBlocked && promotionBlocked.target) {
    target = promotionBlocked.target;
  } else if (normalizedLast >= 4) {
    if (normalizedLast === 4) {
      target = 5;
    }
  } else {
    const referenceLevel = Math.max(normalizedLast, normalizedBest);
    if (referenceLevel >= 3) {
      target = 4;
    }
  }
  if (!target && normalizedLast === 4) {
    target = 5;
  }
  if (!target || !PROMOTION_RULES[target]) return null;
  const rule = PROMOTION_RULES[target];
  const progress = computeNoHintProgress(info.noHintHistory, rule, now);
  const cooldownMs = progress.nextEligibleAt ? Math.max(0, progress.nextEligibleAt - now) : 0;
  return {
    target,
    required: rule.required,
    qualified: progress.qualified,
    remaining: progress.remaining,
    minIntervalMs: rule.minIntervalMs,
    nextEligibleAt: progress.nextEligibleAt || null,
    cooldownMs,
    countedThisAttempt: progress.countedThisAttempt,
    met: progress.met,
  };
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes > 0) return `${hours}時間${minutes}分`;
    return `${hours}時間`;
  }
  return `${Math.max(1, totalMinutes)}分`;
}

function buildNoHintProgressNote(goal) {
  if (!goal) return '';
  const levelLabel = `Lv${goal.target}`;
  if ((goal.remaining || 0) <= 0) {
    return `${levelLabel}のノーヒント条件は準備OK！`;
  }
  let message = `あと${goal.remaining}回ノーヒント合格で${levelLabel}`;
  if (goal.cooldownMs > 0) {
    const waitLabel = formatDurationMs(goal.cooldownMs);
    if (waitLabel) {
      message += `（${waitLabel}後にカウント可）`;
    }
  }
  return message;
}

function loadLevelFilterFromStorage() {
  const parsed = loadJson(LEVEL_FILTER, null);
  if (Array.isArray(parsed)) {
    const valid = parsed.map((value) => Number(value)).filter((value) => LEVEL_CHOICES.includes(value));
    if (valid.length) {
      const set = new Set(valid);
      const coversLegacy = LEGACY_LEVEL_CHOICES.every((level) => set.has(level));
      if (coversLegacy && !set.has(0)) set.add(0);
      return set;
    }
  }
  return new Set(LEVEL_CHOICES);
}

function saveLevelFilterToStorage(set) {
  if (!(set instanceof Set)) return;
  const arr = LEVEL_CHOICES.filter((level) => set.has(level));
  saveJson(LEVEL_FILTER, arr);
}

export function createLevelStateManager({ baseHintStage, getFirstHintStage, getEnglishRevealStage }) {
  let levelStateMap = loadLevelStateFromStorage();
  let levelFilterSet = loadLevelFilterFromStorage();

  function ensureLevelFilterSet(set) {
    if (!(set instanceof Set) || set.size === 0) {
      return new Set(LEVEL_CHOICES);
    }
    return set;
  }

  function getLevelFilterSet() {
    return new Set(levelFilterSet);
  }

  function setLevelFilterSet(nextSet) {
    levelFilterSet = ensureLevelFilterSet(nextSet instanceof Set ? nextSet : new Set(nextSet));
    saveLevelFilterToStorage(levelFilterSet);
    return getLevelFilterSet();
  }

  function getActiveLevelArray() {
    levelFilterSet = ensureLevelFilterSet(levelFilterSet);
    const arr = LEVEL_CHOICES.filter((level) => levelFilterSet.has(level));
    return arr.length ? arr : LEVEL_CHOICES.slice();
  }

  function getLevelInfo(id) {
    if (!id) return { best: 0, last: 0 };
    return levelStateMap[id] || { best: 0, last: 0 };
  }

  function evaluateLevel(matchRate, hintStageUsed) {
    const rate = Math.max(0, Math.min(1, Number(matchRate) || 0));
    const stageRaw = Number.isFinite(hintStageUsed) ? Math.floor(hintStageUsed) : baseHintStage;
    const stage = Math.max(baseHintStage, stageRaw);
    const firstHintStage = getFirstHintStage();
    const englishRevealStage = getEnglishRevealStage();
    const usedHint = stage >= firstHintStage;
    const revealedEnglishHint = stage >= englishRevealStage;
    let candidate = 1;
    if (rate < 0.7) {
      candidate = 1;
    } else if (rate < 0.8) {
      candidate = 2;
    } else if (rate < 0.9) {
      candidate = 3;
    } else if (usedHint) {
      candidate = 3;
    } else if (rate < 1) {
      candidate = 4;
    } else {
      candidate = 5;
    }
    const usedEnglishHint = usedHint;
    const noHintSuccess = !usedHint && rate >= NO_HINT_RATE_THRESHOLD;
    const perfectNoHint = noHintSuccess && rate >= PERFECT_MATCH_THRESHOLD;
    const pass = rate >= 0.7;
    return { candidate, rate, stage, noHintSuccess, perfectNoHint, usedEnglishHint, revealedEnglishHint, pass };
  }

  function updateLevelInfo(id, evaluation, { now = Date.now() } = {}) {
    const fallbackCandidate = Number.isFinite(Number(evaluation?.candidate)) ? Number(evaluation.candidate) : 0;
    if (!id) {
      const fallback = { best: fallbackCandidate, last: fallbackCandidate };
      return {
        info: fallback,
        candidate: fallbackCandidate,
        finalLevel: fallbackCandidate,
        best: fallbackCandidate,
        promotionBlocked: null,
        nextTarget: null,
        evaluation,
      };
    }
    const info = levelStateMap[id] || { best: 0, last: 0 };
    const prevLastRaw = Number(info.last);
    const prevBestRaw = Number(info.best);
    const prevLast = Number.isFinite(prevLastRaw) ? prevLastRaw : 0;
    const prevBest = Number.isFinite(prevBestRaw) ? prevBestRaw : 0;
    const stage = Number.isFinite(evaluation?.stage) ? Number(evaluation.stage) : baseHintStage;
    const rate = Number(evaluation?.rate) || 0;
    if (!Array.isArray(info.noHintHistory)) info.noHintHistory = [];
    const history = info.noHintHistory.slice();
    const noHintSuccess = !!evaluation?.noHintSuccess;
    if (noHintSuccess) {
      history.push(now);
      const prevStreak = Number(info.noHintStreak) || 0;
      info.noHintStreak = prevStreak + 1;
      info.lastNoHintAt = now;
    } else {
      info.noHintStreak = 0;
    }
    const perfectNoHint = !!evaluation?.perfectNoHint;
    let level5CountNumeric = Number(info.level5Count);
    if (!Number.isFinite(level5CountNumeric) || level5CountNumeric < 0) {
      level5CountNumeric = 0;
    }
    if (perfectNoHint) {
      level5CountNumeric += 1;
    }
    info.level5Count = level5CountNumeric;
    const normalizedHistory = normalizeNoHintHistory(history);
    info.noHintHistory = normalizedHistory;
    const candidate = Math.max(0, Math.floor(fallbackCandidate));
    let finalLevel = candidate;
    let promotionBlocked = null;
    if (candidate > prevLast && candidate >= 4) {
      const rule = PROMOTION_RULES[candidate];
      if (rule) {
        const progress = computeNoHintProgress(normalizedHistory, rule, now);
        if (!progress.met || progress.remaining > 0) {
          finalLevel = prevLast;
          promotionBlocked = Object.assign({ target: candidate, minIntervalMs: rule.minIntervalMs }, progress);
        }
      }
    }
    if (!Number.isFinite(finalLevel)) finalLevel = 0;
    info.last = finalLevel;
    if (!Number.isFinite(prevBestRaw)) info.best = prevBest;
    if (info.last > prevBest) info.best = info.last;
    const nextReview = computeReviewState(info.review, evaluation, now);
    info.review = nextReview;
    info.nextDueAt = nextReview.nextDueAt;
    info.stability = nextReview.stability;
    info.difficulty = nextReview.difficulty;
    info.intervalMs = nextReview.intervalMs;
    info.lastMatch = rate;
    info.hintStage = stage;
    info.updatedAt = now;
    levelStateMap[id] = info;
    saveLevelStateToStorage(levelStateMap);
    const nextTarget = determineNextTarget(info, candidate, finalLevel, promotionBlocked, now);
    return {
      info,
      candidate,
      finalLevel: info.last,
      best: info.best,
      promotionBlocked,
      nextTarget,
      evaluation,
    };
  }

  function lastRecordedLevel(id) {
    const info = getLevelInfo(id);
    if (!info) return 0;
    const lastVal = Number(info.last);
    if (Number.isFinite(lastVal)) return lastVal;
    const bestVal = Number(info.best);
    if (Number.isFinite(bestVal)) return bestVal;
    return 0;
  }

  function refreshLevelState() {
    levelStateMap = loadLevelStateFromStorage();
    return levelStateMap;
  }

  return {
    evaluateLevel,
    getLevelInfo,
    updateLevelInfo,
    buildNoHintProgressNote,
    getActiveLevelArray,
    getLevelFilterSet,
    setLevelFilterSet,
    lastRecordedLevel,
    refreshLevelState,
  };
}

export { LEVEL_CHOICES };
