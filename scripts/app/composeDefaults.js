import { createComposeGuide } from './composeGuide.js';
import { toks } from '../utils/text.js';

const state={
  items:new Map(),
  ready:false,
  scheduled:false,
  syncing:false,
  fallbackGuide:null,
};

function currentStudyMode(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function shuffledCopy(list){
  const out=Array.isArray(list)?list.slice():[];
  for(let i=out.length-1;i>0;i-=1){
    const j=Math.floor(Math.random()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}

async function loadItems(){
  const response=await fetch('./data/items.json',{cache:'no-cache'});
  if(!response.ok) throw new Error(`items.json: ${response.status}`);
  const raw=await response.json();
  const items=Array.isArray(raw)?raw:(Array.isArray(raw?.items)?raw.items:[]);
  state.items=new Map(items.filter(item=>item?.id).map(item=>[String(item.id),item]));
  state.ready=true;
}

function ensureFallbackGuide(){
  if(state.fallbackGuide) return state.fallbackGuide;
  const guide=document.getElementById('composeGuide');
  const tokens=document.getElementById('composeTokens');
  const note=document.getElementById('composeNote');
  if(!guide||!tokens) return null;
  state.fallbackGuide=createComposeGuide({
    composeGuideEl:guide,
    composeTokensEl:tokens,
    composeNoteEl:note,
    defaultNote:'',
    getTaskType:()=> 'compose',
    toks,
    shuffledCopy,
  });
  return state.fallbackGuide;
}

function syncComposeDefaults(){
  state.scheduled=false;
  if(!state.ready||state.syncing||currentStudyMode()!=='compose') return;
  const study=document.getElementById('studyView');
  const en=document.getElementById('enText');
  const ja=document.getElementById('jaText');
  const guide=document.getElementById('composeGuide');
  const tokens=document.getElementById('composeTokens');
  if(!study||study.hidden||!en||!ja||!guide||!tokens) return;
  const itemId=String(en.dataset.itemId||'');
  const item=state.items.get(itemId);
  if(!item) return;

  state.syncing=true;
  try{
    if(ja.textContent!==String(item.ja||'')) ja.textContent=String(item.ja||'');
    if(ja.style.display!=='block') ja.style.display='block';

    // main.js owns the primary compose guide. If it already rendered chunks,
    // adopt that DOM instead of rebuilding it with a second controller.
    const primaryReady=guide.classList.contains('show')&&tokens.children.length>0;
    if(primaryReady){
      tokens.dataset.composeDefaultItem=itemId;
      return;
    }

    const alreadyFallback=tokens.dataset.composeDefaultItem===itemId&&tokens.children.length>0;
    if(!alreadyFallback){
      const fallback=ensureFallbackGuide();
      fallback?.setup(item);
      if(tokens.children.length>0) tokens.dataset.composeDefaultItem=itemId;
    }
    if(tokens.children.length>0){
      guide.classList.add('show');
      guide.setAttribute('aria-hidden','false');
    }
  }finally{
    state.syncing=false;
  }
}

function scheduleSync(){
  if(state.scheduled) return;
  state.scheduled=true;
  requestAnimationFrame(syncComposeDefaults);
}

async function init(){
  const study=document.getElementById('studyView');
  const en=document.getElementById('enText');
  const ja=document.getElementById('jaText');
  const guide=document.getElementById('composeGuide');
  const tokens=document.getElementById('composeTokens');
  if(!study||!en||!ja||!guide||!tokens) return;

  new MutationObserver(scheduleSync).observe(en,{attributes:true,attributeFilter:['data-item-id']});
  new MutationObserver(scheduleSync).observe(study,{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(scheduleSync).observe(ja,{attributes:true,attributeFilter:['style','hidden']});
  new MutationObserver(scheduleSync).observe(guide,{attributes:true,attributeFilter:['class','aria-hidden']});
  new MutationObserver(scheduleSync).observe(tokens,{childList:true});

  await loadItems();
  scheduleSync();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Compose defaults failed',error)),{once:true});
  else init().catch(error=>console.warn('Compose defaults failed',error));
}
