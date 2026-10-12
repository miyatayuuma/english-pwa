# ASR-09A Architecture Report

## Baseline

- Repository: `miyatayuuma/english-pwa`
- Main: `e1b56da18e0df1d583473a6f208a75333bd22969`
- APP_VERSION: `v5.101`
- Vocabulary / items blob: `91324d35b2db1911ece2cf3ff746409d321fe963` / `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`
- Closed Japanese Prompt Authority: PR #325; production materialization confirms population 2,478, POST=545, DRIFT=0.

## Existing speech path

- **safe-token-apostrophe-retained — PASS:** NFKC + apostrophe-glyph normalization is applied; TOKEN_PATTERN retains internal apostrophes as part of one token.
- **safe-vs-canonical-token-difference — RISK_IF_REUSED:** safeSpeechTokens preserves apostrophe and word boundaries. canonicalTokens removes apostrophes before mergeContractions, so we’re collides with bare were as “were”; the expanded phrase we are remains two tokens. Keep canonicalTokens out of speech-equivalence decisions.
- **vocabulary-answer-normalization — SEPARATE:** normalizeVocabularyAnswer removes apostrophes but does not merge expanded contractions; existing target/paraphrase authority compares only explicit source strings.
- **alignment-span — EXACT_OR_EXPLICIT_ONLY:** resolveSpeechTokenSpan accepts exact token equality or explicit exact-equivalent rules; explicit rules are checked in array order and return 1↔N span lengths.
- **rule-scope-and-provenance — AVAILABLE:** Current explicit rules support global/entry/mode/provider scopes and attach ruleId/ruleKind/displayPolicy to alignment evidence.
- **target-paraphrase-miss — AUTHORITY_PRESERVED:** Vocabulary first classifies canonical/answers/source as TARGET and curated paraphrases as PARAPHRASE; ASR equivalence may align a recognized surface but must not add a new answer string or promote a paraphrase.
- **nbest — INDEPENDENT_HYPOTHESES:** Rank 0 is evaluated first; only finalized provider alternatives are separately evaluated. No cross-rank word synthesis.
- **cloze-polarity — EXISTING_GUARD:** preservesExpectedNegation requires every expected negation token index to be matched; hidden target tokens also require full in-place reproduction and final repair selection.
- **read-correction-and-srs — MODE_OWNED:** Read and Correction score their alignment differently; Correction practice success does not itself write scheduled review state. Vocabulary TARGET/MISS owns SRS updates; therefore new equivalence changes admission risk.
- **existing-rules — PRESERVE:** than↔then, their↔there, birthrate↔birth rate, and reviewed final-t/d rules remain untouched. Grammar rules must neither precede nor widen those existing scopes.

## Candidate accounting

The deterministic generator scanned 2478 vocabulary entries (5272 canonical/answer/paraphrase strings), 560 source English sentences, and joined 2481/2481 vocabulary source occurrences. It emitted 529 deduplicated candidate spans. Classification and disposition counts are in `manifest.json`; every corpus candidate joins one explicit decision in `decisions.json`.

## Grammar authority

- A contraction and its expanded form are grammatical variants, not punctuation normalization and not permission to add a semantic paraphrase.
- A fixed pair is eligible only as an exact contiguous span in either direction. Preserve all surrounding tokens, order, auxiliary, tense/aspect, and polarity. Keep raw ASR text unchanged and retain the rule ID and span as alignment provenance.
- `’s` and `’d` remain context conditional. A bounded local resolver may pass only when the construction forces one standard parse; unresolved parses reject. The corpus scanner records cues but does not grant production credit.
- Negative rules bind the auxiliary and negator together (do not↔don’t, will not↔won’t, etc.). A missing or added negation, changed auxiliary, or changed scope is REJECT. `can not` remains separate from `cannot/can’t` unless context establishes narrow negative scope.
- `let’s`, `ain’t`, lexical possessive `’s`, and homophone/role collisions are conditional or unresolved. There is no global apostrophe deletion, suffix expansion, or tense morphology.
- Inventory rows always include the task’s listed classes; `corpusDiscoveredForms` adds actual forms found in the source. Corpus occurrence count is not an approval count.

## Mode policy

The enumerated fixed contraction and negative pairs are authorized for Vocabulary, Read, Cloze, and Correction with a separate grammatical-variant provenance tier. Vocabulary still requires canonical/answers/source TARGET authority; Read retains unmatched tokens and highlights only mapped reference indexes; Cloze requires a complete hidden target in place in the selected final utterance plus its existing completeness and negation guards; Correction adds no scheduled SRS update. Context-dependent ’s, ’d, split can not, let’s, and tag forms remain conditional and are not authorized for Read/Cloze in this audit.

N-best hypotheses remain independent provider outputs: exact/rule matching may be evaluated within one finalized candidate and rank, but no cross-rank, cross-segment, or prior-attempt synthesis is authorized. The existing lower-rank ordering and current explicit rules remain untouched.

## Architecture comparison

| Dimension | A. Explicit surface pairs | B. Morphological expansion | C. Bounded grammar resolver | D. Hybrid (recommended) |
|---|---|---|---|---|
| False-positive risk | Low for listed complete spans; registry omissions remain | High: auxiliary, tense, polarity, possessive, and homophone collisions | Medium; grammar coverage can misparse edge forms | Low for fixed pairs; conditionals pass only under a unique parse |
| False-negative reduction | Reduces misses only for enumerated pairs | Broadest apparent reduction, including unsafe cases | Reduces misses for context-forced ’s/’d and constructions | Strong for common safe pairs, bounded for ambiguous families |
| Corpus coverage | Measured, explainable; no unseen forms | Broad but cannot be safely counted as approval | Moderate, depends on controlled grammar inventory | Covers the 221 safe grammar candidates; conditional/unresolved rows stay excluded |
| Runtime cost | Low bounded table lookup | Low after expansion, with large rule surface | Highest; local parsing and syntax checks | Low for fixed list plus small bounded resolver |
| Implementation complexity | Low | Medium; high ongoing regression burden | High | Medium and auditable |
| Browser / Android sharing | Shared data table | Shared but risks global behavior drift | Shared parser needed | Shared rules and resolver; same audit fixtures across clients |
| N-best behavior | Apply to one complete finalized rank at a time | Temptation to normalize candidates broadly | One candidate at a time | Same; never combine ranks, segments, or attempts |
| Alignment provenance | Pair ID and exact span | Expansion path can be opaque | Parse rule and syntax evidence required | Emit authority tier, rule ID, expected/observed spans, and reason |
| Raw transcript | Preserve without rewriting | Often normalized destructively | Can preserve if deliberately designed | Preserve raw ASR text; expose normalized alignment separately |
| Vocabulary authority | Keep canonical/answers/source as TARGET; paraphrases stay PARAPHRASE | High risk of implicit answer promotion | Needs explicit admission boundary | Only align a listed pair to current TARGET authority; never promote paraphrases |

The current alignment supports explicit ordered 1↔N spans, mode/entry/provider scope, and rule provenance. Grammar variants use a distinct grammatical-variant authority tier from Unicode apostrophe normalization. Read preserves every unmatched reference word; Cloze additionally requires complete in-place hidden-target reproduction, the selected final repair, and negation preservation. These modes do not grant credit to unlisted paraphrases.

## Repository closure gate

Repository closure is **CLOSED**. ASR-09A audit authority remains CLOSED and is ready for ASR-09B implementation; this is not an ASR-09B production change.
- T/D validator repair: PR #327, merge `9aed421af7427c115f722ffad5809ff3466fa39b`.
- T/D evidence: `data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json` (Git blob `8f55f0ac88aa02e6bfc7af535625fe7a350f97f2`). Reconciliation accepted **36/36** records: **34 UNCHANGED**, **2 INDEX_RELOCATED**, **0 unresolved drift**. `tdc-00002` (`vocab:00528`, `be forced to do something`) and `tdc-00007` (`vocab:00634`, `tend to do something`) moved from paraphrase index 0 to 1 while retaining unique exact surfaces, PARAPHRASE classification, and entry-scoped rescue.
- ASR-09A audit closure: PR #326, merge `1a8c6b9e4267f390498dab9bc4b0ba9374d6d16c` (required PR checks succeeded before merge).
- Historical audit baseline `e1b56da18e0df1d583473a6f208a75333bd22969` and its production blobs are unchanged. Former `tdc-00002` validation failure is resolved, not an active blocker.

## Regression obligations and remaining risks

43 positive controls, 38 negative controls, and N-best/mode-specific controls are supplied. ASR-09B must turn all SAFE decisions into production tests and preserve each minimum collision. The finite local grammar cue lists do not constitute a full English parser; do not expand them to unseen morphology without new evidence.
