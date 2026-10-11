import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { occurrenceRows } from "../scripts/vocabulary/audit-vocabulary-slot-integrity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_DIR = resolve(ROOT, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const vocabulary = readJson(resolve(ROOT, "data/vocabulary-v3.json")).entries;
const inventory = readJson(resolve(AUDIT_DIR, "slot-inventory.json"));
const candidates = readJson(resolve(AUDIT_DIR, "slot-candidates.json"));
const review = readJson(resolve(AUDIT_DIR, "slot-review.json"));
const index = readJson(resolve(AUDIT_DIR, "review-index.json")).entries;
const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

function check(name, fn) {
  fn();
  console.log(`# PASS ${name}`);
}

check("slot inventory covers production in exact order", () => {
  assert.equal(inventory.length, 2478);
  assert.deepEqual(inventory.map((row) => row.id), vocabulary.map((row) => row.id));
});

check("fixed one and somebody forms are lexical, not open slots", () => {
  for (const canonical of ["for one thing", "one after another", "one by one"]) {
    const row = inventory.find((item) => item.canonical === canonical);
    assert.ok(row, `missing fixture ${canonical}`);
    assert.deepEqual(row.canonical_slot_profile, {});
    assert.ok(row.lexical_placeholder_tokens.some((item) => item.token === "one"));
  }
  const somebody = inventory.find((row) => row.canonical === "somebody");
  assert.deepEqual(somebody.canonical_slot_profile, {});
  assert.ok(somebody.lexical_placeholder_tokens.some((item) => item.token === "somebody"));
});

check("placeholder lexer separates listed fixed phrases and hyphenated lexical forms", () => {
  for (const text of ["for one thing", "one after another", "one by one", "at one time", "twenty-something", "one-of-a-kind"]) {
    const result = occurrenceRows(text, text);
    assert.equal(result.rows.length, 0, `${text} must not create a variable slot`);
    assert.ok(result.lexical.length > 0, `${text} must have lexical-token evidence`);
    assert.equal(result.ambiguous.length, 0);
  }
  const ambiguous = occurrenceRows("something of a surprise", "something of a surprise");
  assert.equal(ambiguous.rows.length, 0);
  assert.equal(ambiguous.ambiguous[0]?.classification, "AMBIGUOUS");
});

check("fixed construction does not count its lexical middle something as a third slot", () => {
  const row = byId(inventory).get("vocab:00328");
  assert.deepEqual(row.canonical_slot_profile, { THING: 2 });
  assert.deepEqual(row.Japanese_prompt_slot_profile, { THING: 2 });
  assert.equal(row.mechanical_status, "CLEAR");
});

check("slot profiles preserve semantic argument roles beyond placeholder spelling", () => {
  assert.deepEqual(byId(inventory).get("vocab:01007").canonical_slot_profile, { PERSON: 1, THING_OR_EVENT: 1 });
  assert.deepEqual(byId(inventory).get("vocab:00988").canonical_slot_profile, { PERSON: 1, THING_OR_ABSTRACT: 1 });
});

check("ambiguous degree construction is explicitly human-resolved", () => {
  const row = byId(inventory).get("vocab:01377");
  assert.ok(row.ambiguous_tokens.some((item) => item.token === "something"));
  assert.equal(byId(review).get("vocab:01377").decision, "KEEP_SLOT_PROFILE");
  assert.equal(byId(review).get("vocab:01377").review_status, "REVIEWED");
});

check("exposed-to candidate restores its reusable slot and records paraphrase review", () => {
  const candidate = byId(candidates).get("vocab:01179");
  const decision = byId(review).get("vocab:01179");
  assert.ok(candidate.violation_classes.includes("SLOT_MISSING"));
  assert.ok(candidate.violation_classes.includes("SLOT_REPLACED_BY_EXAMPLE"));
  assert.equal(decision.decision, "RESTORE_SLOT_AND_PARAPHRASE");
  assert.equal(decision.recommended_prompt, "somethingにさらされる");
  assert.ok(decision.recommended_paraphrases.includes("be subjected to something"));
});

check("every semantic audit row has a slot check and every candidate is dispositioned", () => {
  assert.equal(index.length, 589);
  assert.ok(index.every((row) => row.slot_integrity_checked === true && row.slot_reconciliation));
  assert.ok(index.filter((row) => row.review_status === "REVIEWED").every((row) => row.slot_integrity_checked === true));
  assert.equal(candidates.length, review.length);
  assert.ok(review.every((row) => ["REVIEWED", "UPSTREAM"].includes(row.review_status)));
});
