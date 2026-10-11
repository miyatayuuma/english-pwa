#!/usr/bin/env node

/** Strict closure validator for the Japanese Prompt Authority audit. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintRecommendedPrompt } from "./aggregate-japanese-prompt-authority-parallel-review.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT = resolve(ROOT, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const BASE_MAIN_SHA = "9007e2f59cc6bfc48e7021caa3b469dae89adb60";
const PRODUCTION_BLOB_SHA = "c23643d26e71be22aaec5ec04ce63a7582ad9c25";
const ID83 = "vocab:00083";
const EXPECTED_DECISIONS = {
  KEEP: 40,
  PROMPT_SIMPLIFY: 142,
  PARAPHRASE_RESTORE: 173,
  PROMPT_AND_PARAPHRASE_RECONCILE: 231,
  PARAPHRASE_REMOVE_SEMANTIC: 3,
};
const EXPECTED_PARENTHETICAL = {
  REMOVE_META_HINT: 248,
  REWRITE_MINIMAL_SEMANTIC: 120,
  KEEP_SEMANTIC_SCOPE: 8,
};
const SEMANTIC_FIELDS = ["canonical", "sense_key", "grammarRole", "meaning_ja", "paraphrases", "answers"];
const REMEDIATION_FIELDS = ["canonical", "sense_key", "meaning_ja", "paraphrases", "answers"];

function fail(message) { throw new Error(message); }
function assert(value, message) { if (!value) fail(message); }
function readText(path) { try { return readFileSync(path, "utf8"); } catch (error) { fail(`Cannot read ${path}: ${error.message}`); } }
function readJson(path) { try { return JSON.parse(readText(path)); } catch (error) { fail(`Cannot parse JSON ${path}: ${error.message}`); } }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a, b) { return stable(a) === stable(b); }
function mapById(rows, label) {
  const out = new Map();
  for (const row of rows) {
    assert(row && typeof row.id === "string", `${label} contains a row without id.`);
    assert(!out.has(row.id), `${label} contains duplicate id ${row.id}.`);
    out.set(row.id, row);
  }
  return out;
}
function counts(rows, keyOf) {
  const result = {};
  for (const row of rows) {
    const key = keyOf(row);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function gitBlobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function state(entry) {
  return {
    canonical: entry.canonical ?? null,
    sense_key: entry.sense_key ?? null,
    grammarRole: entry.grammarRole ?? null,
    meaning_ja: entry.meaning_ja ?? null,
    paraphrases: entry.paraphrases ?? [],
    answers: Object.hasOwn(entry, "answers") ? entry.answers : null,
    kind: entry.kind ?? null,
    subtype: entry.subtype ?? null,
  };
}

export function validateFinalAudit() {
  const manifest = readJson(resolve(AUDIT, "manifest.json"));
  const checkpoint = readJson(resolve(AUDIT, "checkpoint.json"));
  const index = readJson(resolve(AUDIT, "review-index.json"));
  const decisions = readJson(resolve(AUDIT, "decisions.json"));
  const parenthetical = readJson(resolve(AUDIT, "parenthetical-review.json"));
  const phrases = readJson(resolve(AUDIT, "paraphrase-reconciliation.json"));
  const semantic = readJson(resolve(AUDIT, "semantic-reconciliation.json"));
  const main = readJson(resolve(AUDIT, "current-main-reconciliation.json"));
  const resolution = readJson(resolve(AUDIT, "upstream-resolution.json"));
  const remediation = readJson(resolve(AUDIT, "production-remediation-authority.json"));
  const slotInventory = readJson(resolve(AUDIT, "slot-inventory.json"));
  const slotReview = readJson(resolve(AUDIT, "slot-review.json"));
  const slotSummary = readJson(resolve(AUDIT, "slot-summary.json"));
  const productionText = readText(resolve(ROOT, "data/vocabulary-v3.json"));
  const production = JSON.parse(productionText);
  assert(gitBlobSha(productionText) === PRODUCTION_BLOB_SHA, "Production vocabulary changed during audit finalization.");
  assert(production.entries.length === 2478, "Production inventory must remain 2,478.");

  assert(manifest.status === "CLOSED", "Manifest is not CLOSED.");
  assert(manifest.audit_base_main_sha === BASE_MAIN_SHA, "Audit base SHA differs from the fixed source.");
  assert(manifest.final_current_main_reconciliation_sha === BASE_MAIN_SHA, "Final main SHA must be recorded and match this reconciliation.");
  assert(manifest.current_main_reconciliation?.status === "PASS", "Manifest latest-main reconciliation is not PASS.");
  assert(manifest.strict_validator === "PASS", "Manifest strict validator is not PASS.");
  assert(manifest.deterministic_regeneration === "PASS", "Manifest deterministic regeneration is not PASS.");
  assert(manifest.production_materialization === "NOT_STARTED" && manifest.production_changes === 0, "Production materialization or modification was recorded.");
  assert(checkpoint.status === "CLOSED" && checkpoint.semantic_review === "COMPLETE", "Checkpoint semantic review is not closed/complete.");
  assert(checkpoint.upstream === 0 && checkpoint.pending === 0, "Checkpoint has unresolved upstream or pending entries.");
  assert(checkpoint.final_main_reconciliation === "COMPLETE" && checkpoint.strict_validation === "PASS", "Checkpoint final reconciliation or strict validation is incomplete.");
  assert(checkpoint.production_materialization === "NOT_STARTED", "Checkpoint production materialization must remain NOT_STARTED.");

  const batchRows = [];
  for (let n = 1; n <= 6; n += 1) {
    const batch = readJson(resolve(AUDIT, "batches", `batch-${String(n).padStart(3, "0")}.json`));
    assert(Array.isArray(batch.entries), `${batch.batch_id} has no entries.`);
    batchRows.push(...batch.entries);
  }
  const batchById = mapById(batchRows, "batches");
  const indexById = mapById(index.entries, "review index");
  const decisionsById = mapById(decisions.entries, "decisions");
  const parentheticalById = mapById(parenthetical.entries, "parenthetical review");
  const semanticById = mapById(semantic.entries, "semantic reconciliation");
  assert(batchRows.length === 589 && index.entries.length === 589 && decisions.entries.length === 589 && semantic.entries.length === 589, "All canonical audit projections must cover 589 IDs.");
  const ids = [...batchById.keys()];
  for (const [label, map] of [["review index", indexById], ["decisions", decisionsById], ["semantic reconciliation", semanticById]]) {
    assert(map.size === 589 && equal([...ids].sort(), [...map.keys()].sort()), `${label} IDs do not exactly match the batch union.`);
  }
  assert(equal(counts(index.entries, (row) => row.review_status), { REVIEWED: 589 }), "Review status counts must be REVIEWED 589, UPSTREAM 0, PENDING 0.");
  assert(equal(counts(decisions.entries, (row) => row.entry_decision), EXPECTED_DECISIONS), `Entry decisions differ: ${JSON.stringify(counts(decisions.entries, (row) => row.entry_decision))}.`);
  assert(equal(counts(parenthetical.entries, (row) => row.decision), EXPECTED_PARENTHETICAL), `Parenthetical decisions differ: ${JSON.stringify(counts(parenthetical.entries, (row) => row.decision))}.`);
  assert(parenthetical.population === 376 && parenthetical.segment_count === 381 && parenthetical.entries.length === 376, "Parenthetical population must be 376 entries and 381 segments.");
  assert(parenthetical.entries.every((row) => row.review_status === "REVIEWED"), "Parenthetical review has unresolved rows.");

  const confidence = counts(decisions.entries, (row) => row.confidence || "MISSING");
  assert(equal(confidence, { HIGH: 438, MEDIUM: 151 }), `Confidence accounting differs: ${JSON.stringify(confidence)}.`);
  assert(!decisions.entries.some((row) => row.confidence === "LOW"), "LOW confidence must be zero.");
  assert(manifest.coverage?.confidence?.HIGH === 438 && manifest.coverage?.confidence?.MEDIUM === 151 && manifest.coverage?.confidence?.LOW === 0 && manifest.coverage?.confidence?.MISSING === 0, "Manifest confidence accounting is incomplete.");

  assert(phrases.entries.length === 978, "Phrase reconciliation must contain all 978 judgments.");
  const phraseCounts = counts(phrases.entries, (row) => `${row.source}:${row.decision}`);
  const phraseTotals = {
    historical_removals: phrases.entries.filter((row) => row.source === "HISTORICAL_REMOVAL").length,
    historical_additions: phrases.entries.filter((row) => row.source === "HISTORICAL_ADDITION").length,
    current: phrases.entries.filter((row) => row.source === "CURRENT").length,
    new_additions: phrases.entries.filter((row) => row.source === "NEW_ADDITION").length,
  };
  assert(equal(phraseTotals, { historical_removals: 670, historical_additions: 8, current: 300, new_additions: 0 }), `Phrase populations differ: ${JSON.stringify(phraseTotals)}.`);
  assert(phraseCounts["HISTORICAL_REMOVAL:RESTORE"] === 531 && phraseCounts["HISTORICAL_REMOVAL:KEEP_REMOVED_SEMANTIC_MISMATCH"] === 139, "Historical removal decisions differ.");
  assert(phraseCounts["HISTORICAL_ADDITION:KEEP_ADDED"] === 8 && !(phraseCounts["HISTORICAL_ADDITION:REMOVE"] || 0), "Historical additions must be KEEP 8, REMOVE 0.");
  assert(phraseCounts["CURRENT:KEEP_CURRENT"] === 295 && phraseCounts["CURRENT:REMOVE_CURRENT_SEMANTIC_MISMATCH"] === 5, "Current paraphrases must be KEEP 295, REMOVE 5.");
  assert(phrases.entries.every((row) => row.review_status === "REVIEWED" && row.decision !== "PENDING"), "Phrase reconciliation has unresolved judgments.");

  assert(index.entries.filter((row) => row.slot_integrity_checked === true).length === 589, "Slot integrity union coverage must be 589/589.");
  assert(slotInventory.length === 2478 && slotReview.length === 19, "Slot inventory/candidate population differs.");
  const slotDefects = slotReview.filter((row) => !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(row.decision));
  assert(slotDefects.length === 17 && slotDefects.every((row) => row.review_status === "REVIEWED"), "All 17 confirmed slot defects must be integrated.");
  assert(slotSummary.candidates.confirmed_defect_entries === 17 && slotSummary.candidates.unresolved_defect_entries === 0, "Slot summary has unresolved defects.");
  assert(manifest.slot_integrity?.production_inventory_population === 2478 && manifest.slot_integrity?.confirmed_defect_entries === 17 && manifest.slot_integrity?.unresolved_defect_entries === 0 && manifest.slot_integrity?.pending === 0, "Manifest slot accounting is incomplete.");

  const promptFailures = [];
  for (const row of semantic.entries) {
    assert(row.final_review_status === "REVIEWED" && row.review_status === "REVIEWED", `Semantic row ${row.id} is unresolved.`);
    assert(row.confidence === "HIGH" || row.confidence === "MEDIUM", `Semantic row ${row.id} lacks acceptable confidence.`);
    assert(row.recommended_canonical === row.current_canonical, `Canonical changed for ${row.id}.`);
    const prompt = row.recommended_meaning_ja;
    const lint = lintRecommendedPrompt(prompt, row.recommended_canonical);
    if (lint.targetLeakage || lint.metaHint) promptFailures.push({ id: row.id, ...lint });
    assert(row.recommended_sense_key && Array.isArray(row.recommended_paraphrases), `Semantic row ${row.id} lacks sense or paraphrase recommendations.`);
  }
  assert(promptFailures.length === 0, `Prompt authority issues remain: ${JSON.stringify(promptFailures.slice(0, 10))}.`);
  assert(manifest.coverage?.target_leakage?.found === 5 && manifest.coverage?.target_leakage?.resolved === 5 && manifest.coverage?.target_leakage?.pending === 0 && manifest.coverage?.target_leakage?.upstream === 0, "Target leakage accounting must be 5/5 resolved.");
  assert(manifest.coverage?.meta_hint?.found === 243 && manifest.coverage?.meta_hint?.resolved === 243 && manifest.coverage?.meta_hint?.upstream === 0 && manifest.coverage?.meta_hint?.pending === 0, "Meta-hint accounting must be 243/243 resolved.");
  assert(manifest.coverage?.integrity?.reviewed_confidence_low === 0 && manifest.coverage?.integrity?.reviewed_confidence_missing === 0, "Manifest quality integrity has LOW or missing confidence.");

  const productionById = mapById(production.entries, "production");
  const row83 = batchById.get(ID83);
  const decision83 = decisionsById.get(ID83);
  const parenthetical83 = parentheticalById.get(ID83);
  const semantic83 = semanticById.get(ID83);
  const production83 = productionById.get(ID83);
  assert(row83 && decision83 && parenthetical83 && semantic83 && production83, "vocab:00083 is missing from a required projection.");
  assert(production83.canonical === "no way" && production83.sense_key === "strong_disbelief_or_refusal" && production83.meaning_ja === "まさか（口語で強い驚き・拒否を表す）" && production83.grammarRole === "interjection", "vocab:00083 current source snapshot was rewritten.");
  assert(row83.sense_key === "strong_disbelief_or_refusal" && row83.current_meaning_ja === production83.meaning_ja, "vocab:00083 source snapshot must preserve current production values.");
  assert(semantic83.current_sense_key === "strong_disbelief_or_refusal" && semantic83.recommended_sense_key === "strong_disbelief", "vocab:00083 current/recommended sense_key split is incorrect.");
  assert(semantic83.recommended_canonical === "no way" && semantic83.recommended_meaning_ja === "まさか", "vocab:00083 canonical/prompt authority differs.");
  assert(semantic83.prompt_changed === true && semantic83.sense_key_changed === true && semantic83.paraphrases_changed === false, "vocab:00083 semantic change flags differ.");
  assert(semantic83.recommended_paraphrases.length === 0 && decision83.recommended_paraphrases.length === 0, "vocab:00083 paraphrases must remain empty.");
  assert(row83.entry_decision === "PROMPT_SIMPLIFY" && decision83.entry_decision === "PROMPT_SIMPLIFY" && row83.review_status === "REVIEWED" && decision83.review_status === "REVIEWED" && decision83.confidence === "HIGH", "vocab:00083 final decision/status/confidence differs.");
  assert(row83.parenthetical_review.parenthetical_decision === "REMOVE_META_HINT" && parenthetical83.decision === "REMOVE_META_HINT" && parenthetical83.review_status === "REVIEWED", "vocab:00083 parenthetical decision differs.");
  assert(row83.resolution_provenance?.resolution_type === "EXPLICIT_SINGLE_SENSE_AUTHORITY" || row83.resolution_provenance?.authority_type === "EXPLICIT_SINGLE_SENSE_AUTHORITY", "vocab:00083 batch resolution provenance is missing.");
  const resolutionEntry = resolution.entries.find((row) => row.id === ID83);
  assert(resolution.status === "RESOLVED" && resolutionEntry?.resolution_type === "EXPLICIT_SINGLE_SENSE_AUTHORITY", "vocab:00083 upstream resolution record is missing.");
  assert(resolutionEntry.resolved_from === "strong_disbelief_or_refusal" && resolutionEntry.resolved_to === "strong_disbelief" && resolutionEntry.recommended_prompt === "まさか" && resolutionEntry.canonical === "no way" && resolutionEntry.excluded_sense === "strong_refusal", "vocab:00083 resolution authority fields differ.");

  assert(main.status === "PASS" && main.population === 589 && main.final_current_main_reconciliation_sha === BASE_MAIN_SHA, "Latest-main reconciliation artifact is incomplete.");
  assert(main.changed_id_count === 0 && main.semantically_affected_id_count === 0 && main.unresolved_semantic_drift === 0, "Latest-main drift must be zero.");
  assert(main.removed_ids.length === 0 && main.rekeyed_ids.length === 0 && main.source_snapshot_mismatches.length === 0, "Latest-main source identity/snapshot drift remains.");
  assert(main.classifications.NON_SEMANTIC_DRIFT === 0 && main.classifications.SEMANTIC_DRIFT_REVALIDATED_SAME === 0 && main.classifications.SEMANTIC_DRIFT_REQUIRES_UPDATE === 0 && main.classifications.SOURCE_REMOVED_OR_REKEYED === 0, "Latest-main classification totals differ.");
  assert(manifest.stale?.count === 0 && manifest.stale?.checked_main_sha === BASE_MAIN_SHA, "Manifest stale status differs from current-main reconciliation.");
  assert(manifest.historical_materialization_divergence?.mismatched_entries === 340 && manifest.historical_materialization_divergence.field_mismatch_counts.paraphrases === 340, "Historical divergence must remain separate at 340 paraphrase-only mismatches.");
  assert(semantic.current_main_reconciliation === "COMPLETE" && semantic.current_main_reconciliation_detail?.unresolved_semantic_drift === 0, "Semantic reconciliation does not record completed latest-main checks.");

  const candidateRows = remediation.entries;
  const candidateById = mapById(candidateRows, "production remediation authority");
  const semanticCandidates = semantic.entries.filter((row) => row.production_eligible).map((row) => row.id);
  assert(remediation.status === "READY_FOR_PRODUCTION_MATERIALIZATION", "Remediation authority is not ready.");
  assert(remediation.production_git_blob_sha === PRODUCTION_BLOB_SHA && remediation.final_current_main_reconciliation_sha === BASE_MAIN_SHA, "Remediation authority source identity differs.");
  assert(remediation.candidate_count === candidateRows.length && remediation.candidate_ids.length === candidateRows.length, "Remediation candidate count is inconsistent.");
  assert(candidateById.size === candidateRows.length && equal(candidateRows.map((row) => row.id), semanticCandidates), "Remediation candidates differ from production-changing semantic entries.");
  assert(remediation.eligibility?.all_reviewed === true && remediation.eligibility?.no_low_confidence === true && remediation.eligibility?.latest_main_reconciliation === "PASS" && remediation.eligibility?.unresolved_slot_conflicts === 0 && remediation.eligibility?.target_leakage_unresolved === 0 && remediation.eligibility?.meta_hint_unresolved === 0 && remediation.eligibility?.production_source_exact === true, "Remediation eligibility gates are incomplete.");
  assert(candidateRows.every((row) => row.materialization_eligible === true && row.exclusion_reason === null && row.confidence !== "LOW" && row.changed_fields.length > 0), "Remediation contains an ineligible or unchanged entry.");
  let meaningChanges = 0, paraphraseChanges = 0, bothChanges = 0, senseChanges = 0, canonicalChanges = 0, answerChanges = 0;
  for (const row of candidateRows) {
    const current = productionById.get(row.id);
    const before = state(current);
    const after = row.recommended_after;
    const changed = REMEDIATION_FIELDS.filter((field) => !equal(before[field], after[field]));
    assert(equal(changed, row.changed_fields), `Changed fields are incorrect for ${row.id}.`);
    assert(equal(before, row.expected_before), `Expected-before state is incorrect for ${row.id}.`);
    assert(row.provenance && row.slot_authority, `Remediation provenance/slot authority is missing for ${row.id}.`);
    if (changed.includes("meaning_ja")) meaningChanges += 1;
    if (changed.includes("paraphrases")) paraphraseChanges += 1;
    if (changed.includes("meaning_ja") && changed.includes("paraphrases")) bothChanges += 1;
    if (changed.includes("sense_key")) senseChanges += 1;
    if (changed.includes("canonical")) canonicalChanges += 1;
    if (changed.includes("answers")) answerChanges += 1;
  }
  assert(senseChanges === 1 && candidateById.has(ID83), "Exactly one sense-key remediation, vocab:00083, is required.");
  assert(canonicalChanges === 0 && answerChanges === 0, "Canonical/answers remediation is not allowed by this audit.");
  assert(remediation.change_counts.meaning_ja === meaningChanges && remediation.change_counts.paraphrases === paraphraseChanges && remediation.change_counts.meaning_ja_and_paraphrases === bothChanges && remediation.change_counts.sense_key === senseChanges, "Remediation change accounting is inconsistent.");
  assert(candidateById.get(ID83).expected_before.sense_key === "strong_disbelief_or_refusal" && candidateById.get(ID83).recommended_after.sense_key === "strong_disbelief" && candidateById.get(ID83).recommended_after.meaning_ja === "まさか", "vocab:00083 remediation candidate does not carry the fixed authority.");
  assert(remediation.production_changes_during_audit === 0 && manifest.production_changes === 0, "Production file changed during this audit.");

  return {
    result: "PASS",
    population: 589,
    review_status: { REVIEWED: 589, UPSTREAM: 0, PENDING: 0 },
    entry_decisions: EXPECTED_DECISIONS,
    parenthetical_decisions: EXPECTED_PARENTHETICAL,
    confidence,
    phrases: phraseTotals,
    slots: { inventory: 2478, checked: 589, confirmed_defects: 17, unresolved: 0 },
    target_leakage: manifest.coverage.target_leakage,
    meta_hint: manifest.coverage.meta_hint,
    current_main_changed_ids: main.changed_id_count,
    historical_divergence: main.historical_materialization_divergence.mismatched_entries,
    remediation_candidates: candidateRows.length,
    remediation_change_counts: remediation.change_counts,
    production_changes: 0,
    status: "CLOSED",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(validateFinalAudit(), null, 2)); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
