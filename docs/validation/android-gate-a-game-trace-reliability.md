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
| H1 Button handler not executed | Old reports lacked a button-stage signal. | Both historical failure logs record the `openGameTrace` invocation; all three new runs passed Stage 2 before navigation. | **Not supported as the sole cause.** The button path ran. |
| H2 Bridge/plugin call failed | Old logs did not retain bridge results. | In the new failure, native request, authorization, WebView load request, and `openGameTrace()` resolution all occurred. | **Not supported for the reproduced failure's navigation request.** The later initializer capability call remains unobserved at the native dispatch boundary. |
| H3 MainActivity pre-navigation gate mismatch | Historical runs lacked a native state snapshot. | New failure passed Stage 3 native authorization; snapshot showed the app URL and launch flag enabled. | **Not supported for the reproduced failure.** The validation-page source gate and app navigation completed. |
| H4 WebView navigation/document readiness | Old assertion combined `#app` and panel presence without `readyState`. | New failure snapshot showed `/index.html`, `document.readyState=complete`, and `#app` present. | **Not supported for the reproduced failure.** Navigation and app document readiness completed before Stage 4 stalled. |
| H5 `nativeSpeechGameTraceLaunch` mismatch | Flag value was absent from historical reports. | New failure snapshot showed `launchEnabled=true`; its independent capability read showed `available=true, enabled=true`. | **Not supported by this failure snapshot.** The unresolved initializer request still leaves one capability call's exact response unknown. |
| H6 Game Trace capability resolution | In the third independent Gate A execution, the initializer stopped after `native-bridge-resolved`; the failure snapshot's separate `getCapability()` request resolved `{available:true, enabled:true}`. | The separate request proves the capability can resolve, but this commit did not mark the initializer's native request or native response. | **Partially localized, unresolved.** The initializer's own capability promise remained nonterminal; whether the call was dispatched or its reply was lost was not observed. |
| H7 Game Trace initialization ordering | Navigation and document readiness passed; cycles 1–3 passed, then Stage 4 stayed nonterminal after a fresh Activity relaunch following cycle 3. The app bootstrap and panel initialization start concurrently. | Two other independent runs passed all 10 cycles, including fresh Activity relaunches after cycles 3 and 6. | **Plausible, unconfirmed.** The failure followed a fresh Activity relaunch once, but that condition alone did not reproduce it. This commit lacked app-bootstrap timestamps. |
| H8 Panel detached after creation | Historical assertion saw no panel. | In the new failure, the initializer had not recorded capability resolution or panel creation. | **Not supported for the reproduced failure.** No evidence shows a panel was created and then detached. |
| H9 JavaScript/module error | Old setup swallowed the initializer rejection and did not include window error state. | No matching console exception/module-load message was found in the captured logcat. | **Not evidenced, not excluded.** Old error capture was incomplete. |
| H10 Emulator / WebView / runner instability | The new failure occurred on an API 35 GitHub Actions emulator. | Pass and fail jobs all had emulator-console and emulator-configuration warnings. The second pass had 5 renderer-crash messages; the failure had 4. Both had WebView `124.0.6367.219`; the failure had no matching `ERROR:CONSOLE` or uncaught JS exception. | **Not isolated as cause.** Warning classes and renderer crashes also occurred in a pass and do not distinguish the failure. |
| H11 Instrumentation observation defect | The failing diagnostic was `{}` and the conjunction could not identify its unmet term. | This explains poor diagnosis, not why the panel was absent. | **Confirmed diagnostic defect.** The assertion remained strict but observed too little state. |

**Classification:** `ROOT_CAUSE_OPEN`. The historical failures reached the app and called the capability method. The new repeated-run failure narrowed the missing readiness to a nonterminal Game Trace initialization after bridge resolution, but did not observe whether the initializer's capability request reached Java or received a callback. A production lifecycle race is not claimed.

### Instrumented repeated-run evidence

PR head `b74881c938a728e48920423b37c0f07810562731` was tested in three separate Gate A emulator job executions under workflow run `38370818415` (run attempts 1–3). All used the workflow's API 35 Google APIs x86_64 emulator, reported as `emulator-5554 - 15`, Node 22, Temurin Java 21.0.12, Gradle 8.14.3, and WebView 124.0.6367.219.

| Run attempt | Job ID | Artifact ID | Result |
|---|---:|---:|---|
| 1 | `115207074837` | `11799196621` | 5 tests passed, 0 failed, 0 skipped. The target test completed 10 navigation cycles and two fresh Activity relaunches. |
| 2 | `115209129459` | `11799870702` | 5 tests passed, 0 failed, 0 skipped. The target test completed 10 navigation cycles and two fresh Activity relaunches. |
| 3 | `115211359443` | `11799268841` | 4 passed, 1 failed, 0 skipped. `d_debugValidationUsesActualTargetAuthority` failed at Stage 4. |

In attempt 3, cycles 1–3 passed. After the fresh Activity relaunch following cycle 3, Stage 1, Stage 2, Stage 3 document readiness, and native navigation authorization passed. Stage 4 then timed out before `initializeGameTracePanel()` reached a terminal result. The failure snapshot showed `/index.html`, `document.readyState=complete`, `#app` present, no panel, native launch flag enabled, and Activity resumed. The initializer's recorded JS events stopped at `native-bridge-resolved`; its terminal flag was false and captured JS error list was empty. A separate diagnostic `getCapability()` request resolved with `available=true` and `enabled=true`. The failure artifact did not record whether the initializer's own capability call reached Java or whether its callback returned.

The failed run's logcat confirms successful navigation authorization, `WebView.loadUrl()` request, and resolution of `openGameTrace()`. It records no `ERROR:CONSOLE` or matching uncaught TypeError/ReferenceError/SyntaxError. Emulator-console startup and ADB offline warnings also appeared in both passing runs. WebView renderer-crash messages appeared in the second pass and in the failure, so those messages do not isolate the failure. Android elapsed-realtime timestamps and per-document JavaScript `performance.now()` values use different clocks and are not compared numerically.

This reproduces the missing initialization result at a narrower boundary, but does not establish why it remained pending. The observed association with a fresh Activity relaunch is not sufficient to claim that relaunch as the cause: both passing jobs exercised the same relaunch points successfully.

## Changes in this branch

- Added a bounded, metadata-only Game Trace initialization reporter. It records bridge resolution, capability booleans, panel creation/connection, terminal initialization, and error type. It never stores audio, recognized text, or error messages and is inactive unless `Capacitor.DEBUG === true`.
- Instrumented the debug Validation Page click/plugin stages, handler availability, and page readiness. Events use `performance.now()` within each document; that clock is not compared numerically with Android timestamps.
- After the Stage 4 failure, added metadata-only `native-capability-requested` / result markers on the JS and Java sides, plus ordered app-bootstrap, DOM-ready, and `initApp()` completion markers. These distinguish whether the capability request was dispatched, handled natively, answered, and how it overlapped bootstrap. This is diagnostic-only; it does not change initialization order or suppress a failure.
- Added a debug-only native diagnostics method and bounded Activity event history using `SystemClock.elapsedRealtimeNanos()`. It records fixed stage names, sanitized local page identity, document progress, lifecycle, launch flag, and allow/deny reason; no speech or trace payload is collected. Android elapsed-realtime values are not directly compared with JS `performance.now()`.
- Replaced the target test’s empty failure context with five explicit readiness stages and a snapshot of page, bridge, JS navigation/init, capability, and native state. Native state can still be collected if WebView JS evaluation times out. Stage pass/failure records are written to logcat.
- Expanded the existing Gate A debug-validation test to execute 10 Validation Page → Game Trace → Validation Page cycles, with two fresh Activity relaunches. Every cycle requires 14 cases, native/plugin resolution, completed app document, enabled capability, connected panel with `GAME TRACE`, return navigation, cleared launch flag, and no panel on the validation page. Assertions remain fail-closed.
- No production speech, grading, Vocabulary, Items, SRS, or Game Trace semantics were changed. `NativeGameTracePlugin` remains in `src/debug`; native registration and all diagnostics are guarded by `BuildConfig.DEBUG`; the release UI does not gain the validation page.
- Runtime JS changed, so APP_VERSION moved from `v5.104` to `v5.105`; `scripts/version.js`, `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, and cache references are synchronized. `npm run native:sync` stages 117 runtime assets successfully.

## Validation

### Local results before PR CI

| Check | Result |
|---|---|
| `npm test` | 595 tests; 508 pass, 0 fail, 87 skipped because Chromium is unavailable locally. A restricted first run could not spawn the configured Node executable (`EPERM`); the full rerun with the required sandbox permission passed. |
| `npm run speech:validate-td-cluster-before-to` | PASS |
| `npm run speech:validate-asr-09b` | PASS (33 approved pairs / 66 directions) |
| `npm run speech:validate-asr-09c` | PASS |
| `npm run speech:validate-asr-09d` | PASS; confirms APP_VERSION `v5.105` |
| `npm run vocab:check-derived` | PASS |
| `npm run vocab:validate` | PASS |
| ASR-09A audit validator and deterministic `--check` | PASS |
| `npm run native:sync` | PASS; 117 assets staged and Capacitor sync completed. The sandboxed attempt could not write Capacitor's generated plugin manifest; the authorized rerun completed the full sync. |
| `git diff --check` | PASS |
| Local Android build / emulator | Not completed: available local Java 17 runtime lacks `JAVA_COMPILER`; CI Java 21 and emulator jobs are the required verification. |
| Browser regression | Local Chromium tests skipped; the required Playwright Chromium CI job is authoritative. |
| PR head `b74881c` — Application tests | PASS (workflow run `38370818580`), including Chromium browser regression. |
| PR head `b74881c` — Vocabulary / paraphrase scope | PASS (runs `38370818026` / `38370818303`). |
| PR head `b74881c` — Android Debug/Release/Lint | PASS (job `115207075320`; build job also passed on both Gate A reruns). |
| PR head `b74881c` — repeated Gate A | 2 pass / 1 fail across three independent emulator executions; 5 tests required each time; skip count 0 each time. Failure and pass outcomes are listed separately above. |
| Latest diagnostics-only code update | Local tests and full `native:sync` pass; PR CI pending publication. |

### Production authority immutability

Baseline and working tree retain Vocabulary blob `91324d35b2db1911ece2cf3ff746409d321fe963` and Items blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. No authority source data, ASR-09A audit artifact, ASR-09B fixed rules, ASR-09C/09D subset, TARGET/PARAPHRASE/MISS rules, SRS behavior, or Pixel ASR-08D D01–D14 implementation was modified.

### PR and post-merge evidence

PR #333 is open at `https://github.com/miyatayuuma/english-pwa/pull/333`, based on main `624e534baecb9dbcca6549e17eb0a12661259248`. The current report/code update adds request/response and bootstrap markers from the observed Stage 4 failure. Its PR-head workflows and Gate A results will be recorded before merge. No retry pass is treated as proof of root cause. Merge and post-merge values remain pending.

## Residual risks

- Root cause remains unconfirmed: one of three independent emulator executions reproduced a pending initializer capability step after an Activity relaunch, while two executions passed the same relaunch points. The next diagnostic run must establish whether the initial capability request is dispatched and answered and how that relates to application bootstrap.
- The debug test exercises 10 full navigation cycles and two fresh Activity relaunches in one Gate A test invocation; this is not a mathematical proof that future flakiness is impossible and does not replace independent CI emulator runs.
- Local Android build/emulator could not run in this environment. The browser regression passed in GitHub Actions on head `b74881c`; current-head CI must pass before merge.
- Pixel ASR-08D remains a separate open hardware acceptance item; this change does not close it.
