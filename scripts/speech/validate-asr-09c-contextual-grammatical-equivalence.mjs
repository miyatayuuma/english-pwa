import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammaticalEquivalenceRules } from './grammaticalEquivalenceRules.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditDir = path.join(ROOT, 'data/audits/asr-09c-contextual-grammatical-equivalence');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const patterns = read('data/audits/asr-09c-contextual-grammatical-equivalence/approved-patterns.json');
const manifest = read('data/audits/asr-09c-contextual-grammatical-equivalence/manifest.json');
const reconciliation = read('data/audits/asr-09c-contextual-grammatical-equivalence/corpus-reconciliation.json');
const positives = read('tests/fixtures/asr09c-positive-controls.json').positiveControls;
const negatives = read('data/audits/asr-09c-contextual-grammatical-equivalence/negative-controls.json').negativeControls;
const context = mode => ({ context: { mode } });

assert.equal(manifest.source.productionBaselineMainSha, '09039633afd511bf7f76b47e74504fc491860991');
assert.equal(manifest.source.appVersionAfter, 'v5.103');
assert.equal(manifest.source.asr09aDecisionId, 'ambiguous-s');
assert.equal(manifest.source.asr09aDisposition, 'CONTEXT_CONDITIONAL');
assert.deepEqual(patterns.allowedModes, ['vocabulary', 'correction']);
assert.deepEqual(patterns.subjects, ['he', 'she', 'it']);
assert.equal(patterns.patterns.length, 2);
assert.equal(grammaticalEquivalenceRules.length, 66, 'ASR-09B fixed rules remain unchanged');
assert.equal(reconciliation.total, 107);
assert.deepEqual(reconciliation.statusCounts, {
  SAFE_CONTEXT_RESOLVED: 3,
  AMBIGUOUS_UNRESOLVED: 53,
  REJECT: 3,
  OUT_OF_SCOPE: 48,
});
assert.equal(reconciliation.candidates.length, 107);
assert.ok(reconciliation.candidates.every(row => row.counterexample));

for (const fixture of positives) {
  const match = findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(fixture.mode));
  assert.equal(match?.authority, 'grammatical-variant', `${fixture.id} uses the grammatical authority`);
  assert.equal(match?.decisionId, 'ambiguous-s', `${fixture.id} retains the ASR-09A decision`);
  assert.equal(match?.authorityTier, 'grammatical-variant');
  assert.equal(match?.ruleId, fixture.selectedAuxiliary === 'is'
    ? 'asr09c-is-progressive'
    : 'asr09c-has-been-progressive');
  assert.equal(match?.selectedAuxiliary, fixture.selectedAuxiliary);
  assert.equal(match?.contextualGrammarEvidence?.independentParseAgreement, true);
  assert.equal(match?.rawTranscript, fixture.observed);
  assert.equal(match?.alignment[0]?.expectedTokenIndexes.length, fixture.expected.includes("'s") || fixture.expected.includes('’s') ? 1 : 2);
  assert.equal(match?.alignment[0]?.observedTokenIndexes.length, fixture.observed.includes("'s") || fixture.observed.includes('’s') ? 1 : 2);
}

for (const fixture of negatives) {
  for (const mode of fixture.modes || ['vocabulary', 'correction']) {
    assert.equal(findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(mode)), null, `${fixture.id} in ${mode}`);
  }
}

for (const mode of ['read', 'cloze']) {
  assert.equal(findSpeechSurfaceMatch('I am ready.', "I'm ready.", context(mode))?.decisionId, 'fixed-be-have-will', `ASR-09B remains active in ${mode}`);
  assert.equal(findSpeechSurfaceMatch('He is working.', "He's working.", context(mode)), null, `ASR-09C stays isolated from ${mode}`);
}

const generated = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts/speech/build-asr-09c-contextual-grammatical-equivalence.mjs'),
  '--check',
], { cwd: ROOT, encoding: 'utf8' });
assert.equal(generated.status, 0, `${generated.stdout}${generated.stderr}`);
console.log(`ASR-09C authority PASS: ${positives.length} bidirectional positive controls; ${negatives.length} negative controls; 107 source-joined candidates; 66 ASR-09B rules retained.`);
