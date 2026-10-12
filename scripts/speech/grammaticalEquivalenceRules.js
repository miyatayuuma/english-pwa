const ALLOWED_MODES = Object.freeze(['vocabulary', 'read', 'cloze', 'correction']);

const fixedBeHaveWill = [
  ['i-am', 'I am', "I'm"],
  ['you-are', 'you are', "you're"],
  ['we-are', 'we are', "we're"],
  ['they-are', 'they are', "they're"],
  ['i-have', 'I have', "I've"],
  ['you-have', 'you have', "you've"],
  ['we-have', 'we have', "we've"],
  ['they-have', 'they have', "they've"],
  ['i-will', 'I will', "I'll"],
  ['you-will', 'you will', "you'll"],
  ['he-will', 'he will', "he'll"],
  ['she-will', 'she will', "she'll"],
  ['it-will', 'it will', "it'll"],
  ['we-will', 'we will', "we'll"],
  ['they-will', 'they will', "they'll"],
];

const negativeFixedPairs = [
  ['do-not', 'do not', "don't"],
  ['does-not', 'does not', "doesn't"],
  ['did-not', 'did not', "didn't"],
  ['is-not', 'is not', "isn't"],
  ['are-not', 'are not', "aren't"],
  ['was-not', 'was not', "wasn't"],
  ['were-not', 'were not', "weren't"],
  ['have-not', 'have not', "haven't"],
  ['has-not', 'has not', "hasn't"],
  ['had-not', 'had not', "hadn't"],
  ['cannot', 'cannot', "can't"],
  ['could-not', 'could not', "couldn't"],
  ['will-not', 'will not', "won't"],
  ['would-not', 'would not', "wouldn't"],
  ['should-not', 'should not', "shouldn't"],
  ['must-not', 'must not', "mustn't"],
  ['need-not', 'need not', "needn't"],
  ['shall-not', 'shall not', "shan't"],
];

function bidirectionalRules(pairs, decisionId) {
  return pairs.flatMap(([slug, expanded, contracted]) => {
    const id = `asr09b-${slug}`;
    const common = {
      id,
      decisionId,
      kind: decisionId,
      credit: 'exact-equivalent',
      scope: { type: 'mode', modes: ALLOWED_MODES },
      authorityTier: 'grammatical-variant',
      display: 'raw',
    };
    return [
      { ...common, expected: expanded, recognized: contracted, direction: 'expanded-to-contracted' },
      { ...common, expected: contracted, recognized: expanded, direction: 'contracted-to-expanded' },
    ];
  });
}

export const grammaticalEquivalenceRules = Object.freeze([
  ...bidirectionalRules(fixedBeHaveWill, 'fixed-be-have-will'),
  ...bidirectionalRules(negativeFixedPairs, 'negative-fixed-pair'),
]);

export const GRAMMATICAL_EQUIVALENCE_DECISIONS = Object.freeze([
  'fixed-be-have-will',
  'negative-fixed-pair',
]);

export const GRAMMATICAL_EQUIVALENCE_PAIR_COUNT = fixedBeHaveWill.length + negativeFixedPairs.length;
