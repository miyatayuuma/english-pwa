const DEFAULT_FALLBACK_MS = 420;

export function createCardTransitionQueue({ cardElement, fallbackMs = DEFAULT_FALLBACK_MS } = {}) {
  let transitionQueue = Promise.resolve();

  const getCard = () => cardElement || null;

  const animateCardChange = (direction, task) => {
    const card = getCard();
    if (!card) {
      return task();
    }
    const isNext = direction === 'next';
    const outClass = isNext ? 'slide-left' : 'slide-right';
    const inClass = isNext ? 'slide-in-from-right' : 'slide-in-from-left';
    const prefersReduced = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      return task();
    }
    let slideInStarted = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let outFallbackTimer = 0;
      let inFallbackTimer = 0;

      const cleanup = () => {
        card.classList.remove('card-sliding', 'card-no-transition', outClass, inClass);
        card.removeEventListener('transitionend', handleOutEnd);
        card.removeEventListener('transitionend', handleInEnd);
        if (outFallbackTimer) {
          clearTimeout(outFallbackTimer);
          outFallbackTimer = 0;
        }
        if (inFallbackTimer) {
          clearTimeout(inFallbackTimer);
          inFallbackTimer = 0;
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const handleInEnd = (ev) => {
        if (ev.target !== card) return;
        if (ev.propertyName && ev.propertyName.indexOf('transform') === -1) return;
        finish();
      };

      const startSlideIn = async () => {
        if (slideInStarted) return;
        slideInStarted = true;
        card.removeEventListener('transitionend', handleOutEnd);
        if (outFallbackTimer) {
          clearTimeout(outFallbackTimer);
          outFallbackTimer = 0;
        }
        try {
          card.classList.add('card-no-transition');
          card.classList.remove(outClass);
          card.classList.add(inClass);
          void card.offsetWidth; // force reflow
          card.classList.remove('card-no-transition');
          await task();
        } catch (err) {
          fail(err);
          return;
        }
        card.addEventListener('transitionend', handleInEnd);
        requestAnimationFrame(() => {
          card.classList.remove(inClass);
        });
        inFallbackTimer = setTimeout(finish, fallbackMs);
      };

      const handleOutEnd = (ev) => {
        if (ev.target !== card) return;
        if (ev.propertyName && ev.propertyName.indexOf('transform') === -1) return;
        startSlideIn();
      };

      card.classList.add('card-sliding');
      card.classList.remove('slide-left', 'slide-right', 'slide-in-from-left', 'slide-in-from-right', 'card-no-transition');
      card.addEventListener('transitionend', handleOutEnd);
      requestAnimationFrame(() => {
        card.classList.add(outClass);
      });
      outFallbackTimer = setTimeout(startSlideIn, fallbackMs);
    });
  };

  const queueTransition = (direction, task, { animate = true } = {}) => {
    if (typeof task !== 'function') {
      return transitionQueue;
    }
    transitionQueue = transitionQueue
      .catch((err) => {
        console.error('card transition queue reset', err);
      })
      .then(() => {
        if (!animate) {
          return task();
        }
        return animateCardChange(direction, task);
      });
    return transitionQueue;
  };

  return {
    queueTransition
  };
}
