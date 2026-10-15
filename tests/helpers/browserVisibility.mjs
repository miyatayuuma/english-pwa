import assert from 'node:assert/strict';

export async function backgroundChromiumTab(page, { timeout = 10_000 } = {}) {
  const initial = await page.evaluate(() => ({
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  assert.equal(initial.visibility, 'visible', 'Chromium page starts foregrounded');

  const foregroundTab = await page.context().newPage();
  try {
    await foregroundTab.bringToFront();
    await page.waitForFunction(
      () => document.visibilityState === 'hidden',
      null,
      { timeout, polling: 100 },
    );
    const evidence = await page.evaluate(() => ({
      state: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    assert.equal(evidence.state, 'hidden');
    assert.equal(evidence.hidden, true);

    return {
      evidence,
      restore: async () => {
        await page.bringToFront();
        await page.waitForFunction(
          () => document.visibilityState === 'visible',
          null,
          { timeout, polling: 100 },
        );
        await foregroundTab.close();
      },
    };
  } catch (error) {
    await page.bringToFront().catch(() => {});
    await foregroundTab.close().catch(() => {});
    throw new Error('Activating a second Chromium tab did not produce a verified hidden transition', { cause: error });
  }
}
