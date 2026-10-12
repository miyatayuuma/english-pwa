import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppVersionAtLeast } from './appVersionBoundary.js';
import {
  ASR09C_CONTEXTUAL_PATTERNS,
  ASR09C_PROGRESSIVE_PARTICIPLES,
} from './contextualGrammaticalEquivalence.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIR = path.join(ROOT, 'data/audits/asr-09c-contextual-grammatical-equivalence');
const AUDIT_09A_DIR = path.join(ROOT, 'data/audits/asr-09a-grammatical-equivalence');
const AUDIT_09A_BASELINE = 'e1b56da18e0df1d583473a6f208a75333bd22969';
const PRODUCTION_BASELINE = '09039633afd511bf7f76b47e74504fc491860991';
const ASR09C_IMPLEMENTATION_VERSION = 'v5.103';
const SOURCE_SHA256 = Object.freeze({
  vocabulary: '12d8a01161f02a969fd34be190ced0c681c73252be37175a66561a734c9e0071',
  items: 'ea2ce9aa40a3b09971aed27371ca41411a3e9da72f3e76005778a7d701d26c45',
});
const SOURCE_GIT_BLOBS = Object.freeze({
  vocabulary: '91324d35b2db1911ece2cf3ff746409d321fe963',
  items: 'ae2aca768b784199b77ac1cf8c0c5a80fd5725bb',
});
const AUDIT_SHA256 = Object.freeze({
  decisions: 'bddaea10381c9475270206f025a3629bac2f9ff2b716c9839608ca587e4a6d63',
  corpusCandidates: '2eed8ba1bb9ba6046864f2464edf978a22e38576e36e4b81582aec6e7df2f5b9',
  manifest: '169c8b347db1404f18f331611a1861d19d22e8f1734548ad6bceb4cdbd2c420e',
});
const ALLOWED_MODES = ['vocabulary', 'correction'];
const SUPPORTED_SUBJECTS = new Set(['he', 'she', 'it']);
const SAFE_STATUSES = [
  'SAFE_CONTEXT_RESOLVED',
  'AMBIGUOUS_UNRESOLVED',
  'REJECT',
  'OUT_OF_SCOPE',
];
const PERFORMANCE_MEASUREMENTS = Object.freeze([
  { workload: 'exact phrase', api: 'findSpeechSurfaceMatch', baselineMsPerCall: 0.021498, currentMsPerCall: 0.022124, deltaPct: 2.9, deltaMicroseconds: 0.63 },
  { workload: 'ASR-09B fixed pair', api: 'findSpeechSurfaceMatch', baselineMsPerCall: 0.011428, currentMsPerCall: 0.011598, deltaPct: 1.5, deltaMicroseconds: 0.17 },
  { workload: 'contextual ambiguous reject', api: 'findSpeechSurfaceMatch', baselineMsPerCall: 0.015302, currentMsPerCall: 0.015594, deltaPct: 1.9, deltaMicroseconds: 0.29 },
  { workload: 'exact phrase', api: 'alignSpeech', baselineMsPerCall: 0.730023, currentMsPerCall: 0.757591, deltaPct: 3.8, deltaMicroseconds: 27.57 },
  { workload: 'ASR-09B fixed pair', api: 'alignSpeech', baselineMsPerCall: 0.102277, currentMsPerCall: 0.107034, deltaPct: 4.7, deltaMicroseconds: 4.76 },
]);

const readBytes = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(readBytes(file).toString('utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitBlobSha = bytes => crypto.createHash('sha1')
  .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
  .digest('hex');
const renderJson = value => `${JSON.stringify(value, null, 2)}\n`;

const vocabularyBytes = readBytes('data/vocabulary-v3.json');
const itemsBytes = readBytes('data/items.json');
const vocabulary = JSON.parse(vocabularyBytes.toString('utf8'));
const items = JSON.parse(itemsBytes.toString('utf8'));
const auditFiles = {
  decisions: fs.readFileSync(path.join(AUDIT_09A_DIR, 'decisions.json')),
  corpusCandidates: fs.readFileSync(path.join(AUDIT_09A_DIR, 'corpus-candidates.json')),
  manifest: fs.readFileSync(path.join(AUDIT_09A_DIR, 'manifest.json')),
};
const decisions = JSON.parse(auditFiles.decisions.toString('utf8')).decisions;
const oldManifest = JSON.parse(auditFiles.manifest.toString('utf8'));
const oldCandidates = JSON.parse(auditFiles.corpusCandidates.toString('utf8')).candidates;
const newNegativeControls = readJson('tests/fixtures/asr09c-negative-controls.json');
const appVersion = readBytes('scripts/version.js').toString('utf8').match(/APP_VERSION\s*=\s*'(v\d+\.\d+)'/)?.[1];

assert.ok(isAppVersionAtLeast(appVersion, ASR09C_IMPLEMENTATION_VERSION),
  `Current APP_VERSION must be at least ${ASR09C_IMPLEMENTATION_VERSION} for ASR-09C grading.`);
assert.equal(oldManifest.source.baselineMainSha, AUDIT_09A_BASELINE, 'ASR-09A audit source baseline is immutable');
assert.equal(oldManifest.source.vocabularyBlob, SOURCE_GIT_BLOBS.vocabulary);
assert.equal(oldManifest.source.itemsBlob, SOURCE_GIT_BLOBS.items);
assert.equal(sha256(vocabularyBytes), SOURCE_SHA256.vocabulary, 'Vocabulary production data must remain unchanged');
assert.equal(sha256(itemsBytes), SOURCE_SHA256.items, 'Items production data must remain unchanged');
assert.equal(gitBlobSha(vocabularyBytes), SOURCE_GIT_BLOBS.vocabulary);
assert.equal(gitBlobSha(itemsBytes), SOURCE_GIT_BLOBS.items);
for (const [key, expected] of Object.entries(AUDIT_SHA256)) {
  assert.equal(sha256(auditFiles[key]), expected, `historical ASR-09A ${key} must remain byte-identical`);
}

const ambiguousDecision = decisions.find(row => row.id === 'ambiguous-s');
assert.equal(ambiguousDecision?.disposition, 'CONTEXT_CONDITIONAL');
assert.deepEqual(ambiguousDecision?.allowedModes, ALLOWED_MODES);
assert.deepEqual(ambiguousDecision?.excludedModes && Object.keys(ambiguousDecision.excludedModes).sort(), ['cloze', 'read']);
const candidates = oldCandidates.filter(row => row.decisionId === 'ambiguous-s');
assert.equal(candidates.length, 107, 'all historical ambiguous-s candidates must be reconciled');

const vocabularyEntries = new Map((vocabulary.entries || []).map(row => [String(row.id), row]));
const itemEntries = new Map(items.map(row => [String(row.id), row]));
function latestProductionSurface(candidate) {
  if (candidate.sourceType === 'vocabulary') {
    const entry = vocabularyEntries.get(String(candidate.sourceId));
    assert.ok(entry, `current Vocabulary entry exists for ${candidate.id}`);
    if (candidate.field === 'canonical') return String(entry.canonical ?? '');
    if (candidate.field === 'answers') return String(entry.answers?.[candidate.fieldIndex] ?? '');
    if (candidate.field === 'paraphrases') return String(entry.paraphrases?.[candidate.fieldIndex] ?? '');
    throw new Error(`Unsupported current Vocabulary field ${candidate.field} in ${candidate.id}`);
  }
  if (candidate.sourceType === 'item') {
    const item = itemEntries.get(String(candidate.sourceId));
    assert.ok(item, `current source Item exists for ${candidate.id}`);
    assert.equal(candidate.field, 'en', `source field remains English for ${candidate.id}`);
    return String(item.en ?? '');
  }
  throw new Error(`Unsupported ASR-09A source type ${candidate.sourceType} in ${candidate.id}`);
}

const patternById = new Map(ASR09C_CONTEXTUAL_PATTERNS.map(row => [row.ruleId, row]));
const negativeById = new Map(newNegativeControls.negativeControls.map(row => [row.id, row]));
function candidateHead(candidate, source) {
  const tokens = safeSpeechTokens(source);
  const index = tokens.findIndex(token => token.start === candidate.start);
  assert.ok(index >= 0, `candidate start aligns to a token in ${candidate.id}`);
  const token = tokens[index].value;
  const contractedSubject = token.match(/^(he|she|it)'s$/u)?.[1] ?? null;
  const subject = contractedSubject ?? token;
  let next = null;
  if (contractedSubject) next = tokens[index + 1]?.value ?? null;
  else if (SUPPORTED_SUBJECTS.has(token) && ['is', 'has'].includes(tokens[index + 1]?.value)) {
    next = tokens[index + 2]?.value ?? null;
  } else next = candidate.context?.nextToken ?? tokens[index + 1]?.value ?? null;
  return { tokens, index, token, subject, next };
}

function minimalCounterexample(status, local) {
  if (status === 'REJECT' && local.next === 'not') return negativeById.get('negative-is-not');
  if (status === 'REJECT' && local.next === 'got') return negativeById.get('got-possession');
  if (status === 'OUT_OF_SCOPE') return negativeById.get('there-subject-out-of-scope');
  if (status === 'SAFE_CONTEXT_RESOLVED') return null;
  if (local.subject === 'he' && /finished/iu.test(local.token)) return negativeById.get('finished-is-ambiguous');
  return negativeById.get('unapproved-ing-form');
}

const reconciled = candidates.map(candidate => {
  const current = latestProductionSurface(candidate);
  assert.equal(current, candidate.sourceContext, `candidate context still joins current production in ${candidate.id}`);
  assert.equal(current.slice(candidate.start, candidate.end), candidate.surface, `candidate span still joins in ${candidate.id}`);

  const eligibleModes = (candidate.modeApplicability || []).filter(mode => ALLOWED_MODES.includes(mode));
  const resolutions = [];
  for (const counterpart of candidate.proposedCounterparts || []) {
    const variant = `${current.slice(0, candidate.start)}${counterpart}${current.slice(candidate.end)}`;
    for (const mode of eligibleModes) {
      const match = findSpeechSurfaceMatch(current, variant, { context: { mode, sourceId: candidate.sourceId } });
      if (match?.decisionId === 'ambiguous-s'
        && patternById.has(match.ruleId)
        && ['is', 'has'].includes(match.selectedAuxiliary)) {
        resolutions.push({
          mode,
          counterpart,
          selectedAuxiliary: match.selectedAuxiliary,
          ruleId: match.ruleId,
          evidence: match.contextualGrammarEvidence,
        });
      }
    }
  }

  const local = candidateHead(candidate, current);
  let status;
  let reason;
  let resolution = null;
  if (resolutions.length) {
    status = 'SAFE_CONTEXT_RESOLVED';
    resolution = resolutions[0];
    reason = 'A proposed counterpart passes the bounded rule in an ASR-09A-authorized mode using the complete current production surface.';
  } else if (SUPPORTED_SUBJECTS.has(local.subject) && ['not', 'got'].includes(local.next)) {
    status = 'REJECT';
    reason = local.next === 'not'
      ? 'The candidate is inside an excluded negative-s construction.'
      : 'The candidate is inside an excluded got construction.';
  } else if (!eligibleModes.length || !SUPPORTED_SUBJECTS.has(local.subject)) {
    status = 'OUT_OF_SCOPE';
    reason = !eligibleModes.length
      ? 'This source occurrence has no mode authorized by the ambiguous-s audit decision.'
      : `Subject ${local.subject} is outside the initial he/she/it production subset.`;
  } else {
    status = 'AMBIGUOUS_UNRESOLVED';
    reason = 'The complete current context does not satisfy either allowlisted progressive parse, so no contextual equivalence is emitted.';
  }

  return {
    candidateId: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    field: candidate.field,
    fieldIndex: candidate.fieldIndex ?? null,
    expectedSurface: candidate.surface,
    sourceContext: current,
    counterpartCandidates: candidate.proposedCounterparts || [],
    allowedModes: eligibleModes,
    status,
    selectedAuxiliary: resolution?.selectedAuxiliary ?? null,
    contextEvidence: resolution?.evidence ?? {
      subject: local.subject,
      tokenAfterCandidate: local.next,
      uniqueParseEstablished: false,
    },
    requiredRule: resolution?.ruleId ?? null,
    counterexample: resolution
      ? patternById.get(resolution.ruleId).minimalCounterexample
      : minimalCounterexample(status, local),
    decisionReason: reason,
  };
});

const statusCounts = Object.fromEntries(SAFE_STATUSES.map(status => [status, reconciled.filter(row => row.status === status).length]));
assert.equal(Object.values(statusCounts).reduce((total, count) => total + count, 0), 107);
assert.ok(reconciled.every(row => row.counterexample), 'each ambiguous or excluded candidate carries a minimal counterexample');

const approvedPatterns = {
  schemaVersion: 1,
  decisionId: 'ambiguous-s',
  authorityTier: 'grammatical-variant',
  allowedModes: ALLOWED_MODES,
  subjects: [...SUPPORTED_SUBJECTS],
  progressiveParticipleAllowlist: ASR09C_PROGRESSIVE_PARTICIPLES,
  patterns: ASR09C_CONTEXTUAL_PATTERNS,
  exclusions: [
    'negative-s',
    'got constructions',
    'past participle and adjective readings',
    'possessive apostrophe-s',
    'subjects outside he/she/it',
    'read and cloze modes',
    'unlisted -ing forms',
  ],
};

const manifest = {
  schemaVersion: 1,
  audit: "ASR-09C Bounded Contextual 's Equivalence Production Acceptance",
  status: 'IMPLEMENTATION_ACCEPTANCE',
  source: {
    repository: 'miyatayuuma/english-pwa',
    productionBaselineMainSha: PRODUCTION_BASELINE,
    asr09aAuditBaselineMainSha: AUDIT_09A_BASELINE,
    asr09aDecisionId: 'ambiguous-s',
    asr09aDisposition: 'CONTEXT_CONDITIONAL',
    asr09aCorpusCandidateCount: 107,
    asr09aArtifactSha256: AUDIT_SHA256,
    vocabularyBlob: SOURCE_GIT_BLOBS.vocabulary,
    itemsBlob: SOURCE_GIT_BLOBS.items,
    vocabularySha256: SOURCE_SHA256.vocabulary,
    itemsSha256: SOURCE_SHA256.items,
    appVersionBefore: 'v5.102',
    appVersionAfter: ASR09C_IMPLEMENTATION_VERSION,
  },
  productionScope: {
    ruleIds: ASR09C_CONTEXTUAL_PATTERNS.map(row => row.ruleId),
    allowedModes: ALLOWED_MODES,
    readClozeContextualRules: 0,
    vocabularyDataChanges: 0,
    itemDataChanges: 0,
  },
  performance: {
    runtime: 'Node v24.19.0',
    methodology: 'One-process, seven paired alternating samples per workload after 1,800 warmup calls per implementation; per-call medians; baseline worktree vs current branch.',
    measurements: PERFORMANCE_MEASUREMENTS,
  },
  corpusReconciliation: {
    total: reconciled.length,
    statusCounts,
    acceptedCandidateIds: reconciled.filter(row => row.status === 'SAFE_CONTEXT_RESOLVED').map(row => row.candidateId),
  },
};

const corpusReconciliation = {
  schemaVersion: 1,
  source: {
    baselineMainSha: PRODUCTION_BASELINE,
    auditCandidateFile: 'data/audits/asr-09a-grammatical-equivalence/corpus-candidates.json',
    auditCandidateSha256: AUDIT_SHA256.corpusCandidates,
    currentVocabularyBlob: gitBlobSha(vocabularyBytes),
    currentItemsBlob: gitBlobSha(itemsBytes),
  },
  decisionId: 'ambiguous-s',
  total: reconciled.length,
  statusCounts,
  candidates: reconciled,
};

const performanceTable = `${PERFORMANCE_MEASUREMENTS.map(row => `| ${row.workload} | ${row.api} | ${row.baselineMsPerCall.toFixed(6)} | ${row.currentMsPerCall.toFixed(6)} | +${row.deltaPct}% (${row.deltaMicroseconds.toFixed(2)} μs) |`).join('\n')}`;

const report = `# ASR-09C Contextual 's Production Acceptance\n\n**Status: implementation acceptance inventory; browser and Android closure is tracked by the pull request checks.**\n\n## Authority and production boundary\n\n- Production baseline: \`${PRODUCTION_BASELINE}\`, APP_VERSION \`v5.102\`.\n- Immutable ASR-09A baseline: \`${AUDIT_09A_BASELINE}\`; decision \`ambiguous-s\` remains \`CONTEXT_CONDITIONAL\`.\n- ASR-09A decision, corpus-candidate, and manifest SHA-256 values are frozen in \`manifest.json\`.\n- Current Vocabulary and Items source blobs match the ASR-09A blobs exactly; this task changes neither corpus.\n- Contextual matching is limited to Vocabulary and Correction. Read/Cloze do not receive these rules; the ASR-09B fixed rules remain shared across all four modes.\n\n## Implemented patterns\n\n| Rule | Expansion | Contracted surface | Evidence required |\n|---|---|---|---|\n${ASR09C_CONTEXTUAL_PATTERNS.map(row => `| \`${row.ruleId}\` | ${row.expectedForm} | ${row.recognizedForm} | Same subject, pattern, and allowlisted participle independently parsed on both token sequences. |`).join('\n')}\n\nThe finite participle allowlist is: ${ASR09C_PROGRESSIVE_PARTICIPLES.map(value => `\`${value}\``).join(', ')}. A suffix match alone never grants credit. Negative \`'s not\`, \`'s got\`, adjective/past-participle, possessive, missing-context, and disagreement cases fail closed.\n\n## ASR-09A corpus reconciliation\n\nAll ${reconciled.length} candidates were joined against their current production source string and span, then tested against each recorded counterpart in the ASR-09A-authorized modes. The inventory is in \`corpus-reconciliation.json\`.\n\n| Disposition | Count |\n|---|---:|\n${SAFE_STATUSES.map(status => `| ${status} | ${statusCounts[status]} |`).join('\n')}\n\nAccepted candidate IDs: ${corpusReconciliation.candidates.filter(row => row.status === 'SAFE_CONTEXT_RESOLVED').map(row => `\`${row.candidateId}\``).join(', ') || 'none'}. Corpus discovery does not widen runtime scope.\n\n## Negative controls and validation\n\n\`negative-controls.json\` contains ${newNegativeControls.negativeControls.length} minimal counterexamples for ambiguity, unsupported morphology, negation, possessives, homophones, mode isolation, and malformed expansions. The production test also preserves TARGET/PARAPHRASE classification, raw transcript, Correction's practice-only behavior, N-best independence, attempt provenance, and 09B's fixed-pair coverage.\n\n## Performance\n\nA paired microbenchmark compared the baseline worktree with this branch on Node v24.19.0. Each workload used seven alternating samples after 1,800 warmup calls per implementation; the table shows per-call medians. The eligibility gate keeps the contextual resolver off exact matches and ordinary fixed-pair matches. Measured changes were below 5% in these workloads, with absolute increases of 0.17–0.63 microseconds per surface lookup and 4.76–27.57 microseconds per alignment.\n\n| Workload | API | Baseline ms/call | Current ms/call | Change |\n|---|---|---:|---:|---:|\n${performanceTable}\n\n## Required repository checks\n\nnpm run speech:validate-asr-09b, npm run speech:validate-td-cluster-before-to, npm run vocab:check-derived, npm run vocab:validate, npm test, ASR-09A validator and deterministic check, ASR-09C validator, Chromium browser tests, and Android build/lint/emulator CI.\n`;

const files = new Map([
  ['manifest.json', renderJson(manifest)],
  ['corpus-reconciliation.json', renderJson(corpusReconciliation)],
  ['approved-patterns.json', renderJson(approvedPatterns)],
  ['negative-controls.json', renderJson(newNegativeControls)],
  ['validation-report.md', report],
]);

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  for (const [name, expected] of files) {
    const actual = fs.readFileSync(path.join(OUTPUT_DIR, name), 'utf8');
    assert.equal(actual, expected, `${name} is stale; regenerate ASR-09C acceptance outputs`);
  }
  console.log(`ASR-09C deterministic check PASS: ${reconciled.length} current-source candidates; ${statusCounts.SAFE_CONTEXT_RESOLVED} bounded safe matches; ${newNegativeControls.negativeControls.length} controls.`);
} else {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [name, content] of files) fs.writeFileSync(path.join(OUTPUT_DIR, name), content);
  console.log(`ASR-09C acceptance inventory written: ${reconciled.length} candidates; ${JSON.stringify(statusCounts)}.`);
}
