# Issue #342 ASR finality / SRS integrity remediation

**Status: `ISSUE #342 P0 ASR FINALITY / SRS INTEGRITY PRODUCTION CLOSED`.** PR #343 is merged, all required PR and post-merge CI passed, and Issue #342 is closed. Issue #210 remains open for its separate physical-device and Pixel acceptance work.

## 1. GitHub authority

- Initial main SHA: `4a01d9e6d8f4c080d738dc87dfc9c5082afb9d29`
- Initial `APP_VERSION`: `v5.109`
- Working branch: `fix/issue342-asr-finality-srs-integrity`
- Production target: `v5.110`
- Pull request: [#343](https://github.com/miyatayuuma/english-pwa/pull/343).
- Implementation commit at PR creation: `c9b69f8e21ff27b74057b79a21957b92384c9322`.
- Final PR head: `8a9f6c4dc809f2be56c453a96bce4f6c72901a49`.
- PR #343 merged at `2026-10-14T23:40:08Z`; merge commit and main immediately after the P0 merge: `614417ea209f4d18be4191755ca872029cf58d5f`.
- Post-merge Application/Chromium, vocabulary, Android, and Pages workflow runs all passed; see §7 and §9.
- Issue #342: CLOSED by PR #343. Issue #210: OPEN.

## 2. Confirmed P0 reproduction and pre-fix failure

Issue #342 records the production-source SHA as `179ee55f51f663dfc5acf2cbacde23a44a96d970` (`v5.109`) and the production Chromium test as `Issue 210 interim negative control: an interim-only exact transcript cannot update SRS or pass`.

The retained PR #341 browser test ran against the real production home, options UI, recognition controller, scoring, and persistence path. Its provider fixture supplied only the exact E0006 answer with `isFinal:false`, `recognitionComplete:false`, and `completionState:'pending'`, then stopped through the production mic control and sent `end`. CI run 975 / job `115902965070` logged the failing before/after assertion under the audit TODO. The actual result was:

- Before: no E0006 SRS record.
- After: `last=0`, `best=0`, `lastMatch=1`, `level5Count=1`, `noHintHistory=[2026-10-14T12:00:00Z]`, and a 24-hour review due date.
- After: `studyLogV1[2026-10-14].passes=1` and `no_hint=1`.
- Raw provider event: exact E0006 text, `isFinal:false`, one rank-zero candidate, attempt still pending.

This is the pre-fix failure evidence. The audit TODO has now been removed and the assertion is a required browser test. A local pre-fix Chromium rerun was not available because this workspace has no Playwright Chromium executable; local browser download was not usable. The captured CI reproduction above is the pre-fix authority.

The pre-fix red control was also run against original main `4a01d9e6d8f4c080d738dc87dfc9c5082afb9d29` on isolated branch `repro/issue342-pre-fix-red`, commit `238f14eff1dc11acf1a641b8c479f23005659e91`. In Application run `38655946872`, job `116165620352`, the formerly TODO test failed at the SRS snapshot assertion: expected `{}` but received an E0006 record with `lastMatch=1`, `level5Count=1`, a no-hint history entry, and a 24-hour review deadline. This is the required before-fix red result. The same full run also hit a separate 30-second audio-folder browser timeout; it did not alter the Issue #342 failure evidence.

## 3. Lifecycle mapping and root cause

Production call path:

`Web Speech interim` → `recognition.onresult` → `recognition.onend` → `finalize()` → `stopRec()` → `recognitionHypotheses()` → `evaluateRecognitionCandidates()` → Read/Cloze/Correction grading → SRS / Study log.

The defect had three connected admission failures:

1. `recognition.js` treated the provider `end` event as both transport completion and completed speech evidence, setting `recognitionComplete=true` regardless of segment finality.
2. `recognitionCandidates.js` allowed terminal attempt flags to override non-final segments, and always returned primary transcript as a candidate even when the evidence was incomplete. Restricting only N-best rescue therefore could not prevent an exact interim primary from matching.
3. `main.js:stopRec()` admitted grading after `outcome.ok` and transcript presence. That path could reach Read/Cloze/Correction, score display, SRS, study-log writes, promotion, and advance without a finality check.

Vocabulary has a separate production grader and therefore needed its own admission check in addition to the shared candidate layer.

## 4. Finality contract implemented

- **Transport completion** records the provider/session lifecycle (`end`, manual stop completion, error, or cancellation).
- **Evidence finality** records whether every segment used to compose the primary transcript was received with `isFinal:true`.
- A normal `end` closes transport and settles the stop promise even when evidence is empty or interim-only. It never upgrades an interim segment.
- Grading requires a successful normal terminal outcome, at least one segment, all segments final, a primary transcript reconstructed from those final segments, a matching attempt/item/entry identity, and an unprocessed attempt.
- The production guard requires both `transportComplete:true` and a terminal completion state; legacy shared-evidence parsing remains available to legacy callers, but does not open production grading.
- Native Android `final` results retain their existing finalized mapping. Native `partial`, errors, cancellation, and late results do not become grading evidence.

## 5. Production changes

- `scripts/speech/recognition.js`: stores attempt/item/entry provenance on every result segment; distinguishes transport completion from evidence finality; traces `provider-ended`, final evidence state, and terminal completion truthfully; settles interim-only attempts normally.
- `scripts/speech/recognitionCandidates.js`: rejects empty, non-final, mixed, errored, cancelled, contradictory, or transcript-mismatched evidence; returns no primary or N-best candidates for incomplete evidence; adds the strict production attempt/context admission predicate.
- `scripts/speech/recognitionEvidence.js`: retains segment attempt/item/entry provenance.
- `scripts/app/main.js`: adds a guard before candidate evaluation and every scoring/persistence/advance side effect; rejected evidence clears preview/score/highlights and returns the learner to retry. Final transcript display no longer commits an early score before provider termination.
- `scripts/app/vocabularyMode.js` and `scripts/speech/vocabularySpeechEvidence.js`: apply the same strict finality and identity rules to TARGET, PARAPHRASE, MISS, and Correction, while allowing legacy evidence calls that contain no recognition metadata.
- Correction practice behavior, N-best ordering/provenance, explicit homophone/orthographic equivalence, ASR-09B/C/D scope, and Shadowing's exposure-only lifecycle remain unchanged.

## 6. Regression coverage

### Deterministic unit and controller tests

`tests/issue342RecognitionFinality.test.mjs`, `tests/recognitionCandidates.test.mjs`, `tests/recognitionContext.test.mjs`, and `tests/androidSpeechBackend.test.mjs` cover:

- terminal plus all-final acceptance;
- terminal plus interim-only, mixed final/interim, no segments, pending, error, cancellation, incomplete attempt, and mismatched primary rejection;
- explicit `terminal` plus `isFinal:false` rejection even when `recognitionComplete:true`;
- rank-zero and N-best promotion rejection for incomplete evidence;
- stale attempt/item identity rejection;
- multi-segment finalized transcript acceptance;
- Web delayed/manual/automatic stop behavior and Android finalized-result behavior;
- Vocabulary TARGET, PARAPHRASE, and Correction staying NO GRADE/MISS on interim evidence, while a final TARGET remains accepted.

Finality-focused controller/candidate suites: 47 pass / 0 fail.

Full local `npm test`: 622 tests, 523 pass, 0 fail, 99 skipped, 0 TODO. The skips are browser tests because Chromium is unavailable in the local workspace; they are not acceptance passes.

### Production browser scenarios added

`tests/issue210RealSession.browser.test.mjs` now requires the #342 negative control as a normal test. Through a fresh browser context and real production session it checks:

- exact interim primary followed by manual stop/end: no SRS or study-log write, no pass, no score, no result screen, no advance, retry enabled;
- a new interim attempt whose rank-one N-best exactly matches the answer: also NO GRADE;
- exact interim followed by automatic provider end: no grade or persistence;
- a subsequent new finalized exact attempt: normal PASS, one SRS write, one pass-log write, `lastMatch=1`, `level5Count=1`, one no-hint history entry, and the normal 24-hour review interval;
- interim-only Correction does not record success/failure or advance; later finalized Correction still works.

`tests/reorderProduction.browser.test.mjs` adds interim-only full-sentence Cloze NO GRADE before the existing finalized Cloze N-best PASS. `tests/vocabularyMode.browser.test.mjs` verifies interim-only transport end stays NO GRADE, leaves SRS unchanged, and permits a new finalized attempt.

The Issue #210 CI workflow sets `ISSUE210_REQUIRE_BROWSER=1`, so absence of Chromium fails that job instead of turning the required tests into skips.

## 7. Validation and assets

Completed locally:

- `npm ci`
- `npm test`: 523 pass / 0 fail / 99 browser skips / 0 TODO.
- `npm run vocab:check-derived`: PASS.
- `npm run vocab:validate`: PASS.
- `npm run speech:validate-td-cluster-before-to`: PASS.
- `npm run speech:validate-asr-09b`: PASS.
- `npm run speech:validate-asr-09c`: PASS.
- `npm run speech:validate-asr-09d`: PASS.
- `npm run native:sync`: PASS; 118 runtime assets staged and Capacitor Android assets synchronized.
- Staged `scripts/app/main.js` SHA-256 equals source and Android staged asset: `51aeb6e3ccf24cfd27c6b59b0cf37381d07d5e61fd4bdcfc3a7258425d403332`.
- Staged `scripts/speech/recognition.js` SHA-256 equals source and Android staged asset: `6a2382bafcf2772ce96bb01eeda5c8f6dfbebaeac4e6bcf8df7a8e2265cb73ce`.
- App version, PWA bootstrap, service-worker cache, worker precache, and native staging target `v5.110`.

The local Android Gradle build could not start because the wrapper could not download Gradle 8.14.3 in this restricted network environment. GitHub CI subsequently completed the required Android builds and emulator gate successfully.

### Required CI and post-merge results

- PR Application / Chromium: run `38654595646`, attempt 2 PASS. The suite reported 622 tests, 620 passed, 0 failed, 2 skipped, and 0 TODO. The Issue #342 E0006 test executed as `ok 180`.
- Post-merge Application / Chromium: run `38655489798` PASS; 622 tests, 620 passed, 0 failed, 2 skipped, and 0 TODO.
- Post-merge raw E0006 interim evidence: `isFinal:false`, pending attempt; `beforeSrs=null`, `afterInterimSrs=null`, `afterNbestSrs=null`, and `studyLog=null`. The test asserted unchanged SRS and Study-log snapshots, zero SRS/Study-log writes, no score, no committed interim transcript, no result screen, and no advance.
- Normal finalized E0006 retry in the same production browser test: PASS. One finalized attempt wrote SRS once and Study log once; `lastMatch=1`, `level5Count=1`, `noHintHistory=[2026-10-14T12:00:00Z]`, and the 24-hour review interval remained intact. The test asserted one pass and one `no_hint` entry.
- PR Vocabulary validation: run `38654595593` PASS. Post-merge Vocabulary validation: run `38655489763` PASS.
- PR paraphrase scope guard: run `38654595570` PASS.
- PR Android shell build: run `38654595600` PASS, including `native:sync`, `assembleDebug`, `assembleRelease`, `lintDebug`, and Android Gate A.
- Post-merge Android shell build: run `38655489768` PASS with the same build/lint tasks and Gate A emulator.
- Post-merge Pages build/deployment: run `38655489865` PASS.
- Final PR-head Application/Chromium, vocabulary, scope, and Android checks were green before merge. Post-merge Application, vocabulary, Android, and Pages checks were green on `614417ea209f4d18be4191755ca872029cf58d5f`.

## 8. Protected data integrity

The following current blob IDs equal the initial main authority and remain unchanged:

| Asset | Initial/current blob |
|---|---|
| `data/vocabulary-v3.json` | `91324d35b2db1911ece2cf3ff746409d321fe963` |
| `data/items.json` | `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb` |
| `data/characters.json` | `1d0c61711d763373e1f587ecde16ff9f07cb1a45` |

No learning data or user study history was changed.

## 9. PR, CI, merge, and post-merge evidence

- PR URL: [#343](https://github.com/miyatayuuma/english-pwa/pull/343).
- PR implementation commit: `c9b69f8e21ff27b74057b79a21957b92384c9322`.
- Final PR head SHA: `8a9f6c4dc809f2be56c453a96bce4f6c72901a49`.
- PR #343 merge SHA / main at P0 merge: `614417ea209f4d18be4191755ca872029cf58d5f`.
- Application / Chromium, vocabulary validation, paraphrase scope guard, Android assembleDebug, assembleRelease, lintDebug, Android Gate A, and post-merge Pages deployment: PASS. Run IDs are listed in §7.
- Issue #342 is CLOSED after the verified merge. Protected data blob IDs match initial main.

## 10. Issue #210 reconciliation and remaining risks

Issue #210 remains OPEN and has been reconciled with this verified browser result:

- Finalized speech scoring: PASS.
- Interim-only false-PASS prevention: PASS.
- SRS persistence integrity: PASS.
- Study-log integrity: PASS.
- Existing result integration: PASS for the tested scenarios.

Physical-device visual acceptance, actual Pixel microphone/Android SpeechRecognizer behavior, hidden-page `visibilitychange` finalization, and Pixel ASR-08D PR #323 remain unverified. This repair does not close #210.

## 11. Remaining risks

- Local Chromium and Android Gradle could not be run in this workspace; required GitHub browser and Android CI passed on the PR head and after merge.
- Physical-device and Pixel-specific speech behavior remain outside this browser/controller validation.
- Service-worker behavior while the page is hidden remains `NOT_VERIFIED`.
