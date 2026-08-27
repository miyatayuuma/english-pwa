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
function iconPath(profile){
  const name=String(profile?.name||'').trim();
  return name?`./${encodeURIComponent(name)}.png`:'';
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
    #playOptionsDialog .focus-sheet__body{padding:0;display:flex;flex-direction:column;min-height:0}
    .play-options{display:flex;flex-direction:column;min-height:100%;margin:0}.play-options__fields{padding:14px 16px 120px;display:grid;gap:14px}
    .play-options__field{display:grid;gap:7px}.play-options__label{font-size:12px;font-weight:850;letter-spacing:.02em}.play-options__select,.play-options__custom,.play-options__search{width:100%;min-height:48px;border:1px solid rgba(148,163,184,.17);border-radius:13px;background:rgba(148,163,184,.055);color:inherit;padding:10px 12px;font:inherit}
    .play-options__choices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.play-options__choices--mode{grid-template-columns:repeat(2,minmax(0,1fr))}.play-options__choice{min-height:43px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(148,163,184,.04);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.play-options__choice.is-active{border-color:rgba(129,140,248,.65);background:rgba(99,102,241,.18);color:#e0e7ff}
    .play-options__manual{display:grid;gap:8px}.play-options__manual-list{display:grid;gap:5px;max-height:270px;overflow:auto;padding-right:2px}.play-options__manual-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:9px;border:1px solid rgba(148,163,184,.11);border-radius:11px;background:rgba(148,163,184,.025);font-size:11px}.play-options__manual-row input{margin-top:3px}.play-options__manual-en{display:block;font-weight:750;line-height:1.35}.play-options__manual-ja{display:block;opacity:.58;line-height:1.35;margin-top:3px}.play-options__manual-note{font-size:10px;opacity:.52}
    .play-options__footer{position:sticky;bottom:0;margin-top:auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid rgba(148,163,184,.12);background:rgba(16,21,34,.97);backdrop-filter:blur(12px)}.play-options__summary{font-size:12px;font-weight:800;line-height:1.45}.play-options__count{font-size:10px;opacity:.6;margin-top:3px}.play-options__causes{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.play-options__cause{border:1px solid rgba(248,113,113,.28);border-radius:999px;background:rgba(248,113,113,.08);color:#fecaca;padding:6px 9px;font:inherit;font-size:10px;cursor:pointer}.play-options__start{width:100%;min-height:52px;border:0;border-radius:15px;background:#6366f1;color:#fff;font:inherit;font-size:16px;font-weight:900;margin-top:10px;cursor:pointer}.play-options__start:disabled{opacity:.38;cursor:not-allowed}
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
  if(view==='home'&&(previous==='study'||previous==='review')){
    state.optionsDraft=resetSessionOptions({...state.optionsDraft,characterId:globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||state.optionsDraft.characterId});
    state.pendingOptions=null;
  }
}

function simplifyReview(){
  const view=document.getElementById('reviewCompleteView');
  if(!view) return;
  const title=view.querySelector('h2');if(title) title.textContent='完了';
  const cont=document.getElementById('reviewActionContinue');if(cont) cont.textContent='続ける';
  const finish=document.getElementById('reviewActionFinish');if(finish) finish.textContent='終了';
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
  const character=dialog.querySelector('#playOptionsCharacter');if(character) character.value=options.characterId;
  const skill=dialog.querySelector('#playOptionsSkill');if(skill) skill.value=options.skillId;
  const section=dialog.querySelector('#playOptionsSection');if(section) section.value=options.section;
  dialog.querySelectorAll('[data-session-count]').forEach(button=>button.classList.toggle('is-active',button.dataset.sessionCount===options.count));
  dialog.querySelectorAll('[data-session-mode]').forEach(button=>button.classList.toggle('is-active',button.dataset.sessionMode===options.mode));
  const custom=dialog.querySelector('#playOptionsCustomCount');custom.hidden=options.count!=='custom';custom.value=String(options.customCount);
  const manual=dialog.querySelector('#playOptionsManual');manual.hidden=options.mode!=='manual';
  const eligible=eligibleItemsForSessionOptions(state.items,options);
  if(renderManual&&options.mode==='manual') renderManualChoices(dialog,eligible);
  const {characters,skills}=optionsLabelMaps();
  const labels=[characters.get(options.characterId)||'誰でも',skills.get(options.skillId)||'テーマおまかせ',options.section?options.section.replace(/^Section/i,'Chapter '):'チャプターおまかせ'];
  const summary=dialog.querySelector('#playOptionsSummary');summary.textContent=`${labels.join(' × ')}：対象 ${eligible.length}文`;
  const count=requestedCountForSessionOptions(options);
  const selectedManual=options.manualItemIds.filter(id=>eligible.some(item=>String(item.id)===id)).length;
  dialog.querySelector('#playOptionsCount').textContent=options.mode==='manual'
    ?`例文指定 ${selectedManual}文${count?` · 今回は最大${count}会話`:''}`
    :(count?`今回は ${count}会話`:'会話数は自動で6〜8');
  const causes=dialog.querySelector('#playOptionsCauses');causes.replaceChildren();
  if(!eligible.length){
    for(const cause of diagnoseEmptySessionOptions(state.items,options)){
      const button=document.createElement('button');button.type='button';button.className='play-options__cause';button.textContent=`${cause.label}を解除（${cause.available}文）`;
      button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,[cause.key]:''};updateOptionsSheet(dialog);});causes.appendChild(button);
    }
  }
  const start=dialog.querySelector('#playOptionsStart');
  start.disabled=!eligible.length||(options.mode==='manual'&&selectedManual===0);
  start.textContent=options.mode==='manual'?`${selectedManual}文で始める`:(count?`${count}会話を始める`:'おまかせで始める');
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
      <div class="play-options__manual" id="playOptionsManual" hidden><input class="play-options__search" type="search" placeholder="英文・和訳を検索" aria-label="指定する例文を検索"><div class="play-options__manual-note"></div><div class="play-options__manual-list"></div></div>
    </div>
    <footer class="play-options__footer"><div class="play-options__summary" id="playOptionsSummary"></div><div class="play-options__count" id="playOptionsCount"></div><div class="play-options__causes" id="playOptionsCauses"></div><button class="play-options__start" id="playOptionsStart" type="submit"></button></footer>
  </form>`;
  body.querySelector('#playOptionsCharacter').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,characterId:event.target.value};updateOptionsSheet(dialog);});
  body.querySelector('#playOptionsSkill').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,skillId:event.target.value};updateOptionsSheet(dialog);});
  body.querySelector('#playOptionsSection').addEventListener('change',event=>{state.optionsDraft={...state.optionsDraft,section:event.target.value};updateOptionsSheet(dialog);});
  body.querySelectorAll('[data-session-count]').forEach(button=>button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,count:button.dataset.sessionCount};updateOptionsSheet(dialog);}));
  body.querySelectorAll('[data-session-mode]').forEach(button=>button.addEventListener('click',()=>{state.optionsDraft={...state.optionsDraft,mode:button.dataset.sessionMode};updateOptionsSheet(dialog);}));
  body.querySelector('#playOptionsCustomCount').addEventListener('input',event=>{state.optionsDraft={...state.optionsDraft,customCount:event.target.value};updateOptionsSheet(dialog,{renderManual:false});});
  body.querySelector('.play-options__search').addEventListener('input',()=>renderManualChoices(dialog,eligibleItemsForSessionOptions(state.items,state.optionsDraft)));
  body.querySelector('#playOptionsForm').addEventListener('submit',event=>{
    event.preventDefault();
    const options=normalizeSessionOptions(state.optionsDraft);
    if(!eligibleItemsForSessionOptions(state.items,options).length) return;
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
  const tags=document.createElement('button');tags.type='button';tags.className='explore-tag-link';tags.textContent='キャラ・スキル';
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
  // The legacy CTA reuses its existing QUEUE when it is non-empty. Tell its
  // bubble-phase handler that window.ALL_ITEMS has just been replaced and a
  // rebuild is mandatory before starting.
  markFocusedSessionPending(globalThis);
  return true;
}

function prepareStart(){
  const recentItemIds=state.sessionPlan?.items?.map(item=>item.id)||[];
  if(state.pendingOptions){
    const options=state.pendingOptions;
    state.pendingOptions=null;
    consumeRequestedTagScope();
    const plan=buildSessionPlanFromOptions(state.items,loadLevelState(),options,{recentItemIds});
    state.manualPool=null;
    return setLegacyPlan(plan);
  }
  const requestedScope=consumeRequestedTagScope();
  const pool=state.manualPool||state.items;
  const plan=buildAutomaticSession(pool,loadLevelState(),{scope:requestedScope||null,recentItemIds});
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
  state.optionsDraft=createDefaultSessionOptions(globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||'');
  setupCompactHome();
  hideInternalSettings();
  bindStartInterceptors();
  bindObservers();
  ensureMemoryCue();
  refreshHomeMeta();
  injectStyles();
  globalThis.__OPEN_SESSION_OPTIONS__=openSessionOptions;
  document.dispatchEvent(new CustomEvent('english-pwa:session-shell-ready'));
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Session shell failed',error)),{once:true});
  else init().catch(error=>console.warn('Session shell failed',error));
}
