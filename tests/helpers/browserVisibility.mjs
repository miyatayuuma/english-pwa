import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

let windowSequence = 0;

function wmctrl(...args) {
  return execFileSync('wmctrl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function minimizeChromiumWindow(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({ visibility: document.visibilityState, title: document.title }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const title = `issue210-hidden-${process.pid}-${++windowSequence}`;
  await page.evaluate(value => { document.title = value; }, title);

  let row = '';
  for (let attempt = 0; attempt < 20 && !row; attempt += 1) {
    row = wmctrl('-lp').split(/\r?\n/).find(line => line.endsWith(title)) || '';
    if (!row) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(row, `window manager lists Chromium window titled ${title}`);
  const windowId = row.trim().split(/\s+/)[0];

  try {
    execFileSync('xdotool', ['windowminimize', windowId], { stdio: 'ignore' });
    await page.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout, polling: 100 });
    const evidence = await page.evaluate(() => ({
      state: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    assert.equal(evidence.state, 'hidden');
    assert.equal(evidence.hidden, true);
    return {
      title,
      windowId,
      evidence,
      restore: async () => {
        wmctrl('-ia', windowId);
        await page.bringToFront();
        await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout, polling: 100 });
        await page.evaluate(value => { document.title = value; }, initial.title);
      },
    };
  } catch (error) {
    wmctrl('-ia', windowId);
    await page.evaluate(value => { document.title = value; }, initial.title).catch(() => {});
    throw new Error(`OS-level Chromium window minimize did not produce a verified hidden transition (${title})`, { cause: error });
  }
}
