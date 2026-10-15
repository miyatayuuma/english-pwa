# v5.113 Pixel acceptance readiness

**PIXEL ACCEPTANCE KIT READY / DEVICE_PENDING**

Audit date: 2026-10-15 (Asia/Tokyo). Physical acceptance has not been performed. This document supersedes no historical evidence: #323 retains its v5.99 report unchanged.

## Authority and boundaries

- Initial main: `f5fa6064761d4fcaf5c66214f3dbba4183ae03d5`; APP_VERSION `v5.113` in scripts/version.js.
- Branch: `test/pixel-v5113-acceptance-readiness`, created from that exact main.
- Final branch HEAD is the final commit in this report's PR (not the runtime/APK source SHA).
- #345, #347 and #348 are integrated in this main; no production JS/CSS, ASR rule, SRS algorithm, storage schema or教材 data changed here. APP_VERSION stays v5.113.
- PR #323: OPEN / DRAFT, head `6f287edff6fcc0628508106f0eed0de1267242c7`, v5.99 historical evidence only.
- PR #344: CLOSED / unmerged, head `6bae15beeb056d7575ba8dfd1b5b14a9bf80734e`; hidden-page acceptance NOT_VERIFIED. Branch not modified.
- Issue #210: OPEN; remains open with physical and hidden-page acceptance outstanding.

## Immediate physical access result

`command -v adb` returned no executable. Therefore `adb version` and `adb devices -l` could not run. **DEVICE_UNAVAILABLE / ADB_MISSING**. No repeated Pixel connection attempts, installation, microphone permission changes, real utterances or background observations were performed. This is host access unavailability, not an application defect. Model/API and usual user execution surface are NOT OBSERVED.

## Exact current APK provenance

|Field|Verified authority|
|---|---|
|Run|[Android 38704347368](https://github.com/miyatayuuma/english-pwa/actions/runs/38704347368), head f5fa6064761d4fcaf5c66214f3dbba4183ae03d5; conclusion success|
|Jobs|debug-build 116319921415 success; gate-a-emulator 116319921223 success|
|Artifact|english-pwa-android-debug / [11957099414](https://github.com/miyatayuuma/english-pwa/actions/runs/38704347368/artifacts/11957099414); 37,196,145 bytes; not expired at inspection|
|ZIP SHA-256|e2bdf54c6fd989bd5874120647e9b8a842f5b20c61e2879f51a008b5f7ad4d3a — locally downloaded and matched|
|APK member|app-debug.apk — sole artifact ZIP member, locally inspected|
|APK SHA-256|5209c8946aaa3e714cd86199f1c3f88d1b196a4bcb30c9d45e64535241238cad — locally calculated|
|Embedded runtime|assets/public/scripts/version.js equals pinned source exactly, v5.113; index.html and all three protected datasets equal pinned source bytes|
|Native versionName|Not used as JS version authority; no claim that native versionName equals v5.113|

Download URLs expire; use the stable run/artifact links and reverify the digest before installation. The kit verifier checks bytes, not APK signature/update compatibility. Never uninstall an existing app to bypass an installation/signature failure.

## Gate A on pinned runtime main

|Check|Result and evidence|
|---|---|
|Application Node + Chromium|[38704347421](https://github.com/miyatayuuma/english-pwa/actions/runs/38704347421), job 116319921203: 691 total, 689 PASS, 0 FAIL, 2 SKIP|
|Chromium boundary|Dedicated workflow installed Chromium and required REORDER/HOME_NAV/ISSUE210 browsers. Two contextual ASR browser checks explicitly SKIP (ASR-09C and ASR-09D); do not report zero skips or complete all-browser coverage|
|Vocabulary|[38704347371](https://github.com/miyatayuuma/english-pwa/actions/runs/38704347371) success; application speech/vocabulary validation step success|
|ASR authority|Application workflow validates td-cluster, 09B/C/D, 09A audit/generation; step success|
|Android Debug / Release / lintDebug|assembleDebug assembleRelease lintDebug step success in debug-build job above|
|Android Gate A|API 35 google_apis emulator; connectedDebugAndroidTest success, 5 completed, no failed/skipped tests observed in job log|
|Gate A result artifact|android-gate-a-results / 11957304793; ZIP digest 25f63e63094fb001df95d66e37015c2d60bb8c3de51af0099c3e3c6252e50957|

These are same-source-SHA CI results independently read from jobs/logs, not newly executed physical tests. No Android SDK/ADB available locally. Existing emulator/native privacy controls are Gate A only.

## Implemented kit and evidence contract

`tools/pixel-acceptance/README.md` is the executable operator handoff: source/APK checks, authorization boundaries, UI-01–UI-10 (both reload directions), fixed question count variants, D01–D14 with required subtrials, private Game Trace capture, read-only Study-log/SRS before/after/reload snapshots, triage and publication checks.

- `kit.py preflight`: bounded read-only calls, refuses unavailable/unauthorized/multiple devices and emulator, no serial output, no install/reset operations.
- `kit.py verify-apk`: pinned artifact hash/layout and embedded web/data byte authority.
- `kit.py sanitize`: allowlisted projection of existing Game Trace exports; no replacement collector. Unknown/nested/private strings dropped, identity/rule references hashed, numeric/boolean/finality/backend/grader events retained. No automatic acceptance decision.
- `authority.json`: exact v5.113 run/artifact/digests.
- `manifest.schema.json` / `manifest.template.json`: per-case/subtrial/surface manifest, nullable unknowns, PASS/FAIL/INCONCLUSIVE/NOT_RUN; template NOT_RUN. A schema-valid manifest is a structural check, not acceptance proof.
- Python tests invoked by Node application test discovery cover device refusal/privacy, real native/finality/decision shapes, identity mismatches, cumulative SRS count, unknown export rejection and tampered ZIP/embedded assets.

Important observability limits: Game Trace retains 40 attempts and 120 events per attempt; copy each trial promptly. Existing metadata export is not treated as public-safe. Study-log has no dedicated trace event; a separate private read-only snapshot and numeric reconciliation is mandatory. SRS cumulative counts must not be summed. Missing evidence is unknown, never zero/PASS.

Current fixtures verified in current production data: D01/03/04 vocab:00139 → E0112 offsets 0–41; D02/12 vocab:00437 → E0343 offsets 46–66. Runtime answers/activeOccurrence must still be captured privately on the tested device. No fixture substitutions or synthetic live evidence.

## Physical results

|Area|Status|
|---|---|
|Pixel model/API, WebView/Chrome, mic/provider|NOT OBSERVED|
|UI-01–UI-10 incl. reload both ways|NOT_RUN|
|D01–D14 and required subtrials|NOT_RUN|
|Gate B actual Native SpeechRecognizer|DEVICE_PENDING / NOT_RUN|
|Gate C live candidate/finality/grading/UI/SRS/Study-log reconciliation|DEVICE_PENDING / NOT_RUN|
|Background observation|NOT_VERIFIED|
|Full #344 BG-01–BG-16|NOT_VERIFIED; no substitution|

No physical defect reproduced; no speculative repair or defect issue. Provider TARGET absence must be separated from candidate/grader defects. Real callback duplication/end-never-arrives conditions cannot be claimed tested unless actually observed.

## Data safety and remaining operator work

Protected git blobs match the supplied authority and remain unchanged:

- data/vocabulary-v3.json: 91324d35b2db1911ece2cf3ff746409d321fe963
- data/items.json: ae2aca768b784199b77ac1cf8c0c5a80fd5725bb
- data/characters.json: 1d0c61711d763373e1f587ecde16ff9f07cb1a45

No real runtime data accessed/reset. No raw transcript/audio, private screenshot, raw device identifier or raw storage dump committed. Physical SRS/Study-log integrity remains unverified, not “safe by test”.

Next operator: authorize the specific Pixel and usual native/browser surface; verify/install exact current APK with permission and preserved data; collect environment; execute UI matrix and all D subtrials; reconcile private raw evidence and publish only reviewed safe manifest. If provider cannot produce required conditions, keep those subcases incomplete. #323 remains DRAFT and #210 OPEN. Hidden-page #344 remains NOT_VERIFIED independently.

## Local kit verification

- Python unit suite: 8/8 PASS; Node wrapper: 1/1 PASS.
- Full local Node discovery: 692 total, 563 PASS, 0 FAIL, 129 SKIP (local Chromium absent). Local skipped browser cases are not acceptance success. Same-runtime main browser CI evidence remains above; new PR CI must execute Chromium independently.
- td-cluster, ASR-09B/C/D, vocab:check-derived and vocab:validate executed locally with exit 0.
- Actual artifact verification and DEVICE_UNAVAILABLE preflight executed successfully.
- Independent reviewer inspected privacy, native/finality/event shapes and cumulative SRS semantics; first-review findings corrected before PR submission. PR review and relevant CI required before merge.
