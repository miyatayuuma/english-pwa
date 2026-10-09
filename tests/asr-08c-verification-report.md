# ASR-08C Android Real-Game Diagnostic Instrumentation

Status at PR submission: **OPEN — CI build and browser regression pending**

## Repository

- Repository: `miyatayuuma/english-pwa`
- Starting `main` SHA: `15b7cfdf83df5db5ae4a72fe4260e0d1d9d43593`
- Starting `APP_VERSION`: `v5.98`
- Working branch: `feat/asr-08c-native-game-diagnostics`
- Runtime version after shared JavaScript changes: `v5.99`
- PR: pending
- Production grading and vocabulary/item data: unchanged

## Diagnostic coverage

|Field|Implemented|Verified|
|---|---|---|
|Native session / attempt correlation|Yes; distinct IDs, trace session, sequence, start-time game context|Controller/collector contract tests; Android runtime pending|
|N-best evidence|Yes; provider counts, retained alternatives, rank, confidence, segment and final state|Recognition and Android adapter tests; live Android pending|
|Selected candidate|Yes; source, transcript, rank, segment, authority and decision from actual grader result|Existing candidate tests and source-contract tests; game E2E pending|
|Vocabulary grading|Yes; actual TARGET / PARAPHRASE / MISS result, occurrence and rescue provenance|Full unit suite includes current `vocab:00139` production canonical tests|
|Cloze repair span|Yes; selected repair, offsets, source token spans, restart, completeness, negation and hidden targets|Cloze grader regression fixtures pass; live game trace pending|
|Correction state|Yes; Read/Vocabulary source, attempt count, result, completion and SRS skip|Correction unit coverage and source-contract checks; live game pending|
|SRS update result|Yes; actual update invocation, persistence result, before/candidate/after, review and streak|SRS observer tests verify successful and failed storage writes|
|Final UI score / highlight|Yes; displayed rate, level, token highlight state and authority|Source-contract check; rendered game trace pending|
|Debug-only gate|Yes; debug-only Android bridge plus launch Intent; no Web/local-storage/query enable path|Debug gate tests pass; compiled release verification pending CI|
|JSON export|Yes; raw export requires explicit copy, metadata-only redaction, clear and bounded memory|Collector/export unit tests pass|

The `native-gate.html` recognition harness remains separate. Game trace instrumentation observes the ordinary Recognition Controller, graders, UI commits and existing SRS writes; the collector does not grade or write learning state.

## Validation

- `npm ci`: PASS (101 packages installed)
- `npm test`: PASS for all executed tests — 455 passed, 0 failed, 85 skipped because the Playwright Chromium binary was unavailable
- Chromium browser regression: NOT RUN. Playwright browser download returned a truncated 0 MiB archive; the 85 browser tests therefore remain pending CI.
- `npm run speech:validate-td-cluster-before-to`: PASS
- `npm run vocab:check-derived`: PASS
- `npm run vocab:validate`: PASS
- JavaScript syntax checks: PASS
- `git diff --check`: PASS
- `npm run native:sync`: PASS; 112 runtime assets staged and Capacitor Android sync completed
- Local `assembleDebug`: BLOCKED because this environment's Java 17 installation has no Java compiler (`JAVA_COMPILER`); no Android SDK is installed locally
- Release isolation: static gate tests PASS; compiled release APK check pending CI
- Android real-device execution: NOT RUN; this is ASR-08D device acceptance work
- Privacy/logging: raw transcripts stay in bounded in-memory trace records and are copied only on explicit action; metadata-only export redacts transcript/content fields; native and JS diagnostics log summaries only; no persistent trace store or external upload was added

No production scoring defect was observed by the available automated tests. Real-game acceptance remains pending Android build/CI and ASR-08D execution on a Pixel.

## Pixel handoff

1. Install the debug APK built by CI: `adb install -r app-debug.apk`.
2. Launch the ordinary game shell in trace mode: `adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace true`.
3. Open Vocabulary, Read, Cloze, and Correction normally. In the floating `GAME TRACE` panel, turn Trace ON before each set of trials.
4. Use “全件JSONをコピー” for raw evidence or “伏字JSONをコピー” for metadata-only export. Compare each `final-ui-result-committed` and `srs-update-completed` event with the visible game result.
5. Turn the launch gate off with `adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace false`; the panel is removed and collection stops.
