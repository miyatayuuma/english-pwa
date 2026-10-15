import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function wmctrl(...args) {
  return execFileSync('wmctrl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function windowIdAsBigInt(value) {
  return BigInt(value.trim());
}

export async function minimizeChromiumWindow(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({ visibility: document.visibilityState, hasFocus: document.hasFocus() }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  await page.bringToFront();
  await page.waitForFunction(
    () => document.visibilityState === 'visible' && document.hasFocus(),
    null,
    { timeout, polling: 100 },
  );

  const activeWindowId = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
  const activeWindowNumber = windowIdAsBigInt(activeWindowId);
  const windows = wmctrl('-lp').split(/\r?\n/).filter(Boolean);
  const matchingWindow = windows.find(line => {
    const listedId = line.trim().split(/\s+/)[0];
    return BigInt(listedId) === activeWindowNumber;
  });
  assert.ok(matchingWindow, `X11 active window belongs to a listed Chromium window; active=${activeWindowId}; windows=${windows.join(' | ')}`);
  const wmWindowId = matchingWindow.trim().split(/\s+/)[0];
  const windowPid = execFileSync('xdotool', ['getwindowpid', activeWindowId], { encoding: 'utf8' }).trim();

  try {
    execFileSync('xdotool', ['windowminimize', activeWindowId], { stdio: 'ignore' });
    await page.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout, polling: 100 });
    const evidence = await page.evaluate(() => ({
      state: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    assert.equal(evidence.state, 'hidden');
    assert.equal(evidence.hidden, true);
    return {
      windowId: wmWindowId,
      windowPid,
      evidence,
      restore: async () => {
        wmctrl('-ia', wmWindowId);
        await page.bringToFront();
        await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
      },
    };
  } catch (error) {
    wmctrl('-ia', wmWindowId);
    throw new Error(`Minimizing the X11 active Chromium window did not produce a verified hidden transition (window ${wmWindowId}, pid ${windowPid})`, { cause: error });
  }
}
