import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function x11(command, args) {
  execFileSync(command, args, { stdio: 'ignore' });
}

function xid(windowId) {
  return `0x${Number(windowId).toString(16)}`;
}

async function getWindowId(page) {
  const pageSession = await page.context().newCDPSession(page);
  const browserSession = await page.context().browser().newBrowserCDPSession();
  try {
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    const { windowId } = await browserSession.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    return { windowId, browserSession };
  } catch (error) {
    await browserSession.detach().catch(() => {});
    throw error;
  } finally {
    await pageSession.detach().catch(() => {});
  }
}

async function waitForHidden(page, timeout) {
  await page.waitForFunction(
    () => document.visibilityState === 'hidden',
    null,
    { timeout, polling: 50 },
  );
  const evidence = await page.evaluate(() => ({
    state: document.visibilityState,
    hidden: document.hidden,
    hasFocus: document.hasFocus(),
    visibilityEvents: window.__issue210?.visibilityEvents?.map(event => ({ ...event }))
      || window.__vocabularyHiddenAudit?.visibilityEvents?.map(event => ({ ...event }))
      || [],
  }));
  assert.equal(evidence.state, 'hidden');
  assert.equal(evidence.hidden, true);
  assert.ok(evidence.visibilityEvents.some(event => event.state === 'hidden'),
    'Chromium fired a visibilitychange event with hidden state');
  return evidence;
}

export async function backgroundChromiumTab(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const context = page.context();
  const targetUrl = new URL('/__issue210-background-tab__', page.url()).href;
  const routeHandler = route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Background tab</title>',
  });
  await context.route(targetUrl, routeHandler);

  let foregroundTab = null;
  let minimized = false;
  let windowId = null;
  let browserSession = null;
  let method = '';
  try {
    // Open an actual same-window tab through Chromium's window.open path. The
    // fixture route is intentionally blank and the fixture init scripts skip it.
    const pageEvent = context.waitForEvent('page', { timeout: 2_000 }).catch(() => null);
    const opener = await context.newCDPSession(page);
    try {
      await opener.send('Runtime.evaluate', {
        expression: `window.open(${JSON.stringify(targetUrl)}, '_blank')`,
        userGesture: true,
      });
    } finally {
      await opener.detach();
    }
    foregroundTab = await pageEvent;

    if (foregroundTab) {
      method = 'window-open-tab';
      await foregroundTab.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
      const target = await getWindowId(page);
      windowId = target.windowId;
      browserSession = target.browserSession;

      // window.open normally selects the new tab immediately; capture that
      // natural hidden transition before using any additional UI controls.
      try {
        const evidence = await waitForHidden(page, 1_500);
        return {
          evidence: { ...evidence, method, windowId },
          restore: async () => {
            await page.bringToFront();
            await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
            await foregroundTab.close();
            await context.unroute(targetUrl, routeHandler);
            await browserSession.detach().catch(() => {});
          },
        };
      } catch (_) {
        // If the popup is a separate window, try the real tab-strip shortcut.
      }

      // Use the window manager's real keyboard path to select the next browser
      // tab, then verify the app document itself became hidden.
      try {
        x11('wmctrl', ['-ia', xid(windowId)]);
        x11('xdotool', ['key', 'ctrl+Tab']);
        method = 'x11-ctrl-tab';
        try {
          const evidence = await waitForHidden(page, 1_500);
          return {
            evidence: { ...evidence, method, windowId },
            restore: async () => {
              x11('wmctrl', ['-ia', xid(windowId)]);
              await page.bringToFront();
              await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
              await foregroundTab.close();
              await context.unroute(targetUrl, routeHandler);
              await browserSession.detach().catch(() => {});
            },
          };
        } catch (_) {
          // Continue with an OS window minimize if the popup was not a tab in
          // the same browser window.
        }
      } catch (_) {
        // X11 window controls may be unavailable in local browser runs.
      }
    } else {
      // Keep a controllable second page for non-X11 and local fallback cases.
      foregroundTab = await context.newPage();
      await foregroundTab.bringToFront();
      method = 'playwright-new-page';
      try {
        const evidence = await waitForHidden(page, 1_500);
        return {
          evidence: { ...evidence, method, windowId: null },
          restore: async () => {
            await page.bringToFront();
            await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
            await foregroundTab.close();
            await context.unroute(targetUrl, routeHandler);
          },
        };
      } catch (_) {
        // Continue with window minimization below.
      }
    }

    if (windowId === null) {
      const target = await getWindowId(page);
      windowId = target.windowId;
      browserSession = target.browserSession;
    }
    x11('xdotool', ['windowminimize', xid(windowId)]);
    minimized = true;
    method = 'x11-window-minimize';
    const evidence = await waitForHidden(page, timeout);
    return {
      evidence: { ...evidence, method, windowId },
      restore: async () => {
        x11('xdotool', ['windowmap', xid(windowId)]);
        x11('wmctrl', ['-ia', xid(windowId)]);
        await page.bringToFront();
        await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
        await foregroundTab?.close().catch(() => {});
        await context.unroute(targetUrl, routeHandler);
        await browserSession?.detach().catch(() => {});
      },
    };
  } catch (error) {
    if (minimized && windowId !== null) {
      try {
        x11('xdotool', ['windowmap', xid(windowId)]);
        x11('wmctrl', ['-ia', xid(windowId)]);
      } catch (_) {
        // Continue cleanup even when the X11 session is unavailable.
      }
    }
    await page.bringToFront().catch(() => {});
    await foregroundTab?.close().catch(() => {});
    await context.unroute(targetUrl, routeHandler).catch(() => {});
    await browserSession?.detach().catch(() => {});
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium X11/tab lifecycle did not produce verified hidden state (${detail})`, { cause: error });
  }
}
