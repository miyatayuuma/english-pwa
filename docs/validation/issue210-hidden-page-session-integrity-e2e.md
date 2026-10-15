# Issue #210 Hidden-Page Session Integrity E2E

**Audit status: NOT_VERIFIED.** The GitHub Chromium runner did not produce a real hidden visibility state for the application page. No production defect is confirmed by this run, and no hidden-page acceptance PASS is claimed.

Date: 2026-10-15 UTC.

## 1. Latest-main authority

| Item | Authority |
|---|---|
| Initial and final main SHA | 447063b6160ce3919a369dd7136512d41fafd6ce |
| APP_VERSION | v5.110 |
| Audit branch | audit/issue210-hidden-page-integrity |
| Audit PR | https://github.com/miyatayuuma/english-pwa/pull/344 (OPEN; not merged) |
| PR head at evidence capture | dc1e7afb137ad34c6a1e70cf2b3e4406a2e72492 |
| PR merge SHA | None |
| Issue #342 | CLOSED; prior finality repair authority retained |
| Parent Issue #210 | OPEN |
| Pixel ASR-08D PR #323 | OPEN; physical-device acceptance remains separate |

The audit branch changes test code, test diagnostics, the test workflow and this report. Production source, APP_VERSION, SRS/ASR rules, storage schemas and learning data were not changed.

Protected data blobs match main and the audit branch:

- data/vocabulary-v3.json: 91324d35b2db1911ece2cf3ff746409d321fe963
- data/items.json: ae2aca768b784199b77ac1cf8c0c5a80fd5725bb
- data/characters.json: 1d0c61711d763373e1f587ecde16ff9f07cb1a45

## 2. Existing background lifecycle

Source inspection of scripts/app/main.js confirms that the production visibility handler returns unless document.visibilityState is hidden, then calls finalizeActiveSession with reason background. The finalizer stops audio, cancels pending microphone start, awaits stopRec for an active non-shadowing recognition controller, finalizes session metrics and closure, resets session state and returns to Home.

This is a source description only. The real hidden lifecycle handler was not reached in the CI runs below.

## 3. Test architecture

The existing Issue #210 real-session browser fixture is reused. It provides an isolated BrowserContext, fixed time, production item fixtures, real production session start/scoring/storage/result rendering, controllable external SpeechRecognition callbacks, storage/write snapshots, relationship snapshots, result event capture, console/page error capture and external-request blocking.

Only the external Web Speech provider event boundary is mocked. The production finalizer, scoring, SRS and study-log writes, relationship calculation, result renderer and reset path are not mocked. The CI job sets ISSUE210_REQUIRE_BROWSER=1 and ISSUE210_HEADFUL=1 and runs Chromium under Xvfb/Openbox with wmctrl and xdotool installed.

## 4. Real visibility transition evidence

The helper requires a visible starting page, then tries to move Chromium focus to a second target. It accepts a transition only after the app page reports document.visibilityState hidden and a visibilitychange listener recorded hidden. It does not set document.hidden or document.visibilityState and does not dispatch visibilitychange as a substitute.

The latest run, Application/Chromium run 38675238173, used a separate Chromium window in the app BrowserContext. It placed the foreground target over the app window at identical bounds (left 10, top 10, width 508, height 929). X11 showed the target window active. Despite that, after 10 seconds the app page still reported visibilityState visible, hidden false, hasFocus true, and an empty visibility event list. The test failed its hidden-state precondition.

Earlier attempts also failed the same precondition:

- Run 38673744838: serial test-file execution and same-window tab activation; the app remained visible.
- Run 38674508924: separate Chromium window; the app remained visible.
- Run 38673315736: focus could be taken by another parallel Chromium process; test-file serialization removed this competing-window condition but did not produce hidden state.

These are test-environment/lifecycle-driver failures, not evidence about the production background handler. A synthetic event was not counted as a lifecycle PASS.

## 5. Scenario matrix

All BG scenarios remain NOT_VERIFIED because the required real hidden transition was not observed. ASR setup reached before the transition is described where useful; post-transition state was not measured.

| Scenario | Visibility | ASR | SRS | Closure | Result |
|---|---|---|---|---|---|
| BG-01 Start then hidden unanswered | NOT_VERIFIED | Idle | No post-hidden snapshot | Not observed | NOT_VERIFIED |
| BG-02 Preserve one committed answer | NOT_VERIFIED | One final answer was scored before transition attempt | One pre-transition write; preservation after hidden not observed | Not observed | NOT_VERIFIED |
| BG-03 Interim-only hidden | NOT_VERIFIED | Exact interim injected; hidden stop not observed | Post-hidden state not observed | Not observed | NOT_VERIFIED |
| BG-04 Exact rank-1 interim N-best | NOT_VERIFIED | Exact rank-1 interim injected; hidden stop not observed | Post-hidden state not observed | Not observed | NOT_VERIFIED |
| BG-05 Final before hidden | NOT_VERIFIED | Pre-transition final scoring setup reached | One pre-transition write; no post-hidden duplicate check | Not observed | NOT_VERIFIED |
| BG-06 Final/hidden race | NOT_VERIFIED | Race ordering was not established | Not observed | Not observed | NOT_VERIFIED |
| BG-07 Delayed provider end | NOT_VERIFIED | Stop request not observed | Not observed | Not observed | NOT_VERIFIED |
| BG-08 Missing provider end | NOT_VERIFIED | Stop request not observed | Not observed | Not observed | NOT_VERIFIED |
| BG-09 Duplicate hidden event | NOT_VERIFIED | Stop-pending state not reached | Not observed | Not observed | NOT_VERIFIED |
| BG-10 Hidden/manual exit race | NOT_VERIFIED | Stop-pending state not reached | Not observed | Not observed | NOT_VERIFIED |
| BG-11 Resume after background | NOT_VERIFIED | No background close to resume from | Not observed | Not observed | NOT_VERIFIED |
| BG-12 Late callback after close | NOT_VERIFIED | No background close or old-attempt delivery | Not observed | Not observed | NOT_VERIFIED |
| BG-13 Reload after background | NOT_VERIFIED | No background close to reload | Not observed | Not observed | NOT_VERIFIED |
| BG-14 Normal start after interruption | NOT_VERIFIED | No background interruption occurred | Not observed | Not observed | NOT_VERIFIED |
| BG-15 Correction then hidden | NOT_VERIFIED | Original FAIL and interim Correction setup reached; no hidden boundary | Post-hidden state not observed | Not observed | NOT_VERIFIED |
| BG-16 Cloze then hidden | NOT_VERIFIED | Cloze stage and exact interim setup reached; no hidden boundary | Post-hidden state not observed | Not observed | NOT_VERIFIED |

## 6. Interim/final recognition protection

The existing Issue #342 negative regression passed in the latest Application run:

- “Issue 342 interim-only automatic provider end remains NO GRADE”: PASS.
- “Issue 342 finality matrix admits only a normally completed all-final transcript”: PASS.
- Production finality regression tying finalized segments to attempt identity and item context: PASS.

These controls verify the existing normal recognition-finality contract. They do not establish that the same contract survives background finalization because the hidden handler did not run. No conclusion is made about a final callback arriving after the hidden boundary.

## 7. Session closure reconciliation

No background session_closure value was observed in any BG scenario because the production visibility handler did not run. Therefore reason background, cardsDone reconciliation, no-result-screen behavior, session reset and closure idempotence remain NOT_VERIFIED.

## 8. SRS and study-log preservation

The baseline real-session suite passed its normal completed-session, failure/Correction and persistence checks. In the BG-02 setup, one committed answer was written once before the attempted transition. The test could not observe whether background finalization preserved that answer, omitted the unanswered item or avoided a second write. No post-hidden SRS, study-log, relationship or write-count diff is claimed.

## 9. Duplicate/reentrant finalization

BG-09 and BG-10 did not reach a real hidden boundary or an in-flight stop state. Semantic closure count, closure-reason winner, result event count and metrics reconciliation remain NOT_VERIFIED. The planned duplicate synthetic visibility event was not used as a substitute for an actual transition.

## 10. Resume and reload

BG-11, BG-12 and BG-13 did not execute their post-background assertions. No claim is made about microphone state, stale recognizer restart, old callback isolation, reload persistence or a fresh session after a real background closure.

## 11. Correction and Cloze controls

BG-15 reached the original finalized FAIL and prepared an interim Correction attempt, but the hidden boundary did not occur. BG-16 entered the production Cloze hint stage and prepared an interim full-sentence callback, but the hidden boundary did not occur. Their background SRS and PASS assertions remain NOT_VERIFIED.

## 12. Web vs Android lifecycle distinction

This run targets Chromium visibility and Web Speech callbacks only. It does not equate Web Speech stop/end behavior with Android Native SpeechRecognizer pause/cancel behavior.

Android build/Gate A authority from the same v5.110 runtime is reused from successful runs 38654595600 and 38655489768. No production code changed in this audit. Pixel app switching, OS process suspension, real microphone input and device callback ordering remain untested here.

## 13. Chromium and CI evidence

Latest CI evidence on commit dc1e7afb137ad34c6a1e70cf2b3e4406a2e72492:

- Application/Chromium run 38675238173: FAIL because all ten hidden-page browser checks plus the Vocabulary hidden-page check failed to establish document.visibilityState hidden. Test summary: 633 total, 620 passed, 11 failed, 2 pre-existing skips, 0 TODO. The hidden tests failed before background production behavior was exercised.
- Vocabulary validation run 38675238174: PASS.
- Paraphrase scope guard run 38675238123: PASS.
- The Application workflow’s speech and vocabulary validation step: PASS.
- Existing Issue #342 negative controls: PASS as listed above.
- The ordinary successful real-session fixture recorded no external requests, uncaught page errors or notification permission requests. Because hidden finalization was not reached, this is not hidden-path console evidence.

The CI failure is retained rather than converted into a synthetic-only or skipped PASS.

## 14. Findings

Confirmed production findings: P0 0, P1 0, P2 0.

Unverified risk: source inspection shows the background finalizer awaits stopRec while recognition is active. BG-07/BG-08 did not reach the production stop request, so an end-never-arrives hang is not confirmed and no production issue was opened.

Audit blocker: the available headful Chromium/Xvfb target/window activation procedure did not make the application document hidden, even with separate windows at identical bounds and the target X11 window active. This is recorded as an E2E environment limitation, not a product severity finding.

## 15. Issue #210 acceptance update

Parent Issue #210 remains OPEN. Its previous “Hidden-page visibilitychange finalization: NOT_VERIFIED” status is retained and linked to this report. No remediation issue URL is listed because no production defect was exercised or confirmed.

Browser lifecycle acceptance is NOT_VERIFIED. Do not mark the hidden-page objective accepted from these runs.

## 16. Remaining physical-device acceptance

Physical-device acceptance remains an independent outstanding task:

- Pixel app-switch/background behavior and process suspension.
- Real microphone capture and Android SpeechRecognizer callback ordering.
- PR #323 Pixel ASR-08D acceptance.
- Device screenshots and interaction review.

The next browser task is to establish a Chromium CI method that produces a genuine visible-to-hidden document transition and event, then rerun the BG matrix. Keep Issue #210 open until browser and device acceptance evidence is complete.
