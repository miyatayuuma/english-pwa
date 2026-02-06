export function createSwUpdatePrompt(){
  let hasPromptedReload=false;
  let swRegistration=null;
  let swRegistrationPromise=null;

  const waitForControllerChange=()=>new Promise(resolve=>{
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once:true });
  });

  const shouldPromptReload=()=>!!navigator.serviceWorker.controller;

  const promptToReload=(registration, worker, { toastFn=()=>{} }={})=>{
    if(!shouldPromptReload() || hasPromptedReload) return;
    hasPromptedReload=true;

    const message='新バージョンがあります。再読み込みしますか？';
    toastFn(message, 3200);
    const approved=window.confirm(message);
    if(!approved) return;

    if(registration.waiting){
      registration.waiting.postMessage({ type:'SKIP_WAITING' });
      waitForControllerChange().then(()=>window.location.reload());
    }else if(worker?.state==='activated'){
      window.location.reload();
    }
  };

  const handleServiceWorker=(registration, worker, deps)=>{
    if(!worker) return;
    const onStateChange=()=>{
      if((worker.state==='installed' || worker.state==='activated') && shouldPromptReload()){
        promptToReload(registration, worker, deps);
      }
    };
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  };

  function registerServiceWorker({ toastFn=()=>{} }={}){
    if(!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      swRegistrationPromise = navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          swRegistration = registration;
          handleServiceWorker(registration, registration.installing || registration.waiting, { toastFn });
          registration.addEventListener('updatefound', () => handleServiceWorker(registration, registration.installing, { toastFn }));
          registration.update().catch(() => {});
          return registration;
        })
        .catch(() => {
          swRegistration=null;
          return null;
        });
    });
  }

  return {
    registerServiceWorker,
    getRegistration:()=>swRegistration,
    getRegistrationPromise:()=>swRegistrationPromise,
  };
}
