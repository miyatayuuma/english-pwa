export function createOverlayController({ overlayElement } = {}) {
  const locks = new Set();

  const getOverlay = () => overlayElement || null;

  const update = () => {
    const el = getOverlay();
    if (!el) return;
    const active = locks.size > 0;
    el.classList.toggle('hidden', !active);
    el.classList.toggle('active', active);
  };

  const release = (token) => {
    const el = getOverlay();
    if (!el || token == null) return;
    if (locks.delete(token)) {
      update();
    }
  };

  const acquire = (tag = 'load') => {
    const el = getOverlay();
    if (!el) {
      return () => {};
    }
    const token = `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    locks.add(token);
    update();
    return () => release(token);
  };

  return {
    acquire,
    release,
    update
  };
}
