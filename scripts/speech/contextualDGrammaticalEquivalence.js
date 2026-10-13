const ALLOWED_MODES = new Set(['vocabulary', 'correction']);
const SUBJECTS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);
const CONTRACTED_SUBJECTS = new Map([
  ["i'd", 'i'], ["you'd", 'you'], ["he'd", 'he'], ["she'd", 'she'],
  ["it'd", 'it'], ["we'd", 'we'], ["they'd", 'they'],
]);

// These are lexical authorities, not suffix-based morphology guesses. Syncretic
// forms (put, read, cut, come, run, set, let, hit) intentionally appear nowhere.
export const ASR09D_PAST_PARTICIPLES = Object.freeze([
  'been', 'deposited', 'eaten', 'gone', 'seen', 'taken', 'written',
]);
export const ASR09D_BASE_VERBS = Object.freeze([
  'ask', 'be', 'do', 'eat', 'go', 'like', 'see', 'speak',
]);
const PAST_PARTICIPLES = new Set(ASR09D_PAST_PARTICIPLES);
const BASE_VERBS = new Set(ASR09D_BASE_VERBS);
const BEEN_COMPLEMENTS = new Set(['covering', 'taken']);
const DISALLOWED_COMPLEMENTS = new Set([
  'not', 'never', 'already', 'just', 'have', 'had', 'would', 'better', 'rather',
]);

export const ASR09D_CONTEXTUAL_PATTERNS = Object.freeze([
  Object.freeze({
    patternId: 'asr09d-had-past-participle',
    ruleId: 'asr09d-had-past-participle',
    selectedAuxiliary: 'had',
    expectedForm: 'subject + had + explicitly allowlisted past participle',
    recognizedForm: "subject'd + same explicitly allowlisted past participle",
    minimalCounterexample: { expected: 'I had read it.', observed: "I'd read it." },
  }),
  Object.freeze({
    patternId: 'asr09d-would-base-verb',
    ruleId: 'asr09d-would-base-verb',
    selectedAuxiliary: 'would',
    expectedForm: 'subject + would + explicitly allowlisted base verb',
    recognizedForm: "subject'd + same explicitly allowlisted base verb",
    minimalCounterexample: { expected: 'I would put it there.', observed: "I'd put it there." },
  }),
]);

const tokenValue = (tokens, index) => tokens?.[index]?.value ?? null;

export function isContextualDHeadAt(tokens, start) {
  const token = tokenValue(tokens, start);
  return CONTRACTED_SUBJECTS.has(token)
    || (SUBJECTS.has(token) && ['had', 'would'].includes(tokenValue(tokens, start + 1)));
}

export function hasContextualDHead(tokens) {
  for (let index = 0; index < (tokens?.length ?? 0); index += 1) {
    if (isContextualDHeadAt(tokens, index)) return true;
  }
  return false;
}

function unresolved(reason, evidence = null) {
  return { status: 'UNRESOLVED', reason, evidence };
}

function parseAt(tokens, start) {
  const first = tokenValue(tokens, start);
  const contractedSubject = CONTRACTED_SUBJECTS.get(first);
  const subject = contractedSubject ?? first;
  if (!SUBJECTS.has(subject)) return null;

  const auxiliary = contractedSubject ? null : tokenValue(tokens, start + 1);
  if (!contractedSubject && !['had', 'would'].includes(auxiliary)) return null;
  const auxiliaryIndex = contractedSubject ? start : start + 1;
  const verbIndex = contractedSubject ? start + 1 : start + 2;
  const next = tokenValue(tokens, verbIndex);

  if (DISALLOWED_COMPLEMENTS.has(next)) {
    return unresolved('excluded-complement-or-incomplete-evidence', {
      subject, surface: first, auxiliary: auxiliary ?? null, next,
    });
  }

  let selectedAuxiliary;
  let patternId;
  let lexicalHead = next;
  if (next === 'been' && PAST_PARTICIPLES.has(next)) {
    const continuation = tokenValue(tokens, verbIndex + 1);
    if (!BEEN_COMPLEMENTS.has(continuation)) {
      return unresolved('complete-had-been-construction-not-established', {
        subject, surface: first, continuation,
      });
    }
    selectedAuxiliary = 'had';
    patternId = 'asr09d-had-past-participle';
    lexicalHead = `been ${continuation}`;
  } else if (PAST_PARTICIPLES.has(next) && !BASE_VERBS.has(next)) {
    selectedAuxiliary = 'had';
    patternId = 'asr09d-had-past-participle';
  } else if (BASE_VERBS.has(next) && !PAST_PARTICIPLES.has(next)) {
    selectedAuxiliary = 'would';
    patternId = 'asr09d-would-base-verb';
  } else {
    return unresolved('following-verb-not-unambiguously-approved', {
      subject, surface: first, auxiliary: auxiliary ?? null, next,
    });
  }

  if (auxiliary && auxiliary !== selectedAuxiliary) {
    return unresolved('expanded-auxiliary-disagrees-with-complement', {
      subject, auxiliary, next, selectedAuxiliary,
    });
  }
  return {
    status: 'PARSED', subject, auxiliary: selectedAuxiliary, patternId,
    lexicalHead,
    contracted: !!contractedSubject,
    tokenStart: start,
    tokenLength: contractedSubject ? 1 : 2,
    evidenceTokens: contractedSubject
      ? [first, next, ...(lexicalHead.startsWith('been ') ? [tokenValue(tokens, verbIndex + 1)] : [])]
      : [subject, auxiliary, next, ...(lexicalHead.startsWith('been ') ? [tokenValue(tokens, verbIndex + 1)] : [])],
    evidenceSpan: {
      start,
      end: verbIndex + (lexicalHead.startsWith('been ') ? 1 : 0) + 1,
      auxiliaryIndex,
    },
  };
}

/**
 * Bounded ASR-09D resolver. Each complete token sequence is parsed independently;
 * a reference-side auxiliary never supplies evidence for an observed contraction.
 */
export function resolveContextualDGrammaticalEquivalence({
  expectedTokens = [],
  observedTokens = [],
  expectedStart = 0,
  observedStart = 0,
  mode = '',
  referenceContext = null,
  recognitionProvenance = null,
} = {}) {
  const expectedParse = parseAt(expectedTokens, expectedStart);
  const observedParse = parseAt(observedTokens, observedStart);
  if (!expectedParse && !observedParse) return { status: 'NO_MATCH' };
  if (!ALLOWED_MODES.has(String(mode))) {
    return unresolved('mode-not-authorized', { mode: String(mode || '') });
  }
  if (!expectedParse || !observedParse
    || expectedParse.status !== 'PARSED' || observedParse.status !== 'PARSED') {
    return unresolved('complete-unique-independent-parse-not-established', {
      expected: expectedParse, observed: observedParse,
    });
  }
  if (expectedParse.subject !== observedParse.subject
    || expectedParse.auxiliary !== observedParse.auxiliary
    || expectedParse.patternId !== observedParse.patternId
    || expectedParse.lexicalHead !== observedParse.lexicalHead) {
    return unresolved('independent-parses-disagree', {
      expected: expectedParse, observed: observedParse,
    });
  }
  if (expectedParse.contracted === observedParse.contracted) return { status: 'NO_MATCH' };

  const rule = ASR09D_CONTEXTUAL_PATTERNS.find(row => row.patternId === expectedParse.patternId);
  const expectedTokenSpan = { start: expectedStart, length: expectedParse.tokenLength };
  const observedTokenSpan = { start: observedStart, length: observedParse.tokenLength };
  const contextualGrammarEvidence = {
    patternId: rule.patternId,
    subject: expectedParse.subject,
    selectedAuxiliary: expectedParse.auxiliary,
    lexicalHead: expectedParse.lexicalHead,
    expectedParse: expectedParse.evidenceTokens,
    observedParse: observedParse.evidenceTokens,
    expectedParseSpan: expectedParse.evidenceSpan,
    observedParseSpan: observedParse.evidenceSpan,
    independentParseAgreement: true,
    permittedMode: String(mode),
    referenceContextProvided: referenceContext != null,
    recognitionProvenanceProvided: recognitionProvenance != null,
  };
  return {
    status: 'MATCH',
    authority: 'grammatical-variant',
    authorityTier: 'grammatical-variant',
    decisionId: 'ambiguous-d',
    ruleId: rule.ruleId,
    ruleKind: 'contextual-grammatical-equivalence',
    patternId: rule.patternId,
    selectedAuxiliary: expectedParse.auxiliary,
    expectedLength: expectedParse.tokenLength,
    observedLength: observedParse.tokenLength,
    expectedTokenSpan,
    observedTokenSpan,
    contextualGrammarEvidence,
    independentParseAgreement: true,
    displayPolicy: 'raw',
  };
}
