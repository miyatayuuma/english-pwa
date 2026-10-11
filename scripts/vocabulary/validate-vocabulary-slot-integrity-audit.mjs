#!/usr/bin/env node

/** Strict structural and closure validator for the slot integrity audit. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_DIR = resolve(ROOT, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const VOCAB_PATH = resolve(ROOT, "data/vocabulary-v3.json");
const ALLOWED_DECISIONS = new Set([
  "KEEP_SLOT_PROFILE",
  "RESTORE_SLOT_PROMPT",
  "RESTORE_SLOT_AND_PARAPHRASE",
  "REWRITE_SLOT_PROFILE",
  "REMOVE_OVERCONSTRAINT",
  "UPSTREAM_SLOT_AUTHORITY_REVIEW",
]);
const ALLOWED_CLASSES = new Set([
  "SLOT_OK",
  "SLOT_MISSING",
  "SLOT_REPLACED_BY_EXAMPLE",
  "SLOT_REPLACED_BY_META_SCOPE",
  "SLOT_TYPE_MISMATCH",
  "SLOT_COUNT_MISMATCH",
  "SLOT_ROLE_MISMATCH",
  "SLOT_OVERCONSTRAINED",
  "AMBIGUOUS_SLOT_AUTHORITY",
]);
const SLOT_RE = /\b(?:someone|somebody|something|somewhere|someplace|ones?|one)\b/gi;
const ALLOWED_SLOT_ROLES = new Set(["PERSON", "PLACE", "THING", "THING_OR_EVENT", "THING_OR_ABSTRACT", "ACTION_OR_EVENT", "ONE_OR_ONES"]);

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { fail(`Cannot read JSON ${path}: ${error.message}`); }
}
function mapById(rows, label) {
  const map = new Map();
  for (const row of rows) {
    assert(typeof row.id === "string" && row.id.length > 0, `${label} row has no ID.`);
    assert(!map.has(row.id), `${label} contains duplicate ID ${row.id}.`);
    map.set(row.id, row);
  }
  return map;
}
function blobSha(text) {
  return createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function counts(rows) {
  const out = {};
  for (const row of rows) out[row.semantic_role] = (out[row.semantic_role] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function promptCounts(prompt) {
  const out = {};
  for (const match of String(prompt ?? "").matchAll(SLOT_RE)) {
    const token = match[0].toLowerCase();
    const type = ["someone", "somebody"].includes(token) ? "PERSON" : ["somewhere", "someplace"].includes(token) ? "PLACE" : ["one", "ones"].includes(token) ? "ONE_OR_ONES" : "THING";
    out[type] = (out[type] ?? 0) + 1;
  }
  for (const _match of String(prompt ?? "").matchAll(/[〜～]/gu)) out.ACTION_OR_EVENT = (out.ACTION_OR_EVENT ?? 0) + 1;
  return out;
}
function argumentFamilyCounts(profile) {
  const out = {};
  for (const [role, count] of Object.entries(profile)) {
    const family = role === "PERSON" ? "PERSON" : role === "PLACE" ? "PLACE" : role === "ONE_OR_ONES" ? "ONE_OR_ONES" : "THING";
    out[family] = (out[family] ?? 0) + count;
  }
  return out;
}

try {
  const vocabularyText = readFileSync(VOCAB_PATH, "utf8");
  const vocabulary = JSON.parse(vocabularyText);
  const manifest = readJson(resolve(AUDIT_DIR, "manifest.json"));
  const index = readJson(resolve(AUDIT_DIR, "review-index.json"));
  const inventory = readJson(resolve(AUDIT_DIR, "slot-inventory.json"));
  const candidates = readJson(resolve(AUDIT_DIR, "slot-candidates.json"));
  const review = readJson(resolve(AUDIT_DIR, "slot-review.json"));
  const summary = readJson(resolve(AUDIT_DIR, "slot-summary.json"));
  assert(Array.isArray(vocabulary.entries) && vocabulary.entries.length === 2478, "Production population must equal 2,478.");
  assert(Array.isArray(index.entries) && index.entries.length === 589, "Japanese Prompt Authority union population must equal 589.");
  assert(Array.isArray(inventory) && inventory.length === 2478, "Slot inventory must cover all 2,478 production entries.");

  const productionById = mapById(vocabulary.entries, "production");
  const inventoryById = mapById(inventory, "slot inventory");
  const candidateById = mapById(candidates, "slot candidates");
  const reviewById = mapById(review, "slot review");
  const unionById = mapById(index.entries, "audit union");
  assert(same([...productionById.keys()], [...inventoryById.keys()]), "Slot inventory IDs/order must exactly match production IDs/order.");
  assert(blobSha(vocabularyText) === manifest.production_source?.git_blob_sha, "Production vocabulary differs from the immutable audit base.");
  assert(summary.production_source?.git_blob_sha === manifest.production_source.git_blob_sha, "Slot summary source SHA does not match audit base.");

  assert(candidateById.size === reviewById.size, "Every mechanical candidate must have exactly one review row and no orphan review rows.");
  for (const [id, candidate] of candidateById) {
    const reviewed = reviewById.get(id);
    const inv = inventoryById.get(id);
    assert(reviewed && inv, `Candidate ${id} is missing inventory or review authority.`);
    assert(inv.mechanical_status === "CANDIDATE", `${id} is not marked as a mechanical candidate in inventory.`);
    assert(reviewed.review_status === "REVIEWED" || reviewed.review_status === "UPSTREAM", `${id} is still pending slot review.`);
    assert(ALLOWED_DECISIONS.has(reviewed.decision), `${id} has an unknown slot decision ${reviewed.decision}.`);
    assert(Array.isArray(reviewed.violation_classes) && reviewed.violation_classes.every((item) => ALLOWED_CLASSES.has(item)), `${id} has malformed violation classes.`);
    if (reviewed.review_status === "UPSTREAM" || reviewed.decision === "UPSTREAM_SLOT_AUTHORITY_REVIEW") {
      assert(reviewed.reason && reviewed.confidence === "LOW", `${id} upstream disposition requires a reason and LOW confidence.`);
    } else {
      assert(typeof reviewed.recommended_prompt === "string" && reviewed.recommended_prompt.length > 0, `${id} reviewed mismatch lacks a recommended prompt.`);
      assert(Array.isArray(reviewed.recommended_paraphrases), `${id} reviewed row must include recommended paraphrases.`);
      assert(reviewed.reason && reviewed.evidence?.length > 0, `${id} reviewed row lacks reason/evidence.`);
      assert(["HIGH", "MEDIUM", "LOW"].includes(reviewed.confidence), `${id} has invalid confidence.`);
      if (reviewed.decision !== "KEEP_SLOT_PROFILE") {
        const expected = argumentFamilyCounts(counts(inv.canonical_slot_tokens));
        const actual = argumentFamilyCounts(promptCounts(reviewed.recommended_prompt));
        for (const family of ["PERSON", "THING", "PLACE", "ONE_OR_ONES"]) {
          assert((expected[family] ?? 0) === (actual[family] ?? 0), `${id} recommended_prompt does not preserve ${family} slot count.`);
        }
      }
    }
    assert(reviewed.canonical === candidate.canonical && reviewed.sense_key === candidate.sense_key, `${id} review candidate snapshot is stale.`);
  }

  for (const [id, inv] of inventoryById) {
    assert(inv.canonical === productionById.get(id).canonical, `${id} canonical changed in slot inventory.`);
    assert(inv.kind === (productionById.get(id).kind ?? null), `${id} kind differs from production.`);
    assert(inv.grammarRole === (productionById.get(id).grammarRole ?? null), `${id} grammarRole differs from production.`);
    assert(inv.sense_key === (productionById.get(id).sense_key ?? null), `${id} sense_key differs from production.`);
    for (const field of ["canonical_slot_profile", "answer_slot_profile", "paraphrase_slot_profile", "Japanese_prompt_slot_profile"]) {
      assert(inv[field] && typeof inv[field] === "object" && !Array.isArray(inv[field]), `${id} ${field} must be an object.`);
      for (const [role, count] of Object.entries(inv[field])) {
        assert(ALLOWED_SLOT_ROLES.has(role), `${id} ${field}.${role} is not a recognized semantic slot role.`);
        assert(Number.isInteger(count) && count > 0, `${id} ${field}.${role} must be a positive integer.`);
      }
    }
    assert(same(inv.canonical_slot_profile, counts(inv.canonical_slot_tokens)), `${id} canonical profile does not reconcile to its slot tokens.`);
    assert(same(inv.Japanese_prompt_slot_profile, counts(inv.Japanese_prompt_slot_tokens)), `${id} prompt profile does not reconcile to its slot tokens.`);
    assert(inv.canonical_slot_tokens.every((row) => row.classification === "VARIABLE_SLOT"), `${id} lexical/ambiguous tokens were counted as variable slots without review.`);
    for (const row of [...inv.canonical_slot_tokens, ...inv.Japanese_prompt_slot_tokens]) {
      const token = row.token.toLowerCase();
      const validRole = ["someone", "somebody"].includes(token) ? row.semantic_role === "PERSON"
        : ["somewhere", "someplace"].includes(token) ? row.semantic_role === "PLACE"
          : ["one", "ones"].includes(token) ? row.semantic_role === "ONE_OR_ONES"
            : token === "something" ? ["THING", "THING_OR_EVENT", "THING_OR_ABSTRACT", "ACTION_OR_EVENT"].includes(row.semantic_role)
              : row.notation === "JAPANESE_WAVE_DASH" && row.semantic_role === "ACTION_OR_EVENT";
      assert(validRole, `${id} slot token ${row.token} has an incompatible semantic role ${row.semantic_role}.`);
    }
    assert(Array.isArray(inv.lexical_placeholder_tokens) && inv.lexical_placeholder_tokens.every((row) => row.classification === "LEXICAL_TOKEN" && row.source && row.context), `${id} lexical token lacks source/context evidence.`);
    assert(Array.isArray(inv.ambiguous_tokens) && inv.ambiguous_tokens.every((row) => row.classification === "AMBIGUOUS" && row.source && row.context), `${id} ambiguous token lacks source/context evidence.`);
    assert(["CLEAR", "CANDIDATE"].includes(inv.mechanical_status), `${id} has invalid mechanical status.`);
    assert((inv.mechanical_status === "CANDIDATE") === candidateById.has(id), `${id} inventory candidate status differs from candidate list.`);
  }

  // Regression controls for fixed lexical uses and the one true ambiguous phrase.
  for (const canonical of ["for one thing", "one after another", "one by one"]) {
    const row = inventory.find((item) => item.canonical === canonical);
    assert(row && row.canonical_slot_tokens.length === 0 && row.lexical_placeholder_tokens.some((token) => token.token === "one"), `${canonical} must classify one as lexical.`);
  }
  const somebody = inventory.find((item) => item.canonical === "somebody");
  assert(somebody && somebody.canonical_slot_tokens.length === 0 && somebody.lexical_placeholder_tokens.some((token) => token.token === "somebody"), "The somebody headword must remain lexical.");
  const relation = inventoryById.get("vocab:00328");
  assert(same(relation.canonical_slot_profile, { THING: 2 }) && same(relation.Japanese_prompt_slot_profile, { THING: 2 }), "The fixed middle something in 'something has something to do with something else' must not count as a third slot.");
  const degreePhrase = inventoryById.get("vocab:01377");
  assert(degreePhrase.ambiguous_tokens.some((row) => row.token === "something") && reviewById.get("vocab:01377")?.decision === "KEEP_SLOT_PROFILE", "something of a surprise must be human-resolved as non-slot.");
  assert(reviewById.get("vocab:01179")?.decision === "RESTORE_SLOT_AND_PARAPHRASE" && reviewById.get("vocab:01179")?.recommended_prompt === "somethingにさらされる", "vocab:01179 must restore its open argument slot.");

  const batches = [];
  for (let number = 1; number <= 6; number += 1) {
    const batch = readJson(resolve(AUDIT_DIR, `batches/batch-${String(number).padStart(3, "0")}.json`));
    assert(Array.isArray(batch.entries), `batch-${String(number).padStart(3, "0")} has no entries.`);
    batches.push(batch);
  }
  const batchRows = batches.flatMap((batch) => batch.entries);
  const batchById = mapById(batchRows, "audit batches");
  assert(batchById.size === 589, "Batch files must cover the exact 589-entry union.");
  for (const [id, row] of unionById) {
    const detail = batchById.get(id);
    assert(detail, `Union entry ${id} is absent from batches.`);
    assert(row.slot_integrity_checked === true && detail.slot_integrity_checked === true, `${id} has not passed the slot gate in both index and batch.`);
    assert(row.slot_reconciliation && detail.slot_reconciliation, `${id} is missing slot reconciliation evidence.`);
    assert(same(row.slot_reconciliation, detail.slot_reconciliation), `${id} slot reconciliation differs between index and batch.`);
    assert(row.slot_reconciliation_status === row.slot_reconciliation.review_status, `${id} slot reconciliation status is inconsistent.`);
    assert(same(row.slot_reconciliation.canonical_slot_profile, inventoryById.get(id).canonical_slot_profile), `${id} union link has a stale canonical slot profile.`);
    assert(same(row.slot_reconciliation.prompt_slot_profile, inventoryById.get(id).Japanese_prompt_slot_profile), `${id} union link has a stale prompt slot profile.`);
    if (candidateById.has(id)) assert(row.slot_reconciliation.review_status === "REVIEWED" || row.slot_reconciliation.review_status === "UPSTREAM", `${id} linked candidate is not dispositioned.`);
    if (row.review_status === "REVIEWED") assert(row.slot_integrity_checked === true, `Semantic REVIEWED entry ${id} is not slot checked.`);
  }

  assert(summary.candidates.total === candidates.length, "Slot summary candidate total mismatch.");
  assert(summary.candidates.reviewed + summary.candidates.upstream === candidates.length && summary.candidates.pending === 0, "Not every slot candidate is reviewed or upstream.");
  assert(summary.candidates.confirmed_defect_entries === 17 && summary.candidates.unresolved_defect_entries === 0, "Confirmed/unresolved defect accounting is inconsistent.");
  assert(summary.union_coverage.population === 589 && summary.union_coverage.slot_checked === 589 && summary.union_coverage.slot_pending === 0, "Union slot coverage is incomplete.");
  assert(summary.production_changes === 0 && manifest.production_changes === 0, "Production changes must remain zero.");
  assert(manifest.status === "SEMANTIC_REVIEW_COMPLETE_PENDING_FINAL_RECONCILIATION", "The audit must remain open pending latest-main reconciliation and strict final validation.");
  assert(index.entries.filter((row) => row.review_status === "PENDING").length === 0, "Semantic review must be complete before final reconciliation.");
  assert(manifest.historical_materialization_divergence?.mismatched_entries === 340, "Historical materialization divergence must remain distinct and equal 340.");

  console.log(JSON.stringify({
    result: "PASS",
    production_inventory: inventory.length,
    union_slot_checked: index.entries.filter((row) => row.slot_integrity_checked).length,
    candidates: candidates.length,
    reviewed: review.filter((row) => row.review_status === "REVIEWED").length,
    upstream: review.filter((row) => row.review_status === "UPSTREAM").length,
    pending: review.filter((row) => row.review_status === "PENDING").length,
    confirmed_defect_entries: summary.candidates.confirmed_defect_entries,
    production_changes: 0,
    audit_status: manifest.status,
  }, null, 2));
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
