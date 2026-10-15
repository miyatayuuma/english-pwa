import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installMockSpeechRecognition } from './helpers/mockSpeechRecognition.mjs';
import { buildExchangeResult } from '../scripts/app/relationshipMode.js';
import { reachedMilestones } from '../scripts/app/relationshipCore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INITIAL_MAIN_SHA = '447063b6160ce3919a369dd7136512d41fafd6ce';
const FIXED_NOW = Date.parse('2026-10-14T12:00:00.000Z');
const FIXED_DAY = '2026-10-14';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const itemRows = JSON.parse(await fs.readFile(path.join(ROOT, 'data/items.json'), 'utf8'));
const itemsById = new Map(itemRows.map(item => [item.id, item]));
let server;
let baseUrl;
let browser;
let browserError = '';

function fixture(ids) {
  return ids.map(id => {
    const item = itemsById.get(id);
    assert.ok(item, `production fixture item ${id} exists`);
    return item;
  });
}

function srsSeed({ level, history = [], dueAt = FIXED_NOW - HOUR, intervalMs = DAY } = {}) {
  return {
    last: level,
    best: level,
    noHintStreak: history.length,
    level5Count: level === 5 ? 1 : 0,
    lastMatch: level >= 2 ? 0.8 : 0,
    hintStage: 0,
    updatedAt: FIXED_NOW - 2 * DAY,
    noHintHistory: history,
    review: { nextDueAt: dueAt, stability: 1, difficulty: 5, intervalMs },
  };
}

function browserTest(name, run, options = {}) {
  test(name, { timeout: 120_000, ...options }, async t => {
    if (!browser) {
      if (process.env.ISSUE210_REQUIRE_BROWSER) {
        throw new Error(`Chromium is required but did not start: ${browserError}`);
      }
      t.skip(`Chromium unavailable locally: ${browserError || 'browser launch failed'}`);
      return;
    }
    await run(t);
  });
}

before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
      const target = path.resolve(ROOT, relative);
      if (!target.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const ext = path.extname(target);
      const types = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      };
      response.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(await fs.readFile(target));
    } catch (_) {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ headless: process.env.ISSUE210_HEADFUL !== '1' });
  } catch (error) {
    browserError = error?.message || String(error);
    if (process.env.ISSUE210_REQUIRE_BROWSER) throw error;
  }
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function newFixturePage({ ids, levels = {}, storageSeed = {}, staleFilters = false } = {}) {
  assert.ok(browser, 'Chromium has launched');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(installMockSpeechRecognition, { stateKey: '__issue210Speech' });
  await context.addInitScript(({ fixedNow, levels, storageSeed, staleFilters }) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    }
    Object.defineProperty(window, 'Date', { value: FixedDate, configurable: true });
    let eventSequence = 0;
    window.__issue210Sequence = () => ++eventSequence;
    window.__issue210 = { results: [], writes: {}, permissionCalls: 0, visibilityEvents: [] };
    document.addEventListener('visibilitychange', () => window.__issue210.visibilityEvents.push({ state: document.visibilityState, sequence: window.__issue210Sequence(), at: performance.now() }));
    document.addEventListener('english-pwa:session-result', event => {
      window.__issue210.results.push(JSON.parse(JSON.stringify(event.detail || {})));
    });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      window.__issue210.writes[key] = (window.__issue210.writes[key] || 0) + 1;
      return originalSetItem.call(this, key, value);
    };
    if (window.Notification?.requestPermission) {
      const requestPermission = window.Notification.requestPermission;
      Object.defineProperty(window.Notification, 'requestPermission', {
        configurable: true,
        value: function (...args) {
          window.__issue210.permissionCalls += 1;
          return requestPermission.apply(this, args);
        },
      });
    }
    window.SpeechRecognitionPhrase = class { constructor(phrase, boost) { this.phrase = phrase; this.boost = boost; } };
    const seedKey = '__issue210FixtureSeeded';
    if (sessionStorage.getItem(seedKey) !== 'true') {
      sessionStorage.setItem(seedKey, 'true');
      for (const [key, value] of Object.entries(storageSeed || {})) localStorage.setItem(key, value);
      localStorage.setItem('appConfigV3', JSON.stringify({ studyMode: 'read' }));
      if (Object.keys(levels || {}).length) localStorage.setItem('itemLevelV1', JSON.stringify(levels));
      else if (!storageSeed?.itemLevelV1) localStorage.setItem('itemLevelV1', '{}');
      if (!storageSeed?.studyLogV1) localStorage.setItem('studyLogV1', '{}');
      if (staleFilters) {
        localStorage.setItem('secSel', 'Section23');
        localStorage.setItem('itemSearchV1', 'legacy search term');
        localStorage.setItem('orderSel', 'desc');
        localStorage.setItem('levelFilterV1', JSON.stringify([5]));
      }
    }
  }, { fixedNow: FIXED_NOW, levels, storageSeed, staleFilters });

  const externalRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  await context.route('**/*', async route => {
    const requested = new URL(route.request().url());
    if (requested.origin === baseUrl) return route.continue();
    externalRequests.push(requested.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', request => {
    if (new URL(request.url()).origin !== baseUrl) externalRequests.push(request.url());
  });
  await page.route('**/data/items.json', route => route.fulfill({
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(fixture(ids)),
  }));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => window.ALL_ITEMS?.length
    && typeof window.__RELATIONSHIP_GAME_STATE__ === 'function'
    && document.querySelector('#sessionShellStyles')
    && document.querySelector('#friendshipHero'));
  assert.equal(await page.evaluate(() => window.APP_VERSION), 'v5.110', 'browser fixture uses the P0 finality repair version');
  await page.waitForFunction(() => !document.querySelector('#loadingOverlay')?.classList.contains('show'));
  await page.evaluate(() => { window.__issue210.writes = {}; });
  return { context, page, pageErrors, consoleErrors, externalRequests };
}

async function openOptions(page) {
  await page.locator('#openLearningChoice').click();
  await page.locator('#learningChoiceDialog [data-open-session-options]').click();
  await page.waitForFunction(() => document.querySelector('#playOptionsDialog')?.open === true);
}

async function startManualSession(page, { characterId, skillId = '', section = '', ids }) {
  await openOptions(page);
  if (characterId) await page.locator('#playOptionsCharacter').selectOption(characterId);
  if (skillId) await page.locator('#playOptionsSkill').selectOption(skillId);
  if (section) await page.locator('#playOptionsSection').selectOption(section);
  await page.locator('[data-session-mode="manual"]').click();
  for (const id of ids) await page.locator(`#playOptionsManual input[value="${id}"]`).check();
  const selectedCount = await page.locator('#playOptionsManual input:checked').count();
  assert.equal(selectedCount, ids.length, 'the production options UI retained the selected production item IDs');
  assert.equal(await page.locator('#playOptionsStart').isDisabled(), false);
  await page.locator('#playOptionsStart').click();
  await page.waitForFunction(() => !document.querySelector('#studyView')?.hidden
    && !!document.querySelector('#enText')?.dataset.itemId);
  await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false);
  const firstId = await page.locator('#enText').getAttribute('data-item-id');
  assert.equal(firstId, ids[0], 'manual queue order follows the user selection order');
  return firstId;
}

async function waitForItem(page, id) {
  await page.waitForFunction(expected => !document.querySelector('#studyView')?.hidden
    && document.querySelector('#enText')?.dataset.itemId === expected, id, { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false, null, { timeout: 15_000 });
}

async function beginAttempt(page) {
  await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false);
  await page.locator('#btnMic').click();
  await page.waitForFunction(() => window.__issue210Speech?.latest?.lifecycleState === 'active', null, { timeout: 10_000 });
  return page.evaluate(() => window.__issue210Speech.latest.attemptId);
}

async function injectAndStop(page, candidate, { final = true } = {}) {
  const attemptId = await beginAttempt(page);
  const delivered = await page.evaluate(({ candidate, final }) => {
    const mock = window.__issue210Speech.latest;
    if (final) mock.emitFinal(candidate);
    else mock.emitInterim(candidate);
    const event = [...window.__issue210Speech.events].reverse().find(entry => entry.type === 'result' && entry.attemptId === mock.attemptId);
    return { attemptId: mock.attemptId, event };
  }, { candidate, final });
  // The production recording state uses a pulsing mic button; keep the real UI
  // click while bypassing Playwright's animation-stability wait.
  await page.locator('#btnMic').click({ force: true });
  await page.waitForFunction(attemptId => window.__issue210Speech?.events?.some(entry => entry.attemptId === attemptId
    && (entry.type === 'end' || entry.type === 'duplicate-end'))
    && document.querySelector('#micStatus')?.dataset.state === 'off', delivered.attemptId, { timeout: 10_000 });
  return delivered;
}

async function waitForSrs(page, id, condition = { field: 'updatedAt', op: 'gt', value: 0 }) {
  await page.waitForFunction(({ id, field, op, value }) => {
    try {
      const item = JSON.parse(localStorage.getItem('itemLevelV1') || '{}')[id];
      if (!item) return false;
      const observed = item[field];
      if (op === 'lt') return Number(observed) < value;
      if (op === 'gte') return Number(observed) >= value;
      return observed === value;
    } catch (_) { return false; }
  }, { id, ...condition }, { timeout: 10_000 });
  return page.evaluate(id => JSON.parse(localStorage.getItem('itemLevelV1') || '{}')[id], id);
}

async function storageSnapshot(page) {
  return page.evaluate(() => {
    const parse = key => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch (_) { return null; }
    };
    return {
      itemLevel: parse('itemLevelV1') || {},
      studyLog: parse('studyLogV1') || {},
      recentItems: parse('recentSentenceSessionIdsV1') || [],
      recentCharacters: parse('recentCharacterSessionsV1') || [],
      filters: Object.fromEntries(['secSel', 'itemSearchV1', 'orderSel', 'levelFilterV1'].map(key => [key, localStorage.getItem(key)])),
      writes: { ...window.__issue210.writes },
      resultEvents: window.__issue210.results.length,
      permissionCalls: window.__issue210.permissionCalls,
    };
  });
}

async function relationshipSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__RELATIONSHIP_GAME_STATE__();
    return Object.fromEntries(state.relationships.map(row => [row.id, {
      friendshipPoints: row.friendshipPoints,
      rankOrder: row.rank.order,
      rankId: row.rank.id,
      intimacy: row.intimacy,
    }]));
  });
}

async function relationshipState(page) {
  return page.evaluate(() => {
    const state = window.__RELATIONSHIP_GAME_STATE__();
    const relationships = state.relationships.map(row => ({
      id: row.id, name: row.name, friendshipPoints: row.friendshipPoints,
      maxFriendshipPoints: row.maxFriendshipPoints,
      rank: { id: row.rank.id, label: row.rank.label, order: row.rank.order },
      intimacy: row.intimacy, intimacyStatus: { label: row.intimacyStatus?.label || '' },
      total: row.total, started: row.started, mastered: row.mastered, stable: row.stable,
    }));
    return { relationships, activeCharacterId: state.activeCharacterId, world: state.world };
  });
}

function resultDomSnapshot(page) {
  return page.evaluate(() => {
    const view = document.querySelector('#reviewCompleteView');
    const notices = [...(view?.querySelectorAll('.friendship-review__notice') || [])].map(node => node.textContent.trim());
    const stats = [...(view?.querySelectorAll('.friendship-review__stat strong') || [])].map(node => node.textContent.trim());
    return {
      title: view?.querySelector('h2')?.textContent.trim() || '',
      message: document.querySelector('#reviewCompleteMessage')?.textContent.trim() || '',
      headline: view?.querySelector('.friendship-review__headline')?.textContent.trim() || '',
      rank: view?.querySelector('.friendship-review__rank')?.textContent.trim() || '',
      rankUp: view?.querySelector('.friendship-review__rank')?.dataset.rankUp === 'true',
      stats,
      intimacy: view?.querySelector('.friendship-review__relation-head strong')?.textContent.trim() || '',
      intimacyChange: view?.querySelector('.friendship-review__change')?.textContent.trim() || '',
      notices,
      continueLabel: document.querySelector('#reviewActionContinue')?.textContent.trim() || '',
      finishLabel: document.querySelector('#reviewActionFinish')?.textContent.trim() || '',
    };
  });
}

async function verifyResult(page, { beforeSnapshot, activeCharacterId, milestonesBefore = {} }) {
  await page.waitForFunction(() => {
    const view = document.querySelector('#reviewCompleteView');
    const summary = window.__issue210?.results?.at(-1);
    const stats = [...(view?.querySelectorAll('.friendship-review__stat strong') || [])].map(node => node.textContent.trim());
    const conversations = Math.max(0, Number(summary?.conversationCount ?? summary?.cardsDone) || 0);
    const revisits = Math.max(0, Number(summary?.retryConversationCount) || 0);
    return !!view && !view.hidden && !!view.querySelector('#friendshipReview') && !!summary
      && stats[0] === String(conversations) && stats[1] === String(revisits);
  }, null, { timeout: 15_000 });
  const [screen, after, snapshot] = await Promise.all([
    resultDomSnapshot(page),
    relationshipState(page),
    storageSnapshot(page),
  ]);
  const summary = await page.evaluate(() => window.__issue210.results.at(-1));
  const closure = snapshot.studyLog[FIXED_DAY]?.session_closure;
  assert.ok(closure, 'normal session finalization persisted session_closure');
  const { updatedAt, ...closureSummary } = closure;
  assert.equal(updatedAt, new Date(FIXED_NOW).toISOString());
  assert.deepEqual(closureSummary, summary, 'result event metrics reconcile with persisted session_closure');
  assert.equal(summary.reason, 'completed');
  assert.equal(activeCharacterId, after.activeCharacterId);

  const freshMilestones = reachedMilestones(after.world).filter(item => !milestonesBefore[item.id]);
  const expected = buildExchangeResult({
    beforeSnapshot,
    relationships: after.relationships,
    activeCharacterId,
    summary,
    freshMilestones,
  });
  const expectedRank = expected.rankUp
    ? `${expected.rankBefore.label} → ${expected.rankAfter.label}`
    : expected.rankAfter.label;
  assert.equal(screen.title, expected.title);
  assert.equal(screen.headline, expected.headline);
  assert.equal(screen.rank, expectedRank);
  assert.equal(screen.rankUp, expected.rankUp);
  assert.deepEqual(screen.stats, [String(expected.conversationCount), String(expected.revisitCount)]);
  assert.equal(screen.intimacy, String(Math.round(expected.intimacyAfter)));
  assert.equal(screen.intimacyChange,
    `きょうの変化 ${Math.round(expected.intimacyBefore)} → ${Math.round(expected.intimacyAfter)} · ${expected.relationship.intimacyStatus?.label || ''}`);
  assert.deepEqual(screen.notices, expected.notices.map(notice => notice.text));
  assert.equal(screen.continueLabel, expected.primaryAction === 'continue' ? expected.primaryLabel : expected.secondaryLabel);
  assert.equal(screen.finishLabel, expected.primaryAction === 'finish' ? expected.primaryLabel : expected.secondaryLabel);
  assert.match(screen.message, new RegExp(`失敗率${Math.round(summary.failRate * 100)}%`));
  return { screen, summary, closure, relationships: after.relationships, model: expected, storage: snapshot };
}

async function assertQuietBrowser(t, fixturePage) {
  const final = await storageSnapshot(fixturePage.page);
  assert.deepEqual(fixturePage.externalRequests, [], 'browser made no external requests');
  assert.deepEqual(fixturePage.pageErrors, [], 'production UI reported no uncaught page errors');
  assert.equal(final.permissionCalls, 0, 'no notification permission request was made');
  t.diagnostic(`[issue210-browser] ${JSON.stringify({ externalRequests: fixturePage.externalRequests, pageErrors: fixturePage.pageErrors, permissionCalls: final.permissionCalls })}`);
}

async function auditDiagnostic(t, page, scenario, evidence) {
  const appVersion = await page.evaluate(() => window.APP_VERSION);
  t.diagnostic(`[issue210-${scenario}] ${JSON.stringify({ sourceSha: INITIAL_MAIN_SHA, appVersion, ...evidence })}`);
}

browserTest('Issue 210 success: real Read scoring, SRS, relationship, result rerender, continue, finish, and reload', async t => {
  const levels = {
    E0006: srsSeed({ level: 2, dueAt: FIXED_NOW - 12 * HOUR, intervalMs: 12 * HOUR }),
    E0007: srsSeed({ level: 3, history: [FIXED_NOW - 2 * DAY, FIXED_NOW - DAY], dueAt: FIXED_NOW - HOUR }),
  };
  const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007', 'E0035'], levels });
  const { context, page } = fixturePage;
  try {
    const beforeSnapshot = await relationshipSnapshot(page);
    const milestonesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('relationshipMilestonesV1') || '{}'));
    assert.equal((await storageSnapshot(page)).writes.itemLevelV1 || 0, 0, 'home display and options inspection do not write SRS');
    await startManualSession(page, { characterId: 'bob', section: 'Section1', ids: ['E0006', 'E0007'] });
    assert.deepEqual(await storageSnapshot(page).then(value => value.recentItems), ['E0006', 'E0007']);

    const srsBeforeFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('itemLevelV1') || '{}').E0006);
    const first = await injectAndStop(page, itemsById.get('E0006').en);
    assertRecognitionEvidence(first, itemsById.get('E0006').en, true);
    const afterFirst = await waitForSrs(page, 'E0006', { field: 'lastMatch', op: 'eq', value: 1 });
    assert.equal(afterFirst.last, 2, 'existing promotion interval rules retain the current level when higher-rank evidence is not yet qualified');
    assert.equal(afterFirst.best, 2);
    assert.equal(afterFirst.updatedAt, FIXED_NOW);
    assert.ok(afterFirst.review.nextDueAt > FIXED_NOW);
    assert.equal(afterFirst.noHintHistory.at(-1), FIXED_NOW);
    assert.notDeepEqual(afterFirst.review, srsBeforeFirst.review, 'due SRS review state advanced after a real successful Read grade');
    const firstWriteCount = (await storageSnapshot(page)).writes.itemLevelV1;
    assert.equal(firstWriteCount, 1, 'one finalized attempt caused one itemLevelV1 write');
    await page.evaluate(transcript => {
      const mock = window.__issue210Speech.latest;
      mock.emitEnd();
      mock.emitFinal(transcript);
      mock.emitEnd();
    }, itemsById.get('E0006').en);
    assert.equal((await storageSnapshot(page)).writes.itemLevelV1, firstWriteCount, 'duplicate final and terminal callbacks did not write SRS again');
    assert.equal((await storageSnapshot(page)).studyLog[FIXED_DAY].passes, 1);

    await waitForItem(page, 'E0007');
    const srsBeforeSecond = await page.evaluate(() => JSON.parse(localStorage.getItem('itemLevelV1') || '{}').E0007);
    const second = await injectAndStop(page, itemsById.get('E0007').en);
    assertRecognitionEvidence(second, itemsById.get('E0007').en, true);
    const afterSecond = await waitForSrs(page, 'E0007', { field: 'lastMatch', op: 'eq', value: 1 });
    assert.equal(afterSecond.last, 5, 'three properly spaced exact no-hint passes satisfy the existing Lv5 promotion gate');
    assert.equal(afterSecond.best, 5);
    assert.equal(afterSecond.noHintHistory.at(-1), FIXED_NOW);
    assert.ok(afterSecond.review.nextDueAt >= FIXED_NOW + DAY, 'perfect no-hint review schedules at least the current SRS 24-hour minimum');
    assert.ok(srsBeforeSecond.review.nextDueAt <= FIXED_NOW);
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && document.querySelector('#reviewCompleteView h2')?.textContent === '今日の交流結果', null, { timeout: 15_000 });
    const activeCharacterId = await page.evaluate(() => window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__);
    assert.equal(activeCharacterId, 'bob');
    const firstResult = await verifyResult(page, { beforeSnapshot, activeCharacterId, milestonesBefore });
    assert.equal(firstResult.summary.conversationCount, 2);
    assert.equal(firstResult.summary.retryConversationCount, 0);
    assert.equal(firstResult.summary.failRate, 0);
    assert.equal(firstResult.summary.cardsDone, 2);
    assert.equal(firstResult.storage.studyLog[FIXED_DAY].passes, 2);
    const beforeRerender = await storageSnapshot(page);
    const beforeResultDom = await resultDomSnapshot(page);
    await page.locator('.friendship-review__details summary').click();
    await page.locator('.friendship-review__details summary').click();
    await page.evaluate(() => {
      const view = document.querySelector('#reviewCompleteView');
      view.hidden = true;
      view.hidden = false;
    });
    await page.waitForFunction(() => !!document.querySelector('#friendshipReview'), null, { timeout: 5_000 });
    assert.deepEqual(await storageSnapshot(page), beforeRerender, 'result details and production view re-render do not change SRS, study log, or result-event count');
    assert.deepEqual(await resultDomSnapshot(page), beforeResultDom, 're-render preserves rank, intimacy, counts, notices, and actions');

    const beforeSecondSession = await relationshipSnapshot(page);
    const milestonesBeforeSecond = await page.evaluate(() => JSON.parse(localStorage.getItem('relationshipMilestonesV1') || '{}'));
    const writesBeforeContinue = (await storageSnapshot(page)).writes.studyLogV1;
    await page.locator('#reviewActionContinue').click();
    await page.waitForFunction(() => !document.querySelector('#studyView')?.hidden
      && document.querySelector('#enText')?.dataset.itemId === 'E0035', null, { timeout: 15_000 });
    assert.equal((await storageSnapshot(page)).studyLog[FIXED_DAY].session_closure.reason, 'completed');
    assert.equal((await storageSnapshot(page)).writes.studyLogV1, writesBeforeContinue, 'continue starts a new plan without re-closing or rewriting the previous summary');
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false);
    const third = await injectAndStop(page, itemsById.get('E0035').en);
    assertRecognitionEvidence(third, itemsById.get('E0035').en, true);
    const afterThird = await waitForSrs(page, 'E0035', { field: 'lastMatch', op: 'eq', value: 1 });
    assert.equal(afterThird.updatedAt, FIXED_NOW);
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && !!document.querySelector('#friendshipReview'), null, { timeout: 15_000 });
    const secondResult = await verifyResult(page, {
      beforeSnapshot: beforeSecondSession,
      activeCharacterId,
      milestonesBefore: milestonesBeforeSecond,
    });
    assert.equal(secondResult.summary.conversationCount, 1);
    const finishedStorage = await storageSnapshot(page);
    await page.locator('#reviewActionFinish').click();
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && document.querySelector('#studyView')?.hidden
      && document.querySelector('#reviewCompleteView')?.hidden);
    assert.equal((await storageSnapshot(page)).studyLog[FIXED_DAY].session_closure.reason, 'completed');
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && typeof window.__RELATIONSHIP_GAME_STATE__ === 'function');
    const afterReload = await storageSnapshot(page);
    assert.deepEqual(afterReload.itemLevel, finishedStorage.itemLevel, 'SRS state survives browser refresh');
    assert.deepEqual(afterReload.studyLog, finishedStorage.studyLog, 'passes and the final completed-session closure survive browser refresh');
    assert.deepEqual(afterReload.recentItems, finishedStorage.recentItems);
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'success', { itemIds: ['E0006', 'E0007', 'E0035'], asr: [first.event, second.event, third.event], beforeSrs: { E0006: srsBeforeFirst, E0007: srsBeforeSecond }, afterSrs: { E0006: afterFirst, E0007: afterSecond, E0035: afterThird }, beforeRelationships: beforeSnapshot, firstResult: firstResult.screen, secondResult: secondResult.screen, closure: secondResult.closure });
  } finally {
    await context.close();
  }
});

function assertRecognitionEvidence(delivery, transcript, isFinal) {
  assert.ok(delivery.attemptId > 0, 'ASR boundary delivery is tied to an attemptId');
  assert.equal(delivery.event.primaryTranscript, transcript);
  assert.equal(delivery.event.recognitionSegmentIndex, 0);
  assert.equal(delivery.event.isFinal, isFinal);
  assert.equal(delivery.event.recognitionComplete, false, 'provider result remains pending until its terminal callback');
  assert.equal(delivery.event.completionState, 'pending');
  assert.deepEqual(delivery.event.recognitionSegments.map(segment => segment.segmentIndex), [0]);
  assert.deepEqual(delivery.event.recognitionSegments[0].alternatives, delivery.event.rankedAlternatives);
  assert.deepEqual(delivery.event.rankedAlternatives.map(candidate => candidate.asrRank), [0]);
}

browserTest('Issue 210 failure/correction: N-best and later attempts stay separate; technical and correction attempts do not create PASS history', async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    const beforeSnapshot = await relationshipSnapshot(page);
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(page);
    const errorAttemptId = await beginAttempt(page);
    await page.evaluate(() => window.__issue210Speech.latest.injectError('network'));
    await page.waitForFunction(() => window.__issue210Speech?.events?.some(event => event.type === 'error' && event.error === 'network')
      && document.querySelector('#micStatus')?.dataset.state === 'off');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let snapshot = await storageSnapshot(page);
    assert.equal(snapshot.writes.itemLevelV1 || 0, before.writes.itemLevelV1 || 0, 'technical ASR error has no SRS write');
    assert.equal(snapshot.studyLog[FIXED_DAY]?.passes || 0, 0, 'technical ASR error creates no pass log');

    const silentAttemptId = await beginAttempt(page);
    await page.locator('#btnMic').click({ force: true });
    await page.waitForFunction(attemptId => window.__issue210Speech?.events?.some(event => event.type === 'end' && event.attemptId === attemptId)
      && document.querySelector('#micStatus')?.dataset.state === 'off', silentAttemptId, { timeout: 10_000 });
    const afterSilence = await storageSnapshot(page);
    assert.deepEqual(afterSilence.itemLevel, before.itemLevel, 'silence cannot create an SRS record');
    assert.equal(afterSilence.writes.itemLevelV1 || 0, before.writes.itemLevelV1 || 0, 'silence has no SRS write');
    assert.equal(afterSilence.studyLog[FIXED_DAY]?.passes || 0, 0, 'silence cannot create a pass-log entry');

    const split = await injectAndStop(page, ['He leaned against', 'gazed at the Statue of Liberty']);
    assert.notEqual(split.attemptId, errorAttemptId);
    assert.notEqual(split.attemptId, silentAttemptId);
    assert.equal(split.event.isFinal, true);
    assert.deepEqual(split.event.rankedAlternatives.map(candidate => candidate.asrRank), [0, 1]);
    assert.ok(split.event.rankedAlternatives.every(candidate => candidate.transcript !== itemsById.get('E0006').en));
    const failed = await waitForSrs(page, 'E0006', { field: 'lastMatch', op: 'lt', value: 0.7 });
    assert.equal(failed.lastMatch < 0.7, true, 'neither incomplete N-best rank was combined into a passing sentence');
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'), 'E0006', 'failed speech stays on the original item for correction');
    assert.equal((await storageSnapshot(page)).studyLog[FIXED_DAY]?.passes || 0, 0);
    const afterOriginalFail = await storageSnapshot(page);

    const correctionInterim = await injectAndStop(page, itemsById.get('E0006').en, { final: false });
    assert.notEqual(correctionInterim.attemptId, split.attemptId, 'interim correction is a separate attempt');
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false, null, { timeout: 10_000 });
    const afterCorrectionInterim = await storageSnapshot(page);
    assert.deepEqual(afterCorrectionInterim.itemLevel, afterOriginalFail.itemLevel,
      'interim-only exact Correction speech cannot update the original SRS failure');
    assert.deepEqual(afterCorrectionInterim.studyLog, afterOriginalFail.studyLog,
      'interim-only Correction speech cannot change pass or study history');
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'), 'E0006',
      'interim-only Correction speech cannot advance the session');
    assert.equal(await page.locator('#reviewCompleteView').isHidden(), true,
      'interim-only Correction speech cannot complete correction or show the result screen');
    assert.equal(await page.locator('#valMatch').textContent(), '—',
      'an interim correction cannot remain as a final score');

    const correctionFailure = await injectAndStop(page, 'gazed at the Statue of Liberty');
    assert.notEqual(correctionFailure.attemptId, split.attemptId, 'correction uses a new recognizer attempt');
    assert.equal(correctionFailure.event.isFinal, true);
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false, null, { timeout: 10_000 });
    const afterCorrectionFail = await storageSnapshot(page);
    assert.deepEqual(afterCorrectionFail.itemLevel, afterOriginalFail.itemLevel, 'failed correction practice does not change the original failure SRS record');
    assert.equal(afterCorrectionFail.studyLog[FIXED_DAY]?.passes || 0, 0);
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'), 'E0006');

    const correctionSuccess = await injectAndStop(page, itemsById.get('E0006').en);
    assert.notEqual(correctionSuccess.attemptId, correctionFailure.attemptId, 'correction retry uses another distinct attempt');
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && !!document.querySelector('#friendshipReview'), null, { timeout: 15_000 });
    snapshot = await storageSnapshot(page);
    assert.deepEqual(snapshot.itemLevel, afterOriginalFail.itemLevel, 'correction success cannot rewrite the original SRS failure');
    assert.equal(snapshot.studyLog[FIXED_DAY]?.passes || 0, 0, 'correction success does not add a pass to studyLogV1');
    const activeCharacterId = 'bob';
    assert.equal(await page.evaluate(() => window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__), activeCharacterId);
    const result = await verifyResult(page, { beforeSnapshot, activeCharacterId });
    assert.equal(result.summary.cardsDone, 0);
    assert.equal(result.summary.conversationCount, 1);
    assert.equal(result.summary.retryConversationCount, 1);
    assert.equal(result.summary.failRate, 1);
    assert.equal(result.summary.attempts, 1, 'correction practice is not counted as another graded conversation attempt');
    assert.equal(result.summary.reason, 'completed');
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'correction', { itemId: 'E0006', technicalAttemptId: errorAttemptId, splitNbest: split.event, originalFailure: failed, correctionInterim: correctionInterim.event, afterCorrectionInterim: afterCorrectionInterim.itemLevel.E0006, correctionFailure: correctionFailure.event, correctionSuccess: correctionSuccess.event, afterOriginalFail: afterOriginalFail.itemLevel.E0006, afterCorrection: snapshot.itemLevel.E0006, result: result.screen, closure: result.closure });
  } finally {
    await context.close();
  }
});

browserTest('Issue 210 interim negative control: an interim-only exact transcript cannot update SRS or pass', async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(page);
    const assertNoGrade = async label => {
      const after=await storageSnapshot(page);
      assert.deepEqual(after.itemLevel,before.itemLevel,`${label}: every SRS field remains unchanged`);
      assert.equal(after.studyLog[FIXED_DAY]?.passes||0,before.studyLog[FIXED_DAY]?.passes||0,`${label}: no pass log`);
      assert.equal(after.studyLog[FIXED_DAY]?.no_hint||0,before.studyLog[FIXED_DAY]?.no_hint||0,`${label}: no no-hint log`);
      assert.equal(after.writes.itemLevelV1||0,before.writes.itemLevelV1||0,`${label}: no SRS storage write`);
      assert.equal(after.writes.studyLogV1||0,before.writes.studyLogV1||0,`${label}: no study-log storage write`);
      assert.equal(await page.locator('#valMatch').textContent(),'—',`${label}: no final score`);
      assert.equal(await page.locator('#transcript').textContent(),'',`${label}: no interim preview remains as a committed transcript`);
      assert.equal(await page.locator('#enText').getAttribute('data-item-id'),'E0006',`${label}: no automatic card advance`);
      assert.equal(await page.locator('#reviewCompleteView').isHidden(),true,`${label}: no result screen`);
      return after;
    };
    const interim = await injectAndStop(page, itemsById.get('E0006').en, { final: false });
    assert.equal(interim.event.isFinal, false);
    assert.equal(interim.event.recognitionComplete, false);
    const afterInterim=await assertNoGrade('interim-only primary');
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false, null, { timeout: 10_000 });

    const interimNbest=await injectAndStop(page,['a different transcript',itemsById.get('E0006').en],{final:false});
    assert.equal(interimNbest.event.isFinal,false);
    assert.equal(interimNbest.event.alternatives[1],itemsById.get('E0006').en,'rank-one interim N-best contains the exact target');
    assert.notEqual(interimNbest.attemptId,interim.attemptId,'interim N-best control is a fresh attempt');
    const afterInterimNbest=await assertNoGrade('interim-only matching N-best');
    await auditDiagnostic(t, page, 'interim', { itemId: 'E0006', rawInput: interim.event,
      rawNbestInput:interimNbest.event,beforeSrs:before.itemLevel.E0006||null,
      afterInterimSrs:afterInterim.itemLevel.E0006||null,afterNbestSrs:afterInterimNbest.itemLevel.E0006||null,
      studyLog:afterInterimNbest.studyLog[FIXED_DAY]||null });
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false, null, { timeout: 10_000 });

    const finalized = await injectAndStop(page, itemsById.get('E0006').en, { final: true });
    assert.notEqual(finalized.attemptId, interim.attemptId, 'retry creates a new recognition attempt');
    assert.equal(finalized.event.isFinal, true);
    const accepted = await waitForSrs(page, 'E0006', { field: 'lastMatch', op: 'gte', value: 0.99 });
    const afterFinal = await storageSnapshot(page);
    assert.equal(accepted.lastMatch, 1, 'a normally finalized exact answer still passes');
    assert.equal(accepted.level5Count, 1, 'a normally finalized no-hint pass retains level promotion');
    assert.deepEqual(accepted.noHintHistory, [FIXED_NOW], 'a finalized no-hint pass records its history once');
    assert.equal(accepted.review.nextDueAt, FIXED_NOW + DAY, 'a finalized pass retains the normal review interval');
    assert.equal(afterFinal.studyLog[FIXED_DAY]?.passes, 1, 'a finalized answer increments the pass log');
    assert.equal(afterFinal.studyLog[FIXED_DAY]?.no_hint, 1, 'a finalized answer increments no-hint history');
    assert.equal(afterFinal.writes.itemLevelV1, 1, 'one finalized attempt causes one SRS write');
    assert.equal(afterFinal.writes.studyLogV1, 1, 'one finalized attempt causes one study-log write');
    assert.equal(await page.locator('#transcript .interim').count(),0,'final segment display is not left in interim preview styling');
    await assertQuietBrowser(t, fixturePage);
  } finally {
    await context.close();
  }
});

browserTest('Issue 342 interim-only automatic provider end remains NO GRADE',async t=>{
  const fixturePage=await newFixturePage({ids:['E0006']});
  const {context,page}=fixturePage;
  try{
    await startManualSession(page,{characterId:'bob',ids:['E0006']});
    const before=await storageSnapshot(page);
    const attemptId=await beginAttempt(page);
    const interim=await page.evaluate(transcript=>{
      const mock=window.__issue210Speech.latest;
      mock.emitInterim(transcript);
      const event=[...window.__issue210Speech.events].reverse().find(entry=>entry.type==='result'&&entry.attemptId===mock.attemptId);
      mock.emitEnd();
      return {attemptId:mock.attemptId,event};
    },itemsById.get('E0006').en);
    assert.equal(interim.attemptId,attemptId);
    assert.equal(interim.event.isFinal,false);
    await page.waitForFunction(()=>document.querySelector('#micStatus')?.dataset.state==='off'
      &&document.querySelector('#btnMic')?.disabled===false, null,{timeout:10_000});
    const after=await storageSnapshot(page);
    assert.deepEqual(after.itemLevel,before.itemLevel,'automatic end after exact interim speech leaves SRS unchanged');
    assert.deepEqual(after.studyLog,before.studyLog,'automatic end after exact interim speech leaves the pass log unchanged');
    assert.equal(after.writes.itemLevelV1||0,before.writes.itemLevelV1||0);
    assert.equal(after.writes.studyLogV1||0,before.writes.studyLogV1||0);
    assert.equal(await page.locator('#valMatch').textContent(),'—');
    assert.equal(await page.locator('#transcript').textContent(),'');
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'),'E0006');
    assert.equal(await page.locator('#reviewCompleteView').isHidden(),true);
    await assertQuietBrowser(t,fixturePage);
  }finally{await context.close();}
});

browserTest('Issue 210 interruption/options: persist completed card, exclude unanswered card, clear temporary filters and old queue on normal launch', async t => {
  const staleLevels = {};
  const fixturePage = await newFixturePage({
    ids: ['E0554', 'E0556', 'E0037', 'E0212'],
    levels: staleLevels,
    staleFilters: true,
  });
  const { context, page } = fixturePage;
  try {
    await openOptions(page);
    await page.locator('#playOptionsCharacter').selectOption('bob');
    await page.locator('#playOptionsSkill').selectOption('grammar:future_will');
    await page.locator('#playOptionsSection').selectOption('Section19');
    await page.locator('[data-session-mode="manual"]').click();
    assert.equal(await page.locator('#playOptionsStart').isDisabled(), true, 'a zero-candidate character/grammar/section combination cannot start');
    assert.match(await page.locator('#playOptionsSummary').textContent(), /対象 0文/);
    assert.ok(await page.locator('#playOptionsCauses .play-options__cause').count() > 0);
    await page.locator('#playOptionsCauses .play-options__cause').filter({ hasText: 'チャプターを解除' }).click();
    await page.locator('#playOptionsSection').selectOption('Section45');
    for (const id of ['E0554', 'E0556']) await page.locator(`#playOptionsManual input[value="${id}"]`).check();
    assert.equal(await page.locator('#playOptionsManual input:checked').count(), 2);
    await page.locator('#playOptionsStart').click();
    await page.waitForFunction(() => !document.querySelector('#studyView')?.hidden
      && document.querySelector('#enText')?.dataset.itemId === 'E0554');
    await page.waitForFunction(() => document.querySelector('#btnMic')?.disabled === false);
    const pass = await injectAndStop(page, itemsById.get('E0554').en);
    assertRecognitionEvidence(pass, itemsById.get('E0554').en, true);
    const completedSrs = await waitForSrs(page, 'E0554', { field: 'lastMatch', op: 'eq', value: 1 });
    await waitForItem(page, 'E0556');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('itemLevelV1') || '{}').E0556 || null), null,
      'the next unanswered item has no SRS entry');
    await page.locator('#learningHomeReturn').click();
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && document.querySelector('#studyView')?.hidden
      && document.querySelector('#reviewCompleteView')?.hidden);
    let afterExit = await storageSnapshot(page);
    assert.equal(afterExit.studyLog[FIXED_DAY].session_closure.reason, 'idle', 'the existing home-return path finalizes as idle');
    assert.equal(afterExit.studyLog[FIXED_DAY].session_closure.cardsDone, 1);
    assert.equal(afterExit.studyLog[FIXED_DAY].session_closure.conversationCount, 1);
    assert.equal(afterExit.resultEvents, 0, 'interrupted session does not show the normal completion result screen');
    assert.equal(afterExit.itemLevel.E0554.lastMatch, 1);
    assert.equal(afterExit.itemLevel.E0556, undefined);
    assert.deepEqual(afterExit.recentItems, ['E0554', 'E0556']);
    assert.deepEqual(afterExit.filters, {
      secSel: '', itemSearchV1: '', orderSel: 'asc', levelFilterV1: '[0,1,2,3,4,5]',
    }, 'focused session clears old section/search/order/level filters');

    await openOptions(page);
    assert.equal(await page.locator('#playOptionsCharacter').inputValue(), 'bob', 'the selected character is retained for the next options visit');
    assert.equal(await page.locator('#playOptionsSkill').inputValue(), '');
    assert.equal(await page.locator('#playOptionsSection').inputValue(), '');
    assert.equal(await page.locator('[data-session-mode="auto"]').getAttribute('class').then(value => value.includes('is-active')), true);
    await page.locator('[data-session-mode="manual"]').click();
    assert.equal(await page.locator('#playOptionsManual input:checked').count(), 0, 'temporary manual item IDs are reset');
    await page.locator('#playOptionsDialog .focus-sheet__close').click();

    const beforeReload = await storageSnapshot(page);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && typeof window.__RELATIONSHIP_GAME_STATE__ === 'function');
    const afterReload = await storageSnapshot(page);
    assert.deepEqual(afterReload.itemLevel, beforeReload.itemLevel, 'interruption preserves committed SRS through refresh');
    assert.deepEqual(afterReload.studyLog, beforeReload.studyLog, 'interruption closure persists through refresh');
    assert.deepEqual(afterReload.recentItems, beforeReload.recentItems);

    const persisted = await page.evaluate(() => Object.fromEntries([
      'itemLevelV1', 'studyLogV1', 'recentSentenceSessionIdsV1', 'recentCharacterSessionsV1',
      'secSel', 'itemSearchV1', 'orderSel', 'levelFilterV1',
    ].map(key => [key, localStorage.getItem(key)])));
    const migrated = await newFixturePage({ ids: ['E0554', 'E0556', 'E0037', 'E0212'], storageSeed: persisted });
    try {
      const migratedState = await storageSnapshot(migrated.page);
      assert.deepEqual(migratedState.itemLevel, afterReload.itemLevel);
      assert.deepEqual(migratedState.studyLog, afterReload.studyLog);
      assert.deepEqual(migratedState.recentItems, afterReload.recentItems);
      await migrated.page.locator('#openLearningChoice').click();
      await migrated.page.locator('#learningChoiceDialog [data-course="explore"]').click();
      await migrated.page.locator('#learningChoiceDialog .learning-choice__start').click();
      await migrated.page.waitForFunction(() => document.querySelector('#focusExploreDialog')?.open === true);
      await migrated.page.locator('#secSel').selectOption('Section45');
      await migrated.page.locator('#rangeSearch').fill('issue210-no-range-match');
      assert.match(await migrated.page.locator('#exploreCount').textContent(), /0文/);
      await migrated.page.locator('#focusExploreDialog .focus-sheet__close').click();
      await migrated.page.waitForFunction(() => document.querySelector('#focusExploreDialog')?.open !== true
        && !document.querySelector('#homeView')?.hidden, null, { timeout: 5_000 });
      await migrated.page.locator('.friendship-hero__cta').click();
      await migrated.page.waitForFunction(() => !document.querySelector('#studyView')?.hidden
        && !!document.querySelector('#enText')?.dataset.itemId, null, { timeout: 15_000 });
      const normalId = await migrated.page.locator('#enText').getAttribute('data-item-id');
      assert.ok(!['E0554', 'E0556'].includes(normalId), `normal CTA did not reuse custom session item ${normalId}`);
      assert.equal(await migrated.page.locator('#secSel').inputValue(), '');
      assert.equal(await migrated.page.locator('#rangeSearch').inputValue(), '');
      assert.equal(await migrated.page.locator('#orderSel').inputValue(), 'asc');
      await assertQuietBrowser(t, migrated);
    } finally {
      await migrated.context.close();
    }
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'interrupted-options', { itemIds: ['E0554', 'E0556'], input: pass.event, completedSrs, afterInterruption: afterExit, afterReload: { itemLevel: afterReload.itemLevel, studyLog: afterReload.studyLog, recentItems: afterReload.recentItems }, normalCtaItemId: 'validated-not-E0554-or-E0556' });
  } finally {
    await context.close();
  }
});

browserTest('Issue 210 shared speaker: one finalized shared item advances Bob and Jane from existing proficiency and reconciles the result', async t => {
  const levels = {
    E0001: srsSeed({ level: 1, dueAt: FIXED_NOW + DAY }),
    E0006: srsSeed({ level: 2, dueAt: FIXED_NOW + DAY }),
    E0037: srsSeed({ level: 2, dueAt: FIXED_NOW + DAY }),
    E0212: srsSeed({ level: 3, history: [FIXED_NOW - 2 * DAY, FIXED_NOW - DAY], dueAt: FIXED_NOW - HOUR }),
  };
  const fixturePage = await newFixturePage({ ids: ['E0001', 'E0006', 'E0037', 'E0212'], levels });
  const { context, page } = fixturePage;
  try {
    const beforeSnapshot = await relationshipSnapshot(page);
    const milestonesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('relationshipMilestonesV1') || '{}'));
    const shared = itemsById.get('E0212');
    const speakers = [...new Set(shared.speaker_tags.map(tag => tag.id))];
    assert.deepEqual(speakers, ['bob', 'jane']);
    assert.equal((await storageSnapshot(page)).writes.itemLevelV1 || 0, 0);
    await startManualSession(page, { characterId: 'jane', ids: ['E0212'] });
    const input = await injectAndStop(page, shared.en);
    assertRecognitionEvidence(input, shared.en, true);
    const afterSrs = await waitForSrs(page, 'E0212', { field: 'lastMatch', op: 'eq', value: 1 });
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && !!document.querySelector('#friendshipReview'), null, { timeout: 15_000 });
    assert.equal(afterSrs.last, 5, 'seeded spaced no-hint history satisfies the production Lv5 promotion rule');
    const afterSnapshot = await relationshipSnapshot(page);
    assert.equal(afterSnapshot.jane.rankId, 'close_friend');
    assert.equal(afterSnapshot.bob.rankId, 'close_friend');
    assert.ok(afterSnapshot.jane.friendshipPoints > beforeSnapshot.jane.friendshipPoints);
    assert.ok(afterSnapshot.bob.friendshipPoints > beforeSnapshot.bob.friendshipPoints);
    assert.ok(afterSnapshot.jane.intimacy > beforeSnapshot.jane.intimacy);
    assert.ok(afterSnapshot.bob.intimacy > beforeSnapshot.bob.intimacy);
    assert.deepEqual(afterSnapshot.ken, beforeSnapshot.ken, 'unrelated Ken remains unchanged');
    assert.ok(afterSnapshot.jane.intimacy <= 89 && afterSnapshot.bob.intimacy <= 89, 'rank intimacy caps are respected');
    const activeCharacterId = await page.evaluate(() => window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__);
    const result = await verifyResult(page, { beforeSnapshot, activeCharacterId, milestonesBefore });
    assert.equal(result.summary.conversationCount, 1);
    assert.ok(result.screen.notices.some(text => /Bobとの関係も進んだ/.test(text)), 'result notifies the second shared speaker');
    assert.ok(result.screen.notices.some(text => /Janeと仲良しになった/.test(text)), 'result reports the active speaker rank-up');
    assert.equal(await page.evaluate(() => localStorage.getItem('friendshipPointsV1')), null, 'no separate friendship-points currency is persisted');
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'shared', { itemId: 'E0212', speakers, beforeSrs: levels.E0212, afterSrs, beforeRelationships: beforeSnapshot, afterRelationships: afterSnapshot, result: result.screen });
  } finally {
    await context.close();
  }
});

browserTest('Issue 210 result milestone: a real rank transition produces the production 5-friends notice', async t => {
  const levels = {
    E0001: srsSeed({ level: 2, dueAt: FIXED_NOW + DAY }),
    E0010: srsSeed({ level: 2, dueAt: FIXED_NOW + DAY }),
    E0016: srsSeed({ level: 2, dueAt: FIXED_NOW + DAY }),
    E0212: srsSeed({ level: 1, history: [FIXED_NOW - 2 * DAY, FIXED_NOW - DAY], dueAt: FIXED_NOW - HOUR }),
  };
  const fixturePage = await newFixturePage({ ids: ['E0001', 'E0010', 'E0016', 'E0212'], levels });
  const { context, page } = fixturePage;
  try {
    const beforeSnapshot = await relationshipSnapshot(page);
    const milestonesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('relationshipMilestonesV1') || '{}'));
    const beforeState = await relationshipState(page);
    assert.equal(beforeState.world.friendCount, 3);
    assert.equal(milestonesBefore.friends_5, undefined);
    await startManualSession(page, { characterId: 'jane', ids: ['E0212'] });
    const input = await injectAndStop(page, itemsById.get('E0212').en);
    assertRecognitionEvidence(input, itemsById.get('E0212').en, true);
    const afterSrs = await waitForSrs(page, 'E0212', { field: 'lastMatch', op: 'eq', value: 1 });
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && !!document.querySelector('#friendshipReview'), null, { timeout: 15_000 });
    assert.equal(afterSrs.last, 5);
    const activeCharacterId = await page.evaluate(() => window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__);
    const result = await verifyResult(page, { beforeSnapshot, activeCharacterId, milestonesBefore });
    assert.equal(result.model.rankBefore.id, 'acquaintance');
    assert.equal(result.model.rankAfter.id, 'best_friend');
    assert.ok(result.screen.notices.some(text => text.includes('5人と友達を達成')));
    assert.ok(result.screen.notices.some(text => text.includes('Janeと親友になった')));
    assert.deepEqual([...new Set(itemsById.get('E0212').speaker_tags.map(tag => tag.id))], ['bob', 'jane']);
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'milestone', { itemIds: ['E0001', 'E0010', 'E0016', 'E0212'], input: input.event, beforeRelationships: beforeSnapshot, afterSrs, result: result.screen, closure: result.closure });
  } finally {
    await context.close();
  }
});

browserTest('Issue 210 relationship cap: passing a shared item at best_friend intimacy cap leaves capped speakers unchanged', async t => {
  const levels = {
    E0006: srsSeed({ level: 5, dueAt: FIXED_NOW + DAY }),
    E0007: srsSeed({ level: 5, dueAt: FIXED_NOW + DAY }),
    E0035: srsSeed({ level: 5, dueAt: FIXED_NOW + DAY }),
    E0037: srsSeed({ level: 1, dueAt: FIXED_NOW + DAY }),
    E0212: srsSeed({ level: 5, dueAt: FIXED_NOW + DAY }),
  };
  const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007', 'E0035', 'E0037', 'E0212'], levels });
  const { context, page } = fixturePage;
  try {
    const beforeSnapshot = await relationshipSnapshot(page);
    const milestonesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('relationshipMilestonesV1') || '{}'));
    assert.equal(beforeSnapshot.bob.rankId, 'best_friend');
    assert.equal(beforeSnapshot.bob.intimacy, 100);
    assert.equal(beforeSnapshot.jane.intimacy, 49);
    await startManualSession(page, { characterId: 'bob', ids: ['E0212'] });
    const input = await injectAndStop(page, itemsById.get('E0212').en);
    assertRecognitionEvidence(input, itemsById.get('E0212').en, true);
    const afterSrs = await waitForSrs(page, 'E0212', { field: 'lastMatch', op: 'eq', value: 1 });
    await page.waitForFunction(() => !document.querySelector('#reviewCompleteView')?.hidden
      && !!document.querySelector('#friendshipReview'), null, { timeout: 15_000 });
    const afterSnapshot = await relationshipSnapshot(page);
    assert.deepEqual(afterSnapshot, beforeSnapshot, 'relationship points, rank, and intimacy do not change after the speakers reach their cap');
    const activeCharacterId = await page.evaluate(() => window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__);
    const result = await verifyResult(page, { beforeSnapshot, activeCharacterId, milestonesBefore });
    assert.equal(result.screen.intimacy, '100');
    assert.equal(result.screen.intimacyChange.includes('100 → 100'), true);
    assert.equal(result.screen.notices.length, 0);
    await assertQuietBrowser(t, fixturePage);
    await auditDiagnostic(t, page, 'cap', { itemId: 'E0212', beforeSrs: levels.E0212, afterSrs, beforeRelationships: beforeSnapshot, afterRelationships: afterSnapshot, result: result.screen });
  } finally {
    await context.close();
  }
});


/**
 * Cause a real Chromium page lifecycle transition by foregrounding a second
 * page in the same BrowserContext. Dispatching visibilitychange by itself is
 * not accepted as evidence: the app page must report hidden after the switch.
 */
async function backgroundTransition(page, context) {
  const initialState = await page.evaluate(() => document.visibilityState);
  assert.equal(initialState, 'visible', 'the real-session page starts foregrounded');
  await page.evaluate(() => { window.__issue210.visibilityEvents.length = 0; });

  // Foreground a second real Chromium tab in the same BrowserContext. This
  // uses Chromium's tab lifecycle and never overrides document state or
  // dispatches a synthetic visibilitychange event.
  const foregroundPage = await context.newPage();
  try {
    await foregroundPage.goto('about:blank');
    await foregroundPage.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 10_000, polling: 100 });
    const evidence = await page.evaluate(() => ({
      state: document.visibilityState,
      events: window.__issue210.visibilityEvents.map(event => ({ ...event })),
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    assert.equal(evidence.state, 'hidden', 'Chromium reports the production page is actually hidden');
    assert.equal(evidence.hidden, true, 'Chromium marks the document hidden');
    assert.ok(evidence.events.some(event => event.state === 'hidden'),
      'the real hidden transition dispatched visibilitychange');
    return { foregroundPage, evidence };
  } catch (error) {
    await foregroundPage.close().catch(() => {});
    throw error;
  }
}

async function restoreForeground(page, foregroundPage) {
  if (foregroundPage?.restore) await foregroundPage.restore();
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 10_000, polling: 100 });
  if (foregroundPage && !foregroundPage.restore && !foregroundPage.isClosed()) {
    await foregroundPage.close();
    await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 10_000, polling: 100 });
  }
}

async function readSessionClosure(page) {
  return page.evaluate(day => {
    try {
      const log = JSON.parse(localStorage.getItem('studyLogV1') || '{}');
      return log?.[day]?.session_closure || null;
    } catch (_) { return null; }
  }, FIXED_DAY);
}

async function waitForAnySessionClosure(page) {
  await page.waitForFunction(day => {
    try {
      const log = JSON.parse(localStorage.getItem('studyLogV1') || '{}');
      return !!log?.[day]?.session_closure?.reason;
    } catch (_) { return false; }
  }, FIXED_DAY, { timeout: 15_000, polling: 100 });
  return readSessionClosure(page);
}

async function waitForBackgroundClosure(page) {
  await page.waitForFunction(day => {
    try {
      const log = JSON.parse(localStorage.getItem('studyLogV1') || '{}');
      return log?.[day]?.session_closure?.reason === 'background';
    } catch (_) { return false; }
  }, FIXED_DAY, { timeout: 15_000, polling: 100 });
  return readSessionClosure(page);
}

async function waitForStopRequest(page, attemptId) {
  await page.waitForFunction(id => window.__issue210Speech?.events?.some(event =>
    event.type === 'stop-request' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
}

async function assertHiddenBrowserQuiet(t, fixturePage) {
  await assertQuietBrowser(t, fixturePage);
  assert.deepEqual(fixturePage.consoleErrors, [], 'hidden-page scenarios report no browser console errors');
}

browserTest("BG-01/BG-11/BG-14: real hidden exit closes unanswered session, resume stays idle, and normal start is clean", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007', 'E0035'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006', 'E0007'] });
    const before = await storageSnapshot(page);
    const transition = await backgroundTransition(page, context);
    const closure = await waitForBackgroundClosure(page);
    await page.waitForFunction(() => document.querySelector('#homeView')?.hidden === false
      && document.querySelector('#studyView')?.hidden === true
      && document.querySelector('#reviewCompleteView')?.hidden === true, null, { polling: 100 });
    const after = await storageSnapshot(page);
    assert.deepEqual(after.itemLevel, before.itemLevel, 'BG-01: unanswered items leave SRS unchanged');
    assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, before.studyLog[FIXED_DAY]?.passes || 0,
      'BG-01: unanswered items do not add a study pass');
    assert.equal(closure.reason, 'background');
    assert.equal(closure.cardsDone, 0);
    assert.equal(after.resultEvents, 0, 'background does not render the normal completed result');
    assert.equal(await page.locator('#micStatus').getAttribute('data-state'), 'off');
    assert.equal(transition.evidence.state, 'hidden');
    assert.equal(transition.evidence.events.filter(event => event.state === 'hidden').length, 1);

    await restoreForeground(page, transition.foregroundPage);
    const resumed = await storageSnapshot(page);
    assert.equal(resumed.studyLog[FIXED_DAY].session_closure.reason, 'background',
      'BG-11: returning visible does not resume or rewrite the closed session');
    assert.equal(await page.locator('#homeView').isHidden(), false);
    assert.equal(await page.locator('#studyView').isHidden(), true);
    assert.equal(await page.locator('#micStatus').getAttribute('data-state'), 'off');

    await openOptions(page);
    assert.equal(await page.locator('#playOptionsManual input:checked').count(), 0,
      'BG-14: the interrupted manual queue is not retained');
    assert.equal(await page.locator('[data-session-mode="auto"]').getAttribute('class').then(value => value.includes('is-active')), true,
      'BG-14: next options visit uses the normal automatic mode');
    await page.locator('#playOptionsDialog .focus-sheet__close').click();
    await page.locator('.friendship-hero__cta').click();
    await page.waitForFunction(() => !document.querySelector('#studyView')?.hidden
      && !!document.querySelector('#enText')?.dataset.itemId, null, { timeout: 15_000, polling: 100 });
    assert.equal(await page.locator('#reviewCompleteView').isHidden(), true);
    await page.evaluate(() => document.querySelector('#learningHomeReturn')?.click());
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && document.querySelector('#studyView')?.hidden);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-01-BG-11-BG-14', {
      visibilityBefore: 'visible',
      visibilityAfter: transition.evidence.state,
      visibilityEvents: transition.evidence.events,
      closure,
      after: { itemLevel: after.itemLevel, studyLog: after.studyLog, resultEvents: after.resultEvents },
      resumed: { homeVisible: true, micState: 'off', closureReason: resumed.studyLog[FIXED_DAY].session_closure.reason },
      normalStartItemId: await page.locator('#enText').getAttribute('data-item-id'),
    });
  } finally {
    await context.close();
  }
});

browserTest("BG-02/BG-05/BG-13: finalized answer before hidden is preserved once across closure and reload", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006', 'E0007'] });
    const before = await storageSnapshot(page);
    const committed = await injectAndStop(page, itemsById.get('E0006').en);
    assertRecognitionEvidence(committed, itemsById.get('E0006').en, true);
    const committedSrs = await waitForSrs(page, 'E0006', { field: 'lastMatch', op: 'eq', value: 1 });
    await waitForItem(page, 'E0007');
    const afterCommit = await storageSnapshot(page);
    assert.equal(afterCommit.writes.itemLevelV1 - (before.writes.itemLevelV1 || 0), 1,
      'BG-05: the finalized answer caused exactly one SRS storage write');
    assert.equal(afterCommit.studyLog[FIXED_DAY]?.passes || 0, (before.studyLog[FIXED_DAY]?.passes || 0) + 1,
      'BG-05: the finalized answer caused one pass entry');

    const transition = await backgroundTransition(page, context);
    const closure = await waitForBackgroundClosure(page);
    const afterHidden = await storageSnapshot(page);
    assert.equal(closure.reason, 'background');
    assert.equal(closure.cardsDone, 1);
    assert.equal(closure.conversationCount, 1);
    assert.deepEqual(afterHidden.itemLevel.E0006, committedSrs, 'BG-02: committed SRS survives the background close');
    assert.equal(afterHidden.itemLevel.E0007, undefined, 'BG-02: unanswered second item remains ungraded');
    assert.equal(afterHidden.studyLog[FIXED_DAY]?.passes || 0, 1, 'BG-02: only the committed answer is in the pass log');
    assert.equal(afterHidden.writes.itemLevelV1, afterCommit.writes.itemLevelV1,
      'background closure does not write SRS again');
    assert.equal(afterHidden.resultEvents, 0, 'background close has no completion result event');
    await restoreForeground(page, transition.foregroundPage);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && typeof window.__RELATIONSHIP_GAME_STATE__ === 'function');
    const afterReload = await storageSnapshot(page);
    assert.deepEqual(afterReload.itemLevel, afterHidden.itemLevel, 'BG-13: reload preserves committed SRS');
    assert.deepEqual(afterReload.studyLog, afterHidden.studyLog, 'BG-13: reload preserves pass and closure');
    assert.equal(afterReload.studyLog[FIXED_DAY].session_closure.reason, 'background');
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-02-BG-05-BG-13', {
      visibility: transition.evidence,
      attemptId: committed.attemptId,
      committedSrs,
      afterHidden: { itemLevel: afterHidden.itemLevel, studyLog: afterHidden.studyLog, writes: afterHidden.writes },
      afterReload: { itemLevel: afterReload.itemLevel, studyLog: afterReload.studyLog },
      closure,
    });
  } finally {
    await context.close();
  }
});

browserTest("BG-03/BG-04: interim-only and exact interim N-best remain NO GRADE on real hidden exit", async t => {
  const cases = [
    { id: 'BG-03', label: 'exact primary interim', candidates: [itemsById.get('E0006').en] },
    { id: 'BG-04', label: 'exact rank-1 interim N-best', candidates: ['an unrelated phrase', itemsById.get('E0006').en] },
  ];
  for (const scenario of cases) {
    const fixturePage = await newFixturePage({ ids: ['E0006'] });
    const { context, page } = fixturePage;
    try {
      await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
      const before = await storageSnapshot(page);
      const attemptId = await beginAttempt(page);
      const interim = await page.evaluate(candidates => {
        const mock = window.__issue210Speech.latest;
        mock.emitInterim(candidates);
        return [...window.__issue210Speech.events].reverse()
          .find(event => event.type === 'result' && event.attemptId === mock.attemptId);
      }, scenario.candidates);
      assert.equal(interim.isFinal, false);
      assert.equal(interim.recognitionComplete, false);
      if (scenario.id === 'BG-04') {
        assert.equal(interim.rankedAlternatives[1].transcript, itemsById.get('E0006').en);
        assert.equal(interim.rankedAlternatives[1].asrRank, 1);
      }
      const transition = await backgroundTransition(page, context);
      await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
        event.type === 'end' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
      const closure = await waitForBackgroundClosure(page);
      const after = await storageSnapshot(page);
      assert.deepEqual(after.itemLevel, before.itemLevel, scenario.id + ': no SRS change from interim evidence');
      assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, before.studyLog[FIXED_DAY]?.passes || 0,
        scenario.id + ': no PASS history from interim evidence');
      assert.equal(after.writes.itemLevelV1 || 0, before.writes.itemLevelV1 || 0,
        scenario.id + ': no SRS write');
      assert.equal(after.resultEvents, 0);
      assert.equal(closure.reason, 'background');
      assert.equal(closure.cardsDone, 0);
      const timeline = await page.evaluate(() => ({
        visibility: window.__issue210.visibilityEvents.map(event => ({ ...event })),
        speech: window.__issue210Speech.events.map(event => ({ ...event })),
      }));
      const hiddenAt = timeline.visibility.find(event => event.state === 'hidden')?.at;
      const stopAt = timeline.speech.find(event => event.type === 'stop-request' && event.attemptId === attemptId)?.at;
      assert.ok(Number.isFinite(hiddenAt) && Number.isFinite(stopAt) && hiddenAt <= stopAt,
        scenario.id + ': actual hidden transition precedes production stop request');
      await restoreForeground(page, transition.foregroundPage);
      await assertHiddenBrowserQuiet(t, fixturePage);
      await auditDiagnostic(t, page, scenario.id, {
        label: scenario.label,
        visibility: transition.evidence,
        attemptId,
        interim,
        timeline,
        after: { itemLevel: after.itemLevel, studyLog: after.studyLog, writes: after.writes },
        closure,
      });
    } finally {
      await context.close();
    }
  }
});

browserTest("BG-06: final ASR callback races with the visibility boundary without duplicate attempt commits", async t => {
  const variants = [
    { name: 'final-callback-before-hidden', deliverAfterHidden: false },
    { name: 'final-callback-after-hidden-stop', deliverAfterHidden: true },
  ];
  for (const variant of variants) {
    const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007'] });
    const { context, page } = fixturePage;
    try {
      await startManualSession(page, { characterId: 'bob', ids: ['E0006', 'E0007'] });
      const before = await storageSnapshot(page);
      const attemptId = await beginAttempt(page);
      if (!variant.deliverAfterHidden) {
        await page.evaluate(transcript => window.__issue210Speech.latest.emitFinal(transcript),
          itemsById.get('E0006').en);
      } else {
        await page.evaluate(transcript => {
          window.__issue210Speech.latest.stopPlan = {
            final: transcript,
            finalDelayMs: 0,
            holdTerminal: true,
          };
        }, itemsById.get('E0006').en);
      }
      const transition = await backgroundTransition(page, context);
      await waitForStopRequest(page, attemptId);
      if (variant.deliverAfterHidden) {
        await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
          event.type === 'result' && event.attemptId === id && event.isFinal === true), attemptId, { timeout: 10_000, polling: 100 });
        const beforeTerminal = await storageSnapshot(page);
        assert.deepEqual(beforeTerminal.itemLevel, before.itemLevel,
          'provider result alone is not committed before its terminal callback');
        await page.evaluate(() => window.__issue210Speech.latest.emitEnd());
      }
      await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
        event.type === 'end' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
      const closure = await waitForBackgroundClosure(page);
      const after = await storageSnapshot(page);
      const timeline = await page.evaluate(() => ({
        visibility: window.__issue210.visibilityEvents.map(event => ({ ...event })),
        speech: window.__issue210Speech.events.map(event => ({ ...event })),
      }));
      const hiddenEvent = timeline.visibility.find(event => event.state === 'hidden');
      const resultEvent = timeline.speech.find(event => event.type === 'result' && event.attemptId === attemptId);
      const endEvent = timeline.speech.find(event => event.type === 'end' && event.attemptId === attemptId);
      assert.ok(Number.isFinite(hiddenEvent?.sequence) && Number.isFinite(resultEvent?.sequence) && Number.isFinite(endEvent?.sequence));
      assert.ok(after.writes.itemLevelV1 - (before.writes.itemLevelV1 || 0) <= 1,
        'one attempt cannot create multiple SRS writes');
      assert.ok((after.studyLog[FIXED_DAY]?.passes || 0) - (before.studyLog[FIXED_DAY]?.passes || 0) <= 1,
        'one attempt cannot create multiple pass entries');
      assert.ok(closure.cardsDone <= 1, 'session closure cannot count one attempt twice');
      assert.equal(after.resultEvents, 0, 'background close must not show the completion result');
      if (variant.deliverAfterHidden) assert.ok(hiddenEvent.sequence < resultEvent.sequence && resultEvent.sequence < endEvent.sequence,
        'BG-06 records the exact hidden → final result → terminal callback order');
      else assert.ok(resultEvent.sequence < hiddenEvent.sequence && hiddenEvent.sequence < endEvent.sequence,
        'BG-06 records the exact final result → hidden → terminal callback order');
      await restoreForeground(page, transition.foregroundPage);
      await assertHiddenBrowserQuiet(t, fixturePage);
      await auditDiagnostic(t, page, 'BG-06-' + variant.name, {
        visibility: transition.evidence,
        attemptId,
        eventOrder: variant.name,
        savedSrs: after.itemLevel.E0006 || null,
        srsWrites: after.writes.itemLevelV1 || 0,
        passes: after.studyLog[FIXED_DAY]?.passes || 0,
        timeline,
        closure,
      });
    } finally {
      await context.close();
    }
  }
});

browserTest("BG-07/BG-08: delayed end completes safely; missing end reproduces a stuck background finalizer", async t => {
  const delayed = await newFixturePage({ ids: ['E0006'] });
  try {
    await startManualSession(delayed.page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(delayed.page);
    const attemptId = await beginAttempt(delayed.page);
    await delayed.page.evaluate(() => { window.__issue210Speech.latest.stopPlan = { holdTerminal: true }; });
    const transition = await backgroundTransition(delayed.page, delayed.context);
    await waitForStopRequest(delayed.page, attemptId);
    assert.equal(await readSessionClosure(delayed.page), null,
      'BG-07: finalization waits while the deliberately delayed terminal callback is withheld');
    const beforeEnd = await storageSnapshot(delayed.page);
    assert.deepEqual(beforeEnd.itemLevel, before.itemLevel);
    await delayed.page.evaluate(() => window.__issue210Speech.latest.emitEnd());
    const closure = await waitForBackgroundClosure(delayed.page);
    const after = await storageSnapshot(delayed.page);
    assert.equal(closure.reason, 'background');
    assert.equal(after.itemLevel.E0006, undefined);
    assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, 0);
    assert.equal(after.resultEvents, 0);
    await restoreForeground(delayed.page, transition.foregroundPage);
    await assertHiddenBrowserQuiet(t, delayed);
    await auditDiagnostic(t, delayed.page, 'BG-07-delayed-end', {
      visibility: transition.evidence, attemptId, beforeEnd, after, closure,
    });
  } finally {
    await delayed.context.close();
  }

  const missing = await newFixturePage({ ids: ['E0006'] });
  try {
    await startManualSession(missing.page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(missing.page);
    const attemptId = await beginAttempt(missing.page);
    await missing.page.evaluate(() => { window.__issue210Speech.latest.stopPlan = { holdTerminal: true }; });
    const transition = await backgroundTransition(missing.page, missing.context);
    await waitForStopRequest(missing.page, attemptId);
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = await storageSnapshot(missing.page);
    const closure = await readSessionClosure(missing.page);
    const state = await missing.page.evaluate(() => ({
      visibility: document.visibilityState,
      homeHidden: document.querySelector('#homeView')?.hidden,
      studyHidden: document.querySelector('#studyView')?.hidden,
      micState: document.querySelector('#micStatus')?.dataset.state,
      providerState: window.__issue210Speech.latest?.lifecycleState,
    }));
    assert.equal(closure, null, 'BG-08 reproduces that no closure is written without provider end');
    assert.equal(state.visibility, 'hidden');
    assert.equal(state.homeHidden, true);
    assert.equal(state.studyHidden, false, 'the hidden page remains in the active study view');
    assert.equal(state.providerState, 'stopping');
    assert.notEqual(state.micState, 'off', 'the UI still reports an active microphone state');
    assert.deepEqual(after.itemLevel, before.itemLevel);
    assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, before.studyLog[FIXED_DAY]?.passes || 0);
    t.diagnostic('[issue210-BG-08-FINDING-P1] stop() has no provider end/error; background finalization remains pending for 500ms, no closure is persisted, and study/mic state remains active. This is a reproduction record, not acceptance.');
    await auditDiagnostic(t, missing.page, 'BG-08-missing-end-finding', {
      visibility: transition.evidence,
      attemptId,
      state,
      closure,
      srsBefore: before.itemLevel,
      srsAfter: after.itemLevel,
      studyLog: after.studyLog,
      providerEvents: await missing.page.evaluate(() => window.__issue210Speech.events),
    });
    await assertHiddenBrowserQuiet(t, missing);
    await restoreForeground(missing.page, transition.foregroundPage);
  } finally {
    await missing.context.close();
  }
});

browserTest("BG-09: duplicate hidden event during a pending stop creates one semantic closure", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(page);
    const attemptId = await beginAttempt(page);
    await page.evaluate(() => { window.__issue210Speech.latest.stopPlan = { holdTerminal: true }; });
    const transition = await backgroundTransition(page, context);
    await waitForStopRequest(page, attemptId);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const closure = await waitForBackgroundClosure(page);
    const beforeEnd = await storageSnapshot(page);
    assert.equal(beforeEnd.writes.studyLogV1 - (before.writes.studyLogV1 || 0), 1,
      'duplicate event produces one semantic session-closure write');
    assert.equal(beforeEnd.itemLevel.E0006, undefined);
    assert.equal(beforeEnd.studyLog[FIXED_DAY]?.passes || 0, 0);
    await page.evaluate(() => window.__issue210Speech.latest.emitEnd());
    await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
      event.type === 'end' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
    const afterEnd = await storageSnapshot(page);
    assert.deepEqual(afterEnd.studyLog[FIXED_DAY].session_closure, closure,
      'settling the first finalizer does not replace the recorded closure');
    assert.equal(afterEnd.writes.studyLogV1, beforeEnd.writes.studyLogV1,
      'the first pending finalizer does not persist a second closure');
    const evidence = await page.evaluate(() => ({
      visibility: window.__issue210.visibilityEvents,
      speech: window.__issue210Speech.events,
    }));
    assert.equal(evidence.visibility.filter(event => event.state === 'hidden').length, 2,
      'one actual hidden transition plus one duplicate hidden-state event was observed');
    await restoreForeground(page, transition.foregroundPage);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-09', { transition: transition.evidence, attemptId, evidence, closure, beforeEnd, afterEnd });
  } finally {
    await context.close();
  }
});

browserTest("BG-10: manual home exit racing hidden finalization produces one closure and records the winner", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    const before = await storageSnapshot(page);
    const attemptId = await beginAttempt(page);
    await page.evaluate(() => { window.__issue210Speech.latest.stopPlan = { holdTerminal: true }; });
    const transition = await backgroundTransition(page, context);
    await waitForStopRequest(page, attemptId);
    await page.evaluate(() => document.querySelector('#learningHomeReturn')?.click());
    const closure = await waitForAnySessionClosure(page);
    assert.ok(['background', 'idle'].includes(closure.reason),
      'closure reason is one of the two requested production exits');
    await page.evaluate(() => window.__issue210Speech.latest.emitEnd());
    await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
      event.type === 'end' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
    const after = await storageSnapshot(page);
    assert.equal(after.writes.studyLogV1 - (before.writes.studyLogV1 || 0), 1,
      'hidden/manual collision records one session_closure value');
    assert.equal(after.writes.itemLevelV1 || 0, before.writes.itemLevelV1 || 0);
    assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, before.studyLog[FIXED_DAY]?.passes || 0);
    assert.equal(after.resultEvents, 0);
    assert.deepEqual(await readSessionClosure(page), closure,
      'late completion of the other finalizer does not overwrite the winning closure');
    const evidence = await page.evaluate(() => ({
      visibility: window.__issue210.visibilityEvents,
      speech: window.__issue210Speech.events,
      view: {
        homeHidden: document.querySelector('#homeView')?.hidden,
        studyHidden: document.querySelector('#studyView')?.hidden,
        resultHidden: document.querySelector('#reviewCompleteView')?.hidden,
      },
    }));
    await restoreForeground(page, transition.foregroundPage);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-10', {
      transition: transition.evidence, attemptId, evidence, closure,
      closureWrites: after.writes.studyLogV1 - (before.writes.studyLogV1 || 0),
    });
  } finally {
    await context.close();
  }
});

browserTest("BG-12: late callback from a closed hidden attempt cannot affect a new session item", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006', 'E0007'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006', 'E0007'] });
    const oldAttemptId = await beginAttempt(page);
    await page.evaluate(() => {
      window.__issue210.oldAttempt = window.__issue210Speech.latest;
      window.__issue210Speech.latest.stopPlan = { holdTerminal: true };
    });
    const transition = await backgroundTransition(page, context);
    await waitForStopRequest(page, oldAttemptId);
    await page.evaluate(() => window.__issue210Speech.latest.emitEnd());
    const closure = await waitForBackgroundClosure(page);
    await restoreForeground(page, transition.foregroundPage);

    await startManualSession(page, { characterId: 'bob', ids: ['E0007'] });
    const newAttemptId = await beginAttempt(page);
    assert.notEqual(newAttemptId, oldAttemptId);
    const beforeLateCallback = await storageSnapshot(page);
    const oldDelivery = await page.evaluate(transcript => {
      const old = window.__issue210.oldAttempt;
      old.emitFinal(transcript);
      return {
        oldAttemptId: old.attemptId,
        finalEvent: [...window.__issue210Speech.events].reverse()
          .find(event => event.type === 'result' && event.attemptId === old.attemptId),
      };
    }, itemsById.get('E0006').en);
    assert.equal(oldDelivery.oldAttemptId, oldAttemptId);
    assert.equal(oldDelivery.finalEvent.isFinal, true);
    const afterLateCallback = await storageSnapshot(page);
    assert.deepEqual(afterLateCallback.itemLevel, beforeLateCallback.itemLevel,
      'old attempt does not write its SRS after a new session starts');
    assert.equal(afterLateCallback.studyLog[FIXED_DAY]?.passes || 0,
      beforeLateCallback.studyLog[FIXED_DAY]?.passes || 0);
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'), 'E0007');
    assert.equal(afterLateCallback.resultEvents, 0);
    await page.evaluate(() => document.querySelector('#learningHomeReturn')?.click());
    await page.waitForFunction(() => !document.querySelector('#homeView')?.hidden
      && document.querySelector('#studyView')?.hidden);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-12', {
      transition: transition.evidence, oldAttemptId, newAttemptId, oldDelivery,
      beforeLateCallback: beforeLateCallback.itemLevel,
      afterLateCallback: afterLateCallback.itemLevel,
      closure,
    });
  } finally {
    await context.close();
  }
});

browserTest("BG-15: hidden Correction attempt preserves original FAIL and creates no correction PASS", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    const beforeFailure = await storageSnapshot(page);
    const failedAttempt = await injectAndStop(page, 'a deliberately incorrect sentence');
    assert.equal(failedAttempt.event.isFinal, true);
    const failedSrs = await waitForSrs(page, 'E0006', { field: 'lastMatch', op: 'lt', value: 0.7 });
    const afterFailure = await storageSnapshot(page);
    assert.notDeepEqual(afterFailure.itemLevel, beforeFailure.itemLevel,
      'control: the original finalized FAIL is stored through production scoring');

    const correctionAttemptId = await beginAttempt(page);
    await page.evaluate(transcript => window.__issue210Speech.latest.emitInterim(transcript),
      itemsById.get('E0006').en);
    const transition = await backgroundTransition(page, context);
    await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
      event.type === 'end' && event.attemptId === id), correctionAttemptId, { timeout: 10_000, polling: 100 });
    const closure = await waitForBackgroundClosure(page);
    const afterHidden = await storageSnapshot(page);
    assert.deepEqual(afterHidden.itemLevel, afterFailure.itemLevel,
      'BG-15: hidden Correction does not replace the original FAIL SRS state');
    assert.equal(afterHidden.studyLog[FIXED_DAY]?.passes || 0,
      afterFailure.studyLog[FIXED_DAY]?.passes || 0, 'BG-15: correction cannot add a study PASS');
    assert.equal(afterHidden.writes.itemLevelV1, afterFailure.writes.itemLevelV1,
      'BG-15: interim correction does not write SRS');
    assert.equal(afterHidden.resultEvents, 0);
    assert.equal(closure.reason, 'background');
    assert.equal(closure.cardsDone, 0);
    await restoreForeground(page, transition.foregroundPage);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-15', {
      transition: transition.evidence, originalFailAttemptId: failedAttempt.attemptId,
      correctionAttemptId, failedSrs, afterFailure: afterFailure.itemLevel.E0006,
      afterHidden: afterHidden.itemLevel.E0006, closure,
    });
  } finally {
    await context.close();
  }
});

browserTest("BG-16: hidden Read Cloze stage rejects interim-only full-sentence recognition", async t => {
  const fixturePage = await newFixturePage({ ids: ['E0006'] });
  const { context, page } = fixturePage;
  try {
    await startManualSession(page, { characterId: 'bob', ids: ['E0006'] });
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('english-pwa:request-hint'));
      document.dispatchEvent(new CustomEvent('english-pwa:request-hint'));
    });
    await page.waitForFunction(() => document.querySelector('#enText')?.classList.contains('cloze-active')
      && document.querySelector('#enText .cloze-mask'), null, { timeout: 10_000, polling: 100 });
    const clozeState = await page.evaluate(() => ({
      itemId: document.querySelector('#enText')?.dataset.itemId,
      clozeRendered: document.querySelector('#enText')?.dataset.clozeRendered,
      maskedTokens: document.querySelectorAll('#enText .cloze-mask').length,
    }));
    assert.equal(clozeState.itemId, 'E0006');
    assert.ok(clozeState.maskedTokens > 0, 'the production progressive hint module entered its Cloze stage');
    const before = await storageSnapshot(page);
    const attemptId = await beginAttempt(page);
    const interim = await page.evaluate(transcript => {
      const mock = window.__issue210Speech.latest;
      mock.emitInterim(transcript);
      return [...window.__issue210Speech.events].reverse()
        .find(event => event.type === 'result' && event.attemptId === mock.attemptId);
    }, itemsById.get('E0006').en);
    assert.equal(interim.isFinal, false);
    const transition = await backgroundTransition(page, context);
    await page.waitForFunction(id => window.__issue210Speech.events.some(event =>
      event.type === 'end' && event.attemptId === id), attemptId, { timeout: 10_000, polling: 100 });
    const closure = await waitForBackgroundClosure(page);
    const after = await storageSnapshot(page);
    assert.deepEqual(after.itemLevel, before.itemLevel, 'BG-16: interim full-sentence Cloze attempt cannot pass');
    assert.equal(after.studyLog[FIXED_DAY]?.passes || 0, before.studyLog[FIXED_DAY]?.passes || 0);
    assert.equal(after.writes.itemLevelV1 || 0, before.writes.itemLevelV1 || 0);
    assert.equal(after.resultEvents, 0);
    assert.equal(closure.reason, 'background');
    assert.equal(closure.cardsDone, 0);
    await restoreForeground(page, transition.foregroundPage);
    await assertHiddenBrowserQuiet(t, fixturePage);
    await auditDiagnostic(t, page, 'BG-16', {
      transition: transition.evidence, clozeState, attemptId, interim, after, closure,
    });
  } finally {
    await context.close();
  }
});
