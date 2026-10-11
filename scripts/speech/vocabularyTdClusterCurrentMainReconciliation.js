import { createHash } from 'node:crypto';
import { classifyVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { classifyVocabularySpeechAnswer } from './vocabularySpeechEvidence.js';
import { findSpeechSurfaceMatch } from './speechAlignment.js';
import { safeSpeechTokens } from './safeSpeechNormalization.js';

export const TD_CURRENT_MAIN_BASELINE = Object.freeze({
  mainSha: 'e1b56da18e0df1d583473a6f208a75333bd22969',
  sourceBlobs: Object.freeze({
    'data/vocabulary-v3.json': '91324d35b2db1911ece2cf3ff746409d321fe963',
    'data/items.json': 'ae2aca768b784199b77ac1cf8c0c5a80fd5725bb',
  }),
  historicalMaterializationBlob: 'd3dedaafd2b42807bbf41a3036bbf6992fa3d603',
  sourceAuditSha: '76085365bd3f5759bf3048df427574f350d01191',
  historicalMaterializationMainSha: '22d4f37b48177b9a42a4b215330f0d7231400779',
});

const EXPECTED_RELOCATIONS = Object.freeze({
  'tdc-00002': { from: 0, to: 1 },
  'tdc-00007': { from: 0, to: 1 },
});

export function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
}

function tokenValues(surface) {
  return safeSpeechTokens(surface).map(token => token.value);
}

function tokenIdentity(left, right) {
  const a = tokenValues(left);
  const b = tokenValues(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function authorityCandidates(record, entry, itemById) {
  if (record.surface_type === 'canonical') {
    return [{ surface: String(entry.canonical || ''), index: null, ref: `${entry.id}:canonical` }];
  }
  if (record.surface_type === 'answers[]') {
    return (entry.answers || []).map((surface, index) => ({ surface, index, ref: `${entry.id}:answer:${index}` }));
  }
  if (record.surface_type === 'accepted paraphrase') {
    return (entry.paraphrases || []).map((surface, index) => ({ surface, index, ref: `${entry.id}:paraphrase:${index}` }));
  }
  if (record.surface_type === 'source occurrence') {
    return (entry.occurrences || []).map((occurrence, index) => {
      const item = itemById.get(occurrence.item_id);
      return {
        surface: item ? item.en.slice(occurrence.start, occurrence.end) : '',
        index,
        ref: `${entry.id}:source:${index}`,
        itemId: occurrence.item_id,
      };
    });
  }
  return [];
}

function authoritySnapshot(entry) {
  return {
    canonical: entry.canonical ?? null,
    answers: entry.answers ?? null,
    paraphrases: entry.paraphrases ?? null,
    meaning_ja: entry.meaning_ja ?? null,
    sense_key: entry.sense_key ?? null,
    grammarRole: entry.grammarRole ?? null,
    occurrences: entry.occurrences ?? null,
  };
}

function expectedClass(record) {
  return record.surface_type === 'accepted paraphrase' ? 'paraphrase' : 'target';
}

function activeOccurrenceFor(record, entry, match, itemById) {
  if (record.surface_type !== 'source occurrence' || !match) return null;
  const occurrence = entry.occurrences?.[match.index];
  const item = occurrence && itemById.get(occurrence.item_id);
  return occurrence && item ? { occurrence, item } : null;
}

export function inspectTdMaterializationRecord(record, entryById, itemById, ruleById) {
  const entry = entryById.get(record.entry_id);
  if (!entry) throw new Error(`${record.audit_candidate_id} references missing entry ${record.entry_id}`);
  const candidates = authorityCandidates(record, entry, itemById);
  const exactMatches = candidates.filter(candidate => candidate.surface === record.target_surface);
  const normalizedMatches = candidates.filter(candidate => tokenIdentity(candidate.surface, record.target_surface));
  const currentMatch = exactMatches.length === 1 ? exactMatches[0] : null;
  const historicalPosition = record.surface_type === 'canonical'
    ? null
    : record.surface_index;
  const surfaceAtHistoricalPosition = record.surface_type === 'canonical'
    ? String(entry.canonical || '')
    : String(candidates.find(candidate => candidate.index === historicalPosition)?.surface || '');
  const occurrence = activeOccurrenceFor(record, entry, currentMatch, itemById);
  const target = classifyVocabularyAnswer({
    entry,
    activeOccurrence: occurrence,
    transcript: record.target_surface,
  });
  const intendedClass = expectedClass(record);
  let state;
  if (exactMatches.length > 1) state = 'AMBIGUOUS_DUPLICATE';
  else if (exactMatches.length === 0) state = normalizedMatches.length ? 'SURFACE_MODIFIED' : 'SURFACE_REMOVED';
  else if (target.type !== intendedClass) state = 'AUTHORITY_DRIFT';
  else if (currentMatch.index !== historicalPosition && historicalPosition !== null) state = 'INDEX_RELOCATED';
  else state = 'UNCHANGED';

  const collision = classifyVocabularySpeechAnswer({
    entry,
    activeOccurrence: occurrence,
    transcript: record.collision_surface,
  });
  const speechMatch = findSpeechSurfaceMatch(record.target_surface, record.collision_surface, {
    context: { mode: 'vocabulary', entryId: record.entry_id },
  });
  const rule = record.production_rule_id ? ruleById.get(record.production_rule_id) || null : null;
  const ruleScopeValid = record.materialization_status === 'ALREADY_COVERED'
    ? rule === null
    : Boolean(rule
      && rule.scope?.type === 'entry'
      && rule.scope?.entryIds?.length === 1
      && rule.scope.entryIds[0] === record.entry_id
      && rule.scope.mode === 'vocabulary'
      && rule.kind === 'connected-speech-td-cluster-before-to'
      && rule.credit === 'exact-equivalent');
  const collisionExpectedAuthority = record.materialization_status === 'ALREADY_COVERED'
    ? collision.recognitionAuthority === 'exact' && collision.speechMatch?.ruleId == null
    : collision.recognitionAuthority === 'explicit-equivalence'
      && collision.speechMatch?.ruleId === record.production_rule_id
      && speechMatch?.ruleId === record.production_rule_id;
  const collisionAccepted = collision.matched === true
    && collision.type === intendedClass
    && collisionExpectedAuthority
    && ruleScopeValid;

  if (state === 'UNCHANGED' || state === 'INDEX_RELOCATED') {
    if (!ruleScopeValid || !collisionAccepted) state = 'AUTHORITY_DRIFT';
  }
  const reference = currentMatch;
  return {
    audit_candidate_id: record.audit_candidate_id,
    entry_id: record.entry_id,
    historical: {
      surface_type: record.surface_type,
      surface_index: record.surface_index ?? null,
      surface_ref: record.surface_ref,
      target_surface: record.target_surface,
      current_main_accepted_surface: record.current_main_accepted_surface,
      current_main_accepted_via: record.current_main_accepted_via,
      materialization_status: record.materialization_status,
      production_rule_id: record.production_rule_id,
    },
    current: {
      state,
      surface_at_historical_position: surfaceAtHistoricalPosition,
      exact_surface_match_count: exactMatches.length,
      exact_surface_matches: exactMatches.map(({ surface, index, ref, itemId }) => ({ surface, index, ref, ...(itemId ? { item_id: itemId } : {}) })),
      normalized_token_match_count: normalizedMatches.length,
      normalized_token_matches: normalizedMatches.map(({ surface, index, ref, itemId }) => ({ surface, index, ref, ...(itemId ? { item_id: itemId } : {}) })),
      current_surface: reference?.surface ?? null,
      current_index: reference?.index ?? null,
      current_ref: reference?.ref ?? null,
      exact_surface_identity: Boolean(reference && reference.surface === record.target_surface),
      normalized_token_identity: Boolean(reference && tokenIdentity(reference.surface, record.target_surface)),
      classification: target.type.toUpperCase(),
      matched_authority: target.matchedAuthority ?? null,
      expected_classification: intendedClass.toUpperCase(),
      authority_snapshot: authoritySnapshot(entry),
    },
    collision: {
      surface: record.collision_surface,
      accepted: collisionAccepted,
      classification: collision.type.toUpperCase(),
      recognition_authority: collision.recognitionAuthority,
      applied_rule_id: collision.speechMatch?.ruleId ?? null,
      aligned_rule_id: speechMatch?.ruleId ?? null,
    },
    production_rule: rule ? {
      id: rule.id,
      expected: rule.expected,
      recognized: rule.recognized,
      kind: rule.kind,
      credit: rule.credit,
      scope: rule.scope,
    } : null,
    historical_relationship: state === 'INDEX_RELOCATED'
      ? 'SAME_EXACT_SURFACE_UNIQUE_AT_NEW_INDEX'
      : state === 'UNCHANGED' ? 'SAME_EXACT_SURFACE_AT_HISTORICAL_REFERENCE' : state,
  };
}

function safeRetirement(record, current) {
  return record.surface_type === 'accepted paraphrase'
    && current.state === 'SURFACE_REMOVED'
    && current.current.exact_surface_match_count === 0
    && current.current.normalized_token_match_count === 0
    && current.current.classification === 'MISS'
    && current.historical.materialization_status === 'APPLY';
}

export function buildTdCurrentMainReconciliation({ artifact, entries, items, rules, sourceBlobShas }) {
  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  const itemById = new Map(items.map(item => [item.id, item]));
  const ruleById = new Map(rules.map(rule => [rule.id, rule]));
  const records = artifact.records.map(record => inspectTdMaterializationRecord(record, entryById, itemById, ruleById));
  const problems = [];
  if (records.length !== 36) problems.push(`expected 36 historical records, received ${records.length}`);
  if (new Set(records.map(record => record.audit_candidate_id)).size !== records.length) problems.push('historical candidate IDs are not unique');
  if (artifact.source_audit_sha !== TD_CURRENT_MAIN_BASELINE.sourceAuditSha) problems.push('historical source audit SHA changed');
  if (artifact.current_main_sha !== TD_CURRENT_MAIN_BASELINE.historicalMaterializationMainSha) problems.push('historical materialization main SHA changed');
  if (JSON.stringify(sourceBlobShas) !== JSON.stringify(TD_CURRENT_MAIN_BASELINE.sourceBlobs)) problems.push('current production source blobs differ from the reconciled baseline');
  if (records.some(record => !['UNCHANGED', 'INDEX_RELOCATED'].includes(record.current.state) && !safeRetirement(artifact.records.find(item => item.audit_candidate_id === record.audit_candidate_id), record))) {
    problems.push('one or more records are missing, modified, duplicated, or have authority drift');
  }
  const relocated = Object.fromEntries(records.filter(record => record.current.state === 'INDEX_RELOCATED')
    .map(record => [record.audit_candidate_id, { from: record.historical.surface_index, to: record.current.current_index }]));
  if (JSON.stringify(relocated) !== JSON.stringify(EXPECTED_RELOCATIONS)) problems.push('observed index relocations differ from the complete preflight set');
  if (records.some(record => !record.collision.accepted && !safeRetirement(artifact.records.find(item => item.audit_candidate_id === record.audit_candidate_id), record))) {
    problems.push('one or more current collision surfaces lack the historical scoped acceptance');
  }
  if (problems.length) throw new Error(`T/D 36-record reconciliation failed: ${problems.join('; ')}`);

  const counts = Object.fromEntries(['UNCHANGED', 'INDEX_RELOCATED', 'SURFACE_REMOVED', 'SURFACE_MODIFIED', 'AMBIGUOUS_DUPLICATE', 'AUTHORITY_DRIFT']
    .map(state => [state, records.filter(record => record.current.state === state).length]));
  return {
    schema_version: 1,
    reconciled_main_sha: TD_CURRENT_MAIN_BASELINE.mainSha,
    source_blobs: { ...TD_CURRENT_MAIN_BASELINE.sourceBlobs },
    historical_materialization_blob_sha: TD_CURRENT_MAIN_BASELINE.historicalMaterializationBlob,
    historical_source_audit_sha: artifact.source_audit_sha,
    historical_materialization_main_sha: artifact.current_main_sha,
    counts: {
      total: records.length,
      statuses: counts,
      classification: {
        TARGET: records.filter(record => record.current.classification === 'TARGET').length,
        PARAPHRASE: records.filter(record => record.current.classification === 'PARAPHRASE').length,
      },
      collision_accepted: records.filter(record => record.collision.accepted).length,
    },
    records,
  };
}

export function assertTdCurrentMainReconciliation(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('current-main reconciliation artifact differs from deterministic 36-record regeneration');
  }
  return true;
}
