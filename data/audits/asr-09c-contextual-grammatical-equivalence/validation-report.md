# ASR-09C Contextual 's Production Acceptance

**Status: implementation acceptance inventory; browser and Android closure is tracked by the pull request checks.**

## Authority and production boundary

- Production baseline: `09039633afd511bf7f76b47e74504fc491860991`, APP_VERSION `v5.102`.
- Immutable ASR-09A baseline: `e1b56da18e0df1d583473a6f208a75333bd22969`; decision `ambiguous-s` remains `CONTEXT_CONDITIONAL`.
- ASR-09A decision, corpus-candidate, and manifest SHA-256 values are frozen in `manifest.json`.
- Current Vocabulary and Items source blobs match the ASR-09A blobs exactly; this task changes neither corpus.
- Contextual matching is limited to Vocabulary and Correction. Read/Cloze do not receive these rules; the ASR-09B fixed rules remain shared across all four modes.

## Implemented patterns

| Rule | Expansion | Contracted surface | Evidence required |
|---|---|---|---|
| `asr09c-is-progressive` | subject + is + allowlisted present participle | subject's + same allowlisted present participle | Same subject, pattern, and allowlisted participle independently parsed on both token sequences. |
| `asr09c-has-been-progressive` | subject + has + been + allowlisted present participle | subject's + been + same allowlisted present participle | Same subject, pattern, and allowlisted participle independently parsed on both token sequences. |

The finite participle allowlist is: `catching`, `going`, `raining`, `running`, `seeing`, `studying`, `working`. A suffix match alone never grants credit. Negative `'s not`, `'s got`, adjective/past-participle, possessive, missing-context, and disagreement cases fail closed.

## ASR-09A corpus reconciliation

All 107 candidates were joined against their current production source string and span, then tested against each recorded counterpart in the ASR-09A-authorized modes. The inventory is in `corpus-reconciliation.json`.

| Disposition | Count |
|---|---:|
| SAFE_CONTEXT_RESOLVED | 3 |
| AMBIGUOUS_UNRESOLVED | 53 |
| REJECT | 3 |
| OUT_OF_SCOPE | 48 |

Accepted candidate IDs: `ge-18e0696d35c10ec7`, `ge-48759bb81ca2d7d6`, `ge-46cdf4db9913702c`. Corpus discovery does not widen runtime scope.

## Negative controls and validation

`negative-controls.json` contains 31 minimal counterexamples for ambiguity, unsupported morphology, negation, possessives, homophones, mode isolation, and malformed expansions. The production test also preserves TARGET/PARAPHRASE classification, raw transcript, Correction's practice-only behavior, N-best independence, attempt provenance, and 09B's fixed-pair coverage.

## Performance

A paired microbenchmark compared the baseline worktree with this branch on Node v24.19.0. Each workload used seven alternating samples after 1,800 warmup calls per implementation; the table shows per-call medians. The eligibility gate keeps the contextual resolver off exact matches and ordinary fixed-pair matches. Measured changes were below 5% in these workloads, with absolute increases of 0.17–0.63 microseconds per surface lookup and 4.76–27.57 microseconds per alignment.

| Workload | API | Baseline ms/call | Current ms/call | Change |
|---|---|---:|---:|---:|
| exact phrase | findSpeechSurfaceMatch | 0.021498 | 0.022124 | +2.9% (0.63 μs) |
| ASR-09B fixed pair | findSpeechSurfaceMatch | 0.011428 | 0.011598 | +1.5% (0.17 μs) |
| contextual ambiguous reject | findSpeechSurfaceMatch | 0.015302 | 0.015594 | +1.9% (0.29 μs) |
| exact phrase | alignSpeech | 0.730023 | 0.757591 | +3.8% (27.57 μs) |
| ASR-09B fixed pair | alignSpeech | 0.102277 | 0.107034 | +4.7% (4.76 μs) |

## Required repository checks

npm run speech:validate-asr-09b, npm run speech:validate-td-cluster-before-to, npm run vocab:check-derived, npm run vocab:validate, npm test, ASR-09A validator and deterministic check, ASR-09C validator, Chromium browser tests, and Android build/lint/emulator CI.
