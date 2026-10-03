# Shared Chunk Authority materialization

Start main: `85506d6ce258d2bd12f8ec80e937fbdd5e7a098d` (PR #251).
Integrated main: `fce346d` (PR #261), following `8624729b77330a03172e991100b91aa14d62e5c6` (parallel vocabulary semantic audit retained). English source did not change.

Production authority is `items.json → generate-reorder-metadata.py → sentence.partition.chunks`. Every sentence, including fixed context, has one partition. Reordering level does not select a partition. Android implementation is outside this change; its surface contract is exactly `sentence.partition.chunks.map(chunk => chunk.learningText)`.

## Schema and surfaces

Schema 2 remains at `data/reorder-v1.json`; legacy variants and tier rules are absent. Offsets are absolute item UTF-16 code units; token ranges are sentence-local half-open intervals. Items carry English-only SHA-256 authority and exact source text. Sentences carry source text, separators, tokens, clauses, protected constructions, one partition, and provenance. Chunks carry stable IDs, exact source spans/text/separators, one case-preserved learning surface, and mixed ownership members when necessary. Concatenating chunk sourceText + separatorAfter reconstructs the sentence; item leadingSeparator + sentence sourceText + separatorAfter reconstructs the original English.

Punctuation is classified in full item context before slicing chunks. Structural marks become whitespace and whitespace is collapsed/trimmed only in learningText. Contraction/possessive/name apostrophes, lexical hyphens/slashes, abbreviations, numeric internal commas/periods/colons, currency and percent marks are preserved. Unknown marks fail closed. No decapitalization, NFKC, contraction expansion, ASR-specific normalization or overlapping chunks are introduced.

## Structural materialization

Recursive clause/PP ownership includes subject-NP descendants. Natural NP cores retain determiners, possessors, compounds, adjectives and numerals. Arguments/complements/adjuncts have productive boundaries. Predicate reconciliation retains contiguous auxiliary/modal/negation/verb/adverb cores, with a closed semimodal set. Markers/coordinators open the following constituent. Adjacent particles stay with the verb; object-separated particles stay separate. Simple PPs retain their nominal core; internal productive clauses/coordination/nesting can split.

Protected lexical spans close boundaries without claiming the surrounding complement subtree. Lexical orthography has final protection. Dependency-fixed protection uses its connected lexical core. The generator has no tile-count merge pass and no maximum-8 rule. More than 13 units fails with an explicit exception-authority requirement rather than silently merging.

## Grading and runtime

State retains unique tile IDs. A completed candidate must be a permutation of the accepted IDs. Grading compares exact, case-sensitive learningText sequences against canonical and manual accepted orders. Any permutation among identical surfaces is equivalent; distinct surfaces remain order-sensitive. Wrong initial shuffles use the same equivalence relation. An all-identical partition is fixed context. Existing tap/drag/keyboard interactions, attempts, grading, workspace, completion, Lv5 exclusion, and speech isolation are retained.

## Corpus metrics

| Metric | Result |
|---|---:|
| itemCount | 560 |
| sentenceCount | 804 |
| sharedPartitionCount | 804 |
| playableSentenceCount | 758 |
| fixedContextSentenceCount | 46 |
| unavailableSentenceCount | 0 |
| chunkCount | 3472 |
| maxTileCount | 13 |
| tileCount14Plus | 0 |
| sourceReconstructionViolations | 0 |
| sourceCoverageViolations | 0 |
| tokenSpanCoverageViolations | 0 |
| protectedViolations | 0 |
| structuralPunctuationLeakage | 0 |
| lexicalPunctuationViolations | 0 |
| emptyLearningText | 0 |
| duplicateSurfaceGroupCount | 10 |

| Tiles | Sentences |
|---|---:|
| 1 | 43 |
| 2 | 85 |
| 3 | 164 |
| 4 | 196 |
| 5 | 117 |
| 6 | 88 |
| 7 | 61 |
| 8 | 27 |
| 9 | 11 |
| 10 | 6 |
| 11 | 5 |
| 12 | 0 |
| 13 | 1 |
| 14+ | 0 |

| One-word category | Chunks |
|---|---:|
| function word | 406 |
| content word | 565 |
| proper noun | 77 |
| operator | 8 |
| conjunction | 0 |
| particle | 23 |
| adverb | 42 |
| other | 102 |

## Overrides and repairs

Old overrides: 18; KEEP: 8; MIGRATE: 2; removed/OBSOLETE: 8. New partition overrides: 6. Production override entries total: 16 (8 fixed contexts and 8 parser-repair partitions, including the 2 migrated entries). Every override checks the full item English hash. Partition overrides additionally check sentence text and resolve surface anchors from fresh tokens; no char ranges or old tier ranges are copied. All 79 repaired candidates live in the gold regression corpus, not production manual ranges.

| Repair disposition | Count |
|---|---:|
| A | 43 |
| B | 20 |
| C | 8 |
| D | 8 |

A = general structural rule; B = reusable protected construction; C = deterministic parser reconciliation; D = genuine explicit parser exception.

| Partition exception | Migration | Reason |
|---|---|---|
| E0011-0 | NEW | Parser treats combines as auxiliary and prose as lexical verb. |
| E0050-0 | MIGRATE | Parser treats possessive her back as object pronoun + adverb and infinitival hug as proper noun. |
| E0053-0 | NEW | Parser treats nominal cloning techniques as xcomp + object. |
| E0075-0 | MIGRATE | Parser attaches Now as ccomp head and joins contracted subordinate subject to found. |
| E0119-0 | NEW | Parser tags the proper-name subject Dolly as an adverb. |
| E0459-0 | NEW | Parser tags finite correspond as nominal PP complement. |
| E0480-0 | NEW | Parser tags finite dates as root noun and cathedral as adjective. |
| E0511-1 | NEW | Parser tags proper-name subject Molly as an adverb and absorbs it into the predicate. |

## Human regression evidence

`data/reorder-gold.json` contains all 126 reviewed sources, prototype learning chunks, final expected learning chunks and assessment; all 79 repairs with disposition; and every old override migration decision. Fresh pinned-parser replay passes every record. 123/126 prototype partitions are reproduced. Three policy-faithful differences are recorded rather than hidden: E0400 recursively splits the nonfinite PP complement; E0403 keeps the closely attached adverb in `thought better`; E0538 retains the contracted subject/copula and splits its productive adjective complement. Of 79 repaired candidates, 78 reproduce exactly and E0403 has the same recorded predicate-core improvement.

## Validation status

Full corpus independent source/token/span/structural/protected/learning/lexical/grading validation: PASS. Fresh-parser 126 + 79 replay: PASS. Consecutive generation byte stability: PASS. Local Node tests: 288 pass, zero failures; browser tests cannot launch in this managed execution environment and are explicitly not counted as passed. CI browser launch failures are fatal. Application CI job 111127248308 passed all 341 tests with zero skips, including actual production UI, duplicate-surface grading and the generated 13-tile item. The required-browser flag is scoped to the browser-installed application job; the vocabulary unit-only job remains independent. PR #253 records final-head reruns and release/merge status.

Implementation gates: source/coverage/protected/surface, fresh-parser human regression, determinism, and production browser tests PASS. Final-head CI and merge provenance are recorded in PR #253.

Latest-main refresh: fce346d (PR #261). All parallel Vocabulary changes retained; English source unchanged. Full 560-item / 804-sentence regeneration and determinism/validation rerun before closure.
