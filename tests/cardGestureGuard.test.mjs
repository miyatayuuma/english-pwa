import test from 'node:test';
import assert from 'node:assert/strict';
import { isCardControlTarget, shouldBlockSyntheticCardGesture } from '../scripts/app/cardGestureGuard.js';

function node(tagName, { parent = null, attrs = {} } = {}) {
  return {
    nodeType: 1,
    tagName,
    parentElement: parent,
    getAttribute(name) { return attrs[name] ?? null; },
  };
}

test('card controls are excluded from swipe gestures', () => {
  const card = node('SECTION');
  const button = node('BUTTON', { parent: card });
  const icon = node('SPAN', { parent: button });
  const slider = node('DIV', { parent: card, attrs: { role: 'slider' } });
  assert.equal(isCardControlTarget(button, card), true);
  assert.equal(isCardControlTarget(icon, card), true);
  assert.equal(isCardControlTarget(slider, card), true);
});

test('plain card content remains swipeable', () => {
  const card = node('SECTION');
  const text = node('SPAN', { parent: node('DIV', { parent: card }) });
  assert.equal(isCardControlTarget(text, card), false);
});

test('synthetic touch gestures are blocked but real swipes are not', () => {
  assert.equal(shouldBlockSyntheticCardGesture({ type: 'touchstart', isTrusted: false }), true);
  assert.equal(shouldBlockSyntheticCardGesture({ type: 'touchend', isTrusted: false }), true);
  assert.equal(shouldBlockSyntheticCardGesture({ type: 'touchstart', isTrusted: true }), false);
  assert.equal(shouldBlockSyntheticCardGesture({ type: 'click', isTrusted: false }), false);
});

test('gesture guard module imports safely outside browser', async () => {
  const mod = await import('../scripts/app/cardGestureGuard.js');
  assert.equal(typeof mod.isCardControlTarget, 'function');
  assert.equal(typeof mod.shouldBlockSyntheticCardGesture, 'function');
});
