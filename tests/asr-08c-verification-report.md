# ASR-08C Android Real-Game Diagnostic Instrumentation

Status: **Verified on PR head; ready to merge**

## Repository

- Repository: `miyatayuuma/english-pwa`
- Starting `main` SHA: `15b7cfdf83df5db5ae4a72fe4260e0d1d9d43593`
- Starting `APP_VERSION`: `v5.98`
- Working branch: `feat/asr-08c-native-game-diagnostics`
- Runtime version after shared JavaScript changes: `v5.99`
- PR #322: https://github.com/miyatayuuma/english-pwa/pull/322
- Implementation commit verified: `3c1f19eb920508e0664efe805a7b4705ab0d4501`
- Production grading, semantic authority, vocabulary entries, and Read items: unchanged

## Diagnostic coverage

|Field|Implemented|Verified|
|---|---|---|
|Native session / attempt correlation|Yes; distinct IDs, trace session, sequence, start-time game context|Collector/controller tests and Android emulator Gate-A PASS; Pixel runtime pending|
|N-best evidence|Yes; provider counts, retained alternatives, rank, confidence, segment and final state|Recognition, adapter and full CI tests PASS|
|Selected candidate|Yes; source, transcript, rank, segment, authority and decision from actual grader result|Candidate and source-contract tests PASS|
|Vocabulary grading|Yes; actual TARGET / PARAPHRASE / MISS result, occurrence and rescue provenance|Full CI suite PASS, including current `vocab:00139` canonical fixture|
|Cloze repair span|Yes; selected repair, offsets, source token spans, restart, completeness, negation and hidden targets|Cloze grader fixtures and full CI suite PASS; live Pixel trace pending|
|Correction state|Yes; Read/Vocabulary source, attempt count, result, completion and SRS skip|Correction and source-contract tests PASS|
|SRS update result|Yes; actual update invocation, persistence result, before/candidate/after, review and streak|SRS observer tests verify successful and failed storage writes|
|Final UI score / highlight|Yes; displayed rate, level, token highlight state and authority|UI/source-contract tests PASS; live Pixel comparison pending|
|Debug-only gate|Yes; debug-only Android bridge plus launch Intent; no Web/local-storage/query enable path|Debug gate tests and `assembleRelease` PASS|
|JSON export|Yes; raw export requires explicit copy, metadata-only redaction, clear and bounded memory|Collector/export tests PASS|

The `native-gate.html` recognition harness remains separate. Game trace instrumentation observes the ordinary Recognition Controller, graders, UI commits, and existing SRS writes; the collector does not grade or write learning state.

## Validation

- `npm ci`: PASS (101 packages installed)
- `npm test` locally: 455 passed, 0 failed, 85 skipped because the local Playwright Chromium binary could not be installed
- GitHub Actions `npm test`: PASS — 540 passed, 0 failed, 0 skipped, including the 85 Chromium browser regression tests
- PR test retry: PASS. The first PR-triggered attempt hit a 30-second timeout in the unrelated existing `audioFolderRestore` browser test; the same job passed on retry and the push-triggered run also passed.
- `npm run speech:validate-td-cluster-before-to`: PASS
- `npm run vocab:check-derived`: PASS
- `npm run vocab:validate`: PASS
- JavaScript syntax checks: PASS
- `git diff --check`: PASS
- `npm run native:sync`: PASS; 112 runtime assets staged and Capacitor Android sync completed
- Android CI: `assembleDebug assembleRelease lintDebug`: PASS; the debug APK was uploaded as the `english-pwa-android-debug` workflow artifact
- Android Gate-A emulator `connectedDebugAndroidTest`: PASS
- Release isolation: static gate tests and `assembleRelease` PASS
- Android Pixel / real-device game execution: NOT RUN; this is ASR-08D acceptance work
- Privacy/logging: raw transcripts stay in bounded in-memory trace records and are copied only on explicit action; metadata-only export redacts transcript/content fields; native and JS diagnostics log summaries only; no persistent trace store or external upload was added

No production scoring defect was observed by automated verification. Pixel recognition accuracy and live Vocabulary / Read / Cloze / Correction trace comparison remain for ASR-08D.

## Pixel handoff

1. Download `app-debug.apk` from the `english-pwa-android-debug` artifact on the [Android workflow run](https://github.com/miyatayuuma/english-pwa/actions/runs/37931540932), then install it: `adb install -r app-debug.apk`.
2. Launch the ordinary game shell in trace mode: `adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace true`.
3. Open Vocabulary, Read, Cloze, and Correction normally. In the floating `GAME TRACE` panel, turn Trace ON before each set of trials.
4. Use “全件JSONをコピー” for raw evidence or “伏字JSONをコピー” for metadata-only export. Compare each `final-ui-result-committed` and `srs-update-completed` event with the visible game result.
5. Turn the launch gate off with `adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace false`; the panel is removed and collection stops.
