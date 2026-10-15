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

export async function backgroundChromiumTab(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const foregroundTab = await page.context().newPage();
  let minimizedWindow = null;
  let method = 'foreground-tab';
  try {
    await foregroundTab.bringToFront();
    try {
      await page.waitForFunction(
        () => document.visibilityState === 'hidden',
        null,
        { timeout: Math.min(timeout, 1_500), polling: 100 },
      );
    } catch (tabSwitchError) {
      // Chromium can place context-created pages in separate windows in Xvfb.
      // Minimize the app's actual browser window through CDP and still require
      // Chromium to report hidden; this does not mutate document state or fire
      // a synthetic visibilitychange event.
      minimizedWindow = await minimizeTargetWindow(page);
      method = 'cdp-window-minimize';
      await page.waitForFunction(
        () => document.visibilityState === 'hidden',
        null,
        { timeout, polling: 100 },
      );
    }

    const evidence = await page.evaluate(() => ({
      state: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    assert.equal(evidence.state, 'hidden');
    assert.equal(evidence.hidden, true);

    return {
      evidence: { ...evidence, method, windowId: minimizedWindow?.windowId ?? null },
      restore: async () => {
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
    if (minimizedWindow) {
      await minimizedWindow.restore().catch(() => {});
      await minimizedWindow.cleanup();
    }
    await page.bringToFront().catch(() => {});
    await foregroundTab.close().catch(() => {});
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium tab activation and real window minimization did not produce verified hidden state (${detail})`, { cause: error });
  }
}
