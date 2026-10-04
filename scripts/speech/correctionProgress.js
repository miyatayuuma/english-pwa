export const CORRECTION_MISS_LIMIT = 3;
export const CORRECTION_TECHNICAL_FAILURE_LIMIT = 3;
export function createCorrectionProgress() { return {misses:0,technicalFailures:0}; }
export function recordCorrectionAttempt(progress,{success=false,technical=false}={}) {
  if(technical) progress.technicalFailures+=1;
  else { progress.technicalFailures=0; if(!success) progress.misses+=1; }
  const complete=success||progress.misses>=CORRECTION_MISS_LIMIT||progress.technicalFailures>=CORRECTION_TECHNICAL_FAILURE_LIMIT;
  const message=success?'修正練習完了':technical
    ? complete?'発音を採点できないため次へ進みます':'認識できませんでした。もう一度話してください。'
    : complete?'3回練習したので次へ進みます':progress.misses===2?'あと1回練習します':'もう一度話してください';
  return {complete,message};
}
