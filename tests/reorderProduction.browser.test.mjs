import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const item = {
  id: 'RPROD1',
  en: 'Birds sing. We like books. They run.',
  ja: '鳥は歌います。私たちは本が好きです。彼らは走ります。',
  unit: 'Section1',
  taskType: 'read',
  tags: 'fixture',
};
const sentenceRows = [
  { text: 'Birds sing.', tiles: ['Birds', 'sing.'] },
  { text: 'We like books.', tiles: ['We', 'like', 'books.'] },
  { text: 'They run.', tiles: ['They', 'run.'] },
];

function buildMetadata(sourceItem = item) {
  const sentences = sentenceRows.map((row, sentenceIndex) => {
    let charOffset = sourceItem.en.indexOf(row.text);
    const tiles = row.tiles.map((text, tileIndex) => {
      const charStart = charOffset;
      const charEnd = charStart + text.length;
      charOffset = charEnd + (tileIndex + 1 < row.tiles.length ? 1 : 0);
      return {
        id: `s${sentenceIndex}-t${tileIndex}`,
        text,
        tokenStart: tileIndex,
        tokenEnd: tileIndex + 1,
        charStart,
        charEnd,
        role: 'phrase',
        label: '語句',
        dependency: 'fixture',
        separatorAfter: tileIndex + 1 < row.tiles.length ? ' ' : '',
      };
    });
    const canonicalOrder = tiles.map((tile) => tile.id);
    const variant = {
      tier: 'foundation',
      tiles,
      canonicalOrder,
      acceptedOrders: [canonicalOrder],
      clauseScaffold: tiles.map(() => '語句'),
      canonicalReconstruction: row.text,
    };
    return {
      sentenceIndex,
      text: row.text,
      fixedContext: false,
      variants: { foundation: variant },
    };
  });
  return {
    schemaVersion: 1,
    items: [{
      itemId: sourceItem.id,
      sourceHash: crypto.createHash('sha256').update(sourceItem.en, 'utf8').digest('hex'),
      status: 'playable',
      sentences,
    }],
  };
}

const validMetadata = buildMetadata();
let server;
let baseUrl;
let browser;
let browserError = '';
let metadata = validMetadata;
let holdMetadata = false;
let metadataRequestedResolve;
let heldMetadataResponse;
let metadataRequestCount = 0;

function waitForMetadataRequest() {
  return new Promise((resolve) => { metadataRequestedResolve = resolve; });
}

function respondWithMetadata(response, payload = metadata) {
  if (!response || response.writableEnded) return;
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function newProductionPage({ studyMode = 'compose', hold = false, metadataPayload = validMetadata } = {}) {
  metadata = metadataPayload;
  holdMetadata = hold;
  heldMetadataResponse = null;
  metadataRequestCount = 0;
  const metadataRequested = hold ? waitForMetadataRequest() : null;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ studyMode }) => {
    localStorage.setItem('appConfigV3', JSON.stringify({ playbackMode: 'speech', studyMode }));
    window.__testSpeech = { latest: null };
    class MockRecognition {
      constructor() { window.__testSpeech.latest = this; }
      start() { this.onstart?.(); }
      stop() {}
      inject(text) {
        const result = Object.assign([{ transcript: String(text), confidence: 1 }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [result] });
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: MockRecognition, configurable: true });
    class MockUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      value: { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} },
      configurable: true,
    });
  }, { studyMode });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => window.ALL_ITEMS?.length === 1
    && document.querySelector('#sessionShellStyles')
    && document.querySelector('#startStudyCta'));
  await page.locator('#startStudyCta').click();
  return { context, page, metadataRequested };
}

async function waitForReorder(page) {
  await page.waitForSelector('#composeGuide.show .compose-token', { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#enText')?.dataset.itemId === 'RPROD1');
}

async function awaitMetadataRequest(requested) {
  let timer;
  try {
    return await Promise.race([
      requested,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('production render did not request reorder metadata')), 12000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function completeSentence(page, sentenceIndex, order) {
  for (const tileIndex of order) {
    await page.locator(`[data-zone="bank"][data-tile-id="s${sentenceIndex}-t${tileIndex}"]`).click();
  }
  await page.waitForSelector('#composeControls [data-action="advance"]');
  await page.locator('#composeControls [data-action="advance"]').click();
}

async function failSentenceThreeTimes(page, sentenceIndex) {
  const tileCount = sentenceRows[sentenceIndex].tiles.length;
  const wrongOrder = Array.from({ length: tileCount }, (_, index) => tileCount - index - 1);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const tileIndex of wrongOrder) {
      await page.locator(`[data-zone="bank"][data-tile-id="s${sentenceIndex}-t${tileIndex}"]`).click();
    }
    if (attempt < 3) await page.locator('#composeControls [data-action="reset"]').click();
  }
  await page.waitForSelector('#composeControls [data-action="advance"]');
  assert.match(await page.locator('#composeFeedback').innerText(), /正しい語順を表示/);
  await page.locator('#composeControls [data-action="advance"]').click();
}

async function submitFullUtterance(page) {
  await page.waitForFunction(() => !document.querySelector('#btnMic')?.disabled);
  await page.evaluate(() => document.querySelector('#btnMic').click());
  await page.waitForFunction(() => window.__testSpeech?.latest, null, { timeout: 5000 });
  await page.evaluate((text) => window.__testSpeech.latest.inject(text), item.en);
  await page.evaluate(() => document.querySelector('#btnMic').click());
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(localStorage.getItem('itemLevelV1') || '{}').RPROD1;
      return state?.lastMatch === 1;
    } catch { return false; }
  }, null, { timeout: 5000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('itemLevelV1') || '{}').RPROD1);
}

async function closePage({ context }) { await context.close(); }

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
    if (url.pathname === '/data/items.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify([item]));
      return;
    }
    if (url.pathname === '/data/reorder-v1.json') {
      metadataRequestCount += 1;
      if (holdMetadata) {
        holdMetadata = false;
        heldMetadataResponse = response;
        metadataRequestedResolve?.();
        return;
      }
      respondWithMetadata(response);
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
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { browserError = String(error?.message ?? error).split('\n')[0]; }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

browserTest('production render keeps canonical English out of DOM and accessible text until delayed metadata activates reordering', async () => {
  const opened = await newProductionPage({ hold: true });
  const { context, page, metadataRequested } = opened;
  try {
    await awaitMetadataRequest(metadataRequested);
    const pending = await page.evaluate(() => {
      const english = document.querySelector('#enText');
      return {
        text: english.textContent,
        html: english.innerHTML,
        ariaLabel: english.getAttribute('aria-label') || '',
        markup: english.outerHTML,
        micDisabled: document.querySelector('#btnMic').disabled,
      };
    });
    const accessibleText = await page.locator('#enText').ariaSnapshot();
    const answerFragments = sentenceRows.flatMap((row) => row.tiles);
    for (const field of ['text', 'html', 'ariaLabel', 'markup']) {
      assert.equal(pending[field].includes(item.en), false, `canonical answer leaked through ${field}: ${pending[field]}`);
      for (const fragment of answerFragments) {
        assert.equal(pending[field].includes(fragment), false, `answer tile leaked through ${field}: ${pending[field]}`);
      }
    }
    assert.equal(accessibleText.includes(item.en), false, `canonical answer leaked through accessibility tree: ${accessibleText}`);
    for (const fragment of answerFragments) {
      assert.equal(accessibleText.includes(fragment), false, `answer tile leaked through accessibility tree: ${accessibleText}`);
    }
    assert.equal(pending.micDisabled, true);
    respondWithMetadata(heldMetadataResponse, validMetadata);
    await waitForReorder(page);
    assert.match(await page.locator('#enText').innerText(), /文の語順を組み立ててください/);
    assert.equal(await page.locator('#composeTokens .compose-token').count(), 2);
    assert.equal(await page.locator('#btnMic').isDisabled(), true);
    assert.equal((await page.locator('#enText').innerText()).includes(item.en), false);
  } finally {
    if (heldMetadataResponse && !heldMetadataResponse.writableEnded) respondWithMetadata(heldMetadataResponse, validMetadata);
    await closePage({ context });
  }
});

browserTest('production render safely restores English and enables speech after a stale metadata source hash', async () => {
  const staleMetadata = {
    ...validMetadata,
    items: [{ ...validMetadata.items[0], sourceHash: 'stale-source-hash' }],
  };
  const { context, page } = await newProductionPage({ metadataPayload: staleMetadata });
  try {
    await page.waitForFunction(() => document.querySelector('#enText')?.dataset.itemId === 'RPROD1'
      && document.querySelector('#enText')?.textContent.includes('Birds sing.'));
    assert.equal(await page.locator('#composeGuide').evaluate((node) => node.classList.contains('show')), false);
    assert.equal(await page.locator('#btnMic').isDisabled(), false);
    assert.match(await page.locator('#footerMessage').innerText(), /並べ替えを安全に停止しました/);
    assert.match(await page.locator('#nextActionMessage').innerText(), /語順データを確認できない/);
    await page.locator('#btnMic').click();
    await page.waitForFunction(() => window.__testSpeech?.latest);
  } finally {
    await closePage({ context });
  }
});

browserTest('production read mode keeps canonical English visible and does not request reorder metadata', async () => {
  const { context, page } = await newProductionPage({ studyMode: 'read' });
  try {
    await page.waitForFunction(() => document.querySelector('#enText')?.dataset.itemId === 'RPROD1');
    await page.evaluate(() => document.dispatchEvent(new Event('english-pwa:request-hint')));
    await page.waitForFunction(() => document.querySelector('#enText')?.textContent.includes('Birds sing.'));
    assert.equal(metadataRequestCount, 0);
    assert.equal(await page.locator('#composeGuide').evaluate((node) => node.classList.contains('show')), false);
  } finally {
    await closePage({ context });
  }
});

browserTest('production assisted multi-sentence reorder grades full-item speech as assisted, while self-completed reorder stays unassisted', async () => {
  const opened = await newProductionPage();
  const { context, page } = opened;
  try {
    await waitForReorder(page);
    await completeSentence(page, 0, [0, 1]);
    await failSentenceThreeTimes(page, 1);
    await completeSentence(page, 2, [0, 1]);
    const assisted = await submitFullUtterance(page);
    assert.equal(assisted.hintStage, 3, 'English answer reveal must be recorded before speech grading');
    assert.equal(assisted.noHintHistory.length, 0, 'assisted speech cannot enter no-hint history');
    assert.equal(assisted.level5Count, 0, 'assisted 100% speech cannot count as perfect-no-hint');
    assert.equal(assisted.lastMatch, 1);
  } finally {
    await closePage({ context });
  }

  const selfCompleted = await newProductionPage();
  try {
    await waitForReorder(selfCompleted.page);
    await completeSentence(selfCompleted.page, 0, [0, 1]);
    await completeSentence(selfCompleted.page, 1, [0, 1, 2]);
    await completeSentence(selfCompleted.page, 2, [0, 1]);
    const unassisted = await submitFullUtterance(selfCompleted.page);
    assert.equal(unassisted.hintStage, 0, 'self-correct reorder cannot raise hint stage');
    assert.equal(unassisted.noHintHistory.length, 1, 'pure self-completion remains eligible for no-hint success');
    assert.equal(unassisted.level5Count, 1, 'pure self-completion keeps perfect-no-hint credit');
  } finally {
    await closePage(selfCompleted);
  }
});

browserTest('a pre-existing English hint stage survives self-completed reorder and speech grading', async () => {
  const opened = await newProductionPage();
  const { context, page } = opened;
  try {
    await waitForReorder(page);
    await page.evaluate(() => {
      for (let index = 0; index < 3; index += 1) {
        document.dispatchEvent(new Event('english-pwa:request-hint'));
      }
    });
    assert.match(await page.locator('#enText').innerText(), /Birds sing\./);
    await completeSentence(page, 0, [0, 1]);
    await completeSentence(page, 1, [0, 1, 2]);
    await completeSentence(page, 2, [0, 1]);
    const state = await submitFullUtterance(page);
    assert.equal(state.hintStage, 3);
    assert.equal(state.noHintHistory.length, 0);
  } finally {
    await closePage({ context });
  }
});
