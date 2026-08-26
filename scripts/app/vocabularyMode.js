import { createLevelStateManager } from './levelState.js';
import { createRecognitionController, calcMatchScore, isRecognitionSupported } from '../speech/recognition.js';
import { createSpeechSynthesisController } from '../speech/synthesis.js';
import {
  answerVariants,
  buildVocabularySession,
  displayAnswer,
  displayMeaning,
  readyVocabularyEntries,
  vocabularyStats,
} from './vocabularyLearningCore.js';

const state={
  entries:[],
  kind:'all',
  queue:[],
  position:0,
  initialCount:0,
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
  speechText:'',
  speechPromise:null,
  advanceToken:0,
};

const levels=createLevelStateManager({
  baseHintStage:0,
  getFirstHintStage:()=>1,
  getEnglishRevealStage:()=>1,
});

const speech=createSpeechSynthesisController({
  getCurrentItem:()=>state.speechText?{en:state.speechText}:null,
  isSpeechDesired:()=>!!state.speechText,
});
speech.setSpeechRate(0.94);

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
    .vocab-dialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 10px,600px);max-height:calc(100dvh - 10px)}
    .vocab-dialog::backdrop{background:rgba(3,6,16,.82);backdrop-filter:blur(6px)}
    .vocab-shell{display:flex;flex-direction:column;height:min(720px,calc(100dvh - 10px));min-height:0;overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:22px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.5)}
    .vocab-head{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid rgba(148,163,184,.1)}
    .vocab-head strong{font-size:17px}.vocab-close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .vocab-body{display:flex;flex:1;min-height:0;flex-direction:column;padding:15px;overflow:hidden}
    .vocab-lobby{display:flex;flex:1;min-height:0;flex-direction:column;justify-content:center;gap:16px;max-width:460px;width:100%;margin:auto;overflow:auto;padding:4px 1px}
    .vocab-lead{text-align:center}.vocab-lead h2{font-size:25px;margin:0 0 7px}.vocab-lead p{margin:0;opacity:.6;font-size:12px;line-height:1.55}
    .vocab-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.vocab-stat{min-width:0;padding:11px 6px;border:1px solid rgba(148,163,184,.12);border-radius:13px;text-align:center;background:rgba(148,163,184,.045)}.vocab-stat b{display:block;font-size:19px}.vocab-stat span{display:block;margin-top:1px;font-size:10px;opacity:.54;white-space:nowrap}
    .vocab-kind{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:4px;border-radius:13px;background:rgba(148,163,184,.07)}.vocab-kind button{min-width:0;border:0;background:transparent;color:inherit;border-radius:9px;padding:10px 4px;font:inherit;font-size:12px;cursor:pointer;opacity:.58;white-space:nowrap}.vocab-kind button.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .vocab-start{min-height:54px;border:0;border-radius:15px;background:#6366f1;color:#fff;font:inherit;font-weight:850;font-size:16px;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.22)}.vocab-start:disabled{opacity:.45;cursor:default;box-shadow:none}
    .vocab-note{text-align:center;font-size:10px;line-height:1.45;opacity:.44}
    .vocab-study{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.vocab-progress{display:flex;flex:0 0 auto;align-items:center;gap:9px;font-size:10px;opacity:.56;white-space:nowrap}.vocab-progress__bar{height:4px;flex:1;min-width:30px;border-radius:99px;background:rgba(148,163,184,.12);overflow:hidden}.vocab-progress__bar i{display:block;height:100%;background:currentColor;transition:width .2s ease}
    .vocab-card{display:flex;flex:1;min-height:0;overflow:auto;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:18px 8px 10px;scrollbar-width:thin}
    .vocab-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin-bottom:13px}.vocab-meta span{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border:1px solid rgba(148,163,184,.12);border-radius:999px;background:rgba(148,163,184,.045);font-size:9px;letter-spacing:.025em;opacity:.56;white-space:nowrap}
    .vocab-meaning{max-width:520px;font-size:clamp(24px,6.8vw,37px);font-weight:850;line-height:1.38;letter-spacing:.005em;line-break:strict;overflow-wrap:break-word}.vocab-meaning.is-long{font-size:clamp(21px,5.8vw,31px);line-height:1.45}.vocab-meaning.is-xlong{font-size:clamp(18px,5vw,27px);line-height:1.5}
    .vocab-prompt{margin-top:11px;font-size:11px;opacity:.42}.vocab-answer-wrap{display:flex;min-height:50px;margin-top:16px;flex-direction:column;align-items:center;justify-content:center;gap:7px;max-width:100%}.vocab-answer{max-width:520px;font-size:clamp(22px,5.8vw,32px);font-weight:850;line-height:1.35;color:#a5b4fc;word-break:normal;overflow-wrap:break-word;hyphens:auto}.vocab-answer.is-long{font-size:clamp(19px,5vw,27px)}.vocab-answer.is-xlong{font-size:clamp(17px,4.5vw,23px);line-height:1.42}.vocab-answer[hidden]{display:block!important;visibility:hidden}.vocab-audio{border:1px solid rgba(165,180,252,.22);background:rgba(99,102,241,.08);color:#c7d2fe;border-radius:999px;padding:6px 11px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.vocab-audio[hidden]{display:none!important}
    .vocab-transcript{min-height:19px;margin-top:7px;font-size:11px;line-height:1.4;opacity:.5;max-width:500px;word-break:normal;overflow-wrap:break-word}
    .vocab-feedback{flex:0 0 auto;min-height:22px;text-align:center;font-size:12px;font-weight:750}.vocab-feedback.is-ok{color:#86efac}.vocab-feedback.is-miss{color:#fca5a5}
    .vocab-controls{display:flex;flex:0 0 auto;flex-direction:column;align-items:stretch;gap:7px;margin-top:6px}.vocab-mic{width:78px;height:78px;align-self:center;border:0;border-radius:50%;background:#6366f1;color:#fff;font:inherit;font-size:14px;font-weight:850;cursor:pointer;box-shadow:0 12px 28px rgba(99,102,241,.28);transition:transform .12s ease,box-shadow .12s ease}.vocab-mic.is-listening{transform:scale(1.05);box-shadow:0 0 0 8px rgba(99,102,241,.14),0 12px 28px rgba(99,102,241,.28)}
    .vocab-reveal{align-self:center;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;opacity:.56;padding:7px 12px;cursor:pointer}.vocab-manual{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vocab-manual button{min-height:48px;border-radius:13px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.vocab-manual button:disabled{opacity:.45;cursor:default}.vocab-manual__miss{border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.06);color:inherit}.vocab-manual__ok{border:0;background:#6366f1;color:#fff}
    .vocab-done{display:flex;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:11px}.vocab-done h2{font-size:29px;margin:0}.vocab-done p{margin:0;opacity:.62}.vocab-done small{opacity:.48}.vocab-done button{min-width:210px;min-height:50px;border:0;border-radius:14px;background:#6366f1;color:white;font:inherit;font-weight:850;cursor:pointer;margin-top:7px}.vocab-done .vocab-reveal{min-width:0;min-height:0;background:transparent;color:inherit;margin-top:0}
    @media(max-width:390px){.vocab-body{padding:12px}.vocab-shell{border-radius:18px}.vocab-card{padding-inline:3px}.vocab-meta{margin-bottom:10px}.vocab-meaning{font-size:26px}.vocab-meaning.is-long{font-size:22px}.vocab-meaning.is-xlong{font-size:19px}.vocab-mic{width:72px;height:72px}}
    @media(max-height:650px){.vocab-head{padding-block:9px}.vocab-body{padding-block:10px}.vocab-card{padding-block:10px 5px}.vocab-meta{margin-bottom:8px}.vocab-meaning{font-size:clamp(22px,6vw,31px)}.vocab-prompt{margin-top:7px}.vocab-answer-wrap{margin-top:10px}.vocab-mic{width:66px;height:66px}.vocab-controls{gap:4px;margin-top:3px}}
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

function cancelPronunciation(){
  state.advanceToken+=1;
  state.speechText='';
  state.speechPromise=null;
  speech.cancelSpeech();
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
  cancelPronunciation();
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
  cancelPronunciation();
  state.processing=false;
  levels.refreshLevelState();
  const entries=kindEntries();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const stats=vocabularyStats(entries,levelState);
  const plan=buildVocabularySession(entries,levelState,{size:12,kind:'all'});
  state.screen.innerHTML=`
    <section class="vocab-lobby">
      <div class="vocab-lead"><h2>日本語 → 英語</h2><p>意味を見て、英語を声に出して答えます。復習を優先し、新しい語は少量ずつ追加します。</p></div>
      <div class="vocab-stats">
        <div class="vocab-stat"><b>${stats.due}</b><span>復習</span></div>
        <div class="vocab-stat"><b>${stats.fresh}</b><span>未学習</span></div>
        <div class="vocab-stat"><b>${stats.total}</b><span>対象</span></div>
      </div>
      <div class="vocab-kind" role="tablist" aria-label="カード種別">
        <button type="button" data-kind="all" class="${state.kind==='all'?'is-active':''}">すべて</button>
        <button type="button" data-kind="word" class="${state.kind==='word'?'is-active':''}">単語</button>
        <button type="button" data-kind="phrase" class="${state.kind==='phrase'?'is-active':''}">熟語</button>
      </div>
      <button type="button" class="vocab-start" ${plan.size?'':'disabled'}>${plan.size?`${plan.size}枚で始める`:'対象カードなし'}</button>
      <div class="vocab-note">答えを見たカードだけ自己判定になります。</div>
    </section>`;
  state.screen.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{
    state.kind=button.dataset.kind||'all';
    renderLobby();
  }));
  state.screen.querySelector('.vocab-start')?.addEventListener('click',startSession);
}

function startSession(){
  stopListening();
  cancelPronunciation();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const plan=buildVocabularySession(state.entries,levelState,{size:12,kind:state.kind});
  state.queue=plan.entries.slice();
  state.position=0;
  state.initialCount=plan.size;
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
      if(prompt) prompt.textContent='音声認識に非対応です。答えを見て自己判定してください。';
    },
    onError:()=>{
      setListening(false);
      const prompt=state.screen.querySelector('.vocab-prompt');
      if(prompt) prompt.textContent='認識できませんでした。もう一度「話す」を押してください。';
    },
    setMicState:setListening,
  });
}

function setListening(active){
  const mic=state.screen?.querySelector('.vocab-mic');
  if(!mic) return;
  mic.classList.toggle('is-listening',!!active);
  mic.textContent=active?'停止':'話す';
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

function densityClass(base,text,{long=24,xlong=42}={}){
  const length=[...String(text||'')].length;
  if(length>=xlong) return `${base} is-xlong`;
  if(length>=long) return `${base} is-long`;
  return base;
}

function sectionLabel(entry){
  const raw=String(entry?.section??'').trim().replace(/^section\s*/i,'');
  return /^\d+$/.test(raw)?`Sec. ${Number(raw)}`:'';
}

function canonicalAnswer(){
  return displayAnswer(state.current);
}

function setAnswerVisible(text=canonicalAnswer()){
  const answer=state.screen?.querySelector('.vocab-answer');
  if(!answer) return;
  answer.hidden=false;
  answer.textContent=text;
  answer.className=densityClass('vocab-answer',text,{long:22,xlong:38});
  const audio=state.screen.querySelector('.vocab-audio');
  if(audio) audio.hidden=!speech.supported();
}

function speakAnswer(text=canonicalAnswer()){
  const value=String(text||'').trim();
  if(!value||!speech.supported()){
    state.speechPromise=Promise.resolve(false);
    return state.speechPromise;
  }
  state.speechText=value;
  let tracked;
  tracked=Promise.resolve(speech.speakCurrentCard())
    .catch(()=>false)
    .finally(()=>{
      if(state.speechPromise===tracked) state.speechPromise=null;
    });
  state.speechPromise=tracked;
  return tracked;
}

function bindPronunciationButton(){
  const button=state.screen?.querySelector('.vocab-audio');
  if(!button||button.dataset.boundPronunciation==='true') return;
  button.dataset.boundPronunciation='true';
  button.addEventListener('click',()=>{
    clearTimeout(state.timer);
    state.timer=0;
    const delay=state.processing?280:null;
    speakAnswer();
    if(delay!==null) scheduleAdvanceAfterSpeech(delay);
  });
}

function scheduleAdvanceAfterSpeech(delay){
  const card=state.current;
  const position=state.position;
  const token=++state.advanceToken;
  const pending=state.speechPromise||Promise.resolve(false);
  Promise.resolve(pending).finally(()=>{
    if(token!==state.advanceToken||state.current!==card||state.position!==position||!state.processing) return;
    state.timer=setTimeout(()=>{
      if(token!==state.advanceToken||state.current!==card||state.position!==position) return;
      state.position+=1;
      showNextCard();
    },Math.max(0,Number(delay)||0));
  });
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
  revealFeedback(pass,best.score);
}

function revealFeedback(pass,_score){
  const answer=canonicalAnswer();
  setAnswerVisible(answer);
  const controls=state.screen.querySelector('.vocab-controls');
  if(controls) controls.replaceChildren();
  const feedback=state.screen.querySelector('.vocab-feedback');
  if(feedback){
    feedback.className=`vocab-feedback ${pass?'is-ok':'is-miss'}`;
    feedback.textContent=pass?'正解':'あとでもう一度';
  }
  if(pass) state.correct+=1;
  else if(!state.retried.has(state.current.id)){
    state.retried.add(state.current.id);
    state.queue.push(state.current);
  }
  state.completed+=1;
  bindPronunciationButton();
  speakAnswer(answer);
  scheduleAdvanceAfterSpeech(pass?280:520);
}

function revealAnswer(){
  if(state.processing||!state.current) return;
  state.hintUsed=true;
  stopListening();
  setListening(false);
  const answer=canonicalAnswer();
  setAnswerVisible(answer);
  const prompt=state.screen.querySelector('.vocab-prompt');
  if(prompt) prompt.textContent='聞いて確認してから自己判定';
  const controls=state.screen.querySelector('.vocab-controls');
  if(controls){
    controls.innerHTML=`<div class="vocab-manual"><button type="button" class="vocab-manual__miss" data-grade="miss">思い出せなかった</button><button type="button" class="vocab-manual__ok" data-grade="ok">言えていた</button></div>`;
    controls.querySelector('[data-grade="miss"]').addEventListener('click',()=>manualGrade(false));
    controls.querySelector('[data-grade="ok"]').addEventListener('click',()=>manualGrade(true));
  }
  bindPronunciationButton();
  speakAnswer(answer);
}

function disableManualControls(){
  state.screen?.querySelectorAll('.vocab-manual button').forEach(button=>{button.disabled=true;});
}

function manualGrade(ok){
  if(state.processing||!state.current) return;
  state.processing=true;
  disableManualControls();
  updateVocabularyLevel(ok?0.95:0,true);
  if(ok) state.correct+=1;
  else if(!state.retried.has(state.current.id)){
    state.retried.add(state.current.id);
    state.queue.push(state.current);
  }
  state.completed+=1;
  const feedback=state.screen.querySelector('.vocab-feedback');
  if(feedback){feedback.className=`vocab-feedback ${ok?'is-ok':'is-miss'}`;feedback.textContent=ok?'記録しました':'あとでもう一度';}
  scheduleAdvanceAfterSpeech(ok?220:420);
}

function showNextCard(){
  clearTimeout(state.timer);
  clearGradeTimer();
  cancelPronunciation();
  state.timer=0;
  state.pendingTranscript='';
  if(state.position>=state.queue.length){ renderDone(); return; }
  state.current=state.queue[state.position];
  state.variants=answerVariants(state.current);
  state.hintUsed=false;
  state.processing=false;
  const initial=Math.max(1,state.initialCount||state.queue.length);
  const isRetry=state.position>=initial;
  const progress=Math.min(100,Math.round((Math.min(state.position,initial)/initial)*100));
  const meaning=displayMeaning(state.current);
  const kindLabel=state.current.kind==='phrase'?'熟語':'単語';
  const sec=sectionLabel(state.current);
  state.screen.innerHTML=`
    <section class="vocab-study">
      <div class="vocab-progress"><span>${isRetry?'再確認':`${state.position+1}/${initial}`}</span><div class="vocab-progress__bar"><i style="width:${progress}%"></i></div><span>正解 ${state.correct}</span></div>
      <div class="vocab-card">
        <div class="vocab-meta"><span>${kindLabel}</span>${sec?`<span>${sec}</span>`:''}</div>
        <div class="${densityClass('vocab-meaning',meaning,{long:20,xlong:34})}" lang="ja">${escapeHtml(meaning)}</div>
        <div class="vocab-prompt">英語で答える</div>
        <div class="vocab-answer-wrap">
          <div class="vocab-answer" lang="en" dir="ltr" hidden></div>
          <button type="button" class="vocab-audio" hidden>発音</button>
        </div>
        <div class="vocab-transcript" lang="en" dir="ltr" aria-live="polite"></div>
      </div>
      <div class="vocab-feedback" aria-live="polite"></div>
      <div class="vocab-controls">
        <button type="button" class="vocab-mic" aria-label="音声認識を開始">話す</button>
        <button type="button" class="vocab-reveal">答えを見る</button>
      </div>
    </section>`;
  setupRecognition();
  state.screen.querySelector('.vocab-mic')?.addEventListener('click',startListening);
  state.screen.querySelector('.vocab-reveal')?.addEventListener('click',revealAnswer);
  if(isRecognitionSupported()) state.timer=setTimeout(startListening,550);
}

function renderDone(){
  stopListening();
  cancelPronunciation();
  state.current=null;
  state.processing=false;
  const initial=Math.max(0,state.initialCount);
  const retryCount=state.retried.size;
  state.screen.innerHTML=`<section class="vocab-done"><h2>完了</h2><p>正解 ${state.correct}/${initial}</p>${retryCount?`<small>再確認 ${retryCount}枚</small>`:''}<button type="button">もう1セット</button><button type="button" class="vocab-reveal" data-back>戻る</button></section>`;
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
