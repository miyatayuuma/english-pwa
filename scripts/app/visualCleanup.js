function injectCleanupStyles(){
  if(document.getElementById('visualCleanupStyles')) return;
  const style=document.createElement('style');
  style.id='visualCleanupStyles';
  style.textContent=`
    body.focus-home-view #homeView>.goal-row,
    body.focus-home-view #homeView>#dailyOverviewCard,
    body.focus-home-view #homeView>#personalPlanSummary,
    body.focus-home-view #homeView>#rangeBar{display:none!important}

    body.focus-home-view #app>header{
      position:absolute!important;
      top:0;left:0;right:0;
      min-height:0!important;
      padding:9px 11px!important;
      border:0!important;
      background:transparent!important;
      box-shadow:none!important;
      pointer-events:none;
      z-index:20;
    }
    body.focus-home-view #app>header .grow{display:none!important}
    body.focus-home-view #app>header #btnCfg{
      margin-left:auto;
      pointer-events:auto;
      background:rgba(16,21,34,.72);
      border-color:rgba(148,163,184,.18);
      backdrop-filter:blur(8px);
    }
    body.focus-home-view main{padding-top:0!important}
    body.focus-home-view .home-cta-wrap.focus-home{margin-top:clamp(76px,11vh,118px)!important}

    body.focus-home-view #app>footer{
      display:flex!important;
      justify-content:center;
      min-height:0;
      padding:5px 10px calc(6px + env(safe-area-inset-bottom,0px))!important;
      border-top:0!important;
      background:transparent!important;
      box-shadow:none!important;
    }
    body.focus-home-view #app>footer>progress,
    body.focus-home-view #app>footer>.footer-info,
    body.focus-home-view #app>footer>.grow,
    body.focus-home-view #app>footer>.version-tag{display:none!important}
    body.focus-home-view #app>footer .footer-trust-links{
      grid-area:auto!important;
      display:flex!important;
      justify-content:center;
      gap:10px;
      max-width:none;
      overflow:visible;
      opacity:.3;
      white-space:nowrap;
    }
    body.focus-home-view #app>footer .footer-trust-links a{font-size:9px}

    @media(max-width:430px){
      body.focus-home-view .home-cta-wrap.focus-home{margin-top:clamp(70px,9vh,96px)!important}
    }
  `;
  document.head.appendChild(style);
}

function removeClosedLegacyTagDialog(){
  const legacy=document.getElementById('focusTagDialog');
  if(legacy&&!legacy.open) legacy.remove();
}

function init(){
  injectCleanupStyles();
  removeClosedLegacyTagDialog();
  const observer=new MutationObserver(()=>removeClosedLegacyTagDialog());
  observer.observe(document.body,{childList:true});
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}
