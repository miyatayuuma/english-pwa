# Android Gate A capability callback root-cause report

**Status:** `ROOT_CAUSE_CONFIRMED / PR #335 MERGED / PR #334 MERGED / PR #336 MERGED / FINAL MAIN v5.108 ACCEPTANCE PASSED`

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

This report covers the Game Trace Stage 4 callback stall and its relationship to PR #334. The ASR rules and evidence introduced by PR #334 remain unchanged by the diagnosis and root-cause repair. A later review follow-up in PR #336 added a final-recognition-evidence gate to the existing targeted Vocabulary matching paths without changing the approved equivalence mappings or scopes.

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

The baseline `data/vocabulary-v3.json` blob remains `91324d35b2db1911ece2cf3ff746409d321fe963`; the `data/items.json` blob remains `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. ASR-09A through ASR-09D authority, TARGET/PARAPHRASE/MISS, N-best provenance, `gaze ↔ gays`, `lack → black`, Read/Cloze/Correction grading, SRS updates, and Pixel ASR-08D acceptance are not changed by this repair.

Because readiness diagnostics JS changed, PR #335 moved main from `v5.105` to `v5.106` and synchronized `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, PWA precache references, and Capacitor staged assets. PR #335 merged at `3b14776ed5dbb3b6d47290874e2c0d52bf3a62b9`. Existing PR #334 was reconciled to `v5.107` and merged at `6147df3b5bda938d0f9925c899009ca8138cb24e`; the PR head tree and merge-commit tree are identical. That was the runtime/cache identity at the #334 merge. PR #336 later updated the targeted final-evidence guard and synchronized production assets to `v5.108`, merging at `76101569b73a9ffd964028a9ba75c7a4db0d4c92`.

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
| Final code/test source `2c8d16af77462558f8d9971af4b75e052b0ca0db` PR Application / Chromium, Vocabulary, scope guard | Application/Chromium PASS: PR run `38504484084`; Vocabulary PASS: `38504484029`; scope guard PASS: `38504484043`. |
| Final code/test source `2c8d16af77462558f8d9971af4b75e052b0ca0db` Android PR and push | PR Android run `38504484035`: build/lint job `115658715684`, Gate A job `115658715304`, artifact `11867261849`; push Android run `38504478539`: build/lint job `115658699409`, Gate A job `115658699785`, artifact `11867751838`. Both reports show 5 passed, 0 failed, 0 skipped, ten navigation cycles, two Activity relaunches, and a passing permission test. |
| Final exact-source independent Gate A acceptance | Run `38504493522`, with checkout verification pinned to code/test SHA `2c8d16af77462558f8d9971af4b75e052b0ca0db`: acceptance-1 job `115658743666`, artifact `11867936355`; acceptance-2 job `115658743384`, artifact `11866863667`; acceptance-3 job `115658743676`, artifact `11867236943`. Each independent fresh-runner report has 5 passed, 0 failed, 0 skipped; 10 cycles; 2 fresh Activity relaunches; and the permission-dialog test passed after pressing the system button. All three are on the same app/test source SHA. |

## Final integration and post-merge verification — 2026-10-14

### GitHub authority

| Item | SHA / state |
|---|---|
| Baseline main | `6e6d3d250570fc24d92ca768ebae3865b88946c5` (`v5.105`) |
| PR #334 original ASR head | `41f767c064ef88adf9180bcee1890fbcbf15cb03` (`v5.106`) |
| Root-fix PR #335 final head | `6ee55480b64963b305f7867fd7724e76a136d304` — MERGED |
| Root-fix main merge | `3b14776ed5dbb3b6d47290874e2c0d52bf3a62b9` (`v5.106`) |
| PR #334 reconciled head | `718727eeb637f9b34cbe8338e79f70aa8388f775` (`v5.107`) |
| PR #334 merge | `6147df3b5bda938d0f9925c899009ca8138cb24e` — MERGED |
| Main after PR #335 and #334 merges | `6147df3b5bda938d0f9925c899009ca8138cb24e` (`v5.107`) |
| PR #336 final-evidence follow-up merge | `76101569b73a9ffd964028a9ba75c7a4db0d4c92` (`v5.108`) — MERGED |
| Main after #336 code merge | `76101569b73a9ffd964028a9ba75c7a4db0d4c92` (`v5.108`) |
| Pixel ASR-08D PR #323 | OPEN; not part of this work |

### Repair-source and main acceptance

The repair application/test source `2c8d16af77462558f8d9971af4b75e052b0ca0db` passed an exact-source, three-independent-emulator matrix in run `38504493522`: jobs `115658743666`, `115658743384`, and `115658743676`; artifacts `11867936355`, `11866863667`, and `11867236943`. Every run reported 5 passed, 0 failed, 0 skipped, 10 navigation cycles, 2 fresh Activity relaunches, and a granted real system permission dialog. PR #335 head `6ee55480b64963b305f7867fd7724e76a136d304` also passed its normal Gate A job `115660992610`, artifact `11867833037` (5/0/0, 10 cycles, 2 relaunches, permission passed).

After PR #335 reached main at `3b14776ed5dbb3b6d47290874e2c0d52bf3a62b9`, three independent jobs in run `38505902039` checked out that exact SHA. Jobs `115663227814`, `115663228028`, and `115663228204`, artifacts `11867273826`, `11868021556`, and `11867158920`, each passed 5/0/0 with ten cycles, two relaunches, and the system permission dialog.

### Existing PR #334 acceptance and merge

The reconciled PR #334 head `718727eeb637f9b34cbe8338e79f70aa8388f775` is a two-parent merge of original PR head `41f767c064ef88adf9180bcee1890fbcbf15cb03` and root-fix main `3b14776ed5dbb3b6d47290874e2c0d52bf3a62b9`. Its tree is exactly main merge tree `26ea0d90c0e44abddcb1f4d7787fa8f2ad377390`. ASR rules, benchmark, and dedicated tests are byte-identical to original PR #334; only root-fix integration, cache/version synchronization, and report reconciliation were added.

The exact-head independent Gate A workflow `38506212927` used checkout verification against `718727eeb637f9b34cbe8338e79f70aa8388f775` and `v5.107`. Jobs/artifacts: acceptance-1 `115664204553` / `11867987071`; acceptance-2 `115664204418` / `11867834808`; acceptance-3 `115664204713` / `11868465031`. All three uploaded reports show 5 passed, 0 failed, 0 skipped, including all four `NativeShellGateTest` cases and `NativeNBestEvidenceTest`; each logged ten navigation cycles, two fresh Activity relaunches, and successful click/grant through the real permission dialog.

On that exact PR head, Application/Chromium passed on PR run `38506197872` and push run `38506193467`; each ran 605 tests (603 passed, 0 failed, 2 skipped) and all ASR-09A audit/deterministic, ASR-09B/09C/09D, T/D cluster, Vocabulary-derived, and Vocabulary-full validators passed. Vocabulary runs `38506198415` and `38506193525` passed; Paraphrase scope guard `38506197866` passed. Android PR run `38506197828` passed Debug/Release/Lint and Gate A (jobs `115664154915` / `115664155067`); push run `38506193746` passed the same checks (jobs `115664141530` / `115664141798`).

PR #334 merged successfully at `6147df3b5bda938d0f9925c899009ca8138cb24e`. Push-triggered post-merge runs on that exact main SHA all passed: Application `38506804000` (605 tests, 603 pass, 0 fail, 2 skip, with all production authority validators); Vocabulary `38506804072`; Android Debug/Release/Lint + Gate A `38506804085`, jobs `115666066896` / `115666067152`, artifact `11868216698`; and Pages build `38506804189`. The push Gate A artifact has 5/0/0, ten cycles, two relaunches, and a passing permission dialog.

An additional independent main-pinned Gate A matrix run `38506857511` checked out exact code merge SHA `6147df3b5bda938d0f9925c899009ca8138cb24e` (`v5.107`) in all three jobs. Acceptance-1 `115666232970` / artifact `11868810221`, acceptance-2 `115666232757` / artifact `11867958876`, and acceptance-3 `115666232984` / artifact `11868117871` each passed 5/0/0, ten cycles, two fresh Activity relaunches, and permission grant.

### Version, staged assets, and protected authority

At the PR #334 merge, the `v5.107` PWA runtime contained 117 staged files with identity `6770e516e8cf4d46f8201f1c9d0d1dd7cc0bb7772bbfd117a89763ba7f250d9a`; Android contains those same 117 files plus generated `cordova.js` and `cordova_plugins.js`, for 119 files with identity `59578be76e702682ed70702e945ea87fe776e0c0210603364efb2161ea28c322`. These use SHA-256 over sorted relative paths, a NUL separator, 8-byte big-endian file length, file bytes, and a trailing NUL. All 116 repo-backed runtime files in the built APK match source bytes; the three debug-only validation assets match their Android debug sources. The remaining staged file is the Capacitor core module from the pinned npm dependency, while Cordova assets are generated by Capacitor sync. `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, and `scripts/version.js` used the synchronized `v5.107` cache/version identity at that merge.

The merged main tree preserves Vocabulary blob `91324d35b2db1911ece2cf3ff746409d321fe963` and Items blob `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. Main's speech-rule source and evidence confirm bidirectional `gaze ↔ gays`, `lack → black` only, Vocabulary-only and limited to `vocab:01251` / `vocab:01296`, with no reverse `black → lack` rule. The original 8-group targeted suite remains unchanged and passes; its 18 positive and 42 negative checks preserve TARGET/PARAPHRASE/MISS, rank/attempt/segment provenance, Read/Cloze/Correction boundaries, and SRS behavior.

### Permission finding and remaining risks

Permission timing was separate from Stage 4. On the final test source, the test waits for a marker set immediately after the NativeSpeech permission request creates its Capacitor call, then waits up to 45 seconds for the actual system button and verifies the permission becomes GRANTED. It does not add a sleep, shell grant, retry, skip, or weaker assertion. Three exact-source PR runs, the main push Gate A, and the three post-merge main matrix jobs all passed this system-dialog path. The earlier selector timeouts and their request/dialog timestamps are preserved in the table above.

Root cause is confirmed by the pinned A/B and test-only proxy-order probe. A/B counts (main 3/5 pass; original PR #334 4/5 pass) are descriptive only and do not estimate long-term failure probability. The unforced case of a callback deliberately held across Activity recreation remains a test limitation; the fix defers a short capability response to the main looper and does not add a delay hook to the plugin. All required merge gates are closed; Pixel ASR-08D remains an independent open hardware acceptance item.


## PR #336 final-evidence review follow-up and current production head

PR #334 merged its approved recognition-collision rules at 6147df3b5bda938d0f9925c899009ca8138cb24e (v5.107). During final review confirmation, an inline review comment identified that the explicit-paraphrase production path did not receive the same final-recognition-evidence gate already used by targeted primary and N-best paths. PR #336 made that minimal correction and added negative controls, preserving the existing rule IDs, directions, Vocabulary entry scopes, paraphrase authority, and final-result behavior.

The review also found that Web Speech can report outer recognitionComplete=true and a terminal completion state while its only recognition segment is interim (isFinal=false). PR #336 therefore passes validated completeEvidence—which incorporates segment finality—to targeted primary, N-best, and explicit-paraphrase evaluation. Tests preserve the valid final “gays at something” PARAPHRASE case and reject non-final pending, interim, error, cancelled, and terminalized-interim evidence for both TARGET and PARAPHRASE. The two approved ASR mappings and scopes were not redesigned.

PR #336 merged at 76101569b73a9ffd964028a9ba75c7a4db0d4c92, bringing main to v5.108. Latest-head checks passed: Application/Chromium run 38509108385; Vocabulary 38509108372; Paraphrase scope guard 38509108382; Android Debug/Release/Lint and Gate A 38509108355. The exact PR head aada037f41ac182ddca5524aee36335941432354 passed three independent Gate A jobs in run 38509340349 (jobs 115673997725, 115673997935, 115673997942), each 5 passed / 0 failed / 0 skipped, ten navigation cycles, two Activity relaunches, and real permission-dialog grant.

Push-triggered post-merge checks on code merge SHA 76101569b73a9ffd964028a9ba75c7a4db0d4c92 passed: Android build/lint/Gate A run 38510184838, Application/Chromium 38510184939, Vocabulary 38510184916, and Pages 38510185088. The exact code merge SHA also passed the independent three-job Gate A matrix 38510219370 (jobs 115676771986, 115676771983, 115676771865), with 5/0/0, ten cycles, two Activity relaunches, and the real permission dialog in every job.

Application run 38509108385 ran 605 tests (603 passed, 0 failed, 2 skipped); ASR validators, vocabulary validation, and scope guard passed on the follow-up head. The original #334 review thread was answered with this follow-up evidence and resolved; PR #336 review concluded without additional findings.

Vocabulary and Items blobs remain 91324d35b2db1911ece2cf3ff746409d321fe963 and ae2aca768b784199b77ac1cf8c0c5a80fd5725bb. Pixel ASR-08D PR #323 remains OPEN. Remaining Gate A limitation: a callback deliberately held across Activity recreation was not separately forced; this is separate from the confirmed reply-proxy ordering cause.


The additional exact-SHA workflow 38510777393 completed successfully after this report's initial v5.108 follow-up entry. All three fresh jobs checked out code SHA 76101569b73a9ffd964028a9ba75c7a4db0d4c92, confirmed APP_VERSION v5.108, and independently computed identical staged asset identities: PWA 117 files, SHA-256 74c09237768a5faabc9f144ec7271ebb74853f7bce4256d12e21e828e427707e; Android 119 files, SHA-256 c8b8c60b56e345388e84b19c99b66374835e4215ec07fb3c1417536c85c8967a. Hashing uses the same sorted relative-path/NUL/length/content/NUL format documented above.

| Job | Artifact | Gate A HTML result | Cycle / relaunch and permission evidence |
|---|---|---|---|
| acceptance-1, 115678529751 | 11870075488 | 5 tests, 0 failures, 0 skipped; all four NativeShellGateTest methods and NativeNBestEvidenceTest passed | Logcat confirms total=10 cycles and 2 fresh Activity relaunches; the system GrantPermissionsActivity appeared and the permission test passed. |
| acceptance-2, 115678530026 | 11869523870 | 5 tests, 0 failures, 0 skipped | Logcat confirms total=10 cycles and 2 fresh Activity relaunches; the system GrantPermissionsActivity appeared and the permission test passed. |
| acceptance-3, 115678529999 | 11869354867 | 5 tests, 0 failures, 0 skipped | Logcat confirms total=10 cycles and 2 fresh Activity relaunches; the system GrantPermissionsActivity appeared and the permission test passed. |

Artifact logcat also records a later pm grant command in NativeShellGateTest.b_productionBackendStartsAndCancelsWithoutWebSpeech. The test order is alphabetical: a_permissionIsRequestedOnDemandAndGrantedThroughSystemDialog runs first, asserts the permission begins denied, waits for and clicks the actual system Allow button, and verifies GRANTED. The later backend test uses pm grant as its own setup. Thus the permission acceptance is independently exercised through the system dialog and is not replaced by that subsequent test fixture.


## Relationship to the PR #333 reliability report

The earlier report, docs/validation/android-gate-a-game-trace-reliability.md, accurately described the evidence available through 2026-10-13 and left the callback root cause open. It recorded one of three independent executions on an earlier code head reproducing a pending initializer after relaunch, while two passed. That historical pass/fail result did not prove why the callback stalled.

The 2026-10-14 pinned A/B comparison and controlled Capacitor proxy-order probe add evidence that was not available to PR #333: distinct initializer and diagnostic callback IDs, old and incoming JavaScriptReplyProxy identities, response thread, and before/after repair behavior. Those observations identify the response crossing the wrong document proxy before the new listener installs its proxy. The finding upgrades the current classification to ROOT_CAUSE_CONFIRMED without rewriting the older report's time-bounded ROOT_CAUSE_OPEN conclusion.
