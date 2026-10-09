import { VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY } from './vocabularyTdClusterBeforeToAuthority.js';

const pair = ({ id, expected, recognized, kind, display = 'raw', scope = { type: 'global' } }) => [
  { id, expected, recognized, kind, credit: 'exact-equivalent', scope, display },
  { id: `${recognized.replace(/\s+/gu, '-')}-${expected.replace(/\s+/gu, '-')}`,
    expected: recognized, recognized: expected, kind, credit: 'exact-equivalent',
    scope, display: 'raw' },
];

function isReviewedTDBoundaryVariant(rule) {
  const expected = String(rule?.expected || '').trim().toLocaleLowerCase('en-US').split(/\s+/u);
  const recognized = String(rule?.recognized || '').trim().toLocaleLowerCase('en-US').split(/\s+/u);
  if (expected.length !== 2 || recognized.length !== 2 || expected[1] !== 'to' || recognized[1] !== 'to') return false;
  return expected[0].replace(/[td]$/u, '') === recognized[0];
}

// Preserve the audited Vocabulary rules as entry-scoped authority, while
// sharing only the reviewed final-t/d deletion environment with prose modes.
const sharedTDBoundaryRules = VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY
  .filter(isReviewedTDBoundaryVariant)
  .map(rule => ({
    ...rule,
    id: `shared-read-${rule.id}`,
    scope: { type: 'mode', modes: ['read', 'cloze', 'correction'] },
  }));

export const speechEquivalenceRules = Object.freeze([
  // Than/then has the same audible form in all four speech-bearing modes.
  ...pair({ id: 'than-then', expected: 'than', recognized: 'then', kind: 'asr-context-collision', scope: { type: 'mode', modes: ['vocabulary', 'read', 'cloze', 'correction'] } }),
  ...pair({ id: 'prose-pros', expected: 'prose', recognized: 'pros', kind: 'homophone', display: 'expected' }),
  ...pair({ id: 'dye-die', expected: 'dye', recognized: 'die', kind: 'homophone' }),
  ...pair({ id: 'postwar-post-war', expected: 'postwar', recognized: 'post war', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'birthrate-birth-rate', expected: 'birthrate', recognized: 'birth rate', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'makeup-make-up', expected: 'makeup', recognized: 'make up', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'email-e-mail', expected: 'email', recognized: 'e mail', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'high-tech-hi-tech', expected: 'high tech', recognized: 'hi tech', kind: 'explicit-spelling-variant' }),
  ...pair({ id: 'rain-forest-rainforest', expected: 'rain forest', recognized: 'rainforest', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'suite-sweet', expected: 'suite', recognized: 'sweet', kind: 'homophone' }),
  ...pair({ id: 'hear-here', expected: 'hear', recognized: 'here', kind: 'homophone' }),
  ...pair({ id: 'buy-by', expected: 'buy', recognized: 'by', kind: 'homophone' }),
  ...pair({ id: 'cell-sell', expected: 'cell', recognized: 'sell', kind: 'homophone' }),
  ...pair({ id: 'fair-fare', expected: 'fair', recognized: 'fare', kind: 'homophone' }),
  ...pair({ id: 'peace-piece', expected: 'peace', recognized: 'piece', kind: 'homophone' }),
  ...pair({ id: 'plain-plane', expected: 'plain', recognized: 'plane', kind: 'homophone' }),
  ...pair({ id: 'their-there', expected: 'their', recognized: 'there', kind: 'homophone' }),
  ...pair({ id: 'weather-whether', expected: 'weather', recognized: 'whether', kind: 'homophone' }),
  ...pair({ id: 'principal-principle', expected: 'principal', recognized: 'principle', kind: 'homophone' }),
  ...pair({ id: 'altogether-all-together', expected: 'altogether', recognized: 'all together', kind: 'segmentation-equivalence' }),
  ...pair({ id: 'oh-owe', expected: 'oh', recognized: 'owe', kind: 'homophone' }),
  ...pair({ id: 'sent-scent', expected: 'sent', recognized: 'scent', kind: 'homophone' }),
  ...sharedTDBoundaryRules,
  ...VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY,
]);
