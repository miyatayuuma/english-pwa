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
