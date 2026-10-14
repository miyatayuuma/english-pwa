const ACTIONS = Object.freeze([
  Object.freeze({ id: 'contacts', buttonId: 'openCharacterContacts', label: '連絡先', className: 'friendship-nav__choose' }),
  Object.freeze({ id: 'learning', buttonId: 'openLearningChoice', label: '遊び方を選ぶ', className: 'home-navigation__learning' }),
]);

const actions = new Map();
const capabilities = new Map();
const buttons = new Map();

function dispatch(name, detail) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('homeNavigationStyles')) return;
  const style = document.createElement('style');
  style.id = 'homeNavigationStyles';
  style.textContent = `
    #focusHomeNav.home-navigation-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px}
    #focusHomeNav.home-navigation-nav>button{box-sizing:border-box;min-width:0;min-height:45px;padding:11px 8px;white-space:normal;overflow-wrap:anywhere;text-align:center;line-height:1.3;font-size:clamp(12px,3.45vw,14px)}
    #focusHomeNav.home-navigation-nav>button:disabled{opacity:.56;cursor:wait}
    @media(max-width:370px){#focusHomeNav.home-navigation-nav>button{min-height:42px;padding-inline:6px}}
  `;
  document.head.appendChild(style);
}

function getNav() {
  return typeof document === 'undefined' ? null : document.getElementById('focusHomeNav');
}

function isActionReady(action) {
  return !!action && action.ready !== false && typeof action.onActivate === 'function';
}

export function getHomeNavigationAction(id) {
  return actions.get(String(id || '')) || null;
}

export function getHomeNavigationCapability(name) {
  return capabilities.get(String(name || '')) || null;
}

export function setHomeNavigationCapability(name, value = {}) {
  const key = String(name || '').trim();
  if (!key) return false;
  const next = { ...value };
  const previous = capabilities.get(key);
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next)]);
  if (previous && [...keys].every(field => Object.is(previous[field], next[field]))) return false;
  capabilities.set(key, next);
  dispatch('english-pwa:home-navigation-capability-changed', { name: key, capability: next });
  return true;
}

export function activateHomeNavigationAction(id) {
  const key = String(id || '');
  const action = actions.get(key);
  if (!isActionReady(action)) return false;
  dispatch('english-pwa:home-navigation-action-activated', { id: key });
  try {
    return action.onActivate() !== false;
  } catch (error) {
    dispatch('english-pwa:home-navigation-action-failed', { id: key, error });
    console.error(`Home navigation action failed: ${key}`, error);
    return false;
  }
}

export function renderHomeNavigation() {
  const nav = getNav();
  if (!nav) return false;
  injectStyles();
  nav.classList.remove('friendship-nav', 'learning-nav', 'has-vocab-mode');
  nav.classList.add('home-navigation-nav');

  const rendered = ACTIONS.map(definition => {
    let button = buttons.get(definition.buttonId);
    if (!button) {
      button = document.createElement('button');
      button.id = definition.buttonId;
      button.type = 'button';
      button.dataset.homeNavigationAction = definition.id;
      button.addEventListener('click', () => activateHomeNavigationAction(definition.id));
      buttons.set(definition.buttonId, button);
    }
    const action = actions.get(definition.id);
    const ready = isActionReady(action);
    button.className = `home-navigation__action ${definition.className}`.trim();
    button.textContent = definition.label;
    button.disabled = !ready;
    button.setAttribute('aria-busy', String(!ready));
    return button;
  });

  const current = [...nav.children];
  if (current.length !== rendered.length || rendered.some((button, index) => current[index] !== button)) {
    nav.replaceChildren(...rendered);
  }
  const ready = ACTIONS.every(definition => isActionReady(actions.get(definition.id)));
  nav.dataset.homeNavigationReady = String(ready);
  nav.setAttribute('aria-busy', String(!ready));
  dispatch('english-pwa:home-navigation-rendered', { ready, actionIds: ACTIONS.map(action => action.id) });
  return true;
}

export function registerHomeNavigationAction(id, action = {}) {
  const key = String(id || '').trim();
  if (!key) return false;
  const next = {
    label: String(action.label || ''),
    ready: action.ready !== false,
    onActivate: typeof action.onActivate === 'function' ? action.onActivate : null,
  };
  const previous = actions.get(key);
  if (previous && previous.label === next.label && previous.ready === next.ready && previous.onActivate === next.onActivate) return false;
  actions.set(key, next);
  dispatch('english-pwa:home-navigation-action-registered', { id: key, ready: isActionReady(next) });
  renderHomeNavigation();
  return true;
}

export function initializeHomeNavigation() {
  injectStyles();
  return renderHomeNavigation();
}
