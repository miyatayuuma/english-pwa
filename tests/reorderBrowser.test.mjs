import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let baseUrl;
let browser;
let browserError = '';
let currentMetadata;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildItem({ id = 'T0001', sentences, itemText, sourceHashText = itemText } = {}) {
  const entries = sentences.map((entry, sentenceIndex) => {
    if (entry.fixedContext) return {
      sentenceIndex,
      text: entry.text,
      fixedContext: true,
      fixedContextReason: entry.fixedContextReason ?? 'one-word-fragment',
      variants: {},
    };
    const tiles = entry.tiles.map((text, tileIndex) => ({
      id: `s${sentenceIndex}-t${tileIndex}`,
      text,
      tokenStart: tileIndex,
      tokenEnd: tileIndex + 1,
      charStart: tileIndex,
      charEnd: tileIndex + text.length,
      role: 'phrase',
      label: '語句',
      dependency: 'fixture',
      separatorAfter: tileIndex + 1 < entry.tiles.length ? ' ' : '',
    }));
    const canonicalOrder = tiles.map((tile) => tile.id);
    const variant = {
      tier: entry.tier ?? 'foundation',
      tiles,
      canonicalOrder,
      acceptedOrders: [canonicalOrder],
      clauseScaffold: tiles.map(() => '語句'),
      canonicalReconstruction: entry.text,
    };
    return {
      sentenceIndex,
      text: entry.text,
      fixedContext: false,
      variants: { [variant.tier]: variant },
    };
  });
  return {
    item: { id, en: sourceHashText, taskType: 'compose' },
    metadataItem: { itemId: id, sourceHash: sha256(sourceHashText), status: 'playable', sentences: entries },
  };
}

function basicFixture(count = 3) {
  const words = Array.from({ length: count }, (_, index) => `unit${index + 1}`);
  words[words.length - 1] += '.';
  const text = words.join(' ');
  return buildItem({ itemText: text, sentences: [{ text, tiles: words }] });
}

async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/tests/reorder-harness.html`);
  await page.waitForFunction(() => typeof window.bootReorder === 'function');
  return { context, page };
}

async function boot(page, fixture, level = 0) {
  currentMetadata = { schemaVersion: 1, items: [fixture.metadataItem] };
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  const result = await page.evaluate(({ item, level }) => window.bootReorder(item, level), { item: fixture.item, level });
  if (!result.active) {
    const diagnostics = await page.evaluate(async () => {
      const urls = [
        new URL('./data/reorder-v1.json', document.baseURI),
        new URL('../../data/reorder-v1.json', new URL('/scripts/app/reorderGuide.js', location.href)),
      ];
      return Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url);
          return { url: url.href, status: response.status, schemaVersion: (await response.json()).schemaVersion };
        } catch (error) {
          return { url: url.href, error: String(error) };
        }
      }));
    });
    throw new Error(`Reorder setup disabled: ${result.reason}; diagnostics=${JSON.stringify(diagnostics)}; console=${consoleMessages.join(' | ')}`);
  }
  return result;
}

async function tapTile(page, id) {
  await page.locator(`[data-zone="bank"][data-tile-id="${id}"]`).click();
}

async function tapCanonical(page, count) {
  for (let index = 0; index < count; index += 1) await tapTile(page, `s0-t${index}`);
}

async function closePage({ context }) {
  await context.close();
}

function browserTest(name, run) {
  test(name, async (t) => {
    if (!browser) {
      t.skip(`Chromium is unavailable in this environment: ${browserError || 'browser launch failed'}`);
      return;
    }
    await run(t);
  });
}

before(async () => {
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', baseUrl ?? 'http://127.0.0.1');
    if (url.pathname === '/data/reorder-v1.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(currentMetadata ?? { schemaVersion: 1, items: [] }));
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const content = await fs.readFile(target);
      const extension = path.extname(target);
      const type = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' })[extension] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      response.end(content);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    browserError = String(error?.message ?? error).split('\n')[0];
  }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

browserTest('390×844 supports three, seven, and nine tile sentence units without horizontal overflow', async () => {
  for (const count of [3, 7, 9]) {
    const { context, page } = await newPage();
    const phrases = Array.from({ length: count }, (_, index) => `phrase-${index + 1}`);
    phrases[0] = 'The exceptionally long noun phrase that must wrap inside the narrow mobile screen';
    if (count >= 7) phrases[1] = 'the fixed expression as soon as it becomes appropriate to continue';
    phrases[count - 1] += '.';
    const text = phrases.join(' ');
    const fixture = buildItem({ id: `T${count}`, itemText: text, sentences: [{ text, tiles: phrases }] });
    await boot(page, fixture, count === 3 ? 1 : count === 7 ? 3 : 5);
    await page.waitForSelector('.compose-token');
    assert.equal(await page.locator('.compose-token').count(), count);
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(widths.document <= widths.viewport, `horizontal overflow at ${count} tiles: ${JSON.stringify(widths)}`);
    if (count === 9) {
      await page.setViewportSize({ width: 320, height: 640 });
      const resized = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(resized.document <= resized.viewport, `horizontal overflow after resize: ${JSON.stringify(resized)}`);
    }
    await tapCanonical(page, count);
    await page.waitForSelector('[data-action="advance"]');
    await page.locator('[data-action="advance"]').click();
    await page.waitForFunction(() => document.querySelector('#completion').textContent === 'speech handoff');
    await closePage({ context });
  }
});

browserTest('tap-only completion, canonical feedback, and speech handoff work end-to-end', async () => {
  const { context, page } = await newPage();
  const fixture = basicFixture(3);
  await boot(page, fixture);
  assert.equal(await page.locator('#mic').isDisabled(), true);
  await tapCanonical(page, 3);
  await page.waitForSelector('[data-action="advance"]');
  assert.match(await page.locator('#composeFeedback').innerText(), /正解です/);
  assert.match(await page.locator('#composeContext').innerText(), /英文:/);
  assert.match(await page.locator('#composeContext').innerText(), /まとまり:/);
  await page.locator('[data-action="advance"]').click();
  await page.waitForFunction(() => document.querySelector('#completion').textContent === 'speech handoff');
  assert.equal(await page.locator('#mic').isDisabled(), false);
  assert.match(await page.locator('#composeContext').innerText(), new RegExp(fixture.item.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await closePage({ context });
});

browserTest('fixed context and two independent sentence puzzles progress in source order before full-item speech', async () => {
  const { context, page } = await newPage();
  const sentences = [
    { text: 'Hi.', fixedContext: true },
    { text: 'Birds sing.', tiles: ['Birds', 'sing.'] },
    { text: 'We like books.', tiles: ['We', 'like', 'books.'] },
  ];
  const fixture = buildItem({ id: 'MULTI', itemText: 'Hi. Birds sing. We like books.', sentences });
  await boot(page, fixture, 0);
  assert.match(await page.locator('#composeContext').innerText(), /固定文脈: Hi\./);
  assert.equal(await page.locator('[data-zone="bank"] .compose-token').count(), 0);
  await page.locator('[data-action="advance"]').click();
  await page.waitForSelector('[data-zone="bank"] .compose-token');
  assert.equal(await page.locator('[data-zone="bank"] .compose-token').count(), 2);
  assert.match(await page.locator('#composeContext').innerText(), /固定文脈: Hi\./);
  await tapCanonical(page, 2);
  await page.locator('[data-action="advance"]').click();
  await page.waitForFunction(() => document.querySelector('#composeNote').textContent.includes('Sentence 3/3'));
  assert.equal(await page.locator('[data-zone="bank"] .compose-token').count(), 3);
  await tapCanonical(page, 3);
  await page.locator('[data-action="advance"]').click();
  await page.waitForFunction(() => document.querySelector('#completion').textContent === 'speech handoff');
  assert.equal(await page.locator('#composeContext').innerText(), '全文: Hi. Birds sing. We like books.');
  await closePage({ context });
});

browserTest('wrong answers retain their tiles, offer a scaffold on try two, and reveal on try three', async () => {
  const { context, page } = await newPage();
  await boot(page, basicFixture(3));
  const wrong = async () => {
    await tapTile(page, 's0-t2');
    await tapTile(page, 's0-t0');
    await tapTile(page, 's0-t1');
  };
  await wrong();
  assert.match(await page.locator('#composeFeedback').innerText(), /語順が違います/);
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 3);
  await page.locator('[data-action="reset"]').click();
  await wrong();
  assert.match(await page.locator('#composeFeedback').innerText(), /文の骨格/);
  await page.locator('[data-action="reset"]').click();
  await wrong();
  assert.match(await page.locator('#composeFeedback').innerText(), /正しい語順を表示/);
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 3);
  assert.equal(await page.locator('[data-zone="bank"] .compose-token').count(), 0);
  assert.equal(await page.locator('#mic').isDisabled(), true);
  await closePage({ context });
});

browserTest('Undo, Reset, keyboard movement, and duplicate visual buttons are operable', async () => {
  const { context, page } = await newPage();
  const text = 'the dog and the dog';
  const fixture = buildItem({ id: 'DUPLICATE', itemText: text, sentences: [{ text, tiles: ['the dog', 'and', 'the dog'] }] });
  await boot(page, fixture);
  assert.equal(await page.locator('.compose-token').filter({ hasText: 'the dog' }).count(), 2);
  assert.equal(await page.locator('.compose-token').nth(0).evaluate((node) => node.tagName), 'BUTTON');
  assert.match(await page.locator('.compose-token').first().getAttribute('aria-label'), /EnterまたはSpace/);
  assert.equal(await page.locator('#composeFeedback').getAttribute('aria-live'), 'polite');
  await tapTile(page, 's0-t0');
  await page.locator('[data-zone="answer"][data-tile-id="s0-t0"]').click();
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 0);
  assert.equal(await page.locator('[data-zone="bank"] .compose-token').count(), 3);
  await tapTile(page, 's0-t0');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 0);
  await tapTile(page, 's0-t0');
  await tapTile(page, 's0-t1');
  await page.locator('[data-action="reset"]').click();
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 0);
  const tile = page.locator('[data-zone="bank"][data-tile-id="s0-t0"]');
  await tile.focus();
  await page.keyboard.press('Enter');
  await tapTile(page, 's0-t1');
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 2);
  await page.locator('[data-zone="answer"] [data-tile-id="s0-t0"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.locator('[data-zone="answer"] .compose-token').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId)), ['s0-t1', 's0-t0']);
  assert.match(await page.locator('#composeFeedback').innerText(), /解答内の語順を移動しました/);
  await page.locator('[data-zone="bank"][data-tile-id="s0-t2"]').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('[data-zone="answer"] .compose-token').count(), 3);
  assert.match(await page.locator('#composeFeedback').innerText(), /語順が違います/);
  await closePage({ context });
});

browserTest('pointer drag moves a tile between zones and between answer positions', async () => {
  const { context, page } = await newPage();
  await boot(page, basicFixture(3));
  const source = page.locator('[data-zone="bank"][data-tile-id="s0-t0"]');
  const destination = page.locator('[data-drop-zone="answer"]');
  const start = await source.boundingBox();
  const end = await destination.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 24, end.y + 24, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator('[data-zone="answer"][data-tile-id="s0-t0"]').count(), 1);
  await tapTile(page, 's0-t2');
  await tapTile(page, 's0-t1');
  const moving = page.locator('[data-zone="answer"][data-tile-id="s0-t0"]');
  const target = page.locator('[data-zone="answer"][data-tile-id="s0-t1"]');
  const from = await moving.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await page.locator('[data-zone="answer"] .compose-token').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId)), ['s0-t2', 's0-t1', 's0-t0']);
  await closePage({ context });
});

browserTest('schema or source-hash mismatch disables reordering without a word-count fallback', async () => {
  const { context, page } = await newPage();
  const fixture = basicFixture(3);
  currentMetadata = { schemaVersion: 2, items: [fixture.metadataItem] };
  await page.evaluate(({ item }) => window.bootReorder(item), { item: fixture.item });
  let state = await page.evaluate(() => window.getReorderState());
  assert.equal(state.active, false);
  assert.match(state.reason, /並べ替えを停止/);
  await closePage({ context });

  const next = await newPage();
  currentMetadata = { schemaVersion: 1, items: [{ ...fixture.metadataItem, sourceHash: 'stale' }] };
  await next.page.evaluate(({ item }) => window.bootReorder(item), { item: fixture.item });
  state = await next.page.evaluate(() => window.getReorderState());
  assert.equal(state.active, false);
  assert.match(state.reason, /全文を表示/);
  await closePage(next);
});

browserTest('the current PWA worker clears old caches and serves reorder metadata offline', async () => {
  const { context, page } = await newPage();
  const fixture = basicFixture(3);
  currentMetadata = { schemaVersion: 1, items: [fixture.metadataItem] };
  await page.evaluate(async () => {
    await caches.open('v5.54');
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const online = await page.evaluate(async () => (await fetch('/data/reorder-v1.json')).json());
  assert.equal(online.schemaVersion, 1);
  assert.equal(await page.evaluate(() => caches.keys().then((keys) => keys.includes('v5.54'))), false);
  await context.setOffline(true);
  const offline = await page.evaluate(async () => (await fetch('/data/reorder-v1.json')).json());
  assert.equal(offline.items[0].itemId, fixture.item.id);
  const cachedModule = await page.evaluate(async () => (await fetch('/scripts/app/reorderGuide.js')).text());
  assert.match(cachedModule, /createReorderGuide/);
  await closePage({ context });
});
