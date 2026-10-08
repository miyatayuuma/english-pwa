# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Authority and live-main reconciliation

- Repository: `miyatayuuma/english-pwa`; audit branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`.
- Remote resume checkpoint was re-fetched at `f6e72de478c5598fd5ce1be6a17dfa5bcf295ff0`. Verified audit checkpoints since resume: `5714173a6d714d79a3ad69150a690b53ece93e10`, `dc3e67bf33ce5968e3bce3ebc7bff76073a23ca5`, `bd896c6d502718a0a33427e6785294edc877ba76`, `697e4a4d41c1d374c244c7ce72ce53afda83b359`, `4e4d26c7dd343ded04331a83e9d4f110c21bd064`.
- Current main re-fetched before the current batch: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Current main Vocabulary SHA256: `c0dfee10995c063c9c2df5c1edd2f5d0edb1efa4a1cef3ed1be7a265aefeb309`; semantic inventory SHA256: `f0e65131a05f29cb0053c5ebd37af20e6d92ea372010f03f554f3e028a77117b`.
- Selective drift reconciliation remains valid: semantic entry drift 1 (`vocab:00139`), six non-semantic commits, 00139 revalidated, stale 0; no global Meaning/Canonical, Paraphrase authority, or Grammar Role drift. `vocab:00947` (`toil`) remains in source accounting and excluded from learning/remediation.
- Audit source snapshot remains pinned (blob `326021c771aa5b4746b120f5d1086ecce33a334f`, SHA256 `3b5a3b82d25dfcee5b8593e53835a36577998af3cb42570b1711203ae568ae34`); current-main snapshot is recorded separately in the drift artifact.

## Current checkpoint

- This checkpoint started from remote audit HEAD `d734e868e890566d0e29138f341145198224ad06`; the re-fetched main was `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Source population **2,478**; learning eligible **2,477**; excluded **1** (`vocab:00947`).
- Reviewed **494**; pending **1,984**; stale **0**; duplicate **0**; order drift **0**.
- This checkpoint adjudicated 50 pending entries in source indices **274–328** across `batches/batch-003.json` and `batches/batch-004.json`. Five entries in the span were already resolved (`vocab:00289`, `00292`, `00302`, `00314`, `00318`) and were left unchanged. Next pending: `vocab:00330` at source index 329.
- This batch: KEEP **46**, QUALIFIER_ONLY **1**, QUALIFIER_AND_PARAPHRASE **2**, PARAPHRASE_REVALIDATION_ONLY **1**, UPSTREAM_AUTHORITY_REVIEW **0**, CROSS_AUDIT_CONFLICT **0**. Every qualified prompt received individual paraphrase revalidation.

## Cumulative progress

- Review status: REVIEWED **374**, PREVIOUS_AUTHORITY_CONFIRMED **104**, CROSS_AUDIT_CONFLICT **5**, UPSTREAM_ISOLATED **11**, PENDING **1,984**.
- Decision classes: KEEP **313**, QUALIFIER_ONLY **17**, QUALIFIER_AND_PARAPHRASE **136**, PARAPHRASE_REVALIDATION_ONLY **12**, UPSTREAM_AUTHORITY_REVIEW **11**; five cross-audit conflicts remain isolated without an asserted decision.
- Confidence: HIGH **334**, MEDIUM **155**, LOW **5**; pending **1,984**.
- Previous Near-Synonym authority: **104/104** entries individually revalidated; 104 confirmed, zero conflicts.
- Provisional remediation candidates **165** (**164** learning eligible, **1** excluded), all `ready_for_production: false`.
- Qualifier additions **153** (104 inherited, 49 new); rewrites **0**; removals **0**.
- Paraphrase removals **225** (162 inherited, 63 new); additions **5** (4 inherited, 1 new).

## Fifth checkpoint findings (source indices 220–273)

- `vocab:00248` — `swear at someone`: added that it uses rude or offensive language; `curse at someone` remains aligned.
- `vocab:00252` — `be my guest`: qualified it as a friendly permission response; removed `please`, which does not state permission on its own, and retained `go ahead`.
- `vocab:00274` — `cheer up`: isolated because the sense key includes both becoming happier and making someone happier, while the current Japanese gloss covers only the intransitive use.
- Other 47 entries were individually checked against their canonical, current Japanese prompt, representative occurrence, grammar role, and each registered paraphrase. Existing near-synonym group KEEP decisions encountered in this range were independently confirmed.

## Sixth checkpoint findings (source indices 274–328)

- `vocab:00275` — `dwell on something`: specified the usual focus on something unpleasant; removed the overly broad `keep thinking about something` paraphrase.
- `vocab:00280` — `turn up`: recorded its informal, usually unexpected arrival sense; retained `show up` and removed the neutral, broader `appear`.
- `vocab:00306` — `be accompanied by something`: removed `involve something`, which does not encode co-occurrence.
- `vocab:00320` — `provide for someone`: retained `support someone`; Cambridge also defines supporting someone as providing money or physical necessities, matching the family-income example.
- `vocab:00321` — `make the best of it`: clarified coping as well as possible with an undesirable situation.
- The remaining 46 targets were individually checked against their representative occurrence and each registered paraphrase. Existing near-synonym group decisions in the range were confirmed; no cross-audit conflict was introduced.

## Earlier checkpoint range correction

- The third checkpoint reviewed 50 PENDING entries at source indices **115–167** (ending at `vocab:00168`). Its earlier summary incorrectly said 115–168; index 168 is `vocab:00169`, the first entry of checkpoint four. Checkpoint and reconciliation records now use the correct range.
- Checkpoint four reviewed the next 50 pending entries across source indices 168–219 and left previously resolved `vocab:00185` and `vocab:00213` unchanged.

## Resume state and scope

- Persistent resume state is `checkpoint.json`: **494** reviewed, **1,984** unresolved, next `vocab:00330`, stale 0, parent remote HEAD `d734e868e890566d0e29138f341145198224ad06`.
- WIP and drift validators plus deterministic regeneration must pass before each audit-only remote checkpoint. Strict closure is not due until all 2,478 source entries are reviewed.
- Production Vocabulary, meanings, paraphrases, runtime, ASR, UI, and spelling authority remain unchanged. No main merge is performed.
- Next batch starts at `vocab:00330`; keep source order and checkpoint after about 50 entries.
