# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Authority and live-main reconciliation

- Repository: `miyatayuuma/english-pwa`; audit branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`.
- Remote resume checkpoint was re-fetched and verified at `f6e72de478c5598fd5ce1be6a17dfa5bcf295ff0`; verified audit checkpoints since resume: `5714173a6d714d79a3ad69150a690b53ece93e10`, `dc3e67bf33ce5968e3bce3ebc7bff76073a23ca5`, `bd896c6d502718a0a33427e6785294edc877ba76`, `697e4a4d41c1d374c244c7ce72ce53afda83b359`.
- Current main re-fetched before this batch: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Current main Vocabulary SHA256: `c0dfee10995c063c9c2df5c1edd2f5d0edb1efa4a1cef3ed1be7a265aefeb309`; semantic inventory SHA256: `f0e65131a05f29cb0053c5ebd37af20e6d92ea372010f03f554f3e028a77117b`.
- Selective drift reconciliation remains valid: semantic entry drift 1 (`vocab:00139`), six non-semantic commits, 00139 revalidated, stale 0; no global Meaning/Canonical, Paraphrase authority, or Grammar Role drift. `vocab:00947` (`toil`) remains in source accounting and is excluded from learning/remediation.
- Audit source snapshot remains the pinned 2,478-entry snapshot (blob `326021c771aa5b4746b120f5d1086ecce33a334f`, SHA256 `3b5a3b82d25dfcee5b8593e53835a36577998af3cb42570b1711203ae568ae34`). Drift artifact records current main snapshot separately.

## Current checkpoint

- This checkpoint started from remote audit HEAD `697e4a4d41c1d374c244c7ce72ce53afda83b359`; main remained `794e6cf8c88ed6775be9b56a6f1fddc0775a7130` during review.
- Source population **2,478**; learning eligible **2,477**; excluded **1** (`vocab:00947`).
- Reviewed **394**; pending **2,084**; stale **0**; duplicate **0**; order drift **0**.
- This checkpoint adjudicated 50 pending entries in source indices **168–219**, spanning `batches/batch-002.json` and `batches/batch-003.json`. `vocab:00185` and `vocab:00213` were already resolved, so they were not reprocessed. Next pending: `vocab:00221` at source index 220.
- This batch: KEEP **41**, QUALIFIER_ONLY **2**, QUALIFIER_AND_PARAPHRASE **5**, PARAPHRASE_REVALIDATION_ONLY **0**, UPSTREAM_AUTHORITY_REVIEW **2**. All qualified prompts had each existing paraphrase re-evaluated.

## Cumulative progress and accounting

- Review status: REVIEWED **275**, PREVIOUS_AUTHORITY_CONFIRMED **104**, CROSS_AUDIT_CONFLICT **5**, UPSTREAM_ISOLATED **10**, PENDING **2,084**.
- Decision classes: KEEP **220**, QUALIFIER_ONLY **15**, QUALIFIER_AND_PARAPHRASE **133**, PARAPHRASE_REVALIDATION_ONLY **11**, UPSTREAM_AUTHORITY_REVIEW **10**; five cross-audit conflicts remain isolated without an asserted decision.
- Confidence: HIGH **239**, MEDIUM **150**, LOW **5**; pending **2,084**.
- Previous Near-Synonym authority: **104/104** affected entries individually revalidated; 104 confirmed, zero conflicts.
- Provisional remediation candidates **159** (**158** learning eligible, **1** excluded), all `ready_for_production: false`.
- Qualifier additions **148** (104 inherited, 44 new); rewrites **0**; removals **0**.
- Paraphrase removals **221** (162 inherited, 59 new); additions **5** (4 inherited, 1 new).

## Fourth checkpoint findings (source indices 168–219)

- `vocab:00178` — `get away with something`: qualifier records escaping blame or punishment after wrongdoing; Cambridge evidence supports this pragmatic/connotation note.
- `vocab:00181` — `as if nothing had happened`: isolated because E0151 actually says “as if he were somebody,” inconsistent with the card's canonical and Japanese meaning.
- `vocab:00184` — `at someone's disposal`: added the formal-register note; removed the broader, register-neutral `available to someone` alternative for the qualified prompt.
- `vocab:00192` — `make sense`: isolated because the Japanese gloss emphasizes logical coherence while the sense key and representative sentence may point to understandability.
- `vocab:00194` — `to the point`: added concise/without-extra-information nuance; removed `on point`, which Cambridge defines as informal “perfect/as good as it could be.”
- `vocab:00196` — `a piece of cake`: added informal-register note; `child's play` remains suitable.
- `vocab:00201` — `get mad at someone`: added informal, mainly-US usage note; removed neutral `get angry with someone`.
- `vocab:00218` — `go on a diet`: clarified onset versus ongoing state; removed `be on a diet` and `diet`, added `start dieting`.
- `vocab:00220` — `what's more`: qualified as adding an interesting/surprising or more-important point; removed generic `in addition`, retained `moreover`. No spoken-only label was asserted.

## Previous checkpoint range correction

- The third checkpoint reviewed 50 PENDING entries at source indices **115–167** (ending at `vocab:00168`). Its previous summary incorrectly said 115–168; index 168 is `vocab:00169`, the first entry in this fourth checkpoint. The checkpoint ledger and reconciliation note are corrected.

## Resume state and scope

- Persistent resume state: `checkpoint.json` (`completed_ids=394`, `unresolved_ids=2084`, next `vocab:00221`, stale 0, parent remote HEAD `697e4a4d41c1d374c244c7ce72ce53afda83b359`).
- WIP validator and deterministic regeneration must pass before each audit-only remote checkpoint. Final strict validation/regeneration and closure are not due until all 2,478 entries are reviewed.
- Production Vocabulary, meanings, paraphrases, runtime, ASR, UI, spelling authority, and main remain unchanged. No merge is authorized or performed.
- Next source-order checkpoint starts at the first PENDING entry, `vocab:00221`; keep batches at roughly 50 entries, save judgments and validate before publishing.
