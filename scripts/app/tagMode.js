import {
  TAG_TYPES,
  TAG_TYPE_META,
  buildTagCatalog,
  recommendTags,
  labelForTag,
} from './tagLearningCore.js';
import {
  buildAutomaticSession,
  buildLegacyQueueItems,
  determineLearningStage,
  hintSwipesForStage,
  levelOf,
} from './adaptiveLearning.js';
import { createUxMetrics } from './uxMetrics.js';

const LEVEL_KEY='itemLevelV1';
const TAB_KEY='tagLearningTabV2';
const SELECTED_KEY='tagLearningSelectionV2';
const ALL_LEVELS=[0,1,2,3,4,5];
const STATUS_LEVELS={all:ALL_LEVELS,fresh:[0],learning:[1,2,3],stable:[4,5]};
const metrics=createUxMetrics();

const state={
  items:[],
  characters:[],
  characterMap:new Map(),
  catalog:null,
  activeType:'character',
  selected:null,
  pendingScope:null,
  manualPool:null,
  sessionPlan:null,
  originalAllItems:null,
  restoring:false,
  currentItemId:'',
  fallbackUsed:new Set(),
  sessionSeen:new Set(),
  sessionFailures:new Set(),
  exploreStatus:'all',
  touchStart:null,
  autoHinting:false,
  lastView:'',
  lastSessionSnapshot:null,
};

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
function escapeText(value){ return String(value??''); }
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function waitForLegacyReady(timeout=9000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    if(Array.isArray(window.ALL_ITEMS) && window.ALL_ITEMS.length && document.getElementById('startStudyCta') && document.querySelector('#levelFilter button[data-level]')) return true;
    await sleep(60);
  }
  return false;
}

async function loadCharacters(){
  try{
    const res=await fetch('./data/characters.json',{cache:'no-cache'});
    if(!res.ok) return [];
    const data=await res.json();
    if(Array.isArray(data)) return data;
    return Array.isArray(data?.characters)?data.characters:[];
  }catch(_){ return []; }
}

function injectStyles(){
  if(document.getElementById('focusUxStyles')) return;
  const style=document.createElement('style');
  style.id='focusUxStyles';
  style.textContent=`
    #dailyGoalCard,#dailyOverviewCard,#sessionGoalCard,#personalPlanSummary{display:none!important}
    #homeView>#rangeBar{display:none!important}
    body.focus-home-view header .stat{display:none!important}
    body.focus-home-view header{min-height:48px;border-bottom-color:transparent}
    body.focus-home-view main{padding-top:4px}
    .home-cta-wrap.focus-home{display:flex!important;flex-direction:column;gap:12px;align-items:stretch;margin:10vh auto 20px;max-width:520px;padding:0 16px}
    .home-cta-wrap.focus-home .home-cta{min-height:58px;font-size:18px;font-weight:800;border-radius:18px;box-shadow:0 12px 30px rgba(72,88,255,.22)}
    .focus-home-meta{display:flex;justify-content:center;gap:10px;align-items:center;font-size:13px;opacity:.68;min-height:20px}
    .focus-home-nav{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .focus-home-nav button{border:1px solid rgba(148,163,184,.17);background:rgba(148,163,184,.07);color:inherit;border-radius:14px;padding:13px 10px;font:inherit;font-weight:700;cursor:pointer}
    .focus-home-nav button:active{transform:scale(.985)}
    #chips{display:none!important}
    .study-stage-access{display:none!important}
    #studyView .kpi>div:nth-child(2){display:none!important}
    #footerInfoBtn,#footerMessage{display:none!important}
    .footer-trust-links{opacity:.4}
    .memory-cue{min-height:30px;display:flex;align-items:center;gap:6px;margin:0 0 7px;opacity:.82}
    .memory-cue:empty{display:none}
    .memory-cue__person{width:29px;height:29px;border-radius:9px;object-fit:cover;background:rgba(148,163,184,.12)}
    .memory-cue__scene{font-size:10px;opacity:.6;margin-left:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
    .memory-cue__more{font-size:10px;opacity:.45}
    .review-complete h2{font-size:28px;margin-bottom:8px}
    #reviewActionFocusReview{display:none!important}
    .review-complete-actions{display:grid!important;grid-template-columns:1fr auto;gap:9px;align-items:center}
    #reviewActionContinue{min-height:50px}
    #reviewActionFinish{background:transparent!important;border-color:transparent!important;opacity:.7;padding-inline:12px}
    .focus-dialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 18px,680px);max-height:calc(100dvh - 18px);overflow:visible}
    .focus-dialog::backdrop{background:rgba(3,6,16,.76);backdrop-filter:blur(5px)}
    .focus-sheet{display:flex;flex-direction:column;max-height:calc(100dvh - 18px);overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:24px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.46)}
    .focus-sheet__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 17px 12px;border-bottom:1px solid rgba(148,163,184,.1)}
    .focus-sheet__head h2{margin:0;font-size:19px}.focus-sheet__close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .focus-sheet__body{padding:14px 16px 18px;overflow:auto;overscroll-behavior:contain}
    .focus-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:4px;background:rgba(148,163,184,.07);border-radius:13px;position:sticky;top:0;z-index:2;backdrop-filter:blur(8px)}
    .focus-tab{border:0;border-radius:10px;background:transparent;color:inherit;padding:10px 4px;font:inherit;font-size:13px;opacity:.6;cursor:pointer}.focus-tab.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .focus-recommend{margin:12px 0 4px;border:1px solid rgba(129,140,248,.2);background:rgba(99,102,241,.08);color:inherit;border-radius:13px;padding:10px 12px;width:100%;text-align:left;font:inherit;cursor:pointer}.focus-recommend small{opacity:.55;margin-left:7px}
    .focus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.focus-tag-card{border:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.045);color:inherit;border-radius:15px;padding:11px;text-align:left;font:inherit;cursor:pointer;min-width:0}.focus-tag-card.is-selected{border-color:rgba(129,140,248,.58);background:rgba(99,102,241,.12)}
    .focus-tag-card--person{display:grid;grid-template-columns:46px minmax(0,1fr);gap:9px;align-items:center}.focus-tag-card img{width:46px;height:46px;border-radius:13px;object-fit:cover;background:rgba(148,163,184,.1)}.focus-tag-card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.focus-tag-card small{display:block;margin-top:4px;opacity:.55;font-size:10px}.focus-mini-progress{height:3px;background:rgba(148,163,184,.12);border-radius:99px;margin-top:7px;overflow:hidden}.focus-mini-progress i{display:block;height:100%;background:currentColor;opacity:.6}
    .focus-detail{position:sticky;bottom:-1px;margin:13px -4px -5px;padding:12px;border:1px solid rgba(129,140,248,.2);border-radius:17px;background:rgba(16,21,34,.97);box-shadow:0 -10px 30px rgba(0,0,0,.2);backdrop-filter:blur(12px)}.focus-detail__hero{display:flex;gap:10px;align-items:center}.focus-detail__hero img{width:52px;height:52px;border-radius:15px;object-fit:cover}.focus-detail__title{font-weight:850;font-size:17px}.focus-detail__sub{font-size:11px;opacity:.58;margin-top:2px}.focus-detail__summary{font-size:12px;line-height:1.55;opacity:.76;margin:8px 0 0}.focus-detail__start{width:100%;min-height:48px;border:0;border-radius:13px;background:#6366f1;color:#fff;font:inherit;font-weight:850;margin-top:10px;cursor:pointer}.focus-detail details{font-size:11px;opacity:.68;margin-top:7px}.focus-detail details div{margin-top:5px;line-height:1.55}
    .explore-status{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:12px 0}.explore-status button{border:1px solid rgba(148,163,184,.13);background:rgba(148,163,184,.045);color:inherit;border-radius:10px;padding:9px 4px;font:inherit;font-size:11px;cursor:pointer}.explore-status button.is-active{border-color:rgba(129,140,248,.5);background:rgba(99,102,241,.13);font-weight:750}
    #focusExploreDialog #rangeBar{display:grid!important;grid-template-columns:1fr!important;gap:9px!important;margin:0!important;padding:0!important;background:transparent!important;border:0!important}.explore-hidden{display:none!important}#focusExploreDialog .range-item{width:100%!important}#focusExploreDialog select,#focusExploreDialog input[type=search]{width:100%!important;min-height:46px!important;border-radius:12px!important}.explore-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:12px}.explore-actions button{min-height:48px;border-radius:13px;font:inherit;font-weight:750;cursor:pointer}.explore-tag-link{border:1px solid rgba(148,163,184,.15);background:rgba(148,163,184,.05);color:inherit;padding:0 14px}.explore-start{border:0;background:#6366f1;color:#fff}.explore-count{text-align:center;font-size:11px;opacity:.55;margin-top:8px}.ux-debug{margin-top:15px;font-size:11px;opacity:.65}.ux-debug pre{white-space:pre-wrap;font-size:10px}
    .cfg-fieldset[data-focus-hidden=true]{display:none!important}
    @media(min-width:650px){.focus-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.home-cta-wrap.focus-home{margin-top:12vh}}
    @media(max-width:390px){.home-cta-wrap.focus-home{margin-top:7vh}.focus-sheet__body{padding-inline:12px}.focus-grid{gap:6px}.focus-tag-card{padding:9px}.focus-tag-card--person{grid-template-columns:40px minmax(0,1fr)}.focus-tag-card img{width:40px;height:40px}.focus-tabs{gap:3px}.focus-tab{font-size:12px}}
  `;
  document.head.appendChild(style);
}

function setBodyViewClass(){
  const home=document.getElementById('homeView');
  const study=document.getElementById('studyView');
  const review=document.getElementById('reviewCompleteView');
  const view=!study?.hidden?'study':(!review?.hidden?'review':'home');
  document.body.classList.toggle('focus-home-view',view==='home');
  document.body.classList.toggle('focus-study-view',view==='study');
  document.body.classList.toggle('focus-review-view',view==='review');
  if(view===state.lastView) return;
  const previous=state.lastView;
  state.lastView=view;
  if(view==='study'){
    state.sessionSeen=new Set(); state.sessionFailures=new Set(); state.fallbackUsed=new Set(); state.currentItemId='';
    metrics.markSessionStarted({planned:state.sessionPlan?.size||0});
    restoreAllItemsSoon();
  }else if(view==='review'){
    const snapshot=metrics.markSessionComplete('review_complete')||{cards:state.sessionSeen.size,failures:state.sessionFailures.size};
    state.lastSessionSnapshot=snapshot;
    simplifyReview(snapshot);
    refreshHomeMeta();
  }else if(view==='home' && previous==='study'){
    metrics.markAbandon('returned_home');
    restoreAllItems();
  }
}

function simplifyReview(snapshot){
  const view=document.getElementById('reviewCompleteView'); if(!view) return;
  const title=view.querySelector('h2'); if(title) title.textContent='完了';
  const msg=document.getElementById('reviewCompleteMessage');
  const cards=Math.max(0,Number(snapshot?.cards)||state.sessionSeen.size);
  const failures=Math.max(0,Number(snapshot?.failures)||state.sessionFailures.size);
  if(msg) msg.textContent=failures?`${cards}文 完了 · 要復習 ${failures}文`:`${cards}文 完了`;
  const cont=document.getElementById('reviewActionContinue'); if(cont) cont.textContent='続ける';
  const finish=document.getElementById('reviewActionFinish'); if(finish) finish.textContent='終了';
}

function setupCompactHome(){
  const wrap=document.querySelector('.home-cta-wrap'); const cta=document.getElementById('startStudyCta');
  if(!wrap||!cta) return;
  wrap.classList.add('focus-home'); cta.textContent='学習を始める';
  let meta=document.getElementById('focusHomeMeta');
  if(!meta){ meta=document.createElement('div'); meta.id='focusHomeMeta'; meta.className='focus-home-meta'; wrap.insertBefore(meta,cta); }
  if(!document.getElementById('focusHomeNav')){
    const nav=document.createElement('div'); nav.id='focusHomeNav'; nav.className='focus-home-nav';
    const tags=document.createElement('button'); tags.type='button'; tags.textContent='キャラ・タグ'; tags.addEventListener('click',openTagDialog);
    const explore=document.createElement('button'); explore.type='button'; explore.textContent='探す'; explore.addEventListener('click',openExploreDialog);
    nav.append(tags,explore); wrap.appendChild(nav);
  }
  refreshHomeMeta();
}

function refreshHomeMeta(){
  const host=document.getElementById('focusHomeMeta'); if(!host||!state.items.length) return;
  const plan=buildAutomaticSession(state.items,loadLevelState());
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
  let dialog=document.getElementById(id); if(dialog) return dialog;
  dialog=document.createElement('dialog'); dialog.id=id; dialog.className='focus-dialog';
  dialog.innerHTML=`<section class="focus-sheet"><header class="focus-sheet__head"><h2>${title}</h2><button class="focus-sheet__close" type="button" aria-label="閉じる">×</button></header><div class="focus-sheet__body"></div></section>`;
  dialog.querySelector('.focus-sheet__close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',ev=>{ if(ev.target===dialog) dialog.close(); });
  document.body.appendChild(dialog); return dialog;
}

function rebuildCatalog(){ state.catalog=buildTagCatalog(state.items,state.characters,loadLevelState(),Date.now()); }

function createTagDialog(){
  const dialog=makeDialog('focusTagDialog','タグから選ぶ');
  const body=dialog.querySelector('.focus-sheet__body');
  body.innerHTML='<div class="focus-tabs" id="focusTagTabs"></div><div id="focusTagRecommendation"></div><div id="focusTagCatalog"></div><div id="focusTagDetail"></div>';
  return dialog;
}

function openTagDialog(){
  rebuildCatalog(); renderTagDialog(); const dialog=createTagDialog(); if(!dialog.open) dialog.showModal();
}

function renderTagDialog(){
  const dialog=createTagDialog();
  const tabs=dialog.querySelector('#focusTagTabs'); tabs.replaceChildren();
  for(const type of TAG_TYPES){
    const btn=document.createElement('button'); btn.type='button'; btn.className='focus-tab'+(type===state.activeType?' is-active':''); btn.textContent=TAG_TYPE_META[type].label;
    btn.addEventListener('click',()=>{ state.activeType=type; state.selected=null; localStorage.setItem(TAB_KEY,type); renderTagDialog(); }); tabs.appendChild(btn);
  }
  const recHost=dialog.querySelector('#focusTagRecommendation'); recHost.replaceChildren();
  const rec=recommendTags(state.catalog,{limit:1})[0];
  if(rec){ const btn=document.createElement('button'); btn.type='button'; btn.className='focus-recommend'; btn.textContent=`おすすめ · ${rec.label}`; const small=document.createElement('small'); small.textContent=`${rec.total}文`; btn.appendChild(small); btn.addEventListener('click',()=>{ state.activeType=rec.type; state.selected={type:rec.type,id:rec.id}; renderTagDialog(); }); recHost.appendChild(btn); }
  const catalog=dialog.querySelector('#focusTagCatalog'); catalog.replaceChildren();
  const grid=document.createElement('div'); grid.className='focus-grid';
  for(const entry of state.catalog?.[state.activeType]||[]) grid.appendChild(createTagCard(entry));
  catalog.appendChild(grid);
  const selectedEntry=(state.catalog?.[state.activeType]||[]).find(entry=>entry.id===state.selected?.id && entry.type===state.selected?.type);
  renderTagDetail(selectedEntry||null);
}

function createTagCard(entry){
  const btn=document.createElement('button'); btn.type='button'; btn.className='focus-tag-card'+(entry.type==='character'?' focus-tag-card--person':'');
  if(state.selected?.type===entry.type && state.selected?.id===entry.id) btn.classList.add('is-selected');
  if(entry.type==='character'){
    const img=document.createElement('img'); img.alt=''; img.loading='lazy'; img.decoding='async'; if(entry.profile) img.src=iconPath(entry.profile);
    const text=document.createElement('span'); const name=document.createElement('strong'); name.textContent=entry.label;
    const small=document.createElement('small'); const total=entry.coreTotal||entry.total; small.textContent=`${entry.mastered}/${total}`;
    const bar=document.createElement('span'); bar.className='focus-mini-progress'; const fill=document.createElement('i'); fill.style.width=`${entry.mastery}%`; bar.appendChild(fill); text.append(name,small,bar); btn.append(img,text);
  }else{
    const name=document.createElement('strong'); name.textContent=entry.label; const small=document.createElement('small'); small.textContent=`${entry.total}文`;
    const bar=document.createElement('span'); bar.className='focus-mini-progress'; const fill=document.createElement('i'); fill.style.width=`${entry.mastery}%`; bar.appendChild(fill); btn.append(name,small,bar);
  }
  btn.addEventListener('click',()=>{ state.selected={type:entry.type,id:entry.id}; localStorage.setItem(SELECTED_KEY,JSON.stringify(state.selected)); renderTagDialog(); });
  return btn;
}

function relationText(rel){
  const target=state.characterMap.get(rel?.character_id); const who=target?.name||rel?.character_id||'';
  return [who,rel?.label_ja||rel?.type||''].filter(Boolean).join('：');
}

function renderTagDetail(entry){
  const host=document.querySelector('#focusTagDialog #focusTagDetail'); if(!host) return; host.replaceChildren(); if(!entry) return;
  const box=document.createElement('div'); box.className='focus-detail';
  const hero=document.createElement('div'); hero.className='focus-detail__hero';
  if(entry.type==='character'&&entry.profile){ const img=document.createElement('img'); img.alt=''; img.src=iconPath(entry.profile); hero.appendChild(img); }
  const text=document.createElement('div'); const title=document.createElement('div'); title.className='focus-detail__title'; title.textContent=entry.label;
  const sub=document.createElement('div'); sub.className='focus-detail__sub'; sub.textContent=`${entry.mastered}/${entry.type==='character'?(entry.coreTotal||entry.total):entry.total} 習得`; text.append(title,sub); hero.appendChild(text); box.appendChild(hero);
  if(entry.type==='character'){
    const summary=entry.profile?.summary_ja||entry.profile?.archetype_ja||'';
    if(summary){ const p=document.createElement('p'); p.className='focus-detail__summary'; p.textContent=summary; box.appendChild(p); }
    const rels=Array.isArray(entry.profile?.relationships)?entry.profile.relationships:[];
    if(rels.length){ const details=document.createElement('details'); const s=document.createElement('summary'); s.textContent='関係'; const d=document.createElement('div'); d.textContent=rels.map(relationText).filter(Boolean).join(' / '); details.append(s,d); box.appendChild(details); }
  }
  const start=document.createElement('button'); start.type='button'; start.className='focus-detail__start'; start.textContent='このタグで学習';
  start.addEventListener('click',()=>{
    state.pendingScope={type:entry.type,id:entry.id,includeMedium:entry.type!=='character'};
    document.getElementById('focusTagDialog')?.close();
    setTimeout(()=>document.getElementById('startStudyCta')?.click(),0);
  }); box.appendChild(start); host.appendChild(box);
}

function createExploreDialog(){
  const dialog=makeDialog('focusExploreDialog','探す'); const body=dialog.querySelector('.focus-sheet__body');
  if(body.dataset.ready==='true') return dialog;
  body.dataset.ready='true';
  const range=document.getElementById('rangeBar'); if(range) body.appendChild(range);
  const level=document.getElementById('levelFilter')?.closest('.range-item'); if(level) level.classList.add('explore-hidden');
  const order=document.getElementById('orderSel')?.closest('.range-item'); if(order) order.classList.add('explore-hidden');
  const status=document.createElement('div'); status.className='explore-status'; status.id='exploreStatus';
  for(const [key,label] of [['all','すべて'],['fresh','未学習'],['learning','学習中'],['stable','定着']]){ const b=document.createElement('button'); b.type='button'; b.dataset.status=key; b.textContent=label; b.addEventListener('click',()=>{ state.exploreStatus=key; renderExploreStatus(); updateExploreCount(); }); status.appendChild(b); }
  body.insertBefore(status,range?.nextSibling||body.firstChild);
  const actions=document.createElement('div'); actions.className='explore-actions';
  const tag=document.createElement('button'); tag.type='button'; tag.className='explore-tag-link'; tag.textContent='タグ'; tag.addEventListener('click',()=>{ dialog.close(); openTagDialog(); });
  const start=document.createElement('button'); start.type='button'; start.className='explore-start'; start.textContent='学習する'; start.addEventListener('click',()=>{ state.manualPool=buildExplorePool(); dialog.close(); setTimeout(()=>document.getElementById('startStudyCta')?.click(),0); });
  actions.append(tag,start); body.appendChild(actions);
  const count=document.createElement('div'); count.id='exploreCount'; count.className='explore-count'; body.appendChild(count);
  document.getElementById('rangeSearch')?.addEventListener('input',updateExploreCount);
  document.getElementById('secSel')?.addEventListener('change',updateExploreCount);
  if(new URLSearchParams(location.search).get('debug')==='1'){
    const debug=document.createElement('details'); debug.className='ux-debug'; const summary=document.createElement('summary'); summary.textContent='UX debug'; const pre=document.createElement('pre'); pre.id='uxDebugPre'; debug.append(summary,pre); body.appendChild(debug);
  }
  renderExploreStatus(); updateExploreCount(); return dialog;
}

function openExploreDialog(){
  const dialog=createExploreDialog(); updateExploreCount(); updateDebugStats(); if(!dialog.open) dialog.showModal();
}

function renderExploreStatus(){
  document.querySelectorAll('#exploreStatus button').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.status===state.exploreStatus));
}

function buildExplorePool(){
  let pool=state.items.slice(); const sec=String(document.getElementById('secSel')?.value||'').trim(); const q=String(document.getElementById('rangeSearch')?.value||'').trim().toLowerCase();
  if(sec) pool=pool.filter(item=>String(item?.unit||'')===sec);
  if(q) pool=pool.filter(item=>String(item?.en||'').toLowerCase().includes(q)||String(item?.ja||'').toLowerCase().includes(q)||String(item?.tags||'').toLowerCase().includes(q));
  const levels=new Set(STATUS_LEVELS[state.exploreStatus]||ALL_LEVELS); const levelState=loadLevelState();
  pool=pool.filter(item=>levels.has(levelOf(levelState,item?.id)));
  return pool;
}
function updateExploreCount(){ const host=document.getElementById('exploreCount'); if(host) host.textContent=`${buildExplorePool().length}文`; }
function updateDebugStats(){ const pre=document.getElementById('uxDebugPre'); if(pre) pre.textContent=JSON.stringify(metrics.summary(),null,2); }

function ensureAllLevelsActive(){
  const buttons=[...document.querySelectorAll('#levelFilter button[data-level]')];
  for(const btn of buttons){ if(btn.getAttribute('aria-pressed')!=='true') btn.click(); }
}

function setLegacyPlan(plan){
  if(!plan?.items?.length) return false;
  ensureAllLevelsActive();
  const sec=document.getElementById('secSel'); if(sec) sec.value='';
  const studySec=document.getElementById('studySecSel'); if(studySec) studySec.value='';
  const search=document.getElementById('rangeSearch'); if(search) search.value='';
  const order=document.getElementById('orderSel'); if(order) order.value='asc';
  const slider=document.getElementById('sessionGoalSlider'); if(slider){ slider.value=String(plan.size); slider.dispatchEvent(new Event('input',{bubbles:true})); }
  restoreAllItems();
  state.originalAllItems=window.ALL_ITEMS;
  window.ALL_ITEMS=buildLegacyQueueItems(plan.items);
  state.sessionPlan=plan;
  return true;
}

function restoreAllItems(){
  if(state.originalAllItems){ window.ALL_ITEMS=state.originalAllItems; state.originalAllItems=null; }
}
function restoreAllItemsSoon(){
  if(state.restoring) return; state.restoring=true;
  setTimeout(()=>{ restoreAllItems(); state.restoring=false; },350);
  setTimeout(()=>{ restoreAllItems(); state.restoring=false; },3000);
}

function prepareStart(mode){
  const levelState=loadLevelState();
  let pool=state.items; let scope=state.pendingScope;
  if(state.manualPool){ pool=state.manualPool; scope=null; mode='manual'; }
  const plan=buildAutomaticSession(pool,levelState,{scope});
  state.pendingScope=null; state.manualPool=null;
  if(!plan.items.length) return false;
  metrics.markStartIntent(mode||'auto');
  return setLegacyPlan(plan);
}

function bindStartInterceptors(){
  const cta=document.getElementById('startStudyCta');
  cta?.addEventListener('click',()=>{
    const mode=state.pendingScope?'tag':(state.manualPool?'manual':'auto');
    prepareStart(mode);
  },true);
  document.getElementById('reviewActionContinue')?.addEventListener('click',()=>prepareStart('continue'),true);
}

function cueForItem(item){
  const chars=(Array.isArray(item?.character_tags)?item.character_tags:[]).filter(tag=>tag?.id&&tag.certainty!=='inferred_medium').slice(0,2);
  const scene=(Array.isArray(item?.situation_tags)?item.situation_tags:[]).find(id=>id&&id!=='general')||'';
  return {chars,scene};
}

function ensureMemoryCue(){
  let cue=document.getElementById('tagMemoryCue'); if(cue) return cue;
  const en=document.getElementById('enText'); if(!en) return null;
  cue=document.createElement('div'); cue.id='tagMemoryCue'; cue.className='memory-cue'; en.parentNode.insertBefore(cue,en); return cue;
}

function renderMemoryCue(item){
  const cue=ensureMemoryCue(); if(!cue) return; cue.replaceChildren(); if(!item) return;
  const {chars,scene}=cueForItem(item);
  for(const tag of chars){ const profile=state.characterMap.get(tag.id); if(!profile) continue; const img=document.createElement('img'); img.className='memory-cue__person'; img.alt=''; img.src=iconPath(profile); cue.appendChild(img); }
  if(scene){ const span=document.createElement('span'); span.className='memory-cue__scene'; span.textContent=labelForTag('situation',scene); cue.appendChild(span); }
}

function makeTouchEvent(type,props){
  const ev=new Event(type,{bubbles:true,cancelable:true});
  for(const [key,value] of Object.entries(props||{})){ try{ Object.defineProperty(ev,key,{value,configurable:true}); }catch(_){} }
  return ev;
}

async function dispatchDownSwipe({automatic=true}={}){
  const card=document.getElementById('card'); if(!card||document.getElementById('studyView')?.hidden) return false;
  const rect=card.getBoundingClientRect(); const x=Math.max(10,rect.width/2); const y=Math.max(20,Math.min(90,rect.height*.25));
  const startPoint={clientX:x,clientY:y,target:card}; const endPoint={clientX:x,clientY:y+120,target:card};
  state.autoHinting=automatic;
  card.dispatchEvent(makeTouchEvent('touchstart',{touches:[startPoint]}));
  await sleep(36);
  card.dispatchEvent(makeTouchEvent('touchend',{changedTouches:[endPoint]}));
  metrics.markHint({automatic});
  state.autoHinting=false;
  return true;
}

async function applyAdaptiveAssistance(itemId){
  if(!itemId||itemId!==state.currentItemId||document.getElementById('studyView')?.hidden) return;
  const info=loadLevelState()?.[itemId]||{}; const stage=determineLearningStage(info); const count=hintSwipesForStage(stage);
  for(let i=0;i<count;i+=1){ if(itemId!==state.currentItemId) return; await dispatchDownSwipe({automatic:true}); await sleep(90); }
}

function onNewItem(itemId){
  if(!itemId||itemId===state.currentItemId) return;
  state.currentItemId=itemId; state.sessionSeen.add(itemId); metrics.markCard(itemId);
  const item=state.items.find(entry=>entry?.id===itemId); renderMemoryCue(item||null);
  setTimeout(()=>applyAdaptiveAssistance(itemId),150);
}

function parseMatch(text){ const n=Number.parseFloat(String(text||'').replace('%','')); if(!Number.isFinite(n)) return null; return n>1?n/100:n; }
function handleMatchChange(){
  const rate=parseMatch(document.getElementById('valMatch')?.textContent); const id=state.currentItemId; if(rate===null||!id) return;
  if(rate<0.7){
    state.sessionFailures.add(id); metrics.markFailure(id);
    if(!state.fallbackUsed.has(id)){
    state.fallbackUsed.add(id);
    const en=document.getElementById('enText');
    const ja=document.getElementById('jaText');
    const englishHidden=!!en?.classList.contains('concealed');
    const japaneseHidden=!ja || ja.style.display==='none' || getComputedStyle(ja).display==='none';
    if(englishHidden || japaneseHidden){
      setTimeout(()=>{ if(state.currentItemId===id) dispatchDownSwipe({automatic:true}); },130);
    }
  }
  }
}

function bindCardObservers(){
  const en=document.getElementById('enText'); const match=document.getElementById('valMatch'); const card=document.getElementById('card');
  if(en){ const obs=new MutationObserver(()=>onNewItem(en.dataset.itemId||'')); obs.observe(en,{attributes:true,attributeFilter:['data-item-id'],childList:true,subtree:true}); }
  if(match){ const obs=new MutationObserver(handleMatchChange); obs.observe(match,{childList:true,characterData:true,subtree:true}); }
  if(card){
    card.addEventListener('touchstart',ev=>{ if(state.autoHinting) return; const p=ev.touches?.[0]; if(p) state.touchStart={x:p.clientX,y:p.clientY,at:performance.now()}; },{passive:true,capture:true});
    card.addEventListener('touchend',ev=>{ if(state.autoHinting||!state.touchStart) return; const p=ev.changedTouches?.[0]; const start=state.touchStart; state.touchStart=null; if(p&&p.clientY-start.y>45&&Math.abs(p.clientX-start.x)<90) metrics.markHint({automatic:false}); },{passive:true,capture:true});
  }
}

function bindViewObserver(){
  const targets=['homeView','studyView','reviewCompleteView'].map(id=>document.getElementById(id)).filter(Boolean);
  const obs=new MutationObserver(setBodyViewClass); targets.forEach(target=>obs.observe(target,{attributes:true,attributeFilter:['hidden']})); setBodyViewClass();
}

function bindProgressObserver(){
  const node=document.getElementById('dailyGoalDone'); if(!node) return; new MutationObserver(refreshHomeMeta).observe(node,{childList:true,characterData:true,subtree:true});
}

function normalizeLegacyConfig(){
  try{
    const cfg=loadJsonStorage('appConfigV3',{})||{};
    if(cfg.studyMode!=='read'){ cfg.studyMode='read'; localStorage.setItem('appConfigV3',JSON.stringify(cfg)); }
  }catch(_){}
}

async function init(){
  injectStyles(); normalizeLegacyConfig();
  const ready=await waitForLegacyReady(); if(!ready) return;
  state.items=Array.isArray(window.ALL_ITEMS)?window.ALL_ITEMS.slice():[];
  state.characters=await loadCharacters(); state.characterMap=new Map(state.characters.map(profile=>[profile.id,profile]));
  const savedTab=localStorage.getItem(TAB_KEY); if(TAG_TYPES.includes(savedTab)) state.activeType=savedTab;
  const savedSelected=loadJsonStorage(SELECTED_KEY,null); if(savedSelected?.type&&savedSelected?.id) state.selected=savedSelected;
  rebuildCatalog(); setupCompactHome(); createTagDialog(); createExploreDialog(); hideInternalSettings(); bindStartInterceptors(); bindCardObservers(); bindViewObserver(); bindProgressObserver(); ensureMemoryCue();
  metrics.markAppShown(); refreshHomeMeta();
  globalThis.__ENGLISH_PWA_UX_METRICS__={summary:()=>metrics.summary(),events:()=>metrics.events(),reset:()=>metrics.reset()};
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init(),{once:true}); else init();
}
