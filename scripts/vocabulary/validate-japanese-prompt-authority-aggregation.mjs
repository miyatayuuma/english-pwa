#!/usr/bin/env node

/** Validate the completed parallel-review aggregation without editing artifacts. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAggregationPlan, EXPECTED_WORKERS, lintRecommendedPrompt, reconstructRecommendedParaphrases, validateWorkerRefSnapshot } from "./aggregate-japanese-prompt-authority-parallel-review.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_REL = "data/audits/vocabulary-japanese-prompt-authority-reconciliation";
const AUDIT = resolve(ROOT, AUDIT_REL);
const EXPECTED_PRODUCTION_BLOB = "c23643d26e71be22aaec5ec04ce63a7582ad9c25";
const FINAL_STATUS = "SEMANTIC_REVIEW_COMPLETE_PENDING_FINAL_RECONCILIATION";
const EXPECTED_ENTRY_DECISIONS = {
  KEEP: 40,
  PROMPT_SIMPLIFY: 141,
  PARAPHRASE_RESTORE: 173,
  PROMPT_AND_PARAPHRASE_RECONCILE: 231,
  PARAPHRASE_REMOVE_SEMANTIC: 3,
  UPSTREAM_AUTHORITY_REVIEW: 1,
};
const EXPECTED_PARENTHETICAL = {
  REMOVE_META_HINT: 247,
  REWRITE_MINIMAL_SEMANTIC: 120,
  KEEP_SEMANTIC_SCOPE: 8,
  UPSTREAM_MEANING_REVIEW: 1,
};

function fail(message) { throw new Error(message); }
function assert(value, message) { if (!value) fail(message); }
function readText(path) { return readFileSync(path, "utf8"); }
function readJson(path) { return JSON.parse(readText(path)); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function same(a, b) { return stable(a) === stable(b); }
function mapBy(rows, keyOf, label) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    assert(!out.has(key), `${label} contains duplicate key ${key}.`);
    out.set(key, row);
  }
  return out;
}
function counts(rows, keyOf) {
  const out = {};
  for (const row of rows) {
    const key = keyOf(row);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
function gitBlobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function phraseKey(row) { return JSON.stringify([row.id, row.source, row.phrase]); }
function phraseDecision(row) { return row.decision; }
function sourceCounts(rows, source, predicate) { return rows.filter((row) => row.source === source && predicate(row)).length; }

export function validateAggregation({ offlineWorkerSnapshot = false } = {}) {
  const plan = buildAggregationPlan({ offlineWorkerSnapshot });
  assert(plan.postState && plan.changed.length === 0, "Canonical aggregation is not complete or has drift.");
  assert(plan.metrics.canonical_bias_only_removals === 0, "Canonical-bias-only removals must be zero.");
  assert(plan.metrics.slot_conflicts === 0, "Unresolved slot conflicts must be zero.");

  const manifest = readJson(resolve(AUDIT, "manifest.json"));
  const checkpoint = readJson(resolve(AUDIT, "checkpoint.json"));
  const index = readJson(resolve(AUDIT, "review-index.json"));
  const decisions = readJson(resolve(AUDIT, "decisions.json"));
  const parenthetical = readJson(resolve(AUDIT, "parenthetical-review.json"));
  const paraphrases = readJson(resolve(AUDIT, "paraphrase-reconciliation.json"));
  const semantic = readJson(resolve(AUDIT, "semantic-reconciliation.json"));
  const refs = readJson(resolve(AUDIT, "parallel/worker-heads.json"));
  const productionText = readText(resolve(ROOT, "data/vocabulary-v3.json"));
  const indexById = mapBy(index.entries, (row) => row.id, "review index");
  const decisionById = mapBy(decisions.entries, (row) => row.id, "decisions");
  const semanticById = mapBy(semantic.entries, (row) => row.id, "semantic reconciliation");

  validateWorkerRefSnapshot(refs.workers);
  assert(manifest.status === FINAL_STATUS && checkpoint.status === FINAL_STATUS && semantic.status === FINAL_STATUS, "Audit must remain open pending final reconciliation.");
  assert(manifest.production_changes === 0 && checkpoint.production_changes === 0 && semantic.production_changes === 0, "Production changes must remain zero.");
  assert(gitBlobSha(productionText) === EXPECTED_PRODUCTION_BLOB, "Production vocabulary differs from the immutable aggregation base.");
  assert(plan.output.size === 12 && [...plan.output.keys()].every((path) => path.startsWith(`${AUDIT}/`)), "Aggregation output contains a path outside the audit directory.");

  assert(index.entries.length === 589 && decisions.entries.length === 589 && semantic.entries.length === 589, "Canonical union population must be 589.");
  const reviewCounts = counts(index.entries, (row) => row.review_status);
  assert(same(reviewCounts, { REVIEWED: 588, UPSTREAM: 1 }), `Review status counts differ: ${JSON.stringify(reviewCounts)}.`);
  assert(indexById.get("vocab:00083")?.review_status === "UPSTREAM" && decisionById.get("vocab:00083")?.entry_decision === "UPSTREAM_AUTHORITY_REVIEW", "vocab:00083 must remain upstream.");
  assert(index.entries.every((row) => row.review_status !== "PENDING"), "Canonical review index still has PENDING rows.");
  for (const row of index.entries) {
    const decision = decisionById.get(row.id);
    const semanticRow = semanticById.get(row.id);
    assert(decision && semanticRow, `Missing canonical projection for ${row.id}.`);
    assert(decision.review_status === row.review_status && decision.entry_decision === row.entry_decision, `Decision/index mismatch for ${row.id}.`);
    assert(semanticRow.review_status === row.review_status && semanticRow.entry_decision === row.entry_decision, `Semantic/index mismatch for ${row.id}.`);
  }
  const entryDecisionCounts = counts(decisions.entries, (row) => row.entry_decision);
  assert(same(entryDecisionCounts, EXPECTED_ENTRY_DECISIONS), `Entry decision totals differ: ${JSON.stringify(entryDecisionCounts)}.`);
  assert(decisions.entries.filter((row) => row.provenance?.authority_type === "PARALLEL_WORKER").length === 548, "Worker provenance must be present for all 548 imported rows.");
  assert(decisions.entries.filter((row) => row.review_status === "REVIEWED" && !["HIGH", "MEDIUM"].includes(row.confidence)).length === 0, "Reviewed decision confidence is missing or LOW.");

  assert(parenthetical.entries.length === 376 && parenthetical.segment_count === 381, "Parenthetical population/segment count differs.");
  const parentheticalCounts = counts(parenthetical.entries, (row) => row.decision);
  assert(same(parentheticalCounts, EXPECTED_PARENTHETICAL), `Parenthetical decisions differ: ${JSON.stringify(parentheticalCounts)}.`);
  assert(parenthetical.entries.every((row) => row.review_status !== "PENDING"), "Parenthetical projection has pending entries.");

  assert(paraphrases.entries.length === 978, "Phrase projection must contain the exact 978 source phrases.");
  mapBy(paraphrases.entries, phraseKey, "phrase projection");
  assert(paraphrases.entries.every((row) => ["CURRENT", "HISTORICAL_REMOVAL", "HISTORICAL_ADDITION", "NEW_ADDITION"].includes(row.source)), "Phrase projection contains an unknown source.");
  assert(sourceCounts(paraphrases.entries, "CURRENT", (row) => ["KEEP_CURRENT", "KEEP"].includes(phraseDecision(row))) === 295, "Current KEEP count differs.");
  assert(sourceCounts(paraphrases.entries, "CURRENT", (row) => ["REMOVE_CURRENT_SEMANTIC_MISMATCH", "REMOVE"].includes(phraseDecision(row))) === 5, "Current REMOVE count differs.");
  assert(sourceCounts(paraphrases.entries, "HISTORICAL_REMOVAL", (row) => row.decision === "RESTORE") === 531, "Historical RESTORE count differs.");
  assert(sourceCounts(paraphrases.entries, "HISTORICAL_REMOVAL", (row) => row.decision === "KEEP_REMOVED_SEMANTIC_MISMATCH") === 139, "Historical semantic mismatch count differs.");
  assert(sourceCounts(paraphrases.entries, "HISTORICAL_ADDITION", (row) => ["KEEP_ADDED", "KEEP"].includes(row.decision)) === 8, "Historical addition KEEP count differs.");
  assert(sourceCounts(paraphrases.entries, "NEW_ADDITION", () => true) === 0, "Worker aggregation must not create new additions.");
  assert(paraphrases.entries.every((row) => row.review_status !== "PENDING" && row.decision !== "PENDING"), "Phrase projection has pending judgments.");

  const batches = [];
  for (let number = 1; number <= 6; number += 1) {
    const batch = readJson(resolve(AUDIT, `batches/batch-${String(number).padStart(3, "0")}.json`));
    batches.push(...batch.entries);
  }
  const batchById = mapBy(batches, (row) => row.id, "canonical batches");
  const phrasesByEntry = new Map();
  for (const row of paraphrases.entries) {
    const list = phrasesByEntry.get(row.id) || [];
    list.push(row);
    phrasesByEntry.set(row.id, list);
  }
  for (const row of decisions.entries.filter((item) => item.review_status === "REVIEWED")) {
    const source = batchById.get(row.id);
    const reconstructed = reconstructRecommendedParaphrases(source, phrasesByEntry.get(row.id) || []);
    assert(same(row.recommended_paraphrases || [], reconstructed), `Recommended paraphrases do not reconstruct for ${row.id}.`);
  }

  assert(index.entries.filter((row) => row.slot_integrity_checked === true).length === 589, "Slot integrity union coverage must be 589/589.");
  const slotReview = readJson(resolve(AUDIT, "slot-review.json"));
  const defects = slotReview.filter((row) => !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(row.decision));
  assert(defects.length === 17, "Exactly 17 confirmed slot defects must be integrated.");
  assert(slotReview.every((row) => row.review_status !== "PENDING"), "Slot authority has unresolved entries.");
  assert(defects.every((slot) => decisionById.get(slot.id)?.recommended_prompt === slot.recommended_prompt && batchById.get(slot.id)?.parenthetical_review?.recommended_prompt === slot.recommended_prompt), "A confirmed slot prompt conflicts with the canonical projection.");
  const slot1179 = slotReview.find((row) => row.id === "vocab:01179");
  assert(slot1179?.recommended_prompt === "somethingにさらされる", "vocab:01179 prompt must preserve the open argument slot.");
  assert((phrasesByEntry.get("vocab:01179") || []).some((row) => row.source === "HISTORICAL_REMOVAL" && row.phrase === "be subjected to something" && row.decision === "RESTORE"), "vocab:01179 historical paraphrase authority differs.");

  let targetLeakage = 0;
  let metaHints = 0;
  for (const row of semantic.entries.filter((item) => item.production_readiness === "SEMANTICALLY_READY")) {
    const lint = lintRecommendedPrompt(row.recommended_prompt, batchById.get(row.id).canonical);
    if (lint.targetLeakage) targetLeakage += 1;
    if (lint.metaHint) metaHints += 1;
  }
  assert(targetLeakage === 0 && metaHints === 0, `Final prompt lint failed: target leakage ${targetLeakage}; meta hints ${metaHints}.`);
  assert(semantic.entries.filter((row) => row.production_readiness === "SEMANTICALLY_READY").length === 588, "SEMANTICALLY_READY count differs from 588.");
  assert(semanticById.get("vocab:00083")?.production_readiness !== "SEMANTICALLY_READY", "The upstream row cannot be production-ready.");
  assert(decisions.entries.filter((row) => row.review_status === "REVIEWED" && row.confidence === "LOW").length === 0, "LOW confidence must be zero.");

  const divergence = manifest.historical_materialization_divergence;
  assert(divergence?.mismatched_entries === 340 && divergence.field_mismatch_counts?.paraphrases === 340, "Historical materialization divergence must remain 340 paraphrase-only differences.");
  assert(Object.entries(divergence.field_mismatch_counts).filter(([field, count]) => field !== "paraphrases" && count !== 0).length === 0, "Historical materialization divergence gained a non-paraphrase field.");
  assert(manifest.stale?.count === 0, "Historical divergence must not be recast as stale during this task.");

  return {
    result: "PASS",
    worker_count: EXPECTED_WORKERS.length,
    imported_reviews: plan.metrics.worker_reviews,
    union_population: index.entries.length,
    review_status: reviewCounts,
    entry_decisions: entryDecisionCounts,
    parenthetical: { entries: parenthetical.entries.length, segments: parenthetical.segment_count, decisions: parentheticalCounts },
    phrase_sources: {
      current: 300,
      historical_removal: 670,
      historical_addition: 8,
      new_addition: 0,
      unique_keys: paraphrases.entries.length,
    },
    slots: { union_checked: 589, confirmed_defects: defects.length, unresolved_conflicts: plan.metrics.slot_conflicts },
    integrity: { target_leakage_unresolved: targetLeakage, meta_hint_unresolved: metaHints, canonical_bias_only_removals: plan.metrics.canonical_bias_only_removals, low_confidence: 0 },
    historical_divergence: divergence.mismatched_entries,
    production_changes: 0,
    status: FINAL_STATUS,
  };
}

function main(argv) {
  const offlineWorkerSnapshot = argv.includes("--offline-worker-snapshot");
  assert(argv.every((arg) => arg === "--offline-worker-snapshot"), `Unknown arguments: ${argv.join(" ")}.`);
  console.log(JSON.stringify(validateAggregation({ offlineWorkerSnapshot }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
