import assert from 'node:assert/strict';

async function minimizeTargetWindow(page) {
  const pageSession = await page.context().newCDPSession(page);
  const browserSession = await page.context().browser().newBrowserCDPSession();
  try {
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    const { windowId } = await browserSession.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    await browserSession.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' },
    });
    return {
      windowId,
      restore: async () => {
        await browserSession.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
        await page.bringToFront();
        await page.waitForFunction(
          () => document.visibilityState === 'visible',
          null,
          { timeout: 10_000, polling: 100 },
        );
        await pageSession.detach();
        await browserSession.detach();
      },
      cleanup: async () => {
        await pageSession.detach().catch(() => {});
        await browserSession.detach().catch(() => {});
      },
    };
  } catch (error) {
    await pageSession.detach().catch(() => {});
    await browserSession.detach().catch(() => {});
    throw error;
  }
}

async function lifecycleFreezeHidden(page) {
  const session = await page.context().newCDPSession(page);
  let frozenSnapshot = null;
  let evaluationTimedOut = false;
  try {
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    const inspect = session.send('Runtime.evaluate', {
      expression: '({ state: document.visibilityState, hidden: document.hidden })',
      returnByValue: true,
    });
    const inspection = await Promise.race([
      inspect.then(value => ({ value })),
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 1_500)),
    ]);
    evaluationTimedOut = inspection.timeout === true;
    frozenSnapshot = inspection.value?.result?.value || null;

    // Resume script execution and let Chromium deliver the lifecycle event.
    // The observer name differs between the Read fixture and Vocabulary fixture.
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await page.waitForFunction(() => {
      const traces = [
        window.__issue210?.visibilityEvents,
        window.__vocabularyHiddenAudit?.visibilityEvents,
      ].filter(Array.isArray);
      return traces.some(events => events.some(event => event.state === 'hidden'));
    }, null, { timeout: 3_000, polling: 50 });

    const after = await page.evaluate(() => {
      const issueEvents = window.__issue210?.visibilityEvents?.map(event => ({ ...event })) || null;
      const vocabularyEvents = window.__vocabularyHiddenAudit?.visibilityEvents?.map(event => ({ ...event })) || null;
      const hiddenEvent = [...(issueEvents || []), ...(vocabularyEvents || [])]
        .reverse().find(event => event.state === 'hidden');
      return {
        state: hiddenEvent?.state || document.visibilityState,
        hidden: hiddenEvent?.state === 'hidden',
        currentState: document.visibilityState,
        currentHidden: document.hidden,
        issueEvents,
        vocabularyEvents,
        hiddenEvent,
      };
    });
    assert.equal(after.state, 'hidden', 'Chromium dispatched visibilitychange with hidden state');
    assert.equal(after.hidden, true);
    return { session, evidence: after };
  } catch (error) {
    await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    const detail = await page.evaluate(() => ({
      state: document.visibilityState,
      hidden: document.hidden,
      issueEvents: window.__issue210?.visibilityEvents || null,
      vocabularyEvents: window.__vocabularyHiddenAudit?.visibilityEvents || null,
    })).catch(() => null);
    await session.detach().catch(() => {});
    throw new Error(`CDP page lifecycle inspection failed: ${JSON.stringify({ frozenSnapshot, evaluationTimedOut, detail, error: error.message })}`, { cause: error });
  }
}

export async function backgroundChromiumTab(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const foregroundTab = await page.context().newPage();
  let minimizedWindow = null;
  let lifecycleSession = null;
  let method = 'foreground-tab';
  let evidence = null;
  try {
    await foregroundTab.bringToFront();
    try {
      await page.waitForFunction(
        () => document.visibilityState === 'hidden',
        null,
        { timeout: Math.min(timeout, 1_000), polling: 100 },
      );
      evidence = await page.evaluate(() => ({
        state: document.visibilityState,
        hidden: document.hidden,
        currentState: document.visibilityState,
        currentHidden: document.hidden,
        hasFocus: document.hasFocus(),
      }));
    } catch (_) {
      // Context-created pages can occupy separate windows in Xvfb.
      minimizedWindow = await minimizeTargetWindow(page);
      method = 'cdp-window-minimize';
      try {
        await page.waitForFunction(
          () => document.visibilityState === 'hidden',
          null,
          { timeout: Math.min(timeout, 1_000), polling: 100 },
        );
        evidence = await page.evaluate(() => ({
          state: document.visibilityState,
          hidden: document.hidden,
          currentState: document.visibilityState,
          currentHidden: document.hidden,
          hasFocus: document.hasFocus(),
        }));
      } catch (_) {
        // Chromium's Page lifecycle control invokes its browser-engine hidden
        // transition and dispatches visibilitychange. It does not mutate DOM
        // state or dispatch a synthetic event.
        const lifecycle = await lifecycleFreezeHidden(page);
        lifecycleSession = lifecycle.session;
        evidence = lifecycle.evidence;
        method = 'cdp-page-lifecycle-hidden';
      }
    }

    assert.equal(evidence.state, 'hidden');
    assert.equal(evidence.hidden, true);

    return {
      evidence: { ...evidence, method, windowId: minimizedWindow?.windowId ?? null },
      restore: async () => {
        if (lifecycleSession) {
          await lifecycleSession.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
          await lifecycleSession.detach().catch(() => {});
          lifecycleSession = null;
        }
        if (minimizedWindow) {
          await minimizedWindow.restore();
        } else {
          await page.bringToFront();
          await page.waitForFunction(
            () => document.visibilityState === 'visible',
            null,
            { timeout, polling: 100 },
          );
        }
        await foregroundTab.close();
      },
    };
  } catch (error) {
    if (lifecycleSession) {
      await lifecycleSession.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
      await lifecycleSession.detach().catch(() => {});
    }
    if (minimizedWindow) {
      await minimizedWindow.restore().catch(() => {});
      await minimizedWindow.cleanup();
    }
    await page.bringToFront().catch(() => {});
    await foregroundTab.close().catch(() => {});
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium did not produce a verified hidden lifecycle transition (${detail})`, { cause: error });
  }
}
