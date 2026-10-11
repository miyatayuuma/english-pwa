import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeVocabularyAnswer } from '../app/vocabularyLearningCore.js';
import { validateFinalAudit } from './validate-japanese-prompt-authority-final.mjs';
import {
  SOURCE_AUDIT_BRANCH,
  SOURCE_AUDIT_COMMIT,
  SOURCE_MAIN_COMMIT,
  SOURCE_AUTHORITY_PATH,
  SOURCE_AUTHORITY_BLOB,
  SOURCE_PRODUCTION_PATH,
  SOURCE_PRODUCTION_BLOB,
  MATERIALIZATION_DIR,
  MATERIALIZATION_FIELDS,
} from './materialize-japanese-prompt-authority-remediation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED = {
  candidate_count: 545,
  meaning_ja_changed: 372,
  paraphrases_changed: 400,
  meaning_and_paraphrase_changed: 227,
  sense_key_changed: 1,
  canonical_changed: 0,
  answers_changed: 0,
  paraphrase_additions: 531,
  paraphrase_removals: 5,
};
const eq = isDeepStrictEqual;
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const gitBlobSha = (value) => crypto.createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const asArray = (value) => Array.isArray(value) ? value : [];

function assert(ok, message, errors) {
  if (!ok) errors.push(message);
}

function snapshot(entry) {
  return {
    canonical: entry?.canonical ?? null,
    sense_key: entry?.sense_key ?? null,
    grammarRole: entry?.grammarRole ?? null,
    meaning_ja: entry?.meaning_ja ?? null,
    paraphrases: asArray(entry?.paraphrases),
    answers: Array.isArray(entry?.answers) ? entry.answers : null,
    kind: entry?.kind ?? null,
    subtype: entry?.subtype ?? null,
  };
}

function expectedAfter(row) {
  const before = snapshot(row.expected_before);
  const after = { ...before };
  for (const field of MATERIALIZATION_FIELDS) {
    if (Object.hasOwn(row.recommended_after || {}, field)) after[field] = field === 'paraphrases'
      ? asArray(row.recommended_after[field])
      : row.recommended_after[field];
  }
  return after;
}

function countChanges(rows) {
  const totals = {
    candidate_count: rows.length,
    meaning_ja_changed: 0,
    paraphrases_changed: 0,
    meaning_and_paraphrase_changed: 0,
    sense_key_changed: 0,
    canonical_changed: 0,
    answers_changed: 0,
    paraphrase_additions: 0,
    paraphrase_removals: 0,
  };
  for (const row of rows) {
    const before = snapshot(row.expected_before);
    const after = expectedAfter(row);
    const meaning = !eq(before.meaning_ja, after.meaning_ja);
    const paraphrases = !eq(before.paraphrases, after.paraphrases);
    if (meaning) totals.meaning_ja_changed += 1;
    if (paraphrases) totals.paraphrases_changed += 1;
    if (meaning && paraphrases) totals.meaning_and_paraphrase_changed += 1;
    if (!eq(before.sense_key, after.sense_key)) totals.sense_key_changed += 1;
    if (!eq(before.canonical, after.canonical)) totals.canonical_changed += 1;
    if (!eq(before.answers, after.answers)) totals.answers_changed += 1;
    const beforeSet = new Set(before.paraphrases.map(String));
    const afterSet = new Set(after.paraphrases.map(String));
    totals.paraphrase_additions += [...afterSet].filter((value) => !beforeSet.has(value)).length;
    totals.paraphrase_removals += [...beforeSet].filter((value) => !afterSet.has(value)).length;
  }
  return totals;
}

function reconstructSource(production, rows) {
  const source = structuredClone(production);
  const byId = new Map(source.entries.map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const entry = byId.get(row.id);
    if (!entry) continue;
    const before = snapshot(row.expected_before);
    entry.meaning_ja = before.meaning_ja;
    entry.sense_key = before.sense_key;
    if (before.paraphrases.length) entry.paraphrases = [...before.paraphrases];
    else delete entry.paraphrases;
  }
  return source;
}

function buildExpected(source, rows) {
  const expected = structuredClone(source);
  const byId = new Map(expected.entries.map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const entry = byId.get(row.id);
    if (!entry) continue;
    if (Object.hasOwn(row.recommended_after || {}, 'meaning_ja')) entry.meaning_ja = row.recommended_after.meaning_ja;
    if (Object.hasOwn(row.recommended_after || {}, 'sense_key')) entry.sense_key = row.recommended_after.sense_key;
    if (Object.hasOwn(row.recommended_after || {}, 'paraphrases')) {
      const paraphrases = asArray(row.recommended_after.paraphrases);
      if (paraphrases.length || Object.hasOwn(entry, 'paraphrases')) entry.paraphrases = [...paraphrases];
      else delete entry.paraphrases;
    }
  }
  return expected;
}

function objectWithoutAllowedFields(entry) {
  const omitted = new Set(MATERIALIZATION_FIELDS);
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !omitted.has(key)));
}

function isNaturalAnswer(value) {
  return typeof value === 'string' && !!value.trim()
    && !/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|[A-Za-z]\s*\/\s*[A-Za-z]|\(\d+\)|^\s*\d+[.)]|\.{2,}/.test(value);
}

function validateParaphrases(entries, phase, errors) {
  const totals = { phrases: 0, invalid_notation: 0, empty_or_unnormalizable: 0, normalized_duplicates: 0, canonical_overlap: 0, answers_overlap: 0 };
  for (const entry of entries) {
    const values = entry.paraphrases;
    if (values == null) continue;
    if (!Array.isArray(values)) {
      errors.push(`${phase}: ${entry.id} paraphrases must be an array when present`);
      continue;
    }
    const normalized = [];
    const canonical = normalizeVocabularyAnswer(entry.canonical);
    const answers = new Set(asArray(entry.answers).map(normalizeVocabularyAnswer).filter(Boolean));
    for (const phrase of values) {
      totals.phrases += 1;
      const form = typeof phrase === 'string' ? normalizeVocabularyAnswer(phrase) : '';
      if (!form || !String(phrase).trim()) {
        totals.empty_or_unnormalizable += 1;
        errors.push(`${phase}: ${entry.id} has an empty/unnormalizable paraphrase`);
      } else normalized.push(form);
      if (!isNaturalAnswer(phrase)) {
        totals.invalid_notation += 1;
        errors.push(`${phase}: ${entry.id} has invalid audit notation in a paraphrase`);
      }
      if (form && canonical && form === canonical) {
        totals.canonical_overlap += 1;
        errors.push(`${phase}: ${entry.id} paraphrase overlaps canonical`);
      }
      if (form && answers.has(form)) {
        totals.answers_overlap += 1;
        errors.push(`${phase}: ${entry.id} paraphrase overlaps answers`);
      }
    }
    if (new Set(normalized).size !== normalized.length) {
      totals.normalized_duplicates += 1;
      errors.push(`${phase}: ${entry.id} contains normalized duplicate paraphrases`);
    }
  }
  return totals;
}

export function validateJapanesePromptAuthorityMaterialization() {
  const errors = [];
  const authorityBytes = fs.readFileSync(path.join(ROOT, SOURCE_AUTHORITY_PATH));
  const authority = JSON.parse(authorityBytes.toString('utf8'));
  const manifest = readJson('data/audits/vocabulary-japanese-prompt-authority-reconciliation/manifest.json');
  const checkpoint = readJson('data/audits/vocabulary-japanese-prompt-authority-reconciliation/checkpoint.json');
  const authorityBlob = gitBlobSha(authorityBytes);
  const authoritySha256 = sha256(authorityBytes);
  assert(authorityBlob === SOURCE_AUTHORITY_BLOB, 'Pinned production authority Git blob mismatch', errors);
  assert(authority.schema_version === 1 && authority.status === 'READY_FOR_PRODUCTION_MATERIALIZATION', 'Production remediation authority is not ready', errors);
  assert(authority.audit_base_main_sha === SOURCE_MAIN_COMMIT && authority.final_current_main_reconciliation_sha === SOURCE_MAIN_COMMIT, 'Authority source main identity mismatch', errors);
  assert(authority.production_path === SOURCE_PRODUCTION_PATH && authority.production_git_blob_sha === SOURCE_PRODUCTION_BLOB, 'Authority source production identity mismatch', errors);
  assert(authority.joined_by === 'id' && authority.candidate_count === EXPECTED.candidate_count, 'Authority ID join/count mismatch', errors);
  assert(manifest.status === 'CLOSED' && manifest.semantic_review === 'COMPLETE' && manifest.final_main_reconciliation === 'COMPLETE' && manifest.strict_validation === 'PASS', 'Closed audit manifest identity/status mismatch', errors);
  assert(checkpoint.status === 'CLOSED' && checkpoint.strict_validation === 'PASS' && checkpoint.production_materialization === 'NOT_STARTED', 'Closed audit checkpoint identity/status mismatch', errors);
  const auditValidation = validateFinalAudit();
  assert(auditValidation.status === 'CLOSED' && auditValidation.production_changes === 0, 'Source audit does not validate as CLOSED', errors);

  const rows = authority.entries;
  const ids = rows.map((row) => String(row?.id ?? ''));
  assert(rows.length === EXPECTED.candidate_count && authority.candidate_ids?.length === EXPECTED.candidate_count, 'Candidate coverage must be exactly 545', errors);
  assert(new Set(ids).size === EXPECTED.candidate_count && eq(ids, authority.candidate_ids), 'Candidate IDs must be unique and match authority order', errors);
  assert(rows.every((row) => row.materialization_eligible === true && row.exclusion_reason === null), 'Ineligible candidate present', errors);

  const production = readJson(SOURCE_PRODUCTION_PATH);
  const materialization = readJson(`${MATERIALIZATION_DIR}/materialization.json`);
  const reconciliation = readJson(`${MATERIALIZATION_DIR}/reconciliation.json`);
  const summary = readJson(`${MATERIALIZATION_DIR}/summary.json`);
  const entries = production.entries;
  const actualById = new Map(entries.map((entry) => [entry.id, entry]));
  const source = reconstructSource(production, rows);
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  const sourceBlob = gitBlobSha(sourceBytes);
  assert(sourceBlob === SOURCE_PRODUCTION_BLOB, `Reconstructed source production blob mismatch: ${sourceBlob}`, errors);
  assert(entries.length === 2478 && actualById.size === 2478, 'Production population/unique IDs must remain 2478', errors);
  assert(eq(entries.map((entry) => entry.id), source.entries.map((entry) => entry.id)), 'Production ID order changed', errors);
  const sourceKinds = Object.fromEntries(['word', 'expression', 'construction'].map((kind) => [kind, source.entries.filter((entry) => entry.kind === kind).length]));
  const actualKinds = Object.fromEntries(['word', 'expression', 'construction'].map((kind) => [kind, entries.filter((entry) => entry.kind === kind).length]));
  assert(eq(sourceKinds, actualKinds), 'Production kind counts changed', errors);

  const sourceById = new Map(source.entries.map((entry) => [entry.id, entry]));
  let post = 0, pre = 0, drift = 0, nonTargetDifferences = 0, forbiddenFieldDifferences = 0;
  const candidateSet = new Set(ids);
  for (const row of rows) {
    const actual = actualById.get(row.id);
    const before = snapshot(row.expected_before);
    const after = expectedAfter(row);
    const state = actual && eq(snapshot(actual), after) ? 'POST' : actual && eq(snapshot(actual), before) ? 'PRE' : 'DRIFT';
    if (state === 'POST') post += 1;
    else if (state === 'PRE') pre += 1;
    else drift += 1;
    assert(state === 'POST', `${row.id}: expected POST, found ${state}`, errors);
    assert(!!actual && eq(objectWithoutAllowedFields(actual), objectWithoutAllowedFields(sourceById.get(row.id) || {})), `${row.id}: a forbidden field changed`, errors);
    if (actual && !eq(objectWithoutAllowedFields(actual), objectWithoutAllowedFields(sourceById.get(row.id) || {}))) forbiddenFieldDifferences += 1;
    assert(row.expected_before.canonical === row.recommended_after.canonical, `${row.id}: canonical authority changed`, errors);
    assert(eq(row.expected_before.answers ?? null, row.recommended_after.answers ?? null), `${row.id}: answers authority changed`, errors);
  }
  for (const entry of source.entries) {
    if (candidateSet.has(entry.id)) continue;
    if (!eq(entry, actualById.get(entry.id))) nonTargetDifferences += 1;
  }
  assert(nonTargetDifferences === 0, `Non-target production differences: ${nonTargetDifferences}`, errors);
  assert(forbiddenFieldDifferences === 0, `Target forbidden-field differences: ${forbiddenFieldDifferences}`, errors);
  const expectedProduction = buildExpected(source, rows);
  assert(eq(production, expectedProduction), 'Production is not a deep exact projection of source plus the 545 authority rows', errors);

  const counts = countChanges(rows);
  for (const [key, expected] of Object.entries(EXPECTED)) assert(counts[key] === expected, `Authority count ${key}: expected ${expected}, got ${counts[key]}`, errors);

  const blob = Buffer.from(fs.readFileSync(path.join(ROOT, SOURCE_PRODUCTION_PATH)));
  assert(materialization.schema_version === 1 && materialization.status === 'MATERIALIZED', 'Materialization artifact schema/status mismatch', errors);
  assert(materialization.source_audit?.branch === SOURCE_AUDIT_BRANCH && materialization.source_audit?.commit === SOURCE_AUDIT_COMMIT && materialization.source_audit?.status === 'CLOSED', 'Materialization audit source reference mismatch', errors);
  assert(materialization.source_audit?.authority_path === SOURCE_AUTHORITY_PATH && materialization.source_audit?.authority_git_blob_sha === SOURCE_AUTHORITY_BLOB && materialization.source_audit?.authority_sha256 === authoritySha256, 'Materialization authority provenance mismatch', errors);
  assert(materialization.source_audit?.source_production_git_blob_sha === SOURCE_PRODUCTION_BLOB && materialization.source_audit?.source_main_sha === SOURCE_MAIN_COMMIT, 'Materialization source production identity mismatch', errors);
  assert(materialization.materialization_base_sha === SOURCE_AUDIT_COMMIT && materialization.materialization_branch === 'fix/vocabulary-japanese-prompt-authority-materialization', 'Materialization branch/base reference mismatch', errors);
  assert(materialization.population === 2478 && eq(materialization.source_state, { PRE: 545, POST: 0, DRIFT: 0 }) && eq(materialization.result_state, { PRE: 0, POST: 545, DRIFT: 0 }), 'Materialization state accounting mismatch', errors);
  assert(eq(materialization.change_counts, counts), 'Materialization change counts differ from authority', errors);
  assert(materialization.entries?.length === 545 && eq(materialization.entries.map((row) => row.id), ids), 'Materialization candidate artifact coverage/order mismatch', errors);
  for (let i = 0; i < rows.length; i += 1) {
    const record = materialization.entries[i];
    const authorityRow = rows[i];
    assert(record.source_index === authorityRow.source_index && record.state_before === 'PRE' && record.state_after === 'POST' && record.result === 'APPLIED', `${record.id}: materialization evidence state/provenance mismatch`, errors);
    assert(eq(record.expected_before, snapshot(authorityRow.expected_before)) && eq(record.applied_after, expectedAfter(authorityRow)), `${record.id}: materialization evidence surface mismatch`, errors);
    assert(eq(record.changed_fields, authorityRow.changed_fields), `${record.id}: materialization evidence changed fields mismatch`, errors);
    assert(eq(record.authority_provenance, authorityRow.provenance), `${record.id}: authority provenance is missing or stale`, errors);
  }
  const productionAfterHash = sha256(Buffer.from(`${JSON.stringify(production, null, 2)}\n`));
  assert(reconciliation.schema_version === 1 && reconciliation.status === 'PASS', 'Reconciliation artifact schema/status mismatch', errors);
  assert(reconciliation.candidate_count === 545 && reconciliation.PRE === 0 && reconciliation.POST === 545 && reconciliation.DRIFT === 0 && reconciliation.production_population === 2478, 'Reconciliation coverage/state mismatch', errors);
  assert(eq(reconciliation.target_ids, ids) && eq(reconciliation.changed_field_counts, counts), 'Reconciliation candidate/count detail mismatch', errors);
  assert(reconciliation.non_target_differences === 0 && reconciliation.target_forbidden_field_differences === 0 && reconciliation.strict_projection === 'DEEP_EXACT_PASS', 'Reconciliation integrity gates failed', errors);
  assert(reconciliation.production_before_hash === sha256(sourceBytes) && reconciliation.production_after_hash === productionAfterHash && reconciliation.authority_hash === authoritySha256, 'Reconciliation content hashes mismatch', errors);
  assert(reconciliation.source_production_git_blob_sha === SOURCE_PRODUCTION_BLOB, 'Reconciliation source production blob mismatch', errors);

  const expectedSummary = {
    status: 'MATERIALIZED',
    candidate_count: 545,
    meaning_ja_changed: 372,
    paraphrase_changed: 400,
    meaning_and_paraphrase_changed: 227,
    sense_key_changed: 1,
    canonical_changed: 0,
    answers_changed: 0,
    paraphrase_additions: 531,
    paraphrase_removals: 5,
    production_population: 2478,
    PRE: 0,
    POST: 545,
    drift: 0,
  };
  assert(eq(summary, expectedSummary), 'Materialization summary differs from required exact accounting', errors);
  assert(blob.length > 0, 'Production vocabulary is empty', errors);

  const sourceParaphrases = validateParaphrases(source.entries, 'PRE', errors);
  const finalParaphrases = validateParaphrases(entries, 'POST', errors);
  const validationErrors = ['invalid_notation', 'empty_or_unnormalizable', 'normalized_duplicates', 'canonical_overlap', 'answers_overlap'];
  for (const key of validationErrors) assert(sourceParaphrases[key] === 0, `PRE paraphrase validation ${key}=${sourceParaphrases[key]}`, errors);
  for (const key of validationErrors) assert(finalParaphrases[key] === 0, `POST paraphrase validation ${key}=${finalParaphrases[key]}`, errors);

  const row83 = actualById.get('vocab:00083');
  assert(row83?.canonical === 'no way' && row83?.sense_key === 'strong_disbelief' && row83?.meaning_ja === 'まさか' && asArray(row83?.paraphrases).length === 0, 'vocab:00083 production state mismatch', errors);
  const row1179 = actualById.get('vocab:01179');
  assert(row1179?.meaning_ja === 'somethingにさらされる' && asArray(row1179?.paraphrases).includes('be subjected to something'), 'vocab:01179 slot repair mismatch', errors);

  const slotSummary = readJson('data/audits/vocabulary-japanese-prompt-authority-reconciliation/slot-summary.json');
  const slotCandidateIds = rows.filter((row) => row.slot_authority?.slot_review_id).map((row) => row.id);
  assert(slotSummary.candidates?.confirmed_defect_entries === 17 && slotSummary.candidates?.unresolved_defect_entries === 0, 'Closed slot defect accounting mismatch', errors);
  assert(slotCandidateIds.length === 17 && new Set(slotCandidateIds).size === 17, 'Expected exactly 17 authority-linked slot defect rows', errors);
  for (const id of slotCandidateIds) {
    const row = rows.find((candidate) => candidate.id === id);
    const actual = actualById.get(id);
    assert(actual?.meaning_ja === row.recommended_after.meaning_ja && eq(asArray(actual?.paraphrases), asArray(row.recommended_after.paraphrases)), `${id}: final slot-related production surface differs from CLOSED remediation authority`, errors);
  }

  const result = {
    status: errors.length ? 'FAIL' : 'PASS',
    source_audit: { branch: SOURCE_AUDIT_BRANCH, commit: SOURCE_AUDIT_COMMIT, authority_blob: authorityBlob, authority_sha256: authoritySha256 },
    production: { population: entries.length, candidate_count: rows.length, PRE: pre, POST: post, DRIFT: drift, source_blob: sourceBlob },
    counts,
    non_target_differences: nonTargetDifferences,
    forbidden_field_differences: forbiddenFieldDifferences,
    slot_defect_rows: slotCandidateIds.length,
    paraphrases: { PRE: sourceParaphrases, POST: finalParaphrases },
    audit_status: auditValidation.status,
    errors,
  };
  if (errors.length) throw new Error(`Materialization validation failed:\n- ${errors.join('\n- ')}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(validateJapanesePromptAuthorityMaterialization(), null, 2));
  } catch (error) {
    console.error(`Japanese Prompt Authority materialization validation FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
