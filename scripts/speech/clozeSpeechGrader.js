import { calcAlignmentF1 } from './speechAlignment.js';

function targetTokenIndexes(alignment, target) {
  const start = Number(target?.start);
  const end = Number(target?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return alignment.referenceTokens.flatMap((token, index) => token.end > start && token.start < end ? [index] : []);
}

export function gradeClozeSpeech(alignment, context) {
  const targets = Array.isArray(context?.targets) ? context.targets : [];
  const matchedReference = new Set(alignment?.matchedReferenceTokenIndexes || []);
  const active = targets.length > 0
    && String(context?.sentence || '') === String(alignment?.referenceText || '');
  const targetResults = targets.map(target => {
    const tokenIndexes = targetTokenIndexes(alignment, target);
    const matched = tokenIndexes.length > 0 && tokenIndexes.every(index => matchedReference.has(index));
    const events = (alignment?.alignment || []).filter(event => event.expectedTokenIndexes.some(index => tokenIndexes.includes(index)));
    const explicit = events.find(event => event.authority === 'explicit-equivalence');
    return {
      entryId: String(target?.entry_id || ''),
      expected: String(target?.surface || ''),
      matched,
      authority: matched ? (explicit ? 'explicit-equivalence' : 'exact') : 'unmatched',
      ruleId: matched ? (explicit?.ruleId || null) : null,
      ruleKind: matched ? (explicit?.ruleKind || null) : null,
      recognitionSegmentIndex: matched ? (explicit?.recognitionSegmentIndex ?? events[0]?.recognitionSegmentIndex ?? null) : null,
      asrRank: matched ? (explicit?.asrRank ?? events[0]?.asrRank ?? 0) : null,
      rawTranscript: String(alignment?.rawTranscript || ''),
      displayTranscript: String(alignment?.displayTranscript || alignment?.rawTranscript || ''),
    };
  });
  const hasTargets = targetResults.length > 0;
  const allTargetsMatched = hasTargets && targetResults.every(target => target.matched);
  return {
    active: hasTargets && active,
    overallScore: calcAlignmentF1(alignment?.refCount || 0, alignment?.recall || 0, alignment?.precision || 0),
    targets: targetResults,
    allTargetsMatched,
  };
}

// The Read thresholds remain unchanged; Cloze adds only its hidden-target
// completion requirement to the result owned by the Read-facing flow.
export function applyClozeTargetRequirement(evaluation, clozeResult, currentLevel = 0) {
  if (!evaluation || !clozeResult?.active || clozeResult.allTargetsMatched) return evaluation;
  const priorLevel = Number.isFinite(Number(currentLevel)) ? Math.max(0, Math.floor(Number(currentLevel))) : 0;
  const candidate = Number.isFinite(Number(evaluation.candidate)) ? Math.max(0, Math.floor(Number(evaluation.candidate))) : priorLevel;
  return {
    ...evaluation,
    candidate: Math.min(candidate, priorLevel),
    noHintSuccess: false,
    perfectNoHint: false,
    pass: false,
  };
}
