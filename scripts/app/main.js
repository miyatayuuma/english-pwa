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
  calcMatchScore
} from '../speech/recognition.js';
import { createSpeechSynthesisController } from '../speech/synthesis.js';
import { createOverlayController } from './overlay.js';
import { createCardTransitionQueue } from './cardTransitions.js';
import { createComposeGuide } from './composeGuide.js';
import { qs, qsa } from './dom.js';

async function initApp(){
  // ===== Utilities =====
  const now=()=>Date.now(); const UA=(()=>navigator.userAgent||'')();

  const {LEVEL_STATE, LEVEL_FILTER, SEARCH, SPEED, CONFIG, PENDING_LOGS: PENDING_LOGS_KEY, SECTION_SELECTION, ORDER_SELECTION}=STORAGE_KEYS;

  function loadLevelState(){ return loadJson(LEVEL_STATE, {}) || {}; }
  function saveLevelState(state){ saveJson(LEVEL_STATE, state||{}); }
  let levelStateMap=loadLevelState();
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
  const LEVEL_CHOICES=[0,1,2,3,4,5];
  const LEGACY_LEVEL_CHOICES=[1,2,3,4,5];
  const NO_HINT_RATE_THRESHOLD=0.90;
  const PERFECT_MATCH_THRESHOLD=0.999;
  const PROMOTION_RULES={
    4:{required:2,minIntervalMs:12*60*60*1000},
    5:{required:3,minIntervalMs:24*60*60*1000}
  };
  const NO_HINT_HISTORY_LIMIT=24;
  function normalizeNoHintHistory(raw){
    if(!Array.isArray(raw)) return [];
    return raw
      .map(v=>Number(v)||0)
      .filter(v=>Number.isFinite(v) && v>0)
      .sort((a,b)=>a-b)
      .slice(-NO_HINT_HISTORY_LIMIT);
  }
  function computeNoHintProgress(history, rule, now){
    const normalizedHistory=normalizeNoHintHistory(history);
    if(!rule){
      return {qualified:normalizedHistory.length,required:0,remaining:0,met:true,lastQualifiedAt:null,nextEligibleAt:null,countedThisAttempt:false};
    }
    const minInterval=Math.max(0, Number(rule.minIntervalMs)||0);
    const selected=[];
    let lastIncluded=-Infinity;
    for(const ts of normalizedHistory){
      if(!selected.length || ts-lastIncluded>=minInterval){
        selected.push(ts);
        lastIncluded=ts;
      }
    }
    const qualified=selected.length;
    const required=Math.max(0, Number(rule.required)||0);
    const met=qualified>=required && required>0 ? true : qualified>=required;
    const lastQualifiedAt=selected.length?selected[selected.length-1]:null;
    let nextEligibleAt=null;
    if(lastQualifiedAt && minInterval>0){
      const candidateTs=lastQualifiedAt+minInterval;
      if(!Number.isFinite(now) || candidateTs>now){
        nextEligibleAt=candidateTs;
      }
    }
    const countedThisAttempt=Number.isFinite(now) && lastQualifiedAt===now;
    const remaining=Math.max(0, required-qualified);
    return {qualified,required,remaining,met,lastQualifiedAt,nextEligibleAt,countedThisAttempt};
  }
  function determineNextTarget(info, candidate, finalLevel, promotionBlocked, now){
    if(!info) return null;
    const lastLevel=Number(info.last);
    const bestLevel=Number(info.best);
    const normalizedLast=Number.isFinite(lastLevel)?lastLevel:0;
    const normalizedBest=Number.isFinite(bestLevel)?bestLevel:0;
    let target=null;
    if(promotionBlocked && promotionBlocked.target){
      target=promotionBlocked.target;
    }else if(normalizedLast>=4){
      if(normalizedLast===4){
        target=5;
      }
    }else{
      const refLevel=Math.max(normalizedLast, normalizedBest);
      if(refLevel>=3){
        target=4;
      }
    }
    if(!target && normalizedLast===4){
      target=5;
    }
    if(!target || !PROMOTION_RULES[target]) return null;
    const rule=PROMOTION_RULES[target];
    const progress=computeNoHintProgress(info.noHintHistory, rule, now);
    const cooldownMs=progress.nextEligibleAt?Math.max(0, progress.nextEligibleAt-now):0;
    return {
      target,
      required:rule.required,
      qualified:progress.qualified,
      remaining:progress.remaining,
      minIntervalMs:rule.minIntervalMs,
      nextEligibleAt:progress.nextEligibleAt||null,
      cooldownMs,
      countedThisAttempt:progress.countedThisAttempt,
      met:progress.met
    };
  }
  function formatDurationMs(ms){
    if(!Number.isFinite(ms) || ms<=0) return '';
    const totalMinutes=Math.ceil(ms/60000);
    if(totalMinutes>=60){
      const hours=Math.floor(totalMinutes/60);
      const minutes=totalMinutes%60;
      if(minutes>0) return `${hours}時間${minutes}分`;
      return `${hours}時間`;
    }
    return `${Math.max(1,totalMinutes)}分`;
  }
  function buildNoHintProgressNote(goal){
    if(!goal) return '';
    const levelLabel=`Lv${goal.target}`;
    if((goal.remaining||0)<=0){
      return `${levelLabel}のノーヒント条件は準備OK！`;
    }
    let msg=`あと${goal.remaining}回ノーヒント合格で${levelLabel}`;
    if(goal.cooldownMs>0){
      const waitLabel=formatDurationMs(goal.cooldownMs);
      if(waitLabel){
        msg+=`（${waitLabel}後にカウント可）`;
      }
    }
    return msg;
  }
  function loadLevelFilter(){
    const parsed=loadJson(LEVEL_FILTER, null);
    if(Array.isArray(parsed)){
      const valid=parsed.map(n=>Number(n)).filter(n=>LEVEL_CHOICES.includes(n));
      if(valid.length){
        const set=new Set(valid);
        const coversLegacy=LEGACY_LEVEL_CHOICES.every(l=>set.has(l));
        if(coversLegacy && !set.has(0)) set.add(0);
        return set;
      }
    }
    return new Set(LEVEL_CHOICES);
  }
  function saveLevelFilter(set){
    if(!(set instanceof Set)) return;
    const arr=LEVEL_CHOICES.filter(l=>set.has(l));
    saveJson(LEVEL_FILTER, arr);
  }
  let levelFilterSet=loadLevelFilter();
  function activeLevelArray(){
    if(!(levelFilterSet instanceof Set) || levelFilterSet.size===0){
      levelFilterSet=new Set(LEVEL_CHOICES);
    }
    const arr=LEVEL_CHOICES.filter(l=>levelFilterSet.has(l));
    return arr.length?arr:LEVEL_CHOICES.slice();
  }
  function evaluateLevel(matchRate, hintStageUsed){
    const rate=Math.max(0, Math.min(1, Number(matchRate)||0));
    const stageRaw=Number.isFinite(hintStageUsed)?Math.floor(hintStageUsed):BASE_HINT_STAGE;
    const stage=Math.max(BASE_HINT_STAGE, stageRaw);
    let candidate=1;
    if(rate<0.70){
      candidate=1;
    }else if(rate<0.80){
      candidate=2;
    }else if(rate<0.90){
      candidate=3;
    }else{
      const usedEnglishHint=stage>=BASE_HINT_STAGE+1;
      if(usedEnglishHint){
        candidate=3;
      }else if(rate<1){
        candidate=4;
      }else{
        candidate=5;
      }
    }
    const usedEnglishHint = stage >= BASE_HINT_STAGE + 1;
    const noHintSuccess=!usedEnglishHint && rate>=NO_HINT_RATE_THRESHOLD;
    const perfectNoHint=noHintSuccess && rate>=PERFECT_MATCH_THRESHOLD;
    const pass=rate>=0.70;
    return {candidate, rate, stage, noHintSuccess, perfectNoHint, usedEnglishHint, pass};
  }
  function getLevelInfo(id){
    if(!id) return {best:0,last:0};
    return levelStateMap[id] || {best:0,last:0};
  }
  function updateLevelInfo(id, evaluation, {now=Date.now()}={}){
    const fallbackCandidate=Number.isFinite(Number(evaluation?.candidate))?Number(evaluation.candidate):0;
    if(!id){
      const fallback={best:fallbackCandidate,last:fallbackCandidate};
      return {info:fallback,candidate:fallbackCandidate,finalLevel:fallbackCandidate,best:fallbackCandidate,promotionBlocked:null,nextTarget:null,evaluation};
    }
    const info=levelStateMap[id] || {best:0,last:0};
    const prevLastRaw=Number(info.last);
    const prevBestRaw=Number(info.best);
    const prevLast=Number.isFinite(prevLastRaw)?prevLastRaw:0;
    const prevBest=Number.isFinite(prevBestRaw)?prevBestRaw:0;
    const stage=Number.isFinite(evaluation?.stage)?Number(evaluation.stage):BASE_HINT_STAGE;
    const rate=Number(evaluation?.rate)||0;
    if(!Array.isArray(info.noHintHistory)) info.noHintHistory=[];
    const history=info.noHintHistory.slice();
    const noHintSuccess=!!evaluation?.noHintSuccess;
    if(noHintSuccess){
      history.push(now);
      const prevStreak=Number(info.noHintStreak)||0;
      info.noHintStreak=prevStreak+1;
      info.lastNoHintAt=now;
    }else{
      info.noHintStreak=0;
    }
    const perfectNoHint=!!evaluation?.perfectNoHint;
    let level5CountNumeric=Number(info.level5Count);
    if(!Number.isFinite(level5CountNumeric) || level5CountNumeric<0){
      level5CountNumeric=0;
    }
    if(perfectNoHint){
      level5CountNumeric+=1;
    }
    info.level5Count=level5CountNumeric;
    const normalizedHistory=normalizeNoHintHistory(history);
    info.noHintHistory=normalizedHistory;
    const candidate=Math.max(0, Math.floor(fallbackCandidate));
    let finalLevel=candidate;
    let promotionBlocked=null;
    if(candidate>prevLast && candidate>=4){
      const rule=PROMOTION_RULES[candidate];
      if(rule){
        const progress=computeNoHintProgress(normalizedHistory, rule, now);
        if(!progress.met || progress.remaining>0){
          finalLevel=prevLast;
          promotionBlocked=Object.assign({target:candidate,minIntervalMs:rule.minIntervalMs}, progress);
        }
      }
    }
    if(!Number.isFinite(finalLevel)) finalLevel=0;
    info.last=finalLevel;
    if(!Number.isFinite(prevBestRaw)) info.best=prevBest;
    if(info.last>prevBest) info.best=info.last;
    info.lastMatch=rate;
    info.hintStage=stage;
    info.updatedAt=now;
    levelStateMap[id]=info;
    saveLevelState(levelStateMap);
    const nextTarget=determineNextTarget(info, candidate, finalLevel, promotionBlocked, now);
    return {
      info,
      candidate,
      finalLevel:info.last,
      best:info.best,
      promotionBlocked,
      nextTarget,
      evaluation
    };
  }
  function refreshLevelDisplay(info){
    if(!el.level) return;
    if(!info){ el.level.textContent='—'; return; }
    const lastVal = Number(info.last);
    const bestVal = Number(info.best);
    const last = Number.isFinite(lastVal) ? lastVal : (Number.isFinite(bestVal) ? bestVal : 0);
    const best = Number.isFinite(bestVal) ? bestVal : last;
    el.level.textContent = Number.isFinite(best) && best>last ? `${last} / ${best}` : `${last}`;
  }

  function lastRecordedLevel(id){
    const info=getLevelInfo(id);
    if(!info) return 0;
    const lastVal=Number(info.last);
    if(Number.isFinite(lastVal)) return lastVal;
    const bestVal=Number(info.best);
    if(Number.isFinite(bestVal)) return bestVal;
    return 0;
  }

  function updateLevelFilterButtons(){
    if(!el.levelFilter) return;
    const active=new Set(activeLevelArray());
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
    const activeLevels=new Set(activeLevelArray());
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
        if(!(levelFilterSet instanceof Set)){
          levelFilterSet=new Set(LEVEL_CHOICES);
        }
        if(levelFilterSet.has(level)){
          if(levelFilterSet.size===1){
            levelFilterSet=new Set(LEVEL_CHOICES);
          }else{
            levelFilterSet.delete(level);
          }
        }else{
          levelFilterSet.add(level);
        }
        if(!levelFilterSet.size){
          levelFilterSet=new Set(LEVEL_CHOICES);
        }
        saveLevelFilter(levelFilterSet);
        updateLevelFilterButtons();
        rebuildAndRender(true);
      });
      btnWrap.appendChild(btn);
    }
    updateLevelFilterButtons();
  }


  // ===== Elements =====
  const el={ headerSection:qs('#statSection'), headerLevelAvg:qs('#statLevelAvg'), headerProgressCurrent:qs('#statProgressCurrent'), headerProgressTotal:qs('#statProgressTotal'), pbar:qs('#pbar'), footer:qs('#footerInfo'), en:qs('#enText'), ja:qs('#jaText'), chips:qs('#chips'), match:qs('#valMatch'), level:qs('#valLevel'), attempt:qs('#attemptInfo'), next:qs('#btnNext'), play:qs('#btnPlay'), mic:qs('#btnMic'), card:qs('#card'), secSel:qs('#secSel'), orderSel:qs('#orderSel'), search:qs('#rangeSearch'), levelFilter:qs('#levelFilter'), composeGuide:qs('#composeGuide'), composeTokens:qs('#composeTokens'), composeNote:qs('#composeNote'), cfgBtn:qs('#btnCfg'), cfgModal:qs('#cfgModal'), cfgUrl:qs('#cfgUrl'), cfgKey:qs('#cfgKey'), cfgAudioBase:qs('#cfgAudioBase'), cfgSpeechVoice:qs('#cfgSpeechVoice'), cfgSave:qs('#cfgSave'), cfgClose:qs('#cfgClose'), btnImport:qs('#btnImport'), filePick:qs('#filePick'), btnTestAudio:qs('#btnTestAudio'), btnPickDir:qs('#btnPickDir'), btnClearDir:qs('#btnClearDir'), dirStatus:qs('#dirStatus'), overlay:qs('#loadingOverlay'), dirPermOverlay:qs('#dirPermOverlay'), dirPermAllow:qs('#dirPermAllow'), dirPermLater:qs('#dirPermLater'), dirPermStatus:qs('#dirPermStatus'), speed:qs('#speedSlider'), speedDown:qs('#speedDown'), speedUp:qs('#speedUp'), speedValue:qs('#speedValue'), notifBtn:qs('#btnNotifPerm'), notifStatus:qs('#notifStatus') };
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

  const audioController=createAudioController({
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

  const {
    playTone,
    updatePlayButtonAvailability,
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

  function applyRemoteStatus(status){
    remoteStatus = status ? Object.assign({}, status) : null;
    updateHeaderStats();
  }

  const FAIL_LIMIT=3;
  let failCount=0;

  const BASE_HINT_STAGE=0;
  let hintStage=BASE_HINT_STAGE;
  let maxHintStageUsed=BASE_HINT_STAGE;
  let currentEnHtml='';
  let currentItem=null;

  speechController = createSpeechSynthesisController({
    setSpeechPlayingState,
    getCurrentItem: ()=>currentItem,
    isSpeechDesired: ()=>currentShouldUseSpeech,
  });
  speechController.setSpeechRate(audioController.getPlaybackRate());
  function setHintStage(stage,{reset=false}={}){
    const next=Math.max(0, Math.min(2, Number.isFinite(stage)?Math.floor(stage):0));
    const prev=hintStage;
    hintStage=next;
    if(reset){ maxHintStageUsed=next; }
    else if(next>maxHintStageUsed){ maxHintStageUsed=next; }
    if(next<=0){
      el.en.classList.add('concealed');
      el.en.innerHTML='<span class="hint-placeholder">カードをダブルタップして英文ヒントを表示（もう一度で和訳）</span>';
      el.ja.style.display='none';
      if(recognitionController){ recognitionController.clearHighlight(); }
    }else{
      el.en.classList.remove('concealed');
      el.en.innerHTML=currentEnHtml||'';
      el.ja.style.display = next>=2 ? 'block' : 'none';
      if(recognitionController && currentItem && lastMatchEval && lastMatchEval.source){
        lastMatchEval = recognitionController.matchAndHighlight(currentItem.en, lastMatchEval.source);
        const score=calcMatchScore(lastMatchEval.refCount, lastMatchEval.recall, lastMatchEval.precision);
        updateMatch(score);
      }
    }
    return prev!==next;
  }

  function advanceHintStage(){
    if(!sessionActive) return;
    const nextStage=(hintStage+1)%3;
    const changed=setHintStage(nextStage);
    if(changed){
      if(hintStage===1){ el.footer.textContent='英文ヒントを表示しました。もう一度で和訳ヒント。'; }
      else if(hintStage===2){ el.footer.textContent='和訳ヒントを表示しました'; }
      else if(hintStage===0){ el.footer.textContent='ヒントを非表示に戻しました。ダブルタップで再表示できます。'; }
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
    el.mic.disabled=false;
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
    CFG.studyMode = normalizedStudy===STUDY_MODE_COMPOSE ? STUDY_MODE_COMPOSE : STUDY_MODE_READ;
  }

  function getPlaybackMode(){
    return CFG.playbackMode==='speech' ? 'speech' : 'audio';
  }
  function getStudyMode(){
    return CFG.studyMode===STUDY_MODE_COMPOSE ? STUDY_MODE_COMPOSE : STUDY_MODE_READ;
  }
  function isComposeMode(){
    return getStudyMode()===STUDY_MODE_COMPOSE;
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

  function loadPendingLogs(){
    const raw=loadJson(PENDING_LOGS_KEY, []);
    if(Array.isArray(raw)) return raw.filter(entry=>entry&&entry.type&&entry.url);
    return [];
  }
  let PENDING_LOGS=loadPendingLogs();
  for(const entry of PENDING_LOGS){
    if(!entry.uid) entry.uid=generateUid();
    if(entry.data && !entry.data.client_uid) entry.data.client_uid=entry.uid;
  }
  rememberPending();
  function rememberPending(){ saveJson(PENDING_LOGS_KEY, PENDING_LOGS); }
  function generateUid(){ if(window.crypto?.randomUUID){ try{ return crypto.randomUUID(); }catch(_){ } } return 'uid-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
  let flushPromise=null;
  async function flushPendingLogs(){
    if(!PENDING_LOGS.length) return;
    if(flushPromise) return flushPromise;
    flushPromise=(async()=>{
      const accepted=new Set();
      const groups=new Map();
      for(const entry of PENDING_LOGS){
        if(!entry || !entry.url || !entry.type) continue;
        const key=`${entry.url}::${entry.apiKey||''}`;
        if(!groups.has(key)) groups.set(key,{url:entry.url, apiKey:entry.apiKey, items:[]});
        const data=Object.assign({}, entry.data||{});
        if(!data.client_uid) data.client_uid=entry.uid;
        groups.get(key).items.push({uid:entry.uid, type:entry.type, data});
      }
      for(const group of groups.values()){
        if(!group.items.length) continue;
        const payload={type:'bulk', apiKey:group.apiKey, entries:group.items};
        try{
          const res=await fetch(group.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload)});
          if(!res.ok) continue;
          let json=null;
          try{ json=await res.json(); }catch(_){ }
          if(json && json.ok){
            const ack=Array.isArray(json.accepted)?json.accepted:group.items.map(it=>it.uid);
            ack.forEach(uid=>accepted.add(uid));
          }
        }catch(err){ console.warn('flushPendingLogs', err); }
      }
      let changed=false;
      if(accepted.size){
        PENDING_LOGS=PENDING_LOGS.filter(entry=>!accepted.has(entry.uid));
        changed=true;
      }
      const cleaned=PENDING_LOGS.filter(entry=>entry && entry.url);
      if(cleaned.length!==PENDING_LOGS.length){
        PENDING_LOGS=cleaned;
        changed=true;
      }
      if(changed) rememberPending();
    })();
    try{
      await flushPromise;
    }finally{
      flushPromise=null;
    }
  }

  async function sendLog(type,data){
    const url=(CFG.apiUrl||'').trim();
    if(!url) return;
    const uid=generateUid();
    const payload=Object.assign({}, data||{});
    if(!payload.client_uid) payload.client_uid=uid;
    const entry={ uid, type, data:payload, url, apiKey:(CFG.apiKey||'')||undefined, createdAt:Date.now() };
    PENDING_LOGS.push(entry);
    rememberPending();
    try{ await flushPendingLogs(); }catch(err){ console.warn('sendLog', err); }
  }

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
  const notifHandlers = initNotificationSystem({
    statusEl: el.notifStatus,
    buttonEl: el.notifBtn,
    toast
  });
  if(el.notifBtn && notifHandlers?.handleClick){
    el.notifBtn.addEventListener('click', notifHandlers.handleClick);
  }
  if(typeof document!=='undefined' && notifHandlers?.handleVisibilityChange){
    document.addEventListener('visibilitychange', notifHandlers.handleVisibilityChange);
  }
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
        CFG.studyMode = selectedStudy && selectedStudy.value===STUDY_MODE_COMPOSE ? STUDY_MODE_COMPOSE : STUDY_MODE_READ;
      }else{
        CFG.studyMode=STUDY_MODE_READ;
      }
      if(el.cfgSpeechVoice){ CFG.speechVoice=el.cfgSpeechVoice.value||''; }
      saveCfg(CFG);
      const newStudyMode=getStudyMode();
      if((CFG.apiUrl||'').trim()){
        for(const entry of PENDING_LOGS){
          entry.url=CFG.apiUrl.trim();
          entry.apiKey=(CFG.apiKey||'')||undefined;
        }
      } else {
        for(const entry of PENDING_LOGS){
          entry.url='';
          entry.apiKey=undefined;
        }
        applyRemoteStatus(null);
      }
      rememberPending();
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
      const resetSessionForSearch=()=>{
        if(sessionActive || sessionStarting){
          stopAudio();
          if(recognitionController && recognitionController.isActive()){
            stopRec().catch(()=>{});
          }
          setMicState(false);
          sessionActive=false;
          sessionStarting=false;
        }
      };
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
        resetSessionForSearch();
        lastEmptySearchToast='';
        rebuildAndRender(true,{autoStart:false});
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
    const levels=activeLevelArray();
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
    if(order==='rnd'){
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
  function resetTranscript(){ qs('#transcript').innerHTML=''; }
  function toggleJA(){ advanceHintStage(); }

  function showIdleCard(){
    sessionActive=false;
    sessionStarting=false;
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
      el.mic.disabled=false;
      if(shouldUseAudioForItem(QUEUE[i+1])){ primeAudio(QUEUE[i+1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(shouldUseAudioForItem(QUEUE[i-1])){ primeAudio(QUEUE[i-1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(autoPlay&&(url||currentShouldUseSpeech)){
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
    if(resetIndex){
      idx=-1;
      showIdleCard();
      if(autoStart && QUEUE.length){
        setTimeout(()=>{
          if(!sessionActive && !sessionStarting){
            startSession(autoPlay);
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
      await render(idx, autoPlay && autoPlayUnlocked);
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
      await render(idx, autoPlay && autoPlayUnlocked);
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
      idx=-1;
      el.mic.disabled=false;
      try{
        await nextCard(true, autoPlay);
      }catch(err){
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
  let cardDragFrame=0;
  let cardDragPending=null;
  let cardDragResetTimer=0;
  function getSwipeThresholds(){
    const width=window.innerWidth || document.documentElement.clientWidth || 0;
    const height=window.innerHeight || document.documentElement.clientHeight || 0;
    const base=Math.min(width, height) * 0.15;
    const minThreshold=45;
    return {
      horizontal: Math.max(base, width * 0.2, minThreshold),
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
  el.card.addEventListener('touchstart',(ev)=>{
    if(!sessionActive){ touchStart=null; return; }
    if(ev.touches?.length!==1) return;
    const t=ev.touches[0];
    touchStart={
      x:t.clientX,
      y:t.clientY,
      time:performance.now(),
      thresholds:getSwipeThresholds(),
      dragging:false,
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
    const thresholds=touchStart.thresholds || getSwipeThresholds();
    const horizontalThreshold=Math.max(1, thresholds.horizontal || 0);
    const directionLock=6;
    if(!touchStart.dragging){
      if(absDx<directionLock && absDy<directionLock){
        touchStart.lastDx=dx;
        touchStart.lastDy=dy;
        return;
      }
      if(absDy>absDx){
        touchStart=null;
        resetCardDrag({animate:false});
        return;
      }
      touchStart.dragging=true;
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
    touchStart.lastDx=limitedDx;
    touchStart.lastDy=dy;
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
    const horizontalDominant=absDx>absDy;
    const reachedHorizontal=absDx>=horizontalThreshold;
    if(state.dragging){
      if(horizontalDominant && reachedHorizontal){
        clearCardDragStyles();
        if(dx>0) prevCard(true);
        else nextCard(false,true);
        return;
      }
      resetCardDrag({animate:true});
      return;
    }
    const horizontalSwipe=horizontalDominant && reachedHorizontal && horizontalVelocity>=MIN_SWIPE_VELOCITY && dt<=MAX_SWIPE_DURATION;
    if(horizontalSwipe){
      clearCardDragStyles();
      if(dx>0) prevCard(true);
      else nextCard(false,true);
    }else{
      resetCardDrag({animate:false});
    }
  }
  el.card.addEventListener('touchend',(ev)=>{ handleTouchFinish(ev,false); },{passive:true});
  el.card.addEventListener('touchcancel',(ev)=>{ handleTouchFinish(ev,true); },{passive:true});
  el.en.addEventListener('click', async ()=>{ if(!sessionActive){ await startSession(false); } });
  el.card.addEventListener('dblclick', ()=>{ if(!sessionActive) return; toggleJA(); });
  el.next.onclick=()=> nextCard(false,true);
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

  recognitionController = createRecognitionController({
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
      el.mic.disabled=false;
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

  function startRec(){
    if(el.mic.disabled) return;
    if(!recognitionController) return;
    if(recognitionController.isActive()) return;
    hideNextCta();
    lastMatchEval=null;
    const result=recognitionController.start();
    if(result && result.reason==='unsupported'){
      el.mic.disabled=false;
    }
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
    const progressNote = buildNoHintProgressNote(levelUpdate?.nextTarget);
    if(pass){
      failCount=0;
      playTone('success');
      showNextCta();
      const baseFooter = `一致率${pct}% ${levelLabel}${bestLabel}！「次へ」で進みましょう`;
      el.footer.textContent = progressNote ? `${baseFooter} ${progressNote}` : baseFooter;
      if(levelCandidate>=4 && evaluation?.noHintSuccess){
        const baseToast = evaluation?.perfectNoHint ? 'ノーヒントで満点クリア！' : '素晴らしい！ノーヒント合格';
        toast(progressNote ? `${baseToast} ${progressNote}` : `${baseToast}`, 2000);
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
      failCount++;
      playTone('fail');
      if(failCount>=FAIL_LIMIT){
        el.footer.textContent = `3回失敗。${levelLabel}で次へ進みます`;
        toast('不合格で次へ進みます', 1600);
        el.mic.disabled=true;
        setTimeout(()=>{ hideNextCta(); nextCard(false,true); }, 900);
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
    try{ await sendLog('speech', payload); }catch(_){ }
    if(!pass && failCount<FAIL_LIMIT){ el.mic.disabled=false; }
  }

  el.mic.onclick=()=>{
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
      syncProgressAndStatus().catch(()=>{});
    }catch(e){
      console.error(e);
      toast('初期化失敗: '+(e&&e.message||e));
    }finally{
      releaseBoot();
    }
  }

  bootApp();
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
