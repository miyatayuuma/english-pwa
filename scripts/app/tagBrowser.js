import {
  BROWSE_TYPES,
  BROWSE_TYPE_META,
  SKILL_GROUP_META,
  buildTagCatalog,
} from './tagLearningCore.js';
import { buildRelationshipCatalog, relationshipRankColor } from './relationshipCore.js';

const LEVEL_KEY='itemLevelV1';
const TAB_KEY='learningBrowserTabV2';
const SELECTED_KEY='learningBrowserSelectionV2';
const LEGACY_KEYS=['tagBrowserTabV1','tagBrowserSelectionV1'];

const state={items:[],characters:[],catalog:null,activeType:'character',selected:null,query:'',loaded:false,loading:null,characterOnly:false,characterDetailId:'',characterListScrollTop:0};

export function resolveBrowseType(requestedType,savedType){
  if(BROWSE_TYPES.includes(requestedType)) return requestedType;
  if(BROWSE_TYPES.includes(savedType)) return savedType;
  return 'character';
}

function loadJsonStorage(key,fallback){
  try{const raw=localStorage.getItem(key);return raw?(JSON.parse(raw)??fallback):fallback;}catch(_){return fallback;}
}
function cleanLegacyBrowserState(){for(const key of LEGACY_KEYS){try{localStorage.removeItem(key);}catch(_){}}}
function loadLevelState(){return loadJsonStorage(LEVEL_KEY,{});}
function iconPath(profile){const name=String(profile?.name||'').trim();return name?`./${encodeURIComponent(name)}.png`:'';}
async function loadJson(path){const res=await fetch(path,{cache:'default'});if(!res.ok) throw new Error(`${path}: ${res.status}`);return res.json();}

async function ensureData(){
  if(state.loaded) return;
  if(state.loading) return state.loading;
  state.loading=(async()=>{
    const [itemsRaw,charactersRaw]=await Promise.all([loadJson('./data/items.json'),loadJson('./data/characters.json')]);
    state.items=Array.isArray(itemsRaw)?itemsRaw:(Array.isArray(itemsRaw?.items)?itemsRaw.items:[]);
    state.characters=Array.isArray(charactersRaw)?charactersRaw:(Array.isArray(charactersRaw?.characters)?charactersRaw.characters:[]);
    const selected=loadJsonStorage(SELECTED_KEY,null);if(BROWSE_TYPES.includes(selected?.type)&&selected?.id) state.selected=selected;
    cleanLegacyBrowserState();state.loaded=true;
  })().finally(()=>{state.loading=null;});
  return state.loading;
}

function refreshCatalog(){
  const levels=loadLevelState();
  const base=buildTagCatalog(state.items,state.characters,levels,Date.now());
  const relationships=buildRelationshipCatalog(state.items,state.characters,levels,Date.now());
  const byId=new Map(relationships.map(entry=>[entry.id,entry]));
  base.character=base.character.map(entry=>Object.assign(entry,byId.get(entry.id)||{}));
  state.catalog=base;
}

function injectStyles(){
  if(document.getElementById('tagBrowserStyles')) return;
  const style=document.createElement('style');style.id='tagBrowserStyles';style.textContent=`
    #tagBrowserDialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 18px,720px);max-height:calc(100dvh - 18px)}#tagBrowserDialog::backdrop{background:rgba(3,6,16,.78);backdrop-filter:blur(5px)}
    .tag-browser{display:flex;flex-direction:column;max-height:calc(100dvh - 18px);overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:24px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.48)}.tag-browser__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px 11px;border-bottom:1px solid rgba(148,163,184,.09)}.tag-browser__head h2{font-size:19px;margin:0}.tag-browser__close{width:38px;height:38px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}.tag-browser__body{padding:13px 16px 17px;overflow:auto;overscroll-behavior:contain}
    .tag-browser__tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:rgba(148,163,184,.065);border-radius:13px;position:sticky;top:0;z-index:3;backdrop-filter:blur(8px)}.tag-browser__tab{min-width:0;border:0;border-radius:10px;background:transparent;color:inherit;padding:11px 5px;font:inherit;font-size:13px;opacity:.58;cursor:pointer;white-space:nowrap}.tag-browser__tab.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .tag-browser__tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:12px;align-items:center}.tag-browser__search{width:100%;min-width:0;border:1px solid rgba(148,163,184,.16);background:rgba(148,163,184,.045);color:inherit;border-radius:12px;padding:10px 12px;font:inherit}.tag-browser__count{font-size:11px;opacity:.46;white-space:nowrap}.tag-browser__section{margin-top:15px}.tag-browser__section-title{font-size:11px;font-weight:850;letter-spacing:.08em;opacity:.5;padding:0 3px 5px}.tag-browser__section:first-child{margin-top:12px}
    .tag-browser__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tag-browser__card{border:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.04);color:inherit;border-radius:15px;padding:11px;text-align:left;font:inherit;cursor:pointer;min-width:0;min-height:82px}.tag-browser__card.is-selected{border-color:rgba(129,140,248,.62);background:rgba(99,102,241,.13)}.tag-browser__card--person{--person-accent:#c4b5fd;display:grid;grid-template-columns:60px minmax(0,1fr);gap:10px;align-items:center;min-height:86px;background:radial-gradient(100% 130% at 0 0,color-mix(in srgb,var(--person-accent) 12%,transparent),rgba(148,163,184,.035));border-color:color-mix(in srgb,var(--person-accent) 19%,transparent)}.tag-browser__card img{width:60px;height:60px;border-radius:17px;object-fit:cover;background:rgba(148,163,184,.1)}.tag-browser__card-copy{min-width:0}.tag-browser__card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px;line-height:1.3}
    .tag-browser__rankline{display:flex;align-items:center;gap:6px;margin-top:7px;font-size:10px}.tag-browser__rank{font-weight:900;color:var(--rank-accent,#cbd5e1)}.tag-browser__meet{margin-left:auto;opacity:.7;white-space:nowrap}.tag-browser__meet.is-due{color:#fde68a;opacity:1}.tag-browser__next{margin-top:5px;font-size:10px;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag-browser__bond{height:5px;margin-top:6px;border-radius:999px;overflow:hidden;background:rgba(148,163,184,.12)}.tag-browser__bond-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#818cf8,#34d399)}
    .tag-browser__progress-meta{display:flex;align-items:center;gap:7px;min-width:0;margin-top:5px;font-size:10px;line-height:1.2;opacity:.66;white-space:nowrap}.tag-browser__progress-meta span:nth-child(2){margin-left:auto}.tag-browser__due{padding:2px 5px;border-radius:999px;background:rgba(251,191,36,.12);color:#fcd34d;font-weight:800;opacity:1}.tag-browser__mastery{display:flex;width:100%;height:5px;margin-top:6px;overflow:hidden;border-radius:999px;background:rgba(148,163,184,.1)}.tag-browser__mastery--detail{height:8px;margin-top:10px}.tag-browser__mastery-segment{height:100%}.tag-browser__mastery-segment--mastered{background:#34d399}.tag-browser__mastery-segment--learning{background:#818cf8}.tag-browser__mastery-segment--fresh{background:rgba(148,163,184,.22)}
    .tag-browser__detail{position:sticky;bottom:-1px;margin:13px -4px -5px;padding:13px;border:1px solid rgba(129,140,248,.22);border-radius:17px;background:rgba(16,21,34,.98);box-shadow:0 -10px 30px rgba(0,0,0,.25);backdrop-filter:blur(12px)}.tag-browser__detail--character{position:static;display:grid;gap:14px;margin:12px 0 0;padding:0 0 76px;border:0;background:transparent;box-shadow:none;backdrop-filter:none;touch-action:pan-y}.tag-browser__detail-pager{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:8px}.tag-browser__detail-page{font-size:11px;text-align:center;opacity:.58}.tag-browser__detail-arrow{width:44px;height:40px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(148,163,184,.055);color:inherit;font:inherit;font-size:22px;cursor:pointer}.tag-browser__detail-hero{display:grid;grid-template-columns:108px minmax(0,1fr);gap:14px;align-items:center;padding:13px;border:1px solid rgba(129,140,248,.2);border-radius:19px;background:radial-gradient(100% 130% at 0 0,rgba(129,140,248,.16),rgba(148,163,184,.035))}.tag-browser__detail-hero>img{width:108px;height:126px;border-radius:18px;object-fit:cover;background:rgba(148,163,184,.1)}.tag-browser__detail-head{display:flex;gap:10px;align-items:center}.tag-browser__detail-head img{width:54px;height:54px;border-radius:15px;object-fit:cover}.tag-browser__detail-copy{min-width:0;flex:1}.tag-browser__detail-title{font-weight:850;font-size:18px}.tag-browser__detail-ja{font-size:10px;opacity:.48;margin-top:2px}.tag-browser__detail-intimacy{display:flex;justify-content:space-between;gap:8px;margin-top:10px;font-size:10px}.tag-browser__detail-intimacy strong{font-size:15px;color:#c7d2fe}.tag-browser__detail-section{padding:12px 13px;border:1px solid rgba(148,163,184,.12);border-radius:16px;background:rgba(148,163,184,.035)}.tag-browser__detail-label{font-size:10px;font-weight:900;letter-spacing:.07em;opacity:.5}.tag-browser__detail-lead{margin-top:6px;font-size:13px;font-weight:800;line-height:1.5}.tag-browser__summary{font-size:11px;line-height:1.65;opacity:.7;margin:7px 0 0}.tag-browser__stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.tag-browser__stat{min-width:0;padding:9px 4px;border:1px solid rgba(148,163,184,.11);border-radius:12px;text-align:center;background:rgba(148,163,184,.025)}.tag-browser__stat b{display:block;font-size:16px}.tag-browser__stat span{display:block;margin-top:2px;font-size:8px;opacity:.52;white-space:nowrap}.tag-browser__chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.tag-browser__chip{padding:5px 8px;border-radius:999px;background:rgba(129,140,248,.1);font-size:9px;color:#dbeafe}.tag-browser__detail-actions{position:sticky;z-index:4;bottom:-17px;display:grid;grid-template-columns:minmax(96px,.62fr) minmax(0,1.38fr);gap:8px;margin:0 -16px -93px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(148,163,184,.12);background:rgba(16,21,34,.96);box-shadow:0 -12px 30px rgba(0,0,0,.28);backdrop-filter:blur(14px)}.tag-browser__detail-back{min-height:52px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(148,163,184,.07);color:inherit;padding:0 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.tag-browser__start{width:100%;min-height:52px;border:0;border-radius:14px;background:#6366f1;color:#fff;font:inherit;font-weight:850;margin-top:0;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.2)}.tag-browser__start:disabled{opacity:.45;cursor:not-allowed}.tag-browser__empty,.tag-browser__loading,.tag-browser__error{padding:26px 12px;text-align:center;font-size:12px;opacity:.62}.tag-browser__error{color:#fca5a5}
    @media(min-width:650px){.tag-browser__grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:390px){.tag-browser__body{padding-inline:12px}.tag-browser__grid{gap:6px}.tag-browser__card{padding:8px}.tag-browser__card--person{grid-template-columns:52px minmax(0,1fr)}.tag-browser__card img{width:52px;height:52px}.tag-browser__tab{font-size:12px}.tag-browser__detail-hero{grid-template-columns:92px minmax(0,1fr);gap:11px}.tag-browser__detail-hero>img{width:92px;height:112px}.tag-browser__stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;document.head.appendChild(style);
}

function ensureDialog(){
  let dialog=document.getElementById('tagBrowserDialog');if(dialog) return dialog;
  dialog=document.createElement('dialog');dialog.id='tagBrowserDialog';dialog.innerHTML='<section class="tag-browser"><header class="tag-browser__head"><h2>連絡先・トレーニング</h2><button type="button" class="tag-browser__close" aria-label="閉じる">×</button></header><div class="tag-browser__body"><div class="tag-browser__loading">読み込んでいます…</div></div></section>';
  dialog.querySelector('.tag-browser__close')?.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});document.body.appendChild(dialog);return dialog;
}

function visibleEntries(){
  const list=state.catalog?.[state.activeType]||[];const query=state.query.trim().toLocaleLowerCase('ja');if(!query) return list;
  return list.filter(entry=>{const profile=entry.profile||entry.character;const themes=(entry.themes||[]).map(theme=>theme.label);return [entry.label,entry.labelJa,entry.name,entry.id,entry.groupLabel,...themes,profile?.name_ja,profile?.summary_ja,profile?.archetype_ja].filter(Boolean).join(' ').toLocaleLowerCase('ja').includes(query);});
}
function findSelected(){if(!state.selected) return null;return (state.catalog?.[state.selected.type]||[]).find(entry=>entry.id===state.selected.id)||null;}
function masteryStats(entry){const total=Math.max(0,Number(entry?.total)||0);const mastered=Math.max(0,Math.min(total,Number(entry?.mastered)||0));const learning=Math.max(0,Math.min(total-mastered,Number(entry?.learning)||0));const fresh=Math.max(0,Math.min(total-mastered-learning,Number(entry?.fresh)||0));return {total,mastered,learning,fresh,mastery:total?Math.round(mastered/total*100):0,due:Math.max(0,Number(entry?.due)||0)};}

function skillProgressMeta(entry){
  const stats=masteryStats(entry);const meta=document.createElement('div');meta.className='tag-browser__progress-meta';
  const total=document.createElement('span');total.textContent=`${stats.total}文`;const mastery=document.createElement('span');mastery.textContent=`習得 ${stats.mastery}%`;meta.append(total,mastery);
  if(stats.due>0){const due=document.createElement('span');due.className='tag-browser__due';due.textContent=`復習 ${stats.due}`;meta.appendChild(due);}return meta;
}
function masteryBar(entry,{detail=false}={}){
  const stats=masteryStats(entry);const bar=document.createElement('div');bar.className='tag-browser__mastery'+(detail?' tag-browser__mastery--detail':'');
  for(const [name,count] of [['mastered',stats.mastered],['learning',stats.learning],['fresh',stats.fresh]]){const seg=document.createElement('span');seg.className=`tag-browser__mastery-segment tag-browser__mastery-segment--${name}`;seg.style.width=stats.total?`${count/stats.total*100}%`:'0%';bar.appendChild(seg);}return bar;
}
function relationshipCopy(entry,{detail=false}={}){
  const wrap=document.createDocumentFragment();const line=document.createElement('div');line.className='tag-browser__rankline';
  const rank=document.createElement('span');rank.className='tag-browser__rank';rank.style.setProperty('--rank-accent',relationshipRankColor(entry.rank?.id));rank.textContent=entry.rank?.label||'知り合い';const meet=document.createElement('span');meet.className='tag-browser__meet'+(entry.due>0?' is-due':'');meet.textContent=entry.due>0?'会いどき':(entry.intimacyStatus?.label||'会いに行こう');line.append(rank,meet);wrap.appendChild(line);
  if(detail){const next=document.createElement('div');next.className='tag-browser__next';next.textContent=entry.rank?.id==='best_friend'?'この関係を大切にしよう':`${entry.next?.label||'次の関係'}へ、また会いに行こう`;wrap.appendChild(next);}
  return wrap;
}

function intimacyBar(entry){
  const bar=document.createElement('div');bar.className='tag-browser__bond';const fill=document.createElement('div');fill.className='tag-browser__bond-fill';fill.style.width=`${Math.max(0,Math.min(100,Number(entry?.intimacy)||0))}%`;bar.appendChild(fill);return bar;
}

function cardFor(entry){
  const button=document.createElement('button');button.type='button';button.className='tag-browser__card'+(entry.type==='character'?' tag-browser__card--person':'');if(state.selected?.type===entry.type&&state.selected?.id===entry.id) button.classList.add('is-selected');
  const copy=document.createElement('span');copy.className='tag-browser__card-copy';const name=document.createElement('strong');name.textContent=entry.label;copy.appendChild(name);
  if(entry.type==='character') copy.append(relationshipCopy(entry),intimacyBar(entry)); else copy.append(skillProgressMeta(entry),masteryBar(entry));
  if(entry.type==='character'){const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';if(entry.profile) img.src=iconPath(entry.profile);button.append(img,copy);}else button.append(copy);
  if(entry.type==='character') button.style.setProperty('--person-accent',['#7dd3fc','#c4b5fd','#f9a8d4','#86efac','#fcd34d'][[...entry.id].reduce((sum,char)=>sum+char.codePointAt(0),0)%5]);
  button.setAttribute('aria-label',entry.type==='character'?`${entry.label}の詳細を見る`:entry.label);
  button.addEventListener('click',()=>{const body=button.closest('.tag-browser__body');state.selected={type:entry.type,id:entry.id};if(entry.type==='character'){state.characterDetailId=entry.id;state.characterListScrollTop=body?.scrollTop||0;}localStorage.setItem(SELECTED_KEY,JSON.stringify(state.selected));renderResults();body?.scrollTo({top:0});});return button;
}

function returnToCharacterList(){
  state.characterDetailId='';renderResults();requestAnimationFrame(()=>{const body=document.querySelector('#tagBrowserDialog .tag-browser__body');if(body) body.scrollTop=state.characterListScrollTop||0;});
}

function showAdjacentCharacter(entries,currentId,offset){
  const list=Array.isArray(entries)?entries.filter(entry=>entry?.type==='character'):[];if(list.length<2) return;const currentIndex=Math.max(0,list.findIndex(entry=>entry.id===currentId));const next=list[(currentIndex+offset+list.length)%list.length];if(!next) return;state.characterDetailId=next.id;state.selected={type:'character',id:next.id};localStorage.setItem(SELECTED_KEY,JSON.stringify(state.selected));renderResults();document.querySelector('#tagBrowserDialog .tag-browser__body')?.scrollTo({top:0});
}

function characterDetailFor(entry,entries=[]){
  const box=document.createElement('section');box.className='tag-browser__detail tag-browser__detail--character';
  const list=Array.isArray(entries)&&entries.length?entries:(state.catalog?.character||[]);const index=Math.max(0,list.findIndex(item=>item.id===entry.id));const pager=document.createElement('nav');pager.className='tag-browser__detail-pager';pager.setAttribute('aria-label','連絡先を切り替える');const previous=document.createElement('button');previous.type='button';previous.className='tag-browser__detail-arrow';previous.textContent='‹';previous.setAttribute('aria-label','前の連絡先');previous.disabled=list.length<2;previous.addEventListener('click',()=>showAdjacentCharacter(list,entry.id,-1));const page=document.createElement('div');page.className='tag-browser__detail-page';page.textContent=`${index+1} / ${list.length}`;const next=document.createElement('button');next.type='button';next.className='tag-browser__detail-arrow';next.textContent='›';next.setAttribute('aria-label','次の連絡先');next.disabled=list.length<2;next.addEventListener('click',()=>showAdjacentCharacter(list,entry.id,1));pager.append(previous,page,next);box.appendChild(pager);
  const hero=document.createElement('div');hero.className='tag-browser__detail-hero';const img=document.createElement('img');img.alt='';img.src=iconPath(entry.profile);const copy=document.createElement('div');copy.className='tag-browser__detail-copy';const title=document.createElement('div');title.className='tag-browser__detail-title';title.textContent=entry.label;const nameJa=document.createElement('div');nameJa.className='tag-browser__detail-ja';nameJa.textContent=entry.profile?.name_ja||'';copy.append(title,nameJa,relationshipCopy(entry,{detail:true}));
  const intimacy=document.createElement('div');intimacy.className='tag-browser__detail-intimacy';const intimacyLabel=document.createElement('span');intimacyLabel.textContent='親密度';const intimacyValue=document.createElement('strong');intimacyValue.textContent=String(Math.max(0,Number(entry.intimacy)||0));intimacy.append(intimacyLabel,intimacyValue);copy.append(intimacy,intimacyBar(entry));hero.append(img,copy);box.appendChild(hero);

  const stats=document.createElement('div');stats.className='tag-browser__stats-grid';for(const [value,label] of [[entry.started||0,'合格済み'],[entry.mastered||0,'習得'],[entry.total||0,'会話'],[entry.due||0,'復習待ち']]){const cell=document.createElement('div');cell.className='tag-browser__stat';const b=document.createElement('b');b.textContent=String(value);const span=document.createElement('span');span.textContent=label;cell.append(b,span);stats.appendChild(cell);}box.appendChild(stats);

  const profile=document.createElement('section');profile.className='tag-browser__detail-section';const profileLabel=document.createElement('div');profileLabel.className='tag-browser__detail-label';profileLabel.textContent='人物紹介';const summary=document.createElement('p');summary.className='tag-browser__summary';summary.textContent=entry.profile?.intro_ja||'';profile.append(profileLabel,summary);box.appendChild(profile);

  const goal=document.createElement('section');goal.className='tag-browser__detail-section';const goalLabel=document.createElement('div');goalLabel.className='tag-browser__detail-label';goalLabel.textContent='次の関係目標';const goalText=document.createElement('div');goalText.className='tag-browser__detail-lead';goalText.textContent=entry.rank?.id==='best_friend'?(entry.next?.remaining?`完全定着まであと${entry.next.remaining}文`:'完全定着'):`${entry.next?.label||'次の関係'}まであと${Math.max(0,Number(entry.next?.remaining)||0)}文`;const goalRule=document.createElement('p');goalRule.className='tag-browser__summary';goalRule.textContent=entry.rank?.order<2?'一致率70%以上で1文クリア':entry.rank?.id==='best_friend'?'完全定着はノーヒント100%相当を重ねて進行':'習得はノーヒント90%以上を重ねて進行';goal.append(goalLabel,goalText,goalRule);box.appendChild(goal);

  const actions=document.createElement('div');actions.className='tag-browser__detail-actions';const back=document.createElement('button');back.type='button';back.className='tag-browser__detail-back';back.textContent='一覧へ戻る';back.addEventListener('click',returnToCharacterList);const start=document.createElement('button');start.type='button';start.className='tag-browser__start';start.textContent=`${entry.label}と遊ぶ`;start.disabled=entry.total<=0;start.addEventListener('click',()=>startScopedStudy(entry));actions.append(back,start);box.appendChild(actions);
  let touchStart=null;box.addEventListener('touchstart',event=>{const touch=event.touches?.[0];if(!touch) return;const body=box.closest('.tag-browser__body');touchStart={x:touch.clientX,y:touch.clientY,atTop:!body||body.scrollTop<=1};},{passive:true});box.addEventListener('touchend',event=>{if(!touchStart) return;const touch=event.changedTouches?.[0];const startPoint=touchStart;touchStart=null;if(!touch) return;const dx=touch.clientX-startPoint.x;const dy=touch.clientY-startPoint.y;if(Math.abs(dx)>=54&&Math.abs(dx)>Math.abs(dy)*1.25){showAdjacentCharacter(list,entry.id,dx<0?1:-1);return;}if(startPoint.atTop&&dy>=90&&Math.abs(dy)>Math.abs(dx)*1.4) returnToCharacterList();},{passive:true});return box;
}

function detailFor(entry){
  if(!entry) return null;if(entry.type==='character') return characterDetailFor(entry);const box=document.createElement('div');box.className='tag-browser__detail';const head=document.createElement('div');head.className='tag-browser__detail-head';
  if(entry.type==='character'&&entry.profile){const img=document.createElement('img');img.alt='';img.src=iconPath(entry.profile);head.appendChild(img);}const copy=document.createElement('div');copy.className='tag-browser__detail-copy';const title=document.createElement('div');title.className='tag-browser__detail-title';title.textContent=entry.label;copy.appendChild(title);
  if(entry.type==='character') copy.appendChild(relationshipCopy(entry,{detail:true}));else copy.appendChild(skillProgressMeta(entry));head.appendChild(copy);box.appendChild(head);
  box.appendChild(masteryBar(entry,{detail:true}));const p=document.createElement('p');p.className='tag-browser__summary';p.textContent=`${entry.groupLabel}のトレーニング`;box.appendChild(p);
  const start=document.createElement('button');start.type='button';start.className='tag-browser__start';start.textContent='このスキルを練習する';start.disabled=entry.total<=0;start.addEventListener('click',()=>startScopedStudy(entry));box.appendChild(start);return box;
}

function startScopedStudy(entry){
  document.getElementById('tagBrowserDialog')?.close();
  if(entry.type==='character'&&globalThis.__START_CHARACTER_STUDY__){globalThis.__START_CHARACTER_STUDY__(entry.id);return;}
  globalThis.__CLEAR_ACTIVE_CHARACTER_SESSION__?.();const scope={type:entry.type,id:entry.id};globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=scope;const cta=document.getElementById('startStudyCta');if(!cta){delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;return;}cta.click();queueMicrotask(()=>{if(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__===scope) delete globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;});
}
function appendGrid(host,entries){const grid=document.createElement('div');grid.className='tag-browser__grid';entries.forEach(entry=>grid.appendChild(cardFor(entry)));host.appendChild(grid);}

function renderResults(){
  refreshCatalog();const body=document.querySelector('#tagBrowserDialog .tag-browser__body');if(!body) return;const tools=body.querySelector('.tag-browser__tools');const count=body.querySelector('.tag-browser__count');const host=body.querySelector('.tag-browser__results');if(!host) return;const entries=visibleEntries();const characterDetail=state.activeType==='character'&&state.characterDetailId?(state.catalog?.character||[]).find(entry=>entry.id===state.characterDetailId):null;if(tools) tools.hidden=!!characterDetail;if(count) count.textContent=`${entries.length}件`;host.replaceChildren();
  if(characterDetail){host.appendChild(characterDetailFor(characterDetail,entries));return;}
  if(!entries.length){const empty=document.createElement('div');empty.className='tag-browser__empty';empty.textContent=state.query?'一致する項目がありません':'選べる項目がありません';host.appendChild(empty);}else if(state.activeType==='skill'){
    for(const group of Object.keys(SKILL_GROUP_META)){const grouped=entries.filter(entry=>entry.group===group);if(!grouped.length) continue;const section=document.createElement('section');section.className='tag-browser__section';const title=document.createElement('div');title.className='tag-browser__section-title';title.textContent=SKILL_GROUP_META[group].label;section.appendChild(title);appendGrid(section,grouped);host.appendChild(section);}
  }else{const section=document.createElement('section');section.className='tag-browser__section';appendGrid(section,entries);host.appendChild(section);}
  const selected=findSelected();if(!state.characterOnly&&selected&&selected.type===state.activeType&&entries.some(entry=>entry.id===selected.id)){const detail=detailFor(selected);if(detail) host.appendChild(detail);}
}

function setActiveType(type){
  if(!BROWSE_TYPES.includes(type)) return;state.activeType=type;state.selected=null;state.characterDetailId='';state.query='';localStorage.setItem(TAB_KEY,type);localStorage.removeItem(SELECTED_KEY);const body=document.querySelector('#tagBrowserDialog .tag-browser__body');body?.querySelectorAll('.tag-browser__tab').forEach(button=>button.classList.toggle('is-active',button.dataset.type===type));const search=body?.querySelector('.tag-browser__search');if(search){search.value='';search.placeholder=type==='character'?'名前を検索':'トレーニングを検索';}renderResults();
}
function renderShell(){
  const dialog=ensureDialog();dialog.querySelector('.tag-browser__head h2').textContent=state.characterOnly?'連絡先':'連絡先・トレーニング';const body=dialog.querySelector('.tag-browser__body');body.replaceChildren();const tabs=document.createElement('div');tabs.className='tag-browser__tabs';
  if(!state.characterOnly){for(const type of BROWSE_TYPES){const button=document.createElement('button');button.type='button';button.dataset.type=type;button.className='tag-browser__tab'+(state.activeType===type?' is-active':'');button.textContent=type==='character'?'連絡先':'トレーニング';button.addEventListener('click',()=>setActiveType(type));tabs.appendChild(button);}body.appendChild(tabs);}
  const tools=document.createElement('div');tools.className='tag-browser__tools';const search=document.createElement('input');search.type='search';search.className='tag-browser__search';search.placeholder=state.activeType==='character'?'名前を検索':'トレーニングを検索';search.value=state.query;search.addEventListener('input',()=>{state.query=search.value;renderResults();});const count=document.createElement('div');count.className='tag-browser__count';tools.append(search,count);body.appendChild(tools);const results=document.createElement('div');results.className='tag-browser__results';body.appendChild(results);renderResults();
}

async function openBrowser(type){
  const requestedType=BROWSE_TYPES.includes(type)?type:undefined;state.characterOnly=requestedType==='character';state.characterDetailId='';state.selected=null;injectStyles();const dialog=ensureDialog();if(!dialog.open) dialog.showModal();const body=dialog.querySelector('.tag-browser__body');if(!state.loaded) body.innerHTML='<div class="tag-browser__loading">読み込んでいます…</div>';
  try{await ensureData();state.activeType=resolveBrowseType(requestedType,localStorage.getItem(TAB_KEY));refreshCatalog();renderShell();}catch(error){console.warn('Character/training browser failed to load',error);body.innerHTML='<div class="tag-browser__error">読み込めませんでした。閉じてもう一度お試しください。</div>';}
}
function isBrowserEntry(target){
  if(!(target instanceof Element)) return false;if(target.closest('[data-course="tag"]')) return true;if(target.closest('.explore-tag-link')) return true;const button=target.closest('#focusHomeNav button');return !!button&&['連絡先・トレーニング','連絡先','キャラ・スキル','キャラを選ぶ','相手を選ぶ','トレーニング'].includes(button.textContent?.trim());
}
function interceptEntrances(event){
  if(!isBrowserEntry(event.target)) return;event.preventDefault();event.stopImmediatePropagation();document.getElementById('learningChoiceDialog')?.close();document.getElementById('focusExploreDialog')?.close();document.getElementById('focusTagDialog')?.close();const label=event.target.closest('button')?.textContent?.trim();const type=label==='トレーニング'?'skill':(['連絡先','キャラを選ぶ','相手を選ぶ'].includes(label)?'character':undefined);setTimeout(()=>openBrowser(type),0);
}
function init(){injectStyles();ensureDialog();cleanLegacyBrowserState();document.addEventListener('click',interceptEntrances,true);document.addEventListener('english-pwa:relationship-updated',()=>{if(document.getElementById('tagBrowserDialog')?.open&&state.loaded) renderResults();});globalThis.__OPEN_ENGLISH_LEARNING_BROWSER__=openBrowser;}
if(typeof document!=='undefined'){if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();}
