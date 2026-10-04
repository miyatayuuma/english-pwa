const state={
  dialog:null,
  screen:null,
  observer:null,
  bodyObserver:null,
  raf:0,
  audioContext:null,
  feedbackSeen:new WeakMap(),
};

function injectStyles(){
  if(document.getElementById('vocabularyFeedbackUxStyles')) return;
  const style=document.createElement('style');
  style.id='vocabularyFeedbackUxStyles';
  style.textContent=`
    .vocab-listening-indicator{display:flex;align-items:center;justify-content:center;gap:7px;min-height:30px;margin:2px auto 3px;padding:5px 10px;border:1px solid rgba(148,163,184,.13);border-radius:999px;background:rgba(148,163,184,.045);font-size:11px;font-weight:750;opacity:.62;transition:opacity .15s ease,border-color .15s ease,background .15s ease,color .15s ease}
    .vocab-listening-indicator__dot{width:7px;height:7px;border-radius:50%;background:rgba(148,163,184,.55);box-shadow:none}
    .vocab-listening-indicator.is-listening{opacity:1;color:#fecaca;border-color:rgba(248,113,113,.36);background:rgba(239,68,68,.10)}
    .vocab-listening-indicator.is-listening .vocab-listening-indicator__dot{background:#f87171;box-shadow:0 0 0 0 rgba(248,113,113,.42);animation:vocabListeningPulse 1.15s ease-out infinite}
    .vocab-mic.is-listening{background:#dc2626!important;box-shadow:0 0 0 9px rgba(239,68,68,.14),0 12px 30px rgba(220,38,38,.3)!important}
    .vocab-study.is-listening .vocab-prompt{opacity:.9;color:#fecaca;font-weight:750}
    @keyframes vocabListeningPulse{0%{box-shadow:0 0 0 0 rgba(248,113,113,.42)}70%{box-shadow:0 0 0 9px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}
    @media(prefers-reduced-motion:reduce){.vocab-listening-indicator.is-listening .vocab-listening-indicator__dot{animation:none}}
  `;
  document.head.appendChild(style);
}

function AudioContextCtor(){
  return window.AudioContext||window.webkitAudioContext||null;
}

function warmAudio(){
  const Ctor=AudioContextCtor();
  if(!Ctor) return null;
  try{
    if(!state.audioContext) state.audioContext=new Ctor();
    if(state.audioContext.state==='suspended') state.audioContext.resume?.().catch(()=>{});
    return state.audioContext;
  }catch(_){ return null; }
}

function makeTone(ctx,{frequency=440,endFrequency=frequency,start=0,duration=.09,type='sine',gain=.035}={}){
  try{
    const now=ctx.currentTime+start;
    const osc=ctx.createOscillator();
    const amp=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(frequency,now);
    if(endFrequency!==frequency) osc.frequency.exponentialRampToValueAtTime(Math.max(30,endFrequency),now+duration);
    amp.gain.setValueAtTime(.0001,now);
    amp.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),now+.012);
    amp.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(amp); amp.connect(ctx.destination);
    osc.start(now); osc.stop(now+duration+.02);
  }catch(_){}
}

function playGradeSound(pass){
  const ctx=warmAudio();
  if(!ctx||ctx.state==='closed') return;
  if(pass){
    makeTone(ctx,{frequency:620,start:0,duration:.075,type:'sine',gain:.032});
    makeTone(ctx,{frequency:880,start:.07,duration:.105,type:'sine',gain:.038});
  }else{
    makeTone(ctx,{frequency:260,endFrequency:175,start:0,duration:.16,type:'triangle',gain:.03});
  }
}

function ensureIndicator(screen){
  const controls=screen?.querySelector('.vocab-controls');
  if(!controls) return null;
  let indicator=screen.querySelector('.vocab-listening-indicator');
  if(!indicator){
    indicator=document.createElement('div');
    indicator.className='vocab-listening-indicator';
    indicator.setAttribute('role','status');
    indicator.setAttribute('aria-live','polite');
    indicator.innerHTML='<span class="vocab-listening-indicator__dot" aria-hidden="true"></span><span class="vocab-listening-indicator__text">マイク待機</span>';
    controls.parentNode?.insertBefore(indicator,controls);
  }
  return indicator;
}

function syncListening(screen){
  const study=screen?.querySelector('.vocab-study');
  const mic=screen?.querySelector('.vocab-mic');
  if(!study||!mic) return;
  const active=mic.classList.contains('is-listening');
  study.classList.toggle('is-listening',active);
  const indicator=ensureIndicator(screen);
  if(indicator){
    indicator.classList.toggle('is-listening',active);
    const text=indicator.querySelector('.vocab-listening-indicator__text');
    if(text) text.textContent=active?'聞き取り中…':'マイク待機';
  }
  const prompt=screen.querySelector('.vocab-prompt');
  if(prompt&&!screen.querySelector('.vocab-answer:not([hidden])')){
    prompt.textContent=active?'そのまま話してください':'英語で答える';
  }
}

function syncFeedback(screen){
  const feedback=screen?.querySelector('.vocab-feedback');
  if(!feedback) return;
  const pass=feedback.classList.contains('is-ok');
  const miss=feedback.classList.contains('is-miss');
  if(!pass&&!miss) return;
  const text=String(feedback.textContent||'').trim();
  if(!text) return;
  const signature=`${pass?'ok':'miss'}:${text}`;
  if(state.feedbackSeen.get(feedback)===signature) return;
  state.feedbackSeen.set(feedback,signature);
  playGradeSound(pass);
}

function sync(){
  state.raf=0;
  if(!state.screen) return;
  syncListening(state.screen);
  syncFeedback(state.screen);
}

function scheduleSync(){
  if(state.raf) return;
  state.raf=requestAnimationFrame(sync);
}

function attachDialog(dialog){
  if(!dialog||state.dialog===dialog) return;
  state.observer?.disconnect();
  state.dialog=dialog;
  state.screen=dialog.querySelector('#vocabModeScreen');
  if(!state.screen) return;
  dialog.addEventListener('pointerdown',warmAudio,{passive:true});
  dialog.addEventListener('keydown',warmAudio,{passive:true});
  state.observer=new MutationObserver(scheduleSync);
  state.observer.observe(state.screen,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden']});
  scheduleSync();
}

function findAndAttach(){
  const dialog=document.getElementById('vocabularyModeDialog');
  if(dialog) attachDialog(dialog);
}

function init(){
  injectStyles();
  findAndAttach();
  if(state.dialog) return;
  state.bodyObserver=new MutationObserver(()=>{
    findAndAttach();
    if(state.dialog){ state.bodyObserver?.disconnect(); state.bodyObserver=null; }
  });
  state.bodyObserver.observe(document.body,{childList:true,subtree:true});
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}
