import {
  buildAutomaticSession,
  buildLegacyQueueItems,
  consumeRequestedTagScope,
  levelOf,
} from './adaptiveLearning.js';
import { labelForTag } from './tagLearningCore.js';

const LEVEL_KEY='itemLevelV1';
const ALL_LEVELS=[0,1,2,3,4,5];
const STATUS_LEVELS={all:ALL_LEVELS,fresh:[0],learning:[1,2,3],stable:[4,5]};

const state={
  items:[],
  characters:new Map(),
  manualPool:null,
  sessionPlan:null,
  originalAllItems:null,
  restoring:false,
  exploreStatus:'all',
  currentItemId:'',
  lastView:'',
};

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function loadJsonStorage(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  }catch(_){ return fallback; }
}
function loadLevelState(){ return loadJsonStorage(LEVEL_KEY,{}); }
function iconPath(profile){
  const name=String(profile?.name||'').trim();
  return name ? `./${encodeURIComponent(name)}.png` : '';
}

export function isMainRuntimeReady(windowObj=globalThis.window,documentObj=globalThis.document){
  return !!(
    Array.isArray(windowObj?.ALL_ITEMS)
    && windowObj.ALL_ITEMS.length
    && documentObj?.getElementById?.('startStudyCta')
  );
}

async function waitForMainReady(){
  while(!isMainRuntimeReady()){
    await sleep(80);
  }
  return true;
}

async function loadCharacters(){
  try{
    const res=await fetch('./data/characters.json',{cache:'default'});
    if(!res.ok) return [];
    const raw=await res.json();
    return Array.isArray(raw)?raw:(Array.isArray(raw?.characters)?raw.characters:[]);
  }catch(_){ return []; }
}

function injectStyles(){
  if(document.getElementById('sessionShellStyles')) return;
  const style=document.createElement('style');
  style.id='sessionShellStyles';
  style.textContent=`
    #dailyGoalCard,#dailyOverviewCard,#sessionGoalCard,#personalPlanSummary{display:none!important}
    #homeView>#rangeBar{display:none!important}
    body.focus-home-view header .stat{display:none!important}
    body.focus-home-view main{padding-top:4px}
    .home-cta-wrap.focus-home{display:flex!important;flex-direction:column;gap:12px;align-items:stretch;margin:10vh auto 20px;max-width:520px;padding:0 16px}
    .home-cta-wrap.focus-home .home-cta{min-height:58px;font-size:18px;font-weight:800;border-radius:18px;box-shadow:0 12px 30px rgba(72,88,255,.22)}
    .focus-home-meta{display:flex;justify-content:center;gap:10px;align-items:center;font-size:13px;opacity:.68;min-height:20px}
    .focus-home-nav{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .focus-home-nav button{border:1px solid rgba(148,163,184,.17);background:rgba(148,163,184,.07);color:inherit;border-radius:14px;padding:13px 10px;font:inherit;font-weight:700;cursor:pointer}
    #chips,.study-stage-access,#studyView .kpi>div:nth-child(2),#footerInfoBtn,#footerMessage{display:none!important}
    .memory-cue{min-height:30px;display:flex;align-items:center;gap:6px;margin:0 0 7px;opacity:.82}
    .memory-cue:empty{display:none}.memory-cue__person{width:29px;height:29px;border-radius:9px;object-fit:cover;background:rgba(148,163,184,.12)}
    .memory-cue__scene{font-size:10px;opacity:.6;margin-left:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
    .review-complete h2{font-size:28px;margin-bottom:8px}#reviewActionFocusReview{display:none!important}
    .review-complete-actions{display:grid!important;grid-template-columns:1fr auto;gap:9px;align-items:center}#reviewActionContinue{min-height:50px}
    #reviewActionFinish{background:transparent!important;border-color:transparent!important;opacity:.7;padding-inline:12px}
    .focus-dialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 18px,680px);max-height:calc(100dvh - 18px);overflow:visible}
    .focus-dialog::backdrop{background:rgba(3,6,16,.76);backdrop-filter:blur(5px)}
    .focus-sheet{display:flex;flex-direction:column;max-height:calc(100dvh - 18px);overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:24px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.46)}
    .focus-sheet__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 17px 12px;border-bottom:1px solid rgba(148,163,184,.1)}
    .focus-sheet__head h2{margin:0;font-size:19px}.focus-sheet__close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .focus-sheet__body{padding:14px 16px 18px;overflow:auto;overscroll-behavior:contain}
    #focusExploreDialog #rangeBar{display:grid!important;grid-template-columns:1fr!important;gap:9px!important;margin:0!important;padding:0!important;background:transparent!important;border:0!important}
    #focusExploreDialog .range-item{width:100%!important}#focusExploreDialog select,#focusExploreDialog input[type=search]{width:100%!important;min-height:46px!important;border-radius:12px!important}
    .explore-hidden{display:none!important}.explore-status{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:0 0 12px}
    .explore-status button{border:1px solid rgba(148,163,184,.13);background:rgba(148,163,184,.045);color:inherit;border-radius:10px;padding:9px 4px;font:inherit;font-size:11px;cursor:pointer}
    .explore-status button.is-active{border-color:rgba(129,140,248,.5);background:rgba(99,102,241,.13);font-weight:750}
    .explore-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:12px}.explore-actions button{min-height:48px;border-radius:13px;font:inherit;font-weight:750;cursor:pointer}
    .explore-tag-link{border:1px solid rgba(148,163,184,.15);background:rgba(148,163,184,.05);color:inherit;padding:0 14px}.explore-start{border:0;background:#6366f1;color:#fff}
    .explore-count{text-align:center;font-size:11px;opacity:.55;margin-top:8px}.cfg-fieldset[data-focus-hidden=true]{display:none!important}
    @media(max-width:390px){.home-cta-wrap.focus-home{margin-top:7vh}.focus-sheet__body{padding-inline:12px}}
  `;
  document.head.appendChild(style);
}

function currentView(){
  const study=document.getElementById('studyView');
  const review=document.getElementById('reviewCompleteView');
  return !study?.hidden?'study':(!review?.hidden?'review':'home');
}

function setBodyViewClass(){
  const view=currentView();
  document.body.classList.toggle('focus-home-view',view==='home');
  document.body.classList.toggle('focus-study-view',view==='study');
  document.body.classList.toggle('focus-review-view',view==='review');
  if(view===state.lastView) return;
  const previous=state.lastView;
  state.lastView=view;
  if(view==='study'){
    state.currentItemId='';
    restoreAllItemsSoon();
  }else if(view==='review'){
    simplifyReview();
    refreshHomeMeta();
  }else if(view==='home'&&previous==='study'){
    restoreAllItems();
  }
}

function simplifyReview(){
  const view=document.getElementById('reviewCompleteView');
  if(!view) return;
  const title=view.querySelector('h2'); if(title) title.textContent='完了';
  const cont=document.getElementById('reviewActionContinue'); if(cont) cont.textContent='続ける';
  const finish=document.getElementById('reviewActionFinish'); if(finish) finish.textContent='終了';
}

function setupCompactHome(){
  const wrap=document.querySelector('.home-cta-wrap');
  const cta=document.getElementById('startStudyCta');
  if(!wrap||!cta) return;
  wrap.classList.add('focus-home');
  let meta=document.getElementById('focusHomeMeta');
  if(!meta){
    meta=document.createElement('div');
    meta.id='focusHomeMeta';
    meta.className='focus-home-meta';
    wrap.insertBefore(meta,cta);
  }
  if(!document.getElementById('focusHomeNav')){
    const nav=document.createElement('div');
    nav.id='focusHomeNav';
    nav.className='focus-home-nav';
    const explore=document.createElement('button');
    explore.type='button';
    explore.textContent='探す';
    explore.addEventListener('click',openExploreDialog);
    nav.appendChild(explore);
    wrap.appendChild(nav);
  }
  refreshHomeMeta();
}

function refreshHomeMeta(){
  const host=document.getElementById('focusHomeMeta');
  if(!host||!state.items.length) return;
  const plan=buildAutomaticSession(state.items,loadLevelState(),{scope:null});
  const today=Math.max(0,Number(document.getElementById('dailyGoalDone')?.textContent)||0);
  host.textContent=`今日 ${today}文 · 次 ${plan.size}文`;
}

function hideInternalSettings(){
  document.querySelectorAll('.cfg-fieldset').forEach(fieldset=>{
    const legend=fieldset.querySelector('legend');
    if(legend?.textContent?.includes('学習モード')) fieldset.dataset.focusHidden='true';
  });
}

function makeDialog(id,title){
  let dialog=document.getElementById(id);
  if(dialog) return dialog;
  dialog=document.createElement('dialog');
  dialog.id=id;
  dialog.className='focus-dialog';
  dialog.innerHTML=`<section class="focus-sheet"><header class="focus-sheet__head"><h2>${title}</h2><button class="focus-sheet__close" type="button" aria-label="閉じる">×</button></header><div class="focus-sheet__body"></div></section>`;
  dialog.querySelector('.focus-sheet__close')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  document.body.appendChild(dialog);
  return dialog;
}

export function filterExploreItems(items,levelState,{section='',query='',status='all'}={}){
  let pool=(Array.isArray(items)?items:[]).slice();
  const sec=String(section||'').trim();
  const q=String(query||'').trim().toLowerCase();
  if(sec) pool=pool.filter(item=>String(item?.unit||'')===sec);
  if(q){
    pool=pool.filter(item=>String(item?.en||'').toLowerCase().includes(q)
      ||String(item?.ja||'').toLowerCase().includes(q)
      ||String(item?.tags||'').toLowerCase().includes(q));
  }
  const levels=new Set(STATUS_LEVELS[status]||ALL_LEVELS);
  return pool.filter(item=>levels.has(levelOf(levelState,item?.id)));
}

function buildExplorePool(){
  return filterExploreItems(state.items,loadLevelState(),{
    section:document.getElementById('secSel')?.value||'',
    query:document.getElementById('rangeSearch')?.value||'',
    status:state.exploreStatus,
  });
}

function renderExploreStatus(){
  document.querySelectorAll('#exploreStatus button').forEach(button=>button.classList.toggle('is-active',button.dataset.status===state.exploreStatus));
}
function updateExploreCount(){
  const host=document.getElementById('exploreCount');
  if(host) host.textContent=`${buildExplorePool().length}文`;
}

function createExploreDialog(){
  const dialog=makeDialog('focusExploreDialog','探す');
  const body=dialog.querySelector('.focus-sheet__body');
  if(body.dataset.ready==='true') return dialog;
  body.dataset.ready='true';
  const status=document.createElement('div');
  status.id='exploreStatus'; status.className='explore-status';
  for(const [key,label] of [['all','すべて'],['fresh','未プレイ'],['learning','進行中'],['stable','クリア']]){
    const button=document.createElement('button');
    button.type='button'; button.dataset.status=key; button.textContent=label;
    button.addEventListener('click',()=>{state.exploreStatus=key;renderExploreStatus();updateExploreCount();});
    status.appendChild(button);
  }
  body.appendChild(status);
  const range=document.getElementById('rangeBar');
  if(range) body.appendChild(range);
  document.getElementById('levelFilter')?.closest('.range-item')?.classList.add('explore-hidden');
  document.getElementById('orderSel')?.closest('.range-item')?.classList.add('explore-hidden');
  const actions=document.createElement('div'); actions.className='explore-actions';
  const tags=document.createElement('button'); tags.type='button'; tags.className='explore-tag-link'; tags.textContent='テーマ';
  tags.addEventListener('click',()=>{dialog.close();globalThis.__OPEN_ENGLISH_TAG_BROWSER__?.();});
  const start=document.createElement('button'); start.type='button'; start.className='explore-start'; start.textContent='この範囲で遊ぶ';
  start.addEventListener('click',()=>{
    state.manualPool=buildExplorePool();
    dialog.close();
    setTimeout(()=>document.getElementById('startStudyCta')?.click(),0);
  });
  actions.append(tags,start); body.appendChild(actions);
  const count=document.createElement('div'); count.id='exploreCount'; count.className='explore-count'; body.appendChild(count);
  document.getElementById('rangeSearch')?.addEventListener('input',updateExploreCount);
  document.getElementById('secSel')?.addEventListener('change',updateExploreCount);
  renderExploreStatus(); updateExploreCount();
  return dialog;
}

function openExploreDialog(){
  const dialog=createExploreDialog();
  updateExploreCount();
  if(!dialog.open) dialog.showModal();
}

function ensureAllLevelsActive(){
  document.querySelectorAll('#levelFilter button[data-level]').forEach(button=>{
    if(button.getAttribute('aria-pressed')!=='true') button.click();
  });
}

function restoreAllItems(){
  if(state.originalAllItems){
    window.ALL_ITEMS=state.originalAllItems;
    state.originalAllItems=null;
  }
}
function restoreAllItemsSoon(){
  if(state.restoring) return;
  state.restoring=true;
  setTimeout(()=>{restoreAllItems();state.restoring=false;},350);
  setTimeout(()=>{restoreAllItems();state.restoring=false;},3000);
}

function setLegacyPlan(plan){
  if(!plan?.items?.length) return false;
  ensureAllLevelsActive();
  const sec=document.getElementById('secSel'); if(sec) sec.value='';
  const studySec=document.getElementById('studySecSel'); if(studySec) studySec.value='';
  const search=document.getElementById('rangeSearch'); if(search) search.value='';
  const order=document.getElementById('orderSel'); if(order) order.value='asc';
  const slider=document.getElementById('sessionGoalSlider');
  if(slider){slider.value=String(plan.size);slider.dispatchEvent(new Event('input',{bubbles:true}));}
  restoreAllItems();
  state.originalAllItems=window.ALL_ITEMS;
  window.ALL_ITEMS=buildLegacyQueueItems(plan.items);
  state.sessionPlan=plan;
  return true;
}

function prepareStart(){
  const requestedScope=consumeRequestedTagScope();
  const pool=state.manualPool||state.items;
  const plan=buildAutomaticSession(pool,loadLevelState(),{scope:requestedScope||null});
  state.manualPool=null;
  return setLegacyPlan(plan);
}

function bindStartInterceptors(){
  document.getElementById('startStudyCta')?.addEventListener('click',prepareStart,true);
  document.getElementById('reviewActionContinue')?.addEventListener('click',prepareStart,true);
}

function ensureMemoryCue(){
  let cue=document.getElementById('tagMemoryCue');
  if(cue) return cue;
  const en=document.getElementById('enText');
  if(!en) return null;
  cue=document.createElement('div'); cue.id='tagMemoryCue'; cue.className='memory-cue';
  en.parentNode?.insertBefore(cue,en);
  return cue;
}

function renderMemoryCue(item){
  const cue=ensureMemoryCue();
  if(!cue) return;
  cue.replaceChildren();
  if(!item) return;
  const chars=(Array.isArray(item.character_tags)?item.character_tags:[])
    .filter(tag=>tag?.id&&tag.certainty!=='inferred_medium').slice(0,2);
  for(const tag of chars){
    const profile=state.characters.get(tag.id);
    if(!profile) continue;
    const img=document.createElement('img'); img.className='memory-cue__person'; img.alt=''; img.src=iconPath(profile); cue.appendChild(img);
  }
  const scene=(Array.isArray(item.situation_tags)?item.situation_tags:[]).find(id=>id&&id!=='general');
  if(scene){
    const span=document.createElement('span'); span.className='memory-cue__scene'; span.textContent=labelForTag('situation',scene); cue.appendChild(span);
  }
}

function onNewItem(itemId){
  if(!itemId||itemId===state.currentItemId) return;
  state.currentItemId=itemId;
  renderMemoryCue(state.items.find(item=>String(item?.id)===itemId)||null);
}

function bindObservers(){
  const en=document.getElementById('enText');
  if(en){
    new MutationObserver(()=>onNewItem(String(en.dataset.itemId||'')))
      .observe(en,{attributes:true,attributeFilter:['data-item-id']});
  }
  const views=['homeView','studyView','reviewCompleteView'].map(id=>document.getElementById(id)).filter(Boolean);
  const viewObserver=new MutationObserver(setBodyViewClass);
  views.forEach(view=>viewObserver.observe(view,{attributes:true,attributeFilter:['hidden']}));
  const daily=document.getElementById('dailyGoalDone');
  if(daily) new MutationObserver(refreshHomeMeta).observe(daily,{childList:true,characterData:true,subtree:true});
  setBodyViewClass();
}

async function init(){
  const charactersPromise=loadCharacters();
  await waitForMainReady();
  state.items=window.ALL_ITEMS.slice();
  const characters=await charactersPromise;
  state.characters=new Map(characters.filter(profile=>profile?.id).map(profile=>[profile.id,profile]));
  setupCompactHome();
  hideInternalSettings();
  bindStartInterceptors();
  bindObservers();
  ensureMemoryCue();
  refreshHomeMeta();
  injectStyles();
  document.dispatchEvent(new CustomEvent('english-pwa:session-shell-ready'));
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Session shell failed',error)),{once:true});
  else init().catch(error=>console.warn('Session shell failed',error));
}