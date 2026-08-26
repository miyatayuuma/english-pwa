const CONFIG_KEY='appConfigV3';

const state={
  timer:0,
  lastKey:'',
  fallbackTimer:0,
};

function currentMethod(){
  try{
    const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

export function shouldAutoplaySentence(method){
  return method==='read';
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

function composeActive(){ return studyActive()&&currentMethod()==='compose'; }

function syncModeClass(){
  document.body?.classList.toggle('sentence-compose-mode',composeActive());
}

function visibleSentenceText(){
  return String(document.getElementById('enText')?.textContent||'')
    .replace(/\s+/g,' ')
    .trim();
}

export function fullSentenceForCurrentCard(){
  const en=document.getElementById('enText');
  const itemId=String(en?.dataset?.itemId||'').trim();
  if(itemId&&Array.isArray(window.ALL_ITEMS)){
    const item=window.ALL_ITEMS.find(entry=>String(entry?.id||'')===itemId);
    if(item?.en) return String(item.en).trim();
  }
  return visibleSentenceText();
}

function cardKey(){
  const en=document.getElementById('enText');
  const itemId=String(en?.dataset?.itemId||'').trim();
  if(!itemId) return '';
  return `${currentMethod()}|${itemId}`;
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

function isUsEnglishVoice(voice){
  return String(voice?.lang||'').replace('_','-').toLowerCase().startsWith('en-us');
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
    utterance.voice=voices.find(isUsEnglishVoice)
      ||voices.find(voice=>/^en(?:-|_)/i.test(String(voice?.lang||'')))
      ||null;
    window.speechSynthesis.speak(utterance);
    return true;
  }catch(_){ return false; }
}

function attemptPlayback(expectedKey,attempt=0){
  if(!studyActive()||cardKey()!==expectedKey) return;
  syncModeClass();
  if(!shouldAutoplaySentence(currentMethod())) return;
  if(mediaAlreadyPlaying()) return;
  const button=document.getElementById('btnPlay');
  const reference=fullSentenceForCurrentCard();
  if(!button){
    if(attempt<12){ state.timer=setTimeout(()=>attemptPlayback(expectedKey,attempt+1),90); return; }
    fallbackSpeak(reference);
    return;
  }
  if(button.disabled){
    if(attempt<12){ state.timer=setTimeout(()=>attemptPlayback(expectedKey,attempt+1),90); return; }
    fallbackSpeak(reference);
    return;
  }
  button.click();
  state.fallbackTimer=setTimeout(()=>{
    if(!studyActive()||cardKey()!==expectedKey||mediaAlreadyPlaying()) return;
    if(!shouldAutoplaySentence(currentMethod())) return;
    fallbackSpeak(fullSentenceForCurrentCard());
  },1000);
}

function scheduleAutoplay(){
  syncModeClass();
  if(!studyActive()) return;
  const player=document.getElementById('player');
  if(!shouldAutoplaySentence(currentMethod())){
    cancelTimers();
    state.lastKey='';
    if(player) player.autoplay=false;
    return;
  }
  const key=cardKey();
  if(!key||key===state.lastKey) return;
  state.lastKey=key;
  cancelTimers();
  if(player) player.autoplay=true;
  state.timer=setTimeout(()=>attemptPlayback(key),160);
}

function observe(){
  const study=document.getElementById('studyView');
  const en=document.getElementById('enText');
  if(!study||!en) return;
  const observer=new MutationObserver(scheduleAutoplay);
  observer.observe(study,{attributes:true,attributeFilter:['hidden']});
  observer.observe(en,{attributes:true,attributeFilter:['data-item-id']});
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
