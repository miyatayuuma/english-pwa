#!/usr/bin/env node

/**
 * Resolve the fixed vocab:00083 authority, reconcile the audit by ID against
 * an explicitly observed main SHA, and deterministically build final audit
 * projections. This script only writes within the audit directory.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintRecommendedPrompt } from "./aggregate-japanese-prompt-authority-parallel-review.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_REL = "data/audits/vocabulary-japanese-prompt-authority-reconciliation";
const AUDIT = resolve(ROOT, AUDIT_REL);
const VOCAB_REL = "data/vocabulary-v3.json";
const VOCAB_PATH = resolve(ROOT, VOCAB_REL);
const AUDIT_BASE_SHA = "9007e2f59cc6bfc48e7021caa3b469dae89adb60";
const START_AUDIT_HEAD = "8af36e0da1bdbaa07d1e77b76221d640044a161d";
const EXPECTED_PRODUCTION_BLOB = "c23643d26e71be22aaec5ec04ce63a7582ad9c25";
const ID = "vocab:00083";
const PROMPT_META = /(倒置|構文|文型|語順|文法|時制|不定詞|動名詞|分詞構文|関係代名詞|受動態|能動態|比較級|最上級|可算|不可算|countability|register|dialect|方言|口語|文語|米語|英語圏|アメリカ英語|イギリス英語|敬語|丁寧語|古風|発音|強勢|語形|スペリング|表現法|構文上)/i;
const SEMANTIC_FIELDS = ["canonical", "sense_key", "grammarRole", "meaning_ja", "paraphrases", "answers"];
const STRUCTURAL_FIELDS = ["kind", "subtype"];
const ENTRY_DECISIONS = {
  KEEP: 40,
  PROMPT_SIMPLIFY: 142,
  PARAPHRASE_RESTORE: 173,
  PROMPT_AND_PARAPHRASE_RECONCILE: 231,
  PARAPHRASE_REMOVE_SEMANTIC: 3,
  UPSTREAM_AUTHORITY_REVIEW: 0,
};
const PARENTHETICAL_DECISIONS = {
  REMOVE_META_HINT: 248,
  REWRITE_MINIMAL_SEMANTIC: 120,
  KEEP_SEMANTIC_SCOPE: 8,
  UPSTREAM_MEANING_REVIEW: 0,
};

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readText(path) { try { return readFileSync(path, "utf8"); } catch (error) { fail(`Cannot read ${path}: ${error.message}`); } }
function readJson(path) { try { return JSON.parse(readText(path)); } catch (error) { fail(`Cannot parse JSON ${path}: ${error.message}`); } }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a, b) { return stable(a) === stable(b); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function blobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function mapById(rows, label) {
  const out = new Map();
  for (const row of rows) {
    assert(row && typeof row.id === "string" && row.id, `${label} contains a row without id.`);
    assert(!out.has(row.id), `${label} contains duplicate id ${row.id}.`);
    out.set(row.id, row);
  }
  return out;
}
function counts(rows, keyOf) {
  const out = {};
  for (const row of rows) {
    const key = keyOf(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function normalizeState(entry) {
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
function mainVocabulary(mainSha, explicitPath, baseText) {
  if (explicitPath) return readText(isAbsolute(explicitPath) ? explicitPath : resolve(ROOT, explicitPath));
  if (mainSha === AUDIT_BASE_SHA) return baseText;
  try {
    return execFileSync("git", ["show", `${mainSha}:${VOCAB_REL}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    fail(`Cannot read current-main vocabulary at ${mainSha}; pass --main-vocabulary <path>. ${error.message}`);
  }
}
function parseArgs(argv) {
  const args = { mode: null, mainSha: null, mainVocabulary: null, branchHead: START_AUDIT_HEAD };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--write" || key === "--check") {
      assert(args.mode === null, "Choose exactly one of --write or --check.");
      args.mode = key.slice(2);
    } else if (["--main-sha", "--main-vocabulary", "--branch-head"].includes(key)) {
      const value = argv[++i];
      assert(value && !value.startsWith("--"), `${key} requires a value.`);
      if (key === "--main-sha") args.mainSha = value;
      if (key === "--main-vocabulary") args.mainVocabulary = value;
      if (key === "--branch-head") args.branchHead = value;
    } else fail(`Unknown argument: ${key}`);
  }
  args.mode ??= "check";
  assert(args.mainSha && /^[0-9a-f]{40}$/.test(args.mainSha), "Pass the latest observed main SHA with --main-sha.");
  assert(/^[0-9a-f]{40}$/.test(args.branchHead), "--branch-head must be a full SHA.");
  return args;
}

function buildPlan(args) {
  const manifest = readJson(resolve(AUDIT, "manifest.json"));
  const indexDoc = readJson(resolve(AUDIT, "review-index.json"));
  const decisionsDoc = readJson(resolve(AUDIT, "decisions.json"));
  const parentheticalDoc = readJson(resolve(AUDIT, "parenthetical-review.json"));
  const semanticDoc = readJson(resolve(AUDIT, "semantic-reconciliation.json"));
  const phraseDoc = readJson(resolve(AUDIT, "paraphrase-reconciliation.json"));
  const slotReview = readJson(resolve(AUDIT, "slot-review.json"));
  const baseText = readText(VOCAB_PATH);
  assert(blobSha(baseText) === EXPECTED_PRODUCTION_BLOB, "Production vocabulary differs from the immutable audit base.");
  assert(manifest.audit_base_main_sha === AUDIT_BASE_SHA, "Audit base SHA differs from the pinned source.");
  assert(manifest.production_source?.git_blob_sha === EXPECTED_PRODUCTION_BLOB, "Manifest production blob differs from the pinned source.");
  assert(args.mainSha === AUDIT_BASE_SHA || args.mainVocabulary, "An advanced main SHA requires a fetched --main-vocabulary snapshot.");

  const batches = [];
  for (let n = 1; n <= manifest.populations.batch_count; n += 1) {
    const path = resolve(AUDIT, "batches", `batch-${String(n).padStart(3, "0")}.json`);
    const doc = readJson(path);
    assert(Array.isArray(doc.entries), `${doc.batch_id} has no entries array.`);
    batches.push({ path, doc: structuredClone(doc) });
  }
  const allRows = batches.flatMap(({ doc }) => doc.entries);
  const batchById = mapById(allRows, "canonical batches");
  const index = structuredClone(indexDoc);
  const decisionEntries = structuredClone(decisionsDoc.entries);
  const parentheticalEntries = structuredClone(parentheticalDoc.entries);
  const semanticEntries = structuredClone(semanticDoc.entries);
  const indexById = mapById(index.entries, "review-index");
  const decisionsById = mapById(decisionEntries, "decisions");
  const parentheticalById = mapById(parentheticalEntries, "parenthetical review");
  const semanticById = mapById(semanticEntries, "semantic reconciliation");
  const baseVocabulary = JSON.parse(baseText);
  const mainText = mainVocabulary(args.mainSha, args.mainVocabulary, baseText);
  const main = JSON.parse(mainText);
  assert(Array.isArray(baseVocabulary.entries) && Array.isArray(main.entries), "Production snapshots must contain entries arrays.");
  const baseById = mapById(baseVocabulary.entries, "audit-base production");
  const mainById = mapById(main.entries, "latest-main production");
  const unionIds = [...batchById.keys()];
  assert(unionIds.length === 589 && index.entries.length === 589 && decisionEntries.length === 589 && semanticEntries.length === 589, "Audit union coverage must equal 589.");
  assert(equal([...unionIds].sort(), [...indexById.keys()].sort()), "Review-index IDs do not equal batch IDs.");
  assert(equal([...unionIds].sort(), [...decisionsById.keys()].sort()), "Decision IDs do not equal batch IDs.");
  assert(equal([...unionIds].sort(), [...semanticById.keys()].sort()), "Semantic projection IDs do not equal batch IDs.");

  const id83 = batchById.get(ID);
  const prod83 = baseById.get(ID);
  assert(id83 && prod83, "vocab:00083 is missing from the production snapshot or audit batch.");
  assert(prod83.canonical === "no way" && prod83.sense_key === "strong_disbelief_or_refusal" && prod83.meaning_ja === "まさか（口語で強い驚き・拒否を表す）" && prod83.grammarRole === "interjection", "vocab:00083 current production snapshot differs from the fixed authority input.");
  assert(prod83.occurrences?.some((row) => row.contextual_meaning_ja === "まさか"), "vocab:00083 occurrence context differs from the fixed authority input.");
  assert(id83.previous_nuance_before?.meaning_ja === "まさか", "vocab:00083 previous prompt differs from the fixed authority input.");
  assert(id83.canonical === "no way" && id83.sense_key === "strong_disbelief_or_refusal", "vocab:00083 batch source snapshot must remain unchanged.");

  const resolution = {
    id: ID,
    resolution_type: "EXPLICIT_SINGLE_SENSE_AUTHORITY",
    resolved_from: "strong_disbelief_or_refusal",
    resolved_to: "strong_disbelief",
    recommended_prompt: "まさか",
    canonical: "no way",
    excluded_sense: "strong_refusal",
    evidence: {
      current_occurrence_meaning_ja: "まさか",
      previous_prompt: "まさか",
      scope: "strong disbelief / incredulity only",
      exclusion: "Refusal readings such as 絶対嫌だ, 絶対だめだ, and そんなの無理だ are not part of this card.",
    },
    reason: "The current occurrence and previous prompt support disbelief. A single Japanese prompt must not combine disbelief with refusal; a refusal sense can be represented by a separate card if needed.",
    confidence: "HIGH",
    review_status: "REVIEWED",
  };
  const resolutionProvenance = {
    authority_type: resolution.resolution_type,
    branch: "audit/vocabulary-japanese-prompt-authority-reconciliation",
    branch_head: args.branchHead,
    resolved_from: resolution.resolved_from,
    resolved_to: resolution.resolved_to,
    excluded_sense: resolution.excluded_sense,
  };

  id83.parenthetical_review = {
    ...id83.parenthetical_review,
    parenthetical_decision: "REMOVE_META_HINT",
    recommended_prompt: "まさか",
    retained_semantic_information: "強い不信・驚き（disbelief / incredulity）。",
    removed_meta_information: "「口語」というregister提示、およびこのカードの学習範囲に含めない拒否sense。",
    prompt_reason: "出現文脈と以前のpromptはいずれも「まさか」であり、disbelief senseに限定する。canonicalの拒否用法をこのカードのpromptへ混ぜない。",
    prompt_confidence: "HIGH",
    review_status: "REVIEWED",
    target_leakage_checked: true,
    meta_hint_checked: true,
    prompt_minimality: "PASS",
  };
  id83.entry_decision = "PROMPT_SIMPLIFY";
  id83.recommended_prompt = "まさか";
  id83.recommended_meaning_ja = "まさか";
  id83.recommended_sense_key = "strong_disbelief";
  id83.recommended_paraphrases = [];
  id83.review_status = "REVIEWED";
  id83.resolution_provenance = resolutionProvenance;

  const index83 = indexById.get(ID);
  index83.review_status = "REVIEWED";
  index83.entry_decision = "PROMPT_SIMPLIFY";
  const decision83 = decisionsById.get(ID);
  Object.assign(decision83, {
    entry_decision: "PROMPT_SIMPLIFY",
    recommended_prompt: "まさか",
    recommended_meaning_ja: "まさか",
    recommended_sense_key: "strong_disbelief",
    recommended_paraphrases: [],
    review_status: "REVIEWED",
    confidence: "HIGH",
    provenance: resolutionProvenance,
    resolution_provenance: resolutionProvenance,
  });
  const parenthetical83 = parentheticalById.get(ID);
  Object.assign(parenthetical83, {
    decision: "REMOVE_META_HINT",
    parenthetical_decision: "REMOVE_META_HINT",
    recommended_prompt: "まさか",
    retained_semantic_information: id83.parenthetical_review.retained_semantic_information,
    removed_meta_information: id83.parenthetical_review.removed_meta_information,
    reason: id83.parenthetical_review.prompt_reason,
    prompt_reason: id83.parenthetical_review.prompt_reason,
    confidence: "HIGH",
    prompt_confidence: "HIGH",
    review_status: "REVIEWED",
    target_leakage_checked: true,
    meta_hint_checked: true,
    prompt_minimality: "PASS",
    provenance: resolutionProvenance,
    resolution_provenance: resolutionProvenance,
  });

  const slotById = mapById(slotReview, "slot review");
  const sourceSnapshotMismatches = [];
  const mainChanges = [];
  const mainChangedIds = [];
  const semanticChangedIds = [];
  const structuralOnlyIds = [];
  const removedIds = [];
  const rekeyedIds = [];
  const changedFieldsById = {};
  const baseComparisonFields = ["canonical", "sense_key", "grammarRole", "meaning_ja", "paraphrases", "answers", ...STRUCTURAL_FIELDS];
  for (const id of unionIds) {
    const snapshot = batchById.get(id);
    const baseEntry = baseById.get(id);
    const current = mainById.get(id);
    if (!baseEntry || !current) { removedIds.push(id); continue; }
    if (baseEntry.canonical !== current.canonical) rekeyedIds.push(id);
    const baseState = normalizeState(baseEntry);
    for (const field of baseComparisonFields) {
      const snapshotValue = field === "meaning_ja" ? snapshot.current_meaning_ja : field === "paraphrases" ? snapshot.current_paraphrases : snapshot[field];
      const actualValue = field === "kind" || field === "subtype" ? baseEntry[field] ?? null : field === "answers" ? (Object.hasOwn(baseEntry, field) ? baseEntry[field] : null) : field === "paraphrases" ? baseEntry.paraphrases ?? [] : baseEntry[field] ?? null;
      if (field !== "kind" && field !== "subtype" && !equal(snapshotValue ?? (field === "paraphrases" ? [] : null), actualValue)) sourceSnapshotMismatches.push({ id, field });
    }
    const changedFields = baseComparisonFields.filter((field) => {
      const a = field === "meaning_ja" ? baseState.meaning_ja : field === "paraphrases" ? baseState.paraphrases : field === "answers" ? baseState.answers : baseState[field];
      const b = field === "meaning_ja" ? (current.meaning_ja ?? null) : field === "paraphrases" ? (current.paraphrases ?? []) : field === "answers" ? (Object.hasOwn(current, field) ? current[field] : null) : current[field] ?? null;
      return !equal(a, b);
    });
    if (changedFields.length) {
      mainChangedIds.push(id);
      changedFieldsById[id] = changedFields;
      const semanticChanged = changedFields.filter((field) => SEMANTIC_FIELDS.includes(field));
      if (semanticChanged.length) semanticChangedIds.push(id);
      else structuralOnlyIds.push(id);
      mainChanges.push({ id, source_index: snapshot.source_index, changed_fields: changedFields });
    }
  }
  assert(sourceSnapshotMismatches.length === 0, `Batch source snapshots differ from audit-base production: ${JSON.stringify(sourceSnapshotMismatches.slice(0, 10))}.`);
  const driftCounts = {
    NON_SEMANTIC_DRIFT: structuralOnlyIds.length,
    SEMANTIC_DRIFT_REVALIDATED_SAME: 0,
    SEMANTIC_DRIFT_REQUIRES_UPDATE: semanticChangedIds.length,
    SOURCE_REMOVED_OR_REKEYED: removedIds.length + rekeyedIds.length,
  };
  const mainPass = semanticChangedIds.length === 0 && removedIds.length === 0 && rekeyedIds.length === 0;
  assert(mainPass, `Latest-main reconciliation requires STOP: semantic=${semanticChangedIds.join(",")}; removed=${removedIds.join(",")}; rekeyed=${rekeyedIds.join(",")}.`);

  const finalIndexCounts = counts(index.entries, (row) => row.review_status);
  const rawDecisionCounts = counts(decisionEntries, (row) => row.entry_decision);
  const decisionCounts = Object.fromEntries(Object.keys(ENTRY_DECISIONS).map((key) => [key, rawDecisionCounts[key] || 0]));
  const rawParentheticalCounts = counts(parentheticalEntries, (row) => row.decision);
  const parentheticalCounts = Object.fromEntries(Object.keys(PARENTHETICAL_DECISIONS).map((key) => [key, rawParentheticalCounts[key] || 0]));
  const confidenceCounts = counts(decisionEntries.filter((row) => row.review_status === "REVIEWED"), (row) => row.confidence || "MISSING");
  assert(equal(finalIndexCounts, { REVIEWED: 589 }), `Final review states differ: ${JSON.stringify(finalIndexCounts)}.`);
  assert(equal(decisionCounts, ENTRY_DECISIONS), `Final entry decisions differ: ${JSON.stringify(decisionCounts)}.`);
  assert(equal(parentheticalCounts, PARENTHETICAL_DECISIONS), `Final parenthetical decisions differ: ${JSON.stringify(parentheticalCounts)}.`);
  assert(equal(confidenceCounts, { HIGH: 438, MEDIUM: 151 }), `Final confidence counts differ: ${JSON.stringify(confidenceCounts)}.`);
  assert(decisionEntries.every((row) => row.confidence === "HIGH" || row.confidence === "MEDIUM"), "Every reviewed entry must have HIGH or MEDIUM confidence.");
  assert(index.entries.every((row) => row.slot_integrity_checked === true), "All 589 union entries must pass the slot check.");
  assert(allRows.every((row) => row.slot_integrity_checked === true && ["CLEAR", "REVIEWED"].includes(row.slot_reconciliation?.review_status)), "Every batch slot reconciliation must be resolved.");
  const slotDefects = slotReview.filter((row) => !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(row.decision));
  assert(slotDefects.length === 17 && slotDefects.every((row) => row.review_status === "REVIEWED"), "All 17 confirmed slot defects must be integrated and resolved.");

  const promptsById = new Map();
  const recommendedParaphrasesById = new Map();
  const promptLintFindings = [];
  for (const row of decisionEntries) {
    const prompt = row.recommended_prompt;
    const batch = batchById.get(row.id);
    assert(typeof prompt === "string" && prompt.trim(), `Missing recommended prompt for ${row.id}.`);
    const lint = lintRecommendedPrompt(prompt, batch.canonical);
    if (lint.targetLeakage || lint.metaHint || PROMPT_META.test(prompt)) promptLintFindings.push({ id: row.id, ...lint });
    promptsById.set(row.id, prompt);
    assert(Array.isArray(row.recommended_paraphrases), `Missing recommended paraphrase list for ${row.id}.`);
    recommendedParaphrasesById.set(row.id, row.recommended_paraphrases);
  }
  assert(promptLintFindings.length === 0, `Recommended prompt authority has unresolved leakage/meta hints: ${JSON.stringify(promptLintFindings.slice(0, 10))}.`);
  const leakageIds = new Set(allRows.filter((row) => row.cohort_flags?.current_parenthetical === true)
    .filter((row) => (row.current_parenthetical_segments || []).some((segment) => /[A-Za-z]/.test(segment))).map((row) => row.id));
  const targetLeakage = {
    found: leakageIds.size,
    resolved: [...leakageIds].filter((id) => indexById.get(id)?.review_status === "REVIEWED").length,
    upstream: [...leakageIds].filter((id) => indexById.get(id)?.review_status === "UPSTREAM").length,
    pending: [...leakageIds].filter((id) => indexById.get(id)?.review_status === "PENDING").length,
    entry_ids: [...leakageIds].sort(),
  };
  assert(targetLeakage.found === 5 && targetLeakage.resolved === 5 && targetLeakage.upstream === 0 && targetLeakage.pending === 0, "Target leakage cohort must be 5/5 resolved.");
  const metaHintRows = allRows.filter((row) => row.cohort_flags?.current_parenthetical === true)
    .filter((row) => {
      const decision = batchById.get(row.id).parenthetical_review?.parenthetical_decision;
      return (decision === "REMOVE_META_HINT" && !leakageIds.has(row.id)) || decision === "UPSTREAM_MEANING_REVIEW";
    });
  const metaHint = {
    found: metaHintRows.length,
    resolved: metaHintRows.filter((row) => indexById.get(row.id)?.review_status === "REVIEWED").length,
    upstream: metaHintRows.filter((row) => indexById.get(row.id)?.review_status === "UPSTREAM").length,
    pending: metaHintRows.filter((row) => indexById.get(row.id)?.review_status === "PENDING").length,
    entry_ids: metaHintRows.map((row) => row.id).sort(),
  };
  assert(metaHint.found === 243 && metaHint.resolved === 243 && metaHint.upstream === 0 && metaHint.pending === 0, "Meta-hint cohort must be 243/243 resolved.");

  const phraseCounts = counts(phraseDoc.entries, (row) => `${row.source}:${row.decision}`);
  assert(phraseDoc.entries.length === 978, "Phrase reconciliation must contain all 978 source phrase judgments.");
  assert(phraseCounts["HISTORICAL_REMOVAL:RESTORE"] === 531 && phraseCounts["HISTORICAL_REMOVAL:KEEP_REMOVED_SEMANTIC_MISMATCH"] === 139, "Historical removal judgments differ.");
  assert(phraseCounts["HISTORICAL_ADDITION:KEEP_ADDED"] + (phraseCounts["HISTORICAL_ADDITION:KEEP"] || 0) === 8 && (phraseCounts["HISTORICAL_ADDITION:REMOVE"] || 0) === 0, "Historical addition judgments differ.");
  assert((phraseCounts["CURRENT:KEEP_CURRENT"] || 0) + (phraseCounts["CURRENT:KEEP"] || 0) === 295 && (phraseCounts["CURRENT:REMOVE_CURRENT_SEMANTIC_MISMATCH"] || 0) + (phraseCounts["CURRENT:REMOVE"] || 0) === 5, "Current paraphrase judgments differ.");
  assert(phraseDoc.entries.filter((row) => row.source === "NEW_ADDITION").length === 0, "No new paraphrases may be added in this audit.");
  const divergence = manifest.historical_materialization_divergence;
  assert(divergence?.mismatched_entries === 340 && divergence.field_mismatch_counts?.paraphrases === 340, "Historical divergence must remain 340 paraphrase-only differences.");
  assert(Object.entries(divergence.field_mismatch_counts).every(([field, count]) => field === "paraphrases" || count === 0), "Historical divergence gained a non-paraphrase field.");

  const semanticProjection = structuredClone(semanticDoc);
  const projectedRows = semanticEntries.map((oldRow) => {
    const batch = batchById.get(oldRow.id);
    const baseEntry = baseById.get(oldRow.id);
    const current = mainById.get(oldRow.id);
    const currentState = normalizeState(current);
    const decision = decisionsById.get(oldRow.id);
    const prompt = promptsById.get(oldRow.id);
    const recommendedSenseKey = decision.recommended_sense_key ?? batch.sense_key;
    const recommendedParaphrases = recommendedParaphrasesById.get(oldRow.id);
    const expectedAfter = {
      canonical: currentState.canonical,
      sense_key: recommendedSenseKey,
      meaning_ja: prompt,
      paraphrases: recommendedParaphrases,
      answers: currentState.answers,
    };
    const expectedBefore = {
      canonical: currentState.canonical,
      sense_key: currentState.sense_key,
      meaning_ja: currentState.meaning_ja,
      paraphrases: currentState.paraphrases,
      answers: currentState.answers,
    };
    const changedFields = ["canonical", "sense_key", "meaning_ja", "paraphrases", "answers"]
      .filter((field) => !equal(expectedBefore[field], expectedAfter[field]));
    const slot = batch.slot_reconciliation || {};
    const recommended = {
      ...oldRow,
      current_canonical: currentState.canonical,
      recommended_canonical: expectedAfter.canonical,
      current_sense_key: currentState.sense_key,
      recommended_sense_key: expectedAfter.sense_key,
      current_meaning_ja: currentState.meaning_ja,
      recommended_meaning_ja: expectedAfter.meaning_ja,
      current_paraphrases: currentState.paraphrases,
      recommended_paraphrases: expectedAfter.paraphrases,
      current_answers: currentState.answers,
      recommended_answers: expectedAfter.answers,
      current_main_state: currentState,
      current_main_changed_fields: changedFieldsById[oldRow.id] || [],
      main_drift_classification: changedFieldsById[oldRow.id]
        ? (changedFieldsById[oldRow.id].some((field) => SEMANTIC_FIELDS.includes(field)) ? "SEMANTIC_DRIFT_REQUIRES_UPDATE" : "NON_SEMANTIC_DRIFT")
        : "CURRENT_MAIN_UNCHANGED",
      prompt_changed: !equal(expectedBefore.meaning_ja, expectedAfter.meaning_ja),
      sense_key_changed: !equal(expectedBefore.sense_key, expectedAfter.sense_key),
      paraphrases_changed: !equal(expectedBefore.paraphrases, expectedAfter.paraphrases),
      slot_remediation: Boolean(oldRow.slot_remediation || (slot.decision && !["KEEP_SLOT_PROFILE", "UPSTREAM_SLOT_AUTHORITY_REVIEW"].includes(slot.decision))),
      entry_decision: decision.entry_decision,
      confidence: decision.confidence,
      final_review_status: "REVIEWED",
      review_status: "REVIEWED",
      production_eligible: changedFields.length > 0,
      production_exclusion_reason: changedFields.length ? null : "NO_PRODUCTION_CHANGE",
      production_readiness: changedFields.length ? "REMEDIATION_READY" : "NO_CHANGE_REQUIRED",
      provenance: decision.provenance,
    };
    if (oldRow.id === ID) recommended.resolution_provenance = resolutionProvenance;
    return recommended;
  });

  const materializationCandidates = projectedRows.filter((row) => row.production_eligible);
  const currentCandidates = [];
  const senseKeyChanges = projectedRows.filter((row) => row.sense_key_changed);
  assert(projectedRows.every((row) => row.recommended_canonical === row.current_canonical), "Canonical recommendations must remain unchanged.");
  assert(senseKeyChanges.length === 1 && senseKeyChanges[0].id === ID && senseKeyChanges[0].recommended_sense_key === "strong_disbelief", "Only vocab:00083 may change sense_key.");
  const candidateIds = new Set(materializationCandidates.map((row) => row.id));
  for (const row of projectedRows) {
    if (row.production_eligible) {
      const current = mainById.get(row.id);
      const before = normalizeState(current);
      const after = {
        canonical: row.recommended_canonical,
        sense_key: row.recommended_sense_key,
        meaning_ja: row.recommended_meaning_ja,
        paraphrases: row.recommended_paraphrases,
        answers: row.recommended_answers,
      };
      const slot = batchById.get(row.id).slot_reconciliation || {};
      const decision = decisionsById.get(row.id);
      const provenance = decision.provenance;
      const entry = {
        id: row.id,
        source_index: batchById.get(row.id).source_index,
        expected_before: before,
        recommended_after: after,
        changed_fields: ["canonical", "sense_key", "meaning_ja", "paraphrases", "answers"].filter((field) => !equal(before[field], after[field])),
        entry_decision: decision.entry_decision,
        confidence: decision.confidence,
        slot_authority: {
          review_status: slot.review_status ?? "CLEAR",
          decision: slot.decision ?? "KEEP_SLOT_PROFILE",
          slot_review_id: slot.slot_review_id ?? null,
          recommended_prompt: slot.recommended_prompt ?? null,
          reason: slot.reason ?? "No variable slot remediation is required.",
        },
        provenance: row.id === ID ? resolutionProvenance : provenance,
        materialization_eligible: true,
        exclusion_reason: null,
      };
      currentCandidates.push(entry);
    }
  }
  assert(currentCandidates.length === candidateIds.size, "Remediation authority candidate IDs differ from the semantic projection.");
  assert(currentCandidates.every((row) => row.changed_fields.length > 0), "Remediation authority must not contain unchanged entries.");
  assert(currentCandidates.some((row) => row.id === ID && row.expected_before.sense_key === "strong_disbelief_or_refusal" && row.recommended_after.sense_key === "strong_disbelief"), "vocab:00083 is missing from remediation authority.");

  const currentMain = {
    status: "PASS",
    audit_base_main_sha: AUDIT_BASE_SHA,
    final_current_main_reconciliation_sha: args.mainSha,
    comparison_method: "ID_JOIN_ONLY; source_index is diagnostic metadata only",
    population: 589,
    comparison_fields: baseComparisonFields,
    changed_ids: mainChangedIds,
    changed_id_count: mainChangedIds.length,
    semantic_affected_ids: semanticChangedIds,
    semantically_affected_id_count: semanticChangedIds.length,
    revalidated_ids: [],
    removed_ids: removedIds,
    rekeyed_ids: rekeyedIds,
    classifications: driftCounts,
    unresolved_semantic_drift: semanticChangedIds.length,
    changed_fields_by_id: changedFieldsById,
    source_snapshot_mismatches: sourceSnapshotMismatches,
    historical_materialization_divergence: {
      mismatched_entries: divergence.mismatched_entries,
      field_mismatch_counts: divergence.field_mismatch_counts,
      classification: "HISTORICAL_MATERIALIZATION_DIVERGENCE; not current-main staleness",
    },
  };
  const resolutionDoc = {
    schema_version: 1,
    status: "RESOLVED",
    authority: "single-sense disbelief-only scope for vocab:00083",
    entries: [resolution],
  };
  semanticProjection.status = "CLOSED";
  semanticProjection.review = { REVIEWED: 589, UPSTREAM: 0, PENDING: 0 };
  semanticProjection.current_main_reconciliation = "COMPLETE";
  semanticProjection.final_current_main_reconciliation_sha = args.mainSha;
  semanticProjection.current_main_reconciliation_detail = currentMain;
  semanticProjection.production_changes = 0;
  semanticProjection.entries = projectedRows;
  semanticProjection.notes = [
    "Japanese prompts are judged by the meaning requested, not canonical-specific wording.",
    "The 340 paraphrase-only historical materialization divergences remain informational and are not current-main stale entries.",
    "Production materialization has not started; only changed entries are eligible in production-remediation-authority.json.",
  ];

  const remediationDoc = {
    schema_version: 1,
    status: "READY_FOR_PRODUCTION_MATERIALIZATION",
    audit: "vocabulary-japanese-prompt-authority-reconciliation",
    audit_base_main_sha: AUDIT_BASE_SHA,
    final_current_main_reconciliation_sha: args.mainSha,
    production_path: VOCAB_REL,
    production_git_blob_sha: EXPECTED_PRODUCTION_BLOB,
    joined_by: "id",
    candidate_count: currentCandidates.length,
    candidate_ids: currentCandidates.map((row) => row.id),
    change_counts: {
      meaning_ja: currentCandidates.filter((row) => row.changed_fields.includes("meaning_ja")).length,
      paraphrases: currentCandidates.filter((row) => row.changed_fields.includes("paraphrases")).length,
      meaning_ja_and_paraphrases: currentCandidates.filter((row) => row.changed_fields.includes("meaning_ja") && row.changed_fields.includes("paraphrases")).length,
      sense_key: currentCandidates.filter((row) => row.changed_fields.includes("sense_key")).length,
      canonical: currentCandidates.filter((row) => row.changed_fields.includes("canonical")).length,
      answers: currentCandidates.filter((row) => row.changed_fields.includes("answers")).length,
    },
    production_changes_during_audit: 0,
    entries: currentCandidates,
    excluded_unchanged_entry_count: 589 - currentCandidates.length,
    eligibility: {
      all_reviewed: true,
      no_low_confidence: true,
      latest_main_reconciliation: "PASS",
      unresolved_slot_conflicts: 0,
      target_leakage_unresolved: 0,
      meta_hint_unresolved: 0,
      production_source_exact: true,
    },
    next_task: "Japanese Prompt Authority Production Materialization",
  };
  const manifestUpdate = {
    status: "CLOSED",
    final_current_main_reconciliation_sha: args.mainSha,
    branch_head_at_generation: args.branchHead,
    current_main_reconciliation: currentMain,
    upstream_resolution: "upstream-resolution.json",
    semantic_reconciliation: "COMPLETE",
    strict_validator: "PASS",
    deterministic_regeneration: "PASS",
    production_materialization: "NOT_STARTED",
    production_changes: 0,
    remediation_authority: {
      path: "production-remediation-authority.json",
      status: remediationDoc.status,
      candidate_count: remediationDoc.candidate_count,
      meaning_ja_changes: remediationDoc.change_counts.meaning_ja,
      paraphrase_changes: remediationDoc.change_counts.paraphrases,
      meaning_and_paraphrase_changes: remediationDoc.change_counts.meaning_ja_and_paraphrases,
      sense_key_changes: remediationDoc.change_counts.sense_key,
    },
  };
  const output = new Map();
  for (const { path, doc } of batches) output.set(path, json(doc));
  output.set(resolve(AUDIT, "review-index.json"), json(index));
  output.set(resolve(AUDIT, "decisions.json"), json({ ...decisionsDoc, entries: decisionEntries }));
  output.set(resolve(AUDIT, "parenthetical-review.json"), json({ ...parentheticalDoc, entries: parentheticalEntries }));
  output.set(resolve(AUDIT, "paraphrase-reconciliation.json"), readText(resolve(AUDIT, "paraphrase-reconciliation.json")));
  output.set(resolve(AUDIT, "semantic-reconciliation.json"), json(semanticProjection));
  output.set(resolve(AUDIT, "upstream-resolution.json"), json(resolutionDoc));
  output.set(resolve(AUDIT, "current-main-reconciliation.json"), json(currentMain));
  output.set(resolve(AUDIT, "production-remediation-authority.json"), json(remediationDoc));
  return { output, manifestUpdate, currentMain, remediationDoc, resolutionDoc };
}

function mapEqual(left, right) {
  return left.size === right.size && [...left].every(([path, body]) => right.get(path) === body);
}
function currentBodyMatches(path, body) {
  try { return readText(path) === body; } catch { return false; }
}
function updateManifest(update) {
  const path = resolve(AUDIT, "manifest.json");
  const manifest = readJson(path);
  Object.assign(manifest, update);
  writeFileSync(path, json(manifest));
}
export function runFinalizer(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const first = buildPlan(args);
  const second = buildPlan(args);
  assert(mapEqual(first.output, second.output) && equal(first.manifestUpdate, second.manifestUpdate), "Finalizer generation is nondeterministic for identical inputs.");
  const changed = [...first.output].filter(([path, body]) => !currentBodyMatches(path, body)).map(([path]) => path);
  const manifest = readJson(resolve(AUDIT, "manifest.json"));
  const manifestNeedsUpdate = Object.entries(first.manifestUpdate).some(([key, value]) => !equal(manifest[key], value));
  if (args.mode === "write") {
    for (const [path, body] of first.output) writeFileSync(path, body);
    if (manifestNeedsUpdate) updateManifest(first.manifestUpdate);
    const after = buildPlan(args);
    assert(mapEqual(first.output, after.output), "Post-write finalizer output differs from generated output.");
    if (changed.length === 0 && !manifestNeedsUpdate) console.log("PASS: finalizer --write is idempotent; no-op.");
    else console.log(`WROTE ${changed.length} changed audit artifacts and final manifest authority.`);
    console.log(JSON.stringify({ latest_main_sha: first.currentMain.final_current_main_reconciliation_sha, candidates: first.remediationDoc.candidate_count }, null, 2));
    const productionNow = blobSha(readText(VOCAB_PATH));
    assert(productionNow === EXPECTED_PRODUCTION_BLOB, "Production vocabulary changed during audit finalization.");
  } else {
    const mismatches = changed.map((path) => path.replace(`${ROOT}/`, ""));
    assert(mismatches.length === 0 && !manifestNeedsUpdate, `Final audit artifacts differ from deterministic output: ${mismatches.join(", ") || "manifest.json"}. Run with --write.`);
    assert(manifest.status === "CLOSED" && manifest.strict_validator === "PASS" && manifest.deterministic_regeneration === "PASS", "Manifest does not record closed strict validation and deterministic regeneration.");
    assert(blobSha(readText(VOCAB_PATH)) === EXPECTED_PRODUCTION_BLOB, "Production vocabulary differs from the immutable audit base.");
    console.log("PASS: finalizer --check; canonical projections and production boundary are current.");
  }
  return { result: "PASS", changed: changed.length, latest_main_sha: first.currentMain.final_current_main_reconciliation_sha, candidates: first.remediationDoc.candidate_count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runFinalizer(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
