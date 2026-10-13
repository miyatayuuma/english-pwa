const S_SUBJECTS = new Set(['he', 'she', 'it']);
const D_SUBJECTS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);
const S_CONTRACTIONS = new Set(["he's", "she's", "it's"]);
const D_CONTRACTIONS = new Set(["i'd", "you'd", "he'd", "she'd", "it'd", "we'd", "they'd"]);

// A single bounded head probe keeps contextual rules cheap inside alignment's
// token matrix while leaving each grammar resolver and its authority separate.
export function contextualGrammarHeadAt(tokens, start) {
  const token = tokens?.[start]?.value ?? null;
  if (!token) return null;
  if (S_CONTRACTIONS.has(token)) return 's';
  if (D_CONTRACTIONS.has(token)) return 'd';
  if (S_SUBJECTS.has(token) && ['is', 'has'].includes(tokens?.[start + 1]?.value)) return 's';
  if (D_SUBJECTS.has(token) && ['had', 'would'].includes(tokens?.[start + 1]?.value)) return 'd';
  return null;
}
