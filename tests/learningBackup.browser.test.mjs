import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const root = new URL('../', import.meta.url);
let server;
let browser;
let source;
let destination;
const type = { js: 'text/javascript', json: 'application/json', css: 'text/css', html: 'text/html' };

before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/practice\//, '/');
    const name = path === '/' ? '/index.html' : path;
    try {
      const body = await readFile(new URL('.' + name, root));
      response.setHeader('Content-Type', type[name.split('.').at(-1)] || 'application/octet-stream');
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  source = `http://127.0.0.1:${port}/practice/`;
  destination = `http://localhost:${port}/`;
  try { browser = await chromium.launch(); }
  catch (error) { if (process.env.REORDER_REQUIRE_BROWSER) throw error; }
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function waitForHome(page) {
  await page.waitForFunction(() => window.ALL_ITEMS?.length
    && document.querySelector('#friendshipHero')
    && window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status === 'ready'
    && !document.querySelector('#loadingOverlay')?.classList.contains('active'));
}

async function downloadBackup(page) {
  const download = page.waitForEvent('download', { timeout: 5000 });
  await page.locator('#exportLearningBackup').click();
  const file = await download.catch(async error => {
    throw new Error(await page.locator('#learningBackupStatus').textContent(), { cause: error });
  });
  assert.match(file.suggestedFilename(), /^english-pwa-learning-.*\.json$/);
  return readFile(await file.path());
}

async function selectBackup(page, buffer) {
  await page.locator('#learningBackupFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer });
}

test('Android viewport exports, previews, cancels and restores across origins with unchanged learning state', async t => {
  if (!browser) return t.skip('Chromium unavailable');
  const context = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(source + 'seed');
    await page.evaluate(() => {
      const stamp = Date.now();
      const day = new Date().toISOString().slice(0, 10);
      const state = {
        itemLevelV1: JSON.stringify({
          E0001: { last: 4, best: 4, updatedAt: stamp, review: { nextDueAt: stamp + 30000, stability: 2, difficulty: 4, intervalMs: 30000 } },
          'vocab:00001': { last: 2, best: 3, updatedAt: stamp, review: { nextDueAt: stamp + 60000 } },
          'vocab:retired': { last: 1, best: 1 },
        }),
        studyLogV1: JSON.stringify({ [day]: { passes: 10, session_closure: { cardsDone: 10, reason: 'completed' } } }),
        relationshipMilestonesV1: '{"friends_5":123}',
        appConfigV3: '{"studyMode":"read","apiKey":"not-portable"}',
        dailyGoalV1: '18',
        sessionGoalV1: '8',
        audioSpeedV1: '1.25',
        recentSentenceSessionIdsV1: '["E0001"]',
        recentVocabularySessionIdsV1: '["vocab:00001"]',
        recentCharacterSessionsV1: '["bob"]',
        vocabularyRotationSeedV1: '2',
      };
      for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value);
    });
    await page.goto(source);
    await waitForHome(page);
    const relationship = () => page.evaluate(async () => {
      const state = window.__RELATIONSHIP_GAME_STATE__();
      return state.relationships.map(row => [row.id, row.rank, row.friendshipPoints, row.intimacy]);
    });
    const originalRelationship = await relationship();
    await page.locator('#btnCfg').click();
    const first = await downloadBackup(page);
    const backup = JSON.parse(first);
    assert.equal(backup.data.appConfigV3.apiKey, undefined);
    assert.equal(backup.data.itemLevelV1.E0001.review.stability, 2);
    assert.equal(backup.data.itemLevelV1['vocab:retired'].last, 1);

    await page.goto(destination);
    await waitForHome(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('itemLevelV1')), null);
    await page.locator('#btnCfg').click();
    await selectBackup(page, Buffer.from('{broken'));
    await page.waitForFunction(() => document.querySelector('#learningBackupStatus').textContent.includes('JSON'));
    await selectBackup(page, first);
    await page.locator('#learningRestoreDialog').waitFor();
    assert.match(await page.locator('#learningRestoreDetails').innerText(), /教材は同じ版.*未収録 ID/s);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('itemLevelV1')), null);

    // A live tab can hold an older SRS/log snapshot. Restore must fail safely.
    const secondTab = await context.newPage();
    await secondTab.goto(destination);
    await waitForHome(secondTab);
    await selectBackup(page, first);
    await page.locator('#confirmLearningRestore').click();
    await page.waitForFunction(() => document.querySelector('#learningBackupStatus').textContent.includes('別のタブ'));
    assert.equal(await page.evaluate(() => localStorage.getItem('itemLevelV1')), null);
    await secondTab.close();

    for (let i = 0; i < 2; i++) {
      await selectBackup(page, first);
      await Promise.all([
        page.waitForEvent('load'),
        page.locator('#confirmLearningRestore').click(),
      ]);
      await waitForHome(page);
      assert.deepEqual(await relationship(), originalRelationship);
      await page.locator('#btnCfg').click();
      const exportedAgain = JSON.parse(await downloadBackup(page));
      assert.deepEqual(exportedAgain.data, backup.data);
    }

    await page.locator('#cfgClose').click();
    await page.locator('.friendship-hero__cta').click();
    await page.locator('#studyView').waitFor();
    await page.locator('#btnCfg').click();
    await page.locator('#exportLearningBackup').click();
    await page.waitForFunction(() => document.querySelector('#learningBackupStatus').textContent.includes('学習を終了'));
    assert.equal(await page.evaluate(() => localStorage.getItem('englishPwaLearningRestoreRecoveryV1')), null);
  } finally {
    await context.close();
  }
});
