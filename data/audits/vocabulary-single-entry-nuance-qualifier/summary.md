# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Remote resume and source authority

- Repository: `miyatayuuma/english-pwa`; audit branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`.
- Remote audit HEAD before the first resumed checkpoint: `f6e72de478c5598fd5ce1be6a17dfa5bcf295ff0`.
- Current main verified at resume: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Main Vocabulary SHA256: `c0dfee10995c063c9c2df5c1edd2f5d0edb1efa4a1cef3ed1be7a265aefeb309`; semantic inventory SHA256: `f0e65131a05f29cb0053c5ebd37af20e6d92ea372010f03f554f3e028a77117b`.
- Live-main drift reconciliation found one semantic entry change (`vocab:00139`), six non-semantic commits, and no remaining stale IDs. The `vocab:00139` decision was revalidated against current main. `vocab:00947` (`toil`) remains in source accounting but is excluded from learning and remediation.

## Current checkpoint

- Source population: **2,478**; learning eligible: **2,477**; excluded from learning: **1** (`vocab:00947`).
- Reviewed or isolated: **294**; pending: **2,184**; stale: **0**; duplicates: **0**; order drift: **0**.
- Two bounded source-order checkpoints reviewed **100** PENDING entries: first indices **2–58**, then **59–114**. The next pending entry is `vocab:00115` at source index 115.
- Current statuses: REVIEWED **178**, PREVIOUS_AUTHORITY_CONFIRMED **104**, CROSS_AUDIT_CONFLICT **5**, UPSTREAM_ISOLATED **7**, PENDING **2,184**.
- Current provisional classifications: KEEP **133**, QUALIFIER_ONLY **10**, QUALIFIER_AND_PARAPHRASE **128**, PARAPHRASE_REVALIDATION_ONLY **11**, UPSTREAM_AUTHORITY_REVIEW **7**, plus five isolated cross-audit conflicts.
- Previous Near-Synonym authority: all **104/104** affected entries have single-entry revalidation; all 104 remain confirmed, with zero conflicts against that authority.
- Confidence among reviewed or isolated entries: HIGH **150**, MEDIUM **139**, LOW **5**. Pending entries have no confidence assigned.
- Provisional remediation candidates: **149** (148 learning eligible, one excluded). All remain unauthorized for production materialization.
- Proposed qualifier additions: **138** total (104 inherited, 34 new); rewrites/removals: **0**. Proposed paraphrase removals: **215** total (162 inherited, 53 new); additions: **4** inherited, **0** new.

## Newly adjudicated cases

- `vocab:00004` — `make someone do something`: QUALIFIER_AND_PARAPHRASE. Prompt: `someoneにsomethingをさせる（相手に直接働きかけ、強制する場合も）`. Re-evaluated both existing paraphrases against the qualified prompt; removed `get someone to do something` and `have someone do something` because their persuade / arrange senses do not preserve the make construction's direct causative nuance. MEDIUM confidence.
- `vocab:00012` — `be starved`: QUALIFIER_AND_PARAPHRASE. Prompt: `お腹がぺこぺこだ（主に米語のくだけた言い方）`. Re-evaluated its existing paraphrase and removed `be starving` because it does not share the same regional register. HIGH confidence.
- `vocab:00074` — `let alone`: QUALIFIER_ONLY. The prompt now notes that the phrase commonly follows negative or limiting content and adds a more difficult example. Cambridge documents this use; the existing `much less` paraphrase has the same contrastive pattern and remains accepted.
- `vocab:00109` — `get at something`: QUALIFIER_AND_PARAPHRASE. The prompt now captures its informal use for what someone means or is indirectly trying to express. The broader `try to say something` paraphrase was removed because it erases that pragmatic nuance.
- The other 96 entries received individual KEEP decisions with entry-specific reasons after the source, representative sense, grammar role, and existing paraphrases were checked. `vocab:00096` was individually checked against its previous group KEEP and confirmed: Oxford Learner’s Dictionary treats the figurative `rob somebody of something` sense as synonymous with `deprive`; the supplemental draft’s conflict flag was not supported.

## Supplemental semantic-review drafts

The seven `semantic-review/batch-001.json`–`batch-007.json` files contain 639 draft rows. At resume, 638 mapped to PENDING canonical rows and one (`vocab:00139`) was superseded by live-main revalidation. These two checkpoints promoted 100 source-checked rows into canonical authored judgments, decisions, review index, and batch artifacts; **538** supplemental rows remain unpromoted. Draft presence alone does not count as review. Differences resolved against drafts are recorded in `semantic-review/reconciliation.json`, including the qualifier decisions for `vocab:00004`, `vocab:00074`, and `vocab:00109`, plus the independently confirmed KEEP for `vocab:00096`.

## Validation and production boundary

- Both resumed checkpoints passed the WIP validator, drift-only validator, and deterministic 2,478-entry regeneration check. The second source-order range spans canonical batches 001 and 002; both regenerated batch files are included in its remote checkpoint.
- `production_changed` is **false**. No production Vocabulary, meaning, paraphrase, runtime, ASR, or UI files are included.
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

Resume from `checkpoint.json`, confirm the current remote branch head and main, then continue from `vocab:00115` in source order. Continue in bounded batches, save every decision and evidence record, run WIP validation and deterministic comparison, and publish audit-only commits. Do not close the audit until all 2,478 entries pass the strict validator and final reconciliation.
