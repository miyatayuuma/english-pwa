import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammaticalEquivalenceRules, GRAMMATICAL_EQUIVALENCE_DECISIONS, GRAMMATICAL_EQUIVALENCE_PAIR_COUNT } from './grammaticalEquivalenceRules.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditDir = path.join(ROOT, 'data/audits/asr-09a-grammatical-equivalence');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));
const decisions = read('decisions.json').decisions;
const inventory = read('inventory.json');
const fixtures = read('regression-fixtures.json');
const MODES = ['vocabulary', 'read', 'cloze', 'correction'];
const byDecision = new Map(decisions.map(row => [row.id, row]));

assert.deepEqual([...GRAMMATICAL_EQUIVALENCE_DECISIONS].sort(), ['fixed-be-have-will', 'negative-fixed-pair']);
assert.equal(GRAMMATICAL_EQUIVALENCE_PAIR_COUNT, 33, 'only the audited 15 affirmative and 18 negative fixed pairs are compiled');
assert.equal(grammaticalEquivalenceRules.length, 66, 'every approved surface pair is bidirectional');
for (const id of GRAMMATICAL_EQUIVALENCE_DECISIONS) {
  const authority = byDecision.get(id);
  assert.equal(authority?.disposition, 'SAFE_EQUIVALENCE', `${id} is approved by ASR-09A`);
  assert.equal(authority?.authorityTier, 'grammatical-variant', `${id} remains distinct from explicit ASR equivalence`);
  assert.deepEqual(authority?.allowedModes, MODES, `${id} is shared only by the four grading modes`);
  assert.ok(inventory.ruleFamilies.some(row => row.id === id && row.disposition === 'SAFE_EQUIVALENCE'));
}

const pairKeys = new Set();
for (const rule of grammaticalEquivalenceRules) {
  assert.ok(GRAMMATICAL_EQUIVALENCE_DECISIONS.includes(rule.decisionId), `unexpected decision ${rule.decisionId}`);
  assert.equal(rule.authorityTier, 'grammatical-variant');
  assert.equal(rule.credit, 'exact-equivalent');
  assert.deepEqual(rule.scope, { type: 'mode', modes: MODES });
  pairKeys.add(rule.id);
  for (const mode of MODES) {
    const match = findSpeechSurfaceMatch(rule.expected, rule.recognized, { context: { mode } });
    assert.equal(match?.authority, 'grammatical-variant', `${rule.id} ${rule.direction} in ${mode}`);
    assert.equal(match?.authorityTier, 'grammatical-variant');
    assert.equal(match?.decisionId, rule.decisionId);
    assert.equal(match?.ruleId, rule.id);
    assert.equal(match?.rawTranscript, rule.recognized);
  }
}
assert.equal(pairKeys.size, 33);

const safeFixtures = fixtures.positiveControls.filter(row => GRAMMATICAL_EQUIVALENCE_DECISIONS.includes(row.decisionId));
assert.ok(safeFixtures.length >= 33, 'production tests must cover the audited SAFE fixture inventory');
for (const fixture of safeFixtures) {
  const modes = fixture.modes || [fixture.mode].filter(Boolean);
  for (const mode of modes) {
    const match = findSpeechSurfaceMatch(fixture.expected, fixture.observed, { context: { mode } });
    assert.equal(match?.authority, 'grammatical-variant', `${fixture.id} must use the approved rule in ${mode}`);
  }
}

const prohibited = decisions.filter(row => row.disposition !== 'SAFE_EQUIVALENCE').map(row => row.id);
for (const id of prohibited) {
  assert.equal(grammaticalEquivalenceRules.some(rule => rule.decisionId === id), false, `${id} is excluded`);
}
console.log(`ASR-09B rules PASS: ${GRAMMATICAL_EQUIVALENCE_PAIR_COUNT} approved pairs / ${grammaticalEquivalenceRules.length} directions; ${safeFixtures.length} SAFE fixtures; 4 modes.`);
