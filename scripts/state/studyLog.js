import {
  STORAGE_KEYS,
  loadJson,
  saveJson
} from '../storage/local.js';

const { STUDY_LOG: STUDY_LOG_KEY, NOTIF_STATE: NOTIF_STATE_KEY } = STORAGE_KEYS;

const DAY_MS = 86400000;

function localDateKey(time = Date.now()) {
  const d = new Date(time);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function loadStudyLog() {
  const parsed = loadJson(STUDY_LOG_KEY, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function saveStudyLog(log) {
  saveJson(STUDY_LOG_KEY, log || {});
}

function pruneStudyLog(log) {
  const entries = Object.entries(log || {});
  if (entries.length <= 190) return log || {};
  entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(entries.slice(-190));
}

let STUDY_LOG = pruneStudyLog(loadStudyLog());

function recordStudyProgress({
  pass = false,
  newLevel5 = false,
  noHint = false,
  perfect = false,
  streak = 0,
  mode = 'read'
} = {}) {
  const modeKey = mode === 'compose' ? 'compose' : 'read';
  const key = localDateKey();
  const entry = STUDY_LOG[key] || {
    passes: 0,
    level5: 0,
    level5_count: 0,
    no_hint: 0,
    streak: 0,
    modes: {}
  };
  if (!entry.modes || typeof entry.modes !== 'object') {
    entry.modes = {};
  }
  if (pass) entry.passes = (entry.passes || 0) + 1;
  if (newLevel5) entry.level5 = (entry.level5 || 0) + 1;
  if (noHint) entry.no_hint = (entry.no_hint || 0) + 1;
  if (perfect) entry.level5_count = (entry.level5_count || 0) + 1;
  if (Number.isFinite(streak)) entry.streak = Math.max(entry.streak || 0, streak || 0);
  entry.last_mode = modeKey;
  const modeEntry = entry.modes[modeKey] || {
    passes: 0,
    level5: 0,
    level5_count: 0,
    no_hint: 0,
    streak: 0
  };
  if (pass) modeEntry.passes = (modeEntry.passes || 0) + 1;
  if (newLevel5) modeEntry.level5 = (modeEntry.level5 || 0) + 1;
  if (noHint) modeEntry.no_hint = (modeEntry.no_hint || 0) + 1;
  if (perfect) modeEntry.level5_count = (modeEntry.level5_count || 0) + 1;
  if (Number.isFinite(streak)) modeEntry.streak = Math.max(modeEntry.streak || 0, streak || 0);
  entry.modes[modeKey] = modeEntry;
  STUDY_LOG[key] = entry;
  STUDY_LOG = pruneStudyLog(STUDY_LOG);
  saveStudyLog(STUDY_LOG);
  if (pass || newLevel5 || noHint || perfect) scheduleNotificationCheckSoon();
}

function getDailyStats(key) {
  const target = key || localDateKey();
  const entry = STUDY_LOG[target];
  const modeStats = {};
  if (entry && entry.modes && typeof entry.modes === 'object') {
    for (const [mk, mv] of Object.entries(entry.modes)) {
      if (!mv || typeof mv !== 'object') continue;
      modeStats[mk] = {
        passes: mv.passes || 0,
        level5: mv.level5 || 0,
        level5_count: mv.level5_count || 0,
        no_hint: mv.no_hint || 0,
        streak: mv.streak || 0
      };
    }
  }
  return {
    passes: entry?.passes || 0,
    level5: entry?.level5 || 0,
    level5_count: entry?.level5_count || 0,
    no_hint: entry?.no_hint || 0,
    streak: entry?.streak || 0,
    modes: modeStats
  };
}

function sumRange(startKey, endKey) {
  const res = { passes: 0, level5: 0, level5_count: 0, no_hint: 0, streak: 0, modes: {} };
  if (!startKey || !endKey) return res;
  let cur = startKey;
  while (cur <= endKey) {
    const st = STUDY_LOG[cur];
    if (st) {
      res.passes += st.passes || 0;
      res.level5 += st.level5 || 0;
      res.level5_count += st.level5_count || 0;
      res.no_hint += st.no_hint || 0;
      res.streak = Math.max(res.streak || 0, st.streak || 0);
      if (st.modes && typeof st.modes === 'object') {
        for (const [mk, mv] of Object.entries(st.modes)) {
          if (!res.modes[mk]) {
            res.modes[mk] = { passes: 0, level5: 0, level5_count: 0, no_hint: 0, streak: 0 };
          }
          const target = res.modes[mk];
          target.passes += mv?.passes || 0;
          target.level5 += mv?.level5 || 0;
          target.level5_count += mv?.level5_count || 0;
          target.no_hint += mv?.no_hint || 0;
          target.streak = Math.max(target.streak || 0, mv?.streak || 0);
        }
      }
    }
    const parts = cur.split('-').map((n) => parseInt(n, 10));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + 1);
      cur = localDateKey(d.getTime());
    } else {
      break;
    }
  }
  return res;
}

function loadNotifState() {
  const parsed = loadJson(NOTIF_STATE_KEY, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function saveNotifState(state) {
  saveJson(NOTIF_STATE_KEY, state || {});
}

function pruneNotifState(state) {
  const out = Object.assign({ dailyZero: {}, dailyCompare: {}, weeklyCompare: {} }, state || {});
  const limitDate = localDateKey(Date.now() - DAY_MS * 120);
  for (const [key, value] of Object.entries(out.dailyZero || {})) {
    if (key < limitDate) {
      delete out.dailyZero[key];
    } else if (value && typeof value === 'object') {
      for (const slot of Object.keys(value)) {
        if (!value[slot]) delete value[slot];
      }
    }
  }
  for (const key of Object.keys(out.dailyCompare || {})) {
    if (key < limitDate) delete out.dailyCompare[key];
  }
  const weekLimit = localDateKey(Date.now() - DAY_MS * 180);
  for (const key of Object.keys(out.weeklyCompare || {})) {
    if (key < weekLimit) delete out.weeklyCompare[key];
  }
  return out;
}

let NOTIF_STATE = pruneNotifState(loadNotifState());

function markDailyZeroNotified(dateKey, slot) {
  if (!dateKey || !slot) return;
  if (!NOTIF_STATE.dailyZero) NOTIF_STATE.dailyZero = {};
  const entry = NOTIF_STATE.dailyZero[dateKey] || {};
  entry[slot] = Date.now();
  NOTIF_STATE.dailyZero[dateKey] = entry;
  NOTIF_STATE = pruneNotifState(NOTIF_STATE);
  saveNotifState(NOTIF_STATE);
}

function hasDailyZeroNotified(dateKey, slot) {
  return !!(
    NOTIF_STATE.dailyZero &&
    NOTIF_STATE.dailyZero[dateKey] &&
    NOTIF_STATE.dailyZero[dateKey][slot]
  );
}

function markDailyCompareNotified(dateKey) {
  if (!dateKey) return;
  if (!NOTIF_STATE.dailyCompare) NOTIF_STATE.dailyCompare = {};
  NOTIF_STATE.dailyCompare[dateKey] = Date.now();
  NOTIF_STATE = pruneNotifState(NOTIF_STATE);
  saveNotifState(NOTIF_STATE);
}

function hasDailyCompareNotified(dateKey) {
  return !!(NOTIF_STATE.dailyCompare && NOTIF_STATE.dailyCompare[dateKey]);
}

function markWeeklyCompareNotified(weekKey) {
  if (!weekKey) return;
  if (!NOTIF_STATE.weeklyCompare) NOTIF_STATE.weeklyCompare = {};
  NOTIF_STATE.weeklyCompare[weekKey] = Date.now();
  NOTIF_STATE = pruneNotifState(NOTIF_STATE);
  saveNotifState(NOTIF_STATE);
}

function hasWeeklyCompareNotified(weekKey) {
  return !!(NOTIF_STATE.weeklyCompare && NOTIF_STATE.weeklyCompare[weekKey]);
}

function describeStudy(stats) {
  const passes = stats?.passes || 0;
  const level5New = stats?.level5 || 0;
  const level5Perfect = stats?.level5_count || 0;
  const noHint = stats?.no_hint || 0;
  const streak = stats?.streak || 0;
  const parts = [`合格${passes}`];
  if (noHint > 0) parts.push(`ノーヒント${noHint}`);
  if (level5Perfect > 0) parts.push(`Lv5完璧${level5Perfect}`);
  if (level5New > 0) parts.push(`Lv5新${level5New}`);
  if (streak > 0) parts.push(`連続${streak}`);
  return parts.join(' / ');
}

function startOfWeek(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - diff);
  return d;
}

async function showStudyNotification(title, options) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = Object.assign({ icon: './icons/icon-192.png', badge: './icons/icon-192.png' }, options || {});
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, opts);
        return true;
      }
    }
  } catch (err) {
    console.warn('showNotification via SW failed', err);
  }
  try {
    new Notification(title, opts);
    return true;
  } catch (err) {
    console.warn('Notification constructor failed', err);
    return false;
  }
}

const DAILY_ZERO_SLOTS = [
  { label: '12:00', hour: 12, minute: 0 },
  { label: '18:00', hour: 18, minute: 0 },
  { label: '21:00', hour: 21, minute: 0 }
];

async function checkDailyZeroReminders(now, stats) {
  const todayKey = localDateKey(now.getTime());
  const total = (stats?.passes || 0) + (stats?.level5 || 0);
  if (total > 0) return;
  for (const slot of DAILY_ZERO_SLOTS) {
    const scheduled = new Date(now.getTime());
    scheduled.setHours(slot.hour, slot.minute, 0, 0);
    if (now >= scheduled && !hasDailyZeroNotified(todayKey, slot.label)) {
      const body = '今日の合格はまだ0件。サクッと1フレーズだけでも発声しておこう！';
      await showStudyNotification('今日の学習がまだ始まっていません', {
        body,
        tag: `daily-zero-${todayKey}-${slot.label}`
      });
      markDailyZeroNotified(todayKey, slot.label);
      break;
    }
  }
}

async function checkDailyComparison(now, todayStats) {
  if (now.getHours() < 18) return;
  const todayKey = localDateKey(now.getTime());
  if (hasDailyCompareNotified(todayKey)) return;
  const yesterdayKey = localDateKey(now.getTime() - DAY_MS);
  const yesterdayStats = getDailyStats(yesterdayKey);
  const todayTotal = (todayStats.passes || 0) + (todayStats.level5 || 0);
  const yTotal = (yesterdayStats.passes || 0) + (yesterdayStats.level5 || 0);
  if (todayTotal === 0 && yTotal === 0) return;
  let title = '今日の進捗';
  let body = '';
  if (todayTotal < yTotal) {
    const diff = yTotal - todayTotal;
    title = '昨日に追いつくチャンス！';
    body = `昨日は${describeStudy(yesterdayStats)}でしたが、今日はまだ${describeStudy(todayStats)}。あと${diff}件巻き返そう！`;
  } else if (todayTotal > yTotal) {
    const diff = todayTotal - yTotal;
    title = '昨日を超えるハイペース！';
    body = `昨日は${describeStudy(yesterdayStats)}。今日は${describeStudy(todayStats)}で${diff}件リード中。このまま締め切ろう！`;
  } else {
    title = '昨日と互角のペース';
    body = `昨日は${describeStudy(yesterdayStats)}。今日は今のところ同じだけ進んでいます。ラスト1件で差をつけよう！`;
  }
  await showStudyNotification(title, {
    body,
    tag: `daily-compare-${todayKey}`
  });
  markDailyCompareNotified(todayKey);
}

async function checkWeeklyComparison(now) {
  if (now.getDay() !== 1 || now.getHours() < 9) return;
  const thisWeek = startOfWeek(now);
  const weekKey = localDateKey(thisWeek.getTime());
  if (hasWeeklyCompareNotified(weekKey)) return;
  const lastWeekStart = new Date(thisWeek.getTime() - DAY_MS * 7);
  const lastWeekEnd = new Date(lastWeekStart.getTime() + DAY_MS * 6);
  const prevWeekStart = new Date(lastWeekStart.getTime() - DAY_MS * 7);
  const prevWeekEnd = new Date(prevWeekStart.getTime() + DAY_MS * 6);
  const lastStats = sumRange(localDateKey(lastWeekStart.getTime()), localDateKey(lastWeekEnd.getTime()));
  const prevStats = sumRange(localDateKey(prevWeekStart.getTime()), localDateKey(prevWeekEnd.getTime()));
  const lastTotal = (lastStats.passes || 0) + (lastStats.level5 || 0);
  const prevTotal = (prevStats.passes || 0) + (prevStats.level5 || 0);
  if (lastTotal === 0 && prevTotal === 0) return;
  let title = '先週の振り返り';
  let body = '';
  if (lastTotal < prevTotal) {
    const diff = prevTotal - lastTotal;
    title = '先週は失速気味…';
    body = `先週は${describeStudy(lastStats)}で、前の週は${describeStudy(prevStats)}。今週は${diff}件取り返して流れを戻そう！`;
  } else if (lastTotal > prevTotal) {
    const diff = lastTotal - prevTotal;
    title = '先週はしっかり積み上げ！';
    body = `先週は${describeStudy(lastStats)}で前の週を${diff}件上回りました。この勢いで今週も更新しよう！`;
  } else {
    title = '先週は横ばいペース';
    body = `先週は${describeStudy(lastStats)}で、前の週と同じ結果でした。今週はもう一歩攻めてみませんか？`;
  }
  await showStudyNotification(title, {
    body,
    tag: `weekly-compare-${weekKey}`
  });
  markWeeklyCompareNotified(weekKey);
}

let notifInterval = null;
let scheduleTimeoutId = null;

function stopNotificationLoop() {
  if (notifInterval) {
    clearInterval(notifInterval);
    notifInterval = null;
  }
}

async function runNotificationChecks({ force = false } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    stopNotificationLoop();
    return;
  }
  const now = new Date();
  const todayKey = localDateKey(now.getTime());
  const todayStats = getDailyStats(todayKey);
  await checkDailyZeroReminders(now, todayStats);
  await checkDailyComparison(now, todayStats);
  await checkWeeklyComparison(now);
  if (force) {
    scheduleTimeoutId = null;
  }
}

function ensureNotificationLoop() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (notifInterval) return;
  notifInterval = setInterval(() => {
    runNotificationChecks().catch(() => {});
  }, 10 * 60 * 1000);
  runNotificationChecks({ force: true }).catch(() => {});
}

function scheduleNotificationCheckSoon() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  ensureNotificationLoop();
  if (scheduleTimeoutId) {
    clearTimeout(scheduleTimeoutId);
  }
  scheduleTimeoutId = setTimeout(() => {
    runNotificationChecks({ force: true }).catch(() => {});
  }, 1000);
}

function updateNotificationUi({ statusEl, buttonEl } = {}) {
  if (!statusEl || !buttonEl) return;
  if (!('Notification' in window)) {
    statusEl.textContent = '通知非対応のブラウザです';
    buttonEl.textContent = '通知を許可できません';
    buttonEl.disabled = true;
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    statusEl.textContent = '通知は許可されています';
    buttonEl.textContent = '通知は許可済み';
    buttonEl.disabled = true;
  } else if (perm === 'denied') {
    statusEl.textContent = 'ブラウザ設定で通知を許可してください';
    buttonEl.textContent = '通知を許可できません';
    buttonEl.disabled = true;
  } else {
    statusEl.textContent = '未許可：タップで有効化';
    buttonEl.textContent = '学習リマインド通知を有効化';
    buttonEl.disabled = false;
  }
}

function initNotificationSystem({ statusEl, buttonEl, toast } = {}) {
  const notify = typeof toast === 'function' ? toast : () => {};
  updateNotificationUi({ statusEl, buttonEl });
  if ('Notification' in window && Notification.permission === 'granted') {
    ensureNotificationLoop();
  }
  const handleClick = async () => {
    if (!('Notification' in window)) {
      notify('このブラウザは通知に対応していません');
      return;
    }
    if (Notification.permission === 'granted') {
      notify('通知はすでに有効です');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      updateNotificationUi({ statusEl, buttonEl });
      if (result === 'granted') {
        notify('通知を有効にしました');
        ensureNotificationLoop();
        runNotificationChecks({ force: true }).catch(() => {});
      } else {
        notify('通知は許可されませんでした');
      }
    } catch (err) {
      console.warn('Notification permission request failed', err);
      notify('通知の許可リクエストに失敗しました');
    }
  };
  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      updateNotificationUi({ statusEl, buttonEl });
      runNotificationChecks({ force: true }).catch(() => {});
    }
  };
  return { handleClick, handleVisibilityChange };
}

export {
  STUDY_LOG_KEY,
  NOTIF_STATE_KEY,
  DAY_MS,
  localDateKey,
  loadStudyLog,
  saveStudyLog,
  pruneStudyLog,
  recordStudyProgress,
  getDailyStats,
  sumRange,
  runNotificationChecks,
  ensureNotificationLoop,
  scheduleNotificationCheckSoon,
  updateNotificationUi,
  initNotificationSystem
};
