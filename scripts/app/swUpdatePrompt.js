export function createSwUpdatePrompt(){
  let hasPromptedReload=false;
  let swRegistration=null;
  let swRegistrationPromise=null;
  let pendingUpdate=null;
  let promptDeps={};
  let lastViewState='home';
  let promptVisible=false;
  let hasDeferredNotice=false;

  const waitForControllerChange=()=>new Promise(resolve=>{
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once:true });
  });

  const shouldPromptReload=()=>!!navigator.serviceWorker.controller;

  const showUpdatePromptWithFooterDialog=({ toastFn=()=>{} }={})=>{
    const dialog=document.getElementById('footerInfoDialog');
    const title=document.getElementById('footerInfoDialogTitle');
    const body=document.getElementById('footerInfoDialogBody');
    if(!dialog || !body){
      toastFn('新しいバージョンがあります。ホーム画面で更新してください。', 2600);
      return Promise.resolve('later');
    }
    if(dialog.open && dialog.dataset.mode!=='sw-update'){
      toastFn('新しいバージョンがあります。画面を閉じた後に更新案内を表示します。', 2600);
      return Promise.resolve('later');
    }

    const previousMode=dialog.dataset.mode||'';
    const previousTitle=title ? title.textContent : '';
    const previousBody=body.innerHTML;
    const closeButton=dialog.querySelector('#footerInfoDialogClose');
    const previousCloseHidden=closeButton ? closeButton.hidden : false;

    dialog.dataset.mode='sw-update';
    if(title){
      title.textContent='更新があります';
    }

    body.innerHTML='';
    const message=document.createElement('p');
    message.textContent='新しいバージョンを適用できます。今すぐ更新しますか？';
    const actions=document.createElement('div');
    actions.className='info-dialog__actions';
    const nowButton=document.createElement('button');
    nowButton.type='button';
    nowButton.className='btn btn--primary';
    nowButton.textContent='今すぐ更新';
    const laterButton=document.createElement('button');
    laterButton.type='button';
    laterButton.className='btn';
    laterButton.textContent='学習後に更新';
    actions.append(nowButton, laterButton);
    body.append(message, actions);

    if(closeButton){
      closeButton.hidden=true;
    }

    return new Promise(resolve=>{
      let settled=false;
      const settle=(choice)=>{
        if(settled) return;
        settled=true;
        dialog.removeEventListener('cancel', onCancel);
        nowButton.removeEventListener('click', onNow);
        laterButton.removeEventListener('click', onLater);
        if(closeButton){
          closeButton.hidden=previousCloseHidden;
        }
        body.innerHTML=previousBody;
        if(title){
          title.textContent=previousTitle;
        }
        if(previousMode){
          dialog.dataset.mode=previousMode;
        }else{
          delete dialog.dataset.mode;
        }
        if(dialog.open){
          dialog.close();
        }
        resolve(choice);
      };
      const onNow=()=>settle('now');
      const onLater=()=>settle('later');
      const onCancel=(event)=>{
        event.preventDefault();
        settle('later');
      };

      nowButton.addEventListener('click', onNow);
      laterButton.addEventListener('click', onLater);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
    });
  };

  const promptToReload=(registration, worker, { toastFn=()=>{}, showUpdatePrompt }={})=>{
    if(!shouldPromptReload() || hasPromptedReload || promptVisible) return;
    promptVisible=true;

    const keepDeferred=()=>{
      promptVisible=false;
      hasPromptedReload=false;
    };

    Promise.resolve(typeof showUpdatePrompt==='function' ? showUpdatePrompt() : 'later')
      .then(choice=>{
        if(choice!=='now'){
          keepDeferred();
          return;
        }

        hasPromptedReload=true;
        promptVisible=false;
        pendingUpdate=null;
        hasDeferredNotice=false;

        if(registration.waiting){
          registration.waiting.postMessage({ type:'SKIP_WAITING' });
          waitForControllerChange().then(()=>window.location.reload());
        }else if(worker?.state==='activated'){
          window.location.reload();
        }
      })
      .catch(()=>{
        keepDeferred();
        toastFn('更新はホーム画面でいつでも適用できます。', 2600);
      });
  };

  const maybePromptPendingUpdate=()=>{
    if(!pendingUpdate || !shouldPromptReload() || hasPromptedReload) return;
    const { registration, worker }=pendingUpdate;
    const currentView=typeof promptDeps.getCurrentViewState==='function' ? promptDeps.getCurrentViewState() : 'home';
    if(currentView==='studying'){
      if(!hasDeferredNotice){
        hasDeferredNotice=true;
        promptDeps.toastFn?.('新しいバージョンがあります。学習後に更新できます。', 2600);
      }
      return;
    }
    promptToReload(registration, worker, promptDeps);
  };

  const handleServiceWorker=(registration, worker)=>{
    if(!worker) return;
    const onStateChange=()=>{
      if((worker.state==='installed' || worker.state==='activated') && shouldPromptReload()){
        pendingUpdate={ registration, worker };
        maybePromptPendingUpdate();
      }
    };
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  };

  function registerServiceWorker({ toastFn=()=>{}, getCurrentViewState=()=> 'home' }={}){
    if(!('serviceWorker' in navigator)) return;
    promptDeps={
      toastFn,
      getCurrentViewState,
      showUpdatePrompt:()=>showUpdatePromptWithFooterDialog({ toastFn }),
    };
    window.addEventListener('load', () => {
      swRegistrationPromise = navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          swRegistration = registration;
          handleServiceWorker(registration, registration.installing || registration.waiting);
          registration.addEventListener('updatefound', () => handleServiceWorker(registration, registration.installing));
          registration.update().catch(() => {});
          return registration;
        })
        .catch(() => {
          swRegistration=null;
          return null;
        });
    });
  }

  function handleViewStateChange(nextViewState){
    const next=nextViewState||'home';
    const didReturnHome=lastViewState!==next && next==='home';
    lastViewState=next;
    if(didReturnHome){
      maybePromptPendingUpdate();
    }
  }

  return {
    registerServiceWorker,
    handleViewStateChange,
    getRegistration:()=>swRegistration,
    getRegistrationPromise:()=>swRegistrationPromise,
  };
}
