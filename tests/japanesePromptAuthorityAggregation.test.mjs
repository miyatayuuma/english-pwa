import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_WORKERS,
  buildAggregationPlan,
  lintRecommendedPrompt,
  validateWorkerRefSnapshot,
} from "../scripts/vocabulary/aggregate-japanese-prompt-authority-parallel-review.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = resolve(ROOT, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const PRODUCTION_BLOB = "c23643d26e71be22aaec5ec04ce63a7582ad9c25";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};
const plan = () => buildAggregationPlan({ offlineWorkerSnapshot: true });

test("pins all ten worker branch heads exactly", () => {
  const refs = readJson(resolve(AUDIT, "parallel/worker-heads.json"));
  assert.equal(EXPECTED_WORKERS.length, 10);
  assert.equal(validateWorkerRefSnapshot(refs.workers), true);
  const changed = structuredClone(refs.workers);
  changed[0].branch_head = "0".repeat(40);
  assert.throws(() => validateWorkerRefSnapshot(changed), /Unexpected branch\/head/);
});

test("verifies 548 unique claim IDs against the 589-entry canonical union", () => {
  const result = plan();
  assert.equal(result.metrics.worker_claims, 548);
  assert.equal(result.metrics.worker_count, 10);
  const claims = Array.from({ length: 10 }, (_, i) => readJson(resolve(AUDIT, `parallel/claims/worker-${String(i + 1).padStart(2, "0")}.json`)));
  const ids = claims.flatMap((claim) => claim.ordered_ids);
  const batches = Array.from({ length: 6 }, (_, i) => readJson(resolve(AUDIT, `batches/batch-${String(i + 1).padStart(3, "0")}.json`)).entries).flat();
  const union = new Set(batches.map((row) => row.id));
  assert.equal(ids.length, 548);
  assert.equal(new Set(ids).size, 548);
  assert.equal(ids.filter((id) => union.has(id)).length, 548);
  assert.equal(union.size - new Set(ids).size, 41);
});

test("each worker review is owned by its own claim exactly once", () => {
  const allReviewed = new Set();
  for (let i = 1; i <= 10; i += 1) {
    const workerId = `W${String(i).padStart(2, "0")}`;
    const base = resolve(AUDIT, `parallel/worker-${String(i).padStart(2, "0")}`);
    const claim = readJson(resolve(AUDIT, `parallel/claims/worker-${String(i).padStart(2, "0")}.json`));
    const reviews = readJson(resolve(base, "reviews.json"));
    assert.equal(reviews.worker_id, workerId);
    assert.equal(reviews.claim_sha256, claim.claim_sha256);
    assert.deepEqual(reviews.reviews.map((row) => row.id), claim.ordered_ids);
    for (let n = 0; n < reviews.reviews.length; n += 1) {
      const row = reviews.reviews[n];
      assert.equal(row.source_index, claim.source_indices[n]);
      assert.ok(claim.ordered_ids.includes(row.id));
      assert.equal(allReviewed.has(row.id), false, `duplicate owner for ${row.id}`);
      allReviewed.add(row.id);
    }
  }
  assert.equal(allReviewed.size, 548);
});

test("imports all worker judgments and reconciles canonical review decisions", () => {
  const result = plan();
  const index = readJson(resolve(AUDIT, "review-index.json"));
  const decisions = readJson(resolve(AUDIT, "decisions.json"));
  assert.equal(index.entries.length, 589);
  assert.deepEqual(result.metrics.review_status, { REVIEWED: 588, UPSTREAM: 1 });
  assert.equal(index.entries.filter((row) => row.review_status === "PENDING").length, 0);
  assert.equal(decisions.entries.filter((row) => row.provenance?.authority_type === "PARALLEL_WORKER").length, 548);
});

test("phrase reconciliation has unique source keys and expected category totals", () => {
  const rows = readJson(resolve(AUDIT, "paraphrase-reconciliation.json")).entries;
  const keys = rows.map((row) => JSON.stringify([row.id, row.source, row.phrase]));
  assert.equal(rows.length, 978);
  assert.equal(new Set(keys).size, 978);
  assert.equal(rows.filter((row) => row.source === "CURRENT").length, 300);
  assert.equal(rows.filter((row) => row.source === "HISTORICAL_REMOVAL").length, 670);
  assert.equal(rows.filter((row) => row.source === "HISTORICAL_ADDITION").length, 8);
  assert.equal(rows.filter((row) => row.source === "NEW_ADDITION").length, 0);
});

test("integrates slot authority across the union and preserves all 17 defects", () => {
  const result = plan();
  assert.equal(result.metrics.slots_checked, 589);
  assert.equal(result.metrics.confirmed_slot_defects, 17);
  assert.equal(result.metrics.slot_conflicts, 0);
  assert.equal(result.metrics.canonical_bias_only_removals, 0);
  const slot = readJson(resolve(AUDIT, "slot-review.json")).find((row) => row.id === "vocab:01179");
  assert.equal(slot.recommended_prompt, "somethingにさらされる");
});

test("final recommended prompts have no target leakage or unresolved meta hints", () => {
  const semantic = readJson(resolve(AUDIT, "semantic-reconciliation.json"));
  const batches = Array.from({ length: 6 }, (_, i) => readJson(resolve(AUDIT, `batches/batch-${String(i + 1).padStart(3, "0")}.json`)).entries).flat();
  const entries = new Map(batches.map((row) => [row.id, row]));
  const lint = semantic.entries.filter((row) => row.production_readiness === "SEMANTICALLY_READY").map((row) => lintRecommendedPrompt(row.recommended_prompt, entries.get(row.id).canonical));
  assert.equal(lint.filter((row) => row.targetLeakage).length, 0);
  assert.equal(lint.filter((row) => row.metaHint).length, 0);
});

test("canonical projections regenerate byte-identically", () => {
  const first = plan();
  const second = plan();
  assert.deepEqual(first.changed, []);
  assert.deepEqual(second.changed, []);
  assert.deepEqual([...first.output.keys()], [...second.output.keys()]);
  for (const [path, content] of first.output) assert.equal(content, second.output.get(path), `deterministic output drift for ${path}`);
});

test("production vocabulary remains byte-identical to the immutable base", () => {
  const text = readFileSync(resolve(ROOT, "data/vocabulary-v3.json"), "utf8");
  assert.equal(gitBlobSha(text), PRODUCTION_BLOB);
  const result = plan();
  assert.equal(result.metrics.production_changes, 0);
  assert.ok([...result.output.keys()].every((path) => path.startsWith(`${AUDIT}/`)));
});
