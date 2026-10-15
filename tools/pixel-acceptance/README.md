# Pixel v5.113 acceptance operator handoff

Status: **PIXEL ACCEPTANCE KIT READY / DEVICE_PENDING**. This kit does not install, clear, stop, launch, grant permissions, grade speech, or modify storage. Run from a clean checkout with Python 3 and git. For APK verification, the pinned source object must be present; in a shallow clone run `git fetch origin f5fa6064761d4fcaf5c66214f3dbba4183ae03d5` first. Unit tests build an isolated synthetic source repository and need no checkout history. No ADB on the Work host: do not retry connection here.

## 1. Identify the exact build

The pinned authority is `authority.json`. Verify Actions run [38704347368](https://github.com/miyatayuuma/english-pwa/actions/runs/38704347368), head SHA `f5fa6064761d4fcaf5c66214f3dbba4183ae03d5`, both successful Android jobs, artifact `english-pwa-android-debug` / `11957099414`. Download that artifact using GitHub's authenticated UI. Never use the v5.99 artifact in #323. ZIP digest and APK digest are separate.

```bash
python3 -B tools/pixel-acceptance/kit.py verify-apk /private/download/artifact.zip
python3 -B tools/pixel-acceptance/kit.py preflight
```

The verifier checks the ZIP digest/member name and compares embedded version/index and all three protected datasets with exact pinned git source bytes. `scripts/version.js` is the JS authority; Android `versionName` is not APP_VERSION. Save output privately. Extraction, if needed, must go to private operator storage outside the checkout. Confirm APK digest against authority.json immediately before installation. APK signatures/update compatibility must be checked on the operator host; do not uninstall to bypass signature failure.

## 2. Authorization and environment

Connect only the Pixel the user explicitly authorizes. Preflight reads only `adb devices` and model/API properties; it never prints the serial. It refuses multiple/unauthorized devices and emulator transports/properties. Detection alone is not permission to install. Obtain explicit permission before each previously unauthorized install or permission change. Record user approval privately. Do not run adb install, force-stop, launch debug extras, or change permissions from an unapproved host.

After approval, operator commands (not run by this kit):

```bash
adb install -r /private/download/app-debug.apk
adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGameTrace true
```

Never use uninstall, `pm clear`, `pm grant`, reset controls, or a clean-data test prerequisite. If update fails, stop and preserve existing data. `-r` retains app data but real accepted answers normally change SRS. Record baseline before any gameplay.

Record model, Android/API, WebView and Chrome versions from device settings, JS v5.113 shown by app, native APK vs Browser PWA, width/height in px and CSS viewport, orientation, mic permission, recognizer/provider if exposed (otherwise UNKNOWN), network and offline status. Omit serial, fingerprint, account names and device identifiers. Prioritize the user's usual surface; do not infer it. Use separate records for browser and native. Native ASR PASS requires actual native backend/session/provider evidence; browser UI success does not establish native ASR acceptance.

## 3. UI checklist

All cases currently NOT_RUN on Pixel. Record specified count, available pool, started count and shortfall separately. Perform both Read/Compose directions; each uses a fresh attempt.

|ID|Operator action|Acceptance|
|---|---|---|
|UI-01|Open Home, inspect character and three primary actions, open details|Visible and reachable without unintended start|
|UI-02|Choose Read/Cloze, details, submit|Only applicable controls; correct mode starts|
|UI-03|Choose Compose, details, submit|No irrelevant Shadowing controls; correct mode starts|
|UI-04|Choose Vocabulary; switch card kind; start independently|Vocabulary controls; existing 12-card contract; no sentence session|
|UI-05|In details: Read → Compose → Vocabulary → Read|Controls follow mode; hidden filters inactive; no start before submit|
|UI-06|Inspect sentence counts and start each applicable count|Auto / 5 / 8 / 12 / 20 / 30 / 50; no arbitrary input|
|UI-07|Select existing narrow filters producing fewer candidates than requested|Requested − started = shortfall; started equals valid available pool|
|UI-08|Manual list in chosen order; over-limit, short list and zero separately|Preserve order, limit; no refill; zero cannot start|
|UI-09|Back, close, Android Back, reopen separately|No unintended start or abandoned draft leak; settings behavior matches design #346|
|UI-10a|Read → Compose with reload handoff|Boot completed then exactly one start; count correct; learning view retained|
|UI-10b|Compose → Read with reload handoff; reload again afterwards|Same; consumed handoff never starts again|

Record card/session identity before/after, UI count, and session-start evidence. If exactly-once cannot be observed, record INCONCLUSIVE instead of inferring it from one screenshot.

## 4. ASR D01–D14, preserved authority

Definitions: [old report at PR #323 head](https://github.com/miyatayuuma/english-pwa/blob/6f287edff6fcc0628508106f0eed0de1267242c7/tests/asr-08d-pixel-acceptance-report.md), current `android/app/src/debug/assets/public/native-gate-cases.js`. The validation page is guidance only: execute ordinary gameplay. Do not substitute injected candidates or convenient new fixture IDs for live acceptance.

Current source fixtures: D01/03/04 `vocab:00139` (construction; occurrence E0112, 0–41); D02/12 `vocab:00437` (expression; occurrence E0343, 46–66). Read current canonical/paraphrases from `data/vocabulary-v3.json`; capture actual runtime answers and activeOccurrence privately before speaking. Static canonical alone is not runtime grading authority. If the normal game cannot reach a fixture, mark blocked/INCONCLUSIVE; do not alter production data or history to force it.

|ID|Required separate trials|Expected observation|
|---|---|---|
|D01|Complete TARGET, manual stop; repeat fresh attempt|Final TARGET, rank 0 vs selected candidate, one normal SRS write|
|D02|Real lower N-best TARGET (fixture above)|0-based rank >0, exact TARGET rescue; no provider TARGET → PROVIDER_RECOGNITION_FAILURE or INCONCLUSIVE|
|D03|Omit key word and whole chunk|MISS; do not mistake provider restoration for grader error|
|D04|Swap TARGET order|MISS unless exact current authority explicitly permits form|
|D05|Correct full Read, manual and automatic termination|Score/rate/highlights/UI/SRS agree|
|D06|Content word omission and meaning-changing utterance|Existing score reduction/UI/storage agree|
|D07|Restart, repetition, then complete corrected Cloze|Repair spans/completeness/hidden TARGET/score/highlights agree|
|D08|Incomplete last repair, including ASR-08A omission shape|FAIL; abandoned earlier text cannot fill final missing spans|
|D09|Hidden TARGET omission; middle omission; end omission|Each FAIL with corresponding missing/blocking spans|
|D10|Omit not/never from applicable sentence|FAIL; negation integrity observed|
|D11|Read and Vocabulary: initial MISS → wrong correction → correct correction|Practice transitions complete; no extra SRS writes from corrections|
|D12|Manual, auto, delayed final, multi-segment/interim, cancel, error; separate attempts|Only normal complete final evidence can grade; no stale result on next card|
|D13|Accepted answer, finalized MISS, retry, duplicate callback guard, reload persistence|At most one normal update per attempt, persisted before/after state agrees|
|D14|Ordinary launch, debug launch, Trace OFF/ON, metadata copy, release isolation|No ordinary/release panel, OFF stops collection; no public raw export|

D12 negative controls: interim-only, pending, cancelled, technical error, incomplete evidence → NO GRADE and no result write; stale callback cannot affect next card. Positive final TARGET and finalized MISS grade normally. D13 duplicate callback behavior needs observed actual duplicate evidence; if device/provider does not produce it, mark that subcase NOT_RUN/INCONCLUSIVE. Automated mocks establish only Gate A. Likewise inability to produce delayed/error/interim-only conditions must remain explicit gaps. Case-level PASS requires every required subtrial PASS on the exact build/surface.

## 5. Existing GAME TRACE and live reconciliation

With approved debug launch, confirm ordinary app panel initially Trace OFF; turn ON immediately before a trial. Copy each attempt promptly: collector retains only 40 attempts and 120 events/attempt. Missing/pruned events or inability to prove ordering → INCONCLUSIVE. Stop capture after collection. Raw and metadata exports both stay PRIVATE until projected: existing metadata redaction is not a complete public privacy guarantee.

```bash
python3 -B tools/pixel-acceptance/kit.py sanitize /private/traces/case.json > /private/evidence/case.safe.json
```

Projection allows only known event types, numeric fields, booleans and enum values. Attempt IDs become local aliases; authority/rule/decision references become hashes. Unknown/nested fields, transcripts, candidate strings, raw context, timestamps, device serial and arbitrary messages are dropped. It never decides PASS. Keep a private mapping of safe attempt aliases to original attempt/trace/native session IDs, actual candidates, ranks and semantic authorities. Safe output loses detail by design; review private source before publishing any manifest.

For each trial reconcile, in event sequence order:

1. Actual provider results and 0-based ranks (not assumed intended utterance).
2. Finality, terminal completion, attempt/session/card identities; native backend proof.
3. Evaluated/selected candidate and current equivalence/paraphrase authority.
4. Grader decision, score and final UI result/highlight.
5. SRS invocation/persistence and before/candidate/after state. `persistenceWriteCount` is cumulative per attempt: use final/max, never sum repeated events. Missing is UNKNOWN, never zero.
6. Study-log before/after delta and persisted read after reload.

Study-log has no dedicated current Game Trace event. Use approved remote Chrome DevTools to READ `localStorage.getItem('studyLogV1')` and `localStorage.getItem('itemLevelV1')` before/after each trial and after reload. Save privately with case and attempt mapping; do not paste whole history into GitHub. Read-only expressions only; do not inject storage interception, setters, clearing or synthetic callbacks. Record numeric deltas and reviewer outcome in the manifest. If native WebView inspection is unavailable, leave Study-log NOT_OBSERVED and Gate C INCONCLUSIVE. Trace SRS events alone do not prove Study-log integrity.

No returned TARGET: classify provider failure/inconclusive; returned finalized valid TARGET but selection/grade mismatch: isolate candidate/grader layer. UI-only mismatch and write/persistence mismatch are distinct. Preserve raw evidence privately, minimize reproduction, and open a separate defect issue with severity/affected version and sanitized references. Do not modify production in this kit.

## 6. Background, privacy, handoff

Only with a real authorized Pixel: Home/app switch/resume during learning, record real visibility/lifecycle events, recognition stop, resumed state and duplicate grade/write counts. If events are not observed → NOT_VERIFIED. This limited observation never replaces #344 BG-01–BG-16; BG-08 requires actual provider-end absence reproduction. Do not reopen/merge #344.

Use `manifest.template.json` per surface and trial and validate against `manifest.schema.json` with a Draft 2020-12 validator. Keep all required cases, including missing cases. Raw voice, screenshots with personal data, raw transcripts, raw logcat, storage dumps, original session IDs and serials must not enter git or public issues. Publish only reviewed safe JSON plus manifest; evidence paths are relative reviewed public paths, never private device paths.

Outcome vocabulary: PASS (all evidence reconciled), FAIL (reproduced mismatch), INCONCLUSIVE (insufficient/provided wrong evidence), NOT_RUN (not executed). `PROVIDER_RECOGNITION_FAILURE` is a triage classification, not a grader defect. Gate B/C require physical evidence, never emulator/mocked PASS. Keep #323 DRAFT / DEVICE_PENDING and #210 OPEN until acceptance is complete; frozen #344 remains NOT_VERIFIED.

Schema constraints require the exact APK hash only for Native surface, and reject an unobserved PASS and require native attempt/SRS/Study-log evidence fields for D01–D13 PASS. This still does not prove semantics: a human must reconcile every required subtrial against private source. Browser UI results are recorded separately, not promoted to native ASR PASS.

ASR PASS records require observed finality and completion state. A graded TARGET/MISS/PARAPHRASE/PASS/FAIL or lexical correction outcome requires final evidence, terminal completion and recognitionComplete=true. Successful negative-control acceptance may instead record interim/none plus pending/cancelled/error and NO_GRADE; do not turn a NO_GRADE control into a lexical MISS.
