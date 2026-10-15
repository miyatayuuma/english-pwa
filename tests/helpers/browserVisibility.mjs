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
  let targetActivation = null;
  let method = '';
  try {
    // Add and click a fixture link with target=_blank. Chromium handles the
    // actual navigation and selects a tab in the app window.
    await page.evaluate(url => {
      const link = document.createElement('a');
      link.id = 'issue210-background-tab-link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open background test tab';
      Object.assign(link.style, {
        position: 'fixed', left: '8px', top: '8px', zIndex: '2147483647',
        width: '180px', height: '36px', opacity: '0.01',
      });
      document.body.append(link);
    }, targetUrl);
    const pageEvent = context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
    await page.locator('#issue210-background-tab-link').click({ timeout: 5_000 });
    foregroundTab = await pageEvent;
    assert.ok(foregroundTab, 'Chromium created a second page for the real target=_blank link');
    await foregroundTab.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});

    method = 'chromium-target-blank-tab';
    try {
      await foregroundTab.bringToFront();
      const evidence = await waitForHidden(page, 1_500);
      return {
        evidence: { ...evidence, method },
        restore: async () => {
          await page.bringToFront();
          await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
          await foregroundTab.close();
          await page.evaluate(() => document.querySelector('#issue210-background-tab-link')?.remove());
          await context.unroute(targetUrl, routeHandler);
        },
      };
    } catch (_) {
      // The explicit Playwright foreground switch did not produce a native
      // hidden transition; try browser-level tab activation next.
    }

    let browserCdpSession = null;
    let appCdpSession = null;
    let foregroundCdpSession = null;
    let createdTargetId = null;
    try {
      browserCdpSession = await context.browser().newBrowserCDPSession();
      appCdpSession = await context.newCDPSession(page);
      foregroundCdpSession = await context.newCDPSession(foregroundTab);
      const [{ targetInfo: appTarget }, { targetInfo: foregroundTarget }] = await Promise.all([
        appCdpSession.send('Target.getTargetInfo'),
        foregroundCdpSession.send('Target.getTargetInfo'),
      ]);
      const [appWindow, foregroundWindow] = await Promise.all([
        browserCdpSession.send('Browser.getWindowForTarget', { targetId: appTarget.targetId }),
        browserCdpSession.send('Browser.getWindowForTarget', { targetId: foregroundTarget.targetId }),
      ]);
      targetActivation = {
        appTargetId: appTarget.targetId,
        appBrowserContextId: appTarget.browserContextId || null,
        appWindowId: appWindow.windowId,
        foregroundTargetId: foregroundTarget.targetId,
        foregroundWindowId: foregroundWindow.windowId,
      };
      let targetIdToActivate = foregroundTarget.targetId;
      if (appWindow.windowId !== foregroundWindow.windowId) {
        const pageEvent = context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
        const created = await browserCdpSession.send('Target.createTarget', {
          url: targetUrl,
          browserContextId: appTarget.browserContextId,
          openerId: appTarget.targetId,
          forTab: true,
          background: false,
        });
        createdTargetId = created.targetId;
        targetIdToActivate = created.targetId;
        const sameWindowTab = await pageEvent;
        assert.ok(sameWindowTab, 'Chromium created a tab target in the isolated BrowserContext');
        await sameWindowTab.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
        await foregroundTab.close();
        foregroundTab = sameWindowTab;
        const createdWindow = await browserCdpSession.send('Browser.getWindowForTarget', { targetId: created.targetId });
        targetActivation.createdTargetId = created.targetId;
        targetActivation.createdWindowId = createdWindow.windowId;
      }
      await browserCdpSession.send('Target.activateTarget', { targetId: targetIdToActivate });
      targetActivation.activatedTargetId = targetIdToActivate;
      method = 'cdp-activate-chromium-tab';
    } catch (error) {
      targetActivation = {
        ...(targetActivation || {}),
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
      if (createdTargetId) {
        await browserCdpSession?.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
      }
    } finally {
      await foregroundCdpSession?.detach().catch(() => {});
      await appCdpSession?.detach().catch(() => {});
      await browserCdpSession?.detach().catch(() => {});
    }
    if (targetActivation?.activatedTargetId) {
      try {
        const evidence = await waitForHidden(page, 2_000);
        return {
          evidence: { ...evidence, method, targetActivation },
          restore: async () => {
            await page.bringToFront();
            await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
            await foregroundTab.close();
            await page.evaluate(() => document.querySelector('#issue210-background-tab-link')?.remove());
            await context.unroute(targetUrl, routeHandler);
          },
        };
      } catch (error) {
        targetActivation.hiddenWaitError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        await foregroundTab.close().catch(() => {});
        foregroundTab = null;
      }
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
          await page.evaluate(() => document.querySelector('#issue210-background-tab-link')?.remove());
          await context.unroute(targetUrl, routeHandler);
        },
      };
    } catch (_) {
      // The keyboard shortcut did not select another tab in this CI window.
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
    await page.evaluate(() => document.querySelector('#issue210-background-tab-link')?.remove()).catch(() => {});
    await context.unroute(targetUrl, routeHandler).catch(() => {});
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium X11/tab lifecycle did not produce verified hidden state: ${JSON.stringify({ method, targetActivation, x11WindowId, pageState, popupState, x11State })} (${detail})`, { cause: error });
  }
}
