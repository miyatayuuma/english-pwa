import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildCurrentProductionAuditProjection } from './materialize-paraphrase-learning-audit.mjs';
import { normalizeVocabularyAnswer } from '../app/vocabularyLearningCore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SOURCE_AUDIT_BRANCH = 'audit/vocabulary-japanese-prompt-authority-reconciliation';
export const SOURCE_AUDIT_COMMIT = 'e5b2e42deebdcb750006a7871f805668f55de4bf';
export const SOURCE_MAIN_COMMIT = '9007e2f59cc6bfc48e7021caa3b469dae89adb60';
export const SOURCE_AUTHORITY_PATH = 'data/audits/vocabulary-japanese-prompt-authority-reconciliation/production-remediation-authority.json';
export const SOURCE_AUTHORITY_BLOB = 'cf5fa6a183b5ec96dc40cc1d9acff4ef70507c10';
export const SOURCE_PRODUCTION_PATH = 'data/vocabulary-v3.json';
export const SOURCE_PRODUCTION_BLOB = 'c23643d26e71be22aaec5ec04ce63a7582ad9c25';
export const MATERIALIZATION_DIR = 'data/audits/vocabulary-japanese-prompt-authority-materialization';
export const MATERIALIZATION_FIELDS = ['meaning_ja', 'paraphrases', 'sense_key'];
export const SNAPSHOT_FIELDS = ['canonical', 'sense_key', 'grammarRole', 'meaning_ja', 'paraphrases', 'answers', 'kind', 'subtype'];

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
const ALLOWED_AUTHORITY_AFTER_FIELDS = new Set(['canonical', 'sense_key', 'meaning_ja', 'paraphrases', 'answers']);
const eq = isDeepStrictEqual;
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const gitBlobSha = (value) => crypto.createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const normalizeArray = (value) => Array.isArray(value) ? value : [];

function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}

function normalizeSnapshot(value) {
  return {
    canonical: value?.canonical ?? null,
    sense_key: value?.sense_key ?? null,
    grammarRole: value?.grammarRole ?? null,
    meaning_ja: value?.meaning_ja ?? null,
    paraphrases: normalizeArray(value?.paraphrases),
    answers: Array.isArray(value?.answers) ? value.answers : null,
    kind: value?.kind ?? null,
    subtype: value?.subtype ?? null,
  };
}

function expectedAfter(row) {
  const before = normalizeSnapshot(row.expected_before);
  const after = { ...before };
  for (const field of MATERIALIZATION_FIELDS) {
    if (Object.hasOwn(row.recommended_after || {}, field)) after[field] = field === 'paraphrases'
      ? normalizeArray(row.recommended_after[field])
      : row.recommended_after[field];
  }
  return after;
}

function expectedChangedFields(before, after) {
  return MATERIALIZATION_FIELDS.filter((field) => !eq(before[field], after[field]));
}

function countAuthorityChanges(rows) {
  const counts = {
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
    const before = normalizeSnapshot(row.expected_before);
    const after = expectedAfter(row);
    const changed = expectedChangedFields(before, after);
    if (changed.includes('meaning_ja')) counts.meaning_ja_changed += 1;
    if (changed.includes('paraphrases')) counts.paraphrases_changed += 1;
    if (changed.includes('meaning_ja') && changed.includes('paraphrases')) counts.meaning_and_paraphrase_changed += 1;
    if (changed.includes('sense_key')) counts.sense_key_changed += 1;
    if (before.canonical !== after.canonical) counts.canonical_changed += 1;
    if (!eq(before.answers, after.answers)) counts.answers_changed += 1;

    const beforeByKey = new Map(before.paraphrases.map((value) => [String(value), value]));
    const afterByKey = new Map(after.paraphrases.map((value) => [String(value), value]));
    counts.paraphrase_additions += [...afterByKey.keys()].filter((value) => !beforeByKey.has(value)).length;
    counts.paraphrase_removals += [...beforeByKey.keys()].filter((value) => !afterByKey.has(value)).length;
  }
  return counts;
}

function validateNaturalParaphrases(entries, phase) {
  for (const entry of entries) {
    const values = entry.paraphrases ?? [];
    requireThat(Array.isArray(values), `${phase}: ${entry.id} paraphrases must be an array`);
    const normalized = [];
    const canonical = normalizeVocabularyAnswer(entry.canonical);
    const answers = new Set(normalizeArray(entry.answers).map(normalizeVocabularyAnswer).filter(Boolean));
    for (const value of values) {
      requireThat(typeof value === 'string' && value.trim(), `${phase}: ${entry.id} has an empty paraphrase`);
      const form = normalizeVocabularyAnswer(value);
      requireThat(!!form, `${phase}: ${entry.id} paraphrase has no normalized form`);
      requireThat(!/[~～]|(?<![A-Za-z])[AB](?![A-Za-z])|[A-Za-z]\s*\/\s*[A-Za-z]|\(\d+\)|^\s*\d+[.)]|\.{2,}/.test(value), `${phase}: ${entry.id} has invalid audit notation`);
      requireThat(form !== canonical, `${phase}: ${entry.id} paraphrase overlaps canonical`);
      requireThat(!answers.has(form), `${phase}: ${entry.id} paraphrase overlaps answers`);
      normalized.push(form);
    }
    requireThat(new Set(normalized).size === normalized.length, `${phase}: ${entry.id} has normalized duplicate paraphrases`);
  }
}

function verifyAuthorityIdentity(authority, manifest, checkpoint) {
  const authorityBuffer = fs.readFileSync(path.join(ROOT, SOURCE_AUTHORITY_PATH));
  const computedBlob = gitBlobSha(authorityBuffer);
  requireThat(computedBlob === SOURCE_AUTHORITY_BLOB, `Authority Git blob mismatch: expected ${SOURCE_AUTHORITY_BLOB}, got ${computedBlob}`);
  requireThat(authority.schema_version === 1 && authority.status === 'READY_FOR_PRODUCTION_MATERIALIZATION', 'Production remediation authority is not ready');
  requireThat(authority.audit === 'vocabulary-japanese-prompt-authority-reconciliation', 'Unexpected authority audit identifier');
  requireThat(authority.audit_base_main_sha === SOURCE_MAIN_COMMIT && authority.final_current_main_reconciliation_sha === SOURCE_MAIN_COMMIT, 'Authority main identity differs from the pinned source main');
  requireThat(authority.production_path === SOURCE_PRODUCTION_PATH && authority.production_git_blob_sha === SOURCE_PRODUCTION_BLOB, 'Authority production source identity differs');
  requireThat(authority.joined_by === 'id' && authority.candidate_count === EXPECTED.candidate_count, 'Authority candidate join/count differs');
  requireThat(authority.entries.every((row) => row.provenance && row.materialization_eligible === true), 'Authority rows lack approved provenance/eligibility');
  requireThat(manifest.status === 'CLOSED' && manifest.semantic_review === 'COMPLETE' && manifest.final_main_reconciliation === 'COMPLETE' && manifest.strict_validation === 'PASS', 'Audit manifest is not CLOSED with strict validation');
  requireThat(checkpoint.status === 'CLOSED' && checkpoint.strict_validation === 'PASS' && checkpoint.production_materialization === 'NOT_STARTED', 'Audit checkpoint is not the expected immutable CLOSED state');
  return { authorityBuffer, authoritySha256: sha256(authorityBuffer) };
}

export function classifyMaterializationState(production, authorityRows) {
  const entries = production?.entries;
  requireThat(Array.isArray(entries), 'Production vocabulary must contain entries[]');
  const byId = new Map(entries.map((entry) => [String(entry?.id ?? ''), entry]));
  requireThat(byId.size === entries.length, 'Production vocabulary has duplicate IDs');
  const states = new Map();
  let pre = 0, post = 0, drift = 0;
  for (const row of authorityRows) {
    const entry = byId.get(row.id);
    if (!entry) {
      states.set(row.id, 'DRIFT');
      drift += 1;
      continue;
    }
    const actual = normalizeSnapshot(entry);
    const before = normalizeSnapshot(row.expected_before);
    const after = expectedAfter(row);
    const state = eq(actual, before) ? 'PRE' : eq(actual, after) ? 'POST' : 'DRIFT';
    states.set(row.id, state);
    if (state === 'PRE') pre += 1;
    else if (state === 'POST') post += 1;
    else drift += 1;
  }
  return { byId, states, PRE: pre, POST: post, DRIFT: drift };
}

export function buildExpectedProduction(sourceProduction, authorityRows) {
  const expected = structuredClone(sourceProduction);
  const byId = new Map(expected.entries.map((entry) => [entry.id, entry]));
  for (const row of authorityRows) {
    const entry = byId.get(row.id);
    requireThat(entry, `Missing authority candidate ${row.id}`);
    for (const field of ['meaning_ja', 'sense_key']) {
      if (Object.hasOwn(row.recommended_after || {}, field)) entry[field] = row.recommended_after[field];
    }
    if (Object.hasOwn(row.recommended_after || {}, 'paraphrases')) {
      const paraphrases = normalizeArray(row.recommended_after.paraphrases);
      if (paraphrases.length || Object.hasOwn(entry, 'paraphrases')) entry.paraphrases = [...paraphrases];
      else delete entry.paraphrases;
    }
  }
  return expected;
}

function buildObservedStateProjection(sourceProduction, authorityRows, states) {
  const expected = structuredClone(sourceProduction);
  const byId = new Map(expected.entries.map((entry) => [entry.id, entry]));
  for (const row of authorityRows) {
    if (states.get(row.id) !== 'POST') continue;
    const entry = byId.get(row.id);
    requireThat(entry, `Missing authority candidate ${row.id}`);
    if (Object.hasOwn(row.recommended_after || {}, 'meaning_ja')) entry.meaning_ja = row.recommended_after.meaning_ja;
    if (Object.hasOwn(row.recommended_after || {}, 'sense_key')) entry.sense_key = row.recommended_after.sense_key;
    if (Object.hasOwn(row.recommended_after || {}, 'paraphrases')) {
      const paraphrases = normalizeArray(row.recommended_after.paraphrases);
      if (paraphrases.length || Object.hasOwn(entry, 'paraphrases')) entry.paraphrases = [...paraphrases];
      else delete entry.paraphrases;
    }
  }
  return expected;
}

function restoreSourceProduction(production, authorityRows) {
  const source = structuredClone(production);
  const byId = new Map(source.entries.map((entry) => [entry.id, entry]));
  for (const row of authorityRows) {
    const entry = byId.get(row.id);
    requireThat(entry, `Missing authority candidate ${row.id}`);
    const before = normalizeSnapshot(row.expected_before);
    entry.meaning_ja = before.meaning_ja;
    entry.sense_key = before.sense_key;
    if (before.paraphrases.length) entry.paraphrases = [...before.paraphrases];
    else delete entry.paraphrases;
  }
  return source;
}

function recoverPinnedSource(production, authorityRows, states) {
  const allPre = states.PRE === EXPECTED.candidate_count && states.POST === 0;
  const sourceProduction = allPre ? structuredClone(production) : restoreSourceProduction(production, authorityRows);
  const sourceProductionBytes = allPre
    ? fs.readFileSync(path.join(ROOT, SOURCE_PRODUCTION_PATH))
    : Buffer.from(jsonBytes(sourceProduction));
  const blob = gitBlobSha(sourceProductionBytes);
  requireThat(blob === SOURCE_PRODUCTION_BLOB, `Production source identity mismatch: expected Git blob ${SOURCE_PRODUCTION_BLOB}, got ${blob}`);
  requireThat(sourceProduction.entries.length === 2478 && new Set(sourceProduction.entries.map((entry) => entry.id)).size === 2478, 'Pinned source population/IDs are invalid');
  return { sourceProduction, sourceProductionBytes };
}

function validateAuthorityRows(authority) {
  const rows = authority.entries;
  requireThat(Array.isArray(rows) && rows.length === EXPECTED.candidate_count, 'Authority rows must contain exactly 545 candidates');
  const ids = rows.map((row) => String(row?.id ?? ''));
  requireThat(ids.every((id) => /^vocab:\d{5}$/.test(id)), 'Authority contains an invalid candidate ID');
  requireThat(new Set(ids).size === ids.length, 'Authority contains duplicate candidate IDs');
  requireThat(eq(ids, authority.candidate_ids), 'Authority candidate_ids order differs from authority rows');
  for (const row of rows) {
    requireThat(row.materialization_eligible === true && row.exclusion_reason === null, `Candidate ${row.id} is not eligible`);
    requireThat(row.expected_before && row.recommended_after, `Candidate ${row.id} lacks before/after states`);
    requireThat(row.expected_before.canonical === row.recommended_after.canonical, `Canonical write is forbidden for ${row.id}`);
    requireThat(eq(row.expected_before.answers ?? null, row.recommended_after.answers ?? null), `Answers write is forbidden for ${row.id}`);
    requireThat(Object.keys(row.recommended_after).every((field) => ALLOWED_AUTHORITY_AFTER_FIELDS.has(field)), `Unexpected recommended_after field for ${row.id}`);
    requireThat(typeof row.recommended_after.meaning_ja === 'string' && row.recommended_after.meaning_ja.trim(), `Missing final meaning_ja for ${row.id}`);
    requireThat(Array.isArray(row.recommended_after.paraphrases), `Missing final paraphrases for ${row.id}`);
    const before = normalizeSnapshot(row.expected_before), after = expectedAfter(row);
    const actualChanged = expectedChangedFields(before, after);
    const declaredChanged = Array.isArray(row.changed_fields) ? [...row.changed_fields].sort() : [];
    requireThat(eq([...actualChanged].sort(), declaredChanged), `Authority changed_fields mismatch for ${row.id}`);
    requireThat(actualChanged.length > 0, `Candidate ${row.id} has no production change`);
  }
  const counts = countAuthorityChanges(rows);
  for (const [key, expected] of Object.entries(EXPECTED)) requireThat(counts[key] === expected, `Authority ${key} mismatch: expected ${expected}, got ${counts[key]}`);
  const row83 = rows.find((row) => row.id === 'vocab:00083');
  requireThat(row83?.expected_before.canonical === 'no way' && row83?.recommended_after.sense_key === 'strong_disbelief' && row83?.recommended_after.meaning_ja === 'まさか' && row83?.recommended_after.paraphrases.length === 0, 'vocab:00083 final authority differs');
  requireThat(rows.filter((row) => row.expected_before.sense_key !== row.recommended_after.sense_key).map((row) => row.id).join(',') === 'vocab:00083', 'Only vocab:00083 may change sense_key');
  return counts;
}

function buildRowsArtifact(authority, states) {
  return authority.entries.map((row) => {
    const before = normalizeSnapshot(row.expected_before);
    const after = expectedAfter(row);
    const beforeByKey = new Map(before.paraphrases.map((value) => [String(value), value]));
    const afterByKey = new Map(after.paraphrases.map((value) => [String(value), value]));
    return {
      id: row.id,
      source_index: row.source_index,
      state_before: 'PRE',
      state_after: 'POST',
      expected_before: before,
      applied_after: after,
      changed_fields: [...row.changed_fields],
      meaning_changed: !eq(before.meaning_ja, after.meaning_ja),
      paraphrases_changed: !eq(before.paraphrases, after.paraphrases),
      sense_key_changed: !eq(before.sense_key, after.sense_key),
      paraphrase_additions: [...afterByKey.keys()].filter((value) => !beforeByKey.has(value)).map((value) => afterByKey.get(value)),
      paraphrase_removals: [...beforeByKey.keys()].filter((value) => !afterByKey.has(value)).map((value) => beforeByKey.get(value)),
      result: 'APPLIED',
      authority_provenance: row.provenance,
      slot_review_reference: row.slot_authority?.slot_review_id ?? null,
    };
  });
}

function buildArtifacts({ authority, identity, sourceProduction, sourceProductionBytes, outputProduction }) {
  const authorityRows = authority.entries;
  const afterState = classifyMaterializationState(outputProduction, authorityRows);
  const expected = buildExpectedProduction(sourceProduction, authorityRows);
  requireThat(eq(outputProduction, expected), 'Production differs from exact source-plus-authority projection');
  const sourceProductionHash = sha256(sourceProductionBytes);
  const outputBytes = Buffer.from(jsonBytes(outputProduction));
  const changedCounts = countAuthorityChanges(authorityRows);
  const materialization = {
    schema_version: 1,
    status: 'MATERIALIZED',
    source_audit: {
      branch: SOURCE_AUDIT_BRANCH,
      commit: SOURCE_AUDIT_COMMIT,
      status: 'CLOSED',
      authority_path: SOURCE_AUTHORITY_PATH,
      authority_git_blob_sha: SOURCE_AUTHORITY_BLOB,
      authority_sha256: identity.authoritySha256,
      source_production_path: SOURCE_PRODUCTION_PATH,
      source_production_git_blob_sha: SOURCE_PRODUCTION_BLOB,
      source_main_sha: SOURCE_MAIN_COMMIT,
    },
    materialization_branch: 'fix/vocabulary-japanese-prompt-authority-materialization',
    materialization_base_sha: SOURCE_AUDIT_COMMIT,
    population: outputProduction.entries.length,
    source_state: { PRE: EXPECTED.candidate_count, POST: 0, DRIFT: 0 },
    result_state: { PRE: afterState.PRE, POST: afterState.POST, DRIFT: afterState.DRIFT },
    change_counts: changedCounts,
    entries: buildRowsArtifact(authority, afterState.states),
  };
  const reconciliation = {
    schema_version: 1,
    status: 'PASS',
    candidate_count: authorityRows.length,
    PRE: afterState.PRE,
    POST: afterState.POST,
    DRIFT: afterState.DRIFT,
    production_population: outputProduction.entries.length,
    target_ids: authorityRows.map((row) => row.id),
    changed_field_counts: changedCounts,
    paraphrase_additions: changedCounts.paraphrase_additions,
    paraphrase_removals: changedCounts.paraphrase_removals,
    forbidden_field_changes: { canonical: 0, answers: 0, grammarRole: 0, kind: 0, subtype: 0, occurrences: 0, id: 0, source_order: 0 },
    non_target_differences: 0,
    target_forbidden_field_differences: 0,
    production_before_hash: sourceProductionHash,
    production_after_hash: sha256(outputBytes),
    authority_hash: identity.authoritySha256,
    source_production_git_blob_sha: SOURCE_PRODUCTION_BLOB,
    strict_projection: 'DEEP_EXACT_PASS',
  };
  const summary = {
    status: 'MATERIALIZED',
    candidate_count: EXPECTED.candidate_count,
    meaning_ja_changed: changedCounts.meaning_ja_changed,
    paraphrase_changed: changedCounts.paraphrases_changed,
    meaning_and_paraphrase_changed: changedCounts.meaning_and_paraphrase_changed,
    sense_key_changed: changedCounts.sense_key_changed,
    canonical_changed: changedCounts.canonical_changed,
    answers_changed: changedCounts.answers_changed,
    paraphrase_additions: changedCounts.paraphrase_additions,
    paraphrase_removals: changedCounts.paraphrase_removals,
    production_population: outputProduction.entries.length,
    PRE: afterState.PRE,
    POST: afterState.POST,
    drift: afterState.DRIFT,
  };
  return { materialization, reconciliation, summary, outputBytes };
}

function writeIfChanged(relativePath, content) {
  const file = path.join(ROOT, relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return true;
}

export function runMaterialization(mode = '--dry-run') {
  if (!['--dry-run', '--write', '--check'].includes(mode)) throw new Error('Usage: node materialize-japanese-prompt-authority-remediation.mjs [--dry-run|--write|--check]');
  const authority = readJson(SOURCE_AUTHORITY_PATH);
  const manifest = readJson('data/audits/vocabulary-japanese-prompt-authority-reconciliation/manifest.json');
  const checkpoint = readJson('data/audits/vocabulary-japanese-prompt-authority-reconciliation/checkpoint.json');
  const identity = verifyAuthorityIdentity(authority, manifest, checkpoint);
  const authorityCounts = validateAuthorityRows(authority);
  const production = readJson(SOURCE_PRODUCTION_PATH);
  const entries = production.entries;
  requireThat(entries.length === 2478, `Production population must be 2478, got ${entries.length}`);
  requireThat(new Set(entries.map((entry) => entry.id)).size === 2478, 'Production IDs are not unique');
  const classified = classifyMaterializationState(production, authority.entries);
  requireThat(classified.DRIFT === 0, `Production DRIFT=${classified.DRIFT}; write/check stopped`);
  const { sourceProduction, sourceProductionBytes } = recoverPinnedSource(production, authority.entries, classified);
  requireThat(eq(entries.map((entry) => entry.id), sourceProduction.entries.map((entry) => entry.id)), 'Production ID order differs from pinned source');
  const observedProjection = buildObservedStateProjection(sourceProduction, authority.entries, classified.states);
  requireThat(eq(production, observedProjection), 'Production contains a non-target difference or an unauthorized target-field change');
  if (mode === '--check') requireThat(classified.PRE === 0 && classified.POST === EXPECTED.candidate_count, `--check requires POST 545, got PRE=${classified.PRE} POST=${classified.POST}`);
  const projected = buildExpectedProduction(sourceProduction, authority.entries);
  const planned = buildExpectedProduction(production, authority.entries);
  validateNaturalParaphrases(sourceProduction.entries, 'PRE');
  validateNaturalParaphrases(planned.entries, 'POST');
  const outputForArtifacts = mode === '--dry-run' && classified.PRE > 0 ? planned : production;
  let artifacts;
  let changedFiles = 0;
  if (mode === '--write' && classified.PRE > 0) {
    const productionBytes = Buffer.from(jsonBytes(planned));
    changedFiles += Number(writeIfChanged(SOURCE_PRODUCTION_PATH, productionBytes));
    const reloaded = readJson(SOURCE_PRODUCTION_PATH);
    artifacts = buildArtifacts({ authority, identity, sourceProduction, sourceProductionBytes, outputProduction: reloaded });
    changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/materialization.json`, jsonBytes(artifacts.materialization)));
    changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/reconciliation.json`, jsonBytes(artifacts.reconciliation)));
    changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/summary.json`, jsonBytes(artifacts.summary)));
  } else {
    artifacts = buildArtifacts({ authority, identity, sourceProduction, sourceProductionBytes, outputProduction: outputForArtifacts });
    if (mode === '--check') {
      for (const [name, expected] of Object.entries({
        [`${MATERIALIZATION_DIR}/materialization.json`]: jsonBytes(artifacts.materialization),
        [`${MATERIALIZATION_DIR}/reconciliation.json`]: jsonBytes(artifacts.reconciliation),
        [`${MATERIALIZATION_DIR}/summary.json`]: jsonBytes(artifacts.summary),
      })) requireThat(fs.existsSync(path.join(ROOT, name)) && fs.readFileSync(path.join(ROOT, name), 'utf8') === expected, `${name} differs from deterministic regeneration`);
      const paraphraseAudit = readJson('data/vocabulary-v3-paraphrase-audit.json');
      const expectedProjection = buildCurrentProductionAuditProjection(paraphraseAudit, readJson(SOURCE_PRODUCTION_PATH).entries);
      requireThat(eq(paraphraseAudit, expectedProjection), 'Current paraphrase audit projection is stale');
    }
    if (mode === '--write') {
      changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/materialization.json`, jsonBytes(artifacts.materialization)));
      changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/reconciliation.json`, jsonBytes(artifacts.reconciliation)));
      changedFiles += Number(writeIfChanged(`${MATERIALIZATION_DIR}/summary.json`, jsonBytes(artifacts.summary)));
    }
  }
  if (mode === '--write') {
    const paraphraseAudit = readJson('data/vocabulary-v3-paraphrase-audit.json');
    const projection = buildCurrentProductionAuditProjection(paraphraseAudit, readJson(SOURCE_PRODUCTION_PATH).entries);
    changedFiles += Number(writeIfChanged('data/vocabulary-v3-paraphrase-audit.json', jsonBytes(projection)));
  }
  if (mode === '--write') {
    const finalProduction = readJson(SOURCE_PRODUCTION_PATH);
    const finalState = classifyMaterializationState(finalProduction, authority.entries);
    requireThat(finalState.PRE === 0 && finalState.POST === EXPECTED.candidate_count && finalState.DRIFT === 0, `Post-write state mismatch PRE=${finalState.PRE} POST=${finalState.POST} DRIFT=${finalState.DRIFT}`);
    requireThat(eq(finalProduction, projected), 'Post-write production does not exactly equal pinned source plus authority');
  }
  const state = mode === '--dry-run' ? classified : classifyMaterializationState(readJson(SOURCE_PRODUCTION_PATH), authority.entries);
  const reported = mode === '--dry-run' ? planned : readJson(SOURCE_PRODUCTION_PATH);
  const result = {
    mode,
    authority: { commit: SOURCE_AUDIT_COMMIT, blob: SOURCE_AUTHORITY_BLOB, sha256: identity.authoritySha256, candidates: authority.entries.length },
    state: { PRE: state.PRE, POST: state.POST, DRIFT: state.DRIFT },
    production_population: reported.entries.length,
    ...authorityCounts,
    changed_files: changedFiles,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error('Usage: node materialize-japanese-prompt-authority-remediation.mjs [--dry-run|--write|--check]');
    runMaterialization(args[0] || '--dry-run');
  } catch (error) {
    console.error(`Japanese Prompt Authority materialization FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
