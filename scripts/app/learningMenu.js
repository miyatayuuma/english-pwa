const PREF_METHOD_KEY='preferredSentenceMethodV1';

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function injectStyles(){
  if(document.getElementById('learningMenuStyles')) return;
  const style=document.createElement('style');
  style.id='learningMenuStyles';
  style.textContent=`
    .focus-home-nav.learning-nav{grid-template-columns:1fr 1fr!important}
    .learning-home-return{display:none;border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.08);color:inherit;border-radius:11px;padding:8px 10px;font:inherit;font-size:12px;font-weight:750;cursor:pointer;white-space:nowrap;margin-right:8px}
    body.focus-study-view .learning-home-return,body.focus-review-view .learning-home-return{display:inline-flex;align-items:center;gap:5px}
    .learning-choice{display:grid;gap:16px}
    .learning-choice__section{display:grid;gap:8px}
    .learning-choice__title{font-size:11px;font-weight:800;letter-spacing:.06em;opacity:.48;padding-left:2px}
    .learning-choice__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .learning-choice__grid--course{grid-template-columns:repeat(3,minmax(0,1fr))}
    .learning-choice__button{min-height:64px;border:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.05);color:inherit;border-radius:14px;padding:10px 8px;font:inherit;font-size:13px;font-weight:760;cursor:pointer;text-align:center}
    .learning-choice__button small{display:block;margin-top:4px;font-size:9px;font-weight:500;opacity:.45}
    .learning-choice__button.is-active{border-color:rgba(129,140,248,.58);background:rgba(99,102,241,.13)}
    @media(max-width:430px){.learning-home-return span{display:none}.learning-home-return{padding-inline:10px}.learning-choice__grid--course{grid-template-columns:1fr}.learning-choice__button{min-height:56px}}
  `;
  document.head.appendChild(style);
}

async function waitForNav(timeout=12000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    const nav=document.getElementById('focusHomeNav');
    if(nav) return nav;
    await sleep(80);
  }
  return null;
}

function currentMethod(){
  try{
    const preferred=localStorage.getItem(PREF_METHOD_KEY);
    if(preferred==='compose'||preferred==='read') return preferred;
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function applyStudyMethod(method,{remember=true}={}){
  const next=method==='compose'?'compose':'read';
  if(remember) localStorage.setItem(PREF_METHOD_KEY,next);
  const radios=[...document.querySelectorAll('input[name="cfgStudyMode"]')];
  if(radios.length){
    radios.forEach(input=>{ input.checked=input.value===next; });
    document.getElementById('cfgSave')?.click();
  }else{
    try{
      const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
      cfg.studyMode=next;
      localStorage.setItem('appConfigV3',JSON.stringify(cfg));
    }catch(_){}
  }
  return next;
}

function restorePreferredMethod(){
  const preferred=localStorage.getItem(PREF_METHOD_KEY);
  if(preferred==='compose'||preferred==='read') applyStudyMethod(preferred,{remember:false});
}

function returnHome(){
  const finish=document.getElementById('reviewActionFinish');
  if(finish){ finish.click(); return; }
  const home=document.getElementById('homeView');
  const study=document.getElementById('studyView');
  const review=document.getElementById('reviewCompleteView');
  if(home) home.hidden=false;
  if(study) study.hidden=true;
  if(review) review.hidden=true;
}

function setupHomeReturn(){
  if(document.getElementById('learningHomeReturn')) return;
  const header=document.querySelector('#app>header');
  const firstStat=header?.querySelector('.stat');
  if(!header) return;
  const button=document.createElement('button');
  button.id='learningHomeReturn';
  button.className='learning-home-return';
  button.type='button';
  button.setAttribute('aria-label','ホームに戻る');
  button.innerHTML='← <span>ホーム</span>';
  button.addEventListener('click',returnHome);
  header.insertBefore(button,firstStat||header.firstChild);
}

function getLegacyButtons(nav){
  const buttons=[...nav.querySelectorAll('button')];
  const tags=buttons.find(btn=>btn.textContent?.trim()==='キャラ・タグ')||null;
  const explore=buttons.find(btn=>btn.textContent?.trim()==='探す')||null;
  const vocab=document.getElementById('openVocabularyMode');
  return {tags,explore,vocab};
}

async function openVocabulary(){
  for(let i=0;i<25;i+=1){
    const button=document.getElementById('openVocabularyMode');
    if(button){ button.click(); return; }
    await sleep(80);
  }
}

function startSentence(method){
  applyStudyMethod(method);
  document.getElementById('learningChoiceDialog')?.close();
  setTimeout(()=>document.getElementById('startStudyCta')?.click(),40);
}

function makeDialog(nav){
  let dialog=document.getElementById('learningChoiceDialog');
  if(dialog) return dialog;
  dialog=document.createElement('dialog');
  dialog.id='learningChoiceDialog';
  dialog.className='focus-dialog';
  dialog.innerHTML=`<section class="focus-sheet"><header class="focus-sheet__head"><h2>学び方・コース</h2><button class="focus-sheet__close" type="button" aria-label="閉じる">×</button></header><div class="focus-sheet__body"><div class="learning-choice"><section class="learning-choice__section"><div class="learning-choice__title">学び方</div><div class="learning-choice__grid"><button type="button" class="learning-choice__button" data-method="read">例文・音読<small>英文を使って発話</small></button><button type="button" class="learning-choice__button" data-method="compose">整序ヒント<small>語順の手掛かりから発話</small></button><button type="button" class="learning-choice__button" data-method="vocabulary">単語・熟語<small>日本語から即答</small></button></div></section><section class="learning-choice__section"><div class="learning-choice__title">例文コース</div><div class="learning-choice__grid learning-choice__grid--course"><button type="button" class="learning-choice__button" data-course="auto">おまかせ</button><button type="button" class="learning-choice__button" data-course="tag">キャラ・タグ</button><button type="button" class="learning-choice__button" data-course="explore">セクション・状態</button></div></section></div></div></section>`;
  document.body.appendChild(dialog);
  dialog.querySelector('.focus-sheet__close')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  dialog.querySelector('[data-method="read"]')?.addEventListener('click',()=>startSentence('read'));
  dialog.querySelector('[data-method="compose"]')?.addEventListener('click',()=>startSentence('compose'));
  dialog.querySelector('[data-method="vocabulary"]')?.addEventListener('click',()=>{dialog.close();openVocabulary();});
  dialog.querySelector('[data-course="auto"]')?.addEventListener('click',()=>{dialog.close();setTimeout(()=>document.getElementById('startStudyCta')?.click(),20);});
  dialog.querySelector('[data-course="tag"]')?.addEventListener('click',()=>{dialog.close();getLegacyButtons(nav).tags?.click();});
  dialog.querySelector('[data-course="explore"]')?.addEventListener('click',()=>{dialog.close();getLegacyButtons(nav).explore?.click();});
  return dialog;
}

function refreshMethodState(dialog){
  const method=currentMethod();
  dialog.querySelectorAll('[data-method]').forEach(button=>button.classList.toggle('is-active',button.dataset.method===method));
}

function syncNav(nav){
  nav.classList.add('learning-nav');
  const {tags,vocab}=getLegacyButtons(nav);
  if(tags) tags.hidden=true;
  if(vocab) vocab.hidden=true;
  let button=document.getElementById('openLearningChoice');
  if(!button){
    button=document.createElement('button');
    button.id='openLearningChoice';
    button.type='button';
    button.textContent='学び方・コース';
    button.addEventListener('click',()=>{const dialog=makeDialog(nav);refreshMethodState(dialog);dialog.showModal();});
    nav.insertBefore(button,nav.firstChild);
  }
}

async function init(){
  injectStyles();
  setupHomeReturn();
  const nav=await waitForNav();
  if(!nav) return;
  restorePreferredMethod();
  syncNav(nav);
  const observer=new MutationObserver(()=>syncNav(nav));
  observer.observe(nav,{childList:true,subtree:false});
  makeDialog(nav);
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init(),{once:true});
  else init();
}
