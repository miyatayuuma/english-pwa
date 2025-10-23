import {
  STORAGE_KEYS,
  loadJson,
  saveJson,
  loadString,
  saveString,
  loadNumber,
  saveNumber,
  remove
} from '../storage/local.js';
import { createDictionaryClient } from '../api/dictionary.js';
import {
  spanify,
  toks
} from '../utils/text.js';
import {
  toast,
  triggerMilestoneEffect
} from '../ui/milestones.js';
import {
  recordStudyProgress,
  updateNotificationUi,
  initNotificationSystem
} from '../state/studyLog.js';
import { createAudioController } from '../audio/controller.js';
import {
  createRecognitionController,
  calcMatchScore,
  isRecognitionSupported,
} from '../speech/recognition.js';
import { createSpeechSynthesisController } from '../speech/synthesis.js';
import { createOverlayController } from './overlay.js';
import { createCardTransitionQueue } from './cardTransitions.js';
import { createComposeGuide } from './composeGuide.js';
import { createLogManager } from './logManager.js';
import { qs, qsa } from './dom.js';
import { createLevelStateManager, LEVEL_CHOICES } from './levelState.js';
import { createDrillPanel } from './drill.js';
import { createDifficultyTracker } from '../state/difficulty.js';

function createAppRuntime(){
  // ===== Utilities =====
  const now=()=>Date.now(); const UA=(()=>navigator.userAgent||'')();

  function toIsoString(value){
    if(value instanceof Date){
      return value.toISOString();
    }
    if(typeof value==='number'){
      if(!Number.isFinite(value) || value<=0) return '';
      try{ return new Date(value).toISOString(); }catch(_){ return ''; }
    }
    if(typeof value==='string'){
      const trimmed=value.trim();
      return trimmed;
    }
    return '';
  }

  function numericOrEmpty(value){
    const num=Number(value);
    return Number.isFinite(num)?num:'';
  }

  const RECOGNITION_SUPPORTED = isRecognitionSupported();
  const DEFAULT_FOOTER_HINT_BASE='左右スワイプ：戻る/進む　上スワイプ：ヒント切替（英文・和訳・音声）';
  const DEFAULT_FOOTER_HINT_UNSUPPORTED=`${DEFAULT_FOOTER_HINT_BASE}　マイクによる音声入力はこの端末では利用できません。`;
  const DEFAULT_FOOTER_HINT = RECOGNITION_SUPPORTED ? DEFAULT_FOOTER_HINT_BASE : DEFAULT_FOOTER_HINT_UNSUPPORTED;
  const LEVEL_DESCRIPTIONS={
    0:'Lv0: これから練習を始めるカードです。ヒントを使って流れを確認しましょう。',
    1:'Lv1: 音声や和訳ヒントを頼りに正しい形を身に付けていく段階です。',
    2:'Lv2: ノーヒントで通せる回数を増やし、聞き取り精度を上げましょう。',
    3:'Lv3: 安定してきました。ノーヒント合格を重ねて次のレベルを目指します。',
    4:'Lv4: ノーヒント連続合格でLv5が開放されます。リズムを崩さず復習しましょう。',
    5:'Lv5: 定着済みです。定期的な復習で維持しつつ新しいカードに挑戦しましょう。'
  };
  let footerInfoIntroShown=false;

  const { SEARCH, SPEED, CONFIG, PENDING_LOGS: PENDING_LOGS_KEY, SECTION_SELECTION, ORDER_SELECTION } = STORAGE_KEYS;

  const BASE_HINT_STAGE=0;
  const COMPOSE_HINT_STAGE_JA=BASE_HINT_STAGE+1;
  const COMPOSE_HINT_STAGE_AUDIO=BASE_HINT_STAGE+2;
  const COMPOSE_HINT_STAGE_EN=BASE_HINT_STAGE+3;

  function loadSearchQuery(){
    return loadString(SEARCH, '');
  }
  function saveSearchQuery(value){
    saveString(SEARCH, value||'');
  }
  function currentSearchQuery(){
    const input=document.getElementById('rangeSearch');
    const raw=(input && typeof input.value==='string') ? input.value : '';
    return raw.trim();
  }

  const levelStateManager=createLevelStateManager({
    baseHintStage: BASE_HINT_STAGE,
    getFirstHintStage,
    getEnglishRevealStage,
  });
  const evaluateLevel=(...args)=>levelStateManager.evaluateLevel(...args);
  const getLevelInfo=(...args)=>levelStateManager.getLevelInfo(...args);
  const updateLevelInfo=(...args)=>levelStateManager.updateLevelInfo(...args);
  const buildNoHintProgressNote=(...args)=>levelStateManager.buildNoHintProgressNote(...args);
  const getActiveLevelArray=()=>levelStateManager.getActiveLevelArray();
  const getLevelFilterSet=()=>levelStateManager.getLevelFilterSet();
  const setLevelFilterSet=(...args)=>levelStateManager.setLevelFilterSet(...args);
  const lastRecordedLevel=(...args)=>levelStateManager.lastRecordedLevel(...args);

  function refreshLevelDisplay(info){
    if(!el.level) return;
    if(!info){ el.level.textContent='—'; return; }
    const lastVal = Number(info.last);
    const bestVal = Number(info.best);
    const last = Number.isFinite(lastVal) ? lastVal : (Number.isFinite(bestVal) ? bestVal : 0);
    const best = Number.isFinite(bestVal) ? bestVal : last;
    el.level.textContent = Number.isFinite(best) && best>last ? `${last} / ${best}` : `${last}`;
  }

  function updateLevelFilterButtons(){
    if(!el.levelFilter) return;
    const active=new Set(getActiveLevelArray());
    qsa('button[data-level]', el.levelFilter).forEach(btn=>{
      const level=Number(btn.dataset.level||'0');
      const on=active.has(level);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on?'true':'false');
    });
  }

  function initLevelFilterUI(){
    if(!el.levelFilter) return;
    el.levelFilter.innerHTML='';
    const label=document.createElement('span');
    label.className='level-filter-label';
    label.textContent='Lv';
    el.levelFilter.appendChild(label);
    const btnWrap=document.createElement('div');
    btnWrap.className='level-filter-buttons';
    el.levelFilter.appendChild(btnWrap);
    const activeLevels=new Set(getActiveLevelArray());
    for(const level of LEVEL_CHOICES){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='level-chip';
      btn.dataset.level=String(level);
      btn.textContent=String(level);
      if(activeLevels.has(level)){
        btn.classList.add('active');
        btn.setAttribute('aria-pressed','true');
      }else{
        btn.setAttribute('aria-pressed','false');
      }
      btn.addEventListener('click',()=>{
        let nextLevels=getLevelFilterSet();
        if(!(nextLevels instanceof Set)){
          nextLevels=new Set();
        }
        if(nextLevels.has(level)){
          if(nextLevels.size===1){
            nextLevels=new Set(LEVEL_CHOICES);
          }else{
            nextLevels.delete(level);
          }
        }else{
          nextLevels.add(level);
        }
        if(!nextLevels.size){
          nextLevels=new Set(LEVEL_CHOICES);
        }
        setLevelFilterSet(nextLevels);
        updateLevelFilterButtons();
        rebuildAndRender(true);
      });
      btnWrap.appendChild(btn);
    }
    updateLevelFilterButtons();
  }


  // ===== Elements =====
  const el={ headerSection:qs('#statSection'), headerLevelAvg:qs('#statLevelAvg'), headerProgressCurrent:qs('#statProgressCurrent'), headerProgressTotal:qs('#statProgressTotal'), pbar:qs('#pbar'), footer:qs('#footerMessage'), footerInfoContainer:qs('#footerInfo'), footerInfoBtn:qs('#footerInfoBtn'), footerInfoDialog:qs('#footerInfoDialog'), footerInfoDialogBody:qs('#footerInfoDialogBody'), en:qs('#enText'), ja:qs('#jaText'), chips:qs('#chips'), match:qs('#valMatch'), level:qs('#valLevel'), attempt:qs('#attemptInfo'), next:qs('#btnNext'), play:qs('#btnPlay'), mic:qs('#btnMic'), card:qs('#card'), secSel:qs('#secSel'), orderSel:qs('#orderSel'), search:qs('#rangeSearch'), levelFilter:qs('#levelFilter'), composeGuide:qs('#composeGuide'), composeTokens:qs('#composeTokens'), composeNote:qs('#composeNote'), cfgBtn:qs('#btnCfg'), cfgModal:qs('#cfgModal'), cfgUrl:qs('#cfgUrl'), cfgKey:qs('#cfgKey'), cfgAudioBase:qs('#cfgAudioBase'), cfgSpeechVoice:qs('#cfgSpeechVoice'), cfgSave:qs('#cfgSave'), cfgClose:qs('#cfgClose'), btnImport:qs('#btnImport'), filePick:qs('#filePick'), btnTestAudio:qs('#btnTestAudio'), btnPickDir:qs('#btnPickDir'), btnClearDir:qs('#btnClearDir'), dirStatus:qs('#dirStatus'), overlay:qs('#loadingOverlay'), dirPermOverlay:qs('#dirPermOverlay'), dirPermAllow:qs('#dirPermAllow'), dirPermLater:qs('#dirPermLater'), dirPermStatus:qs('#dirPermStatus'), speedCtrl:qs('.speed-ctrl'), speed:qs('#speedSlider'), speedDown:qs('#speedDown'), speedUp:qs('#speedUp'), speedValue:qs('#speedValue'), notifBtn:qs('#btnNotifPerm'), notifStatus:qs('#notifStatus') };
  if(el.mic && !RECOGNITION_SUPPORTED){
    el.mic.disabled=true;
    el.mic.setAttribute('aria-disabled','true');
    el.mic.setAttribute('aria-label','マイク（この端末では利用できません）');
    el.mic.title='この端末では音声入力を利用できません';
  }
  el.cfgPlaybackMode=qsa('input[name="cfgPlaybackMode"]');
  el.cfgStudyMode=qsa('input[name="cfgStudyMode"]');
  const composeNoteDefault = el.composeNote ? el.composeNote.textContent : '';
  const audio=qs('#player');
  const composeGuide = createComposeGuide({
    composeGuideEl: el.composeGuide,
    composeTokensEl: el.composeTokens,
    composeNoteEl: el.composeNote,
    defaultNote: composeNoteDefault,
    isComposeMode,
    toks,
    shuffledCopy
  });
  let recognitionController=null;
  let speechController=null;
  let lastMatchEval=null;
  let currentShouldUseSpeech=false;
  let lastProgressNote='';

  function setLastProgressNote(note){
    lastProgressNote = typeof note==='string' ? note.trim() : '';
  }

  function clearLastProgressNote(){
    setLastProgressNote('');
  }

  function getLastProgressNote(){
    return (lastProgressNote||'').trim();
  }

  function ensureProgressNoteModalStyles(){
    if(typeof document==='undefined') return;
    const styleId='progress-note-dialog-style';
    if(document.getElementById(styleId)) return;
    const style=document.createElement('style');
    style.id=styleId;
    style.textContent=`.progress-note-dialog{background:#111726;color:var(--txt,#e6e8ef);border:1px solid var(--bd,rgba(255,255,255,.12));border-radius:16px;padding:18px 20px;min-width:min(320px,90vw);max-width:min(420px,92vw);box-shadow:0 24px 60px rgba(0,0,0,.55);} .progress-note-dialog::backdrop{background:rgba(11,14,26,.65);} .progress-note-dialog__message{margin:0 0 14px 0;line-height:1.6;font-size:14px;color:var(--muted,#aeb5c6);} .progress-note-dialog__actions{display:flex;justify-content:flex-end;gap:8px;}`;
    document.head?.appendChild(style);
  }

  function showProgressNoteModal(message){
    if(typeof document==='undefined') return false;
    ensureProgressNoteModalStyles();
    let dialog=document.getElementById('progressNoteDialog');
    if(!dialog){
      dialog=document.createElement('dialog');
      dialog.id='progressNoteDialog';
      dialog.className='progress-note-dialog';
      dialog.setAttribute('aria-label','進捗メモ');
      dialog.innerHTML='<form method="dialog" class="progress-note-dialog__form"><p class="progress-note-dialog__message"></p><div class="progress-note-dialog__actions"><button value="close" class="btn">閉じる</button></div></form>';
      dialog.addEventListener('cancel',()=>{ dialog.close(); });
      document.body.appendChild(dialog);
    }
    const messageEl=dialog.querySelector('.progress-note-dialog__message');
    if(messageEl){
      messageEl.textContent=message;
    }else{
      dialog.textContent=message;
    }
    try{
      if(typeof dialog.showModal==='function'){
        if(dialog.open) dialog.close();
        dialog.showModal();
        const closeBtn=dialog.querySelector('button[value="close"]');
        try{ closeBtn?.focus?.({preventScroll:true}); }catch(_){ }
        return true;
      }
    }catch(err){
      console.warn('progress note modal failed', err);
    }
    if(dialog.open){
      dialog.close();
    }
    return false;
  }

  function showLastProgressNote({mode='toast', duration=2000}={}){
    const note=getLastProgressNote();
    if(!note) return false;
    const normalized=(mode||'toast').toLowerCase();
    if(normalized==='modal'){
      const shown=showProgressNoteModal(note);
      if(shown) return true;
    }
    toast(note, duration==null?2000:duration);
    return true;
  }

  function buildLevelSummary(){
    const item=currentItem;
    if(!item) return null;
    const info=getLevelInfo(item.id);
    if(!info) return null;
    const lastVal=Number(info.last);
    const bestVal=Number(info.best);
    const resolved=Number.isFinite(lastVal)?lastVal:(Number.isFinite(bestVal)?bestVal:0);
    const safeLevel=Number.isFinite(resolved)?resolved:0;
    const description=LEVEL_DESCRIPTIONS.hasOwnProperty(safeLevel)?LEVEL_DESCRIPTIONS[safeLevel]:LEVEL_DESCRIPTIONS[0];
    const best=Number.isFinite(bestVal)?bestVal:null;
    return { level:safeLevel, best, description };
  }

  function collectFooterInfoSections(){
    const sections=[];
    const note=getLastProgressNote();
    if(note){
      sections.push({ title:'進捗メモ', lines:[note] });
    }
    const summary=buildLevelSummary();
    if(summary){
      const lines=[];
      let label=`現在の目安レベル: Lv${summary.level}`;
      if(typeof summary.best==='number' && Number.isFinite(summary.best) && summary.best>summary.level){
        label+=`（最高Lv${summary.best}）`;
      }
      lines.push(label);
      if(summary.description){
        lines.push(summary.description);
      }
      sections.push({ title:'レベル説明', lines });
    }
    sections.push({ title:'操作ヒント', lines:[DEFAULT_FOOTER_HINT] });
    return sections;
  }

  function buildFooterInfoFallbackText(sections){
    if(!Array.isArray(sections)) return '';
    const chunks=[];
    for(const section of sections){
      if(!section || !Array.isArray(section.lines)) continue;
      const lines=section.lines.map(line=>typeof line==='string'?line.trim():'').filter(Boolean);
      if(lines.length){
        chunks.push(lines.join(' '));
      }
    }
    return chunks.join(' / ');
  }

  function openFooterInfoDialog(sections){
    const dialog=el.footerInfoDialog;
    const body=el.footerInfoDialogBody;
    if(!dialog || !body || typeof dialog.showModal!=='function') return false;
    const infoSections=Array.isArray(sections) && sections.length ? sections : collectFooterInfoSections();
    body.innerHTML='';
    const effectiveSections=infoSections.length ? infoSections : [{ title:'操作ヒント', lines:[DEFAULT_FOOTER_HINT] }];
    for(const section of effectiveSections){
      const sectionEl=document.createElement('section');
      sectionEl.className='info-dialog__section';
      const titleText=typeof section.title==='string' ? section.title.trim() : '';
      if(titleText){
        const titleEl=document.createElement('p');
        titleEl.className='info-dialog__section-title';
        titleEl.textContent=titleText;
        sectionEl.appendChild(titleEl);
      }
      const lines=Array.isArray(section.lines) ? section.lines : [];
      if(lines.length){
        for(const rawLine of lines){
          const text=typeof rawLine==='string' ? rawLine.trim() : '';
          if(!text) continue;
          const p=document.createElement('p');
          p.textContent=text;
          sectionEl.appendChild(p);
        }
      }
      body.appendChild(sectionEl);
    }
    try{
      if(dialog.open) dialog.close();
      dialog.showModal();
      const closeBtn=dialog.querySelector('button[value="close"]');
      try{ closeBtn?.focus?.({preventScroll:true}); }catch(_){ }
      return true;
    }catch(err){
      console.warn('footer info dialog failed', err);
    }
    if(dialog.open){
      dialog.close();
    }
    return false;
  }

  function presentFooterInfo(){
    const sections=collectFooterInfoSections();
    if(openFooterInfoDialog(sections)) return true;
    const note=getLastProgressNote();
    if(note){
      toast(note, 2600);
      return true;
    }
    const fallback=buildFooterInfoFallbackText(sections);
    if(fallback){
      toast(fallback, 2600);
      return true;
    }
    toast(DEFAULT_FOOTER_HINT, 2400);
    return false;
  }

  function maybeShowFooterInfoIntroToast(){
    if(footerInfoIntroShown) return;
    footerInfoIntroShown=true;
    setTimeout(()=>{ toast('ℹ️ ボタンから詳細を確認できます', 2200); }, 500);
  }

  function initFooterInfoButton(){
    if(el.footer && !el.footer.textContent){
      el.footer.textContent=DEFAULT_FOOTER_HINT;
    }
    if(el.footerInfoDialog){
      el.footerInfoDialog.addEventListener('cancel',()=>{ el.footerInfoDialog.close(); });
    }
    if(!el.footerInfoBtn) return;
    el.footerInfoBtn.addEventListener('click',()=>{ presentFooterInfo(); });
  }
  function initializeMediaControllers(){
    const controller=createAudioController({
      audioElement: audio,
      playButton: el.play,
      speedSlider: el.speed,
      speedDownButton: el.speedDown,
      speedUpButton: el.speedUp,
      speedValueElement: el.speedValue,
      loadSpeed: ()=>{
        const stored=loadNumber(SPEED, 1);
        return stored==null?1:stored;
      },
      saveSpeed: (rate)=>{ saveNumber(SPEED, rate); },
      getCanSpeak: ()=>speechController ? speechController.canSpeakCurrentCard() : false,
      onPlaybackRateChange: (rate)=>{
        if(speechController){
          speechController.setSpeechRate(rate);
        }
      },
      isRecognitionActive: ()=>recognitionController ? recognitionController.isActive() : false,
    });
    const speech=createSpeechSynthesisController({
      setSpeechPlayingState: controller.setSpeechPlayingState,
      getCurrentItem: ()=>currentItem,
      isSpeechDesired: ()=>currentShouldUseSpeech,
    });
    speech.setSpeechRate(controller.getPlaybackRate());
    return { controller, speech };
  }

  const { controller: audioController, speech } = initializeMediaControllers();
  speechController=speech;
  const drillPanel = createDrillPanel({
    root: qs('#drillPanel'),
    dictionaryClient,
    speakFallback: async () => {
      if(!speechController) return false;
      const prevState=currentShouldUseSpeech;
      currentShouldUseSpeech=true;
      try{
        const spoken=await speechController.speakCurrentCard({ preferredVoiceId: CFG.speechVoice });
        return !!spoken;
      }catch(err){
        console.warn('drill fallback speech failed', err);
        return false;
      }finally{
        currentShouldUseSpeech=prevState;
      }
    }
  });

  initFooterInfoButton();

  const {
    playTone,
    updatePlayButtonAvailability: baseUpdatePlayButtonAvailability,
    updatePlayVisualState,
    setAudioSource,
    clearAudioSource,
    primeAudio,
    setResumeAfterMicStart,
    resetResumeAfterMicStart,
    clearResumeTimer,
    setSpeechPlayingState,
  } = audioController;
  const overlayController = createOverlayController({ overlayElement: el.overlay });
  const acquireOverlay = (tag='load') => overlayController.acquire(tag);
  const { queueTransition: queueCardTransition } = createCardTransitionQueue({
    cardElement: el.card
  });
  let sessionActive=false;
  let sessionStarting=false;
  let remoteStatus=null;
  let QUEUE=[];
  let idx=-1;
  let sessionStart=0;
  let cardStart=0;
  const createEmptySessionMetrics=()=>({ startMs:0, cardsDone:0, newIntroduced:0, currentStreak:0, highestStreak:0 });
  let sessionMetrics=createEmptySessionMetrics();
  let autoPlayUnlocked=false;
  let lastEmptySearchToast='';

  function updateHeaderStats(){
    if(el.headerSection){
      let sectionLabel='—';
      const sel=el.secSel;
      if(sel){
        const selected = sel.selectedOptions && sel.selectedOptions.length ? sel.selectedOptions[0] : null;
        if(selected){
          sectionLabel=(selected.textContent||selected.label||selected.value||'').trim();
        }
        if(!sectionLabel){
          if(sel.value){
            sectionLabel=String(sel.value).trim();
          }else if(sel.options.length){
            const first=sel.options[0];
            sectionLabel=(first.textContent||first.label||first.value||'').trim();
          }
        }
        if(!sectionLabel && sel.value==='') sectionLabel='全体';
      }
      if(!sectionLabel) sectionLabel='—';
      const query=currentSearchQuery();
      if(query){
        const suffix=(sectionLabel && sectionLabel!=='—') ? ` (${sectionLabel})` : '';
        el.headerSection.textContent=`検索: ${query}${suffix}`;
      }else{
        el.headerSection.textContent=sectionLabel;
      }
    }

    if(el.headerLevelAvg){
      const secKey = el.secSel ? el.secSel.value : '';
      const pool = secKey ? (ITEMS_BY_SECTION.get(secKey)||[]) : (window.ALL_ITEMS||[]);
      let sum=0;
      let count=0;
      for(const item of pool){
        if(!item) continue;
        const info=getLevelInfo(item.id);
        let val = info ? Number(info.last) : NaN;
        if(!Number.isFinite(val)) val = info ? Number(info.best) : NaN;
        if(!Number.isFinite(val)) val = 0;
        if(val < 0) val = 0;
        sum+=val;
        count++;
      }
      if(count>0){
        const avg=sum/count;
        let text=avg.toFixed(1);
        if(text.endsWith('.0')) text=text.slice(0,-2);
        el.headerLevelAvg.textContent=text;
      }else{
        el.headerLevelAvg.textContent='—';
      }
    }

    if(el.headerProgressCurrent){
      const total=Array.isArray(QUEUE)?QUEUE.length:0;
      const shown=(sessionActive && idx>=0) ? Math.min(idx+1, total) : 0;
      el.headerProgressCurrent.textContent = shown;
      if(el.headerProgressTotal){
        el.headerProgressTotal.textContent = total;
      }
    }
  }

  function finalizeSessionMetrics(){
    if(!sessionMetrics || !sessionMetrics.startMs){
      sessionMetrics=createEmptySessionMetrics();
      return;
    }
    const finishedAt=now();
    const elapsedMinutes=Math.max(0, (finishedAt-sessionMetrics.startMs)/60000);
    const roundedMinutes=Math.round(elapsedMinutes*100)/100;
    const payload={
      date:new Date(sessionMetrics.startMs).toISOString(),
      minutes:roundedMinutes,
      cards_done:sessionMetrics.cardsDone,
      new_introduced:sessionMetrics.newIntroduced,
      streak:sessionMetrics.highestStreak,
    };
    try{
      const maybePromise=sendLog('session', payload);
      if(maybePromise && typeof maybePromise.catch==='function'){
        maybePromise.catch(()=>{});
      }
    }catch(_){ }
    if((CFG.apiUrl||'').trim()){
      Promise.resolve(syncProgressAndStatus()).catch(()=>{});
    }
    sessionMetrics=createEmptySessionMetrics();
  }

  function beginSessionMetrics(){
    sessionMetrics=createEmptySessionMetrics();
    sessionMetrics.startMs=now();
  }

  function applyRemoteStatus(status){
    remoteStatus = status ? Object.assign({}, status) : null;
    updateHeaderStats();
  }

  const FAIL_LIMIT=3;
  let failCount=0;

  let hintStage=BASE_HINT_STAGE;
  let maxHintStageUsed=BASE_HINT_STAGE;
  let currentEnHtml='';
  let currentItem=null;

  function getMaxHintStage(){
    return isComposeMode() ? COMPOSE_HINT_STAGE_EN : BASE_HINT_STAGE+2;
  }

  function getFirstHintStage(){
    return BASE_HINT_STAGE+1;
  }

  function getJapaneseHintStage(){
    return isComposeMode() ? COMPOSE_HINT_STAGE_JA : BASE_HINT_STAGE+2;
  }

  function getAudioUnlockStage(){
    return isComposeMode() ? COMPOSE_HINT_STAGE_AUDIO : BASE_HINT_STAGE;
  }

  function getEnglishRevealStage(){
    return isComposeMode() ? COMPOSE_HINT_STAGE_EN : BASE_HINT_STAGE+1;
  }

  function isAudioHintUnlocked(stage=hintStage){
    const unlockStage=getAudioUnlockStage();
    if(unlockStage<=BASE_HINT_STAGE) return true;
    return stage>=unlockStage;
  }

  function updatePlayButtonAvailability(){
    baseUpdatePlayButtonAvailability();
    if(!el.play) return;
    const locked=!isAudioHintUnlocked();
    if(locked){
      el.play.disabled=true;
      el.play.classList.add('hint-locked');
      el.play.setAttribute('aria-disabled','true');
    }else{
      el.play.classList.remove('hint-locked');
      el.play.removeAttribute('aria-disabled');
    }
  }

  function composeHintPlaceholder(stage){
    if(stage<=BASE_HINT_STAGE){
      return '<span class="hint-placeholder">カードを上スワイプして和訳ヒントを表示（もう一度で音声、さらにもう一度で英文）</span>';
    }
    if(stage<COMPOSE_HINT_STAGE_AUDIO){
      return '<span class="hint-placeholder">英文はまだ非表示です。もう一度上スワイプで音声ヒントを有効化（さらにもう一度で英文）</span>';
    }
    if(stage<COMPOSE_HINT_STAGE_EN){
      return '<span class="hint-placeholder">英文はまだ非表示です。もう一度上スワイプで英文ヒントを表示</span>';
    }
    return '';
  }

  function defaultHintPlaceholder(){
    return '<span class="hint-placeholder">カードを上スワイプして英文ヒントを表示（もう一度で和訳）</span>';
  }

  function setHintStage(stage,{reset=false}={}){
    const maxStage=Math.max(BASE_HINT_STAGE, getMaxHintStage());
    const next=Math.max(BASE_HINT_STAGE, Math.min(maxStage, Number.isFinite(stage)?Math.floor(stage):BASE_HINT_STAGE));
    const prev=hintStage;
    hintStage=next;
    if(reset){ maxHintStageUsed=next; }
    else if(next>maxHintStageUsed){ maxHintStageUsed=next; }
    const compose=isComposeMode();
    const showEnglish=next>=getEnglishRevealStage();
    const showJapanese=next>=getJapaneseHintStage();
    if(showEnglish){
      el.en.classList.remove('concealed');
      el.en.innerHTML=currentEnHtml||'';
      if(recognitionController && currentItem && lastMatchEval && lastMatchEval.source){
        lastMatchEval = recognitionController.matchAndHighlight(currentItem.en, lastMatchEval.source);
        const score=calcMatchScore(lastMatchEval.refCount, lastMatchEval.recall, lastMatchEval.precision);
        updateMatch(score);
      }
    }else{
      el.en.classList.add('concealed');
      el.en.innerHTML=compose ? composeHintPlaceholder(next) : defaultHintPlaceholder();
      if(recognitionController){ recognitionController.clearHighlight(); }
    }
    el.ja.style.display = showJapanese ? 'block' : 'none';
    updatePlayButtonAvailability();
    return prev!==next;
  }

  function advanceHintStage(){
    if(!sessionActive) return;
    const maxStage=Math.max(BASE_HINT_STAGE, getMaxHintStage());
    const nextStage=hintStage>=maxStage ? BASE_HINT_STAGE : hintStage+1;
    const changed=setHintStage(nextStage);
    if(changed){
      if(isComposeMode()){
        if(hintStage===COMPOSE_HINT_STAGE_JA){ el.footer.textContent='和訳ヒントを表示しました。もう一度上スワイプで音声ヒント（再生ボタン）が使えます。さらにもう一度で英文ヒント。'; }
        else if(hintStage===COMPOSE_HINT_STAGE_AUDIO){ el.footer.textContent='音声ヒントを有効化しました。再生ボタンが使えます。さらにもう一度上スワイプで英文ヒント。'; }
        else if(hintStage===COMPOSE_HINT_STAGE_EN){ el.footer.textContent='英文ヒントを表示しました。'; }
        else if(hintStage===BASE_HINT_STAGE){ el.footer.textContent='ヒントを非表示に戻しました。上スワイプで再表示できます。'; }
      }else{
        if(hintStage===BASE_HINT_STAGE+1){ el.footer.textContent='英文ヒントを表示しました。もう一度上スワイプで和訳ヒント。'; }
        else if(hintStage===BASE_HINT_STAGE+2){ el.footer.textContent='和訳ヒントを表示しました。'; }
        else if(hintStage===BASE_HINT_STAGE){ el.footer.textContent='ヒントを非表示に戻しました。上スワイプで再表示できます。'; }
      }
    }
  }

  function updateMatch(rate){
    el.match.classList.remove('match-good','match-mid','match-bad');
    if(rate==null || !isFinite(rate)){
      el.match.textContent='—';
      return;
    }
    const pct=Math.max(0, Math.min(100, Math.round(rate*100)));
    el.match.textContent=`${pct}%`;
    if(pct>=85){ el.match.classList.add('match-good'); }
    else if(pct>=70){ el.match.classList.add('match-mid'); }
    else { el.match.classList.add('match-bad'); }
  }

  function updateAttemptInfo(){
    if(failCount<=0){ el.attempt.textContent=''; el.attempt.classList.remove('alert'); return; }
    const remain=Math.max(0, FAIL_LIMIT-failCount);
    el.attempt.textContent = remain>0 ? `リトライ残り ${remain}回` : '規定回数に達しました';
    if(remain<=1){ el.attempt.classList.add('alert'); }
    else{ el.attempt.classList.remove('alert'); }
  }

  function hideNextCta(){
    el.next.hidden=true;
    el.next.disabled=true;
    if(RECOGNITION_SUPPORTED){
      el.mic.disabled=false;
    }
  }

  function showNextCta(){
    el.next.hidden=false;
    el.next.disabled=false;
  }

  function setMicState(on){
    el.mic.classList.toggle('recording', !!on);
  }

  // ===== Config =====
  const STUDY_MODE_READ='read';
  const STUDY_MODE_COMPOSE='compose';
  const STUDY_MODE_DRILL='drill';
  function loadCfg(){
    const cfg=loadJson(CONFIG, {});
    return cfg && typeof cfg==='object'?cfg:{};
  }
  function saveCfg(o){
    saveJson(CONFIG, o||{});
  }
  let CFG=Object.assign({ apiUrl:'', apiKey:'', audioBase:'./audio', speechVoice:'', playbackMode:'audio', studyMode:STUDY_MODE_READ }, loadCfg());
  if(typeof CFG.speechVoice!=='string'){ CFG.speechVoice=''; }
  const legacyFallback=CFG && typeof CFG.speechFallback!=='undefined' ? !!CFG.speechFallback : false;
  if(CFG && typeof CFG.playbackMode!=='string'){ CFG.playbackMode=''; }
  const normalizedMode = (CFG.playbackMode||'').toLowerCase();
  CFG.playbackMode = normalizedMode==='speech' ? 'speech' : (normalizedMode==='audio' ? 'audio' : (legacyFallback ? 'speech' : 'audio'));
  if(CFG && Object.prototype.hasOwnProperty.call(CFG,'speechFallback')){ delete CFG.speechFallback; }
  if(typeof CFG.studyMode!=='string'){ CFG.studyMode=STUDY_MODE_READ; }
  else {
    const normalizedStudy=(CFG.studyMode||'').toLowerCase();
    if(normalizedStudy===STUDY_MODE_COMPOSE){ CFG.studyMode=STUDY_MODE_COMPOSE; }
    else if(normalizedStudy===STUDY_MODE_DRILL){ CFG.studyMode=STUDY_MODE_DRILL; }
    else { CFG.studyMode=STUDY_MODE_READ; }
  }

  function getPlaybackMode(){
    return CFG.playbackMode==='speech' ? 'speech' : 'audio';
  }
  function getStudyMode(){
    const normalized=(CFG.studyMode||'').toLowerCase();
    if(normalized===STUDY_MODE_COMPOSE) return STUDY_MODE_COMPOSE;
    if(normalized===STUDY_MODE_DRILL) return STUDY_MODE_DRILL;
    return STUDY_MODE_READ;
  }
  function isComposeMode(){
    return getStudyMode()===STUDY_MODE_COMPOSE;
  }
  function isDrillMode(){
    return getStudyMode()===STUDY_MODE_DRILL;
  }
  function isAutoPlayAllowed(){
    return !(isComposeMode() || isDrillMode());
  }
  function shouldUseSpeechForItem(item){
    if(!item) return false;
    if(item.forceSpeech){ return true; }
    return getPlaybackMode()==='speech';
  }
  function shouldUseAudioForItem(item){
    if(!item) return false;
    if(item.forceSpeech){ return false; }
    return getPlaybackMode()!=='speech';
  }

  function populateVoiceOptions(){
    if(!el.cfgSpeechVoice){ return; }
    const sel=el.cfgSpeechVoice;
    const priorValue=sel.value;
    const stored=CFG.speechVoice||'';
    const result = speechController.populateVoiceOptions(sel, { storedVoiceId: stored, currentValue: priorValue });
    if(result && typeof result.selected==='string'){
      sel.value = result.selected;
    }
  }

  if(el.cfgSpeechVoice){
    populateVoiceOptions();
    speechController.attachVoicesChangedListener(populateVoiceOptions);
  }

  const logManager=createLogManager({
    loadJson,
    saveJson,
    storageKey: PENDING_LOGS_KEY,
    getConfig: ()=>CFG,
  });
  const { sendLog, flushPendingLogs, setEndpointForPending, clearPendingEndpoints } = logManager;
  const difficultyTracker = createDifficultyTracker({ load: loadJson, save: saveJson });
  const dictionaryClient = createDictionaryClient({ load: loadJson, save: saveJson });

  // ===== IndexedDB for DirectoryHandle =====
  const DB='fs-handles', STORE='dir';
  function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>{ r.result.createObjectStore(STORE); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function saveDirHandle(h){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(h,'audio'); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
  async function loadDirHandle(){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const rq=tx.objectStore(STORE).get('audio'); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); }); }
  async function clearDirHandle(){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete('audio'); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

  let DIR=null; // FileSystemDirectoryHandle
  let dirNeedsGesture=false;
  let dirPromptArmed=false;
  async function ensureDir({prompt=true, forceCheck=false, allowSchedule=true}={}){
    if(!DIR || forceCheck){
      if(!DIR){
        try{
          DIR = await loadDirHandle();
        }catch(err){
          console.warn('loadDirHandle failed', err);
          DIR=null;
          dirNeedsGesture=false;
          refreshDirStatus();
          return null;
        }
      }
    }
    if(!DIR){ dirNeedsGesture=false; refreshDirStatus(); return null; }
    let state='granted';
    try{
      state = await DIR.queryPermission?.({mode:'read'}) || 'granted';
    }catch(_){ state='prompt'; }
    if(state==='granted'){
      dirNeedsGesture=false;
      dirPromptArmed=false;
      refreshDirStatus();
      return DIR;
    }
    if(!prompt){
      dirNeedsGesture = state!=='granted';
      if(dirNeedsGesture && allowSchedule) scheduleDirPrompt();
      refreshDirStatus();
      return null;
    }
    try{
      state = await DIR.requestPermission?.({mode:'read'});
    }catch(err){
      if(err && (err.name==='InvalidStateError' || /user activation/i.test(err.message||''))){
        dirNeedsGesture=true;
        if(allowSchedule) scheduleDirPrompt();
        refreshDirStatus();
        return null;
      }
      console.warn('requestPermission error', err);
      DIR=null;
      dirNeedsGesture=false;
      refreshDirStatus();
      return null;
    }
      if(state==='granted'){
        dirNeedsGesture=false;
        dirPromptArmed=false;
        refreshDirStatus();
        return DIR;
      }
      if(state==='prompt'){
        dirNeedsGesture=true;
        if(allowSchedule) scheduleDirPrompt();
        refreshDirStatus();
        return null;
      }
      // denied or unknown
      dirNeedsGesture=false;
      dirPromptArmed=false;
      DIR=null;
      try{ await clearDirHandle(); }catch(_){ }
      refreshDirStatus();
      return null;
  }
  function scheduleDirPrompt(){
    if(!DIR || !dirNeedsGesture || dirPromptArmed) return;
    dirPromptArmed=true;
    const handler=async()=>{
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
      dirPromptArmed=false;
      const release=acquireOverlay('dir');
      try{
        await ensureDir({prompt:true});
      }finally{
        release();
      }
    };
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
  }

  async function gateDirPermissionBeforeBoot(){
    await ensureDir({prompt:false, forceCheck:true, allowSchedule:false});
    if(!DIR || !dirNeedsGesture){
      return;
    }
    refreshDirStatus();
    if(el.dirPermOverlay && el.dirPermAllow){
      const overlay=el.dirPermOverlay;
      const statusEl=el.dirPermStatus;
      const allowBtn=el.dirPermAllow;
      const laterBtn=el.dirPermLater;
      function hideOverlay(){
        overlay.classList.remove('show');
        overlay.setAttribute('hidden','');
        overlay.setAttribute('aria-hidden','true');
      }
      function showOverlay(){
        overlay.removeAttribute('hidden');
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden','false');
        setTimeout(()=>{ try{ allowBtn?.focus?.(); }catch(_){ } }, 0);
      }
      await new Promise(resolve=>{
        if(laterBtn){ laterBtn.hidden=true; }
        const attempt=async(fromUser=false)=>{
          statusEl && (statusEl.textContent='');
          const release=acquireOverlay('dir-permission');
          try{
            const handle=await ensureDir({prompt:true, forceCheck:true, allowSchedule:false});
            if(handle){
              cleanup();
              hideOverlay();
              resolve();
              return;
            }
            if(statusEl){
              statusEl.textContent = fromUser
                ? 'アクセスが許可されませんでした。端末のダイアログで「許可する」を選んでください。'
                : '音声フォルダへのアクセス許可が必要です。「許可を開く」をタップしてください。';
            }
            if(fromUser && laterBtn){
              laterBtn.hidden=false;
            }
          }catch(err){
            console.warn('dir permission attempt failed', err);
            if(statusEl){
              statusEl.textContent = fromUser
                ? 'アクセス許可のリクエストに失敗しました。もう一度お試しください。'
                : 'アクセス許可のリクエストを開始できませんでした。「許可を開く」をタップしてください。';
            }
            if(fromUser && laterBtn){
              laterBtn.hidden=false;
            }
          }finally{
            release();
          }
        };
        const skip=()=>{
          cleanup();
          hideOverlay();
          resolve();
        };
        const onKey=ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); attempt(true); } };
        const onAllow=()=>{ attempt(true); };
        function cleanup(){
          allowBtn.removeEventListener('click', onAllow);
          laterBtn?.removeEventListener('click', skip);
          overlay.removeEventListener('keydown', onKey);
        }
        showOverlay();
        allowBtn.addEventListener('click', onAllow);
        laterBtn?.addEventListener('click', skip);
        overlay.addEventListener('keydown', onKey);
        setTimeout(()=>{ attempt(false).catch(()=>{}); }, 0);
      });
    }else{
      await ensureDir({prompt:true, forceCheck:true, allowSchedule:false});
    }
  }

  // Settings modal
  if(el.cfgBtn && el.cfgModal && el.cfgUrl && el.cfgKey && el.cfgAudioBase){
    el.cfgBtn.addEventListener('click', ()=>{
      el.cfgUrl.value=CFG.apiUrl||'';
      el.cfgKey.value=CFG.apiKey||'';
      el.cfgAudioBase.value=CFG.audioBase||'./audio';
      if(el.cfgPlaybackMode && el.cfgPlaybackMode.length){
        const mode=getPlaybackMode();
        el.cfgPlaybackMode.forEach(input=>{ input.checked = (input.value===mode); });
      }
      if(el.cfgStudyMode && el.cfgStudyMode.length){
        const studyMode=getStudyMode();
        el.cfgStudyMode.forEach(input=>{ input.checked = (input.value===studyMode); });
      }
      if(el.cfgSpeechVoice){
        populateVoiceOptions();
        const desired=CFG.speechVoice||'';
        if(desired){
          el.cfgSpeechVoice.value=desired;
          if(el.cfgSpeechVoice.value!==desired){ el.cfgSpeechVoice.value=''; }
        }else{
          el.cfgSpeechVoice.value='';
        }
      }
      refreshDirStatus();
      updateNotificationUi({ statusEl: el.notifStatus, buttonEl: el.notifBtn });
      el.cfgModal.style.display='flex';
    });
  }
  function setupNotifications(){
    const handlers=initNotificationSystem({
      statusEl: el.notifStatus,
      buttonEl: el.notifBtn,
      toast
    });
    if(el.notifBtn && handlers?.handleClick){
      el.notifBtn.addEventListener('click', handlers.handleClick);
    }
    if(typeof document!=='undefined' && handlers?.handleVisibilityChange){
      document.addEventListener('visibilitychange', handlers.handleVisibilityChange);
    }
    return handlers;
  }

  const notifHandlers=setupNotifications();
  if(el.cfgClose && el.cfgModal){
    el.cfgClose.addEventListener('click', ()=>{ el.cfgModal.style.display='none'; });
  }
  if(el.cfgSave && el.cfgModal && el.cfgUrl && el.cfgKey && el.cfgAudioBase){
    el.cfgSave.addEventListener('click', ()=>{
      const prevStudyMode=getStudyMode();
      CFG.apiUrl=(el.cfgUrl.value||'').trim();
      CFG.apiKey=(el.cfgKey.value||'').trim();
      CFG.audioBase=(el.cfgAudioBase.value||'').trim()||'./audio';
      if(el.cfgPlaybackMode && el.cfgPlaybackMode.length){
        const selected=el.cfgPlaybackMode.find(input=>input.checked);
        CFG.playbackMode = selected ? (selected.value==='speech' ? 'speech' : 'audio') : 'audio';
      }else{
        CFG.playbackMode='audio';
      }
      if(el.cfgStudyMode && el.cfgStudyMode.length){
        const selectedStudy=el.cfgStudyMode.find(input=>input.checked);
        if(selectedStudy){
          if(selectedStudy.value===STUDY_MODE_COMPOSE){ CFG.studyMode=STUDY_MODE_COMPOSE; }
          else if(selectedStudy.value===STUDY_MODE_DRILL){ CFG.studyMode=STUDY_MODE_DRILL; }
          else { CFG.studyMode=STUDY_MODE_READ; }
        }else{
          CFG.studyMode=STUDY_MODE_READ;
        }
      }else{
        CFG.studyMode=STUDY_MODE_READ;
      }
      if(el.cfgSpeechVoice){ CFG.speechVoice=el.cfgSpeechVoice.value||''; }
      saveCfg(CFG);
      const newStudyMode=getStudyMode();
      if((CFG.apiUrl||'').trim()){
        setEndpointForPending(CFG.apiUrl.trim(), (CFG.apiKey||'')||undefined);
      } else {
        clearPendingEndpoints();
        applyRemoteStatus(null);
      }
      el.cfgModal.style.display='none';
      toast('設定を保存しました');
      if(currentItem){
        const wantsSpeech=shouldUseSpeechForItem(currentItem);
        if(wantsSpeech){
          clearAudioSource();
          currentShouldUseSpeech=true;
        }else{
          currentShouldUseSpeech=false;
          speechController.cancelSpeech();
          if(shouldUseAudioForItem(currentItem) && !audio.dataset.srcKey && currentItem.audio_fn){
            (async()=>{
              try{
                const url=await resolveAudioUrl(currentItem.audio_fn);
                if(url){
                  await setAudioSource(url);
                }else{
                  clearAudioSource();
                }
              }catch(err){
                console.warn('audio reload after config failed', err);
              }
            })();
          }
        }
        if(prevStudyMode!==newStudyMode){
          if(recognitionController){ recognitionController.clearHighlight(); }
          setupComposeGuide(currentItem);
          if(recognitionController && lastMatchEval && lastMatchEval.source){
            const rerun=recognitionController.matchAndHighlight(currentItem.en, lastMatchEval.source);
            lastMatchEval=Object.assign({}, rerun);
            const score=calcMatchScore(rerun.refCount, rerun.recall, rerun.precision);
            updateMatch(score);
          }
        }
      }else{
        currentShouldUseSpeech=false;
        if(prevStudyMode!==newStudyMode){
          resetComposeGuide();
        }
      }
      updatePlayButtonAvailability();
      if((CFG.apiUrl||'').trim()){
        syncProgressAndStatus().catch(()=>{});
      }
    });
  }
  if(el.btnPickDir){
    el.btnPickDir.addEventListener('click', async()=>{
      if(!window.showDirectoryPicker){ toast('この端末はフォルダピッカー非対応'); return; }
      try{
        const h=await showDirectoryPicker({mode:'read'});
        await saveDirHandle(h);
        DIR=h;
        dirNeedsGesture=false;
        refreshDirStatus();
        await ensureDir({prompt:true, forceCheck:true});
        refreshDirStatus();
        toast(dirNeedsGesture ? 'フォルダを保存（許可待ち）' : 'フォルダを保存しました');
      }catch(e){
        if(e&&e.name!=='AbortError') toast('フォルダ選択に失敗');
      }
    });
  }
  if(el.btnClearDir){
    el.btnClearDir.addEventListener('click', async()=>{
      await clearDirHandle();
      DIR=null;
      dirNeedsGesture=false;
      dirPromptArmed=false;
      refreshDirStatus();
      toast('フォルダ設定を解除');
    });
  }
  function refreshDirStatus(){ if(!el.dirStatus) return; if(DIR){ el.dirStatus.textContent = dirNeedsGesture ? '許可待ち' : '保存済み'; } else { el.dirStatus.textContent = '未設定'; } }

  // Import audio (OPFS)
  if(el.btnImport && el.filePick){
    el.btnImport.addEventListener('click', ()=>{ el.filePick.click(); });
    el.filePick.addEventListener('change', async(ev)=>{
      const files=[...ev.target.files||[]];
      if(!files.length){ toast('ファイル未選択'); return; }
      try{
        if(!(navigator.storage&&navigator.storage.getDirectory)) throw new Error('OPFS未対応');
        const root=await navigator.storage.getDirectory();
        let ok=0;
        for(const f of files){
          const fh=await root.getFileHandle(f.name,{create:true});
          const w=await fh.createWritable();
          await w.write(f);
          await w.close();
          ok++;
        }
        toast(`${ok} 件をOPFSへ保存`);
      }catch(e){
        console.error(e);
        toast('OPFS取り込み失敗');
      }
    });
  }

  // GAS Bridge
  async function refreshRemoteStatus(){
    const url=(CFG.apiUrl||'').trim();
    if(!url) return null;
    try{
      const payload={type:'status', apiKey:CFG.apiKey||undefined};
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload)});
      if(!res.ok) throw new Error('status '+res.status);
      const json=await res.json();
      if(json && json.ok && json.status){
        applyRemoteStatus(json.status);
        return json.status;
      }
    }catch(err){ console.warn('refreshRemoteStatus', err); }
    return null;
  }

  async function syncProgressAndStatus(){
    const url=(CFG.apiUrl||'').trim();
    if(!url) return null;
    try{ await flushPendingLogs(); }catch(err){ console.warn('syncProgressAndStatus', err); }
    return refreshRemoteStatus();
  }

  window.addEventListener('online', ()=>{
    flushPendingLogs().then(()=>refreshRemoteStatus()).catch(()=>{});
  });

  // Data
  const DATA_URL='./data/items.json';
  const ITEM_CACHE_NAME='items-v1';
  const ITEMS_BY_SECTION=new Map();
  let itemsLoadPromise=null;
  async function fetchJson(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(url+': '+r.status); return r.json(); }
  window.ALL_ITEMS=[]; let SRS_MAP=new Map();
  function rebuildSectionIndex(){
    ITEMS_BY_SECTION.clear();
    for(const it of window.ALL_ITEMS){
      const key=String((it&& (it.unit ?? it.sec ?? ''))||'').trim();
      if(!key) continue;
      if(!ITEMS_BY_SECTION.has(key)) ITEMS_BY_SECTION.set(key, []);
      ITEMS_BY_SECTION.get(key).push(it);
    }
  }
  function updateSectionOptions({preferSaved=false}={}){
    const sel=el.secSel;
    if(!sel) return;
    const saved=loadString(SECTION_SELECTION, '');
    const desired=preferSaved ? saved : (sel.value || saved || '');
    const frag=document.createDocumentFragment();
    frag.appendChild(new Option('全体',''));
    const units=[...ITEMS_BY_SECTION.keys()].sort((a,b)=>{
      const na=+String(a).replace(/\D+/g,'')||0;
      const nb=+String(b).replace(/\D+/g,'')||0;
      if(na!==nb) return na-nb;
      return String(a).localeCompare(String(b));
    });
    for(const u of units){ frag.appendChild(new Option(u,u)); }
    sel.innerHTML='';
    sel.appendChild(frag);
    const target=units.includes(desired)?desired:'';
    sel.value=target;
    if(preferSaved && saved && !units.includes(saved)){
      saveString(SECTION_SELECTION, '');
    }
    if(!target && !preferSaved){
      saveString(SECTION_SELECTION, '');
    }
    updateHeaderStats();
  }
  function applyItemsData(items,{refreshPicker=false}={}){
    window.ALL_ITEMS=Array.isArray(items)?items.slice():[];
    rebuildSectionIndex();
    if(refreshPicker) updateSectionOptions();
    updateHeaderStats();
  }
  async function loadItemsOnce(url){
    let cache=null;
    if('caches' in window){
      try{ cache=await caches.open(ITEM_CACHE_NAME); }catch(_){ cache=null; }
    }
    let resp=cache?await cache.match(url):null;
    if(!resp){
      resp=await fetch(url,{cache:'no-cache'});
      if(!resp.ok) throw new Error(url+': '+resp.status);
      if(cache){
        try{ await cache.put(url, resp.clone()); }catch(_){ }
      }
    }
    let data;
    try{
      data=await resp.json();
    }catch(err){
      console.error('Failed to parse items data', err);
      toast('items.json parse failed');
      throw err;
    }
    if(cache){
      fetch(url,{cache:'no-cache'}).then(async fresh=>{
        if(!fresh.ok) return;
        try{ await cache.put(url, fresh.clone()); }catch(_){ }
        const latest=await fresh.json();
        applyItemsData(latest,{refreshPicker:true});
      }).catch(()=>{});
    }
    return data;
  }
  async function ensureItemsLoaded(){
    if(window.ALL_ITEMS.length){
      if(!ITEMS_BY_SECTION.size) rebuildSectionIndex();
      return window.ALL_ITEMS;
    }
    if(!itemsLoadPromise){
      itemsLoadPromise=(async()=>{
        const data=await loadItemsOnce(DATA_URL);
        applyItemsData(data);
        return window.ALL_ITEMS;
      })().catch(err=>{ itemsLoadPromise=null; throw err; });
    }
    return itemsLoadPromise;
  }
  async function ensureDataLoaded(){
    await ensureItemsLoaded();
    if(!SRS_MAP.size){
      try{ const arr=await fetchJson('./data/srs.json'); const m=new Map(); for(const x of arr) m.set(x.id,x); SRS_MAP=m; }
      catch(_){ SRS_MAP=new Map(); }
    }
  }

  // Build section options (All/単一)
  async function finalizeActiveSession({ flushLogs=false }={}){
    if(!(sessionActive || sessionStarting)) return false;
    stopAudio();
    if(recognitionController && recognitionController.isActive()){
      try{ await stopRec(); }
      catch(_){ }
    }
    setMicState(false);
    finalizeSessionMetrics();
    sessionActive=false;
    sessionStarting=false;
    if(flushLogs){
      try{ await flushPendingLogs(); }
      catch(err){ console.warn('finalizeActiveSession', err); }
    }
    return true;
  }

  if(typeof document!=='undefined'){
    const handleVisibilityExit=()=>{
      if(document.visibilityState !== 'hidden') return;
      finalizeActiveSession({ flushLogs:true }).catch(()=>{});
    };
    document.addEventListener('visibilitychange', handleVisibilityExit);
  }

  function initSectionPicker(){
    updateSectionOptions({preferSaved:true});
    const sel=el.secSel;
    sel.onchange=()=>{
      saveString(SECTION_SELECTION, sel.value);
      rebuildAndRender(true);
    };
    const ordSaved=loadString(ORDER_SELECTION, 'asc')||'asc';
    el.orderSel.value=ordSaved;
    el.orderSel.onchange=()=>{
      saveString(ORDER_SELECTION, el.orderSel.value);
      rebuildAndRender(true);
    };
    if(el.search){
      const saved=loadSearchQuery();
      if(saved){
        el.search.value=saved;
      }
      let lastAppliedSearch=currentSearchQuery();
      let searchTimer=null;
      const resetSessionForSearch=()=>finalizeActiveSession();
      const applySearchChange=(fromChange=false)=>{
        if(searchTimer){
          clearTimeout(searchTimer);
          searchTimer=null;
        }
        const trimmed=currentSearchQuery();
        if(fromChange && el.search.value!==trimmed){
          el.search.value=trimmed;
        }
        saveSearchQuery(trimmed);
        if(trimmed===lastAppliedSearch){
          return;
        }
        lastAppliedSearch=trimmed;
        updateHeaderStats();
        const resetPromise=resetSessionForSearch();
        lastEmptySearchToast='';
        Promise.resolve(resetPromise)
          .catch(()=>{})
          .finally(()=>{ rebuildAndRender(true,{autoStart:false}); });
        return;
      };
      const scheduleSearchChange=()=>{
        if(searchTimer){
          clearTimeout(searchTimer);
        }
        searchTimer=setTimeout(()=>{
          applySearchChange(false);
        }, 220);
      };
      el.search.addEventListener('input', ()=>{
        saveSearchQuery(el.search.value.trim());
        scheduleSearchChange();
      });
      el.search.addEventListener('change', ()=>{
        applySearchChange(true);
      });
    }
    initLevelFilterUI();
  }

  function getRandomIndex(maxExclusive){
    if(maxExclusive<=0) return 0;
    const cryptoObj = (typeof window!=='undefined' && window.crypto && window.crypto.getRandomValues) ? window.crypto : null;
    if(!cryptoObj) return Math.floor(Math.random()*maxExclusive);
    const randArr=new Uint32Array(1);
    const limit=Math.floor(0x100000000/maxExclusive)*maxExclusive;
    let val;
    do{
      cryptoObj.getRandomValues(randArr);
      val=randArr[0];
    }while(val>=limit);
    return val%maxExclusive;
  }
  function shuffledCopy(arr){
    if(!Array.isArray(arr)||arr.length<=1) return Array.isArray(arr)?arr.slice():[];
    const copy=arr.slice();
    for(let i=copy.length-1;i>0;i--){
      const j=getRandomIndex(i+1);
      if(i!==j){
        [copy[i],copy[j]]=[copy[j],copy[i]];
      }
    }
    return copy;
  }
  function resetComposeGuide(){
    composeGuide.reset();
  }
  function setupComposeGuide(item){
    composeGuide.setup(item);
  }
  function buildQueue(){
    const sec=el.secSel.value;
    const order=el.orderSel.value;
    const baseItems=sec ? (ITEMS_BY_SECTION.get(sec)||[]) : window.ALL_ITEMS;
    let items=Array.isArray(baseItems) ? baseItems.filter(Boolean) : [];
    const drillMode=isDrillMode();
    const levels=getActiveLevelArray();
    if(levels.length && levels.length<LEVEL_CHOICES.length){
      const levelSet=new Set(levels);
      items=items.filter(x=>levelSet.has(lastRecordedLevel(x.id)));
    }
    const query=currentSearchQuery().toLowerCase();
    if(query){
      items=items.filter(it=>{
        const en=String(it.en||'').toLowerCase();
        const ja=String(it.ja||'').toLowerCase();
        const tags=String(it.tags||'').toLowerCase();
        return en.includes(query) || ja.includes(query) || tags.includes(query);
      });
    }
    if(drillMode){
      items=difficultyTracker.sortByDifficulty(items);
    }else if(order==='rnd'){
      items=shuffledCopy(items);
    }else{
      items=items.slice().sort((a,b)=>{
        const na=+String(a.unit||'').replace(/\D+/g,'')||0;
        const nb=+String(b.unit||'').replace(/\D+/g,'')||0;
        if(na!==nb) return na-nb;
        return String(a.id).localeCompare(String(b.id));
      });
    }
    return items.map(it=>{
      const forceSpeech=!!(it&&(
        it.forceSpeech || it.force_speech || it.speech_force || it.speechOnly || it.speech_only
      ));
      return {
        id:it.id,
        en:it.en,
        ja:it.ja,
        tags:it.tags||'',
        chunks_json:it.chunks||'[]',
        audio_fn:it.audio_fn||'',
        forceSpeech
      };
    });
  }

  // Audio resolve: DIR (folder) -> OPFS -> base URL
  const audioUrlCache=new Map();
  async function resolveFromDir(name){ try{ const d=await ensureDir(); if(!d||!name) return ''; const fh=await d.getFileHandle(name).catch(()=>null); if(!fh) return ''; const f=await fh.getFile(); return URL.createObjectURL(f); }catch(_){ return ''; } }
  async function resolveFromOPFS(name){ if(!name) return ''; try{ if(!(navigator.storage&&navigator.storage.getDirectory)) return ''; const root=await navigator.storage.getDirectory(); const fh=await root.getFileHandle(name).catch(()=>null); if(!fh) return ''; const file=await fh.getFile(); return URL.createObjectURL(file); }catch(_){ return ''; } }
  async function resolveAudioUrl(name){ if(!name) return ''; if(audioUrlCache.has(name)) return audioUrlCache.get(name); let url=await resolveFromDir(name); if(!url) url=await resolveFromOPFS(name); if(!url){ const base=(CFG.audioBase||'./audio').replace(/\/$/,''); url= base + '/' + encodeURI(name); } audioUrlCache.set(name,url); return url; }

  // Render & navigation
  function stopAudio(){ resetResumeAfterMicStart(); try{audio.pause();}catch(_){ } audio.currentTime=0; speechController.cancelSpeech(); }
  async function tryPlayAudio({userInitiated=false, resetPosition=false}={}){
    const hasSrc=!!(audio?.dataset?.srcKey);
    const item=currentItem;
    const playbackMode=getPlaybackMode();
    const speechForced=!!(item&&item.forceSpeech);
    const speechDesired=!!currentShouldUseSpeech;
    const speechAllowed=speechDesired && (playbackMode==='speech' || speechForced);
    const audioAllowed=shouldUseAudioForItem(item);
    if(speechAllowed){
      const controllerCanSpeak = speechController ? speechController.canSpeakCurrentCard() : false;
      if(!controllerCanSpeak){
        if(userInitiated){
          if(!speechController || !speechController.supported()) toast('音声合成に未対応のため再生できません');
          else toast('音声合成を開始できませんでした');
        }
        return false;
      }
      const speechOk=await speechController.speakCurrentCard({ preferredVoiceId: CFG.speechVoice });
      if(speechOk){
        if(userInitiated){
          autoPlayUnlocked=true;
        }
        return true;
      }
      if(userInitiated){
        if(!speechController || !speechController.supported()) toast('音声合成に未対応のため再生できません');
        else toast('音声合成を開始できませんでした');
      }
      return false;
    }
    if(speechDesired && !speechAllowed){
      if(userInitiated && speechForced){
        toast('このカードは合成音声のみ対応です');
      }
      return false;
    }
    if(!audioAllowed){
      if(userInitiated){
        if(playbackMode==='speech' || speechForced){
          if(!speechController || !speechController.supported()){ toast('音声合成に未対応のため再生できません'); }
        }
      }
      return false;
    }
    if(!hasSrc){
      if(userInitiated) toast('音声が見つかりません');
      return false;
    }
    if(resetPosition){
      try{ audio.currentTime=0; }catch(_){ }
    }
    speechController.cancelSpeech();
    try{
      const playPromise=audio.play();
      if(playPromise && typeof playPromise.then==='function'){
        await playPromise;
      }
      if(userInitiated){
        autoPlayUnlocked=true;
      }
      return true;
    }catch(err){
      console.warn('audio play failed', err);
      if(userInitiated){
        let reason='音声を再生できませんでした';
        if(err){
          if(err.name==='NotAllowedError'){ reason='ブラウザにブロックされました。端末の音量設定などを確認して再度タップしてください'; }
          else if(err.message||err.name){ reason=err.message||err.name; }
        }
        toast(`音声を再生できません: ${reason}`);
      }
      return false;
    }
  }
  function resetResult(){ updateMatch(null); }
  function resetTranscript(){
    const transcriptEl=qs('#transcript');
    if(!transcriptEl) return;
    if(RECOGNITION_SUPPORTED){
      transcriptEl.innerHTML='';
    }else{
      transcriptEl.textContent='この端末では音声入力を利用できません。';
    }
  }
  function toggleJA(){ advanceHintStage(); }

  function showIdleCard(){
    clearLastProgressNote();
    finalizeSessionMetrics();
    sessionActive=false;
    sessionStarting=false;
    drillPanel.hide();
    stopAudio();
    speechController.cancelSpeech();
    clearAudioSource();
    currentShouldUseSpeech=false;
    autoPlayUnlocked=false;
    updatePlayVisualState();
    updatePlayButtonAvailability();
    if(el.play){ el.play.disabled=true; }
    const query=currentSearchQuery();
    const hasQueue=QUEUE.length>0;
    const emptyWithSearch=!!query && !hasQueue;
    el.en.textContent = hasQueue ? '出題を準備しています…' : (emptyWithSearch ? '検索結果がありません' : '出題できる問題がありません');
    el.en.classList.remove('concealed');
    delete el.en.dataset.itemId;
    if(recognitionController){ recognitionController.clearHighlight(); }
    el.ja.textContent = '—';
    el.ja.style.display = 'none';
    el.chips.innerHTML = '';
    resetComposeGuide();
    currentItem=null;
    currentEnHtml='';
    hintStage=BASE_HINT_STAGE;
    maxHintStageUsed=BASE_HINT_STAGE;
    refreshLevelDisplay(null);
    cardStart = now();
    sessionStart = 0;
    failCount = 0;
    resetResult();
    resetTranscript();
    updateAttemptInfo();
    hideNextCta();
    setMicState(false);
    el.mic.disabled = true;
    el.next.hidden = true;
    el.pbar.value = 0;
    el.footer.textContent = hasQueue ? '準備が整い次第、自動で開始します' : (emptyWithSearch ? '検索条件に一致する問題がありません' : 'キューが空です');
    if(emptyWithSearch){
      if(lastEmptySearchToast!==query){
        toast('検索条件に一致する項目がありません');
        lastEmptySearchToast=query;
      }
    }else{
      lastEmptySearchToast='';
    }
    updateHeaderStats();
  }

  async function render(i, autoPlay=false){
    clearLastProgressNote();
    let releaseResolve=null;
    let releasePrepare=null;
    try{
      stopAudio();
      currentShouldUseSpeech=false;
      updatePlayButtonAvailability();
      const it=QUEUE[i];
      if(!it){
        el.footer.textContent='キューが空です';
        clearAudioSource();
        return;
      }
      currentItem=it;
      currentEnHtml=spanify(it.en);
      el.en.classList.remove('concealed');
      el.en.dataset.itemId = it.id || '';
      el.en.innerHTML=currentEnHtml;
      if(recognitionController){ recognitionController.clearHighlight(); }
      setupComposeGuide(it);
      if(isDrillMode()){
        await drillPanel.loadItem(it);
      }else{
        drillPanel.hide();
      }
      el.ja.textContent=it.ja;
      el.chips.innerHTML='';
      (it.tags||'').split(',').filter(Boolean).forEach(t=>{ const s=document.createElement('span'); s.className='chip'; s.textContent=t.trim(); el.chips.appendChild(s); });
      const levelInfo=getLevelInfo(it.id);
      refreshLevelDisplay(levelInfo);
      setHintStage(BASE_HINT_STAGE,{reset:true});
      const allowAudio=shouldUseAudioForItem(it);
      let url='';
      if(allowAudio){
        const hasDirAudio=!!DIR;
        const needsResolveLoader = !!(hasDirAudio && it.audio_fn && !audioUrlCache.has(it.audio_fn));
        releaseResolve = needsResolveLoader ? acquireOverlay('audio-resolve') : null;
        try{
          url=await resolveAudioUrl(it.audio_fn);
        }finally{
          releaseResolve?.();
          releaseResolve=null;
        }
        if(url){
          const needsPrepareLoader = hasDirAudio && (audio.dataset.srcKey !== url || audio.readyState<2);
          releasePrepare = needsPrepareLoader ? acquireOverlay('audio-prepare') : null;
          try{
            await setAudioSource(url);
            if(audio.readyState<2){
              const retryPrime=primeAudio(it, url, {shouldUseAudioForItem, resolveAudioUrl});
              if(retryPrime){
                try{ await retryPrime; }catch(err){ console.warn('primeAudio retry failed', err); }
              }
              await setAudioSource(url,{timeout:4000, forceReload:true});
              if(audio.readyState<2){
                console.warn('Audio not ready after retry', it && it.id, url);
              }
            }
          }finally{
            releasePrepare?.();
            releasePrepare=null;
          }
        }else{
          clearAudioSource();
        }
      }else{
        clearAudioSource();
      }
      currentShouldUseSpeech=shouldUseSpeechForItem(it);
      updatePlayButtonAvailability();
      cardStart=now();
      resetResult();
      resetTranscript();
      lastMatchEval=null;
      failCount=0;
      updateAttemptInfo();
      hideNextCta();
      setMicState(false);
      el.mic.disabled=!RECOGNITION_SUPPORTED;
      if(shouldUseAudioForItem(QUEUE[i+1])){ primeAudio(QUEUE[i+1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(shouldUseAudioForItem(QUEUE[i-1])){ primeAudio(QUEUE[i-1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(autoPlay && isAutoPlayAllowed() && (url||currentShouldUseSpeech)){
        try{
          await tryPlayAudio({userInitiated:false, resetPosition:true});
        }catch(err){
          console.warn('auto play failed', err);
        }
      }
    }catch(err){
      releaseResolve?.();
      releasePrepare?.();
      console.error('render failed', err);
      toast('カードの表示に失敗しました');
      throw err;
    }finally{
      releaseResolve?.();
      releasePrepare?.();
    }
  }

  async function rebuildAndRender(resetIndex=false, {autoStart=true, autoPlay=false}={}){
    QUEUE=buildQueue();
    el.pbar.max=Math.max(1, QUEUE.length);
    hideNextCta();
    const allowAutoPlay=autoPlay && isAutoPlayAllowed();
    if(resetIndex){
      idx=-1;
      showIdleCard();
      if(autoStart && QUEUE.length){
        setTimeout(()=>{
          if(!sessionActive && !sessionStarting){
            startSession(allowAutoPlay);
          }
        }, 0);
      }
      return;
    }
    if(!sessionActive){
      showIdleCard();
      return;
    }
    if(!QUEUE.length){
      showIdleCard();
      return;
    }
    idx=Math.max(0, Math.min(idx, QUEUE.length-1));
    render(idx,false);
    el.pbar.value=idx;
    el.footer.textContent=`#${idx+1}/${QUEUE.length}`;
    updateHeaderStats();
  }

  function advanceToNextSection(){
    if(!el.secSel) return false;
    const options=[...el.secSel.options];
    if(!options.length) return false;
    const currentValue=el.secSel.value;
    const currentIndex=options.findIndex(opt=>opt.value===currentValue);
    if(currentIndex<0 || currentIndex>=options.length-1) return false;
    if(currentIndex===0 && currentValue==='') return false;
    const nextOpt=options[currentIndex+1];
    const nextValue=nextOpt.value;
    el.secSel.value=nextValue;
    saveString(SECTION_SELECTION, nextValue);
    hideNextCta();
    const label=nextOpt.textContent||nextOpt.label||nextValue||'次のセクション';
    toast(`セクション「${label}」へ進みます`);
    rebuildAndRender(true,{autoPlay:true})
      .then(()=>{
        if(!QUEUE.length){
          el.footer.textContent='次のセクションに出題がありません';
        }
      })
      .catch(err=>{ console.error(err); toast('次のセクションの読み込みに失敗しました'); });
    return true;
  }

  async function nextCard(first=false, autoPlay=false){
    if(!QUEUE.length){ el.footer.textContent='キューが空です'; clearAudioSource(); stopAudio(); return; }
    if(!sessionActive) return;
    if(!first && idx>=QUEUE.length-1){
      if(advanceToNextSection()) return;
      toast('最後のセクションまで完了しました');
      return;
    }
    const task=async ()=>{
      idx = first? 0 : Math.min(QUEUE.length-1, idx+1);
      const allowAutoPlay=autoPlay && autoPlayUnlocked && isAutoPlayAllowed();
      await render(idx, allowAutoPlay);
      el.pbar.value=idx;
      el.footer.textContent=`#${idx+1}/${QUEUE.length}`;
      updateHeaderStats();
    };
    return queueCardTransition('next', task, {animate:!first});
  }
  async function prevCard(autoPlay=false){
    if(!QUEUE.length) return;
    if(!sessionActive) return;
    const targetIdx=Math.max(0, idx-1);
    const animate=idx>0;
    const task=async ()=>{
      idx=targetIdx;
      const allowAutoPlay=autoPlay && autoPlayUnlocked && isAutoPlayAllowed();
      await render(idx, allowAutoPlay);
      el.pbar.value=idx;
      el.footer.textContent=`#${idx+1}/${QUEUE.length}`;
      updateHeaderStats();
    };
    return queueCardTransition('prev', task, {animate});
  }

  async function startSession(autoPlay=false){
    if(sessionActive || sessionStarting) return;
    if(!QUEUE.length){ showIdleCard(); return; }
    sessionStarting=true;
    try{
      if((CFG.apiUrl||'').trim()){
        syncProgressAndStatus().catch(err=>{ console.warn('startSession status', err); });
      }
      await ensureDir();
      sessionActive=true;
      sessionStart=now();
      beginSessionMetrics();
      idx=-1;
      if(RECOGNITION_SUPPORTED){
        el.mic.disabled=false;
      }
      try{
        const allowAutoPlay=autoPlay && isAutoPlayAllowed();
        await nextCard(true, allowAutoPlay);
      }catch(err){
        finalizeSessionMetrics();
        sessionActive=false;
        throw err;
      }
    }finally{
      sessionStarting=false;
    }
  }

  // Gestures
  let touchStart=null;
  const MIN_SWIPE_VELOCITY=0.35; // px/ms
  const MAX_SWIPE_DURATION=700; // ms
  const MAX_CARD_TILT=10; // deg
  const CARD_OPACITY_REDUCTION=0.4;
  const VERTICAL_SWIPE_THRESHOLD_SCALE=0.8; // allow shorter vertical swipes
  let cardDragFrame=0;
  let cardDragPending=null;
  let cardDragResetTimer=0;
  function getSwipeThresholds(){
    const width=window.innerWidth || document.documentElement.clientWidth || 0;
    const height=window.innerHeight || document.documentElement.clientHeight || 0;
    const base=Math.min(width, height) * 0.15;
    const minThreshold=45;
    const horizontal=Math.max(base, width * 0.2, minThreshold);
    const vertical=Math.max(base, height * 0.2, minThreshold) * VERTICAL_SWIPE_THRESHOLD_SCALE;
    return {
      horizontal,
      vertical,
    };
  }
  function cancelCardDragAnimation(){
    if(cardDragFrame){
      cancelAnimationFrame(cardDragFrame);
      cardDragFrame=0;
    }
  }
  function applyCardDragValues(values){
    if(!values) return;
    const card=el.card;
    if(!card) return;
    card.style.setProperty('--card-offset', `${values.offset}px`);
    card.style.setProperty('--card-tilt', `${values.tilt}deg`);
    card.style.setProperty('--card-opacity', `${values.opacity}`);
  }
  function scheduleCardDragValues(values){
    cardDragPending=values;
    if(cardDragFrame) return;
    cardDragFrame=requestAnimationFrame(()=>{
      cardDragFrame=0;
      if(!cardDragPending) return;
      const pending=cardDragPending;
      cardDragPending=null;
      applyCardDragValues(pending);
    });
  }
  function clearCardDragValues(){
    cardDragPending=null;
    cancelCardDragAnimation();
  }
  function removeCardDragProperties(){
    const card=el.card;
    if(!card) return;
    card.style.removeProperty('--card-offset');
    card.style.removeProperty('--card-tilt');
    card.style.removeProperty('--card-opacity');
  }
  function resetCardDrag({animate=true}={}){
    const card=el.card;
    if(!card) return;
    if(cardDragResetTimer){ clearTimeout(cardDragResetTimer); cardDragResetTimer=0; }
    if(animate){
      card.classList.remove('card-no-transition');
      scheduleCardDragValues({offset:0, tilt:0, opacity:1});
      cardDragResetTimer=setTimeout(()=>{
        cardDragResetTimer=0;
        if(touchStart) return;
        removeCardDragProperties();
      }, 400);
    }else{
      card.classList.add('card-no-transition');
      clearCardDragValues();
      removeCardDragProperties();
      requestAnimationFrame(()=>{ card.classList.remove('card-no-transition'); });
    }
  }
  function clearCardDragStyles(){
    const card=el.card;
    if(!card) return;
    if(cardDragResetTimer){ clearTimeout(cardDragResetTimer); cardDragResetTimer=0; }
    clearCardDragValues();
    card.classList.remove('card-no-transition');
    removeCardDragProperties();
  }
  function isSwipeExcludedTarget(target){
    if(!target) return false;
    let element=target;
    if(element.nodeType!==1){
      element=element.parentElement || null;
    }
    while(element){
      if(el.speedCtrl && element===el.speedCtrl) return true;
      if(element.classList && element.classList.contains('speed-ctrl')) return true;
      element=element.parentElement || null;
    }
    return false;
  }
  el.card.addEventListener('touchstart',(ev)=>{
    if(!sessionActive){ touchStart=null; return; }
    if(ev.touches?.length!==1){ touchStart=null; return; }
    const t=ev.touches[0];
    const originTarget=(t && t.target) || ev.target;
    if(isSwipeExcludedTarget(originTarget)){ touchStart=null; return; }
    touchStart={
      x:t.clientX,
      y:t.clientY,
      time:performance.now(),
      thresholds:getSwipeThresholds(),
      dragging:false,
      axis:null,
      lastDx:0,
      lastDy:0,
    };
  },{passive:true});
  el.card.addEventListener('touchmove',(ev)=>{
    if(!touchStart) return;
    if(!sessionActive){ touchStart=null; resetCardDrag({animate:false}); return; }
    if(ev.touches?.length!==1){
      if(touchStart.dragging){ resetCardDrag({animate:false}); }
      touchStart=null;
      return;
    }
    const t=ev.touches[0];
    const dx=t.clientX-touchStart.x;
    const dy=t.clientY-touchStart.y;
    const absDx=Math.abs(dx);
    const absDy=Math.abs(dy);
    const state=touchStart;
    const thresholds=state.thresholds || getSwipeThresholds();
    const horizontalThreshold=Math.max(1, thresholds.horizontal || 0);
    const directionLock=6;
    if(!state.axis){
      if(absDx<directionLock && absDy<directionLock){
        state.lastDx=dx;
        state.lastDy=dy;
        return;
      }
      if(absDy>absDx){
        state.axis='vertical';
        state.lastDx=dx;
        state.lastDy=dy;
        return;
      }
      state.axis='horizontal';
    }
    if(state.axis==='vertical'){
      state.lastDx=dx;
      state.lastDy=dy;
      return;
    }
    if(!state.dragging){
      state.dragging=true;
      const card=el.card;
      if(card){ card.classList.add('card-no-transition'); }
    }
    if(ev.cancelable) ev.preventDefault();
    const maxOffset=horizontalThreshold*1.2;
    const limitedDx=Math.max(-maxOffset, Math.min(maxOffset, dx));
    const absLimitedDx=Math.abs(limitedDx);
    const progress=Math.min(1, absLimitedDx/horizontalThreshold);
    const direction=limitedDx===0?0:(limitedDx>0?1:-1);
    const tilt=MAX_CARD_TILT*progress*direction;
    const opacity=Math.max(1-CARD_OPACITY_REDUCTION*progress, 1-CARD_OPACITY_REDUCTION);
    state.lastDx=limitedDx;
    state.lastDy=dy;
    scheduleCardDragValues({offset:limitedDx, tilt, opacity});
  },{passive:false});
  function handleTouchFinish(ev, canceled=false){
    if(!touchStart) return;
    const state=touchStart;
    touchStart=null;
    if(!sessionActive){ resetCardDrag({animate:false}); return; }
    if(canceled){ resetCardDrag({animate:state.dragging}); return; }
    const point=ev.changedTouches && ev.changedTouches[0];
    if(!point){ resetCardDrag({animate:state.dragging}); return; }
    const dx=point.clientX-state.x;
    const dy=point.clientY-state.y;
    const absDx=Math.abs(dx);
    const absDy=Math.abs(dy);
    const dt=Math.max(1, performance.now()-state.time);
    const horizontalVelocity=absDx/dt;
    const thresholds=state.thresholds || getSwipeThresholds();
    const horizontalThreshold=Math.max(1, thresholds.horizontal || 0);
    const verticalThreshold=Math.max(1, thresholds.vertical || thresholds.horizontal || 0);
    const axis=state.axis;
    const verticalPreferred=axis==='vertical';
    const horizontalDominant=absDx>absDy;
    const reachedHorizontal=absDx>=horizontalThreshold;
    if(state.dragging){
      if(!verticalPreferred && horizontalDominant && reachedHorizontal){
        clearCardDragStyles();
        const allowAuto=isAutoPlayAllowed();
        if(dx>0) prevCard(allowAuto);
        else nextCard(false, allowAuto);
        return;
      }
      resetCardDrag({animate:true});
      return;
    }
    const horizontalSwipe=!verticalPreferred && horizontalDominant && reachedHorizontal && horizontalVelocity>=MIN_SWIPE_VELOCITY && dt<=MAX_SWIPE_DURATION;
    if(horizontalSwipe){
      clearCardDragStyles();
      const allowAuto=isAutoPlayAllowed();
      if(dx>0) prevCard(allowAuto);
      else nextCard(false, allowAuto);
      return;
    }
    const verticalVelocity=absDy/dt;
    const reachedVertical=absDy>=verticalThreshold;
    const verticalCandidate=verticalPreferred || !horizontalDominant;
    const upwardSwipe=verticalCandidate && reachedVertical && verticalVelocity>=MIN_SWIPE_VELOCITY && dt<=MAX_SWIPE_DURATION && dy<0;
    if(upwardSwipe){
      resetCardDrag({animate:false});
      toggleJA();
      return;
    }
    resetCardDrag({animate:false});
  }
  el.card.addEventListener('touchend',(ev)=>{ handleTouchFinish(ev,false); },{passive:true});
  el.card.addEventListener('touchcancel',(ev)=>{ handleTouchFinish(ev,true); },{passive:true});
  el.en.addEventListener('click', async ()=>{ if(!sessionActive){ await startSession(false); } });
  el.next.onclick=()=> nextCard(false, isAutoPlayAllowed());
  el.play.addEventListener('click', async ()=>{
    if(sessionStarting) return;
    if(!sessionActive){ await startSession(false); }
    if(sessionStarting) return;
    if(!sessionActive){ return; }
    const hasSrc=!!audio.dataset.srcKey;
    const canSpeak=speechController ? speechController.canSpeakCurrentCard() : false;
    const audioPlaying=hasSrc && !audio.paused && !audio.ended;
    if(audioPlaying){
      resetResumeAfterMicStart();
      audio.pause();
      return;
    }
    if(speechController && speechController.isSpeaking()){
      resetResumeAfterMicStart();
      speechController.cancelSpeech();
      return;
    }
    if(!hasSrc && !canSpeak){ toast('音声が見つかりません'); return; }
    const shouldReset = hasSrc ? (audio.ended || audio.currentTime<=0.05) : false;
    await tryPlayAudio({userInitiated:true, resetPosition:shouldReset});
  });

  // ASR（改良：重複抑制・上限・多重一致防止）

  function showTranscriptInterim(text){ qs('#transcript').innerHTML=`<span class="interim">${text}</span>`; }
  function showTranscriptFinal(text){ qs('#transcript').textContent=text; }

  function initializeRecognitionController(){
    return createRecognitionController({
      enElement: el.en,
      getComposeNodes: ()=>composeGuide.getNodes(),
      getReferenceText: ()=>{
        const refItem=QUEUE[idx];
        return refItem ? refItem.en : el.en.textContent;
      },
      onTranscriptReset: resetTranscript,
      onTranscriptInterim: showTranscriptInterim,
      onTranscriptFinal: (text)=>{ showTranscriptFinal(text); },
      onMatchEvaluated: (info)=>{
        if(!info) return;
        lastMatchEval=Object.assign({}, info);
        const score=calcMatchScore(info.refCount, info.recall, info.precision);
        updateMatch(score);
      },
      onUnsupported: ()=>toast('この端末では音声認識が使えません'),
      onError: (e)=>{
        toast('ASRエラー: '+(e && e.error || ''));
        if(RECOGNITION_SUPPORTED){
          el.mic.disabled=false;
        }
      },
      onStart: ()=>{ setMicState(true); },
      onStop: ()=>{ setMicState(false); },
      onAutoStop: (result)=>{ stopRec(result).catch(()=>{}); },
      setMicState,
      playTone,
      setResumeAfterMicStart,
      clearResumeTimer,
      resetResumeAfterMicStart,
      shouldResumeAudio: ()=> audio && !audio.paused && !audio.ended,
      resumeAudio: ()=>{ if(audio?.src){ audio.play().catch(()=>{}); } },
    });
  }

  recognitionController=RECOGNITION_SUPPORTED ? initializeRecognitionController() : null;

  function startRec(){
    if(!RECOGNITION_SUPPORTED) return;
    if(el.mic.disabled) return;
    if(!recognitionController) return;
    if(recognitionController.isActive()) return;
    hideNextCta();
    lastMatchEval=null;
    recognitionController.start();
  }

  async function stopRec(result){
    if(!recognitionController) return;
    const outcome = result && result.ok ? result : recognitionController.stop();
    if(!outcome || !outcome.ok) return;
    const it = QUEUE[idx];
    if(!it){
      updateMatch(null);
      return;
    }
    const hyp = (outcome.transcript || '').trim();
    const refItem = QUEUE[idx];
    const refText = refItem ? refItem.en : el.en.textContent;
    const studyMode = getStudyMode();
    let matchInfo = outcome.matchInfo;
    if(!matchInfo || matchInfo.source !== hyp){
      matchInfo = recognitionController.matchAndHighlight(refText, hyp);
    }
    if(!matchInfo){
      lastMatchEval=null;
      updateMatch(null);
      return;
    }
    lastMatchEval = matchInfo;
    const { recall, precision, matched, missing, refCount, hypTokens, transcript } = matchInfo;
    const matchRate = calcMatchScore(refCount, recall, precision);
    updateMatch(matchRate);
    const prevInfoSnapshot = getLevelInfo(it.id);
    const hadPriorProgress = Number(prevInfoSnapshot?.best)>0 || Number(prevInfoSnapshot?.last)>0;
    let prevBest = Number(prevInfoSnapshot?.best||0);
    if(!Number.isFinite(prevBest) || prevBest<=0){
      prevBest = Number(prevInfoSnapshot?.last||0) || 0;
    }
    const stageUsed = maxHintStageUsed;
    const evaluation = evaluateLevel(matchRate, stageUsed);
    const updateTs = Date.now();
    const levelUpdate = updateLevelInfo(it.id, evaluation, {now:updateTs});
    const levelInfo = levelUpdate?.info;
    const levelCandidate = Number.isFinite(Number(evaluation?.candidate)) ? Number(evaluation.candidate) : 0;
    const lastLevelRaw = Number(levelUpdate?.finalLevel);
    const bestLevelRaw = Number(levelInfo?.best);
    const resolvedLastLevel = Number.isFinite(lastLevelRaw) ? lastLevelRaw : (Number.isFinite(bestLevelRaw) ? bestLevelRaw : levelCandidate);
    const resolvedBestLevel = Number.isFinite(bestLevelRaw) ? bestLevelRaw : resolvedLastLevel;
    const levelInfoBest = resolvedBestLevel;
    const gainedLevel5 = prevBest<5 && levelInfoBest>=5;
    refreshLevelDisplay(levelInfo);
    updateHeaderStats();

    if(levelInfoBest > prevBest){
      triggerMilestoneEffect('best',{level:levelInfoBest, previous:prevBest});
    }
    if(levelCandidate ===5){
      triggerMilestoneEffect('level5',{level:levelCandidate, matchRate});
    }else if(levelCandidate ===4){
      triggerMilestoneEffect('level4',{level:levelCandidate, matchRate});
    }

    const pct=Math.max(0, Math.round((matchRate||0)*100));
    const levelLabel = `Lv${resolvedLastLevel}`;
    const bestLabel = levelInfoBest>resolvedLastLevel ? ` (最高${levelInfoBest})` : '';

    const pass = !!evaluation?.pass;
    const missingCount = Array.isArray(missing) ? missing.length : 0;
    difficultyTracker.registerAttempt(it.id, { missingTokens: missingCount, failed: !pass, passed: pass });
    if(isDrillMode()){
      drillPanel.handleResult({ pass, missingTokens: missing });
      if(Array.isArray(QUEUE) && QUEUE.length){
        const currentId=it.id;
        const sorted=difficultyTracker.sortByDifficulty(QUEUE);
        const newIndex=sorted.findIndex(entry=>entry && entry.id===currentId);
        QUEUE=sorted;
        if(newIndex>=0){
          idx=newIndex;
          el.pbar.value=idx;
          el.footer.textContent=`#${idx+1}/${QUEUE.length}`;
        }
      }
    }
    const responseMs = cardStart>0 ? Math.max(0, now()-cardStart) : '';
    const srsPayload = (()=>{
      const info=levelInfo||{};
      const historyRaw=Array.isArray(info.noHintHistory)?info.noHintHistory:[];
      const history=historyRaw
        .map(v=>Number(v))
        .filter(v=>Number.isFinite(v) && v>0);
      const promotionBlockedRaw=levelUpdate?.promotionBlocked || null;
      const promotionBlocked=promotionBlockedRaw?Object.assign({}, promotionBlockedRaw):null;
      const nextTargetRaw=levelUpdate?.nextTarget || null;
      const nextTarget=nextTargetRaw?Object.assign({}, nextTargetRaw):null;
      return {
        ts: toIsoString(updateTs) || new Date().toISOString(),
        id: it.id,
        level_candidate: numericOrEmpty(levelCandidate),
        level_final: numericOrEmpty(levelUpdate?.finalLevel),
        level_last: numericOrEmpty(info.last),
        level_best: numericOrEmpty(info.best),
        hint_stage: numericOrEmpty(info.hintStage),
        last_match: numericOrEmpty(info.lastMatch),
        no_hint_streak: numericOrEmpty(info.noHintStreak),
        no_hint_history: history,
        last_no_hint_at: toIsoString(info.lastNoHintAt),
        level5_count: numericOrEmpty(info.level5Count),
        level_updated_at: toIsoString(info.updatedAt),
        promotion_blocked: promotionBlocked,
        next_target: nextTarget,
      };
    })();
    const attemptPayload = {
      ts: new Date().toISOString(),
      id: it.id,
      result: pass ? 'pass' : 'fail',
      auto_recall: +recall.toFixed(3),
      auto_precision: +precision.toFixed(3),
      response_ms: responseMs,
      hint_used: stageUsed>BASE_HINT_STAGE ? 1 : 0,
      hint_stage: stageUsed,
      hint_en_used: stageUsed>=getEnglishRevealStage() ? 1 : 0,
      device: UA
    };
    const progressNote = buildNoHintProgressNote(levelUpdate?.nextTarget);
    if(pass){
      setLastProgressNote(progressNote);
      if(sessionMetrics && sessionMetrics.startMs){
        sessionMetrics.cardsDone+=1;
        sessionMetrics.currentStreak+=1;
        if(!hadPriorProgress){
          sessionMetrics.newIntroduced+=1;
        }
        if(sessionMetrics.currentStreak>sessionMetrics.highestStreak){
          sessionMetrics.highestStreak=sessionMetrics.currentStreak;
        }
      }
      failCount=0;
      playTone('success');
      showNextCta();
      el.footer.textContent='';
      if(levelCandidate>=4 && evaluation?.noHintSuccess){
        const baseToast = evaluation?.perfectNoHint ? 'ノーヒントで満点クリア！' : '素晴らしい！ノーヒント合格';
        toast(baseToast, 2000);
      }else{
        toast('Great! 合格です', 1600);
      }
      recordStudyProgress({
        pass:true,
        newLevel5:gainedLevel5,
        noHint:!!evaluation?.noHintSuccess,
        perfect:!!evaluation?.perfectNoHint,
        streak:Number(levelInfo?.noHintStreak)||0,
        mode:studyMode
      });
    }else{
      clearLastProgressNote();
      if(sessionMetrics && sessionMetrics.startMs){
        sessionMetrics.currentStreak=0;
      }
      failCount++;
      playTone('fail');
      if(failCount>=FAIL_LIMIT){
        el.footer.textContent = `3回失敗。${levelLabel}で次へ進みます`;
        toast('不合格で次へ進みます', 1600);
        el.mic.disabled=true;
        setTimeout(()=>{ hideNextCta(); nextCard(false, isAutoPlayAllowed()); }, 900);
      }else{
        el.footer.textContent = `一致率${pct}%：${levelLabel}${bestLabel} 維持のため再挑戦 (${failCount}/${FAIL_LIMIT})`;
        toast('70%未満。もう一度チャレンジ！', 1600);
      }
    }
    updateAttemptInfo();

    // Persist the locally-tracked level information to the GAS spreadsheet log as well.
    const payload = {
      ts: new Date().toISOString(), id: it.id, mode: studyMode,
      wer: +(1-recall).toFixed(3), cer: +(1-precision).toFixed(3),
      latency_ms: 0,
      words_spoken: (hypTokens||toks(hyp)).length,
      transcript: transcript || hyp,
      transcript_raw: hyp,
      matched_tokens_json: JSON.stringify(matched),
      missing_tokens_json: JSON.stringify(missing),
      recall:+recall.toFixed(3), precision:+precision.toFixed(3),
      match:+(matchRate||0).toFixed(3),
      hint_stage:stageUsed,
      level_last:levelInfo?.last ?? levelCandidate,
      level_best:levelInfo?.best ?? levelCandidate,
      level5_count:levelInfo?.level5Count||0,
      streak:levelInfo?.noHintStreak||0,
      no_hint_successes:Array.isArray(levelInfo?.noHintHistory)?levelInfo.noHintHistory.length:0,
      next_level_target:levelUpdate?.nextTarget?.target||null,
      next_level_remaining:levelUpdate?.nextTarget?.remaining ?? null,
      next_level_available_at:levelUpdate?.nextTarget?.nextEligibleAt ? new Date(levelUpdate.nextTarget.nextEligibleAt).toISOString() : null,
      study_mode: studyMode
    };
    if(!pass && failCount<FAIL_LIMIT && RECOGNITION_SUPPORTED){ el.mic.disabled=false; }
    sendLog('srs', srsPayload);
    sendLog('attempt', attemptPayload);
    sendLog('speech', payload);
  }

  el.mic.onclick=()=>{
    if(!RECOGNITION_SUPPORTED) return;
    const active=recognitionController && recognitionController.isActive();
    if(!active){ startRec(); }
    else{ stopRec(); }
  };
  // Boot
  async function bootApp(){
    const releaseBoot=acquireOverlay('boot');
    try{
      await ensureDir({prompt:true, forceCheck:true, allowSchedule:false});
      if(DIR && dirNeedsGesture){
        await gateDirPermissionBeforeBoot();
      }
      await ensureDataLoaded();
      updateHeaderStats();
      initSectionPicker();
      refreshDirStatus();
      await rebuildAndRender(true);
      maybeShowFooterInfoIntroToast();
      syncProgressAndStatus().catch(()=>{});
    }catch(e){
      console.error(e);
      toast('初期化失敗: '+(e&&e.message||e));
    }finally{
      releaseBoot();
    }
  }

  return {
    boot: bootApp,
  };
}

async function initApp(){
  const runtime=createAppRuntime();
  await runtime.boot();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

async function waitForDomReady() {
  if (document.readyState === 'loading') {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
}

async function bootstrap() {
  try {
    await waitForDomReady();
    await initApp();
  } catch (err) {
    console.error('App init failed', err);
  } finally {
    registerServiceWorker();
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
});
