function storedMethod(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
}

function preferredMethod(){
  try{
    const value=localStorage.getItem('preferredSentenceMethodV1');
    return value==='compose'||value==='read'?value:'';
  }catch(_){ return ''; }
}

const BOOT_METHOD=typeof localStorage!=='undefined'?storedMethod():'read';

function pendingMethod(dialog){
  const value=dialog?.dataset?.pendingMethod;
  return value==='compose'?'compose':value==='vocabulary'?'vocabulary':'read';
}

function pendingCourse(dialog){
  const value=dialog?.dataset?.pendingCourse;
  return ['tag','explore','auto'].includes(value)?value:'auto';
}

function persistMethod(method){
  if(method!=='read'&&method!=='compose') return;
  try{
    localStorage.setItem('preferredSentenceMethodV1',method);
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    cfg.studyMode=method;
    localStorage.setItem('appConfigV3',JSON.stringify(cfg));
  }catch(_){}
}

function injectCleanupStyles(){
  if(document.getElementById('gameModeBridgeStyles')) return;
  const style=document.createElement('style');
  style.id='gameModeBridgeStyles';
  style.textContent=`
    .learning-choice__intro,
    .learning-choice__note,
    #composeGuide>h4,
    #composeNote{display:none!important}
  `;
  document.head.appendChild(style);
}

function clickExplore(){
  const nav=document.getElementById('focusHomeNav');
  const button=[...(nav?.querySelectorAll('button')||[])].find(node=>node.textContent?.trim()==='探す');
  if(button){button.click();return true;}
  return false;
}

function runCourse(course,attempt=0){
  if(course==='tag'){
    if(typeof globalThis.__OPEN_ENGLISH_TAG_BROWSER__==='function'){
      globalThis.__OPEN_ENGLISH_TAG_BROWSER__();
      return true;
    }
  }else if(course==='explore'){
    if(clickExplore()) return true;
  }else{
    const cta=document.getElementById('startStudyCta');
    if(cta){cta.click();return true;}
  }
  if(attempt<20){
    setTimeout(()=>runCourse(course,attempt+1),80);
  }
  return false;
}

function handleStartCapture(event){
  const start=event.target?.closest?.('.learning-choice__start');
  if(!start) return;
  const dialog=start.closest('#learningChoiceDialog');
  if(!dialog) return;
  const method=pendingMethod(dialog);
  if(method==='vocabulary') return;

  // Sentence game launches are owned here. This prevents the older menu code
  // from opening the settings modal and clicking Save as an indirect way to
  // switch modes, which could trigger unrelated validation and side effects.
  event.preventDefault();
  event.stopImmediatePropagation();

  const course=pendingCourse(dialog);
  persistMethod(method);
  try{dialog.close();}catch(_){}

  if(method!==BOOT_METHOD){
    try{sessionStorage.setItem('englishPwaPendingGameAction',course);}catch(_){}
    location.reload();
    return;
  }
  setTimeout(()=>runCourse(course),0);
}

function consumePendingAction(){
  let action='';
  try{
    action=sessionStorage.getItem('englishPwaPendingGameAction')||'';
    if(action) sessionStorage.removeItem('englishPwaPendingGameAction');
    sessionStorage.removeItem('englishPwaModeReloadNeeded');
  }catch(_){}
  if(action) setTimeout(()=>runCourse(action),80);
}

function init(){
  injectCleanupStyles();
  document.addEventListener('click',handleStartCapture,true);
  consumePendingAction();
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}

export { storedMethod, preferredMethod, pendingMethod, pendingCourse };
