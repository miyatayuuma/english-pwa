import { safeSpeechTokens } from './safeSpeechNormalization.js';
import { speechEquivalenceRules } from './speechEquivalenceRules.js';
import { grammaticalEquivalenceRules } from './grammaticalEquivalenceRules.js';
import {
  isContextualSHeadAt,
  resolveContextualGrammaticalEquivalence,
} from './contextualGrammaticalEquivalence.js';

function scopeAllows(rule, context = {}) {
  const scope = rule?.scope || { type: 'global' };
  if (scope.type === 'global') return true;
  if (scope.type === 'entry') {
    return (scope.entryIds || []).includes(String(context.entryId || ''))
      && (!scope.mode || scope.mode === String(context.mode || ''));
  }
  if (scope.type === 'mode') return (scope.modes || []).includes(String(context.mode || ''));
  if (scope.type === 'provider') return (scope.providers || []).includes(String(context.provider || ''));
  return false;
}

const compiledRules = speechEquivalenceRules.map(rule => ({
  ...rule,
  expectedTokens: safeSpeechTokens(rule.expected).map(token => token.value),
  recognizedTokens: safeSpeechTokens(rule.recognized).map(token => token.value),
}));

const compiledGrammaticalRules = grammaticalEquivalenceRules.map(rule => ({
  ...rule,
  expectedTokens: safeSpeechTokens(rule.expected).map(token => token.value),
  recognizedTokens: safeSpeechTokens(rule.recognized).map(token => token.value),
}));

function spanEquals(tokens, start, expected) {
  if (!expected.length || start < 0 || start + expected.length > tokens.length) return false;
  return expected.every((value, offset) => tokens[start + offset].value === value);
}

export function resolveSpeechTokenSpan(expectedTokens, expectedStart, observedTokens, observedStart, context = {}) {
  const expected = expectedTokens[expectedStart];
  const observed = observedTokens[observedStart];
  if (!expected || !observed) return null;
  if (expected.value === observed.value) {
    return {
      expectedLength: 1,
      observedLength: 1,
      authority: 'exact',
      ruleId: null,
      ruleKind: null,
      displayPolicy: 'raw',
    };
  }

  for (const rule of compiledRules) {
    if (rule.credit !== 'exact-equivalent' || !scopeAllows(rule, context)) continue;
    const ruleExpected = rule.expectedTokens;
    const ruleRecognized = rule.recognizedTokens;
    if (!spanEquals(expectedTokens, expectedStart, ruleExpected)
      || !spanEquals(observedTokens, observedStart, ruleRecognized)) continue;
    return {
      expectedLength: ruleExpected.length,
      observedLength: ruleRecognized.length,
      authority: 'explicit-equivalence',
      ruleId: rule.id,
      ruleKind: rule.kind,
      displayPolicy: rule.display,
      authorityTier: rule.authorityTier ?? null,
      decisionId: rule.decisionId ?? null,
    };
  }
  for (const rule of compiledGrammaticalRules) {
    if (rule.credit !== 'exact-equivalent' || !scopeAllows(rule, context)) continue;
    if (!spanEquals(expectedTokens, expectedStart, rule.expectedTokens)
      || !spanEquals(observedTokens, observedStart, rule.recognizedTokens)) continue;
    return {
      expectedLength: rule.expectedTokens.length,
      observedLength: rule.recognizedTokens.length,
      authority: 'grammatical-variant',
      authorityTier: rule.authorityTier,
      decisionId: rule.decisionId,
      ruleId: rule.id,
      ruleKind: rule.kind,
      displayPolicy: rule.display,
    };
  }
  if ((context.mode !== 'vocabulary' && context.mode !== 'correction')
    || (!isContextualSHeadAt(expectedTokens, expectedStart)
      && !isContextualSHeadAt(observedTokens, observedStart))) return null;
  const contextual = resolveContextualGrammaticalEquivalence({
    expectedTokens,
    observedTokens,
    expectedStart,
    observedStart,
    mode: context.mode,
    referenceContext: context.referenceContext ?? context,
    recognitionProvenance: context.recognitionProvenance ?? null,
  });
  if (contextual.status === 'MATCH') return contextual;
  return null;
}
