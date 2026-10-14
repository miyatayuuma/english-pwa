# Targeted ASR Recognition Collision Remediation

## Scope and baseline

- Repository: `miyatayuuma/english-pwa`
- Baseline main: `6e6d3d250570fc24d92ca768ebae3865b88946c5`
- Baseline app version: `v5.105`
- Resulting app version: `v5.106`
- Vocabulary blob (unchanged): `91324d35b2db1911ece2cf3ff746409d321fe963`
- Items blob (unchanged): `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`

The implementation changes transcript-to-answer matching only. It does not change SpeechRecognizer output, vocabulary meanings, paraphrase authority, SRS rules, or the ASR-09A through ASR-09D audit artifacts.

## Corpus collision review

- `vocab:01156` remains canonical `gaze at something`; its source occurrence is “gazed at the Statue of Liberty” in item `E0006`. No morphology is generated from the new homophone pair.
- `gaze at something` also occurs as a paraphrase of `vocab:02374` (`stare at something`). The regression test confirms the equivalent `gays at something` remains PARAPHRASE for that entry, not TARGET.
- `lack` is canonical for `vocab:01251`, and `lack of something` is canonical for `vocab:01296`; both relate to the source span in `E0089`.
- The corpus also contains `lack something` as a paraphrase of `vocab:00025`. The entry scope prevents the collision rule from reaching it. The rule is not added to canonical strings or paraphrases.
- Existing speech rule IDs were unique before and after this change. No existing ID or approved ASR-09B grammatical pair was changed.

## Production rules

| Rule ID | Direction | Kind | Scope | Display |
|---|---|---|---|---|
| `gaze-gays` / `gays-gaze` | Bidirectional | `homophone` | Global; Vocabulary, Read, Cloze, Correction | Raw |
| `asr-lack-to-black` | `lack → black` only | `asr-known-confusion` | Vocabulary only; `vocab:01251`, `vocab:01296` | Raw |

`black → lack` is excluded. `gave`, `game`, `gaze's`, `gazed`, and `gazing` receive no gaze equivalence. The `lack/black` exception requires the complete recognized answer tokens to match after the existing carrier removal; it does not add unrelated words, missing words, or changed prepositions to the accepted answer.

Targeted rules are rejected when the supplied recognition state is explicitly non-final (`pending`, `interim`, `error`, `cancelled`, or `recognitionComplete: false`). Vocabulary's existing terminal-event gate remains authoritative in the application flow.

## Grading and provenance

- Vocabulary production classification confirms `vocab:01156` as TARGET for `gays at something`.
- Both lack entries classify only their canonical target as TARGET after the authorized one-way rule.
- The existing `my answer is` carrier path is reused. No carrier parser was added.
- Primary and lower N-best candidates retain their independent transcript, rank, segment, and attempt provenance. Candidate alternatives are not joined across ranks or segments; separate attempts are not combined.
- Primary raw transcript and display policy remain intact. For lower-ranked rescue, the established policy keeps the primary transcript visible and stores the accepted candidate in `rawTranscript`.
- Read ordering and precision, Cloze target/completeness/negation checks, Correction thresholds and practice-only state, paraphrase priority, and SRS behavior remain unchanged.

The dedicated suite has 8 test groups and covers 18 positive match/grading checks plus 42 explicit negative controls, including direction, entry and mode isolation, carrier handling, all four non-final completion states, provenance, and non-synthesis.

## Local validation

Passing commands:

- `node --test tests/asrTargetedRecognitionCollisions.test.mjs`
- `npm run speech:validate-td-cluster-before-to`
- `npm run speech:validate-asr-09b`
- `npm run speech:validate-asr-09c`
- `npm run speech:validate-asr-09d`
- `node scripts/speech/validate-asr-09a-grammatical-equivalence-audit.mjs`
- `node scripts/speech/build-asr-09a-grammatical-equivalence-audit.mjs --check`
- `npm run vocab:check-derived`
- `npm run vocab:validate`
- `npm test`: 516 PASS, 0 FAIL, 87 SKIP.
- `npm run native:sync`: passed; 117 runtime assets staged and Capacitor Android sync completed.
- The updated equivalence registry, Vocabulary evidence grader, version file, and index match byte-for-byte between source, `native-web`, and `android/app/src/main/assets/public`. The updated rule IDs are present in both PWA and Android staged speech assets.
- Vocabulary and Items Git blob hashes remain identical to the baseline values above; neither JSON file is modified.

The local Node runtime has no Chromium executable; the 87 skipped tests include browser cases. A Playwright browser download was attempted, but the download endpoint returned an empty archive. The repository's Application tests workflow installs Chromium and runs with `REORDER_REQUIRE_BROWSER=1`; its PR result is the browser acceptance evidence.

The local Android build could not resolve a Java compiler: this environment has a Java 17 runtime without `javac`, while the repository's Android workflow uses Temurin Java 21 and Android SDK 36. `native:sync` succeeded. Debug, Release, Lint, and Gate A are delegated to the repository's Android CI using that configured toolchain.

## Performance

Before and after were measured in the same checkout environment using the new benchmark script against baseline main and the work branch. Each row is the median of three independent process runs; each run executed 8,000 calls twice and 10,000 calls once. Values are milliseconds per call.

| Workload | Before P50 | After P50 | Before P95 | After P95 |
|---|---:|---:|---:|---:|
| Exact surface | 0.015260 | 0.015802 | 0.027332 | 0.021921 |
| Approved homophone | 0.006260 | 0.006495 | 0.019133 | 0.010175 |
| `gaze ↔ gays` | 0.021365 | 0.010649 | 0.035235 | 0.016146 |
| `lack → black`, allowed entry | 0.021169 | 0.011051 | 0.026365 | 0.013833 |
| `lack → black`, wrong entry | 0.008323 | 0.008914 | 0.010747 | 0.014688 |
| Read/Cloze negative path | 0.018060 | 0.017194 | 0.031999 | 0.023088 |
| Sentence alignment | 0.866017 | 0.878662 | 0.980530 | 1.008648 |

The biggest absolute P50 increase among non-match paths was 0.000592 ms for exact surface (0.542 μs); sentence-alignment P50 increased 0.012645 ms (12.645 μs). Wrong-entry rejection P95 increased 0.003941 ms (3.941 μs). The measured changes are small in absolute time, and the repeated P95 results varied; no clear end-user performance regression was found.

## Residual risks and GitHub evidence

- A learner who actually says “black” can receive TARGET for the two approved lack entries; this limited false-positive risk was explicitly accepted for this exception.
- The SpeechRecognizer's raw recognition rate was not measured or improved by this change.
- `gaze → gave` remains unsupported.
- Pixel ASR-08D remains OPEN.
- Android Gate A root cause remains OPEN; this task does not restart that diagnosis.
- PR URL, final PR head, CI results, merge commit, and post-merge main SHA are recorded in the GitHub PR and final closure report.
