// Product-owned recognition policy, shared by Web Speech and Android adapters.
export const REQUESTED_MAX_ALTERNATIVES = 20;
export const SPEECH_DISABLED_MODES = new Set(['compose', 'generate', 'reorder']);

export function buildRecognitionContext({ mode } = {}) {
  return { mode, speechDisabled: SPEECH_DISABLED_MODES.has(mode) };
}
