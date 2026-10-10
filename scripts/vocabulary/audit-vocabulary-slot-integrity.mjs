#!/usr/bin/env node

/**
 * Mechanical discovery and deterministic artifact builder for the Vocabulary
 * placeholder/slot integrity audit. This script never edits production data
 * and never makes a semantic decision. Human decisions live in slot-review.json
 * and survive subsequent --write runs.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VOCAB_PATH = resolve(ROOT, "data/vocabulary-v3.json");
const AUDIT_DIR = resolve(ROOT, "data/audits/vocabulary-japanese-prompt-authority-reconciliation");
const AUDIT_INDEX_PATH = resolve(AUDIT_DIR, "review-index.json");
const AUDIT_MANIFEST_PATH = resolve(AUDIT_DIR, "manifest.json");
const BATCH_DIR = resolve(AUDIT_DIR, "batches");
const OUTPUTS = {
  inventory: resolve(AUDIT_DIR, "slot-inventory.json"),
  candidates: resolve(AUDIT_DIR, "slot-candidates.json"),
  review: resolve(AUDIT_DIR, "slot-review.json"),
  summary: resolve(AUDIT_DIR, "slot-summary.json"),
};

const DEFINITIONS = [
  { token: "someone", type: "PERSON", aliases: ["somebody"] },
  { token: "somebody", type: "PERSON", aliases: ["someone"] },
  { token: "something", type: "THING", aliases: [] },
  { token: "somewhere", type: "PLACE", aliases: ["someplace"] },
  { token: "someplace", type: "PLACE", aliases: ["somewhere"] },
  { token: "one", type: "ONE_OR_ONES", aliases: ["ones"] },
  { token: "ones", type: "ONE_OR_ONES", aliases: ["one"] },
];
const DEFINITION_BY_TOKEN = new Map(DEFINITIONS.map((row) => [row.token, row]));
const TOKEN_RE = /\b(?:someone|somebody|something|somewhere|someplace|ones?|one)\b/gi;
const LEXICAL_ONE_PATTERNS = [
  /\bfor one thing\b/i,
  /\bone after another\b/i,
  /\bone by one\b/i,
  /\bone at a time\b/i,
  /\bat one time\b/i,
  /\bone of these days\b/i,
  /\bone way or another\b/i,
  /\bone day\b/i,
  /\bsquare one\b/i,
  /\bnumber one\b/i,
  /\bone-of-a-kind\b/i,
  /\bone(?:['’])s (?:own|mind|way|heart)\b/i,
  /\bone likes\b/i,
];
const EXAMPLE_HINT_RE = /(?:権利|機会|火|炎|危険|有害|婚約|交際|交渉|予定|消費量|出費|悪事|過失|略語|規則|罰則|可能性|候補|困難|問題|制度|慣習|割合|数量|事実|意味|行為)/u;
const GENERIC_SLOT_REPLACEMENT_RE = /(?:人|相手|対象|事柄|物|もの|場所)/u;
const META_SLOT_REPLACEMENT_RE = /(?:対象範囲|意味範囲|適用範囲|対象を限定|意味を限定|範囲を限定)/u;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseArgs(argv) {
  let mode = null;
  for (const arg of argv) {
    if (arg === "--write" || arg === "--check") {
      assert(mode === null, "Choose exactly one of --write or --check.");
      mode = arg.slice(2);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return mode ?? "check";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON ${path}: ${error.message}`);
  }
}

function stringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function flattenStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) flattenStrings(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["answer", "text", "canonical", "phrase", "value"].includes(key)) flattenStrings(item, out);
    }
  }
  return out;
}

function tokenMatches(text) {
  return [...String(text ?? "").matchAll(TOKEN_RE)].map((match) => ({
    token: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function isWholeLexeme(canonical, token) {
  return canonical.trim().toLowerCase() === token;
}

function isLexicalToken(canonical, token, occurrenceIndex, matches) {
  const normalized = canonical.trim().toLowerCase();
  if (isWholeLexeme(canonical, token)) return true;
  if (token === "one" || token === "ones") {
    return LEXICAL_ONE_PATTERNS.some((pattern) => pattern.test(normalized));
  }
  if (token === "something" && /\btwenty-something\b/i.test(normalized)) return true;
  if (token === "something" && /\bsomething has something to do with something else\b/i.test(normalized)) {
    // In this fixed construction the middle "something" is lexical; the
    // subject and the object of "with" are the two open arguments.
    return occurrenceIndex === 1 && matches.length === 3;
  }
  return false;
}

function isAmbiguousToken(canonical, token) {
  if ((token === "one" || token === "ones") && !LEXICAL_ONE_PATTERNS.some((pattern) => pattern.test(canonical))) return true;
  if (token === "something" && /\bsomething of a\b/i.test(canonical)) return true;
  if (token === "something" && /\btwenty-something\b/i.test(canonical)) return false;
  return false;
}

function semanticType(token, text, match) {
  if (token === "someone" || token === "somebody") return "PERSON";
  if (token === "somewhere" || token === "someplace") return "PLACE";
  if (token === "something") {
    const canonical = text.trim().toLowerCase();
    if (canonical === "accuse someone of something") return "THING_OR_EVENT";
    if (canonical === "deprive someone of something") return "THING_OR_ABSTRACT";
    const before = text.slice(Math.max(0, match.start - 24), match.start);
    const after = text.slice(match.end, Math.min(text.length, match.end + 14));
    if (/\b(?:do|doing|did|done)\s*$/i.test(before) || /^\s*(?:する|した|して|しよう|すること)/u.test(after)) return "ACTION_OR_EVENT";
    return "THING";
  }
  return "ONE_OR_ONES";
}

function occurrenceRows(text, context, { prompt = false, expectedActionSlots = 0 } = {}) {
  const matches = tokenMatches(text);
  const rows = [];
  const ambiguous = [];
  const lexical = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const definition = DEFINITION_BY_TOKEN.get(match.token);
    if (!definition) continue;
    if (!prompt && isLexicalToken(context, match.token, index, matches)) {
      lexical.push({ token: match.token, classification: "LEXICAL_TOKEN", context: context.trim(), occurrence_index: index, start: match.start, end: match.end });
      continue;
    }
    if (!prompt && isAmbiguousToken(context, match.token)) {
      ambiguous.push({ token: match.token, classification: "AMBIGUOUS", context: context.trim(), occurrence_index: index, start: match.start, end: match.end });
      continue;
    }
    const type = semanticType(match.token, text, match);
    rows.push({ token: match.token, classification: "VARIABLE_SLOT", type, semantic_role: type, context: context.trim(), start: match.start, end: match.end });
  }
  if (prompt && expectedActionSlots > 0) {
    let added = 0;
    for (const match of text.matchAll(/[〜～]/gu)) {
      if (added >= expectedActionSlots) break;
      rows.push({ token: match[0], classification: "VARIABLE_SLOT", type: "ACTION_OR_EVENT", semantic_role: "ACTION_OR_EVENT", context: context.trim(), notation: "JAPANESE_WAVE_DASH", start: match.index, end: match.index + match[0].length });
      added += 1;
    }
  }
  return { rows, lexical, ambiguous };
}

function groupProfile(rows) {
  const profile = {};
  for (const row of rows) profile[row.semantic_role] = (profile[row.semantic_role] ?? 0) + 1;
  return Object.fromEntries(Object.entries(profile).sort(([a], [b]) => a.localeCompare(b)));
}

function reconcilePromptRoles(promptRows, canonicalRows) {
  const aliases = new Map();
  for (const definition of DEFINITIONS) {
    aliases.set(definition.token, definition.type);
    for (const alias of definition.aliases) aliases.set(alias, definition.type);
  }
  const rolesByToken = new Map();
  const rolesByType = new Map();
  const actionRoles = [];
  for (const row of canonicalRows) {
    const type = aliases.get(row.token) ?? row.type;
    const tokenRoles = rolesByToken.get(row.token) ?? [];
    tokenRoles.push(row.semantic_role);
    rolesByToken.set(row.token, tokenRoles);
    const typeRoles = rolesByType.get(type) ?? [];
    typeRoles.push(row.semantic_role);
    rolesByType.set(type, typeRoles);
    if (row.semantic_role === "ACTION_OR_EVENT") actionRoles.push(row.semantic_role);
  }
  const usedByType = new Map();
  return promptRows.map((row) => {
    const type = row.notation === "JAPANESE_WAVE_DASH" ? "ACTION_OR_EVENT" : aliases.get(row.token) ?? row.type;
    const used = usedByType.get(type) ?? 0;
    usedByType.set(type, used + 1);
    const exactRoles = row.notation === "JAPANESE_WAVE_DASH" ? actionRoles : rolesByToken.get(row.token);
    const roles = exactRoles?.length ? exactRoles : rolesByType.get(type) ?? [];
    if (roles[used]) return { ...row, type: roles[used], semantic_role: roles[used] };
    return { ...row, type, semantic_role: type };
  });
}

function countTokens(rows) {
  const counts = {};
  for (const row of rows) counts[row.token] = (counts[row.token] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function parentheticalSegments(text) {
  return [...String(text ?? "").matchAll(/[（(]([^）)]*)[）)]/gu)].map((match) => ({
    text: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function hasNearSlotQualifier(prompt, promptRows) {
  const parens = parentheticalSegments(prompt);
  if (parens.length === 0) return false;
  return promptRows.some((row) => {
    return parens.some((segment) => {
      const distance = row.end <= segment.start
        ? segment.start - row.end
        : segment.end <= row.start
          ? row.start - segment.end
          : 0;
      return distance <= 1 && EXAMPLE_HINT_RE.test(segment.text);
    });
  });
}

function humanCategoryHints(prompt) {
  const segments = parentheticalSegments(prompt);
  if (EXAMPLE_HINT_RE.test(prompt) || GENERIC_SLOT_REPLACEMENT_RE.test(prompt)) return "EXAMPLE_OR_CATEGORY";
  if (segments.some((part) => META_SLOT_REPLACEMENT_RE.test(part.text))) return "META_SCOPE";
  return segments.length > 0 ? "PARENTHETICAL_UNCLASSIFIED" : null;
}

function difference(expected, actual) {
  const missing = {};
  const extra = {};
  for (const [key, count] of Object.entries(expected)) if (count > (actual[key] ?? 0)) missing[key] = count - (actual[key] ?? 0);
  for (const [key, count] of Object.entries(actual)) if (count > (expected[key] ?? 0)) extra[key] = count - (expected[key] ?? 0);
  return { missing, extra };
}

function makeCandidate(entry, inventoryRow, auditReview) {
  const classes = [];
  const expected = inventoryRow.canonical_slot_profile;
  const actual = inventoryRow.Japanese_prompt_slot_profile;
  const delta = difference(expected, actual);
  const expectedTotal = Object.values(expected).reduce((sum, value) => sum + value, 0);
  const actualTotal = Object.values(actual).reduce((sum, value) => sum + value, 0);
  const canonicalSequence = inventoryRow.canonical_slot_tokens.map((row) => row.semantic_role);
  const promptSequence = inventoryRow.Japanese_prompt_slot_tokens.map((row) => row.semantic_role);

  if (inventoryRow.ambiguous_tokens.length > 0) classes.push("AMBIGUOUS_SLOT_AUTHORITY");
  if (Object.keys(delta.extra).length > 0) classes.push("SLOT_COUNT_MISMATCH");
  if (Object.keys(delta.missing).length > 0) {
    classes.push("SLOT_MISSING");
    if (expectedTotal > actualTotal) classes.push("SLOT_COUNT_MISMATCH");
    if (Object.values(delta.missing).some((count) => count > 0) && Object.values(delta.extra).some((count) => count > 0)) classes.push("SLOT_TYPE_MISMATCH");
    const category = humanCategoryHints(entry.meaning_ja);
    if (category === "EXAMPLE_OR_CATEGORY") classes.push("SLOT_REPLACED_BY_EXAMPLE");
    else if (category === "META_SCOPE") classes.push("SLOT_REPLACED_BY_META_SCOPE");
  }
  if (expectedTotal === actualTotal && expectedTotal > 1 && canonicalSequence.join("|") !== promptSequence.join("|")) {
    classes.push("SLOT_ROLE_MISMATCH");
  }
  if (hasNearSlotQualifier(entry.meaning_ja, inventoryRow.Japanese_prompt_slot_tokens)) classes.push("SLOT_OVERCONSTRAINED");
  if (classes.length === 0) return null;

  return {
    id: entry.id,
    canonical: entry.canonical,
    sense_key: entry.sense_key ?? null,
    kind: entry.kind ?? null,
    grammarRole: entry.grammarRole ?? null,
    current_meaning_ja: entry.meaning_ja,
    current_paraphrases: entry.paraphrases ?? [],
    canonical_slot_profile: inventoryRow.canonical_slot_profile,
    prompt_slot_profile: inventoryRow.Japanese_prompt_slot_profile,
    canonical_slot_tokens: inventoryRow.canonical_slot_tokens,
    Japanese_prompt_slot_tokens: inventoryRow.Japanese_prompt_slot_tokens,
    violation_classes: [...new Set(classes)],
    mechanical_evidence: {
      expected_minus_prompt: delta.missing,
      prompt_minus_expected: delta.extra,
      parenthetical_hints: parentheticalSegments(entry.meaning_ja).map((part) => part.text),
    },
    current_audit_union_member: Boolean(auditReview),
    current_audit_review_status: auditReview?.review_status ?? null,
  };
}

function preserveReview(candidateRows, priorRows) {
  const previous = new Map((priorRows ?? []).map((row) => [row.id, row]));
  return candidateRows.map((candidate) => {
    const old = previous.get(candidate.id);
    if (old) return { ...candidate, ...old, ...candidate };
    return {
      ...candidate,
      decision: "PENDING",
      recommended_prompt: null,
      recommended_paraphrases: null,
      reason: null,
      confidence: null,
      evidence: [],
      review_status: "PENDING",
    };
  });
}

function build() {
  const mode = parseArgs(process.argv.slice(2));
  const vocabulary = readJson(VOCAB_PATH);
  const vocabularyText = readFileSync(VOCAB_PATH, "utf8");
  const vocabularyBlobSha = createHash("sha1").update(`blob ${Buffer.byteLength(vocabularyText)}\0`).update(vocabularyText).digest("hex");
  assert(Array.isArray(vocabulary.entries), "data/vocabulary-v3.json must contain an entries array.");
  const manifest = readJson(AUDIT_MANIFEST_PATH);
  const auditIndex = readJson(AUDIT_INDEX_PATH);
  assert(Array.isArray(auditIndex.entries), "Japanese Prompt Authority review-index.json must contain an entries array.");

  const auditById = new Map();
  for (const row of auditIndex.entries) {
    assert(!auditById.has(row.id), `Duplicate audit index ID ${row.id}.`);
    auditById.set(row.id, row);
  }
  const tokenSourceCounts = Object.fromEntries(DEFINITIONS.map(({ token }) => [token, { canonical: 0, answers: 0, paraphrases: 0 }]));
  const inventory = [];
  const candidates = [];
  const ids = new Set();

  for (const entry of vocabulary.entries) {
    assert(typeof entry.id === "string" && entry.id.length > 0, "Production entry without ID.");
    assert(!ids.has(entry.id), `Duplicate production ID ${entry.id}.`);
    ids.add(entry.id);
    const canonical = occurrenceRows(entry.canonical, entry.canonical);
    const actionSlotsExpected = canonical.rows.filter((row) => row.semantic_role === "ACTION_OR_EVENT").length;
    const rawPrompt = occurrenceRows(entry.meaning_ja, entry.meaning_ja, { prompt: true, expectedActionSlots: actionSlotsExpected });
    const prompt = { ...rawPrompt, rows: reconcilePromptRoles(rawPrompt.rows, canonical.rows) };
    const answers = flattenStrings(entry.answers);
    const paraphrases = flattenStrings(entry.paraphrases);
    const answerAnalyses = answers.map((text) => occurrenceRows(text, text));
    const paraphraseAnalyses = paraphrases.map((text) => occurrenceRows(text, text));
    const answerRows = answerAnalyses.flatMap((analysis) => analysis.rows);
    const paraphraseRows = paraphraseAnalyses.flatMap((analysis) => analysis.rows);
    const allLexicalRows = [
      ...canonical.lexical.map((row) => ({ ...row, source: "canonical" })),
      ...answerAnalyses.flatMap((analysis) => analysis.lexical.map((row) => ({ ...row, source: "answers" }))),
      ...paraphraseAnalyses.flatMap((analysis) => analysis.lexical.map((row) => ({ ...row, source: "paraphrases" }))),
    ];
    const allAmbiguousRows = [
      ...canonical.ambiguous.map((row) => ({ ...row, source: "canonical" })),
      ...answerAnalyses.flatMap((analysis) => analysis.ambiguous.map((row) => ({ ...row, source: "answers" }))),
      ...paraphraseAnalyses.flatMap((analysis) => analysis.ambiguous.map((row) => ({ ...row, source: "paraphrases" }))),
    ];
    for (const [field, values] of [["answers", answers], ["paraphrases", paraphrases]]) {
      for (const value of values) {
        for (const match of tokenMatches(value)) {
          const source = tokenSourceCounts[match.token];
          if (source) source[field] += 1;
        }
      }
    }
    for (const match of tokenMatches(entry.canonical)) {
      const source = tokenSourceCounts[match.token];
      if (source) source.canonical += 1;
    }
    const slotRow = {
      id: entry.id,
      kind: entry.kind ?? null,
      grammarRole: entry.grammarRole ?? null,
      sense_key: entry.sense_key ?? null,
      canonical: entry.canonical,
      canonical_slot_tokens: canonical.rows,
      canonical_slot_profile: groupProfile(canonical.rows),
      answer_slot_tokens: answerRows,
      answer_slot_profile: groupProfile(answerRows),
      paraphrase_slot_tokens: paraphraseRows,
      paraphrase_slot_profile: groupProfile(paraphraseRows),
      Japanese_prompt_slot_tokens: prompt.rows,
      Japanese_prompt_slot_profile: groupProfile(prompt.rows),
      lexical_placeholder_tokens: allLexicalRows,
      ambiguous_tokens: allAmbiguousRows,
      mechanical_status: "CLEAR",
    };
    const candidate = makeCandidate(entry, slotRow, auditById.get(entry.id));
    if (candidate) {
      slotRow.mechanical_status = "CANDIDATE";
      candidates.push(candidate);
    }
    inventory.push(slotRow);
  }

  const priorReview = existsSync(OUTPUTS.review) ? readJson(OUTPUTS.review) : [];
  const reviewRows = preserveReview(candidates, priorReview);
  const inventoryById = new Map(inventory.map((row) => [row.id, row]));
  const candidateById = new Map(candidates.map((row) => [row.id, row]));
  const reviewById = new Map(reviewRows.map((row) => [row.id, row]));
  const vocabularyById = new Map(vocabulary.entries.map((row) => [row.id, row]));
  const makeReconciliation = (id) => {
    const inv = inventoryById.get(id);
    const source = vocabularyById.get(id);
    const reviewed = reviewById.get(id);
    assert(inv && source, `Cannot link slot result for unknown production ID ${id}.`);
    assert(!candidateById.has(id) || reviewed, `Slot candidate ${id} has no review authority.`);
    const status = reviewed?.review_status === "UPSTREAM" ? "UPSTREAM" : reviewed ? "REVIEWED" : "CLEAR";
    return {
      review_status: status,
      decision: reviewed?.decision ?? "KEEP_SLOT_PROFILE",
      violation_classes: reviewed?.violation_classes ?? [],
      canonical_slot_profile: inv.canonical_slot_profile,
      prompt_slot_profile: inv.Japanese_prompt_slot_profile,
      canonical_slot_tokens: inv.canonical_slot_tokens,
      Japanese_prompt_slot_tokens: inv.Japanese_prompt_slot_tokens,
      recommended_prompt: reviewed?.recommended_prompt ?? source.meaning_ja,
      recommended_paraphrases: reviewed?.recommended_paraphrases ?? (source.paraphrases ?? []),
      reason: reviewed?.reason ?? (Object.keys(inv.canonical_slot_profile).length === 0
        ? "No canonical variable slot notation was found."
        : "Canonical and Japanese prompt slot profiles align."),
      confidence: reviewed?.confidence ?? "HIGH",
      slot_review_id: reviewed?.id ?? null,
    };
  };
  const unionRows = structuredClone(auditIndex.entries);
  for (const row of unionRows) {
    const slotResult = makeReconciliation(row.id);
    row.slot_integrity_checked = true;
    row.slot_reconciliation_status = slotResult.review_status;
    row.slot_reconciliation = slotResult;
  }
  const batchCount = manifest.populations?.batch_count;
  assert(Number.isInteger(batchCount) && batchCount > 0, "manifest.populations.batch_count must be a positive integer.");
  const batchDocuments = [];
  for (let number = 1; number <= batchCount; number += 1) {
    const batchId = `batch-${String(number).padStart(3, "0")}`;
    const path = resolve(BATCH_DIR, `${batchId}.json`);
    const document = readJson(path);
    assert(document.batch_id === batchId && Array.isArray(document.entries), `${batchId}.json has an invalid shape.`);
    for (const row of document.entries) {
      const indexRow = unionRows.find((item) => item.id === row.id);
      assert(indexRow, `${batchId} contains non-union ID ${row.id}.`);
      row.slot_integrity_checked = true;
      row.slot_reconciliation = indexRow.slot_reconciliation;
    }
    batchDocuments.push({ path, document });
  }
  const checkedUnion = unionRows.filter((row) => row.slot_integrity_checked === true).length;
  const reviewCounts = {
    reviewed: reviewRows.filter((row) => row.review_status === "REVIEWED").length,
    upstream: reviewRows.filter((row) => row.review_status === "UPSTREAM").length,
    pending: reviewRows.filter((row) => row.review_status === "PENDING").length,
  };
  const confirmedViolationCounts = Object.fromEntries([
    "SLOT_MISSING",
    "SLOT_REPLACED_BY_EXAMPLE",
    "SLOT_REPLACED_BY_META_SCOPE",
    "SLOT_TYPE_MISMATCH",
    "SLOT_COUNT_MISMATCH",
    "SLOT_ROLE_MISMATCH",
    "SLOT_OVERCONSTRAINED",
    "AMBIGUOUS_SLOT_AUTHORITY",
  ].map((violation) => [violation, reviewRows.filter((row) => {
    if (row.review_status === "UPSTREAM") return violation === "AMBIGUOUS_SLOT_AUTHORITY";
    if (row.review_status !== "REVIEWED") return false;
    if (row.decision === "KEEP_SLOT_PROFILE") return false;
    return row.violation_classes.includes(violation);
  }).length]));
  const reviewedUnion = unionRows.filter((row) => row.review_status === "REVIEWED");
  const reviewedUnionSlotBearing = reviewedUnion.filter((row) => inventory.find((item) => item.id === row.id)?.canonical_slot_tokens.length > 0);
  const reviewedUnionCandidateReconciliations = reviewedUnion.filter((row) => reviewRows.some((item) => item.id === row.id));
  const variableSlotEntries = inventory.filter((row) => row.canonical_slot_tokens.length > 0).length;
  const lexicalTokenEntries = inventory.filter((row) => row.lexical_placeholder_tokens.length > 0).length;
  const ambiguousEntries = inventory.filter((row) => row.ambiguous_tokens.length > 0).length;
  const summary = {
    schema_version: 1,
    audit: "vocabulary-japanese-prompt-authority-reconciliation",
    production_source: {
      path: "data/vocabulary-v3.json",
      git_blob_sha: vocabularyBlobSha,
      population: vocabulary.entries.length,
    },
    slot_notation_inventory: {
      candidate_tokens: DEFINITIONS,
      token_occurrences_by_source: tokenSourceCounts,
      entries_with_candidate_tokens: inventory.filter((row) => Object.keys(row.canonical_slot_profile).length > 0 || Object.keys(row.answer_slot_profile).length > 0 || Object.keys(row.paraphrase_slot_profile).length > 0 || row.lexical_placeholder_tokens.length > 0 || row.ambiguous_tokens.length > 0).length,
      variable_slot_entries: variableSlotEntries,
      lexical_placeholder_entries: lexicalTokenEntries,
      ambiguous_entries: ambiguousEntries,
      ambiguous_resolved: reviewRows.filter((row) => row.violation_classes.includes("AMBIGUOUS_SLOT_AUTHORITY") && ["REVIEWED", "UPSTREAM"].includes(row.review_status)).length,
    },
    candidates: {
      total: candidates.length,
      reviewed: reviewCounts.reviewed,
      upstream: reviewCounts.upstream,
      pending: reviewCounts.pending,
      by_violation_class: Object.fromEntries([...new Set(candidates.flatMap((row) => row.violation_classes))].sort().map((name) => [name, candidates.filter((row) => row.violation_classes.includes(name)).length])),
      confirmed_by_violation_class: confirmedViolationCounts,
      confirmed_defect_entries: reviewRows.filter((row) => row.review_status === "REVIEWED" && row.decision !== "KEEP_SLOT_PROFILE").length,
      unresolved_defect_entries: reviewRows.filter((row) => row.review_status === "PENDING").length,
    },
    union_coverage: {
      population: unionRows.length,
      slot_checked: checkedUnion,
      slot_pending: unionRows.length - checkedUnion,
      reviewed_40_slot_bearing_checked: reviewedUnionSlotBearing.length,
      reviewed_40_reconciliation_count: reviewedUnionCandidateReconciliations.length,
    },
    production_changes: 0,
    audit_status: "IN_PROGRESS",
  };

  return {
    mode,
    outputs: new Map([
      [OUTPUTS.inventory, stringify(inventory)],
      [OUTPUTS.candidates, stringify(candidates)],
      [OUTPUTS.review, stringify(reviewRows)],
      [OUTPUTS.summary, stringify(summary)],
      [AUDIT_INDEX_PATH, stringify({ ...auditIndex, entries: unionRows })],
      ...batchDocuments.map(({ path, document }) => [path, stringify(document)]),
    ]),
    summary,
  };
}

export { occurrenceRows };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = build();
    if (result.mode === "write") {
      for (const [path, content] of result.outputs) writeFileSync(path, content);
      console.log(`WROTE ${result.outputs.size} slot integrity artifacts.`);
    } else {
      const mismatches = [];
      for (const [path, expected] of result.outputs) {
        let actual = "";
        try { actual = readFileSync(path, "utf8"); } catch { /* report below */ }
        if (actual !== expected) mismatches.push(path.replace(`${ROOT}/`, ""));
      }
      if (mismatches.length > 0) fail(`Slot artifacts differ from deterministic output: ${mismatches.join(", ")}. Run with --write.`);
      console.log("PASS: slot integrity artifacts match deterministic output.");
    }
    console.log(JSON.stringify(result.summary, null, 2));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
