import { migrateZeroSetupStorage } from '../storage/zeroSetupMigration.js';
migrateZeroSetupStorage();
import { isNativeAndroid } from '../native/runtimePlatform.js';
import { nativeDirectory } from '../native/media.js';
import { buildRecognitionContext } from '../speech/recognitionPolicy.js';
import { nativeSpeechDiagnostic } from '../native/androidSpeechBackend.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../speech/correctionProgress.js';
import { clearActiveClozeRecognitionContext } from './clozeRecognitionContext.js';
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
  initNotificationSystem,
  getDailyStats,
  localDateKey,
  getNotificationSettings,
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
import { createResultFeedbackQueue } from './resultFeedbackSound.js';
import { createOverlayController } from './overlay.js';
import { createCardTransitionQueue } from './cardTransitions.js';
import { createReorderGuide } from './reorderGuide.js';
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
  const now=()=>Date.now();
  const DAY_MS=86400000;



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


  const { SEARCH, SPEED, CONFIG, DAILY_GOAL: DAILY_GOAL_KEY, SESSION_GOAL: SESSION_GOAL_KEY, SECTION_SELECTION, ORDER_SELECTION, DAILY_OVERVIEW, DAILY_GOAL_COLLAPSE, SESSION_GOAL_COLLAPSE } = STORAGE_KEYS;

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
  const el={ app:qs('#app'), homeView:qs('#homeView'), studyView:qs('#studyView'), reviewCompleteView:qs('#reviewCompleteView'), startStudyCta:qs('#startStudyCta'), reviewCompleteMessage:qs('#reviewCompleteMessage'), reviewActionContinue:qs('#reviewActionContinue'), reviewActionFocusReview:qs('#reviewActionFocusReview'), reviewActionFinish:qs('#reviewActionFinish'), headerSection:qs('#statSection'), headerLevelAvg:qs('#statLevelAvg'), headerProgressCurrent:qs('#statProgressCurrent'), headerProgressTotal:qs('#statProgressTotal'), pbar:qs('#pbar'), footer:qs('#footerMessage'), nextAction:qs('#nextActionMessage'), footerInfoContainer:qs('#footerInfo'), footerInfoBtn:qs('#footerInfoBtn'), footerInfoDialog:qs('#footerInfoDialog'), footerInfoDialogBody:qs('#footerInfoDialogBody'), en:qs('#enText'), ja:qs('#jaText'), chips:qs('#chips'), match:qs('#valMatch'), level:qs('#valLevel'), attempt:qs('#attemptInfo'), play:qs('#btnPlay'), mic:qs('#btnMic'), micStatus:qs('#micStatus'), card:qs('#card'), secSel:qs('#secSel'), studySecSel:qs('#studySecSel'), orderSel:qs('#orderSel'), search:qs('#rangeSearch'), levelFilter:qs('#levelFilter'), composeGuide:qs('#composeGuide'), composeTokens:qs('#composeTokens'), composeAnswer:qs('#composeAnswer'), composeContext:qs('#composeContext'), composeFeedback:qs('#composeFeedback'), composeControls:qs('#composeControls'), composeNote:qs('#composeNote'), cfgBtn:qs('#btnCfg'), cfgModal:qs('#cfgModal'), cfgClose:qs('#cfgClose'), btnPickDir:qs('#btnPickDir'), btnClearDir:qs('#btnClearDir'), dirStatus:qs('#dirStatus'), overlay:qs('#loadingOverlay'), speedCtrl:qs('#speedCtrl'), speedToggle:qs('#speedToggle'), speedCtrlBody:qs('#speedCtrlBody'), speed:qs('#speedSlider'), speedDown:qs('#speedDown'), speedUp:qs('#speedUp'), speedValue:qs('#speedValue'), dailyGoalCard:qs('#dailyGoalCard'), dailyGoalBody:qs('#dailyGoalBody'), dailyGoalToggle:qs('#dailyGoalToggle'), dailyGoalToggleState:qs('#dailyGoalToggleState'), dailyGoalRing:qs('#dailyGoalRing'), dailyGoalPercent:qs('#dailyGoalPercent'), dailyGoalTag:qs('#dailyGoalTag'), dailyGoalDone:qs('#dailyGoalDone'), dailyGoalTarget:qs('#dailyGoalTarget'), dailyGoalHint:qs('#dailyGoalHint'), sessionGoalCard:qs('#sessionGoalCard'), sessionGoalBody:qs('#sessionGoalBody'), sessionGoalToggle:qs('#sessionGoalToggle'), sessionGoalRing:qs('#sessionGoalRing'), sessionGoalPercent:qs('#sessionGoalPercent'), sessionGoalTag:qs('#sessionGoalTag'), sessionGoalDone:qs('#sessionGoalDone'), sessionGoalTarget:qs('#sessionGoalTarget'), sessionGoalSlider:qs('#sessionGoalSlider'), sessionGoalBarFill:qs('#sessionGoalBarFill'), dailyOverviewCard:qs('#dailyOverviewCard'), dailyOverviewBody:qs('#dailyOverviewBody'), dailyOverviewToggle:qs('#dailyOverviewToggle'), dailyOverviewToggleState:qs('#dailyOverviewToggleState'), dailyOverviewDiff:qs('#dailyOverviewDiff'), dailyOverviewTrendStatus:qs('#dailyOverviewTrendStatus'), dailyOverviewNote:qs('#dailyOverviewNote'), overviewHighlights:qs('#dailyOverviewHighlights'), overviewTodayFill:qs('#overviewTodayFill'), overviewYesterdayFill:qs('#overviewYesterdayFill'), overviewTodayValue:qs('#overviewTodayValue'), overviewYesterdayValue:qs('#overviewYesterdayValue'), overviewPromotionStatus:qs('#overviewPromotionStatus'), overviewTaskBalance:qs('#overviewTaskBalance'), overviewMilestones:qs('#overviewMilestones'), overviewQuickStart:qs('#overviewQuickStart'), };
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
      }else{
        promotionTone='progress';
      }
    }else if(promotionNote){
      promotionTone='progress';
    }
    return {
      trend:{
        today:todayTotal,
        yesterday:yesterdayTotal,
        maxValue,
        diff,
        status:trendStatus,
        label:diff>0?`+${diff}件`:diff<0?`${diff}件`:'±0件'
      },
      streak:{
        today:todayStreak,
        yesterday:yesterdayStreak,
        diff:streakDiff,
        status:streakStatus
      },
      promotion:{ note:promotionNote, tone:promotionTone },
      review:{ dueCount, completionRate, completionLabel:`${Math.round(completionRate*100)}%` },
      taskBalance:(()=>{
        const counts={ read:0, compose:0, generate:0 };
        for(const entry of (Array.isArray(QUEUE)?QUEUE:[])){
          const type=String(entry?.taskType||'read').toLowerCase();
          if(Object.prototype.hasOwnProperty.call(counts,type)) counts[type]+=1;
          else counts.read+=1;
        }
        const total=Math.max(0, counts.read+counts.compose+counts.generate);
        const dominant=total>0 ? Math.max(counts.read,counts.compose,counts.generate)/total : 0;
        return { counts, total, dominant };
      })(),
      milestones:buildRecentLevelMilestones(4),
      goalSnapshot: summary.goalSnapshot,
      sections: summary.sections,
      weeklyHighlights,
      resumeTriggerNote,
      highlights: buildOverviewHighlightItems({ summary, todayStats, yesterdayStats, promotion:{ note:promotionNote, tone:promotionTone }, weeklyHighlights })
    };
  }

  function applyGoalCollapsed(target, collapsed){
    if(target!=='daily' && target!=='session') return;
    const isDaily=target==='daily';
    const nextCollapsed=!!collapsed;
    goalCollapsed[target]=nextCollapsed;
    saveString(isDaily?DAILY_GOAL_COLLAPSE:SESSION_GOAL_COLLAPSE, nextCollapsed?'1':'0');
    const body=isDaily ? el.dailyGoalBody : el.sessionGoalBody;
    const card=isDaily ? el.dailyGoalCard : el.sessionGoalCard;
    const toggle=isDaily ? el.dailyGoalToggle : el.sessionGoalToggle;
    if(body){
      body.hidden=nextCollapsed;
    }
    if(card){
      card.classList.toggle('is-collapsed', nextCollapsed);
    }
    if(toggle){
      if(body && body.id){
        toggle.setAttribute('aria-controls', body.id);
      }
      toggle.classList.toggle('is-collapsed', nextCollapsed);
      toggle.setAttribute('aria-expanded', nextCollapsed?'false':'true');
      toggle.setAttribute('aria-label', nextCollapsed ? (isDaily?'今日の目標を展開する':'セッション目標を展開する') : (isDaily?'今日の目標を折りたたむ':'セッション目標を折りたたむ'));
    }
    if(isDaily && el.dailyGoalToggleState){
      el.dailyGoalToggleState.textContent=nextCollapsed
        ? '現在は折りたたみ中です。ボタンを押すと展開します。'
        : '現在は展開中です。ボタンを押すと折りたたみます。';
    }
  }

  function initGoalCollapseState(){
    goalCollapsed.daily=loadString(DAILY_GOAL_COLLAPSE, '0')==='1';
    goalCollapsed.session=loadString(SESSION_GOAL_COLLAPSE, '0')==='1';
    applyGoalCollapsed('daily', goalCollapsed.daily);
    applyGoalCollapsed('session', goalCollapsed.session);
    if(el.dailyGoalToggle){
      el.dailyGoalToggle.addEventListener('click',()=>{
        applyGoalCollapsed('daily', !goalCollapsed.daily);
      });
    }
    if(el.sessionGoalToggle){
      el.sessionGoalToggle.addEventListener('click',()=>{
        applyGoalCollapsed('session', !goalCollapsed.session);
      });
    }
  }

  function applyOverviewCollapsed(collapsed){
    overviewCollapsed=!!collapsed;
    saveString(DAILY_OVERVIEW, overviewCollapsed?'1':'0');
    if(el.dailyOverviewBody){
      el.dailyOverviewBody.hidden=overviewCollapsed;
    }
    if(el.dailyOverviewCard){
      el.dailyOverviewCard.classList.toggle('is-collapsed', overviewCollapsed);
    }
    if(el.dailyOverviewToggle){
      el.dailyOverviewToggle.classList.toggle('is-collapsed', overviewCollapsed);
      el.dailyOverviewToggle.setAttribute('aria-expanded', overviewCollapsed?'false':'true');
      el.dailyOverviewToggle.setAttribute('aria-label', overviewCollapsed?'今日の概要を展開する':'今日の概要を折りたたむ');
    }
    if(el.dailyOverviewToggleState){
      el.dailyOverviewToggleState.textContent=overviewCollapsed
        ? '現在は折りたたみ中です。ボタンを押すと展開します。'
        : '現在は展開中です。ボタンを押すと折りたたみます。';
    }
  }

  function initOverviewCollapseState(){
    const stored=loadString(DAILY_OVERVIEW, '0');
    overviewCollapsed=stored==='1';
    applyOverviewCollapsed(overviewCollapsed);
    if(el.dailyOverviewToggle){
      el.dailyOverviewToggle.addEventListener('click',()=>{
        applyOverviewCollapsed(!overviewCollapsed);
      });
    }
  }









  function initSpeedControlCollapse(){
    if(!el.speedCtrl || !el.speedToggle) return;
    const mobileQuery=window.matchMedia('(max-width: 480px)');
    const applyMode=()=>{
      const isMobile=mobileQuery.matches;
      if(!isMobile){
        el.speedCtrl.classList.remove('is-expanded');
        el.speedToggle.setAttribute('aria-expanded', 'false');
        el.speedToggle.setAttribute('aria-label', '再生速度コントロールを展開する');
        return;
      }
      el.speedCtrl.classList.remove('is-expanded');
      el.speedToggle.setAttribute('aria-expanded', 'false');
      el.speedToggle.setAttribute('aria-label', '再生速度コントロールを展開する');
    };
    el.speedToggle.addEventListener('click',()=>{
      if(!mobileQuery.matches) return;
      const expanded=!el.speedCtrl.classList.contains('is-expanded');
      el.speedCtrl.classList.toggle('is-expanded', expanded);
      el.speedToggle.setAttribute('aria-expanded', expanded?'true':'false');
      el.speedToggle.setAttribute('aria-label', expanded?'再生速度コントロールを折りたたむ':'再生速度コントロールを展開する');
    });
    applyMode();
    if(typeof mobileQuery.addEventListener==='function'){
      mobileQuery.addEventListener('change', applyMode);
    }else if(typeof mobileQuery.addListener==='function'){
      mobileQuery.addListener(applyMode);
    }
  }


  function renderOverviewTrend(model){
    if(el.dailyOverviewDiff){
      const prefix=model.trend.status==='up'?'▲':(model.trend.status==='down'?'▼':'→');
      el.dailyOverviewDiff.textContent=`${prefix} ${model.trend.label||'—'}`;
      el.dailyOverviewDiff.classList.remove('is-up','is-down','is-even');
      if(model.trend.status==='up') el.dailyOverviewDiff.classList.add('is-up');
      else if(model.trend.status==='down') el.dailyOverviewDiff.classList.add('is-down');
      else el.dailyOverviewDiff.classList.add('is-even');
    }
    if(el.dailyOverviewTrendStatus){
      el.dailyOverviewTrendStatus.textContent=`今日${model.trend.today}件 / 昨日${model.trend.yesterday}件`;
      el.dailyOverviewTrendStatus.classList.remove('is-up','is-down','is-even');
      if(model.trend.status==='up') el.dailyOverviewTrendStatus.classList.add('is-up');
      else if(model.trend.status==='down') el.dailyOverviewTrendStatus.classList.add('is-down');
      else el.dailyOverviewTrendStatus.classList.add('is-even');
    }
    const maxBar=Math.max(1, model.trend.maxValue||1);
    const todayPct=Math.max(6, Math.round(Math.min(100, (model.trend.today/maxBar)*100)));
    const yesterdayPct=Math.max(6, Math.round(Math.min(100, (model.trend.yesterday/maxBar)*100)));
    if(el.overviewTodayFill){
      el.overviewTodayFill.style.width=`${todayPct}%`;
    }
    if(el.overviewYesterdayFill){
      el.overviewYesterdayFill.style.width=`${yesterdayPct}%`;
    }
    if(el.overviewTodayValue){
      el.overviewTodayValue.textContent=`${model.trend.today}件`;
    }
    if(el.overviewYesterdayValue){
      el.overviewYesterdayValue.textContent=`${model.trend.yesterday}件`;
    }
  }

  function renderOverviewHighlights(list){
    if(!el.overviewHighlights) return;
    el.overviewHighlights.innerHTML='';
    if(!Array.isArray(list) || !list.length){
      const empty=document.createElement('p');
      empty.className='overview-empty';
      empty.textContent='ハイライトはまだありません';
      el.overviewHighlights.appendChild(empty);
      return;
    }
    for(const item of list){
      const row=document.createElement('div');
      row.className='overview-highlight';
      if(item.tone){
        row.classList.add(`tone-${item.tone}`);
      }
      const icon=document.createElement('span');
      icon.className='overview-highlight__icon';
      icon.textContent=item.icon||'•';
      const text=document.createElement('p');
      text.className='overview-highlight__text';
      text.textContent=item.text||'';
      row.appendChild(icon);
      row.appendChild(text);
      el.overviewHighlights.appendChild(row);
    }
  }

  function renderOverviewMilestones(list){
    if(!el.overviewMilestones) return;
    el.overviewMilestones.innerHTML='';
    if(!Array.isArray(list) || !list.length){
      const empty=document.createElement('p');
      empty.className='overview-empty';
      empty.textContent='Lv4/Lv5の達成履歴はまだありません';
      el.overviewMilestones.appendChild(empty);
      return;
    }
    for(const item of list){
      const pill=document.createElement('div');
      pill.className=`overview-pill level-${item.level>=5?5:4}`;
      const icon=document.createElement('div');
      icon.className='overview-pill__icon';
      icon.textContent=item.level>=5?'Lv5':'Lv4';
      const content=document.createElement('div');
      content.className='overview-pill__content';
      const title=document.createElement('p');
      title.className='overview-pill__title';
      title.textContent=item.label||`#${item.id}`;
      const meta=document.createElement('p');
      meta.className='overview-pill__meta';
      meta.textContent=item.when ? `${item.when}更新` : '更新日不明';
      content.appendChild(title);
      content.appendChild(meta);
      pill.appendChild(icon);
      pill.appendChild(content);
      el.overviewMilestones.appendChild(pill);
    }
  }

  function updateDailyOverview(){
    if(!el.dailyOverviewCard) return;
    const model=buildDailyOverviewModel();
    renderOverviewTrend(model);
    const goalSnapshot=model.goalSnapshot||{};
    const dailyRemaining=Math.max(0, goalSnapshot?.daily?.remaining ?? 0);
    const sessionRemaining=Math.max(0, goalSnapshot?.session?.remaining ?? 0);
    const remainingTargets=[
      { type:'daily', label:'今日の目標', remaining:dailyRemaining, done:goalSnapshot?.daily?.done, target:goalSnapshot?.daily?.target },
      { type:'session', label:'セッション目標', remaining:sessionRemaining, done:goalSnapshot?.session?.done, target:goalSnapshot?.session?.target }
    ].filter(entry=>entry.remaining>0);
    const nextTarget=remainingTargets.length ? remainingTargets.reduce((best, cur)=>cur.remaining<best.remaining?cur:best) : null;
    if(el.overviewQuickStart){
      let ctaText='復習を続ける';
      let ariaLabel='目標は達成済みです。復習を続けましょう';
      const reviewDue=Math.max(0, Number(model?.review?.dueCount)||0);
      if(reviewDue>0){
        ctaText=`期限切れ${reviewDue}件を先に復習`;
        ariaLabel=`期限切れカード${reviewDue}件を優先して取り組む`;
      }else if(nextTarget){
        ctaText=`あと${nextTarget.remaining}件で${nextTarget.label}`;
        ariaLabel=`${ctaText}に到達`;
      }
      el.overviewQuickStart.textContent=ctaText;
      el.overviewQuickStart.setAttribute('aria-label', ariaLabel);
    }
    if(el.dailyOverviewNote){
      const dailyProgressLabel=goalSnapshot?.daily?.target>0 ? `${Math.max(0, goalSnapshot.daily.done||0)}/${goalSnapshot.daily.target}件` : `${Math.max(0, goalSnapshot?.daily?.done||0)}件`;
      const sessionProgressLabel=goalSnapshot?.session?.target>0 ? `${Math.max(0, goalSnapshot.session.done||0)}/${goalSnapshot.session.target}件` : `${Math.max(0, goalSnapshot?.session?.done||0)}件`;
      let noteText='';
      if(nextTarget){
        const estimatedMinutes=Math.max(1, Math.ceil(nextTarget.remaining));
        const progressLabel=nextTarget.type==='daily' ? dailyProgressLabel : sessionProgressLabel;
        noteText=`${nextTarget.label}まであと${nextTarget.remaining}件（現在${progressLabel}）。すぐ始めれば${estimatedMinutes}分で達成ペース`;
      }else{
        noteText=`今日の目標(${dailyProgressLabel})とセッション目標(${sessionProgressLabel})はクリア済み。復習で定着をキープしましょう`;
      }
      const reviewDue=Math.max(0, Number(model?.review?.dueCount)||0);
      const completionLabel=model?.review?.completionLabel||'0%';
      noteText+=` / 期限切れカード${reviewDue}件 / 本日消化率${completionLabel}`;
      if(model?.resumeTriggerNote){
        noteText+=` / ${model.resumeTriggerNote}`;
      }
      el.dailyOverviewNote.textContent=noteText;
    }
    if(el.overviewPromotionStatus){
      el.overviewPromotionStatus.textContent=model.promotion.note || '昇格条件のメモはまだありません';
      el.overviewPromotionStatus.classList.remove('is-ready','is-wait','is-cooldown');
      if(model.promotion.tone==='ready') el.overviewPromotionStatus.classList.add('is-ready');
      else if(model.promotion.tone==='cooldown') el.overviewPromotionStatus.classList.add('is-cooldown');
      else if(model.promotion.tone==='progress') el.overviewPromotionStatus.classList.add('is-wait');
    }
    if(el.overviewTaskBalance){
      const bal=model.taskBalance||{};
      const c=bal.counts||{};
      const read=Math.max(0, Number(c.read)||0);
      const compose=Math.max(0, Number(c.compose)||0);
      const generate=Math.max(0, Number(c.generate)||0);
      const total=Math.max(0, Number(bal.total)||0);
      const dominant=Math.max(0, Number(bal.dominant)||0);
      el.overviewTaskBalance.textContent=`read ${read} / compose ${compose} / generate ${generate}${total>0?`（計${total}）`:''}`;
      el.overviewTaskBalance.classList.remove('is-ready','is-wait','is-cooldown');
      if(total>0 && dominant>=0.7){
        el.overviewTaskBalance.classList.add('is-wait');
      }else{
        el.overviewTaskBalance.classList.add('is-ready');
      }
    }
    renderOverviewHighlights(model.highlights);
    renderOverviewMilestones(model.milestones);
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
    const closeButton=qs('#footerInfoDialogClose', dialog);
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
      const focusTarget=closeButton || qs('button[value="close"]', dialog);
      if(focusTarget){
        try{ focusTarget.focus({preventScroll:true}); }catch(_){ focusTarget.focus(); }
      }
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
    setTimeout(()=>{ toast('ℹ️ ボタンから学習ルールを確認できます', 2200); }, 500);
  }

  function isMobileViewport(){
    try{ return !!(globalThis.matchMedia && globalThis.matchMedia(MOBILE_MEDIA_QUERY).matches); }catch(_){ return false; }
  }

  function truncateMessage(text, maxLength){
    const raw=typeof text==='string' ? text.trim() : '';
    if(!raw || raw.length<=maxLength) return raw;
    return `${raw.slice(0, Math.max(1, maxLength-1)).trimEnd()}…`;
  }

  function shortenStatusMessage(status, {lowPriority=false}={}){
    const raw=typeof status==='string' ? status.trim() : '';
    if(!raw) return '';
    if(!isMobileViewport()) return raw;
    if(raw===DEFAULT_FOOTER_HINT) return '左右スワイプで移動、下スワイプでヒント切替。';
    if(raw===LONG_HINT_MESSAGE_COMPOSE_JA) return lowPriority ? '和訳ヒント表示。' : '和訳ヒント表示。次は音声ヒント。';
    if(raw===LONG_HINT_MESSAGE_COMPOSE_AUDIO) return lowPriority ? '音声ヒントON。' : '音声ヒントON。次は英文ヒント。';
    if(raw===LONG_HINT_MESSAGE_READ_EN) return lowPriority ? '英文ヒント表示。' : '英文ヒント表示。次は和訳ヒント。';
    if(raw==='ヒントを非表示に戻しました。下スワイプで再表示できます。') return 'ヒントを非表示にしました。';
    if(raw==='準備ができ次第、学習を自動で開始します') return '準備中。まもなく開始します。';
    if(raw.startsWith('一致率') && lowPriority) return truncateMessage(raw, 28);
    return truncateMessage(raw, lowPriority?30:44);
  }

  function shortenActionMessage(action, {lowPriority=false}={}){
    const raw=typeof action==='string' ? action.trim() : '';
    if(!raw) return '';
    if(!isMobileViewport()) return raw;
    if(raw==='次回の1アクション：冠詞・前置詞を意識して再挑戦。') return lowPriority ? '次: 冠詞/前置詞を意識。' : '次: 冠詞・前置詞を意識して再挑戦。';
    if(raw==='次回の1アクション：語順を固定して言い直そう。') return lowPriority ? '次: 語順を固定。' : '次: 語順を固定して言い直そう。';
    if(raw==='次回の1アクション：時制・語尾変化を確認して再挑戦。') return lowPriority ? '次: 時制と語尾を確認。' : '次: 時制・語尾変化を確認して再挑戦。';
    if(raw==='次回の1アクション：抜けた語を補って再挑戦。') return lowPriority ? '次: 抜け語を補う。' : '次: 抜けた語を補って再挑戦。';
    return truncateMessage(raw, lowPriority?22:34);
  }

  function setLiveRegionText(node, message){
    if(!node) return false;
    const next=typeof message==='string' ? message : '';
    if(node.textContent===next) return false;
    node.textContent=next;
    return true;
  }

  function setFooterMessages(status, action, {actionPriority=false}={}){
    const hasStatus=typeof status==='string' && !!status.trim();
    const hasAction=typeof action==='string' && !!action.trim();
    const compactStatus=shortenStatusMessage(status, {lowPriority:hasAction && actionPriority});
    const compactAction=shortenActionMessage(action, {lowPriority:hasStatus && !actionPriority});
    const statusText=hasStatus ? compactStatus : '';
    const actionText=hasAction ? compactAction : '';
    setLiveRegionText(el.footer, statusText);
    setLiveRegionText(el.nextAction, actionText);
  }

  function initFooterInfoButton(){
    if(el.footer && !el.footer.textContent){
      setFooterMessages(DEFAULT_FOOTER_HINT, '');
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
    });
    const speech=createSpeechSynthesisController({
      setSpeechPlayingState: controller.setSpeechPlayingState,
      getCurrentItem: ()=>currentItem,
      isSpeechDesired: ()=>currentShouldUseSpeech,
      getActiveCharacterId: ()=>globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__||'',
      canStartSpeech: ()=>controller.getAudioLockState()===AUDIO_LOCK_STATES.UNLOCKED
        && !recognitionController?.isActive?.(),
    });
    speech.setSpeechRate(controller.getPlaybackRate());
    return { controller, speech };
  }

  const { controller: audioController, speech } = initializeMediaControllers();
  speechController=speech;

  initFooterInfoButton();
  initGoalCollapseState();
  initOverviewCollapseState();
  initSpeedControlCollapse();
  if(el.overviewQuickStart){
    el.overviewQuickStart.addEventListener('click', handleQuickStart);
  }
  if(el.startStudyCta){
    el.startStudyCta.addEventListener('click', handleQuickStart);
  }
  if(el.reviewActionContinue){
    el.reviewActionContinue.addEventListener('click', ()=>{
      setViewState(VIEW_HOME);
      handleQuickStart();
    });
  }
  if(el.reviewActionFocusReview){
    el.reviewActionFocusReview.addEventListener('click', ()=>{
      if(el.orderSel){
        el.orderSel.value='srs';
        saveString(ORDER_SELECTION, 'srs');
      }
      setViewState(VIEW_HOME);
      rebuildAndRender(true,{autoStart:true, autoPlay:isAutoPlayAllowed()}).catch(()=>{});
    });
  }
  if(el.reviewActionFinish){
    el.reviewActionFinish.addEventListener('click', ()=>{
      setViewState(VIEW_HOME);
      showIdleCard();
    });
  }
  setViewState(VIEW_HOME);

  const {
    playTone,
    prepareToneOutput,
    updatePlayButtonAvailability: baseUpdatePlayButtonAvailability,
    updatePlayVisualState,
    setAudioSource,
    clearAudioSource,
    primeAudio,
    setSpeechPlayingState,
    setAudioLockState: baseSetAudioLockState,
    getAudioLockState,
    isPlaybackTransitionLocked,
    authorizeUserPlayback,
    isTonePlaying,
    stopAllTones,
  } = audioController;
  let micUiState=MIC_UI_STATES.OFF;
  function setMicUiState(state){
    micUiState=applyMicStatus({statusElement:el.micStatus,micButton:el.mic,state});
    return micUiState;
  }
  function micUiStateForAudioLock(state){
    if(state===AUDIO_LOCK_STATES.PENDING) return MIC_UI_STATES.PENDING;
    if(state===AUDIO_LOCK_STATES.ACTIVE) return MIC_UI_STATES.ACTIVE;
    if(state===AUDIO_LOCK_STATES.RELEASE) return MIC_UI_STATES.RELEASE;
    return MIC_UI_STATES.OFF;
  }
  function setAudioLockState(state){
    const applied=baseSetAudioLockState(state);
    if(applied!==AUDIO_LOCK_STATES.UNLOCKED){
      speechController?.cancelSpeech?.();
    }
    setMicUiState(micUiStateForAudioLock(applied));
    return applied;
  }
  const resultFeedbackQueue=createResultFeedbackQueue({
    getMode:()=> 'standard',
    isUnlocked:()=>getAudioLockState()===AUDIO_LOCK_STATES.UNLOCKED,
    playTone,
    vibrate:(duration)=>navigator.vibrate?.(duration),
  });
  const overlayController = createOverlayController({ overlayElement: el.overlay });
  const acquireOverlay = (tag='load') => overlayController.acquire(tag);
  const { queueTransition: queueCardTransition } = createCardTransitionQueue({
    cardElement: el.card
  });
  let sessionActive=false;
  let sessionStarting=false;
  let activeTrainingMode=TRAINING_MODES.STANDARD;
  let shadowCycleToken=0;
  let shadowCycleState=null;
  let shadowingPaused=false;
  const shadowingSessionMetrics={cards:0,durationMs:0};
  let QUEUE=[];
  let idx=-1;
  let sessionStart=0;
  const FATIGUE_CONSECUTIVE_THRESHOLD=8;
  const FATIGUE_FAIL_RATE_THRESHOLD=0.45;
  const FATIGUE_MIN_ATTEMPTS=6;
  const createEmptySessionMetrics=()=>({ startMs:0, cardsDone:0, newIntroduced:0, currentStreak:0, highestStreak:0, attempts:0, failures:0, fatigueAlerted:false });
  let sessionMetrics=createEmptySessionMetrics();
  let latestSessionClosureSummary=null;
  const createEmptySpeechSessionStats=()=>({ submissions:new Map(), correct:new Map() });
  let speechSessionStats=createEmptySpeechSessionStats();
  let autoPlayUnlocked=false;
  let lastEmptySearchToast='';

  function isShadowingSession(){ return isContinuousShadowingMode(activeTrainingMode); }
  function consumePendingTrainingMode(){
    if(!Object.prototype.hasOwnProperty.call(globalThis,'__ENGLISH_PWA_PENDING_TRAINING_MODE__')) return activeTrainingMode;
    activeTrainingMode=normalizeTrainingMode(globalThis.__ENGLISH_PWA_PENDING_TRAINING_MODE__);
    try{delete globalThis.__ENGLISH_PWA_PENDING_TRAINING_MODE__;}catch(_){globalThis.__ENGLISH_PWA_PENDING_TRAINING_MODE__=TRAINING_MODES.STANDARD;}
    return activeTrainingMode;
  }

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


  function buildFatigueGuidanceMessage(){
    const failRate=sessionMetrics && sessionMetrics.attempts>0 ? sessionMetrics.failures/sessionMetrics.attempts : 0;
    const failRateLabel=`${Math.round(failRate*100)}%`;
    return `集中負荷が上がっています（連続${Math.max(0, sessionMetrics?.cardsDone||0)}件 / 失敗率${failRateLabel}）。2分休憩 or 軽め3件で終了がおすすめです`;
  }

  function maybeNotifyFatigue(){
    if(!sessionMetrics || !sessionMetrics.startMs || sessionMetrics.fatigueAlerted) return;
    const attempts=Math.max(0, Number(sessionMetrics.attempts)||0);
    const cardsDone=Math.max(0, Number(sessionMetrics.cardsDone)||0);
    const failures=Math.max(0, Number(sessionMetrics.failures)||0);
    const failRate=attempts>0 ? failures/attempts : 0;
    const thresholdReached = cardsDone>=FATIGUE_CONSECUTIVE_THRESHOLD && attempts>=FATIGUE_MIN_ATTEMPTS && failRate>=FATIGUE_FAIL_RATE_THRESHOLD;
    if(!thresholdReached) return;
    sessionMetrics.fatigueAlerted=true;
    const msg=buildFatigueGuidanceMessage();
    toast(msg, 3600);
    if(el.dailyOverviewNote){
      el.dailyOverviewNote.textContent=`🧠 ${msg}`;
    }
  }

  function buildSessionClosureSummary(reason='manual'){
    const cardsDone=Math.max(0, Number(sessionMetrics?.cardsDone)||0);
    const attempts=Math.max(0, Number(sessionMetrics?.attempts)||0);
    const failures=Math.max(0, Number(sessionMetrics?.failures)||0);
    const failRate=attempts>0 ? failures/attempts : 0;
    const nextGoal=Math.max(1, Math.min(3, cardsDone>0 ? 1 : 2));
    const conversationIds=[...speechSessionStats.submissions.keys()];
    const conversationCount=conversationIds.length||cardsDone;
    const retryConversationCount=conversationIds.filter(id=>(speechSessionStats.submissions.get(id)||0)>1||(speechSessionStats.correct.get(id)||0)===0).length;
    const shadowing=isShadowingSession();
    return {
      reason,
      trainingMode:shadowing?TRAINING_MODES.CONTINUOUS_SHADOWING:TRAINING_MODES.STANDARD,
      cardsDone,
      conversationCount,
      retryConversationCount,
      attempts,
      newIntroduced:Math.max(0, Number(sessionMetrics?.newIntroduced)||0),
      highestStreak:Math.max(0, Number(sessionMetrics?.highestStreak)||0),
      failRate:Math.round(failRate*1000)/1000,
      nextDayMinimumGoal:nextGoal,
      message:shadowing
        ?`連続シャドウイング: ${cardsDone}文 / ${Math.max(1,Math.round(shadowingSessionMetrics.durationMs/60000))}分。`
        :`今日の達成: ${cardsDone}件 / 最高連続${Math.max(0, Number(sessionMetrics?.highestStreak)||0)}件。明日は最小${nextGoal}件だけでOK。`
    };
  }

  function presentSessionClosureSummary(summary){
    if(!summary) return;
    latestSessionClosureSummary=summary;
    const failRateLabel=`${Math.round(Math.max(0, Number(summary.failRate)||0)*100)}%`;
    const toastMessage=`🎉 ${summary.message}`;
    toast(toastMessage, 3600);
    if(el.dailyOverviewNote){
      el.dailyOverviewNote.textContent=summary.trainingMode===TRAINING_MODES.CONTINUOUS_SHADOWING
        ?summary.message
        :`${summary.message}（失敗率${failRateLabel}）`;
    }
  }

  function presentReviewCompleteView(summary){
    if(!summary) return;
    const failRateLabel=`${Math.round(Math.max(0, Number(summary.failRate)||0)*100)}%`;
    if(el.reviewCompleteMessage){
      el.reviewCompleteMessage.textContent=summary.trainingMode===TRAINING_MODES.CONTINUOUS_SHADOWING
        ?summary.message
        :`${summary.message}（失敗率${failRateLabel} / 新規${Math.max(0, Number(summary.newIntroduced)||0)}件）`;
    }
    if(el.reviewCompleteView) el.reviewCompleteView.dataset.trainingMode=summary.trainingMode||TRAINING_MODES.STANDARD;
    document.dispatchEvent(new CustomEvent('english-pwa:session-result',{detail:{...summary}}));
    setViewState(VIEW_REVIEW_COMPLETE);
  }

  function finalizeSessionMetrics(reason='manual'){
    if(!sessionMetrics || !sessionMetrics.startMs){
      sessionMetrics=createEmptySessionMetrics();
      return;
    }
    const closureSummary=buildSessionClosureSummary(reason);
    recordSessionClosureSummary({ summary:closureSummary });
    presentSessionClosureSummary(closureSummary);
    sessionMetrics=createEmptySessionMetrics();
    updateGoalProgressFromMetrics();
    updateDailyOverview();
  }

  function beginSessionMetrics(){
    sessionMetrics=createEmptySessionMetrics();
    sessionMetrics.startMs=now();
    resetSpeechSessionStats();
    goalState.sessionDone=0;
    goalMilestones.session=false;
    updateGoalProgressFromMetrics();
  }

  function resetSpeechSessionStats(){
    speechSessionStats=createEmptySpeechSessionStats();
  }

  function recordSpeechAttempt(itemId, isCorrect=false){
    if(!itemId) return { submissions:0, correct:0 };
    const key=String(itemId);
    const submissions=speechSessionStats.submissions;
    const correct=speechSessionStats.correct;
    const nextSub=(submissions.get(key)||0)+1;
    submissions.set(key, nextSub);
    if(isCorrect){
      correct.set(key, (correct.get(key)||0)+1);
    }
    return {
      submissions: nextSub,
      correct: correct.get(key)||0
    };
  }




  let hintStage=BASE_HINT_STAGE;
  let maxHintStageUsed=BASE_HINT_STAGE;
  let currentEnHtml='';
  let currentReorderSetupReason='';
  let reorderSetupPending=false;
  let reorderSetupGeneration=0;
  let currentItem=null;
  let lastErrorType='';
  let sameErrorStreak=0;

  function recordHintStageUsed(stage){
    maxHintStageUsed=retainHighestHintStageUsed(maxHintStageUsed,stage);
  }

  function restoreReorderSetupNotice(){
    if(currentReorderSetupReason){
      setFooterMessages('並べ替えを安全に停止しました',currentReorderSetupReason);
    }
  }

  function getMaxHintStage(){
    return isProductionTask() ? COMPOSE_HINT_STAGE_EN : BASE_HINT_STAGE+2;
  }

  function getFirstHintStage(){
    return BASE_HINT_STAGE+1;
  }

  function getJapaneseHintStage(){
    return isProductionTask() ? COMPOSE_HINT_STAGE_JA : BASE_HINT_STAGE+2;
  }

  function getAudioUnlockStage(){
    return isProductionTask() ? COMPOSE_HINT_STAGE_AUDIO : BASE_HINT_STAGE;
  }

  function getEnglishRevealStage(){
    return isProductionTask() ? COMPOSE_HINT_STAGE_EN : BASE_HINT_STAGE+1;
  }

  function isAudioHintUnlocked(stage=hintStage){
    const unlockStage=getAudioUnlockStage();
    if(unlockStage<=BASE_HINT_STAGE) return true;
    return stage>=unlockStage;
  }

  function updatePlayButtonAvailability(){
    baseUpdatePlayButtonAvailability();
    if(!el.play) return;
    if(currentShouldUseSpeech&&getAudioLockState()!==AUDIO_LOCK_STATES.UNLOCKED){
      el.play.disabled=true;
      el.play.setAttribute('aria-disabled','true');
      return;
    }
    if(isShadowingSession()&&getAudioLockState()!==AUDIO_LOCK_STATES.UNLOCKED){
      el.play.disabled=true;
      el.play.setAttribute('aria-disabled','true');
      return;
    }
    if(isPlaybackTransitionLocked()){
      el.play.disabled=true;
      el.play.setAttribute('aria-disabled','true');
      return;
    }
    const locked=isComposeMode() ? !composeGuide.isComplete() : !isAudioHintUnlocked();
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
      return '<span class="hint-placeholder">ヒントを押すか、下にスワイプして和訳を表示（次は音声、さらに次は英文）</span>';
    }
    if(stage<COMPOSE_HINT_STAGE_AUDIO){
      return '<span class="hint-placeholder">英文はまだ非表示です。ヒントをもう一度押すと音声、その次に英文を表示します</span>';
    }
    if(stage<COMPOSE_HINT_STAGE_EN){
      return '<span class="hint-placeholder">英文はまだ非表示です。ヒントをもう一度押すと英文を表示します</span>';
    }
    return '';
  }

  function defaultHintPlaceholder(){
    return '<span class="hint-placeholder">ヒントを押すか、下にスワイプして英文を表示（次は和訳）</span>';
  }

  function showReorderPrompt(){
    el.en.classList.remove('concealed');
    el.en.textContent='文の語順を組み立ててください';
    el.en.setAttribute('aria-label','並べ替えチャレンジ。語句を並べ終えると英文が表示されます。');
  }

  function showCanonicalEnglishAfterReorderSetup(item,reorderState){
    if(isReorderSetupRequested(item) && reorderState?.reason){
      el.en.textContent='並べ替えを停止しました';
      el.mic.disabled=true;
      el.composeGuide.classList.add('show');
      el.composeGuide.setAttribute('aria-hidden','false');
      el.composeFeedback.textContent=reorderState.reason;
      const skip=document.createElement('button');
      skip.type='button'; skip.className='compose-control compose-control--primary';
      skip.textContent='次へ'; skip.addEventListener('click',()=>nextCard(false,false));
      el.composeControls.replaceChildren(skip);
      return;
    }
    el.en.classList.remove('concealed');
    el.en.removeAttribute('aria-label');
    el.en.innerHTML=currentEnHtml;
  }

  function setHintStage(stage,{reset=false}={}){
    if((reorderSetupPending||isComposeMode())&&!reset) return false;
    if(isPostResultReveal(el.en,currentItem?.id)) return false;
    const maxStage=Math.max(BASE_HINT_STAGE, getMaxHintStage());
    const next=Math.max(BASE_HINT_STAGE, Math.min(maxStage, Number.isFinite(stage)?Math.floor(stage):BASE_HINT_STAGE));
    const prev=hintStage;
    hintStage=next;
    if(reset){ maxHintStageUsed=next; }
    else recordHintStageUsed(next);
    const compose=isProductionTask();
    const showEnglish=next>=getEnglishRevealStage();
    const showJapanese=next>=getJapaneseHintStage();
    const card=el.card;
    const hintActive=next>BASE_HINT_STAGE;
    const audioUnlocked=isAudioHintUnlocked(next);
    if(card){
      card.classList.toggle('card-hint-active', hintActive);
      card.classList.toggle('card-hint-audio', audioUnlocked);
    }
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
    clearActiveClozeRecognitionContext();
    el.ja.style.display = showJapanese ? 'block' : 'none';
    updatePlayButtonAvailability();
    return prev!==next;
  }

  function resetPostResultFeedback(){
    clearPostResultReveal(el.en);
  }

  function showPostResultFeedback(item,matchInfo){
    clearActiveClozeRecognitionContext();
    if(!item?.id||!item?.en) return;
    const source=String(matchInfo?.source||'').trim();
    const highlighted=revealCanonicalPostResult(el.en,item,{
      rehighlight:(canonical)=>source&&recognitionController
        ? recognitionController.matchAndHighlight(canonical,source)
        : null,
    });
    if(highlighted){
      lastMatchEval=Object.assign({},highlighted,{source});
      updateMatch(calcMatchScore(highlighted.refCount,highlighted.recall,highlighted.precision));
    }
  }

  function advanceHintStage(){
    if(!sessionActive||reorderSetupPending||isComposeMode()) return;
    const maxStage=Math.max(BASE_HINT_STAGE, getMaxHintStage());
    const nextStage=hintStage>=maxStage ? BASE_HINT_STAGE : hintStage+1;
    const changed=setHintStage(nextStage);
    if(changed){
      if(isProductionTask()){
        if(hintStage===COMPOSE_HINT_STAGE_JA){ setFooterMessages(LONG_HINT_MESSAGE_COMPOSE_JA, ''); }
        else if(hintStage===COMPOSE_HINT_STAGE_AUDIO){ setFooterMessages(LONG_HINT_MESSAGE_COMPOSE_AUDIO, ''); }
        else if(hintStage===COMPOSE_HINT_STAGE_EN){ setFooterMessages('英文ヒントを表示しました。', ''); }
        else if(hintStage===BASE_HINT_STAGE){ setFooterMessages('ヒントを非表示に戻しました。下スワイプで再表示できます。', ''); }
      }else{
        if(hintStage===BASE_HINT_STAGE+1){ setFooterMessages(LONG_HINT_MESSAGE_READ_EN, ''); }
        else if(hintStage===BASE_HINT_STAGE+2){ setFooterMessages('和訳ヒントを表示しました。', ''); }
        else if(hintStage===BASE_HINT_STAGE){ setFooterMessages('ヒントを非表示に戻しました。下スワイプで再表示できます。', ''); }
      }
    }
  }

  document.addEventListener('english-pwa:request-hint',advanceHintStage);


  const ARTICLE_TOKENS=new Set(['a','an','the']);
  const PREPOSITION_TOKENS=new Set(['in','on','at','to','for','from','with','of','by','about','into','through','after','before','over','under','between','around','during','without','within']);

  function toTokenCounts(tokens){
    const map=new Map();
    for(const token of (Array.isArray(tokens)?tokens:[])){
      if(!token) continue;
      map.set(token, (map.get(token)||0)+1);
    }
    return map;
  }

  function stripMorphSuffix(token){
    const raw=(token||'').toLowerCase();
    if(raw.length<=3) return raw;
    if(raw.endsWith('ies') && raw.length>4) return `${raw.slice(0,-3)}y`;
    if(raw.endsWith('ing') && raw.length>5) return raw.slice(0,-3);
    if(raw.endsWith('ed') && raw.length>4) return raw.slice(0,-2);
    if(raw.endsWith('es') && raw.length>4) return raw.slice(0,-2);
    if(raw.endsWith('s') && raw.length>3) return raw.slice(0,-1);
    return raw;
  }

  function classifySpeechErrors(matchInfo, refText){
    const refTokens=toks(refText||'');
    const spokenTokens=Array.isArray(matchInfo?.hypTokens)?matchInfo.hypTokens:toks(matchInfo?.source||'');
    const missingTokens=Array.isArray(matchInfo?.missing)?matchInfo.missing:[];
    const missingCounts=toTokenCounts(missingTokens);
    const refCounts=toTokenCounts(refTokens);
    const spokenCounts=toTokenCounts(spokenTokens);
    const refBagEquals=refTokens.length===spokenTokens.length && refCounts.size===spokenCounts.size && [...refCounts].every(([k,v])=>spokenCounts.get(k)===v);

    const hasArticlePrepMissing=[...missingCounts.keys()].some(tok=>ARTICLE_TOKENS.has(tok) || PREPOSITION_TOKENS.has(tok));
    const hasOrderIssue=refBagEquals && (refTokens.join(' ')!==spokenTokens.join(' '));

    const spokenSet=new Set(spokenTokens.map(stripMorphSuffix));
    const hasMorphIssue=missingTokens.some(tok=>spokenSet.has(stripMorphSuffix(tok)));

    const errorTypes=[];
    if(hasOrderIssue) errorTypes.push('word_order');
    if(hasArticlePrepMissing) errorTypes.push('article_or_preposition_missing');
    if(hasMorphIssue) errorTypes.push('morphology');
    if(!errorTypes.length && missingTokens.length>0) errorTypes.push('other');

    const primaryType=errorTypes[0]||'none';
    return {
      primaryType,
      errorTypes,
      missingTokens,
      spokenTokens,
      refTokens,
      actionMessage: primaryType==='article_or_preposition_missing'
        ? '次回の1アクション：冠詞・前置詞を意識して再挑戦。'
        : primaryType==='word_order'
          ? '次回の1アクション：語順を固定して言い直そう。'
          : primaryType==='morphology'
            ? '次回の1アクション：時制・語尾変化を確認して再挑戦。'
            : (primaryType==='other' ? '次回の1アクション：抜けた語を補って再挑戦。' : '次回の1アクション：この調子で次へ進もう。')
    };
  }

  function optimizeHintStageForError(errorType){
    if(errorType==='article_or_preposition_missing'){
      return getJapaneseHintStage();
    }
    if(errorType==='word_order'){
      return getEnglishRevealStage();
    }
    if(errorType==='morphology'){
      return Math.max(getEnglishRevealStage(), getAudioUnlockStage());
    }
    return BASE_HINT_STAGE;
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
    el.attempt.textContent=correctiveItemId?'修正練習中':'';
    el.attempt.classList.remove('alert');
  }

  function setMicState(on){
    if(on){setMicUiState(MIC_UI_STATES.ACTIVE);return;}
    setMicUiState(micUiStateForAudioLock(getAudioLockState()));
  }

  // ===== Config =====
  const TASK_TYPE_READ='read';
  const TASK_TYPE_COMPOSE='compose';
  const TASK_TYPE_GENERATE='generate';
  const TASK_TYPE_ROTATION=[TASK_TYPE_READ,TASK_TYPE_COMPOSE,TASK_TYPE_GENERATE];

  const STUDY_MODE_READ='read';
  const STUDY_MODE_COMPOSE='compose';
  function loadCfg(){
    const cfg=loadJson(CONFIG, {});
    return cfg && typeof cfg==='object'?cfg:{};
  }
  let CFG=Object.assign({ studyMode:STUDY_MODE_READ }, loadCfg());
  setMilestoneEffectIntensity('normal');

  function getStudyMode(){
    return CFG.studyMode===STUDY_MODE_COMPOSE ? STUDY_MODE_COMPOSE : STUDY_MODE_READ;
  }
  function getCurrentTaskType(item=currentItem){
    const type=String(item?.taskType||'').toLowerCase();
    return TASK_TYPE_ROTATION.includes(type) ? type : TASK_TYPE_READ;
  }
  function isComposeMode(){
    return getStudyMode()===STUDY_MODE_COMPOSE;
  }
  function requestedPracticeTaskType(item){
    if(getStudyMode()!==STUDY_MODE_COMPOSE) return TASK_TYPE_READ;
    return item?.taskType===TASK_TYPE_GENERATE?TASK_TYPE_GENERATE:TASK_TYPE_COMPOSE;
  }
  function isReorderSetupRequested(item){
    const type=requestedPracticeTaskType(item);
    return type===TASK_TYPE_COMPOSE||type===TASK_TYPE_GENERATE;
  }
  function isProductionTask(item=currentItem){
    const type=requestedPracticeTaskType(item);
    return type===TASK_TYPE_COMPOSE || type===TASK_TYPE_GENERATE;
  }
  function isAutoPlayAllowed(){
    return !isComposeMode();
  }
  function shouldUseSpeechForItem(item){
    if(!item) return false;
    if(item.forceSpeech){ return true; }
    return !audio?.dataset?.srcKey;
  }
  function shouldUseAudioForItem(item){
    if(!item) return false;
    if(item.forceSpeech){ return false; }
    return true;
  }



  // ===== Notification settings =====











  // ===== IndexedDB for DirectoryHandle =====
  const DB='fs-handles', STORE='dir';
  function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>{ r.result.createObjectStore(STORE); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function saveDirHandle(h){ if(isNativeAndroid()) return; const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(h,'audio'); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
  async function loadDirHandle(){ if(isNativeAndroid()) return nativeDirectory('status'); const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const rq=tx.objectStore(STORE).get('audio'); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); }); }
  async function clearDirHandle(){ if(isNativeAndroid()) return nativeDirectory('clear'); const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete('audio'); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

  let DIR=null; // FileSystemDirectoryHandle
  let dirNeedsGesture=false;
  async function ensureDir({prompt=false, forceCheck=false}={}){
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
      refreshDirStatus();
      return DIR;
    }
    if(!prompt){
      dirNeedsGesture = state!=='granted';
      refreshDirStatus();
      return null;
    }
    try{
      state = await DIR.requestPermission?.({mode:'read'});
    }catch(err){
      if(err && (err.name==='InvalidStateError' || /user activation/i.test(err.message||''))){
        dirNeedsGesture=true;
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
        refreshDirStatus();
        return DIR;
      }
      if(state==='prompt'){
        dirNeedsGesture=true;
        refreshDirStatus();
        return null;
      }
      // denied or unknown
      dirNeedsGesture=false;
      DIR=null;
      try{ await clearDirHandle(); }catch(_){ }
      refreshDirStatus();
      return null;
  }


  // Folder changes are applied immediately; no duplicate settings authority.
  if(el.cfgBtn && el.cfgModal){
    el.cfgBtn.addEventListener('click',()=>{
      refreshDirStatus();
      el.cfgModal.style.display='flex';
    });
  }
  if(el.cfgClose && el.cfgModal){
    el.cfgClose.addEventListener('click',()=>{el.cfgModal.style.display='none';});
  }
  const notifHandlers=initNotificationSystem({settings:getNotificationSettings(),toast});
  if(notifHandlers?.handleVisibilityChange){
    document.addEventListener('visibilitychange',notifHandlers.handleVisibilityChange);
  }
  if(el.btnPickDir){
    el.btnPickDir.addEventListener('click', async()=>{
      if(!isNativeAndroid()&&!window.showDirectoryPicker){ toast('この端末はフォルダピッカー非対応'); return; }
      try{
        const h=isNativeAndroid()?await nativeDirectory('pick'):await showDirectoryPicker({mode:'read'});
        audioUrlResolver.clear();
        await saveDirHandle(h);
        DIR=h;
        dirNeedsGesture=false;
        refreshDirStatus();
        await ensureDir({prompt:true, forceCheck:true});
        refreshDirStatus();
        await refreshCurrentAudioSource();
        toast(dirNeedsGesture ? 'フォルダを保存（許可待ち）' : 'フォルダを保存しました');
      }catch(e){
        if(e&&e.name!=='AbortError') toast('フォルダ選択に失敗');
      }
    });
  }
  if(el.btnClearDir){
    el.btnClearDir.addEventListener('click', async()=>{
      await clearDirHandle();
      audioUrlResolver.clear();
      DIR=null;
      dirNeedsGesture=false;
      refreshDirStatus();
      await refreshCurrentAudioSource();
      toast('フォルダ設定を解除');
    });
  }
  function refreshDirStatus(){ if(!el.dirStatus) return; if(DIR){ el.dirStatus.textContent = dirNeedsGesture ? '許可待ち' : '保存済み'; } else { el.dirStatus.textContent = '未設定'; } }

  // GAS Bridge



  // Data
  const DATA_URL='./data/items.json';
  const CHARACTER_DATA_URL='./data/characters.json';
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
    if(el.studySecSel){
      el.studySecSel.innerHTML=sel.innerHTML;
      el.studySecSel.value=sel.value;
    }
    updateHeaderStats();
  }
  function applyItemsData(items,{refreshPicker=false}={}){
    window.ALL_ITEMS=Array.isArray(items)?items.slice():[];
    itemLabelCache.clear();
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
    if(!characterVoiceData){
      try{
        characterVoiceData=await fetchJson(CHARACTER_DATA_URL);
        speechController?.setCharacterVoiceData?.(characterVoiceData);
      }catch(_){
        characterVoiceData={characters:[]};
        speechController?.setCharacterVoiceData?.(characterVoiceData);
      }
    }
    if(!SRS_MAP.size){
      try{ const arr=await fetchJson('./data/srs.json'); const m=new Map(); for(const x of arr) m.set(x.id,x); SRS_MAP=m; }
      catch(_){ SRS_MAP=new Map(); }
    }
  }

  // Build section options (All/単一)
  async function finalizeActiveSession({ reason='manual' }={}){
    if(!(sessionActive || sessionStarting)){
      setViewState(VIEW_HOME);
      return false;
    }
    stopAudio();
    resetPostResultFeedback();
    resultFeedbackQueue.clear();
    cancelShadowingCycle({stopOutput:true});
    cancelPendingMicStart();
    if(recognitionController && recognitionController.isActive()){
      try{
        if(isShadowingSession()) recognitionController.cancel();
        else await stopRec();
      }
      catch(_){ }
    }
    setMicState(false);
    if(isShadowingSession()) sessionMetrics.cardsDone=Math.max(sessionMetrics.cardsDone,shadowingSessionMetrics.cards);
    finalizeSessionMetrics(reason);
    sessionActive=false;
    clearActiveClozeRecognitionContext();
    sessionStarting=false;
    clearRecoverySessionTarget();
    if(reason==='completed' && latestSessionClosureSummary){
      presentReviewCompleteView(latestSessionClosureSummary);
    }else{
      setViewState(VIEW_HOME);
    }
    if(reason==='completed'&&isShadowingSession()){
      setTimeout(()=>{
        if(getAudioLockState()===AUDIO_LOCK_STATES.UNLOCKED) playTone('complete',{intensity:'standard'});
      },MIC_RELEASE_SETTLE_MS+100);
    }
    return true;
  }

  if(typeof document!=='undefined'){
    const handleVisibilityExit=()=>{
      if(document.visibilityState !== 'hidden') return;
      finalizeActiveSession({ reason:'background' }).catch(()=>{});
    };
    document.addEventListener('visibilitychange', handleVisibilityExit);
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
    reorderSetupGeneration+=1;
    reorderSetupPending=false;
    composeGuide.reset();
    el.card.classList.remove('reorder-complete');
  }
  async function setupComposeGuide(item){
    const info=getLevelInfo(item?.id);
    const requestedType=requestedPracticeTaskType(item);
    el.card.classList.toggle('reorder-mode', isComposeMode());
    el.card.classList.remove('reorder-complete');
    const generation=++reorderSetupGeneration;
    reorderSetupPending=requestedType===TASK_TYPE_COMPOSE||requestedType===TASK_TYPE_GENERATE;
    try{
      return await composeGuide.setup(item?{...item,taskType:requestedType}:item, info?.best ?? info?.last ?? 0);
    }finally{
      if(generation===reorderSetupGeneration) reorderSetupPending=false;
    }
  }
  function buildQueue(){
    const sec=el.secSel.value;
    const order=el.orderSel.value;
    const baseItems=sec ? (ITEMS_BY_SECTION.get(sec)||[]) : window.ALL_ITEMS;
    let items=Array.isArray(baseItems) ? baseItems.filter(Boolean) : [];
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
    if(order==='rnd'){
      items=shuffledCopy(items);
    }else if(order==='srs'){
      const nowTs=Date.now();
      const due=[];
      const notDue=[];
      for(const it of items){
        const info=getLevelInfo(it?.id);
        const dueAt=Number(info?.review?.nextDueAt ?? info?.nextDueAt);
        if(Number.isFinite(dueAt) && dueAt>0 && dueAt<=nowTs){
          due.push(it);
        }else{
          notDue.push(it);
        }
      }
      const sorter=(a,b)=>{
        const na=+String(a.unit||'').replace(/\D+/g,'')||0;
        const nb=+String(b.unit||'').replace(/\D+/g,'')||0;
        if(na!==nb) return na-nb;
        return String(a.id).localeCompare(String(b.id));
      };
      due.sort(sorter);
      notDue.sort(sorter);
      items=[...due, ...notDue];
    }else{
      items=items.slice().sort((a,b)=>{
        const na=+String(a.unit||'').replace(/\D+/g,'')||0;
        const nb=+String(b.unit||'').replace(/\D+/g,'')||0;
        if(na!==nb) return na-nb;
        return String(a.id).localeCompare(String(b.id));
      });
    }
    const daySeed=Math.floor(Date.now()/DAY_MS);
    const hashId=(raw)=>{
      const text=String(raw||'');
      let h=0;
      for(let i=0;i<text.length;i+=1){ h=((h<<5)-h)+text.charCodeAt(i); h|=0; }
      return Math.abs(h);
    };
    const normalizeTaskTypes=(raw)=>{
      if(!Array.isArray(raw) || !raw.length) return TASK_TYPE_ROTATION.slice();
      const list=[];
      for(const entry of raw){
        const t=String(entry||'').toLowerCase().trim();
        if(TASK_TYPE_ROTATION.includes(t) && !list.includes(t)) list.push(t);
      }
      return list.length ? list : TASK_TYPE_ROTATION.slice();
    };
    const queue=[];
    for(const it of items){
      const forceSpeech=!!(it&&(
        it.forceSpeech || it.force_speech || it.speech_force || it.speechOnly || it.speech_only
      ));
      const base={
        id:it.id,
        en:it.en,
        ja:it.ja,
        tags:it.tags||'',
        audio_fn:it.audio_fn||'',
        forceSpeech,
        paraphrases:Array.isArray(it.paraphrases)?it.paraphrases.filter(Boolean):[],
        prompt_ja:typeof it.prompt_ja==='string'?it.prompt_ja:'',
        focus_grammar:typeof it.focus_grammar==='string'?it.focus_grammar:''
      };
      if(isComposeMode()){
        const types=normalizeTaskTypes(it.task_types);
        const idxStart=(hashId(it.id)+daySeed)%types.length;
        queue.push({ ...base, taskType:types[idxStart] });
      }else{
        queue.push({ ...base, taskType:TASK_TYPE_READ });
      }
    }
    return queue;
  }

  // Audio resolve: selected folder -> OPFS. Missing audio uses automatic TTS.
  async function resolveFromDir(name){ try{ const d=await ensureDir(); if(!d||!name) return ''; const fh=await d.getFileHandle(name).catch(()=>null); if(!fh) return ''; const f=await fh.getFile(); return URL.createObjectURL(f); }catch(_){ return ''; } }
  async function resolveFromOPFS(name){ if(!name) return ''; try{ if(!(navigator.storage&&navigator.storage.getDirectory)) return ''; const root=await navigator.storage.getDirectory(); const fh=await root.getFileHandle(name).catch(()=>null); if(!fh) return ''; const file=await fh.getFile(); return URL.createObjectURL(file); }catch(_){ return ''; } }
  const audioUrlResolver=createAudioUrlResolver({
    resolveFromDirectory:resolveFromDir,
    resolveFromOPFS,
  });
  const resolveAudioUrl=audioUrlResolver.resolveAudioUrl;
  configureSharedAudioResolver(audioUrlResolver);

  let folderAudioGeneration=0;
  async function refreshCurrentAudioSource(){
    const generation=++folderAudioGeneration;
    const item=currentItem;
    if(!item) return;
    stopAudio();
    const url=item.forceSpeech?'':await resolveAudioUrl(item.audio_fn);
    if(generation!==folderAudioGeneration || currentItem!==item) return;
    if(url) await setAudioSource(url); else clearAudioSource();
    currentShouldUseSpeech=shouldUseSpeechForItem(item);
    updatePlayButtonAvailability();
  }

  // Render & navigation
  function stopAudio(){ try{audio.pause();}catch(_){ } audio.currentTime=0; speechController.cancelSpeech(); }
  async function tryPlayAudio({userInitiated=false, resetPosition=false,shadowingPlayback=false}={}){
    if(isComposeMode()&&!composeGuide.isComplete()) return false;
    if(isPlaybackTransitionLocked()) return false;
    if(getAudioLockState()===AUDIO_LOCK_STATES.ACTIVE&&!userInitiated&&!shadowingPlayback) return false;
    if(shadowingPlayback&&!authorizeUserPlayback()) return false;
    const hasSrc=!!(audio?.dataset?.srcKey);
    const item=currentItem;
    const speechForced=!!(item&&item.forceSpeech);
    const speechDesired=!!currentShouldUseSpeech;
    const speechAllowed=speechDesired;
    const audioAllowed=shouldUseAudioForItem(item);
    if(speechAllowed){
      if(getAudioLockState()!==AUDIO_LOCK_STATES.UNLOCKED) return false;
      const controllerCanSpeak = speechController ? speechController.canSpeakCurrentCard() : false;
      if(!controllerCanSpeak){
        if(userInitiated){
          if(!speechController || !speechController.supported()) toast('音声合成に未対応のため再生できません');
          else toast('音声合成を開始できませんでした');
        }
        return false;
      }
      const speechOk=await speechController.speakCurrentCard();
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
        if(speechForced){
          if(!speechController || !speechController.supported()){ toast('音声合成に未対応のため再生できません'); }
        }
      }
      return false;
    }
    if(!hasSrc){
      currentShouldUseSpeech=true;
      return tryPlayAudio({userInitiated,resetPosition,shadowingPlayback});
    }
    if(resetPosition){
      try{ audio.currentTime=0; }catch(_){ }
    }
    if(userInitiated&&!authorizeUserPlayback()) return false;
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
      if(err?.name!=='NotAllowedError'){
        clearAudioSource();
        currentShouldUseSpeech=true;
        return tryPlayAudio({userInitiated,resetPosition,shadowingPlayback});
      }
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
    resetPostResultFeedback();
    resultFeedbackQueue.clear();
    cancelShadowingCycle({stopOutput:true});
    shadowingPaused=false;
    cancelPendingMicStart();
    clearLastProgressNote();
    finalizeSessionMetrics('idle');
    sessionActive=false;
    clearActiveClozeRecognitionContext();
    sessionStarting=false;
    setViewState(VIEW_HOME);
    cancelAutoAdvance();
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
    currentReorderSetupReason='';
    hintStage=BASE_HINT_STAGE;
    maxHintStageUsed=BASE_HINT_STAGE;
    refreshLevelDisplay(null);
    sessionStart = 0;
    lastErrorType='';
    sameErrorStreak=0;
    setFooterMessages('', '');
    resetResult();
    resetTranscript();
    updateAttemptInfo();
    setMicState(false);
    el.mic.disabled = true;
    el.pbar.value = 0;
    setFooterMessages(hasQueue ? '準備ができ次第、学習を自動で開始します' : (emptyWithSearch ? '検索条件に一致する学習項目がありません' : '出題できる学習項目がありません'), '');
    if(emptyWithSearch){
      if(lastEmptySearchToast!==query){
        toast('検索条件に一致する学習項目がありません');
        lastEmptySearchToast=query;
      }
    }else{
      lastEmptySearchToast='';
    }
    updateHeaderStats();
  }

  async function render(i, autoPlay=false){
    correctiveItemId=null;
    correctionFinished=false;
    correctionProgress=createCorrectionProgress();
    clearActiveClozeRecognitionContext();
    resetPostResultFeedback();
    resultFeedbackQueue.clear();
    clearLastProgressNote();
    let releaseResolve=null;
    let releasePrepare=null;
    try{
      stopAudio();
      currentShouldUseSpeech=false;
      if(isShadowingSession()){
        cancelShadowingCycle({stopOutput:true});
        if(recognitionController?.isActive?.()) recognitionController.cancel();
      }
      updatePlayButtonAvailability();
      const it=QUEUE[i];
      if(!it){
        setFooterMessages('出題できる学習項目がありません', '');
        clearAudioSource();
        return;
      }
      currentItem=it;
      currentEnHtml=spanify(it.en);
      currentReorderSetupReason='';
      el.en.dataset.itemId = it.id || '';
      const requestedTaskType=requestedPracticeTaskType(it);
      const concealEnglishUntilReorderSetup=isReorderSetupRequested(it);
      if(concealEnglishUntilReorderSetup){
        el.en.classList.add('concealed');
        el.en.textContent='並べ替えを準備しています…';
        el.en.setAttribute('aria-label','並べ替えを準備しています');
      }else{
        el.en.classList.remove('concealed');
        el.en.removeAttribute('aria-label');
        el.en.innerHTML=currentEnHtml;
      }
      if(recognitionController){ recognitionController.clearHighlight(); }
      el.mic.disabled=true;
      let reorderState;
      try{
        reorderState=await setupComposeGuide(it);
      }catch(error){
        console.warn('Reordering safely disabled',error);
        resetComposeGuide();
        reorderState={
          active:false,
          reason:'語順データを確認できないため、並べ替えを停止しました。この項目をスキップしてください。',
        };
      }
      currentReorderSetupReason=String(reorderState?.reason||'');
      const deferCanonicalFallback=concealEnglishUntilReorderSetup&&!!reorderState?.reason;
      if(reorderState?.active){
        if(isShadowingSession()){
          showCanonicalEnglishAfterReorderSetup(it,reorderState);
        }else{
          showReorderPrompt();
        }
      }else if(!deferCanonicalFallback){
        showCanonicalEnglishAfterReorderSetup(it,reorderState);
      }
      if(reorderState?.reason){
        setFooterMessages('並べ替えを安全に停止しました',reorderState.reason);
      }
      el.ja.textContent=it.ja;
      el.chips.innerHTML='';
      (it.tags||'').split(',').filter(Boolean).forEach(t=>{ const s=document.createElement('span'); s.className='chip'; s.textContent=t.trim(); el.chips.appendChild(s); });
      const levelInfo=getLevelInfo(it.id);
      refreshLevelDisplay(levelInfo);
      setHintStage(BASE_HINT_STAGE,{reset:true});
      if(composeGuide.isAwaitingReorder()&&!isShadowingSession()){
        showReorderPrompt();
      }else if(reorderState?.reason){
        showCanonicalEnglishAfterReorderSetup(it,reorderState);
      }
      if(isShadowingSession()){
        showCanonicalEnglishAfterReorderSetup(it,reorderState);
        el.ja.style.display='none';
      }
      const allowAudio=shouldUseAudioForItem(it);
      let url='';
      if(allowAudio){
        const hasDirAudio=!!DIR;
        const needsResolveLoader = !!(hasDirAudio && it.audio_fn && !audioUrlResolver.hasCached(it.audio_fn));
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
                clearAudioSource();
                url='';
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
      resetResult();
      resetTranscript();
      lastMatchEval=null;
      lastErrorType='';
      sameErrorStreak=0;
      setFooterMessages('', '');
      updateAttemptInfo();
      setMicState(false);
      el.mic.disabled=isComposeMode();
      if(reorderState?.reason) setFooterMessages('並べ替えを安全に停止しました',reorderState.reason);
      if(shouldUseAudioForItem(QUEUE[i+1])){ primeAudio(QUEUE[i+1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(shouldUseAudioForItem(QUEUE[i-1])){ primeAudio(QUEUE[i-1], undefined, {shouldUseAudioForItem, resolveAudioUrl}); }
      if(isShadowingSession()){
        shadowingPaused=false;
        setFooterMessages('連続シャドウイング','マイクを準備しています。');
        setTimeout(()=>{
          if(sessionActive&&isShadowingSession()&&idx===i&&!recognitionController?.isActive?.()) startRec();
        },0);
      }else if(autoPlay && isAutoPlayAllowed() && (url||currentShouldUseSpeech)){
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
    await render(idx,false);
    el.pbar.value=idx;
    setFooterMessages(`#${idx+1}/${QUEUE.length}`, '');
    restoreReorderSetupNotice();
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
    const label=nextOpt.textContent||nextOpt.label||nextValue||'次のセクション';
    toast(`セクション「${label}」へ進みます`);
    rebuildAndRender(true,{autoPlay:true})
      .then(()=>{
        if(!QUEUE.length){
          setFooterMessages('次のセクションに学習項目がありません', '');
        }
      })
      .catch(err=>{ console.error(err); toast('次のセクションの読み込みに失敗しました'); });
    return true;
  }

  function handleQuickStart(){
    if(sessionStarting) return;
    prepareToneOutput();
    consumePendingTrainingMode();
    const allowAuto=isAutoPlayAllowed();
    if(consumeFocusedSessionPending(globalThis)){
      rebuildAndRender(true,{autoStart:true,autoPlay:allowAuto}).catch(()=>{
        clearRecoverySessionTarget();
        toast('学習範囲を開始できませんでした');
      });
      return;
    }
    const shouldRecovery=!sessionActive && getConsecutiveNoStudyDays()>=2;
    if(shouldRecovery){
      activateRecoverySessionTarget();
    }
    if(!QUEUE.length){
      rebuildAndRender(true,{autoStart:true, autoPlay:allowAuto}).then(()=>{
        if(!QUEUE.length){
          clearRecoverySessionTarget();
          toast('この条件で学習できる項目がありません');
        }
      }).catch(()=>{ clearRecoverySessionTarget(); });
      return;
    }
    if(sessionActive){
      nextCard(false, allowAuto);
      return;
    }
    startSession(allowAuto);
  }

  async function nextCard(first=false, autoPlay=false){
    cancelAutoAdvance();
    if(!QUEUE.length){ setFooterMessages('出題できる学習項目がありません', ''); clearAudioSource(); stopAudio(); return; }
    if(!sessionActive) return;
    if(!first && idx>=QUEUE.length-1){
      if(advanceToNextSection()) return;
      toast('すべてのセクションを完了しました！お疲れさまでした。');
      await finalizeActiveSession({ reason:'completed' });
      return;
    }
    const task=async ()=>{
      idx = first? 0 : Math.min(QUEUE.length-1, idx+1);
      const allowAutoPlay=autoPlay && autoPlayUnlocked && isAutoPlayAllowed();
      await render(idx, allowAutoPlay);
      el.pbar.value=idx;
      setFooterMessages(`#${idx+1}/${QUEUE.length}`, '');
      restoreReorderSetupNotice();
      updateHeaderStats();
    };
    return queueCardTransition('next', task, {animate:!first});
  }
  async function prevCard(autoPlay=false){
    cancelAutoAdvance();
    if(!QUEUE.length) return;
    if(!sessionActive) return;
    const targetIdx=Math.max(0, idx-1);
    const animate=idx>0;
    const task=async ()=>{
      idx=targetIdx;
      const allowAutoPlay=autoPlay && autoPlayUnlocked && isAutoPlayAllowed();
      await render(idx, allowAutoPlay);
      el.pbar.value=idx;
      setFooterMessages(`#${idx+1}/${QUEUE.length}`, '');
      restoreReorderSetupNotice();
      updateHeaderStats();
    };
    return queueCardTransition('prev', task, {animate});
  }

  function cancelAutoAdvance(){
    autoAdvanceGeneration+=1;
    if(autoAdvanceTimer){
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer=0;
    }
  }

  function scheduleAutoAdvance(delayMs=900){
    cancelAutoAdvance();
    if(!sessionActive) return;
    const allowAuto=isAutoPlayAllowed();
    const generation=autoAdvanceGeneration;
    const scheduledIndex=idx;
    const scheduledItemId=QUEUE[idx]?.id;
    autoAdvanceTimer=setTimeout(()=>{
      autoAdvanceTimer=0;
      if(!sessionActive||generation!==autoAdvanceGeneration||idx!==scheduledIndex||QUEUE[idx]?.id!==scheduledItemId) return;
      nextCard(false, allowAuto);
    }, delayMs);
  }

  async function startSession(autoPlay=false){
    if(sessionActive || sessionStarting) return;
    if(!QUEUE.length){ showIdleCard(); return; }
    sessionStarting=true;
    try{
      await ensureDir();
      sessionActive=true;
      shadowingPaused=false;
      shadowingSessionMetrics.cards=0;
      shadowingSessionMetrics.durationMs=0;
      setViewState(VIEW_STUDYING);
      sessionStart=now();
      beginSessionMetrics();
      idx=-1;
      el.mic.disabled=false;
      try{
        const allowAutoPlay=autoPlay && isAutoPlayAllowed();
        await nextCard(true, allowAutoPlay);
      }catch(err){
        finalizeSessionMetrics('start-error');
        sessionActive=false;
        clearActiveClozeRecognitionContext();
        setViewState(VIEW_HOME);
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
  const VERTICAL_SWIPE_THRESHOLD_SCALE=0.5; // allow shorter vertical swipes
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
  function clearHintSwipeState(){
    const card=el.card;
    if(!card) return;
    card.classList.remove('hint-swipe-ready');
    card.style.removeProperty('--hint-progress');
  }
  function updateHintSwipeProgress(progress){
    const card=el.card;
    if(!card) return;
    const clamped=Math.max(0, Math.min(1, progress||0));
    if(clamped>0){
      card.style.setProperty('--hint-progress', `${clamped}`);
    }else{
      card.style.removeProperty('--hint-progress');
    }
    if(clamped>=1){
      card.classList.add('hint-swipe-ready');
    }else{
      card.classList.remove('hint-swipe-ready');
    }
  }
  function resetCardDrag({animate=true}={}){
    const card=el.card;
    if(!card) return;
    clearHintSwipeState();
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
    clearHintSwipeState();
  }
  function isSwipeExcludedTarget(target){
    if(!target) return false;
    if(target.closest?.('#composeGuide')) return true;
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
      getRecognitionContext:()=>buildRecognitionContext({mode:isShadowingSession()?'shadowing':getStudyMode()}),
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

    if(isRecognitionSupported()) recordSpeechAttempt(it.id, pass);
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
      await ensureDir({prompt:false, forceCheck:true});
      await ensureDataLoaded();
      initGoals();
      updateHeaderStats();
      initSectionPicker();
      refreshDirStatus();
      // Opening the app must stay on Home. A saved legacy section must never
      // start itself before the focused character/training shell is ready.
      await rebuildAndRender(true,{autoStart:false});
      maybeShowFooterInfoIntroToast();
      maybeShowGoalOverview();
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
