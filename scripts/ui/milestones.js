export const TOAST_SELECTOR = '#toast';
export const MILESTONE_LAYER_ID = 'milestoneEffects';

export const TOAST_DEFAULT_DURATION = 1500;
export const MILESTONE_EFFECT_DURATION = 2800;
export const MILESTONE_EFFECT_LIMIT = 3;

const MILESTONE_INTENSITY = Object.freeze({
  subtle: 'subtle',
  normal: 'normal',
  strong: 'strong'
});

let milestoneIntensity = MILESTONE_INTENSITY.normal;

let toastTimer = null;

function query(selector, root = document) {
  return root?.querySelector?.(selector) || null;
}

export function toast(message, duration = TOAST_DEFAULT_DURATION) {
  const toastEl = query(TOAST_SELECTOR);
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, duration);
}

export function ensureMilestoneLayer() {
  let layer = document.getElementById(MILESTONE_LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = MILESTONE_LAYER_ID;
    layer.setAttribute('aria-live', 'polite');
    layer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

function formatLevelLabel(level) {
  return `Lv${level}`;
}

function pickMessageTemplate(type, { hasPriorProgress = true, bestUpdated = false, streakUpdated = false } = {}) {
  const templates = {
    best: [
      { title: '自己ベスト更新！', sub: '前回の記録を超えました' },
      { title: '最高レベル更新！', sub: 'この調子で次の壁も突破！' }
    ],
    level4_first: [
      { title: 'Lv4 初達成！', sub: '初めての高精度クリアです' },
      { title: 'はじめてのLv4！', sub: 'ノーヒント練習が効いています' }
    ],
    level4_repeat: [
      { title: 'Lv4 達成！', sub: '安定して高精度をキープ' },
      { title: 'Lv4 クリア！', sub: '難所をしっかり突破' }
    ],
    level5_first: [
      { title: 'Lv5 初達成！', sub: '完璧クリアの第一歩！' },
      { title: '初のLv5！', sub: '100%一致、お見事です' }
    ],
    level5_repeat: [
      { title: 'Lv5 完璧！', sub: '精度と再現性がさらに向上' },
      { title: 'Lv5 連続達成！', sub: '高水準の仕上がりです' }
    ],
    streak_record: [
      { title: '連続記録更新！', sub: '自己ベストの連続数を更新' },
      { title: '新ストリーク達成！', sub: '集中力がしっかり続いています' }
    ]
  };
  let key = type;
  if (type === 'level4') key = hasPriorProgress ? 'level4_repeat' : 'level4_first';
  if (type === 'level5') key = hasPriorProgress ? 'level5_repeat' : 'level5_first';
  if (type === 'best' && bestUpdated) key = 'best';
  if (streakUpdated) key = 'streak_record';
  const pool = templates[key] || [{ title: 'Great!', sub: '' }];
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] || pool[0];
}

export function setMilestoneEffectIntensity(level = MILESTONE_INTENSITY.normal) {
  if (!Object.values(MILESTONE_INTENSITY).includes(level)) {
    milestoneIntensity = MILESTONE_INTENSITY.normal;
    return milestoneIntensity;
  }
  milestoneIntensity = level;
  return milestoneIntensity;
}

export function triggerMilestoneEffect(type, { level, previous, matchRate, hasPriorProgress = true, bestUpdated = false, streakUpdated = false } = {}) {
  const layer = ensureMilestoneLayer();
  if (!layer) return;

  const effect = document.createElement('div');
  effect.className = ['milestone-effect', type || '', `intensity-${milestoneIntensity}`].filter(Boolean).join(' ');

  const template = pickMessageTemplate(type, { hasPriorProgress, bestUpdated, streakUpdated });
  let title = template.title || 'Great!';
  let sub = template.sub || '';
  const hasLevel = Number.isFinite(level);
  const hasPrev = Number.isFinite(previous);
  const hasMatch = Number.isFinite(matchRate);

  switch (type) {
    case 'best': {
      if (!title) title = '最高レベル更新！';
      if (hasPrev && hasLevel) {
        sub = `${formatLevelLabel(previous)} → ${formatLevelLabel(level)}`;
      } else if (hasLevel) {
        sub = formatLevelLabel(level);
      }
      break;
    }
    case 'level4': {
      if (!title) title = 'Lv4 達成！';
      if (hasMatch) {
        sub = `一致率${Math.round(matchRate * 100)}%`;
      } else {
        sub = 'ノーヒントで高精度！';
      }
      break;
    }
    case 'level5': {
      if (!title) title = 'Lv5 完璧！';
      if (hasMatch) {
        sub = `一致率${Math.round(matchRate * 100)}%`;
      } else {
        sub = '100%達成、お見事！';
      }
      break;
    }
    default: {
      if (hasLevel) {
        sub = formatLevelLabel(level);
      }
    }
  }

  if (!sub && hasLevel) {
    sub = formatLevelLabel(level);
  }

  effect.innerHTML = `<div class="effect-title">${title}</div>${sub ? `<div class="effect-sub">${sub}</div>` : ''}`;
  layer.appendChild(effect);
  requestAnimationFrame(() => effect.classList.add('show'));
  const duration = milestoneIntensity === MILESTONE_INTENSITY.subtle
    ? Math.max(1600, MILESTONE_EFFECT_DURATION - 800)
    : milestoneIntensity === MILESTONE_INTENSITY.strong
    ? MILESTONE_EFFECT_DURATION + 400
    : MILESTONE_EFFECT_DURATION;
  setTimeout(() => effect.classList.add('hide'), Math.max(700, duration - 400));
  setTimeout(() => {
    if (effect.parentNode === layer) {
      layer.removeChild(effect);
    }
  }, duration);

  while (layer.children.length > MILESTONE_EFFECT_LIMIT) {
    layer.removeChild(layer.firstElementChild);
  }
}
