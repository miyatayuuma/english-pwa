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
    .learning-choice__intro{margin:0;text-align:center;font-size:11px;line-height:1.55;opacity:.6}
    .learning-choice__section{display:grid;gap:8px}
    .learning-choice__section[hidden]{display:none!important}
    .learning-choice__title-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}
    .learning-choice__title{font-size:11px;font-weight:800;letter-spacing:.06em;opacity:.5}
    .learning-choice__current{font-size:10px;font-weight:850;color:#c7d2fe;white-space:nowrap}
    .learning-choice__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .learning-choice__button{position:relative;min-height:72px;border:1px solid rgba(148,163,184,.16);background:rgba(148,163,184,.05);color:inherit;border-radius:14px;padding:13px 9px 11px;font:inherit;font-size:13px;font-weight:760;cursor:pointer;text-align:center;line-height:1.25;transition:transform .08s ease,border-color .12s ease,background .12s ease,box-shadow .12s ease}
    .learning-choice__button:active{transform:scale(.985)}
    .learning-choice__button small{display:block;margin-top:5px;font-size:9px;line-height:1.35;font-weight:500;opacity:.52}
    .learning-choice__button .learning-choice__mark{display:inline-grid;place-items:center;width:17px;height:17px;margin-right:5px;border:1px solid rgba(148,163,184,.38);border-radius:50%;font-size:10px;vertical-align:-2px;color:transparent;background:transparent}
    .learning-choice__button.is-active{border:2px solid #818cf8;background:rgba(99,102,241,.24);box-shadow:0 0 0 3px rgba(99,102,241,.11)}
    .learning-choice__button.is-active .learning-choice__mark{border-color:#a5b4fc;background:#818cf8;color:#fff}
    .learning-choice__button.is-active .learning-choice__mark::after{content:'✓'}
    .learning-choice__button[data-recommended]::after{content:'基本';position:absolute;top:6px;right:7px;font-size:8px;font-weight:800;letter-spacing:.06em;padding:2px 5px;border-radius:999px;background:rgba(99,102,241,.2);color:#c7d2fe}
    .learning-choice__note{font-size:10px;line-height:1.5;opacity:.5;text-align:center;margin-top:1px}
    .learning-choice__footer{display:grid;gap:8px;padding-top:11px;border-top:1px solid rgba(148,163,184,.1)}
    .learning-choice__summary{text-align:center;font-size:12px;line-height:1.5;font-weight:750;color:#c7d2fe;min-height:18px}
    .learning-choice__start{width:100%;min-height:52px;border:0;border-radius:14px;background:#6366f1;color:#fff;font:inherit;font-size:15px;font-weight:850;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.2)}
    @media(max-width:430px){.learning-home-return span{display:none}.learning-home-return{padding-inline:10px}.learning-choice__grid{grid-template-columns:1fr}.learning-choice__button{min-height:60px}.learning-choice__title-row{align-items:flex-end}.learning-choice__current{font-size:9px}}
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

function storedConfigMethod(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function currentMethod(){
  try{
    const preferred=localStorage.getItem(PREF_METHOD_KEY);
    if(preferred==='compose'||preferred==='read') return preferred;
    return storedConfigMethod();
  }catch(_){ return 'read'; }
}

function methodLabel(method){
  if(method==='compose') return '並べ替えチャレンジ';
  if(method==='vocabulary') return '単語チャレンジ';
  return '穴あきチャレンジ';
}

function courseLabel(course){
  if(course==='tag') return 'テーマから';
  if(course==='explore') return '範囲から';
  return 'おまかせ';
}

function syncPrimaryCta(){
  const cta=document.getElementById('startStudyCta');
  if(!cta) return;
  cta.textContent=currentMethod()==='compose'?'並べ替えチャレンジを始める':'今日のチャレンジを始める';
}

function persistStudyMethod(next){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    cfg.studyMode=next;
    localStorage.setItem('appConfigV3',JSON.stringify(cfg));
  }catch(_){}
}

function applyStudyMethod(method,{remember=true}={}){
  const next=method==='compose'?'compose':'read';
  if(remember) localStorage.setItem(PREF_METHOD_KEY,next);

  // main.js owns the live CFG object. Its settings-save handler is the public
  // path that updates that runtime object. Open settings first so the form is
  // hydrated and the save button is enabled, then change only studyMode.
  let runtimeSynced=false;
  const cfgButton=document.getElementById('btnCfg');
  const cfgSave=document.getElementById('cfgSave');
  if(cfgButton&&cfgSave){
    try{
      cfgButton.click();
      const radios=[...document.querySelectorAll('input[name="cfgStudyMode"]')];
      if(radios.length){
        radios.forEach(input=>{ input.checked=input.value===next; });
        if(cfgSave.disabled) cfgSave.disabled=false;
        cfgSave.click();
        runtimeSynced=true;
      }
    }catch(_){ runtimeSynced=false; }
  }

  // Persistence is kept independent from the settings form so an unrelated
  // validation problem cannot make the next launch revert to the old game.
  persistStudyMethod(next);

  // If the runtime form is unavailable, record a reload request. This is only
  // a fallback for unusual partial-load states; normal starts stay seamless.
  if(!runtimeSynced){
    try{ sessionStorage.setItem('englishPwaModeReloadNeeded','1'); }catch(_){}
  }else{
    try{ sessionStorage.removeItem('englishPwaModeReloadNeeded'); }catch(_){}
  }

  syncPrimaryCta();
  try{ document.dispatchEvent(new CustomEvent('english-pwa:study-method-changed',{detail:{method:next}})); }catch(_){}
  return {method:next,runtimeSynced};
}

function restorePreferredMethod(){
  const preferred=localStorage.getItem(PREF_METHOD_KEY);
  if(preferred==='compose'||preferred==='read'){
    if(storedConfigMethod()!==preferred) applyStudyMethod(preferred,{remember:false});
    else syncPrimaryCta();
  }else syncPrimaryCta();
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
    if(button){ button.click(); return true; }
    await sleep(80);
  }
  return false;
}

function pendingMethod(dialog){ return dialog?.dataset?.pendingMethod||currentMethod(); }
function pendingCourse(dialog){ return dialog?.dataset?.pendingCourse||'auto'; }

function setPendingMethod(dialog,method){
  const next=['read','compose','vocabulary'].includes(method)?method:'read';
  dialog.dataset.pendingMethod=next;
  refreshChoiceState(dialog);
  try{ navigator.vibrate?.(14); }catch(_){}
}

function setPendingCourse(dialog,course){
  dialog.dataset.pendingCourse=['auto','tag','explore'].includes(course)?course:'auto';
  refreshChoiceState(dialog);
  try{ navigator.vibrate?.(10); }catch(_){}
}

function refreshChoiceState(dialog){
  if(!dialog) return;
  const method=pendingMethod(dialog);
  const course=pendingCourse(dialog);
  dialog.querySelectorAll('[data-method]').forEach(button=>{
    const active=button.dataset.method===method;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
  dialog.querySelectorAll('[data-course]').forEach(button=>{
    const active=button.dataset.course===course;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
  const methodCurrent=dialog.querySelector('[data-method-current]');
  if(methodCurrent) methodCurrent.textContent=`選択中：${methodLabel(method)}`;
  const courseCurrent=dialog.querySelector('[data-course-current]');
  if(courseCurrent) courseCurrent.textContent=`選択中：${courseLabel(course)}`;
  const courseSection=dialog.querySelector('[data-course-section]');
  if(courseSection) courseSection.hidden=method==='vocabulary';
  const summary=dialog.querySelector('.learning-choice__summary');
  const start=dialog.querySelector('.learning-choice__start');
  if(summary){
    summary.textContent=method==='vocabulary'
      ? `${methodLabel(method)}を選択中`
      : `${methodLabel(method)} × ${courseLabel(course)}`;
  }
  if(start){
    if(method==='vocabulary') start.textContent='単語チャレンジを開く';
    else if(course==='tag') start.textContent='テーマを選ぶ';
    else if(course==='explore') start.textContent='範囲を選ぶ';
    else start.textContent=`${methodLabel(method)}で遊ぶ`;
  }
}

async function executeChoice(dialog,nav){
  const method=pendingMethod(dialog);
  const course=pendingCourse(dialog);
  if(method==='vocabulary'){
    dialog.close();
    await openVocabulary();
    return;
  }
  const applied=applyStudyMethod(method);
  dialog.close();

  if(!applied.runtimeSynced){
    try{
      sessionStorage.setItem('englishPwaPendingGameAction',course);
      location.reload();
      return;
    }catch(_){}
  }

  if(course==='tag'){
    if(typeof globalThis.__OPEN_ENGLISH_TAG_BROWSER__==='function'){
      globalThis.__OPEN_ENGLISH_TAG_BROWSER__();
      return;
    }
    getLegacyButtons(nav).tags?.click();
    return;
  }
  if(course==='explore'){
    getLegacyButtons(nav).explore?.click();
    return;
  }
  setTimeout(()=>document.getElementById('startStudyCta')?.click(),30);
}

function makeChoiceButton({method='',course='',label,detail,recommended=false}){
  const data=method?`data-method="${method}"`:`data-course="${course}"`;
  const rec=recommended?' data-recommended':'';
  return `<button type="button" class="learning-choice__button" ${data} aria-pressed="false"${rec}><span class="learning-choice__mark" aria-hidden="true"></span>${label}<small>${detail}</small></button>`;
}

function makeDialog(nav){
  let dialog=document.getElementById('learningChoiceDialog');
  if(dialog) return dialog;
  dialog=document.createElement('dialog');
  dialog.id='learningChoiceDialog';
  dialog.className='focus-dialog';
  dialog.innerHTML=`<section class="focus-sheet"><header class="focus-sheet__head"><h2>遊び方を選ぶ</h2><button class="focus-sheet__close" type="button" aria-label="閉じる">×</button></header><div class="focus-sheet__body"><div class="learning-choice"><p class="learning-choice__intro">ゲームとステージを選んで、最後の大きいボタンからスタートします。</p><section class="learning-choice__section"><div class="learning-choice__title-row"><div class="learning-choice__title">ゲーム</div><div class="learning-choice__current" data-method-current></div></div><div class="learning-choice__grid">${makeChoiceButton({method:'read',label:'穴あきチャレンジ',detail:'一部が隠れた英文を手掛かりに、全文を言えたらクリア',recommended:true})}${makeChoiceButton({method:'compose',label:'並べ替えチャレンジ',detail:'語句ブロックを並べて、全文を言えたらクリア'})}${makeChoiceButton({method:'vocabulary',label:'単語チャレンジ',detail:'日本語を見て、英語をすばやく言えたらクリア'})}</div><div class="learning-choice__note">ここでは選ぶだけ。ゲームはまだ始まりません。</div></section><section class="learning-choice__section" data-course-section><div class="learning-choice__title-row"><div class="learning-choice__title">ステージ</div><div class="learning-choice__current" data-course-current></div></div><div class="learning-choice__grid">${makeChoiceButton({course:'auto',label:'おまかせ',detail:'今やるカードを自動でミックス'})}${makeChoiceButton({course:'tag',label:'テーマから',detail:'キャラ・場面・文法・表現から選ぶ'})}${makeChoiceButton({course:'explore',label:'範囲から',detail:'セクションや進み具合から選ぶ'})}</div></section><div class="learning-choice__footer"><div class="learning-choice__summary"></div><button type="button" class="learning-choice__start">穴あきチャレンジで遊ぶ</button></div></div></div></section>`;
  document.body.appendChild(dialog);
  dialog.querySelector('.focus-sheet__close')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  dialog.querySelectorAll('[data-method]').forEach(button=>button.addEventListener('click',()=>setPendingMethod(dialog,button.dataset.method)));
  dialog.querySelectorAll('[data-course]').forEach(button=>button.addEventListener('click',()=>setPendingCourse(dialog,button.dataset.course)));
  dialog.querySelector('.learning-choice__start')?.addEventListener('click',()=>executeChoice(dialog,nav));
  return dialog;
}

function prepareDialog(dialog){
  dialog.dataset.pendingMethod=currentMethod();
  dialog.dataset.pendingCourse='auto';
  refreshChoiceState(dialog);
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
    button.textContent='遊び方を選ぶ';
    button.addEventListener('click',()=>{
      const dialog=makeDialog(nav);
      prepareDialog(dialog);
      dialog.showModal();
    });
    nav.insertBefore(button,nav.firstChild);
  }
  syncPrimaryCta();
}

function resumePendingAction(nav){
  let action='';
  try{
    action=sessionStorage.getItem('englishPwaPendingGameAction')||'';
    sessionStorage.removeItem('englishPwaPendingGameAction');
    sessionStorage.removeItem('englishPwaModeReloadNeeded');
  }catch(_){}
  if(!action) return;
  setTimeout(()=>{
    if(action==='tag'){
      if(typeof globalThis.__OPEN_ENGLISH_TAG_BROWSER__==='function') globalThis.__OPEN_ENGLISH_TAG_BROWSER__();
      else getLegacyButtons(nav).tags?.click();
    }else if(action==='explore'){
      getLegacyButtons(nav).explore?.click();
    }else{
      document.getElementById('startStudyCta')?.click();
    }
  },120);
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
  resumePendingAction(nav);
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init(),{once:true});
  else init();
}