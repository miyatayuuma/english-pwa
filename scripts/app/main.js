Warning: truncated output (original token count: 45488)
Total output lines: 4378

import { isNativeAndroid } from '../native/runtimePlatform.js';
import { nativeDirectory } from '../native/media.js';
import { buildRecognitionBiasContext } from '../speech/contextualBias.js';
import { nativeSpeechDiagnostic } from '../native/androidSpeechBackend.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../speech/correctionProgress.js';
import { getActiveClozeRecognitionContext, clearActiveClozeRecognitionContext } from './clozeRecognitionContext.js';
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
  triggerMilestoneEffect,
  setMilestoneEffectIntensity
} from '../ui/milestones.js';
import {
  recordStudyProgress,
  updateNotificationUi,
  initNotificationSystem,
  getDailyStats,
  localDateKey,
  getNotificationSettings,
  saveNotificationSettings,
  normalizeNotificationSettings,
  computeNextNotificationCheckTime,
  ensureNotificationLoop,
  getConsecutiveNoStudyDays,
  computeWeeklyHighlights,
  recordSessionClosureSummary,
  getLatestSessionClosureSummaryBefore,
  recordShadowingExposure,
} from '../state/studyLog.js';
import { AUDIO_LOCK_STATES, createAudioController } from '../audio/controller.js';
import { configureSharedAudioResolver, createAudioUrlResolver } from '../audio/resolver.js';
import {
  createRecognitionController,
  calcMatchScore,
  hasRecognizedSpeech,
  isRecognitionSupported
} from '../speech/recognition.js';
import { createSpeechSynthesisController } from '../speech/synthesis.js';
import { clearPostResultReveal, isPostResultReveal, revealCanonicalPostResult } from './postResultFeedback.js';
import {
  TRAINING_MODES,
  buildShadowingExposure,
  isContinuousShadowingMode,
  normalizeTrainingMode,
} from './continuousShadowing.js';
import { MIC_UI_STATES, applyMicStatus } from './micStatus.js';
import { createResultFeedbackQueue, normalizeResultSoundMode } from './resultFeedbackSound.js';
import { createOverlayController } from './overlay.js';
import { createCardTransitionQueue } from './cardTransitions.js';
import { createReorderGuide } from './reorderGuide.js';
import { createReorderSrsPayload } from './reorderGrading.js';
import { createLogManager } from './logManager.js';
import { qs, qsa } from './dom.js';
import { createLevelStateManager, LEVEL_CHOICES, retainHighestHintStageUsed } from './levelState.js';
import { createViewStateController, VIEW_HOME, VIEW_STUDYING, VIEW_REVIEW_COMPLETE } from './viewState.js';
import { createGoalController, normalizeGoalValue } from './goalController.js';
import { createFilterController } from './filterController.js';
import { createSwUpdatePrompt } from './swUpdatePrompt.js';
import {
  consumeFocusedSessionPending,
  FOCUSED_SESSION_PREPARE_EVENT,
} from './adaptiveLearning.js';
import '../version.js';

const APP_VERSION = globalThis.APP_VERSION;
function createAppRuntime(){
  // ===== Utilities =====
  const now=()=>Date.now(); const UA=(()=>navigator.userAgent||'')();
  const DAY_MS=86400000;

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

  const DEFAULT_FOOTER_HINT='左右スワイプ：戻る/進む　下スワイプ：ヒント切替（英文・和訳・音声）';
  const LEVEL_DESCRIPTIONS={
    0:'Lv0: これから練習を始めるカードです。ヒントを使って流れを確認しましょう。',
    1:'Lv1: 音声や和訳ヒントを頼りに正しい形を身に付けていく段階です。',
    2:'Lv2: ノーヒントで通せる回数を増やし、聞き取り精度を上げましょう。',
    3:'Lv3: 安定してきました。ノーヒント合格を重ねて次のレベルを目指します。',
    4:'Lv4: ノーヒント連続合格でLv5が開放されます。リズムを崩さず復習しましょう。',
    5:'Lv5: 定着済みです。定期的な復習で維持しつつ新しいカードに挑戦しましょう。'
  };
  let footerInfoIntroShown=false;
  const MOBILE_MEDIA_QUERY='(max-width:640px)';
  const LONG_HINT_MESSAGE_COMPOSE_JA='和訳ヒントを表示しました。もう一度下スワイプで音声ヒント（再生ボタン）が使えます。さらにもう一度で英文ヒント。';
  const LONG_HINT_MESSAGE_COMPOSE_AUDIO='音声ヒントを有効化しました。再生ボタンが使えます。さらにもう一度下スワイプで英文ヒント。';
  const LONG_HINT_MESSAGE_READ_EN='英文ヒントを表示しました。もう一度下スワイプで和訳ヒント。';

  const DEFAULT_DAILY_GOAL=10;
  const DEFAULT_SESSION_GOAL=5;
  const RECOVERY_SESSION_TARGET=3;
  const goalState={ dailyTarget:DEFAULT_DAILY_GOAL, sessionTarget:DEFAULT_SESSION_GOAL, dailyDone:0, sessionDone:0, todayKey:'' };
  const goalMilestones={ daily:false, session:false };
  let lastPromotionGoal=null;
  let overviewCollapsed=false;
  const goalCollapsed={ daily:false, session:false };
  const onboardingState={ step:1, level:'', purpose:'', minutes:0, completed:false };
  let onboardingPlanSummary='';


  const { SEARCH, SPEED, CONFIG, DAILY_GOAL: DAILY_GOAL_KEY, SESSION_GOAL: SESSION_GOAL_KEY, PENDING_LOGS: PENDING_LOGS_KEY, SECTION_SELECTION, ORDER_SELECTION, DAILY_OVERVIEW, DAILY_GOAL_COLLAPSE, SESSION_GOAL_COLLAPSE, ONBOARDING_COMPLETED, ONBOARDING_PLAN, ONBOARDING_PLAN_COLLAPSE_DATE } = STORAGE_KEYS;

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






  // ===== Elements =====
  const el={ app:qs('#app'), homeView:qs('#homeView'), studyView:qs('#studyView'), reviewCompleteView:qs('#reviewCompleteView'), startStudyCta:qs('#startStudyCta'), reviewCompleteMessage:qs('#reviewCompleteMessage'), reviewActionContinue:qs('#reviewActionContinue'), reviewActionFocusReview:qs('#reviewActionFocusReview'), reviewActionFinish:qs('#reviewActionFinish'), headerSection:qs('#statSection'), headerLevelAvg:qs('#statLevelAvg'), headerProgressCurrent:qs('#statProgressCurrent'), headerProgressTotal:qs('#statProgressTotal'), pbar:qs('#pbar'), footer:qs('#footerMessage'), nextAction:qs('#nextActionMessage'), footerInfoContainer:qs('#footerInfo'), footerInfoBtn:qs('#footerInfoBtn'), footerInfoDialog:qs('#footerInfoDialog'), footerInfoDialogBody:qs('#footerInfoDialogBody'), en:qs('#enText'), ja:qs('#jaText'), chips:qs('#chips'), match:qs('#valMatch'), level:qs('#valLevel'), attempt:qs('#attemptInfo'), play:qs('#btnPlay'), mic:qs('#btnMic'), micStatus:qs('#micStatus'), card:qs('#card'), secSel:qs('#secSel'), studySecSel:qs('#studySecSel'), orderSel:qs('#orderSel'), search:qs('#rangeSearch'), levelFilter:qs('#levelFilter'), composeGuide:qs('#composeGuide'), composeTokens:qs('#composeTokens'), composeAnswer:qs('#composeAnswer'), composeContext:qs('#composeContext'), composeFeedback:qs('#composeFeedback'), composeControls:qs('#composeControls'), composeNote:qs('#composeNote'), cfgBtn:qs('#btnCfg'), cfgModal:qs('#cfgModal'), cfgUrl:qs('#cfgUrl'), cfgKey:qs('#cfgKey'), cfgAudioBase:qs('#cfgAudioBase'), cfgSpeechVoice:qs('#cfgSpeechVoice'), cfgResultSound:qs('#cfgResultSound'), cfgSave:qs('#cfgSave'), cfgClose:qs('#cfgClose'), btnPickDir:qs('#btnPickDir'), btnClearDir:qs('#btnClearDir'), dirStatus:qs('#dirStatus'), overlay:qs('#loadingOverlay'), dirPermOverlay:qs('#dirPermOverlay'), dirPermAllow:qs('#dirPermAllow'), dirPermLater:qs('#dirPermLater'), dirPermStatus:qs('#dirPermStatus'), speedCtrl:qs('#speedCtrl'), speedToggle:qs('#speedToggle'), speedCtrlBody:qs('#speedCtrlBody'), speed:qs('#speedSlider'), speedDown:qs('#speedDown'), speedUp:qs('#speedUp'), speedValue:qs('#speedValue'), notifBtn:qs('#btnNotifPerm'), notifStatus:qs('#notifStatus'), notifTimeList:qs('#notifTimeList'), notifTimeAdd:qs('#notifTimeAdd'), notifTriggerDailyZero:qs('#notifTriggerDailyZero'), notifTriggerDailyCompare:qs('#notifTriggerDailyCompare'), notifTriggerWeekly:qs('#notifTriggerWeekly'), notifTriggerRestartTone:qs('#notifTriggerRestartTone'), milestoneIntensity:qs('#cfgMilestoneIntensity'), notifHelp:qs('#notifHelp'), dailyGoalCard:qs('#dailyGoalCard'), dailyGoalBody:qs('#dailyGoalBody'), dailyGoalToggle:qs('#dailyGoalToggle'), dailyGoalToggleState:qs('#dailyGoalToggleState'), dailyGoalRing:qs('#dailyGoalRing'), dailyGoalPercent:qs('#dailyGoalPercent'), dailyGoalTag:qs('#dailyGoalTag'), dailyGoalDone:qs('#dailyGoalDone'), dailyGoalTarget:qs('#dailyGoalTarget'), dailyGoalHint:qs('#dailyGoalHint'), sessionGoalCard:qs('#sessionGoalCard'), sessionGoalBody:qs('#sessionGoalBody'), sessionGoalToggle:qs('#sessionGoalToggle'), sessionGoalRing:qs('#sessionGoalRing'), sessionGoalPercent:qs('#sessionGoalPercent'), sessionGoalTag:qs('#sessionGoalTag'), sessionGoalDone:qs('#sessionGoalDone'), sessionGoalTarget:qs('#sessionGoalTarget'), sessionGoalSlider:qs('#sessionGoalSlider'), sessionGoalBarFill:qs('#sessionGoalBarFill'), dailyOverviewCard:qs('#dailyOverviewCard'), dailyOverviewBody:qs('#dailyOverviewBody'), dailyOverviewToggle:qs('#dailyOverviewToggle'), dailyOverviewToggleState:qs('#dailyOverviewToggleState'), dailyOverviewDiff:qs('#dailyOverviewDiff'), dailyOverviewTrendStatus:qs('#dailyOverviewTrendStatus'), dailyOverviewNote:qs('#dailyOverviewNote'), overviewHighlights:qs('#dailyOverviewHighlights'), overviewTodayFill:qs('#overviewTodayFill'), overviewYesterdayFill:qs('#overviewYesterdayFill'), overviewTodayValue:qs('#overviewTodayValue'), overviewYesterdayValue:qs('#overviewYesterdayValue'), overviewPromotionStatus:qs('#overviewPromotionStatus'), overviewTaskBalance:qs('#overviewTaskBalance'), overviewMilestones:qs('#overviewMilestones'), overviewQuickStart:qs('#overviewQuickStart'), onboardingCard:qs('#onboardingCard'), onboardingStepLabel:qs('#onboardingStepLabel'), onboardingLevel:qs('#onboardingLevel'), onboardingPurpose:qs('#onboardingPurpose'), onboardingMinutes:qs('#onboardingMinutes'), onboardingBack:qs('#onboardingBack'), onboardingNext:qs('#onboardingNext'), personalPlanSummary:qs('#personalPlanSummary'), personalPlanBody:qs('#personalPlanBody'), personalPlanToggle:qs('#personalPlanToggle') };
  const viewStateController=createViewStateController({ el });
  const applyViewState=(...args)=>viewStateController.applyViewState(...args);
  const getCurrentViewState=(...args)=>viewStateController.getCurrentViewState(...args);
  function setViewState(...args){
    const nextView=applyViewState(...args);
    swUpdatePrompt?.handleViewStateChange?.(nextView);
    return nextView;
  }

  const goalController=createGoalController({
    el,
    goalState,
    goalMilestones,
    defaults:{ DEFAULT_DAILY_GOAL, DEFAULT_SESSION_GOAL, RECOVERY_SESSION_TARGET },
    storage:{ DAILY_GOAL_KEY, SESSION_GOAL_KEY },
    deps:{
      loadNumber,
      saveNumber,
      localDateKey,
      getDailyStats,
      toast,
      getSessionCardsDone:()=>sessionMetrics?.cardsDone||0,
      updateDailyOverview,
    },
  });
  const initGoals=(...args)=>goalController.initGoals(...args);
  const ensureDailyGoalFresh=(...args)=>goalController.ensureDailyGoalFresh(...args);
  const applyGoalTargetsToControls=(...args)=>goalController.applyGoalTargetsToControls(...args);
  const updateGoalProgressFromMetrics=(...args)=>goalController.updateGoalProgressFromMetrics(...args);
  const activateRecoverySessionTarget=(...args)=>goalController.activateRecoverySessionTarget(...args);
  const clearRecoverySessionTarget=(...args)=>goalController.clearRecoverySessionTarget(...args);
  const incrementGoalProgressForPass=(...args)=>goalController.incrementGoalProgressForPass(...args);
  const maybeShowGoalOverview=(...args)=>goalController.maybeShowGoalOverview(...args);

  const filterController=createFilterController({
    el,
    levelChoices:LEVEL_CHOICES,
    qsa,
    storage:{ SECTION_SELECTION, ORDER_SELECTION },
    deps:{
      loadSearchQuery,
      saveSearchQuery,
      currentSearchQuery,
      loadOrderSelection:loadString,
      saveOrderSelection:saveString,
      saveSectionSelection:saveString,
      getActiveLevelArray,
      getLevelFilterSet,
      setLevelFilterSet,
      rebuildAndRender,
      updateHeaderStats,
      finalizeActiveSession,
      updateSectionOptions,
    },
  });
  const initSectionPicker=(...args)=>filterController.initSectionPicker(...args);
  const updateLevelFilterButtons=(...args)=>filterController.updateLevelFilterButtons(...args);
  function resetLegacyFiltersForFocusedSession(){
    setLevelFilterSet(new Set(LEVEL_CHOICES));
    updateLevelFilterButtons();
    if(el.secSel) el.secSel.value='';
    if(el.studySecSel) el.studySecSel.value='';
    if(el.search) el.search.value='';
    if(el.orderSel) el.orderSel.value='asc';
    saveString(SECTION_SELECTION,'');
    saveString(SEARCH,'');
    saveString(ORDER_SELECTION,'asc');
  }
  document.addEventListener(FOCUSED_SESSION_PREPARE_EVENT,resetLegacyFiltersForFocusedSession);
  el.cfgPlaybackMode=qsa('input[name="cfgPlaybackMode"]');
  el.cfgStudyMode=qsa('input[name="cfgStudyMode"]');
  const versionTargets=qsa('[data-app-version]');
  const appVersionText=`バージョン: ${APP_VERSION}`;
  function initAppVersion(){
    versionTargets.forEach(node=>{
      if(node){
        node.textContent=appVersionText;
      }
    });
  }
  const audio=qs('#player');
  const composeGuide = createReorderGuide({
    composeGuideEl: el.composeGuide,
    composeTokensEl: el.composeTokens,
    composeAnswerEl: el.composeAnswer,
    composeContextEl: el.composeContext,
    composeFeedbackEl: el.composeFeedback,
    composeControlsEl: el.composeControls,
    composeNoteEl: el.composeNote,
    onComplete: (result) => {
      if (!sessionActive || !currentItem || !isComposeMode()) return;
      const update = levelStateManager.updateReorderLevelInfo(currentItem.id, result);
      const pass = update.evaluation.pass;
      refreshLevelDisplay(update.info);
      updateHeaderStats();
      el.card.classList.add('reorder-complete');
      el.mic.disabled = true;
      updatePlayButtonAvailability();
      setFooterMessages('', '');
      if (sessionMetrics && sessionMetrics.startMs) {
        sessionMetrics.attempts += 1;
        sessionMetrics.cardsDone += 1;
        if (!pass) sessionMetrics.failures += 1;
        sessionMetrics.currentStreak = pass ? sessionMetrics.currentStreak + 1 : 0;
        sessionMetrics.highestStreak = Math.max(sessionMetrics.highestStreak, sessionMetrics.currentStreak);
      }
      if (pass) incrementGoalProgressForPass();
      recordStudyProgress({ pass, newLevel5: false, noHint: false, perfect: false, mode: getStudyMode() });
      resultFeedbackQueue.enqueue(pass ? 'success' : 'fail', { itemId: currentItem.id });
      sendLog('srs', createReorderSrsPayload(currentItem.id, update));
      sendLog('attempt', { id: currentItem.id, ts: new Date().toISOString(),
        mode: 'compose', result: pass ? 'pass' : 'fail', reorder_grade: result.grade,
        reorder_sentences: result.sentences });
    },
    onNext: () => nextCard(false, false),
  });
  initAppVersion();
  const itemLabelCache=new Map();
  let correctiveItemId=null;
  let correctionProgress=createCorrectionProgress();
  let correctionFinished=false;
  let recognitionController=null;
  let speechController=null;
  let lastMatchEval=null;
  let currentShouldUseSpeech=false;
  let characterVoiceData=null;
  let lastProgressNote='';
  let autoAdvanceTimer=0;
  let autoAdvanceGeneration=0;

  function setLastProgressNote(note, goal){
    lastProgressNote = typeof note==='string' ? note.trim() : '';
    lastPromotionGoal = goal || null;
    updateDailyOverview();
  }

  function clearLastProgressNote(){
    lastPromotionGoal=null;
    setLastProgressNote('');
  }

  function getLastProgressNote(){
    return (lastProgressNote||'').trim();
  }

  function getLastPromotionGoal(){
    return lastPromotionGoal;
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

  function resolvePromotionNoteText(){
    const goal=getLastPromotionGoal();
    const noteFromGoal=buildNoHintProgressNote(goal);
    if(noteFromGoal) return noteFromGoal;
    const note=getLastProgressNote();
    if(note) return note;
    if(goal && goal.target){
      return `Lv${goal.target}を目指して継続しましょう`;
    }
    return '';
  }

  function buildProgressInfoSummary(){
    const sections=[];
    ensureDailyGoalFresh();
    const todayKey=localDateKey();
    const yesterdayKey=localDateKey(Date.now()-DAY_MS);
    const todayStats=getDailyStats(todayKey);
    const yesterdayStats=getDailyStats(yesterdayKey);
    goalState.sessionDone=Math.max(goalState.sessionDone, sessionMetrics?.cardsDone||0);
    const dailyRatio=goalState.dailyTarget>0 ? goalState.dailyDone/goalState.dailyTarget : 0;
    const sessionRatio=goalState.sessionTarget>0 ? goalState.sessionDone/goalState.sessionTarget : 0;
    const dailyRemaining=Math.max(0, goalState.dailyTarget-goalState.dailyDone);
    const sessionRemaining=Math.max(0, goalState.sessionTarget-goalState.sessionDone);
    const goalSnapshot={
      daily:{
        done:goalState.dailyDone,
        target:goalState.dailyTarget,
        ratio:dailyRatio,
        remaining:dailyRemaining
      },
      session:{
        done:goalState.sessionDone,
        target:goalState.sessionTarget,
        ratio:sessionRatio,
        remaining:sessionRemaining
      }
    };
    const todayStreak=Math.max(0, todayStats?.streak||0);
    const yesterdayStreak=Math.max(0, yesterdayStats?.streak||0);
    const streakDiff=todayStreak-yesterdayStreak;
    const streakDiffLabel=streakDiff>0?`+${streakDiff}`:(streakDiff<0?`${streakDiff}`:'±0');
    const goalLines=[
      `今日の目標: ${goalState.dailyDone}/${goalState.dailyTarget}件（達成率${Math.min(100, Math.round(dailyRatio*100))}%）`,
      dailyRemaining>0 ? `あと${dailyRemaining}件で達成` : '今日の目標を達成済み',
      `セッション目標: ${goalState.sessionDone}/${goalState.sessionTarget}件（達成率${Math.min(100, Math.round(sessionRatio*100))}%）`,
      sessionRemaining>0 ? `あと${sessionRemaining}件で到達` : 'セッション目標クリア'
    ];
    sections.push({ title:'目標と達成状況', lines:goalLines });
    sections.push({
      title:'モチベーション',
      lines:[`連続合格: ${todayStreak}回（昨日${yesterdayStreak}回、昨日比${streakDiffLabel}回）`]
    });
    const note=resolvePromotionNoteText();
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
    return { sections, goalSnapshot, note, levelSummary: summary, streakSnapshot:{ today:todayStreak, yesterday:yesterdayStreak, diff:streakDiff } };
  }

  function collectFooterInfoSections(){
    const info=buildProgressInfoSummary();
    return info.sections;
  }

  function formatOverviewDate(ts){
    if(!Number.isFinite(ts) || ts<=0) return '';
    const todayKey=localDateKey();
    const targetKey=localDateKey(ts);
    const yesterdayKey=localDateKey(Date.now()-DAY_MS);
    if(targetKey===todayKey) return '今日';
    if(targetKey===yesterdayKey) return '昨日';
    const d=new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()}`;
  }

  function getItemLabel(id){
    const key=String(id);
    if(itemLabelCache.has(key)) return itemLabelCache.get(key);
    const found=(window.ALL_ITEMS||[]).find(it=>String(it?.id)===key);
    const label=(found?.ja || found?.en || `#${key}`).trim();
    itemLabelCache.set(key, label);
    return label;
  }

  function buildRecentLevelMilestones(limit=4){
    const state=levelStateManager.refreshLevelState?.() || {};
    const entries=[];
    for(const [id, info] of Object.entries(state||{})){
      if(!info || typeof info!=='object') continue;
      const best=Number(info.best);
      const last=Number(info.last);
      const level=Number.isFinite(best)&&best>0?best:(Number.isFinite(last)?last:0);
      if(level<4) continue;
      const updated=Number(info.updatedAt)||0;
      entries.push({ id, level:Math.min(5, level), updatedAt:updated });
    }
    entries.sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
    const maxItems=Math.max(1, limit||0);
    return entries.slice(0, maxItems).map(entry=>({
      id:entry.id,
      level:entry.level>=5?5:4,
      label:getItemLabel(entry.id),
      when:formatOverviewDate(entry.updatedAt)
    }));
  }

  function buildOverviewHighlightItems({ summary, todayStats, yesterdayStats, promotion, weeklyHighlights }){
    const list=[];
    const todayTotal=Math.max(0, (todayStats?.passes||0)+(todayStats?.level5||0));
    const yesterdayTotal=Math.max(0, (yesterdayStats?.passes||0)+(yesterdayStats?.level5||0));
    const diff=todayTotal-yesterdayTotal;
    const trendTone=diff>0?'good':(diff<0?'alert':'muted');
    const trendIcon=diff>0?'📈':(diff<0?'📉':'⏸️');
    list.push({
      icon: trendIcon,
      tone: trendTone,
      text: `今日${todayTotal}件 / 昨日${yesterdayTotal}件`
    });
    const todayStreak=Math.max(0, todayStats?.streak||0);
    const yesterdayStreak=Math.max(0, yesterdayStats?.streak||0);
    const streakDiff=todayStreak-yesterdayStreak;
    const streakTone=streakDiff>0?'good':(streakDiff<0?'warn':'muted');
    const streakIcon=streakDiff>0?'🔥':(streakDiff<0?'🧊':'⏸️');
    const streakLabel=streakDiff>0?`+${streakDiff}`:(streakDiff<0?`${streakDiff}`:'±0');
    list.push({
      icon: streakIcon,
      tone: streakTone,
      text: `連続合格: ${todayStreak}回（昨日比${streakLabel}回）`
    });
    const todayNoHint=Math.max(0, todayStats?.no_hint||0);
    const weekNoHintGrowth=Number(weeklyHighlights?.noHint?.growthRate);
    const weekNoHintTrend=weeklyHighlights?.noHint?.trend||'even';
    const weekNoHintLabel=Number.isFinite(weekNoHintGrowth)
      ? `${weekNoHintGrowth>=0?'+':''}${Math.round(weekNoHintGrowth*100)}%`
      : '±0%';
    list.push({
      icon: todayNoHint>0 ? '🎯' : '🧭',
      tone: todayNoHint>0 ? 'good' : 'warn',
      text: todayNoHint>0 ? `ノーヒント合格${todayNoHint}件` : 'ノーヒント合格はまだありません'
    });
    list.push({
      icon: weekNoHintTrend==='up' ? '🟢' : (weekNoHintTrend==='down' ? '🟠' : '⚪'),
      tone: weekNoHintTrend==='up' ? 'good' : (weekNoHintTrend==='down' ? 'warn' : 'muted'),
      text: `今週ノーヒント増加率 ${weekNoHintLabel}（${Math.max(0, Number(weeklyHighlights?.noHint?.current)||0)}件）`
    });
    const weekBest=weeklyHighlights?.bestDay;
    if(weekBest && weekBest.score>0){
      const weekBestMessage=weeklyHighlights?.records?.updatedThisWeek
        ? `今週の自己ベスト更新：${weekBest.dateKey}に${weekBest.score}件`
        : `今週のベスト日：${weekBest.dateKey}に${weekBest.score}件`;
      list.push({
        icon: weeklyHighlights?.records?.updatedThisWeek ? '🏆' : '📅',
        tone: weeklyHighlights?.records?.updatedThisWeek ? 'good' : 'muted',
        text: weekBestMessage
      });
    }
    const dailyRemaining=Math.max(0, summary?.goalSnapshot?.daily?.remaining ?? 0);
    list.push({
      icon: dailyRemaining>0 ? '🎯' : '🏁',
      tone: dailyRemaining>0 ? 'warn' : 'good',
      text: dailyRemaining>0 ? `今日の目標まであと${dailyRemaining}件` : '今日の目標を達成しました'
    });
    const promotionNote=promotion?.note || summary?.note || '';
    if(promotionNote){
      let tone='warn';
      if(promotion?.tone==='ready') tone='good';
      else if(promotion?.tone==='cooldown') tone='warn';
      else if(promotion?.tone==='progress') tone='warn';
      const icon=promotion?.tone==='ready' ? '🚀' : (promotion?.tone==='cooldown' ? '⏳' : '🔖');
      list.push({
        icon,
        tone,
        text: promotionNote
      });
    }else{
      const progressSection=(summary?.sections||[]).find(sec=>Array.isArray(sec.lines) && sec.title?.includes('進捗'));
      const fallbackLine=progressSection?.lines?.find(Boolean);
      if(fallbackLine){
        list.push({
          icon:'✨',
          tone:'muted',
          text:fallbackLine
        });
      }
    }
    return list.slice(0, 6);
  }

  function buildDailyOverviewModel(){
    const summary=buildProgressInfoSummary();
    const todayKey=localDateKey();
    const yesterdayKey=localDateKey(Date.now()-DAY_MS);
    const todayStats=getDailyStats(todayKey);
    const yesterdayStats=getDailyStats(yesterdayKey);
    const todayTotal=Math.max(0, (todayStats?.passes||0)+(todayStats?.level5||0));
    const yesterdayTotal=Math.max(0, (yesterdayStats?.passes||0)+(yesterdayStats?.level5||0));
    const maxValue=Math.max(1, todayTotal, yesterdayTotal);
    const diff=todayTotal-yesterdayTotal;
    const trendStatus=diff>0?'up':(diff<0?'down':'even');
    const todayStreak=Math.max(0, todayStats?.streak||0);
    const yesterdayStreak=Math.max(0, yesterdayStats?.streak||0);
    const streakDiff=todayStreak-yesterdayStreak;
    const streakStatus=streakDiff>0?'up':(streakDiff<0?'down':'even');
    const levelState=levelStateManager.refreshLevelState?.() || {};
    const nowTs=Date.now();
    let dueCount=0;
    for(const info of Object.values(levelState)){
      const dueAt=Number(info?.review?.nextDueAt ?? info?.nextDueAt);
      if(Number.isFinite(dueAt) && dueAt>0 && dueAt<=nowTs){
        dueCount+=1;
      }
    }
    const dayGoal=Math.max(0, Number(summary?.goalSnapshot?.daily?.target)||0);
    const dayDone=Math.max(0, Number(summary?.goalSnapshot?.daily?.done)||0);
    const completionRate=dayGoal>0 ? Math.min(1, dayDone/dayGoal) : 0;
    const weeklyHighlights=computeWeeklyHighlights();
    const latestClosure=getLatestSessionClosureSummaryBefore(todayKey);
    const resumeTriggerNote=latestClosure
      ? `昨日の締めメモ: ${latestClosure.message || `達成${Math.max(0, Number(latestClosure.cardsDone)||0)}件`}（再開は最小${Math.max(1, Number(latestClosure.nextDayMinimumGoal)||1)}件でOK）`
      : '';
    const promotionGoal=getLastPromotionGoal();
    const promotionNote=resolvePromotionNoteText();
    let promotionTone='muted';
    if(promotionGoal){
      if(promotionGoal.met || (promotionGoal.remaining||0)<=0){
        promotionTone='ready';
      }else if(promotionGoal.cooldownMs>0){
        promotionTone='cooldown';
…29488 tokens truncated…osest?.('#composeGuide')) return true;
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
    clearHintSwipeState();
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
    const verticalThreshold=Math.max(1, thresholds.vertical || thresholds.horizontal || 0);
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
      const progress=dy>0 ? Math.min(1, Math.max(0, dy/verticalThreshold)) : 0;
      updateHintSwipeProgress(progress);
      return;
    }
    updateHintSwipeProgress(0);
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
    clearHintSwipeState();
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
    const downwardSwipe=verticalCandidate && reachedVertical && verticalVelocity>=MIN_SWIPE_VELOCITY && dt<=MAX_SWIPE_DURATION && dy>0;
    if(downwardSwipe){
      resetCardDrag({animate:false});
      toggleJA();
      return;
    }
    resetCardDrag({animate:false});
  }
  el.card.addEventListener('touchend',(ev)=>{ handleTouchFinish(ev,false); },{passive:true});
  el.card.addEventListener('touchcancel',(ev)=>{ handleTouchFinish(ev,true); },{passive:true});
  el.en.addEventListener('click', async ()=>{ if(!sessionActive){ await startSession(false); } });
  el.play.addEventListener('click', async ()=>{
    if(isPlaybackTransitionLocked()) return;
    if(sessionStarting) return;
    if(!sessionActive){ await startSession(false); }
    if(sessionStarting) return;
    if(!sessionActive){ return; }
    if(correctiveItemId===QUEUE[idx]?.id){
      const expected=correctiveItemId;
      cancelPendingMicStart();
      if(recognitionController?.isActive?.()) recognitionController.cancel();
      if(getAudioLockState()===AUDIO_LOCK_STATES.RELEASE) await new Promise(resolve=>setTimeout(resolve,MIC_RELEASE_SETTLE_MS+30));
      if(!sessionActive||QUEUE[idx]?.id!==expected) return;
    }
    const hasSrc=!!audio.dataset.srcKey;
    const canSpeak=speechController ? speechController.canSpeakCurrentCard() : false;
    const audioPlaying=hasSrc && !audio.paused && !audio.ended;
    if(audioPlaying){
      audio.pause();
      return;
    }
    if(speechController && speechController.isSpeaking()){
      speechController.cancelSpeech();
      return;
    }
    if(!hasSrc && !canSpeak){ toast('音声が見つかりません'); return; }
    const shouldReset = hasSrc ? (getAudioLockState()===AUDIO_LOCK_STATES.ACTIVE || audio.ended || audio.currentTime<=0.05) : false;
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
      shouldEvaluate:()=>!isShadowingSession(),
      getRecognitionBiasContext:()=>buildRecognitionBiasContext({mode:isShadowingSession()?'shadowing':getStudyMode(),itemId:QUEUE[idx]?.id,clozeContext:getActiveClozeRecognitionContext(QUEUE[idx]?.id)}),
      onTranscriptPreview:text=>{if(!isShadowingSession()) showTranscriptFinal(text);},
      onTranscriptReset: resetTranscript,
      onTranscriptInterim: (text)=>{ if(!isShadowingSession()) showTranscriptInterim(text); },
      onTranscriptFinal: (text)=>{ if(!isShadowingSession()) showTranscriptFinal(text); },
      onMatchEvaluated: (info)=>{
        if(!info||isShadowingSession()) return;
        lastMatchEval=Object.assign({}, info);
        const score=calcMatchScore(info.refCount, info.recall, info.precision);
        updateMatch(score);
      },
      onUnsupported: ()=>toast('この端末では音声認識が使えません'),
      onError: (e)=>{
        toast('ASRエラー: '+(e && e.error || ''));
        if(correctiveItemId===QUEUE[idx]?.id) handleCorrectionAttempt({technical:true});
        el.mic.disabled=correctionFinished;
        if(isShadowingSession()){
          cancelShadowingCycle({stopOutput:true});
          shadowingPaused=true;
          setMicUiState(MIC_UI_STATES.ERROR);
        }
        beginMicReleaseSettle();
        updatePlayButtonAvailability();
      },
      onStart: ()=>{
        setAudioLockState(AUDIO_LOCK_STATES.ACTIVE);setMicState(true);updatePlayButtonAvailability();
        if(isShadowingSession()){
          setFooterMessages('録音中・連続シャドウイング','流れる音声を追いかけて発話してください。');
          runShadowingCycle().catch(()=>pauseShadowingAfterError('音声を開始できませんでした。マイクを押して再試行してください。'));
        }else{
          setFooterMessages('録音中です。','「聞く」で先頭から再生し、音声を追いかけて話してください。');
        }
      },
      onStop: ()=>{ setMicState(false);beginMicReleaseSettle(); },
      onAutoStop: (result)=>{
        if(isShadowingSession()) handleShadowingAutoStop(result);
        else stopRec(result).catch(()=>{});
      },
      setMicState,
    });
  }

  recognitionController=initializeRecognitionController();

  const MIC_AUDIO_SETTLE_MS=350;
  const MIC_RELEASE_SETTLE_MS=800;
  const MIC_STOP_CONFIRM_TIMEOUT_MS=700;
  const SHADOWING_TAIL_MS=700;
  const SHADOWING_PLAYBACK_TIMEOUT_MS=45000;
  let pendingMicStartTimer=null;
  let micReleaseTimer=null;
  let micRequestToken=0;

  function cancelShadowingCycle({stopOutput=false}={}){
    shadowCycleToken+=1;
    shadowCycleState=null;
    if(stopOutput) stopAppAudioOutput();
  }

  function pauseShadowingAfterError(message){
    cancelShadowingCycle({stopOutput:true});
    shadowingPaused=true;
    if(recognitionController?.isActive?.()) recognitionController.cancel();
    setFooterMessages(message||'連続シャドウイングを一時停止しました。','マイクを押すと現在の文から再開します。');
    el.mic.disabled=false;
  }

  async function waitForShadowingPlaybackEnd(token){
    const started=now();
    while(token===shadowCycleToken&&sessionActive&&isShadowingSession()){
      const audioPlaying=!!(audio?.dataset?.srcKey&&!audio.paused&&!audio.ended);
      const speechPlaying=!!speechController?.isSpeaking?.();
      if(!audioPlaying&&!speechPlaying) return true;
      if(now()-started>=SHADOWING_PLAYBACK_TIMEOUT_MS) return false;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    return false;
  }

  async function runShadowingCycle(){
    if(!sessionActive||!isShadowingSession()||shadowingPaused||!recognitionController?.isActive?.()) return false;
    const item=QUEUE[idx];
    if(!item) return false;
    const token=++shadowCycleToken;
    shadowCycleState={token,itemId:String(item.id||''),startedAt:0,index:idx};
    shadowCycleState.startedAt=now();
    const played=await tryPlayAudio({resetPosition:true,shadowingPlayback:true});
    if(token!==shadowCycleToken) return false;
    if(!played){
      pauseShadowingAfterError('この文の音声を再生できないため一時停止しました。');
      return false;
    }
    const ended=await waitForShadowingPlaybackEnd(token);
    if(!ended||token!==shadowCycleToken||!recognitionController?.isActive?.()) return false;
    await new Promise(resolve=>setTimeout(resolve,SHADOWING_TAIL_MS));
    if(token!==shadowCycleToken||!sessionActive||idx!==shadowCycleState?.index||!recognitionController?.isActive?.()) return false;
    finishShadowingCycle(token);
    return true;
  }

  function finishShadowingCycle(token){
    const cycle=shadowCycleState;
    if(!cycle||cycle.token!==token||token!==shadowCycleToken) return false;
    const exposure=buildShadowingExposure({itemId:cycle.itemId,startedAt:cycle.startedAt,finishedAt:now()});
    shadowCycleState=null;
    const transitionToken=++shadowCycleToken;
    if(recognitionController?.isActive?.()) recognitionController.cancel();
    if(exposure.completed){
      recordShadowingExposure({cards:1,durationMs:exposure.durationMs});
      sendLog('shadowing',{
        ts:new Date().toISOString(),
        id:exposure.itemId,
        duration_ms:exposure.durationMs,
        mode:TRAINING_MODES.CONTINUOUS_SHADOWING,
      });
      shadowingSessionMetrics.cards+=1;
      shadowingSessionMetrics.durationMs+=exposure.durationMs;
      try{navigator.vibrate?.(8);}catch(_){ }
    }
    const scheduledIndex=idx;
    const scheduledId=QUEUE[idx]?.id;
    setFooterMessages('シャドウイング完了','次の文を準備しています。');
    setTimeout(()=>{
      if(transitionToken!==shadowCycleToken||!sessionActive||shadowingPaused||idx!==scheduledIndex||QUEUE[idx]?.id!==scheduledId) return;
      nextCard(false,false).catch(()=>pauseShadowingAfterError('次の文を開始できませんでした。'));
    },MIC_RELEASE_SETTLE_MS+80);
    return true;
  }

  function handleShadowingAutoStop(){
    cancelShadowingCycle({stopOutput:true});
    shadowingPaused=true;
    setFooterMessages('マイクが停止したため一時停止しました。','マイクを押すと現在の文から再開します。');
    el.mic.disabled=false;
  }

  function clearMicReleaseTimer(){
    if(micReleaseTimer){clearTimeout(micReleaseTimer);micReleaseTimer=null;}
  }

  function cancelPendingMicStart(){
    micRequestToken+=1;
    if(pendingMicStartTimer){clearTimeout(pendingMicStartTimer);pendingMicStartTimer=null;}
    if(getAudioLockState()===AUDIO_LOCK_STATES.PENDING) beginMicReleaseSettle();
  }

  function beginMicReleaseSettle(){
    clearMicReleaseTimer();
    setAudioLockState(AUDIO_LOCK_STATES.RELEASE);
    updatePlayButtonAvailability();
    micReleaseTimer=setTimeout(()=>{
      micReleaseTimer=null;
      if(recognitionController?.isActive?.()||getAudioLockState()===AUDIO_LOCK_STATES.PENDING) return;
      setAudioLockState(AUDIO_LOCK_STATES.UNLOCKED);
      updatePlayButtonAvailability();
      if(!isShadowingSession()) resultFeedbackQueue.flush({itemId:QUEUE[idx]?.id});
    },MIC_RELEASE_SETTLE_MS);
  }

  function stopAppAudioOutput(){
    try{audio?.pause?.();}catch(_){}
    speechController?.cancelSpeech?.();
    stopAllTones();
  }

  function resetPlaybackSessionForMic(){
    stopAppAudioOutput();
    if(!audio) return;
    try{audio.currentTime=0;}catch(_){}
    try{audio.load?.();}catch(_){}
  }

  async function waitForAppAudioStop(timeoutMs=MIC_STOP_CONFIRM_TIMEOUT_MS){
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      const audioStopped=!audio||audio.paused||audio.ended;
      const speechStopped=!speechController?.isSpeaking?.();
      const tonesStopped=!isTonePlaying();
      if(audioStopped&&speechStopped&&tonesStopped) return true;
      stopAppAudioOutput();
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return (!audio||audio.paused||audio.ended)&&!speechController?.isSpeaking?.()&&!isTonePlaying();
  }

  function beginRecognition(requestToken,requestedItemId){
    pendingMicStartTimer=null;
    if(isComposeMode()) { beginMicReleaseSettle(); return; }
    if(requestToken!==micRequestToken||!sessionActive||QUEUE[idx]?.id!==requestedItemId||!recognitionController||recognitionController.isActive()){
      beginMicReleaseSettle();
      return;
    }
    lastMatchEval=null;
    const result=recognitionController.start();
    if(result&&!result.ok){
      if(result.reason==='unsupported') el.mic.disabled=false;
      beginMicReleaseSettle();
    }
  }

  async function startRec(){
    if(isComposeMode()) return;
    if(composeGuide.isAwaitingReorder()){
      setFooterMessages('先に文の語順を完成してください。','');
      return;
    }
    if(el.mic.disabled) return;
    if(!recognitionController) return;
    if(recognitionController.isActive()||pendingMicStartTimer||getAudioLockState()===AUDIO_LOCK_STATES.PENDING) return;
    clearMicReleaseTimer();
    resultFeedbackQueue.clear();
    const requestToken=++micRequestToken;
    const requestedItemId=QUEUE[idx]?.id;
    setAudioLockState(AUDIO_LOCK_STATES.PENDING);
    resetPlaybackSessionForMic();
    setFooterMessages('音声を停止して録音を準備しています。','録音開始後、「聞く」で先頭から再生できます。');
    await waitForAppAudioStop();
    if(requestToken!==micRequestToken||!sessionActive||QUEUE[idx]?.id!==requestedItemId){beginMicReleaseSettle();return;}
    pendingMicStartTimer=setTimeout(()=>beginRecognition(requestToken,requestedItemId),MIC_AUDIO_SETTLE_MS);
  }

  function handleCorrectionAttempt(attempt){
    if(!sessionActive||correctionFinished||correctiveItemId!==QUEUE[idx]?.id) return;
    const result=recordCorrectionAttempt(correctionProgress,attempt);
    el.mic.disabled=result.complete;
    setFooterMessages(result.message,result.complete?'':'「聞く」で正解音声を確認できます。');
    if(result.complete){
      correctionFinished=true;
      clearActiveClozeRecognitionContext();
      if(attempt.success) resultFeedbackQueue.enqueue('success',{itemId:QUEUE[idx].id});
      scheduleAutoAdvance(1900);
    }
    updateAttemptInfo();updatePlayButtonAvailability();
  }

  let stopRecPending=false;
  async function stopRec(result){
    if(isComposeMode()) return;
    if(!recognitionController) return;
    if(!result&&stopRecPending) return;
    const requestedItemId=QUEUE[idx]?.id;
    let outcome;
    if(!result) stopRecPending=true;
    try { outcome = result && result.ok ? result : await recognitionController.stop(); }
    finally { if(!result) stopRecPending=false; }
    if(requestedItemId!==QUEUE[idx]?.id) return;
    if(!outcome || !outcome.ok) return;
    const it = QUEUE[idx];
    if(!it){
      updateMatch(null);
      return;
    }
    const hyp = (outcome.transcript || '').trim();
    if(!hasRecognizedSpeech(hyp)){
      if(correctiveItemId===it.id){handleCorrectionAttempt({technical:true});return;}
      lastMatchEval=null;updateMatch(null);resetTranscript();setFooterMessages('発話が検出されませんでした。もう一度話してください。','');el.mic.disabled=false;updatePlayButtonAvailability();return;
    }
    const refItem = QUEUE[idx];
    const refText = refItem ? refItem.en : el.en.textContent;
    const studyMode = getStudyMode();
    let matchInfo = outcome.matchInfo;
    if(!matchInfo){
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
    if(correctiveItemId===it.id){
      // Practice after the recorded failure never mutates SRS/history/metrics.
      nativeSpeechDiagnostic('grading',{mode:'correction',itemId:it.id,matchRate,evaluation:evaluateLevel(matchRate,maxHintStageUsed)});
      handleCorrectionAttempt({success:!!evaluateLevel(matchRate,maxHintStageUsed)?.pass});
      return;
    }
    const prevInfoSnapshot = getLevelInfo(it.id);
    const hadPriorProgress = Number(prevInfoSnapshot?.best)>0 || Number(prevInfoSnapshot?.last)>0;
    let prevBest = Number(prevInfoSnapshot?.best||0);
    if(!Number.isFinite(prevBest) || prevBest<=0){
      prevBest = Number(prevInfoSnapshot?.last||0) || 0;
    }
    const stageUsed = maxHintStageUsed;
    const evaluation = evaluateLevel(matchRate, stageUsed);
    nativeSpeechDiagnostic('grading',{mode:studyMode,itemId:it.id,matchRate,evaluation});
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

    const streakUpdated=Boolean(evaluation?.noHintSuccess && Number(levelInfo?.noHintStreak||0)>Number(prevInfoSnapshot?.noHintStreak||0));
    if(levelInfoBest > prevBest){
      triggerMilestoneEffect('best',{
        level:levelInfoBest,
        previous:prevBest,
        hasPriorProgress:hadPriorProgress,
        bestUpdated:true,
        streakUpdated
      });
    }
    if(levelCandidate ===5){
      triggerMilestoneEffect('level5',{
        level:levelCandidate,
        matchRate,
        hasPriorProgress:hadPriorProgress,
        streakUpdated
      });
    }else if(levelCandidate ===4){
      triggerMilestoneEffect('level4',{
        level:levelCandidate,
        matchRate,
        hasPriorProgress:hadPriorProgress,
        streakUpdated
      });
    }


    const errorAnalysis=classifySpeechErrors(matchInfo, refText);
    const primaryErrorType=errorAnalysis.primaryType;
    const pass = !!evaluation?.pass;
    if(sessionMetrics && sessionMetrics.startMs){
      sessionMetrics.attempts+=1;
      if(!pass){
        sessionMetrics.failures+=1;
      }
    }

    const responseMs = cardStart>0 ? Math.max(0, now()-cardStart) : '';
    const nativeSpeechStats = isRecognitionSupported()
      ? recordSpeechAttempt(it.id, pass)
      : getSpeechAttemptStats(it.id);
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
      error_type: primaryErrorType,
      error_types_json: JSON.stringify(errorAnalysis.errorTypes),
      missing_tokens_json: JSON.stringify(errorAnalysis.missingTokens),
      spoken_tokens_json: JSON.stringify(errorAnalysis.spokenTokens),
      device: UA
    };
    const progressNote = buildNoHintProgressNote(levelUpdate?.nextTarget);
    if(pass){
      setLastProgressNote(progressNote, levelUpdate?.nextTarget);
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
      maybeNotifyFatigue();
      incrementGoalProgressForPass();
      lastErrorType='';
      sameErrorStreak=0;
      setFooterMessages('', '');
      el.mic.disabled=true;
      showPostResultFeedback(it,matchInfo);
      resultFeedbackQueue.enqueue('success',{itemId:it.id,perfect:!!evaluation?.perfectNoHint});
      if(levelCandidate>=4 && evaluation?.noHintSuccess){
        const baseToast = evaluation?.perfectNoHint ? 'ノーヒントで満点クリア！' : '素晴らしい！ノーヒント合格';
        toast(baseToast, 2000);
      }else{
        toast('合格です！着実にスピーキング力が伸びています。', 1600);
      }
      scheduleAutoAdvance(1900);
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
      sameErrorStreak = primaryErrorType && primaryErrorType!=='none' && primaryErrorType===lastErrorType ? sameErrorStreak+1 : 1;
      lastErrorType = primaryErrorType;
      setFooterMessages('', errorAnalysis.actionMessage);
      maybeNotifyFatigue();
      if(sameErrorStreak>=3){
        const optimizedStage=optimizeHintStageForError(primaryErrorType);
        if(optimizedStage>BASE_HINT_STAGE){
          setHintStage(optimizedStage);
          setFooterMessages(`つまずきに合わせてヒントを最適化しました（${sameErrorStreak}回）`, errorAnalysis.actionMessage, {actionPriority:true});
        }
      }
      resultFeedbackQueue.enqueue('fail',{itemId:it.id});
      cancelAutoAdvance();
      correctiveItemId=it.id;
      correctionProgress=createCorrectionProgress();
      correctionFinished=false;
      showPostResultFeedback(it,matchInfo);
      el.mic.disabled=true;
      setFooterMessages('正解音声を聞いて、表示された英文を話してください。','「聞く」で正解音声を確認できます。');
      // Existing source/TTS playback and mic lock remain the audio authority.
      const correctionId=it.id;
      setTimeout(async()=>{
        if(!sessionActive||correctiveItemId!==correctionId||QUEUE[idx]?.id!==correctionId) return;
        try{
          if(!recognitionController.isActive()&&getAudioLockState()===AUDIO_LOCK_STATES.UNLOCKED) await tryPlayAudio({userInitiated:false,resetPosition:true});
        }finally{
          if(sessionActive&&correctiveItemId===correctionId&&QUEUE[idx]?.id===correctionId&&!correctionFinished){el.mic.disabled=false;updatePlayButtonAvailability();}
        }
      },MIC_RELEASE_SETTLE_MS+80);
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
      study_mode: studyMode,
      error_type: primaryErrorType,
      error_types_json: JSON.stringify(errorAnalysis.errorTypes),
      next_action: errorAnalysis.actionMessage,
      native_sr_submissions: numericOrEmpty(nativeSpeechStats?.submissions),
      native_sr_successes: numericOrEmpty(nativeSpeechStats?.correct)
    };
    sendLog('srs', srsPayload);
    sendLog('attempt', attemptPayload);
    sendLog('speech', payload);
  }

  el.mic.onclick=()=>{
    prepareToneOutput();
    const active=recognitionController && recognitionController.isActive();
    if(isShadowingSession()){
      if(active){
        cancelShadowingCycle({stopOutput:true});
        shadowingPaused=true;
        recognitionController.cancel();
        setFooterMessages('連続シャドウイングを一時停止しました。','マイクを押すと現在の文から再開します。');
      }else if(getAudioLockState()===AUDIO_LOCK_STATES.PENDING){
        cancelPendingMicStart();
        shadowingPaused=true;
        setFooterMessages('連続シャドウイングを一時停止しました。','マイクを押すと現在の文から再開します。');
      }else{
        shadowingPaused=false;
        startRec();
      }
      return;
    }
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
      initGoals();
      updateHeaderStats();
      initSectionPicker();
      initOnboardingFlow();
      refreshDirStatus();
      // Opening the app must stay on Home. A saved legacy section must never
      // start itself before the focused character/training shell is ready.
      await rebuildAndRender(true,{autoStart:false});
      maybeShowFooterInfoIntroToast();
      maybeShowGoalOverview();
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
    getCurrentViewState,
  };
}

let appRuntime=null;
async function initApp(){
  appRuntime=createAppRuntime();
  await appRuntime.boot();
}



const swUpdatePrompt=createSwUpdatePrompt();

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
    swUpdatePrompt.registerServiceWorker({
      toastFn: toast,
      getCurrentViewState: ()=>appRuntime?.getCurrentViewState?.() || VIEW_HOME,
    });
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
});

// The target page itself is a debug-only Android asset; never shown in release/PWA.
if(isNativeAndroid() && globalThis.Capacitor?.DEBUG === true){
  const button=document.createElement('button');
  button.className='btn';button.id='nativeAsrTest';button.textContent='ASR実機テスト';
  button.onclick=()=>{location.href='/native-gate.html';};
  document.querySelector('#homeView .home-cta-wrap')?.append(button);
}
