export const TOAST_SELECTOR = '#toast';
export const MILESTONE_LAYER_ID = 'milestoneEffects';

export const TOAST_DEFAULT_DURATION = 1500;
export const MILESTONE_EFFECT_DURATION = 2800;
export const MILESTONE_EFFECT_LIMIT = 3;

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

export function triggerMilestoneEffect(type, { level, previous, matchRate } = {}) {
  const layer = ensureMilestoneLayer();
  if (!layer) return;

  const effect = document.createElement('div');
  effect.className = ['milestone-effect', type || ''].filter(Boolean).join(' ');

  let title = 'Great!';
  let sub = '';
  const hasLevel = Number.isFinite(level);
  const hasPrev = Number.isFinite(previous);
  const hasMatch = Number.isFinite(matchRate);

  switch (type) {
    case 'best': {
      title = '最高レベル更新！';
      if (hasPrev && hasLevel) {
        sub = `${formatLevelLabel(previous)} → ${formatLevelLabel(level)}`;
      } else if (hasLevel) {
        sub = formatLevelLabel(level);
      }
      break;
    }
    case 'level4': {
      title = 'Lv4 達成！';
      if (hasMatch) {
        sub = `一致率${Math.round(matchRate * 100)}%`;
      } else {
        sub = 'ノーヒントで高精度！';
      }
      break;
    }
    case 'level5': {
      title = 'Lv5 完璧！';
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
  setTimeout(() => effect.classList.add('hide'), MILESTONE_EFFECT_DURATION - 400);
  setTimeout(() => {
    if (effect.parentNode === layer) {
      layer.removeChild(effect);
    }
  }, MILESTONE_EFFECT_DURATION);

  while (layer.children.length > MILESTONE_EFFECT_LIMIT) {
    layer.removeChild(layer.firstElementChild);
  }
}
