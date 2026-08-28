import {
  buildAutomaticSession,
  buildLegacyQueueItems,
  consumeRequestedTagScope,
  FOCUSED_SESSION_PREPARE_EVENT,
  levelOf,
  markFocusedSessionPending,
} from './adaptiveLearning.js';
import { buildTagCatalog, SKILL_GROUP_META } from './tagLearningCore.js';
import {
  buildSessionPlanFromOptions,
  createDefaultSessionOptions,
  diagnoseEmptySessionOptions,
  eligibleItemsForSessionOptions,
  normalizeSessionOptions,
  requestedCountForSessionOptions,
  resetSessionOptions,
} from './sessionOptionsCore.js';
import { TRAINING_MODES, isContinuousShadowingMode } from './continuousShadowing.js';

const LEVEL_KEY='itemLevelV1';
const RECENT_SESSION_KEY='recentSentenceSessionIdsV1';
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
  optionsDraft:createDefaultSessionOptions(),
  pendingOptions:null,
};

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function loadJsonStorage(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw?(JSON.parse(raw)??fallback):fallback;
  }catch(_){ return fallback; }
}
function loadLevelState(){ return loadJsonStorage(LEVEL_KEY,{}); }
function loadRecentSessionIds(){
  const value=loadJsonStorage(RECENT_SESSION_KEY,[]);
  return Array.isArray(value)?[...new Set(value.map(String).filter(Boolean))].slice(0,12):[];
}
function rememberSessionItems(items){
  const ids=(Array.isArray(items)?items:[]).map(item=>String(item?.id||'')).filter(Boolean).slice(0,12);
  try{ localStorage.setItem(RECENT_SESSION_KEY,JSON.stringify(ids)); }catch(_){}
}
function iconPath(profile){
  const name=String(profile?.name||'').trim();
  return name?`./${encodeURIComponent(name)}.png`:'';
}

export function orderedSpeakerIds(item){
  return [...new Set((Array.isArray(item?.speaker_tags)?item.speaker_tags:[]).map(tag=>String(tag?.id||'')).filter(Boolean))];
}

export function conversationProgressFor(itemId,planItems=[]){
  const items=Array.isArray(planItems)?planItems:[];
  const index=items.findIndex(item=>String(item?.id)===String(itemId));
  return {current:index>=0?index+1:Math.min(1,items.length),total:items.length};
}

export function isMainRuntimeReady(windowObj=globalThis.window,documentObj=globalThis.document){
  return !!(
    Array.isArray(windowObj?.ALL_ITEMS)
    &&windowObj.ALL_ITEMS.length
    &&documentObj?.getElementById?.('startStudyCta')
  );
}

async function waitForMainReady(){
  while(!isMainRuntimeReady()) await sleep(80);
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
    body.focus-study-view main{padding:5px 8px 7px}.focus-study-view #studyView{gap:0}.focus-study-view .study-stage-access,.focus-study-view .friendship-session,.focus-study-view .memory-cue{display:none!important}
    .focus-study-view #studyView .conversation-card{--scene-accent:#7dd3fc;min-height:0!important;height:auto!important;max-height:none!important;flex:0 1 auto;overflow:visible!important;padding:10px 12px 12px!important;gap:8px!important;border-radius:22px!important;background:radial-gradient(120% 80% at 50% 0,rgba(30,64,175,.16),transparent 68%),#101522!important}
    .conversation-progress{font-size:11px;font-weight:900;letter-spacing:.1em;text-align:center;color:var(--scene-accent);min-height:16px}
    .conversation-scene{display:grid;grid-template-columns:minmax(108px,35%) minmax(0,1fr);gap:10px;align-items:stretch;min-height:164px}
    .conversation-cast{position:relative;display:flex;align-items:flex-end;justify-content:center;min-height:164px;border-radius:20px;overflow:hidden;background:radial-gradient(95% 75% at 50% 28%,color-mix(in srgb,var(--scene-accent) 26%,transparent),transparent 68%),rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}
    .conversation-cast__person{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center}.conversation-cast__person img{width:100%;height:100%;object-fit:cover;object-position:center 28%}.conversation-cast__order{position:absolute;left:7px;top:7px;display:grid;place-items:center;width:22px;height:22px;border-radius:999px;background:rgba(8,15,28,.78);border:1px solid color-mix(in srgb,var(--scene-accent) 38%,transparent);font-size:10px;font-weight:900;color:var(--scene-accent)}
    .conversation-cast--pair .conversation-cast__person{width:58%;inset:10px auto 0}.conversation-cast--pair .conversation-cast__person:first-child{left:0;z-index:2}.conversation-cast--pair .conversation-cast__person:nth-child(2){right:0;z-index:1;filter:saturate(.82) brightness(.82)}.conversation-cast--pair .conversation-cast__person:nth-child(2) .conversation-cast__order{left:auto;right:7px}
    .conversation-cast__fallback{font-size:46px;opacity:.68;align-self:center}.conversation-bubble{position:relative;display:flex;flex-direction:column;justify-content:center;min-width:0;padding:14px 13px;border:1px solid rgba(255,255,255,.13);border-radius:20px;background:rgba(8,15,28,.58);box-shadow:0 13px 30px rgba(0,0,0,.18)}.conversation-bubble::before{content:"";position:absolute;left:-8px;top:42%;width:14px;height:14px;border-left:1px solid rgba(255,255,255,.13);border-bottom:1px solid rgba(255,255,255,.13);background:#0d1524;transform:rotate(45deg)}
    .conversation-speakers{font-size:9px;font-weight:900;letter-spacing:.08em;color:var(--scene-accent);margin-bottom:7px}.conversation-prompt{font-size:15px;font-weight:750;line-height:1.55;word-break:normal}.conversation-intent{font-size:9px;opacity:.5;margin-top:8px}.conversation-feedback{min-height:17px;font-size:11px;font-weight:850;text-align:center;color:var(--scene-accent)}
    .conversation-relationship{display:grid;gap:4px;margin-top:9px}.conversation-relationship[hidden]{display:none}.conversation-relationship__label{font-size:9px;font-weight:850;color:var(--scene-accent)}.conversation-relationship__track{height:4px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.1)}.conversation-relationship__fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--scene-accent),#86efac)}
    .conversation-card #enText{margin:0;padding:8px 10px!important;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025);font-size:17px;line-height:1.5;min-height:42px}.conversation-card #enText::before{display:none}.conversation-card #enText.concealed{min-height:42px!important;font-size:11px!important;line-height:1.4!important;padding:9px!important}.conversation-card #jaText{display:none!important}.conversation-card #transcript{min-height:20px;text-align:center;font-size:12px}
    .conversation-card .audio-ctrls{display:grid;grid-template-columns:1fr 76px 1fr;gap:12px;align-items:center;margin:0}.conversation-card #btnPlay{order:1;justify-self:end;width:54px;height:54px;font-size:18px}.conversation-card #btnMic{order:2;width:76px;height:76px;border:2px solid color-mix(in srgb,var(--scene-accent) 54%,transparent);background:color-mix(in srgb,var(--scene-accent) 15%,#101522);box-shadow:0 10px 28px color-mix(in srgb,var(--scene-accent) 16%,transparent)}.conversation-card .conversation-hint{order:3;justify-self:start;width:54px;height:54px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:#162032;color:inherit;font:inherit;font-size:18px;cursor:pointer}.conversation-control-label{display:block;font-size:8px;font-weight:900;line-height:1;margin-top:2px;opacity:.7}
    .conversation-details{border:0;text-align:center}.conversation-details summary{display:inline-flex;align-items:center;min-height:26px;padding:3px 9px;border-radius:999px;color:var(--muted);font-size:9px;cursor:pointer;list-style:none}.conversation-details summary::-webkit-details-marker{display:none}.conversation-details__body{display:grid;gap:8px;margin-top:7px;padding:9px;border-radius:12px;background:rgba(255,255,255,.035)}.conversation-details .kpi{justify-content:center}.conversation-details .speed-ctrl{justify-self:center}
    .conversation-card[data-conversation-outcome="success"] .conversation-scene{filter:drop-shadow(0 0 14px color-mix(in srgb,var(--scene-accent) 25%,transparent))}.conversation-card[data-conversation-outcome="success"] .conversation-cast::after{content:"✨";position:absolute;right:8px;top:7px;font-size:20px;filter:drop-shadow(0 0 8px var(--scene-accent))}.conversation-card[data-conversation-outcome="success"] .conversation-feedback{color:#86efac}.conversation-card[data-conversation-outcome="retry"] .conversation-feedback{color:#fde68a}
    @media(prefers-reduced-motion:reduce){.conversation-card[data-conversation-outcome] .conversation-scene{filter:none!important}}
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
    #playOptionsDialog{width:min(100%,720px);height:100dvh;max-height:100dvh;margin:0 auto}
    #playOptionsDialog .focus-sheet{height:100dvh;max-height:100dvh;border-radius:0}
    #playOptionsDialog .focus-sheet__body{flex:1;padding:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
    .play-options{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;margin:0}.play-options__fields{display:grid;flex:1;min-height:0;gap:14px;padding:14px 16px;overflow:auto;overscroll-behavior:contain}
    .play-options__field{display:grid;gap:7px}.play-options__label{font-size:12px;font-weight:850;letter-spacing:.02em}.play-options__select,.play-options__custom,.play-options__search{width:100%;min-height:48px;border:1px solid rgba(148,163,184,.17);border-radius:13px;background:rgba(148,163,184,.055);color:inherit;padding:10px 12px;font:inherit}
    .play-options__choices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.play-options__choices--mode,.play-options__choices--training{grid-template-columns:repeat(2,minmax(0,1fr))}.play-options__choice{min-height:43px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(148,163,184,.04);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.play-options__choice.is-active{border-color:rgba(129,140,248,.65);background:rgba(99,102,241,.18);color:#e0e7ff}.play-options__training-note{font-size:10px;line-height:1.5;opacity:.62;margin:7px 2px 0}
    .play-options__manual{display:grid;gap:8px}.play-options__manual-list{display:grid;gap:5px;max-height:270px;overflow:auto;padding-right:2px}.play-options__manual-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:9px;border:1px solid rgba(148,163,184,.11);border-radius:11px;background:rgba(148,163,184,.025);font-size:11px}.play-options__manual-row input{margin-top:3px}.play-options__manual-en{display:block;font-weight:750;line-height:1.35}.play-options__manual-ja{display:block;opacity:.58;line-height:1.35;margin-top:3px}.play-options__manual-note{font-size:10px;opacity:.52}
    .play-options__footer{display:block;flex:0 0 auto;margin:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid rgba(148,163,184,.12);background:rgba(16,21,34,.97);backdrop-filter:blur(12px)}.play-options__summary{font-size:12px;font-weight:800;line-height:1.45}.play-options__count{font-size:10px;opacity:.6;margin-top:3px}.play-options__causes{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.play-options__cause{border:1px solid rgba(248,113,113,.28);border-radius:999px;background:rgba(248,113,113,.08);color:#fecaca;padding:6px 9px;font:inherit;font-size:10px;cursor:pointer}.play-options__start{display:block;width:100%;min-height:52px;border:0;border-radius:15px;background:#6366f1;color:#fff;font:inherit;font-size:16px;font-weight:900;margin-top:10px;cursor:pointer}.play-options__start:disabled{opacity:.38;cursor:not-allowed}
    @media(max-width:390px){.home-cta-wrap.focus-home{margin-top:7vh}.focus-sheet__body{padding-inline:12px}.conversation-card{padding-inline:9px!important}.conversation-scene{grid-template-columns:104px minmax(0,1fr);min-height:150px;gap:8px}.conversation-cast{min-height:150px}.conversation-bubble{padding:11px 10px}.conversation-prompt{font-size:14px}.conversation-card .audio-ctrls{grid-template-columns:1fr 68px 1fr}.conversation-card #btnMic{width:68px;height:68px}.conversation-card #btnPlay,.conversation-card .conversation-hint{width:50px;height:50px}}
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
  if(view==='home'&&(previous==='study'||previous==='review')){
    state.optionsDraft=resetSessionOptions({...state.optionsDraft,characterId:globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||state.optionsDraft.characterId});
    state.pendingOptions=null;
  }
}

function simplifyReview(){
  const view=document.getElementById('reviewCompleteView');
  if(!view) return;
  const shadowing=view.dataset.trainingMode===TRAINING_MODES.CONTINUOUS_SHADOWING;
  const title=view.querySelector('h2');if(title) title.textContent=shadowing?'シャドウイング結果':'今日の交流結果';
  const cont=document.getElementById('reviewActionContinue');if(cont) cont.textContent=shadowing?'通常会話へ':'もう少し話す';
  const finish=document.getElementById('reviewActionFinish');if(finish) finish.textContent='今日はここまで';
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
    explore.textContent='遊び方を変える';
    explore.addEventListener('click',()=>openSessionOptions());
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

function optionCatalog(){
  return buildTagCatalog(state.items,[...state.characters.values()],loadLevelState(),Date.now());
}

function fillSelect(select,entries,{emptyLabel='おまかせ',groups=false}={}){
  if(!select) return;
  select.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=emptyLabel;select.appendChild(empty);
  if(groups){
    for(const group of Object.keys(SKILL_GROUP_META)){
      const matched=entries.filter(entry=>entry.group===group);
      if(!matched.length) continue;
      const optgroup=document.createElement('optgroup');optgroup.label=SKILL_GROUP_META[group].label;
      for(const entry of matched){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.label;optgroup.appendChild(option);}
      select.appendChild(optgroup);
    }
    return;
  }
  for(const entry of entries){const option=document.createElement('option');option.value=entry.value??entry.id;option.textContent=entry.label??entry.name??entry.id;select.appendChild(option);}
}

function optionsLabelMaps(){
  const catalog=optionCatalog();
  return {
    catalog,
    characters:new Map(catalog.character.map(entry=>[entry.id,entry.label])),
    skills:new Map(catalog.skill.map(entry=>[entry.id,entry.label])),
  };
}

function populateOptionsSelects(dialog){
  const {catalog}=optionsLabelMaps();
  fillSelect(dialog.querySelector('#playOptionsCharacter'),catalog.character,{emptyLabel:'誰でも'});
  fillSelect(dialog.querySelector('#playOptionsSkill'),catalog.skill,{emptyLabel:'おまかせ',groups:true});
  const sections=[...new Set(state.items.map(item=>String(item?.unit||'')).filter(Boolean))]
    .sort((a,b)=>(Number(a.match(/\d+/)?.[0])||0)-(Number(b.match(/\d+/)?.[0])||0)||a.localeCompare(b));
  fillSelect(dialog.querySelector('#playOptionsSection'),sections.map(value=>({value,label:value.replace(/^Section/i,'Chapter ')})),{emptyLabel:'おまかせ'});
}

function renderManualChoices(dialog,eligible){
  const panel=dialog.querySelector('#playOptionsManual');
  if(!panel||panel.hidden) return;
  const list=panel.querySelector('.play-options__manual-list');
  const note=panel.querySelector('.play-options__manual-note');
  const query=String(panel.querySelector('.play-options__search')?.value||'').trim().toLowerCase();
  const matched=eligible.filter(item=>!query||String(item?.en||'').toLowerCase().includes(query)||String(item?.ja||'').toLowerCase().includes(query));
  const shown=matched.slice(0,60);list.replaceChildren();
  for(const item of shown){
    const label=document.createElement('label');label.className='play-options__manual-row';
    const input=document.createElement('input');input.type='checkbox';input.value=String(item.id);input.checked=state.optionsDraft.manualItemIds.includes(String(item.id));
    input.addEventListener('change',()=>{
      const selected=new Set(state.optionsDraft.manualItemIds);
      if(input.checked) selected.add(input.value);else selected.delete(input.value);
      state.optionsDraft={...state.optionsDraft,manualItemIds:[...selected]};
      updateOptionsSheet(dialog,{renderManual:false});
    });
    const copy=document.createElement('span');const en=document.createElement('span');en.className='play-options__manual-en';en.textContent=item.en||item.id;const ja=document.createElement('span');ja.className='play-options__manual-ja';ja.textContent=item.ja||'';copy.append(en,ja);label.append(input,copy);list.appendChild(label);
  }
  note.textContent=matched.length>shown.length?`${matched.length}文中、先頭${shown.length}文を表示`:`${matched.length}文から選択`;
}

function updateOptionsSheet(dialog,{renderManual=true}={}){
  state.optionsDraft=normalizeSessionOptions(state.optionsDraft);
  const options=state.optionsDraft;
  const levelState=loadLevelState();
  const character=dialog.querySelector('#playOptionsCharacter');if(character) character.value=options.characterId;
  const skill=dialog.querySelector('#playOptionsSkill');if(skill) skill.value=options.skillId;
  const section=dialog.querySelector('#playOptionsSection');if(section) section.value=options.section;
  dialog.querySelectorAll('[data-session-count]').forEach(button=>button.classList.toggle('is-active',button.dataset.sessionCount===options.count));
  dialog.querySelectorAll('[data-session-mode]').forEach(button=>button.classList.toggle('is-active',button.dataset.sessionMode===options.mode));
  dialog.querySelectorAll('[data-training-mode]').forEach(button=>button.classList.toggle('is-active',button.dataset.trainingMode===options.trainingMode));
  const custom=dialog.querySelector('#playOptionsCustomCount');custom.hidden=options.count!=='custom';custom.value=String(options.customCount);
  const manual=dialog.querySelector('#playOptionsManual');manual.hidden=options.mode!=='manual';
  const eligible=eligibleItemsForSessionOptions(state.items,options,levelState);
  if(renderManual&&options.mode==='manual') renderManualChoices(dialog,eligible);
  const {characters,skills}=optionsLabelMaps();
  const labels=[characters.get(options.characterId)||'誰でも',skills.get(options.skillId)||'テーマおまかせ',options.section?options.section.replace(/^Section/i,'Chapter '):'チャプターおまかせ'];
  const trainingLabel=isContinuousShadowingMode(options.trainingMode)?'連続シャドウイング':'通常会話';
  const summary=dialog.querySelector('#playOptionsSummary');summary.textContent=`${labels.join(' × ')} · ${trainingLabel}：対象 ${eligible.length}文`;
  const count=requestedCountForSessionOptions(options);
  const selectedManual=options.manualItemIds.filter(id=>eligible.some(item=>String(item.id)===id)).length;
  dialog.querySelector('#playOptionsCount').textContent=options.mode==='manual'
    ?`例文指定 ${selectedManual}文${count?` · 今回は最大${count}会話`:''}`
    :(count?`今回は ${count}会話`:'会話数は自動で6〜8');
  const causes=dialog.querySelector('#playOptionsCauses');causes.replaceChildren();
  if(!eligible.length){
    for(const cause of diagnoseEmptySessionOptions(state.items,options,levelState)){
      const button=document.createElement('button');button.type='button';button.className='play-options__cause';button.textContent=`${cause.label}を解除（${cause.available}文）`;
      button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,[cause.key]:cause.value??''};updateOptionsSheet(dialog);});causes.appendChild(button);
    }
  }
  const start=dialog.querySelector('#playOptionsStart');
  start.disabled=!eligible.length||(options.mode==='manual'&&selectedManual===0);
  start.textContent=isContinuousShadowingMode(options.trainingMode)
    ?(count?`${count}文を連続練習`:'連続シャドウイングを始める')
    :(options.mode==='manual'?`${selectedManual}文で始める`:(count?`${count}会話を始める`:'おまかせで始める'));
}

function createOptionsDialog(){
  const dialog=makeDialog('playOptionsDialog','遊び方を変える');
  const body=dialog.querySelector('.focus-sheet__body');
  if(body.dataset.ready==='true') return dialog;
  body.dataset.ready='true';
  body.innerHTML=`<form class="play-options" id="playOptionsForm">
    <div class="play-options__fields">
      <label class="play-options__field"><span class="play-options__label">相手</span><select class="play-options__select" id="playOptionsCharacter"></select></label>
      <label class="play-options__field"><span class="play-options__label">特訓テーマ</span><select class="play-options__select" id="playOptionsSkill"></select></label>
      <label class="play-options__field"><span class="play-options__label">チャプター</span><select class="play-options__select" id="playOptionsSection"></select></label>
      <div class="play-options__field"><span class="play-options__label">今回の会話数</span><div class="play-options__choices">
        <button class="play-options__choice" type="button" data-session-count="auto">おまかせ</button><button class="play-options__choice" type="button" data-session-count="5">5</button><button class="play-options__choice" type="button" data-session-count="8">8</button><button class="play-options__choice" type="button" data-session-count="12">12</button>
      </div><button class="play-options__choice" type="button" data-session-count="custom">任意</button><input class="play-options__custom" id="playOptionsCustomCount" type="number" inputmode="numeric" min="1" max="50" aria-label="任意の会話数"></div>
      <div class="play-options__field"><span class="play-options__label">選び方</span><div class="play-options__choices play-options__choices--mode">
        <button class="play-options__choice" type="button" data-session-mode="auto">おまかせ</button><button class="play-options__choice" type="button" data-session-mode="review">復習優先</button><button class="play-options__choice" type="button" data-session-mode="new">新規多め</button><button class="play-options__choice" type="button" data-session-mode="manual">例文指定</button>
      </div></div>
      <div class="play-options__field"><span class="play-options__label">トレーニング</span><div class="play-options__choices play-options__choices--training">
        <button class="play-options__choice" type="button" data-training-mode="${TRAINING_MODES.STANDARD}">通常会話</button><button class="play-options__choice" type="button" data-training-mode="${TRAINING_MODES.CONTINUOUS_SHADOWING}">連続シャドウイング</button>
      </div><p class="play-options__training-note">連続シャドウイングは一致率70%以上で合格済みの文だけを使う復習モードです。評価・親密度・実績・SRSは更新しません。</p></div>
      <div class="play-options__manual" id="playOptionsManual" hidden><input class="play-options__search" type="search" placeholder="英文・和訳を検索" aria-label="指定する例文を検索"><div class="play-options__manual-note"></div><div class="play-options__manual-list"></div></div>
    </div>
    <footer class="play-options__footer"><div class="play-options__summary" id="playOptionsSummary"></div><div class="play-options__count" id="playOptionsCount"></div><div class="play-options__causes" id="playOptionsCauses"></div><button class="play-options__start" id="playOptionsStart" type="submit"></button></footer>
  </form>`;
  body.querySelector('#playOptionsCharacter').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,characterId:event.target.value};updateOptionsSheet(dialog);});
  body.querySelector('#playOptionsSkill').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,skillId:event.target.value};updateOptionsSheet(dialog);});
  body.querySelector('#playOptionsSection').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,section:event.target.value};updateOptionsSheet(dialog);});
  body.querySelectorAll('[data-session-count]').forEach(button=>button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,count:button.dataset.sessionCount};updateOptionsSheet(dialog);}));
  body.querySelectorAll('[data-session-mode]').forEach(button=>button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,mode:button.dataset.sessionMode};updateOptionsSheet(dialog);}));
  body.querySelectorAll('[data-training-mode]').forEach(button=>button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,trainingMode:button.dataset.trainingMode};updateOptionsSheet(dialog);}));
  body.querySelector('#playOptionsCustomCount').addEventListener('input',event=>{state.optionsDraft={...state.optionsDraft,customCount:event.target.value};updateOptionsSheet(dialog,{renderManual:false});});
  body.querySelector('.play-options__search').addEventListener('input',()=>renderManualChoices(dialog,eligibleItemsForSessionOptions(state.items,state.optionsDraft,loadLevelState())));
  body.querySelector('#playOptionsForm').addEventListener('submit',event=>{
    event.preventDefault();
    const options=normalizeSessionOptions(state.optionsDraft);
    if(!eligibleItemsForSessionOptions(state.items,options,loadLevelState()).length) return;
    state.pendingOptions=options;
    state.optionsDraft=resetSessionOptions(options);
    dialog.close();
    if(options.characterId) globalThis.__PREPARE_CHARACTER_SESSION__?.(options.characterId);
    else globalThis.__CLEAR_ACTIVE_CHARACTER_SESSION__?.();
    globalThis.__ENGLISH_PWA_CUSTOM_SESSION_PENDING__=true;
    setTimeout(()=>document.getElementById('startStudyCta')?.click(),0);
  });
  return dialog;
}

function openSessionOptions(initial={}){
  state.optionsDraft=normalizeSessionOptions({...state.optionsDraft,...initial});
  const dialog=createOptionsDialog();
  populateOptionsSelects(dialog);updateOptionsSheet(dialog);
  if(!dialog.open) dialog.showModal();
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
  status.id='exploreStatus';status.className='explore-status';
  for(const [key,label] of [['all','すべて'],['fresh','未プレイ'],['learning','進行中'],['stable','クリア']]){
    const button=document.createElement('button');
    button.type='button';button.dataset.status=key;button.textContent=label;
    button.addEventListener('click',()=>{state.exploreStatus=key;renderExploreStatus();updateExploreCount();});
    status.appendChild(button);
  }
  body.appendChild(status);
  const range=document.getElementById('rangeBar');
  if(range) body.appendChild(range);
  document.getElementById('levelFilter')?.closest('.range-item')?.classList.add('explore-hidden');
  document.getElementById('orderSel')?.closest('.range-item')?.classList.add('explore-hidden');
  const actions=document.createElement('div');actions.className='explore-actions';
  const tags=document.createElement('button');tags.type='button';tags.className='explore-tag-link';tags.textContent='連絡先・トレーニング';
  tags.addEventListener('click',()=>{dialog.close();globalThis.__OPEN_ENGLISH_LEARNING_BROWSER__?.();});
  const start=document.createElement('button');start.type='button';start.className='explore-start';start.textContent='この範囲で遊ぶ';
  start.addEventListener('click',()=>{
    state.manualPool=buildExplorePool();
    dialog.close();
    setTimeout(()=>document.getElementById('startStudyCta')?.click(),0);
  });
  actions.append(tags,start);body.appendChild(actions);
  const count=document.createElement('div');count.id='exploreCount';count.className='explore-count';body.appendChild(count);
  document.getElementById('rangeSearch')?.addEventListener('input',updateExploreCount);
  document.getElementById('secSel')?.addEventListener('change',updateExploreCount);
  renderExploreStatus();updateExploreCount();
  return dialog;
}

function openExploreDialog(){
  const dialog=createExploreDialog();
  updateExploreCount();
  if(!dialog.open) dialog.showModal();
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
  // Reset the legacy runtime synchronously without clicking its filter UI.
  // Filter clicks rebuild the old queue and can schedule the saved section
  // (commonly Section23) before this focused plan reaches the start handler.
  document.dispatchEvent(new CustomEvent(FOCUSED_SESSION_PREPARE_EVENT));
  const sec=document.getElementById('secSel');if(sec) sec.value='';
  const studySec=document.getElementById('studySecSel');if(studySec) studySec.value='';
  const search=document.getElementById('rangeSearch');if(search) search.value='';
  const order=document.getElementById('orderSel');if(order) order.value='asc';
  const slider=document.getElementById('sessionGoalSlider');
  if(slider){slider.value=String(plan.size);slider.dispatchEvent(new Event('input',{bubbles:true}));}
  restoreAllItems();
  state.originalAllItems=window.ALL_ITEMS;
  window.ALL_ITEMS=buildLegacyQueueItems(plan.items);
  state.sessionPlan=plan;
  globalThis.__ENGLISH_PWA_PENDING_TRAINING_MODE__=plan.trainingMode||TRAINING_MODES.STANDARD;
  rememberSessionItems(plan.items);
  // The legacy CTA reuses its existing QUEUE when it is non-empty. Tell its
  // bubble-phase handler that window.ALL_ITEMS has just been replaced and a
  // rebuild is mandatory before starting.
  markFocusedSessionPending(globalThis);
  return true;
}

function prepareStart(){
  const recentItemIds=state.sessionPlan?.items?.map(item=>item.id)||loadRecentSessionIds();
  if(state.pendingOptions){
    const options=state.pendingOptions;
    state.pendingOptions=null;
    consumeRequestedTagScope();
    const plan=buildSessionPlanFromOptions(state.items,loadLevelState(),options,{recentItemIds});
    state.manualPool=null;
    return setLegacyPlan(plan);
  }
  const requestedScope=consumeRequestedTagScope();
  const activeCharacterId=String(globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||'').trim();
  const automaticScope=requestedScope||(activeCharacterId?{type:'character',id:activeCharacterId}:null);
  const pool=state.manualPool||state.items;
  const plan=buildAutomaticSession(pool,loadLevelState(),{scope:automaticScope,recentItemIds});
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
  cue=document.createElement('div');cue.id='tagMemoryCue';cue.className='memory-cue';
  en.parentNode?.insertBefore(cue,en);
  return cue;
}

function renderMemoryCue(item){
  const cue=ensureMemoryCue();
  if(!cue) return;
  cue.replaceChildren();
  if(!item) return;
  const speakers=(Array.isArray(item.speaker_tags)?item.speaker_tags:[]).filter(tag=>tag?.id).slice(0,2);
  for(const tag of speakers){
    const profile=state.characters.get(tag.id);
    if(!profile) continue;
    const img=document.createElement('img');img.className='memory-cue__person';img.alt='';img.src=iconPath(profile);cue.appendChild(img);
  }
}

const CONVERSATION_ACCENTS=['#7dd3fc','#c4b5fd','#f9a8d4','#86efac','#fcd34d'];

function conversationAccent(characterId=''){
  const index=[...String(characterId)].reduce((sum,char)=>sum+char.codePointAt(0),0)%CONVERSATION_ACCENTS.length;
  return CONVERSATION_ACCENTS[index];
}

function ensureConversationScene(){
  const card=document.getElementById('card');
  const en=document.getElementById('enText');
  if(!card||!en) return null;
  card.classList.add('conversation-card');

  let progress=document.getElementById('conversationProgress');
  let scene=document.getElementById('conversationScene');
  if(!progress){
    progress=document.createElement('div');progress.id='conversationProgress';progress.className='conversation-progress';progress.setAttribute('aria-live','polite');
    card.insertBefore(progress,en);
  }
  if(!scene){
    scene=document.createElement('section');scene.id='conversationScene';scene.className='conversation-scene';scene.setAttribute('aria-label','会話シーン');
    const cast=document.createElement('div');cast.id='conversationCast';cast.className='conversation-cast';cast.setAttribute('aria-hidden','true');
    const bubble=document.createElement('div');bubble.className='conversation-bubble';
    const speakers=document.createElement('div');speakers.id='conversationSpeakers';speakers.className='conversation-speakers';
    const prompt=document.createElement('div');prompt.id='conversationPrompt';prompt.className='conversation-prompt';
    const intent=document.createElement('div');intent.className='conversation-intent';intent.textContent='日本語を英語で返してみよう';
    const relationship=document.createElement('div');relationship.id='conversationRelationship';relationship.className='conversation-relationship';relationship.hidden=true;
    const relationshipLabel=document.createElement('div');relationshipLabel.id='conversationRelationshipLabel';relationshipLabel.className='conversation-relationship__label';
    const relationshipTrack=document.createElement('div');relationshipTrack.className='conversation-relationship__track';relationshipTrack.setAttribute('role','progressbar');relationshipTrack.setAttribute('aria-label','親密度');relationshipTrack.setAttribute('aria-valuemin','0');relationshipTrack.setAttribute('aria-valuemax','100');
    const relationshipFill=document.createElement('div');relationshipFill.id='conversationRelationshipFill';relationshipFill.className='conversation-relationship__fill';
    relationshipTrack.appendChild(relationshipFill);relationship.append(relationshipLabel,relationshipTrack);bubble.append(speakers,prompt,intent,relationship);scene.append(cast,bubble);
    card.insertBefore(scene,en);
  }

  let feedback=document.getElementById('conversationFeedback');
  const transcript=document.getElementById('transcript');
  if(!feedback){
    feedback=document.createElement('div');feedback.id='conversationFeedback';feedback.className='conversation-feedback';feedback.setAttribute('aria-live','polite');
    transcript?.parentNode?.insertBefore(feedback,transcript.nextSibling);
  }

  const controls=card.querySelector('.audio-ctrls');
  let details=document.getElementById('conversationDetails');
  if(!details&&controls){
    details=document.createElement('details');details.id='conversationDetails';details.className='conversation-details';
    const summary=document.createElement('summary');summary.textContent='記録・速度';
    const body=document.createElement('div');body.className='conversation-details__body';
    const kpi=card.querySelector('.kpi');const speed=document.getElementById('speedCtrl');
    if(kpi) body.appendChild(kpi);if(speed) body.appendChild(speed);
    details.append(summary,body);card.insertBefore(details,controls);
  }
  if(controls){
    const micStatus=document.getElementById('micStatus');if(micStatus) card.insertBefore(micStatus,controls);
    const play=document.getElementById('btnPlay');const mic=document.getElementById('btnMic');
    if(play&&!play.querySelector('.conversation-control-label')){const label=document.createElement('span');label.className='conversation-control-label';label.textContent='聞く';play.appendChild(label);}
    if(mic&&!mic.querySelector('.conversation-control-label')){const label=document.createElement('span');label.className='conversation-control-label';label.textContent='話す';mic.appendChild(label);}
    let hint=document.getElementById('conversationHintBtn');
    if(!hint){
      hint=document.createElement('button');hint.id='conversationHintBtn';hint.className='conversation-hint';hint.type='button';hint.setAttribute('aria-label','次のヒントを表示');hint.innerHTML='<span aria-hidden="true">💡</span><span class="conversation-control-label">ヒント</span>';
      hint.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('english-pwa:request-hint')));controls.appendChild(hint);
    }
  }
  return {card,progress,scene};
}

function renderConversationRelationship(item,{visible=false}={}){
  const relationship=document.getElementById('conversationRelationship');
  const label=document.getElementById('conversationRelationshipLabel');
  const fill=document.getElementById('conversationRelationshipFill');
  if(!relationship||!label||!fill) return;
  const speakerId=orderedSpeakerIds(item)[0];
  const game=globalThis.__RELATIONSHIP_GAME_STATE__?.();
  const rel=game?.relationships?.find(entry=>String(entry?.id)===speakerId);
  if(!visible||!rel){relationship.hidden=true;return;}
  const intimacy=Math.max(0,Math.min(100,Number(rel.intimacy)||0));
  label.textContent=`${rel.name||state.characters.get(speakerId)?.name||'相手'}との親密度 ${Math.round(intimacy)}`;
  fill.style.width=`${intimacy}%`;fill.parentElement?.setAttribute('aria-valuenow',String(Math.round(intimacy)));relationship.hidden=false;
}

function renderConversationScene(item){
  const surface=ensureConversationScene();
  if(!surface) return;
  const planItems=state.sessionPlan?.items?.length?state.sessionPlan.items:(item?[item]:[]);
  const progress=conversationProgressFor(item?.id,planItems);
  surface.progress.textContent=`会話 ${progress.current}/${Math.max(1,progress.total)}`;
  const speakerIds=orderedSpeakerIds(item).slice(0,2);
  surface.card.style.setProperty('--scene-accent',conversationAccent(speakerIds[0]));
  const cast=document.getElementById('conversationCast');
  const speakers=document.getElementById('conversationSpeakers');
  const prompt=document.getElementById('conversationPrompt');
  cast?.replaceChildren();cast?.classList.toggle('conversation-cast--pair',speakerIds.length>1);
  const names=[];
  for(const [index,id] of speakerIds.entries()){
    const profile=state.characters.get(id);if(!profile) continue;
    names.push(profile.name||profile.name_ja||id);
    const person=document.createElement('div');person.className='conversation-cast__person';
    const image=document.createElement('img');image.src=iconPath(profile);image.alt='';
    const order=document.createElement('span');order.className='conversation-cast__order';order.textContent=String(index+1);
    person.append(image,order);cast?.appendChild(person);
  }
  if(cast&&!cast.children.length){const fallback=document.createElement('span');fallback.className='conversation-cast__fallback';fallback.textContent='💬';cast.appendChild(fallback);}
  if(speakers) speakers.textContent=names.length?names.join(' → '):'会話';
  if(prompt) prompt.textContent=String(item?.ja||'英語で話してみよう');
  delete surface.card.dataset.conversationOutcome;
  const feedback=document.getElementById('conversationFeedback');if(feedback) feedback.textContent='';
  renderConversationRelationship(item,{visible:false});
}

function updateConversationOutcome(){
  const card=document.getElementById('card');const match=document.getElementById('valMatch');const feedback=document.getElementById('conversationFeedback');
  if(!card||!match||!feedback) return;
  const item=state.items.find(entry=>String(entry?.id)===state.currentItemId)||null;
  if(match.classList.contains('match-good')){
    card.dataset.conversationOutcome='success';feedback.textContent='通じた！';renderConversationRelationship(item,{visible:true});return;
  }
  if(match.classList.contains('match-mid')||match.classList.contains('match-bad')){
    card.dataset.conversationOutcome='retry';feedback.textContent='もう一度話してみる';renderConversationRelationship(item,{visible:false});return;
  }
  delete card.dataset.conversationOutcome;feedback.textContent='';renderConversationRelationship(item,{visible:false});
}

function onNewItem(itemId){
  if(!itemId||itemId===state.currentItemId) return;
  state.currentItemId=itemId;
  const item=state.items.find(entry=>String(entry?.id)===itemId)||null;
  renderMemoryCue(item);renderConversationScene(item);
}

function bindObservers(){
  const en=document.getElementById('enText');
  if(en){
    new MutationObserver(()=>onNewItem(String(en.dataset.itemId||'')))
      .observe(en,{attributes:true,attributeFilter:['data-item-id']});
  }
  const match=document.getElementById('valMatch');
  if(match) new MutationObserver(updateConversationOutcome).observe(match,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
  document.addEventListener('english-pwa:relationship-updated',updateConversationOutcome);
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
  state.optionsDraft=createDefaultSessionOptions(globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||'');
  setupCompactHome();
  hideInternalSettings();
  bindStartInterceptors();
  bindObservers();
  ensureMemoryCue();
  ensureConversationScene();
  refreshHomeMeta();
  injectStyles();
  globalThis.__OPEN_SESSION_OPTIONS__=openSessionOptions;
  globalThis.__OPEN_ENGLISH_RANGE_BROWSER__=openExploreDialog;
  document.dispatchEvent(new CustomEvent('english-pwa:session-shell-ready'));
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Session shell failed',error)),{once:true});
  else init().catch(error=>console.warn('Session shell failed',error));
}
