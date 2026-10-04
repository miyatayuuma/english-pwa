import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve(new URL('..',import.meta.url).pathname);
let browser,server,url;
before(async()=>{
  server=http.createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,'http://localhost').pathname;
      const file=path.join(root,name==='/'?'index.html':name);
      res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');
      res.end(await fs.readFile(file));
    }catch(_){res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch(error){if(process.env.REORDER_REQUIRE_BROWSER)throw error;}
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
async function open(existing=false){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.addInitScript(existing=>{
    window.__permissionCalls=0;
    Object.defineProperty(window,'Notification',{value:class{static permission='default';static requestPermission(){window.__permissionCalls++;return Promise.resolve('denied');}},configurable:true});
    if(existing){
      localStorage.setItem('appConfigV3',JSON.stringify({studyMode:'compose',apiUrl:'https://script.google.com/legacy',apiKey:'secret',audioBase:'https://old-audio.example',playbackMode:'speech',speechVoice:'old',milestoneIntensity:'strong',resultSound:'off'}));
      localStorage.setItem('itemLevelV1',JSON.stringify({E0001:{last:3,best:4,review:{nextDueAt:123}}}));
      localStorage.setItem('studyLogV1','{}');localStorage.setItem('audioSpeedV1','1.25');localStorage.setItem('dailyGoalV1','18');localStorage.setItem('sessionGoalV1','8');
      localStorage.setItem('onboardingPlanV1',JSON.stringify({dailyGoal:1,sessionGoal:1,section:'Section23',levelFilters:[5],order:'rnd'}));
      for(const key of ['pendingLogsV1','hasCompletedOnboardingV1','onboardingPlanCollapseDateV1','notifSettingsV1'])localStorage.setItem(key,'legacy');
    }
  },existing);
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const remote=[];page.on('request',req=>{if(/script.google.com|old-audio.example/.test(req.url()))remote.push(req.url());});
  if(existing){
    await page.goto(url+'/seed');
    await page.evaluate(async()=>{
      const handle=await navigator.storage.getDirectory();
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('fs-handles',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('dir');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result;const tx=db.transaction('dir','readwrite');tx.objectStore('dir').put(handle,'audio');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
      });
    });
  }
  await page.goto(url+'/index.html');
  await page.waitForFunction(()=>window.ALL_ITEMS?.length && document.querySelector('#sessionShellStyles') && typeof window.__OPEN_SESSION_OPTIONS__==='function');
  await page.waitForFunction(()=>!document.querySelector('#loadingOverlay')?.classList.contains('show'));
  return {context,page,errors,remote};
}
function browserTest(name,run){test(name,async t=>{if(!browser)return t.skip('Chromium unavailable');await run();});}
browserTest('fresh install opens home without questionnaire/permissions and starts adaptive learning',async()=>{
  const {context,page,errors}=await open();try{
    assert.equal(await page.locator('#homeView').isVisible(),true);
    assert.equal(await page.locator('#onboardingCard').count(),0);
    assert.equal(await page.evaluate(()=>window.__permissionCalls),0);
    await page.locator('#btnCfg').click();
    assert.deepEqual(await page.locator('#cfgBox button').evaluateAll(nodes=>nodes.map(node=>node.id)),['btnPickDir','btnClearDir','cfgClose']);
    assert.equal(await page.locator('#cfgBox input,#cfgBox select').count(),0);
    const version=await page.locator('#cfgBox [data-app-version]').innerText();
    assert.equal(version,await page.evaluate(()=>`バージョン: ${window.APP_VERSION}`));
    assert.ok(version.trim());
    await page.locator('#cfgClose').click();await page.locator('.friendship-hero__cta').click();
    await page.waitForFunction(()=>!document.querySelector('#studyView').hidden&&Number(document.querySelector('#statProgressTotal').textContent)>0);
    assert.equal(await page.evaluate(()=>window.__permissionCalls),0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
browserTest('existing migration preserves progress/method/speed/goals without replaying old onboarding or GAS',async()=>{
  const {context,page,errors,remote}=await open(true);try{
    const state=await page.evaluate(()=>({cfg:JSON.parse(localStorage.getItem('appConfigV3')),level:JSON.parse(localStorage.getItem('itemLevelV1')),goal:localStorage.getItem('dailyGoalV1'),session:localStorage.getItem('sessionGoalV1'),speed:localStorage.getItem('audioSpeedV1'),retired:['pendingLogsV1','onboardingPlanV1','hasCompletedOnboardingV1','notifSettingsV1'].map(key=>localStorage.getItem(key))}));
    assert.deepEqual(state.cfg,{studyMode:'compose'});assert.equal(state.level.E0001.best,4);assert.equal(state.level.E0001.review.nextDueAt,123);
    assert.equal(state.goal,'18');assert.equal(state.session,'8');assert.equal(state.speed,'1.25');assert.deepEqual(state.retired,[null,null,null,null]);
    assert.equal(await page.evaluate(async()=>{
      const expected=await navigator.storage.getDirectory();
      const saved=await new Promise((resolve,reject)=>{const request=indexedDB.open('fs-handles',1);request.onsuccess=()=>{const db=request.result;const read=db.transaction('dir','readonly').objectStore('dir').get('audio');read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>reject(read.error);};request.onerror=()=>reject(request.error);});
      return saved?.kind==='directory' && await saved.isSameEntry(expected);
    }),true,'selected browser directory identity survives the migration');
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__permissionCalls),0);
  }finally{await context.close();}
});
for(const [count,custom,size] of [['5',null,5],['8',null,8],['12',null,12],['custom',17,17]])browserTest(`normal session options create actual QUEUE of ${size}`,async()=>{
  const {context,page,errors}=await open();try{
    await page.evaluate(()=>window.__OPEN_SESSION_OPTIONS__());
    await page.locator(`[data-session-count="${count}"]`).click();
    if(custom)await page.locator('#playOptionsCustomCount').fill(String(custom));
    await page.locator('#playOptionsStart').click();
    await page.waitForFunction(size=>!document.querySelector('#studyView').hidden&&Number(document.querySelector('#statProgressTotal').textContent)===size,size);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
