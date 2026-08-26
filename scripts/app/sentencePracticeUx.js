const CONFIG_KEY='appConfigV3';
const PREF_METHOD_KEY='preferredSentenceMethodV1';

const state={
  timer:0,
  lastKey:'',
  fallbackTimer:0,
};

function currentMethod(){
  try{
    const preferred=localStorage.getItem(PREF_METHOD_KEY);
    if(preferred==='compose'||preferred==='read') return preferred;
    const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function injectStyles(){
  if(document.getElementById('sentencePracticeUxStyles')) return;
  const style=document.createElement('style');
  style.id='sentencePracticeUxStyles';
  style.textContent=`
    body.sentence-compose-mode #studyView:not([hidden]) #jaText{
      display:block!important;
      visibility:visible!important;
    }
  `;
  document.head.appendChild(style);
}

function studyActive(){
  const view=document.getElementById('studyView');
  return !!view&&!view.hidden;
}

function syncModeClass(){
  document.body?.classList.toggle('sentence-compose-mode',currentMethod()==='compose'&&studyActive());
}

function sentenceText(){
  return String(document.getElementById('enText')?.textContent||'')
    .replace(/\s+/g,' ')
    .trim();
}

function cardKey(){
  const progress=String(document.getElementById('statProgressCurrent')?.textContent||'').trim();
  const text=sentenceText();
  return text?`${currentMethod()}|${progress}|${text}`:'';
}

function cancelTimers(){
  clearTimeout(state.timer);
  clearTimeout(state.fallbackTimer);
  state.timer=0;
  state.fallbackTimer=0;
}

function mediaAlreadyPlaying(){
  const player=document.getElementById('player');
  if(player&&!player.paused&&!player.ended) return true;
  try{ if(window.speechSynthesis?.speaking) return true; }catch(_){}
  return false;
}

function fallbackSpeak(text){
  if(!text||typeof SpeechSynthesisUtterance==='undefined'||!window.speechSynthesis) return false;
  try{
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='en-US';
    const speed=Number(document.getElementById('speedSlider')?.value);
    utterance.rate=Number.isFinite(speed)?Math.max(.7,Math.min(1.25,speed)):.95;
    const voices=window.speechSynthesis.getVoices?.()||[];
    utterance.voice=voices.find(v=>/^en(-|_)/i.test(v.lang||''))||null;
    window.speechSynthesis.speak(utterance);
    return true;
  }catch(_){ return false; }
}

function attemptPlayback(expectedKey,attempt=0){
  if(!studyActive()||cardKey()!==expectedKey) return;
  const button=document.getElementById('btnPlay');
  if(mediaAlreadyPlaying()) return;
  if(!button||button.disabled){
    if(attempt<12) state.timer=setTimeout(()=>attemptPlayback(expectedKey,attempt+1),90);
    return;
  }
  button.click();
  state.fallbackTimer=setTimeout(()=>{
    if(!studyActive()||cardKey()!==expectedKey||mediaAlreadyPlaying()) return;
    fallbackSpeak(sentenceText());
  },650);
}

function scheduleAutoplay(){
  syncModeClass();
  if(!studyActive()) return;
  const key=cardKey();
  if(!key||key===state.lastKey) return;
  state.lastKey=key;
  cancelTimers();
  const player=document.getElementById('player');
  if(player) player.autoplay=true;
  state.timer=setTimeout(()=>attemptPlayback(key),140);
}

function observe(){
  const study=document.getElementById('studyView');
  const en=document.getElementById('enText');
  const progress=document.getElementById('statProgressCurrent');
  const card=document.getElementById('card');
  if(!study||!en) return;
  const observer=new MutationObserver(()=>scheduleAutoplay());
  observer.observe(study,{attributes:true,attributeFilter:['hidden']});
  observer.observe(en,{childList:true,subtree:true,characterData:true});
  if(progress) observer.observe(progress,{childList:true,subtree:true,characterData:true});
  if(card) observer.observe(card,{attributes:true,attributeFilter:['class']});
  document.addEventListener('english-pwa:study-method-changed',()=>{
    state.lastKey='';
    syncModeClass();
    scheduleAutoplay();
  });
  document.addEventListener('change',event=>{
    if(event.target?.matches?.('input[name="cfgStudyMode"]')){
      state.lastKey='';
      setTimeout(()=>{syncModeClass();scheduleAutoplay();},0);
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){ cancelTimers(); return; }
    state.lastKey='';
    scheduleAutoplay();
  });
  scheduleAutoplay();
}

function init(){
  injectStyles();
  observe();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}
