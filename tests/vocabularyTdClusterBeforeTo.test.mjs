import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyVocabularySpeechAnswer } from '../scripts/speech/vocabularySpeechEvidence.js';
import { findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { safeSpeechTokens } from '../scripts/speech/safeSpeechNormalization.js';
import { classifyVocabularyAnswer, normalizeVocabularyAnswer } from '../scripts/app/vocabularyLearningCore.js';
import {
  VOCABULARY_TD_CLUSTER_BEFORE_TO_AUDIT_RECORD_COUNT,
  VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY,
  VOCABULARY_TD_CLUSTER_BEFORE_TO_SOURCE_AUDIT_SHA,
} from '../scripts/speech/vocabularyTdClusterBeforeToAuthority.js';
import { VOCABULARY_CHUNK_RESCUE_AUTHORITY } from '../scripts/speech/vocabularyChunkRescueAuthority.js';
import {
  assertTdCurrentMainReconciliation,
  buildTdCurrentMainReconciliation,
  gitBlobSha,
  TD_CURRENT_MAIN_BASELINE,
} from '../scripts/speech/vocabularyTdClusterCurrentMainReconciliation.js';

const accounting = JSON.parse(readFileSync(new URL('../data/audits/vocabulary-td-cluster-before-to-production/materialization.json', import.meta.url), 'utf8'));
const currentMainReconciliation = JSON.parse(readFileSync(new URL('../data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json', import.meta.url), 'utf8'));
const vocabularyBytes = readFileSync(new URL('../data/vocabulary-v3.json', import.meta.url));
const itemsBytes = readFileSync(new URL('../data/items.json', import.meta.url));
const vocabulary = JSON.parse(vocabularyBytes.toString('utf8')).entries;
const items = JSON.parse(itemsBytes.toString('utf8'));
const nuanceMaterialization = JSON.parse(readFileSync(new URL('../data/audits/vocabulary-single-entry-nuance-materialization/materialization.json', import.meta.url), 'utf8'));
const entryById = new Map(vocabulary.map(entry => [entry.id, entry]));
const nuanceById = new Map(nuanceMaterialization.entries.map(row => [row.id, row]));
const japanesePromptAuthority = JSON.parse(readFileSync(new URL('../data/audits/vocabulary-japanese-prompt-authority-reconciliation/production-remediation-authority.json', import.meta.url), 'utf8'));
const japanesePromptById = new Map(japanesePromptAuthority.entries.map(row => [row.id, row]));
const itemById = new Map(items.map(item => [item.id, item]));
const safeIds = [
  'wfc-00069', 'wfc-01883', 'wfc-01954', 'wfc-01957', 'wfc-01977', 'wfc-01978',
  'wfc-02183', 'wfc-02185', 'wfc-02515', 'wfc-02523', 'wfc-02718', 'wfc-02720',
  'wfc-02939', 'wfc-02946', 'wfc-03163', 'wfc-03391', 'wfc-03392', 'wfc-03849',
  'wfc-03850', 'wfc-03991', 'wfc-03992', 'wfc-04076', 'wfc-04078', 'wfc-04163',
  'wfc-04264', 'tdc-00001', 'tdc-00002', 'tdc-00003', 'tdc-00005', 'tdc-00006',
  'tdc-00007', 'tdc-00008', 'tdc-00009', 'tdc-00010', 'tdc-00012', 'tdc-00013',
];

function buildCurrentMainReconciliation(sourceEntries = vocabulary) {
  return buildTdCurrentMainReconciliation({
    artifact: accounting,
    entries: sourceEntries,
    items,
    rules: VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY,
    sourceBlobShas: {
      'data/vocabulary-v3.json': gitBlobSha(vocabularyBytes),
      'data/items.json': gitBlobSha(itemsBytes),
    },
  });
}

function activeOccurrence(record) {
  if (record.surface_type !== 'source occurrence') return null;
  const entry = entryById.get(record.entry_id);
  const occurrence = entry?.occurrences?.[record.surface_index];
  const item = occurrence && itemById.get(occurrence.item_id);
  return occurrence && item ? { occurrence, item } : null;
}

function segment(transcripts) {
  return {
    segmentIndex: 0,
    primaryTranscript: transcripts[0],
    isFinal: true,
    alternatives: transcripts.map((transcript, asrRank) => ({ transcript, asrRank, confidence: 0 })),
  };
}

test('36 SAFE records preserve historical classification while current nuance removals are no longer accepted', () => {
  assert.equal(VOCABULARY_TD_CLUSTER_BEFORE_TO_SOURCE_AUDIT_SHA, '76085365bd3f5759bf3048df427574f350d01191');
  assert.equal(VOCABULARY_TD_CLUSTER_BEFORE_TO_AUDIT_RECORD_COUNT, 36);
  assert.equal(accounting.source_audit_sha, VOCABULARY_TD_CLUSTER_BEFORE_TO_SOURCE_AUDIT_SHA);
  assert.equal(accounting.records.length, 36);
  assert.deepEqual(accounting.records.map(record => record.audit_candidate_id), safeIds);
  assert.equal(accounting.records.filter(record => record.materialization_status === 'APPLY').length, 35);
  assert.equal(accounting.records.filter(record => record.materialization_status === 'ALREADY_COVERED').length, 1);
  assert.equal(accounting.records.filter(record => record.materialization_status === 'BLOCKED').length, 0);
  assert.equal(accounting.records.filter(record => record.current_main_status === 'ACTIVE_ACCEPTED').length, 36);
  assert.equal(accounting.counts.unique_entry_ids, 22);
  assert.equal(accounting.counts.affected_entry_ids, 23);

  for (const record of accounting.records) {
    const entry = entryById.get(record.entry_id);
    assert.ok(entry, record.entry_id);
    const nuance=nuanceById.get(record.entry_id);
    const normalizedAccepted=normalizeVocabularyAnswer(record.current_main_accepted_surface);
    const removedByAuthority=record.surface_type==='accepted paraphrase'
      &&!(entry.paraphrases||[]).some(value=>normalizeVocabularyAnswer(value)===normalizedAccepted);
    const expectedType = record.surface_type === 'accepted paraphrase' ? 'paraphrase' : 'target';
    const result = classifyVocabularySpeechAnswer({
      entry,
      activeOccurrence: activeOccurrence(record),
      transcript: record.collision_surface,
    });
    assert.equal(result.type, removedByAuthority?'miss':expectedType, record.audit_candidate_id);
    assert.equal(result.matched, !removedByAuthority, record.audit_candidate_id);
    if(removedByAuthority){
      assert.equal((japanesePromptById.get(record.entry_id)?.recommended_after?.paraphrases||entry.paraphrases||[]).some(value=>normalizeVocabularyAnswer(value)===normalizedAccepted),false,record.audit_candidate_id);
      continue;
    }
    if (record.materialization_status === 'ALREADY_COVERED') {
      assert.equal(record.audit_candidate_id, 'wfc-04264');
      assert.equal(result.recognitionAuthority, 'exact', record.audit_candidate_id);
      assert.equal(result.matchedAuthority, 'canonical', record.audit_candidate_id);
      assert.equal(result.speechMatch.ruleId, null, record.audit_candidate_id);
      assert.equal(record.production_rule_id, null);
    } else {
      assert.equal(result.recognitionAuthority, 'explicit-equivalence', record.audit_candidate_id);
      assert.equal(result.speechMatch.ruleId, record.production_rule_id, record.audit_candidate_id);
      assert.equal(result.speechMatch.ruleKind, 'connected-speech-td-cluster-before-to', record.audit_candidate_id);
    }
    assert.equal(result.rawTranscript, record.collision_surface, record.audit_candidate_id);
    assert.equal(result.targetRescued, false, record.audit_candidate_id);
  }
});

test('all production rules are entry-scoped, one-way, and anchored to two tokens ending in to', () => {
  const rules = VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY;
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  assert.equal(rules.length, 25);
  assert.equal(byId.size, rules.length);
  assert.equal(accounting.counts.unique_production_rules, rules.length);
  const linkedCandidateIds = [];

  for (const rule of rules) {
    assert.equal(rule.kind, 'connected-speech-td-cluster-before-to');
    assert.equal(rule.credit, 'exact-equivalent');
    assert.equal(rule.display, 'raw');
    assert.equal(rule.scope.type, 'entry');
    assert.equal(rule.scope.entryIds.length, 1);
    assert.equal(rule.scope.mode, 'vocabulary');
    assert.ok(entryById.has(rule.scope.entryIds[0]), rule.id);
    assert.ok(rule.auditCandidateIds.length > 0, rule.id);
    linkedCandidateIds.push(...rule.auditCandidateIds);

    const expected = safeSpeechTokens(rule.expected).map(token => token.value);
    const recognized = safeSpeechTokens(rule.recognized).map(token => token.value);
    assert.equal(expected.length, 2, rule.id);
    assert.equal(recognized.length, 2, rule.id);
    assert.equal(expected[1], 'to', rule.id);
    assert.equal(recognized[1], 'to', rule.id);
    assert.notEqual(expected[0], recognized[0], rule.id);
    assert.equal(findSpeechSurfaceMatch(rule.recognized, rule.expected, {
      context: { mode: 'vocabulary', entryId: rule.scope.entryIds[0] },
    }), null, `${rule.id} has no reverse equivalence`);

    const linkedRecords = accounting.records.filter(record => record.production_rule_id === rule.id);
    assert.ok(linkedRecords.length > 0, rule.id);
    for (const record of linkedRecords) {
      assert.equal(record.expected_anchor.toLocaleLowerCase('en-US'), rule.expected.toLocaleLowerCase('en-US'));
      assert.equal(record.recognized_anchor.toLocaleLowerCase('en-US'), rule.recognized.toLocaleLowerCase('en-US'));
      assert.equal(record.entry_id, rule.scope.entryIds[0]);
    }
  }
  assert.deepEqual([...linkedCandidateIds].sort(), safeIds.filter(id => id !== 'wfc-04264').sort());
  assert.equal(new Set(linkedCandidateIds).size, 35);
});

test('current-main reconciliation covers all 36 historical records without changing their authority', () => {
  const regenerated = buildCurrentMainReconciliation();
  assert.equal(assertTdCurrentMainReconciliation(currentMainReconciliation, regenerated), true);
  assert.deepEqual(buildCurrentMainReconciliation(), regenerated, 'reconciliation generation is deterministic');
  assert.equal(currentMainReconciliation.reconciled_main_sha, TD_CURRENT_MAIN_BASELINE.mainSha);
  assert.equal(currentMainReconciliation.counts.total, 36);
  assert.deepEqual(currentMainReconciliation.counts.statuses, {
    UNCHANGED: 34,
    INDEX_RELOCATED: 2,
    SURFACE_REMOVED: 0,
    SURFACE_MODIFIED: 0,
    AMBIGUOUS_DUPLICATE: 0,
    AUTHORITY_DRIFT: 0,
  });
  assert.deepEqual(currentMainReconciliation.counts.classification, { TARGET: 25, PARAPHRASE: 11 });
  assert.equal(currentMainReconciliation.counts.collision_accepted, 36);

  for (const [id, entryId] of [['tdc-00002', 'vocab:00528'], ['tdc-00007', 'vocab:00634']]) {
    const historical = accounting.records.find(record => record.audit_candidate_id === id);
    const current = currentMainReconciliation.records.find(record => record.audit_candidate_id === id);
    const entry = entryById.get(entryId);
    assert.equal(current.current.state, 'INDEX_RELOCATED', id);
    assert.equal(current.historical.surface_ref, `${entryId}:paraphrase:0`, id);
    assert.equal(current.current.current_ref, `${entryId}:paraphrase:1`, id);
    assert.equal(current.historical.surface_index, 0, id);
    assert.equal(current.current.current_index, 1, id);
    assert.equal(current.current.current_surface, historical.target_surface, id);
    assert.equal(current.current.exact_surface_match_count, 1, id);
    assert.equal(current.current.exact_surface_identity, true, id);
    assert.equal(current.current.normalized_token_identity, true, id);
    assert.equal(current.current.classification, 'PARAPHRASE', id);
    assert.equal(current.collision.accepted, true, id);
    assert.equal(current.collision.classification, 'PARAPHRASE', id);
    assert.equal(current.collision.applied_rule_id, historical.production_rule_id, id);
    assert.deepEqual(current.production_rule.scope, { type: 'entry', entryIds: [entryId], mode: 'vocabulary' }, id);
    assert.equal(classifyVocabularyAnswer({ entry, transcript: historical.target_surface }).type, 'paraphrase', id);
    const collision = classifyVocabularySpeechAnswer({ entry, transcript: historical.collision_surface });
    assert.equal(collision.type, 'paraphrase', id);
    assert.equal(collision.recognitionAuthority, 'explicit-equivalence', id);
    assert.equal(collision.speechMatch.ruleId, historical.production_rule_id, id);

    const lowerNbest = classifyVocabularySpeechAnswer({
      entry,
      transcript: 'unrelated words',
      recognitionSegments: [segment(['unrelated words', historical.collision_surface])],
    });
    assert.equal(lowerNbest.type, 'miss', `${id} lower N-best paraphrase remains a miss`);
    assert.equal(lowerNbest.matched, false, `${id} lower N-best paraphrase is not promoted`);
  }

  const unrelatedEntry = entryById.get('vocab:00503');
  assert.equal(classifyVocabularySpeechAnswer({ entry: unrelatedEntry, transcript: 'be force to do something' }).type, 'miss');
  assert.equal(classifyVocabularySpeechAnswer({ entry: unrelatedEntry, transcript: 'ten to do something' }).type, 'miss');
});

test('current-main reconciliation fails closed on missing, duplicate, modified, semantic, or TARGET-promotion drift', () => {
  const original = entryById.get('vocab:00528');
  const rest = vocabulary.filter(entry => entry.id !== original.id);
  const replace = paraphrases => [...rest, { ...original, paraphrases }];

  assert.throws(() => buildCurrentMainReconciliation(replace(['be compelled to do something'])), /reconciliation failed/);
  assert.throws(() => buildCurrentMainReconciliation(replace(['be forced to do something', 'be forced to do something'])), /reconciliation failed/);
  assert.throws(() => buildCurrentMainReconciliation(replace(['be compelled to do something', 'be forced to do something!'])), /reconciliation failed/);

  const changedMeaning = vocabulary.map(entry => entry.id === original.id
    ? { ...entry, meaning_ja: `${entry.meaning_ja}（意味変更）` }
    : entry);
  const changedExpected = buildCurrentMainReconciliation(changedMeaning);
  assert.throws(() => assertTdCurrentMainReconciliation(currentMainReconciliation, changedExpected), /differs from deterministic/);

  const promoted = structuredClone(currentMainReconciliation);
  promoted.records.find(record => record.audit_candidate_id === 'tdc-00002').current.classification = 'TARGET';
  assert.throws(() => assertTdCurrentMainReconciliation(promoted, buildCurrentMainReconciliation()), /differs from deterministic/);
});

test('vocab:00502 rescues canonical and active source targets, including the existing ten/10 normalization', () => {
  const entry = entryById.get('vocab:00502');
  const canonical = classifyVocabularySpeechAnswer({ entry, transcript: 'ten to do something' });
  assert.equal(canonical.type, 'target');
  assert.equal(canonical.matched, true);
  assert.equal(canonical.recognitionAuthority, 'explicit-equivalence');
  assert.equal(canonical.speechMatch.ruleId, 'td-cluster-before-to-vocab-00502-tend-to-ten');
  assert.equal(canonical.rawTranscript, 'ten to do something');

  assert.deepEqual(
    safeSpeechTokens('ten to').map(token => token.value),
    safeSpeechTokens('10 to').map(token => token.value),
  );
  const numeric = classifyVocabularySpeechAnswer({ entry, transcript: '10 to do something' });
  assert.equal(numeric.type, 'target');
  assert.equal(numeric.matched, true);
  assert.equal(numeric.recognitionAuthority, 'explicit-equivalence');
  assert.equal(numeric.rawTranscript, '10 to do something');

  const occurrence = entry.occurrences[0];
  const item = itemById.get(occurrence.item_id);
  const active = { occurrence, item };
  const sourceTarget = item.en.slice(occurrence.start, occurrence.end);
  assert.equal(sourceTarget, 'tend to associate politicians with hypocrisy');
  const source = classifyVocabularySpeechAnswer({
    entry,
    activeOccurrence: active,
    transcript: 'ten to associate politicians with hypocrisy',
  });
  assert.equal(source.type, 'target');
  assert.equal(source.matched, true);
  assert.equal(source.matchedAuthority, 'source');
  assert.equal(source.recognitionAuthority, 'explicit-equivalence');
  assert.equal(source.rawTranscript, 'ten to associate politicians with hypocrisy');
});

test('explicit rescue stays within TARGET N-best policy and preserves correction behavior', () => {
  const entry = entryById.get('vocab:00502');
  const lower = classifyVocabularySpeechAnswer({
    entry,
    transcript: 'unrelated words',
    recognitionSegments: [segment(['unrelated words', 'ten to do something'])],
  });
  assert.equal(lower.type, 'target');
  assert.equal(lower.targetRescued, true);
  assert.equal(lower.recognitionAuthority, 'explicit-equivalence');
  assert.equal(lower.asrRank, 1);
  assert.equal(lower.rawTranscript, 'ten to do something');

  const targetCorrection = classifyVocabularySpeechAnswer({
    entry,
    transcript: 'ten to do something',
    correction: true,
  });
  assert.equal(targetCorrection.type, 'target');
  assert.equal(targetCorrection.recognitionAuthority, 'explicit-equivalence');

  const paraphraseEntry = entryById.get('vocab:00528');
  assert.deepEqual(paraphraseEntry.paraphrases,japanesePromptById.get('vocab:00528').recommended_after.paraphrases);
  const retainedParaphrase=classifyVocabularySpeechAnswer({entry:paraphraseEntry,transcript:'be forced to do something'});
  assert.equal(retainedParaphrase.type,'paraphrase');
  assert.equal(retainedParaphrase.matched,true);
  const reducedParaphrase = 'unrelated words';
  const paraphrase = classifyVocabularySpeechAnswer({ entry: paraphraseEntry, transcript: reducedParaphrase });
  assert.equal(paraphrase.type, 'miss', 'a removed source paraphrase is not revived by its older speech equivalence');
  assert.equal(paraphrase.matched, false);

  assert.equal(classifyVocabularySpeechAnswer({
    entry: paraphraseEntry,
    transcript: `okay ${reducedParaphrase}`,
  }).type, 'miss', 'existing exact-only paraphrase boundary is preserved');
  assert.equal(classifyVocabularySpeechAnswer({
    entry: paraphraseEntry,
    transcript: 'wrong',
    recognitionSegments: [segment(['wrong', reducedParaphrase])],
  }).type, 'miss', 'lower N-best paraphrases remain outside TARGET rescue policy');
  assert.equal(classifyVocabularySpeechAnswer({
    entry: paraphraseEntry,
    transcript: reducedParaphrase,
    correction: true,
  }).type, 'miss', 'explicit equivalence does not bypass correction mode');
});

test('negative controls remain unmatched and the new authority does not leak by surface alone', () => {
  const apt = entryById.get('vocab:01166');
  for (const transcript of ['up to do something']) {
    assert.equal(classifyVocabularySpeechAnswer({ entry: apt, transcript }).type, 'miss', transcript);
  }
  const tend = entryById.get('vocab:00502');
  for (const transcript of ['tent to do something', 'ten toward do something', 'tend toward do something', 'ten to', 'ten toward', 'ten']) {
    assert.equal(classifyVocabularySpeechAnswer({ entry: tend, transcript }).type, 'miss', transcript);
  }
  assert.equal(findSpeechSurfaceMatch('tend', 'ten', { context: { mode: 'vocabulary', entryId: 'vocab:00502' } }), null, 'word-only reduction is not in authority');
  assert.equal(findSpeechSurfaceMatch('see', 'say', { context: { mode: 'vocabulary', entryId: 'vocab:00502' } }), null);
  assert.equal(findSpeechSurfaceMatch('yield', 'yelled', { context: { mode: 'vocabulary', entryId: 'vocab:00502' } }), null);
  assert.equal(findSpeechSurfaceMatch('tend to do something', 'ten to do something', {
    context: { mode: 'vocabulary', entryId: 'vocab:00503' },
  }), null, 'an unrelated entry cannot use the vocab:00502 rule');
  const sharedRead=findSpeechSurfaceMatch('tend to do something', 'ten to do something', {
    context: { mode: 'read', entryId: 'vocab:00502' },
  });
  assert.equal(sharedRead?.ruleId,'shared-read-td-cluster-before-to-vocab-00502-tend-to-ten');
  assert.equal(findSpeechSurfaceMatch('apt to do something', 'app to do something', {
    context: { mode: 'read' },
  }),null,'the separately reviewed apt/app near spelling remains Vocabulary-entry scoped');
});

test('vocab:00528 chunk rescue remains independent of the new paraphrase equivalence', () => {
  const entry = entryById.get('vocab:00528');
  assert.ok(VOCABULARY_CHUNK_RESCUE_AUTHORITY['vocab:00528']);
  const rescued = classifyVocabularySpeechAnswer({
    entry,
    transcript: 'have no choice on this',
    recognitionSegments: [segment(['have no choice on this', 'but to do something'])],
  });
  assert.equal(rescued.type, 'target');
  assert.equal(rescued.recognitionAuthority, 'nbest-chunk-exact');
  assert.ok(rescued.chunkRescue);
  assert.equal(rescued.speechMatch.ruleKind, null);

  const paraphrase = classifyVocabularySpeechAnswer({ entry, transcript: 'be forced to do something' });
  assert.equal(paraphrase.type, 'paraphrase', 'the valid paraphrase restored by the final Japanese Prompt authority remains accepted');
  assert.equal(paraphrase.chunkRescue, undefined);

  const uncuratedParaphrase = classifyVocabularySpeechAnswer({
    entry,
    transcript: 'wrong',
    recognitionSegments: [segment(['wrong', 'be force to do something'])],
  });
  assert.equal(uncuratedParaphrase.type, 'miss');
  assert.equal(uncuratedParaphrase.chunkRescue, undefined);
});
