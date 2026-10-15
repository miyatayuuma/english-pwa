import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
function x11WindowForTitle(title) {
  const rows = x11('wmctrl', ['-lpG']).split(/\r?\n/);
  const line = rows.find(row => row.includes(title));
  assert.ok(line, `X11 window exists for unique Chromium tab title ${title}`);
  return line.match(/^(0x[0-9a-f]+)/i)?.[1] || null;
}

async function waitForX11WindowForTitle(title, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const windowId = x11WindowForTitle(title);
      assert.ok(windowId, `X11 window ID is present for ${title}`);
      return windowId;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`X11 window title did not appear: ${title}`);
}

export async function backgroundChromiumTab(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const context = page.context();
  let browserCdpSession = null;
  let pageCdpSession = null;
  let appTargetId = null;
  let createdTargetId = null;
  let targetEvidence = null;
  let appX11WindowId = null;
  let focusMarker = null;
  const detachSessions = async () => {
    await pageCdpSession?.detach().catch(() => {});
    await browserCdpSession?.detach().catch(() => {});
    pageCdpSession = null;
    browserCdpSession = null;
  };

  try {
    browserCdpSession = await context.browser().newBrowserCDPSession();
    pageCdpSession = await context.newCDPSession(page);
    const { targetInfo: appTarget } = await pageCdpSession.send('Target.getTargetInfo');
    appTargetId = appTarget.targetId;
    assert.ok(appTarget.browserContextId, 'app page belongs to an isolated BrowserContext');
    const appWindow = await browserCdpSession.send('Browser.getWindowForTarget', { targetId: appTargetId });
    focusMarker = `ISSUE210_BG_${randomUUID().replaceAll('-', '')}`;
    const targetUrl = `data:text/html,${encodeURIComponent(`<title>${focusMarker}</title>`)}`;
    const created = await browserCdpSession.send('Target.createTarget', {
      url: targetUrl,
      browserContextId: appTarget.browserContextId,
      openerId: appTargetId,
      forTab: true,
      background: false,
      focus: true,
    });
    createdTargetId = created.targetId;
    const createdWindow = await browserCdpSession.send('Browser.getWindowForTarget', { targetId: createdTargetId });
    targetEvidence = {
      method: 'cdp-target-create-tab',
      appTargetId,
      appWindowId: appWindow.windowId,
      createdTargetId,
      createdWindowId: createdWindow.windowId,
      sameWindow: appWindow.windowId === createdWindow.windowId,
      focusMarker,
    };
    assert.equal(targetEvidence.sameWindow, true, 'Chromium created a tab in the app window');
    await browserCdpSession.send('Target.activateTarget', { targetId: createdTargetId });
    appX11WindowId = await waitForX11WindowForTitle(focusMarker, 5_000);
    targetEvidence.appX11WindowId = appX11WindowId;
    x11('wmctrl', ['-ia', appX11WindowId]);
    x11('xdotool', ['windowactivate', '--sync', appX11WindowId]);
    targetEvidence.activeX11Window = await activeX11Window();
    assert.equal(Number(targetEvidence.activeX11Window), Number.parseInt(appX11WindowId, 16),
      'the X11 window containing this uniquely titled Chromium tab is foregrounded');
    const evidence = await waitForHidden(page, timeout);
    return {
      evidence: { ...evidence, ...targetEvidence },
      restore: async () => {
        await browserCdpSession.send('Target.activateTarget', { targetId: appTargetId });
        if (appX11WindowId) {
          x11('wmctrl', ['-ia', appX11WindowId]);
          x11('xdotool', ['windowactivate', '--sync', appX11WindowId]);
        }
        await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
        await browserCdpSession.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
        await detachSessions();
      },
    };
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      visibility: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      visibilityEvents: window.__issue210?.visibilityEvents?.map(event => ({ ...event }))
        || window.__vocabularyHiddenAudit?.visibilityEvents?.map(event => ({ ...event }))
        || [],
    })).catch(() => null);
    const x11State = {
      activeWindow: (() => { try { return x11('xdotool', ['getactivewindow']); } catch (_) { return null; } })(),
      focusWindow: (() => { try { return x11('xdotool', ['getwindowfocus']); } catch (_) { return null; } })(),
      windows: (() => { try { return x11('wmctrl', ['-lpG']); } catch (_) { return null; } })(),
    };
    if (appTargetId) await browserCdpSession?.send('Target.activateTarget', { targetId: appTargetId }).catch(() => {});
    if (appX11WindowId) {
      try {
        x11('wmctrl', ['-ia', appX11WindowId]);
        x11('xdotool', ['windowactivate', '--sync', appX11WindowId]);
      } catch (_) { /* retain the original lifecycle diagnostic */ }
    }
    if (createdTargetId) await browserCdpSession?.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
    await detachSessions();
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium browser target lifecycle did not produce verified hidden state: ${JSON.stringify({ targetEvidence, createdTargetId, appTargetId, pageState, x11State })} (${detail})`, { cause: error });
  }
}
