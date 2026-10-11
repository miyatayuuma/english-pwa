import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIT_DIR = path.join(ROOT, 'data/audits/asr-09a-grammatical-equivalence');
const EXPECTED = {
  baselineMainSha: 'e1b56da18e0df1d583473a6f208a75333bd22969',
  appVersion: 'v5.101',
  vocabularyBlob: '91324d35b2db1911ece2cf3ff746409d321fe963',
  itemsBlob: 'ae2aca768b784199b77ac1cf8c0c5a80fd5725bb',
};
const TAXONOMIES = new Set(['ORTHOGRAPHIC_ASR_EQUIVALENCE', 'GRAMMATICAL_VARIANT', 'CONTEXT_CONDITIONAL', 'AMBIGUOUS', 'NOT_EQUIVALENT']);
const DISPOSITIONS = new Set(['SAFE_EQUIVALENCE', 'CONTEXT_CONDITIONAL', 'REJECT', 'UNRESOLVED']);

function read(name) { return JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, name), 'utf8')); }
function sha1GitBlob(file) {
  const data = fs.readFileSync(path.join(ROOT, file));
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex');
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function slots(text) {
  return [...String(text || '').matchAll(/\b(something|someone|somebody|somewhere|somehow|anything|anyone|anybody|anywhere|everything|everyone|everybody|everywhere|nothing|nobody|nowhere)\b/giu)]
    .map(match => match[0].toLocaleLowerCase('en-US'));
}
function slotSpans(text) {
  return [...String(text || '').matchAll(/\b(something|someone|somebody|somewhere|somehow|anything|anyone|anybody|anywhere|everything|everyone|everybody|everywhere|nothing|nobody|nowhere)\b/giu)]
    .map(match => ({ value: match[0].toLocaleLowerCase('en-US'), start: match.index, end: match.index + match[0].length }));
}

export function validateAudit() {
  const manifest = read('manifest.json');
  const inventory = read('inventory.json');
  const { candidates } = read('corpus-candidates.json');
  const { decisions } = read('decisions.json');
  const fixtures = read('regression-fixtures.json');
  const vocabulary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vocabulary-v3.json'), 'utf8')).entries;
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
  const vocabById = new Map(vocabulary.map(row => [String(row.id), row]));
  const itemById = new Map(items.map(row => [String(row.id), row]));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.audit, 'ASR-09A Grammatical Speech Equivalence Audit');
  assert.equal(manifest.status, 'CLOSED');
  assert.equal(manifest.implementationReady, true);
  assert.equal(manifest.repositoryClosure.status, 'BLOCKED_REQUIRED_VALIDATION');
  assert.equal(manifest.repositoryClosure.auditAuthorityStatus, 'CLOSED');
  assert.equal(manifest.repositoryClosure.implementationAuthority, 'ASR-09B_READY');
  assert.equal(manifest.repositoryClosure.blocker.command, 'npm run speech:validate-td-cluster-before-to');
  assert.equal(manifest.repositoryClosure.blocker.result, 'FAIL_BASELINE_SOURCE_REF_DRIFT');
  assert.equal(manifest.repositoryClosure.blocker.auditCandidateId, 'tdc-00002');
  assert.equal(manifest.repositoryClosure.blocker.auditedProductionMainSha, EXPECTED.baselineMainSha);
  assert.equal(manifest.source.baselineMainSha, EXPECTED.baselineMainSha);
  assert.equal(manifest.source.appVersion, EXPECTED.appVersion);
  assert.equal(manifest.source.vocabularyBlob, EXPECTED.vocabularyBlob);
  assert.equal(manifest.source.itemsBlob, EXPECTED.itemsBlob);
  assert.equal(sha1GitBlob('data/vocabulary-v3.json'), EXPECTED.vocabularyBlob);
  assert.equal(sha1GitBlob('data/items.json'), EXPECTED.itemsBlob);
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, 'data/vocabulary-v3.json'))), manifest.source.vocabularySha256);
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, 'data/items.json'))), manifest.source.itemsSha256);
  assert.equal(manifest.population.vocabularyEntries, 2478);
  assert.equal(manifest.population.uniqueVocabularyIds, 2478);
  assert.equal(manifest.population.itemSentences, 560);
  assert.equal(manifest.population.uniqueItemIds, 560);
  assert.equal(manifest.population.vocabularyOccurrences, 2481);
  assert.equal(manifest.population.joinedVocabularyOccurrences, 2481);
  assert.equal(manifest.integrity.occurrenceJoinErrors, 0);
  assert.equal(manifest.integrity.productionDataChanged, false);
  assert.equal(manifest.integrity.productionCodeChanged, false);
  assert.equal(manifest.source.japanesePromptAuditStatus, 'CLOSED');
  assert.equal(manifest.source.japanesePromptMaterializationStatus, 'MATERIALIZED');
  assert.equal(manifest.baselineIntegrity.entryIdsUnique, true);
  assert.equal(manifest.baselineIntegrity.itemIdsUnique, true);
  assert.equal(manifest.baselineIntegrity.productionAuthorityFieldsHashFrozen, true);
  assert.equal(manifest.baselineIntegrity.occurrenceJoin, '2481/2481');
  assert.deepEqual(manifest.baselineIntegrity.japanesePromptRemediation, { auditStatus: 'CLOSED', materializationStatus: 'MATERIALIZED', post: 545, drift: 0 });
  assert.deepEqual(manifest.baselineIntegrity.preValidation, { 'npm run vocab:check-derived': 'PASS', 'npm run vocab:validate': 'PASS' });

  const decisionById = new Map(decisions.map(row => [row.id, row]));
  assert.equal(decisionById.size, decisions.length, 'decision IDs must be unique');
  for (const decision of decisions) {
    assert.ok(TAXONOMIES.has(decision.taxonomy), `unknown taxonomy ${decision.id}`);
    assert.ok(DISPOSITIONS.has(decision.disposition), `unknown disposition ${decision.id}`);
    assert.ok(decision.reason && decision.failureAction && decision.conditions.length, `incomplete decision ${decision.id}`);
    assert.ok(Array.isArray(decision.minimalCounterexample) && decision.minimalCounterexample.length >= 2, `missing counterexample ${decision.id}`);
    if (decision.disposition === 'UNRESOLVED') assert.equal(decision.allowedModes.length, 0, `${decision.id} must be excluded from implementation`);
    if (decision.taxonomy === 'GRAMMATICAL_VARIANT' && decision.disposition === 'SAFE_EQUIVALENCE') {
      assert.equal(decision.authorityTier, 'grammatical-variant', `${decision.id} must retain distinct grammar provenance`);
      for (const mode of ['vocabulary', 'read', 'cloze', 'correction']) assert.ok(decision.allowedModes.includes(mode), `${decision.id} missing mode ${mode}`);
    }
  }
  assert.ok(decisionById.has('lexical-possessive-s'));

  const candidateIds = new Set();
  const keys = new Set();
  const byTaxonomy = Object.fromEntries([...TAXONOMIES].map(key => [key, 0]));
  const byDisposition = Object.fromEntries([...DISPOSITIONS].map(key => [key, 0]));
  const bySource = { vocabulary: 0, item: 0 };
  const byMode = Object.fromEntries(['vocabulary', 'read', 'cloze', 'correction'].map(mode => [mode, Object.fromEntries([...DISPOSITIONS].map(value => [value, 0]))]));
  let previousOrder = -1;
  for (const candidate of candidates) {
    assert.ok(!candidateIds.has(candidate.id), `duplicate candidate ID ${candidate.id}`);
    candidateIds.add(candidate.id);
    assert.ok(Number.isInteger(candidate.sourceOrder) && candidate.sourceOrder > previousOrder, `source order drift at ${candidate.id}`);
    previousOrder = candidate.sourceOrder;
    assert.ok(decisionById.has(candidate.decisionId), `missing decision join ${candidate.id}`);
    assert.ok(TAXONOMIES.has(candidate.taxonomy), `unknown candidate taxonomy ${candidate.id}`);
    assert.ok(DISPOSITIONS.has(candidate.disposition), `unknown candidate disposition ${candidate.id}`);
    assert.ok(candidate.proposedCounterparts.length > 0, `no proposed pair ${candidate.id}`);
    assert.equal(candidate.recognitionSurface.rawTranscriptRemainsImmutable, true);
    assert.equal(new Set(candidate.modeApplicability).size, candidate.modeApplicability.length, `duplicate mode ${candidate.id}`);
    const rule = decisionById.get(candidate.decisionId);
    assert.equal(candidate.authorityTier, rule.authorityTier || (rule.taxonomy === 'ORTHOGRAPHIC_ASR_EQUIVALENCE' ? 'orthographic-asr-equivalence' : null), `authority tier drift ${candidate.id}`);
    for (const mode of candidate.modeApplicability) {
      const expectedModeTreatment = rule.disposition === 'REJECT'
        ? 'REJECT'
        : rule.allowedModes.includes(mode) ? candidate.disposition : 'UNRESOLVED';
      assert.equal(candidate.modeTreatment[mode], expectedModeTreatment, `mode scope drift ${candidate.id}/${mode}`);
      byMode[mode][expectedModeTreatment] += 1;
    }
    assert.deepEqual(Object.keys(candidate.modeTreatment).sort(), [...candidate.modeApplicability].sort());
    assert.ok(typeof candidate.sourceContext === 'string');
    assert.ok(candidate.start >= 0 && candidate.end > candidate.start);
    assert.equal(candidate.sourceContext.slice(candidate.start, candidate.end), candidate.surface, `span drift ${candidate.id}`);
    const sourceSlots = slotSpans(candidate.sourceContext);
    const insideSlots = sourceSlots.filter(slot => slot.end > candidate.start && slot.start < candidate.end);
    const outsideSlots = sourceSlots.filter(slot => !(slot.end > candidate.start && slot.start < candidate.end));
    assert.deepEqual(candidate.slotIntegrity.sourceSlots, sourceSlots, `source slot drift ${candidate.id}`);
    assert.deepEqual(candidate.slotIntegrity.slotsInsideCandidate, insideSlots, `candidate slot drift ${candidate.id}`);
    assert.deepEqual(candidate.slotIntegrity.slotsOutsideCandidate, outsideSlots, `external slot drift ${candidate.id}`);
    assert.equal(candidate.slotIntegrity.outsideSlotsRemainOutsideMatchedSpan, true);
    const pairSlotSymmetry = candidate.proposedCounterparts.every(value => JSON.stringify(slots(value)) === JSON.stringify(insideSlots.map(slot => slot.value)));
    assert.equal(candidate.slotIntegrity.exactPairSlotSymmetry, pairSlotSymmetry, `counterpart slot integrity ${candidate.id}`);
    const key = [candidate.sourceType, candidate.sourceId, candidate.field, candidate.start, candidate.end, candidate.familyId].join('\u0000');
    assert.ok(!keys.has(key), `duplicate source candidate ${candidate.id}`);
    keys.add(key);
    const expectedId = `ge-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    assert.equal(candidate.id, expectedId, `unstable candidate ID ${candidate.id}`);
    byTaxonomy[candidate.taxonomy] += 1;
    byDisposition[candidate.disposition] += 1;

    if (candidate.sourceType === 'vocabulary') {
      bySource.vocabulary += 1;
      const entry = vocabById.get(candidate.sourceId);
      assert.ok(entry, `missing vocabulary entry ${candidate.sourceId}`);
      const actual = candidate.field === 'canonical' ? entry.canonical
        : candidate.field === 'answers' ? entry.answers?.[candidate.fieldIndex]
          : candidate.field === 'paraphrases' ? entry.paraphrases?.[candidate.fieldIndex] : undefined;
      assert.equal(actual, candidate.sourceContext, `field join mismatch ${candidate.id}`);
      assert.equal(candidate.authority.matchedAuthorityField, candidate.field);
      assert.equal(candidate.authority.paraphraseCannotBePromotedByThisAudit, candidate.field === 'paraphrases');
      assert.deepEqual(candidate.authority.canonicalSlots, slots(entry.canonical));
      assert.deepEqual(candidate.authority.candidateSlots, slots(candidate.surface));
      assert.deepEqual(candidate.authority.sourceFieldSlots, slots(candidate.sourceContext));
      if (candidate.field === 'paraphrases') assert.notEqual(candidate.authority.paraphraseCannotBePromotedByThisAudit, false);
    } else {
      assert.equal(candidate.sourceType, 'item');
      bySource.item += 1;
      const item = itemById.get(candidate.sourceId);
      assert.ok(item, `missing item ${candidate.sourceId}`);
      assert.equal(item.en, candidate.sourceContext, `item source join mismatch ${candidate.id}`);
      for (const link of candidate.linkedVocabularyOccurrences) {
        const entry = vocabById.get(link.entryId);
        assert.ok(entry, `missing occurrence entry ${link.entryId}`);
        assert.ok(entry.occurrences.some(row => row.item_id === candidate.sourceId && row.start === link.occurrenceStart && row.end === link.occurrenceEnd), `occurrence span join mismatch ${link.entryId}`);
      }
    }
  }
  assert.equal(candidateIds.size, manifest.candidateAccounting.total);
  assert.deepEqual(bySource, manifest.candidateAccounting.bySourceType);
  assert.deepEqual(byTaxonomy, manifest.candidateAccounting.byTaxonomy);
  assert.deepEqual(byDisposition, manifest.candidateAccounting.byDisposition);
  assert.deepEqual(byMode, manifest.candidateAccounting.byModeTreatment);
  assert.equal(keys.size, candidates.length);

  const inventoryPairs = inventory.requestedClasses.map(row => `${row.expansion}|${row.form}`.replace(/[‘’‛ʼ＇]/gu, "'"));
  for (const required of [
    "I am|I'm", "you are|you're", "he is|he's", "he has|he's", "I have|I've", "it has|it's",
    "I will|I'll", "I would|I'd", "I had|I'd", "do not|don't", "does not|doesn't", "did not|didn't",
    "cannot|can't", "will not|won't", "shall not|shan't", "let us|let's", "were|we're", "your|you're", "its|it's",
  ]) assert.ok(inventoryPairs.includes(required), `missing required inventory pair ${required}`);
  assert.ok(inventory.corpusDiscoveredForms.length > 0);
  for (const ambiguity of ["'s", "'d", "'re", "ain't", "let's", 'cannot / can not']) assert.ok(inventory.ambiguities.some(row => row.form === ambiguity), `missing ambiguity ${ambiguity}`);

  const allFixtures = [...fixtures.positiveControls, ...fixtures.negativeControls];
  assert.equal(new Set(allFixtures.map(row => row.id)).size, allFixtures.length, 'fixture IDs must be unique');
  for (const fixture of allFixtures) {
    assert.ok(decisionById.has(fixture.decisionId), `fixture decision missing: ${fixture.id}`);
    assert.ok(fixture.expected && (fixture.observed || fixture.hypotheses), `fixture needs concrete evidence: ${fixture.id}`);
  }
  assert.ok(fixtures.positiveControls.length >= 10);
  assert.ok(fixtures.negativeControls.length >= 15);
  assert.ok(fixtures.negativeControls.every(row => ['REJECT', 'UNRESOLVED', 'PARAPHRASE_OR_MISS'].includes(row.expectedResult)));
  for (const id of ['n-drop-negation', 'n-drop-not', 'n-possessive-s', 'n-would-had', 'n-have-be', 'n-cross-rank-synthesis', 'n-cloze-negation', 'n-cloze-partial-hidden-target', 'n-read-missing-reference-word', 'n-paraphrase-not-target']) {
    assert.ok(fixtures.negativeControls.some(row => row.id === id), `missing required negative fixture ${id}`);
  }
  assert.match(fixtures.negativeControls.find(row => row.id === 'n-cross-rank-synthesis').decisionId, /nbest/);
  assert.match(fixtures.negativeControls.find(row => row.id === 'n-cloze-negation').requiredProperty, /preservesExpectedNegation/);
  assert.match(fixtures.modeExpectations.cloze, /hidden target|target completeness/i);
  assert.match(fixtures.modeExpectations.vocabulary, /PARAPHRASE/);
  assert.equal(fixtures.safetyCoverage.negativeContractionPairs.length, 18);
  for (const pair of fixtures.safetyCoverage.negativeContractionPairs) {
    const positive = allFixtures.find(row => row.id === pair.positiveFixtureId);
    const negative = allFixtures.find(row => row.id === pair.negativeFixtureId);
    assert.ok(positive && negative, `incomplete negative-pair control ${pair.expansion}/${pair.contraction}`);
    assert.equal(positive.expectedResult, 'SAFE_EQUIVALENCE');
    assert.equal(positive.decisionId, 'negative-fixed-pair');
    for (const mode of ['vocabulary', 'read', 'cloze', 'correction']) {
      assert.ok(positive.modes.includes(mode), `positive pair ${pair.contraction} missing ${mode} control`);
      assert.ok(negative.modes.includes(mode), `negative pair ${pair.contraction} missing ${mode} control`);
    }
    assert.equal(positive.observed, negative.expected, `negative contraction and polarity control disagree for ${pair.contraction}`);
    assert.ok(positive.expected.toLocaleLowerCase('en-US').includes(pair.expansion), `positive expanded control missing ${pair.expansion}`);
    const positiveAuxiliary = pair.expansion === 'cannot' ? 'can' : pair.expansion.replace(/ not$/u, '');
    assert.ok(negative.observed.toLocaleLowerCase('en-US').includes(positiveAuxiliary), `negative polarity control missing ${positiveAuxiliary}`);
    assert.equal(negative.expectedResult, 'REJECT');
    assert.equal(negative.decisionId, 'negation-drop-or-add');
  }
  assert.ok(manifest.candidateAccounting.byModeTreatment.read.SAFE_EQUIVALENCE > 0, 'Read must admit bounded fixed-pair candidates');
  assert.ok(manifest.candidateAccounting.byModeTreatment.cloze.SAFE_EQUIVALENCE > 0, 'Cloze must admit bounded fixed-pair candidates');
  assert.match(fixtures.modeExpectations.read, /unmatched word|unmatched reference/i);
  assert.match(fixtures.modeExpectations.cloze, /complete hidden target/i);
  assert.match(fixtures.positiveControls.find(row => row.id === 'p-cloze-negative-complete-target').requiredProperty, /preservesExpectedNegation=true/);
  assert.match(fixtures.negativeControls.find(row => row.id === 'n-cloze-partial-hidden-target').requiredProperty, /hidden target is incomplete/);

  return { candidates: candidates.length, decisions: decisions.length, positive: fixtures.positiveControls.length, negative: fixtures.negativeControls.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateAudit();
    console.log(`ASR-09A audit validation PASS: ${result.candidates} candidates, ${result.decisions} decisions, ${result.positive} positive controls, ${result.negative} negative controls.`);
  } catch (error) {
    console.error(`ASR-09A audit validation FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
