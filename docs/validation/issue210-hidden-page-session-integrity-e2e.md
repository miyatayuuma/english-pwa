# Issue #210 Hidden-Page Session Integrity E2E

**Audit status:** IN PROGRESS — NOT ACCEPTED. Browser execution evidence is pending.

## 1. Authority at audit start

| Item | Authority |
|---|---|
| Repository | \`miyatayuuma/english-pwa\` |
| Latest \`main\` at audit start | \`447063b6160ce3919a369dd7136512d41fafd6ce\` |
| \`APP_VERSION\` | \`v5.110\` |
| P0 finality repair | PR [#343](https://github.com/miyatayuuma/english-pwa/pull/343), merged |
| Parent Issue | [#210](https://github.com/miyatayuuma/english-pwa/issues/210), OPEN |
| Pixel ASR-08D | PR [#323](https://github.com/miyatayuuma/english-pwa/pull/323), OPEN / device acceptance pending |
| Audit branch | \`audit/issue210-hidden-page-integrity\` |

Protected production data blobs at the audited main SHA:

- \`data/vocabulary-v3.json\`: \`91324d35b2db1911ece2cf3ff746409d321fe963\`
- \`data/items.json\`: \`ae2aca768b784199b77ac1cf8c0c5a80fd5725bb\`
- \`data/characters.json\`: \`1d0c61711d763373e1f587ecde16ff9f07cb1a45\`

The audit changes only the existing real-session browser test and this report. Production code, app version, SRS rules, ASR rules, and data are not changed.

## 2. Production lifecycle inspected

The production path in \`scripts/app/main.js\` is:

\`document.visibilitychange\` → require \`document.visibilityState === 'hidden'\` → \`finalizeActiveSession({ reason: 'background' })\` → stop audio and pending mic start → await \`stopRec()\` for active recognition → finalize session metrics and persist \`session_closure\` → clear session state → return home.

The recognition controller in \`scripts/speech/recognition.js\` creates a pending Promise in \`stop()\`. In the inspected source, it is settled by provider \`end\`, a terminal error, or a synchronous exception from \`stop()\`; there is no timeout or independent background-cancel path in this Web Speech stop path. BG-08 is designed to validate this liveness risk in Chromium. The source observation alone is not counted as runtime acceptance evidence.

\`stopRec()\` also returns early when \`stopRecPending\` is already true. The E2E therefore includes hidden/duplicate-hidden and hidden/manual overlaps while the first stop is still pending.

## 3. Test architecture

The tests extend \`tests/issue210RealSession.browser.test.mjs\` so they reuse its existing isolated BrowserContext, production item fixtures, fixed clock, real session UI, Web Speech boundary mock, SRS and study-log snapshots, result-event capture, and browser-error checks. A separate hidden-page file would duplicate or improperly import the existing test module's private fixture.

Only provider events are controlled. The production visibility handler, Recognition controller, grading, SRS writes, study-log writes, session metrics, and home/result UI remain in the exercised path.

The fixture records \`visibilitychange\` state and timestamps before production scripts load. For actual hidden-page scenarios, a second Chromium page in the same context is foregrounded and the app page must report \`document.visibilityState === 'hidden'\`. A synthetic event is used only as the duplicate-event variant after a real hidden transition.

## 4. Scenario matrix

All results remain PENDING until the required Chromium workflow completes. A finding-reproducer test may pass as a test while documenting a production defect; its result is not an acceptance PASS.

| ID | Scenario | Planned evidence |
|---|---|---|
| BG-01 | Hide immediately after start | Real hidden state, background closure, no SRS/pass for unanswered item |
| BG-02 | Hide after one committed answer | Committed item retained; next item ungraded |
| BG-03 | Exact primary interim only | No SRS/pass and no result event |
| BG-04 | Exact interim N-best at rank 1 | No SRS/pass despite exact alternative |
| BG-05 | Final answer fully graded before hide | One SRS/pass commit survives background closure |
| BG-06 | Final callback around the hidden boundary | Event ordering plus at-most-once SRS/pass measurements |
| BG-07 | Provider end deliberately delayed | No closure before end; safe background closure after end |
| BG-08 | Provider end withheld | Liveness reproduction; expected P1 finding if closure remains pending |
| BG-09 | Duplicate hidden event while stop is pending | One semantic closure and one closure write |
| BG-10 | Hidden transition racing production home-return | Closure reason, event order, and one semantic closure |
| BG-11 | Return visible after background closure | No automatic session/mic restart |
| BG-12 | Old callback after closure and a new session | Old attempt cannot update the new item |
| BG-13 | Reload after background closure | Committed SRS and closure persist |
| BG-14 | Start a normal session after interruption | Temporary manual IDs/options are reset |
| BG-15 | Correction attempt active during hide | Original FAIL remains; no correction PASS/SRS write |
| BG-16 | Read Cloze stage active during hide | Interim full-sentence attempt remains NO GRADE |

## 5. Finality and storage contract

Existing #342 negative controls remain in the full application test suite. The added BG-03/BG-04 cases supply interim-only and exact rank-1 interim speech, then trigger a real hidden transition. The assertions compare complete \`itemLevelV1\` snapshots, pass counts, SRS write counts, and result-event count.

BG-05 uses the existing production final answer path and waits for the actual SRS value before hiding. BG-06 records the provider result, stop request, terminal callback, visibility event, persisted SRS, pass count, and closure. Its observation will distinguish the final callback's arrival relative to hidden; the final report will state whether the current boundary is acceptable or requires a separate decision/repair.

The \`studyLogV1.session_closure\` value is treated as an overwriteable summary. Tests compare the semantic closure and count writes separately, so an idempotent same-value write is not mistaken for a duplicate pass.

## 6. Resume, Correction, Cloze, and platform boundary

BG-11 verifies foreground return after closure; BG-12 delivers an old attempt's final callback only after a new session starts; BG-13 reloads the same isolated browser storage; BG-14 inspects reset options before a normal character start.

BG-15 first commits a real failed Read attempt, then hides during a separate interim-only Correction attempt. BG-16 enters the production progressive Read Cloze stage via its existing hint event, verifies masked tokens, and hides during interim speech.

These Chromium tests do not claim Android lifecycle equivalence. Android \`handleOnPause()\` and native \`BACKGROUND_CANCELLED\` remain a separate lifecycle contract. Same-runtime Android build/Gate-A evidence may be reused because this audit has no production changes; no Pixel microphone, OS process-kill, or real-device app-switch claim is made.

## 7. Regression and CI

The required Application workflow installs headless Chromium and sets \`ISSUE210_REQUIRE_BROWSER=1\`. That run must execute the existing Issue #210 real-session tests and all added hidden-page tests without new skips or TODOs. Vocabulary/speech validators run in the same Application workflow.

The following evidence is pending:

- Chromium Application workflow URL, test counts, hidden-state diagnostics, and console/page errors.
- Final report with per-scenario outcomes and any Finding issue URL.
- Post-PR protected-blob comparison and latest-main reconciliation.

## 8. Preliminary finding review

No runtime finding is declared in this draft. Static source inspection identifies a potential P1 liveness failure if the Web Speech provider never emits \`end\` or an error after \`stop()\`. BG-08 must reproduce or falsify this under a real Chromium hidden transition before severity and issue status are finalized.

No new Issue #210 acceptance claim has been posted yet. Parent #210 will remain OPEN, and Pixel device work remains separate.
