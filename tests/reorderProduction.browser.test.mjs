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

async function newProductionPage({ studyMode = 'compose', hold = false, metadataPayload = validMetadata, sourceItem=item, vocabulary=[], level=0 } = {}) {
  metadata = metadataPayload;
  holdMetadata = hold;
  heldMetadataResponse = null;
  metadataRequestCount = 0;
  const metadataRequested = hold ? waitForMetadataRequest() : null;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion:'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ studyMode, level, itemId }) => {
    localStorage.setItem('itemLevelV1',JSON.stringify({[itemId]:{last:level,best:level}}));
    localStorage.setItem('appConfigV3', JSON.stringify({ playbackMode: 'speech', studyMode }));
    window.__testSpeech = { latest: null, starts:0, srsWrites:0, spoken:[] };
    const storageSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='itemLevelV1') window.__testSpeech.srsWrites++;return storageSet.call(this,key,value);};
    window.SpeechRecognitionPhrase=class {constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}};
    class MockRecognition {
      constructor() { window.__testSpeech.latest = this;this.phrases=[]; }
      start() { this.phrasesAtStart=this.phrases.map(p=>({text:p.phrase,boost:p.boost}));window.__testSpeech.starts=(window.__testSpeech.starts||0)+1;this.onstart?.(); }
      stop() {}
      inject(text) {
        const result = Object.assign((Array.isArray(text)?text:[text]).map(transcript=>({transcript:String(transcript),confidence:0})), { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [result] });
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: MockRecognition, configurable: true });
    class MockUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      value: { getVoices: () => [{name:'English',lang:'en-US',voiceURI:'english'}], speak: utterance => {window.__testSpeech.spoken.push(utterance.text);utterance.onstart?.();utterance.onend?.();}, cancel: () => {}, addEventListener: () => {} },
      configurable: true,
    });
  }, { studyMode, level, itemId:sourceItem.id });
  const page = await context.newPage();
  await page.route('**/data/items.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([sourceItem])}));
  await page.route('**/data/vocabulary-v3.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({entries:vocabulary})}));
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
    const answerFragments = sentenceRows.flatMap((row) => row.tiles);
    const pendingSnapshots = [];
    for (let hintAttempt = 0; hintAttempt < 4; hintAttempt += 1) {
      await page.evaluate(() => document.dispatchEvent(new Event('english-pwa:request-hint')));
      const pending = await page.evaluate(() => {
        const english = document.querySelector('#enText');
        const japanese = document.querySelector('#jaText');
        const card = document.querySelector('#card');
        return {
          text: english.textContent,
          html: english.innerHTML,
          ariaLabel: english.getAttribute('aria-label') || '',
          markup: english.outerHTML,
          micDisabled: document.querySelector('#btnMic').disabled,
          japaneseVisible: japanese.style.display !== 'none',
          hintActive: card.classList.contains('card-hint-active'),
          audioHint: card.classList.contains('card-hint-audio'),
        };
      });
      const accessibleText = await page.locator('#enText').ariaSnapshot();
      pendingSnapshots.push({ pending, accessibleText });
    }
    for (const { pending, accessibleText } of pendingSnapshots) {
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
      assert.equal(pending.text, '並べ替えを準備しています…', 'pending hint input must be ignored without advancing hint state');
      assert.equal(pending.japaneseVisible, false, 'Japanese hint must remain hidden during setup');
      assert.equal(pending.hintActive, false, 'hint state must remain at base during setup');
      assert.equal(pending.audioHint, false, 'audio hint state must remain locked during setup');
      assert.equal(pending.micDisabled, true);
    }
    respondWithMetadata(heldMetadataResponse, validMetadata);
    await waitForReorder(page);
    assert.match(await page.locator('#enText').innerText(), /文の語順を組み立ててください/);
    assert.equal(await page.locator('#composeTokens .compose-token').count(), 2);
    assert.equal(await page.locator('#btnMic').isDisabled(), true);
    assert.equal((await page.locator('#enText').innerText()).includes(item.en), false);
    await completeSentence(page, 0, [0, 1]);
    await completeSentence(page, 1, [0, 1, 2]);
    await completeSentence(page, 2, [0, 1]);
    const state = await submitFullUtterance(page);
    assert.equal(state.hintStage, 0, 'ignored pending hints cannot make self-completion assisted');
    assert.equal(state.noHintHistory.length, 1, 'self-completion remains eligible for no-hint success');
    assert.equal(state.level5Count, 1, 'self-completion keeps perfect-no-hint credit');
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
    const state = await submitFullUtterance(page);
    assert.equal(state.hintStage, 3, 'safe-disable English reveal is recorded before speech grading');
    assert.equal(state.last, 3, '100% fallback speech uses candidate 3 under current policy');
    assert.equal(state.best, 3);
    assert.equal(state.noHintHistory.length, 0, 'safe-disable fallback cannot enter no-hint history');
    assert.equal(state.level5Count, 0, 'safe-disable fallback cannot receive perfect-no-hint credit');
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
    const state = await submitFullUtterance(page);
    assert.equal(state.hintStage, 1, 'read mode keeps its ordinary manual English hint stage');
    assert.equal(state.last, 3, 'read mode uses the ordinary hinted candidate');
    assert.equal(state.noHintHistory.length, 0);
    assert.equal(state.level5Count, 0);
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

async function speechAttempt(page,words){
  const starts=await page.evaluate(()=>window.__testSpeech.starts||0);
  await page.waitForFunction(()=>!document.querySelector('#btnMic').disabled);
  {const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
  await page.waitForFunction(count=>(window.__testSpeech.starts||0)>count,starts);
  await page.evaluate(words=>window.__testSpeech.latest.inject(words),words);
  {const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
}

browserTest('390×844 normal read baseline uses primary score/highlight without whole-sentence bias',async()=>{
  const {context,page}=await newProductionPage({studyMode:'read'});
  try{
    await page.waitForFunction(()=>document.querySelector('#enText')?.dataset.itemId==='RPROD1');
    await speechAttempt(page,item.en);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')||'{}').RPROD1?.lastMatch===1);
    assert.equal(await page.locator('#transcript').innerText(),item.en);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.latest.phrasesAtStart),[]);
    assert.equal(await page.locator('#enText .tok.miss').count(),0);
    assert.ok(await page.locator('#enText .tok.hit').count()>0);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }finally{await context.close();}
});

browserTest('normal read FAIL correction is practice-only through repeated failure and automatic successful advance',async()=>{
  const {context,page}=await newProductionPage({studyMode:'read'});
  try{
    await page.waitForFunction(()=>document.querySelector('#enText')?.dataset.itemId==='RPROD1');
    await speechAttempt(page,['banana','unrelated']);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')||'{}').RPROD1?.lastMatch===0);
    const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    assert.equal(await page.locator('#enText').innerText(),item.en);
    assert.equal(await page.locator('#attemptInfo').textContent(),'修正練習中');
    await page.waitForFunction(()=>window.__testSpeech.spoken.length>0);
    for(let attempt=0;attempt<2;attempt++){
      await speechAttempt(page,'banana');
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1),initial);
      assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    }
    await speechAttempt(page,item.en);
    await page.waitForFunction(()=>document.querySelector('#footer')?.textContent.includes('修正練習完了')||document.body.textContent.includes('修正練習完了'));
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1),initial);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    await page.waitForFunction(()=>document.querySelector('#startStudyCta')&&!document.querySelector('#startStudyCta').hidden);
  }finally{await context.close();}
});

for(const count of [1,3]) browserTest(`390×844 read Cloze ${count} targets injects internal target/local context, preserves concealment and full-sentence grading`,async()=>{
  const sentence=count===1?'He refused to yield to any threats from them.':'Today I came across him near the old bridge when I was looking for the station and decided to yield to his request before continuing my long journey home again.';
  const surfaces=count===1?['yield to']:['came across','looking for','yield to'];
  const sourceItem={...item,en:sentence};
  const vocabulary=surfaces.map((surface,index)=>({id:`target${index}`,kind:'expression',canonical:surface,meaning_ja:'意味',answers:[],occurrences:[{item_id:item.id,start:sentence.indexOf(surface),end:sentence.indexOf(surface)+surface.length,contextual_meaning_ja:'意味'}]}));
  const {context,page}=await newProductionPage({studyMode:'read',sourceItem,vocabulary,level:count===1?0:5});
  try{
    await page.waitForFunction(()=>document.querySelector('#enText')?.dataset.itemId==='RPROD1');
    await page.evaluate(()=>document.dispatchEvent(new Event('english-pwa:request-hint')));
    await page.waitForSelector('#enText.cloze-active .cloze-mask');
    const registry=await page.evaluate(async()=> (await import('./scripts/app/clozeRecognitionContext.js')).getActiveClozeRecognitionContext('RPROD1'));
    assert.equal(registry.targets.length,count);
    for(const stage of ['2','0']){
      await page.evaluate(()=>document.dispatchEvent(new Event('english-pwa:request-hint')));
      await page.waitForFunction(stage=>document.querySelector('#enText')?.dataset.readHintStage===stage,stage);
      assert.equal(await page.evaluate(async()=> (await import('./scripts/app/clozeRecognitionContext.js')).getActiveClozeRecognitionContext()),null);
    }
    await page.evaluate(()=>document.dispatchEvent(new Event('english-pwa:request-hint')));
    await page.waitForSelector('#enText.cloze-active .cloze-mask');
    assert.deepEqual(await page.evaluate(async()=> (await import('./scripts/app/clozeRecognitionContext.js')).getActiveClozeRecognitionContext('RPROD1')),registry);
    const visible=await page.locator('#enText').evaluate(en=>{const copy=en.cloneNode(true);copy.querySelectorAll('.cloze-mask').forEach(node=>node.remove());return copy.textContent;});
    assert.ok((await page.locator('#enText .cloze-mask').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).color==='rgba(0, 0, 0, 0)'&&node.getAttribute('aria-hidden')==='true'))));
    const accessible=await page.locator('#enText').ariaSnapshot();
    for(const target of registry.targets){
      assert.ok(!visible.includes(target.surface),'masked targets are absent from visible text');
      assert.ok(!accessible.includes(target.surface),'masked targets are absent from accessible text');
      assert.equal(await page.locator(`#enText [aria-label*="${target.surface}"],#enText [title*="${target.surface}"]`).count(),0);
      const leaked=await page.locator('#enText').evaluate((en,surface)=>[en,...en.querySelectorAll('*')].some(node=>[...node.attributes].some(attr=>attr.name.startsWith('data-')&&attr.name!=='data-w'&&attr.value.includes(surface))),target.surface);
      assert.equal(leaked,false,'no new target data attribute');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await speechAttempt(page,registry.targets[0].surface);
    const phrases=await page.evaluate(()=>window.__testSpeech.latest.phrasesAtStart);
    assert.ok(phrases.length<=6);
    for(const target of registry.targets) assert.ok(phrases.some(p=>p.text===target.surface&&p.boost===4.5));
    assert.equal(phrases.filter(p=>p.boost===3).length,count);
    assert.ok(!phrases.some(p=>p.text===sentence));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1.lastMatch<0.7);
    assert.equal(await page.locator('#enText').innerText(),sentence,'grading still covers the full sentence');
    assert.equal(await page.evaluate(async()=> (await import('./scripts/app/clozeRecognitionContext.js')).getActiveClozeRecognitionContext()),null,'canonical reveal clears hidden context');
    await speechAttempt(page,sentence);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.latest.phrasesAtStart),[{text:sentence,boost:5}]);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
  }finally{await context.close();}
});

for(const technical of [false,true]) browserTest(`normal correction ${technical?'technical':'lexical'} ×3 closes without multiplying penalties`,async()=>{
  const {context,page}=await newProductionPage({studyMode:'read'});
  try{
    await page.waitForFunction(()=>document.querySelector('#enText')?.dataset.itemId==='RPROD1');
    await speechAttempt(page,'banana');await page.waitForFunction(()=>window.__testSpeech.spoken.length>0);
    for(let index=0;index<3;index++){
      if(technical){
        const starts=await page.evaluate(()=>window.__testSpeech.starts);
        await page.waitForFunction(()=>!document.querySelector('#btnMic').disabled);
        const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
        await page.waitForFunction(count=>window.__testSpeech.starts>count,starts);
        await page.evaluate(()=>{const r=window.__testSpeech.latest;r.onerror?.({error:'network'});r.onend?.();});
      }else await speechAttempt(page,'banana');
      assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    }
    await page.waitForFunction(()=>document.querySelector('#startStudyCta')&&!document.querySelector('#startStudyCta').hidden);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
  }finally{await context.close();}
});
