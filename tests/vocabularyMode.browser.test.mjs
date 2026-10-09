import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installMockSpeechRecognition } from './helpers/mockSpeechRecognition.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vocabulary=JSON.parse(await fs.readFile(path.join(ROOT,'data/vocabulary-v3.json'),'utf8'));
const items=JSON.parse(await fs.readFile(path.join(ROOT,'data/items.json'),'utf8'));
const itemById=new Map(items.map(item=>[String(item.id),item]));
let server,baseUrl,browser,browserError='';
const sources=[
  {kind:'expression',canonical:'come across someone',itemId:'E0524'},
  {kind:'word',canonical:'faint',itemId:'E0125'},
  {kind:'construction',canonical:'make someone do something',itemId:'E0130'},
  {kind:'word',canonical:'despite something',itemId:'E0088',entryId:'vocab:00121'},
  {kind:'expression',canonical:'yield to something',itemId:'E0343'},
  {kind:'word',canonical:'scarcely',itemId:'E0010'},
  {kind:'word',canonical:'confuse',itemId:'E0016'},
  {kind:'expression',canonical:'learn your lesson',itemId:'E0187'},
  {kind:'construction',canonical:'talk someone into doing something',itemId:'E0081',entryId:'vocab:00111'},
  {kind:'expression',canonical:'will do',itemId:'E0127',entryId:'vocab:01387'},
];
const fixtureFor=source=>source.entryId?vocabulary.entries.find(entry=>entry.id===source.entryId):vocabulary.entries.find(entry=>entry.kind===source.kind&&entry.canonical===source.canonical&&entry.occurrences.some(occurrence=>occurrence.item_id===source.itemId));
const sourceSurface=(entry,itemId)=>{const occurrence=entry.occurrences.find(value=>String(value.item_id)===String(itemId));const item=itemById.get(String(itemId));return occurrence&&item?item.en.slice(occurrence.start,occurrence.end):''};

async function newPage(source,{reducedMotion='reduce',entryState:entryStateOverride=null,speechSupported=true,startSession=true,fullDataset=false,native=false,nativePermission=true,viewport={width:390,height:844},additionalEntries=[]}={}){
  const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion});
  await context.addInitScript(installMockSpeechRecognition,{stateKey:'__mockSpeech',enabled:speechSupported});
  const entry=JSON.parse(JSON.stringify(fixtureFor(source)));
  const fixtures=[entry,...additionalEntries.map(value=>JSON.parse(JSON.stringify(value)))];
  assert.ok(entry,`fixture ${source.kind}/${source.canonical} exists`);
  const entryState=entryStateOverride||{last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0};
  await context.addInitScript(({entry,fixtures,source,entryState,speechSupported,fullDataset,items,native,nativePermission})=>{
    const freshState={last:0,best:0,noHintHistory:[],noHintStreak:0,level5Count:0,review:{nextDueAt:0,intervalMs:0},stability:0,difficulty:0};
    const encounteredIds=[...new Set([source.itemId,...fixtures.flatMap(value=>(value.occurrences||[]).map(occurrence=>String(occurrence.item_id||''))).filter(Boolean)])];
    const initial={
      // Encountered sources unlock Vocabulary without completing the unrelated friendship milestone.
      ...(fullDataset?Object.fromEntries(items.map(item=>[item.id,{last:1,best:1,updatedAt:1700000000000}])):{}),
      ...Object.fromEntries(encounteredIds.map(id=>[id,{last:2,best:2,updatedAt:1700000000000}])),
      [entry.id]:entryState,
      ...Object.fromEntries(fixtures.slice(1).map(value=>[value.id,freshState])),
    };
    localStorage.setItem('itemLevelV1',JSON.stringify(initial));
    navigator.storage.getDirectory=async()=>({getFileHandle:async name=>({getFile:async()=>new File(['mock-audio'],name,{type:'audio/mp4'})})});
    window.__vocabularyFixture__=fixtures;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const raw=typeof input==='string'?input:input?.url||String(input||'');
      const url=new URL(raw,location.href);
      if(!fullDataset&&url.pathname.endsWith('/data/vocabulary-v3.json')){
        return Promise.resolve(new Response(JSON.stringify({schema_version:3,entries:window.__vocabularyFixture__}),{status:200,headers:{'content-type':'application/json'}}));
      }
      return nativeFetch(input,init);
    };
    window.__mockSpeech=Object.assign(window.__mockSpeech||{},{latest:null,spoken:[],audioPlayed:[],latestAudio:null,startCount:0,srsWrites:0});
    const storageSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==='itemLevelV1') window.__mockSpeech.srsWrites+=1;
      return storageSetItem.call(this,key,value);
    };
    window.SpeechRecognitionPhrase=class {constructor(phrase,boost){this.phrase=phrase;this.boost=boost;}};
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
        isAvailable:async()=>({available:true,apiLevel:35,requestedMaxResults:20}),
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
  },{entry,fixtures,source,entryState,speechSupported,fullDataset,items,native,nativePermission});
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
  return {context,page,entry,entries:fixtures};
}

async function closePage({context}){await context.close();}
async function injectCompletedFinal(page,text){
  await page.waitForFunction(()=>window.__mockSpeech?.latest);
  await page.evaluate(value=>{const recognition=window.__mockSpeech.latest;recognition.inject(value);recognition.emitEnd();},text);
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
  await page.evaluate(value=>{const recognition=window.__mockSpeech.latest;recognition.injectError(value);recognition.emitEnd();},error);
}
async function tapResult(page){
  await page.waitForTimeout(400);
  const box=await page.locator('.vocab-context-state').boundingBox();
  assert.ok(box);
  const x=box.x+box.width-4,y=box.y+box.height-8;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.up();
}
async function touchSwipe(page,x,y,dx,dy){
  await page.evaluate(()=>{
    window.__resultSwipePointerTrace=[];
    if(window.__resultSwipePointerTraceInstalled) return;
    window.__resultSwipePointerTraceInstalled=true;
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel']) document.addEventListener(type,event=>{
      const surface=document.querySelector('.vocab-context-state');
      window.__resultSwipePointerTrace.push({type,pointerId:event.pointerId,pointerType:event.pointerType,isPrimary:event.isPrimary,isTrusted:event.isTrusted,button:event.button,x:event.clientX,y:event.clientY,target:event.target?.className||event.target?.tagName,insideSurface:!!surface?.contains(event.target),interactive:!!event.target?.closest?.('button,a[href],input,textarea,select,[role="button"],[role="slider"],[contenteditable="true"]')});
    },true);
  });
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y,force:1}]});
    for(let step=1;step<=8;step++){
      const progress=step/8;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+dx*progress,y:y+dy*progress,force:1}]});
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const trace=await page.evaluate(()=>window.__resultSwipePointerTrace);
    const down=trace.find(event=>event.type==='pointerdown');
    assert.ok(down,`touch gesture dispatched pointerdown: ${JSON.stringify(trace)}`);
    assert.equal(down.pointerType,'touch',JSON.stringify(trace));
    assert.equal(down.isTrusted,true,JSON.stringify(trace));
    assert.equal(down.isPrimary,true,JSON.stringify(trace));
    assert.equal(down.button,0,JSON.stringify(trace));
    assert.equal(down.insideSurface,true,JSON.stringify(trace));
    assert.ok(trace.some(event=>event.type==='pointermove'),`touch gesture dispatched pointermove: ${JSON.stringify(trace)}`);
    assert.ok(trace.some(event=>event.type==='pointerup'||event.type==='pointercancel'),`touch gesture terminated with pointerup or pointercancel: ${JSON.stringify(trace)}`);
    assert.ok(trace.every(event=>event.pointerId===down.pointerId),JSON.stringify(trace));
  }finally{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp.detach();
  }
}
async function swipeResult(page,dx,dy=0){
  await page.waitForTimeout(400);
  const box=await page.locator('.vocab-context-state').boundingBox();
  assert.ok(box);
  const point=await page.evaluate(({dx,dy})=>{
    const surface=document.querySelector('.vocab-context-state');
    const rect=surface.getBoundingClientRect();
    const minX=Math.max(rect.left+4,rect.left+4-dx,4);
    const maxX=Math.min(rect.right-4,rect.right-4-dx,innerWidth-4,innerWidth-4-dx);
    const minY=Math.max(rect.top+4,rect.top+4-dy,4);
    const maxY=Math.min(rect.bottom-4,rect.bottom-4-dy,innerHeight-4,innerHeight-4-dy);
    const interactive='button,a[href],input,textarea,select,[role="button"],[role="slider"],[contenteditable="true"]';
    const textBearing='.vocab-feedback,.vocab-result-prompt,.vocab-answer,.vocab-paraphrases,.vocab-source-block,.vocab-heard,.vocab-transcript,.vocab-advance-hint,.vocab-speaker';
    const textRects=[...surface.querySelectorAll(textBearing)].flatMap(node=>{
      const range=document.createRange();range.selectNodeContents(node);
      return [...range.getClientRects()].map(value=>({left:value.left-4,right:value.right+4,top:value.top-4,bottom:value.bottom+4}));
    });
    const findPoint=gridStep=>{
      for(let y=Math.floor(maxY);y>=minY;y-=gridStep){
        for(let x=Math.floor(maxX);x>=minX;x-=gridStep){
          let pathSafe=true;
          const targets=[];
          for(let step=0;step<=24;step++){
            const progress=step/24;
            const px=x+dx*progress,py=y+dy*progress;
            const target=document.elementFromPoint(px,py);
            if(!target||!surface.contains(target)||target.closest(interactive)||target.closest(textBearing)||textRects.some(value=>px>=value.left&&px<=value.right&&py>=value.top&&py<=value.bottom)){
              pathSafe=false;break;
            }
            targets.push(target.className||target.tagName);
          }
          if(pathSafe) return {x,y,startTarget:targets[0],endTarget:targets.at(-1),pathTargets:targets};
        }
      }
      return null;
    };
    return findPoint(8)||findPoint(4);
  },{dx,dy});
  assert.ok(point,`no non-text background swipe point found: ${JSON.stringify({dx,dy,box})}`);
  const {x,y}=point;
  assert.ok(x>=box.x&&x+dx<=box.x+box.width&&x+dx>=box.x&&x<=box.x+box.width&&y>=box.y&&y+dy>=box.y&&y+dy<=box.y+box.height,`swipe stays inside result surface: ${JSON.stringify({point,dx,dy,box})}`);
  await touchSwipe(page,x,y,dx,dy);
  const selected=await page.evaluate(()=>String(getSelection()||'').trim());
  assert.equal(selected,'',`background swipe selected text: ${JSON.stringify({dx,dy,point,selected})}`);
}
async function swipeFromControl(page,selector,dx=-120){
  await page.waitForTimeout(400);
  const box=await page.locator(selector).boundingBox();
  const surface=await page.locator('.vocab-context-state').boundingBox();
  assert.ok(box&&surface,`${selector} and result surface are visible`);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  assert.ok(surface.x<=x&&x<=surface.x+surface.width&&surface.y<=y&&y<=surface.y+surface.height,`${selector} starts inside result surface`);
  assert.ok(x+dx>=surface.x&&x+dx<=surface.x+surface.width,`${selector} swipe ends inside result surface`);
  await touchSwipe(page,x,y,dx,0);
}
async function captureAcceptanceScreenshot(page,name){
  const directory=process.env.VOCAB_ACCEPTANCE_SCREENSHOT_DIR;
  if(!directory) return;
  await fs.mkdir(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,name)});
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
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
  }catch(error){
    browserError=`local test server unavailable: ${error?.code||error?.message||error}`;
    return;
  }
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch(error){browserError=String(error?.message??error).split('\n')[0];}
});

after(async()=>{await browser?.close();if(server?.listening) await new Promise(resolve=>server.close(resolve));});

browserTest('390×844 expression card preserves active source, strict paraphrase grade, and context/audio',async()=>{
  const opened=await newPage(sources[0]);
  const {context,page,entry}=opened;
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.vocab-meta').innerText().then(text=>text.includes('動詞')),true);
    assert.doesNotMatch(await page.locator('.vocab-meta').innerText(),/単語|表現/);
    const questionGrammarRole=await page.locator('.vocab-meta .vocab-grammar-role').innerText();
    const carrier=page.locator('.vocab-speech-carrier');
    assert.equal(await carrier.innerText(),'my answer is …');
    assert.equal(await carrier.evaluate(node=>node.tagName),'DIV');
    assert.equal(await carrier.evaluate(node=>node.closest('button,[role="button"]')===null),true);
    assert.equal(await carrier.evaluate(node=>getComputedStyle(node).opacity),'0.3');
    assert.equal(await carrier.evaluate(node=>getComputedStyle(node).pointerEvents),'none');
    assert.equal(await page.locator('.vocab-prompt').innerText(),'英語で答える');
    assert.equal(await page.locator('.vocab-result-grammar-role').count(),0);
    assert.equal(await page.locator('.vocab-mic').getAttribute('aria-label'),'英語で答える');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-mic')),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.vocab-mic')).transitionDuration),'0s');
    await captureAcceptanceScreenshot(page,'vocab-carrier-question-390x844.png');
    await page.waitForSelector('.vocab-listening-indicator');
    assert.equal(await page.locator('.vocab-listening-indicator').evaluate(node=>node.parentElement.matches('.vocab-study')),true,'question indicator keeps its fallback position');
    assert.ok(await page.locator('.vocab-speaker').count());
    assert.equal(await page.locator('.vocab-paraphrases').count(),0,'paraphrases stay hidden before response');
    const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(width.document<=width.viewport,`horizontal overflow: ${JSON.stringify(width)}`);
    await injectCompletedFinal(page,sourceSurface(entry,sources[0].itemId));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'came across Nick');
    assert.equal(await page.locator('.vocab-feedback').getAttribute('role'),'status');
    assert.equal(await page.locator('.vocab-feedback').getAttribute('aria-live'),'polite');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-context-state')),true);
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),entry.meaning_ja);
    assert.equal(await page.locator('.vocab-result-grammar-role').innerText(),questionGrammarRole);
    assert.equal(await page.locator('.vocab-answer-block').evaluate(node=>node.querySelector('.vocab-result-grammar-role').compareDocumentPosition(node.querySelector('.vocab-answer'))&Node.DOCUMENT_POSITION_FOLLOWING?true:false),true);
    await captureAcceptanceScreenshot(page,'vocab-carrier-result-390x844.png');
    assert.equal(await page.locator('.vocab-source-heading').innerText().then(text=>text.includes('SOURCE EXAMPLE')),true);
    assert.match(await page.locator('.vocab-paraphrases').innerText(),/run into someone/);
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'result remains after the former auto-advance delay');
    const audio=page.locator('.vocab-expression-audio');
    await audio.waitFor({state:'visible'});
    await audio.click();
    await page.waitForFunction(()=>window.__mockSpeech.spoken.includes('come across someone'));
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'TARGET TTS end does not advance');
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-context-full').isVisible(),true);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'context control does not advance');
    const expandedWidth=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(expandedWidth.document<=expandedWidth.viewport,`overflow after expanding source context: ${JSON.stringify(expandedWidth)}`);
    const sourceAudio=page.locator('.vocab-source-audio');
    await sourceAudio.waitFor({state:'visible'});
    await sourceAudio.click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    await page.evaluate(()=>window.__mockSpeech.latestAudio?.onended?.());
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'source audio end does not advance');
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-context-scroll').evaluate(element=>element.scrollHeight<=element.clientHeight+1),true,'closing context restores collapsed fit');
    await tapResult(page);
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1　別表現 0　要復習 0/);

  }finally{await closePage(opened);}
});

browserTest('canonical grammar role wins over paraphrase POS and legacy kind labels',async()=>{
  const cases=[
    {source:{kind:'expression',canonical:'job interview',itemId:'E0366'},label:'名詞'},
    {source:{kind:'expression',canonical:'take up',itemId:'E0020'},label:'動詞'},
    {source:{kind:'construction',canonical:'so tired that I fell asleep',itemId:'E0371'},label:'構文'},
    {source:{kind:'word',canonical:'despite something',itemId:'E0088',entryId:'vocab:00121'},label:'前置詞'},
  ];
  for(const {source,label} of cases){
    const opened=await newPage(source);
    try{
      const meta=opened.page.locator('.vocab-meta');
      assert.doesNotMatch(await meta.innerText(),/単語|表現/);
      const roleTags=meta.locator(':scope > span:not(.vocab-speaker)');
      assert.equal(await roleTags.count(),1,label);
      assert.equal((await roleTags.first().innerText()).trim(),label);
      assert.equal(await opened.page.locator('.vocab-speech-carrier').innerText(),'my answer is …');
      await injectCompletedFinal(opened.page,sourceSurface(opened.entry,source.itemId));
      await opened.page.waitForFunction(()=>document.querySelector('.vocab-answer'));
      assert.equal(await opened.page.locator('.vocab-result-grammar-role').innerText(),label,label);
      assert.equal(await opened.page.locator('.vocab-answer-block').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,label+' answer block fits its viewport');
    }finally{await closePage(opened);}
  }
});

browserTest('Vocabulary carrier cue stays subtle, emphasizes lexical misses, pulses once, and resets on the next card',async()=>{
  const extra=fixtureFor(sources[2]);
  const opened=await newPage(sources[0],{
    viewport:{width:390,height:844},
    reducedMotion:'no-preference',
    additionalEntries:[extra],
  });
  const {page,entry}=opened;
  try{
    const cue=page.locator('.vocab-speech-carrier');
    assert.equal(await cue.innerText(),'my answer is …');
    await injectCompletedFinal(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-speech-carrier.is-emphasized'));
    assert.equal(await cue.getAttribute('data-miss-count'),'1');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.vocab-speech-carrier')).opacity==='0.72');
    assert.equal(await cue.evaluate(node=>getComputedStyle(node).opacity),'0.72');
    assert.equal(await cue.innerText(),'my answer is …');
    const beforePulse=await cue.boundingBox();

    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=2);
    await injectCompletedFinal(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-speech-carrier.is-pulsing'));
    assert.equal(await cue.getAttribute('data-miss-count'),'2');
    assert.equal(await cue.evaluate(node=>getComputedStyle(node).animationName),'vocab-carrier-pulse');
    const after=await cue.boundingBox();
    assert.deepEqual({x:after.x,y:after.y,width:after.width,height:after.height},{x:beforePulse.x,y:beforePulse.y,width:beforePulse.width,height:beforePulse.height},'the repeated-miss pulse does not shift the cue');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await cue.evaluate(node=>getComputedStyle(node).animationName),'none');

    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>=3);
    await injectCompletedFinal(page,sourceSurface(entry,sources[0].itemId));
    await page.waitForSelector('.vocab-answer');
    await tapResult(page);
    await page.waitForFunction(()=>document.querySelector('.vocab-speech-carrier')&&!document.querySelector('.vocab-speech-carrier').classList.contains('is-emphasized'));
    assert.equal(await page.locator('.vocab-speech-carrier').innerText(),'my answer is …');
    assert.equal(await page.locator('.vocab-speech-carrier').getAttribute('data-miss-count'),null);
  }finally{await closePage(opened);}
});

browserTest('carrier-bearing homophone answer keeps provider transcript visible and uses the result grammarRole',async()=>{
  const source={kind:'word',canonical:'dye',itemId:'E0106',entryId:'vocab:01314'};
  const opened=await newPage(source,{viewport:{width:390,height:844}});
  const {page,entry}=opened;
  try{
    assert.equal(await page.locator('.vocab-speech-carrier').innerText(),'my answer is …');
    await injectCompletedFinal(page,'my answer is die');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'my answer is die');
    assert.equal(await page.locator('.vocab-result-grammar-role').innerText(),'動詞');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.results[0][0].transcript),'my answer is die');
    const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,answer:document.querySelector('.vocab-answer').getBoundingClientRect().toJSON(),role:document.querySelector('.vocab-result-grammar-role').getBoundingClientRect().toJSON()}));
    assert.ok(layout.document<=layout.viewport,JSON.stringify(layout));
    assert.ok(layout.role.bottom<=layout.answer.top,JSON.stringify(layout));
    assert.ok(layout.answer.right<=layout.viewport&&layout.answer.left>=0,JSON.stringify(layout));
  }finally{await closePage(opened);}
});

for(const viewport of [{width:390,height:844},{width:360,height:640},{width:1280,height:900}]) browserTest(`${viewport.width}×${viewport.height} vocab:00111 result hierarchy fits without collapsed scrolling`,async()=>{
  const opened=await newPage(sources[8],{viewport});
  const {page,entry}=opened;
  try{
    await injectCompletedFinal(page,sourceSurface(entry,sources[8].itemId));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    const layout=await page.evaluate(()=>{
      const selectors=['.vocab-result-prompt','.vocab-result-grammar-role','.vocab-answer','.vocab-paraphrases','.vocab-source-block','.vocab-heard'];
      const nodes=selectors.map(selector=>document.querySelector(selector));
      const scroll=document.querySelector('.vocab-context-scroll');
      const surface=document.querySelector('.vocab-context-state');
      const rect=node=>{const value=node.getBoundingClientRect();return {top:value.top,bottom:value.bottom,left:value.left,right:value.right};};
      return {
        texts:nodes.map(node=>node?.innerText||''),
        ordered:nodes.every(Boolean)&&nodes.every((node,index)=>!index||nodes[index-1].compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING),
        result:{scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,density:surface.className},
        document:{width:document.documentElement.scrollWidth,viewport:innerWidth},
        fontSizes:{prompt:parseFloat(getComputedStyle(nodes[0]).fontSize),target:parseFloat(getComputedStyle(nodes[2]).fontSize)},
        sourceLine:rect(document.querySelector('.vocab-source-line')),
        hint:document.querySelector('.vocab-advance-hint')?.innerText||'',
        shell:rect(document.querySelector('.vocab-shell')),
        headerHeight:document.querySelector('.vocab-head').getBoundingClientRect().height,
        closeHeight:document.querySelector('.vocab-close').getBoundingClientRect().height,
      };
    });
    assert.equal(layout.ordered,true,JSON.stringify(layout));
    assert.equal(layout.texts[0],entry.meaning_ja);
    assert.equal(layout.texts[1],'動詞');
    assert.equal(layout.texts[2],entry.canonical);
    assert.match(layout.texts[3],/persuade someone to do something/);
    assert.match(layout.texts[3],/convince someone to do something/);
    assert.match(layout.texts[4],/SOURCE EXAMPLE/);
    assert.match(layout.texts[4],/みんなを説得して賛同させた/);
    assert.ok(layout.texts[5].includes(sourceSurface(entry,sources[8].itemId)),layout.texts[5]);
    assert.ok(layout.result.scrollHeight<=layout.result.clientHeight+1,JSON.stringify(layout.result));
    assert.doesNotMatch(layout.result.density,/is-scroll-fallback/);
    assert.equal(layout.document.width<=layout.document.viewport,true);
    assert.ok(layout.fontSizes.prompt>=20&&layout.fontSizes.target>=22,JSON.stringify(layout.fontSizes));
    assert.equal(await page.locator('.vocab-answer-block').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'grammar role and long canonical wrap inside the answer block');
    assert.match(layout.hint,/タップ \/ ←スワイプで次へ/);
    assert.ok(layout.headerHeight>=50&&layout.headerHeight<=58,`header ${layout.headerHeight}px`);
    assert.ok(layout.closeHeight>=44,`close target ${layout.closeHeight}px`);
    if(process.env.VOCAB_ACCEPTANCE_REPORT==='1') console.log(`VOCAB_LAYOUT ${viewport.width}x${viewport.height} ${JSON.stringify(layout)}`);
    await captureAcceptanceScreenshot(page,`vocab-00111-${viewport.width}x${viewport.height}.png`);
    const expressionAudio=page.locator('.vocab-expression-audio');
    const sourceAudio=page.locator('.vocab-source-audio');
    await sourceAudio.waitFor({state:'visible'});
    assert.ok(await expressionAudio.evaluate(node=>node.getBoundingClientRect().height>=44));
    assert.ok(await sourceAudio.evaluate(node=>node.getBoundingClientRect().height>=44));
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-context-state').evaluate(node=>getComputedStyle(node.querySelector('.vocab-context-scroll')).overflowY),'auto');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    if(viewport.height===640){
      const scroll=page.locator('.vocab-context-scroll');
      const metrics=await scroll.evaluate(node=>({scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,scrollTop:node.scrollTop}));
      assert.ok(metrics.scrollHeight>metrics.clientHeight,JSON.stringify(metrics));
      const box=await scroll.boundingBox();assert.ok(box);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.wheel(0,metrics.scrollTop>0?-180:180);
      await page.waitForFunction(previous=>document.querySelector('.vocab-context-scroll')?.scrollTop!==previous,metrics.scrollTop);
      assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'expanded vertical scrolling keeps the result visible');
    }
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-context-scroll').evaluate(node=>node.scrollHeight<=node.clientHeight+1),true);
  }finally{await closePage(opened);}
});

browserTest('vocab:01387 shows the sufficiency prompt and will do target without a temporal paraphrase',async()=>{
  const source=sources[9];
  const opened=await newPage(source,{viewport:{width:390,height:844}});
  const {page,entry}=opened;
  try{
    assert.equal(entry.canonical,'will do');
    assert.equal(entry.sense_key,'be_sufficient');
    assert.equal(entry.meaning_ja,'用が足りる');
    assert.deepEqual(entry.paraphrases||[],[]);
    assert.equal(await page.locator('.vocab-meaning').innerText(),'用が足りる');
    await injectCompletedFinal(page,sourceSurface(entry,source.itemId));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),'用が足りる');
    assert.equal(await page.locator('.vocab-answer').innerText(),'will do');
    assert.equal(await page.locator('.vocab-paraphrases').count(),0);
    assert.match(await page.locator('.vocab-source-block').innerText(),/どんなアパートでも構わない/);
    assert.doesNotMatch(await page.locator('.vocab-context-state').innerText(),/make it in time/i);
    const layout=await page.locator('.vocab-context-scroll').evaluate(node=>({scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}));
    assert.ok(layout.scrollHeight<=layout.clientHeight+1,JSON.stringify(layout));
    await captureAcceptanceScreenshot(page,'vocab-01387-will-do-390x844.png');
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('.vocab-answer').innerText(),'will do','the result remains after 2.5 seconds');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),'用が足りる');
  }finally{await closePage(opened);}
});

browserTest('result tap ignores audio/context controls and selected text, then advances once',async()=>{
  const opened=await newPage(sources[0],{additionalEntries:[fixtureFor(sources[4])]});
  const {page,entries}=opened;
  try{
    const firstPrompt=await page.locator('.vocab-meaning').innerText();
    const entry=entries.find(value=>value.meaning_ja===firstPrompt);
    assert.ok(entry,`current prompt fixture: ${firstPrompt}`);
    const nextEntry=entries.find(value=>value.id!==entry.id);
    assert.ok(nextEntry,'two expression fixtures are available for a manual advance');
    await injectCompletedFinal(page,sourceSurface(entry,entry.occurrences[0].item_id));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    await swipeFromControl(page,'.vocab-expression-audio');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'expression audio control swipe does not advance');
    await swipeFromControl(page,'.vocab-expand-context');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'context control swipe does not advance');
    await page.locator('.vocab-expand-context').click();
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await swipeFromControl(page,'.vocab-source-audio');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'source audio control swipe does not advance');
    await page.locator('.vocab-expand-context').click();
    await page.waitForTimeout(400);
    await page.locator('.vocab-expression-audio').click();
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await page.locator('.vocab-source-audio').click();
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    await page.locator('.vocab-expand-context').click();
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    await page.locator('.vocab-context-full .vocab-source-line').click();
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'expanded context taps do not advance');
    await page.locator('.vocab-expand-context').click();

    const selectionPoint=await page.locator('.vocab-source-line').first().evaluate(node=>{
      const range=document.createRange();range.selectNodeContents(node);
      const rect=range.getClientRects()[0];
      return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null;
    });
    assert.ok(selectionPoint);
    await page.mouse.move(selectionPoint.x+1,selectionPoint.y+selectionPoint.height/2);
    await page.mouse.down();
    await page.mouse.move(selectionPoint.x+selectionPoint.width-1,selectionPoint.y+selectionPoint.height/2,{steps:6});
    await page.mouse.up();
    const selectedText=await page.evaluate(()=>String(getSelection()||'').trim());
    assert.ok(selectedText.length>0,'pointer drag selects example text');
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'pointer text selection suppresses advance');
    await page.evaluate(()=>getSelection()?.removeAllRanges());
    await tapResult(page);
    await page.waitForFunction(prompt=>document.querySelector('.vocab-meaning')?.textContent===prompt,nextEntry.meaning_ja);
    assert.equal(await page.locator('.vocab-meaning').innerText(),nextEntry.meaning_ja,'one tap advances to the next expression');
    assert.equal(await page.locator('.vocab-done').count(),0,'one tap advances exactly one card in a two-card session');
  }finally{await closePage(opened);}
});

browserTest('only a dominant left swipe advances; short, vertical, and right movements do nothing',async()=>{
  const opened=await newPage(sources[0],{additionalEntries:[fixtureFor(sources[4])]});
  const {page,entries}=opened;
  try{
    const firstPrompt=await page.locator('.vocab-meaning').innerText();
    const entry=entries.find(value=>value.meaning_ja===firstPrompt);
    assert.ok(entry,`current prompt fixture: ${firstPrompt}`);
    const nextEntry=entries.find(value=>value.id!==entry.id);
    assert.ok(nextEntry,'two expression fixtures are available for a manual advance');
    await injectCompletedFinal(page,sourceSurface(entry,entry.occurrences[0].item_id));
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    await swipeResult(page,-42);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'short horizontal movement is ignored');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),firstPrompt,'short horizontal movement keeps the current result');
    await swipeResult(page,-8,-105);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'vertical gesture is ignored');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),firstPrompt,'vertical movement keeps the current result');
    await swipeResult(page,105,4);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'right swipe is ignored');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),firstPrompt,'right swipe keeps the current result');
    await swipeResult(page,-100);
    await page.waitForFunction(prompt=>document.querySelector('.vocab-meaning')?.textContent===prompt,nextEntry.meaning_ja,{timeout:2500});
    assert.equal(await page.locator('.vocab-meaning').innerText(),nextEntry.meaning_ja,'left swipe advances to the next expression');
    assert.equal(await page.locator('.vocab-done').count(),0,'one left swipe advances exactly one card');
  }finally{await closePage(opened);}
});

const lv5State=()=>({last:5,best:5,noHintHistory:[1700000000000,1700100000000,1700200000000],noHintStreak:3,level5Count:8,review:{nextDueAt:1,intervalMs:86400000},stability:8.4,difficulty:2.2});

browserTest('PARAPHRASE result uses the shared target-first answer block without duplicate explanation',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});
  const {page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await injectCompletedFinal(page,'run into someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='意味はOK');
    assert.equal(await page.locator('.vocab-answer-detail').count(),0);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical);
    assert.equal(await page.locator('.vocab-paraphrase.is-spoken').innerText(),'✓ run into someone');
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before,'automatic paraphrase must not mutate Lv5 target state');
    await tapResult(page);
    assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 0　別表現 1　要復習 0/);
  }finally{await closePage(opened);}
});

browserTest('removed force paraphrase is not accepted after audit revalidation',async()=>{
  const source={kind:'construction',canonical:'have no choice but to do something',itemId:'E0425',entryId:'vocab:00528'};
  const opened=await newPage(source);const {page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    assert.deepEqual(entry.paraphrases,['be compelled to do something']);
    await injectCompletedFinal(page,'be force to do something');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'be force to do something','raw ASR surface remains visible');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0,'rejected paraphrase does not update TARGET SRS state');
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),before);
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
        await injectCompletedFinal(page,text);
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
        await tapResult(page);
        assert.match(await page.locator('.vocab-done').innerText(),/ターゲット正解 1/);
      }
    }finally{await closePage(opened);}
  }
});


browserTest('chunked ASR preview stays cumulative and final evidence remains ungraded until terminal',async()=>{
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
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.vocab-feedback').textContent(),'','final evidence alone is not gradeable before terminal completion');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.evaluate(()=>window.__mockSpeech.latest.emitEnd());
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
    await injectCompletedFinal(page,'despite');
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

browserTest('manual stop and delayed final terminal paths grade each attempt exactly once',async()=>{
  const opened=await newPage(sources[1]);
  const {context,page}=opened;
  try{
    await injectFinal(page,'faint');
    await page.waitForTimeout(500);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    await page.evaluate(()=>window.__mockSpeech.latest.emitEnd());
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-heard .vocab-heard__text').innerText(),'faint');
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.events.map(event=>event.type)),['start','result','stop-request','end','duplicate-end']);
  }finally{await closePage(opened);}

  const delayed=await newPage(sources[1]);
  try{
    await delayed.page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await delayed.page.evaluate(()=>{window.__mockSpeech.latest.stopPlan={final:'faint',finalDelayMs:50,terminalDelayMs:250};});
    await delayed.page.locator('.vocab-mic').click();
    await delayed.page.waitForFunction(()=>window.__mockSpeech.events.some(event=>event.type==='stop-request'));
    assert.equal(await delayed.page.evaluate(()=>window.__mockSpeech.srsWrites),0,'stop request alone is not gradeable evidence');
    await delayed.page.waitForFunction(()=>window.__mockSpeech.events.some(event=>event.type==='result'));
    assert.equal(await delayed.page.evaluate(()=>window.__mockSpeech.srsWrites),0,'a final delivered during stop still waits for terminal completion');
    await delayed.page.waitForFunction(()=>window.__mockSpeech.events.some(event=>event.type==='end'));
    await delayed.page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.deepEqual(await delayed.page.evaluate(()=>window.__mockSpeech.events.map(event=>event.type)),['start','stop-request','result','end']);
    assert.equal(await delayed.page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(delayed);}
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
  for(const [source,target] of [[sources[3],'despite something'],[sources[0],'come across someone']]){
    const opened=await newPage(source);const {page}=opened;
    try{
      await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
      const phrases=await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart);
      assert.deepEqual(phrases,[]);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.context.biasStrings),undefined);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.maxAlternatives),20);
      await injectCompletedFinal(page,target);
      await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
      assert.equal(await page.locator('.vocab-heard__text').innerText(),target);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
      assert.equal(await page.locator('.vocab-answer').innerText(),fixtureFor(source).canonical);
      await tapResult(page);
      await page.waitForSelector('.vocab-done');
    }finally{await closePage(opened);}
  }
});

browserTest('native TARGET rescue preserves raw primary, answer authority and exactly one SRS write',async()=>{
  for(const [source,primary] of [[sources[4],'YouTube something'],[sources[5],'scarcity'],[sources[6],'confused']]){
    const opened=await newPage(source);const {page}=opened;
    try{
      await injectCompletedFinal(page,[primary,source.canonical]);
      await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
      assert.equal(await page.locator('.vocab-heard__text').innerText(),primary);
      assert.equal(await page.locator('.vocab-answer').innerText(),source.canonical);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    }finally{await closePage(opened);}
  }
});

browserTest('a TARGET in an interim segment cannot rescue a terminalized Vocabulary attempt',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await injectCompletedFinal(page,['banana','run into someone']);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await injectFinal(page,'not');await injectInterim(page,['wrong','come across someone']);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0,'final plus interim evidence remains pending until terminal');
    await page.evaluate(()=>window.__mockSpeech.latest.emitEnd());
    await page.waitForFunction(()=>document.querySelector('.vocab-heard__text')?.textContent==='not wrong');
    assert.match(await page.locator('.vocab-feedback').innerText(),/聞き取りを確認/);
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'not wrong');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0,'a candidate from a non-final segment cannot be promoted or written as SRS evidence');
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.events.map(event=>event.type)),['start','result','end','start','result','result','end']);
  }finally{await closePage(opened);}
});

browserTest('primary Vocabulary containment accepts extra words, preserves raw transcript, and writes SRS once',async()=>{
  const opened=await newPage(sources[4]);const {page}=opened;
  try{
    const spoken='I mean yield to something please';
    await injectCompletedFinal(page,spoken);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard__text').innerText(),spoken);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('TARGET-internal interruption remains a MISS under primary containment',async()=>{
  const opened=await newPage(sources[4]);const {page}=opened;
  try{
    await injectCompletedFinal(page,'yield um to something');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'yield um to something');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
  }finally{await closePage(opened);}
});

browserTest('correction completes on a contained strict TARGET without an extra SRS write',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});const {page,entry}=opened;
  try{
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await injectCompletedFinal(page,'okay come across someone again');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-answer').innerText(),entry.canonical,'correction completion holds the same result');
    assert.equal(await page.locator('.vocab-mic').count(),0);
  }finally{await closePage(opened);}
});

browserTest('all-MISS review supports unlimited fresh retries, focus, stale-event isolation and TARGET without penalty',async()=>{
  const opened=await newPage(sources[3]);const {page,entry}=opened;
  try{
    const before=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    for(let attempt=0;attempt<3;attempt++){
      await injectCompletedFinal(page,['banana','unrelated']);
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
      await page.evaluate(()=>{window.__oldRecognition.inject('despite');window.__oldRecognition.emitEnd();});
      assert.equal(await page.locator('.vocab-answer').count(),0);
    }
    await injectCompletedFinal(page,'despite');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('retry primary PARAPHRASE leaves SRS unchanged',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await injectCompletedFinal(page,'banana');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await injectCompletedFinal(page,'run into someone');
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
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.vocab-controls').compareDocumentPosition(document.querySelector('.vocab-advance-hint'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'advance hint follows the correction footer');
    const miss=await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id);
    await page.waitForFunction(()=>window.__mockSpeech.spoken.includes('come across someone'));
    assert.equal(await page.locator('.vocab-expression-audio').getAttribute('aria-label'),'英語の表現を再生');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vocab-expression-audio')),true);
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('.vocab-answer').count(),1,'no advance before correction');
    await swipeFromControl(page,'.vocab-mic');
    assert.equal(await page.locator('.vocab-answer').count(),1,'microphone control swipe does not advance during correction');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),0,'microphone control swipe does not start recognition');
    await tapResult(page);
    assert.equal(await page.locator('.vocab-answer').count(),1,'tap cannot advance during correction');
    const correctionPrompt=await page.locator('.vocab-result-prompt').innerText();
    await swipeResult(page,-100);
    assert.equal(await page.locator('.vocab-answer').count(),1,'swipe cannot advance during correction');
    assert.equal(await page.locator('.vocab-result-prompt').innerText(),correctionPrompt,'correction swipe keeps the current result');
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    assert.equal(await page.locator('.vocab-listening-indicator').evaluate(node=>node.parentElement.matches('[data-vocab-listening-host]')),true,'correction indicator uses the explicit footer host');
    await injectCompletedFinal(page,'run into someone');
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
    await injectCompletedFinal(page,'come across someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('itemLevelV1'))[id],entry.id),miss);
    assert.equal(await page.locator('.vocab-answer').count(),1,'correction completion does not advance automatically');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0,'keyboard advance opens delayed retrieval');
  }finally{await closePage(opened);}
});

browserTest('correction completion and source audio end keep the result until explicit swipe',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State(),additionalEntries:[fixtureFor(sources[4])]});const {page,entries}=opened;
  try{
    const firstPrompt=await page.locator('.vocab-meaning').innerText();
    const entry=entries.find(value=>value.meaning_ja===firstPrompt);
    assert.ok(entry,`current prompt fixture: ${firstPrompt}`);
    const nextEntry=entries.find(value=>value.id!==entry.id);
    assert.ok(nextEntry,'second expression fixture is available after correction');
    await page.locator('.vocab-reveal').click();
    await page.waitForSelector('.vocab-answer');
    await captureAcceptanceScreenshot(page,'correction-footer-390x844.png');
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await injectCompletedFinal(page,entry.canonical);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.locator('.vocab-next').count(),0);
    await page.locator('.vocab-source-audio').click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('.vocab-answer').count(),1,'the result remains while source audio plays');
    await page.evaluate(()=>window.__mockSpeech.latestAudio?.onended?.());
    assert.equal(await page.locator('.vocab-answer').count(),1,'source audio end does not advance');
    await swipeResult(page,-100);
    await page.waitForFunction(prompt=>document.querySelector('.vocab-meaning')?.textContent===prompt,nextEntry.meaning_ja);
    assert.equal(await page.locator('.vocab-meaning').innerText(),nextEntry.meaning_ja,'post-correction left swipe advances once');
    assert.equal(await page.locator('.vocab-answer').count(),0);
  }finally{await closePage(opened);}
});

browserTest('correction result can be manually advanced during source audio playback',async()=>{
  const opened=await newPage(sources[0],{entryState:lv5State()});const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();
    await page.waitForSelector('.vocab-answer');
    await page.locator('.vocab-source-audio').waitFor({state:'visible'});
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    await injectCompletedFinal(page,'come across someone');
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    await page.locator('.vocab-source-audio').click();
    await page.waitForFunction(()=>window.__mockSpeech.audioPlayed.length>0);
    await tapResult(page);
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0,'manual tap advances even before audio ends');
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
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('.vocab-answer').count(),1);
  }finally{await closePage(opened);}
});

browserTest('interim transcript stays display-only until final terminal evidence arrives',async()=>{
  const opened=await newPage(sources[0]);const {page}=opened;
  try{
    await injectInterim(page,'came across Nick');
    assert.equal(await page.locator('.vocab-transcript').innerText(),'came across Nick');
    await page.waitForTimeout(1300);
    assert.equal(await page.locator('.vocab-feedback').textContent(),'');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0,'interim-only speech does not write SRS');
    await injectFinal(page,'came across Nick');
    await page.evaluate(()=>window.__mockSpeech.latest.emitEnd());
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard__text').innerText(),'came across Nick');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

for(const technical of [false,true]) browserTest(`Vocabulary correction ${technical?'technical failures':'lexical misses'} ×3 holds result without extra SRS`,async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    for(let attempt=0;attempt<3;attempt++){
      await page.locator('.vocab-mic').click();
      await page.waitForFunction(count=>window.__mockSpeech.startCount>=count,attempt+1);
      assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.maxAlternatives),20);
      if(technical) await recognitionError(page,attempt===1?'no-speech':'network');
      else {await injectCompletedFinal(page,'banana');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.length>0);}
      assert.equal(await page.locator('.vocab-answer').count(),1);
      assert.equal(await page.locator('.vocab-next').count(),0);
      assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    }
    assert.equal(await page.locator('.vocab-answer').count(),1,'third attempt completes correction without advancing');
    await tapResult(page);
    await page.waitForSelector('.vocab-meaning');
    assert.equal(await page.locator('.vocab-answer').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});

browserTest('Web technical error does not automatically retry or grade stale speech, manual retry preserves correction',async()=>{
  const opened=await newPage(sources[3]);const {page}=opened;
  try{
    await page.waitForFunction(()=>window.__mockSpeech.startCount===1);
    await page.evaluate(()=>{window.__failedRecognition=window.__mockSpeech.latest;window.__failedRecognition.injectError('network');window.__failedRecognition.emitEnd();});
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('認識できません'));
    assert.equal(await page.evaluate(()=>window.__mockSpeech.startCount),1);
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),0);
    await page.evaluate(()=>window.__failedRecognition.inject('despite'));
    assert.equal(await page.locator('.vocab-answer').count(),0);
    await page.locator('.vocab-mic').click();
    await page.waitForFunction(()=>window.__mockSpeech.startCount===2);
    await injectCompletedFinal(page,'banana');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent.includes('聞き取りを確認'));
    await page.locator('.vocab-reveal').click();await page.waitForSelector('.vocab-answer');
    await page.locator('.vocab-mic').click();await page.waitForFunction(()=>window.__mockSpeech.startCount===3);
    assert.deepEqual(await page.evaluate(()=>window.__mockSpeech.latest.phrasesAtStart),[]);
    await injectCompletedFinal(page,'despite');await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
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
      else await injectCompletedFinal(page,'despite');
    }
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='修正練習完了');
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
    assert.equal(await page.locator('.vocab-answer').count(),1,'successful correction remains on the result card');
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
    assert.equal(await page.evaluate(()=>window.__mockNative.session.biasStrings),undefined);
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

for(const rank of [1,6,12,20]) browserTest(`Web production Vocabulary strict TARGET at provider rank ${rank} writes SRS once`,async()=>{
  const opened=await newPage(sources[4]);const {page}=opened;
  try{
    await page.waitForFunction(()=>window.__mockSpeech.startCount>0);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.latest.maxAlternatives),20);
    const alternatives=Array.from({length:20},(_,i)=>i===rank-1?'please yield to something again':'years to something');
    await injectCompletedFinal(page,alternatives);
    await page.waitForFunction(()=>document.querySelector('.vocab-feedback')?.textContent==='正解');
    assert.equal(await page.locator('.vocab-heard__text').innerText(),alternatives[0]);
    assert.equal(await page.evaluate(()=>window.__mockSpeech.srsWrites),1);
  }finally{await closePage(opened);}
});
