import { createLevelStateManager } from './levelState.js';
import { createRecognitionController, calcMatchScore, isRecognitionSupported } from '../speech/recognition.js';
import {
  answerVariants,
  buildVocabularySession,
  displayAnswer,
  readyVocabularyEntries,
  vocabularyStats,
} from './vocabularyLearningCore.js';

const state={
  entries:[],
  kind:'all',
  queue:[],
  position:0,
  completed:0,
  correct:0,
  retried:new Set(),
  current:null,
  variants:[],
  hintUsed:false,
  processing:false,
  timer:0,
  gradeTimer:0,
  pendingTranscript:'',
  recognition:null,
  dialog:null,
  screen:null,
};

const levels=createLevelStateManager({
  baseHintStage:0,
  getFirstHintStage:()=>1,
  getEnglishRevealStage:()=>1,
});

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function injectStyles(){
  if(document.getElementById('vocabModeStyles')) return;
  const style=document.createElement('style');
  style.id='vocabModeStyles';
  style.textContent=`
    #focusHomeNav.has-vocab-mode{grid-template-columns:repeat(3,1fr)}
    #focusHomeNav.has-vocab-mode button{min-width:0;font-size:13px;padding-inline:5px}
    .vocab-dialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 14px,620px);max-height:calc(100dvh - 14px)}
    .vocab-dialog::backdrop{background:rgba(3,6,16,.82);backdrop-filter:blur(6px)}
    .vocab-shell{display:flex;flex-direction:column;min-height:min(680px,calc(100dvh - 14px));max-height:calc(100dvh - 14px);overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:24px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.5)}
    .vocab-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 16px;border-bottom:1px solid rgba(148,163,184,.1)}
    .vocab-head strong{font-size:18px}.vocab-close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .vocab-body{display:flex;flex:1;min-height:0;flex-direction:column;padding:16px;overflow:auto}
    .vocab-lobby{display:flex;flex:1;flex-direction:column;justify-content:center;gap:18px;max-width:480px;width:100%;margin:auto}
    .vocab-lead{text-align:center}.vocab-lead h2{font-size:26px;margin:0 0 8px}.vocab-lead p{margin:0;opacity:.62;font-size:13px;line-height:1.55}
    .vocab-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.vocab-stat{padding:12px 8px;border:1px solid rgba(148,163,184,.12);border-radius:14px;text-align:center;background:rgba(148,163,184,.045)}.vocab-stat b{display:block;font-size:20px}.vocab-stat span{font-size:10px;opacity:.55}
    .vocab-kind{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:4px;border-radius:13px;background:rgba(148,163,184,.07)}.vocab-kind button{border:0;background:transparent;color:inherit;border-radius:10px;padding:10px 4px;font:inherit;font-size:13px;cursor:pointer;opacity:.58}.vocab-kind button.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .vocab-start{min-height:56px;border:0;border-radius:16px;background:#6366f1;color:#fff;font:inherit;font-weight:850;font-size:17px;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.22)}
    .vocab-note{text-align:center;font-size:11px;opacity:.48}
    .vocab-study{display:flex;flex:1;min-height:0;flex-direction:column}.vocab-progress{display:flex;align-items:center;gap:10px;font-size:11px;opacity:.58}.vocab-progress__bar{height:4px;flex:1;border-radius:99px;background:rgba(148,163,184,.12);overflow:hidden}.vocab-progress__bar i{display:block;height:100%;background:currentColor;transition:width .2s ease}
    .vocab-card{display:flex;flex:1;min-height:350px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px 8px}.vocab-badge{font-size:10px;letter-spacing:.08em;opacity:.48;margin-bottom:14px}.vocab-meaning{font-size:clamp(25px,7vw,38px);font-weight:850;line-height:1.35;max-width:520px;overflow-wrap:anywhere}.vocab-prompt{margin-top:13px;font-size:12px;opacity:.45}.vocab-answer{margin-top:18px;font-size:clamp(22px,6vw,32px);font-weight:850;line-height:1.35;color:#a5b4fc;min-height:44px}.vocab-answer[hidden]{display:block!important;visibility:hidden}.vocab-transcript{min-height:20px;margin-top:9px;font-size:12px;opacity:.55;max-width:500px;overflow-wrap:anywhere}
    .vocab-controls{display:flex;flex-direction:column;align-items:stretch;gap:9px;margin-top:auto}.vocab-mic{width:82px;height:82px;align-self:center;border:0;border-radius:50%;background:#6366f1;color:#fff;font:inherit;font-size:28px;cursor:pointer;box-shadow:0 12px 28px rgba(99,102,241,.28);transition:transform .12s ease,box-shadow .12s ease}.vocab-mic.is-listening{transform:scale(1.06);box-shadow:0 0 0 9px rgba(99,102,241,.14),0 12px 28px rgba(99,102,241,.28)}
    .vocab-reveal{align-self:center;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;opacity:.58;padding:8px 12px;cursor:pointer}.vocab-manual{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vocab-manual button{min-height:50px;border-radius:14px;font:inherit;font-weight:800;cursor:pointer}.vocab-manual__miss{border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.06);color:inherit}.vocab-manual__ok{border:0;background:#6366f1;color:#fff}
    .vocab-feedback{min-height:24px;text-align:center;font-size:13px;font-weight:750}.vocab-feedback.is-ok{color:#86efac}.vocab-feedback.is-miss{color:#fca5a5}
    .vocab-done{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px}.vocab-done h2{font-size:30px;margin:0}.vocab-done p{margin:0;opacity:.64}.vocab-done button{min-width:210px;min-height:52px;border:0;border-radius:15px;background:#6366f1;color:white;font:inherit;font-weight:850;cursor:pointer;margin-top:8px}
    @media(max-width:390px){.vocab-body{padding:13px}.vocab-shell{border-radius:20px}.vocab-card{padding-inline:3px}.vocab-meaning{font-size:27px}.vocab-mic{width:76px;height:76px}}
  `;
  document.head.appendChild(style);
}

async function loadVocabulary(){
  try{
    const res=await fetch('./data/vocabulary-v2.json',{cache:'no-cache'});
    if(!res.ok) return [];
    return readyVocabularyEntries(await res.json());
  }catch(error){
    console.warn('Vocabulary database failed to load',error);
    return [];
  }
}

function makeDialog(){
  if(state.dialog) return state.dialog;
  const dialog=document.createElement('dialog');
  dialog.id='vocabularyModeDialog';
  dialog.className='vocab-dialog';
  dialog.innerHTML=`<section class="vocab-shell"><header class="vocab-head"><strong>単語・熟語</strong><button type="button" class="vocab-close" aria-label="閉じる">×</button></header><div class="vocab-body" id="vocabModeScreen"></div></section>`;
  document.body.appendChild(dialog);
  state.dialog=dialog;
  state.screen=dialog.querySelector('#vocabModeScreen');
  dialog.querySelector('.vocab-close').addEventListener('click',closeDialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) closeDialog();});
  return dialog;
}

function clearGradeTimer(){
  clearTimeout(state.gradeTimer);
  state.gradeTimer=0;
}

function stopListening(){
  clearTimeout(state.timer);
  state.timer=0;
  clearGradeTimer();
  state.pendingTranscript='';
  if(state.recognition?.isActive?.()) state.recognition.stop();
}

function closeDialog(){
  stopListening();
  state.processing=false;
  state.queue=[];
  state.current=null;
  if(state.dialog?.open) state.dialog.close();
}

function kindEntries(){
  return state.kind==='all'?state.entries:state.entries.filter(x=>x.kind===state.kind);
}

function renderLobby(){
  stopListening();
  state.processing=false;
  levels.refreshLevelState();
  const entries=kindEntries();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const stats=vocabularyStats(entries,levelState);
  const plan=buildVocabularySession(entries,levelState,{size:12,kind:'all'});
  state.screen.innerHTML=`
    <section class="vocab-lobby">
      <div class="vocab-lead"><h2>意味から即答</h2><p>日本語を見て英語を発話。復習を優先し、新しい語は一度に増やしすぎません。</p></div>
      <div class="vocab-stats">
        <div class="vocab-stat"><b>${stats.due}</b><span>復習</span></div>
        <div class="vocab-stat"><b>${stats.fresh}</b><span>未学習</span></div>
        <div class="vocab-stat"><b>${stats.total}</b><span>対象</span></div>
      </div>
      <div class="vocab-kind" role="tablist" aria-label="カード種別">
        <button type="button" data-kind="all" class="${state.kind==='all'?'is-active':''}">ミックス</button>
        <button type="button" data-kind="word" class="${state.kind==='word'?'is-active':''}">単語</button>
        <button type="button" data-kind="phrase" class="${state.kind==='phrase'?'is-active':''}">熟語</button>
      </div>
      <button type="button" class="vocab-start" ${plan.size?'':'disabled'}>${plan.size?`${plan.size}枚で始める`:'対象カードなし'}</button>
      <div class="vocab-note">答えを見た時だけ自己判定に切り替わります。</div>
    </section>`;
  state.screen.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{
    state.kind=button.dataset.kind||'all';
    renderLobby();
  }));
  state.screen.querySelector('.vocab-start')?.addEventListener('click',startSession);
}

function startSession(){
  stopListening();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const plan=buildVocabularySession(state.entries,levelState,{size:12,kind:state.kind});
  state.queue=plan.entries.slice();
  state.position=0;
  state.completed=0;
  state.correct=0;
  state.retried=new Set();
  showNextCard();
}

function scheduleTranscriptGrade(text){
  if(state.processing||!state.current) return;
  state.pendingTranscript=String(text||'').trim();
  if(!state.pendingTranscript) return;
  clearGradeTimer();
  const delay=state.current.kind==='phrase'?720:320;
  state.gradeTimer=setTimeout(()=>{
    state.gradeTimer=0;
    const pending=state.pendingTranscript;
    state.pendingTranscript='';
    if(pending&&!state.processing&&state.current) gradeTranscript(pending);
  },delay);
}

function setupRecognition(){
  const answerEl=state.screen.querySelector('.vocab-answer');
  state.recognition=createRecognitionController({
    enElement:answerEl,
    getReferenceText:()=>state.variants[0]||'',
    onTranscriptReset:()=>{state.pendingTranscript='';clearGradeTimer();setTranscript('');},
    onTranscriptInterim:text=>setTranscript(text),
    onTranscriptFinal:text=>{
      if(state.processing||!state.current) return;
      setTranscript(text);
      scheduleTranscriptGrade(text);
    },
    onAutoStop:result=>{
      if(state.processing||!state.current) return;
      clearGradeTimer();
      const text=String(result?.transcript||state.pendingTranscript||'').trim();
      state.pendingTranscript='';
      if(text) gradeTranscript(text);
      else setListening(false);
    },
    onUnsupported:()=>{
      setListening(false);
      const prompt=state.screen.querySelector('.vocab-prompt');
      if(prompt) prompt.textContent='音声認識非対応。答えを見て自己判定';
    },
    onError:()=>{
      setListening(false);
      const prompt=state.screen.querySelector('.vocab-prompt');
      if(prompt) prompt.textContent='認識できませんでした。タップして再試行';
    },
    setMicState:setListening,
  });
}

function setListening(active){
  const mic=state.screen?.querySelector('.vocab-mic');
  if(!mic) return;
  mic.classList.toggle('is-listening',!!active);
  mic.textContent=active?'■':'●';
  mic.setAttribute('aria-label',active?'音声認識を停止':'音声認識を開始');
}

function setTranscript(text){
  const el=state.screen?.querySelector('.vocab-transcript');
  if(el) el.textContent=String(text||'');
}

function startListening(){
  if(!state.current||state.processing||state.hintUsed||!state.recognition) return;
  if(state.recognition.isActive()){
    clearGradeTimer();
    const result=state.recognition.stop();
    const text=String(result?.transcript||state.pendingTranscript||'').trim();
    state.pendingTranscript='';
    if(text&&!state.processing) gradeTranscript(text);
    return;
  }
  const result=state.recognition.start();
  if(!result?.ok) setListening(false);
}

function bestMatchFor(text){
  let best=null;
  for(const variant of state.variants){
    const match=state.recognition.matchAndHighlight(variant,text);
    const score=calcMatchScore(match.refCount,match.recall,match.precision);
    if(!best||score>best.score) best={variant,match,score};
  }
  return best||{variant:displayAnswer(state.current),match:null,score:0};
}

function updateVocabularyLevel(rate,hintUsed){
  const evaluation=levels.evaluateLevel(rate,hintUsed?1:0);
  return levels.updateLevelInfo(state.current.id,evaluation);
}

function gradeTranscript(text){
  if(state.processing||!state.current) return;
  state.processing=true;
  clearGradeTimer();
  state.pendingTranscript='';
  const best=bestMatchFor(text);
  if(state.recognition?.isActive()) state.recognition.stop();
  setListening(false);
  setTranscript(text);
  updateVocabularyLevel(best.score,state.hintUsed);
  const pass=best.score>=0.7;
  revealFeedback(pass,best.score,best.variant);
}

function revealFeedback(pass,score,answer){
  const answerEl=state.screen.querySelector('.vocab-answer');
  if(answerEl){answerEl.hidden=false;answerEl.textContent=answer||displayAnswer(state.current);}
  const feedback=state.screen.querySelector('.vocab-feedback');
  if(feedback){
    feedback.className=`vocab-feedback ${pass?'is-ok':'is-miss'}`;
    feedback.textContent=pass?'✓':`↺ もう一度`;
  }
  if(pass) state.correct+=1;
  else if(!state.retried.has(state.current.id)){
    state.retried.add(state.current.id);
    state.queue.push(state.current);
  }
  state.completed+=1;
  state.timer=setTimeout(()=>{
    state.position+=1;
    showNextCard();
  },pass?520:820);
}

function revealAnswer(){
  if(state.processing||!state.current) return;
  state.hintUsed=true;
  stopListening();
  setListening(false);
  const answer=state.screen.querySelector('.vocab-answer');
  if(answer){answer.hidden=false;answer.textContent=displayAnswer(state.current);}
  const prompt=state.screen.querySelector('.vocab-prompt');
  if(prompt) prompt.textContent='自己判定';
  const controls=state.screen.querySelector('.vocab-controls');
  if(controls){
    controls.innerHTML=`<div class="vocab-manual"><button type="button" class="vocab-manual__miss" data-grade="miss">思い出せなかった</button><button type="button" class="vocab-manual__ok" data-grade="ok">言えていた</button></div>`;
    controls.querySelector('[data-grade="miss"]').addEventListener('click',()=>manualGrade(false));
    controls.querySelector('[data-grade="ok"]').addEventListener('click',()=>manualGrade(true));
  }
}

function manualGrade(ok){
  if(state.processing||!state.current) return;
  state.processing=true;
  updateVocabularyLevel(ok?0.95:0,true);
  if(ok) state.correct+=1;
  else if(!state.retried.has(state.current.id)){
    state.retried.add(state.current.id);
    state.queue.push(state.current);
  }
  state.completed+=1;
  const feedback=state.screen.querySelector('.vocab-feedback');
  if(feedback){feedback.className=`vocab-feedback ${ok?'is-ok':'is-miss'}`;feedback.textContent=ok?'✓ 記録':'↺ もう一度';}
  state.timer=setTimeout(()=>{state.position+=1;showNextCard();},ok?460:700);
}

function showNextCard(){
  clearTimeout(state.timer);
  clearGradeTimer();
  state.timer=0;
  state.pendingTranscript='';
  if(state.position>=state.queue.length){ renderDone(); return; }
  state.current=state.queue[state.position];
  state.variants=answerVariants(state.current);
  state.hintUsed=false;
  state.processing=false;
  const initialLength=Math.max(1,Math.min(12,state.queue.length-state.retried.size));
  const basePosition=Math.min(initialLength,state.completed+1);
  const progress=Math.min(100,Math.round((Math.min(state.completed,initialLength)/initialLength)*100));
  state.screen.innerHTML=`
    <section class="vocab-study">
      <div class="vocab-progress"><span>${Math.min(basePosition,initialLength)}/${initialLength}</span><div class="vocab-progress__bar"><i style="width:${progress}%"></i></div><span>${state.correct}正解</span></div>
      <div class="vocab-card">
        <div class="vocab-badge">${state.current.kind==='phrase'?'熟語':'単語'} · SECTION ${Number(state.current.section)||''}</div>
        <div class="vocab-meaning">${escapeHtml(state.current.meaning_ja)}</div>
        <div class="vocab-prompt">英語で言う</div>
        <div class="vocab-answer" hidden></div>
        <div class="vocab-transcript" aria-live="polite"></div>
      </div>
      <div class="vocab-feedback" aria-live="polite"></div>
      <div class="vocab-controls">
        <button type="button" class="vocab-mic" aria-label="音声認識を開始">●</button>
        <button type="button" class="vocab-reveal">答えを見る</button>
      </div>
    </section>`;
  setupRecognition();
  state.screen.querySelector('.vocab-mic')?.addEventListener('click',startListening);
  state.screen.querySelector('.vocab-reveal')?.addEventListener('click',revealAnswer);
  if(isRecognitionSupported()) state.timer=setTimeout(startListening,500);
}

function renderDone(){
  stopListening();
  state.current=null;
  state.processing=false;
  const total=state.completed;
  state.screen.innerHTML=`<section class="vocab-done"><h2>完了</h2><p>${total}回答 · ${state.correct}正解</p><button type="button">続ける</button><button type="button" class="vocab-reveal" data-back>戻る</button></section>`;
  state.screen.querySelector('.vocab-done>button:not([data-back])')?.addEventListener('click',renderLobby);
  state.screen.querySelector('[data-back]')?.addEventListener('click',renderLobby);
}

async function waitForHomeNav(timeout=10000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    const nav=document.getElementById('focusHomeNav');
    if(nav) return nav;
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  return null;
}

async function init(){
  injectStyles();
  const [entries,nav]=await Promise.all([loadVocabulary(),waitForHomeNav()]);
  state.entries=entries;
  if(!nav||!entries.length) return;
  if(document.getElementById('openVocabularyMode')) return;
  nav.classList.add('has-vocab-mode');
  const button=document.createElement('button');
  button.type='button';
  button.id='openVocabularyMode';
  button.textContent='単語・熟語';
  button.addEventListener('click',()=>{
    makeDialog();
    renderLobby();
    state.dialog.showModal();
  });
  nav.appendChild(button);
  makeDialog();
}

if(typeof document!=='undefined') init().catch(error=>console.warn('Vocabulary mode failed to initialize',error));
