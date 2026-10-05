const pair = ({ id, expected, recognized, kind, display = 'raw' }) => [
  { id, expected, recognized, kind, credit: 'exact-equivalent', scope: { type: 'global' }, display },
  { id: `${recognized.replace(/\s+/gu, '-')}-${expected.replace(/\s+/gu, '-')}`,
    expected: recognized, recognized: expected, kind, credit: 'exact-equivalent',
    scope: { type: 'global' }, display: 'raw' },
];

export const speechEquivalenceRules = Object.freeze([
  ...pair({ id: 'prose-pros', expected: 'prose', recognized: 'pros', kind: 'homophone', display: 'expected' }),
  ...pair({ id: 'dye-die', expected: 'dye', recognized: 'die', kind: 'homophone' }),
  ...pair({ id: 'postwar-post-war', expected: 'postwar', recognized: 'post war', kind: 'segmentation-equivalence' }),
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
]);
