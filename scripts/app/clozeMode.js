import { adaptiveClozeCount, buildClozeCard } from './clozeLearningCore.js';
import {
  inferReadHintStage,
  readHintCopy,
  READ_HINT_STAGE_HIDDEN,
  READ_HINT_STAGE_CLOZE,
  READ_HINT_STAGE_FULL,
} from './hintProgressionCore.js';
import { spanify } from '../utils/text.js';
import { isPostResultReveal, revealCanonicalPostResult } from './postResultFeedback.js';

const state={
  items:new Map(),
  vocabByExample:new Map(),
  ready:false,
  rendering:false,
  scheduled:false,
};

function currentStudyMode(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function currentLevel(itemId){
  try{
    const map=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
    const info=map?.[itemId]||{};
    const last=Number(info.last);
    const best=Number(info.best);
    const level=Number.isFinite(last)?last:(Number.isFinite(best)?best:0);
    return Math.max(0,Math.min(5,Number.isFinite(level)?level:0));
  }catch(_){ return 0; }
}

function injectStyles(){
  if(document.getElementById('clozeModeStyles')) return;
  const style=document.createElement('style');
  style.id='clozeModeStyles';
  style.textContent=`
    .en.concealed[data-read-hint-stage="0"]{
      min-height:0;
    }
    .en.cloze-active{
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
  if(!en) return false;
  let changed=false;
  if(en.classList.contains('cloze-active')){
    en.classList.remove('cloze-active');
    changed=true;
  }
  for(const key of ['clozeRendered','clozeCount']){
    if(key in en.dataset){
      delete en.dataset[key];
      changed=true;
    }
  }
  return changed;
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

function setFooterForStage(stage){
  const footer=document.getElementById('footerMessage');
  if(!footer) return;
  footer.textContent=readHintCopy(stage).footer;
}

function renderHidden(en){
  clearCloze(en);
  const copy=readHintCopy(READ_HINT_STAGE_HIDDEN);
  const current=en.querySelector('.hint-placeholder')?.textContent||'';
  if(current!==copy.placeholder){
    en.innerHTML=`<span class="hint-placeholder">${copy.placeholder}</span>`;
  }
}

function renderCloze(en,item,itemId){
  const level=currentLevel(itemId);
  const targetCount=adaptiveClozeCount(item.en,level);
  const alreadyRendered=en.dataset.clozeRendered===itemId
    && Number(en.dataset.clozeCount)===targetCount
    && en.classList.contains('cloze-active')
    && !!en.querySelector('.cloze-mask');
  if(alreadyRendered) return;
  const card=buildClozeCard(item,state.vocabByExample.get(itemId)||[],{count:targetCount});
  en.innerHTML=spanify(item.en);
  applyMasks(en,card.targets||[]);
  en.classList.add('cloze-active');
  en.dataset.clozeRendered=itemId;
  en.dataset.clozeCount=String(targetCount);
}

function isJapaneseVisible(ja){
  if(!ja||ja.hidden) return false;
  return ja.style.display!=='none';
}

function syncPresentation(){
  state.scheduled=false;
  if(!state.ready||state.rendering) return;
  const en=document.getElementById('enText');
  const ja=document.getElementById('jaText');
  const study=document.getElementById('studyView');
  if(!en||!study||study.hidden) return;
  if(currentStudyMode()!=='read'){
    clearCloze(en);
    delete en.dataset.readHintStage;
    return;
  }

  const itemId=String(en.dataset.itemId||'');
  const item=state.items.get(itemId);
  if(!item?.en) return;

  if(isPostResultReveal(en,itemId)){
    state.rendering=true;
    try{
      clearCloze(en);
      en.classList.remove('concealed');
      const shown=String(en.textContent||'').replace(/\s+/g,' ').trim();
      const canonical=String(item.en).replace(/\s+/g,' ').trim();
      if(shown!==canonical) revealCanonicalPostResult(en,item);
      en.dataset.readHintStage=String(READ_HINT_STAGE_FULL);
    }finally{
      state.rendering=false;
    }
    return;
  }

  const stage=inferReadHintStage({
    concealed:en.classList.contains('concealed'),
    japaneseVisible:isJapaneseVisible(ja),
  });
  en.dataset.readHintStage=String(stage);

  state.rendering=true;
  try{
    if(stage===READ_HINT_STAGE_HIDDEN){
      renderHidden(en);
    }else if(stage===READ_HINT_STAGE_CLOZE){
      renderCloze(en,item,itemId);
    }else if(stage===READ_HINT_STAGE_FULL){
      clearCloze(en);
      // main.js has already restored the canonical full sentence for this stage.
      // Do not rewrite it here; this keeps ASR highlighting and swipe state stable.
    }
    setFooterForStage(stage);
  }finally{
    state.rendering=false;
  }
}

function scheduleSync(){
  if(state.scheduled) return;
  state.scheduled=true;
  requestAnimationFrame(syncPresentation);
}

async function init(){
  injectStyles();
  const en=document.getElementById('enText');
  const ja=document.getElementById('jaText');
  const study=document.getElementById('studyView');
  if(!en||!study) return;

  // Only observe state-bearing attributes. The previous implementation also
  // observed childList while rewriting innerHTML itself, which could cause
  // repeated redraws during a downward hint swipe.
  const enObserver=new MutationObserver(scheduleSync);
  enObserver.observe(en,{attributes:true,attributeFilter:['data-item-id','data-post-result-reveal','class']});
  if(ja){
    const jaObserver=new MutationObserver(scheduleSync);
    jaObserver.observe(ja,{attributes:true,attributeFilter:['style','hidden']});
  }
  const viewObserver=new MutationObserver(scheduleSync);
  viewObserver.observe(study,{attributes:true,attributeFilter:['hidden']});

  await loadData();
  scheduleSync();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Cloze mode failed to initialize',error)),{once:true});
  else init().catch(error=>console.warn('Cloze mode failed to initialize',error));
}
