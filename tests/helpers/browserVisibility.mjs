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
function x11WindowForPid(pid) {
  const rows = x11('wmctrl', ['-lpG']).split(/\r?\n/);
  const match = rows.map(row => row.match(/^(0x[0-9a-f]+)\s+-?\d+\s+(\d+)\s+/i))
    .find(rowMatch => rowMatch && Number(rowMatch[2]) === Number(pid));
  assert.ok(match, `X11 window exists for Chromium Browser PID ${pid}`);
  return match[1];
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
    const { processInfo } = await browserCdpSession.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(process => process.type === 'Browser');
    assert.ok(browserProcess, 'Chromium exposes its Browser process ID');
    const appX11WindowId = x11WindowForPid(browserProcess.id);
    const created = await browserCdpSession.send('Target.createTarget', {
      url: 'about:blank',
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
      browserProcessId: browserProcess.id,
      appX11WindowId,
    };
    assert.equal(targetEvidence.sameWindow, true, 'Chromium created a tab in the app window');
    await browserCdpSession.send('Target.activateTarget', { targetId: createdTargetId });
    x11('wmctrl', ['-ia', appX11WindowId]);
    x11('xdotool', ['windowactivate', '--sync', appX11WindowId]);
    targetEvidence.activeX11Window = await activeX11Window();
    assert.equal(Number(targetEvidence.activeX11Window), Number.parseInt(appX11WindowId, 16),
      'the actual X11 window for this app Chromium process is foregrounded');
    const evidence = await waitForHidden(page, timeout);
    return {
      evidence: { ...evidence, ...targetEvidence },
      restore: async () => {
        await browserCdpSession.send('Target.activateTarget', { targetId: appTargetId });
        x11('wmctrl', ['-ia', appX11WindowId]);
        x11('xdotool', ['windowactivate', '--sync', appX11WindowId]);
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
    if (createdTargetId) await browserCdpSession?.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
    await detachSessions();
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Chromium browser target lifecycle did not produce verified hidden state: ${JSON.stringify({ targetEvidence, createdTargetId, appTargetId, pageState, x11State })} (${detail})`, { cause: error });
  }
}
