# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Status: IN PROGRESS / NOT CLOSED

The initial population inventory and a bounded set of semantic judgments are published. **No claim of 2,478-entry independent semantic adjudication is made.** Pending records intentionally retain `single_entry_decision: null`. Machine-derived or unexamined KEEP is prohibited.

- Audit base main: `f0ff2e0a6503b234231e6cfa94c45c927fbb8345` (PR #309 followed the initial main; Vocabulary and referenced authority blobs were unchanged).
- Previous Near-Synonym audit: `25058e095e759fe5de677f8d63267ab9669c4a06`; its 104 affected decisions and 178 group memberships have been imported without rewriting.
- Population and unique IDs: **2,478 / 2,478**; fixed order; 25 batches of ~100.
- Reviewed or isolated (including imported previous authority): **155**.
- **Unreviewed: 2,323**.
- Previous authority: **104**; newly adjudicated semantic candidate records: **46**.
- New candidate types: qualifier only **1**, qualifier + paraphrase **28**, paraphrase revalidation only **10**, upstream meaning/canonical **7**.
- Cross-audit conflict isolation: **5** (no previous decision was overwritten).
- Provisional remediation candidates: **143** (104 prior + 39 new; all marked `ready_for_production:false`).
- Confidence among 155 records: HIGH **13**; MEDIUM **137**; LOW **5** (conflict isolation). Pending confidence not assigned.
- Combined provisional classification: QUALIFIER_ONLY **8**; QUALIFIER_AND_PARAPHRASE **125**; PARAPHRASE_REVALIDATION_ONLY **10**; UPSTREAM_AUTHORITY_REVIEW **7**; conflict **5**; KEEP **0**. These counts are **not the final whole-population classifications**.
- Provisional qualifier additions: **133** total (**104** inherited from previous audit, **29** newly proposed); qualifier removals/rewrite proposals: **0** at this WIP stage.
- Provisional paraphrase removals: **211** total (**162** inherited, **49** new). Provisional additions: **4** (all previous authority, **0** new).
- Existing Japanese prompts with parenthetical text: **38** source entries; this group has **not** yet received the required complete existing-qualifier audit.
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

1. Independently adjudicate **2,323 PENDING** entries, including plain KEEP decisions after actual review.
2. Audit every existing parenthetical qualifier and every legitimate multi-sense card before final classification.
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
- `cross-audit-conflicts.json`, `upstream-review.json`: isolation lists.
- `scripts/vocabulary/validate-single-entry-nuance-qualifier-audit.mjs`: strict closure gate; `--allow-incomplete` checks WIP structural integrity only.
- `scripts/vocabulary/build-single-entry-nuance-qualifier-audit.mjs --check`: deterministic reconstruction comparison (must be executed and verified separately).
