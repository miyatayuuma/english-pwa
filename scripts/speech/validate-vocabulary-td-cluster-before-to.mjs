import fs from 'node:fs';
import { classifyVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';
import { VOCABULARY_CHUNK_RESCUE_AUTHORITY_ENTRIES } from './vocabularyChunkRescueAuthority.js';
import {
  VOCABULARY_TD_CLUSTER_BEFORE_TO_AUDIT_RECORD_COUNT,
  VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY,
  VOCABULARY_TD_CLUSTER_BEFORE_TO_SOURCE_AUDIT_SHA,
} from './vocabularyTdClusterBeforeToAuthority.js';

const sourceAuditSha = '76085365bd3f5759bf3048df427574f350d01191';
const currentMainSha = '22d4f37b48177b9a42a4b215330f0d7231400779';
const expectedCandidateIds = [
  'wfc-00069', 'wfc-01883', 'wfc-01954', 'wfc-01957', 'wfc-01977', 'wfc-01978',
  'wfc-02183', 'wfc-02185', 'wfc-02515', 'wfc-02523', 'wfc-02718', 'wfc-02720',
  'wfc-02939', 'wfc-02946', 'wfc-03163', 'wfc-03391', 'wfc-03392', 'wfc-03849',
  'wfc-03850', 'wfc-03991', 'wfc-03992', 'wfc-04076', 'wfc-04078', 'wfc-04163',
  'wfc-04264', 'tdc-00001', 'tdc-00002', 'tdc-00003', 'tdc-00005', 'tdc-00006',
  'tdc-00007', 'tdc-00008', 'tdc-00009', 'tdc-00010', 'tdc-00012', 'tdc-00013',
];
const artifactPath = new URL('../../data/audits/vocabulary-td-cluster-before-to-production/materialization.json', import.meta.url);
const vocabularyPath = new URL('../../data/vocabulary-v3.json', import.meta.url);
const itemsPath = new URL('../../data/items.json', import.meta.url);
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const entries = JSON.parse(fs.readFileSync(vocabularyPath, 'utf8')).entries;
const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
const entryById = new Map(entries.map(entry => [entry.id, entry]));
const itemById = new Map(items.map(item => [item.id, item]));
const fail = message => { throw new Error(message); };
const sameTokens = (left, right) => {
  const a = safeSpeechTokens(left).map(token => token.value);
  const b = safeSpeechTokens(right).map(token => token.value);
  return a.length === b.length && a.every((token, index) => token === b[index]);
};

if (VOCABULARY_TD_CLUSTER_BEFORE_TO_SOURCE_AUDIT_SHA !== sourceAuditSha) fail('production authority source audit SHA drifted');
if (VOCABULARY_TD_CLUSTER_BEFORE_TO_AUDIT_RECORD_COUNT !== 36) fail('production authority record count is not 36');
if (artifact.source_audit_sha !== sourceAuditSha) fail('accounting artifact source audit SHA drifted');
if (artifact.current_main_sha !== currentMainSha) fail('accounting artifact current-main base drifted');
if (artifact.records.length !== 36) fail(`accounting has ${artifact.records.length} records, expected 36`);
if (new Set(artifact.records.map(record => record.audit_candidate_id)).size !== 36) fail('audit candidate IDs are not unique');
if (JSON.stringify(artifact.records.map(record => record.audit_candidate_id)) !== JSON.stringify(expectedCandidateIds)) fail('SAFE candidate accounting differs from the immutable 36-record audit set');
if (artifact.records.some(record => !['APPLY', 'ALREADY_COVERED'].includes(record.materialization_status))) fail('a SAFE record is neither applied nor already covered');
if (artifact.records.some(record => record.current_main_status !== 'ACTIVE_ACCEPTED')) fail('a SAFE surface is not active and accepted on current main');
if (artifact.counts.BLOCKED !== 0 || artifact.counts.APPLY !== 35 || artifact.counts.ALREADY_COVERED !== 1 || artifact.counts.RETIRED !== 0) fail('materialization counts do not reconcile to APPLY 35 / ALREADY_COVERED 1 / 0 blocked');

const rules = VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY;
if (rules.length !== 25 || artifact.counts.unique_production_rules !== 25) fail('unique production-rule count is not 25');
const productionEntryIds = new Set(rules.flatMap(rule => rule.scope?.entryIds || []));
const affectedEntryIds = new Set(artifact.records.map(record => record.entry_id));
if (productionEntryIds.size !== 22 || artifact.counts.unique_entry_ids !== 22) fail('production entry count is not 22');
if (affectedEntryIds.size !== 23 || artifact.counts.affected_entry_ids !== 23) fail('affected SAFE entry count is not 23');
const ruleById = new Map(rules.map(rule => [rule.id, rule]));
if (ruleById.size !== rules.length) fail('production rule IDs are not unique');
const linkedCandidateIds = [];
for (const rule of rules) {
  if (!entryById.has(rule.scope?.entryIds?.[0])) fail(`${rule.id} references an unknown Vocabulary entry`);
  if (rule.scope?.type !== 'entry' || rule.scope.entryIds.length !== 1 || rule.scope.mode !== 'vocabulary') fail(`${rule.id} is not restricted to one Vocabulary entry and mode`);
  if (rule.kind !== 'connected-speech-td-cluster-before-to' || rule.credit !== 'exact-equivalent') fail(`${rule.id} has incorrect kind or credit`);
  const expected = safeSpeechTokens(rule.expected).map(token => token.value);
  const recognized = safeSpeechTokens(rule.recognized).map(token => token.value);
  if (expected.length !== 2 || recognized.length !== 2) fail(`${rule.id} is not a two-token anchor`);
  if (expected[1] !== 'to' || recognized[1] !== 'to') fail(`${rule.id} is not anchored to to`);
  if (expected[0] === recognized[0]) fail(`${rule.id} does not change only the audited word`);
  if (rule.expectedTokens.join(' ') !== expected.join(' ') || rule.recognizedTokens.join(' ') !== recognized.join(' ')) fail(`${rule.id} has stale compiled tokens`);
  if (!Array.isArray(rule.auditCandidateIds) || !rule.auditCandidateIds.length) fail(`${rule.id} has no audit trace`);
  linkedCandidateIds.push(...rule.auditCandidateIds);
  if (rules.some(other => other.id !== rule.id
    && other.scope.entryIds.includes(rule.scope.entryIds[0])
    && sameTokens(other.expected, rule.recognized)
    && sameTokens(other.recognized, rule.expected))) fail(`${rule.id} has a reverse authority`);
}
const expectedProductionCandidateIds = expectedCandidateIds.filter(id => id !== 'wfc-04264');
if (new Set(linkedCandidateIds).size !== 35 || linkedCandidateIds.length !== 35) fail('APPLY-to-production trace is not one-to-one at record level');
if ([...linkedCandidateIds].sort().join('|') !== [...expectedProductionCandidateIds].sort().join('|')) fail('an APPLY audit record is not traced to a production rule');

for (const record of artifact.records) {
  const entry = entryById.get(record.entry_id);
  if (!entry) fail(`${record.audit_candidate_id} references an unknown entry`);
  if (record.source_audit_sha !== sourceAuditSha) fail(`${record.audit_candidate_id} has a stale source SHA`);
  const rule = record.production_rule_id ? ruleById.get(record.production_rule_id) : null;
  if (record.materialization_status === 'APPLY' && (!rule || rule.scope.entryIds[0] !== record.entry_id)) fail(`${record.audit_candidate_id} has no entry-scoped production rule`);
  if (record.materialization_status === 'ALREADY_COVERED' && (record.audit_candidate_id !== 'wfc-04264' || record.production_rule_id !== null)) fail(`${record.audit_candidate_id} is not a verified existing exact match`);
  let activeSurface = '';
  let activeOccurrence = null;
  let expectedType = 'target';
  if (record.surface_type === 'canonical') {
    activeSurface = String(entry.canonical || '');
    if (record.surface_ref !== `${entry.id}:canonical`) fail(`${record.audit_candidate_id} canonical surface reference is malformed`);
  } else if (record.surface_type === 'answers[]') {
    activeSurface = String(entry.answers?.[record.surface_index] || '');
    if (record.surface_ref !== `${entry.id}:answer:${record.surface_index}`) fail(`${record.audit_candidate_id} answers[] surface reference is malformed`);
  } else if (record.surface_type === 'accepted paraphrase') {
    activeSurface = String(entry.paraphrases?.[record.surface_index] || '');
    expectedType = 'paraphrase';
    if (record.surface_ref !== `${entry.id}:paraphrase:${record.surface_index}`) fail(`${record.audit_candidate_id} paraphrase surface reference is malformed`);
  } else if (record.surface_type === 'source occurrence') {
    const occurrence = entry.occurrences?.[record.surface_index];
    const item = occurrence && itemById.get(occurrence.item_id);
    if (occurrence && item) {
      activeOccurrence = { occurrence, item };
      activeSurface = item.en.slice(occurrence.start, occurrence.end);
    }
    if (record.surface_ref !== `${entry.id}:source:${record.surface_index}`) fail(`${record.audit_candidate_id} source surface reference is malformed`);
  } else fail(`${record.audit_candidate_id} has an unsupported surface type`);
  if (!activeSurface || !sameTokens(activeSurface, record.target_surface)) fail(`${record.audit_candidate_id} current accepted surface drifted`);
  const classification = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: record.target_surface });
  if (classification.type !== expectedType) fail(`${record.audit_candidate_id} does not retain its accepted ${expectedType} classification`);
  const collisionClassification = classifyVocabularyAnswer({ entry, activeOccurrence, transcript: record.collision_surface });
  if (record.materialization_status === 'ALREADY_COVERED' && collisionClassification.type !== expectedType) fail(`${record.audit_candidate_id} collision is not already an accepted exact surface`);
  if (record.materialization_status === 'ALREADY_COVERED' && collisionClassification.matchedAuthority !== 'canonical') fail(`${record.audit_candidate_id} exact collision lacks canonical authority evidence`);
  if (!sameTokens(activeSurface, record.current_main_accepted_surface)) fail(`${record.audit_candidate_id} current-main accepted-surface evidence drifted`);

  const targetTokens = safeSpeechTokens(record.target_surface);
  const collisionTokens = safeSpeechTokens(record.collision_surface);
  const targetWord = targetTokens[record.target_word_index];
  const targetTo = targetTokens[record.target_word_index + 1];
  const collisionWord = collisionTokens[record.target_word_index];
  const collisionTo = collisionTokens[record.target_word_index + 1];
  if (!targetWord || targetWord.raw.toLowerCase() !== record.target_word
    || !collisionWord || collisionWord.raw.toLowerCase() !== record.collision_word
    || targetTo?.raw.toLowerCase() !== 'to' || collisionTo?.raw.toLowerCase() !== 'to') fail(`${record.audit_candidate_id} lacks the audited word + to boundary`);
  if (targetTokens.length !== collisionTokens.length
    || targetTokens.some((token, index) => index !== record.target_word_index && token.value !== collisionTokens[index].value)) fail(`${record.audit_candidate_id} changes tokens outside the audited target word`);
  const expectedAnchor = `${targetWord.raw} ${targetTo.raw}`;
  const recognizedAnchor = `${collisionWord.raw} ${collisionTo.raw}`;
  if (!sameTokens(expectedAnchor, record.expected_anchor) || !sameTokens(recognizedAnchor, record.recognized_anchor)) fail(`${record.audit_candidate_id} anchor accounting drifted`);
  if (record.materialization_status === 'APPLY'
    && (!sameTokens(rule.expected, expectedAnchor) || !sameTokens(rule.recognized, recognizedAnchor))) fail(`${record.audit_candidate_id} does not trace to its exact rule`);
}

const affectedEntries = new Set(artifact.records.map(record => record.entry_id));
const chunkIds = new Set(VOCABULARY_CHUNK_RESCUE_AUTHORITY_ENTRIES.map(([id]) => id));
const intersection = [...affectedEntries].filter(id => chunkIds.has(id)).sort();
if (intersection.join('|') !== 'vocab:00528') fail(`unexpected chunk-rescue intersection: ${intersection.join(', ')}`);
if (artifact.counts.chunk_rescue_entry_intersection.join('|') !== intersection.join('|')) fail('chunk-rescue intersection accounting is stale');

console.log(`PASS: 36 SAFE audit records accounted; APPLY 35, ALREADY_COVERED 1, RETIRED 0, BLOCKED 0; 25 entry-scoped one-way to-anchored rules across 22 production entries; 23 affected entries; chunk intersection ${intersection.join(', ')}`);
