const CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a[href]',
  '[role="button"]',
  '[role="slider"]',
  '[contenteditable="true"]',
].join(',');

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

export function isCardControlTarget(target, card = null) {
  let element = target || null;
  if (element && element.nodeType !== 1) element = element.parentElement || null;
  while (element && element !== card) {
    const tag = String(element.tagName || '').toUpperCase();
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return true;
    if (tag === 'A' && element.getAttribute?.('href')) return true;
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    if (role === 'button' || role === 'slider') return true;
    if (String(element.getAttribute?.('contenteditable') || '').toLowerCase() === 'true') return true;
    element = element.parentElement || null;
  }
  return false;
}

export function shouldBlockSyntheticCardGesture(event) {
  return !!event && event.isTrusted === false && TOUCH_EVENTS.includes(event.type);
}

function stopCardSwipe(event) {
  event.stopPropagation();
}

function blockSyntheticCardSwipe(event) {
  if (!shouldBlockSyntheticCardGesture(event)) return;
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}

function bindControl(control) {
  if (!control || control.dataset?.cardGestureGuard === '1') return;
  if (control.dataset) control.dataset.cardGestureGuard = '1';
  for (const type of TOUCH_EVENTS) {
    control.addEventListener(type, stopCardSwipe, { passive: true });
  }
}

function bindControls(card) {
  if (!card?.querySelectorAll) return;
  card.querySelectorAll(CONTROL_SELECTOR).forEach(bindControl);
}

function init() {
  const card = document.getElementById('card');
  if (!card) return;

  // Legacy tag/adaptive code used synthetic touch events to reveal hints.
  // Synthetic touch gestures are never a user request, so stop them before
  // the card's swipe handler sees them. Real finger swipes remain untouched.
  for (const type of TOUCH_EVENTS) {
    card.addEventListener(type, blockSyntheticCardSwipe, { capture: true, passive: false });
  }

  bindControls(card);
  const observer = new MutationObserver(() => bindControls(card));
  observer.observe(card, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
