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
const INITIAL_MAIN_SHA = '4a01d9e6d8f4c080d738dc87dfc9c5082afb9d29';
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
    browser = await chromium.launch({ headless: true });
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
    window.__issue210 = { results: [], writes: {}, permissionCalls: 0 };
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
  await context.route('**/*', async route => {
    const requested = new URL(route.request().url());
    if (requested.origin === baseUrl) return route.continue();
    externalRequests.push(requested.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
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
  assert.equal(await page.evaluate(() => window.APP_VERSION), 'v5.116', 'browser fixture uses the expected release version');
  await page.waitForFunction(() => !document.querySelector('#loadingOverlay')?.classList.contains('show'));
  await page.evaluate(() => { window.__issue210.writes = {}; });
  return { context, page, pageErrors, externalRequests };
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
