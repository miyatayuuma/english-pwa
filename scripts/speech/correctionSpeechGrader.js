import { calcAlignmentF1 } from './speechAlignment.js';

// Correction uses the same exact/equivalence alignment but owns its practice
// success decision and deliberately does not update scheduled review state.
export function gradeCorrectionSpeech(alignment, { evaluateLevel, hintStage } = {}) {
  const score = alignment?.orderedMatchIntegrity?.valid === false
    ? 0
    : calcAlignmentF1(alignment?.refCount || 0, alignment?.recall || 0, alignment?.precision || 0);
  const evaluation = typeof evaluateLevel === 'function' ? evaluateLevel(score, hintStage) : null;
  return { score, evaluation, success: !!evaluation?.pass };
}
