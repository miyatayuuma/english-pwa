# Android Gate A capability callback root-cause report

**Status:** `ROOT_CAUSE_CONFIRMED / ROOT_FIX_ACCEPTANCE_PENDING`

**Investigation date:** 2026-10-14 UTC
**Repository:** `miyatayuuma/english-pwa`

## Authority and scope

| Item | Value |
|---|---|
| Main baseline | `6e6d3d250570fc24d92ca768ebae3865b88946c5` (`v5.105`) |
| PR #334 candidate | `41f767c064ef88adf9180bcee1890fbcbf15cb03` (`v5.106`) |
| Pinned comparison workflow | Runs `38497697805` and `38498397110`, attempt 1 each |
| Android | API 35, Google APIs, x86_64, animation disabled, forced new AVD per job |
| Runner | Ubuntu 24.04 hosted runner |
| Node / Java / Gradle | Node `22.23.3`, Temurin `21.0.12.1`, Gradle `8.14.3` |
| WebView | `124.0.6367.219` in all ten jobs |
| Test order | `connectedDebugAndroidTest`; `NativeShellGateTest` fixed ascending method order; 5 required tests |

This report covers the Game Trace Stage 4 callback stall and its relationship to PR #334. The ASR rules and evidence introduced by PR #334 remain unchanged by the diagnosis and proposed repair.

## Pinned-SHA A/B reproduction

Each row ran on an independent hosted runner and a newly created emulator. The source checkout was pinned to the listed SHA; `npm ci` and `npm run native:sync` ran before the emulator test. Generated Android asset identities were consistent across repetitions of the same SHA:

| Source | APP_VERSION | Source tree | Staged Android asset identity |
|---|---|---|---|
| Baseline `6e6d3d250570fc24d92ca768ebae3865b88946c5` | `v5.105` | `112162b3939d298370475ae8117c595918e873d8` | `c6b03a8279ef4d55bfd06104b19c694abaadabccf123bbc3cc5fad566d00983c` |
| PR #334 `41f767c064ef88adf9180bcee1890fbcbf15cb03` | `v5.106` | `52ecec344e8a5aa54231cb31fddc9ab3d7fdb3e7` | `24b8576a34fe4b294f626bc38a75c55f4c26c5f437b47a93ee39cb88a495b021` |

| Label | Source | Run / job | Artifact | Gate A report |
|---|---|---|---|---|
| A1 | Baseline | `38497697805` / `115637150596` | `11864890797` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| A2 | Baseline | `38497697805` / `115637150664` | `11864955528` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| A3 | Baseline | `38497697805` / `115637150684` | `11864955573` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| B1 | PR #334 | `38497697805` / `115637150636` | `11863849607` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| B2 | PR #334 | `38497697805` / `115637150359` | `11864925897` | 4 pass, 1 fail, 0 skip; Stage 4 failed before cycle 1 |
| B3 | PR #334 | `38497697805` / `115637150632` | `11863949588` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| A4 | Baseline | `38498397110` / `115639314744` | `11864981482` | 4 pass, 1 fail, 0 skip; Stage 4 failed after 6 cycles and 2 relaunches |
| A5 | Baseline | `38498397110` / `115639315050` | `11863834119` | 4 pass, 1 fail, 0 skip; Stage 4 failed before cycle 1 |
| B4 | PR #334 | `38498397110` / `115639315044` | `11863898878` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |
| B5 | PR #334 | `38498397110` / `115639315041` | `11864927078` | 5 pass, 0 fail, 0 skip; 10 cycles, 2 relaunches |

Observed totals were baseline 3/5 successful independent runs and PR #334 4/5. All three failed reports identify `NativeShellGateTest.d_debugValidationUsesActualTargetAuthority` at Stage 4. The first workflow's Android runner wrapper ended all six jobs with a shell-status handling error because its script lines ran in separate shells; those test outcomes are taken from each uploaded Gradle HTML report and logcat artifact. The second workflow used one shell line and reported each job normally. No statistical conclusion is drawn from these ten runs.

### Failure and callback evidence

The B2 failure had a current app document at `/index.html`, `readyState=complete`, `#app` present, NativeGameTrace available, and the native launch flag enabled. The JS initialization log ended at `native-capability-requested`; `terminal` stayed false and the panel was absent. Native logs show the initializer request's Capacitor callback ID `77633012` entering `NativeGameTrace.getCapability()` and a `plugin-capability-resolved` marker. That marker preceded `call.resolve()` in the candidate source, so it is not callback-delivery evidence.

After the Stage 4 timeout, the independent Gate A snapshot issued a second `getCapability()` request with callback ID `77633021`. That request resolved and returned `available=true, enabled=true`. It proves neither that callback `77633012` reached the initializer nor that the initializer Promise settled. The independent baseline failures have the same shape; for example, A5's initializer callback ID was `40232847` and its later snapshot ID was `40232856`. A4 reproduced after six full cycles and both fresh Activity relaunches; its failing initializer and later snapshot callbacks were `103626225` and `103626234`.

All other tests in the three failing reports passed, including the on-demand permission dialog test and `NativeNBestEvidenceTest`. The separate permission-test failure in historical PR #334 job `115623590865` remains a distinct event; this A/B reproduction did not reproduce it.

## JS/Native boundary analysis

The inspected application path is:

1. `initializeGameTracePanel()` records `native-capability-requested` and awaits the facade's `getCapability()` Promise.
2. Capacitor's `toNative()` creates the callback ID and registers its Promise callback before posting the request from JavaScript.
3. Capacitor Android `Bridge.callPluginMethod()` queues the plugin invocation on `taskHandler`.
4. `NativeGameTracePlugin.getCapability()` built the small capability object and called `PluginCall.resolve()` directly from that plugin worker.
5. With the modern Android bridge, Capacitor's `MessageHandler.WebMessageListener` calls `postMessage(message.getData())`, which queues the plugin invocation, and only then assigns `javaScriptReplyProxy = replyProxy` for the message's frame. `sendResponseMessage()` calls `javaScriptReplyProxy.postMessage(...)` directly. The `JavaScriptReplyProxy` API is annotated `@UiThread` and represents one JavaScript object in one frame. genui{"citation":{"ref":"turn5view1"}}

The capability method is unusually short, so its worker can call `resolve()` before the current WebMessageListener invocation has returned and installed the new document's reply proxy. In that ordering window, the result may be sent through the previous document's proxy and the new document's callback map never receives the callback. The later diagnostic query is issued after the proxy assignment and can resolve normally. This explains the exact callback-specific symptom on both pinned SHAs and the rapid fail/pass variation.

### Test-only ordering probe and root-cause confirmation

A temporary workflow patched only the installed Capacitor 8.5.2 dependency at `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java`. It inserted a 500 ms window after `postMessage()` queued the plugin invocation but before the listener assigned its incoming frame's `JavaScriptReplyProxy`. It logged each request's Capacitor callback ID, the prior and incoming proxy identities, the proxy used at response time, and the response thread. The exact patch SHA-256 was `7602da23b09d5e7080029356356f986c4a21021fc885f19ba20594633ac465d1`. This test-only change was not added to the app or production assets.

| Probe side | App SHA | Workflow run / job / artifact | Gate A result | Callback evidence |
|---|---|---|---|---|
| Before repair | PR #334 `41f767c064ef88adf9180bcee1890fbcbf15cb03` | `38500472419` / `115645969308` / `11866016430` | 4 pass, 1 fail, 0 skip. Stage 4 failed; the permission test and other three tests passed. The probe's expected-failure assertion passed. | Initializer callback `108624369` entered with old proxy `22387063` and incoming proxy `255773156`. `call.resolve()` responded on `CapacitorPlugins` through old proxy `22387063` while the 500 ms window was open. The initializer stayed nonterminal and the panel was absent. Later independent snapshot callback `108624378` resolved through the now-current proxy `255773156`. |
| After repair | Repair PR #335 code `bd13c1cfbdfc37e104da82e0bee79d29bcfd823b` | `38500808360` / `115647048545` / `11866485035` | 5 pass, 0 fail, 0 skip; 10 navigation cycles and 2 fresh Activity relaunches. The probe's expected-pass assertion passed. | Initializer callback `119996905` entered with old proxy `111334269` and incoming proxy `259150450`. After the window closed, response used thread `main` and proxy `259150450`, matching the incoming proxy. Gate A observed the settled initializer, connected panel, and terminal readiness. |

This reproduces the failure on the unmodified app source under a controlled bridge ordering window and removes it with the main-looper deferral. The native callback ID, prior/incoming proxy identities, response thread, later independent snapshot, and Stage 4 readiness agree on the same failure boundary. The response is sent to the previous frame's proxy before registration of the new frame's proxy; the initializer in the new document therefore never settles. Posting result construction and `call.resolve()` to the main looper lets the listener finish proxy registration first and keeps `JavaScriptReplyProxy` use on its documented UI thread. **The root cause is confirmed.**

Two exploratory probe attempts are excluded from the before/after result: run `38500397451` failed before emulator execution because its first workflow version escaped GitHub matrix expressions; run `38500472419`'s repaired-side job used the earlier repair commit `34003cf3544c8c5d91ce955799a5d39672a01e40` and hit the AndroidX compile error described below. The later corrected repaired-side job passed. A second pre-fix run (`38500808360`, job `115647048339`) also reproduced Stage 4, but separately failed the permission dialog check; it is not counted as a clean 4/1/0 negative-control result. These permission failures remain distinct from the Game Trace callback defect.

## Hypothesis disposition

| Hypothesis | Evidence and assessment |
|---|---|
| H1 — Capacitor response went to a callback other than the initializer | Confirmed by the test-only probe. Callback `108624369` was returned through the old proxy while callback `108624378` later resolved through the current proxy; after repair, callback `119996905` used the incoming proxy and the initializer settled. |
| H2 — reply proxy/document lifecycle race | Confirmed by the test-only before/after ordering probe and the pinned-SHA reproduction on both main and PR #334. The previous document's reply proxy remained selected until the WebMessageListener callback returned. |
| H3 — non-thenable facade regression | Rejected as cause. The facade remains a frozen plain object around concrete methods; its design is unchanged from main. |
| H4 — concurrent application bootstrap caused the stall | Not supported as the callback-loss cause. `app-initialization-complete` can occur while Stage 4 is still pending by design; there is no native bootstrap call dependency. No global serialization was added. |
| H5 — plugin worker/thread contract | Confirmed. Before repair, `PluginCall.resolve()` and `JavaScriptReplyProxy.postMessage()` ran on `CapacitorPlugins`. After repair, the response ran on `main` and used the newly installed proxy, consistent with the Android API's `@UiThread` contract. This is the same boundary as H2. |
| H6 — PR #334 regression | Not supported as the root defect: the same Stage 4 stall reproduced on the exact main SHA. The observed run rates (3/5 vs 4/5) are too small to compare statistically. PR #334 changes do not touch the Game Trace plugin or facade. |
| H7 — permission dialog test | Separate. It passed in all three new failing reports and is not altered by this callback repair. |

## Repair and callback correlation

The current repair candidate does the following:

- Computes the debug capability result and invokes `PluginCall.resolve()` from a `Handler` posted to the main looper. This yields past the current WebMessageListener callback before sending the response, avoids off-main use of `JavaScriptReplyProxy`, and preserves the same `available`, `enabled`, and `source` values.
- Adds document generation IDs, per-document invocation IDs, fixed request types (`initializer`, `launch-update`, `gate-snapshot`, `gate-return`), Capacitor callback IDs, response status, and bridge-configuration eligibility metadata. The diagnostics do not claim to identify Capacitor's active transport when WebMessageListener registration can fall back to `addJavascriptInterface`. Diagnostic data is bounded and active only when `Capacitor.DEBUG === true`.
- Records native plugin entry, result construction, `call.resolve()` invocation/return, and thread name separately. It does not label `call.resolve()` return as delivery proof; JS bridge response receipt and the settled initializer Promise are recorded separately.
- Keeps the non-thenable facade, parallel bootstrap behavior, panel assertions, ten-cycle test, permission dialog test, and debug-only plugin registration.
- Adds tests for delayed, concurrent, reverse-order, rejected, duplicate, unmatched/prior-document, unregistered-plugin, and debug-disabled callback cases. The Android Gate A test checks that the initializer's request ID and callback ID match through Native resolve, JS bridge receipt, Promise settlement, panel creation, and terminal readiness, and verifies `call.resolve()` ran on `main`. Every accepted cycle also clears launch authorization and verifies `enabled=false` with no panel; each test run performs two fresh Activity relaunches. An in-flight callback deliberately held across Activity recreation is not separately forced: the installed plugin has no delay hook, and adding one would change the production lifecycle under test. The stale-document callback control instead uses an unmatched prior-document callback in the JS harness plus the test-only Capacitor proxy-order probe.

The successful and failed callback boundaries from the ordering probe are recorded above. The standalone probe run is overall red because its deliberate pre-fix matrix member must fail Stage 4; the repaired matrix member and its expected-pass assertion succeeded. The pre-fix permission failure in a later exploratory run is recorded separately and is not treated as a Game Trace result.

## Permission and rejected environmental explanations

All ten jobs used WebView `124.0.6367.219`, the same API 35 Google APIs image, x86_64 emulator, animation setting, test instrumentation, test order, clean runner, Node, Java, and Gradle. The three failures occurred on both source SHAs while the other seven jobs completed ten navigation cycles and two relaunches. This does not rule out all emulator scheduling variation; it does rule out treating the failure as PR #334-only or as an exclusively older WebView setup.

The permission test was the first test in the fixed alphabetical order and passed in A4, A5, and B2. The historical permission failure in PR #334 run `38492796565`, job `115623590865`, is retained as a separate unresolved issue. No permission selector, skip, or test order change is included.

The exploratory pre-fix probe job `115647048339` also saw `Microphone system permission dialog missing: "null"` before the Game Trace test; its report independently records the Stage 4 stall. This permission event did not occur in the clean pre-fix probe job `115645969308`, the repaired probe job `115647048545`, or either of the two normal post-repair Gate A jobs. Permission remains a separate emulator observation; the acceptance test remains enabled and required.

## Protected production data and ASR contracts

The baseline Vocabulary blob remains `91324d35b2db1911ece2cf3ff746409d321fe963`; the Items blob remains `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. ASR-09A through ASR-09D authority, TARGET/PARAPHRASE/MISS, N-best provenance, `gaze ↔ gays`, `lack → black`, Read/Cloze/Correction grading, SRS updates, and Pixel ASR-08D acceptance are not changed by this repair.

Because readiness diagnostics JS changed, the repair candidate increments APP_VERSION from `v5.105` to `v5.106` and synchronizes `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, PWA precache references, and Capacitor staged assets. PR #334 must be reconciled to `v5.107` after this branch reaches main so that the production JS contents do not share an APP_VERSION.

On repair code head `bd13c1cfbdfc37e104da82e0bee79d29bcfd823b`, `native-web` contained 117 files with staged asset identity `f4b360f5200a356c9e8f66017049e4e787553f067f22a4ba91a0ac4edb374360`; Android `assets/public` contained those same 117 byte-identical files plus generated `cordova.js` and `cordova_plugins.js`, for 119 files and identity `6fb5d3cbfb81a8da333e8248762d1641f1226f87461ac88134dc801c31e2cabe`. Both identities use SHA-256 over sorted relative paths, a NUL separator, 8-byte big-endian file length, file bytes, and a trailing NUL. Documentation-only commits do not alter these staged identities.

## Validation state

Local checks on the repair candidate before Android CI:

| Check | Result |
|---|---|
| Focused callback / NativeGameTrace tests | 6 pass, 0 fail |
| ASR-09A audit validator | PASS; 529 candidates, 16 decisions, 43 positive and 38 negative controls |
| ASR-09A deterministic check | PASS; 7 files |
| ASR-09B validator | PASS; 33 approved pairs / 66 directions |
| ASR-09C validator | PASS; 12 bidirectional positive controls / 31 negatives |
| ASR-09D validator | PASS; 18/18 candidates / 23 negatives |
| Vocabulary derived / full validation | PASS |
| Vocabulary / Items blob IDs | unchanged from main baseline |
| `npm test` | 596 tests; 509 pass, 0 fail, 87 Chromium-dependent skips in this local environment |
| `npm run native:sync` | PASS; 117 assets staged and Capacitor sync completed |
| Initial repair commit `34003cf3544c8c5d91ce955799a5d39672a01e40` Android build | FAIL before instrumentation: direct `androidx.webkit.WebViewFeature` reference was not available to app compilation. Removed that compile-time reference; callback diagnostics report bridge-configuration eligibility rather than the active transport. This failed attempt is not an emulator acceptance result. |
| Repair PR #335 code head `bd13c1cfbdfc37e104da82e0bee79d29bcfd823b` Application / Chromium | PASS (push run `38500774538`; PR run `38500779057`) |
| Repair PR #335 code head Vocabulary | PASS (push run `38500774517`; PR run `38500779058`) |
| Repair PR #335 code head paraphrase scope guard | PASS (PR run `38500779051`) |
| Repair PR #335 code head Android Debug / Release / Lint | PASS (push run `38500774553`, job `115646938223`; PR run `38500779053`, job `115646953402`) |
| Repair PR #335 code head normal Gate A | 2/2 independent emulator jobs passed 5/5, 0 fail, 0 skip; each logged 10 navigation cycles and 2 fresh Activity relaunches. PR run `38500779053`, job `115646953633`, artifact `11865464563`; push run `38500774553`, job `115646939112`, artifact `11865791801`. |
| Final review-adjusted PR #335 head `e4de63d1abe52865a9e42eb74cf0969c5ac40ec2` Application / Chromium | PASS: PR run `38502219261`; push run `38502214948`. |
| Final review-adjusted PR #335 head Vocabulary / scope guard | Vocabulary PASS: PR run `38502219270`, push run `38502214957`; scope guard PASS: PR run `38502219228`. |
| Final review-adjusted PR #335 head Android Debug / Release / Lint | PASS: PR run `38502219255`, job `115651594254`; push run `38502214905`, job `115651579476`. |
| Final review-adjusted PR #335 head normal Gate A | PR run `38502219255`, job `115651594034`, artifact `11866582385`; push run `38502214905`, job `115651579778`, artifact `11866114342`. Both reports show 5 passed, 0 failed, 0 skipped; ten navigation cycles; and two fresh Activity relaunches. Permission test passed. |
| Independent Gate A acceptance on app/test source `e4de63d1abe52865a9e42eb74cf0969c5ac40ec2` | Run `38502250224`: jobs `115651688117`, `115651688129`, `115651688033`; artifacts `11865783833`, `11865619049`, `11866462799`. Each fresh-runner job shows 5 passed, 0 failed, 0 skipped, ten cycles, and two Activity relaunches. The permission-dialog test passed each time. |
| Final review adjustment focused regressions | 11 tests passed, 0 failed across native shell/missing-plugin, Game Trace gate, and readiness/callback-correlation tests. |
| Final review comment | Resolved after renaming `callbackTransport` to `callbackTransportEligibility`; logs no longer imply that WebMessageListener registration succeeded when fallback remains possible. |
| Report-only head `2130935ef68d314ccf3d183d520c8624951e4ab1` Application / Chromium, Vocabulary, scope guard | Application PASS (`38502896368`); Vocabulary PASS (`38502896448`); scope guard PASS (`38502896454`). |
| Report-only head `2130935ef68d314ccf3d183d520c8624951e4ab1` Android PR Gate A | Build/Release/Lint PASS and Gate A PASS: run `38502896489`, jobs `115653712644` / `115653713007`, artifact `11865644957`; 5/0/0, ten cycles, two Activity relaunches, permission test passed. |
| Report-only head independent acceptance | Workflow `38502907108` completed 2/3 jobs. Acceptance-1 job `115653746107`, artifact `11866970367`, and acceptance-3 job `115653746552`, artifact `11866850528`, each passed 5/0/0 and ten cycles / two relaunches. Acceptance-2 job `115653746410`, artifact `11866780853`, failed only `a_permissionIsRequestedOnDemandAndGrantedThroughSystemDialog`; `d_debugValidationUsesActualTargetAuthority` completed all ten cycles. This matrix does not satisfy the required 3/3 acceptance. |
| Permission failure evidence and test correction | In failed acceptance-2, RECORD_AUDIO was denied at test start. NativeSpeech request callback `131312508` was issued at `02:51:24.315`; UiDevice's real system-button selector began its 15 s wait at `02:51:23.941` and timed out before `GrantPermissionsActivity` became visible at `02:51:39.496` (15.18 s after the request). The selector failure was at `02:51:39.533`; logcat then shows the permission activity transition. This is a late system-dialog presentation, separate from Game Trace, rather than a permission grant or a Stage 4 failure. The test now waits up to 30 s for the same real system button and still requires the app permission to become GRANTED after clicking it. No fixed sleep, shell grant, skip, or weakened assertion is used. |
| 30 s wait negative control | On candidate `5e4be18a31d743fc7076c2d92ce49b8542ce782e`, acceptance-2 job `115656054035`, artifact `11867440997`, again failed only the permission test; Stage 4 passed all ten cycles. The selector timer started at `03:00:40.428`, before the JS module import had dispatched NativeSpeech request callback `19051254` at `03:00:45.841`. `GrantPermissionsActivity` appeared at `03:01:11.017`, 25.176 s after request dispatch and 0.589 s after the 30 s selector window ended. This shows the previous wait included 5.4 s before the request. The current test first waits for a marker set immediately after `requestPermission()` creates the Capacitor call, then waits up to 45 s for the same real system button. It still checks the permission is granted after the click; it does not retry the request or grant through shell. |
| Candidate `5e4be18a31d743fc7076c2d92ce49b8542ce782e` normal PR Gate A | Run `38503632037`: build/lint job `115656015943`, Gate A job `115656016219`, artifact `11866946156`; PASS 5/0/0, ten cycles, two Activity relaunches, permission test passed. Push run `38503627663`, jobs `115656002329` / `115656002552`, artifact `11867395817`, also PASS 5/0/0 with ten cycles / two relaunches and the permission dialog clicked and granted. |

## Merge and remaining risks

Root-cause confirmation is complete. Root-fix PR #335 has passing Application/Chromium, Vocabulary, scope guard, Android build/lint, and normal Gate A checks. Repeated independent acceptance on candidate `5e4be18a…` found the permission selector started before the asynchronous Capacitor request; the system dialog appeared after the 30 s selector expired. The test now starts its bounded UI wait only after a request-dispatched marker and still requires the real system dialog and grant. A fresh exact-head 3/3 acceptance is required before merge. PR #334 remains OPEN until the repair reaches main and #334 is reconciled, revalidated, and passes its own independent three-run acceptance. Permission failures are reported separately from Stage 4. A/B sampling is intentionally reported descriptively, not as a probability or flake-rate estimate.

Remaining risks are unobserved bridge/lifecycle orderings outside the tested API 35 / WebView combination, PermissionController presentation taking longer than the bounded 45 s post-dispatch wait, and the unforced case of an in-flight callback deliberately held across Activity recreation. No statistical claim is made from the small pinned-SHA A/B sample.
