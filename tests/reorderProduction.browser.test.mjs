import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installMockSpeechRecognition } from './helpers/mockSpeechRecognition.mjs';

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

function buildMetadata(sourceItem = item, rows = sentenceRows) {
  const sentences = rows.map((row, sentenceIndex) => {
    let charOffset = sourceItem.en.indexOf(row.text);
    const tiles = row.tiles.map((text, tileIndex) => {
      const charStart = charOffset;
      const charEnd = charStart + text.length;
      charOffset = charEnd + (tileIndex + 1 < row.tiles.length ? 1 : 0);
      return {
        id: `s${sentenceIndex}-t${tileIndex}`,
        sourceText: text,
      learningText: text.replace(/[.!?]/g, ''),
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
      chunks: tiles,
      canonicalOrder,
      acceptedOrders: [canonicalOrder],
      clauseScaffold: tiles.map(() => '語句'),
      canonicalReconstruction: row.text,
    };
    return {
      sentenceIndex,
      sourceText: row.text,
      fixedContext: false,
      partition: variant,
    };
  });
  return {
    schemaVersion: 2,
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

async function newProductionPage({ studyMode = 'compose', hold = false, metadataPayload = validMetadata, sourceItem=item, vocabulary=[], level=0, playbackMode='speech' } = {}) {
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
  await context.addInitScript(installMockSpeechRecognition, { stateKey: '__testSpeech' });
  await context.addInitScript(({ studyMode, level, itemId, playbackMode, audioBase }) => {
    localStorage.setItem('itemLevelV1',JSON.stringify({[itemId]:{last:level,best:level}}));
    localStorage.setItem('appConfigV3', JSON.stringify({ studyMode }));
    if(playbackMode==='audio') navigator.storage.getDirectory=async()=>({getFileHandle:async()=>({getFile:async()=>new File([await (await fetch(audioBase+'/fixture.wav')).arrayBuffer()],'fixture.wav',{type:'audio/wav'})})});
    window.__testSpeech = Object.assign(window.__testSpeech || {}, { latest: null, starts:0, srsWrites:0, spoken:[] });
    const storageSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='itemLevelV1') window.__testSpeech.srsWrites++;return storageSet.call(this,key,value);};
    window.SpeechRecognitionPhrase=class {constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}};
    class MockUtterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      value: { getVoices: () => [{name:'English',lang:'en-US',voiceURI:'english'}], speak: utterance => {window.__testSpeech.spoken.push(utterance.text);utterance.onstart?.();utterance.onend?.();}, cancel: () => {}, addEventListener: () => {} },
      configurable: true,
    });
  }, { studyMode, level, itemId:sourceItem.id, playbackMode, audioBase:`${baseUrl}/audio` });
  const page = await context.newPage();
  await page.route('**/data/items.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([sourceItem])}));
  await page.route('**/data/vocabulary-v3.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({entries:vocabulary})}));
  if (playbackMode === 'audio') {
    const rate=8000, samples=rate*4;
    const wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF',0);wav.writeUInt32LE(36+samples*2,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    await page.route('**/audio/fixture.wav', route=>route.fulfill({contentType:'audio/wav',body:wav}));
  }
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

const canonicalReorderIds = sentenceRows.flatMap((row, sentenceIndex) =>
  row.tiles.map((_, tileIndex) => `s${sentenceIndex}-t${tileIndex}`));

async function placeReorderIds(page, ids) {
  for (const id of ids) {
    await page.locator(`[data-zone="bank"][data-tile-id="${id}"]`).click();
  }
}

async function completeReorderItem(page) {
  await placeReorderIds(page, canonicalReorderIds);
  await page.locator('#composeControls [data-action="check"]').click();
  await page.waitForSelector('#composeControls [data-action="advance"]');
  await page.locator('#composeControls [data-action="advance"]').click();
}

async function failReorderItemThreeTimes(page) {
  const wrongOrder = canonicalReorderIds.slice().reverse();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await placeReorderIds(page, wrongOrder);
    await page.locator('#composeControls [data-action="check"]').click();
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
  catch (error) { if (process.env.REORDER_REQUIRE_BROWSER) throw error; browserError = String(error?.message ?? error).split('\n')[0]; }
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
    assert.equal(await page.locator('#enText').isVisible(),false);
    assert.equal(await page.locator('#composeTokens .compose-token').count(), 7);
    assert.equal(await page.locator('#btnMic').isDisabled(), true);
    assert.equal((await page.locator('#enText').innerText()).includes(item.en), false);
    await completeReorderItem(page);
    const state = await reorderState(page);
    assert.equal(state.lastReorder.grade,'FIRST_TRY');
    assert.equal(state.lastReorder.candidate,4);
    assert.equal(state.level5Count || 0,0);
    assert.equal((state.noHintHistory || []).length,0);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);

  } finally {
    if (heldMetadataResponse && !heldMetadataResponse.writableEnded) respondWithMetadata(heldMetadataResponse, validMetadata);
    await closePage({ context });
  }
});

browserTest('stale metadata safely disables Reordering with skip, no speech fallback or SRS write', async () => {
  const staleMetadata = {...validMetadata, items:[{...validMetadata.items[0],sourceHash:'stale'}]};
  const {context,page}=await newProductionPage({metadataPayload:staleMetadata});
  try {
    await page.waitForSelector('#composeControls button');
    assert.equal(await page.locator('#btnMic').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),0);
    assert.equal((await page.locator('#card').textContent()).includes(item.en),false);
    await page.locator('#composeControls button').click();
    await page.waitForFunction(()=>!document.querySelector('#startStudyCta').hidden);
  } finally { await context.close(); }
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

async function reorderState(page) {
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')||'{}').RPROD1?.lastReorder);
  return page.evaluate(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1);
}

for (const wrong of [0,1,2,3]) for(const level of [0,5]) browserTest(`390×844 Reordering ${wrong} wrong submissions, existing Lv${level}, speech isolated`, async () => {
  const {context,page}=await newProductionPage({level});
  try {
    await waitForReorder(page);
    for(let i=0;i<4;i++) await page.evaluate(()=>document.dispatchEvent(new Event('english-pwa:request-hint')));
    assert.equal((await page.locator('#enText').textContent()).includes(item.en),false);
    for(const selector of ['#btnMic','#transcript','#micStatus','#conversationHintBtn','.conversation-details'])
      assert.equal(await page.locator(selector).isVisible(),false,selector);
    const workspace=await page.locator('#composeAnswer').boundingBox();
    assert.ok(workspace.height>=180);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(wrong===3) await failReorderItemThreeTimes(page);
    else {
      const wrongOrder = canonicalReorderIds.slice().reverse();
      for(let i=0;i<wrong;i++) {
        await placeReorderIds(page, wrongOrder);
        await page.locator('[data-action="check"]').click();
        assert.equal(await page.locator('#composeFeedback').innerText(),'もう一度');
        assert.equal((await page.locator('#composeContext').textContent()).includes(item.en),false);
        await page.locator('[data-action="reset"]').click();
      }
      await completeReorderItem(page);
    }
    const state=await reorderState(page);
    const grade=wrong===3?'FAILED':wrong?'RETRY_PASS':'FIRST_TRY';
    const candidate=wrong===3?1:wrong?3:4;
    assert.equal(state.lastReorder.grade,grade);assert.equal(state.lastReorder.candidate,candidate);
    assert.equal(state.last,level===5&&wrong<3?5:candidate);
    assert.equal(state.best,level===5?5:candidate);
    assert.equal(state.level5Count||0,0);assert.equal((state.noHintHistory||[]).length,0);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);
    assert.equal(await page.locator('#btnPlay').isVisible(),true);
    await page.locator('#btnPlay').click();
    await page.waitForFunction(()=>window.__testSpeech.spoken.length>0);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.spoken),[item.en]);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(()=>!document.querySelector('#startStudyCta').hidden);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
  } finally { await context.close(); }
});

async function speechAttempt(page,words){
  const starts=await page.evaluate(()=>window.__testSpeech.starts||0);
  await page.waitForFunction(()=>!document.querySelector('#btnMic').disabled&&document.querySelector('#micStatus')?.dataset.state==='off');
  {const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
  await page.waitForFunction(count=>(window.__testSpeech.starts||0)>count,starts);
  await page.evaluate(words=>window.__testSpeech.latest.inject(words),words);
  {const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
}

async function autoStopSpeechAttempt(page,words){
  const starts=await page.evaluate(()=>window.__testSpeech.starts||0);
  await page.waitForFunction(()=>!document.querySelector('#btnMic').disabled&&document.querySelector('#micStatus')?.dataset.state==='off');
  {const box=await page.locator('#btnMic').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
  await page.waitForFunction(count=>(window.__testSpeech.starts||0)>count,starts);
  await page.evaluate(words=>{const recognition=window.__testSpeech.latest;recognition.inject(words);recognition.emitEnd();},words);
}

browserTest('390×844 normal read baseline uses primary score/highlight without whole-sentence bias',async()=>{
  const {context,page}=await newProductionPage({studyMode:'read'});
  try{
    await page.waitForFunction(()=>document.querySelector('#enText')?.dataset.itemId==='RPROD1');
    await autoStopSpeechAttempt(page,item.en);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')||'{}').RPROD1?.lastMatch===1);
    assert.equal(await page.locator('#transcript').innerText(),item.en);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.latest.phrasesAtStart),[]);
    assert.equal(await page.locator('#enText .tok.miss').count(),0);
    assert.ok(await page.locator('#enText .tok.hit').count()>0);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const terminalTrace=await page.evaluate(()=>window.__testSpeech.events.map(event=>event.type));
    assert.deepEqual(terminalTrace,['start','result','end'],'autoStop sends final evidence and terminal completion without a manual stop');
    await page.evaluate(()=>window.__testSpeech.latest.emitEnd());
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1,'a duplicate terminal callback cannot write SRS twice');
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

for(const count of [1,3]) browserTest(`390×844 read Cloze ${count} targets preserve concealment and score a complete N-best sentence while showing raw primary`,async()=>{
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
    await speechAttempt(page,[registry.targets[0].surface,sentence]);
    const phrases=await page.evaluate(()=>window.__testSpeech.latest.phrasesAtStart);
    assert.deepEqual(phrases,[]);
    assert.equal(await page.evaluate(()=>window.__testSpeech.latest.maxAlternatives),20);
    assert.equal(await page.evaluate(()=>window.__testSpeech.latest.context.itemId),undefined);
    assert.equal(await page.evaluate(()=>window.__testSpeech.latest.context.sentenceIndex),undefined);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('itemLevelV1')).RPROD1.lastMatch===1);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.events.find(event=>event.type==='result')?.alternatives),[registry.targets[0].surface,sentence]);
    assert.equal(await page.locator('#transcript').innerText(),registry.targets[0].surface,'the raw rank-zero transcript remains visible after lower-ranked scoring');
    assert.equal(await page.locator('#enText').innerText(),sentence,'the selected complete hypothesis grades the full sentence');
    assert.equal(await page.evaluate(async()=> (await import('./scripts/app/clozeRecognitionContext.js')).getActiveClozeRecognitionContext()),null,'canonical reveal clears hidden context');
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1,'one terminal accepted candidate records one SRS write');
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
        await page.evaluate(()=>{const r=window.__testSpeech.latest;r.emitError('network');r.emitEnd();});
      }else await speechAttempt(page,'banana');
      assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
    }
    await page.waitForFunction(()=>document.querySelector('#startStudyCta')&&!document.querySelector('#startStudyCta').hidden);
    assert.equal(await page.evaluate(()=>window.__testSpeech.srsWrites),1);
  }finally{await context.close();}
});

browserTest('390×844 long compound workspace scrolls; native full-item audio never starts ASR and next works during playback', async () => {
  const tiles=Array.from({length:24},(_,i)=>`a substantial phrase number ${i}`);
  tiles[23]+='.';
  const text=tiles.join(' ');
  const sourceItem={...item,en:text,ja:'長い複合文の文脈',audio_fn:'fixture.wav'};
  const metadataPayload=buildMetadata(sourceItem,[{text,tiles}]);
  const {context,page}=await newProductionPage({sourceItem,metadataPayload,playbackMode:'audio',level:5});
  try {
    await waitForReorder(page);
    assert.equal(await page.locator('#btnPlay').isVisible(),false);
    assert.equal(await page.locator('#jaText').isVisible(),false,'context appears once in scene');
    for(let i=0;i<24;i++) await page.locator(`[data-zone="bank"][data-tile-id="s0-t${i}"]`).click();
    const size=await page.locator('#composeAnswer').evaluate(node=>({height:node.clientHeight,content:node.scrollHeight}));
    assert.ok(size.height>=180);assert.ok(size.content>size.height,'long answer scrolls in workspace');
    await page.locator('#composeAnswer').evaluate(node=>node.scrollTop=node.scrollHeight);
    assert.ok(await page.locator('#composeAnswer').evaluate(node=>node.scrollTop>0));
    await page.locator('[data-zone="answer"][data-tile-id="s0-t23"]').click();
    assert.equal(await page.locator('[data-zone="bank"]').count(),1);
    await page.locator('[data-zone="bank"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/tmp/reorder-layout.png',fullPage:true});
    await page.locator('[data-action="check"]').click();
    await page.locator('[data-action="advance"]').click();
    const state=await reorderState(page);
    assert.equal(state.lastReorder.grade,'FIRST_TRY');
    await page.locator('#btnPlay').click();
    await page.waitForFunction(()=>!document.querySelector('#player').paused);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);
    assert.deepEqual(await page.evaluate(()=>window.__testSpeech.spoken),[],'source audio needs no synthesis');
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(()=>!document.querySelector('#startStudyCta').hidden);
    assert.equal(await page.evaluate(()=>document.querySelector('#player').paused),true);
    assert.equal(await page.evaluate(()=>window.__testSpeech.starts),0);
  }finally {await context.close();}
});
