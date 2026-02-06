export function normalizeGoalValue(raw, fallback){
  const num=Number(raw);
  if(Number.isFinite(num) && num>0){
    return Math.max(1, Math.min(999, Math.round(num)));
  }
  return fallback;
}

export function createGoalController({
  el,
  goalState,
  goalMilestones,
  defaults,
  storage,
  deps,
}){
  const { DEFAULT_DAILY_GOAL, DEFAULT_SESSION_GOAL, RECOVERY_SESSION_TARGET }=defaults;
  const { DAILY_GOAL_KEY, SESSION_GOAL_KEY }=storage;
  const { loadNumber, saveNumber, localDateKey, getDailyStats, toast, getSessionCardsDone, updateDailyOverview }=deps;

  let recoverySessionBackupTarget=null;
  let goalOverviewShown=false;

  function ensureDailyGoalFresh(){
    const today=localDateKey();
    if(goalState.todayKey===today) return;
    goalState.todayKey=today;
    const todayStats=getDailyStats(today);
    goalState.dailyDone=Math.max(0, Number(todayStats?.passes)||0);
    goalMilestones.daily = goalState.dailyDone>=goalState.dailyTarget && goalState.dailyTarget>0;
  }

  function syncGoalTargets(){
    const storedDaily=loadNumber(DAILY_GOAL_KEY, NaN);
    const storedSession=loadNumber(SESSION_GOAL_KEY, NaN);
    goalState.dailyTarget=normalizeGoalValue(storedDaily, DEFAULT_DAILY_GOAL);
    goalState.sessionTarget=normalizeGoalValue(storedSession, DEFAULT_SESSION_GOAL);
    if(!Number.isFinite(storedDaily) || storedDaily<=0){
      saveNumber(DAILY_GOAL_KEY, goalState.dailyTarget);
    }
    if(!Number.isFinite(storedSession) || storedSession<=0){
      saveNumber(SESSION_GOAL_KEY, goalState.sessionTarget);
    }
  }

  function applyGoalTargetsToControls(){
    if(el?.sessionGoalSlider){
      el.sessionGoalSlider.value=String(goalState.sessionTarget);
      el.sessionGoalSlider.setAttribute('aria-valuenow', String(goalState.sessionTarget));
    }
    if(el?.sessionGoalTarget){
      el.sessionGoalTarget.textContent=goalState.sessionTarget;
    }
    if(el?.dailyGoalTarget){
      el.dailyGoalTarget.textContent=goalState.dailyTarget;
    }
  }

  function updateGoalMilestones(dailyRatio, sessionRatio){
    const dailyReached=dailyRatio>=1 && goalState.dailyTarget>0;
    const sessionReached=sessionRatio>=1 && goalState.sessionTarget>0;
    if(dailyReached && !goalMilestones.daily){
      goalMilestones.daily=true;
      toast('今日の目標達成！学習成果がしっかり積み上がっています。', 2200);
    }
    if(sessionReached && !goalMilestones.session){
      goalMilestones.session=true;
      toast('セッション目標をクリア！この調子で定着を進めましょう。', 2200);
    }
    if(!dailyReached) goalMilestones.daily=false;
    if(!sessionReached) goalMilestones.session=false;
  }

  function updateGoalProgressFromMetrics({ notify=false }={}){
    ensureDailyGoalFresh();
    goalState.sessionDone=Math.max(0, getSessionCardsDone()||0);
    applyGoalTargetsToControls();
    if(el?.dailyGoalDone){
      el.dailyGoalDone.textContent=goalState.dailyDone;
    }
    if(el?.sessionGoalDone){
      el.sessionGoalDone.textContent=goalState.sessionDone;
    }
    const dailyRatio=goalState.dailyTarget>0 ? goalState.dailyDone/goalState.dailyTarget : 0;
    const sessionRatio=goalState.sessionTarget>0 ? goalState.sessionDone/goalState.sessionTarget : 0;
    const dailyPct=Math.min(100, Math.round(dailyRatio*100));
    const sessionPct=Math.min(100, Math.round(sessionRatio*100));
    if(el?.dailyGoalRing){
      el.dailyGoalRing.style.setProperty('--goal-ratio', Math.min(1, dailyRatio));
    }
    if(el?.sessionGoalRing){
      el.sessionGoalRing.style.setProperty('--goal-ratio', Math.min(1, sessionRatio));
    }
    if(el?.dailyGoalPercent){
      el.dailyGoalPercent.textContent=`${dailyPct}%`;
    }
    if(el?.sessionGoalPercent){
      el.sessionGoalPercent.textContent=`${sessionPct}%`;
    }
    const dailyRemaining=Math.max(0, goalState.dailyTarget-goalState.dailyDone);
    const sessionRemaining=Math.max(0, goalState.sessionTarget-goalState.sessionDone);
    if(el?.dailyGoalHint){
      el.dailyGoalHint.textContent = dailyRemaining>0 ? `目標まであと${dailyRemaining}件` : '今日の目標を達成しました';
    }
    if(el?.dailyGoalTag){
      el.dailyGoalTag.textContent = dailyRemaining>0 ? `あと${dailyRemaining}件` : '達成';
    }
    if(el?.sessionGoalTag){
      el.sessionGoalTag.textContent = sessionRemaining>0 ? `あと${sessionRemaining}件` : '達成';
    }
    if(el?.sessionGoalBarFill){
      el.sessionGoalBarFill.style.width=`${Math.min(100, Math.max(0, sessionRatio*100))}%`;
    }
    if(notify){
      updateGoalMilestones(dailyRatio, sessionRatio);
    }else{
      goalMilestones.daily = dailyRatio>=1 && goalState.dailyTarget>0;
      goalMilestones.session = sessionRatio>=1 && goalState.sessionTarget>0;
    }
    updateDailyOverview();
  }

  function activateRecoverySessionTarget(){
    if(recoverySessionBackupTarget!==null) return;
    recoverySessionBackupTarget=goalState.sessionTarget;
    goalState.sessionTarget=RECOVERY_SESSION_TARGET;
    applyGoalTargetsToControls();
    updateGoalProgressFromMetrics();
  }

  function clearRecoverySessionTarget(){
    if(recoverySessionBackupTarget===null) return;
    goalState.sessionTarget=recoverySessionBackupTarget;
    recoverySessionBackupTarget=null;
    applyGoalTargetsToControls();
    updateGoalProgressFromMetrics();
  }

  function handleSessionGoalInput(ev){
    const value=normalizeGoalValue(ev?.target?.value, goalState.sessionTarget);
    goalState.sessionTarget=value;
    saveNumber(SESSION_GOAL_KEY, value);
    applyGoalTargetsToControls();
    updateGoalProgressFromMetrics();
  }

  function bindGoalControls(){
    if(el?.sessionGoalSlider){
      el.sessionGoalSlider.addEventListener('input', handleSessionGoalInput);
      el.sessionGoalSlider.addEventListener('change', handleSessionGoalInput);
    }
  }

  function initGoals(){
    syncGoalTargets();
    ensureDailyGoalFresh();
    applyGoalTargetsToControls();
    updateGoalProgressFromMetrics();
    bindGoalControls();
  }

  function incrementGoalProgressForPass(){
    ensureDailyGoalFresh();
    goalState.dailyDone+=1;
    goalState.sessionDone=Math.max(0, getSessionCardsDone()||goalState.sessionDone);
    updateGoalProgressFromMetrics({ notify:true });
  }

  function maybeShowGoalOverview(){
    if(goalOverviewShown) return;
    ensureDailyGoalFresh();
    const dailyRemaining=Math.max(0, goalState.dailyTarget-goalState.dailyDone);
    const dailyText=dailyRemaining>0 ? `今日の目標まであと${dailyRemaining}件です` : '今日の目標は達成済みです';
    const sessionText=`今回の学習目標は${goalState.sessionTarget}件です`;
    toast(`${dailyText} / ${sessionText}`, 3200);
    goalOverviewShown=true;
  }

  return {
    initGoals,
    ensureDailyGoalFresh,
    applyGoalTargetsToControls,
    updateGoalProgressFromMetrics,
    activateRecoverySessionTarget,
    clearRecoverySessionTarget,
    incrementGoalProgressForPass,
    maybeShowGoalOverview,
  };
}
