# Android Gate A Game Trace readiness investigation

**Status:** `DIAGNOSTICS_COMPLETE / ROOT_CAUSE_OPEN` (until new instrumented Gate A evidence is reviewed)

**Investigation date:** 2026-10-13 UTC
**Repository:** `miyatayuuma/english-pwa`
**Baseline main:** `624e534baecb9dbcca6549e17eb0a12661259248`
**Baseline APP_VERSION:** `v5.104`
**Production blobs at baseline:** Vocabulary `91324d35b2db1911ece2cf3ff746409d321fe963`; Items `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`

## Historical evidence

The two first-attempt failures have the same test, assertion, and incomplete diagnostic shape. The failure artifacts contained Android HTML reports and full logcat captures; they did not contain JUnit XML. Both same-SHA retry attempts passed all five Gate A tests with zero failures and skips.

| Incident | Workflow / attempt | SHA | Gate A job | Artifact | Result |
|---|---|---|---|---|---|
| ASR-09C follow-up | [run 38254661688, attempt 1](https://github.com/miyatayuuma/english-pwa/actions/runs/38254661688) | `1e613b1020d77031e1d7f59ed342c416867da383` | `114829511514` | `11749601741` (`android-gate-a-results`) | 1 failing test: `NativeShellGateTest.d_debugValidationUsesActualTargetAuthority` |
| ASR-09C same-SHA retry | [run 38254661688, attempt 2](https://github.com/miyatayuuma/english-pwa/actions/runs/38254661688/attempts/2) | same SHA | `115080450347` | `11782782385` (`android-gate-a-results`) | 5 pass, 0 fail, 0 skip |
| ASR-09D follow-up | [run 38357063402, attempt 1](https://github.com/miyatayuuma/english-pwa/actions/runs/38357063402) | `624e534baecb9dbcca6549e17eb0a12661259248` | `115162306577` | `11793345986` (`android-gate-a-results`) | 1 failing test: same test |
| ASR-09D same-SHA retry | [run 38357063402, attempt 2](https://github.com/miyatayuuma/english-pwa/actions/runs/38357063402/attempts/2) | same SHA | `115164964171` | `11793252100` (`android-gate-a-results`) | 5 pass, 0 fail, 0 skip |

The failed assertion was `!!document.querySelector('#app') && !!document.querySelector('#nativeGameTracePanel')`; the only attached diagnostic was `diagnostics="{}"`. It failed in `NativeShellGateTest.java:112` (incident A) and `:115` (incident B). It did not distinguish navigation, capability, initialization, or panel attachment.

Logcat narrows the path without proving the final cause:

- Both failed attempts logged a `NativeGameTrace.openGameTrace` bridge invocation. Both then loaded `https://localhost/index.html` and made a native `getCapability` call. This rules out a missing button click or an immediate plugin-call/navigation rejection as the sole explanation.
- The old captures did not record the `getCapability` result, the launch flag value, JS readiness state, or whether the panel had been created and remained connected. No old evidence separates capability-state loss from initialization ordering or later DOM replacement.
- The logcat captures report WebView `124.0.6367.219` on API 35 emulator `emulator-5554 - 15`; the workflow configured Google APIs / x86_64, Node `22.23.3`, Temurin Java `21.0.12`, and Gradle `8.14.3`. The two attempts used the same recorded configuration.
- WebView renderer-process crash messages occur in both failure and retry artifacts (A: 3 in each; B: 4 in each). Their presence does not distinguish fail from pass. The `adb: device offline`, emulator-console, and bad-color-buffer messages likewise occur in the passing retries, so they are not sufficient cause evidence.
- Missing `/data/srs.json` asset messages also appear in failing and passing captures. The searched logcat had no `ERROR:CONSOLE`, uncaught TypeError/ReferenceError/SyntaxError, or module-load failure matching the trace path. Absence from these old logs is not proof that no JS exception occurred.

## Root-cause classification

“Reproduced” below refers to the historical first-attempt failure in a suite run, followed by a pass on retry at the same SHA. The archived tests ran the suite order (the target was the final `NativeShellGateTest` method); they do not establish whether running the target alone or after an Activity restart changes the outcome.

| ID | Supporting evidence | Contrary evidence / reproduction | Assessment and uncertainty |
|---|---|---|---|
| H1 Button handler not executed | Old reports lacked a button-stage signal. | Both failure logs record the `openGameTrace` plugin invocation. | **Not supported as the sole cause.** Button click and handler path ran; exact JS click timestamp was not retained. |
| H2 Bridge/plugin call failed | Old logs did not retain bridge result values. | Plugin invocation is followed by app URL load and `getCapability`; no rejection appears in captured logcat. | **Immediate bridge failure unlikely.** Detailed JS/native resolution and reject reason were not retained. |
| H3 MainActivity pre-navigation gate mismatch | No old native state snapshot. | The validation-page request led to `/index.html`; baseline code sets the launch flag before `loadUrl`. | **Source/navigation gate likely passed.** Historical run did not log the actual flag value. |
| H4 WebView navigation/document readiness | The old assertion combined `#app` and panel presence and had no `readyState`. | `/index.html` and app modules loaded before timeout. | **Navigation began and app scripts loaded; document readiness is unproven.** No direct readyState or navigation lifecycle evidence. |
| H5 `nativeSpeechGameTraceLaunch` mismatch | Flag value was absent from old reports. | Baseline MainActivity enables it synchronously before loading the app; capability call follows. | **Unresolved.** The native state was not exposed in those runs. |
| H6 Game Trace capability resolution | Native capability method was called. | No recorded return value or exception. | **Unresolved.** Need `available` and `enabled` result plus native launch flag. |
| H7 Game Trace initialization ordering | Bootstrap launches `initializeGameTracePanel()` and `initApp()` asynchronously; old test waited only for DOM presence. | Historical captures show neither a rejected capability nor init error; they also lack terminal init state. | **Plausible, unconfirmed.** Need ordered init and app-bootstrap evidence. |
| H8 Panel detached after creation | The final combined assertion saw no panel. | The old report never recorded a successful create or an `isConnected` value. | **Unresolved.** Panel creation and post-create DOM lifetime were not observed. |
| H9 JavaScript/module error | Old setup swallowed the initializer rejection and did not include window error state. | No matching console exception/module-load message was found in the captured logcat. | **Not evidenced, not excluded.** Old error capture was incomplete. |
| H10 Emulator / WebView / runner instability | Renderer crash and emulator/ADB warnings appear in run logs. | The same renderer-crash counts and warning classes are present in same-SHA PASS retries on the same WebView/API setup. | **Not isolated as cause.** The warnings may be incidental; crash timing/renderer identity needs stage correlation. |
| H11 Instrumentation observation defect | The failing diagnostic was `{}` and the conjunction could not identify its unmet term. | This explains poor diagnosis, not why the panel was absent. | **Confirmed diagnostic defect.** The assertion remained strict but observed too little state. |

**Classification:** `ROOT_CAUSE_OPEN`. Historical evidence confirms that the navigation request reached the app and that the capability method was invoked. It does not show the capability response, terminal initializer state, or panel connection state at failure. A production lifecycle race is not claimed.

## Changes in this branch

- Added a bounded, metadata-only Game Trace initialization reporter. It records bridge resolution, capability booleans, panel creation/connection, terminal initialization, and error type. It never stores audio, recognized text, or error messages and is inactive unless `Capacitor.DEBUG === true`.
- Instrumented the debug Validation Page click/plugin stages, handler availability, and page readiness. Events use `performance.now()` within each document; that clock is not compared numerically with Android timestamps.
- Added a debug-only native diagnostics method and bounded Activity event history using `SystemClock.elapsedRealtimeNanos()`. It records fixed stage names, sanitized local page identity, document progress, lifecycle, launch flag, and allow/deny reason; no speech or trace payload is collected. Android elapsed-realtime values are not directly compared with JS `performance.now()`.
- Replaced the target test’s empty failure context with five explicit readiness stages and a snapshot of page, bridge, JS navigation/init, capability, and native state. Native state can still be collected if WebView JS evaluation times out. Stage pass/failure records are written to logcat.
- Expanded the existing Gate A debug-validation test to execute 10 Validation Page → Game Trace → Validation Page cycles, with two fresh Activity relaunches. Every cycle requires 14 cases, native/plugin resolution, completed app document, enabled capability, connected panel with `GAME TRACE`, return navigation, cleared launch flag, and no panel on the validation page. Assertions remain fail-closed.
- No production speech, grading, Vocabulary, Items, SRS, or Game Trace semantics were changed. `NativeGameTracePlugin` remains in `src/debug`; native registration and all diagnostics are guarded by `BuildConfig.DEBUG`; the release UI does not gain the validation page.
- Runtime JS changed, so APP_VERSION moved from `v5.104` to `v5.105`; `scripts/version.js`, `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, and cache references are synchronized. `npm run native:sync` stages 117 runtime assets successfully.

## Validation

### Local results before PR CI

| Check | Result |
|---|---|
| `npm test` | 595 tests; 508 pass, 0 fail, 87 skipped because Chromium is unavailable in this local environment. |
| `npm run speech:validate-td-cluster-before-to` | PASS |
| `npm run speech:validate-asr-09b` | PASS (33 approved pairs / 66 directions) |
| `npm run speech:validate-asr-09c` | PASS |
| `npm run speech:validate-asr-09d` | PASS; confirms APP_VERSION `v5.105` |
| `npm run vocab:check-derived` | PASS |
| `npm run vocab:validate` | PASS |
| ASR-09A audit validator and deterministic `--check` | PASS |
| `npm run native:sync` | PASS; 117 assets staged and Capacitor sync completed |
| `git diff --check` | PASS |
| Local Android build / emulator | Not completed: available local Java 17 runtime lacks `JAVA_COMPILER`; CI Java 21 and emulator jobs are the required verification. |
| Browser regression | Local Chromium tests skipped; the required Playwright Chromium CI job is authoritative. |
| PR CI, repeated emulator acceptance | Pending PR creation and CI. |

### Production authority immutability

Baseline and working tree retain Vocabulary blob `91324d35b2db1911ece2cf3ff746409d321fe963` and Items blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. No authority source data, ASR-09A audit artifact, ASR-09B fixed rules, ASR-09C/09D subset, TARGET/PARAPHRASE/MISS rules, SRS behavior, or Pixel ASR-08D D01–D14 implementation was modified.

### PR and post-merge evidence

(To be completed with actual PR number/URL, head and merge SHAs, first-attempt Gate A result, check names/results, final main SHA, version and blob hashes, and ASR-08D status. A retry pass will be reported separately from a first-attempt pass.)

## Residual risks

- Root cause remains unconfirmed until the newly captured failed-stage state or repeated successful evidence identifies the transition, capability, initialization, or panel-lifetime boundary.
- The debug test exercises 10 full navigation cycles and two fresh Activity relaunches in one Gate A test invocation; this is not a mathematical proof that future flakiness is impossible and does not replace independent CI emulator runs.
- Local Android build/emulator and browser tests could not run in this environment. Required GitHub Actions results must be recorded before merge.
- Pixel ASR-08D remains a separate open hardware acceptance item; this change does not close it.
