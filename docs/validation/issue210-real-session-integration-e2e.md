# Issue #210 Real-Session Integration E2E Audit

**Audit state:** Chromium CI evidence pending. This report does not claim browser acceptance until the required `Application tests` Chromium job runs the new tests.

## 1. Latest main authority

| Item | Authority |
|---|---|
| Repository | `miyatayuuma/english-pwa` |
| Initial main | `179ee55f51f663dfc5acf2cbacde23a44a96d970` |
| `APP_VERSION` | `v5.109` |
| Audit branch | `audit/issue210-real-session-e2e` |
| Production JS/CSS changes | None |
| Vocabulary / item data changes | None |
| Parent issue | #210 remains open; physical-device acceptance is pending |

The SHA above matches the supplied 2026-10-14 baseline and the current remote main observed before work. The new work is test, helper, workflow, and report content only.

## 2. Test methodology

`tests/issue210RealSession.browser.test.mjs` creates a fresh Playwright `BrowserContext` per scenario. It serves production application files locally, supplies selected rows from `data/items.json`, fixes the browser clock to `2026-10-14T12:00:00Z`, blocks non-local requests, and uses new LocalStorage and sessionStorage. Notification permission is observed but never requested by the test. No real microphone or speech file is used.

The browser test drives the production home, session-options, microphone, correction, home-return, and result controls. The SpeechRecognition mock supplies raw Web Speech result events at the recognizer boundary; it records attempt ID, primary transcript, segment index, ranked alternatives, final/interim flag, and the provider end callback. Production recognition handling, grading, `evaluateLevel()`, SRS writes, `recordStudyProgress()`, relationship calculations, session finalization, `buildExchangeResult()`, and result rendering remain active.

This layer does not simulate Android SpeechRecognizer, physical microphone behavior, or audible speech quality. Those remain device checks.

## 3. Production lifecycle map

1. The home CTA and `sessionShell.js` options form select a production item plan through `sessionOptionsCore.js` / `adaptiveLearning.js`. Character starts snapshot relationship state in `relationshipMode.js`.
2. `main.js` starts the real session and `recognition.js` creates the recognition controller. Browser input enters as Web Speech result events and retains segment and N-best rank boundaries.
3. On stop, `main.js:stopRec()` requests the controller outcome, evaluates hypotheses through production alignment and Read grading, calls the level-state manager, writes SRS, updates session metrics, and writes pass-only study progress.
4. A failed Read grade records the failure and enters `correctionProgress`; Correction attempts are practice-only and do not call the SRS or pass-log update path.
5. Completing the last card runs `finalizeActiveSession({reason:'completed'})`, records `studyLogV1.session_closure`, emits the real `english-pwa:session-result`, and displays `reviewCompleteView`. `relationshipMode.js` recalculates the relationship catalog, calls `buildExchangeResult()`, and renders the result.
6. Home return during a session follows the existing `learningMenu.js` finish action and `showIdleCard()` path. It stores an `idle` closure and returns home without presenting the normal completed-session result.
7. `visibilitychange` uses the existing `background` finalization path. It is source-mapped here but will remain `NOT_VERIFIED` unless the browser test exercises a real hidden-page transition.

## 4. Finalized-ASR injection boundary

The fixture records raw provider events separately from terminal delivery. Ordinary success cases emit a final result and then stop the recognizer through the UI. The N-best negative control places two incomplete phrases at different ranks in one result; the test checks that production grading cannot splice them. The duplicate-callback control redelivers final and end callbacks on the same mock recognizer after the real result has been committed.

The browser fixture does not label its own provider end callback as production `completionState`. The controller implementation in `scripts/speech/recognition.js` is responsible for setting terminal completion evidence after `onend`; `tests/recognitionContext.test.mjs` covers that controller contract. Browser CI will verify the persistence behavior that follows the delivered terminal callback.

## 5. Scenario matrix

All browser cells below remain `NOT_VERIFIED` until the required Chromium workflow completes. Item IDs refer to actual production rows; their English text is injected only as deterministic ASR fixture content.

| Scenario | Items | Intended evidence | Status |
|---|---|---|---|
| Success, result re-render, Continue, Finish, reload | E0006, E0007, E0035 | Real Read PASS; due SRS update; Lv5 promotion gate; study log; completed closure; builder/UI reconciliation; no duplicate writes; persistence | NOT_VERIFIED |
| Failure and Correction | E0006 | Technical error has no pass write; separate N-best ranks fail; Correction failure and success remain separate from original SRS failure | NOT_VERIFIED |
| Interim negative control | E0006 | Interim-only exact transcript cannot write SRS, display PASS, or increment study log | NOT_VERIFIED |
| Interrupted custom session / options reset | E0554, E0556, E0037, E0212 | One completed card persists; unanswered card stays unrecorded; `idle` closure; character/grammar/Section/manual selection; zero-candidate recovery; stale filters and queue do not leak; reload and isolated-context saved-state check | NOT_VERIFIED |
| Shared speakers | E0001, E0006, E0037, E0212 | Bob and Jane both derive progress from one shared item; Ken remains unchanged; active result reports shared progress | NOT_VERIFIED |
| Rank/milestone result | E0001, E0010, E0016, E0212 | Real rank transition produces the production five-friends milestone notice and matching result values | NOT_VERIFIED |
| Intimacy cap | E0006, E0007, E0035, E0037, E0212 | Real pass at best-friend cap changes SRS but leaves capped relationship snapshots unchanged | NOT_VERIFIED |

## 6. Persistence and negative controls

The browser suite observes `itemLevelV1`, `studyLogV1`, `recentSentenceSessionIdsV1`, `recentCharacterSessionsV1`, and the legacy filter keys `secSel`, `itemSearchV1`, `orderSel`, and `levelFilterV1`. It compares stored closure metrics with the real result event and tests refresh in both the original context and a new isolated context seeded with the saved test data.

Covered controls include home/options-only SRS immutability, technical-error no-pass behavior, interim-only behavior, split N-best ranks, failed and successful Correction practice, duplicate terminal callbacks, unanswered cards, details open/close, result re-render, Continue idempotence, interruption persistence, and normal-launch exclusion of the previous manual queue. Visibility-hidden finalization and returning specifically from the range browser are not exercised by this suite.

## 7. Browser and regression evidence

- Local `npm test`: PASS for unit tests; browser cases SKIP because this container has no usable Chromium. This is not counted as browser acceptance.
- `npm run speech:validate-td-cluster-before-to`: PASS.
- `npm run speech:validate-asr-09b`: PASS.
- `npm run speech:validate-asr-09c`: PASS.
- `npm run speech:validate-asr-09d`: PASS.
- `npm run vocab:check-derived`: PASS.
- `npm run vocab:validate`: PASS.
- New browser tests have `ISSUE210_REQUIRE_BROWSER=1` in the existing Chromium CI invocation. CI failure to launch Chromium fails the job rather than silently skipping.
- Chromium CI result: pending.

Test diagnostics include per-scenario before/after SRS snapshots, relationship snapshots, raw injected ASR evidence, result DOM values, closure metrics, and request/permission observations. They contain no user voice or learning history.

## 8. Findings

No production defect is classified from source inspection alone. A suspected interim-to-grade path is under direct browser test; it will be recorded as a finding only if the Chromium scenario reproduces it. Any confirmed defect will retain its failing assertion, be filed as a separate issue, and remain outside this audit PR's production code.

| Severity | Finding | Status |
|---|---|---|
| P0 | None confirmed | — |
| P1 | None confirmed | — |
| P2 | None confirmed | — |

## 9. Issue #210 reconciliation

Parent Issue #210 will remain open. The browser checklist and child-issue evidence will be updated only for conditions that pass in Chromium CI. Physical-device visual and microphone acceptance remains `DEVICE_PENDING`; PR #323 is outside this audit.

## 10. Physical-device remaining checks

- Real microphone capture and Android SpeechRecognizer behavior.
- Real-device visual acceptance and layout.
- Device-specific audio / TTS interaction during correction.
- Browser visibility-hidden finalization unless separately covered in CI.

**Current target state:** `ISSUE #210 BROWSER INTEGRATION ACCEPTED / PHYSICAL DEVICE ACCEPTANCE PENDING` — not yet achieved until Chromium CI evidence is recorded.
