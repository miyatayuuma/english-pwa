# Android Gate A Game Trace readiness investigation

**Status:** `DIAGNOSTICS_COMPLETE / ROOT_CAUSE_OPEN`

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
| H6 Game Trace capability resolution | The b748 Stage 4 failure stopped after `native-bridge-resolved`, without native request/result markers. On `7ed63ca`, the initializer request and native response were recorded, followed by terminal initialization with an enabled capability. The final `180ce039` run passed 10 cycles, including capability checks. | The successful later runs do not reveal why the earlier initializer stayed pending. | **The original timeout remains unresolved.** Request/result diagnostics now distinguish the boundary; no original-style nonterminal failure was captured on the final head. |
| H7 Game Trace initialization ordering | The b748 Stage 4 failure followed one fresh Activity relaunch. On `7ed63ca`, bootstrap, DOM ready, capability resolution, panel creation, and both initialization completions were recorded in order. The final head passed two fresh Activity relaunches. | Two b748 runs passed the same relaunch points; the final run also passed. | **No ordering defect confirmed.** A lifecycle race remains plausible for the historical timeout but unconfirmed. |
| H8 Panel detached after creation | Historical assertion saw no panel. | `7ed63ca` showed the panel present and connected; the final head passed panel presence, `isConnected`, and `GAME TRACE` assertions through all 10 cycles. | **Not reproduced in the final run; historical panel absence remains unexplained.** |
| H9 JavaScript/module error | Old setup swallowed the initializer rejection and did not include window error state. | No matching console exception/module-load message was found in the captured logcat. | **Not evidenced, not excluded.** Old error capture was incomplete. |
| H10 Emulator / WebView / runner instability | The new failure occurred on an API 35 GitHub Actions emulator. | Pass and fail jobs all had emulator-console and emulator-configuration warnings. The second pass had 5 renderer-crash messages; the failure had 4. Both had WebView `124.0.6367.219`; the failure had no matching `ERROR:CONSOLE` or uncaught JS exception. | **Not isolated as cause.** Warning classes and renderer crashes also occurred in a pass and do not distinguish the failure. |
| H11 Instrumentation observation defect | Historical failures had `{}` diagnostics and the conjunction could not identify its unmet term. The Stage 4 assertion also compared a last-event phase with an earlier completion stage. | `7ed63ca` proves trace initialization and panel creation completed despite the assertion failure; final head `180ce039` passed strict event-based readiness checks. | **Confirmed diagnostic/test defects, corrected and verified.** A separate Java telemetry thread-affinity defect was also confirmed on `dbdfcac` and removed. These fixes improve diagnosis and prevent known false failures; they do not establish the historical production root cause. |

**Classification:** `ROOT_CAUSE_OPEN`. The historical failures reached the app and called the capability method. The new repeated-run failure narrowed the missing readiness to a nonterminal Game Trace initialization after bridge resolution, but did not observe whether the initializer's capability request reached Java or received a callback. A production lifecycle race is not claimed.

The `7ed63ca` run observed the initializer capability request and response, terminal initialization, and connected panel. Its failure was the Stage 4 assertion comparing a stale semantic expectation to the latest-event phase field; it did not reproduce the original missing-panel failure. The corrected event-based assertion passed on the final PR head, including all repeated navigation cycles.

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

### Follow-up diagnostics regression on `dbdfcac`

The first Gate A run after adding Java-side capability request/result markers was run `38374596236`, job `115219700370`, PR head `dbdfcacb3537db04eaa0b656a101c5cff02f3740`, artifact `11800359345`. The Android Debug/Release/Lint build passed, but Gate A failed in `a_permissionIsRequestedOnDemandAndGrantedThroughSystemDialog` before the Game Trace test ran. The runner log records a process crash in `NativeGameTracePlugin.getCapability()`: `recordNativeGameTraceCapabilityEvent()` called `WebView.getUrl()` on the `CapacitorPlugins` thread. Android reported that WebView methods must run on the main thread. This is a confirmed defect in the newly added diagnostics, not evidence for the two historical panel timeouts.

The recorder has been changed to log the capability stage, booleans, launch flag, and Android elapsed-realtime timestamp without reading WebView state. A static regression assertion now prevents WebView calls from entering this plugin-thread recorder. On the next head, the test reached the native capability request/result markers without a process crash; that run failed at the separate Stage 4 assertion documented below.

### Readiness assertion mismatch on `7ed63ca`

Run `38376343044`, Gate A job `115225562313`, PR head `7ed63ca349499362279cc2a627df510ab06f839b`, artifact `11801387631`, completed the other four Gate A tests and failed `d_debugValidationUsesActualTargetAuthority` at the Stage 4 assertion. The snapshot shows successful app initialization: the initializer recorded `native-capability-requested`, `native-capability-resolved` with `available=true, enabled=true`, `panel-created`, and `initialization-complete` with `terminal=true`, `capabilityEnabled=true`, `panelPresent=true`, and `panelConnected=true`. The native event log also contains capability requested/resolved with the launch flag enabled. No JavaScript errors were recorded.

The test compared the single latest `phase` field with `initialization-complete`. After that event, the app bootstrap correctly recorded `app-initialization-complete`, so the latest phase had advanced while the trace-initialization completion event remained present. This is a confirmed test-observation mismatch, not a stalled initializer. The assertion now requires the specific `initialization-complete` event, its terminal/enabled/connected fields, and the successful native capability event. A regression test covers this event ordering. Android elapsed-realtime and per-document JavaScript `performance.now()` values remain separate.

### Final diagnostic acceptance run

On final PR head `180ce039728d08be6fdef9c36b641f2c9cdc8be3`, Android workflow run `38377281598`, Gate A job `115228730713`, artifact `11801684881` passed on its first attempt. The report contains all five required tests: `NativeShellGateTest` (4/4) and `NativeNBestEvidenceTest` (1/1), with 5 passed, 0 failed, and 0 skipped. The target test logged `ACCEPTANCE_CYCLE_PASS round=1` through `round=10`, followed by `ACCEPTANCE_CYCLES_PASS total=10 freshActivityRelaunches=2`. Each cycle checked the Validation Page, Game Trace navigation, completed document, enabled native capability, connected panel and `GAME TRACE` label, then return and restored page state. No workflow retry was used.

The run used the configured API 35 Google APIs x86_64 emulator (`emulator-5554 - 15`), WebView `124.0.6367.219`, Node `22.23.3`, Temurin Java `21.0.12`, and Gradle `8.14.3`. It establishes successful repeated operation on this run, not why the earlier pending initialization occurred or that the flake is eliminated.

The same strict Gate A implementation passed again on documentation-only PR head `55261eb8db691d2d2a397b62cdc2cd2feda336ba`, run `38378661461`, job `115233303123`, artifact `11802481428`: 5 passed, 0 failed, 0 skipped, first attempt. The target test implementation was unchanged and includes the same ten navigation cycles and two fresh Activity relaunches. This is a second independent clean run, not a retry of the first.

## Changes in this branch

- Added a bounded, metadata-only Game Trace initialization reporter. It records bridge resolution, capability booleans, panel creation/connection, terminal initialization, and error type. It never stores audio, recognized text, or error messages and is inactive unless `Capacitor.DEBUG === true`.
- Added the imported readiness diagnostics module to the service worker precache list. Automated review identified that otherwise an offline cache miss could prevent the runtime module graph from loading; a test now keeps the module and consumer entries together.
- Instrumented the debug Validation Page click/plugin stages, handler availability, and page readiness. Events use `performance.now()` within each document; that clock is not compared numerically with Android timestamps.
- After the Stage 4 failure, added metadata-only `native-capability-requested` / result markers on the JS and Java sides, plus ordered app-bootstrap, DOM-ready, and `initApp()` completion markers. These distinguish whether the capability request was dispatched, handled natively, answered, and how it overlapped bootstrap. The Java recorder avoids WebView APIs because Capacitor invokes plugin methods on its plugin thread; a static test enforces this. This is diagnostic-only; it does not change initialization order or suppress a failure.
- Added a debug-only native diagnostics method and bounded Activity event history using `SystemClock.elapsedRealtimeNanos()`. It records fixed stage names, sanitized local page identity, document progress, lifecycle, launch flag, and allow/deny reason; no speech or trace payload is collected. Android elapsed-realtime values are not directly compared with JS `performance.now()`.
- Replaced the target test’s empty failure context with five explicit readiness stages and a snapshot of page, bridge, JS navigation/init, capability, and native state. Native state can still be collected if WebView JS evaluation times out. Stage pass/failure records are written to logcat.
- Expanded the existing Gate A debug-validation test to execute 10 Validation Page → Game Trace → Validation Page cycles, with two fresh Activity relaunches. Every cycle requires 14 cases, native/plugin resolution, completed app document, enabled capability, connected panel with `GAME TRACE`, return navigation, cleared launch flag, and no panel on the validation page. Assertions remain fail-closed.
- No production speech, grading, Vocabulary, Items, SRS, or Game Trace semantics were changed. `NativeGameTracePlugin` remains in `src/debug`; native registration and all diagnostics are guarded by `BuildConfig.DEBUG`; the release UI does not gain the validation page.
- Runtime JS changed, so APP_VERSION moved from `v5.104` to `v5.105`; `scripts/version.js`, `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, and cache references are synchronized. `npm run native:sync` stages 117 runtime assets successfully.

## Validation

### Local results before PR CI

| Check | Result |
|---|---|
| `npm test` | 595 tests; 508 pass, 0 fail, 87 skipped because Chromium is unavailable locally. Full suite passed after the latest Stage 4 assertion/event-order adjustment. |
| `npm run speech:validate-td-cluster-before-to` | PASS |
| `npm run speech:validate-asr-09b` | PASS (33 approved pairs / 66 directions) |
| `npm run speech:validate-asr-09c` | PASS |
| `npm run speech:validate-asr-09d` | PASS; confirms APP_VERSION `v5.105` |
| `npm run vocab:check-derived` | PASS |
| `npm run vocab:validate` | PASS |
| ASR-09A audit validator and deterministic `--check` | PASS |
| `npm run native:sync` | PASS after runtime/precache updates; 117 assets staged and Capacitor sync completed. |
| `git diff --check` | PASS |
| Local Android build / emulator | Not completed: available local Java 17 runtime lacks `JAVA_COMPILER`; CI Java 21 and emulator jobs are the required verification. |
| Browser regression | Local Chromium tests skipped; the required Playwright Chromium CI job is authoritative. |
| PR head `b74881c` — Application tests | PASS (workflow run `38370818580`), including Chromium browser regression. |
| PR head `b74881c` — Vocabulary / paraphrase scope | PASS (runs `38370818026` / `38370818303`). |
| PR head `b74881c` — Android Debug/Release/Lint | PASS (job `115207075320`; build job also passed on both Gate A reruns). |
| PR head `b74881c` — repeated Gate A | 2 pass / 1 fail across three independent emulator executions; 5 tests required each time; skip count 0 each time. Failure and pass outcomes are listed separately above. |
| PR head `dbdfcac` — Application tests | PASS (run `38374596125`). |
| PR head `dbdfcac` — Scope guard / Vocabulary | PASS (runs `38374595986` / `38374596334`). |
| PR head `dbdfcac` — Android Debug/Release/Lint | PASS (job `115219700737`). |
| PR head `dbdfcac` — Gate A | FAIL (run `38374596236`, job `115219700370`, artifact `11800359345`): the new capability telemetry called `WebView.getUrl()` from `CapacitorPlugins`, crashing during `a_permissionIsRequestedOnDemandAndGrantedThroughSystemDialog`; the Game Trace target test did not run. The next head recorded capability requested/resolved events without that crash. |
| PR head `7ed63ca` — Application tests | PASS (run `38376343052`; Chromium-backed suite completed). |
| PR head `7ed63ca` — Scope guard / Vocabulary | PASS (runs `38376343079` / `38376343047`). |
| PR head `7ed63ca` — Android Debug/Release/Lint | PASS (job `115225562924`). |
| Final head `180ce039` — Application tests | PASS (run `38377281595`; Chromium browser regression included). |
| Final head `180ce039` — Vocabulary validation | PASS (run `38377281573`). |
| Final head `180ce039` — Paraphrase scope guard | PASS (run `38377281611`). |
| Final head `180ce039` — Android Debug/Release/Lint | PASS (Android run `38377281598`, job `115228730533`). |
| Final head `180ce039` — Gate A | PASS on first attempt: 5 passed, 0 failed, 0 skipped (run `38377281598`, job `115228730713`, artifact `11801684881`); ten cycles and two fresh Activity relaunches, as detailed above. |
| Documentation head `55261eb8` — Application / Chromium | PASS (run `38378661558`). |
| Documentation head `55261eb8` — Vocabulary / paraphrase scope | PASS (runs `38378661447` / `38378661339`). |
| Documentation head `55261eb8` — Android Debug/Release/Lint | PASS (run `38378661461`, job `115233303546`). |
| Documentation head `55261eb8` — Gate A | PASS on first attempt: 5 passed, 0 failed, 0 skipped (run `38378661461`, job `115233303123`, artifact `11802481428`); same ten-cycle target and two fresh Activity relaunches. |
| Latest local regression checks | PASS: `npm test` (595 tests, 508 pass, 0 fail, 87 Chromium-dependent skips); focused native/readiness/service-worker tests (3/3); `npm run native:sync` (117 assets). |

### Production authority immutability

Baseline and working tree retain Vocabulary blob `91324d35b2db1911ece2cf3ff746409d321fe963` and Items blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. No authority source data, ASR-09A audit artifact, ASR-09B fixed rules, ASR-09C/09D subset, TARGET/PARAPHRASE/MISS rules, SRS behavior, or Pixel ASR-08D D01–D14 implementation was modified.

### PR and post-merge evidence

PR #333 is open at `https://github.com/miyatayuuma/english-pwa/pull/333`, based on main `624e534baecb9dbcca6549e17eb0a12661259248`. Final code head `180ce039728d08be6fdef9c36b641f2c9cdc8be3` passed Application, Vocabulary, paraphrase-scope, Android build/lint, and Gate A checks. The report-only head `55261eb8` repeated those checks and passed Gate A again on its first attempt. The original timeout remains unroot-caused; no retry pass or repeated success is presented as root-cause proof.

## Residual risks

- Root cause of the original timeout remains unconfirmed: one of three independent emulator executions on `b74881c` reproduced a pending initializer capability step after an Activity relaunch, while two executions passed the same relaunch points. The final code and documentation heads each passed Gate A with ten cycles and two Activity relaunches, but those results do not explain the earlier pending initializer or prove zero future flakiness.
- The debug test exercises 10 full navigation cycles and two fresh Activity relaunches in one Gate A test invocation; this is not a mathematical proof that future flakiness is impossible and does not replace independent CI emulator runs.
- Local Android build/emulator could not run in this environment. The Chromium browser regression and Android build/lint/Gate A passed in GitHub Actions on final code head `180ce039`.
- Pixel ASR-08D remains a separate open hardware acceptance item; this change does not close it.

## Follow-up investigation — 2026-10-14

The status and conclusions above describe evidence available to the PR #333 reliability report through 2026-10-13. A later pinned-SHA comparison is documented in [android-gate-a-capability-callback-root-cause.md](./android-gate-a-capability-callback-root-cause.md): baseline main `6e6d3d250570fc24d92ca768ebae3865b88946c5` reproduced the same Stage 4 stall in 2/5 independent jobs, while PR #334 `41f767c064ef88adf9180bcee1890fbcbf15cb03` reproduced it in 1/5. This evidence adds the initializer's distinct Capacitor callback ID and shows that a later independent snapshot callback can resolve while the initializer remains pending.

The follow-up inspection identifies a likely callback lifecycle race in Capacitor 8.5.2: the modern `MessageHandler` queues plugin execution before assigning the current document's `JavaScriptReplyProxy`, while the debug `getCapability()` method previously called `PluginCall.resolve()` immediately on Capacitor's plugin task thread. This narrows the earlier open hypotheses to the NativeGameTrace callback-response boundary; it does not change the historical evidence or claim that the exact failed response used a stale proxy. The callback-order probe and post-repair emulator acceptance are pending, so this report's historical `ROOT_CAUSE_OPEN` conclusion remains the status of the investigation as recorded on 2026-10-13.
