import { answerVariants } from '../app/vocabularyLearningCore.js';
import { getSharedLearningTexts } from '../reorder/sharedAuthority.js';

export const LEARNING_MAX_ALTERNATIVES = 5;
export const SPEECH_DISABLED_MODES = new Set(['compose', 'generate', 'reorder']);

export function exactBiasStrings(values) {
  if (!Array.isArray(values)) throw new Error('biasStrings must be an array');
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Empty bias string');
    if (!seen.has(value)) { seen.add(value); result.push(value); }
  }
  return result;
}

// Web Speech does not consume phrase bias. Native resolves stable authority
// immediately before listening, using only shared chunks or strict TARGET.
export function buildRecognitionBiasContext({ mode, itemId, sentenceIndex = null, vocabularyEntry, activeOccurrence, clozeContext } = {}) {
  const context = { mode, maxAlternatives: LEARNING_MAX_ALTERNATIVES };
  if (SPEECH_DISABLED_MODES.has(mode)) return { ...context, speechDisabled: true };
  if (mode === 'vocabulary') return { ...context, biasStrings: exactBiasStrings(answerVariants(vocabularyEntry, activeOccurrence)) };
  return { ...context, itemId: itemId ?? clozeContext?.itemId, sentenceIndex };
}

export async function resolveNativeBiasStrings(context) {
  if (context?.speechDisabled) throw new Error('Reordering has no speech backend');
  if (context?.mode === 'vocabulary') return exactBiasStrings(context.biasStrings);
  if (!context?.itemId) throw new Error('Stable source itemId is required for native sentence bias');
  return getSharedLearningTexts(context.itemId, context.sentenceIndex ?? null);
}
