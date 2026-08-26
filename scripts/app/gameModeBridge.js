function storedMethod(){
  try{
    const cfg=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    return cfg?.studyMode==='compose'?'compose':'read';
  }catch(_){ return 'read'; }
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

function handleStartCapture(event){
  const start=event.target?.closest?.('.learning-choice__start');
  if(!start) return;
  const dialog=start.closest('#learningChoiceDialog');
  if(!dialog) return;
  const method=pendingMethod(dialog);
  if(method==='vocabulary') return;

  persistMethod(method);
  if(method===BOOT_METHOD) return;

  // main.js reads studyMode into its in-memory CFG during boot. When the game
  // changes, start only after one reload so the very first card uses the new
  // mode instead of briefly starting with the previous one.
  event.preventDefault();
  event.stopImmediatePropagation();
  try{
    sessionStorage.setItem('englishPwaPendingGameAction',pendingCourse(dialog));
  }catch(_){}
  try{ dialog.close(); }catch(_){}
  location.reload();
}

function init(){
  injectCleanupStyles();
  document.addEventListener('click',handleStartCapture,true);
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}

export { storedMethod, pendingMethod, pendingCourse };
