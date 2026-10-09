# ASR-08D Pixel Production Acceptance

Status: OPEN — Gate A verified; Pixel Gate B and live evidence reconciliation Gate C are NOT RUN.

## Audit identity

- Repository: miyatayuuma/english-pwa
- Tested main SHA: 32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8
- APP_VERSION: v5.99
- Main comparison at audit start: identical to the supplied baseline SHA; no later main commit was present.
- Audit date: 2026-10-09 (Asia/Tokyo)
- Production code, grading rules, Vocabulary data, and semantic authority were not changed.
- Device access: no repository checkout, adb executable, or connected Android device was available in this Work environment. No Pixel install or game attempt was made.

## Environment and APK provenance

|Field|Observed value|
|---|---|
|Device manufacturer / model|NOT AVAILABLE — no device connected|
|Android version / API / fingerprint|NOT OBSERVED|
|Installed APK version|NOT INSTALLED|
|Recognizer provider / language|NOT OBSERVED|
|Microphone permission|NOT OBSERVED|
|Network / offline state|NOT OBSERVED|
|Source commit|32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8|
|Source app version|v5.99|
|Actions run|[Android shell build #37932956844](https://github.com/miyatayuuma/english-pwa/actions/runs/37932956844)|
|Artifact|english-pwa-android-debug; artifact ID 11617237848|
|Artifact source|GitHub reports head SHA 32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8|
|Artifact metadata|37,161,611 bytes; digest sha256:ef076300c8704f75d970db7c21db3b9eb54b65420937950c9a67a2eba6da3da9|
|APK output configured by workflow|android/app/build/outputs/apk/debug/app-debug.apk|
|APK archive entry / APK SHA-256|NOT LOCALLY VERIFIED|

The workflow configuration records the APK output path and uploads it under the stated artifact name. GitHub artifact metadata ties the ZIP to the tested SHA. The artifact download operation returned a file reference, but the local shell could not reach its download proxy, so the ZIP could not be unpacked and the APK filename/layout and individual APK SHA-256 were not independently verified here. Before installation, download the artifact from the run page, verify the ZIP digest above, inspect its entries, and record the APK SHA-256.

## Gate A — automated verification

|Check|Result on tested SHA|Evidence|
|---|---|---|
|Application tests, including browser tests|PASS — 540 passed, 0 failed, 0 skipped|[Run #37932956808](https://github.com/miyatayuuma/english-pwa/actions/runs/37932956808); Chromium install and REORDER_REQUIRE_BROWSER=1 were configured|
|Chromium regression|PASS within the 540-test run; no skips|Same Application tests run; 85 browser cases were the established regression set|
|Vocabulary derived and source validation|PASS|[Run #37932956821](https://github.com/miyatayuuma/english-pwa/actions/runs/37932956821); check-derived and vocab-validate steps succeeded|
|Android debug/release build and lintDebug|PASS|[Run #37932956844](https://github.com/miyatayuuma/english-pwa/actions/runs/37932956844); assembleDebug, assembleRelease, lintDebug succeeded|
|Android Gate-A emulator|PASS — 5/5 tests, 0 skipped, 0 failed|Same Android run; API 35 Google APIs emulator; connectedDebugAndroidTest|
|Debug-only trace gate and release isolation|PASS in static tests and release build|nativeGameTraceGate tests are in the 540-test run; release build succeeded|
|ASR-08C schema, collector, SRS observer tests|PASS in application test run|The relevant trace/collector/SRS suites are included in the same-SHA 540-test run|
|speech:validate-td-cluster-before-to|Prior PASS recorded by ASR-08C report; not rerun at this exact merge SHA in this environment|[ASR-08C report](https://github.com/miyatayuuma/english-pwa/blob/32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8/tests/asr-08c-verification-report.md)|

Note: the separate vocabulary workflow also runs npm test without installing Chromium and reports 455 passed / 0 failed / 85 skipped. Those skips are not counted as browser success. Browser acceptance is based on the dedicated Application tests run above, which installed Chromium, required the browser, and completed 540/540 with no skips.

## Gate B — Pixel real-device execution

Result: NOT RUN. There was no ADB executable or connected Pixel in this environment. No actual microphone audio, system SpeechRecognizer response, ordinary-game trace, or device environment record exists.

## Test case matrix

All rows below are real-device acceptance cases. They remain NOT RUN; automated fixtures are not substituted for Pixel evidence.

|ID|Mode / scenario|Required observation|Gate B / C|
|---|---|---|---|
|D01|Vocabulary: current vocab:00139 canonical, complete utterance, manual stop; repeat with a fresh attempt|Current production canonical/answers/activeOccurrence; raw rank 0; TARGET decision; one UI commit and one appropriate SRS write|NOT RUN|
|D02|Vocabulary: exact TARGET appears only at a lower provider N-best rank|Returned candidate count/ranks, selected candidate, strict TARGET authority, TARGET rescue; do not synthesize candidates|NOT RUN|
|D03|Vocabulary: omit a key word or complete target chunk|MISS and no false TARGET; distinguish provider omission from grader miss|NOT RUN|
|D04|Vocabulary: change TARGET word order|MISS unless current authority explicitly permits the observed form|NOT RUN|
|D05|Read: correct full sentence, manual/automatic terminal|Final score, PASS/FAIL, displayed rate, highlights, learning level, and persisted SRS agree|NOT RUN|
|D06|Read: omit a content word or use meaning-changing speech|Normal Read score reduction and matching final highlight/UI|NOT RUN|
|D07|Cloze: full reproduction with a restart, repetition, or corrected phrase|Selected repair span/source spans, completeness, hidden TARGET result, score and highlight agree; valid self-correction passes|NOT RUN|
|D08|Cloze: incomplete final repair, including omission-shaped equivalent of the ASR-08A regression|FAIL; earlier abandoned text must not fill missing final spans|NOT RUN|
|D09|Cloze: omit hidden TARGET or an important middle/end span|FAIL; missing/blocking spans match the final repair|NOT RUN|
|D10|Cloze: omit negation|FAIL; negation preservation and final UI highlight agree|NOT RUN|
|D11|Read and Vocabulary Correction: trigger MISS, try an incorrect repair, then correct repair|Correction transitions and attempts are traced; correct repair completes; correction creates no additional SRS write|NOT RUN|
|D12|Terminal lifecycle: manual stop, auto-stop, delayed final, multiple segments/interim, cancel and recognition error|No grade before terminal; one terminal decision/write maximum; stale callbacks do not affect next card; technical failure is not a lexical MISS|NOT RUN|
|D13|SRS persistence: accepted answer, confirmed miss, retry, and duplicate-callback guard|Attempted/skipped reason, invocation count, persistence result and before/candidate/after state reconcile with UI; no duplicate write|NOT RUN|
|D14|Privacy/debug gate: trace OFF, ordinary launch, explicit debug launch, metadata export, release isolation|Panel only with debug launch capability; OFF stops capture; metadata export redacts transcript; memory-only/no upload|NOT RUN on Pixel; Gate-A static/release checks PASS|

## Gate C — diagnostic evidence manifest

No Pixel gameplay was performed, therefore no attempt IDs, trace session IDs, sanitized trace files, transcripts, game outcomes, or SRS events were collected. No raw speech data was created or committed.

|Case IDs|Attempt ID(s)|Trace session ID|Sanitized evidence reference|Recognition / grade / UI / SRS reconciliation|
|---|---|---|---|
|D01–D14|None|None|None|NOT RUN — requires Pixel game traces|

## Device handoff procedure

1. Open the Android Actions run above and download the english-pwa-android-debug artifact. Verify the ZIP with sha256sum against the recorded GitHub artifact digest, inspect it with unzip -l, extract it, identify the APK path, and calculate sha256sum for that APK. Confirm it is the run whose head SHA is 32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8 before installing.
2. Record device details without collecting a unique device serial:

        adb devices -l
        adb shell getprop ro.product.manufacturer
        adb shell getprop ro.product.model
        adb shell getprop ro.build.version.release
        adb shell getprop ro.build.version.sdk
        adb shell getprop ro.build.fingerprint

3. Install without clearing app data or resetting learning history:

        adb install -r /actual/path/to/app-debug.apk
        adb shell am force-stop com.miyatayuuma.englishpwa
        adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace true

4. In the ordinary game shell, confirm the GAME TRACE panel is available and initially says Trace OFF. Turn it ON. Play normally; do not use native-gate.html as a substitute. Capture the recognizer/provider and language only if the app/device exposes them; otherwise record unknown. Record microphone permission and whether the device is online or offline.
5. For each case, record the case ID, date/time, card/item and entry IDs, actual intended utterance, attempt ID, traceSessionId, nativeSessionId, terminal/stop reason, candidate ranks/count, chosen candidate and provenance, grader result, UI commit/highlight, correction state, SRS invocation/persistence and before/candidate/after state. Use a distinct attempt for repeats. For D01, read canonical, answers, and activeOccurrence from the production data in the tested build.
6. Copy the latest trace after each attempt. Keep any raw transcript export private on the test device/operator storage; never commit it or paste it into a public issue, PR, or Actions log. Commit only a sanitized manifest with transcript/sentence fields removed or redacted.
7. If no exact TARGET appears in any recognizer candidate, classify that trial as Provider Recognition Failure or INCONCLUSIVE for N-best rescue; it is not evidence of a grader false negative. If TARGET exists at a lower rank but is not selected, investigate candidate selection. If the selected candidate is valid but grading differs, capture rule/authority and classify the grader/UI/SRS layer separately.
8. Do not clear app data. Ordinary confirmed Vocabulary/Read outcomes can change the tested card’s learning state; record the before and after values. Correction should produce no additional SRS write. Stop and preserve evidence if a critical stop condition in the ASR-08D task is reproduced.
9. Verify privacy behavior: launch without the extra and confirm no GAME TRACE panel; with the extra, leave Trace OFF and confirm capture stops; then ON and explicitly copy a trace. Confirm metadata-only export redacts sentence/transcript content. The release isolation has Gate-A evidence, but do not label the Pixel runtime privacy checks complete until performed.

## Defects and unresolved coverage

- No production defect was demonstrated by the available automated results. This is not evidence that Pixel behavior is defect-free.
- No defect ticket is filed because Gate B supplied no reproducible device evidence.
- Unresolved: all Pixel Vocabulary, Read, Cloze, Correction, terminal and SRS acceptance; device/provider identity; APK member layout and APK SHA-256; live trace reconciliation.
- Deferred candidates lack and is / 's remain deferred and were not implemented or adjudicated by this audit.
- No production grading, Vocabulary, semantic-authority, or ASR equivalence changes were made.

## Final decision

ASR-08D: OPEN. ASR-08 Production Acceptance: OPEN.

Gate A passes on main SHA 32ceaacbdfaf25f9f7cb8791dc33c4fb15b2d1a8 / v5.99. Gate B and Gate C are not run because a Pixel/ADB execution surface is unavailable here. No closure claim is made. Complete D01–D14 on the Pixel, add only sanitized evidence, resolve any critical mismatch, and rerun affected cases on the exact verified APK before changing this decision.