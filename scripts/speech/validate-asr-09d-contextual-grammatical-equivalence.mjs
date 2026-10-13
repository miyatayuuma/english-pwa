import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppVersionAtLeast } from './appVersionBoundary.js';
import { grammaticalEquivalenceRules } from './grammaticalEquivalenceRules.js';
import { ASR09C_CONTEXTUAL_PATTERNS } from './contextualGrammaticalEquivalence.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const audit = path.join(ROOT, 'data/audits/asr-09d-contextual-grammatical-equivalence');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const manifest = read('data/audits/asr-09d-contextual-grammatical-equivalence/manifest.json');
const reconciliation = read('data/audits/asr-09d-contextual-grammatical-equivalence/corpus-reconciliation.json');
const patterns = read('data/audits/asr-09d-contextual-grammatical-equivalence/approved-patterns.json');
const negatives = read('data/audits/asr-09d-contextual-grammatical-equivalence/negative-controls.json').negativeControls;
const positives = read('tests/fixtures/asr09d-positive-controls.json').positiveControls;
const currentVersion = fs.readFileSync(path.join(ROOT, 'scripts/version.js'), 'utf8').match(/APP_VERSION\s*=\s*'(v\d+\.\d+)'/)?.[1];
const context = mode => ({ context: { mode } });

assert.equal(manifest.source.productionBaselineMainSha, '1e613b1020d77031e1d7f59ed342c416867da383');
assert.equal(manifest.source.asr09aAuditBaselineMainSha, 'e1b56da18e0df1d583473a6f208a75333bd22969');
assert.equal(manifest.source.asr09aDecisionId, 'ambiguous-d');
assert.equal(manifest.source.asr09aDisposition, 'CONTEXT_CONDITIONAL');
assert.equal(manifest.source.implementationVersionBoundary, 'v5.104');
assert.ok(isAppVersionAtLeast(currentVersion, 'v5.104'), `current APP_VERSION ${currentVersion} must not precede implementation boundary`);
assert.equal(manifest.source.currentAppVersion, currentVersion);
assert.deepEqual(patterns.allowedModes, ['vocabulary', 'correction']);
assert.deepEqual(patterns.excludedModes, ['read', 'cloze']);
assert.deepEqual(patterns.subjects, ['i', 'you', 'he', 'she', 'it', 'we', 'they']);
assert.equal(patterns.patterns.length, 2, 'only initial A/B patterns are production-approved');
assert.deepEqual(patterns.patterns.map(row => row.patternId), ['asr09d-had-past-participle', 'asr09d-would-base-verb']);
assert.equal(reconciliation.total, 18);
assert.equal(reconciliation.candidates.length, 18);
assert.deepEqual(reconciliation.statusCounts, manifest.reconciliation.statusCounts);
assert.equal(Object.values(reconciliation.statusCounts).reduce((sum, count) => sum + count, 0), 18);
assert.ok(reconciliation.candidates.every(row => row.status && row.minimalCounterexample && row.decisionReason));
assert.ok(reconciliation.candidates.every(row => row.sourceJoin.exactFieldSurface && row.sourceJoin.exactHistoricalSpan));
assert.equal(manifest.productionScope.asr09bFixedDirectionCount, 66);
assert.equal(manifest.productionScope.asr09cPatternsRetained, 2);
assert.equal(manifest.productionScope.readClozeContextualRules, 0);
assert.equal(grammaticalEquivalenceRules.length, 66);
assert.equal(ASR09C_CONTEXTUAL_PATTERNS.length, 2);

for (const fixture of positives) {
  for (const mode of ['vocabulary', 'correction']) {
    for (const [expected, observed] of [[fixture.expected, fixture.observed], [fixture.observed, fixture.expected]]) {
      const match = findSpeechSurfaceMatch(expected, observed, context(mode));
      assert.equal(match?.decisionId, 'ambiguous-d', fixture.id);
      assert.equal(match?.authorityTier, 'grammatical-variant', fixture.id);
      assert.equal(match?.selectedAuxiliary, fixture.selectedAuxiliary, fixture.id);
      assert.equal(match?.independentParseAgreement, true, fixture.id);
    }
  }
}
for (const fixture of negatives) {
  for (const mode of ['vocabulary', 'correction']) {
    assert.equal(findSpeechSurfaceMatch(fixture.expected, fixture.observed, context(mode)), null, `${fixture.id} ${mode}`);
  }
}
for (const mode of ['read', 'cloze']) {
  assert.equal(findSpeechSurfaceMatch('I had eaten.', "I'd eaten.", context(mode)), null);
  assert.equal(findSpeechSurfaceMatch('I would go.', "I'd go.", context(mode)), null);
  assert.equal(findSpeechSurfaceMatch('I am ready.', "I'm ready.", context(mode))?.decisionId, 'fixed-be-have-will');
  assert.equal(findSpeechSurfaceMatch('He is working.', "He's working.", context(mode)), null);
}

const performance = manifest.performance;
assert.equal(performance.baselineRevision, '1e613b1020d77031e1d7f59ed342c416867da383');
assert.match(performance.candidateRevision, /^[0-9a-f]{40}$/u);
assert.equal(performance.method.trials, 31);
assert.deepEqual(performance.metricNames, ['p50MsPerCall', 'p95MsPerCall']);
for (const row of performance.workloads) {
  assert.ok(row.baseline.p50MsPerCall > 0 && row.candidate.p50MsPerCall > 0, `${row.workload} has P50 timings`);
  assert.ok(row.baseline.p95MsPerCall > 0 && row.candidate.p95MsPerCall > 0, `${row.workload} has P95 timings`);
  assert.ok(row.p50DeltaPct <= 20, `${row.workload} P50 regression is bounded: ${row.p50DeltaPct}%`);
  assert.ok(row.p95DeltaPct <= 35, `${row.workload} P95 regression is bounded: ${row.p95DeltaPct}%`);
}

const generated = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts/speech/build-asr-09d-contextual-grammatical-equivalence.mjs'), '--check',
], { cwd: ROOT, encoding: 'utf8' });
assert.equal(generated.status, 0, `${generated.stdout}${generated.stderr}`);
console.log(`ASR-09D production authority PASS: ${reconciliation.total}/18 candidates; ${JSON.stringify(reconciliation.statusCounts)}; ${positives.length} positive contexts bidirectionally; ${negatives.length} negative controls; APP_VERSION ${currentVersion}.`);
