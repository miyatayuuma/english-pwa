import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const root = new URL('../', import.meta.url);
const versionSource = await readFile(new URL('scripts/version.js', root), 'utf8');
const version = versionSource.match(/const APP_VERSION = '([^']+)'/)[1];
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png' };
const basePath = '/english-pwa/';
const previousStudy = {
  itemLevelV1: '{"E0001":{"last":4,"best":4,"review":{"nextDueAt":1800000000000}},"vocab:00001":{"last":3,"best":3}}',
  studyLogV1: '{"2026-11-25":{"passes":7}}',
  relationshipMilestonesV1: '{"friends_5":1730000000000}',
  recentVocabularySessionIdsV1: '["vocab:00001"]',
};
const oldDocument = '<!doctype html><html><body><p>旧版の読み込み中</p><script src="./scripts/app/main.js"></script></body></html>';
const brokenScript = 'sessionStorage.setItem("staleMainRan", "1"); throw new Error("cached app startup failed");';

let server;
let browser;
let origin;
let legacyRelease;

function legacyWorker(cacheName, cacheNavigation) {
  return `
    self.addEventListener('install', event => {
      event.waitUntil(caches.open(${JSON.stringify(cacheName)}).then(cache =>
        cache.addAll(['./index.html', './scripts/app/main.js'])));
    });
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      const url = new URL(event.request.url);
      let key = event.request;
      if (${cacheNavigation} && event.request.mode === 'navigate' &&
          (url.pathname === '${basePath}' || url.pathname === '${basePath}index.html')) {
        key = new URL('./index.html', self.registration.scope);
      } else if (!url.pathname.startsWith('${basePath}scripts/')) {
        return;
      }
      event.respondWith(caches.open(${JSON.stringify(cacheName)}).then(async cache =>
        (await cache.match(key)) || fetch(event.request)));
    });
  `;
}

before(async () => {
  server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith(basePath)) return res.writeHead(404).end();
    const file = decodeURIComponent(pathname.slice(basePath.length)) || 'index.html';
    const send = (bytes, contentType = types[file.split('.').at(-1)] || 'application/octet-stream') =>
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(bytes);
    if (file === 'seed.html') return send('<!doctype html><title>Test storage</title>');
    if (legacyRelease) {
      if (file === 'sw.js') {
        const cacheName = legacyRelease === 'v5.117' ? legacyRelease : `english-pwa:${origin}${basePath}:${legacyRelease}`;
        return send(legacyWorker(cacheName, legacyRelease === 'v5.118'));
      }
      if (file === 'index.html') return send(oldDocument);
      if (file === 'scripts/app/main.js') return send(brokenScript);
    }
    try { send(await readFile(new URL(file, root))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch(); }
  catch (error) { if (process.env.REORDER_REQUIRE_BROWSER) throw error; }
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

for (const [legacy, entry] of [['v5.117', ''], ['v5.118', 'recover.html']]) {
  test(`${legacy} with broken cached startup upgrades at ${entry || 'the app URL'} and keeps study data`, async t => {
    if (!browser) return t.skip('Chromium unavailable');
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const base = origin + basePath;
    try {
      legacyRelease = legacy;
      const page = await context.newPage();
      await page.goto(base + 'seed.html');
      await page.evaluate(async state => {
        for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value);
        await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;
        const otherApp = await caches.open('unrelated-app-cache');
        await otherApp.put('/unrelated/control', new Response('preserve'));
      }, previousStudy);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const failure = page.waitForEvent('pageerror');
      await page.goto(base);
      assert.match((await failure).message, /cached app startup failed/);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('staleMainRan')), '1');
      assert.equal(await page.evaluate(() => window.APP_VERSION), undefined);
      await page.evaluate(() => sessionStorage.removeItem('staleMainRan'));

      legacyRelease = null;
      await page.goto(base + entry, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(current => window.APP_VERSION === current
        && window.ALL_ITEMS?.length === 560
        && window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status === 'ready'
        && document.getElementById('loadingOverlay').classList.contains('hidden'), version);
      assert.equal(page.url(), base);
      const stored = await page.evaluate(async keys => [
        Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
        sessionStorage.getItem('staleMainRan'),
        await (await caches.match('/unrelated/control', { cacheName: 'unrelated-app-cache' })).text(),
      ], Object.keys(previousStudy));
      assert.deepEqual(stored, [previousStudy, null, 'preserve']);

      await page.locator('#btnCfg').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#exportLearningBackup').click(),
      ]);
      const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(backup.appVersion, version);
      assert.equal(backup.data.studyLogV1['2026-11-25'].passes, 7);
      assert.equal(backup.data.itemLevelV1.E0001.review.nextDueAt, 1800000000000);
    } finally {
      await context.close();
    }
  });
}
