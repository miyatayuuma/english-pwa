import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MODULES=['relationshipMode','learningMenu','vocabularyMode'];
const PERMUTATIONS=[
  ['relationshipMode','learningMenu','vocabularyMode'],
  ['relationshipMode','vocabularyMode','learningMenu'],
  ['learningMenu','relationshipMode','vocabularyMode'],
  ['learningMenu','vocabularyMode','relationshipMode'],
  ['vocabularyMode','relationshipMode','learningMenu'],
  ['vocabularyMode','learningMenu','relationshipMode'],
];
let server,baseUrl,browser,browserError='';

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

function mimeType(file){
  return ({
    '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json',
    '.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.m4a':'audio/mp4',
  })[path.extname(file).toLowerCase()]||'application/octet-stream';
}

before(async()=>{
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=path.resolve(ROOT,`.${pathname==='/'?'/index.html':pathname}`);
      if(file!==ROOT&&!file.startsWith(`${ROOT}${path.sep}`)){res.statusCode=403;res.end();return;}
      res.setHeader('content-type',mimeType(file));
      res.setHeader('cache-control','no-store');
      res.end(await fs.readFile(file));
    }catch(_){res.statusCode=404;res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}
  catch(error){
    browserError=error.message;
    if(process.env.HOME_NAV_REQUIRE_BROWSER==='1') throw error;
  }
});

after(async()=>{
  await browser?.close();
  await new Promise(resolve=>server?.close(resolve));
});

function browserRequired(t){
  if(browser) return true;
  t.skip(`Chromium unavailable${browserError?`: ${browserError.split('\n')[0]}`:''}`);
  return false;
}

async function waitForCoreHome(page){
  await page.waitForFunction(()=>{
    const nav=document.getElementById('focusHomeNav');
    return nav?.dataset.homeNavigationReady==='true'
      &&typeof window.__OPEN_SESSION_OPTIONS__==='function'
      &&typeof window.__OPEN_ENGLISH_LEARNING_BROWSER__==='function';
  });
}

async function waitForSettledHome(page,{requireHero=true}={}){
  await waitForCoreHome(page);
  await page.waitForFunction(requireHero=>{
    const state=window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status;
    return ['ready','empty','error'].includes(state)
      &&(!requireHero||!!document.getElementById('friendshipHero'));
  },requireHero);
}

async function newContextPage({viewport={width:390,height:844},failVocabulary=false,failCharacters=false,emptyVocabulary=false,beforeNavigate=null}={}){
  const context=await browser.newContext({viewport,colorScheme:'dark',reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await context.addInitScript(()=>{
    window.__homeNavigationLifecycle=[];
    for(const name of ['english-pwa:home-navigation-action-registered','english-pwa:home-navigation-action-activated','english-pwa:vocabulary-mode-state']){
      document.addEventListener(name,event=>window.__homeNavigationLifecycle.push({name,detail:event.detail||null}));
    }
  });
  if(failVocabulary) await page.route('**/data/vocabulary-v3.json',route=>route.fulfill({status:503,body:'unavailable'}));
  if(failCharacters) await page.route('**/data/characters.json',route=>route.fulfill({status:503,body:'unavailable'}));
  if(emptyVocabulary) await page.route('**/data/vocabulary-v3.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema_version:3,entries:[]})}));
  if(beforeNavigate) await beforeNavigate(page);
  await page.goto(`${baseUrl}/index.html`,{waitUntil:'domcontentloaded'});
  return {context,page,pageErrors};
}

async function getPrimaryState(page){
  return page.evaluate(()=>{
    const visible=element=>{
      if(!element||element.disabled||element.hidden) return false;
      const style=getComputedStyle(element);const rect=element.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
    };
    const nav=document.getElementById('focusHomeNav');
    const hero=document.querySelector('.friendship-hero__cta');
    const legacy=document.getElementById('startStudyCta');
    const actions=[hero,legacy,...(nav?[...nav.children]:[])].filter(visible);
    return {
      actionCount:actions.length,
      navIds:nav?[...nav.children].map(node=>node.id):[],
      navClasses:nav?[...nav.classList]:[],
      gridColumns:nav?getComputedStyle(nav).gridTemplateColumns.split(' ').filter(Boolean).length:0,
      widths:{viewport:innerWidth,document:document.documentElement.scrollWidth},
      primaryVisible:actions.map(node=>({id:node.id||node.className,text:node.textContent.trim()})),
      navTextFits:nav?[...nav.children].every(node=>node.scrollWidth<=node.clientWidth+1):false,
      heroBottom:hero?.getBoundingClientRect().bottom??null,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      darkScheme:matchMedia('(prefers-color-scheme: dark)').matches,
    };
  });
}

async function settledPage(options={}){
  const {requireHero=true,...pageOptions}=options;
  const result=await newContextPage(pageOptions);
  await waitForSettledHome(result.page,{requireHero});
  return result;
}

test('all six module initialization orders converge to the same owned two-button lobby', {timeout:120000}, async t=>{
  if(!browserRequired(t)) return;
  const snapshots=[];
  for(const order of PERMUTATIONS){
    const arrivals=new Map(MODULES.map(name=>[name,deferred()]));
    const releases=new Map(MODULES.map(name=>[name,deferred()]));
    const {context,page,pageErrors}=await newContextPage({beforeNavigate:async page=>{
      for(const name of MODULES){
        await page.route(`**/scripts/app/${name}.js`,async route=>{
          arrivals.get(name).resolve();
          await releases.get(name).promise;
          await route.continue();
        });
      }
    }});
    try{
      await Promise.all(MODULES.map(name=>arrivals.get(name).promise));
      for(const name of order){
        releases.get(name).resolve();
        if(name==='relationshipMode') await page.waitForFunction(()=>!!document.getElementById('openCharacterContacts')&&!document.getElementById('openCharacterContacts').disabled);
        if(name==='learningMenu') await page.waitForFunction(()=>typeof window.__OPEN_LEARNING_CHOICE__==='function');
        if(name==='vocabularyMode') await page.waitForFunction(()=>['ready','empty','error'].includes(window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status));
      }
      await waitForSettledHome(page);
      const state=await getPrimaryState(page);
      assert.deepEqual(state.navIds,['openCharacterContacts','openLearningChoice'],`settled nav after ${order.join(' → ')}`);
      assert.equal(state.actionCount,3,`hero plus two primary routes after ${order.join(' → ')}`);
      assert.equal(state.gridColumns,2);
      assert.equal(state.navClasses.includes('has-vocab-mode'),false);
      assert.equal(state.navClasses.includes('learning-nav'),false);
      assert.equal(state.navClasses.includes('friendship-nav'),false);
      assert.equal(state.widths.document,state.widths.viewport);
      assert.equal(state.navTextFits,true);
      assert.ok(state.heroBottom<=844);
      assert.equal(state.reducedMotion,true);
      assert.equal(state.darkScheme,true);
      assert.deepEqual(pageErrors,[]);
      snapshots.push({order:order.join(' → '),state});
    }finally{await context.close();}
  }
  assert.equal(new Set(snapshots.map(value=>JSON.stringify(value.state.navIds))).size,1);
});

test('mobile lobby meets the 360/390/430px three-action contract and captures after screenshots', {timeout:90000}, async t=>{
  if(!browserRequired(t)) return;
  const outputDir=path.join(ROOT,'docs/validation/issue337-evidence');
  if(process.env.HOME_NAV_CAPTURE==='1') await fs.mkdir(outputDir,{recursive:true});
  for(const width of [360,390,430]){
    const {context,page,pageErrors}=await settledPage({viewport:{width,height:844}});
    try{
      const state=await getPrimaryState(page);
      assert.deepEqual(state.navIds,['openCharacterContacts','openLearningChoice']);
      assert.equal(state.actionCount,3);
      assert.equal(state.gridColumns,2);
      assert.equal(state.widths.document,width);
      assert.equal(state.navTextFits,true);
      assert.ok(state.heroBottom<=844);
      assert.equal(state.reducedMotion,true);
      assert.equal(state.darkScheme,true);
      assert.deepEqual(pageErrors,[]);
      if(process.env.HOME_NAV_CAPTURE==='1') await page.screenshot({path:path.join(outputDir,`home-${width}-after.png`),fullPage:false});
    }finally{await context.close();}
  }
});

test('secondary navigation opens contacts, vocabulary, detailed options, and range selection without SRS writes', {timeout:90000}, async t=>{
  if(!browserRequired(t)) return;
  const {context,page,pageErrors}=await settledPage();
  try{
    const protectedState=await page.evaluate(()=>Object.fromEntries(['itemLevelV1','studyLogV1','recentSentenceSessionIdsV1','recentVocabularySessionIdsV1','relationshipMilestonesV1'].map(key=>[key,localStorage.getItem(key)])));

    await page.locator('#openCharacterContacts').click();
    await page.waitForFunction(()=>document.getElementById('tagBrowserDialog')?.open===true);
    assert.match(await page.locator('#tagBrowserDialog h2').innerText(),/連絡先/);
    await page.locator('#tagBrowserDialog .tag-browser__close').click();

    await page.locator('#openLearningChoice').click();
    await page.locator('#learningChoiceDialog [data-method="vocabulary"]').click();
    assert.equal(await page.locator('#learningChoiceDialog .learning-choice__start').isEnabled(),true);
    await page.locator('#learningChoiceDialog .learning-choice__start').click();
    await page.waitForFunction(()=>document.getElementById('vocabularyModeDialog')?.open===true);
    await page.locator('#vocabularyModeDialog .vocab-close').click();

    await page.locator('#openLearningChoice').click();
    assert.equal(await page.locator('#learningChoiceDialog [data-open-session-options]').isEnabled(),true);
    await page.locator('#learningChoiceDialog [data-open-session-options]').click();
    await page.waitForFunction(()=>document.getElementById('playOptionsDialog')?.open===true);
    for(const id of ['playOptionsCharacter','playOptionsSkill','playOptionsSection','playOptionsCount','playOptionsMode']){
      if(id==='playOptionsCount') assert.ok(await page.locator('#playOptionsDialog [data-session-count]').count()>0);
      else if(id==='playOptionsMode') assert.ok(await page.locator('#playOptionsDialog [data-session-mode]').count()>0);
      else assert.ok(await page.locator(`#playOptionsDialog #${id}`).count()>0);
    }
    await page.locator('#playOptionsDialog .focus-sheet__close').click();
    await page.waitForFunction(()=>document.getElementById('learningChoiceDialog')?.open===true);
    assert.equal(await page.locator('#studyView').isHidden(),true,'closing details returns to chooser without starting');
    await page.locator('#learningChoiceDialog [data-course="explore"]').click();
    await page.locator('#learningChoiceDialog .learning-choice__start').click();
    await page.waitForFunction(()=>document.getElementById('focusExploreDialog')?.open===true);
    assert.ok(await page.locator('#focusExploreDialog #secSel').count()>0);
    await page.locator('#focusExploreDialog .focus-sheet__close').click();

    await page.locator('#openLearningChoice').click();
    await page.locator('#learningChoiceDialog [data-course="tag"]').click();
    await page.locator('#learningChoiceDialog .learning-choice__start').click();
    await page.waitForFunction(()=>document.getElementById('tagBrowserDialog')?.open===true);
    assert.ok(await page.locator('#tagBrowserDialog .tag-browser__tab').count()>0);
    await page.locator('#tagBrowserDialog .tag-browser__close').click();

    const finalProtectedState=await page.evaluate(()=>Object.fromEntries(['itemLevelV1','studyLogV1','recentSentenceSessionIdsV1','recentVocabularySessionIdsV1','relationshipMilestonesV1'].map(key=>[key,localStorage.getItem(key)])));
    assert.deepEqual(finalProtectedState,protectedState,'opening/closing navigation and dialogs does not change SRS, study history, or relationship state');

    const navBefore=await getPrimaryState(page);
    await page.evaluate(async()=>{
      const owner=await import('./scripts/app/homeNavigation.js');
      const open=window.__OPEN_LEARNING_CHOICE__;
      document.addEventListener('english-pwa:home-navigation-action-activated',event=>{
        if(event.detail?.id==='learning') window.__learningActionCount=(window.__learningActionCount||0)+1;
      });
      owner.registerHomeNavigationAction('learning',{label:'遊び方を選ぶ',ready:true,onActivate:open});
      for(let index=0;index<12;index+=1) owner.renderHomeNavigation();
      document.getElementById('focusHomeNav').classList.add('friendship-nav','learning-nav','has-vocab-mode');
      owner.renderHomeNavigation();
      owner.setHomeNavigationCapability('relationship',{ready:true,allFriends:true});
      owner.registerHomeNavigationAction('everyone',{label:'みんなと遊ぶ',ready:true,onActivate:()=>{window.__everyoneActionCount=(window.__everyoneActionCount||0)+1;return true;}});
    });
    await page.locator('#openLearningChoice').click();
    assert.equal(await page.locator('#learningChoiceDialog [data-start-everyone]').isVisible(),true,'みんなと遊ぶ stays reachable in the secondary menu when its relationship condition is met');
    await page.locator('#learningChoiceDialog [data-start-everyone]').click();
    assert.equal(await page.evaluate(()=>window.__everyoneActionCount),1);
    await page.locator('#openLearningChoice').click();
    await page.locator('#openLearningChoice').evaluate(node=>node.click());
    assert.equal(await page.evaluate(()=>window.__learningActionCount),3,'three taps after repeated render/registration trigger exactly three activations');
    const navAfter=await getPrimaryState(page);
    assert.deepEqual(navAfter.navIds,navBefore.navIds);
    assert.equal(navAfter.actionCount,3);
    assert.equal(navAfter.navClasses.includes('has-vocab-mode'),false);
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettledHome(page);
    assert.deepEqual((await getPrimaryState(page)).navIds,['openCharacterContacts','openLearningChoice'],'browser refresh restores the stable owner-rendered nav');
    const homeCharacterId=await page.evaluate(()=>window.__ENGLISH_PWA_HOME_CHARACTER_ID__);
    await page.evaluate(()=>{window.__issue337PreviousHeroCta=document.querySelector('.friendship-hero__cta');});
    await page.locator('#openCharacterContacts').click();
    await page.waitForFunction(()=>document.getElementById('tagBrowserDialog')?.open===true&&document.querySelectorAll('#tagBrowserDialog .tag-browser__card--person').length>1);
    await page.evaluate(characterId=>{
      const alternative=[...document.querySelectorAll('#tagBrowserDialog .tag-browser__card--person')]
        .find(card=>!card.getAttribute('aria-label')?.startsWith(document.querySelector('.friendship-hero__name')?.textContent||''));
      if(!alternative) throw new Error('No alternate character card was available');
      alternative.click();
    },homeCharacterId);
    await page.locator('#tagBrowserDialog .tag-browser__detail-actions .tag-browser__start').click();
    await page.waitForFunction(previousId=>!document.getElementById('studyView')?.hidden
      &&!!window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__
      &&window.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__!==previousId,homeCharacterId);
    assert.deepEqual(await page.locator('#focusHomeNav').evaluate(nav=>[...nav.children].map(node=>node.id)),['openCharacterContacts','openLearningChoice']);
    await page.evaluate(()=>{
      document.getElementById('studyView').hidden=true;
      document.getElementById('reviewCompleteView').hidden=false;
      document.getElementById('reviewActionFinish').click();
    });
    await page.waitForFunction(()=>!document.getElementById('homeView')?.hidden
      &&document.getElementById('studyView')?.hidden
      &&document.getElementById('reviewCompleteView')?.hidden
      &&document.querySelector('.friendship-hero__cta')!==window.__issue337PreviousHeroCta);
    await page.evaluate(()=>{
      window.__issue337PreviousHeroCta=document.querySelector('.friendship-hero__cta');
      const home=document.getElementById('homeView');home.hidden=true;home.hidden=false;
      document.dispatchEvent(new CustomEvent('english-pwa:relationship-updated'));
    });
    await page.waitForFunction(()=>document.querySelector('.friendship-hero__cta')!==window.__issue337PreviousHeroCta);
    assert.deepEqual((await getPrimaryState(page)).navIds,['openCharacterContacts','openLearningChoice']);
    assert.equal((await getPrimaryState(page)).actionCount,3);
    assert.deepEqual(pageErrors,[]);
  }finally{await context.close();}
});

test('delayed and failed vocabulary loads report state without hiding or losing the secondary route', {timeout:90000}, async t=>{
  if(!browserRequired(t)) return;
  const dataRequested=deferred();const releaseData=deferred();
  const {context,page,pageErrors}=await newContextPage({beforeNavigate:async page=>page.route('**/data/vocabulary-v3.json',async route=>{
    dataRequested.resolve();
    await releaseData.promise;
    await route.continue();
  })});
  try{
    await waitForCoreHome(page);
    await dataRequested.promise;
    await page.locator('#openLearningChoice').click();
    await page.locator('#learningChoiceDialog [data-method="vocabulary"]').click();
    assert.equal(await page.locator('#learningChoiceDialog .learning-choice__start').isEnabled(),false);
    assert.match(await page.locator('#learningChoiceDialog .learning-choice__summary').innerText(),/準備|読み込み/);
    releaseData.resolve();
    await page.waitForFunction(()=>window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status==='ready');
    await page.waitForFunction(()=>document.querySelector('#learningChoiceDialog .learning-choice__start')?.disabled===false);
    await page.locator('#learningChoiceDialog .learning-choice__start').click();
    await page.waitForFunction(()=>document.getElementById('vocabularyModeDialog')?.open===true);
    assert.deepEqual((await getPrimaryState(page)).navIds,['openCharacterContacts','openLearningChoice']);
    await page.locator('#vocabularyModeDialog .vocab-close').click();

    const failed=await settledPage({failVocabulary:true,failCharacters:true,requireHero:false});
    try{
      const state=await getPrimaryState(failed.page);
      assert.deepEqual(state.navIds,['openCharacterContacts','openLearningChoice']);
      assert.ok(state.actionCount<=3);
      assert.equal(await failed.page.evaluate(()=>window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status),'error');
      await failed.page.locator('#openLearningChoice').click();
      await failed.page.locator('#learningChoiceDialog [data-method="vocabulary"]').click();
      assert.equal(await failed.page.locator('#learningChoiceDialog .learning-choice__start').isEnabled(),false);
      assert.match(await failed.page.locator('#learningChoiceDialog .learning-choice__summary').innerText(),/読み込めません|再読み込み/);
      await failed.page.locator('#learningChoiceDialog .focus-sheet__close').click();
      await failed.page.locator('#openCharacterContacts').click();
      await failed.page.waitForFunction(()=>document.querySelector('#tagBrowserDialog .tag-browser__error'));
      assert.deepEqual(failed.pageErrors,[]);
    }finally{await failed.context.close();}

    const empty=await settledPage({emptyVocabulary:true});
    try{
      assert.equal(await empty.page.evaluate(()=>window.__ENGLISH_PWA_VOCABULARY_STATUS__?.status),'empty');
      await empty.page.locator('#openLearningChoice').click();
      await empty.page.locator('#learningChoiceDialog [data-method="vocabulary"]').click();
      assert.equal(await empty.page.locator('#learningChoiceDialog .learning-choice__start').isEnabled(),false);
      assert.match(await empty.page.locator('#learningChoiceDialog .learning-choice__summary').innerText(),/教材がありません/);
      assert.deepEqual(empty.pageErrors,[]);
    }finally{await empty.context.close();}
  }finally{await context.close();}
});
