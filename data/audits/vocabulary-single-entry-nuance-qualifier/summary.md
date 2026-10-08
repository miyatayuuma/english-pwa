# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Remote resume and source authority

- Repository: `miyatayuuma/english-pwa`; audit branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`. The branch resumed at `f6e72de478c5598fd5ce1be6a17dfa5bcf295ff0`; the starting audit HEAD for this checkpoint was `bd896c6d502718a0a33427e6785294edc877ba76`.
- Current main re-fetched: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`. Main Vocabulary SHA256: `c0dfee10995c063c9c2df5c1edd2f5d0edb1efa4a1cef3ed1be7a265aefeb309`; semantic inventory SHA256: `f0e65131a05f29cb0053c5ebd37af20e6d92ea372010f03f554f3e028a77117b`.
- Live-main drift reconciliation identified one semantic entry change (`vocab:00139`), six non-semantic commits, and no remaining stale entries. `vocab:00139` was revalidated against current main. `vocab:00947` (`toil`) remains in source accounting and is excluded from learning/remediation.

## Current checkpoint

- Source population **2,478**; learning eligible **2,477**; excluded **1** (`vocab:00947`).
- Reviewed or isolated **344**; pending **2134**; stale **0**; duplicate **0**; order drift **0**.
- Three source-order checkpoints promoted **150** PENDING entries: indices **2–58**, **59–114**, and **115–168**. Next pending: `vocab:00169` at source index 168.
- Status counts: REVIEWED **227**, PREVIOUS_AUTHORITY_CONFIRMED **104**, CROSS_AUDIT_CONFLICT **5**, UPSTREAM_ISOLATED **8**, PENDING **2134**.
- Decision counts: KEEP **179**, QUALIFIER_ONLY **13**, QUALIFIER_AND_PARAPHRASE **128**, PARAPHRASE_REVALIDATION_ONLY **11**, UPSTREAM_AUTHORITY_REVIEW **8**; five cross-audit conflicts remain isolated.
- Previous Near-Synonym authority: **104/104** affected entries individually revalidated; 104 confirmed, zero conflicts against that authority.
- Confidence: HIGH **198**, MEDIUM **141**, LOW **5**; pending **2134**.
- Provisional remediation candidates **152** (**151** learning eligible, **1** excluded), all marked not ready for production.
- Qualifier additions **141** (104 inherited, 37 new); rewrites/removals **0**. Paraphrase removals **215** (162 inherited, 53 new); additions **4** (4 inherited, 0 new).

## Third checkpoint findings (source indices 115–168)

- **46 KEEP**, **3 QUALIFIER_ONLY**, **1 UPSTREAM_AUTHORITY_REVIEW**. Existing paraphrases for all three qualified entries were individually evaluated and retained.
- `vocab:00130` — `be to blame for something`: QUALIFIER_ONLY. Added the bad-result blame nuance; both existing responsibility paraphrases remain usable with a bad-result object. Its previous group KEEP is preserved and does not conflict.
- `vocab:00135` — `on second thought`: QUALIFIER_ONLY. Added that the phrase is used when reconsideration changes a prior decision. Cambridge evidence is recorded in the judgment.
- `vocab:00150` — `tell someone off`: QUALIFIER_ONLY. Added the informal-register note; the existing `chew someone out` paraphrase also matches the qualified prompt. Oxford and Cambridge evidence are recorded.
- `vocab:00162` — `so much for something`: UPSTREAM_AUTHORITY_REVIEW. The current source sense and example close a topic, while Cambridge documents a separate disappointment use. Because that is a multi-sense authority question, no prompt or paraphrase remediation is recommended yet.
- Supplemental drafts for `vocab:00130`, `00135`, and `00150` differed from the individually checked result; resolutions are recorded in `semantic-review/reconciliation.json`.

## Validation and production boundary

- PASS: WIP validator (344 reviewed / 2,134 pending), live-main drift-only validator (main `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`, stale 0), and deterministic regeneration comparison (2,478 entries in 25 batches).
- `production_changed` remains **false**. No Vocabulary, meaning, paraphrase, runtime, ASR, or UI production file is included. No main merge or production remediation is authorized by this audit.

## Persistent resume artifacts

- `manifest.json`: authority hashes, progress, and decision/provisional counts.
- `checkpoint.json`: completed and unresolved IDs, next source-order position, stale IDs, and remote parent checkpoint.
- `review-index.json` and `decisions.json`: status and decision ledger for all 2,478 source entries.
- `batches/batch-001.json`–`batch-025.json`: deterministic per-entry records.
- `authored-judgments.json`: individually reviewed new judgments and evidence.
- `remediation-candidates.json`: draft-only recommendations, with production materialization disabled.
- `live-main-drift.json`, `previous-near-synonym-authority.json`, `previous-group-membership.json`, `existing-parentheses-review.json`, `cross-audit-conflicts.json`, and `upstream-review.json`: preserved authorities and isolation records.
- `semantic-review/reconciliation.json`: accounts for supplemental review drafts and resolved differences.

## Next work

Resume from `checkpoint.json`, re-fetch current main and the audit branch head, then continue with `vocab:00169` in source order. Continue in bounded batches, save every decision and evidence record, validate and regenerate deterministically, and publish audit-only commits. Do not close the audit until all 2,478 entries pass strict validation and final reconciliation.
