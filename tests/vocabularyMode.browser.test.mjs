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
  {kind:'expression',canonical:'yield to something',itemId:'E0343'},
  {kind:'word',canonical:'scarcely',itemId:'E0010'},
  {kind:'word',canonical:'confuse',itemId:'E0016'},
  {kind:'expression',canonical:'learn your lesson',itemId:'E0187'},
];
const fixtureFor=source=>vocabulary.entries.find(entry=>entry.kind===source.kind&&entry.canonical===source.canonical&&entry.occurrences.some(occurrence=>occurrence.item_id===source.itemId));
const sourceSurface=(entry,itemId)=>{const occurrence=entry.occurrences.find(value=>String(value.item_id)===String(itemId));const item=itemById.get(String(itemId));return occurrence&&item?item.en.slice(occurrence.start,occurrence.end):''};

async function newPage(source,{reducedMotion='reduce',entryState:entryStateOverride=null,speechSupported=true,startSession=true,fullDataset=false,native=false,nativePermission=true}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion});
  const entry=JSON.parse(JSON.stringify(fixtureFor(source)));
  assert.ok(entry,`fixture ${source.kind}/${source.canonical} exists`);
  const entryState=entryStateOverride||{last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0};
  await context.addInitScript(({entry,source,entryState,speechSupported,fullDataset,items,native,nativePermission})=>{
    const initial={
      // Encountered sources unlock Vocabulary without completing the unrelated friendship milestone.
      ...(fullDataset?Object.fromEntries(items.map(item=>[item.id,{last:1,best:1,updatedAt:1700000000000}])):{}),
      [source.itemId]:{last:2,best:2,updatedAt:1700000000000},
      [entry.id]:entryState,
    };
    localStorage.setItem('itemLevelV1',JSON.stringify(initial));
    navigator.storage.getDirectory=async()=>({getFileHandle:async name=>({getFile:async()=>new File(['mock-audio'],name,{type:'audio/mp4'})})});
    window.__vocabularyFixture__=entry;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const raw=typeof input==='string'?input:input?.url||String(input||'');
      const url=new URL(raw,location.href);
      if(!fullDataset&&url.pathname.endsWith('/data/vocabulary-v3.json')){
        return Promise.resolve(new Response(JSON.stringify({schema_version:3,entries:[window.__vocabularyFixture__]}),{status:200,headers:{'content-type':'application/json'}}));
      }
      return nativeFetch(input,init);
    };
    window.__mockSpeech={latest:null,spoken:[],audioPlayed:[],latestAudio:null,startCount:0,srsWrites:0};
    const storageSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==='itemLevelV1') window.__mockSpeech.srsWrites+=1;
      return storageSetItem.call(this,key,value);
    };
    window.SpeechRecognitionPhrase=class {constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}};
    class MockRecognition{
      constructor(){this.results=[];this.phrases=[];}
      start(){this.phrasesAtStart=this.phrases.map(p=>({text:p.phrase,boost:p.boost}));window.__mockSpeech.latest=this;window.__mockSpeech.startCount+=1;this.onstart?.();}
      stop(){this.onend?.();}
      makeResult(text,isFinal){return Object.assign((Array.isArray(text)?text:[text]).map(transcript=>({transcript:String(transcript),confidence:0})),{isFinal});}
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
    if(native){
      window.Capacitor={DEBUG:true,isNativePlatform:()=>true,getPlatform:()=> 'android'};
      window.__mockNative={session:null,listeners:new Set(),starts:0,stops:0};
      const state=window.__mockNative;
      state.emit=(type,transcripts=[])=>{for(const listener of state.listeners) listener({type,sessionId:state.session.sessionId,alternatives:transcripts.map((transcript,asrRank)=>({transcript,asrRank,confidence:null}))});};
      window.__nativePlugin={
        isAvailable:async()=>({available:true,apiLevel:35,biasSupported:true}),
        requestPermission:async()=>{state.permission=nativePermission;return {granted:nativePermission};},
        addListener:async(_,listener)=>{state.listeners.add(listener);return {remove:async()=>state.listeners.delete(listener)};},
        start:async options=>{state.session=options;state.starts++;state.emit('started');},
        stop:async()=>{state.stops++;},
        cancel:async()=>{state.emit('error');state.emit('end');},
      };
    }
    window.Audio=class MockAudio{
      constructor(url){this.url=String(url);window.__mockSpeech.latestAudio=this;}
      play(){window.__mockSpeech.audioPlayed.push(this.url);return Promise.resolve();}
      pause(){}
    };
  },{entry,source,entryState,speechSupported,fullDataset,items,native,nativePermission});
  const page=await context.newPage();
  if(native) await page.route('**/scripts/native/capacitor-core.js',route=>route.fulfill({contentType:'text/javascript',body:'export const registerPlugin=()=>window.__nativePlugin;'}));
  await page.route('**/*.m4a',route=>route.fulfill({status:200,body:'mock-audio'}));
  await page.goto(`${baseUrl}/index.html`);
  const openedMode=await page.evaluate(()=>new Promise(resolve=>{
    const started=performance.now();
    const tryOpen=()=>{
      const button=document.getElementById('openVocabularyMode');
      if(button?.isConnected){button.click();resolve(true);return;}
      // relationshipMode can replace the legacy nav; the learning menu uses
      // this same public mode entrypoint once the vocabulary DB is ready.
      if(typeof window.__OPEN_VOCABULARY_MODE__==='function'&&window.__OPEN_VOCABULARY_MODE__()){resolve(true);return;}
      if(performance.now()-started>12000){resolve(false);return;}
      requestAnimationFrame(tryOpen);
    };
    tryOpen();
  }));
  assert.equal(openedMode,true,`Vocabulary lobby readiness: ${JSON.stringify(await page.evaluate(()=>({nav:!!document.getElementById('focusHomeNav'),open:typeof window.__OPEN_VOCABULARY_MODE__,button:!!document.getElementById('openVocabularyMode'),shell:!!document.getElementById('sessionShellStyles')})))}`);
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
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
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
      if(source===sources[2]){
        await page.locator('.vocab-next').click();
        assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1/);
      }
    }finally{await closePage(opened);}
  }
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

browserTest('Web Vocabulary retains strict TARGET context and N-best without phrase bias, preserves raw output',async()=>{
  for(const [source,target] of [[sources[3],'despite'],[sources[0],'come across someone']]){
    const opened=await newPage(source);const {page}=opened;
    try{
      await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
      const phrases=await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart);
      assert.deepEqual(phrases,[]);
      const bias=await page.evaluate(()=>window.__mockSpeech.latest.context.biasStrings);
      assert.ok(bias.includes(target));
      assert.ok(!bias.includes('run into someone'));
      assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.maxAlternatives),5);
      await inject(page,target);
      await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
      assert.equal(await page.locator('.vocab-heard__text').innerText(),target);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
      await page.waitForSelector('.vocab-done');
    }finally{await closePage(opened);}
  }
});

browserTest('native TARGET rescue preserves raw primary, answer authority and exactly one SRS write',async()=>{
  for(const [source,primary] of [[sources[4],'YouTube something'],[sources[5],'scarcity'],[sources[6],'confused']]){
    const opened=await newPage(source);const {page}=opened;
    try{
      await inject(page,[primary,source.canonical]);
      await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
      assert.equal(await page.locator('.vocab-heard__text').innerText(),primary);
      assert.equal(await page.locator('.vocab-answer').innerText(),source.canonical);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    }finally{await closePage(opened);}
  }
});

browserTest('wrong native candidates and meaningful other segments stay provisional; lower PARAPHRASE is not rescued',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await inject(page,['banana','run into someone']);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await injectFinal(page,'not');await injectInterim(page,['wrong','come across someone']);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'not wrong');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount===3);
    await inject(page,['run into someone','come across someone']);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='意味はOK');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
  }finally{await closePage(opened);}
});

browserTest('filler / restart accepted on primary and native correction keeps original MISS and raw hearing',async()=>{
  const opened=await newPage(sources[4]);const {page,entry}=opened;
  try{
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    const miss=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await inject(page,['YouTube something','uh yield yield to something um']);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'YouTube something');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),miss);
  }finally{await closePage(opened);}
  const second=await newPage(sources[7]);
  try{
    const spoken="um learn learn your lesson uh";
    await inject(second.page,spoken);await second.page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await second.page.locator('.vocab-heard__text').innerText(),spoken);
    assert.equal(await second.page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(second);}
});

browserTest('all-MISS review supports unlimited fresh retries, focus, stale-event isolation and TARGET without penalty',async()=>{
  const opened=await newPage(sources[3]);const {page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    for(let attempt=0;attempt<3;attempt++){
      await inject(page,['banana','unrelated']);
      await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
      assert.equal(await page.locator('.vocab-heard__text').innerText(),'banana');
      assert.equal(await page.locator('.vocab-answer,.vocab-paraphrases').count(),0);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
      assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'もう一度話す');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before);
      const starts=await page.evaluate(()=>{window.__oldRecognition=window.__mockSpeech.latest;return window.__mockSpeech.startCount;});
      await page.locator('.vocab-mic').click();
      await page.waitForFunction(count=>window.__mockSpeech.startCount>count,starts);
      await page.evaluate(()=>{window.__oldRecognition.inject('despite');window.__oldRecognition.onend?.();});
      assert.equal(await page.locator('.vocab-answer').count(),0);
    }
    await inject(page,'despite');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('retry primary PARAPHRASE leaves SRS unchanged',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await inject(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await inject(page,'run into someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='意味はOK');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
  }finally{await closePage(opened);}
});

browserTest('answer correction rejects paraphrase, handles technical error, requires primary TARGET and preserves MISS exactly once',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});const {page,entry}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    await page.waitForSelector('.vocab-answer');
    assert.equal(await page.locator('.vocab-next').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    const miss=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await page.waitForFunction(()=>window.__mockSpeech.spoken.includes('come across someone'));
    assert.equal(await page.locator('.vocab-expression-audio').getAttribute('aria-label'),'英語の表現を再生');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-expression-audio')),true);
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('.vocab-answer').count(),1,'no advance before correction');
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await inject(page,'run into someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('もう一度話して'));
    assert.equal(await page.locator('.vocab-answer').count(),1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await recognitionError(page);
    assert.equal(await page.locator('.vocab-answer').count(),1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=3);
    await inject(page,'come across someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),miss);
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0,'successful correction advances to delayed retrieval');
  }finally{await closePage(opened);}
});

browserTest('correction completion re-arms automatic advance after source audio playback ends',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    await page.waitForSelector('.vocab-answer');
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await inject(page,'come across someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.locator('.vocab-next').count(),1,'correction completion exposes an escape path');
    await page.locator('.vocab-source-audio').click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('.vocab-answer').count(),1,'source audio holds auto-advance while playing');
    await page.evaluate(()=>window.__mockSpeech.latestAudio?.onended?.());
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0,'audio end re-arms automatic advance');
  }finally{await closePage(opened);}
});

browserTest('correction completion keeps manual Next available during source audio playback',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    await page.waitForSelector('.vocab-answer');
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await inject(page,'come across someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    await page.locator('.vocab-source-audio').click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    assert.equal(await page.locator('.vocab-next').count(),1);
    await page.locator('.vocab-next').click();
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0,'manual Next escapes even before audio ended');
  }finally{await closePage(opened);}
});

browserTest('correct-answer playback holds capture until release and replay safely stops corrective recording',async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.evaluate(()=>{
      window.speechSynthesis.speak=utterance=>{window.__heldUtterance=utterance;window.__mockSpeech.spoken.push(utterance.text);utterance.onstart?.();};
    });
    await page.locator('.vocab-reveal').click();
    await page.waitForFunction(()=>window.__heldUtterance);
    await page.locator('.vocab-mic').focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),0,'app output cannot be recorded');
    await page.evaluate(()=>window.__heldUtterance.onend?.());
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),0,'release settle precedes capture');
    await page.waitForFunction(()=>window.__mockSpeech.startCount===1);
    await page.evaluate(()=>{window.__oldRecognition=window.__mockSpeech.latest;window.__heldUtterance=null;});
    await page.locator('.vocab-expression-audio').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>window.__heldUtterance);
    await page.evaluate(()=>window.__oldRecognition.inject('despite'));
    assert.notEqual(await page.locator('.vocab-feedback').innerText(),'修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.evaluate(()=>window.__heldUtterance.onend?.());
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('.vocab-answer').count(),1);
  }finally{await closePage(opened);}
});

browserTest('interim full-utterance rank-one active source is graded without rewriting raw text',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await injectFinal(page,'came');await injectInterim(page,'across Nick');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'came across Nick');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'came across Nick');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

for(const technical of [false,true]) browserTest(`Vocabulary correction ${technical?'technical failures':'lexical misses'} ×3 advances without extra SRS`,async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    for(let attempt=0;attempt<3;attempt++){
      await page.locator('.vocab-mic').click();
      await page.waitForFunction(count=>window.__mockSpeech.startCount>=count,attempt+1);
      assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
      assert.ok((await page.evaluate(()=>window.__mockSpeech.latest.context.biasStrings)).includes('despite'));
      if(technical) await recognitionError(page,attempt===1?'no-speech':'network');
      else {await inject(page,'banana');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.length>0);}
      assert.equal(await page.locator('.vocab-answer').count(),1);
      assert.equal(await page.locator('.vocab-next').count(),attempt===2?1:0);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    }
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('Web technical error does not automatically retry or grade stale speech, manual retry preserves correction',async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.waitForFunction(()=>window.__mockSpeech.startCount===1);
    await page.evaluate(()=>{window.__biasedRecognition=window.__mockSpeech.latest;window.__biasedRecognition.injectError('network');window.__biasedRecognition.onend?.();});
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('認識できません'));
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),1);
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.evaluate(()=>window.__biasedRecognition.inject('despite'));
    assert.equal(await page.locator('.vocab-answer').count(),0);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await inject(page,'banana');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount===3);
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
    await inject(page,'despite');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('two consecutive technical failures then corrective TARGET exits early without lexical penalty or SRS writes',async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    for(let index=0;index<3;index++){
      await page.locator('.vocab-mic').click();await page.waitForFunction(count=>window.__mockSpeech.startCount>=count,index+1);
      if(index<2) await recognitionError(page,'network');
      else await inject(page,'despite');
    }
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.waitForSelector('.vocab-meaning');assert.equal(await page.locator('.vocab-answer').count(),0);
  }finally{await closePage(opened);}
});


browserTest('full 2478-entry production dataset starts Vocabulary and selects each existing UI filter',async()=>{
 const active=await newPage(sources[0],{fullDataset:true,startSession:false});
 try{
  assert.equal(await active.page.evaluate(async()=>{const db=await (await fetch('data/vocabulary-v3.json')).json();return db.entries.length;}),2478);
  for(const label of ['単語','表現','すべて']){
   await active.page.locator('.vocab-kind button').filter({hasText:label}).click();
   assert.equal(await active.page.locator('.vocab-start').isEnabled(),true);
  }
  await active.page.locator('.vocab-start').click();await active.page.waitForSelector('.vocab-mic');
  assert.ok((await active.page.locator('.vocab-meta').innerText()).length);
  await active.page.locator('.vocab-reveal').click();assert.ok((await active.page.locator('.vocab-answer').innerText()).length);
  assert.ok((await active.page.locator('.vocab-target').innerText()).length);
 }finally{await closePage(active);}
});


browserTest('Android Vocabulary preview never grades partials; manual stop waits for native final and strict N-best rescue writes once',async()=>{
  const opened=await newPage(sources[4],{native:true});const {page}=opened;
  try{
    await page.waitForFunction(()=>window.__mockNative.starts===1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),0);
    assert.ok((await page.evaluate(()=>window.__mockNative.session.biasStrings)).includes('yield to something'));
    await page.evaluate(()=>window.__mockNative.emit('partial',['yield to something']));
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    assert.equal(await page.locator('.vocab-answer').count(),0);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockNative.stops===1);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.evaluate(()=>{window.__mockNative.emit('final',['YouTube something','yield to something']);window.__mockNative.emit('end');});
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'YouTube something');
    await page.evaluate(()=>window.__mockNative.emit('final',['yield to something']));
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});


browserTest('Android microphone denial is explicit in Vocabulary UI, creates no recognizer and writes no SRS',async()=>{
  const opened=await newPage(sources[4],{native:true,nativePermission:false});const {page}=opened;
  try{
    try { await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('権限が拒否されました'),null,{timeout:10000}); }
    catch(error){throw new Error(JSON.stringify(await page.evaluate(()=>({prompt:document.querySelector('.vocab-prompt')?.textContent,feedback:document.querySelector('.vocab-feedback')?.textContent,native:{starts:window.__mockNative.starts,permission:window.__mockNative.permission},body:document.body.innerText.slice(-1600)}))),{cause:error});}
    assert.equal(await page.evaluate(()=>window.__mockNative.starts),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    assert.equal(await page.locator('.vocab-answer').count(),0);
    assert.equal(await page.locator('.vocab-mic').isEnabled(),true);
  }finally{await closePage(opened);}
});
