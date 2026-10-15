import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {buildAutomaticSession} from '../scripts/app/adaptiveLearning.js';
import {installMockSpeechRecognition} from './helpers/mockSpeechRecognition.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const rows=JSON.parse(await fs.readFile(path.join(ROOT,'data/items.json'),'utf8'));
const version=(await fs.readFile(path.join(ROOT,'scripts/version.js'),'utf8')).match(/const APP_VERSION = '([^']+)'/)[1];
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const evidenceDir=path.join(ROOT,'docs/validation/mode-aware-session-options-evidence');
let server,browser,baseUrl,browserError;
before(async()=>{
  server=http.createServer(async(req,res)=>{
    const target=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
    if(!target.startsWith(ROOT+path.sep)) return res.writeHead(403).end();
    try{const bytes=await fs.readFile(target);res.writeHead(200,{'content-type':({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mjs':'text/javascript'})[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}).end(bytes);}catch(_){res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch(error){browserError=error.message;}
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
function browserTest(name,run){test(name,{timeout:120_000},async t=>{
  if(!browser){if(process.env.ISSUE210_REQUIRE_BROWSER) throw Error(browserError);t.skip('Chromium unavailable: '+browserError);return;}
  await run(t);
});}
async function setup({width=390,method='read',size=60,due=true}={}){
  const items=rows.slice(0,size);
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript(installMockSpeechRecognition,{stateKey:'__setupSpeech'});
  await context.addInitScript(({items,method,due})=>{
    if(!sessionStorage.getItem('__setupSeeded')){
      sessionStorage.setItem('__setupSeeded','true');
      localStorage.setItem('appConfigV3',JSON.stringify({studyMode:method}));
      localStorage.setItem('itemLevelV1',JSON.stringify(Object.fromEntries(items.map(item=>[item.id,{last:2,best:2,updatedAt:Date.now()-86400000,review:{nextDueAt:Date.now()+(due?-10000:86400000)}}]))));
      localStorage.setItem('studyLogV1','{}');
      localStorage.setItem('relationshipMilestonesV1',JSON.stringify(Object.fromEntries(['friends_5','friends_10','friends_all','best_friends_5','best_friends_10','best_friends_all'].map(id=>[id,Date.now()]))));
    }
    window.__setupErrors=[];
    window.__setupWrites=[];
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(this===localStorage) window.__setupWrites.push({key,value});
      return original.call(this,key,value);
    };
    document.addEventListener('english-pwa:prepare-focused-session',()=>{
      sessionStorage.setItem('__setupLaunches',String(Number(sessionStorage.getItem('__setupLaunches')||0)+1));
    });
  },{items,method,due});
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseUrl?route.continue():route.abort());
  await context.route('**/data/items.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(items)}));
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push('page: '+error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push('console: '+message.text());});
  await page.goto(baseUrl+'/index.html');await ready(page);
  assert.equal(await page.evaluate(()=>window.APP_VERSION),version);
  return {page,context,errors,items};
}
async function ready(page){
  await page.waitForFunction(()=>typeof window.__OPEN_SESSION_OPTIONS__==='function'&&typeof window.__OPEN_LEARNING_CHOICE__==='function'&&typeof window.__PREPARE_CHARACTER_SESSION__==='function'&&['ready','empty'].includes(window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status));
  await page.waitForFunction(()=>!document.querySelector('#loadingOverlay')?.classList.contains('show'));
}
async function open(page,method='read'){
  await page.locator('#openLearningChoice').click();
  await page.locator(`#learningChoiceDialog [data-method="${method}"]`).click();
  await page.locator('#learningChoiceDialog [data-open-session-options]').click();
  await page.locator('#playOptionsDialog[open]').waitFor();
  if(method!=='vocabulary') await page.locator('#playOptionsCharacter').selectOption('');
}
async function snapshot(page){return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).sort(([a],[b])=>a.localeCompare(b))));}
async function started(page,count,method='read'){
  await page.waitForFunction(({count,method})=>!document.querySelector('#studyView').hidden
    &&Number(document.querySelector('#statProgressTotal').textContent)===count
    &&!!document.querySelector('#enText').dataset.itemId
    &&(method!=='compose'||document.querySelector('#card').classList.contains('reorder-mode')),{count,method});
}
async function evidence(t,page,label,errors=[]){
  const state=await page.evaluate(()=>({appVersion:window.APP_VERSION,viewport:{width:innerWidth,height:innerHeight},gameMethod:document.querySelector('#playOptionsDialog')?.dataset.gameMethod,
    visibleControls:[...document.querySelectorAll('#playOptionsDialog button,#playOptionsDialog select')].filter(el=>el.checkVisibility()).map(el=>el.id||el.dataset.gameMethod||el.dataset.sessionCount||el.textContent.trim()),
    preview:document.querySelector('#playOptionsCount')?.textContent,startedCount:document.querySelector('#studyView')?.hidden?0:(Number(document.querySelector('#statProgressTotal')?.textContent)||0),
    sessionLaunchCount:Number(sessionStorage.getItem('__setupLaunches')||0),vocabularyStartedCount:document.querySelector('#vocabularyModeDialog[open] .vocab-study')?JSON.parse(localStorage.getItem('recentVocabularySessionIdsV1')||'[]').length:0,
    localStorage:Object.fromEntries(Object.entries(localStorage)),sessionStorage:Object.fromEntries(Object.entries(sessionStorage))}));
  const record={label,sourceSHA:sha,...state,errors,result:'PASS'};
  t.diagnostic('[mode-aware-browser] '+JSON.stringify(record));
  await fs.mkdir(evidenceDir,{recursive:true});await fs.writeFile(path.join(evidenceDir,label+'.json'),JSON.stringify(record,null,2));
  assert.deepEqual(errors,[]);
}
for(const width of [360,390,430]) browserTest(`mobile ${width}: navigation, mode matrix, count grid, cancel storage safety`,async t=>{
  const {page,context,errors}=await setup({width});try{
    const before=await snapshot(page);
    for(const method of ['read','compose','vocabulary']){
      await open(page,method);
      assert.equal(await page.locator('#playOptionsDialog').getAttribute('data-game-method'),method);
      assert.equal(await page.locator(`button[data-game-method="${method}"]`).getAttribute('aria-pressed'),'true');
      if(method==='vocabulary'){
        assert.equal(await page.locator('#playOptionsCharacter').isVisible(),false);
        assert.equal(await page.locator('#playOptionsCharacter').evaluate(element=>{element.focus();return document.activeElement!==element;}),true,'hidden sentence control cannot take focus');
        await page.locator('[data-vocabulary-kind="word"]').click();
      }else{
        assert.equal(await page.locator('[data-training-field]').isVisible(),method==='read');
        assert.deepEqual(await page.locator('[data-session-count]').evaluateAll(nodes=>nodes.map(x=>x.dataset.sessionCount)),['auto','5','8','12','20','30','50']);
        assert.equal(await page.locator('#playOptionsCustomCount').count(),0);
        const bounds=await page.locator('[data-session-count]').evaluateAll(nodes=>nodes.map(x=>({height:x.getBoundingClientRect().height,top:x.getBoundingClientRect().top})));
        assert.ok(bounds.every(x=>x.height>=44));assert.equal(bounds[0].top,bounds[3].top);assert.ok(bounds[4].top>bounds[3].top);
        await page.locator('[data-session-count="50"]').click();
        for(const id of ['playOptionsSkill','playOptionsSection']){
          const value=await page.locator('#'+id+' option').nth(1).getAttribute('value');
          if(value) await page.locator('#'+id).selectOption(value);
        }
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const rect=await page.locator('#playOptionsStart').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=844);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
      await page.locator('.play-options__fields').evaluate(element=>{element.scrollTop=0;});
      await evidence(t,page,`${width}-${method}`,errors);
      await page.screenshot({path:path.join(evidenceDir,`${width}-${method}.png`)});
      await page.locator('[data-cancel-setup]').click();
      await page.locator('#learningChoiceDialog[open]').waitFor();
      assert.deepEqual(await snapshot(page),before);
      await page.locator('#learningChoiceDialog .focus-sheet__close').click();
    }
    await open(page,'read');
    await page.locator('[data-training-mode="continuous_shadowing"]').click();
    for(const method of ['compose','vocabulary','read']){
      await page.locator(`button[data-game-method="${method}"]`).click();assert.equal(await page.locator('#playOptionsDialog').getAttribute('data-game-method'),method);
      assert.deepEqual(await snapshot(page),before);
    }
    assert.equal(await page.locator('[data-training-mode="standard"]').getAttribute('aria-pressed'),'true','Compose switch clears Read-only training');
    await page.keyboard.press('Escape');await page.locator('#learningChoiceDialog[open]').waitFor();assert.deepEqual(await snapshot(page),before);
    await page.locator('#learningChoiceDialog .focus-sheet__close').click();
    await open(page,'vocabulary');await page.locator('#playOptionsDialog .focus-sheet__close').click();await page.locator('#learningChoiceDialog[open]').waitFor();assert.deepEqual(await snapshot(page),before);
  }finally{await context.close();}
});
for(const count of ['auto','5','8','12','20','30','50']) browserTest(`count ${count}: preview equals real production queue`,async t=>{
  const {page,context,errors}=await setup();try{
    await open(page);await page.locator(`[data-session-count="${count}"]`).click();
    const summary=await page.locator('#playOptionsCount').innerText();const actual=Number(summary.match(/実際 (\d+)問/)[1]);
    if(count==='auto') assert.ok(actual>=6&&actual<=8);else assert.equal(actual,Number(count));
    await page.locator('#playOptionsStart').click();await started(page,actual);
    await evidence(t,page,`count-${count}`,errors);
  }finally{await context.close();}
});
browserTest('50 requested / 49 eligible starts 49 and reports one short',async t=>{
  const {page,context,errors}=await setup({size:49});try{
    await open(page);await page.locator('[data-session-count="50"]').click();
    assert.match(await page.locator('#playOptionsCount').innerText(),/有効候補 49文 · 実際 49問 · 不足 1問/);
    assert.equal(await page.locator('#playOptionsStart').innerText(),'49問で始める');
    await page.locator('#playOptionsStart').click();await started(page,49);await evidence(t,page,'shortfall-49',errors);
  }finally{await context.close();}
});
browserTest('manual real queue retains order/cap/shortfall and disables empty selection',async t=>{
  const {page,context,errors,items}=await setup();try{
    await open(page);await page.locator('[data-session-count="5"]').click();await page.locator('[data-session-mode="manual"]').click();
    assert.equal(await page.locator('#playOptionsStart').isDisabled(),true);
    for(const i of [2,0,1]) await page.locator(`#playOptionsManual input[value="${items[i].id}"]`).check();
    assert.match(await page.locator('#playOptionsCount').innerText(),/実際 3問 · 不足 2問/);
    for(const i of [3,4,5]) await page.locator(`#playOptionsManual input[value="${items[i].id}"]`).check();
    await page.locator('#playOptionsStart').click();await started(page,5);
    assert.equal(await page.locator('#enText').getAttribute('data-item-id'),items[2].id);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('recentSentenceSessionIdsV1'))),[items[2].id,items[0].id,items[1].id,items[3].id,items[4].id]);
    await evidence(t,page,'manual-order-cap',errors);
    await page.locator('#learningHomeReturn').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);
    const recentItemIds=await page.evaluate(()=>JSON.parse(localStorage.getItem('recentSentenceSessionIdsV1')));
    await page.locator('.friendship-hero__cta').click();await page.waitForFunction(()=>!document.querySelector('#studyView').hidden);
    const runtime=await page.evaluate(()=>({active:window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__,levels:JSON.parse(localStorage.getItem('itemLevelV1')),ids:JSON.parse(localStorage.getItem('recentSentenceSessionIdsV1'))}));
    const expected=buildAutomaticSession(items,runtime.levels,{scope:runtime.active?{type:'character',id:runtime.active}:null,recentItemIds});
    assert.equal(Number(await page.locator('#statProgressTotal').textContent()),expected.size);
    assert.deepEqual(runtime.ids,expected.items.map(x=>x.id).slice(0,12));
  }finally{await context.close();}
});
for(const [from,to] of [['read','compose'],['compose','read']]) browserTest(`reload ${from} to ${to}: one launch, character authority, no course replay`,async t=>{
  const {page,context,errors,items}=await setup({method:from});try{
    await open(page,from);await page.locator(`button[data-game-method="${to}"]`).click();await page.locator('[data-session-count="20"]').click();
    const character=items.flatMap(item=>item.speaker_tags||[]).map(x=>x.id).find(id=>id);
    await page.locator('#playOptionsCharacter').selectOption(character);
    const actual=Number((await page.locator('#playOptionsCount').innerText()).match(/実際 (\d+)問/)[1]);assert.ok(actual>0);
    await page.evaluate(()=>sessionStorage.setItem('englishPwaPendingGameAction','auto'));
    await Promise.all([page.waitForEvent('load'),page.locator('#playOptionsStart').click()]);await ready(page);await started(page,actual,to);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches'))),1);
    assert.equal(await page.evaluate(()=>window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__),character);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('englishPwaSessionSetupHandoff')),null);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('englishPwaPendingGameAction')),null);
    assert.equal(await page.evaluate(()=>!!window.__ENGLISH_PWA_CUSTOM_SESSION_PENDING__),false);
    await evidence(t,page,`reload-${from}-${to}`,errors);
    await page.reload();await ready(page);assert.equal(await page.locator('#studyView').isHidden(),true);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches'))),1);
  }finally{await context.close();}
});
browserTest('vocabulary draft preview is side effect free and Start uses independent 12-card authority',async t=>{
  const {page,context,errors}=await setup();try{
    const before=await snapshot(page);await open(page,'read');
    await page.locator('[data-session-count="50"]').click();await page.locator('[data-session-mode="manual"]').click();
    await page.locator('button[data-game-method="vocabulary"]').click();
    for(const kind of ['all','word','expression']){await page.locator(`[data-vocabulary-kind="${kind}"]`).click();assert.deepEqual(await snapshot(page),before);}
    await page.locator('[data-vocabulary-kind="all"]').click();
    const preview=await page.evaluate(()=>window.__VOCABULARY_SESSION_SETUP__.createDraft().preview());assert.ok(preview.plan.size>0&&preview.plan.size<=12);
    await page.locator('#playOptionsStart').click();await page.locator('#vocabularyModeDialog[open] .vocab-study').waitFor();
    assert.equal(await page.locator('.vocab-lobby:visible').count(),0);assert.equal(await page.locator('#studyView').isHidden(),true);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('appConfigV3')).studyMode),'read');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('recentVocabularySessionIdsV1')).length),preview.plan.size);
    assert.equal(await page.evaluate(()=>Number(localStorage.getItem('vocabularyRotationSeedV1'))),1);
    await evidence(t,page,'vocabulary-direct',errors);
    await page.locator('#vocabularyModeDialog .vocab-close').click();assert.equal(await page.locator('#homeView').isVisible(),true);
  }finally{await context.close();}
});
for(const invalid of ['expired','invalid','duplicate']) browserTest(`handoff ${invalid} rejected in real boot; pending course cannot launch`,async t=>{
  const {page,context,errors}=await setup();try{
    await page.evaluate(async invalid=>{
      const mod=await import('./scripts/app/sessionSetupHandoff.js');
      const payload=mod.createSetupHandoff({gameMethod:'read',options:{count:'5'},appVersion:window.APP_VERSION,nonce:'replayed-nonce'});
      if(invalid==='expired') payload.createdAt-=mod.SETUP_HANDOFF_TTL+1;
      if(invalid==='invalid') payload.gameMethod='vocabulary';
      if(invalid==='duplicate') sessionStorage.setItem(mod.SETUP_RECEIPT_KEY,JSON.stringify({[payload.nonce]:Date.now()}));
      sessionStorage.setItem(mod.SETUP_HANDOFF_KEY,JSON.stringify(payload));sessionStorage.setItem('englishPwaPendingGameAction','auto');
    },invalid);
    await page.reload();await ready(page);
    await page.waitForFunction(()=>sessionStorage.getItem('englishPwaSessionSetupHandoff')===null);
    assert.equal(await page.locator('#studyView').isHidden(),true);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('englishPwaSessionSetupHandoff')),null);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('englishPwaPendingGameAction')),null);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches')||0)),0);
    await evidence(t,page,'reject-'+invalid,errors);
  }finally{await context.close();}
});
browserTest('legacy nonmatching custom count restores with notice; exact fixed custom maps once',async t=>{
  const {page,context,errors}=await setup();try{
    await page.evaluate(()=>window.__OPEN_SESSION_OPTIONS__({count:'custom',customCount:17}));
    assert.match(await page.locator('#playOptionsNotice').innerText(),/おまかせ/);assert.equal(await page.locator('[data-session-count="auto"]').getAttribute('aria-pressed'),'true');
    await page.locator('button[data-game-method="compose"]').click();assert.equal(await page.locator('#playOptionsNotice').count(),1);
    await page.locator('[data-cancel-setup]').click();await page.locator('#learningChoiceDialog .focus-sheet__close').click();
    await page.evaluate(()=>window.__OPEN_SESSION_OPTIONS__({count:'custom',customCount:20}));assert.equal(await page.locator('[data-session-count="20"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#playOptionsNotice').innerText(),'');
    await evidence(t,page,'legacy-custom',errors);
  }finally{await context.close();}
});

browserTest('pending Start cannot launch a cancelled/reopened or edited setup draft',async t=>{
  const {page,context,errors}=await setup();try{
    await open(page);await page.locator('[data-session-count="5"]').click();
    await page.evaluate(()=>{window.__setupClear=window.__CLEAR_ACTIVE_CHARACTER_SESSION__;delete window.__CLEAR_ACTIVE_CHARACTER_SESSION__;});
    await page.locator('#playOptionsStart').click();await page.locator('[data-cancel-setup]').click();
    await page.locator('#learningChoiceDialog [data-open-session-options]').click();
    await page.evaluate(()=>{window.__CLEAR_ACTIVE_CHARACTER_SESSION__=window.__setupClear;});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#playOptionsDialog[open]').count(),1);assert.equal(await page.locator('#studyView').isHidden(),true);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches')||0)),0);
    await page.evaluate(()=>{delete window.__CLEAR_ACTIVE_CHARACTER_SESSION__;});
    await page.locator('#playOptionsStart').click();await page.locator('button[data-game-method="vocabulary"]').click();
    await page.evaluate(()=>{window.__CLEAR_ACTIVE_CHARACTER_SESSION__=window.__setupClear;});await page.waitForTimeout(100);
    assert.equal(await page.locator('#playOptionsDialog[open]').count(),1);assert.equal(await page.locator('#vocabularyModeDialog[open]').count(),0);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches')||0)),0);
    await evidence(t,page,'cancel-pending-start',errors);
  }finally{await context.close();}
});

browserTest('new setup Start preserves Issue #342 interim-only finality and SRS/study-log integrity',async t=>{
  const {page,context,errors,items}=await setup();try{
    await open(page);await page.locator('[data-session-mode="manual"]').click();
    await page.locator(`#playOptionsManual input[value="${items[0].id}"]`).check();await page.locator('#playOptionsStart').click();await started(page,1);
    const before=await snapshot(page);
    await page.waitForFunction(()=>!document.querySelector('#btnMic').disabled);
    await page.locator('#btnMic').click();await page.waitForFunction(()=>window.__setupSpeech?.latest?.lifecycleState==='active');
    const attempt=await page.evaluate(text=>{const mock=window.__setupSpeech.latest;mock.emitInterim(text);return mock.attemptId;},items[0].en);
    await page.locator('#btnMic').click({force:true});
    await page.waitForFunction(attempt=>window.__setupSpeech.events.some(e=>e.attemptId===attempt&&e.type==='end')&&document.querySelector('#micStatus').dataset.state==='off',attempt);
    const after=await snapshot(page);assert.equal(after.itemLevelV1,before.itemLevelV1);assert.equal(after.studyLogV1,before.studyLogV1);
    assert.equal(await page.locator('#valMatch').textContent(),'—');assert.equal(await page.locator('#enText').getAttribute('data-item-id'),items[0].id);assert.equal(await page.locator('#reviewCompleteView').isHidden(),true);
    await evidence(t,page,'issue342-interim',errors);
  }finally{await context.close();}
});

browserTest('zero-candidate filters disable actual Start and expose a recovery action',async t=>{
  const {page,context,errors}=await setup();try{
    const before=await snapshot(page);
    await page.evaluate(()=>window.__OPEN_SESSION_OPTIONS__({section:'Section999',count:'50'}));
    assert.equal(await page.locator('#playOptionsStart').isDisabled(),true);
    assert.match(await page.locator('#playOptionsCount').innerText(),/実際 0問/);
    assert.match(await page.locator('#playOptionsCauses').innerText(),/条件に合う文がありません/);
    await page.locator('.play-options__cause').first().click();assert.equal(await page.locator('#playOptionsStart').isDisabled(),false);
    await page.locator('button[data-game-method="compose"]').click();assert.equal(await page.locator('[data-training-field]').isVisible(),false);
    await page.locator('button[data-game-method="read"]').click();assert.equal(await page.locator('[data-training-mode="standard"]').getAttribute('aria-pressed'),'true');
    assert.deepEqual(await snapshot(page),before);await evidence(t,page,'zero-recovery',errors);
  }finally{await context.close();}
});

browserTest('preview and Start share all prior-session IDs beyond the persisted 12-ID recent window',async t=>{
  const {page,context,errors}=await setup({due:false});try{
    await open(page);await page.locator('[data-session-count="20"]').click();await page.locator('#playOptionsStart').click();await started(page,20);
    await page.locator('#learningHomeReturn').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);
    await open(page);await page.locator('[data-session-count="50"]').click();
    assert.match(await page.locator('#playOptionsCount').innerText(),/実際 40問 · 不足 10問/);
    assert.equal(await page.locator('#playOptionsStart').innerText(),'40問で始める');
    await page.locator('#playOptionsStart').click();await started(page,40);await evidence(t,page,'recent-window-alignment',errors);
  }finally{await context.close();}
});

for(const [from,to] of [['read','compose'],['compose','read']]) browserTest(`reload ${from} to ${to}: preview uses persisted recency after a prior 20-question session`,async t=>{
  const {page,context,errors}=await setup({method:from,due:false});try{
    await open(page,from);await page.locator('[data-session-count="20"]').click();await page.locator('#playOptionsStart').click();await started(page,20,from);
    await page.locator('#learningHomeReturn').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);
    await open(page,from);await page.locator(`button[data-game-method="${to}"]`).click();await page.locator('[data-session-count="50"]').click();
    assert.match(await page.locator('#playOptionsCount').innerText(),/実際 48問 · 不足 2問/);
    await Promise.all([page.waitForEvent('load'),page.locator('#playOptionsStart').click()]);await ready(page);await started(page,48,to);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('__setupLaunches'))),2);
    await evidence(t,page,`recent-reload-${from}-${to}`,errors);
  }finally{await context.close();}
});
