# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Remote resume and source authority

- Repository: `miyatayuuma/english-pwa`; audit branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`.
- Remote audit HEAD at resume: `f6e72de478c5598fd5ce1be6a17dfa5bcf295ff0`.
- Current main verified at resume: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Main Vocabulary SHA256: `c0dfee10995c063c9c2df5c1edd2f5d0edb1efa4a1cef3ed1be7a265aefeb309`; semantic inventory SHA256: `f0e65131a05f29cb0053c5ebd37af20e6d92ea372010f03f554f3e028a77117b`.
- Live-main drift reconciliation found one semantic entry change (`vocab:00139`), six non-semantic commits, and no remaining stale IDs. The `vocab:00139` decision was revalidated against current main. `vocab:00947` (`toil`) remains in source accounting but is excluded from learning and remediation.

## Current checkpoint

- Source population: **2,478**; learning eligible: **2,477**; excluded from learning: **1** (`vocab:00947`).
- Reviewed or isolated: **244**; pending: **2,234**; stale: **0**; duplicates: **0**; order drift: **0**.
- This checkpoint reviewed the first **50 PENDING** entries in Vocabulary order, spanning source indices 2–58. The next pending entry is `vocab:00059` at source index 59.
- Current statuses: REVIEWED **128**, PREVIOUS_AUTHORITY_CONFIRMED **104**, CROSS_AUDIT_CONFLICT **5**, UPSTREAM_ISOLATED **7**, PENDING **2,234**.
- Current provisional classifications: KEEP **85**, QUALIFIER_ONLY **9**, QUALIFIER_AND_PARAPHRASE **127**, PARAPHRASE_REVALIDATION_ONLY **11**, UPSTREAM_AUTHORITY_REVIEW **7**, plus five isolated cross-audit conflicts.
- Previous Near-Synonym authority: all **104/104** affected entries have single-entry revalidation; all 104 remain confirmed, with zero conflicts against that authority.
- Confidence among reviewed or isolated entries: HIGH **100**, MEDIUM **139**, LOW **5**. Pending entries have no confidence assigned.
- Provisional remediation candidates: **147** (146 learning eligible, one excluded). All remain unauthorized for production materialization.
- Proposed qualifier additions: **136** total (104 inherited, 32 new); rewrites/removals: **0**. Proposed paraphrase removals: **214** total (162 inherited, 52 new); additions: **4** inherited, **0** new.

## Newly adjudicated cases in this checkpoint

- `vocab:00004` — `make someone do something`: QUALIFIER_AND_PARAPHRASE. Prompt: `someoneにsomethingをさせる（相手に直接働きかけ、強制する場合も）`. Re-evaluated both existing paraphrases against the qualified prompt; removed `get someone to do something` and `have someone do something` because their persuade / arrange senses do not preserve the make construction's direct causative nuance. MEDIUM confidence.
- `vocab:00012` — `be starved`: QUALIFIER_AND_PARAPHRASE. Prompt: `お腹がぺこぺこだ（主に米語のくだけた言い方）`. Re-evaluated its existing paraphrase and removed `be starving` because it does not share the same regional register. HIGH confidence.
- The other 48 entries received individual KEEP decisions with entry-specific reasons after source, representative sense, grammar role, and paraphrases were checked.

## Supplemental semantic-review drafts

The seven `semantic-review/batch-001.json`–`batch-007.json` files contain 639 draft rows. At resume, 638 mapped to PENDING canonical rows and one (`vocab:00139`) was superseded by live-main revalidation. This checkpoint promoted 50 source-checked rows into the canonical authored judgments, decisions, review index, and batch artifacts; 588 supplemental rows remain unpromoted. Draft presence alone does not count as review. The only decision difference among the 50 promoted rows is `vocab:00004`, now QUALIFIER_AND_PARAPHRASE with a causative-force qualifier rather than the draft's PARAPHRASE_REVALIDATION_ONLY. See `semantic-review/reconciliation.json`.

## Validation and production boundary

- WIP validator, drift-only validator, and deterministic regeneration are required before each remote checkpoint; strict closure remains intentionally incomplete while 2,234 entries are pending.
- `production_changed` is **false**. No production Vocabulary, meaning, paraphrase, runtime, ASR, or UI files are included in this checkpoint.
- No main merge or production remediation is authorized by this audit.

## Persistent resume artifacts

- `manifest.json`: population, authority hashes, progress, and provisional counts.
- `checkpoint.json`: completed IDs, unresolved IDs, next source-order position, stale IDs, and remote parent checkpoint.
- `review-index.json` and `decisions.json`: indexed status and decision ledger for all 2,478 source entries.
- `batches/batch-001.json`–`batch-025.json`: deterministic per-entry records.
- `authored-judgments.json`: individually reviewed new judgments and evidence.
- `remediation-candidates.json`: draft-only recommendations with production materialization disabled.
- `live-main-drift.json`, `previous-near-synonym-authority.json`, `previous-group-membership.json`, `existing-parentheses-review.json`, `cross-audit-conflicts.json`, and `upstream-review.json`: preserved authorities and isolation records.
- `semantic-review/reconciliation.json`: accounting for supplemental review drafts.

## Next work

Resume from `checkpoint.json`, confirm the current remote branch head and main, then continue from `vocab:00059` in source order. Continue in bounded batches, save every decision and evidence record, run WIP validation and deterministic comparison, and publish audit-only commits. Do not close the audit until all 2,478 entries pass the strict validator and final reconciliation.
