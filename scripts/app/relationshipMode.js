import {
  buildRelationshipCatalog,
  compareRelationshipSnapshots,
  nextWorldMilestone,
  reachedMilestones,
  recommendCharacter,
  snapshotRelationships,
  summarizeRelationshipWorld,
} from './relationshipCore.js';
import { buildAutomaticSession } from './adaptiveLearning.js';

const LEVEL_KEY='itemLevelV1';
const MILESTONE_KEY='relationshipMilestonesV1';
const GOOD_INTIMACY=75;

const state={
  items:[],
  characters:[],
  relationships:[],
  world:null,
  activeCharacterId:'',
  beforeSnapshot:null,
  liveSnapshot:null,
  skipDefaultScopeOnce:false,
  currentItemId:'',
  initialized:false,
};

function loadJsonStorage(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw?(JSON.parse(raw)??fallback):fallback;
  }catch(_){ return fallback; }
}
function saveJsonStorage(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));}catch(_){}
}
function loadLevelState(){ return loadJsonStorage(LEVEL_KEY,{}); }
function iconPath(profile){
  const name=String(profile?.name||'').trim();
  return name?`./${encodeURIComponent(name)}.png`:'';
}
function activeRelationship(){ return state.relationships.find(entry=>entry.id===state.activeCharacterId)||null; }
function relationshipById(id){ return state.relationships.find(entry=>entry.id===id)||null; }

const CHARACTER_THEMES=Object.freeze([
  Object.freeze({accent:'#7dd3fc',deep:'#164e63',soft:'rgba(14,116,144,.28)'}),
  Object.freeze({accent:'#c4b5fd',deep:'#4c1d95',soft:'rgba(109,40,217,.25)'}),
  Object.freeze({accent:'#f9a8d4',deep:'#831843',soft:'rgba(190,24,93,.23)'}),
  Object.freeze({accent:'#86efac',deep:'#14532d',soft:'rgba(22,101,52,.24)'}),
  Object.freeze({accent:'#fcd34d',deep:'#78350f',soft:'rgba(180,83,9,.23)'}),
]);

export function characterTheme(characterId=''){
  const index=[...String(characterId)].reduce((sum,char)=>sum+char.codePointAt(0),0)%CHARACTER_THEMES.length;
  return CHARACTER_THEMES[index];
}

export function lobbyConversationCopy(name,size){
  return `今日は${name}と${Math.max(1,Number(size)||1)}つ話そう`;
}

async function loadCharacters(){
  try{
    const response=await fetch('./data/characters.json',{cache:'default'});
    if(!response.ok) return [];
    const raw=await response.json();
    return Array.isArray(raw)?raw:(Array.isArray(raw?.characters)?raw.characters:[]);
  }catch(_){ return []; }
}

function refreshModel(){
  const levels=loadLevelState();
  state.relationships=buildRelationshipCatalog(state.items,state.characters,levels,Date.now());
  state.world=summarizeRelationshipWorld(state.items,state.relationships);
  document.dispatchEvent(new CustomEvent('english-pwa:relationship-updated',{detail:{world:state.world}}));
  return {levels,relationships:state.relationships,world:state.world};
}

function injectStyles(){
  if(document.getElementById('relationshipModeStyles')) return;
  const style=document.createElement('style');
  style.id='relationshipModeStyles';
  style.textContent=`
    body.focus-home-view main{padding:6px 12px 10px}
    .home-cta-wrap.focus-home.friendship-home{position:relative;top:auto;z-index:1;width:100%;margin:0 auto;max-width:580px;gap:9px;padding:0 2px 4px;background:none}
    #startStudyCta.friendship-hidden-start{display:none!important}
    #focusHomeMeta.friendship-replaced{display:none!important}
    .friendship-hero{--character-accent:#7dd3fc;--character-deep:#164e63;--character-soft:rgba(14,116,144,.28);position:relative;isolation:isolate;overflow:hidden;border:1px solid color-mix(in srgb,var(--character-accent) 30%,transparent);border-radius:28px;padding:14px;background:radial-gradient(110% 75% at 82% 8%,var(--character-soft),transparent 62%),linear-gradient(155deg,color-mix(in srgb,var(--character-deep) 42%,#101522),#101522 68%);box-shadow:0 22px 54px rgba(0,0,0,.3)}
    .friendship-hero::before{content:"";position:absolute;inset:-20% -35% 46% 35%;z-index:-1;border-radius:50%;background:var(--character-soft);filter:blur(30px);opacity:.8}
    .friendship-hero__eyebrow{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--character-accent);margin:1px 2px 9px}.friendship-hero__eyebrow::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--character-accent);box-shadow:0 0 14px var(--character-accent)}
    .friendship-hero__person{display:grid;grid-template-columns:minmax(132px,42%) minmax(0,1fr);gap:14px;align-items:center;min-height:178px}.friendship-hero__portrait{align-self:stretch;min-height:178px;border-radius:22px;overflow:hidden;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 16px 30px rgba(0,0,0,.22)}.friendship-hero__portrait img{width:100%;height:100%;min-height:178px;object-fit:cover;object-position:center 28%;transform:scale(1.04)}
    .friendship-hero__copy{min-width:0}.friendship-hero__name{font-size:clamp(28px,9vw,38px);font-weight:950;letter-spacing:-.035em;line-height:1}.friendship-rank{display:inline-flex;margin-top:8px;padding:5px 10px;border:1px solid color-mix(in srgb,var(--character-accent) 28%,transparent);border-radius:999px;background:color-mix(in srgb,var(--character-accent) 11%,transparent);color:color-mix(in srgb,var(--character-accent) 84%,white);font-size:11px;font-weight:900}
    .friendship-talk-plan{margin-top:13px;font-size:14px;font-weight:850;line-height:1.45}.friendship-next{font-size:10px;opacity:.62;margin-top:6px;line-height:1.4}.friendship-intimacy-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px;font-size:10px;opacity:.8}.friendship-intimacy-row strong{font-size:11px;color:var(--character-accent)}.friendship-intimacy-track{height:6px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.1);margin-top:5px}.friendship-intimacy-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--character-accent),#a7f3d0);transition:width .35s ease}
    .friendship-hero__cta{width:100%;min-height:54px;border:0;border-radius:16px;background:var(--character-accent);color:#07111c;font:inherit;font-size:16px;font-weight:950;margin-top:13px;cursor:pointer;box-shadow:0 13px 28px color-mix(in srgb,var(--character-accent) 24%,transparent)}
    .friendship-world{display:none!important}
    #focusHomeNav.friendship-nav{display:grid;grid-template-columns:1fr auto;gap:8px}.friendship-nav button{min-height:45px}.friendship-nav__choose{border-color:rgba(255,255,255,.14)!important;background:rgba(255,255,255,.055)!important}.friendship-nav__options{border-color:transparent!important;background:transparent!important;opacity:.68;padding-inline:12px!important}.friendship-all{display:none!important}
    .friendship-session{display:flex;align-items:center;gap:9px;min-height:44px;margin:0 0 8px;padding:7px 9px;border:1px solid rgba(129,140,248,.16);border-radius:14px;background:rgba(99,102,241,.055)}.friendship-session[hidden]{display:none!important}.friendship-session img{width:36px;height:36px;border-radius:11px;object-fit:cover}.friendship-session__copy{min-width:0}.friendship-session__title{font-size:12px;font-weight:850}.friendship-session__prompt{font-size:10px;opacity:.6;margin-top:2px}
    .friendship-float{position:fixed;left:50%;top:18%;z-index:1200;transform:translate(-50%,-10px);padding:10px 14px;border:1px solid rgba(129,140,248,.25);border-radius:999px;background:rgba(16,21,34,.96);box-shadow:0 14px 36px rgba(0,0,0,.35);font-size:13px;font-weight:850;opacity:0;pointer-events:none;animation:friendshipFloat 1.8s ease forwards}.friendship-float--rank{border-radius:16px;font-size:15px;padding:13px 18px}
    @keyframes friendshipFloat{0%{opacity:0;transform:translate(-50%,8px) scale(.96)}18%{opacity:1;transform:translate(-50%,0) scale(1)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-18px) scale(.98)}}
    .friendship-review{margin:0 auto 12px;max-width:520px;padding:13px;border:1px solid rgba(129,140,248,.2);border-radius:16px;background:rgba(99,102,241,.06);text-align:left}.friendship-review__title{font-size:13px;font-weight:900}.friendship-review__line{font-size:11px;opacity:.7;margin-top:5px;line-height:1.5}
    .friendship-ending{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 28px,520px)}.friendship-ending::backdrop{background:rgba(3,6,16,.82);backdrop-filter:blur(7px)}.friendship-ending__card{padding:24px;border:1px solid rgba(129,140,248,.25);border-radius:25px;background:#101522;text-align:center;box-shadow:0 26px 70px rgba(0,0,0,.5)}.friendship-ending__title{font-size:25px;font-weight:950}.friendship-ending__text{font-size:13px;line-height:1.7;opacity:.72;margin:10px 0 18px}.friendship-ending button{width:100%;min-height:48px;border:0;border-radius:14px;background:#6366f1;color:#fff;font:inherit;font-weight:850;cursor:pointer}
    @media(max-width:430px){.friendship-hero{padding:12px;border-radius:24px}.friendship-hero__person{grid-template-columns:minmax(124px,42%) minmax(0,1fr);min-height:166px;gap:11px}.friendship-hero__portrait,.friendship-hero__portrait img{min-height:166px}.friendship-talk-plan{font-size:13px}.friendship-hero__cta{margin-top:11px}.friendship-next{font-size:9px}}
    @media(max-width:370px){.friendship-hero__person{grid-template-columns:118px minmax(0,1fr);min-height:154px}.friendship-hero__portrait,.friendship-hero__portrait img{min-height:154px}.friendship-intimacy-row{margin-top:9px}.friendship-talk-plan{margin-top:10px}.friendship-hero__cta{min-height:50px}.friendship-nav button{min-height:42px}}
  `;
  document.head.appendChild(style);
}

function nextGoalText(rel){
  if(!rel) return '';
  if(rel.rank.id==='best_friend'){
    return rel.next.remaining>0?`完全定着まであと ${rel.next.remaining}文`:'完全定着';
  }
  return rel.next.remaining>0?`${rel.next.label}まであと ${rel.next.remaining}文`:`${rel.next.label}までもう少し`;
}

function worldGoalText(world){
  if(!world) return '';
  if(world.allBestFriends) return `友情良好 ${world.connectedCount}/${world.totalCharacters}`;
  const next=nextWorldMilestone(world);
  if(!next) return '';
  const current=next.kind==='friend'?world.friendCount:world.bestFriendCount;
  const target=next.count==='all'?world.totalCharacters:Number(next.count);
  return `${next.label}まで ${current}/${target}`;
}

function renderHome(){
  refreshModel();
  const wrap=document.querySelector('.home-cta-wrap');
  const cta=document.getElementById('startStudyCta');
  if(!wrap||!cta||!state.relationships.length) return;
  wrap.classList.add('friendship-home');
  cta.classList.add('friendship-hidden-start');
  document.getElementById('focusHomeMeta')?.classList.add('friendship-replaced');

  let hero=document.getElementById('friendshipHero');
  if(!hero){
    hero=document.createElement('section');hero.id='friendshipHero';hero.className='friendship-hero';
    wrap.insertBefore(hero,cta);
  }
  const recommended=recommendCharacter(state.relationships)||state.relationships[0];
  const rel=recommended;
  const plan=buildAutomaticSession(state.items,loadLevelState(),{scope:{type:'character',id:rel.id}});
  const theme=characterTheme(rel.id);
  hero.style.setProperty('--character-accent',theme.accent);hero.style.setProperty('--character-deep',theme.deep);hero.style.setProperty('--character-soft',theme.soft);
  hero.replaceChildren();
  const eyebrow=document.createElement('div');eyebrow.className='friendship-hero__eyebrow';eyebrow.textContent='今日の相手';
  const person=document.createElement('div');person.className='friendship-hero__person';
  const portrait=document.createElement('div');portrait.className='friendship-hero__portrait';const image=document.createElement('img');image.alt='';image.src=iconPath(rel.character);portrait.appendChild(image);
  const copy=document.createElement('div');copy.className='friendship-hero__copy';
  const name=document.createElement('div');name.className='friendship-hero__name';name.textContent=rel.name;
  const rank=document.createElement('div');rank.className='friendship-rank';rank.textContent=rel.rank.label;
  const talkPlan=document.createElement('div');talkPlan.className='friendship-talk-plan';talkPlan.textContent=lobbyConversationCopy(rel.name,plan.size);
  const next=document.createElement('div');next.className='friendship-next';next.textContent=nextGoalText(rel);
  copy.append(name,rank,talkPlan,next);person.append(portrait,copy);
  const intimacyRow=document.createElement('div');intimacyRow.className='friendship-intimacy-row';
  const intimacyLabel=document.createElement('span');intimacyLabel.textContent='親密度';
  const intimacyValue=document.createElement('strong');intimacyValue.textContent=`${rel.intimacy}`;
  intimacyRow.append(intimacyLabel,intimacyValue);
  const track=document.createElement('div');track.className='friendship-intimacy-track';
  const fill=document.createElement('div');fill.className='friendship-intimacy-fill';fill.style.width=`${rel.intimacy}%`;track.appendChild(fill);
  const play=document.createElement('button');play.type='button';play.className='friendship-hero__cta';play.textContent=`${rel.name}に会いに行く`;play.addEventListener('click',()=>startCharacter(rel.id));
  hero.append(eyebrow,person,intimacyRow,track,play);

  let world=document.getElementById('friendshipWorld');
  if(!world){world=document.createElement('div');world.id='friendshipWorld';world.className='friendship-world';wrap.insertBefore(world,cta);}
  world.innerHTML='';
  const counts=document.createElement('span');counts.textContent=`友達 ${state.world.friendCount}/${state.world.totalCharacters} · 親友 ${state.world.bestFriendCount}/${state.world.totalCharacters}`;
  const goal=document.createElement('span');goal.className='friendship-world__goal';goal.textContent=worldGoalText(state.world);
  world.append(counts,goal);

  const nav=document.getElementById('focusHomeNav');
  if(nav){
    nav.classList.add('friendship-nav');nav.replaceChildren();
    const chars=document.createElement('button');chars.type='button';chars.className='friendship-nav__choose';chars.textContent='相手を選ぶ';chars.addEventListener('click',()=>globalThis.__OPEN_ENGLISH_LEARNING_BROWSER__?.('character'));
    const options=document.createElement('button');options.type='button';options.className='friendship-nav__options';options.textContent='遊び方を変える';options.addEventListener('click',()=>globalThis.__OPEN_SESSION_OPTIONS__?.({characterId:rel.id}));
    nav.append(chars,options);
    if(state.world.allFriends){
      const everyone=document.createElement('button');everyone.type='button';everyone.className='friendship-all';everyone.textContent='みんなと遊ぶ';everyone.addEventListener('click',startEveryone);nav.appendChild(everyone);
    }
  }
}

function beginCharacterSession(characterId){
  refreshModel();
  state.activeCharacterId=characterId;
  globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__=characterId;
  state.beforeSnapshot=snapshotRelationships(state.relationships);
  state.liveSnapshot=state.beforeSnapshot;
}

function startCharacter(characterId){
  const rel=relationshipById(characterId)||refreshModel().relationships.find(entry=>entry.id===characterId);
  if(!rel) return false;
  beginCharacterSession(characterId);
  globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__={type:'character',id:characterId};
  document.getElementById('tagBrowserDialog')?.close();
  document.getElementById('startStudyCta')?.click();
  return true;
}

function startEveryone(){
  state.activeCharacterId='';
  globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__='';
  state.skipDefaultScopeOnce=true;
  state.beforeSnapshot=snapshotRelationships(refreshModel().relationships);
  state.liveSnapshot=state.beforeSnapshot;
  document.getElementById('startStudyCta')?.click();
}

function clearActiveCharacter(){
  state.activeCharacterId='';
  globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__='';
}

function captureStarts(event){
  const target=event.target instanceof Element?event.target:null;
  if(!target) return;
  if(target.closest('.explore-start')){
    state.skipDefaultScopeOnce=true;
    return;
  }
  if(target.closest('#reviewActionContinue')&&state.activeCharacterId){
    beginCharacterSession(state.activeCharacterId);
    if(!globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__){
      globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__={type:'character',id:state.activeCharacterId};
    }
    return;
  }
  if(!target.closest('#startStudyCta')) return;
  if(globalThis.__ENGLISH_PWA_CUSTOM_SESSION_PENDING__){
    try{delete globalThis.__ENGLISH_PWA_CUSTOM_SESSION_PENDING__;}catch(_){globalThis.__ENGLISH_PWA_CUSTOM_SESSION_PENDING__=false;}
    return;
  }
  if(globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__) return;
  if(state.skipDefaultScopeOnce){state.skipDefaultScopeOnce=false;return;}
  const recommended=recommendCharacter(refreshModel().relationships);
  if(!recommended) return;
  beginCharacterSession(recommended.id);
  globalThis.__ENGLISH_PWA_TAG_SCOPE_REQUEST__={type:'character',id:recommended.id};
}

function ensureSessionHeader(){
  let host=document.getElementById('friendshipSession');
  if(host) return host;
  const en=document.getElementById('enText');
  if(!en?.parentNode) return null;
  host=document.createElement('div');host.id='friendshipSession';host.className='friendship-session';host.hidden=true;
  en.parentNode.insertBefore(host,en);
  return host;
}

function renderSessionHeader(itemId=''){
  const host=ensureSessionHeader();
  if(!host) return;
  const rel=activeRelationship();
  if(!rel){host.hidden=true;host.replaceChildren();return;}
  host.hidden=false;host.replaceChildren();
  const image=document.createElement('img');image.alt='';image.src=iconPath(rel.character);
  const copy=document.createElement('div');copy.className='friendship-session__copy';
  const title=document.createElement('div');title.className='friendship-session__title';title.textContent=`${rel.name}と遊んでいる · ${rel.rank.label}`;
  const levels=loadLevelState();
  const info=itemId?levels[itemId]:null;
  const best=Math.max(Number(info?.best)||0,Number(info?.last)||0);
  const prompt=document.createElement('div');prompt.className='friendship-session__prompt';
  prompt.textContent=best<=1?'一緒に言ってみよう':(best<=3?'思い出せる？':`${rel.name}に返してみよう`);
  copy.append(title,prompt);host.append(image,copy);
}

function showFloat(text,{rank=false}={}){
  if(!text) return;
  const node=document.createElement('div');node.className='friendship-float'+(rank?' friendship-float--rank':'');node.textContent=text;document.body.appendChild(node);
  setTimeout(()=>node.remove(),1900);
}

function inspectLiveProgress(){
  if(!state.liveSnapshot) return;
  const {relationships}=refreshModel();
  const deltas=compareRelationshipSnapshots(state.liveSnapshot,relationships);
  const meaningful=deltas.filter(delta=>delta.pointGain>0||delta.rankUp||delta.intimacyGain>=2);
  if(meaningful.length){
    const active=meaningful.find(delta=>delta.id===state.activeCharacterId)||meaningful[0];
    if(active.rankUp) showFloat(`${active.name}と${active.rank.label}になった！`,{rank:true});
    else if(active.pointGain>0) showFloat(`友情 +${active.pointGain} · ${active.name}`);
    else if(active.intimacyGain>=2) showFloat(`親密度 +${Math.round(active.intimacyGain)} · ${active.name}`);
    const secondary=meaningful.find(delta=>delta.id!==active.id&&(delta.pointGain>0||delta.rankUp));
    if(secondary) setTimeout(()=>showFloat(`${secondary.name}との友情も進んだ`),500);
  }
  state.liveSnapshot=snapshotRelationships(relationships);
}

function renderReviewSummary(){
  const view=document.getElementById('reviewCompleteView');
  if(!view||!state.beforeSnapshot) return;
  const existing=document.getElementById('friendshipReview');existing?.remove();
  const {relationships}=refreshModel();
  const deltas=compareRelationshipSnapshots(state.beforeSnapshot,relationships);
  const rel=activeRelationship();
  const panel=document.createElement('div');panel.id='friendshipReview';panel.className='friendship-review';
  const title=document.createElement('div');title.className='friendship-review__title';
  title.textContent=rel?`${rel.name}との時間`:'みんなとの時間';
  panel.appendChild(title);
  const activeDelta=rel?deltas.find(delta=>delta.id===rel.id):null;
  const lines=[];
  if(activeDelta?.rankUp) lines.push(`${rel.name}と${activeDelta.rank.label}になった！`);
  if(activeDelta?.pointGain>0) lines.push(`友情 +${activeDelta.pointGain}`);
  if(rel) lines.push(`親密度 ${rel.intimacy} · ${rel.intimacyStatus.label}`);
  const secondary=deltas.filter(delta=>delta.id!==rel?.id&&delta.pointGain>0).slice(0,2);
  if(secondary.length) lines.push(`${secondary.map(delta=>delta.name).join('・')}との友情も進んだ`);
  if(!lines.length) lines.push('復習を重ねると、親密度を保ちやすくなります。');
  for(const text of lines){const line=document.createElement('div');line.className='friendship-review__line';line.textContent=text;panel.appendChild(line);}
  const anchor=view.querySelector('.review-complete-actions')||view.firstChild;
  if(anchor?.parentNode) anchor.parentNode.insertBefore(panel,anchor); else view.appendChild(panel);
  state.liveSnapshot=snapshotRelationships(relationships);
  checkMilestones({show:true});
}

function ensureEndingDialog(){
  let dialog=document.getElementById('friendshipEndingDialog');
  if(dialog) return dialog;
  dialog=document.createElement('dialog');dialog.id='friendshipEndingDialog';dialog.className='friendship-ending';
  dialog.innerHTML='<section class="friendship-ending__card"><div class="friendship-ending__title"></div><div class="friendship-ending__text"></div><button type="button">つづける</button></section>';
  dialog.querySelector('button')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});document.body.appendChild(dialog);return dialog;
}

function showEnding(milestone){
  if(!milestone) return;
  if(milestone.id!=='friends_all'&&milestone.id!=='best_friends_all'){
    showFloat(`${milestone.label}を達成！`,{rank:true});return;
  }
  const dialog=ensureEndingDialog();
  const title=dialog.querySelector('.friendship-ending__title');
  const text=dialog.querySelector('.friendship-ending__text');
  if(milestone.id==='friends_all'){
    title.textContent='みんなと友達になった';
    text.textContent=`${state.world?.assignedItemCount||state.items.length}の英文すべてに出会いました。「みんなと遊ぶ」が解禁されました。`;
  }else{
    title.textContent='みんなと親友になった';
    text.textContent='担当英文をすべて習得しました。ここからは、必要な復習を続けて20人との友情を保つフェーズです。';
  }
  if(!dialog.open) dialog.showModal();
}

function checkMilestones({show=false}={}){
  refreshModel();
  const reached=reachedMilestones(state.world);
  const saved=loadJsonStorage(MILESTONE_KEY,{})||{};
  const fresh=reached.filter(milestone=>!saved[milestone.id]);
  if(!fresh.length) return [];
  const stamp=Date.now();
  for(const milestone of fresh) saved[milestone.id]=stamp;
  saveJsonStorage(MILESTONE_KEY,saved);
  if(show){
    const priority=['best_friends_all','friends_all','best_friends_10','friends_10','best_friends_5','friends_5'];
    const milestone=fresh.slice().sort((a,b)=>priority.indexOf(a.id)-priority.indexOf(b.id))[0];
    setTimeout(()=>showEnding(milestone),160);
  }
  return fresh;
}

function onItemChanged(itemId){
  if(!itemId||itemId===state.currentItemId) return;
  state.currentItemId=itemId;
  refreshModel();renderSessionHeader(itemId);
  setTimeout(inspectLiveProgress,60);
}

function handleViewChange(){
  const study=document.getElementById('studyView');
  const review=document.getElementById('reviewCompleteView');
  const home=document.getElementById('homeView');
  if(study&&!study.hidden){refreshModel();renderSessionHeader(state.currentItemId);return;}
  if(review&&!review.hidden){setTimeout(renderReviewSummary,20);return;}
  if(home&&!home.hidden){refreshModel();renderHome();ensureSessionHeader()?.setAttribute('hidden','');}
}

function bindObservers(){
  document.addEventListener('click',captureStarts,true);
  const en=document.getElementById('enText');
  if(en){new MutationObserver(()=>onItemChanged(String(en.dataset.itemId||''))).observe(en,{attributes:true,attributeFilter:['data-item-id']});}
  const views=['homeView','studyView','reviewCompleteView'].map(id=>document.getElementById(id)).filter(Boolean);
  const observer=new MutationObserver(handleViewChange);views.forEach(view=>observer.observe(view,{attributes:true,attributeFilter:['hidden']}));
}

async function init(){
  if(state.initialized) return;
  state.initialized=true;
  state.items=Array.isArray(window.ALL_ITEMS)?window.ALL_ITEMS.slice():[];
  state.characters=await loadCharacters();
  injectStyles();refreshModel();
  globalThis.__START_CHARACTER_STUDY__=startCharacter;
  globalThis.__PREPARE_CHARACTER_SESSION__=beginCharacterSession;
  globalThis.__CLEAR_ACTIVE_CHARACTER_SESSION__=clearActiveCharacter;
  globalThis.__RELATIONSHIP_GAME_STATE__=()=>({relationships:state.relationships,world:state.world,activeCharacterId:state.activeCharacterId});
  bindObservers();renderHome();ensureSessionHeader();checkMilestones({show:true});handleViewChange();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init().catch(error=>console.warn('Relationship mode failed',error)),{once:true});
  else init().catch(error=>console.warn('Relationship mode failed',error));
}
