# Android Gate A capability callback root-cause report

**Status:** `ROOT_CAUSE_PROBABLE / REMEDIATION_VALIDATION_PENDING`

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

The A/B artifacts do not record which `JavaScriptReplyProxy` instance Capacitor used for each failed native `call.resolve()`. The bridge source ordering and failure observations establish a strong mechanism, but that per-callback fact remains to be captured by the temporary ordering probe before this classification is raised from probable to confirmed.

## Hypothesis disposition

| Hypothesis | Evidence and assessment |
|---|---|
| H1 — Capacitor response went to a callback other than the initializer | Supported as the likely failure boundary. B2's initializer and later snapshot have distinct callback IDs. Existing reports do not log JS callback-entry IDs. |
| H2 — reply proxy/document lifecycle race | Strongly supported by Capacitor 8.5.2 source ordering, short synchronous handler duration, plugin-worker dispatch, both SHA reproductions, and A4's failure after Activity relaunches. Waiting for a UI-thread turn should occur after the current listener has installed its reply proxy. Direct proxy identity capture is pending. |
| H3 — non-thenable facade regression | Rejected as cause. The facade remains a frozen plain object around concrete methods; its design is unchanged from main. |
| H4 — concurrent application bootstrap caused the stall | Not supported as the callback-loss cause. `app-initialization-complete` can occur while Stage 4 is still pending by design; there is no native bootstrap call dependency. No global serialization was added. |
| H5 — plugin worker/thread contract | Confirmed contract violation on the inspected path: the short capability method called `PluginCall.resolve()` from Capacitor's task thread; modern reply proxy is UI-thread annotated and used directly by the response method. This is the same boundary as H2. |
| H6 — PR #334 regression | Not supported as the root defect: the same Stage 4 stall reproduced on the exact main SHA. The observed run rates (3/5 vs 4/5) are too small to compare statistically. PR #334 changes do not touch the Game Trace plugin or facade. |
| H7 — permission dialog test | Separate. It passed in all three new failing reports and is not altered by this callback repair. |

## Repair and callback correlation

The current repair candidate does the following:

- Computes the debug capability result and invokes `PluginCall.resolve()` from a `Handler` posted to the main looper. This yields past the current WebMessageListener callback before sending the response, avoids off-main use of `JavaScriptReplyProxy`, and preserves the same `available`, `enabled`, and `source` values.
- Adds document generation IDs, per-document invocation IDs, fixed request types (`initializer`, `launch-update`, `gate-snapshot`, `gate-return`), Capacitor callback IDs, response status, and transport metadata. Diagnostic data is bounded and active only when `Capacitor.DEBUG === true`.
- Records native plugin entry, result construction, `call.resolve()` invocation/return, and thread name separately. It does not label `call.resolve()` return as delivery proof; JS bridge response receipt and the settled initializer Promise are recorded separately.
- Keeps the non-thenable facade, parallel bootstrap behavior, panel assertions, ten-cycle test, permission dialog test, and debug-only plugin registration.
- Adds tests for delayed, concurrent, reverse-order, rejected, duplicate, unmatched/prior-document, and debug-disabled callback cases. The Android Gate A test checks that the initializer's request ID and callback ID match through Native resolve, JS bridge receipt, Promise settlement, panel creation, and terminal readiness, and verifies `call.resolve()` ran on `main`.

An isolated test-only Capacitor `MessageHandler` ordering probe is pending. It will delay reply-proxy registration on the first NativeGameTrace capability request without changing the pinned application source, compare the candidate without the repair against this repair, and save the exact dependency diff and SHA. This probe is not included in production assets.

## Permission and rejected environmental explanations

All ten jobs used WebView `124.0.6367.219`, the same API 35 Google APIs image, x86_64 emulator, animation setting, test instrumentation, test order, clean runner, Node, Java, and Gradle. The three failures occurred on both source SHAs while the other seven jobs completed ten navigation cycles and two relaunches. This does not rule out all emulator scheduling variation; it does rule out treating the failure as PR #334-only or as an exclusively older WebView setup.

The permission test was the first test in the fixed alphabetical order and passed in A4, A5, and B2. The historical permission failure in PR #334 run `38492796565`, job `115623590865`, is retained as a separate unresolved issue. No permission selector, skip, or test order change is included.

## Protected production data and ASR contracts

The baseline Vocabulary blob remains `91324d35b2db1911ece2cf3ff746409d321fe963`; the Items blob remains `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`. ASR-09A through ASR-09D authority, TARGET/PARAPHRASE/MISS, N-best provenance, `gaze ↔ gays`, `lack → black`, Read/Cloze/Correction grading, SRS updates, and Pixel ASR-08D acceptance are not changed by this repair.

Because readiness diagnostics JS changed, the repair candidate increments APP_VERSION from `v5.105` to `v5.106` and synchronizes `index.html`, `scripts/app/swBootstrap.js`, `sw.js`, PWA precache references, and Capacitor staged assets. PR #334 must be reconciled to `v5.107` after this branch reaches main so that the production JS contents do not share an APP_VERSION.

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
| GitHub Application / Chromium / Vocabulary / Scope / Android / Gate A | Pending on the repair PR |
| Independent post-repair Gate A runs | Pending; require 3 separate runs with 5/5, 10 cycles, and 2 relaunches each |

## Merge and remaining risks

No root-fix PR has been merged and PR #334 remains OPEN while the temporary callback-order probe and all required CI/emulator acceptance are pending. The historic permission failure remains separate. A/B sampling is intentionally reported descriptively, not as a probability or flake-rate estimate.

Root-cause classification may be changed to `ROOT_CAUSE_CONFIRMED` only after the instrumented before/after callback-order probe and the strict post-fix regression runs demonstrate the expected callback ID delivery on the current document and main thread.
