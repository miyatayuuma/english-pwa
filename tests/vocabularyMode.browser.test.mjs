import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vocabulary=JSON.parse(await fs.readFile(path.join(ROOT,'data/vocabulary-v3.json'),'utf8'));
const items=JSON.parse(await fs.readFile(path.join(ROOT,'data/items.json'),'utf8'));
const itemById=new Map(items.map(item=>[String(item.id),item]));
let server,baseUrl,browser,browserError='';
const sources=[
  {kind:'expression',canonical:'come across someone',itemId:'E0524'},
  {kind:'word',canonical:'faint',itemId:'E0125'},
  {kind:'construction',canonical:'make someone do something',itemId:'E0130'},
  {kind:'word',canonical:'despite',itemId:'E0088'},
];
const fixtureFor=source=>vocabulary.entries.find(entry=>entry.kind===source.kind&&entry.canonical===source.canonical&&entry.occurrences.some(occurrence=>occurrence.item_id===source.itemId));
const sourceSurface=(entry,itemId)=>{const occurrence=entry.occurrences.find(value=>String(value.item_id)===String(itemId));const item=itemById.get(String(itemId));return occurrence&&item?item.en.slice(occurrence.start,occurrence.end):''};

async function newPage(source,{reducedMotion='reduce',entryState:entryStateOverride=null}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion});
  const entry=JSON.parse(JSON.stringify(fixtureFor(source)));
  assert.ok(entry,`fixture ${source.kind}/${source.canonical} exists`);
  const entryState=entryStateOverride||{last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0};
  await context.addInitScript(({entry,source,entryState})=>{
    const initial={
      [source.itemId]:{last:2,best:2,updatedAt:1700000000000},
      [entry.id]:entryState,
    };
    localStorage.setItem('itemLevelV1',JSON.stringify(initial));
    localStorage.setItem('appConfigV3',JSON.stringify({audioBase:`${location.origin}/mock-audio`,playbackMode:'audio'}));
    window.__vocabularyFixture__=entry;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const raw=typeof input==='string'?input:input?.url||String(input||'');
      const url=new URL(raw,location.href);
      if(url.pathname.endsWith('/data/vocabulary-v3.json')){
        return Promise.resolve(new Response(JSON.stringify({schema_version:3,entries:[window.__vocabularyFixture__]}),{status:200,headers:{'content-type':'application/json'}}));
      }
      return nativeFetch(input,init);
    };
    window.__mockSpeech={latest:null,spoken:[],audioPlayed:[]};
    class MockRecognition{
      constructor(){window.__mockSpeech.latest=this;}
      start(){this.onstart?.();}
      stop(){this.onend?.();}
      inject(text){
        const result=Object.assign([{transcript:String(text)}],{isFinal:true});
        this.onresult?.({resultIndex:0,results:[result]});
      }
    }
    Object.defineProperty(window,'SpeechRecognition',{value:MockRecognition,configurable:true});
    class MockUtterance{constructor(text){this.text=text;}}
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:MockUtterance,configurable:true});
    Object.defineProperty(window,'speechSynthesis',{value:{
      getVoices:()=>[{name:'English US',lang:'en-US',voiceURI:'mock-en-us',localService:true}],
      speak:utterance=>{window.__mockSpeech.spoken.push(utterance.text);utterance.onstart?.();utterance.onend?.();},
      cancel:()=>{},
      addEventListener:()=>{},
    },configurable:true});
    window.Audio=class MockAudio{
      constructor(url){this.url=String(url);}
      play(){window.__mockSpeech.audioPlayed.push(this.url);return Promise.resolve();}
      pause(){}
    };
  },{entry,source,entryState});
  const page=await context.newPage();
  await page.route('**/*.m4a',route=>route.fulfill({status:200,body:'mock-audio'}));
  await page.goto(`${baseUrl}/index.html`);
  const openedMode=await page.evaluate(()=>new Promise(resolve=>{
    const started=performance.now();
    const tryOpen=()=>{
      const button=document.getElementById('openVocabularyMode');
      if(button?.isConnected){button.click();resolve(true);return;}
      if(performance.now()-started>12000){resolve(false);return;}
      requestAnimationFrame(tryOpen);
    };
    tryOpen();
  }));
  assert.equal(openedMode,true,'Vocabulary lobby button should open the mode');
  await page.locator('.vocab-start:not([disabled])').click();
  await page.waitForSelector('.vocab-mic');
  return {context,page,entry};
}

async function closePage({context}){await context.close();}
async function inject(page,text){
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
  await page.evaluate(value=>window.__mockSpeech.latest.inject(value),text);
}
function browserTest(name,run){
  test(name,async t=>{
    if(!browser){t.skip(`Chromium is unavailable in this environment: ${browserError||'browser launch failed'}`);return;}
    await run(t);
  });
}

before(async()=>{
  server=http.createServer(async(request,response)=>{
    const url=new URL(request.url??'/',baseUrl??'http://127.0.0.1');
    const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const target=path.resolve(ROOT,relative);
    if(!target.startsWith(`${ROOT}${path.sep}`)){response.writeHead(403).end('forbidden');return;}
    try{
      const content=await fs.readFile(target);
      const extension=path.extname(target);
      const type=({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'})[extension]??'application/octet-stream';
      response.writeHead(200,{'content-type':type,'cache-control':'no-cache'});response.end(content);
    }catch{response.writeHead(404).end('not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch(error){browserError=String(error?.message??error).split('\n')[0];}
});

after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

browserTest('390×844 expression card preserves active source, strict paraphrase grade, and context/audio',async()=>{
  const opened=await newPage(sources[0]);
  const {context,page,entry}=opened;
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.vocab-meta').innerText().then(text=>text.includes('表現')),true);
    assert.equal(await page.locator('.vocab-mic').getAttribute('aria-label'),'英語で答える');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-mic')),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.vocab-mic')).transitionDuration),'0s');
    assert.ok(await page.locator('.vocab-speaker').count());
    assert.equal(await page.locator('.vocab-paraphrases').count(),0,'paraphrases stay hidden before response');
    const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(width.document<=width.viewport,`horizontal overflow: ${JSON.stringify(width)}`);
    await inject(page,sourceSurface(entry,sources[0].itemId));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-feedback').getAttribute('role'),'status');
    assert.equal(await page.locator('.vocab-feedback').getAttribute('aria-live'),'polite');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-next')),true);
    assert.match(await page.locator('.vocab-paraphrases').innerText(),/run into someone/);
    const audio=page.locator('.vocab-expression-audio');
    await audio.waitFor({state:'visible'});
    await audio.click();
    await page.waitForFunction(()=>window.__mockSpeech.spoken.includes('come across someone'));
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-context-full').isVisible(),true);
    const expandedWidth=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(expandedWidth.document<=expandedWidth.viewport,`overflow after expanding source context: ${JSON.stringify(expandedWidth)}`);
    const sourceAudio=page.locator('.vocab-source-audio');
    await sourceAudio.waitFor({state:'visible'});
    await sourceAudio.click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1　別表現 0　要復習 0/);

  }finally{await closePage(opened);}
});

const lv5State=()=>({last:5,best:5,noHintHistory:[1700000000000,1700100000000,1700200000000],noHintStreak:3,level5Count:8,review:{nextDueAt:1,intervalMs:86400000},stability:8.4,difficulty:2.2});

browserTest('automatic PARAPHRASE shows target details and leaves Lv5 SRS state untouched',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});
  const {page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await inject(page,'run into someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='意味はOK');
    assert.match(await page.locator('.vocab-answer-detail').innerText(),/このカードの表現：.*come across someone/s);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before,'automatic paraphrase must not mutate Lv5 target state');
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 1　要復習 0/);
  }finally{await closePage(opened);}
});

browserTest('manual PARAPHRASE leaves Lv5 SRS state untouched and does not retry',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});
  const {page,entry}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    assert.equal(await page.locator('.vocab-manual button').count(),3);
    assert.match(await page.locator('.vocab-manual-hint').innerText(),/このカードの表現そのもの/);
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.grade),'miss');
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await page.locator('[data-grade="paraphrase"]').click();
    assert.match(await page.locator('.vocab-feedback').innerText(),/ターゲットの習得記録は変わりません/);
    assert.match(await page.locator('.vocab-answer-detail').innerText(),/このカードの表現：come across someone/);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before,'manual paraphrase must not mutate Lv5 target state');
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 1　要復習 0/);
    assert.doesNotMatch(await page.locator('.vocab-done').innerText(),/再確認/);
  }finally{await closePage(opened);}
});

browserTest('word and construction source realizations grade as TARGET; manual reveal keeps three distinct choices',async()=>{
  for(const source of [sources[1],sources[2]]){
    const opened=await newPage(source);
    const {context,page,entry}=opened;
    try{
      const occurrence=entry.occurrences.find(value=>value.item_id===source.itemId);
      const text=sourceSurface(entry,source.itemId);
      if(source===sources[1]){
        await page.locator('.vocab-reveal').click();
        assert.equal(await page.locator('.vocab-manual button').count(),3);
        assert.match(await page.locator('.vocab-manual-hint').innerText(),/このカードの表現そのもの/);
        assert.equal(await page.evaluate(()=>document.activeElement?.dataset.grade),'miss');
        await page.locator('[data-grade="target"]').click();
        const state=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
        assert.equal(state.last,3,'manual target after reveal retains hint penalty');
        assert.match(await page.locator('.vocab-feedback').innerText(),/ターゲット正解として記録/);
      }else{
        assert.ok(occurrence);
        await inject(page,text);
        await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
        const state=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
        assert.equal(state.lastMatch,1,'strict TARGET classification must pass perfect lexical credit');
        assert.equal(state.level5Count,1,'TARGET must update mastery counters');
        assert.equal(state.noHintHistory.length,1,'TARGET must update no-hint history');
        assert.ok(state.review.nextDueAt>0,'TARGET must update the review schedule');
      }
      await page.locator('.vocab-next').click();
      assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1/);
    }finally{await closePage(opened);}
  }
});

browserTest('fuzzy collision remains MISS and automatic failure receives one retry',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.match(await page.locator('.vocab-answer').innerText(),/despite/i);
    await page.locator('.vocab-next').click();
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-mic').count(),1);
    await page.locator('.vocab-reveal').click();
    await page.locator('[data-grade="miss"]').click();
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 0　要復習 1/);
    assert.match(await page.locator('.vocab-done').innerText(),/再確認 1枚/);
  }finally{await closePage(opened);}
});
