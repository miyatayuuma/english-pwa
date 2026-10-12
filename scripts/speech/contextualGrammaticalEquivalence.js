const ALLOWED_MODES = new Set(['vocabulary', 'correction']);
const SUBJECTS = new Set(['he', 'she', 'it']);
const CONTRACTED_SUBJECTS = new Map([
  ["he's", 'he'],
  ["she's", 'she'],
  ["it's", 'it'],
]);

// This is deliberately a closed lexical set. An -ing suffix alone does not
// establish that the token is functioning as a present participle.
export const ASR09C_PROGRESSIVE_PARTICIPLES = Object.freeze([
  'catching',
  'going',
  'raining',
  'running',
  'seeing',
  'studying',
  'working',
]);
const PROGRESSIVE_PARTICIPLES = new Set(ASR09C_PROGRESSIVE_PARTICIPLES);

export const ASR09C_CONTEXTUAL_PATTERNS = Object.freeze([
  Object.freeze({
    ruleId: 'asr09c-is-progressive',
    selectedAuxiliary: 'is',
    expectedForm: 'subject + is + allowlisted present participle',
    recognizedForm: "subject's + same allowlisted present participle",
    expectedTokenLength: 2,
    recognizedTokenLength: 1,
    minimalCounterexample: { expected: 'He is finished.', observed: "He's finished." },
  }),
  Object.freeze({
    ruleId: 'asr09c-has-been-progressive',
    selectedAuxiliary: 'has',
    expectedForm: 'subject + has + been + allowlisted present participle',
    recognizedForm: "subject's + been + same allowlisted present participle",
    expectedTokenLength: 2,
    recognizedTokenLength: 1,
    minimalCounterexample: { expected: 'He has finished.', observed: "He's finished." },
  }),
]);

const tokenValue = (tokens, index) => tokens?.[index]?.value ?? null;

export function isContextualSHeadAt(tokens, start) {
  const token = tokenValue(tokens, start);
  return CONTRACTED_SUBJECTS.has(token)
    || (SUBJECTS.has(token) && ['is', 'has'].includes(tokenValue(tokens, start + 1)));
}

export function hasContextualSHead(tokens) {
  for (let index = 0; index < (tokens?.length ?? 0); index += 1) {
    if (isContextualSHeadAt(tokens, index)) return true;
  }
  return false;
}

function unresolved(reason, evidence = null) {
  return { status: 'UNRESOLVED', reason, evidence };
}

function parseExpanded(tokens, start) {
  const subject = tokenValue(tokens, start);
  const auxiliary = tokenValue(tokens, start + 1);
  if (!SUBJECTS.has(subject) || !['is', 'has'].includes(auxiliary)) return null;

  const next = tokenValue(tokens, start + 2);
  if (next === 'not') return unresolved('negative-scope-excluded', { subject, auxiliary, next });
  if (next === 'got') return unresolved('got-construction-excluded', { subject, auxiliary, next });

  if (auxiliary === 'is') {
    if (PROGRESSIVE_PARTICIPLES.has(next)) {
      return {
        status: 'PARSED', subject, auxiliary, patternId: 'asr09c-is-progressive',
        participle: next, evidenceTokens: [subject, auxiliary, next],
      };
    }
    return unresolved(next == null ? 'progressive-evidence-missing' : 'is-complement-not-approved', {
      subject, auxiliary, next,
    });
  }

  if (next !== 'been') {
    return unresolved(next == null ? 'perfect-progressive-evidence-missing' : 'has-without-been-excluded', {
      subject, auxiliary, next,
    });
  }
  const participle = tokenValue(tokens, start + 3);
  if (!PROGRESSIVE_PARTICIPLES.has(participle)) {
    return unresolved(participle == null ? 'progressive-evidence-missing' : 'participle-not-approved', {
      subject, auxiliary, next, participle,
    });
  }
  return {
    status: 'PARSED', subject, auxiliary, patternId: 'asr09c-has-been-progressive',
    participle, evidenceTokens: [subject, auxiliary, next, participle],
  };
}

function parseContracted(tokens, start) {
  const contracted = tokenValue(tokens, start);
  const subject = CONTRACTED_SUBJECTS.get(contracted);
  if (!subject) return null;

  const next = tokenValue(tokens, start + 1);
  if (next === 'not') return unresolved('negative-scope-excluded', { subject, contracted, next });
  if (next === 'got') return unresolved('got-construction-excluded', { subject, contracted, next });
  if (next === 'been') {
    const participle = tokenValue(tokens, start + 2);
    if (!PROGRESSIVE_PARTICIPLES.has(participle)) {
      return unresolved(participle == null ? 'progressive-evidence-missing' : 'participle-not-approved', {
        subject, contracted, next, participle,
      });
    }
    return {
      status: 'PARSED', subject, auxiliary: 'has', patternId: 'asr09c-has-been-progressive',
      participle, evidenceTokens: [contracted, next, participle],
    };
  }
  if (PROGRESSIVE_PARTICIPLES.has(next)) {
    return {
      status: 'PARSED', subject, auxiliary: 'is', patternId: 'asr09c-is-progressive',
      participle: next, evidenceTokens: [contracted, next],
    };
  }
  return unresolved(next == null ? 'progressive-evidence-missing' : 'complement-not-approved', {
    subject, contracted, next,
  });
}

function isUnresolved(result) {
  return result?.status === 'UNRESOLVED';
}

/**
 * Resolve only the ASR-09A ambiguous-s subset that has a bounded, independent
 * parse on each complete input sequence. No text is synthesized across ranks
 * or segments; callers pass the one selected hypothesis they are scoring.
 */
export function resolveContextualGrammaticalEquivalence({
  expectedTokens = [],
  observedTokens = [],
  expectedStart = 0,
  observedStart = 0,
  mode = '',
  referenceContext = null,
  recognitionProvenance = null,
} = {}) {
  const expectedExpanded = parseExpanded(expectedTokens, expectedStart);
  const expectedContracted = parseContracted(expectedTokens, expectedStart);
  const observedExpanded = parseExpanded(observedTokens, observedStart);
  const observedContracted = parseContracted(observedTokens, observedStart);

  const expectedParse = expectedExpanded || expectedContracted;
  const observedParse = observedExpanded || observedContracted;
  const hasCandidate = !!expectedParse || !!observedParse;
  if (!hasCandidate) return { status: 'NO_MATCH' };

  if (!ALLOWED_MODES.has(String(mode))) {
    return unresolved('mode-not-authorized', { mode: String(mode || '') });
  }
  if (!expectedParse || !observedParse
    || isUnresolved(expectedParse) || isUnresolved(observedParse)) {
    return unresolved('complete-unique-parse-not-established', {
      expected: expectedParse?.evidence ?? expectedParse,
      observed: observedParse?.evidence ?? observedParse,
    });
  }
  if (expectedParse.subject !== observedParse.subject
    || expectedParse.auxiliary !== observedParse.auxiliary
    || expectedParse.patternId !== observedParse.patternId
    || expectedParse.participle !== observedParse.participle) {
    return unresolved('independent-parses-disagree', {
      expected: expectedParse,
      observed: observedParse,
    });
  }

  const expectedLength = expectedContracted ? 1 : 2;
  const observedLength = observedContracted ? 1 : 2;
  if (expectedLength === observedLength) return { status: 'NO_MATCH' };

  const selectedAuxiliary = expectedParse.auxiliary;
  const ruleId = expectedParse.patternId;
  const contextualGrammarEvidence = {
    patternId: ruleId,
    subject: expectedParse.subject,
    contractedSurface: `${expectedParse.subject}'s`,
    selectedAuxiliary,
    participle: expectedParse.participle,
    expectedParse: expectedParse.evidenceTokens,
    observedParse: observedParse.evidenceTokens,
    independentParseAgreement: true,
    permittedMode: String(mode),
    referenceContextProvided: referenceContext != null,
    recognitionProvenanceProvided: recognitionProvenance != null,
  };

  return {
    status: 'MATCH',
    authority: 'grammatical-variant',
    expectedLength,
    observedLength,
    expectedTokenSpan: { start: expectedStart, length: expectedLength },
    observedTokenSpan: { start: observedStart, length: observedLength },
    selectedAuxiliary,
    ruleId,
    ruleKind: 'contextual-grammatical-equivalence',
    decisionId: 'ambiguous-s',
    authorityTier: 'grammatical-variant',
    displayPolicy: 'raw',
    contextualGrammarEvidence,
  };
}
