# ASR-09A Grammatical Speech Equivalence Audit

**Status: CLOSED — ASR-09B implementation authority prepared**

## Fixed baseline

- Main SHA: `e1b56da18e0df1d583473a6f208a75333bd22969`
- APP_VERSION: `v5.101`
- Vocabulary: 2478 entries; blob `91324d35b2db1911ece2cf3ff746409d321fe963`
- Source items: 560; blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`
- Vocabulary occurrences: 2481/2481 joined
- PR #325 Japanese Prompt materialization: CLOSED; POST=545, DRIFT=0. Baseline PRE checks passed: npm run vocab:check-derived and npm run vocab:validate.

## Corpus accounting

Scanned 5272 canonical/answer/paraphrase strings, all 560 Read/Cloze source sentences, and source occurrence links. Emitted **529** unique candidate spans.

| Taxonomy | Corpus candidates |
|---|---:|
| ORTHOGRAPHIC_ASR_EQUIVALENCE | 0 |
| GRAMMATICAL_VARIANT | 221 |
| CONTEXT_CONDITIONAL | 142 |
| AMBIGUOUS | 133 |
| NOT_EQUIVALENT | 33 |

| Treatment | Corpus candidates |
|---|---:|
| SAFE_EQUIVALENCE | 221 |
| CONTEXT_CONDITIONAL | 56 |
| REJECT | 33 |
| UNRESOLVED | 219 |

| Mode | SAFE | CONDITIONAL | REJECT | UNRESOLVED |
|---|---:|---:|---:|---:|
| vocabulary | 91 | 28 | 33 | 119 |
| read | 184 | 0 | 6 | 193 |
| cloze | 184 | 0 | 6 | 193 |
| correction | 184 | 39 | 6 | 154 |

Counts classify detected spans; they are not production approvals. Each ambiguous or unresolved source remains explicitly joined to a decision. The full candidate rows and rule-level reasons are in `corpus-candidates.json` and `decisions.json`.

## Decision

- Safe pair-based equivalents: only exact, listed contraction↔expansion spans whose auxiliary and polarity are unchanged; approved for all four modes under the separate grammatical-variant authority tier, with existing answer authority retained.
- Conditional: `’s`, `’d`, `let’s`, split `can not`, and the conventional `aren’t I` tag. Only a unique, complete parse can pass; all other cases remain unresolved.
- Reject: negation loss/addition, auxiliary/tense substitution, unsupported sentence-final contractions, and cross-rank/segment phrase synthesis.
- Unresolved: `ain’t`, lexical possessive `’s`, unresolved homophone/role collisions, and any context not parsed uniquely.
- Read accepts only listed complete spans and preserves missing words/highlights. Cloze accepts only a complete hidden target in place in the selected final utterance; completeness and preservesExpectedNegation remain mandatory.

## Repository closure gate

Repository closure is **CLOSED**. ASR-09A audit authority remains CLOSED and is ready for ASR-09B implementation; this is not an ASR-09B production change.
- T/D validator repair: PR #327, merge `9aed421af7427c115f722ffad5809ff3466fa39b`.
- T/D evidence: `data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json` (Git blob `8f55f0ac88aa02e6bfc7af535625fe7a350f97f2`). Reconciliation accepted **36/36** records: **34 UNCHANGED**, **2 INDEX_RELOCATED**, **0 unresolved drift**. `tdc-00002` (`vocab:00528`, `be forced to do something`) and `tdc-00007` (`vocab:00634`, `tend to do something`) moved from paraphrase index 0 to 1 while retaining unique exact surfaces, PARAPHRASE classification, and entry-scoped rescue.
- ASR-09A audit closure: PR #326, merge `1a8c6b9e4267f390498dab9bc4b0ba9374d6d16c` (required PR checks succeeded before merge).
- Historical audit baseline `e1b56da18e0df1d583473a6f208a75333bd22969` and its production blobs are unchanged. Former `tdc-00002` validation failure is resolved, not an active blocker.

See `architecture-report.md` for implementation comparison, risks, exact constraints, and next-task guidance.
