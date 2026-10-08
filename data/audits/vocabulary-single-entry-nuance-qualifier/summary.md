# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit


## Live-main drift reconciliation — 2026-10-08T10:23:39.523Z

- Current main: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130` (v5.95); audit base/merge-base remains `f0ff2e0a6503b234231e6cfa94c45c927fbb8345`.
- `vocab:00139` was selectively revalidated against its changed arrival example, Japanese meaning, and current paraphrases. Decision: `QUALIFIER_ONLY`; add a register/emphasis qualifier and retain both paraphrases.
- `vocab:00947` remains in the 2,478-record database and keeps its semantic audit decision; it is excluded from learning and normal remediation. `vocab:00428` (`toil away`) remains eligible.
- Accounting: one legacy supplemental decision was stale but was not counted in the previous reviewed total; reviewed now **194**, unreviewed **2,284**, remaining stale **0**, source population **2,478**, learning eligible **2,477**.
- The previous status ledger matched 193/2,285. Its confidence counter and paraphrase-removal total did not match the 25 batch records; both are recomputed here.

## Status: IN PROGRESS / NOT CLOSED

The initial population inventory and a bounded set of semantic judgments are published. **No claim of 2,478-entry independent semantic adjudication is made.** Pending records intentionally retain `single_entry_decision: null`. Machine-derived or unexamined KEEP is prohibited.

- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345` (PR #309 followed the initial main; Vocabulary and referenced authority blobs were unchanged).
- Previous Near-Synonym audit: `25058e095e759fe5de677f8d63267ab9669c4a06`; its 104 affected decisions and 178 group memberships have been imported without rewriting.
- Population and unique IDs: **2,478 / 2,478**; fixed order; 25 batches of ~100.
- Reviewed or isolated (including imported previous authority): **194**.
- **Unreviewed: 2,284**.
- Previous authority: **104**; newly adjudicated semantic candidate records: **47**.
- New candidate types: qualifier only **2**, qualifier + paraphrase **28**, paraphrase revalidation only **10**, upstream meaning/canonical **7**.
- Cross-audit conflict isolation: **5** (no previous decision was overwritten).
- Provisional remediation candidates: **145** (104 prior + 40 new + one existing-parenthesis paraphrase correction; all marked `ready_for_production:false`).
- Confidence among 194 reviewed or isolated records: HIGH **51**; MEDIUM **138**; LOW **5** (conflict isolation). Pending confidence not assigned.
- Combined provisional classification: QUALIFIER_ONLY **9**; QUALIFIER_AND_PARAPHRASE **125**; PARAPHRASE_REVALIDATION_ONLY **11**; UPSTREAM_AUTHORITY_REVIEW **7**; conflict **5**; KEEP **37**. These counts are **not the final whole-population classifications**.
- Provisional qualifier additions: **134** total (**104** inherited from previous audit, **30** newly proposed); qualifier removals/rewrite proposals: **0** at this WIP stage.
- Provisional paraphrase removals: **211** total (**162** inherited, **49** new). Provisional additions: **4** (all previous authority, **0** new).
- Existing Japanese prompts with parenthetical text: **38** source entries; this group received an individual review: **37 KEEP**, **1 PARAPHRASE_REVALIDATION_ONLY** (`vocab:01746` / `transfer`, remove broad `move`). See `existing-parentheses-review.json`.
- Proposed new paraphrase additions: **0**. Proposed removals are in `authored-judgments.json`, `previous-near-synonym-authority.json` and `remediation-candidates.json`.

## Representative new single-entry candidates

| ID | Canonical | Tentative disposition | Rationale |
| --- | --- | --- | --- |
| vocab:00756 | purchase | qualifier + remove buy | Formality matters |
| vocab:01418 | flunk | qualifier + remove fail an exam | Primarily US informal |
| vocab:01600 | melt | qualifier + remove dissolve | Phase change vs dissolution |
| vocab:01859 | beverage | qualifier + remove drink | More formal register |
| vocab:02262 | cop | qualifier + remove police officer | Informal register |
| vocab:00088 | get out of something | paraphrase-only; remove get off something | Vehicle-preposition usage split |
| vocab:00884 | forgive | paraphrase-only; remove allow, permit | Forgiveness vs permission |

External dictionary evidence is attached to selected high-confidence judgments. The remaining evidence coverage and nuanced removal proposals require independent scrutiny before release authority can be finalized.

## Strict closure requirements not yet satisfied

1. Independently adjudicate **2,284 PENDING** entries, including plain KEEP decisions after actual review.
2. Existing parenthetical qualifiers have been audited; independently finish the broader multi-sense review before final classification.
3. Revalidate all accepted paraphrases for every newly qualified prompt; confirm every proposed removal against use evidence and source sense.
4. Resolve the five previous-KEEP conflicts without silently editing earlier decisions; isolate all upstream authority conflicts.
5. Run strict validator and source-to-decision deterministic regeneration in a checkout; require no pending records or unresolved conflicts.
6. Publish a reviewed final audit commit and reverify the remote branch against the latest main. **Do not open a PR, merge to main, or touch production files.**

## Artifacts

- `manifest.json`: immutable source hashes and WIP accounting.
- `decisions.json`: 2,478-entry indexed authority; complete individual records reside in `batches/batch-001.json`–`batch-025.json`.
- `authored-judgments.json`: independently authored new recommendations and evidence.
- `previous-near-synonym-authority.json` and `previous-group-membership.json`: previous audit preservation.
- `remediation-candidates.json`: draft only, all materialization flags disabled.
- `existing-parentheses-review.json`: 38 individually reviewed pre-existing parenthetical prompts.
- `cross-audit-conflicts.json`, `upstream-review.json`: isolation lists.
- `scripts/vocabulary/validate-single-entry-nuance-qualifier-audit.mjs`: strict closure gate; `--allow-incomplete` checks WIP structural integrity only.
- `scripts/vocabulary/build-single-entry-nuance-qualifier-audit.mjs --check`: deterministic reconstruction comparison (must be executed and verified separately).
