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

async function newPage(source,{reducedMotion='reduce',entryState:entryStateOverride=null,speechSupported=true,startSession=true}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion});
  const entry=JSON.parse(JSON.stringify(fixtureFor(source)));
  assert.ok(entry,`fixture ${source.kind}/${source.canonical} exists`);
  const entryState=entryStateOverride||{last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0};
  await context.addInitScript(({entry,source,entryState,speechSupported})=>{
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
    window.__mockSpeech={latest:null,spoken:[],audioPlayed:[],startCount:0,srsWrites:0};
    const storageSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==='itemLevelV1') window.__mockSpeech.srsWrites+=1;
      return storageSetItem.call(this,key,value);
    };
    class MockRecognition{
      constructor(){this.results=[];}
      start(){window.__mockSpeech.latest=this;window.__mockSpeech.startCount+=1;this.onstart?.();}
      stop(){this.onend?.();}
      makeResult(text,isFinal){return Object.assign([{transcript:String(text)}],{isFinal});}
      emitFinal(text){
        const last=this.results.length-1;
        const index=last>=0&&!this.results[last].isFinal?last:this.results.length;
        this.results[index]=this.makeResult(text,true);
        this.onresult?.({resultIndex:index,results:this.results});
      }
      emitInterim(text){
        const last=this.results.length-1;
        const index=last>=0&&!this.results[last].isFinal?last:this.results.length;
        this.results[index]=this.makeResult(text,false);
        this.onresult?.({resultIndex:index,results:this.results});
      }
      inject(text){
        this.results=[this.makeResult(text,true)];
        this.onresult?.({resultIndex:0,results:this.results});
      }
      injectError(error='network'){this.onerror?.({error});}
    }
    if(speechSupported) Object.defineProperty(window,'SpeechRecognition',{value:MockRecognition,configurable:true});
    else{
      Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
      Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
    }
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
  },{entry,source,entryState,speechSupported});
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
  if(startSession){
    await page.locator('.vocab-start:not([disabled])').click();
    await page.waitForSelector('.vocab-mic');
  }
  await page.evaluate(()=>{window.__mockSpeech.srsWrites=0;});
  return {context,page,entry};
}

async function closePage({context}){await context.close();}
async function inject(page,text){
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
  await page.evaluate(value=>window.__mockSpeech.latest.inject(value),text);
}
async function injectFinal(page,text){
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
  await page.evaluate(value=>window.__mockSpeech.latest.emitFinal(value),text);
}
async function injectInterim(page,text){
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
  await page.evaluate(value=>window.__mockSpeech.latest.emitInterim(value),text);
}
async function recognitionError(page,error='network'){
  await page.evaluate(value=>window.__mockSpeech.latest.injectError(value),error);
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
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'came across Nick');
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

browserTest('answer reveal immediately records MISS and never asks for manual grading',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});
  const {page,entry}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-manual, [data-grade]').count(),0);
    assert.equal(await page.locator('.vocab-heard').count(),0,'answer reveal with no speech has no empty heard label');
    assert.equal(await page.locator('.vocab-next').count(),1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    assert.equal(before.last,0);
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 0　要復習 1/);
    assert.match(await page.locator('.vocab-done').innerText(),/再確認 1枚/);
  }finally{await closePage(opened);}
});

browserTest('word reveal is MISS while construction source realization remains automatic TARGET',async()=>{
  for(const source of [sources[1],sources[2]]){
    const opened=await newPage(source);
    const {context,page,entry}=opened;
    try{
      const occurrence=entry.occurrences.find(value=>value.item_id===source.itemId);
      const text=sourceSurface(entry,source.itemId);
      if(source===sources[1]){
        await page.locator('.vocab-reveal').click();
        await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
        assert.equal(await page.locator('.vocab-manual, [data-grade]').count(),0);
        assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
        assert.equal(await page.locator('.vocab-heard').count(),0);
      }else{
        assert.ok(occurrence);
        await inject(page,text);
        await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
        const state=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
        assert.equal(state.lastMatch,1,'strict TARGET classification must pass perfect lexical credit');
        assert.equal(state.level5Count,1,'TARGET must update mastery counters');
        assert.equal(state.noHintHistory.length,1,'TARGET must update no-hint history');
        assert.ok(state.review.nextDueAt>0,'TARGET must update the review schedule');
        assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
        assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),text);
      }
      await page.locator('.vocab-next').click();
      assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1/);
    }finally{await closePage(opened);}
  }
});

browserTest('clear MISS skips near retry and automatic failure receives one delayed retry',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await inject(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'banana');
    assert.match(await page.locator('.vocab-answer').innerText(),/despite/i);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.locator('.vocab-next').click();
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-mic').count(),1);
    await page.locator('.vocab-reveal').click();
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 0　要復習 1/);
    assert.match(await page.locator('.vocab-done').innerText(),/再確認 1枚/);
  }finally{await closePage(opened);}
});

browserTest('chunked ASR preview stays cumulative and interims reset the 1,200 ms silence debounce',async()=>{
  const opened=await newPage(sources[0]);
  const {context,page,entry}=opened;
  try{
    await injectFinal(page,'came');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'came');
    await page.waitForTimeout(800);
    await injectInterim(page,'across');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'came across');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.vocab-meaning').count(),1,'first final must not grade while interim speech continues');
    assert.equal(await page.locator('.vocab-answer').count(),0);
    await injectInterim(page,'across Nick');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'came across Nick');
    await injectFinal(page,'across Nick');
    await page.waitForTimeout(1250);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'came across Nick');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id].lastMatch,entry.id),1);
  }finally{await closePage(opened);}
});

browserTest('390×844 live transcript wraps in full without clipping or horizontal overflow',async()=>{
  const opened=await newPage(sources[1]);
  const {context,page}=opened;
  const transcript='I might have called him yesterday morning after the meeting but the connection was breaking up and I could only hear every other word clearly for several minutes';
  try{
    await injectInterim(page,transcript);
    const live=page.locator('.vocab-transcript');
    assert.equal(await live.innerText(),transcript);
    const dimensions=await live.evaluate(element=>({height:element.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(element).lineHeight)}));
    assert.ok(dimensions.height>dimensions.lineHeight*2,`transcript did not wrap: ${JSON.stringify(dimensions)}`);
    assert.equal(await live.evaluate(element=>{
      const style=getComputedStyle(element);
      const value=style.lineClamp||style.webkitLineClamp;
      return !value||value==='none'||value==='0';
    }),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.vocab-feedback').getAttribute('aria-live'),'polite');
  }finally{await closePage(opened);}
});

browserTest('NEAR→TARGET retries once, keeps the first transcript, and writes TARGET exactly once',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='惜しい。もう一度。');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'despise');
    assert.equal(await page.locator('.vocab-answer, .vocab-paraphrases').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before);
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await inject(page,'despite');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'despite');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-feedback').getAttribute('role'),'status');
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1　別表現 0　要復習 0/);
    assert.doesNotMatch(await page.locator('.vocab-done').innerText(),/再確認/);
  }finally{await closePage(opened);}
});

browserTest('NEAR→PARAPHRASE is final without SRS mutation or delayed retry',async()=>{
  const opened=await newPage(sources[0]);
  const {context,page}=opened;
  try{
    await inject(page,'run into');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='惜しい。もう一度。');
    assert.equal(await page.locator('.vocab-paraphrases, .vocab-answer').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await inject(page,'run into someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='意味はOK');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'run into someone');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    assert.match(await page.locator('.vocab-answer-detail').innerText(),/come across someone/);
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 1　要復習 0/);
    assert.doesNotMatch(await page.locator('.vocab-done').innerText(),/再確認/);
  }finally{await closePage(opened);}
});

browserTest('second NEAR after one immediate retry finalizes MISS instead of showing NEAR again',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='惜しい。もう一度。');
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'despise');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-answer').count(),1);
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/要復習 1/);
    assert.match(await page.locator('.vocab-done').innerText(),/再確認 1枚/);
  }finally{await closePage(opened);}
});

browserTest('NEAR→CLEAR MISS finalizes once and enqueues only the delayed retry',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='惜しい。もう一度。');
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await inject(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'banana');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-answer').count(),1);
    await page.locator('.vocab-next').click();
    assert.match(await page.locator('.vocab-done').innerText(),/要復習 1/);
    assert.match(await page.locator('.vocab-done').innerText(),/再確認 1枚/);
  }finally{await closePage(opened);}
});

browserTest('technical ASR error leaves the same card unresolved and allows another attempt',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await recognitionError(page,'network');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='認識できませんでした。もう一度。');
    assert.equal(await page.locator('.vocab-meaning').count(),1);
    assert.equal(await page.locator('.vocab-answer').count(),0);
    assert.equal(await page.locator('.vocab-mic').count(),1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await inject(page,'despite');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('a technical error during NEAR retry does not finalize it or consume a speech answer',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='惜しい。もう一度。');
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await recognitionError(page,'audio-capture');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='認識できませんでした。もう一度。');
    assert.equal(await page.locator('.vocab-answer').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=3);
    await inject(page,'despise');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-answer').count(),1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('answer reveal snapshots partial raw ASR and records one final MISS',async()=>{
  const opened=await newPage(sources[3]);
  const {context,page}=opened;
  try{
    await injectInterim(page,'despise');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'despise');
    await page.locator('.vocab-reveal').click();
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='あとでもう一度');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'despise');
    assert.equal(await page.locator('.vocab-manual, [data-grade]').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('manual stop wins the debounce race and grades the attempt exactly once',async()=>{
  const opened=await newPage(sources[1]);
  const {context,page}=opened;
  try{
    await injectFinal(page,'faint');
    await page.waitForTimeout(500);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    await page.evaluate(()=>window.__mockSpeech.latest.onend?.());
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'faint');
  }finally{await closePage(opened);}
});

browserTest('unsupported speech disables Vocabulary start and never offers manual grading',async()=>{
  const opened=await newPage(sources[0],{speechSupported:false,startSession:false});
  const {context,page}=opened;
  try{
    assert.equal(await page.locator('.vocab-start').isDisabled(),true);
    assert.match(await page.locator('.vocab-note').innerText(),/音声認識に対応していないため、このモードは利用できません/);
    assert.equal(await page.locator('.vocab-mic, .vocab-manual, [data-grade]').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
  }finally{await closePage(opened);}
});
