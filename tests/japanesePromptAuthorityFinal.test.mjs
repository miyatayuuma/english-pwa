import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateFinalAudit } from "../scripts/vocabulary/validate-japanese-prompt-authority-final.mjs";

const root = resolve(import.meta.dirname, "..");
const audit = resolve(root, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const readJson = (path) => JSON.parse(readFileSync(resolve(audit, path), "utf8"));

test("Japanese Prompt Authority audit closes with complete strict accounting", () => {
  const result = validateFinalAudit();
  assert.equal(result.status, "CLOSED");
  assert.equal(result.population, 589);
  assert.deepEqual(result.review_status, { REVIEWED: 589, UPSTREAM: 0, PENDING: 0 });
  assert.deepEqual(result.entry_decisions, {
    KEEP: 40,
    PROMPT_SIMPLIFY: 142,
    PARAPHRASE_RESTORE: 173,
    PROMPT_AND_PARAPHRASE_RECONCILE: 231,
    PARAPHRASE_REMOVE_SEMANTIC: 3,
  });
  assert.deepEqual(result.parenthetical_decisions, {
    REMOVE_META_HINT: 248,
    REWRITE_MINIMAL_SEMANTIC: 120,
    KEEP_SEMANTIC_SCOPE: 8,
  });
  assert.deepEqual(result.confidence, { HIGH: 438, MEDIUM: 151 });
  assert.deepEqual(result.phrases, {
    historical_removals: 670,
    historical_additions: 8,
    current: 300,
    new_additions: 0,
  });
  assert.deepEqual(result.slots, { inventory: 2478, checked: 589, confirmed_defects: 17, unresolved: 0 });
  assert.equal(result.production_changes, 0);
});

test("vocab:00083 preserves its source snapshot and records disbelief-only authority", () => {
  const batch = readJson("batches/batch-001.json").entries.find((row) => row.id === "vocab:00083");
  const semantic = readJson("semantic-reconciliation.json").entries.find((row) => row.id === "vocab:00083");
  const decision = readJson("decisions.json").entries.find((row) => row.id === "vocab:00083");
  const parenthetical = readJson("parenthetical-review.json").entries.find((row) => row.id === "vocab:00083");
  const resolution = readJson("upstream-resolution.json").entries.find((row) => row.id === "vocab:00083");
  const remediation = readJson("production-remediation-authority.json").entries.find((row) => row.id === "vocab:00083");

  assert.equal(batch.canonical, "no way");
  assert.equal(batch.sense_key, "strong_disbelief_or_refusal");
  assert.equal(batch.current_meaning_ja, "まさか（口語で強い驚き・拒否を表す）");
  assert.equal(semantic.current_sense_key, "strong_disbelief_or_refusal");
  assert.equal(semantic.recommended_sense_key, "strong_disbelief");
  assert.equal(semantic.recommended_canonical, "no way");
  assert.equal(semantic.recommended_meaning_ja, "まさか");
  assert.deepEqual(semantic.recommended_paraphrases, []);
  assert.equal(decision.entry_decision, "PROMPT_SIMPLIFY");
  assert.equal(decision.confidence, "HIGH");
  assert.equal(parenthetical.decision, "REMOVE_META_HINT");
  assert.equal(resolution.resolution_type, "EXPLICIT_SINGLE_SENSE_AUTHORITY");
  assert.equal(resolution.resolved_to, "strong_disbelief");
  assert.equal(resolution.excluded_sense, "strong_refusal");
  assert.equal(remediation.expected_before.sense_key, "strong_disbelief_or_refusal");
  assert.equal(remediation.recommended_after.sense_key, "strong_disbelief");
  assert.equal(remediation.recommended_after.meaning_ja, "まさか");
  assert.equal(remediation.materialization_eligible, true);
});
