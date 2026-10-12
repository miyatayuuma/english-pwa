import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { canonicalTokens } from '../scripts/utils/text.js';
import { safeSpeechTokens } from '../scripts/speech/safeSpeechNormalization.js';
import { findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { speechEquivalenceRules } from '../scripts/speech/speechEquivalenceRules.js';
import { validateAudit, validateClosureEvidence } from '../scripts/speech/validate-asr-09a-grammatical-equivalence-audit.mjs';

const auditDir = new URL('../data/audits/asr-09a-grammatical-equivalence/', import.meta.url);
async function readJson(name) { return JSON.parse(await readFile(new URL(name, auditDir), 'utf8')); }

test('ASR-09A corpus candidates join exact source spans and frozen production authority', () => {
  const result = validateAudit();
  assert.equal(result.candidates, 529);
  assert.ok(result.decisions >= 15);
  assert.ok(result.positive >= 10);
  assert.ok(result.negative >= 15);
});

test('requested contraction inventory includes ambiguous, negative, and corpus-discovered families', async () => {
  const inventory = await readJson('inventory.json');
  const pairs = new Set(inventory.requestedClasses.map(row => `${row.expansion}|${row.form}`.replace(/[‘’‛ʼ＇]/gu, "'")));
  for (const pair of [
    "he is|he's", "he has|he's", "I would|I'd", "I had|I'd",
    "do not|don't", "cannot|can't", "will not|won't", "let us|let's",
    "am not (first-person tag)|aren't I", "its|it's", "your|you're", "were|we're",
  ]) assert.ok(pairs.has(pair), pair);
  assert.ok(inventory.corpusDiscoveredForms.some(row => row.form === "someone's"));
  assert.ok(inventory.corpusDiscoveredForms.some(row => row.form === "how's"));
  assert.ok(inventory.ambiguities.some(row => row.form === "'s"));
  assert.ok(inventory.ambiguities.some(row => row.form === "'d"));
});

test('grammar controls keep safe pairs apart from polarity, auxiliary, scope, and ranking failures', async () => {
  const fixtures = await readJson('regression-fixtures.json');
  const pos = new Map(fixtures.positiveControls.map(row => [row.id, row]));
  const neg = new Map(fixtures.negativeControls.map(row => [row.id, row]));
  assert.equal(pos.get('p-negative-do').expectedResult, 'SAFE_EQUIVALENCE');
  assert.equal(pos.get('p-d-had').expectedResult, 'CONTEXT_CONDITIONAL');
  assert.equal(pos.get('p-arent-i-tag').expectedResult, 'CONTEXT_CONDITIONAL');
  assert.equal(neg.get('n-drop-negation').expectedResult, 'REJECT');
  assert.equal(neg.get('n-have-be').expectedResult, 'REJECT');
  assert.equal(neg.get('n-can-not-scope').expectedResult, 'UNRESOLVED');
  assert.equal(neg.get('n-cross-rank-synthesis').expectedResult, 'REJECT');
  assert.equal(neg.get('n-paraphrase-not-target').requiredProperty, 'never promote to TARGET');
  assert.equal(fixtures.modeExpectations.read.includes('listed complete grammatical-variant spans'), true);
  assert.equal(fixtures.modeExpectations.cloze.includes('preservesExpectedNegation'), true);
  const manifest = await readJson('manifest.json');
  assert.equal(manifest.repositoryClosure.status, 'CLOSED');
  assert.equal(manifest.repositoryClosure.blocker, null);
  assert.equal(manifest.repositoryClosure.resolution.tdUnresolvedDrift, 0);
  assert.equal(manifest.repositoryClosure.implementationAuthority, 'ASR-09B_READY');
  assert.ok(manifest.candidateAccounting.byModeTreatment.vocabulary.SAFE_EQUIVALENCE > 0);
  assert.ok(manifest.candidateAccounting.byModeTreatment.correction.SAFE_EQUIVALENCE > 0);
  assert.ok(manifest.candidateAccounting.byModeTreatment.read.SAFE_EQUIVALENCE > 0);
  assert.ok(manifest.candidateAccounting.byModeTreatment.cloze.SAFE_EQUIVALENCE > 0);
  assert.equal((await readJson('decisions.json')).decisions.find(row => row.id === 'fixed-be-have-will').authorityTier, 'grammatical-variant');
});

test('ASR tokenization preserves apostrophe and word boundaries while legacy generic tokens collide', () => {
  assert.deepEqual(safeSpeechTokens("we’re").map(token => token.value), ["we're"]);
  assert.deepEqual(safeSpeechTokens('were').map(token => token.value), ['were']);
  assert.deepEqual(safeSpeechTokens('we are').map(token => token.value), ['we', 'are']);
  assert.deepEqual(canonicalTokens("we’re"), canonicalTokens('were'));
  assert.notDeepEqual(canonicalTokens('we are'), canonicalTokens('were'));
});

test('ASR-09A records expansion as future audit authority without changing the production equivalence table', async () => {
  const fixtures = await readJson('regression-fixtures.json');
  assert.equal(findSpeechSurfaceMatch('I am ready.', 'I’m ready.', { context: { mode: 'read' } }), null);
  assert.ok(speechEquivalenceRules.some(rule => rule.id === 'than-then'));
  assert.ok(speechEquivalenceRules.some(rule => rule.id === 'their-there'));
  assert.ok(speechEquivalenceRules.some(rule => rule.id === 'birthrate-birth-rate'));
  assert.equal(fixtures.modeExpectations.read.includes('Never synthesize content words'), true);
  assert.equal(fixtures.modeExpectations.cloze.includes('complete hidden target is reproduced in place'), true);
});

test('ASR-09A repository closure evidence is pinned to the 36-record T/D repair and merged PRs', async () => {
  const manifest = await readJson('manifest.json');
  const td = JSON.parse(await readFile(new URL('../data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json', import.meta.url), 'utf8'));
  validateClosureEvidence(manifest.repositoryClosure, td);
  assert.equal(manifest.source.baselineMainSha, 'e1b56da18e0df1d583473a6f208a75333bd22969');
  assert.equal(manifest.source.appVersion, 'v5.101');
  assert.equal(manifest.candidateAccounting.total, 529);
  const fixtures = await readJson('regression-fixtures.json');
  assert.equal(fixtures.positiveControls.length, 43);
  assert.equal(fixtures.negativeControls.length, 38);
  const bad = structuredClone(manifest.repositoryClosure);
  bad.status = 'BLOCKED_REQUIRED_VALIDATION';
  bad.blocker = { auditCandidateId: 'tdc-00002' };
  assert.throws(() => validateClosureEvidence(bad, td));
  for (const mutation of [
    value => { value.resolution.tdValidatorRepairMergeSha = '0'.repeat(40); },
    value => { value.resolution.tdUnresolvedDrift = 1; },
    value => { value.resolution.tdReconciliationBlobSha = '0'.repeat(40); },
    value => { value.resolution.asr09aAuditMergeSha = '0'.repeat(40); },
  ]) {
    const value = structuredClone(manifest.repositoryClosure);
    mutation(value);
    assert.throws(() => validateClosureEvidence(value, td));
  }
  const corruptedTd = structuredClone(td);
  corruptedTd.records.find(row => row.audit_candidate_id === 'tdc-00002').current.current_index = 0;
  assert.throws(() => validateClosureEvidence(manifest.repositoryClosure, corruptedTd));
  const missingCollision = structuredClone(td);
  missingCollision.records.find(row => row.audit_candidate_id === 'tdc-00007').collision.accepted = false;
  assert.throws(() => validateClosureEvidence(manifest.repositoryClosure, missingCollision));
});

test('ASR-09A deterministic generator detects stored artifact drift', () => {
  const script = new URL('../scripts/speech/build-asr-09a-grammatical-equivalence-audit.mjs', import.meta.url);
  const check = spawnSync(process.execPath, [script.pathname, '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /PASS \(7 files; 529 corpus candidates\)/);
});
