#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const auditDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(auditDir, "../../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8"));
const auditRelative = "data/audits/vocabulary-word-final-consonant-family-prioritization";
const source = {
  original: readJson("data/audits/vocabulary-word-final-consonant-asr/candidates.json"),
  originalSafe: readJson("data/audits/vocabulary-word-final-consonant-asr/safe.json"),
  a2Candidates: readJson("data/audits/vocabulary-td-cluster-before-to/candidates.json"),
  a2Safe: readJson("data/audits/vocabulary-td-cluster-before-to/safe.json"),
  a2Rejected: readJson("data/audits/vocabulary-td-cluster-before-to/rejected.json"),
  overrides: readJson("data/audits/vocabulary-td-cluster-before-to/existing-audit-overrides.json"),
  a2Manifest: readJson("data/audits/vocabulary-td-cluster-before-to/manifest.json")
};
const manifest = readJson(auditRelative + "/manifest.json");
const population = readJson(auditRelative + "/population.json");
const summary = readJson(auditRelative + "/family-summary.json");
const ranking = readJson(auditRelative + "/family-ranking.json");
const recommendation = readJson(auditRelative + "/next-addendum-recommendation.json");
const partsDir = path.join(auditDir, "family-members");
const partFiles = fs.readdirSync(partsDir).filter((name) => name.endsWith(".json")).sort();
const members = partFiles.flatMap((name) => JSON.parse(fs.readFileSync(path.join(partsDir, name), "utf8")).records);
const checks = [];
const check = (name, condition, details) => checks.push({ name, status: condition ? "PASS" : "FAIL", details: details || null });
const unique = (values) => new Set(values).size === values.length;
const originalById = new Map(source.original.candidates.map((row) => [row.candidate_id, row]));
const originalRejectIds = source.original.candidates.filter((row) => row.decision === "REJECT").map((row) => row.candidate_id);
const originalSafeIds = source.originalSafe.candidates.map((row) => row.candidate_id);
const originalRejectSet = new Set(originalRejectIds);
const promotedIds = source.overrides.overrides.filter((row) => row.old_decision === "REJECT" && row.new_decision === "SAFE").map((row) => row.candidate_id);
const promotedSet = new Set(promotedIds);
const a2OriginalRejectIds = source.a2Candidates.candidates.map((row) => row.candidate_id).filter((id) => originalRejectSet.has(id));
const rerejectedIds = a2OriginalRejectIds.filter((id) => !promotedSet.has(id));
const rerejectedSet = new Set(rerejectedIds);
const remainingIds = originalRejectIds.filter((id) => !promotedSet.has(id) && !rerejectedSet.has(id));
const remainingSet = new Set(remainingIds);
const a2SafeSet = new Set(source.a2Safe.candidate_ids);
const a2RejectedSet = new Set(source.a2Rejected.candidate_ids);
const familyIds = new Set(summary.family_summaries.map((row) => row.family_id));
const memberIds = members.map((row) => row.candidate_id);
const memberById = new Map(members.map((row) => [row.candidate_id, row]));
const familyCounts = new Map();
for (const row of members) {
  if (row.primary_family) familyCounts.set(row.primary_family, (familyCounts.get(row.primary_family) || 0) + 1);
}
const allChangedPathsInAudit = Array.isArray(manifest.changed_paths) && manifest.changed_paths.every((file) => file.startsWith(auditRelative + "/"));
const checksFromPopulation = {
  originalReject4658: originalRejectIds.length === 4658 && population.counts.originalReject === 4658,
  promoted17: promotedIds.length === 17 && unique(promotedIds) && population.counts.promotedByTdToAddendum === 17,
  reconsidered16: rerejectedIds.length === 16 && unique(rerejectedIds) && population.counts.reconsideredTdToStillReject === 16,
  promotedRerejectedOverlap0: promotedIds.every((id) => !rerejectedSet.has(id)),
  partition4625: remainingIds.length === 4625 && population.counts.remainingDiscoveryPopulation === 4625,
  partitionArraysMatchSource: unique(population.candidate_ids.original_reject) &&
    population.candidate_ids.original_reject.length === originalRejectIds.length &&
    originalRejectIds.every((id) => population.candidate_ids.original_reject.includes(id)) &&
    unique(population.candidate_ids.promoted_by_td_to_addendum) &&
    promotedIds.every((id) => population.candidate_ids.promoted_by_td_to_addendum.includes(id)) &&
    unique(population.candidate_ids.already_reconsidered_td_to_still_reject) &&
    rerejectedIds.every((id) => population.candidate_ids.already_reconsidered_td_to_still_reject.includes(id)) &&
    unique(population.candidate_ids.remaining_discovery) &&
    remainingIds.length === population.candidate_ids.remaining_discovery.length &&
    remainingIds.every((id) => population.candidate_ids.remaining_discovery.includes(id)),
  allRemainingOriginalRejects: remainingIds.every((id) => originalRejectSet.has(id)),
  noOriginalSafeIncluded: originalSafeIds.every((id) => !remainingSet.has(id)),
  noPromotedSafeIncluded: promotedIds.every((id) => !remainingSet.has(id) && a2SafeSet.has(id)),
  allA2ReviewedRejectsExcluded: rerejectedIds.every((id) => !remainingSet.has(id) && a2RejectedSet.has(id)),
  noA2ReviewedToRejectInRankingPopulation: rerejectedIds.every((id) => !remainingSet.has(id)),
  a2Counts: source.a2Safe.candidate_ids.length === 36 && source.a2Rejected.candidate_ids.length === 19
};
for (const [name, result] of Object.entries(checksFromPopulation)) check(name, result);
check("source inventories and unique IDs", source.original.candidates.length === 4666 &&
  unique(source.original.candidates.map((row) => row.candidate_id)) &&
  originalSafeIds.length === 8 && unique(originalSafeIds));
check("population stores exact original SAFE IDs", population.candidate_ids.original_safe_excluded.length === originalSafeIds.length &&
  unique(population.candidate_ids.original_safe_excluded) &&
  originalSafeIds.every((id) => population.candidate_ids.original_safe_excluded.includes(id)));
check("A2 existing-audit population partition", source.a2Candidates.candidates.filter((row) => row.source_kind === "existing_closed_audit").length === 41 &&
  a2OriginalRejectIds.length === 33 && promotedIds.length === 17 && rerejectedIds.length === 16);
check("score formula is reproducible", ranking.ranked_families.every((row) => {
  const s = row.score_inputs;
  const w = row.weights;
  const computed = Math.round(20 * (w.evidence * s.evidence + w.productivity * s.productivity +
    w.boundability * s.boundability + w.practical_value * s.practical_value +
    w.false_positive_control * s.false_positive_control + w.rejection_reopenability * s.rejection_reopenability));
  return computed === row.priority_score;
}));
check("all family summaries expose required metrics", summary.family_summaries.every((row) =>
  typeof row.process_description === "string" && typeof row.mechanical_filter === "string" &&
  typeof row.candidate_records === "number" && typeof row.unique_entries === "number" &&
  row.deleted_phone_distribution && row.following_phone_distribution &&
  row.following_token_top_list && row.surface_type_distribution &&
  row.morphology_distribution && row.original_rejection_reason_distribution &&
  row.lexical_collision_risk_summary && row.evidence_grade &&
  row.runtime_boundability && row.false_positive_risk && row.practical_value &&
  row.recommended_action));
check("ranked families contain no following-to row", members.filter((row) =>
  ranking.ranked_families.some((ranked) => ranked.family_id === row.primary_family))
  .every((row) => String(row.following_token || "").toLowerCase() !== "to"));
check("unique partition sets", unique([...promotedIds, ...rerejectedIds, ...remainingIds]) &&
  promotedIds.length + rerejectedIds.length + remainingIds.length === originalRejectIds.length,
  { promoted: promotedIds.length, rerejected: rerejectedIds.length, remaining: remainingIds.length });
check("A2 existing-audit overlap", a2OriginalRejectIds.length === 33 &&
  rerejectedIds.length === 16 && promotedIds.length === 17,
  { originalRejectOverlap: a2OriginalRejectIds.length });
check("family feature IDs unique and complete", unique(memberIds) &&
  memberIds.length === 4625 && remainingIds.length === memberIds.length &&
  remainingIds.every((id) => memberById.has(id)));
check("family assignment complete", members.every((row) => typeof row.primary_family === "string" &&
  row.primary_family.length > 0 && familyIds.has(row.primary_family)) &&
  members.filter((row) => !row.primary_family).length === 0,
  { unclassified: members.filter((row) => !row.primary_family).length });
check("family membership accounting complete", summary.primary_family_membership_accounting.sum_of_family_records === 4625 &&
  summary.primary_family_membership_accounting.unique_candidate_ids === 4625 &&
  [...familyIds].every((id) => (familyCounts.get(id) || 0) ===
    summary.family_summaries.find((row) => row.family_id === id).records));
check("no A2 /t,d/ C+final before to in discovery population", members.filter((row) =>
  ["T", "D"].includes(row.deleted_consonant) &&
  row.coda_structure === "C+final" &&
  String(row.following_token || "").toLowerCase() === "to").length === 0);
check("feature source fields match original records", members.every((feature) => {
  const original = originalById.get(feature.candidate_id);
  return original &&
    feature.original_decision === original.decision &&
    feature.original_rejection_rationale === original.reason &&
    feature.entry_id === original.entry_id &&
    feature.surface_ref === original.surface_ref &&
    feature.target_surface === original.target_surface &&
    feature.target_word === original.target_word &&
    feature.collision_word === original.collision_word &&
    feature.target_pronunciation === original.target_pronunciation &&
    feature.collision_pronunciation === original.collision_pronunciation &&
    feature.deleted_consonant === String(original.phonetic_paths?.find((p) => p.deleted_consonant)?.deleted_consonant ||
      String(original.reduction || "").match(/\/([a-z]+)\//i)?.[1] || "OTHER").toUpperCase();
}));
check("ranking contains at most five existing families", ranking.ranked_families.length <= 5 &&
  ranking.ranked_families.every((row) => familyIds.has(row.family_id) && row.records > 0));
check("exactly one next-family recommendation", recommendation.family_id ===
  "AND_AH0_N_D_TO_AN_BEFORE_NON_TO_CONSONANT" &&
  recommendation.estimated_population.candidate_records === 24 &&
  recommendation.estimated_population.unique_entries === 16);
check("audit-only changed path boundary", allChangedPathsInAudit &&
  manifest.counts.production_files_changed === 0 &&
  manifest.controls.production_changes === 0 &&
  manifest.remote_publication.production_PR === false &&
  manifest.base_commit === "76085365bd3f5759bf3048df427574f350d01191",
  { changedPaths: manifest.changed_paths?.length || 0 });
const failed = checks.filter((row) => row.status !== "PASS");
const result = {
  schema_version: 1,
  audit: "④-C REJECT Family Prioritization Audit",
  status: failed.length ? "FAIL" : "PASS",
  validated_at_utc: new Date().toISOString(),
  validator: "validate-audit.mjs",
  counts: {
    original_reject: originalRejectIds.length,
    promoted_by_a2: promotedIds.length,
    already_reconsidered_reject: rerejectedIds.length,
    remaining_discovery: remainingIds.length,
    family_member_records: members.length,
    primary_families: summary.family_summaries.length,
    unclassified_family_records: members.filter((row) => !row.primary_family).length
  },
  production_files_changed: 0,
  checks
};
fs.writeFileSync(path.join(auditDir, "validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exitCode = 1;
