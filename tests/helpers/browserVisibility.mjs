import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function x11(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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

async function activeX11Window() {
  const windowId = x11('xdotool', ['getactivewindow']);
  assert.match(windowId, /^\d+$/, 'xdotool returned the actual active X11 window ID');
  return windowId;
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
  let x11WindowId = null;
  let minimized = false;
  let method = '';
  try {
    // Open an actual same-window tab through Chromium's window.open path. The
    // route is intentionally blank and fixture init scripts skip this path.
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

    if (!foregroundTab) foregroundTab = await context.newPage();
    else await foregroundTab.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});

    method = 'playwright-bring-to-front-tab';
    try {
      await foregroundTab.bringToFront();
      const evidence = await waitForHidden(page, 1_500);
      return {
        evidence: { ...evidence, method },
        restore: async () => {
          await page.bringToFront();
          await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
          await foregroundTab.close();
          await context.unroute(targetUrl, routeHandler);
        },
      };
    } catch (_) {
      // The explicit Playwright foreground switch did not produce a native
      // hidden transition; try the X11 keyboard and window controls next.
    }

    await page.bringToFront();
    x11WindowId = await activeX11Window();
    x11('xdotool', ['key', 'ctrl+Tab']);
    method = 'x11-ctrl-tab';
    try {
      const evidence = await waitForHidden(page, 1_500);
      return {
        evidence: { ...evidence, method, x11WindowId },
        restore: async () => {
          await page.bringToFront();
          await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
          await foregroundTab.close();
          await context.unroute(targetUrl, routeHandler);
        },
      };
    } catch (_) {
      // If tabs are in separate windows, minimize the actual X11 window.
    }

    await page.bringToFront();
    x11WindowId = await activeX11Window();
    x11('xdotool', ['windowminimize', x11WindowId]);
    minimized = true;
    method = 'x11-window-minimize';
    const evidence = await waitForHidden(page, timeout);
    return {
      evidence: { ...evidence, method, x11WindowId },
      restore: async () => {
        x11('xdotool', ['windowmap', x11WindowId]);
        x11('wmctrl', ['-ia', x11WindowId]);
        await page.bringToFront();
        await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
        await foregroundTab.close();
        await context.unroute(targetUrl, routeHandler);
      },
    };
  } catch (error) {
    if (minimized && x11WindowId) {
      try {
        x11('xdotool', ['windowmap', x11WindowId]);
        x11('wmctrl', ['-ia', x11WindowId]);
      } catch (_) {
        // Continue cleanup even when the X11 session is unavailable.
      }
    }
    const pageState = await page.evaluate(() => ({
      visibility: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      issueEvents: window.__issue210?.visibilityEvents || null,
      vocabularyEvents: window.__vocabularyHiddenAudit?.visibilityEvents || null,
    })).catch(() => null);
    const x11State = {
      activeWindow: (() => { try { return x11('xdotool', ['getactivewindow']); } catch (_) { return null; } })(),
      focusWindow: (() => { try { return x11('xdotool', ['getwindowfocus']); } catch (_) { return null; } })(),
      windows: (() => { try { return x11('wmctrl', ['-lpG']); } catch (_) { return null; } })(),
      netWmState: (() => {
        try { return x11('xprop', ['-id', x11WindowId, '_NET_WM_STATE']); }
        catch (_) { return null; }
      })(),
    };
    const popupState = await foregroundTab?.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      hidden: document.hidden,
      title: document.title,
    })).catch(() => null);
    await page.bringToFront().catch(() => {});
    await foregroundTab?.close().catch(() => {});
    await context.unroute(targetUrl, routeHandler).catch(() => {});
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium X11/tab lifecycle did not produce verified hidden state: ${JSON.stringify({ method, x11WindowId, pageState, popupState, x11State })} (${detail})`, { cause: error });
  }
}
