// Reordering evidence is independent of ASR and ordinary no-hint promotion.
export function reduceReorderResult(sentences) {
  if (!sentences.length || sentences.some(row => !row?.completed)) throw new Error('Incomplete reordering result');
  const grade = sentences.some(row => row.revealed) ? 'FAILED'
    : sentences.some(row => row.wrongAttempts > 0) ? 'RETRY_PASS' : 'FIRST_TRY';
  return { grade, sentences: sentences.map(row => ({ ...row })) };
}

export function evaluateReorder(grade) {
  const candidate = { FIRST_TRY: 4, RETRY_PASS: 3, FAILED: 1 }[grade];
  if (!candidate) throw new Error('Unknown reordering grade');
  return { mode: 'reorder', grade, candidate, rate: grade === 'FAILED' ? 0 : 1,
    stage: 0, pass: grade !== 'FAILED', noHintSuccess: false, perfectNoHint: false,
    usedEnglishHint: false, revealedEnglishHint: grade === 'FAILED' };
}

// GAS upserts replace the complete SRS row, so carry ordinary evidence through
// unchanged rather than omitting its columns from this independent result.
export function createReorderSrsPayload(id, update) {
  const info = update.info;
  const iso = value => Number(value) > 0 ? new Date(Number(value)).toISOString() : '';
  return { id, ts: new Date().toISOString(), mode: 'compose',
    level_candidate: update.candidate, level_final: update.finalLevel,
    level_last: info.last, level_best: info.best, reorder_grade: update.evaluation.grade,
    hint_stage: info.hintStage ?? 0, last_match: info.lastMatch ?? '',
    no_hint_streak: info.noHintStreak ?? 0, no_hint_history: [...(info.noHintHistory || [])],
    last_no_hint_at: iso(info.lastNoHintAt), level5_count: info.level5Count ?? 0,
    level_updated_at: iso(info.updatedAt), promotion_blocked: null, next_target: null };
}
