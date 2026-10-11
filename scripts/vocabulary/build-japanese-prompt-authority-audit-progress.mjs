#!/usr/bin/env node

/**
 * Deterministically rebuild the derived progress artifacts for the Japanese
 * Prompt Authority Reconciliation audit. The review index and batch files are
 * inputs only; this script never edits semantic decisions.
 *
 * Usage:
 *   node scripts/vocabulary/build-japanese-prompt-authority-audit-progress.mjs --check
 *   node scripts/vocabulary/build-japanese-prompt-authority-audit-progress.mjs --write
 *
 * Optional reproducibility inputs:
 *   --branch-head <sha>
 *   --main-sha <sha>
 *   --main-vocabulary <path>
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_REL = "data/audits/vocabulary-japanese-prompt-authority-reconciliation";
const AUDIT_DIR = resolve(ROOT, AUDIT_REL);
const MANIFEST_PATH = resolve(AUDIT_DIR, "manifest.json");
const CHECKPOINT_PATH = resolve(AUDIT_DIR, "checkpoint.json");
const SUMMARY_PATH = resolve(AUDIT_DIR, "summary.md");
const INDEX_PATH = resolve(AUDIT_DIR, "review-index.json");
const DECISIONS_PATH = resolve(AUDIT_DIR, "decisions.json");
const BATCH_DIR = resolve(AUDIT_DIR, "batches");
const SLOT_INVENTORY_PATH = resolve(AUDIT_DIR, "slot-inventory.json");
const SLOT_CANDIDATES_PATH = resolve(AUDIT_DIR, "slot-candidates.json");
const SLOT_REVIEW_PATH = resolve(AUDIT_DIR, "slot-review.json");
const SLOT_SUMMARY_PATH = resolve(AUDIT_DIR, "slot-summary.json");
const VOCAB_REL = "data/vocabulary-v3.json";
const VOCAB_PATH = resolve(ROOT, VOCAB_REL);
const MATERIALIZATION_REL = "data/audits/vocabulary-single-entry-nuance-materialization/materialization.json";
const MATERIALIZATION_PATH = resolve(ROOT, MATERIALIZATION_REL);
const ALLOWED_REVIEW_STATUSES = new Set(["REVIEWED", "UPSTREAM", "PENDING"]);
const DIVERGENCE_FIELDS = ["meaning_ja", "canonical", "sense_key", "grammarRole", "paraphrases"];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseArgs(argv) {
  const args = { mode: null, branchHead: null, mainSha: null, mainVocabulary: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check" || arg === "--write") {
      assert(args.mode === null, "Choose exactly one of --check or --write.");
      args.mode = arg.slice(2);
      continue;
    }
    if (["--branch-head", "--main-sha", "--main-vocabulary"].includes(arg)) {
      const value = argv[index + 1];
      assert(value && !value.startsWith("--"), `${arg} requires a value.`);
      args[{ "--branch-head": "branchHead", "--main-sha": "mainSha", "--main-vocabulary": "mainVocabulary" }[arg]] = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  args.mode ??= "check";
  return args;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON ${path}: ${error.message}`);
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${path}: ${error.message}`);
  }
}

function tryGit(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitShow(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    fail(`Cannot read ${path} from Git ref ${ref}: ${error.message}`);
  }
}

function gitBlobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function countStatuses(items) {
  const result = { REVIEWED: 0, UPSTREAM: 0, PENDING: 0 };
  for (const item of items) {
    assert(ALLOWED_REVIEW_STATUSES.has(item.review_status), `Unknown review status ${JSON.stringify(item.review_status)} for ${item.id}.`);
    result[item.review_status] += 1;
  }
  return {
    reviewed: result.REVIEWED,
    upstream: result.UPSTREAM,
    pending: result.PENDING,
    resolved: result.REVIEWED + result.UPSTREAM,
  };
}

function countBy(values, keys) {
  const output = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) {
    assert(Object.hasOwn(output, value), `Unexpected accounting state: ${JSON.stringify(value)}.`);
    output[value] += 1;
  }
  return output;
}

function normalizePhraseDecision(source, decision) {
  if (decision === "PENDING") return "PENDING";
  if (decision === "UPSTREAM_REVIEW") return "UPSTREAM_REVIEW";
  if (source === "CURRENT") {
    if (decision === "KEEP_CURRENT" || decision === "KEEP") return "KEEP";
    if (["REMOVE_CURRENT", "REMOVE_CURRENT_SEMANTIC_MISMATCH", "REMOVE"].includes(decision)) return "REMOVE";
  }
  if (source === "HISTORICAL_REMOVAL") {
    if (decision === "RESTORE") return "RESTORE";
    if (decision === "KEEP_REMOVED_SEMANTIC_MISMATCH") return "KEEP_REMOVED_SEMANTIC_MISMATCH";
  }
  if (source === "HISTORICAL_ADDITION") {
    if (decision === "KEEP_ADDED" || decision === "KEEP") return "KEEP";
    if (["REMOVE_ADDED", "REMOVE_ADDED_SEMANTIC_MISMATCH", "REMOVE"].includes(decision)) return "REMOVE";
  }
  fail(`Unexpected ${source} phrase decision ${JSON.stringify(decision)}.`);
}

function resolveBranchHead(mode, explicit, oldCheckpoint) {
  if (explicit) return explicit;
  if (mode === "check" && oldCheckpoint.branch_head_at_generation) return oldCheckpoint.branch_head_at_generation;
  const head = tryGit(["rev-parse", "HEAD"]);
  assert(head, "Cannot resolve branch HEAD; pass --branch-head explicitly.");
  return head;
}

function resolveMainSha(explicit) {
  if (explicit) return explicit;
  const sha = tryGit(["rev-parse", "origin/main"]);
  assert(sha, "Cannot resolve origin/main; pass --main-sha explicitly.");
  return sha;
}

function resolveMainVocabulary({ explicitPath, mainSha, auditBaseSha, baseText }) {
  if (explicitPath) {
    return readText(isAbsolute(explicitPath) ? explicitPath : resolve(ROOT, explicitPath));
  }
  if (mainSha === auditBaseSha) return baseText;
  return gitShow(mainSha, VOCAB_REL);
}

function idsMap(entries, label) {
  const map = new Map();
  for (const entry of entries) {
    assert(typeof entry.id === "string" && entry.id.length > 0, `${label} contains an entry with no ID.`);
    assert(!map.has(entry.id), `${label} contains duplicate ID ${entry.id}.`);
    map.set(entry.id, entry);
  }
  return map;
}

function semanticValue(entry, field) {
  if (field === "meaning_ja") return entry?.meaning_ja;
  return entry?.[field];
}

function build() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(MANIFEST_PATH);
  const oldCheckpoint = readJson(CHECKPOINT_PATH);
  const index = readJson(INDEX_PATH);
  const decisionsDocument = readJson(DECISIONS_PATH);
  const slotInventory = readJson(SLOT_INVENTORY_PATH);
  const slotCandidates = readJson(SLOT_CANDIDATES_PATH);
  const slotReview = readJson(SLOT_REVIEW_PATH);
  const slotSummary = readJson(SLOT_SUMMARY_PATH);
  const branchHead = resolveBranchHead(args.mode, args.branchHead, oldCheckpoint);
  const currentMainSha = resolveMainSha(args.mainSha);

  assert(Array.isArray(index.entries), "review-index.json must contain an entries array.");
  assert(Array.isArray(decisionsDocument.entries), "decisions.json must contain an entries array.");
  assert(Array.isArray(slotInventory) && slotInventory.length === 2478, "slot-inventory.json must cover all 2,478 production entries.");
  assert(Array.isArray(slotCandidates), "slot-candidates.json must contain an array.");
  assert(Array.isArray(slotReview), "slot-review.json must contain an array.");
  assert(slotSummary.production_source?.population === 2478, "slot-summary.json must report the 2,478-entry production population.");
  assert(slotSummary.production_source?.git_blob_sha === manifest.production_source?.git_blob_sha, "Slot inventory and audit base production SHA differ.");
  const unionPopulation = index.entries.length;
  const indexById = idsMap(index.entries, "review-index.json");
  const slotInventoryById = idsMap(slotInventory, "slot-inventory.json");
  const slotCandidateById = idsMap(slotCandidates, "slot-candidates.json");
  const slotReviewById = idsMap(slotReview, "slot-review.json");
  assert(slotInventoryById.size === 2478, "slot inventory contains duplicate or missing production IDs.");
  assert(slotCandidateById.size === slotReviewById.size, "Every slot candidate must have exactly one slot-review row.");
  for (const id of slotCandidateById.keys()) assert(slotReviewById.has(id), `Slot candidate ${id} has no human review row.`);
  for (const row of slotReview) {
    assert(["REVIEWED", "UPSTREAM", "PENDING"].includes(row.review_status), `Unknown slot review status for ${row.id}.`);
    if (row.review_status === "PENDING") continue;
    if (row.review_status === "UPSTREAM") assert(row.reason, `Upstream slot review ${row.id} requires a reason.`);
    else if (row.decision !== "UPSTREAM_SLOT_AUTHORITY_REVIEW") assert(row.recommended_prompt, `Reviewed slot row ${row.id} requires recommended_prompt.`);
  }
  const batchCount = manifest.populations?.batch_count;
  assert(Number.isInteger(batchCount) && batchCount > 0, "manifest.populations.batch_count must be a positive integer.");

  const batchDocuments = [];
  const batchIdByEntry = new Map();
  for (let number = 1; number <= batchCount; number += 1) {
    const batchId = `batch-${String(number).padStart(3, "0")}`;
    const document = readJson(resolve(BATCH_DIR, `${batchId}.json`));
    assert(document.batch_id === batchId, `${batchId}.json has unexpected batch_id ${JSON.stringify(document.batch_id)}.`);
    assert(Array.isArray(document.entries), `${batchId}.json must contain an entries array.`);
    for (const entry of document.entries) {
      assert(!batchIdByEntry.has(entry.id), `Entry ${entry.id} appears in multiple batch files.`);
      batchIdByEntry.set(entry.id, batchId);
    }
    batchDocuments.push(document);
  }
  const batchEntries = batchDocuments.flatMap((batch) => batch.entries);
  const batchById = idsMap(batchEntries, "batch files");
  const decisionsById = idsMap(decisionsDocument.entries, "decisions.json");

  const indexIds = new Set(indexById.keys());
  const batchIds = new Set(batchById.keys());
  const unknownIds = [...batchIds].filter((id) => !indexIds.has(id)).sort();
  const missingBatchIds = [...indexIds].filter((id) => !batchIds.has(id)).sort();
  assert(unknownIds.length === 0, `Batch files contain ${unknownIds.length} unknown IDs: ${unknownIds.slice(0, 5).join(", ")}.`);
  assert(missingBatchIds.length === 0, `Batch files omit ${missingBatchIds.length} review-index IDs: ${missingBatchIds.slice(0, 5).join(", ")}.`);

  for (const [id, indexed] of indexById) {
    const detail = batchById.get(id);
    assert(ALLOWED_REVIEW_STATUSES.has(indexed.review_status), `Unknown review-index status for ${id}: ${JSON.stringify(indexed.review_status)}.`);
    assert(detail.review_status === indexed.review_status, `Review status differs between review-index and batch for ${id}.`);
    const indexDecision = indexed.entry_decision ?? (indexed.review_status === "PENDING" ? "PENDING" : null);
    assert(detail.entry_decision === indexDecision, `Entry decision differs between review-index and batch for ${id}.`);
    assert(stableStringify(detail.cohort_flags) === stableStringify(indexed.cohort_flags), `Cohort flags differ between review-index and batch for ${id}.`);
    assert(batchIdByEntry.get(id) === indexed.batch, `Batch assignment differs between review-index and batch for ${id}.`);
    if (indexed.cohort_flags?.current_parenthetical === true) {
      const parentheticalStatus = detail.parenthetical_review?.review_status
        ?? (detail.parenthetical_review?.parenthetical_decision === "PENDING" ? "PENDING" : null);
      assert(parentheticalStatus === indexed.review_status, `Parenthetical review status differs from review-index for ${id}.`);
    }
    assert(indexed.slot_integrity_checked === true, `Union entry ${id} has not passed the slot gate.`);
    assert(indexed.slot_reconciliation_status, `Union entry ${id} has no slot reconciliation status.`);
    const inventoryRow = slotInventoryById.get(id);
    assert(inventoryRow, `Slot inventory is missing union entry ${id}.`);
    if (inventoryRow.mechanical_status === "CANDIDATE") {
      const slotRow = slotReviewById.get(id);
      assert(slotRow && ["REVIEWED", "UPSTREAM"].includes(slotRow.review_status), `Union candidate ${id} is not dispositioned for slot integrity.`);
    }
  }

  const slotCandidateStatuses = countStatuses(slotReview);
  const slotCoverage = {
    production_inventory_population: slotInventory.length,
    entries_with_candidate_tokens: slotSummary.slot_notation_inventory.entries_with_candidate_tokens,
    variable_slot_entries: slotSummary.slot_notation_inventory.variable_slot_entries,
    lexical_placeholder_entries: slotSummary.slot_notation_inventory.lexical_placeholder_entries,
    ambiguous_entries: slotSummary.slot_notation_inventory.ambiguous_entries,
    ambiguous_resolved: slotSummary.slot_notation_inventory.ambiguous_resolved,
    mechanical_candidates: slotCandidates.length,
    reviewed: slotCandidateStatuses.reviewed,
    upstream: slotCandidateStatuses.upstream,
    pending: slotCandidateStatuses.pending,
    confirmed_defect_entries: slotSummary.candidates.confirmed_defect_entries,
    unresolved_defect_entries: slotSummary.candidates.unresolved_defect_entries,
    mechanical_candidate_counts: slotSummary.candidates.by_violation_class,
    confirmed_violation_counts: slotSummary.candidates.confirmed_by_violation_class,
    union_entries_slot_checked: index.entries.filter((entry) => entry.slot_integrity_checked === true).length,
    union_entries_slot_pending: index.entries.filter((entry) => entry.slot_integrity_checked !== true).length,
    reviewed_40_slot_bearing_checked: slotSummary.union_coverage.reviewed_40_slot_bearing_checked,
    reviewed_40_reconciliation_count: slotSummary.union_coverage.reviewed_40_reconciliation_count,
  };
  assert(slotCoverage.union_entries_slot_checked === unionPopulation, "Not all union entries are slot checked.");
  assert(slotCoverage.union_entries_slot_pending === 0, "Some union entries remain pending the slot gate.");
  assert(slotCoverage.pending === 0 && slotCoverage.unresolved_defect_entries === 0, "Slot candidate review is incomplete.");

  assert(manifest.populations.union_entries === unionPopulation, `Manifest union population ${manifest.populations.union_entries} does not match review-index ${unionPopulation}.`);
  const entryCoverage = countStatuses(index.entries);
  assert(entryCoverage.reviewed + entryCoverage.upstream + entryCoverage.pending === unionPopulation, "Union review accounting does not sum to the review-index population.");

  const cohortSpecs = [
    ["current_parenthetical_entries", "current_parenthetical"],
    ["previous_nuance_materialized_ids", "previous_nuance_materialized"],
  ];
  const cohortPopulations = {};
  const cohortCoverage = {};
  for (const [populationKey, flag] of cohortSpecs) {
    const cohortEntries = index.entries.filter((entry) => entry.cohort_flags?.[flag] === true);
    const statusCounts = countStatuses(cohortEntries);
    cohortPopulations[populationKey] = cohortEntries.length;
    cohortCoverage[populationKey] = statusCounts;
    assert(statusCounts.reviewed + statusCounts.upstream + statusCounts.pending === cohortEntries.length, `${flag} accounting does not sum to its population.`);
    assert(manifest.populations[populationKey] === cohortEntries.length, `Manifest ${populationKey} does not match review-index flags.`);
  }

  const perBatch = batchDocuments.map((batch) => {
    const entries = index.entries.filter((entry) => entry.batch === batch.batch_id);
    assert(entries.length === batch.entries.length, `${batch.batch_id} index coverage does not match its batch entry count.`);
    const state = countStatuses(entries);
    assert(state.reviewed + state.upstream + state.pending === entries.length, `${batch.batch_id} accounting does not sum to entry_count.`);
    return { batch_id: batch.batch_id, entry_count: entries.length, ...state };
  });

  const decisionKeys = [
    "KEEP",
    "PROMPT_SIMPLIFY",
    "PARAPHRASE_RESTORE",
    "PROMPT_AND_PARAPHRASE_RECONCILE",
    "PARAPHRASE_REMOVE_SEMANTIC",
    "UPSTREAM_AUTHORITY_REVIEW",
  ];
  const entryDecisionCounts = countBy(index.entries.map((entry) => entry.entry_decision), decisionKeys);
  const parentheticalDecisionKeys = [
    "REMOVE_META_HINT",
    "REWRITE_MINIMAL_SEMANTIC",
    "KEEP_SEMANTIC_SCOPE",
    "UPSTREAM_MEANING_REVIEW",
  ];
  const parentheticalDecisionCounts = countBy(
    batchEntries
      .filter((entry) => entry.cohort_flags?.current_parenthetical === true)
      .map((entry) => entry.parenthetical_review?.parenthetical_decision),
    parentheticalDecisionKeys,
  );
  const confidenceCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, MISSING: 0 };
  for (const entry of index.entries.filter((row) => row.review_status === "REVIEWED")) {
    const decision = decisionsById.get(entry.id);
    assert(decision, `No decision projection exists for ${entry.id}.`);
    assert(decision.review_status === entry.review_status, `Decision review status differs for ${entry.id}.`);
    const confidence = decision.confidence;
    confidenceCounts[confidence === "HIGH" || confidence === "MEDIUM" || confidence === "LOW" ? confidence : "MISSING"] += 1;
  }
  const workerDecisionRows = decisionsDocument.entries.filter((entry) => entry.provenance?.authority_type === "PARALLEL_WORKER");
  const workerRefs = new Map();
  for (const entry of workerDecisionRows) {
    const provenance = entry.provenance;
    assert(provenance.worker_id && provenance.branch && provenance.branch_head && provenance.claim_sha256 && provenance.parallel_review_base_sha,
      `Worker provenance is incomplete for ${entry.id}.`);
    const prior = workerRefs.get(provenance.worker_id);
    const current = {
      worker_id: provenance.worker_id,
      branch: provenance.branch,
      branch_head: provenance.branch_head,
      claim_sha256: provenance.claim_sha256,
      parallel_review_base_sha: provenance.parallel_review_base_sha,
    };
    if (prior) assert(JSON.stringify(prior) === JSON.stringify(current), `Worker provenance drifts within ${provenance.worker_id}.`);
    else workerRefs.set(provenance.worker_id, current);
  }
  const workerWave = {
    status: workerDecisionRows.length === 548 && workerRefs.size === 10 ? "COMPLETE" : "IN_PROGRESS",
    workers: workerRefs.size,
    imported_judgments: workerDecisionRows.length,
    production_changes: 0,
    branch_heads: [...workerRefs.values()].sort((a, b) => a.worker_id.localeCompare(b.worker_id)),
  };

  const phraseRows = [];
  const expectedPhraseKeys = new Set();
  const phraseKey = (id, phrase, source) => JSON.stringify([id, phrase, source]);
  const addExpected = (entry, phrase, source) => {
    assert(typeof phrase === "string" && phrase.length > 0, `${entry.id} has an empty ${source} phrase.`);
    const key = phraseKey(entry.id, phrase, source);
    assert(!expectedPhraseKeys.has(key), `Duplicate source phrase pair ${entry.id} + ${phrase} + ${source}.`);
    expectedPhraseKeys.add(key);
  };

  for (const entry of batchEntries) {
    for (const phrase of entry.current_paraphrases ?? []) addExpected(entry, phrase, "CURRENT");
    for (const phrase of entry.historically_removed_paraphrases ?? []) addExpected(entry, phrase, "HISTORICAL_REMOVAL");
    for (const phrase of entry.historically_added_paraphrases ?? []) addExpected(entry, phrase, "HISTORICAL_ADDITION");
    for (const row of entry.paraphrase_review ?? []) {
      assert(["CURRENT", "HISTORICAL_REMOVAL", "HISTORICAL_ADDITION"].includes(row.source), `Unknown phrase source ${JSON.stringify(row.source)} for ${entry.id}.`);
      phraseRows.push({ id: entry.id, ...row });
    }
  }

  const seenPhraseKeys = new Set();
  const phraseStates = { CURRENT: [], HISTORICAL_REMOVAL: [], HISTORICAL_ADDITION: [] };
  for (const row of phraseRows) {
    const key = phraseKey(row.id, row.phrase, row.source);
    assert(!seenPhraseKeys.has(key), `Duplicate phrase review ${row.id} + ${row.phrase} + ${row.source}.`);
    seenPhraseKeys.add(key);
    assert(expectedPhraseKeys.has(key), `Unexpected phrase review ${row.id} + ${row.phrase} + ${row.source}.`);
    phraseStates[row.source].push(normalizePhraseDecision(row.source, row.decision));
  }
  const missingPhraseRows = [...expectedPhraseKeys].filter((key) => !seenPhraseKeys.has(key));
  assert(missingPhraseRows.length === 0, `${missingPhraseRows.length} source phrases have no phrase-review row.`);

  const currentPhraseKeys = ["KEEP", "REMOVE", "UPSTREAM_REVIEW", "PENDING"];
  const removalPhraseKeys = ["RESTORE", "KEEP_REMOVED_SEMANTIC_MISMATCH", "UPSTREAM_REVIEW", "PENDING"];
  const additionPhraseKeys = ["KEEP", "REMOVE", "UPSTREAM_REVIEW", "PENDING"];
  const currentPhraseCounts = countBy(phraseStates.CURRENT, currentPhraseKeys);
  const historicalRemovalCounts = countBy(phraseStates.HISTORICAL_REMOVAL, removalPhraseKeys);
  const historicalAdditionCounts = countBy(phraseStates.HISTORICAL_ADDITION, additionPhraseKeys);
  const phraseCoverage = {
    CURRENT: {
      population: phraseStates.CURRENT.length,
      decisions: currentPhraseCounts,
      resolved: currentPhraseCounts.KEEP + currentPhraseCounts.REMOVE + currentPhraseCounts.UPSTREAM_REVIEW,
      pending: currentPhraseCounts.PENDING,
    },
    HISTORICAL_REMOVAL: {
      population: phraseStates.HISTORICAL_REMOVAL.length,
      ...historicalRemovalCounts,
      dispositioned: historicalRemovalCounts.RESTORE + historicalRemovalCounts.KEEP_REMOVED_SEMANTIC_MISMATCH + historicalRemovalCounts.UPSTREAM_REVIEW,
    },
    HISTORICAL_ADDITION: {
      population: phraseStates.HISTORICAL_ADDITION.length,
      ...historicalAdditionCounts,
      checked: historicalAdditionCounts.KEEP + historicalAdditionCounts.REMOVE + historicalAdditionCounts.UPSTREAM_REVIEW,
    },
  };
  for (const [source, report, keys] of [
    ["CURRENT", phraseCoverage.CURRENT, currentPhraseKeys],
    ["HISTORICAL_REMOVAL", phraseCoverage.HISTORICAL_REMOVAL, removalPhraseKeys],
    ["HISTORICAL_ADDITION", phraseCoverage.HISTORICAL_ADDITION, additionPhraseKeys],
  ]) {
    assert(keys.reduce((sum, key) => sum + (source === "CURRENT" ? report.decisions[key] : report[key]), 0) === report.population, `${source} phrase accounting does not sum to its population.`);
  }
  if (manifest.populations.previous_historical_removed_phrase_entries !== undefined) {
    assert(phraseCoverage.HISTORICAL_REMOVAL.population === manifest.populations.previous_historical_removed_phrase_entries, "Historical removal population does not match manifest cohort source.");
  }
  if (manifest.populations.previous_historical_added_phrase_entries !== undefined) {
    assert(phraseCoverage.HISTORICAL_ADDITION.population === manifest.populations.previous_historical_added_phrase_entries, "Historical addition population does not match manifest cohort source.");
  }

  const leakageIds = new Set(batchEntries
    .filter((entry) => entry.cohort_flags?.current_parenthetical === true)
    .filter((entry) => (entry.current_parenthetical_segments ?? []).some((segment) => /[A-Za-z]/.test(segment)))
    .map((entry) => entry.id));
  const leakageItems = index.entries.filter((entry) => leakageIds.has(entry.id));
  const leakageStatus = countStatuses(leakageItems);
  const targetLeakage = {
    found: leakageItems.length,
    resolved: leakageStatus.reviewed,
    pending: leakageStatus.pending + leakageStatus.upstream,
    upstream: leakageStatus.upstream,
    entry_ids: [...leakageIds].sort(),
  };

  const metaHintItems = batchEntries.filter((entry) => {
    if (entry.cohort_flags?.current_parenthetical !== true) return false;
    const decision = entry.parenthetical_review?.parenthetical_decision;
    return (decision === "REMOVE_META_HINT" && !leakageIds.has(entry.id)) || decision === "UPSTREAM_MEANING_REVIEW";
  });
  const metaHintIds = new Set(metaHintItems.map((entry) => entry.id));
  const metaHintStatus = countStatuses(index.entries.filter((entry) => metaHintIds.has(entry.id)));
  const metaHint = {
    found: metaHintItems.length,
    resolved: metaHintStatus.reviewed,
    upstream: metaHintStatus.upstream,
    pending: metaHintStatus.pending,
    entry_ids: [...metaHintIds].sort(),
  };

  const baseText = readText(VOCAB_PATH);
  const baseBlobSha = gitBlobSha(baseText);
  const knownBaseBlobSha = manifest.production_source?.git_blob_sha;
  assert(baseBlobSha === knownBaseBlobSha, `Production source differs from the immutable audit base: expected ${knownBaseBlobSha}, found ${baseBlobSha}.`);
  const productionChanges = 0;
  const baseVocabulary = readJson(VOCAB_PATH);
  assert(Array.isArray(baseVocabulary.entries), "Audit-base vocabulary must contain an entries array.");
  const baseById = idsMap(baseVocabulary.entries, "audit-base vocabulary");
  const mainText = resolveMainVocabulary({ explicitPath: args.mainVocabulary, mainSha: currentMainSha, auditBaseSha: manifest.audit_base_main_sha, baseText });
  const mainVocabulary = JSON.parse(mainText);
  assert(Array.isArray(mainVocabulary.entries), "Current-main vocabulary must contain an entries array.");
  const mainById = idsMap(mainVocabulary.entries, "current-main vocabulary");
  const staleFields = new Map();
  for (const id of indexIds) {
    const baseEntry = baseById.get(id);
    const mainEntry = mainById.get(id);
    const changed = DIVERGENCE_FIELDS.filter((field) => stableStringify(semanticValue(baseEntry, field) ?? null) !== stableStringify(semanticValue(mainEntry, field) ?? null));
    if (changed.length > 0) staleFields.set(id, changed);
  }
  const stale = {
    definition: "Entries whose audited semantic fields changed on current main after the audit base was frozen.",
    checked_main_sha: currentMainSha,
    count: staleFields.size,
    entry_ids: [...staleFields.keys()].sort(),
    changed_fields: Object.fromEntries([...staleFields.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };

  const materializationText = readText(MATERIALIZATION_PATH);
  const materializationBlobSha = gitBlobSha(materializationText);
  const expectedMaterializationSha = manifest.previous_materialization?.materialization_git_blob_sha;
  assert(materializationBlobSha === expectedMaterializationSha, `Previous materialization snapshot changed: expected ${expectedMaterializationSha}, found ${materializationBlobSha}.`);
  const materialization = JSON.parse(materializationText);
  assert(Array.isArray(materialization.entries), "Previous materialization must contain an entries array.");
  const materializedById = idsMap(materialization.entries, "previous materialization");
  const materializedIds = index.entries.filter((entry) => entry.cohort_flags?.previous_nuance_materialized === true).map((entry) => entry.id);
  assert(materializedById.size === materializedIds.length, "Previous materialization population does not match the audit cohort.");
  for (const id of materializedIds) assert(materializedById.has(id), `Previous materialization is missing ${id}.`);

  const fieldMismatchCounts = Object.fromEntries(DIVERGENCE_FIELDS.map((field) => [field, 0]));
  const divergentIds = new Set();
  for (const [id, oldEntry] of materializedById) {
    const baseEntry = baseById.get(id);
    assert(baseEntry, `Audit-base production is missing materialized ID ${id}.`);
    for (const field of DIVERGENCE_FIELDS) {
      if (stableStringify(semanticValue(oldEntry.after, field) ?? null) !== stableStringify(semanticValue(baseEntry, field) ?? null)) {
        fieldMismatchCounts[field] += 1;
        divergentIds.add(id);
      }
    }
  }
  const historicalDivergence = {
    comparison: {
      from: "previous_materialization_after",
      to: "audit_base_production",
      fields: DIVERGENCE_FIELDS,
    },
    mismatched_entries: divergentIds.size,
    field_mismatch_counts: fieldMismatchCounts,
    semantic_authority_effect: "informational_only",
  };

  const currentParenthetical = cohortPopulations.current_parenthetical_entries;
  const previousMaterialized = cohortPopulations.previous_nuance_materialized_ids;
  const parentheticalSegmentPopulation = batchEntries.reduce((sum, entry) => sum + (entry.current_parenthetical_segments ?? []).length, 0);
  const workerNewAdditionPopulation = batchEntries
    .filter((entry) => decisionsById.get(entry.id)?.provenance?.authority_type === "PARALLEL_WORKER")
    .reduce((sum, entry) => sum + (entry.new_addition_candidates ?? []).length, 0);
  const coverage = {
    entries: entryCoverage,
    cohorts: cohortCoverage,
    batches: perBatch,
    entry_decisions: entryDecisionCounts,
    parenthetical_decisions: parentheticalDecisionCounts,
    confidence: confidenceCounts,
    worker_wave: workerWave,
    phrases: phraseCoverage,
    target_leakage: targetLeakage,
    meta_hint: metaHint,
    integrity: {
      duplicate_entry_ids: 0,
      duplicate_phrase_keys: 0,
      unknown_ids: unknownIds.length,
      missing_batch_ids: missingBatchIds.length,
      reviewed_confidence_low: confidenceCounts.LOW,
      reviewed_confidence_missing: confidenceCounts.MISSING,
    },
  };

  const reviewComplete = entryCoverage.pending === 0;
  const auditStatus = reviewComplete
    ? "SEMANTIC_REVIEW_COMPLETE_PENDING_FINAL_RECONCILIATION"
    : "PARTIAL_SEMANTIC_REVIEW";
  const nextStep = reviewComplete
    ? "Run latest-main drift reconciliation, revalidate only affected IDs, resolve vocab:00083 upstream authority, and run strict final validation. Keep production unchanged and do not mark the audit closed."
    : `Continue semantic review of the ${entryCoverage.pending} PENDING union entries with the slot integrity gate applied. Keep vocab:00083 isolated for upstream authority review; do not mark the audit closed.`;
  const progress = {
    schema_version: 2,
    status: auditStatus,
    audit_base_main_sha: manifest.audit_base_main_sha,
    branch_head_at_generation: branchHead,
    current_main_sha: currentMainSha,
    source_vocabulary_git_blob_sha: baseBlobSha,
    union_population: unionPopulation,
    review: entryCoverage,
    batches: perBatch,
    entry_decisions: entryDecisionCounts,
    parenthetical_decisions: parentheticalDecisionCounts,
    confidence: confidenceCounts,
    worker_wave: workerWave,
    parenthetical: { population: currentParenthetical, ...cohortCoverage.current_parenthetical_entries },
    previous_materialized: { population: previousMaterialized, ...cohortCoverage.previous_nuance_materialized_ids },
    phrases: phraseCoverage,
    target_leakage: targetLeakage,
    meta_hint: metaHint,
    slot_integrity: slotCoverage,
    historical_materialization_divergence: historicalDivergence,
    stale,
    production_changes: productionChanges,
    semantic_decision_changes: 0,
    next_step: nextStep,
  };

  const nextManifest = {
    ...manifest,
    schema_version: 2,
    status: auditStatus,
    branch_head_at_generation: branchHead,
    populations: {
      union_entries: unionPopulation,
      current_parenthetical_entries: currentParenthetical,
      previous_nuance_materialized_ids: previousMaterialized,
      batch_size: manifest.populations.batch_size,
      batch_count: batchDocuments.length,
      source_order: manifest.populations.source_order,
    },
    coverage,
    aggregation: {
      worker_wave: workerWave,
      entry_decisions: entryDecisionCounts,
      parenthetical_decisions: parentheticalDecisionCounts,
      confidence: confidenceCounts,
    },
    historical_materialization_divergence: historicalDivergence,
    slot_integrity: slotCoverage,
    stale,
    production_changes: productionChanges,
  };
  delete nextManifest.drift_at_base;
  for (const key of [
    "reviewed_entries", "missing_entries", "stale_entries", "duplicate_review", "unknown_ids",
    "parenthetical_reviewed", "previous_materialized_ids_reviewed",
    "historical_removed_phrase_entries_dispositioned", "historical_added_phrase_entries_checked",
    "upstream_isolated_entries", "parenthetical_upstream_isolated", "previous_materialized_ids_upstream_isolated",
    "target_leakage_cases_found", "target_leakage_cases_resolved", "meta_hint_cases_found", "meta_hint_cases_resolved",
    "upstream_authority_review_count", "paraphrase_disposition_counts", "parenthetical_decision_counts", "review_confidence_counts",
  ]) delete nextManifest[key];

  const nextCheckpoint = {
    schema_version: 2,
    status: auditStatus,
    audit_base_main_sha: manifest.audit_base_main_sha,
    branch_head_at_generation: branchHead,
    current_main_sha: currentMainSha,
    source_vocabulary_git_blob_sha: baseBlobSha,
    union_population: unionPopulation,
    review: entryCoverage,
    batches: perBatch,
    entry_decisions: entryDecisionCounts,
    parenthetical_decisions: parentheticalDecisionCounts,
    confidence: confidenceCounts,
    worker_wave: workerWave,
    parenthetical: { population: currentParenthetical, ...cohortCoverage.current_parenthetical_entries },
    previous_materialized: { population: previousMaterialized, ...cohortCoverage.previous_nuance_materialized_ids },
    historical_removals: phraseCoverage.HISTORICAL_REMOVAL,
    historical_additions: phraseCoverage.HISTORICAL_ADDITION,
    current_paraphrases: phraseCoverage.CURRENT,
    target_leakage: targetLeakage,
    meta_hint: metaHint,
    historical_materialization_divergence: historicalDivergence,
    slot_integrity: slotCoverage,
    stale,
    production_changes: productionChanges,
    semantic_decision_changes: 0,
    next_step: nextStep,
  };

  const summary = [
    "# Japanese Prompt Authority Reconciliation — Progress Accounting",
    "",
    `Status: **${auditStatus}**. ${reviewComplete ? "Semantic review is complete; latest-main reconciliation and strict final validation are pending." : "Semantic review remains in progress."} This file is a deterministic human-readable projection of checkpoint.json.`,
    "",
    `- Audit base: \`${manifest.audit_base_main_sha}\``,
    `- Progress generated from branch head: \`${branchHead}\``,
    `- Union: ${unionPopulation}; REVIEWED ${entryCoverage.reviewed}; UPSTREAM ${entryCoverage.upstream}; PENDING ${entryCoverage.pending}; resolved ${entryCoverage.resolved}`,
    `- Dispositioned: ${entryCoverage.resolved}/${unionPopulation}; PENDING ${entryCoverage.pending}`,
    `- Entry decisions: ${Object.entries(entryDecisionCounts).map(([key, value]) => `${key} ${value}`).join("; ")}`,
    `- Parenthetical decisions: ${Object.entries(parentheticalDecisionCounts).map(([key, value]) => `${key} ${value}`).join("; ")}`,
    `- Parallel worker wave: ${workerWave.status}; ${workerWave.imported_judgments} judgments from ${workerWave.workers} workers; production changes ${workerWave.production_changes}`,
    `- Reviewed-entry confidence: HIGH ${confidenceCounts.HIGH}; MEDIUM ${confidenceCounts.MEDIUM}; LOW ${confidenceCounts.LOW}; missing ${confidenceCounts.MISSING}`,
    `- Current parenthetical: ${currentParenthetical}; reviewed ${cohortCoverage.current_parenthetical_entries.reviewed}; upstream ${cohortCoverage.current_parenthetical_entries.upstream}; pending ${cohortCoverage.current_parenthetical_entries.pending}; resolved ${cohortCoverage.current_parenthetical_entries.resolved}`,
    `- Parenthetical decisions fully dispositioned: ${cohortCoverage.current_parenthetical_entries.resolved}/${currentParenthetical} entries; ${parentheticalSegmentPopulation} current segments`,
    `- Previous materialized IDs: ${previousMaterialized}; reviewed ${cohortCoverage.previous_nuance_materialized_ids.reviewed}; upstream ${cohortCoverage.previous_nuance_materialized_ids.upstream}; pending ${cohortCoverage.previous_nuance_materialized_ids.pending}; resolved ${cohortCoverage.previous_nuance_materialized_ids.resolved}`,
    `- Historical removed phrases: ${phraseCoverage.HISTORICAL_REMOVAL.population}; RESTORE ${phraseCoverage.HISTORICAL_REMOVAL.RESTORE}; KEEP_REMOVED_SEMANTIC_MISMATCH ${phraseCoverage.HISTORICAL_REMOVAL.KEEP_REMOVED_SEMANTIC_MISMATCH}; UPSTREAM_REVIEW ${phraseCoverage.HISTORICAL_REMOVAL.UPSTREAM_REVIEW}; PENDING ${phraseCoverage.HISTORICAL_REMOVAL.PENDING}`,
    `- Historical added phrases: ${phraseCoverage.HISTORICAL_ADDITION.population}; checked ${phraseCoverage.HISTORICAL_ADDITION.checked}; KEEP ${phraseCoverage.HISTORICAL_ADDITION.KEEP}; REMOVE ${phraseCoverage.HISTORICAL_ADDITION.REMOVE}; UPSTREAM_REVIEW ${phraseCoverage.HISTORICAL_ADDITION.UPSTREAM_REVIEW}; PENDING ${phraseCoverage.HISTORICAL_ADDITION.PENDING}`,
    `- Current paraphrase review (kept separate): ${phraseCoverage.CURRENT.population}; resolved ${phraseCoverage.CURRENT.resolved}; pending ${phraseCoverage.CURRENT.pending}`,
    `- Historical removals fully dispositioned: ${phraseCoverage.HISTORICAL_REMOVAL.dispositioned}/${phraseCoverage.HISTORICAL_REMOVAL.population}`,
    `- Historical additions fully dispositioned: ${phraseCoverage.HISTORICAL_ADDITION.checked}/${phraseCoverage.HISTORICAL_ADDITION.population}`,
    `- Current paraphrases fully dispositioned: ${phraseCoverage.CURRENT.resolved}/${phraseCoverage.CURRENT.population}; worker new additions ${workerNewAdditionPopulation}`,
    `- Target leakage: found ${targetLeakage.found}; resolved ${targetLeakage.resolved}; pending ${targetLeakage.pending}`,
    `- Meta-hint: found ${metaHint.found}; resolved ${metaHint.resolved}; upstream ${metaHint.upstream}; pending ${metaHint.pending}`,
    `- Full production slot inventory: ${slotCoverage.production_inventory_population}; token-bearing entries ${slotCoverage.entries_with_candidate_tokens}; VARIABLE_SLOT entries ${slotCoverage.variable_slot_entries}; LEXICAL_TOKEN entries ${slotCoverage.lexical_placeholder_entries}; AMBIGUOUS entries ${slotCoverage.ambiguous_entries} (resolved ${slotCoverage.ambiguous_resolved})`,
    `- Slot candidates: ${slotCoverage.mechanical_candidates}; reviewed ${slotCoverage.reviewed}; upstream ${slotCoverage.upstream}; pending ${slotCoverage.pending}; confirmed defect entries ${slotCoverage.confirmed_defect_entries}; unresolved ${slotCoverage.unresolved_defect_entries}`,
    `- Confirmed slot violations: ${JSON.stringify(slotCoverage.confirmed_violation_counts)}`,
    `- Union slot gate: ${slotCoverage.union_entries_slot_checked}/${unionPopulation}; pending ${slotCoverage.union_entries_slot_pending}; reviewed-40 slot-bearing checked ${slotCoverage.reviewed_40_slot_bearing_checked}; reviewed-40 reconciliations ${slotCoverage.reviewed_40_reconciliation_count}`,
    `- Historical materialization divergence: ${historicalDivergence.mismatched_entries} entries; field mismatches ${JSON.stringify(fieldMismatchCounts)}. Informational only; these are not stale entries.`,
    `- Stale since audit base on current main (${currentMainSha}): ${stale.count}`,
    `- Slot integrity: ${slotCoverage.union_entries_slot_checked}/${unionPopulation} checked; confirmed defects integrated ${slotCoverage.confirmed_defect_entries}; unresolved conflicts ${slotCoverage.unresolved_defect_entries}`,
    `- Production changes: ${productionChanges}; production unchanged; worker judgments imported: ${workerWave.imported_judgments}`,
    `- Audit closure: pending; latest-main reconciliation and strict final validation are not yet complete.`,
    `- Per-batch review: ${perBatch.map((batch) => `${batch.batch_id} ${batch.reviewed}/${batch.upstream}/${batch.pending}`).join("; ")} (reviewed/upstream/pending)`,
    `- Next step: ${nextStep}`,
    "",
  ].join("\n");

  return {
    mode: args.mode,
    files: new Map([
      [MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`],
      [CHECKPOINT_PATH, `${JSON.stringify(nextCheckpoint, null, 2)}\n`],
      [SUMMARY_PATH, summary],
    ]),
    metrics: progress,
  };
}

try {
  const result = build();
  if (result.mode === "write") {
    for (const [path, content] of result.files) writeFileSync(path, content);
    console.log(`WROTE ${result.files.size} derived progress artifacts.`);
  } else {
    const mismatches = [];
    for (const [path, expected] of result.files) {
      let actual = "";
      try { actual = readFileSync(path, "utf8"); } catch { /* report as a mismatch below */ }
      if (actual !== expected) mismatches.push(path.replace(`${ROOT}/`, ""));
    }
    if (mismatches.length > 0) fail(`Derived artifacts differ from deterministic output: ${mismatches.join(", ")}. Run with --write.`);
    console.log("PASS: derived progress artifacts match deterministic output.");
  }
  console.log(JSON.stringify(result.metrics, null, 2));
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
