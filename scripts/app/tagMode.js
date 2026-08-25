import {
  TAG_TYPES,
  TAG_TYPE_META,
  buildTagCatalog,
  recommendTags,
  examplesForTag,
  makeSearchToken,
  labelForTag
} from './tagLearningCore.js';

const LEVEL_KEY='itemLevelV1';
const SELECTION_KEY='tagLearningSelectionV1';
const TAB_KEY='tagLearningTabV1';
const MAIN_CHARACTER_IDS=new Set(['bob','jennifer','nick','lisa','jane']);

let state={ items:[], characters:[], characterMap:new Map(), catalog:null, activeType:'character', selected:null };

function loadJsonStorage(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  }catch(_){ return fallback; }
}

function iconPath(profile){
  const name=profile?.name || '';
  return name ? `./${encodeURIComponent(name)}.png` : '';
}

function injectStyles(){
  if(document.getElementById('tagLearningStyles')) return;
  const style=document.createElement('style');
  style.id='tagLearningStyles';
  style.textContent=`
    .tag-hub{margin:18px 0 22px;padding:18px;border:1px solid rgba(148,163,184,.18);border-radius:22px;background:linear-gradient(145deg,rgba(30,41,59,.72),rgba(15,23,42,.54));box-shadow:0 14px 34px rgba(0,0,0,.16)}
    .tag-hub *{box-sizing:border-box}.tag-hub__head{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;margin-bottom:14px}.tag-hub__eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.64;margin:0 0 5px}.tag-hub__title{font-size:21px;line-height:1.25;margin:0}.tag-hub__copy{margin:5px 0 0;font-size:13px;line-height:1.55;opacity:.72}.tag-hub__reset{border:0;background:rgba(148,163,184,.12);color:inherit;border-radius:999px;padding:8px 11px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
    .tag-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:5px;background:rgba(15,23,42,.58);border-radius:14px;margin-bottom:14px}.tag-tab{border:0;border-radius:10px;padding:9px 5px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;opacity:.65}.tag-tab.is-active{background:rgba(99,102,241,.24);opacity:1;font-weight:700;box-shadow:inset 0 0 0 1px rgba(129,140,248,.28)}
    .tag-reco{display:flex;gap:8px;overflow-x:auto;padding:0 0 12px;scrollbar-width:none}.tag-reco::-webkit-scrollbar{display:none}.tag-reco__btn{flex:0 0 auto;border:1px solid rgba(129,140,248,.28);background:rgba(99,102,241,.11);color:inherit;border-radius:999px;padding:8px 11px;font:inherit;font-size:12px;cursor:pointer}.tag-reco__btn strong{font-weight:750}.tag-reco__btn span{opacity:.68;margin-left:5px}
    .tag-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.tag-card{min-width:0;border:1px solid rgba(148,163,184,.17);background:rgba(15,23,42,.42);color:inherit;border-radius:16px;padding:12px;text-align:left;font:inherit;cursor:pointer;transition:transform .15s ease,border-color .15s ease,background .15s ease}.tag-card:active{transform:scale(.985)}.tag-card.is-selected{border-color:rgba(129,140,248,.72);background:rgba(99,102,241,.14)}
    .tag-card--character{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center}.tag-avatar{width:48px;height:48px;border-radius:14px;object-fit:cover;background:rgba(148,163,184,.12);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}.tag-card__name{display:block;font-size:14px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag-card__sub{display:block;font-size:11px;opacity:.62;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag-card__metrics{display:flex;gap:7px;align-items:center;margin-top:7px;font-size:11px;opacity:.72}.tag-progress{height:4px;border-radius:99px;background:rgba(148,163,184,.16);overflow:hidden;margin-top:8px}.tag-progress>i{display:block;height:100%;background:currentColor;opacity:.7;border-radius:inherit}.tag-card__due{font-weight:700;opacity:1}.tag-card__due:not(:empty)::before{content:'●';font-size:7px;margin-right:4px;vertical-align:1px}
    .tag-section-label{font-size:12px;font-weight:750;margin:14px 2px 8px;opacity:.74}.tag-section-label:first-child{margin-top:0}.tag-detail{margin-top:14px;border-top:1px solid rgba(148,163,184,.15);padding-top:14px}.tag-detail[hidden]{display:none}.tag-detail__hero{display:flex;gap:12px;align-items:center}.tag-detail__avatar{width:62px;height:62px;border-radius:18px;object-fit:cover;background:rgba(148,163,184,.12)}.tag-detail__title{font-size:19px;font-weight:800}.tag-detail__meta{font-size:12px;opacity:.68;margin-top:4px}.tag-detail__summary{font-size:13px;line-height:1.65;margin:11px 0 0;opacity:.86}.tag-detail__relation{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.tag-relation-pill{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(148,163,184,.11);opacity:.82}.tag-detail__stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px}.tag-stat{padding:8px 5px;text-align:center;border-radius:11px;background:rgba(15,23,42,.5)}.tag-stat strong{display:block;font-size:16px}.tag-stat span{display:block;font-size:10px;opacity:.62;margin-top:2px}.tag-detail__examples{display:grid;gap:7px;margin-top:10px}.tag-example{padding:9px 10px;border-radius:11px;background:rgba(148,163,184,.08);font-size:11px;line-height:1.45}.tag-example b{display:block;font-size:12px;font-weight:650}.tag-example span{display:block;opacity:.63;margin-top:3px}.tag-detail__start{width:100%;margin-top:12px;border:0;border-radius:14px;padding:13px 15px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 8px 20px rgba(99,102,241,.22)}.tag-detail__note{text-align:center;font-size:10px;opacity:.55;margin-top:7px}
    .tag-context-strip{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:-2px 0 11px;padding:7px 8px;border-radius:12px;background:rgba(99,102,241,.08);font-size:11px}.tag-context-person{display:inline-flex;align-items:center;gap:5px;font-weight:700}.tag-context-person img{width:27px;height:27px;border-radius:9px;object-fit:cover}.tag-context-person.is-related{opacity:.68}.tag-context-chip{padding:4px 7px;border-radius:999px;background:rgba(148,163,184,.1);opacity:.8}.tag-context-related{font-size:9px;font-weight:500;opacity:.65}
    @media (min-width:680px){.tag-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.tag-hub{padding:20px}.tag-card--character{grid-template-columns:56px 1fr}.tag-avatar{width:56px;height:56px}.tag-detail__stats{max-width:440px}}
    @media (max-width:380px){.tag-hub{padding:14px;margin-left:-2px;margin-right:-2px}.tag-tabs{gap:3px}.tag-tab{font-size:12px}.tag-grid{gap:7px}.tag-card{padding:10px}.tag-card--character{grid-template-columns:42px 1fr}.tag-avatar{width:42px;height:42px}}
  `;
  document.head.appendChild(style);
}

function createHub(){
  if(document.getElementById('tagLearningHub')) return document.getElementById('tagLearningHub');
  const home=document.getElementById('homeView');
  if(!home) return null;
  const hub=document.createElement('section');
  hub.id='tagLearningHub';
  hub.className='tag-hub';
  hub.setAttribute('aria-labelledby','tagLearningTitle');
  hub.innerHTML=`
    <div class="tag-hub__head">
      <div><p class="tag-hub__eyebrow">TAG LEARNING</p><h2 class="tag-hub__title" id="tagLearningTitle">タグから学ぶ</h2><p class="tag-hub__copy">同じ560文を人物・場面・文法・表現から再構成。復習は既存SRSをそのまま使います。</p></div>
      <button class="tag-hub__reset" type="button" id="tagLearningReset">絞り込み解除</button>
    </div>
    <div class="tag-tabs" role="tablist" aria-label="タグ学習カテゴリ"></div>
    <div class="tag-reco" id="tagRecommendations" aria-label="おすすめ"></div>
    <div id="tagCatalog"></div>
    <div class="tag-detail" id="tagDetail" hidden></div>
  `;
  const cta=home.querySelector('.home-cta-wrap');
  if(cta?.nextSibling) home.insertBefore(hub,cta.nextSibling); else home.prepend(hub);
  return hub;
}

function loadLevelState(){ return loadJsonStorage(LEVEL_KEY,{}); }

function rebuildCatalog(){
  state.catalog=buildTagCatalog(state.items,state.characters,loadLevelState(),Date.now());
}

function renderTabs(){
  const wrap=document.querySelector('#tagLearningHub .tag-tabs');
  if(!wrap) return;
  wrap.replaceChildren();
  for(const type of TAG_TYPES){
    const btn=document.createElement('button');
    btn.type='button'; btn.className='tag-tab'+(type===state.activeType?' is-active':'');
    btn.textContent=TAG_TYPE_META[type].label; btn.setAttribute('role','tab');
    btn.setAttribute('aria-selected',type===state.activeType?'true':'false');
    btn.addEventListener('click',()=>{ state.activeType=type; localStorage.setItem(TAB_KEY,type); state.selected=null; render(); });
    wrap.appendChild(btn);
  }
}

function metricsText(entry){
  if(entry.due>0) return `${entry.due} 復習`;
  if(entry.learning>0) return `${entry.learning} 学習中`;
  if(entry.fresh>0) return `${entry.fresh} 未学習`;
  return '定着済み';
}

function createTagCard(entry){
  const btn=document.createElement('button');
  btn.type='button'; btn.className='tag-card'+(entry.type==='character'?' tag-card--character':'');
  if(state.selected?.type===entry.type && state.selected?.id===entry.id) btn.classList.add('is-selected');
  btn.dataset.type=entry.type; btn.dataset.id=entry.id;
  if(entry.type==='character'){
    const img=document.createElement('img'); img.className='tag-avatar'; img.alt=''; img.loading='lazy'; img.decoding='async';
    if(entry.profile) img.src=iconPath(entry.profile);
    const body=document.createElement('span');
    const name=document.createElement('span'); name.className='tag-card__name'; name.textContent=entry.label;
    const sub=document.createElement('span'); sub.className='tag-card__sub';
    sub.textContent=entry.profile?.archetype_ja || `${entry.total}文`;
    const metrics=document.createElement('span'); metrics.className='tag-card__metrics';
    const count=document.createElement('span'); count.textContent=`${entry.mastered}/${entry.total} 習得`;
    const due=document.createElement('span'); due.className='tag-card__due'; due.textContent=entry.due?`${entry.due}復習`:'';
    metrics.append(count,due);
    const progress=document.createElement('span'); progress.className='tag-progress'; const fill=document.createElement('i'); fill.style.width=`${entry.mastery}%`; progress.appendChild(fill);
    body.append(name,sub,metrics,progress); btn.append(img,body);
  }else{
    const name=document.createElement('span'); name.className='tag-card__name'; name.textContent=entry.label;
    const sub=document.createElement('span'); sub.className='tag-card__sub'; sub.textContent=`${entry.total}文 · ${metricsText(entry)}`;
    const metrics=document.createElement('span'); metrics.className='tag-card__metrics'; metrics.textContent=`${entry.mastered}/${entry.total} 習得 · ${entry.mastery}%`;
    const progress=document.createElement('span'); progress.className='tag-progress'; const fill=document.createElement('i'); fill.style.width=`${entry.mastery}%`; progress.appendChild(fill);
    btn.append(name,sub,metrics,progress);
  }
  btn.addEventListener('click',()=>{ state.selected={type:entry.type,id:entry.id}; renderCatalog(); renderDetail(entry); });
  return btn;
}

function renderRecommendations(){
  const wrap=document.getElementById('tagRecommendations'); if(!wrap) return;
  wrap.replaceChildren();
  const recs=recommendTags(state.catalog,{limit:4});
  if(!recs.length) return;
  for(const entry of recs){
    const btn=document.createElement('button'); btn.className='tag-reco__btn'; btn.type='button';
    const strong=document.createElement('strong'); strong.textContent=entry.type==='character'?entry.label:entry.label;
    const meta=document.createElement('span'); meta.textContent=entry.due?`${entry.due}件復習`:`${entry.mastery}%習得`;
    btn.append(strong,meta); btn.addEventListener('click',()=>{ state.activeType=entry.type; state.selected={type:entry.type,id:entry.id}; localStorage.setItem(TAB_KEY,entry.type); render(); });
    wrap.appendChild(btn);
  }
}

function renderCatalog(){
  const host=document.getElementById('tagCatalog'); if(!host) return;
  host.replaceChildren();
  const entries=state.catalog?.[state.activeType] || [];
  if(state.activeType==='character'){
    const main=entries.filter(x=>x.profile?.tier==='main' || MAIN_CHARACTER_IDS.has(x.id));
    const supporting=entries.filter(x=>!main.includes(x));
    for(const [label,list] of [['主要キャラ',main],['その他のキャラ',supporting]]){
      if(!list.length) continue;
      const title=document.createElement('div'); title.className='tag-section-label'; title.textContent=label; host.appendChild(title);
      const grid=document.createElement('div'); grid.className='tag-grid'; list.forEach(entry=>grid.appendChild(createTagCard(entry))); host.appendChild(grid);
    }
  }else{
    const grid=document.createElement('div'); grid.className='tag-grid'; entries.forEach(entry=>grid.appendChild(createTagCard(entry))); host.appendChild(grid);
  }
}

function relationLabel(rel){
  if(!rel) return '';
  const target=rel.character_id ? state.characterMap.get(rel.character_id) : null;
  const who=target?.name || (rel.character_id ? rel.character_id : '名前不明');
  return `${who}：${rel.label_ja || rel.type || '関連'}`;
}

function renderDetail(entry){
  const host=document.getElementById('tagDetail'); if(!host || !entry){ if(host) host.hidden=true; return; }
  host.hidden=false; host.replaceChildren();
  const hero=document.createElement('div'); hero.className='tag-detail__hero';
  if(entry.type==='character' && entry.profile){ const img=document.createElement('img'); img.className='tag-detail__avatar'; img.src=iconPath(entry.profile); img.alt=''; hero.appendChild(img); }
  const titleWrap=document.createElement('div'); const title=document.createElement('div'); title.className='tag-detail__title'; title.textContent=entry.label;
  const meta=document.createElement('div'); meta.className='tag-detail__meta';
  meta.textContent=entry.type==='character' ? `${entry.coreTotal}主要文${entry.relatedTotal?` + ${entry.relatedTotal}関連文`:''}` : `${TAG_TYPE_META[entry.type].label} · ${entry.total}文`;
  titleWrap.append(title,meta); hero.appendChild(titleWrap); host.appendChild(hero);
  if(entry.profile?.summary_ja){ const summary=document.createElement('p'); summary.className='tag-detail__summary'; summary.textContent=entry.profile.summary_ja; host.appendChild(summary); }
  if(entry.profile?.relationships?.length){ const rels=document.createElement('div'); rels.className='tag-detail__relation'; for(const rel of entry.profile.relationships.slice(0,4)){ const pill=document.createElement('span'); pill.className='tag-relation-pill'; pill.textContent=relationLabel(rel); rels.appendChild(pill); } host.appendChild(rels); }
  const stats=document.createElement('div'); stats.className='tag-detail__stats';
  for(const [value,label] of [[entry.due,'復習'],[entry.fresh,'未学習'],[entry.learning,'学習中'],[entry.mastered,'習得']]){ const box=document.createElement('div'); box.className='tag-stat'; const strong=document.createElement('strong'); strong.textContent=String(value); const span=document.createElement('span'); span.textContent=label; box.append(strong,span); stats.appendChild(box); }
  host.appendChild(stats);
  const examples=examplesForTag(state.items,entry.type,entry.id,{limit:2,includeMedium:true});
  if(examples.length){ const list=document.createElement('div'); list.className='tag-detail__examples'; for(const item of examples){ const box=document.createElement('div'); box.className='tag-example'; const en=document.createElement('b'); en.textContent=item.en||''; const ja=document.createElement('span'); ja.textContent=item.ja||''; box.append(en,ja); list.appendChild(box); } host.appendChild(list); }
  const start=document.createElement('button'); start.type='button'; start.className='tag-detail__start'; start.textContent=`「${entry.label}」で学習を始める`; start.addEventListener('click',()=>startTagSession(entry)); host.appendChild(start);
  const note=document.createElement('div'); note.className='tag-detail__note'; note.textContent='全セクションを対象に、復習優先で既存の発話学習へ接続します'; host.appendChild(note);
  requestAnimationFrame(()=>host.scrollIntoView({behavior:'smooth',block:'nearest'}));
}

function render(){
  rebuildCatalog(); renderTabs(); renderRecommendations(); renderCatalog();
  if(state.selected){ const entry=(state.catalog?.[state.selected.type]||[]).find(x=>x.id===state.selected.id); renderDetail(entry||null); }
  else renderDetail(null);
}

function dispatchChange(element){ element?.dispatchEvent(new Event('change',{bubbles:true})); }

function startTagSession(entry){
  const search=document.getElementById('rangeSearch'); const section=document.getElementById('secSel'); const order=document.getElementById('orderSel'); const start=document.getElementById('startStudyCta');
  if(!search || !start) return;
  const token=makeSearchToken(entry.type,entry.id); if(!token) return;
  try{ localStorage.setItem(SELECTION_KEY,JSON.stringify({type:entry.type,id:entry.id,at:Date.now()})); }catch(_){}
  if(section && [...section.options].some(opt=>opt.value==='') && section.value!==''){ section.value=''; dispatchChange(section); }
  if(order && [...order.options].some(opt=>opt.value==='srs') && order.value!=='srs'){ order.value='srs'; dispatchChange(order); }
  search.value=token; search.dispatchEvent(new Event('input',{bubbles:true})); dispatchChange(search);
  window.setTimeout(()=>start.click(),380);
}

function clearTagFilter(){
  state.selected=null; try{ localStorage.removeItem(SELECTION_KEY); }catch(_){}
  const search=document.getElementById('rangeSearch'); if(search && /^(character|situation|grammar|function):/.test(search.value.trim())){ search.value=''; search.dispatchEvent(new Event('input',{bubbles:true})); dispatchChange(search); }
  renderCatalog(); renderDetail(null);
}

function normalizedText(value){ return String(value||'').replace(/\s+/g,' ').trim().toLowerCase(); }

function installStudyContext(){
  const en=document.getElementById('enText'); const card=document.getElementById('card'); if(!en || !card) return;
  let strip=document.getElementById('tagContextStrip');
  if(!strip){ strip=document.createElement('div'); strip.id='tagContextStrip'; strip.className='tag-context-strip'; strip.hidden=true; card.prepend(strip); }
  const itemByEn=new Map(state.items.map(item=>[normalizedText(item.en),item]));
  const update=()=>{
    const item=itemByEn.get(normalizedText(en.textContent)); strip.replaceChildren();
    if(!item){ strip.hidden=true; return; }
    const chars=Array.isArray(item.character_tags)?item.character_tags:[];
    for(const tag of chars){
      const profile=state.characterMap.get(tag.id); if(!profile) continue;
      const person=document.createElement('span'); person.className='tag-context-person'+(tag.certainty==='inferred_medium'?' is-related':'');
      const img=document.createElement('img'); img.alt=''; img.src=iconPath(profile); const name=document.createElement('span'); name.textContent=profile.name;
      person.append(img,name); if(tag.certainty==='inferred_medium'){ const related=document.createElement('span'); related.className='tag-context-related'; related.textContent='関連'; person.appendChild(related); } strip.appendChild(person);
    }
    const situations=(Array.isArray(item.situation_tags)?item.situation_tags:[]).filter(id=>id!=='general').slice(0,1);
    const grammars=(Array.isArray(item.grammar_tags)?item.grammar_tags:[]).slice(0,2);
    for(const id of situations){ const chip=document.createElement('span'); chip.className='tag-context-chip'; chip.textContent=labelForTag('situation',id); strip.appendChild(chip); }
    for(const id of grammars){ const chip=document.createElement('span'); chip.className='tag-context-chip'; chip.textContent=labelForTag('grammar',id); strip.appendChild(chip); }
    strip.hidden=!strip.childNodes.length;
  };
  new MutationObserver(update).observe(en,{subtree:true,childList:true,characterData:true}); update();
}

function installHomeRefresh(){
  const home=document.getElementById('homeView'); if(!home) return;
  new MutationObserver(()=>{ if(!home.hidden){ rebuildCatalog(); renderRecommendations(); renderCatalog(); if(state.selected){ const entry=(state.catalog?.[state.selected.type]||[]).find(x=>x.id===state.selected.id); if(entry) renderDetail(entry); } } }).observe(home,{attributes:true,attributeFilter:['hidden']});
}

async function init(){
  injectStyles(); const hub=createHub(); if(!hub) return;
  const savedTab=localStorage.getItem(TAB_KEY); if(TAG_TYPES.includes(savedTab)) state.activeType=savedTab;
  document.getElementById('tagLearningReset')?.addEventListener('click',clearTagFilter);
  try{
    const [itemsRes,charactersRes]=await Promise.all([fetch('./data/items.json',{cache:'no-cache'}),fetch('./data/characters.json',{cache:'no-cache'})]);
    if(!itemsRes.ok || !charactersRes.ok) throw new Error('tag data fetch failed');
    const items=await itemsRes.json(); const characterData=await charactersRes.json();
    state.items=Array.isArray(items)?items:[]; state.characters=Array.isArray(characterData?.characters)?characterData.characters:[]; state.characterMap=new Map(state.characters.map(profile=>[profile.id,profile]));
    const saved=loadJsonStorage(SELECTION_KEY,null); if(saved && TAG_TYPES.includes(saved.type) && saved.id){ state.selected={type:saved.type,id:saved.id}; state.activeType=saved.type; }
    render(); installStudyContext(); installHomeRefresh();
  }catch(error){
    const host=document.getElementById('tagCatalog'); if(host){ const msg=document.createElement('p'); msg.className='tag-hub__copy'; msg.textContent='タグデータを読み込めませんでした。オンライン状態で再読み込みしてください。'; host.replaceChildren(msg); }
    console.warn('Tag learning mode initialization failed',error);
  }
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init(),{once:true}); else init();
}
