import { calcAlignmentF1 } from './speechAlignment.js';

// Read owns its existing sentence-level recall/precision scoring policy.
export function gradeReadSpeech(alignment) {
  const score = calcAlignmentF1(alignment?.refCount || 0, alignment?.recall || 0, alignment?.precision || 0);
  return { score };
}
