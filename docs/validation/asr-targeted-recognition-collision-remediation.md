# Targeted ASR Recognition Collision Remediation

## Scope and baseline

- Repository: `miyatayuuma/english-pwa`
- Baseline main: `6e6d3d250570fc24d92ca768ebae3865b88946c5`
- Baseline app version: `v5.105`
- Original PR #334 app version: `v5.106`; reconciled PR #334 merge version: `v5.107`; current production version after PR #336 review follow-up: `v5.108`
- `data/vocabulary-v3.json` blob (unchanged): `91324d35b2db1911ece2cf3ff746409d321fe963`
- `data/items.json` blob (unchanged): `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`

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

At original PR #334 head, the dedicated suite had 8 test groups and covered 18 positive match/grading checks plus 42 explicit negative controls, including direction, entry and mode isolation, carrier handling, all four non-final completion states, provenance, and non-synthesis. PR #336 extended the same suite with terminalized-interim negative controls for both TARGET and PARAPHRASE; those follow-up cases are described separately below.

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

## Gate A root-fix reconciliation and production closure

PR #334 was based on the same shared Gate A callback defect found on baseline main. The independent fix PR #335 merged to main at `3b14776ed5dbb3b6d47290874e2c0d52bf3a62b9` with `v5.106`. Existing PR #334 merged that root-fix commit and retained its original ASR implementation/tests; its reconciled head was `718727eeb637f9b34cbe8338e79f70aa8388f775`, and its main merge commit was `6147df3b5bda938d0f9925c899009ca8138cb24e` (`v5.107`). The PR head tree and main merge tree were identical.

The speech-equivalence registry, Vocabulary evidence grader, benchmark, and targeted collision tests are byte-identical to original PR #334 head `41f767c064ef88adf9180bcee1890fbcbf15cb03`. Only root-fix integration, `v5.107` cache/version synchronization, and validation-report reconciliation were added. `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, and `scripts/version.js` share the `v5.107` identity.

### ASR and browser acceptance

- Dedicated collision suite: 8 groups PASS; 18 positive match/grading checks PASS; 42 explicit negative controls PASS. Bidirectional `gaze ↔ gays`, scoped one-way `lack → black`, candidate provenance, and grading-mode boundaries are unchanged.
- Reconciled local exact-tree validators: ASR-09A audit and deterministic check, ASR-09B, ASR-09C, ASR-09D, T/D cluster, Vocabulary derived/full, and `git diff --check` passed.
- Application/Chromium PR run `38506197872` and push run `38506193467`: PASS, 605 tests (603 passed, 0 failed, 2 skipped) on each. The workflow ran the ASR-09A through ASR-09D, T/D cluster, Vocabulary derived/full, and browser/unit test steps.
- Vocabulary PR `38506198415` and push `38506193525`: PASS. Paraphrase scope guard `38506197866`: PASS.
- Android PR run `38506197828`: Debug/Release/Lint and Gate A PASS. Android push run `38506193746`: Debug/Release/Lint and Gate A PASS.

### Exact-head emulator acceptance

Independent Gate A run `38506212927` pinned all three fresh emulator jobs to reconciled PR head `718727eeb637f9b34cbe8338e79f70aa8388f775` (`v5.107`).

| Run | Job | Artifact | Result |
|---|---:|---:|---|
| Acceptance 1 | `115664204553` | `11867987071` | 5 PASS / 0 FAIL / 0 SKIP; 10 cycles; 2 Activity relaunches; permission granted |
| Acceptance 2 | `115664204418` | `11867834808` | 5 PASS / 0 FAIL / 0 SKIP; 10 cycles; 2 Activity relaunches; permission granted |
| Acceptance 3 | `115664204713` | `11868465031` | 5 PASS / 0 FAIL / 0 SKIP; 10 cycles; 2 Activity relaunches; permission granted |

The three runs use the same application/test SHA; they are not combined with another head. PR #334 merged after all listed required checks passed.

### Post-merge authority

Main merge SHA `6147df3b5bda938d0f9925c899009ca8138cb24e` is `v5.107`. Push-triggered post-merge Application/Chromium (`38506804000`), Vocabulary (`38506804072`), Android Debug/Release/Lint + Gate A (`38506804085`), and Pages (`38506804189`) workflows passed. Application ran 605 tests (603 passed, 0 failed, 2 skipped). Main-pinned independent Gate A run `38506857511` separately checked out the exact main merge SHA in all three jobs; each passed 5/0/0 with ten cycles, two relaunches, and the real permission dialog.

At the #334 main merge, the then-current v5.107 staged PWA runtime had 117 files with identity `6770e516e8cf4d46f8201f1c9d0d1dd7cc0bb7772bbfd117a89763ba7f250d9a`; Android had the same 117 plus its two generated Cordova files, for 119 files with identity `59578be76e702682ed70702e945ea87fe776e0c0210603364efb2161ea28c322`. Vocabulary blob `91324d35b2db1911ece2cf3ff746409d321fe963` and Items blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb` remain unchanged. The main-tree rule source confirms `gaze-gays` and generated reverse `gays-gaze`; `asr-lack-to-black` has no reverse rule and remains restricted to the two approved Vocabulary entries. Pixel ASR-08D PR #323 remains OPEN.

These v5.107 post-merge results describe PR #334's merge point and are followed by the v5.108 PR #336 review-fix validation below. The post-merge evidence supersedes the original report's note that the Gate A root cause remained open. See `android-gate-a-capability-callback-root-cause.md` for pinned A/B, callback correlation, exact failure mechanism, permission timing, and probe evidence.

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
- Android Gate A root cause was later confirmed and repaired in PR #335; see `android-gate-a-capability-callback-root-cause.md`.
- PR URL, final PR head, CI results, merge commit, and post-merge main SHA are recorded in the GitHub PR and final closure report.


## Final-evidence review follow-up in PR #336

After PR #334 merged at 6147df3b5bda938d0f9925c899009ca8138cb24e (v5.107), its unresolved inline review was checked before reporting the review complete. The comment identified that targeted explicit-paraphrase matching did not receive the final-recognition-evidence guard. PR #336 passed the already computed completeEvidence to primary, N-best, and explicit-paraphrase targeted grading. This also rejects a terminal outer event whose recognition segment is still interim (isFinal=false). Existing equivalence IDs and directions, scope, valid final answers, and other grading semantics remain intact.

The targeted suite retains the positive final-result case and adds negative TARGET/PARAPHRASE cases for pending, interim, error, cancelled, and terminalized interim evidence. PR #336 head aada037f41ac182ddca5524aee36335941432354 passed Application/Chromium (38509108385), Vocabulary (38509108372), Scope guard (38509108382), and Android Debug/Release/Lint (38509108355). Its independent exact-head Gate A matrix 38509340349 passed all three fresh emulators: jobs 115673997725, 115673997935, 115673997942; each was 5/0/0, ten cycles, two Activity relaunches, and permission-dialog grant.

PR #336 merged at 76101569b73a9ffd964028a9ba75c7a4db0d4c92 and advanced APP_VERSION to v5.108. Push-triggered post-merge Application/Chromium (38510184939), Vocabulary (38510184916), Android Debug/Release/Lint + Gate A (38510184838), and Pages (38510185088) passed. The Application suite reported 603 passed, 0 failed, 2 skipped. An independent Gate A matrix pinned to the exact merge SHA (38510219370; jobs 115676771986, 115676771983, 115676771865) passed 5/0/0 with ten cycles, two relaunches, and permission grant per job.

The documented v5.107 identities above are historical values from the #334 merge and are not v5.108 identities.

The original #334 review thread was answered and resolved with this follow-up evidence; PR #336 had no additional review findings. Vocabulary blob 91324d35b2db1911ece2cf3ff746409d321fe963 and Items blob ae2aca768b784199b77ac1cf8c0c5a80fd5725bb remain unchanged; PR #323 remains OPEN.


The final exact-code-SHA workflow 38510777393 completed successfully on SHA 76101569b73a9ffd964028a9ba75c7a4db0d4c92 (v5.108). Jobs 115678529751, 115678530026, and 115678529999 uploaded artifacts 11870075488, 11869523870, and 11869354867. Each report shows all five required tests passing, zero failures, zero skips; logcat confirms ten navigation cycles and two fresh Activity relaunches. Each job independently reports the same staged identity: PWA 117 files, SHA-256 74c09237768a5faabc9f144ec7271ebb74853f7bce4256d12e21e828e427707e; Android 119 files, SHA-256 c8b8c60b56e345388e84b19c99b66374835e4215ec07fb3c1417536c85c8967a. The system PermissionController dialog appeared in all three artifacts and the dedicated on-demand permission test passed.

In each artifact's test order, the dialog test runs before the backend cancellation test. The latter separately calls pm grant for its fixture; this does not serve as the dialog test's grant path. All 3 independent runs remain on the same exact code SHA.