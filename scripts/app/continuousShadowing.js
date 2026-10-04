export const TRAINING_MODES=Object.freeze({
  STANDARD:'standard',
  CONTINUOUS_SHADOWING:'continuous_shadowing',
});

export const SHADOWING_PASS_LEVEL=2;

export function normalizeTrainingMode(value){
  return value===TRAINING_MODES.CONTINUOUS_SHADOWING
    ? TRAINING_MODES.CONTINUOUS_SHADOWING
    : TRAINING_MODES.STANDARD;
}

export function isContinuousShadowingMode(value){
  return normalizeTrainingMode(value)===TRAINING_MODES.CONTINUOUS_SHADOWING;
}

export function isClearedForShadowing(levelInfo){
  const best=Number(levelInfo?.best);
  const last=Number(levelInfo?.last);
  return (Number.isFinite(best)&&best>=SHADOWING_PASS_LEVEL)
    ||(Number.isFinite(last)&&last>=SHADOWING_PASS_LEVEL);
}

export function filterShadowingEligibleItems(items,levelState={}){
  return (Array.isArray(items)?items:[]).filter(item=>isClearedForShadowing(levelState?.[item?.id]));
}

export function buildShadowingExposure({itemId='',startedAt=0,finishedAt=Date.now()}={}){
  const start=Number(startedAt);
  const finish=Number(finishedAt);
  const durationMs=Number.isFinite(start)&&Number.isFinite(finish)&&finish>=start
    ?Math.round(finish-start)
    :0;
  return {
    itemId:String(itemId||''),
    durationMs:Math.max(0,durationMs),
    completed:!!itemId&&durationMs>0,
  };
}
