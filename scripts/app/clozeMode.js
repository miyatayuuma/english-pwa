import { buildClozeCard } from './clozeLearningCore.js';
import { spanify } from '../utils/text.js';

const state={
  items:new Map(),
  vocabByExample:new Map(),
  ready:false,
  rendering:false,
  blockSyntheticUntil:0,
};

function currentStudyMode(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function injectStyles(){
  if(document.getElementById('clozeModeStyles')) return;
  const style=document.createElement('style');
  style.id='clozeModeStyles';
  style.textContent=`
    .en.cloze-active.concealed{
      display:block;
      min-height:0;
      color:var(--txt);
      font-size:22px;
      font-style:normal;
      text-align:left;
    }
    .en.cloze-active .tok.cloze-mask,
    .en.cloze-active .tok.cloze-mask.hit,
    .en.cloze-active .tok.cloze-mask.miss{
      color:transparent!important;
      -webkit-text-fill-color:transparent!important;
      text-shadow:none!important;
      user-select:none;
      border-bottom:2px solid rgba(165,180,252,.82)!important;
      background:rgba(129,140,248,.13)!important;
      border-radius:4px;
    }
    .en.cloze-active .tok.cloze-mask.cloze-start{margin-left:1px}
    .en.cloze-active .tok.cloze-mask.cloze-end{margin-right:1px}
  `;
  document.head.appendChild(style);
}

async function loadJson(path){
  const res=await fetch(path,{cache:'no-cache'});
  if(!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function indexVocabulary(db){
  const entries=Array.isArray(db)?db:(Array.isArray(db?.entries)?db.entries:[]);
  const map=new Map();
  for(const entry of entries){
    for(const id of Array.isArray(entry?.example_ids)?entry.example_ids:[]){
      if(!id) continue;
      if(!map.has(id)) map.set(id,[]);
      map.get(id).push(entry);
    }
  }
  return map;
}

async function loadData(){
  const [itemsRaw,vocabRaw]=await Promise.all([
    loadJson('./data/items.json'),
    loadJson('./data/vocabulary-v2.json'),
  ]);
  const items=Array.isArray(itemsRaw)?itemsRaw:(Array.isArray(itemsRaw?.items)?itemsRaw.items:[]);
  state.items=new Map(items.filter(item=>item?.id).map(item=>[String(item.id),item]));
  state.vocabByExample=indexVocabulary(vocabRaw);
  state.ready=true;
}

function clearCloze(en){
  if(!en) return;
  en.classList.remove('cloze-active');
  delete en.dataset.clozeRendered;
}

function applyMasks(en,targets){
  const wordSpans=[...en.querySelectorAll('.tok')].filter(span=>/[A-Za-z]/.test(span.dataset.w||''));
  let masked=0;
  targets.forEach((target,groupIndex)=>{
    const start=Math.max(0,Number(target?.tokenStart)||0);
    const end=Math.min(wordSpans.length-1,Number(target?.tokenEnd)||start);
    for(let i=start;i<=end;i+=1){
      const span=wordSpans[i];
      if(!span) continue;
      span.classList.add('cloze-mask');
      span.dataset.clozeGroup=String(groupIndex);
      if(i===start) span.classList.add('cloze-start');
      if(i===end) span.classList.add('cloze-end');
      masked+=1;
    }
  });
  return masked;
}

function renderCloze(){
  if(!state.ready||state.rendering) return;
  const en=document.getElementById('enText');
  const study=document.getElementById('studyView');
  if(!en||!study||study.hidden) return;
  if(currentStudyMode()!=='read'){
    clearCloze(en);
    return;
  }
  if(!en.classList.contains('concealed')){
    clearCloze(en);
    return;
  }
  const itemId=String(en.dataset.itemId||'');
  const item=state.items.get(itemId);
  if(!item?.en) return;
  if(en.dataset.clozeRendered===itemId && en.classList.contains('cloze-active') && en.querySelector('.tok')) return;
  state.rendering=true;
  try{
    const card=buildClozeCard(item,state.vocabByExample.get(itemId)||[]);
    en.innerHTML=spanify(item.en);
    applyMasks(en,card.targets||[]);
    en.classList.add('cloze-active');
    en.dataset.clozeRendered=itemId;
    // tagMode used to auto-swipe new read cards into stronger hints. The cloze
    // surface is now the default support, so suppress only those immediate
    // synthetic swipes. Manual swipes and later failure recovery still work.
    state.blockSyntheticUntil=performance.now()+700;
  }finally{
    state.rendering=false;
  }
}

function scheduleRender(){
  queueMicrotask(renderCloze);
}

function blockInitialSyntheticSwipe(event){
  if(currentStudyMode()!=='read') return;
  if(event.isTrusted) return;
  if(performance.now()>state.blockSyntheticUntil) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

async function init(){
  injectStyles();
  await loadData();
  const en=document.getElementById('enText');
  const card=document.getElementById('card');
  const study=document.getElementById('studyView');
  if(!en||!card||!study) return;
  const observer=new MutationObserver(scheduleRender);
  observer.observe(en,{attributes:true,attributeFilter:['data-item-id','class'],childList:true});
  const viewObserver=new MutationObserver(scheduleRender);
  viewObserver.observe(study,{attributes:true,attributeFilter:['hidden']});
  card.addEventListener('touchstart',blockInitialSyntheticSwipe,true);
  card.addEventListener('touchend',blockInitialSyntheticSwipe,true);
  scheduleRender();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Cloze mode failed to initialize',error)),{once:true});
  else init().catch(error=>console.warn('Cloze mode failed to initialize',error));
}
