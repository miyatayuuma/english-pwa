const CONFIG_KEY='appConfigV3';
const PREF_METHOD_KEY='preferredSentenceMethodV1';

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function storedMethod(){
  try{
    const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

const BOOT_METHOD=typeof localStorage!=='undefined'?storedMethod():'read';

function persistMethod(method){
  if(method!=='read'&&method!=='compose') return;
  try{
    const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');
    cfg.studyMode=method;
    localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));
    localStorage.setItem(PREF_METHOD_KEY,method);
  }catch(_){}
}

function injectStyles(){
  if(document.getElementById('learningMenuStyles')) return;
  const style=document.createElement('style');
  style.id='learningMenuStyles';
  style.textContent=`
    .focus-home-nav.learning-nav{grid-template-columns:1fr 1fr!important}
    .learning-home-return{display:none;border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.08);color:inherit;border-radius:11px;padding:8px 10px;font:inherit;font-size:12px;font-weight:750;cursor:pointer;white-space:nowrap;margin-right:8px}
    body.focus-study-view .learning-home-return,body.focus-review-view .learning-home-return{display:inline-flex;align-items:center;gap:5px}
    .learning-choice{display:grid;gap:16px}
    .learning-choice__section{display:grid;gap:8px}.learning-choice__section[hidden]{display:none!important}
    .learning-choice__title-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}
    .learning-choice__title{font-size:11px;font-weight:800;letter-spacing:.06em;opacity:.5}
    .learning-choice__current{font-size:10px;font-weight:850;color:#c7d2fe;white-space:nowrap}
    .learning-choice__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .learning-choice__button{position:relative;min-height:72px;border:1px solid rgba(148,163,184,.16);background:rgba(148,163,184,.05);color:inherit;border-radius:14px;padding:13px 9px 11px;font:inherit;font-size:13px;font-weight:760;cursor:pointer;text-align:center;line-height:1.25;transition:transform .08s ease,border-color .12s ease,background .12s ease,box-shadow .12s ease}
    .learning-choice__button:active{transform:scale(.985)}
    .learning-choice__button small{display:block;margin-top:5px;font-size:9px;line-height:1.35;font-weight:500;opacity:.52}
    .learning-choice__mark{display:inline-grid;place-items:center;width:17px;height:17px;margin-right:5px;border:1px solid rgba(148,163,184,.38);border-radius:50%;font-size:10px;vertical-align:-2px;color:transparent;background:transparent}
    .learning-choice__button.is-active{border:2px solid #818cf8;background:rgba(99,102,241,.24);box-shadow:0 0 0 3px rgba(99,102,241,.11)}
    .learning-choice__button.is-active .learning-choice__mark{border-color:#a5b4fc;background:#818cf8;color:#fff}.learning-choice__button.is-active .learning-choice__mark::after{content:'✓'}
    .learning-choice__button[data-recommended]::after{content:'基本';position:absolute;top:6px;right:7px;font-size:8px;font-weight:800;letter-spacing:.06em;padding:2px 5px;border-radius:999px;background:rgba(99,102,241,.2);color:#c7d2fe}
    .learning-choice__footer{display:grid;gap:8px;padding-top:11px;border-top:1px solid rgba(148,163,184,.1)}
    .learning-choice__summary{text-align:center;font-size:12px;line-height:1.5;font-weight:750;color:#c7d2fe;min-height:18px}
    .learning-choice__start{width:100%;min-height:52px;border:0;border-radius:14px;background:#6366f1;color:#fff;font:inherit;font-size:15px;font-weight:850;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.2)}
    #composeGuide>h4,#composeNote{display:none!important}
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
  cta.textContent=storedMethod()==='compose'?'並べ替えチャレンジを始める':'今日のチャレンジを始める';
}

function returnHome(){
  const finish=document.getElementById('reviewActionFinish');
  if(finish){finish.click();return;}
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
  if(!header) return;
  const firstStat=header.querySelector('.stat');
  const button=document.createElement('button');
  button.id='learningHomeReturn';
  button.className='learning-home-return';
  button.type='button';
  button.setAttribute('aria-label','ホームに戻る');
  button.innerHTML='← <span>ホーム</span>';
  button.addEventListener('click',returnHome);
  header.insertBefore(button,firstStat||header.firstChild);
}

async function openVocabulary(){
  for(let i=0;i<25;i+=1){
    const button=document.getElementById('openVocabularyMode');
    if(button){button.click();return true;}
    await sleep(80);
  }
  return false;
}

function clickExplore(nav){
  const button=[...(nav?.querySelectorAll('button')||[])].find(node=>node.textContent?.trim()==='探す');
  if(button){button.click();return true;}
  return false;
}

function runCourse(course,nav,attempt=0){
  if(course==='tag'){
    if(typeof globalThis.__OPEN_ENGLISH_TAG_BROWSER__==='function'){
      globalThis.__OPEN_ENGLISH_TAG_BROWSER__();
      return true;
    }
  }else if(course==='explore'){
    if(clickExplore(nav)) return true;
  }else{
    const cta=document.getElementById('startStudyCta');
    if(cta){cta.click();return true;}
  }
  if(attempt<25) setTimeout(()=>runCourse(course,nav,attempt+1),80);
  return false;
}

function pendingMethod(dialog){
  const value=dialog?.dataset?.pendingMethod;
  return value==='compose'?'compose':value==='vocabulary'?'vocabulary':'read';
}
function pendingCourse(dialog){
  const value=dialog?.dataset?.pendingCourse;
  return ['auto','tag','explore'].includes(value)?value:'auto';
}

function setPendingMethod(dialog,method){
  dialog.dataset.pendingMethod=['read','compose','vocabulary'].includes(method)?method:'read';
  refreshChoiceState(dialog);
  try{navigator.vibrate?.(14);}catch(_){}
}
function setPendingCourse(dialog,course){
  dialog.dataset.pendingCourse=['auto','tag','explore'].includes(course)?course:'auto';
  refreshChoiceState(dialog);
  try{navigator.vibrate?.(10);}catch(_){}
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
  if(summary) summary.textContent=method==='vocabulary'?methodLabel(method):`${methodLabel(method)} × ${courseLabel(course)}`;
  const start=dialog.querySelector('.learning-choice__start');
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

  persistMethod(method);
  dialog.close();
  if(method!==BOOT_METHOD){
    try{sessionStorage.setItem('englishPwaPendingGameAction',course);}catch(_){}
    location.reload();
    return;
  }
  syncPrimaryCta();
  setTimeout(()=>runCourse(course,nav),0);
}

function choiceButton({method='',course='',label,detail,recommended=false}){
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
  dialog.innerHTML=`<section class="focus-sheet"><header class="focus-sheet__head"><h2>遊び方を選ぶ</h2><button class="focus-sheet__close" type="button" aria-label="閉じる">×</button></header><div class="focus-sheet__body"><div class="learning-choice"><section class="learning-choice__section"><div class="learning-choice__title-row"><div class="learning-choice__title">ゲーム</div><div class="learning-choice__current" data-method-current></div></div><div class="learning-choice__grid">${choiceButton({method:'read',label:'穴あきチャレンジ',detail:'隠れた部分を補って全文を言う',recommended:true})}${choiceButton({method:'compose',label:'並べ替えチャレンジ',detail:'語句ブロックから全文を組み立てる'})}${choiceButton({method:'vocabulary',label:'単語チャレンジ',detail:'日本語から英語をすばやく言う'})}</div></section><section class="learning-choice__section" data-course-section><div class="learning-choice__title-row"><div class="learning-choice__title">ステージ</div><div class="learning-choice__current" data-course-current></div></div><div class="learning-choice__grid">${choiceButton({course:'auto',label:'おまかせ',detail:'今やるカードを自動で選ぶ'})}${choiceButton({course:'tag',label:'テーマから',detail:'キャラ・場面・文法・表現から選ぶ'})}${choiceButton({course:'explore',label:'範囲から',detail:'セクションや進み具合から選ぶ'})}</div></section><div class="learning-choice__footer"><div class="learning-choice__summary"></div><button type="button" class="learning-choice__start">穴あきチャレンジで遊ぶ</button></div></div></div></section>`;
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
  dialog.dataset.pendingMethod=storedMethod();
  dialog.dataset.pendingCourse='auto';
  refreshChoiceState(dialog);
}

function syncNav(nav){
  nav.classList.add('learning-nav');
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
    if(action) sessionStorage.removeItem('englishPwaPendingGameAction');
    sessionStorage.removeItem('englishPwaModeReloadNeeded');
  }catch(_){}
  if(action) setTimeout(()=>runCourse(action,nav),100);
}

async function init(){
  injectStyles();
  setupHomeReturn();
  const nav=await waitForNav();
  if(!nav) return;
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

export { storedMethod, pendingMethod, pendingCourse };
