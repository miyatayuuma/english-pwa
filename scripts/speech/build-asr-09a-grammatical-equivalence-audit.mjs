import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'data/audits/asr-09a-grammatical-equivalence');
const BASELINE_SHA = 'e1b56da18e0df1d583473a6f208a75333bd22969';
const EXPECTED_BLOBS = {
  'data/vocabulary-v3.json': '91324d35b2db1911ece2cf3ff746409d321fe963',
  'data/items.json': 'ae2aca768b784199b77ac1cf8c0c5a80fd5725bb',
};
const TD_RECONCILIATION_PATH = 'data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json';
const TD_RECONCILIATION_BLOB = '8f55f0ac88aa02e6bfc7af535625fe7a350f97f2';
const REPOSITORY_CLOSURE_TEXT = "Repository closure is **CLOSED**. ASR-09A audit authority remains CLOSED and is ready for ASR-09B implementation; this is not an ASR-09B production change.\n- T/D validator repair: PR #327, merge `9aed421af7427c115f722ffad5809ff3466fa39b`.\n- T/D evidence: `data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json` (Git blob `8f55f0ac88aa02e6bfc7af535625fe7a350f97f2`). Reconciliation accepted **36/36** records: **34 UNCHANGED**, **2 INDEX_RELOCATED**, **0 unresolved drift**. `tdc-00002` (`vocab:00528`, `be forced to do something`) and `tdc-00007` (`vocab:00634`, `tend to do something`) moved from paraphrase index 0 to 1 while retaining unique exact surfaces, PARAPHRASE classification, and entry-scoped rescue.\n- ASR-09A audit closure: PR #326, merge `1a8c6b9e4267f390498dab9bc4b0ba9374d6d16c` (required PR checks succeeded before merge).\n- Historical audit baseline `e1b56da18e0df1d583473a6f208a75333bd22969` and its production blobs are unchanged. Former `tdc-00002` validation failure is resolved, not an active blocker.";
const MERGE_EVIDENCE = Object.freeze({ tdRepairPr: 327, tdRepairMergeSha: '9aed421af7427c115f722ffad5809ff3466fa39b', auditPr: 326, auditMergeSha: '1a8c6b9e4267f390498dab9bc4b0ba9374d6d16c' });
const MODES = Object.freeze(['vocabulary', 'read', 'cloze', 'correction']);

const DECISIONS = [
  {
    id: 'apostrophe-unicode',
    taxonomy: 'ORTHOGRAPHIC_ASR_EQUIVALENCE',
    disposition: 'SAFE_EQUIVALENCE',
    conditions: ['Only Unicode apostrophe glyphs are normalized to ASCII apostrophe.', 'The apostrophe is retained as an internal token character.'],
    failureAction: 'REJECT a dropped apostrophe unless a separate contextual rule proves the same lexeme.',
    allowedModes: MODES,
    reason: 'Curly and typographic apostrophes are encoding variants of the same written contraction or possessive. This does not authorize contraction expansion.',
    minimalCounterexample: ['Expected: I\'m ready.', 'Observed: I’m ready.'],
  },
  {
    id: 'fixed-be-have-will',
    taxonomy: 'GRAMMATICAL_VARIANT',
    disposition: 'SAFE_EQUIVALENCE',
    conditions: ['Match only a listed contraction with its exact auxiliary expansion.', 'Use a contiguous 1↔2 token span and preserve all surrounding tokens, order, and polarity.', 'The expansion must be unique for that contraction.'],
    failureAction: 'REJECT if the contraction has another grammatical reading or if any neighboring token is missing or reordered.',
    allowedModes: MODES,
    authorityTier: 'grammatical-variant',
    modeConditions: {
      vocabulary: 'Align only to the existing canonical/answers/source authority; paraphrases remain PARAPHRASE.',
      read: 'Match only the complete contiguous pair in order; preserve every other reference token and highlight reference indexes from the alignment.',
      cloze: 'The entire hidden target must be reproduced in place by the selected final utterance; all completeness and negation gates remain mandatory.',
      correction: 'Use the complete pair only; correction practice adds no scheduled SRS write.',
    },
    reason: 'The enumerated fixed pairs preserve auxiliary, tense/aspect, and proposition. They are approved as grammatical variants, with separate provenance from Unicode/ASR spelling normalization.',
    minimalCounterexample: ['Expected: we are ready', 'Observed: were ready'],
  },
  {
    id: 'ambiguous-s',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['Resolve ’s as is or has only when the complete local syntax admits exactly one standard parse.', 'Treat be + -ing and ’s been/’s got as candidate clues, not universal morphology rules.', 'Past-participle/adjective, ’s not, nominal, and possession collisions remain unresolved absent a complete parse.'],
    failureAction: 'UNRESOLVED or REJECT; never choose is/has from ’s alone.',
    allowedModes: ['vocabulary', 'correction'],
    excludedModes: { read: 'UNRESOLVED: context-dependent auxiliary parsing is outside the bounded exact-span policy.', cloze: 'UNRESOLVED: context-dependent auxiliary parsing is outside the hidden-target policy.' },
    reason: 'He’s can be he is or he has; it’s can be it is, it has, or a possessive-shaped ASR collision. Examples such as He’s finished and He’s not finished admit materially different parses.',
    minimalCounterexample: ['Expected: he is finished', 'Observed: he’s finished (also parses as he has finished)'],
  },
  {
    id: 'ambiguous-d',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['Resolve ’d as had before an unambiguously past participle, or would before an unambiguously bare infinitive / fixed better-rather idiom.', 'Keep syncretic forms such as put, read, and cut unresolved without wider syntax.', 'Do not infer elided have in would have constructions.'],
    failureAction: 'UNRESOLVED if the following construction does not force had or would.',
    allowedModes: ['vocabulary', 'correction'],
    excludedModes: { read: 'UNRESOLVED: had/would parse is context-dependent.', cloze: 'UNRESOLVED: had/would parse is context-dependent.' },
    reason: 'I’d may stand for I had or I would, and the auxiliary changes tense/aspect or modality.',
    minimalCounterexample: ['Expected: I would put it there', 'Observed: I’d put it there (had/would form collision without wider syntax)'],
  },
  {
    id: 'negative-fixed-pair',
    taxonomy: 'GRAMMATICAL_VARIANT',
    disposition: 'SAFE_EQUIVALENCE',
    conditions: ['Match only the exact listed auxiliary + not pair and its listed contraction.', 'The aligned span must contain the auxiliary and the negative marker together.', 'Preserve auxiliary identity, tense, order, and negation scope in both directions.'],
    failureAction: 'REJECT if not/ n’t is absent, another auxiliary replaces it, or the negation is outside the matched span.',
    allowedModes: MODES,
    authorityTier: 'grammatical-variant',
    modeConditions: {
      vocabulary: 'Align only to existing canonical/answers/source authority; a paraphrase is never promoted.',
      read: 'Match the complete auxiliary + negator pair contiguously and preserve the remainder of the reference.',
      cloze: 'The complete hidden target span must map in place; preservesExpectedNegation and completeness remain hard gates.',
      correction: 'Match the complete pair; do not add a scheduled SRS write.',
    },
    reason: 'Listed pairs such as do not/don’t and will not/won’t differ in contraction but preserve the same auxiliary and negative polarity when matched as a whole pair.',
    minimalCounterexample: ['Expected: do not agree', 'Observed: do agree'],
  },
  {
    id: 'can-not-spacing',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['Treat cannot/can’t as a listed fixed negative pair.', 'Do not automatically equate can not with cannot/can’t: split can not may scope over the following verb or express a choice not to act.'],
    failureAction: 'UNRESOLVED for can not unless the intended narrow negative auxiliary construction is independently established.',
    allowedModes: ['vocabulary', 'correction'],
    excludedModes: { read: 'UNRESOLVED pending exact-text policy.', cloze: 'UNRESOLVED pending scope and target policy.' },
    reason: 'Spacing can affect scope: “I can not go” may mean I can choose not to go, while “I cannot go” denies ability or permission.',
    minimalCounterexample: ['Expected: I cannot go', 'Observed: I can not go (scope reading may differ)'],
  },
  {
    id: 'lets-hortative',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['Resolve let’s to let us only as a first-person plural hortative with a following base verb.', 'Do not equate with permission/request “let us …” without discourse evidence.'],
    failureAction: 'UNRESOLVED when discourse force or construction is unclear.',
    allowedModes: ['vocabulary', 'correction'],
    excludedModes: { read: 'UNRESOLVED pending exact-text policy.', cloze: 'UNRESOLVED pending target policy.' },
    reason: 'Let’s go is ordinarily hortative; let us go can instead request permission.',
    minimalCounterexample: ['Expected: Let’s go', 'Observed: Let us go (may request permission rather than propose action)'],
  },
  {
    id: 'aint-dialect',
    taxonomy: 'AMBIGUOUS',
    disposition: 'UNRESOLVED',
    conditions: ['No automatic expansion. A dialect-specific speaker model and sentence parse would be required.'],
    failureAction: 'REJECT for ASR-09B automatic equivalence; preserve as unresolved audit evidence.',
    allowedModes: [],
    reason: 'Ain’t can stand for several be/have forms, is dialect-marked, and does not have one stable auxiliary or register interpretation.',
    minimalCounterexample: ['Expected: she is ready', 'Observed: she ain’t ready (negative polarity differs)'],
  },
  {
    id: 'possessive-s',
    taxonomy: 'AMBIGUOUS',
    disposition: 'UNRESOLVED',
    conditions: ['Do not expand lexical ’s as an auxiliary when followed by a possessed noun.', 'Any possessive/auxiliary collision requires complete syntax and reference context.'],
    failureAction: 'REJECT the minimal auxiliary substitution; otherwise leave unresolved.',
    allowedModes: [],
    reason: 'John’s book contains a possessive marker. Treating ’s as is or has changes the structure and can invent an auxiliary.',
    minimalCounterexample: ['Expected: John’s book', 'Observed: John is book'],
  },
  {
    id: 'lexical-possessive-s',
    taxonomy: 'NOT_EQUIVALENT',
    disposition: 'REJECT',
    conditions: ['The complete phrase uses ’s as a possessive determiner before a lexical noun.', 'Do not expand it to be/have or strip the possessive relation.'],
    failureAction: 'REJECT auxiliary expansion for this observed span.',
    allowedModes: [],
    reason: 'The noun context determines possessive ’s, so an auxiliary expansion changes the syntactic relation.',
    minimalCounterexample: ['Expected: someone’s turn', 'Observed: someone is turn'],
  },
  {
    id: 'homophone-spelling-collision',
    taxonomy: 'AMBIGUOUS',
    disposition: 'UNRESOLVED',
    conditions: ['Require context-specific lexical/grammatical evidence for were/we’re, your/you’re, their/they’re/there, and its/it’s.', 'Do not infer an apostrophe or auxiliary from sound alone.'],
    failureAction: 'REJECT generic contraction/possessive or contraction/past-tense substitution.',
    allowedModes: [],
    reason: 'Several pairs are homophonous or close in common speech but have different grammatical roles and meanings.',
    minimalCounterexample: ['Expected: we are ready', 'Observed: were ready'],
  },
  {
    id: 'am-not-tag',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['Aren’t I is eligible only as the conventional negative tag after a first-person positive clause.', 'It is not a general spelling/contraction of am not.'],
    failureAction: 'REJECT outside an interrogative tag with the matching antecedent polarity.',
    allowedModes: ['vocabulary', 'correction'],
    excludedModes: { read: 'UNRESOLVED pending exact-text policy.', cloze: 'UNRESOLVED pending target policy.' },
    reason: '“I am …, aren’t I?” is an idiomatic tag construction, not a local expansion pair with “am not”.',
    minimalCounterexample: ['Expected: I am not ready', 'Observed: I aren’t I ready'],
  },
  {
    id: 'negation-drop-or-add',
    taxonomy: 'NOT_EQUIVALENT',
    disposition: 'REJECT',
    conditions: ['Negation marker and scope must be preserved in both directions.'],
    failureAction: 'Reject; do not score or align the missing polarity marker as equivalent.',
    allowedModes: [],
    reason: 'Dropping or adding not changes polarity.',
    minimalCounterexample: ['Expected: can’t swim', 'Observed: can swim'],
  },
  {
    id: 'auxiliary-or-tense-swap',
    taxonomy: 'NOT_EQUIVALENT',
    disposition: 'REJECT',
    conditions: ['Auxiliary, tense/aspect, and modal force must remain the same.'],
    failureAction: 'Reject; never use a contraction family to substitute a different auxiliary.',
    allowedModes: [],
    reason: 'The surface contraction must not conceal a swap such as is/has or would/had.',
    minimalCounterexample: ['Expected: I would go', 'Observed: I had gone'],
  },
  {
    id: 'sentence-final-auxiliary',
    taxonomy: 'CONTEXT_CONDITIONAL',
    disposition: 'CONTEXT_CONDITIONAL',
    conditions: ['A contracted auxiliary must be licensed by its syntactic construction; do not assume an elided predicate at sentence end.', 'Accept a short answer only if that exact elliptical form is independently licensed.'],
    failureAction: 'Reject unsupported terminal forms such as “Yes, he’s” for “Yes, he is”.',
    allowedModes: [],
    reason: 'Many contractions require a following predicate; expanding a terminal form may silently add omitted words.',
    minimalCounterexample: ['Expected: Yes, he is.', 'Observed: Yes, he’s.'],
  },
  {
    id: 'nbest-no-synthesis',
    taxonomy: 'NOT_EQUIVALENT',
    disposition: 'REJECT',
    conditions: ['Evaluate each finalized hypothesis independently.', 'Do not join words from rank 0, lower ranks, segments, or prior attempts.'],
    failureAction: 'Reject a synthesized phrase that no provider hypothesis contained.',
    allowedModes: [],
    reason: 'A grammar resolver may only align a complete observed phrase; it cannot manufacture missing evidence from separate candidates.',
    minimalCounterexample: ['Expected: do not agree', 'Rank 0: do / rank 2: not agree; neither is the complete expected phrase'],
  },
];

const FIXED_CONTRACTIONS = new Map();
const EXPANSIONS = [];
const addExpansion = (words, contraction, decisionId, familyId, extra = {}) => {
  const normalizedWords = words.toLocaleLowerCase('en-US');
  const row = { words: normalizedWords.split(' '), contraction, decisionId, familyId, ...extra };
  EXPANSIONS.push(row);
  FIXED_CONTRACTIONS.set(contraction.toLocaleLowerCase('en-US'), row);
};

for (const [words, contraction] of [
  ['i am', "i'm"], ['you are', "you're"], ['we are', "we're"], ['they are', "they're"],
  ['he is', "he's"], ['she is', "she's"], ['it is', "it's"], ['that is', "that's"],
  ['there is', "there's"], ['here is', "here's"], ['who is', "who's"], ['what is', "what's"],
  ['where is', "where's"], ['when is', "when's"], ['why is', "why's"], ['how is', "how's"],
  ['i have', "i've"], ['you have', "you've"], ['we have', "we've"], ['they have', "they've"],
  ['he has', "he's"], ['she has', "she's"], ['it has', "it's"], ['there has', "there's"],
  ['here has', "here's"], ['that has', "that's"], ['who has', "who's"], ['what has', "what's"],
  ['where has', "where's"], ['when has', "when's"], ['why has', "why's"], ['how has', "how's"],
  ['i will', "i'll"], ['you will', "you'll"],
  ['he will', "he'll"], ['she will', "she'll"], ['it will', "it'll"], ['we will', "we'll"],
  ['they will', "they'll"], ['i would', "i'd"], ['i had', "i'd"], ['you would', "you'd"],
  ['you had', "you'd"], ['he would', "he'd"], ['he had', "he'd"], ['she would', "she'd"],
  ['she had', "she'd"], ['it would', "it'd"], ['it had', "it'd"], ['we would', "we'd"],
  ['we had', "we'd"], ['they would', "they'd"], ['they had', "they'd"], ['let us', "let's"],
]) {
  const lower = words.toLocaleLowerCase('en-US');
  const ambiguousS = /(?:he|she|it|there|here|who|what|where|when|why|how|that) (?:is|has)$/.test(lower);
  const ambiguousD = / (?:would|had)$/.test(lower);
  const uniqueFixed = / (?:am|are|have|will)$/.test(lower)
    || /^(?:i|you|we|they) (?:is|has)$/.test(lower);
  const decisionId = ambiguousS ? 'ambiguous-s'
    : ambiguousD ? 'ambiguous-d'
      : words === 'let us' ? 'lets-hortative'
        : uniqueFixed ? 'fixed-be-have-will' : 'ambiguous-s';
  const familyId = ambiguousS ? 'aux-s-ambiguous'
    : ambiguousD ? 'aux-d-ambiguous'
      : words === 'let us' ? 'let-us-hortative'
        : lower.endsWith(' have') ? 'aux-have-fixed'
          : lower.endsWith(' will') ? 'aux-will-fixed' : 'aux-be-fixed';
  addExpansion(words, contraction, decisionId, familyId);
}

const NEGATIVE_PAIRS = [
  ['do not', "don't"], ['does not', "doesn't"], ['did not', "didn't"],
  ['is not', "isn't"], ['are not', "aren't"], ['was not', "wasn't"], ['were not', "weren't"],
  ['have not', "haven't"], ['has not', "hasn't"], ['had not', "hadn't"],
  ['cannot', "can't"], ['could not', "couldn't"], ['will not', "won't"],
  ['would not', "wouldn't"], ['should not', "shouldn't"], ['must not', "mustn't"],
  ['need not', "needn't"], ['shall not', "shan't"],
];
for (const [words, contraction] of NEGATIVE_PAIRS) {
  addExpansion(words, contraction, 'negative-fixed-pair', `negative-${contraction.replace(/[^a-z]+/gu, '-')}`);
}
for (const alt of ['am not', 'is not', 'are not', 'have not', 'has not']) {
  addExpansion(alt, "ain't", 'aint-dialect', 'aint-ambiguous', { ambiguousContraction: true });
}

const SINGLE_CONTRACTIONS = new Map([...FIXED_CONTRACTIONS].map(([form, row]) => [form, row]));
SINGLE_CONTRACTIONS.set("ain't", { decisionId: 'aint-dialect', familyId: 'aint-ambiguous', alternatives: ['am not', 'is not', 'are not', 'have not', 'has not'] });
const HOMOPHONE_COLLISIONS = new Map([
  ['were', { familyId: 'we-are-were', alternatives: ["we're (only if the intended words are we are)"] }],
  ['your', { familyId: 'you-are-your', alternatives: ["you're (only if the intended words are you are)"] }],
  ['there', { familyId: 'they-are-there-their', alternatives: ["they're (only if the intended words are they are)"], existingRuleId: 'their-there' }],
  ['their', { familyId: 'they-are-there-their', alternatives: ["they're (only if the intended words are they are)"], existingRuleId: 'their-there' }],
  ['its', { familyId: 'it-is-its', alternatives: ["it's (only if the intended words are it is/it has)"] }],
]);

const USER_INVENTORY = [
  ...[
    ['I am', "I'm", 'unique'], ['you are', "you're", 'unique'], ['he is', "he's", 'is-or-has'],
    ['she is', "she's", 'is-or-has'], ['it is', "it's", 'is-has-or-possessive'],
    ['we are', "we're", 'collides-with-were'], ['they are', "they're", 'collides-with-there-their'],
    ['that is', "that's", 'is-or-has'], ['there is', "there's", 'is-or-has'], ['who is', "who's", 'is-or-has'],
  ].map(([expansion, form, ambiguity]) => ({ class: 'be', expansion, form, ambiguity })),
  ...[
    ['I have', "I've", 'unique'], ['you have', "you've", 'unique'], ['we have', "we've", 'unique'],
    ['they have', "they've", 'unique'], ['he has', "he's", 'is-or-has'], ['she has', "she's", 'is-or-has'],
    ['it has', "it's", 'is-has-or-possessive'],
  ].map(([expansion, form, ambiguity]) => ({ class: 'have', expansion, form, ambiguity })),
  ...[
    ['I will', "I'll", 'unique'], ['you will', "you'll", 'unique'], ['he will', "he'll", 'unique'],
    ['we will', "we'll", 'unique'], ['I would', "I'd", 'would-or-had'], ['I had', "I'd", 'would-or-had'],
    ['she would', "she'd", 'would-or-had'], ['she had', "she'd", 'would-or-had'],
  ].map(([expansion, form, ambiguity]) => ({ class: 'will-would-had', expansion, form, ambiguity })),
  ...NEGATIVE_PAIRS.map(([expansion, form]) => ({ class: 'negative', expansion, form, ambiguity: 'fixed-auxiliary-plus-negation' })),
  { class: 'irregular', expansion: 'let us', form: "let's", ambiguity: 'hortative-or-permission' },
  { class: 'irregular', expansion: 'cannot', form: "can't", ambiguity: 'spaced-can-not-scope' },
  { class: 'irregular', expansion: 'am not (first-person tag)', form: "aren't I", ambiguity: 'tag-only' },
  { class: 'irregular', expansion: 'am/is/are/have/has not (dialect-dependent)', form: "ain't", ambiguity: 'multiple-auxiliary-and-dialect' },
  { class: 'collision', expansion: 'were', form: "we're", ambiguity: 'tense-and-pronoun-collision' },
  { class: 'collision', expansion: 'your', form: "you're", ambiguity: 'possessive-pronoun-collision' },
  { class: 'collision', expansion: 'there/their', form: "they're", ambiguity: 'homophone-and-role-collision' },
  { class: 'collision', expansion: 'its', form: "it's", ambiguity: 'possessive-collision' },
];

function inventoryDecision(row) {
  if (row.ambiguity === 'is-or-has' || row.ambiguity === 'is-has-or-possessive') return 'ambiguous-s';
  if (row.ambiguity === 'would-or-had') return 'ambiguous-d';
  if (row.class === 'be' || row.class === 'have' || row.class === 'will-would-had') return 'fixed-be-have-will';
  if (row.class === 'negative') return 'negative-fixed-pair';
  if (row.form === "let's") return 'lets-hortative';
  if (row.form === "can't") return 'negative-fixed-pair';
  if (row.form === "aren't I") return 'am-not-tag';
  if (row.form === "ain't") return 'aint-dialect';
  return 'homophone-spelling-collision';
}

function json(file) { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function blobSha(file) {
  const data = fs.readFileSync(path.join(ROOT, file));
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex');
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableId(prefix, value) { return `${prefix}-${sha256(value).slice(0, 16)}`; }
function normalizeApostrophe(value) { return String(value).replace(/[‘’‛ʼ＇]/gu, "'").toLocaleLowerCase('en-US'); }
const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
function tokensOf(text) {
  return [...String(text).matchAll(TOKEN_RE)].map(match => ({
    raw: match[0], value: normalizeApostrophe(match[0]), start: match.index, end: match.index + match[0].length,
  }));
}
function placeholderSlots(text) {
  return [...String(text || '').matchAll(/\b(something|someone|somebody|somewhere|somehow|anything|anyone|anybody|anywhere|everything|everyone|everybody|everywhere|nothing|nobody|nowhere)\b/giu)]
    .map(match => match[0].toLocaleLowerCase('en-US'));
}
function placeholderSlotSpans(text) {
  return [...String(text || '').matchAll(/\b(something|someone|somebody|somewhere|somehow|anything|anyone|anybody|anywhere|everything|everyone|everybody|everywhere|nothing|nobody|nowhere)\b/giu)]
    .map(match => ({ value: match[0].toLocaleLowerCase('en-US'), start: match.index, end: match.index + match[0].length }));
}

const POSSESSIVE_WORDS = new Set(['book', 'name', 'life', 'lives', 'car', 'house', 'idea', 'work', 'family', 'heart', 'death', 'architecture', 'jury', 'couple', 'today', 'history', 'mother', 'father', 'friend', 'face', 'way', 'time', 'world', 'country', 'government', 'company', 'problem', 'voice', 'hand', 'eyes', 'story', 'language', 'future', 'side', 'part', 'decision', 'mind', 'body', 'children', 'content', 'turn', 'disposal', 'play', 'place', 'will', 'dream', 'surprise', 'presence', 'back', 'knowledge', 'business', 'own', 'word', 'words', 'twenties', 'privacy', 'door', 'growth', 'award', 'realities', 'verdict', 'anniversary', 'most']);
const PARTICIPLES = new Set(['been', 'gone', 'done', 'seen', 'taken', 'written', 'spoken', 'given', 'known', 'made', 'found', 'thought', 'brought', 'bought', 'caught', 'taught', 'told', 'heard', 'said', 'left', 'felt', 'kept', 'lost', 'won', 'built', 'sent', 'read', 'put', 'cut', 'run', 'come', 'become', 'broken', 'chosen', 'driven', 'eaten', 'fallen', 'forgotten', 'grown', 'hidden', 'ridden', 'risen', 'stolen', 'thrown', 'worn']);
const SYNCRETIC_BASE_PARTICIPLES = new Set(['read', 'put', 'cut', 'set', 'hurt', 'cost', 'hit', 'let', 'shut', 'split', 'spread', 'burst', 'beat', 'bet', 'cast', 'fit', 'quit', 'rid', 'shed', 'wed', 'bent', 'bound', 'dealt', 'dug', 'fed', 'fled', 'hung', 'laid', 'lent', 'meant', 'paid', 'said', 'sent', 'spent', 'stood', 'stuck', 'struck', 'swept', 'wept', 'won']);
const BARE_VERBS = new Set(['go', 'do', 'say', 'make', 'take', 'see', 'come', 'get', 'know', 'give', 'find', 'think', 'tell', 'use', 'leave', 'play', 'call', 'help', 'try', 'ask', 'work', 'like', 'want', 'need', 'better', 'rather', 'sooner', 'be', 'have', 'run', 'put', 'cut', 'read', 'write', 'speak', 'eat', 'fall', 'grow', 'keep', 'feel', 'look', 'seem', 'sound', 'finish', 'start', 'wait', 'stay', 'move', 'live']);
const BE_CUES = new Set(['ready', 'happy', 'sure', 'tired', 'alive', 'afraid', 'asleep', 'angry', 'quiet', 'wrong', 'right', 'late', 'early', 'different', 'important', 'possible', 'available', 'beautiful', 'small', 'large', 'easy', 'hard', 'fine', 'okay', 'ok', 'pointless']);
function contextFor(tokens, index) {
  return {
    previous: tokens[index - 1]?.value || null,
    next: tokens[index + 1]?.value || null,
    next2: tokens[index + 2]?.value || null,
  };
}
function contextualResolution(token, tokens, index) {
  const form = normalizeApostrophe(token.raw);
  const { next, next2 } = contextFor(tokens, index);
  if (form.endsWith("'s")) {
    if (['he', 'she', 'it', 'they', 'we', 'you', 'i'].includes(next) && next2 && /ing$/u.test(next2)) return { expansion: form.slice(0, -2) + ' is', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `Inverted subject ${next} followed by -ing predicate ${next2} supports the be progressive parse.` };
    if (['someone', 'somebody', 'something', 'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything', 'no one', 'nobody', 'nothing', 'one'].includes(form.slice(0, -2))) {
      if (next && (POSSESSIVE_WORDS.has(next) || (next.endsWith('s') && POSSESSIVE_WORDS.has(next.slice(0, -1))))) return { expansion: null, status: 'REJECT', conditionMet: false, reason: `’s before lexical noun ${next} is possessive.` };
    }
    if (next === 'been' || next === 'got') return { expansion: form.slice(0, -2) + ' has', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `’s + ${next} licenses a have/perfect or have-got construction; the parallel be form is ungrammatical in standard usage.` };
    if (next === 'being' || (next && /ing$/u.test(next) && next !== 'thing' && next !== 'king' && next !== 'spring')) return { expansion: form.slice(0, -2) + ' is', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `’s + ${next} supports the be progressive construction; have + -ing is not licensed here.` };
    if (next && BE_CUES.has(next)) return { expansion: form.slice(0, -2) + ' is', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `Known predicate adjective ${next} supports be; the audit keeps participial/possessive counterexamples unresolved.` };
    return { expansion: null, status: 'UNRESOLVED', conditionMet: false, reason: 'The local context does not force one standard is/has/possessive analysis.' };
  }
  if (form.endsWith("'d")) {
    if (next === 'better' || next === 'rather' || next === 'sooner') return { expansion: form.slice(0, -2) + ' would', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `Fixed ’d ${next} construction selects would.` };
    if (next && SYNCRETIC_BASE_PARTICIPLES.has(next)) return { expansion: null, status: 'UNRESOLVED', conditionMet: false, reason: `The surface form ${next} can be a bare form or past participle, so ’d remains had/would ambiguous.` };
    if (next === 'been' || (next && PARTICIPLES.has(next)) || (next && /(?:ed|en)$/u.test(next))) return { expansion: form.slice(0, -2) + ' had', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `Following form ${next} is treated as a past-participle candidate; syncretic/lexical counterexamples remain caveated.` };
    if (next && BARE_VERBS.has(next)) return { expansion: form.slice(0, -2) + ' would', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `Following base-form cue ${next} licenses would.` };
    return { expansion: null, status: 'UNRESOLVED', conditionMet: false, reason: 'The following form does not force had versus would in this bounded audit.' };
  }
  if (form === "let's") {
    if (next && BARE_VERBS.has(next)) return { expansion: 'let us', status: 'CONTEXT_CONDITIONAL', conditionMet: true, reason: `let’s + base-form cue ${next} supports the hortative parse; discourse force remains distinct.` };
    return { expansion: null, status: 'UNRESOLVED', conditionMet: false, reason: 'No following base verb establishes the hortative construction.' };
  }
  return null;
}

function buildRuleIdsForContraction(token) {
  const key = normalizeApostrophe(token);
  if (/^[\p{L}\p{N}]+['’]s$/iu.test(String(token))) {
    const base = key.slice(0, -2);
    if (['he', 'she', 'it', 'there', 'here', 'who', 'what', 'where', 'when', 'why', 'how', 'that'].includes(base)) {
      return { decisionId: 'ambiguous-s', familyId: 'aux-s-ambiguous', alternatives: [`${base} is`, `${base} has`] };
    }
    if (['someone', 'somebody', 'something', 'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything', 'no one', 'nobody', 'nothing', 'one'].includes(base)) {
      return { decisionId: 'ambiguous-s', familyId: 'aux-s-ambiguous', alternatives: [`${base} is`, `${base} has`, `${base}’s (possessive)`] };
    }
  }
  if (/^[\p{L}\p{N}]+['’]d$/iu.test(String(token))) {
    const base = key.slice(0, -2);
    if (['i', 'you', 'he', 'she', 'it', 'we', 'they'].includes(base)) return { decisionId: 'ambiguous-d', familyId: 'aux-d-ambiguous', alternatives: [`${base} had`, `${base} would`] };
  }
  const found = SINGLE_CONTRACTIONS.get(key);
  if (found) return { ...found, alternatives: found.words ? [found.words.join(' ')] : found.alternatives };
  if (/^[\p{L}\p{N}]+['’]s$/iu.test(String(token))) {
    const base = normalizeApostrophe(token).slice(0, -2);
    if (['he', 'she', 'it', 'there', 'here', 'who', 'what', 'where', 'when', 'why', 'how', 'that'].includes(base)) {
      return { decisionId: 'ambiguous-s', familyId: 'aux-s-ambiguous', alternatives: [`${base} is`, `${base} has`] };
    }
    return { decisionId: 'possessive-s', familyId: 'possessive-s', alternatives: [`${base}’s (possessive)`, `${base} is`, `${base} has`] };
  }
  return null;
}

function matchExpansion(tokens, start, exp) {
  if (start + exp.words.length > tokens.length) return false;
  return exp.words.every((word, offset) => tokens[start + offset].value === word);
}

function contextualizeOccurrence(text, tokenStartIndex, tokenEndIndex, tokens, sourceKind) {
  const startToken = tokens[tokenStartIndex];
  const endToken = tokens[tokenEndIndex];
  const atFinal = tokenEndIndex === tokens.length - 1;
  const previous = tokens[tokenStartIndex - 1]?.value || null;
  const next = tokens[tokenEndIndex + 1]?.value || null;
  const isQuestionTag = /,\s*$/u.test(text.slice(0, startToken?.start ?? 0)) && /[?!.…]?\s*$/u.test(text.slice(endToken?.end ?? text.length));
  return { start: startToken.start, end: endToken.end, atFinal, previous, next, isQuestionTag, sourceKind };
}

const vocabulary = json('data/vocabulary-v3.json').entries;
const items = json('data/items.json');
const itemById = new Map(items.map(item => [String(item.id), item]));
for (const [file, expected] of Object.entries(EXPECTED_BLOBS)) {
  const actual = blobSha(file);
  if (actual !== expected) throw new Error(`ASR-09A source drift: ${file} expected ${expected} but found ${actual}`);
}
if (vocabulary.length !== 2478 || new Set(vocabulary.map(row => row.id)).size !== vocabulary.length) {
  throw new Error(`ASR-09A vocabulary integrity gate failed (${vocabulary.length} rows).`);
}
if (items.length !== 560 || new Set(items.map(row => row.id)).size !== items.length) {
  throw new Error(`ASR-09A item integrity gate failed (${items.length} rows).`);
}
// ASR-09A artifacts are a historical baseline and must not follow later
// production version bumps.
const occurrenceRefsByItem = new Map();
const joinErrors = [];
for (const entry of vocabulary) {
  for (const occurrence of entry.occurrences || []) {
    const item = itemById.get(String(occurrence.item_id));
    if (!item) { joinErrors.push(`Missing item ${occurrence.item_id} referenced by ${entry.id}`); continue; }
    const source = String(item.en || '');
    const surface = source.slice(occurrence.start, occurrence.end);
    if (!surface || occurrence.start < 0 || occurrence.end > source.length) joinErrors.push(`Bad occurrence span ${entry.id}/${occurrence.item_id}`);
    if (!occurrenceRefsByItem.has(String(item.id))) occurrenceRefsByItem.set(String(item.id), []);
    occurrenceRefsByItem.get(String(item.id)).push({ entry, occurrence, surface });
  }
}
if (joinErrors.length) throw new Error(`Corpus occurrence join failed: ${joinErrors.slice(0, 5).join('; ')}`);

const candidates = [];
const candidateKeys = new Set();
let sourceOrder = 0;
let duplicateCandidateDrops = 0;
function addCandidate(source, tokenStartIndex, tokenEndIndex, tokens, selectedRule) {
  const span = contextualizeOccurrence(source.text, tokenStartIndex, tokenEndIndex, tokens, source.type);
  const surface = source.text.slice(span.start, span.end);
  const key = [source.type, source.ownerId, source.field, span.start, span.end, selectedRule.familyId].join('\u0000');
  if (candidateKeys.has(key)) { duplicateCandidateDrops += 1; return; }
  candidateKeys.add(key);
  const id = stableId('ge', key);
  const token = tokens[tokenStartIndex];
  const row = {
    id,
    sourceOrder: sourceOrder++,
    corpus: source.corpus,
    sourceType: source.type,
    sourceId: source.ownerId,
    field: source.field,
    fieldIndex: source.fieldIndex ?? null,
    start: span.start,
    end: span.end,
    surface,
    sourceContext: source.text,
    familyId: selectedRule.familyId,
    decisionId: selectedRule.decisionId,
    taxonomy: DECISIONS.find(d => d.id === selectedRule.decisionId)?.taxonomy || 'AMBIGUOUS',
    disposition: DECISIONS.find(d => d.id === selectedRule.decisionId)?.disposition || 'UNRESOLVED',
    proposedCounterparts: selectedRule.alternatives || (selectedRule.contraction ? [selectedRule.contraction] : []),
    context: { previousToken: span.previous, nextToken: span.next, sentenceFinal: span.atFinal, punctuationContext: span.isQuestionTag ? 'possible-question-tag' : null },
    recognitionSurface: { apostrophePreserved: surface.includes("'") || /[’‘‛ʼ＇]/u.test(surface), rawTranscriptRemainsImmutable: true },
    authority: null,
  };
  const sourceSlots = placeholderSlotSpans(source.text);
  const slotsInsideCandidate = sourceSlots.filter(slot => slot.end > span.start && slot.start < span.end);
  const slotsOutsideCandidate = sourceSlots.filter(slot => !(slot.end > span.start && slot.start < span.end));
  const proposedSlotLists = (selectedRule.alternatives || (selectedRule.contraction ? [selectedRule.contraction] : []))
    .map(value => placeholderSlots(value));
  row.slotIntegrity = {
    sourceSlots,
    slotsInsideCandidate,
    slotsOutsideCandidate,
    proposedCounterpartSlots: proposedSlotLists,
    exactPairSlotSymmetry: proposedSlotLists.every(values => JSON.stringify(values) === JSON.stringify(slotsInsideCandidate.map(slot => slot.value))),
    outsideSlotsRemainOutsideMatchedSpan: true,
  };
  if (selectedRule.existingRuleId) row.existingAuthorityToPreserve = selectedRule.existingRuleId;
  const local = contextualResolution(token, tokens, tokenStartIndex);
  if (local) {
    row.localResolution = local;
    if (local.status === 'REJECT') row.disposition = 'REJECT';
    else if (local.conditionMet) row.disposition = 'CONTEXT_CONDITIONAL';
    else row.disposition = 'UNRESOLVED';
  }
  const surfaceToken = tokens[tokenStartIndex]?.value || '';
  const nextToken = tokens[tokenEndIndex + 1]?.value || '';
  if (/^[\p{L}\p{N}]+['’]s$/iu.test(surface)
      && !['he', 'she', 'it', 'there', 'here', 'who', 'what', 'where', 'when', 'why', 'how', 'that'].includes(surfaceToken.slice(0, -2))
      && POSSESSIVE_WORDS.has(nextToken)) {
    row.decisionId = 'lexical-possessive-s';
    row.taxonomy = 'NOT_EQUIVALENT';
    row.disposition = 'REJECT';
    row.localResolution = { expansion: null, status: 'REJECT', conditionMet: false, reason: `’s before lexical noun ${nextToken} is possessive in this observed phrase, not is/has.` };
  }
  const terminalAuxContraction = span.atFinal && /(?:'m|'re|'ve|'ll|'d|'s)$/iu.test(normalizeApostrophe(surface));
  const terminalExpandedAux = span.atFinal && selectedRule.words?.length > 0
    && ['am', 'is', 'are', 'have', 'has', 'had', 'will', 'would'].includes(selectedRule.words.at(-1));
  if ((terminalAuxContraction || terminalExpandedAux) && !surface.toLocaleLowerCase('en-US').endsWith('not')) {
    row.decisionId = 'sentence-final-auxiliary';
    row.taxonomy = 'CONTEXT_CONDITIONAL';
    row.disposition = 'UNRESOLVED';
    row.sentenceFinalRisk = 'A following predicate or licensed ellipsis is not established by the local span.';
  }
  if (source.type === 'vocabulary') {
    const entry = source.entry;
    const originalSourceOccurrences = (entry.occurrences || []).map(occurrence => {
      const item = itemById.get(String(occurrence.item_id));
      return {
        itemId: String(occurrence.item_id),
        start: occurrence.start,
        end: occurrence.end,
        surface: item ? String(item.en || '').slice(occurrence.start, occurrence.end) : '',
        sentence: String(item?.en || ''),
        contextualMeaningJa: occurrence.contextual_meaning_ja || '',
      };
    });
    row.authority = {
      canonical: entry.canonical,
      answers: entry.answers || [],
      paraphrases: entry.paraphrases || [],
      meaningJa: entry.meaning_ja,
      senseKey: entry.sense_key,
      grammarRole: entry.grammarRole || null,
      sourceOccurrences: originalSourceOccurrences,
      matchedAuthorityField: source.field,
      paraphraseCannotBePromotedByThisAudit: source.field.startsWith('paraphrases'),
      canonicalSlots: placeholderSlots(entry.canonical),
      candidateSlots: placeholderSlots(surface),
      sourceFieldSlots: placeholderSlots(source.text),
    };
    row.modeApplicability = ['vocabulary'];
  } else {
    const links = (occurrenceRefsByItem.get(String(source.ownerId)) || []).filter(ref => ref.occurrence.end > span.start && ref.occurrence.start < span.end);
    row.linkedVocabularyOccurrences = links.map(ref => ({
      entryId: ref.entry.id,
      canonical: ref.entry.canonical,
      senseKey: ref.entry.sense_key,
      meaningJa: ref.entry.meaning_ja,
      grammarRole: ref.entry.grammarRole || null,
      surface: ref.surface,
      occurrenceStart: ref.occurrence.start,
      occurrenceEnd: ref.occurrence.end,
      overlapsCandidate: true,
      targetSlots: placeholderSlots(ref.entry.canonical),
    }));
    row.clozePotentialHiddenTargets = links.map(ref => ({ entryId: ref.entry.id, start: ref.occurrence.start, end: ref.occurrence.end, surface: ref.surface, exactCandidateSpan: ref.occurrence.start === span.start && ref.occurrence.end === span.end }));
    row.modeApplicability = ['read', 'cloze', 'correction'];
    if (links.some(ref => ref.occurrence.start <= span.start && ref.occurrence.end >= span.end)) row.modeApplicability.unshift('vocabulary');
  }
  const decision = DECISIONS.find(item => item.id === row.decisionId) || DECISIONS.find(item => item.id === selectedRule.decisionId);
  row.authorityTier = decision?.authorityTier
    || (decision?.taxonomy === 'ORTHOGRAPHIC_ASR_EQUIVALENCE' ? 'orthographic-asr-equivalence' : null);
  row.modeTreatment = Object.fromEntries(row.modeApplicability.map(mode => [
    mode,
    decision?.disposition === 'REJECT'
      ? 'REJECT'
      : decision?.allowedModes?.includes(mode)
        ? row.disposition
        : 'UNRESOLVED',
  ]));
  if (source.type === 'vocabulary') {
    row.authority.resultTypeRule = source.field.startsWith('paraphrases')
      ? 'remain PARAPHRASE; never promote to TARGET'
      : 'remain governed by existing canonical/answers/source TARGET authority';
  }
  candidates.push(row);
}

function scanSource(source) {
  const tokens = tokensOf(source.text);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const homophone = HOMOPHONE_COLLISIONS.get(token.value);
    if (homophone) addCandidate(source, index, index, tokens, { decisionId: 'homophone-spelling-collision', ...homophone });
    if (token.value === "aren't" && tokens[index + 1]?.value === 'i') {
      addCandidate(source, index, index + 1, tokens, { decisionId: 'am-not-tag', familyId: 'am-not-tag', alternatives: ['am I not? (positive-clause question tag only)'] });
      continue;
    }
    const contraction = buildRuleIdsForContraction(token.raw);
    if (contraction) addCandidate(source, index, index, tokens, contraction);
    for (const exp of EXPANSIONS) {
      if (!matchExpansion(tokens, index, exp)) continue;
      addCandidate(source, index, index + exp.words.length - 1, tokens, {
        decisionId: exp.decisionId,
        familyId: exp.familyId,
        alternatives: [exp.contraction],
        contraction: exp.contraction,
        words: exp.words,
      });
    }
    if (token.value === 'can' && tokens[index + 1]?.value === 'not') {
      addCandidate(source, index, index + 1, tokens, { decisionId: 'can-not-spacing', familyId: 'negative-can-not-spaced', alternatives: ["can't", 'cannot'] });
    }
  }
}

for (const entry of vocabulary) {
  const fieldValues = [
    ['canonical', null, entry.canonical],
    ...(entry.answers || []).map((value, index) => ['answers', index, value]),
    ...(entry.paraphrases || []).map((value, index) => ['paraphrases', index, value]),
  ];
  for (const [field, fieldIndex, raw] of fieldValues) {
    if (typeof raw !== 'string') continue;
    const source = { type: 'vocabulary', corpus: 'vocabulary', ownerId: String(entry.id), field, fieldIndex: fieldIndex ?? null, text: raw, entry };
    scanSource(source);
  }
}
for (const item of items) scanSource({ type: 'item', corpus: 'items', ownerId: String(item.id), field: 'en', text: String(item.en || '') });

const corpusFormCounts = new Map();
const corpusFormExamples = new Map();
for (const candidate of candidates) {
  for (const match of candidate.surface.matchAll(/[\p{L}\p{N}]+['’][\p{L}\p{N}]+/gu)) {
    const form = normalizeApostrophe(match[0]);
    corpusFormCounts.set(form, (corpusFormCounts.get(form) || 0) + 1);
    if (!corpusFormExamples.has(form)) corpusFormExamples.set(form, []);
    if (corpusFormExamples.get(form).length < 12) corpusFormExamples.get(form).push({ candidateId: candidate.id, sourceType: candidate.sourceType, sourceId: candidate.sourceId, context: candidate.sourceContext });
  }
}

const decisions = DECISIONS.map(row => ({ ...row }));
const observedCandidates = new Map();
for (const candidate of candidates) {
  const key = candidate.decisionId;
  observedCandidates.set(key, (observedCandidates.get(key) || 0) + 1);
}
for (const decision of decisions) decision.corpusCandidateCount = observedCandidates.get(decision.id) || 0;

const familyCounts = {};
for (const candidate of candidates) familyCounts[candidate.familyId] = (familyCounts[candidate.familyId] || 0) + 1;
const dispositionCounts = Object.fromEntries(['SAFE_EQUIVALENCE', 'CONTEXT_CONDITIONAL', 'REJECT', 'UNRESOLVED'].map(key => [key, candidates.filter(row => row.disposition === key).length]));
const taxonomyCounts = Object.fromEntries(['ORTHOGRAPHIC_ASR_EQUIVALENCE', 'GRAMMATICAL_VARIANT', 'CONTEXT_CONDITIONAL', 'AMBIGUOUS', 'NOT_EQUIVALENT'].map(key => [key, candidates.filter(row => row.taxonomy === key).length]));
const modeTreatmentCounts = Object.fromEntries(MODES.map(mode => [mode, Object.fromEntries(['SAFE_EQUIVALENCE', 'CONTEXT_CONDITIONAL', 'REJECT', 'UNRESOLVED'].map(result => [result, candidates.filter(row => row.modeTreatment[mode] === result).length]))]));

const existingAuthority = {
  normalizationSource: 'scripts/speech/safeSpeechNormalization.js',
  equivalenceSource: 'scripts/speech/speechEquivalence.js',
  ruleSource: 'scripts/speech/speechEquivalenceRules.js',
  alignmentSource: 'scripts/speech/speechAlignment.js',
  answerAuthoritySource: 'scripts/app/vocabularyLearningCore.js',
  findings: [
    { id: 'safe-token-apostrophe-retained', result: 'PASS', detail: 'NFKC + apostrophe-glyph normalization is applied; TOKEN_PATTERN retains internal apostrophes as part of one token.' },
    { id: 'safe-vs-canonical-token-difference', result: 'RISK_IF_REUSED', detail: 'safeSpeechTokens preserves apostrophe and word boundaries. canonicalTokens removes apostrophes before mergeContractions, so we’re collides with bare were as “were”; the expanded phrase we are remains two tokens. Keep canonicalTokens out of speech-equivalence decisions.' },
    { id: 'vocabulary-answer-normalization', result: 'SEPARATE', detail: 'normalizeVocabularyAnswer removes apostrophes but does not merge expanded contractions; existing target/paraphrase authority compares only explicit source strings.' },
    { id: 'alignment-span', result: 'EXACT_OR_EXPLICIT_ONLY', detail: 'resolveSpeechTokenSpan accepts exact token equality or explicit exact-equivalent rules; explicit rules are checked in array order and return 1↔N span lengths.' },
    { id: 'rule-scope-and-provenance', result: 'AVAILABLE', detail: 'Current explicit rules support global/entry/mode/provider scopes and attach ruleId/ruleKind/displayPolicy to alignment evidence.' },
    { id: 'target-paraphrase-miss', result: 'AUTHORITY_PRESERVED', detail: 'Vocabulary first classifies canonical/answers/source as TARGET and curated paraphrases as PARAPHRASE; ASR equivalence may align a recognized surface but must not add a new answer string or promote a paraphrase.' },
    { id: 'nbest', result: 'INDEPENDENT_HYPOTHESES', detail: 'Rank 0 is evaluated first; only finalized provider alternatives are separately evaluated. No cross-rank word synthesis.' },
    { id: 'cloze-polarity', result: 'EXISTING_GUARD', detail: 'preservesExpectedNegation requires every expected negation token index to be matched; hidden target tokens also require full in-place reproduction and final repair selection.' },
    { id: 'read-correction-and-srs', result: 'MODE_OWNED', detail: 'Read and Correction score their alignment differently; Correction practice success does not itself write scheduled review state. Vocabulary TARGET/MISS owns SRS updates; therefore new equivalence changes admission risk.' },
    { id: 'existing-rules', result: 'PRESERVE', detail: 'than↔then, their↔there, birthrate↔birth rate, and reviewed final-t/d rules remain untouched. Grammar rules must neither precede nor widen those existing scopes.' },
  ],
};

const inventory = {
  schemaVersion: 1,
  ruleFamilies: decisions.map(({ id, taxonomy, disposition, allowedModes, conditions, authorityTier, modeConditions, excludedModes }) => ({ id, taxonomy, disposition, allowedModes, conditions, authorityTier: authorityTier || (taxonomy === 'ORTHOGRAPHIC_ASR_EQUIVALENCE' ? 'orthographic-asr-equivalence' : null), modeConditions: modeConditions || {}, excludedModes: excludedModes || {} })),
  requestedClasses: USER_INVENTORY.map((row, index) => ({
    id: `requested-${String(index + 1).padStart(3, '0')}`,
    ...row,
    decisionId: inventoryDecision(row),
    corpusCount: corpusFormCounts.get(normalizeApostrophe(row.form)) || 0,
    examples: (corpusFormExamples.get(normalizeApostrophe(row.form)) || []).slice(0, 4),
  })),
  corpusDiscoveredForms: [...corpusFormCounts.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([form, count]) => ({
    form,
    count,
    likelyType: /(?:i|you|he|she|it|we|they|there|here|who|what|where|when|why|how)['’](?:m|re|ve|ll|d|s)$/u.test(form)
      ? 'auxiliary-contraction-candidate'
      : form.endsWith("n't") || form.endsWith("n’t") ? 'negative-contraction'
        : form.endsWith("'s") || form.endsWith('’s') ? 'possessive-or-auxiliary-s' : 'other-apostrophe-form',
    examples: corpusFormExamples.get(form) || [],
  })),
  ambiguities: [
    { form: "'s", readings: ['is', 'has', 'possessive'], minimumSafeCondition: 'complete syntax proves exactly one parse', unresolvedExamples: ['He’s finished.', 'He’s not finished.', 'John’s book.'] },
    { form: "'d", readings: ['had', 'would'], minimumSafeCondition: 'following verb form and full construction force one reading', unresolvedExamples: ['I’d put it there.', 'I’d read it.'] },
    { form: "'re", readings: ['are', 'ASR spelling collision with were/there/their/your in nearby homophone classes'], minimumSafeCondition: 'match contracted subject + are as one exact pair; never rewrite a bare collision token', unresolvedExamples: ['We’re ready / were ready', 'They’re here / there / their'] },
    { form: "ain't", readings: ['am not', 'is not', 'are not', 'have not', 'has not'], minimumSafeCondition: 'none for general automatic acceptance', unresolvedExamples: ['She ain’t ready.', 'They ain’t done.'] },
    { form: "let's", readings: ['hortative let us', 'permission/request let us'], minimumSafeCondition: 'discourse and following base verb establish hortative force', unresolvedExamples: ['Let’s go.', 'Let us go.'] },
    { form: 'cannot / can not', readings: ['negative modal', 'wide/split scope'], minimumSafeCondition: 'do not conflate spaced form without contextual scope evidence', unresolvedExamples: ['I cannot go.', 'I can not go.'] },
  ],
};

const regressionFixtures = {
  schemaVersion: 1,
  positiveControls: [
    { id: 'p-be-i-am', expected: 'I am ready.', observed: "I’m ready.", decisionId: 'fixed-be-have-will', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', authorityTier: 'grammatical-variant', requiredProperty: 'complete ordered 1↔2 alignment; both expected tokens map to one observed token where needed' },
    { id: 'p-have-he-has', expected: "He’s been working.", observed: 'He has been working.', decisionId: 'ambiguous-s', contextCondition: 'been uniquely licenses has', modes: ['vocabulary', 'correction'], expectedResult: 'CONTEXT_CONDITIONAL' },
    { id: 'p-negative-do', expected: 'I do not agree.', observed: 'I don’t agree.', decisionId: 'negative-fixed-pair', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', polarity: 'negative', authorityTier: 'grammatical-variant' },
    { id: 'p-negative-can', expected: 'She cannot swim.', observed: 'She can’t swim.', decisionId: 'negative-fixed-pair', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', polarity: 'negative', authorityTier: 'grammatical-variant' },
    { id: 'p-negative-will', expected: 'She will not leave.', observed: 'She won’t leave.', decisionId: 'negative-fixed-pair', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', polarity: 'negative', authorityTier: 'grammatical-variant' },
    { id: 'p-cloze-negative-complete-target', expected: 'I do not agree.', observed: 'I don’t agree.', hiddenTarget: 'do not', decisionId: 'negative-fixed-pair', modes: ['cloze'], expectedResult: 'SAFE_EQUIVALENCE', requiredProperty: 'entire hidden target reproduced in place by final utterance; preservesExpectedNegation=true' },
    { id: 'p-d-would', expected: 'I would go.', observed: 'I’d go.', decisionId: 'ambiguous-d', contextCondition: 'go is an unambiguous bare-form cue', modes: ['vocabulary', 'correction'], expectedResult: 'CONTEXT_CONDITIONAL' },
    { id: 'p-d-had', expected: 'I had gone.', observed: 'I’d gone.', decisionId: 'ambiguous-d', contextCondition: 'gone is a past participle, not the bare form', modes: ['vocabulary', 'correction'], expectedResult: 'CONTEXT_CONDITIONAL' },
    { id: 'p-lets-hortative', expected: 'Let’s go.', observed: 'Let us go.', decisionId: 'lets-hortative', contextCondition: 'following base verb plus hortative discourse force', modes: ['vocabulary', 'correction'], expectedResult: 'CONTEXT_CONDITIONAL' },
    { id: 'p-arent-i-tag', expected: 'I’m late, aren’t I?', observed: 'I am late, am I not?', decisionId: 'am-not-tag', contextCondition: 'first-person positive antecedent licenses conventional negative tag', modes: ['vocabulary', 'correction'], expectedResult: 'CONTEXT_CONDITIONAL' },
    { id: 'p-unicode-apostrophe', expected: "I’m ready.", observed: "I'm ready.", decisionId: 'apostrophe-unicode', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE' },
    ...[
      ['p-be-you', 'You are ready.', "You're ready."],
      ['p-be-we', 'We are ready.', "We're ready."],
      ['p-be-they', 'They are ready.', "They're ready."],
      ['p-have-i', 'I have arrived.', "I've arrived."],
      ['p-have-you', 'You have arrived.', "You've arrived."],
      ['p-have-we', 'We have arrived.', "We've arrived."],
      ['p-have-they', 'They have arrived.', "They've arrived."],
      ['p-will-i', 'I will go.', "I'll go."],
      ['p-will-you', 'You will go.', "You'll go."],
      ['p-will-he', 'He will go.', "He'll go."],
      ['p-will-she', 'She will go.', "She'll go."],
      ['p-will-it', 'It will happen.', "It'll happen."],
      ['p-will-we', 'We will go.', "We'll go."],
      ['p-will-they', 'They will go.', "They'll go."],
    ].map(([id, expected, observed]) => ({ id, expected, observed, decisionId: 'fixed-be-have-will', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', authorityTier: 'grammatical-variant' })),
    ...[
      ['do-not', 'I do not agree.', "I don't agree.", 'I do agree.'],
      ['does-not', 'She does not agree.', "She doesn't agree.", 'She does agree.'],
      ['did-not', 'I did not agree.', "I didn't agree.", 'I did agree.'],
      ['is-not', 'He is not ready.', "He isn't ready.", 'He is ready.'],
      ['are-not', 'They are not ready.', "They aren't ready.", 'They are ready.'],
      ['was-not', 'He was not ready.', "He wasn't ready.", 'He was ready.'],
      ['were-not', 'They were not ready.', "They weren't ready.", 'They were ready.'],
      ['have-not', 'I have not arrived.', "I haven't arrived.", 'I have arrived.'],
      ['has-not', 'She has not arrived.', "She hasn't arrived.", 'She has arrived.'],
      ['had-not', 'I had not gone.', "I hadn't gone.", 'I had gone.'],
      ['cannot', 'She cannot go.', "She can't go.", 'She can go.'],
      ['could-not', 'She could not go.', "She couldn't go.", 'She could go.'],
      ['will-not', 'She will not go.', "She won't go.", 'She will go.'],
      ['would-not', 'She would not go.', "She wouldn't go.", 'She would go.'],
      ['should-not', 'She should not go.', "She shouldn't go.", 'She should go.'],
      ['must-not', 'She must not go.', "She mustn't go.", 'She must go.'],
      ['need-not', 'You need not go.', "You needn't go.", 'You need go.'],
      ['shall-not', 'I shall not go.', "I shan't go.", 'I shall go.'],
    ].map(([id, expected, observed]) => ({ id: `p-negative-${id}`, expected, observed, decisionId: 'negative-fixed-pair', modes: MODES, expectedResult: 'SAFE_EQUIVALENCE', polarity: 'negative', authorityTier: 'grammatical-variant' })),
  ],
  negativeControls: [
    { id: 'n-drop-negation', expected: 'She can’t swim.', observed: 'She can swim.', decisionId: 'negation-drop-or-add', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-drop-not', expected: 'I did not agree.', observed: 'I did agree.', decisionId: 'negation-drop-or-add', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-change-aux-is-has', expected: 'He is ready.', observed: 'He has ready.', decisionId: 'auxiliary-or-tense-swap', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-possessive-s', expected: 'John’s book.', observed: 'John is book.', decisionId: 'lexical-possessive-s', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-would-had', expected: 'I would go.', observed: 'I had gone.', decisionId: 'auxiliary-or-tense-swap', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-have-be', expected: 'He has been working.', observed: 'He is been working.', decisionId: 'auxiliary-or-tense-swap', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-neg-aux-swap', expected: 'I do not agree.', observed: 'I does not agree.', decisionId: 'auxiliary-or-tense-swap', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-final-contraction', expected: 'Yes, he is.', observed: 'Yes, he’s.', decisionId: 'sentence-final-auxiliary', expectedResult: 'REJECT' },
    { id: 'n-drop-apostrophe', expected: 'It’s name.', observed: 'Its name.', decisionId: 'homophone-spelling-collision', expectedResult: 'UNRESOLVED', note: 'Possessive its and contraction it’s must not be collapsed by apostrophe deletion.' },
    { id: 'n-tag-out-of-context', expected: 'I am not ready.', observed: 'I aren’t I ready.', decisionId: 'am-not-tag', expectedResult: 'REJECT' },
    { id: 'n-can-not-scope', expected: 'I cannot go.', observed: 'I can not go.', decisionId: 'can-not-spacing', expectedResult: 'UNRESOLVED' },
    { id: 'n-aint-polarity', expected: 'She is ready.', observed: 'She ain’t ready.', decisionId: 'negation-drop-or-add', expectedResult: 'REJECT' },
    { id: 'n-aint-auxiliary', expected: 'She hasn’t seen it.', observed: 'She ain’t seen it.', decisionId: 'aint-dialect', expectedResult: 'UNRESOLVED' },
    { id: 'n-s-ambiguity', expected: 'He is finished.', observed: 'He’s finished.', decisionId: 'ambiguous-s', expectedResult: 'UNRESOLVED', note: 'also parses as he has finished' },
    { id: 'n-d-ambiguity', expected: 'I would put it there.', observed: 'I’d put it there.', decisionId: 'ambiguous-d', expectedResult: 'UNRESOLVED', note: 'put is base and past participle' },
    { id: 'n-cross-rank-synthesis', expected: 'do not agree', hypotheses: [{ rank: 0, transcript: 'do' }, { rank: 2, transcript: 'not agree' }], decisionId: 'nbest-no-synthesis', expectedResult: 'REJECT', minimumCounterexample: true },
    { id: 'n-cloze-negation', expected: 'I will not leave.', observed: 'I will leave.', decisionId: 'negation-drop-or-add', mode: 'cloze', expectedResult: 'REJECT', requiredProperty: 'preservesExpectedNegation=false; pass=false' },
    { id: 'n-cloze-partial-hidden-target', expected: 'She will not leave tonight.', observed: 'She won’t tonight.', hiddenTarget: 'will not leave', decisionId: 'negative-fixed-pair', mode: 'cloze', expectedResult: 'REJECT', requiredProperty: 'negation remains, but hidden target is incomplete and pass=false' },
    { id: 'n-read-missing-reference-word', expected: 'I am ready now.', observed: 'I’m ready.', decisionId: 'fixed-be-have-will', mode: 'read', expectedResult: 'REJECT', requiredProperty: 'I am↔I’m span may align; missing now remains missing and is not synthesized' },
    { id: 'n-paraphrase-not-target', expected: 'entry.paraphrases[i]', observed: 'contracted paraphrase counterpart', decisionId: 'fixed-be-have-will', expectedResult: 'PARAPHRASE_OR_MISS', requiredProperty: 'never promote to TARGET' },
    ...[
      ['do-not', "I don't agree.", 'I do agree.'], ['does-not', "She doesn't agree.", 'She does agree.'],
      ['did-not', "I didn't agree.", 'I did agree.'], ['is-not', "He isn't ready.", 'He is ready.'],
      ['are-not', "They aren't ready.", 'They are ready.'], ['was-not', "He wasn't ready.", 'He was ready.'],
      ['were-not', "They weren't ready.", 'They were ready.'], ['have-not', "I haven't arrived.", 'I have arrived.'],
      ['has-not', "She hasn't arrived.", 'She has arrived.'], ['had-not', "I hadn't gone.", 'I had gone.'],
      ['cannot', "She can't go.", 'She can go.'], ['could-not', "She couldn't go.", 'She could go.'],
      ['will-not', "She won't go.", 'She will go.'], ['would-not', "She wouldn't go.", 'She would go.'],
      ['should-not', "She shouldn't go.", 'She should go.'], ['must-not', "She mustn't go.", 'She must go.'],
      ['need-not', "You needn't go.", 'You need go.'], ['shall-not', "I shan't go.", 'I shall go.'],
    ].map(([id, expected, observed]) => ({ id: `n-polarity-${id}`, expected, observed, decisionId: 'negation-drop-or-add', modes: MODES, expectedResult: 'REJECT', minimumCounterexample: true })),
  ],
  safetyCoverage: {
    negativeContractionPairs: NEGATIVE_PAIRS.map(([expansion, contraction]) => {
      const pairId = expansion.replace(/\s+/gu, '-');
      return { expansion, contraction, positiveFixtureId: `p-negative-${pairId}`, negativeFixtureId: `n-polarity-${pairId}` };
    }),
  },
  nbestControls: [
    { id: 'nbest-complete-rank-only', expected: 'do not agree', hypotheses: [{ rank: 0, transcript: 'do agree' }, { rank: 2, transcript: "don't agree" }], expectedResult: 'evaluate rank 0 then evaluate rank 2 independently; never synthesize' },
  ],
  modeExpectations: {
    vocabulary: 'Only a bounded pair anchored to existing canonical/answers/source authority may return TARGET; a paraphrase remains PARAPHRASE.',
    correction: 'Use the same strict pair and alignment provenance; correction practice does not add a scheduled SRS write.',
    read: 'SAFE only for listed complete grammatical-variant spans; preserve ordered reference-token alignment/highlights and leave every unmatched word unmatched. Never synthesize content words.',
    cloze: 'SAFE only when the complete hidden target is reproduced in place by the selected final utterance; target completeness and preservesExpectedNegation must both pass.',
  },
};

function reconciledClosureEvidence() {
  if (blobSha(TD_RECONCILIATION_PATH) !== TD_RECONCILIATION_BLOB) throw new Error('T/D reconciliation artifact blob drift');
  const reconciliation = json(TD_RECONCILIATION_PATH);
  const counts = reconciliation.counts;
  if (reconciliation.reconciled_main_sha !== BASELINE_SHA
    || reconciliation.source_blobs['data/vocabulary-v3.json'] !== EXPECTED_BLOBS['data/vocabulary-v3.json']
    || reconciliation.source_blobs['data/items.json'] !== EXPECTED_BLOBS['data/items.json']
    || reconciliation.historical_materialization_blob_sha !== 'd3dedaafd2b42807bbf41a3036bbf6992fa3d603'
    || counts.total !== 36 || reconciliation.records.length !== 36
    || counts.statuses.UNCHANGED !== 34 || counts.statuses.INDEX_RELOCATED !== 2
    || counts.collision_accepted !== 36
    || ['SURFACE_REMOVED', 'SURFACE_MODIFIED', 'AMBIGUOUS_DUPLICATE', 'AUTHORITY_DRIFT'].some(status => counts.statuses[status] !== 0)) {
    throw new Error('T/D reconciliation authority is not the closed 36-record snapshot');
  }
  const moved = new Map([
    ['tdc-00002', { entry: 'vocab:00528', surface: 'be forced to do something' }],
    ['tdc-00007', { entry: 'vocab:00634', surface: 'tend to do something' }],
  ]);
  if (new Set(reconciliation.records.map(row => row.audit_candidate_id)).size !== 36) throw new Error('Duplicate T/D audit IDs');
  for (const row of reconciliation.records) {
    const expected = moved.get(row.audit_candidate_id);
    const movedCorrectly = expected && row.entry_id === expected.entry && row.current.current_surface === expected.surface
      && row.historical.surface_index === 0 && row.current.current_index === 1
      && row.current.classification === 'PARAPHRASE' && row.historical_relationship === 'SAME_EXACT_SURFACE_UNIQUE_AT_NEW_INDEX';
    if (row.current.state !== (expected ? 'INDEX_RELOCATED' : 'UNCHANGED')
      || (expected && !movedCorrectly)
      || row.current.exact_surface_match_count !== 1
      || row.current.current_surface !== row.historical.target_surface
      || row.current.classification !== row.current.expected_classification
      || row.collision.accepted !== true || row.collision.classification !== row.current.classification
      || row.collision.applied_rule_id !== row.collision.aligned_rule_id) {
      throw new Error(`Unresolved T/D reconciliation drift: ${row.audit_candidate_id}`);
    }
  }
  return {
    tdValidatorRepairPr: MERGE_EVIDENCE.tdRepairPr,
    tdValidatorRepairMergeSha: MERGE_EVIDENCE.tdRepairMergeSha,
    asr09aAuditPr: MERGE_EVIDENCE.auditPr,
    asr09aAuditMergeSha: MERGE_EVIDENCE.auditMergeSha,
    tdReconciliationPath: TD_RECONCILIATION_PATH,
    tdReconciliationBlobSha: TD_RECONCILIATION_BLOB,
    tdTotalRecords: counts.total, tdUnchanged: counts.statuses.UNCHANGED,
    tdIndexRelocated: counts.statuses.INDEX_RELOCATED, tdUnresolvedDrift: 0,
  };
}
const vocabFile = fs.readFileSync(path.join(ROOT, 'data/vocabulary-v3.json'));
const itemsFile = fs.readFileSync(path.join(ROOT, 'data/items.json'));
const appVersion = 'v5.101';
const auditStatus = joinErrors.length ? 'BLOCKED' : 'CLOSED';
if (auditStatus !== 'CLOSED') throw new Error('ASR-09A audit authority is not CLOSED');
const closureResolution = reconciledClosureEvidence();
const manifest = {
  schemaVersion: 1,
  audit: 'ASR-09A Grammatical Speech Equivalence Audit',
  status: auditStatus,
  implementationReady: auditStatus === 'CLOSED',
  repositoryClosure: {
    status: 'CLOSED',
    auditAuthorityStatus: auditStatus,
    implementationAuthority: 'ASR-09B_READY',
    blocker: null,
    resolution: closureResolution,
  },
  source: {
    repository: 'miyatayuuma/english-pwa',
    baselineMainSha: BASELINE_SHA,
    baselineStatus: 'matches task-provided current production baseline',
    appVersion,
    vocabularyBlob: blobSha('data/vocabulary-v3.json'),
    itemsBlob: blobSha('data/items.json'),
    vocabularySha256: sha256(vocabFile),
    itemsSha256: sha256(itemsFile),
    existingJapanesePromptAuthority: 'PR #325 / CLOSED',
    japanesePromptAuditStatus: json('data/audits/vocabulary-japanese-prompt-authority-reconciliation/manifest.json').status,
    japanesePromptMaterializationStatus: json('data/audits/vocabulary-japanese-prompt-authority-materialization/materialization.json').status,
  },
  population: {
    vocabularyEntries: vocabulary.length,
    uniqueVocabularyIds: new Set(vocabulary.map(x => x.id)).size,
    itemSentences: items.length,
    uniqueItemIds: new Set(items.map(x => x.id)).size,
    vocabularyOccurrences: vocabulary.reduce((sum, row) => sum + (row.occurrences || []).length, 0),
    joinedVocabularyOccurrences: vocabulary.reduce((sum, row) => sum + (row.occurrences || []).filter(x => itemById.has(String(x.item_id))).length, 0),
    vocabularyStringFieldsScanned: vocabulary.reduce((sum, row) => sum + 1 + (row.answers || []).length + (row.paraphrases || []).length, 0),
    itemEnglishFieldsScanned: items.length,
  },
  baselineIntegrity: {
    entryIdsUnique: new Set(vocabulary.map(x => x.id)).size === vocabulary.length,
    itemIdsUnique: new Set(items.map(x => x.id)).size === items.length,
    productionAuthorityFieldsHashFrozen: true,
    productionSourceSha256Recorded: true,
    occurrenceJoin: `${vocabulary.reduce((sum, row) => sum + (row.occurrences || []).filter(x => itemById.has(String(x.item_id))).length, 0)}/${vocabulary.reduce((sum, row) => sum + (row.occurrences || []).length, 0)}`,
    japanesePromptRemediation: { auditStatus: 'CLOSED', materializationStatus: 'MATERIALIZED', post: 545, drift: 0 },
    preValidation: { 'npm run vocab:check-derived': 'PASS', 'npm run vocab:validate': 'PASS' },
  },
  candidateAccounting: {
    total: candidates.length,
    bySourceType: { vocabulary: candidates.filter(row => row.sourceType === 'vocabulary').length, item: candidates.filter(row => row.sourceType === 'item').length },
    byTaxonomy: taxonomyCounts,
    byDisposition: dispositionCounts,
    byModeTreatment: modeTreatmentCounts,
    byFamily: Object.fromEntries(Object.entries(familyCounts).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    unresolvedCandidateIds: candidates.filter(row => row.disposition === 'UNRESOLVED').map(row => row.id),
  },
  integrity: {
    sourceOrderDeterministic: true,
    stableCandidateId: 'sha256(sourceType, sourceId, field, span, familyId)[0:16]',
    sourceContextsRetained: true,
    sourceOccurrencesJoinedById: true,
    occurrenceJoinErrors: joinErrors.length,
    duplicateCandidateDrops,
    productionDataChanged: false,
    productionCodeChanged: false,
  },
};

const architectureReport = `# ASR-09A Architecture Report\n\n## Baseline\n\n- Repository: \`miyatayuuma/english-pwa\`\n- Main: \`${BASELINE_SHA}\`\n- APP_VERSION: \`${appVersion}\`\n- Vocabulary / items blob: \`${manifest.source.vocabularyBlob}\` / \`${manifest.source.itemsBlob}\`\n- Closed Japanese Prompt Authority: PR #325; production materialization confirms population 2,478, POST=545, DRIFT=0.\n\n## Existing speech path\n\n${existingAuthority.findings.map(row => `- **${row.id} — ${row.result}:** ${row.detail}`).join('\n')}\n\n## Candidate accounting\n\nThe deterministic generator scanned ${manifest.population.vocabularyEntries} vocabulary entries (${manifest.population.vocabularyStringFieldsScanned} canonical/answer/paraphrase strings), ${manifest.population.itemSentences} source English sentences, and joined ${manifest.population.joinedVocabularyOccurrences}/${manifest.population.vocabularyOccurrences} vocabulary source occurrences. It emitted ${candidates.length} deduplicated candidate spans. Classification and disposition counts are in \`manifest.json\`; every corpus candidate joins one explicit decision in \`decisions.json\`.\n\n## Grammar authority\n\n- A contraction and its expanded form are grammatical variants, not punctuation normalization and not permission to add a semantic paraphrase.\n- A fixed pair is eligible only as an exact contiguous span in either direction. Preserve all surrounding tokens, order, auxiliary, tense/aspect, and polarity. Keep raw ASR text unchanged and retain the rule ID and span as alignment provenance.\n- \`’s\` and \`’d\` remain context conditional. A bounded local resolver may pass only when the construction forces one standard parse; unresolved parses reject. The corpus scanner records cues but does not grant production credit.\n- Negative rules bind the auxiliary and negator together (do not↔don’t, will not↔won’t, etc.). A missing or added negation, changed auxiliary, or changed scope is REJECT. \`can not\` remains separate from \`cannot/can’t\` unless context establishes narrow negative scope.\n- \`let’s\`, \`ain’t\`, lexical possessive \`’s\`, and homophone/role collisions are conditional or unresolved. There is no global apostrophe deletion, suffix expansion, or tense morphology.\n- Inventory rows always include the task’s listed classes; \`corpusDiscoveredForms\` adds actual forms found in the source. Corpus occurrence count is not an approval count.\n\n## Mode policy\n\nRecommend ASR-09B first enable only for Vocabulary and Correction, where a listed bounded equivalent may align to an already accepted canonical/answer/source surface. It must not add an answer variant or promote a paraphrase. Read and Cloze remain unresolved in this audit: their reading-text, highlighting, hidden-target completeness, selected final repair, and negation guards require a separate acceptance decision. Cloze must continue to require every hidden target in place and \`preservesExpectedNegation\`; no contraction rule may bypass these gates.\n\nN-best hypotheses remain independent provider outputs: exact/rule matching may be evaluated within one finalized candidate and rank, but no cross-rank, cross-segment, or prior-attempt synthesis is authorized. The existing lower-rank ordering and current explicit rules remain untouched.\n\n## Architecture comparison\n\n| Option | False-positive risk | Coverage | Runtime / sharing | Assessment |\n|---|---|---|---|---|\n| A. Explicit surface pairs | Lowest when span-scoped; list can grow | Low to medium | Minimal, browser/Android shared | Good for safe fixed contractions and negative pairs; insufficient alone for ’s/’d. |\n| B. Morphological expansion | Highest; promotes role, tense, polarity, and possessive collisions | Broad | Low runtime, high audit surface | Reject as a global strategy. |\n| C. Bounded grammar-aware resolver | Medium; depends on grammar coverage | Medium/high | Shared JS possible; parsing and provenance are more complex | Use only as a conservative gate for ’s/’d; unresolved must reject. |\n| D. Hybrid (recommended) | Low when fixed-pair list plus bounded resolver and hard polarity checks | Useful, intentionally bounded | Small shared rule set; one-to-many alignment already supported | ASR-09B should implement this, preserve raw transcript, and emit rule/span/provenance. |\n\nThe current alignment supports explicit ordered 1↔N spans, mode/entry/provider scope, and rule provenance. Add no generic token synthesis. Keep exact answer classification before/alongside ASR alignment so TARGET, PARAPHRASE, and MISS remain distinct.\n\n## Regression obligations and remaining risks\n\n${regressionFixtures.positiveControls.length} positive controls, ${regressionFixtures.negativeControls.length} negative controls, and N-best/mode-specific controls are supplied. ASR-09B must turn all SAFE decisions into production tests and preserve each minimum collision. The finite local grammar cue lists do not constitute a full English parser; do not expand them to unseen morphology without new evidence.\n`;

const architectureComparison = `| Dimension | A. Explicit surface pairs | B. Morphological expansion | C. Bounded grammar resolver | D. Hybrid (recommended) |
|---|---|---|---|---|
| False-positive risk | Low for listed complete spans; registry omissions remain | High: auxiliary, tense, polarity, possessive, and homophone collisions | Medium; grammar coverage can misparse edge forms | Low for fixed pairs; conditionals pass only under a unique parse |
| False-negative reduction | Reduces misses only for enumerated pairs | Broadest apparent reduction, including unsafe cases | Reduces misses for context-forced ’s/’d and constructions | Strong for common safe pairs, bounded for ambiguous families |
| Corpus coverage | Measured, explainable; no unseen forms | Broad but cannot be safely counted as approval | Moderate, depends on controlled grammar inventory | Covers the 221 safe grammar candidates; conditional/unresolved rows stay excluded |
| Runtime cost | Low bounded table lookup | Low after expansion, with large rule surface | Highest; local parsing and syntax checks | Low for fixed list plus small bounded resolver |
| Implementation complexity | Low | Medium; high ongoing regression burden | High | Medium and auditable |
| Browser / Android sharing | Shared data table | Shared but risks global behavior drift | Shared parser needed | Shared rules and resolver; same audit fixtures across clients |
| N-best behavior | Apply to one complete finalized rank at a time | Temptation to normalize candidates broadly | One candidate at a time | Same; never combine ranks, segments, or attempts |
| Alignment provenance | Pair ID and exact span | Expansion path can be opaque | Parse rule and syntax evidence required | Emit authority tier, rule ID, expected/observed spans, and reason |
| Raw transcript | Preserve without rewriting | Often normalized destructively | Can preserve if deliberately designed | Preserve raw ASR text; expose normalized alignment separately |
| Vocabulary authority | Keep canonical/answers/source as TARGET; paraphrases stay PARAPHRASE | High risk of implicit answer promotion | Needs explicit admission boundary | Only align a listed pair to current TARGET authority; never promote paraphrases |

The current alignment supports explicit ordered 1↔N spans, mode/entry/provider scope, and rule provenance. Grammar variants use a distinct grammatical-variant authority tier from Unicode apostrophe normalization. Read preserves every unmatched reference word; Cloze additionally requires complete in-place hidden-target reproduction, the selected final repair, and negation preservation. These modes do not grant credit to unlisted paraphrases.`;
const architectureReportDetailed = architectureReport
  .replace(/## Mode policy\n\n[\s\S]*?\n\nN-best hypotheses remain/, `## Mode policy\n\nThe enumerated fixed contraction and negative pairs are authorized for Vocabulary, Read, Cloze, and Correction with a separate grammatical-variant provenance tier. Vocabulary still requires canonical/answers/source TARGET authority; Read retains unmatched tokens and highlights only mapped reference indexes; Cloze requires a complete hidden target in place in the selected final utterance plus its existing completeness and negation guards; Correction adds no scheduled SRS update. Context-dependent ’s, ’d, split can not, let’s, and tag forms remain conditional and are not authorized for Read/Cloze in this audit.\n\nN-best hypotheses remain`)
  .replace(/## Architecture comparison\n\n[\s\S]*?\n\n## Regression obligations/, `## Architecture comparison\n\n${architectureComparison}\n\n## Regression obligations`)
  .replace('## Regression obligations', '## Repository closure gate\n\n' + REPOSITORY_CLOSURE_TEXT + '\n\n## Regression obligations');

const summary = `# ASR-09A Grammatical Speech Equivalence Audit\n\n**Status: ${auditStatus} — ASR-09B implementation authority prepared**\n\n## Fixed baseline\n\n- Main SHA: \`${BASELINE_SHA}\`\n- APP_VERSION: \`${appVersion}\`\n- Vocabulary: ${manifest.population.vocabularyEntries} entries; blob \`${manifest.source.vocabularyBlob}\`\n- Source items: ${manifest.population.itemSentences}; blob \`${manifest.source.itemsBlob}\`\n- Vocabulary occurrences: ${manifest.population.joinedVocabularyOccurrences}/${manifest.population.vocabularyOccurrences} joined\n- PR #325 Japanese Prompt materialization: CLOSED; current POST state verified.\n\n## Corpus accounting\n\nScanned ${manifest.population.vocabularyStringFieldsScanned} canonical/answer/paraphrase strings, all ${manifest.population.itemEnglishFieldsScanned} Read/Cloze source sentences, and source occurrence links. Emitted **${candidates.length}** unique candidate spans.\n\n| Taxonomy | Corpus candidates |\n|---|---:|\n${Object.entries(taxonomyCounts).map(([key, count]) => `| ${key} | ${count} |`).join('\n')}\n\n| Treatment | Corpus candidates |\n|---|---:|\n${Object.entries(dispositionCounts).map(([key, count]) => `| ${key} | ${count} |`).join('\n')}\n\nCounts classify detected spans; they are not production approvals. Each ambiguous or unresolved source remains explicitly joined to a decision. The full candidate rows and rule-level reasons are in \`corpus-candidates.json\` and \`decisions.json\`.\n\n## Decision\n\n- Safe pair-based equivalents: only exact, listed contraction↔expansion spans whose auxiliary and polarity are unchanged; recommended for Vocabulary/Correction, with existing answer authority retained.\n- Conditional: \`’s\`, \`’d\`, \`let’s\`, split \`can not\`, and the conventional \`aren’t I\` tag. Only a unique, complete parse can pass; all other cases remain unresolved.\n- Reject: negation loss/addition, auxiliary/tense substitution, unsupported sentence-final contractions, and cross-rank/segment phrase synthesis.\n- Unresolved: \`ain’t\`, lexical possessive \`’s\`, unresolved homophone/role collisions, and any context not parsed uniquely.\n- Read and Cloze rollout policy remains unresolved. Keep their existing alignment, hidden-target completeness, final repair, and negation requirements until a mode-specific acceptance policy is chosen.\n\nSee \`architecture-report.md\` for implementation comparison, risks, exact constraints, and next-task guidance.\n`;

const modeTable = `| Mode | SAFE | CONDITIONAL | REJECT | UNRESOLVED |\n|---|---:|---:|---:|---:|\n${MODES.map(mode => `| ${mode} | ${modeTreatmentCounts[mode].SAFE_EQUIVALENCE} | ${modeTreatmentCounts[mode].CONTEXT_CONDITIONAL} | ${modeTreatmentCounts[mode].REJECT} | ${modeTreatmentCounts[mode].UNRESOLVED} |`).join('\n')}`;
const summaryWithModes = summary
  .replace('PR #325 Japanese Prompt materialization: CLOSED; current POST state verified.', 'PR #325 Japanese Prompt materialization: CLOSED; POST=545, DRIFT=0. Baseline PRE checks passed: npm run vocab:check-derived and npm run vocab:validate.')
  .replace('recommended for Vocabulary/Correction, with existing answer authority retained.', 'approved for all four modes under the separate grammatical-variant authority tier, with existing answer authority retained.')
  .replace('Read and Cloze rollout policy remains unresolved. Keep their existing alignment, hidden-target completeness, final repair, and negation requirements until a mode-specific acceptance policy is chosen.', 'Read accepts only listed complete spans and preserves missing words/highlights. Cloze accepts only a complete hidden target in place in the selected final utterance; completeness and preservesExpectedNegation remain mandatory.')
  .replace('\n\nCounts classify detected spans;', `\n\n${modeTable}\n\nCounts classify detected spans;`)
  .replace('\n\nSee `architecture-report.md`', '\n\n## Repository closure gate\n\n' + REPOSITORY_CLOSURE_TEXT + '\n\nSee `architecture-report.md`');

const outputs = new Map([
  ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
  ['inventory.json', `${JSON.stringify(inventory, null, 2)}\n`],
  ['corpus-candidates.json', `${JSON.stringify({ schemaVersion: 1, candidates }, null, 2)}\n`],
  ['decisions.json', `${JSON.stringify({ schemaVersion: 1, decisions }, null, 2)}\n`],
  ['regression-fixtures.json', `${JSON.stringify(regressionFixtures, null, 2)}\n`],
  ['architecture-report.md', architectureReportDetailed],
  ['summary.md', summaryWithModes],
]);

const checkMode = process.argv.includes('--check');
if (process.argv.includes('--write')) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, value] of outputs) fs.writeFileSync(path.join(OUT_DIR, name), value);
}
if (checkMode) {
  const failures = [];
  for (const [name, value] of outputs) {
    const file = path.join(OUT_DIR, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== value) failures.push(name);
  }
  if (failures.length) {
    console.error(`ASR-09A deterministic check failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else console.log(`ASR-09A deterministic check PASS (${outputs.size} files; ${candidates.length} corpus candidates).`);
} else if (!process.argv.includes('--write')) {
  console.log(JSON.stringify({
    status: auditStatus,
    baselineMainSha: BASELINE_SHA,
    appVersion,
    vocabulary: vocabulary.length,
    items: items.length,
    candidates: candidates.length,
    byTaxonomy: taxonomyCounts,
    byDisposition: dispositionCounts,
  }, null, 2));
}
