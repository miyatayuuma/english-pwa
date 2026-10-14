# Issue #210 Real-Session Integration E2E Audit

**Audit outcome:** `ISSUE #210 E2E AUDIT COMPLETE / REMEDIATION REQUIRED`

**Browser integration:** production flows verified on Chromium; one P0 interim-ASR defect reproduced and filed as [Issue #342](https://github.com/miyatayuuma/english-pwa/issues/342).
**Device acceptance:** `DEVICE_PENDING`; no physical microphone, Android SpeechRecognizer, or Pixel visual claim is made.

## 1. Latest main authority

| Item | Authority |
|---|---|
| Repository | `miyatayuuma/english-pwa` |
| Latest main at audit start | `179ee55f51f663dfc5acf2cbacde23a44a96d970` |
| `APP_VERSION` | `v5.109` |
| Runtime merge in baseline | `cc524fdef1ea7d24cd43222d307b5a5d8398f369` |
| Audit branch | `audit/issue210-real-session-e2e` |
| Audit PR | [#341](https://github.com/miyatayuuma/english-pwa/pull/341), targeting `main` |
| Production JS/CSS changes | None |
| Vocabulary blob | `91324d35b2db1911ece2cf3ff746409d321fe963` (unchanged) |
| Items blob | `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb` (unchanged) |
| Parent Issue #210 | Open; physical-device acceptance remains |

The audited production source SHA is the latest main above. The browser suite, fixture, workflow guard, and this report are test/audit-only changes.

## 2. Test methodology

`tests/issue210RealSession.browser.test.mjs` creates an isolated Playwright Chromium context for each scenario with a fixed UTC clock (`2026-10-14T12:00:00Z`), 390×844 viewport, clean storage, blocked non-local requests, and rows selected from production `data/items.json`. It does not request notification permission or use a microphone or user audio.

The test operates the production home, options, session, correction, return-to-home, and result UI. The Web Speech mock supplies only raw recognizer-boundary events. Production recognition control, Read grading, `evaluateLevel()`, SRS writes, study-log updates, relationship calculations, finalization, `buildExchangeResult()`, and result rendering run unchanged.

The browser fixture records attempt ID, primary transcript, segment index, final/interim state, N-best alternatives and ranks, completion state, and recognition-complete flag. The test does not dispatch a synthetic session-result event or write result-screen HTML.

## 3. Production lifecycle mapping

1. The home CTA and `sessionShell.js` options use `sessionOptionsCore.js` and `adaptiveLearning.js` to build the selected plan. `relationshipMode.js` captures the before-session relationship snapshot.
2. `main.js` starts the session and creates the production recognition controller in `scripts/speech/recognition.js`. Browser input enters as Web Speech result events.
3. The stop path in `main.js:stopRec()` consumes the controller outcome, selects/aligned hypotheses, grades through production Read logic and `evaluateLevel()`, updates SRS through level state, updates session metrics, and records pass progress through `recordStudyProgress()`.
4. A failed Read result stays on its item and enters Correction. Correction attempts have separate recognizer attempt IDs and do not rewrite the original SRS failure or add a pass to the study log.
5. Completing the last card calls `finalizeActiveSession({reason:'completed'})`, records the `session_closure`, emits the production `english-pwa:session-result` event, and shows `reviewCompleteView`. Relationship mode reconciles the event and before/after relationship data through `buildExchangeResult()`.
6. The production home-return control ends the current session with reason `idle` and returns home without the normal completed-session result screen.
7. Source inspection maps `visibilitychange` to `background` finalization. A hidden-page transition is not exercised by this browser suite and remains `NOT_VERIFIED`.

## 4. Finalized-ASR injection boundary

For an ordinary final result, the mock delivers a Web Speech result with `isFinal:true`, then the real UI stop action invokes the production controller's terminal path. At the point of injection the controller evidence is still `completionState:'pending'` and `recognitionComplete:false`; the controller, not the fixture, determines the final outcome. The successful scenarios assert a positive attempt ID, primary transcript, one segment, rank-zero candidate, and final state.

The negative controls deliver rank-zero and rank-one alternatives as distinct candidates, separate correction attempts, technical errors, silence, and an interim-only result. The interim case is deliberately retained as an executable TODO because Chromium reproduced a production false PASS; it is **not** reported as passing protection.

## 5. E2E A — successful session

**Scenario ID:** `SUCCESS-RESULT-PERSIST`

**Source / version:** `179ee55f51f663dfc5acf2cbacde23a44a96d970` / `v5.109`
**Selected production items:** E0006, E0007; Continue starts a new session with E0035.

The UI starts a two-card manual session for Bob. Each injected event is final, rank zero, with one segment. E0006 receives its exact production sentence; E0007 receives its exact production sentence.

| Item | Before | After production grade |
|---|---|---|
| E0006 | Level 2; due at fixed time −12h; no no-hint history | PASS, `lastMatch=1`; remains level 2 under the existing promotion spacing rule; one no-hint timestamp; next due fixed time +24h |
| E0007 | Level 3; two spaced no-hint timestamps; due at fixed time −1h | PASS; existing spaced-history gate promotes to level 5; third timestamp recorded; next due fixed time +43.2h |
| Study log | No session pass | 2 passes; closure `reason=completed`, `cardsDone=2`, `conversationCount=2`, `retryConversationCount=0`, `failRate=0` |

The result screen showed `今日の交流結果`, 2 completed conversations, 0 revisits, 0% failure, Bob, intimacy 34→49, and the production rank/notice values for that snapshot. Persisted closure metrics matched the event and result model. Duplicate terminal/final callbacks did not add an SRS write. Opening/closing result details and re-rendering the production view left the result DOM and storage snapshot unchanged.

Continue began a fresh E0035 session without rewriting the prior closure; its completed result showed one conversation. Finish returned home. Refresh preserved SRS, study log, closure, and recent item history. **Expected: production pass/SRS/result agreement with no duplicate write. Actual: observed. Status: PASS.**

## 6. E2E B — failed recognition and Correction

**Scenario ID:** `FAILURE-CORRECTION`; source/version as above; selected item E0006.

A network error and a stopped silent attempt created no SRS record or pass. A finalized rank-zero phrase (`He leaned against`) and rank-one phrase (`gazed at the Statue of Liberty`) remained separate and failed scoring; production stored the original failure (`lastMatch=0.4`, level 1, 10-minute review interval). The wrong speech did not pass.

Correction failure and Correction success used distinct attempt IDs. Neither changed the original failure SRS state nor added a pass entry. The actual completed result reported 1 conversation, 1 revisit, 100% failure, and 0 completed cards; closure metrics agreed. **Expected: original FAIL retained, correction practice separate, no correction SRS/pass write. Actual: observed. Status: PASS.**

## 7. E2E C — interrupted session

**Scenario ID:** `INTERRUPT-IDLE-PERSIST`; selected items E0554 and E0556.

After a final successful E0554 attempt, E0556 was left unanswered and had no SRS entry. Using the production home-return control wrote an `idle` closure with one completed card and one conversation, preserved the E0554 pass, emitted no normal completed-session result event, and returned home. Recent item history retained the selected queue. Refresh preserved the SRS and closure.

The browser also checked filter reset and a new isolated context loaded from the saved fixture state. A zero-candidate options combination remained unstartable until the Section constraint was cleared. A range-browser zero-result search returned to home; the ordinary character CTA started without the old queue or Section/search filter.

**Status:** `PASS` for the production home-return/idle path, unanswered item, closure, and persistence. A page-hidden `visibilitychange` finalization and other direct exit variants remain `NOT_VERIFIED`.

## 8. E2E D — shared-speaker relationship

**Scenario ID:** `SHARED-SPEAKER`; selected production item E0212, speakers Bob and Jane. Before SRS: level 3, two spaced no-hint timestamps, due at fixed time −1h. Final exact answer passed and advanced the item to level 5 using the existing promotion rule.

| Relationship | Before | After |
|---|---|---|
| Bob | 5 points, friend, intimacy 61 | 6 points, close friend, intimacy 75 |
| Jane | 5 points, friend, intimacy 61 | 6 points, close friend, intimacy 75 |
| Ken | 1 point, acquaintance, intimacy 24 | unchanged |

The result for active character Jane showed 1 conversation, 0 revisits, the rank-up, and notices for both Jane and shared speaker Bob. No separate `friendshipPointsV1` currency was persisted.

The milestone fixture separately produced the five-friends notice on a real completed session. The cap fixture passed E0212 at the best-friend intimacy cap: Bob remained at 100, Jane remained at 49, and the result showed 100→100 with no relationship notices. **Expected: relationship derives from proficiency, shared speakers update once, unrelated characters and caps remain stable. Actual: observed. Status: PASS.**

## 9. E2E E — result-screen reconciliation

The success, failure/Correction, shared-speaker, milestone, and cap scenarios reached `reviewCompleteView` from real production session completion. Each reconciled:

- session result event to persisted `studyLogV1.session_closure`;
- completed and revisit counts to the saved summary;
- relationship before/after snapshots to the rendered rank, intimacy, and notices;
- renderer output to production `buildExchangeResult()`;
- failure text to the summary failure rate.

Re-render and result-detail open/close did not change SRS, study log, or result event count. Continue began the next session without re-closing the previous summary; Finish returned home. The interim-only false-PASS result remains the explicit exception tracked as P0 #342. Normal result reconciliation: **PASS**. Interim protection: **FAIL**.

## 10. E2E F — session options lifecycle

The browser selected Bob, `future_will`, and Section 19; the production UI showed zero candidates and disabled start. Clearing Section and choosing Section 45 enabled a manual E0554/E0556 queue. After E0554 passed and the session returned home, the selected character was retained while grammar, Section, manual IDs, and mode reset to the ordinary automatic default. Legacy Section, search, sort, and level filter values were cleared/reset.

Refresh and a new context seeded with saved test state retained committed SRS/log data. Range-browser zero-result return and a subsequent normal CTA did not reuse the temporary queue or filters. **Expected: one-session filters clear, appropriate character selection persists, normal start is clean. Actual: observed for these browser paths. Status: PASS.**

## 11. E2E G — persistence and idempotence

Observed stores include `itemLevelV1`, `studyLogV1`, `recentSentenceSessionIdsV1`, `recentCharacterSessionsV1`, plus Section/search/order/level filter values.

Verified controls: home/options inspection made no SRS write; technical error and silence made no pass; finalized duplicate callbacks did not double-write; ranked alternatives did not combine; Correction did not mutate original SRS/pass history; unanswered cards were not marked complete; result re-render/details did not write learning history; Continue did not close the prior summary again; refresh preserved committed state; unrelated-character relationship stayed fixed; old queue and filters did not leak into ordinary start.

Study-log closure checks compare semantic closure contents and fixed timestamp, not raw `studyLogV1` setItem call counts. The suite does not claim page-hidden finalization coverage.

## 12. Browser and regression evidence

- PR [#341](https://github.com/miyatayuuma/english-pwa/pull/341), head `5e7070302bb747ec985562884a3ec35886cb185a` during this evidence run.
- [Application / Chromium workflow run #979](https://github.com/miyatayuuma/english-pwa/actions/runs/38580443623), failed-job rerun job `115910849333`: **616 tests, 613 pass, 0 fail, 2 skipped, 1 TODO**; job conclusion `success`. The TODO is the reproduced interim P0 and is not counted as acceptance. The two skips are existing ASR-09C and ASR-09D Chromium-specific tests; their dedicated validators below passed.
- The first attempt on this same head hit an existing `audioFolderRestore.browser.test.mjs` wait timeout. Re-running the failed job passed without changing that test.
- [Vocabulary workflow run #666](https://github.com/miyatayuuma/english-pwa/actions/runs/38580443520): PASS.
- [Scope guard workflow run #132](https://github.com/miyatayuuma/english-pwa/actions/runs/38580443387): PASS.
- Local `npm ci`: completed. Local `npm test`: 518 pass, 0 fail, 98 browser skips because this container had no usable Chromium. Those skips are not Chromium acceptance.
- `npm run vocab:check-derived`, `npm run vocab:validate`, `npm run speech:validate-td-cluster-before-to`, and `npm run speech:validate-asr-09b`, `09c`, `09d`: PASS.
- CI sets `ISSUE210_REQUIRE_BROWSER=1`; a missing Chromium executable fails the Issue #210 browser suite instead of being treated as a pass.
- Browser diagnostics reported zero external requests, zero page errors, and zero notification permission requests in the covered scenarios.

## 13. Findings

### P0 — interim-only exact candidate is persisted as a successful attempt

- **Issue:** [#342](https://github.com/miyatayuuma/english-pwa/issues/342), open; repair is outside PR #341.
- **Scenario:** `INTERIM-NEGATIVE`, item E0006, fixed time 2026-10-14T12:00:00Z.
- **Input evidence:** attempt 1, rank 0, one segment; `isFinal=false`, `recognitionComplete=false`, `completionState='pending'`; transcript exactly matches the production target.
- **Expected:** interim-only input produces no grade PASS, SRS change, or pass log.
- **Actual:** storage acquired an E0006 record with `lastMatch=1`, `last=0`, `best=0`, one no-hint timestamp, `level5Count=1`, and next due 24 hours later; `studyLogV1` recorded `passes=1` and `no_hint=1`.
- **Cause indicated by source and reproduction:** `recognition.js` finalizes a stopped preview as terminal without requiring the preview segment to be final. `recognitionCandidates.js` then treats terminal completion as complete and retains the primary candidate. `main.js` grades that exact transcript and reaches the production SRS/pass path.
- **Evidence:** executable Chromium test #179 is an explicit TODO with its failing storage assertion retained; CI logs include raw ASR event and before/after snapshots.
- **Severity:** P0 under the audit's data-integrity/incorrect-confirmation definition.
- **Repair scope:** separately harden the final-evidence contract and add regression coverage in the remediation issue. No production repair is included in this audit PR.

No P1 or P2 defects were confirmed in the covered flows.

## 14. Issue #210 acceptance reconciliation

This audit establishes browser evidence for the conditions below; it does not convert all child issues into full acceptance or close #210.

| Child | Reconciliation |
|---|---|
| #204 relationship values | PARTIAL: shared-speaker, cap, milestone, and unrelated-character snapshots reconcile; not every prior screen/surface was re-audited |
| #205 automatic selection | Prior PASS remains; this audit does not broaden that claim |
| #206 session options | PASS for tested zero-candidate, custom queue, reset, range return, reload/new context, and normal CTA paths |
| #207 home/navigation | PARTIAL: tested production browser flows after #339/#340; physical visual acceptance remains |
| #208 conversation/scoring | PARTIAL: final Read, failure, correction, technical error, and silence paths pass; interim false-PASS is P0 #342 |
| #209 result screen | PARTIAL: normal completed session data reconciles; interim defect requires remediation before full acceptance |

The Issue #210 checklist remains open where full acceptance is not established. Parent Issue #210 stays OPEN. PR #323 / Pixel ASR-08D is outside this task.

## 15. Physical-device remaining checks

- Real microphone capture and Android SpeechRecognizer behavior.
- Pixel visual acceptance, layout, scrolling, touch behavior, and real screen transitions.
- Audible speech/TTS interaction during correction.
- Hidden-page `visibilitychange` finalization on the browser/device lifecycle.

**Target after the P0 repair and later device checks:** `ISSUE #210 BROWSER INTEGRATION ACCEPTED / PHYSICAL DEVICE ACCEPTANCE PENDING`. This audit does not claim that target has been reached.
