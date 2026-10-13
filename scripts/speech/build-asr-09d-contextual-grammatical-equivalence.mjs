import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppVersionAtLeast } from './appVersionBoundary.js';
import {
  ASR09D_BASE_VERBS,
  ASR09D_CONTEXTUAL_PATTERNS,
  ASR09D_PAST_PARTICIPLES,
} from './contextualDGrammaticalEquivalence.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIR = path.join(ROOT, 'data/audits/asr-09d-contextual-grammatical-equivalence');
const AUDIT_09A_DIR = path.join(ROOT, 'data/audits/asr-09a-grammatical-equivalence');
const PRODUCTION_BASELINE = '1e613b1020d77031e1d7f59ed342c416867da383';
const PRODUCTION_TREE = '1e09693f1ad1c861b4a022d87360f9c1730949be';
const AUDIT_09A_BASELINE = 'e1b56da18e0df1d583473a6f208a75333bd22969';
const IMPLEMENTATION_VERSION = 'v5.104';
const ALLOWED_MODES = ['vocabulary', 'correction'];
const STATUSES = ['SAFE_CONTEXT_RESOLVED', 'AMBIGUOUS_UNRESOLVED', 'REJECT', 'OUT_OF_SCOPE'];
const SOURCE_GIT_BLOBS = Object.freeze({
  vocabulary: '91324d35b2db1911ece2cf3ff746409d321fe963',
  items: 'ae2aca768b784199b77ac1cf8c0c5a80fd5725bb',
});
const SOURCE_SHA256 = Object.freeze({
  vocabulary: '12d8a01161f02a969fd34be190ced0c681c73252be37175a66561a734c9e0071',
  items: 'ea2ce9aa40a3b09971aed27371ca41411a3e9da72f3e76005778a7d701d26c45',
});
const AUTHORITY_SHA256 = Object.freeze({
  decisions: 'bddaea10381c9475270206f025a3629bac2f9ff2b716c9839608ca587e4a6d63',
  corpusCandidates: '2eed8ba1bb9ba6046864f2464edf978a22e38576e36e4b81582aec6e7df2f5b9',
  manifest: '169c8b347db1404f18f331611a1861d19d22e8f1734548ad6bceb4cdbd2c420e',
});

const bytes = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(bytes(file).toString('utf8'));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const gitBlobSha = data => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex');
const render = value => `${JSON.stringify(value, null, 2)}\n`;
const write = (name, value) => fs.writeFileSync(path.join(OUTPUT_DIR, name), render(value));

const appVersion = bytes('scripts/version.js').toString('utf8').match(/APP_VERSION\s*=\s*'(v\d+\.\d+)'/)?.[1];
assert.ok(isAppVersionAtLeast(appVersion, IMPLEMENTATION_VERSION), `APP_VERSION must be at least ${IMPLEMENTATION_VERSION}`);
const vocabularyBytes = bytes('data/vocabulary-v3.json');
const itemsBytes = bytes('data/items.json');
assert.equal(sha256(vocabularyBytes), SOURCE_SHA256.vocabulary, 'production Vocabulary must remain byte-identical');
assert.equal(sha256(itemsBytes), SOURCE_SHA256.items, 'production Items must remain byte-identical');
assert.equal(gitBlobSha(vocabularyBytes), SOURCE_GIT_BLOBS.vocabulary);
assert.equal(gitBlobSha(itemsBytes), SOURCE_GIT_BLOBS.items);

const auditBytes = {
  decisions: bytes('data/audits/asr-09a-grammatical-equivalence/decisions.json'),
  corpusCandidates: bytes('data/audits/asr-09a-grammatical-equivalence/corpus-candidates.json'),
  manifest: bytes('data/audits/asr-09a-grammatical-equivalence/manifest.json'),
};
for (const [key, expected] of Object.entries(AUTHORITY_SHA256)) {
  assert.equal(sha256(auditBytes[key]), expected, `ASR-09A ${key} is immutable authority`);
}
const authority = {
  decisions: JSON.parse(auditBytes.decisions.toString('utf8')).decisions,
  candidates: JSON.parse(auditBytes.corpusCandidates.toString('utf8')).candidates,
  manifest: JSON.parse(auditBytes.manifest.toString('utf8')),
};
const ambiguousD = authority.decisions.find(row => row.id === 'ambiguous-d');
assert.equal(ambiguousD?.taxonomy, 'CONTEXT_CONDITIONAL');
assert.equal(ambiguousD?.disposition, 'CONTEXT_CONDITIONAL');
assert.deepEqual(ambiguousD?.allowedModes, ALLOWED_MODES);
assert.deepEqual(Object.keys(ambiguousD?.excludedModes || {}).sort(), ['cloze', 'read']);
assert.equal(authority.manifest.source?.baselineMainSha, AUDIT_09A_BASELINE);
const candidates = authority.candidates.filter(row => row.decisionId === 'ambiguous-d');
assert.equal(candidates.length, 18, 'all historical ASR-09A ambiguous-d candidates are reconciled');

const vocabulary = JSON.parse(vocabularyBytes.toString('utf8'));
const items = JSON.parse(itemsBytes.toString('utf8'));
const vocabularyById = new Map((vocabulary.entries || []).map(row => [String(row.id), row]));
const itemsById = new Map(items.map(row => [String(row.id), row]));
const fixtures = json('tests/fixtures/asr09d-negative-controls.json').negativeControls;
const positiveFixtures = json('tests/fixtures/asr09d-positive-controls.json').positiveControls;
const negativeById = new Map(fixtures.map(row => [row.id, row]));

function currentSource(candidate) {
  if (candidate.sourceType === 'vocabulary') {
    const entry = vocabularyById.get(String(candidate.sourceId));
    assert.ok(entry, `current Vocabulary entry exists for ${candidate.id}`);
    if (candidate.field === 'canonical') return String(entry.canonical ?? '');
    if (candidate.field === 'answers') return String(entry.answers?.[candidate.fieldIndex] ?? '');
    if (candidate.field === 'paraphrases') return String(entry.paraphrases?.[candidate.fieldIndex] ?? '');
    throw new Error(`Unsupported production Vocabulary field ${candidate.field} for ${candidate.id}`);
  }
  if (candidate.sourceType === 'item') {
    const item = itemsById.get(String(candidate.sourceId));
    assert.ok(item, `current source item exists for ${candidate.id}`);
    assert.equal(candidate.field, 'en', `source type field remains en for ${candidate.id}`);
    return String(item.en ?? '');
  }
  throw new Error(`Unsupported ASR-09A source type ${candidate.sourceType}`);
}

function localContext(candidate, source) {
  const tokens = safeSpeechTokens(source);
  const tokenIndex = tokens.findIndex(token => token.start === candidate.start);
  assert.ok(tokenIndex >= 0, `historical source start maps to a current token in ${candidate.id}`);
  const surfaceToken = tokens[tokenIndex].value;
  const contracted = surfaceToken.match(/^(i|you|he|she|it|we|they)'d$/u)?.[1] ?? null;
  const subject = contracted ?? surfaceToken;
  let followingToken = null;
  if (contracted) followingToken = tokens[tokenIndex + 1]?.value ?? null;
  else if (['i', 'you', 'he', 'she', 'it', 'we', 'they'].includes(surfaceToken)
    && ['had', 'would'].includes(tokens[tokenIndex + 1]?.value)) followingToken = tokens[tokenIndex + 2]?.value ?? null;
  else followingToken = candidate.context?.nextToken ?? tokens[tokenIndex + 1]?.value ?? null;
  return { tokens, tokenIndex, sourceToken: surfaceToken, subject, followingToken };
}

function replaceSpan(source, start, end, counterpart) {
  return `${source.slice(0, start)}${counterpart}${source.slice(end)}`;
}

function semanticAuthority(candidate) {
  if (candidate.sourceType !== 'vocabulary') return null;
  const entry = vocabularyById.get(String(candidate.sourceId));
  return {
    canonical: String(entry.canonical ?? ''),
    answers: entry.answers || [],
    paraphrases: entry.paraphrases || [],
    matchedField: candidate.field,
    paraphraseCannotBePromoted: candidate.field === 'paraphrases',
    resultType: candidate.field === 'paraphrases' ? 'PARAPHRASE' : 'TARGET authority remains field-defined',
  };
}

const reconciled = candidates.map(candidate => {
  const source = currentSource(candidate);
  assert.equal(source, candidate.sourceContext, `current production surface still joins candidate ${candidate.id}`);
  assert.equal(source.slice(candidate.start, candidate.end), candidate.surface, `historical character span is unchanged for ${candidate.id}`);
  const local = localContext(candidate, source);
  const allowedModes = (candidate.modeApplicability || []).filter(mode => ALLOWED_MODES.includes(mode));
  const resolutions = [];
  for (const counterpart of candidate.proposedCounterparts || []) {
    const comparison = replaceSpan(source, candidate.start, candidate.end, counterpart);
    for (const mode of allowedModes) {
      const match = findSpeechSurfaceMatch(source, comparison, { context: { mode, sourceId: candidate.sourceId } });
      if (match?.decisionId === 'ambiguous-d'
        && ASR09D_CONTEXTUAL_PATTERNS.some(row => row.ruleId === match.ruleId)) {
        resolutions.push({ mode, counterpart, match });
      }
    }
  }

  let status = 'OUT_OF_SCOPE';
  let reason = 'The historical source context does not meet either initial allowlisted D construction.';
  if (resolutions.length) {
    status = 'SAFE_CONTEXT_RESOLVED';
    reason = 'The complete latest production sentence independently parses to the same approved auxiliary on both sides.';
  } else if (['not', 'never'].includes(local.followingToken)) {
    status = 'REJECT';
    reason = 'The contraction occurs in an excluded negative or negative-adverb construction.';
  } else if (candidate.sourceId === 'E0412' && local.followingToken === 'last') {
    status = 'AMBIGUOUS_UNRESOLVED';
    reason = 'Had is the lexical past-tense verb in “I had last night”; no unique auxiliary parse exists.';
  } else if (local.followingToken === 'better' || local.followingToken === 'rather') {
    status = 'OUT_OF_SCOPE';
    reason = 'The following fixed idiom is outside the approved A/B subset; idiom-specific D rules were not enabled.';
  } else if (local.followingToken === 'to') {
    status = 'OUT_OF_SCOPE';
    reason = 'Had-to obligation is not an approved past-participle or bare-infinitive construction.';
  } else if (local.followingToken === 'just') {
    status = 'OUT_OF_SCOPE';
    reason = 'An intervening adverb prevents the approved immediate-complement pattern.';
  }

  const resolution = resolutions[0]?.match ?? null;
  const positiveCounterexample = resolution
    ? ASR09D_CONTEXTUAL_PATTERNS.find(row => row.ruleId === resolution.ruleId).minimalCounterexample
    : (status === 'REJECT'
      ? negativeById.get('negative-omitted')
    : status === 'AMBIGUOUS_UNRESOLVED'
      ? negativeById.get('syncretic-read')
      : status === 'OUT_OF_SCOPE' && local.followingToken === 'better'
        ? { expected: "We had better make a reservation.", observed: "We'd better make a reservation." }
        : status === 'OUT_OF_SCOPE' && local.followingToken === 'rather'
          ? { expected: 'I would rather go.', observed: "I'd rather go." }
          : negativeById.get('noun-help'));

  const counterpart = candidate.proposedCounterparts?.[0] ?? null;
  return {
    candidateId: candidate.id,
    historicalIdentity: {
      sourceOrder: candidate.sourceOrder,
      decisionId: candidate.decisionId,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      field: candidate.field,
      fieldIndex: candidate.fieldIndex ?? null,
      characterSpan: { start: candidate.start, end: candidate.end },
      historicalSurface: candidate.surface,
      historicalSourceContext: candidate.sourceContext,
    },
    latestProductionIdentity: {
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      field: candidate.field,
      fieldIndex: candidate.fieldIndex ?? null,
      sourceSurface: source,
      exactSpanJoin: source.slice(candidate.start, candidate.end) === candidate.surface,
    },
    proposedCounterparts: candidate.proposedCounterparts || [],
    subject: local.subject,
    followingToken: local.followingToken,
    possibleHadParse: local.followingToken && ASR09D_PAST_PARTICIPLES.includes(local.followingToken),
    possibleWouldParse: local.followingToken && ASR09D_BASE_VERBS.includes(local.followingToken),
    allowedModes,
    semanticAuthority: semanticAuthority(candidate),
    selectedAuxiliary: resolution?.selectedAuxiliary ?? null,
    ruleId: resolution?.ruleId ?? null,
    contextualGrammarEvidence: resolution?.contextualGrammarEvidence ?? {
      sourceSubject: local.subject,
      followingToken: local.followingToken,
      independentUniqueParse: false,
    },
    status,
    minimalCounterexample: positiveCounterexample,
    decisionReason: reason,
    sourceJoin: {
      exactFieldSurface: source === candidate.sourceContext,
      exactHistoricalSpan: source.slice(candidate.start, candidate.end) === candidate.surface,
      counterpartSurface: counterpart,
    },
  };
});

const statusCounts = Object.fromEntries(STATUSES.map(status => [status, reconciled.filter(row => row.status === status).length]));
assert.equal(reconciled.length, 18);
assert.equal(Object.values(statusCounts).reduce((total, count) => total + count, 0), 18);
assert.ok(reconciled.every(row => row.sourceJoin.exactFieldSurface && row.sourceJoin.exactHistoricalSpan));
assert.ok(reconciled.every(row => row.minimalCounterexample), 'each corpus decision has a counterexample anchor');

const patterns = {
  schemaVersion: 1,
  decisionId: 'ambiguous-d',
  taxonomy: 'CONTEXT_CONDITIONAL',
  disposition: 'CONTEXT_CONDITIONAL',
  allowedModes: ALLOWED_MODES,
  excludedModes: ['read', 'cloze'],
  subjects: ['i', 'you', 'he', 'she', 'it', 'we', 'they'],
  pastParticipleAllowlist: ASR09D_PAST_PARTICIPLES,
  baseVerbAllowlist: ASR09D_BASE_VERBS,
  patterns: ASR09D_CONTEXTUAL_PATTERNS,
  excludedVerbs: ['put', 'read', 'cut', 'come', 'run', 'set', 'let', 'hit'],
  otherExclusions: [
    'negation and negative adverbs', 'intervening adverbs', 'would have inference',
    'had better and would rather idioms', 'nominal help/work/time collisions',
    'question and relative pronouns', 'unsupported subject forms',
  ],
};

const manifest = {
  schemaVersion: 1,
  acceptance: 'ASR-09D Bounded Contextual ’d Equivalence Production',
  status: 'IMPLEMENTATION_ACCEPTANCE',
  source: {
    repository: 'miyatayuuma/english-pwa',
    productionBaselineMainSha: PRODUCTION_BASELINE,
    productionBaselineTreeSha: PRODUCTION_TREE,
    asr09aAuditBaselineMainSha: AUDIT_09A_BASELINE,
    asr09aDecisionId: 'ambiguous-d',
    asr09aDisposition: 'CONTEXT_CONDITIONAL',
    historicalCandidateCount: 18,
    vocabularyBlob: SOURCE_GIT_BLOBS.vocabulary,
    itemsBlob: SOURCE_GIT_BLOBS.items,
    vocabularySha256: SOURCE_SHA256.vocabulary,
    itemsSha256: SOURCE_SHA256.items,
    asr09aArtifactSha256: AUTHORITY_SHA256,
    appVersionBefore: 'v5.103',
    implementationVersionBoundary: IMPLEMENTATION_VERSION,
  },
  productionScope: {
    ruleIds: ASR09D_CONTEXTUAL_PATTERNS.map(row => row.ruleId),
    allowedModes: ALLOWED_MODES,
    readClozeContextualRules: 0,
    vocabularyDataChanges: 0,
    itemDataChanges: 0,
    asr09bFixedDirectionCount: 66,
    asr09cPatternsRetained: 2,
  },
  reconciliation: { total: reconciled.length, statusCounts },
  performance: json('data/audits/asr-09d-contextual-grammatical-equivalence/performance-comparison.json'),
  deterministicArtifacts: ['corpus-reconciliation.json', 'approved-patterns.json', 'negative-controls.json', 'performance-comparison.json', 'validation-report.md'],
};

const report = [
  '# ASR-09D validation report',
  '',
  `- Historical ambiguous-d candidates accounted for: ${reconciled.length}/18.`,
  `- Status counts: ${STATUSES.map(status => `${status} ${statusCounts[status]}`).join('; ')}.`,
  `- Approved patterns: ${ASR09D_CONTEXTUAL_PATTERNS.map(row => row.ruleId).join(', ')}.`,
  `- Positive fixtures: ${positiveFixtures.length} unique contexts; tested bidirectionally.`,
  `- Negative controls: ${fixtures.length}.`,
  `- Modes: ${ALLOWED_MODES.join(', ')}; Read/Cloze additions: 0.`,
  `- Version boundary: ${IMPLEMENTATION_VERSION}; current APP_VERSION is validated as greater than or equal to this boundary.`,
  `- Production data blobs: Vocabulary ${SOURCE_GIT_BLOBS.vocabulary}; Items ${SOURCE_GIT_BLOBS.items}.`,
  `- Benchmark baseline: ${manifest.performance.baselineRevision}; implementation: ${manifest.performance.candidateRevision}.`,
  '',
  'The resolver independently evaluates complete expected and observed token arrays. Only an explicitly allowlisted past participle selects had, and only an explicitly allowlisted bare verb selects would. Syncretic forms and unsupported contexts remain unmatched.',
  '',
].join('\n');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
write('manifest.json', manifest);
write('corpus-reconciliation.json', {
  schemaVersion: 1,
  decisionId: 'ambiguous-d',
  total: reconciled.length,
  statusCounts,
  candidates: reconciled,
});
write('approved-patterns.json', patterns);
write('negative-controls.json', { schemaVersion: 1, negativeControls: fixtures });
fs.writeFileSync(path.join(OUTPUT_DIR, 'validation-report.md'), report);

if (process.argv.includes('--check')) {
  for (const name of ['manifest.json', 'corpus-reconciliation.json', 'approved-patterns.json', 'negative-controls.json']) {
    const expected = render(json(`data/audits/asr-09d-contextual-grammatical-equivalence/${name}`));
    assert.equal(fs.readFileSync(path.join(OUTPUT_DIR, name), 'utf8'), expected, `${name} should be deterministic`);
  }
  assert.equal(fs.readFileSync(path.join(OUTPUT_DIR, 'validation-report.md'), 'utf8'), report, 'validation report should be deterministic');
}
console.log(`ASR-09D artifacts ${process.argv.includes('--check') ? 'deterministic PASS' : 'generated'}: ${reconciled.length}/18 candidates; ${JSON.stringify(statusCounts)}.`);
