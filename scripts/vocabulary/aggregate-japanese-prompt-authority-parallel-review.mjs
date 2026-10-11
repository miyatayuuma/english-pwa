#!/usr/bin/env node

/** Deterministic projection of pinned parallel worker reviews into the canonical audit. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_REL = "data/audits/vocabulary-japanese-prompt-authority-reconciliation";
const AUDIT_DIR = resolve(ROOT, AUDIT_REL);
const PARALLEL_DIR = resolve(AUDIT_DIR, "parallel");
const BASE_MAIN_SHA = "9007e2f59cc6bfc48e7021caa3b469dae89adb60";
const PARALLEL_BASE_SHA = "8ea0e6a4521059144d818e8cbca5e23e9e69dce0";
const PRODUCTION_BLOB_SHA = "c23643d26e71be22aaec5ec04ce63a7582ad9c25";
const SLOT_INVENTORY_BLOB_SHA = "b140b2b8d0c558570d133d21b01c7b4db63c7f2e";
const SLOT_REVIEW_BLOB_SHA = "14b4672692088e16a9e000b4d143bc1377defe13";
export const EXPECTED_WORKERS = [
  ["01", "audit/japanese-prompt-authority-worker-01", "c64dfa56ebeec9b14514ed7927db529303d56d94"],
  ["02", "audit/japanese-prompt-authority-worker-02", "6c506e07ff22721fb33df58d86d36ddd891a4454"],
  ["03", "audit/japanese-prompt-authority-worker-03", "56745c9ffcbfce91b1da74b0a42e71e0d7a9917e"],
  ["04", "audit/japanese-prompt-authority-worker-04", "c14d4e24b343fb0bb79a8c753fb23329b63fb7c1"],
  ["05", "audit/japanese-prompt-authority-worker-05", "b1ac88fed80b09007d263a05d0aa218d64c55ae8"],
  ["06", "audit/japanese-prompt-authority-worker-06", "d112ecf455edb91fb2823bb02a5aefc28427f42f"],
  ["07", "audit/japanese-prompt-authority-worker-07", "dad0b6c97a79475d39a953f442464a460b61ec38"],
  ["08", "audit/japanese-prompt-authority-worker-08", "fdc9e713f4e16f2b8618f1fb1e9a776cae0f824e"],
  ["09", "audit/japanese-prompt-authority-worker-09", "49fa8bdc3da464e574cecf350477d1a64fb16864"],
  ["10", "audit/japanese-prompt-authority-worker-10", "71b4971e5b7a10a206b3c3981bf6c10b3a4b6f55"],
].map(([worker_id, branch, branch_head]) => ({ worker_id: `W${worker_id}`, branch, branch_head }));

const DECISION_KEYS = ["KEEP", "PROMPT_SIMPLIFY", "PARAPHRASE_RESTORE", "PROMPT_AND_PARAPHRASE_RECONCILE", "PARAPHRASE_REMOVE_SEMANTIC", "UPSTREAM_AUTHORITY_REVIEW"];
const PARENTHETICAL_KEYS = ["REMOVE_META_HINT", "REWRITE_MINIMAL_SEMANTIC", "KEEP_SEMANTIC_SCOPE", "UPSTREAM_MEANING_REVIEW"];
const PHRASE_SOURCES = ["CURRENT", "HISTORICAL_REMOVAL", "HISTORICAL_ADDITION", "NEW_ADDITION"];
const IMMUTABLE_FIELDS = [
  "id", "source_index", "canonical", "sense_key", "grammarRole", "current_meaning_ja",
  "current_paraphrases", "current_parenthetical_segments", "cohort_flags", "previous_nuance_before",
  "previous_nuance_after", "historically_removed_paraphrases", "historically_added_paraphrases",
];
const META_HINT = /(倒置|構文|文型|語順|文法|時制|不定詞|動名詞|分詞構文|関係代名詞|受動態|能動態|比較級|最上級|可算|不可算|countability|register|dialect|方言|口語|文語|米語|英語圏|アメリカ英語|イギリス英語|敬語|丁寧語|古風|発音|強勢|語形|スペリング|表現法|構文上)/i;

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readText(path) { try { return readFileSync(path, "utf8"); } catch (error) { fail(`Cannot read ${path}: ${error.message}`); } }
function readJson(path) { try { return JSON.parse(readText(path)); } catch (error) { fail(`Cannot parse JSON ${path}: ${error.message}`); } }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a, b) { return stableStringify(a) === stableStringify(b); }
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return right.size === b.length && new Set(a).size === a.length && a.every((value) => right.has(value));
}
function uniqueMap(items, keyOf, label) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    assert(!map.has(key), `${label} has duplicate key ${key}.`);
    map.set(key, item);
  }
  return map;
}
function tally(items, keyOf) {
  const counts = {};
  for (const item of items) { const key = keyOf(item); counts[key] = (counts[key] || 0) + 1; }
  return counts;
}
function sha1GitBlob(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function sha256(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }
function phraseKey(id, source, phrase) { return JSON.stringify([id, source, phrase]); }
function validConfidence(value) { return ["HIGH", "MEDIUM", "LOW"].includes(value); }

export function deriveEntryConfidence(review) {
  if (validConfidence(review?.confidence)) return review.confidence;
  if (validConfidence(review?.review_confidence)) return review.review_confidence;
  const values = [];
  const parenthetical = review?.parenthetical_review || {};
  if (!parenthetical.parenthetical_decision || !["PENDING", "NOT_APPLICABLE", "NO_PARENTHESES"].includes(parenthetical.parenthetical_decision)) {
    if (validConfidence(parenthetical.prompt_confidence)) values.push(parenthetical.prompt_confidence);
  }
  for (const phrase of review?.paraphrase_review || []) if (validConfidence(phrase.confidence)) values.push(phrase.confidence);
  if (values.length === 0) return null;
  return values.includes("LOW") ? "LOW" : values.includes("MEDIUM") ? "MEDIUM" : "HIGH";
}

export function reconstructRecommendedParaphrases(entry, phraseRows) {
  const keep = new Set();
  for (const row of phraseRows) {
    const accepted = row.source === "CURRENT"
      ? ["KEEP_CURRENT", "KEEP"].includes(row.decision)
      : row.source === "HISTORICAL_REMOVAL"
        ? row.decision === "RESTORE"
        : row.source === "HISTORICAL_ADDITION"
          ? ["KEEP_ADDED", "KEEP"].includes(row.decision)
          : row.source === "NEW_ADDITION"
            ? ["KEEP_NEW_ADDITION", "KEEP_ADDED", "KEEP"].includes(row.decision)
            : false;
    if (accepted) keep.add(`${row.source}\0${row.phrase}`);
  }
  const sourceOrder = [
    ...(entry.current_paraphrases || []).map((phrase) => ["CURRENT", phrase]),
    ...(entry.historically_removed_paraphrases || []).map((phrase) => ["HISTORICAL_REMOVAL", phrase]),
    ...(entry.historically_added_paraphrases || []).map((phrase) => ["HISTORICAL_ADDITION", phrase]),
    ...(entry.new_addition_candidates || []).map((phrase) => ["NEW_ADDITION", phrase]),
  ];
  return [...new Set(sourceOrder.filter(([source, phrase]) => keep.has(`${source}\0${phrase}`)).map(([, phrase]) => phrase))];
}

export function lintRecommendedPrompt(prompt, canonical = "") {
  if (typeof prompt !== "string" || !prompt.trim()) return { targetLeakage: true, metaHint: false, leakedTokens: ["<missing>"] };
  const allowed = new Set(["someone", "somebody", "something", "somewhere", "someplace", "one", "ones"]);
  const leakedTokens = (prompt.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).filter((token) => {
    const normalized = token.toLowerCase();
    if (allowed.has(normalized)) return false;
    if (normalized === "else" && /\b(?:someone|somebody|something|somewhere|someplace|one|ones)\s+else\b/i.test(prompt)) return false;
    return true;
  });
  const canonicalTextLeaked = canonical && prompt.toLowerCase().includes(canonical.toLowerCase());
  return { targetLeakage: leakedTokens.length > 0 || Boolean(canonicalTextLeaked), metaHint: META_HINT.test(prompt), leakedTokens };
}

export function validateWorkerRefSnapshot(rows) {
  assert(Array.isArray(rows) && rows.length === EXPECTED_WORKERS.length, "Worker ref snapshot must contain exactly 10 rows.");
  const byId = uniqueMap(rows, (row) => row.worker_id, "worker ref snapshot");
  for (const expected of EXPECTED_WORKERS) {
    const actual = byId.get(expected.worker_id);
    assert(actual, `Missing pinned ref for ${expected.worker_id}.`);
    assert(actual.branch === expected.branch && actual.branch_head === expected.branch_head, `Unexpected branch/head for ${expected.worker_id}.`);
  }
  return true;
}

function parseArgs(argv) {
  const options = { mode: null, offlineWorkerSnapshot: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--check", "--write"].includes(argv[i])) {
      assert(!options.mode, "Choose exactly one of --check or --write.");
      options.mode = argv[i].slice(2);
    } else if (argv[i] === "--offline-worker-snapshot") options.offlineWorkerSnapshot = true;
    else fail(`Unknown argument: ${argv[i]}`);
  }
  options.mode ||= "check";
  return options;
}

function verifyLiveRefs() {
  for (const worker of EXPECTED_WORKERS) {
    let output;
    try { output = execFileSync("git", ["ls-remote", "origin", `refs/heads/${worker.branch}`], { cwd: ROOT, encoding: "utf8" }).trim(); }
    catch (error) { fail(`Cannot verify live remote ref ${worker.branch}: ${error.message}. Use --offline-worker-snapshot only for a previously verified snapshot.`); }
    const [head] = output.split(/\s+/);
    assert(head === worker.branch_head, `Remote HEAD drift for ${worker.worker_id}: expected ${worker.branch_head}, found ${head || "missing"}.`);
  }
}

function canonicalProjection(value) {
  const keys = ["review_status", "decision", "violation_classes", "canonical_slot_profile", "prompt_slot_profile", "canonical_slot_tokens", "Japanese_prompt_slot_tokens", "recommended_prompt", "recommended_paraphrases", "reason", "confidence", "slot_review_id"];
  return Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
}
function provenanceFor(worker, claim) {
  return {
    authority_type: "PARALLEL_WORKER",
    worker_id: worker.worker_id,
    branch: worker.branch,
    branch_head: worker.branch_head,
    claim_sha256: claim.claim_sha256,
    parallel_review_base_sha: PARALLEL_BASE_SHA,
  };
}
function existingProvenance(old, status) {
  return old?.provenance || {
    authority_type: status === "UPSTREAM" ? "UPSTREAM_CANONICAL" : "EXISTING_CANONICAL",
    branch: "audit/vocabulary-japanese-prompt-authority-reconciliation",
    branch_head: BASE_MAIN_SHA,
  };
}
function getWorkerFile(workerId, file) {
  return readJson(resolve(PARALLEL_DIR, `worker-${workerId.slice(1)}`, `${file}.json`));
}

function flattenValidationValues(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    if (predicate(key, item)) out.push([key, item]);
    if (item && typeof item === "object") flattenValidationValues(item, predicate, out);
  }
  return out;
}

function validateWorkerArtifacts({ worker, claim, reviewsDoc, summary, validation, canonicalClaim, batchById, productionById, indexById }) {
  assert(claim.worker_id === worker.worker_id, `${worker.worker_id} claim has the wrong worker_id.`);
  assert(equal(claim, canonicalClaim), `${worker.worker_id} worker claim differs from the canonical claim.`);
  const { claim_sha256: claimHash, ...claimPayload } = claim;
  assert(claimHash === sha256(JSON.stringify(claimPayload)), `${worker.worker_id} claim SHA-256 does not match its claim payload.`);
  assert(claim.parallel_review_base_sha === PARALLEL_BASE_SHA, `${worker.worker_id} base SHA differs.`);
  assert(claim.production_blob_sha === PRODUCTION_BLOB_SHA, `${worker.worker_id} production blob differs.`);
  assert(claim.slot_inventory_blob_sha === SLOT_INVENTORY_BLOB_SHA, `${worker.worker_id} slot inventory SHA differs.`);
  assert(claim.slot_review_blob_sha === SLOT_REVIEW_BLOB_SHA, `${worker.worker_id} slot review SHA differs.`);
  assert(claim.claim_count === claim.ordered_ids.length && claim.claim_count === claim.source_indices.length, `${worker.worker_id} claim count is inconsistent.`);
  assert(reviewsDoc.worker_id === worker.worker_id, `${worker.worker_id} reviews.json has the wrong worker_id.`);
  assert(reviewsDoc.parallel_review_base_sha === PARALLEL_BASE_SHA, `${worker.worker_id} reviews base SHA differs.`);
  assert(reviewsDoc.claim_sha256 === claim.claim_sha256, `${worker.worker_id} reviews claim SHA differs.`);
  assert(reviewsDoc.review_count === claim.claim_count && reviewsDoc.reviews.length === claim.claim_count, `${worker.worker_id} review count differs from claim.`);
  assert(validation.worker_id === worker.worker_id, `${worker.worker_id} validation has the wrong worker_id.`);
  assert(validation.parallel_review_base_sha === PARALLEL_BASE_SHA, `${worker.worker_id} validator base SHA differs or is missing.`);
  assert(validation.claim_sha256 === claim.claim_sha256, `${worker.worker_id} validator claim SHA differs or is missing.`);
  if (summary.claim_sha256 !== undefined) assert(summary.claim_sha256 === claim.claim_sha256, `${worker.worker_id} summary claim SHA differs.`);
  for (const source of [reviewsDoc, validation, summary]) {
    if (source.production_blob_sha !== undefined) assert(source.production_blob_sha === PRODUCTION_BLOB_SHA, `${worker.worker_id} production blob SHA differs in worker evidence.`);
    if (source.slot_inventory_blob_sha !== undefined) assert(source.slot_inventory_blob_sha === SLOT_INVENTORY_BLOB_SHA, `${worker.worker_id} slot inventory SHA differs in worker evidence.`);
    if (source.slot_review_blob_sha !== undefined) assert(source.slot_review_blob_sha === SLOT_REVIEW_BLOB_SHA, `${worker.worker_id} slot review SHA differs in worker evidence.`);
  }
  const statusValues = flattenValidationValues(validation, (key, value) => /^(status|result|validator_status|worker_status|worker_completion|completion_status)$/.test(key) && typeof value === "string").map(([, value]) => value);
  assert(statusValues.some((value) => ["PASS", "COMPLETE"].includes(value)), `${worker.worker_id} validator is not PASS/COMPLETE.`);
  const failedStatuses = flattenValidationValues(validation, (key, value) => /^(status|result|validator_status)$/.test(key) && typeof value === "string" && ["FAIL", "BLOCKED"].includes(value));
  assert(failedStatuses.length === 0, `${worker.worker_id} validator contains a failure status.`);
  for (const key of ["failed_checks", "blockers", "failures"]) {
    if (Array.isArray(validation[key])) assert(validation[key].length === 0, `${worker.worker_id} validator reports ${key}.`);
  }
  const checkItems = Array.isArray(validation.checks) ? validation.checks : [];
  assert(checkItems.every((check) => check.result === true || check.status === "PASS"), `${worker.worker_id} validator has a failed array check.`);
  const nestedCheckFailures = flattenValidationValues(validation.checks, (key, value) => typeof value === "boolean" && value === false);
  assert(nestedCheckFailures.length === 0, `${worker.worker_id} validator has a false check value.`);
  const productionChanges = flattenValidationValues(validation, (key, value) => key === "production_changes" && typeof value === "number");
  const productionChecks = [
    ...productionChanges.map(([, value]) => value),
    ...checkItems.filter((check) => check.check === "production_changes").map((check) => check.count),
  ];
  assert(productionChecks.length > 0 && productionChecks.every((value) => value === 0), `${worker.worker_id} validator does not prove production_changes=0.`);
  const summaryProductionChanges = flattenValidationValues(summary, (key, value) => key === "production_changes" && typeof value === "number");
  assert(summaryProductionChanges.length > 0 && summaryProductionChanges.every(([, value]) => value === 0), `${worker.worker_id} summary does not validate production_changes=0.`);
  const summaryStatusValues = [summary.worker_status, summary.completion_status, summary.status].filter((value) => typeof value === "string");
  assert(summaryStatusValues.every((value) => ["COMPLETE", "PASS"].includes(value)), `${worker.worker_id} summary has a non-complete status.`);

  const claimIndexById = new Map(claim.ordered_ids.map((id, i) => [id, claim.source_indices[i]]));
  assert(new Set(claim.ordered_ids).size === claim.ordered_ids.length, `${worker.worker_id} claim has duplicate IDs.`);
  assert(new Set(claim.source_indices).size === claim.source_indices.length, `${worker.worker_id} claim has duplicate source indices.`);
  const reviewIds = reviewsDoc.reviews.map((row) => row.id);
  assert(equal(reviewIds, claim.ordered_ids), `${worker.worker_id} review order does not match its claim.`);
  assert(new Set(reviewIds).size === reviewIds.length, `${worker.worker_id} has duplicate review IDs.`);
  const reviewById = uniqueMap(reviewsDoc.reviews, (row) => row.id, `${worker.worker_id} reviews`);
  for (const row of reviewsDoc.reviews) {
    const id = row.id;
    assert(claimIndexById.has(id), `${worker.worker_id} has an out-of-claim review ${id}.`);
    assert(row.source_index === claimIndexById.get(id), `${worker.worker_id} source_index differs for ${id}.`);
    assert(row.review_status === "REVIEWED", `${worker.worker_id} has a non-reviewed row ${id}.`);
    const entryConfidence = deriveEntryConfidence(row);
    assert(entryConfidence === "HIGH" || entryConfidence === "MEDIUM", `${worker.worker_id} confidence is missing/LOW for ${id}.`);
    const canonical = batchById.get(id);
    const production = productionById.get(id);
    assert(canonical && production, `${worker.worker_id} references unknown production ID ${id}.`);
    assert(indexById.has(id), `${worker.worker_id} claim is outside the audit union: ${id}.`);
    for (const field of IMMUTABLE_FIELDS) if (Object.hasOwn(row, field)) assert(equal(row[field], canonical[field]), `${worker.worker_id} changed immutable ${field} for ${id}.`);
    if (Object.hasOwn(row, "kind")) assert(row.kind === production.kind, `${worker.worker_id} changed immutable kind for ${id}.`);
    assert(row.slot_integrity_checked === true, `${worker.worker_id} did not check slot integrity for ${id}.`);
    assert(row.slot_reconciliation && !["PENDING", "UPSTREAM"].includes(row.slot_reconciliation.review_status), `${worker.worker_id} has unresolved slot status for ${id}.`);
    if (row.slot_authority_review?.respected === false) fail(`${worker.worker_id} conflicts with slot authority for ${id}.`);
    if (canonical.cohort_flags?.current_parenthetical === true) {
      const p = row.parenthetical_review || {};
      assert(["REMOVE_META_HINT", "REWRITE_MINIMAL_SEMANTIC", "KEEP_SEMANTIC_SCOPE"].includes(p.parenthetical_decision), `${worker.worker_id} has unresolved parenthetical review for ${id}.`);
      assert(typeof p.recommended_prompt === "string" && p.recommended_prompt.trim(), `${worker.worker_id} has no parenthetical prompt for ${id}.`);
      assert(typeof p.prompt_reason === "string" && p.prompt_reason.trim(), `${worker.worker_id} has no parenthetical reason for ${id}.`);
      assert(validConfidence(p.prompt_confidence), `${worker.worker_id} has no parenthetical confidence for ${id}.`);
    }
    for (const phrase of row.paraphrase_review || []) {
      assert(PHRASE_SOURCES.includes(phrase.source), `${worker.worker_id} has unknown phrase source ${phrase.source} for ${id}.`);
      assert(typeof phrase.phrase === "string" && phrase.phrase.trim(), `${worker.worker_id} has empty phrase for ${id}.`);
      assert(phrase.decision && phrase.decision !== "PENDING", `${worker.worker_id} has pending phrase review ${id} + ${phrase.phrase}.`);
      assert(validConfidence(phrase.confidence) && phrase.confidence !== "LOW", `${worker.worker_id} phrase confidence missing/LOW for ${id} + ${phrase.phrase}.`);
      if (phrase.decision.includes("REMOVE") || phrase.decision === "KEEP_REMOVED_SEMANTIC_MISMATCH") assert(typeof (phrase.semantic_fit_reason || phrase.reason) === "string" && (phrase.semantic_fit_reason || phrase.reason).trim(), `${worker.worker_id} has an unexplained removal for ${id} + ${phrase.phrase}.`);
    }
  }
  return { claim, reviewsDoc, summary, validation, reviewById };
}

function workerFinalPrompt(entry, review, slotReviewById) {
  const slot = slotReviewById.get(entry.id);
  const defect = slot && !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(slot.decision);
  const workerPrompt = review.recommended_prompt || review.recommended_meaning_ja || review.parenthetical_review?.recommended_prompt || review.slot_reconciliation?.recommended_prompt;
  if (defect) assert(workerPrompt === slot.recommended_prompt, `Worker prompt conflicts with slot authority for ${entry.id}.`);
  const prompt = defect ? slot.recommended_prompt : workerPrompt || entry.current_meaning_ja;
  assert(typeof prompt === "string" && prompt.trim(), `No final recommended prompt for ${entry.id}.`);
  if (defect) {
    assert(review.slot_reconciliation?.decision === slot.decision, `Slot decision conflict for ${entry.id}.`);
    assert(review.slot_reconciliation?.recommended_prompt === slot.recommended_prompt, `Slot prompt conflict for ${entry.id}.`);
    const missing = (slot.recommended_paraphrases || []).filter((phrase) => !(review.recommended_paraphrases || []).includes(phrase));
    assert(missing.length === 0, `Slot paraphrase recommendation missing for ${entry.id}: ${missing.join(", ")}.`);
  }
  return prompt;
}

function normalizePhraseRow(row, provenance) {
  return {
    id: row.id,
    phrase: row.phrase,
    source: row.source,
    current_status: row.current_status || row.previous_status || ({ CURRENT: "CURRENT", HISTORICAL_REMOVAL: "REMOVED", HISTORICAL_ADDITION: "ADDED", NEW_ADDITION: "NEW" })[row.source],
    previous_status: row.previous_status || row.current_status || null,
    decision: row.decision,
    semantic_fit_reason: row.semantic_fit_reason || row.reason || "",
    semantic_reason: row.semantic_fit_reason || row.reason || "",
    confidence: row.confidence,
    review_status: row.review_status || "REVIEWED",
    sources: row.sources || [],
    provenance,
  };
}

function makeParentheticalRow(entry, source, prompt, provenance, lint) {
  const p = source.parenthetical_review || source;
  const decision = p.parenthetical_decision || p.decision;
  const upstream = decision === "UPSTREAM_MEANING_REVIEW" || source.review_status === "UPSTREAM";
  const promptConfidence = p.prompt_confidence || source.prompt_confidence || null;
  const minimality = p.prompt_minimality || source.prompt_minimality || (upstream ? "UPSTREAM" : decision === "KEEP_SEMANTIC_SCOPE" ? "EXPLICIT_SEMANTIC_SCOPE" : "PASS");
  return {
    id: entry.id,
    source_index: entry.source_index,
    current_prompt: entry.current_meaning_ja,
    current_meaning_ja: entry.current_meaning_ja,
    current_parenthetical_segments: entry.current_parenthetical_segments || [],
    decision,
    parenthetical_decision: decision,
    recommended_prompt: upstream ? null : prompt,
    retained_semantic_information: p.retained_semantic_information ?? source.retained_semantic_information ?? null,
    removed_meta_information: p.removed_meta_information ?? source.removed_meta_information ?? null,
    reason: p.prompt_reason || p.reason || source.prompt_reason || source.reason || "",
    prompt_reason: p.prompt_reason || p.reason || source.prompt_reason || source.reason || "",
    confidence: promptConfidence,
    prompt_confidence: promptConfidence,
    review_status: upstream ? "UPSTREAM" : "REVIEWED",
    target_leakage_checked: upstream ? true : lint && !lint.targetLeakage,
    meta_hint_checked: upstream ? true : lint && !lint.metaHint,
    prompt_minimality: minimality,
    provenance,
  };
}

export function buildAggregationPlan({ offlineWorkerSnapshot = false }) {
  const manifest = readJson(resolve(AUDIT_DIR, "manifest.json"));
  assert(manifest.audit_base_main_sha === BASE_MAIN_SHA, "Audit base main SHA differs from the pinned source.");
  assert(manifest.production_source?.git_blob_sha === PRODUCTION_BLOB_SHA, "Production blob SHA differs from the immutable source.");
  const productionText = readText(resolve(ROOT, "data/vocabulary-v3.json"));
  assert(sha1GitBlob(productionText) === PRODUCTION_BLOB_SHA, "Production vocabulary has changed from the immutable audit base.");
  const production = readJson(resolve(ROOT, "data/vocabulary-v3.json"));
  const productionById = uniqueMap(production.entries, (row) => row.id, "production vocabulary");
  const refsPath = resolve(PARALLEL_DIR, "worker-heads.json");
  const refs = (() => { try { return readJson(refsPath); } catch { return null; } })();
  if (refs) validateWorkerRefSnapshot(refs.workers);
  if (!offlineWorkerSnapshot) verifyLiveRefs();

  const indexDoc = readJson(resolve(AUDIT_DIR, "review-index.json"));
  const indexById = uniqueMap(indexDoc.entries, (row) => row.id, "review-index");
  const batchDocs = [];
  for (let n = 1; n <= manifest.populations.batch_count; n += 1) {
    const name = `batch-${String(n).padStart(3, "0")}`;
    const doc = readJson(resolve(AUDIT_DIR, "batches", `${name}.json`));
    assert(doc.batch_id === name && Array.isArray(doc.entries), `${name} has invalid shape.`);
    batchDocs.push(doc);
  }
  const allEntries = batchDocs.flatMap((doc) => doc.entries);
  const batchById = uniqueMap(allEntries, (row) => row.id, "batch entries");
  assert(allEntries.length === 589 && indexDoc.entries.length === 589, "Canonical union population is not 589.");
  const oldDecisionsDoc = readJson(resolve(AUDIT_DIR, "decisions.json"));
  const oldDecisionsById = uniqueMap(oldDecisionsDoc.entries, (row) => row.id, "existing decisions");
  const oldParentheticalDoc = readJson(resolve(AUDIT_DIR, "parenthetical-review.json"));
  const oldParentheticalById = uniqueMap(oldParentheticalDoc.entries, (row) => row.id, "existing parenthetical review");
  const oldPhraseDoc = readJson(resolve(AUDIT_DIR, "paraphrase-reconciliation.json"));
  const oldPhraseByKey = uniqueMap(oldPhraseDoc.entries, (row) => phraseKey(row.id, row.source, row.phrase), "existing paraphrase reconciliation");
  const slotReview = readJson(resolve(AUDIT_DIR, "slot-review.json"));
  const slotReviewById = uniqueMap(slotReview, (row) => row.id, "slot review");

  const workerHeadsDoc = { schema_version: 1, workers: EXPECTED_WORKERS.map((worker) => ({ ...worker })) };
  const workerArtifacts = [];
  const workerByEntry = new Map();
  const claimIds = [];
  for (const worker of EXPECTED_WORKERS) {
    const claim = getWorkerFile(worker.worker_id, "claim");
    const reviewsDoc = getWorkerFile(worker.worker_id, "reviews");
    const summary = getWorkerFile(worker.worker_id, "summary");
    const validation = getWorkerFile(worker.worker_id, "validation");
    const canonicalClaim = readJson(resolve(PARALLEL_DIR, "claims", `worker-${worker.worker_id.slice(1)}.json`));
    const checked = validateWorkerArtifacts({ worker, claim, reviewsDoc, summary, validation, canonicalClaim, batchById, productionById, indexById });
    workerArtifacts.push({ ...checked, worker });
    for (const id of claim.ordered_ids) claimIds.push(id);
    for (const row of reviewsDoc.reviews) {
      assert(!workerByEntry.has(row.id), `Duplicate worker ownership for ${row.id}.`);
      workerByEntry.set(row.id, { worker, claim, row });
    }
  }
  const claimIdSet = new Set(claimIds);
  assert(claimIds.length === 548 && claimIdSet.size === 548, "Worker claims must cover 548 unique IDs.");
  const originalPending = indexDoc.entries.filter((row) => row.review_status === "PENDING").map((row) => row.id);
  const importedReviewed = indexDoc.entries.filter((row) => row.review_status === "REVIEWED" && oldDecisionsById.get(row.id)?.provenance?.authority_type === "PARALLEL_WORKER").map((row) => row.id);
  const initialState = originalPending.length === 548 && sameSet(originalPending, claimIds) && claimIds.every((id) => indexById.get(id).review_status === "PENDING");
  const postState = originalPending.length === 0 && importedReviewed.length === 548 && sameSet(importedReviewed, claimIds) && claimIds.every((id) => indexById.get(id).review_status === "REVIEWED");
  assert(initialState || postState, "Canonical state must be either the original 548 PENDING rows or this exact complete aggregation.");
  assert(indexDoc.entries.filter((row) => row.review_status === "REVIEWED" && !claimIdSet.has(row.id)).length === 40, "Existing 40 REVIEWED rows changed ownership.");
  const upstreamRows = indexDoc.entries.filter((row) => row.review_status === "UPSTREAM");
  assert(upstreamRows.length === 1 && upstreamRows[0].id === "vocab:00083", "The unique upstream row must remain vocab:00083.");
  assert(!claimIdSet.has("vocab:00083"), "Worker claims must not include vocab:00083.");
  for (const claimId of claimIds) assert(indexById.has(claimId), `Claim contains an ID outside the audit union: ${claimId}.`);
  const sourceOrderedClaims = allEntries.filter((row) => claimIdSet.has(row.id)).map((row) => row.id);
  assert(equal(sourceOrderedClaims, claimIds), "Claims are not in deterministic source order.");

  const expectedPhrasePairs = [];
  for (const entry of allEntries) {
    for (const phrase of entry.current_paraphrases || []) expectedPhrasePairs.push({ id: entry.id, phrase, source: "CURRENT" });
    for (const phrase of entry.historically_removed_paraphrases || []) expectedPhrasePairs.push({ id: entry.id, phrase, source: "HISTORICAL_REMOVAL" });
    for (const phrase of entry.historically_added_paraphrases || []) expectedPhrasePairs.push({ id: entry.id, phrase, source: "HISTORICAL_ADDITION" });
    for (const phrase of entry.new_addition_candidates || []) expectedPhrasePairs.push({ id: entry.id, phrase, source: "NEW_ADDITION" });
  }
  const expectedPhraseByKey = uniqueMap(expectedPhrasePairs, (row) => phraseKey(row.id, row.source, row.phrase), "source phrase inventory");
  assert(expectedPhraseByKey.size === 978 && oldPhraseByKey.size === 978, "Source phrase population must be 978.");
  const workerPhraseByKey = new Map();
  for (const { row } of workerByEntry.values()) {
    for (const phrase of row.paraphrase_review || []) {
      const key = phraseKey(row.id, phrase.source, phrase.phrase);
      assert(expectedPhraseByKey.has(key), `Worker review has a source phrase outside the canonical inventory: ${key}.`);
      assert(!workerPhraseByKey.has(key), `Duplicate worker phrase review ${key}.`);
      workerPhraseByKey.set(key, phrase);
    }
  }

  const phraseEntries = [];
  const phraseCounts = { CURRENT: {}, HISTORICAL_REMOVAL: {}, HISTORICAL_ADDITION: {}, NEW_ADDITION: {} };
  for (const source of PHRASE_SOURCES) phraseCounts[source] = {};
  for (const pair of expectedPhrasePairs) {
    const key = phraseKey(pair.id, pair.source, pair.phrase);
    const old = oldPhraseByKey.get(key);
    assert(old, `Missing existing phrase record ${key}.`);
    const worker = workerByEntry.get(pair.id);
    const imported = workerPhraseByKey.get(key);
    let row;
    let provenance;
    if (imported) {
      assert(old.decision === "PENDING" || (old.review_status === "REVIEWED" && old.decision === imported.decision), `Worker would overwrite an existing phrase decision for ${key}.`);
      provenance = provenanceFor(worker.worker, worker.claim);
      row = normalizePhraseRow({ id: pair.id, ...imported }, provenance);
    } else {
      row = { ...old };
      provenance = old.provenance || existingProvenance(oldDecisionsById.get(pair.id), indexById.get(pair.id).review_status);
      row.provenance = provenance;
      row.previous_status ??= row.current_status ?? null;
      row.semantic_reason ??= row.semantic_fit_reason || row.reason || "";
    }
    assert(row.review_status !== "PENDING" && row.decision !== "PENDING", `Phrase remains pending: ${key}.`);
    assert(PHRASE_SOURCES.includes(row.source), `Unknown phrase source for ${key}.`);
    if (indexById.get(pair.id).review_status !== "UPSTREAM") assert(validConfidence(row.confidence) && row.confidence !== "LOW", `Phrase confidence missing/LOW for ${key}.`);
    const category = row.source;
    const decision = row.decision;
    phraseCounts[category][decision] = (phraseCounts[category][decision] || 0) + 1;
    phraseEntries.push(row);
  }
  assert(workerPhraseByKey.size === 925, `Expected 925 worker phrase judgments, found ${workerPhraseByKey.size}.`);
  const phraseKeys = phraseEntries.map((row) => phraseKey(row.id, row.source, row.phrase));
  assert(new Set(phraseKeys).size === phraseKeys.length, "Duplicate phrase key after aggregation.");
  assert(phraseEntries.length === 978, "Final phrase reconciliation must contain 978 rows.");
  assert((phraseCounts.CURRENT.KEEP_CURRENT || 0) + (phraseCounts.CURRENT.KEEP || 0) === 295 && (phraseCounts.CURRENT.REMOVE_CURRENT_SEMANTIC_MISMATCH || 0) + (phraseCounts.CURRENT.REMOVE || 0) === 5, "Current paraphrase decisions differ from expected accounting.");
  assert((phraseCounts.HISTORICAL_REMOVAL.RESTORE || 0) === 531 && (phraseCounts.HISTORICAL_REMOVAL.KEEP_REMOVED_SEMANTIC_MISMATCH || 0) === 139, "Historical removal decisions differ from expected accounting.");
  assert((phraseCounts.HISTORICAL_ADDITION.KEEP_ADDED || 0) + (phraseCounts.HISTORICAL_ADDITION.KEEP || 0) === 8 && (phraseCounts.HISTORICAL_ADDITION.REMOVE_ADDED_SEMANTIC_MISMATCH || 0) + (phraseCounts.HISTORICAL_ADDITION.REMOVE || 0) === 0, "Historical addition decisions differ from expected accounting.");
  assert((phraseCounts.NEW_ADDITION.KEEP_NEW_ADDITION || 0) + (phraseCounts.NEW_ADDITION.KEEP || 0) === 0 && Object.values(phraseCounts.NEW_ADDITION).reduce((a, b) => a + b, 0) === 0, "Worker wave must add no new paraphrases.");
  const phraseByEntry = new Map();
  for (const row of phraseEntries) { const rows = phraseByEntry.get(row.id) || []; rows.push(row); phraseByEntry.set(row.id, rows); }

  const workerConfidences = [];
  const workerDecisionCounts = {};
  const parentheticalCounts = {};
  const finalPrompts = new Map();
  const recommendations = new Map();
  const slotDefects = slotReview.filter((row) => !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(row.decision));
  assert(slotDefects.length === 17, `Expected 17 confirmed slot defects, found ${slotDefects.length}.`);
  for (const entry of allEntries) {
    const worker = workerByEntry.get(entry.id);
    if (worker) {
      const review = worker.row;
      const confidence = deriveEntryConfidence(review);
      workerConfidences.push(confidence);
      workerDecisionCounts[review.entry_decision] = (workerDecisionCounts[review.entry_decision] || 0) + 1;
      const prompt = workerFinalPrompt(entry, review, slotReviewById);
      const lint = lintRecommendedPrompt(prompt, entry.canonical);
      assert(!lint.targetLeakage, `Target leakage in ${entry.id}: ${lint.leakedTokens.join(", ")}.`);
      assert(!lint.metaHint, `Meta hint remains in recommended prompt for ${entry.id}.`);
      finalPrompts.set(entry.id, prompt);
      const rowPhraseReviews = (review.paraphrase_review || []).map((phrase) => ({ ...phrase, source: phrase.source }));
      const reconstructed = reconstructRecommendedParaphrases(entry, rowPhraseReviews);
      assert(equal(reconstructed, review.recommended_paraphrases || []), `Worker recommended_paraphrases does not reconstruct for ${entry.id}.`);
      recommendations.set(entry.id, reconstructed);
      if (entry.cohort_flags?.current_parenthetical === true) parentheticalCounts[review.parenthetical_review.parenthetical_decision] = (parentheticalCounts[review.parenthetical_review.parenthetical_decision] || 0) + 1;
    } else {
      const old = oldDecisionsById.get(entry.id);
      assert(old, `No existing canonical decision for unclaimed ${entry.id}.`);
      const status = indexById.get(entry.id).review_status;
      finalPrompts.set(entry.id, status === "UPSTREAM" ? old.recommended_prompt || null : old.recommended_prompt || entry.current_meaning_ja);
      if (indexById.get(entry.id).review_status === "UPSTREAM") recommendations.set(entry.id, old.recommended_paraphrases ?? null);
      else {
        const reconstructed = reconstructRecommendedParaphrases(entry, phraseByEntry.get(entry.id) || []);
        recommendations.set(entry.id, reconstructed);
      }
      workerDecisionCounts[old.entry_decision] = (workerDecisionCounts[old.entry_decision] || 0) + 1;
      if (entry.cohort_flags?.current_parenthetical === true) {
        const decision = entry.parenthetical_review?.parenthetical_decision;
        parentheticalCounts[decision] = (parentheticalCounts[decision] || 0) + 1;
      }
    }
  }
  assert(equal(workerDecisionCounts, {
    KEEP: 40,
    PROMPT_SIMPLIFY: 141,
    PARAPHRASE_RESTORE: 173,
    PROMPT_AND_PARAPHRASE_RECONCILE: 231,
    PARAPHRASE_REMOVE_SEMANTIC: 3,
    UPSTREAM_AUTHORITY_REVIEW: 1,
  }), `Entry decision accounting differs: ${JSON.stringify(workerDecisionCounts)}.`);
  assert(equal(parentheticalCounts, {
    REMOVE_META_HINT: 247,
    REWRITE_MINIMAL_SEMANTIC: 120,
    KEEP_SEMANTIC_SCOPE: 8,
    UPSTREAM_MEANING_REVIEW: 1,
  }), `Parenthetical decision accounting differs: ${JSON.stringify(parentheticalCounts)}.`);
  const workerConfidenceCounts = tally(workerConfidences, (value) => value);
  assert(workerConfidences.length === 548 && (workerConfidenceCounts.HIGH || 0) === 402 && (workerConfidenceCounts.MEDIUM || 0) === 146 && !workerConfidenceCounts.LOW, `Worker confidence accounting differs: ${JSON.stringify(workerConfidenceCounts)}.`);
  assert(allEntries.filter((entry) => entry.cohort_flags?.current_parenthetical === true).length === 376, "Current parenthetical population differs from 376.");
  assert(allEntries.reduce((sum, entry) => sum + (entry.current_parenthetical_segments || []).length, 0) === 381, "Current parenthetical segment count differs from 381.");
  assert(workerByEntry.size === 548, "Worker review coverage differs from 548.");
  assert(indexDoc.entries.every((row) => row.slot_integrity_checked === true), "Not all 589 union entries are slot checked.");
  assert(indexDoc.entries.length === 589, "Slot union coverage differs from 589.");

  const entryDecisionRows = [];
  const parentheticalRows = [];
  const semanticRows = [];
  const updatedBatchDocs = batchDocs.map((doc) => structuredClone(doc));
  const updatedBatchById = new Map(updatedBatchDocs.flatMap((doc) => doc.entries).map((row) => [row.id, row]));
  const updatedIndex = structuredClone(indexDoc);
  const indexByIdUpdated = new Map(updatedIndex.entries.map((row) => [row.id, row]));
  const existingRecommendationRepairs = [];
  const reviewStatus = new Map();

  for (const entry of allEntries) {
    const worker = workerByEntry.get(entry.id);
    const currentIndex = indexByIdUpdated.get(entry.id);
    const oldDecision = oldDecisionsById.get(entry.id);
    const status = worker ? "REVIEWED" : currentIndex.review_status;
    reviewStatus.set(entry.id, status);
    const confidence = worker ? deriveEntryConfidence(worker.row) : oldDecision.confidence;
    const prompt = finalPrompts.get(entry.id);
    const recommended = recommendations.get(entry.id);
    const provenance = worker ? provenanceFor(worker.worker, worker.claim) : existingProvenance(oldDecision, status);
    if (worker) {
      const target = updatedBatchById.get(entry.id);
      const beforeImmutable = Object.fromEntries(IMMUTABLE_FIELDS.filter((key) => Object.hasOwn(target, key)).map((key) => [key, structuredClone(target[key])]));
      const workerReview = worker.row;
      const lint = lintRecommendedPrompt(prompt, entry.canonical);
      const p = workerReview.parenthetical_review || {};
      target.parenthetical_review = {
        parenthetical_decision: p.parenthetical_decision || "NOT_APPLICABLE",
        recommended_prompt: prompt,
        retained_semantic_information: p.retained_semantic_information ?? null,
        removed_meta_information: p.removed_meta_information ?? null,
        prompt_reason: p.prompt_reason || p.reason || workerReview.prompt_reason || workerReview.entry_reason || null,
        prompt_confidence: p.prompt_confidence || workerReview.confidence || null,
        review_status: "REVIEWED",
        target_leakage_checked: !lint.targetLeakage,
        meta_hint_checked: !lint.metaHint,
        prompt_minimality: p.prompt_minimality || (p.parenthetical_decision === "KEEP_SEMANTIC_SCOPE" ? "EXPLICIT_SEMANTIC_SCOPE" : "PASS"),
      };
      target.paraphrase_review = workerReview.paraphrase_review.map((phrase) => ({
        phrase: phrase.phrase,
        source: phrase.source,
        current_status: phrase.current_status || ({ CURRENT: "CURRENT", HISTORICAL_REMOVAL: "REMOVED", HISTORICAL_ADDITION: "ADDED", NEW_ADDITION: "NEW" })[phrase.source],
        decision: phrase.decision,
        semantic_fit_reason: phrase.semantic_fit_reason || phrase.reason || "",
        confidence: phrase.confidence,
        review_status: "REVIEWED",
        sources: phrase.sources || [],
      }));
      target.recommended_paraphrases = recommended;
      target.entry_decision = workerReview.entry_decision;
      target.evidence = workerReview.evidence || [];
      target.review_status = "REVIEWED";
      target.confidence = confidence;
      target.slot_integrity_checked = true;
      target.slot_reconciliation = canonicalProjection(workerReview.slot_reconciliation);
      for (const [key, value] of Object.entries(beforeImmutable)) assert(equal(target[key], value), `Aggregation changed immutable ${key} for ${entry.id}.`);

      currentIndex.review_status = "REVIEWED";
      currentIndex.entry_decision = workerReview.entry_decision;
      currentIndex.slot_integrity_checked = true;
      currentIndex.slot_reconciliation = canonicalProjection(workerReview.slot_reconciliation);
      currentIndex.slot_reconciliation_status = workerReview.slot_reconciliation.review_status;
    } else if (status === "REVIEWED" && !equal(oldDecision.recommended_paraphrases || [], recommended || [])) {
      existingRecommendationRepairs.push(entry.id);
      const target = updatedBatchById.get(entry.id);
      target.recommended_paraphrases = recommended;
    }

    const entryDecision = worker ? worker.row.entry_decision : oldDecision.entry_decision;
    const decisionRow = {
      id: entry.id,
      source_index: entry.source_index,
      entry_decision: entryDecision,
      recommended_prompt: prompt,
      recommended_paraphrases: recommended,
      review_status: status,
      confidence: confidence ?? null,
      provenance,
    };
    entryDecisionRows.push(decisionRow);

    if (entry.cohort_flags?.current_parenthetical === true) {
      const lint = prompt ? lintRecommendedPrompt(prompt, entry.canonical) : { targetLeakage: false, metaHint: false };
      const source = worker ? worker.row : oldParentheticalById.get(entry.id);
      assert(source, `Missing parenthetical authority for ${entry.id}.`);
      const projected = makeParentheticalRow(entry, source, prompt, provenance, lint);
      if (status === "UPSTREAM") {
        projected.review_status = "UPSTREAM";
        projected.decision = "UPSTREAM_MEANING_REVIEW";
        projected.parenthetical_decision = "UPSTREAM_MEANING_REVIEW";
        projected.recommended_prompt = null;
        projected.prompt_minimality = "UPSTREAM";
      } else {
        assert(!lint.targetLeakage && !lint.metaHint, `Parenthetical lint failed for ${entry.id}.`);
        projected.target_leakage_checked = true;
        projected.meta_hint_checked = true;
      }
      parentheticalRows.push(projected);
    }

    const slotReviewRow = slotReviewById.get(entry.id);
    const slotRemediation = Boolean(slotReviewRow && !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(slotReviewRow.decision));
    if (slotRemediation) assert(prompt === slotReviewRow.recommended_prompt, `Final prompt conflicts with slot authority for ${entry.id}.`);
    semanticRows.push({
      id: entry.id,
      source_index: entry.source_index,
      current_production_state: { meaning_ja: entry.current_meaning_ja, paraphrases: entry.current_paraphrases || [] },
      current_prompt: entry.current_meaning_ja,
      recommended_prompt: status === "UPSTREAM" ? null : prompt,
      current_paraphrases: entry.current_paraphrases || [],
      recommended_paraphrases: status === "UPSTREAM" ? null : recommended,
      prompt_changed: status === "UPSTREAM" ? null : prompt !== entry.current_meaning_ja,
      paraphrase_changed: status === "UPSTREAM" ? null : !equal(entry.current_paraphrases || [], recommended || []),
      slot_remediation: slotRemediation,
      parenthetical_decision: entry.cohort_flags?.current_parenthetical ? (worker ? worker.row.parenthetical_review.parenthetical_decision : entry.parenthetical_review?.parenthetical_decision) : null,
      entry_decision: entryDecision,
      review_status: status,
      confidence: confidence ?? null,
      provenance,
      production_readiness: status === "REVIEWED" && confidence !== "LOW" ? "SEMANTICALLY_READY" : "UPSTREAM_AUTHORITY_REVIEW",
    });
  }

  assert(parentheticalRows.length === 376, "Parenthetical projection must contain 376 entries.");
  assert(parentheticalRows.reduce((sum, row) => sum + row.current_parenthetical_segments.length, 0) === 381, "Parenthetical projection segment accounting differs from 381.");
  assert(parentheticalRows.filter((row) => row.review_status === "UPSTREAM").length === 1, "Parenthetical projection must retain one upstream row.");
  assert(parentheticalRows.filter((row) => row.review_status === "REVIEWED").length === 375, "Parenthetical projection reviewed count differs from 375.");
  assert(semanticRows.filter((row) => row.production_readiness === "SEMANTICALLY_READY").length === 588, "Semantic readiness population differs from 588.");
  assert(semanticRows.find((row) => row.id === "vocab:00083")?.production_readiness === "UPSTREAM_AUTHORITY_REVIEW", "vocab:00083 must not be production-ready.");
  const orderedWorkerConf = workerConfidences;
  const overallReviewedConfidence = tally([
    ...orderedWorkerConf,
    ...indexDoc.entries.filter((row) => row.review_status === "REVIEWED" && !claimIdSet.has(row.id)).map((row) => oldDecisionsById.get(row.id)?.confidence),
  ], (value) => value || "MISSING");
  assert((overallReviewedConfidence.LOW || 0) === 0 && (overallReviewedConfidence.MISSING || 0) === 0, "Reviewed confidence has LOW or missing values.");
  const finalReviewStatus = tally(allEntries.map((row) => ({ status: reviewStatus.get(row.id) })), (row) => row.status);
  assert(finalReviewStatus.REVIEWED === 588 && finalReviewStatus.UPSTREAM === 1 && !finalReviewStatus.PENDING, `Final review accounting differs: ${JSON.stringify(finalReviewStatus)}.`);

  const updatedIndexDoc = { ...updatedIndex, entries: updatedIndex.entries };
  const decisionsDoc = { schema_version: 2, source_order: "production entries order", entries: entryDecisionRows };
  const parentheticalDoc = { schema_version: 2, population: 376, segment_count: 381, entries: parentheticalRows };
  const paraphraseDoc = {
    ...oldPhraseDoc,
    schema_version: 2,
    phrase_pair_count: phraseEntries.length,
    historical_removed_phrase_entry_count: phraseEntries.filter((row) => row.source === "HISTORICAL_REMOVAL").length,
    historical_added_phrase_entry_count: phraseEntries.filter((row) => row.source === "HISTORICAL_ADDITION").length,
    entries: phraseEntries,
  };
  const semanticDoc = {
    schema_version: 2,
    status: "SEMANTIC_REVIEW_COMPLETE_PENDING_FINAL_RECONCILIATION",
    audit_base_main_sha: BASE_MAIN_SHA,
    source_vocabulary_git_blob_sha: PRODUCTION_BLOB_SHA,
    union_population: 589,
    review: { REVIEWED: 588, UPSTREAM: 1, PENDING: 0 },
    current_main_reconciliation: "PENDING",
    production_changes: 0,
    entries: semanticRows,
    notes: [
      "All semantic states are projected from canonical review fields, phrase judgments, and pinned worker reviews.",
      "Historical materialization divergence remains informational and is not classified as stale.",
      "Production materialization and latest-main semantic reconciliation remain pending.",
    ],
  };

  const output = new Map();
  for (const doc of updatedBatchDocs) output.set(resolve(AUDIT_DIR, "batches", `${doc.batch_id}.json`), doc);
  output.set(resolve(AUDIT_DIR, "review-index.json"), updatedIndexDoc);
  output.set(resolve(AUDIT_DIR, "decisions.json"), decisionsDoc);
  output.set(resolve(AUDIT_DIR, "parenthetical-review.json"), parentheticalDoc);
  output.set(resolve(AUDIT_DIR, "paraphrase-reconciliation.json"), paraphraseDoc);
  output.set(resolve(AUDIT_DIR, "semantic-reconciliation.json"), semanticDoc);
  output.set(resolve(PARALLEL_DIR, "worker-heads.json"), workerHeadsDoc);
  const serialized = new Map([...output.entries()].map(([path, value]) => [path, `${JSON.stringify(value, null, 2)}\n`]));
  const changed = [...serialized.entries()].filter(([path, value]) => {
    let actual = "";
    try { actual = readText(path); } catch { /* the first write creates the artifact */ }
    return actual !== value;
  }).map(([path]) => path.replace(`${ROOT}/`, ""));
  if (initialState) {
    const baselineProductionHash = sha1GitBlob(readText(resolve(ROOT, "data/vocabulary-v3.json")));
    assert(baselineProductionHash === PRODUCTION_BLOB_SHA, "Production file changed during aggregation planning.");
  }
  return {
    mode: "",
    initialState,
    postState,
    output: serialized,
    changed,
    workerHeadsDoc,
    metrics: {
      worker_count: EXPECTED_WORKERS.length,
      worker_claims: claimIds.length,
      worker_reviews: workerByEntry.size,
      review_status: finalReviewStatus,
      entry_decisions: workerDecisionCounts,
      parenthetical_decisions: parentheticalCounts,
      parenthetical_entries: parentheticalRows.length,
      parenthetical_segments: parentheticalRows.reduce((sum, row) => sum + row.current_parenthetical_segments.length, 0),
      phrase_rows: phraseEntries.length,
      phrase_decisions: phraseCounts,
      worker_confidence: workerConfidenceCounts,
      reviewed_confidence: overallReviewedConfidence,
      slots_checked: indexDoc.entries.filter((row) => row.slot_integrity_checked === true).length,
      confirmed_slot_defects: slotDefects.length,
      slot_conflicts: 0,
      target_leakage_unresolved: 0,
      meta_hint_unresolved: 0,
      existing_recommendation_projection_repairs: existingRecommendationRepairs.length,
      production_changes: 0,
    },
  };
}

export function runAggregation(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const plan = buildAggregationPlan(options);
  if (options.mode === "write" && (plan.initialState || plan.changed.length > 0)) {
    for (const [path, content] of plan.output) writeFileSync(path, content);
    const after = sha1GitBlob(readText(resolve(ROOT, "data/vocabulary-v3.json")));
    assert(after === PRODUCTION_BLOB_SHA, "Production file changed during aggregation write.");
    console.log(`WROTE ${plan.output.size} deterministic canonical artifacts.`);
  } else if (options.mode === "write") {
    console.log("PASS: aggregation is already materialized; second --write is a no-op.");
  } else if (plan.initialState) {
    console.log("PASS: worker/source gates are clean; 548 judgments are ready for deterministic projection.");
  } else if (plan.changed.length > 0) {
    fail(`Canonical aggregation output has drift: ${plan.changed.join(", ")}. Run with --write.`);
  } else {
    console.log("PASS: canonical artifacts match deterministic aggregation output.");
  }
  console.log(JSON.stringify(plan.metrics, null, 2));
  return plan.metrics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runAggregation(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
