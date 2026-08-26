import {
  TAG_TYPES,
  TAG_TYPE_META,
  buildTagCatalog,
} from './tagLearningCore.js';

const LEVEL_KEY='itemLevelV1';
const TAB_KEY='tagBrowserTabV1';
const SELECTED_KEY='tagBrowserSelectionV1';

const state={
  items:[],
  characters:[],
  catalog:null,
  activeType:'character',
  selected:null,
  query:'',
  loaded:false,
  loading:null,
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

async function loadJson(path){
  const res=await fetch(path,{cache:'no-cache'});
  if(!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function ensureData(){
  if(state.loaded) return;
  if(state.loading) return state.loading;
  state.loading=(async()=>{
    const [itemsRaw,charactersRaw]=await Promise.all([
      loadJson('./data/items.json'),
      loadJson('./data/characters.json'),
    ]);
    state.items=Array.isArray(itemsRaw)?itemsRaw:(Array.isArray(itemsRaw?.items)?itemsRaw.items:[]);
    state.characters=Array.isArray(charactersRaw)?charactersRaw:(Array.isArray(charactersRaw?.characters)?charactersRaw.characters:[]);
    const savedTab=localStorage.getItem(TAB_KEY);
    if(TAG_TYPES.includes(savedTab)) state.activeType=savedTab;
    const selected=loadJsonStorage(SELECTED_KEY,null);
    if(selected?.type&&selected?.id) state.selected=selected;
    state.loaded=true;
  })().finally(()=>{state.loading=null;});
  return state.loading;
}

function refreshCatalog(){
  state.catalog=buildTagCatalog(state.items,state.characters,loadLevelState(),Date.now());
}

function injectStyles(){
  if(document.getElementById('tagBrowserStyles')) return;
  const style=document.createElement('style');
  style.id='tagBrowserStyles';
  style.textContent=`
    #tagBrowserDialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 18px,720px);max-height:calc(100dvh - 18px)}
    #tagBrowserDialog::backdrop{background:rgba(3,6,16,.78);backdrop-filter:blur(5px)}
    .tag-browser{display:flex;flex-direction:column;max-height:calc(100dvh - 18px);overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:24px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.48)}
    .tag-browser__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px 11px;border-bottom:1px solid rgba(148,163,184,.09)}
    .tag-browser__head h2{font-size:19px;margin:0}.tag-browser__close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .tag-browser__body{padding:13px 16px 17px;overflow:auto;overscroll-behavior:contain}
    .tag-browser__tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;background:rgba(148,163,184,.065);border-radius:13px;position:sticky;top:0;z-index:3;backdrop-filter:blur(8px)}
    .tag-browser__tab{min-width:0;border:0;border-radius:10px;background:transparent;color:inherit;padding:10px 3px;font:inherit;font-size:13px;opacity:.58;cursor:pointer;white-space:nowrap}.tag-browser__tab.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .tag-browser__tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:12px;align-items:center}.tag-browser__search{width:100%;min-width:0;border:1px solid rgba(148,163,184,.16);background:rgba(148,163,184,.045);color:inherit;border-radius:12px;padding:10px 12px;font:inherit}.tag-browser__count{font-size:11px;opacity:.46;white-space:nowrap}
    .tag-browser__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.tag-browser__card{border:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.04);color:inherit;border-radius:15px;padding:12px;text-align:left;font:inherit;cursor:pointer;min-width:0;min-height:72px}.tag-browser__card.is-selected{border-color:rgba(129,140,248,.62);background:rgba(99,102,241,.13)}
    .tag-browser__card--person{display:grid;grid-template-columns:44px minmax(0,1fr);gap:9px;align-items:center}.tag-browser__card img{width:44px;height:44px;border-radius:12px;object-fit:cover;background:rgba(148,163,184,.1)}.tag-browser__card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;line-height:1.3}.tag-browser__card small{display:block;margin-top:5px;opacity:.52;font-size:10px;line-height:1.35}
    .tag-browser__detail{position:sticky;bottom:-1px;margin:13px -4px -5px;padding:12px;border:1px solid rgba(129,140,248,.22);border-radius:17px;background:rgba(16,21,34,.98);box-shadow:0 -10px 30px rgba(0,0,0,.25);backdrop-filter:blur(12px)}.tag-browser__detail-head{display:flex;gap:10px;align-items:center}.tag-browser__detail-head img{width:50px;height:50px;border-radius:14px;object-fit:cover}.tag-browser__detail-title{font-weight:850;font-size:17px}.tag-browser__detail-sub{font-size:11px;opacity:.58;margin-top:2px;line-height:1.45}.tag-browser__summary{font-size:12px;line-height:1.55;opacity:.73;margin:8px 0 0}.tag-browser__start{width:100%;min-height:48px;border:0;border-radius:13px;background:#6366f1;color:#fff;font:inherit;font-weight:850;margin-top:10px;cursor:pointer}.tag-browser__start:disabled{opacity:.45;cursor:not-allowed}
    .tag-browser__empty{margin:16px 0 0;padding:20px 12px;text-align:center;border:1px dashed rgba(148,163,184,.15);border-radius:14px;font-size:12px;opacity:.58}.tag-browser__loading{padding:36px 12px;text-align:center;font-size:13px;opacity:.65}.tag-browser__error{padding:18px 12px;text-align:center;color:#fca5a5;font-size:12px}
    @media(min-width:650px){.tag-browser__grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:390px){.tag-browser__body{padding-inline:12px}.tag-browser__grid{gap:6px}.tag-browser__card{padding:10px;min-height:68px}.tag-browser__card--person{grid-template-columns:40px minmax(0,1fr)}.tag-browser__card img{width:40px;height:40px}.tag-browser__tab{font-size:12px}}
  `;
  document.head.appendChild(style);
}

function ensureDialog(){
  let dialog=document.getElementById('tagBrowserDialog');
  if(dialog) return dialog;
  dialog=document.createElement('dialog');
  dialog.id='tagBrowserDialog';
  dialog.innerHTML='<section class="tag-browser"><header class="tag-browser__head"><h2>タグから選ぶ</h2><button type="button" class="tag-browser__close" aria-label="閉じる">×</button></header><div class="tag-browser__body"><div class="tag-browser__loading">タグを読み込んでいます…</div></div></section>';
  dialog.querySelector('.tag-browser__close')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  document.body.appendChild(dialog);
  return dialog;
}

function visibleEntries(){
  const list=state.catalog?.[state.activeType]||[];
  const query=state.query.trim().toLocaleLowerCase('ja');
  if(!query) return list;
  return list.filter(entry=>{
    const profile=entry.profile;
    const haystack=[entry.label,entry.labelJa,entry.id,profile?.name_ja,profile?.summary_ja,profile?.archetype_ja]
      .filter(Boolean).join(' ').toLocaleLowerCase('ja');
    return haystack.includes(query);
  });
}

function findSelected(){
  if(!state.selected) return null;
  return (state.catalog?.[state.selected.type]||[]).find(entry=>entry.id===state.selected.id)||null;
}

function cardFor(entry){
  const button=document.createElement('button');
  button.type='button';
  button.className='tag-browser__card'+(entry.type==='character'?' tag-browser__card--person':'');
  if(state.selected?.type===entry.type&&state.selected?.id===entry.id) button.classList.add('is-selected');
  const total=entry.type==='character'?(entry.coreTotal??entry.total):entry.total;
  const mastery=Math.max(0,Math.min(100,Math.round(Number(entry.mastery)||0)));
  if(entry.type==='character'){
    const img=document.createElement('img');
    img.alt=''; img.loading='lazy'; img.decoding='async';
    if(entry.profile) img.src=iconPath(entry.profile);
    const text=document.createElement('span');
    const name=document.createElement('strong'); name.textContent=entry.label;
    const small=document.createElement('small'); small.textContent=`${total}文 · 習得 ${mastery}%`;
    text.append(name,small); button.append(img,text);
  }else{
    const name=document.createElement('strong'); name.textContent=entry.label;
    const small=document.createElement('small'); small.textContent=`${total}文 · 習得 ${mastery}%`;
    button.append(name,small);
  }
  button.addEventListener('click',()=>{
    state.selected={type:entry.type,id:entry.id};
    localStorage.setItem(SELECTED_KEY,JSON.stringify(state.selected));
    renderResults();
  });
  return button;
}

function detailFor(entry){
  if(!entry) return null;
  const box=document.createElement('div'); box.className='tag-browser__detail';
  const head=document.createElement('div'); head.className='tag-browser__detail-head';
  if(entry.type==='character'&&entry.profile){
    const img=document.createElement('img'); img.alt=''; img.src=iconPath(entry.profile); head.appendChild(img);
  }
  const text=document.createElement('div');
  const title=document.createElement('div'); title.className='tag-browser__detail-title'; title.textContent=entry.label;
  const total=entry.type==='character'?(entry.coreTotal??entry.total):entry.total;
  const sub=document.createElement('div'); sub.className='tag-browser__detail-sub';
  sub.textContent=`${total}文 · 未学習 ${entry.fresh} · 学習中 ${entry.learning} · 復習 ${entry.due}`;
  text.append(title,sub); head.appendChild(text); box.appendChild(head);
  if(entry.type==='character'){
    const summary=entry.profile?.summary_ja||entry.profile?.archetype_ja||'';
    if(summary){ const p=document.createElement('p'); p.className='tag-browser__summary'; p.textContent=summary; box.appendChild(p); }
  }
  const start=document.createElement('button');
  start.type='button'; start.className='tag-browser__start'; start.textContent='このタグで学習'; start.disabled=total<=0;
  start.addEventListener('click',()=>startTagStudy(entry));
  box.appendChild(start);
  return box;
}

function startTagStudy(entry){
  const scope={type:entry.type,id:entry.id,includeMedium:entry.type!=='character'};
  globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=scope;
  document.getElementById('tagBrowserDialog')?.close();
  const cta=document.getElementById('startStudyCta');
  if(!cta){
    delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
    return;
  }
  cta.click();
  queueMicrotask(()=>{
    if(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__===scope) delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  });
}

function renderResults(){
  const body=document.querySelector('#tagBrowserDialog .tag-browser__body');
  if(!body) return;
  const count=body.querySelector('.tag-browser__count');
  const host=body.querySelector('.tag-browser__results');
  if(!host) return;
  const entries=visibleEntries();
  if(count) count.textContent=`${entries.length}件`;
  host.replaceChildren();
  if(entries.length){
    const grid=document.createElement('div'); grid.className='tag-browser__grid';
    entries.forEach(entry=>grid.appendChild(cardFor(entry)));
    host.appendChild(grid);
  }else{
    const empty=document.createElement('div'); empty.className='tag-browser__empty';
    empty.textContent=state.query?'一致するタグがありません':'この種類のタグはありません';
    host.appendChild(empty);
  }
  const selected=findSelected();
  if(selected&&selected.type===state.activeType&&entries.some(entry=>entry.id===selected.id)){
    const detail=detailFor(selected); if(detail) host.appendChild(detail);
  }
}

function setActiveType(type){
  if(!TAG_TYPES.includes(type)) return;
  state.activeType=type;
  state.selected=null;
  state.query='';
  localStorage.setItem(TAB_KEY,type);
  localStorage.removeItem(SELECTED_KEY);
  const body=document.querySelector('#tagBrowserDialog .tag-browser__body');
  body?.querySelectorAll('.tag-browser__tab').forEach(button=>button.classList.toggle('is-active',button.dataset.type===type));
  const search=body?.querySelector('.tag-browser__search');
  if(search){ search.value=''; search.placeholder=`${TAG_TYPE_META[type].label}を検索`; }
  renderResults();
}

function renderShell(){
  const dialog=ensureDialog();
  const body=dialog.querySelector('.tag-browser__body');
  body.replaceChildren();

  const tabs=document.createElement('div'); tabs.className='tag-browser__tabs';
  for(const type of TAG_TYPES){
    const button=document.createElement('button');
    button.type='button'; button.dataset.type=type;
    button.className='tag-browser__tab'+(state.activeType===type?' is-active':'');
    button.textContent=TAG_TYPE_META[type].label;
    button.addEventListener('click',()=>setActiveType(type));
    tabs.appendChild(button);
  }
  body.appendChild(tabs);

  const tools=document.createElement('div'); tools.className='tag-browser__tools';
  const search=document.createElement('input');
  search.type='search'; search.className='tag-browser__search';
  search.placeholder=`${TAG_TYPE_META[state.activeType].label}を検索`; search.value=state.query;
  search.addEventListener('input',()=>{ state.query=search.value; renderResults(); });
  const count=document.createElement('div'); count.className='tag-browser__count';
  tools.append(search,count); body.appendChild(tools);

  const results=document.createElement('div'); results.className='tag-browser__results';
  body.appendChild(results);
  renderResults();
}

async function openBrowser(){
  injectStyles();
  const dialog=ensureDialog();
  if(!dialog.open) dialog.showModal();
  const body=dialog.querySelector('.tag-browser__body');
  if(!state.loaded) body.innerHTML='<div class="tag-browser__loading">タグを読み込んでいます…</div>';
  try{
    await ensureData();
    refreshCatalog();
    renderShell();
  }catch(error){
    console.warn('Tag browser failed to load',error);
    body.innerHTML='<div class="tag-browser__error">タグを読み込めませんでした。閉じてもう一度お試しください。</div>';
  }
}

function isTagEntry(target){
  if(!(target instanceof Element)) return false;
  if(target.closest('[data-course="tag"]')) return true;
  if(target.closest('.explore-tag-link')) return true;
  const button=target.closest('#focusHomeNav button');
  return !!button&&button.textContent?.trim()==='キャラ・タグ';
}

function interceptTagEntrances(event){
  if(!isTagEntry(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.getElementById('learningChoiceDialog')?.close();
  document.getElementById('focusExploreDialog')?.close();
  document.getElementById('focusTagDialog')?.close();
  setTimeout(()=>openBrowser(),0);
}

function init(){
  injectStyles();
  ensureDialog();
  document.addEventListener('click',interceptTagEntrances,true);
  globalThis.__OPEN_ENGLISH_TAG_BROWSER__=openBrowser;
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}
