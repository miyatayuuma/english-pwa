import { calcAlignmentF1 } from './speechAlignment.js';

// Read owns its existing sentence-level recall/precision scoring policy.
export function gradeReadSpeech(alignment) {
  const orderedMatchIntegrity = alignment?.orderedMatchIntegrity || { valid: true, violations: [] };
  const score = orderedMatchIntegrity.valid === false
    ? 0
    : calcAlignmentF1(alignment?.refCount || 0, alignment?.recall || 0, alignment?.precision || 0);
  return { score, orderedMatchIntegrity };
}
