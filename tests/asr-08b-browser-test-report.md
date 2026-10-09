# ASR-08B Chromium Browser Regression Report

Date: 2026-10-09

## Baseline and environment

- Repository: `miyatayuuma/english-pwa`
- Starting `main` SHA: `bae575c2b250aa6388ae5a984504b65ec98173a5` (rechecked before PR; unchanged).
- APP_VERSION: `v5.98`; no production version or service-worker update was made.
- Branch: `fix/asr-08b-browser-terminal-mocks`.
- Runtime: Node.js `v24.19.0`, npm `11.9.0`, Playwright `1.62.1`, Chromium `151.0.7922.34` headless.
- Browser tests ran against an actual Chromium process. `REORDER_REQUIRE_BROWSER=1` was set for suites that support it; every executed suite reported zero skips.

## Before / after

|Metric|Before|After|
|---|---:|---:|
|Chromium PASS|43 / 85|85 / 85|
|Chromium FAIL|42|0|
|Chromium SKIP|0|0|
|Full `npm test` PASS|481 / 523|527 / 527|
|Full `npm test` FAIL|42|0|
|Full `npm test` SKIP|0|0|

The four-test increase in `npm test` is from the new recognition-context lifecycle unit coverage. The browser population is still 85 registered test cases.

|Chromium test file|Before|After each run|
|---|---:|---:|
|`tests/reorderProduction.browser.test.mjs`|11 PASS / 7 FAIL|18 PASS / 0 FAIL / 0 SKIP|
|`tests/vocabularyMode.browser.test.mjs`|9 PASS / 34 FAIL|43 PASS / 0 FAIL / 0 SKIP|
|`tests/reorderBrowser.test.mjs`|11 PASS / 0 FAIL|11 PASS / 0 FAIL / 0 SKIP|
|`tests/audioFolderRestore.browser.test.mjs`|6 PASS / 1 FAIL in parallel full run|7 PASS / 0 FAIL / 0 SKIP|
|`tests/zeroSetup.browser.test.mjs`|6 PASS / 0 FAIL|6 PASS / 0 FAIL / 0 SKIP|

The audio-folder timeout was a `page.waitForFunction` timeout under the full parallel baseline run. Its standalone Chromium rerun passed 7/7 before edits, and all three serial stability runs passed 7/7. No ASR event was involved.

## Baseline failures and event observations

All 41 ASR-related baseline failures were timeouts rather than assertion mismatches or page exceptions. The Reordering mock had `stop(){}` and never emitted `onend`. The Vocabulary mock emitted `onend` from `stop()` but its result-injection methods only called `onresult`; most tests expected a finalized result to be graded without a terminal callback. The baseline mocks did not record event traces, so the “last event” below is inferred from each test’s call sequence and the old mock implementation. The last relevant event on each stalled ASR attempt was a result injection; that attempt did not receive a usable terminal completion.

The Reordering Production `submitFullUtterance` timeout used a 5-second grade wait; the remaining ASR failures used 30-second `page.waitForFunction` waits. The single non-ASR audio-folder failure used a 30-second wait and passed in isolation.

|File|Test|Before|Baseline error|Last observed event|Terminal|After|
|---|---|---|---|---|---|---|
|`tests/reorderProduction.browser.test.mjs`|production render keeps canonical English out of DOM and accessible text until delayed metadata activates reordering|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|stale metadata safely disables Reordering with skip, no speech fallback or SRS write|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|production read mode keeps canonical English visible and does not request reorder metadata|FAIL|TimeoutError: page.waitForFunction; 5000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 0 wrong submissions, existing Lv0, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 0 wrong submissions, existing Lv5, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 1 wrong submissions, existing Lv0, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 1 wrong submissions, existing Lv5, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 2 wrong submissions, existing Lv0, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 2 wrong submissions, existing Lv5, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 3 wrong submissions, existing Lv0, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 Reordering 3 wrong submissions, existing Lv5, speech isolated|PASS|—|—|—|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 normal read baseline uses primary score/highlight without whole-sentence bias|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|normal read FAIL correction is practice-only through repeated failure and automatic successful advance|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 read Cloze 1 targets preserve concealment and score a complete N-best sentence while showing raw primary|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 read Cloze 3 targets preserve concealment and score a complete N-best sentence while showing raw primary|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|normal correction lexical ×3 closes without multiplying penalties|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|normal correction technical ×3 closes without multiplying penalties|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderProduction.browser.test.mjs`|390×844 long compound workspace scrolls; native full-item audio never starts ASR and next works during playback|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|390×844 expression card preserves active source, strict paraphrase grade, and context/audio|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|canonical grammar role wins over paraphrase POS and legacy kind labels|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Vocabulary carrier cue stays subtle, emphasizes lexical misses, pulses once, and resets on the next card|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|carrier-bearing homophone answer keeps provider transcript visible and uses the result grammarRole|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|1280×900 vocab:00111 result hierarchy fits without collapsed scrolling|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|360×640 vocab:00111 result hierarchy fits without collapsed scrolling|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|390×844 vocab:00111 result hierarchy fits without collapsed scrolling|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|vocab:01387 shows the sufficiency prompt and will do target without a temporal paraphrase|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|result tap ignores audio/context controls and selected text, then advances once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|only a dominant left swipe advances; short, vertical, and right movements do nothing|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|PARAPHRASE result uses the shared target-first answer block without duplicate explanation|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|removed force paraphrase is not accepted after audit revalidation|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|word reveal is MISS while construction source realization remains automatic TARGET|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|chunked ASR preview stays cumulative and final evidence remains ungraded until terminal|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|390×844 live transcript wraps in full without clipping or horizontal overflow|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|technical ASR error leaves the same card unresolved and allows another attempt|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|answer reveal snapshots partial raw ASR and records one final MISS|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|manual stop and delayed final terminal paths grade each attempt exactly once|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|unsupported speech disables Vocabulary start and never offers manual grading|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web Vocabulary retains strict TARGET context and N-best without phrase bias, preserves raw output|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|native TARGET rescue preserves raw primary, answer authority and exactly one SRS write|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|a TARGET in an interim segment cannot rescue a terminalized Vocabulary attempt|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|primary Vocabulary containment accepts extra words, preserves raw transcript, and writes SRS once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|TARGET-internal interruption remains a MISS under primary containment|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|correction completes on a contained strict TARGET without an extra SRS write|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|all-MISS review supports unlimited fresh retries, focus, stale-event isolation and TARGET without penalty|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|retry primary PARAPHRASE leaves SRS unchanged|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|answer correction rejects paraphrase, handles technical error, requires primary TARGET and preserves MISS exactly once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|correction completion and source audio end keep the result until explicit swipe|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|correction result can be manually advanced during source audio playback|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|correct-answer playback holds capture until release and replay safely stops corrective recording|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|interim transcript stays display-only until final terminal evidence arrives|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Vocabulary correction lexical misses ×3 holds result without extra SRS|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Vocabulary correction technical failures ×3 holds result without extra SRS|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web technical error does not automatically retry or grade stale speech, manual retry preserves correction|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|two consecutive technical failures then corrective TARGET exits early without lexical penalty or SRS writes|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|full 2478-entry production dataset starts Vocabulary and selects each existing UI filter|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Android Vocabulary preview never grades partials; manual stop waits for native final and strict N-best rescue writes once|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Android microphone denial is explicit in Vocabulary UI, creates no recognizer and writes no SRS|PASS|—|—|—|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web production Vocabulary strict TARGET at provider rank 1 writes SRS once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web production Vocabulary strict TARGET at provider rank 12 writes SRS once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web production Vocabulary strict TARGET at provider rank 20 writes SRS once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/vocabularyMode.browser.test.mjs`|Web production Vocabulary strict TARGET at provider rank 6 writes SRS once|FAIL|TimeoutError: page.waitForFunction; 30000ms|Result injection on the stalled attempt (inferred; legacy mock had no trace)|Absent|PASS|
|`tests/reorderBrowser.test.mjs`|390×844 supports three, seven, nine, and thirteen tile sentence units without horizontal overflow|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|tap-only completion, canonical feedback, and dedicated completion work end-to-end|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|multi-sentence items expose every shared chunk in one puzzle, including one-chunk turns|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|production E0064 combines all three dialogue turns into one puzzle|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|wrong answers retain their tiles, offer another attempt on try two, and reveal on try three|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|Undo, Reset, keyboard movement, and duplicate visual buttons are operable|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|pointer drag moves a tile between zones and between answer positions|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|schema or source-hash mismatch disables reordering without a word-count fallback|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|the current PWA worker clears old caches and serves reorder metadata offline|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|punctuation-free case-preserved duplicate tiles grade swapped IDs and reject distinct wrong order|PASS|—|—|—|PASS|
|`tests/reorderBrowser.test.mjs`|actual generated 13-tile corpus item renders and completes with the same partition at every playable level|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|saved granted directory restores on boot and supplies audio without permission or picker|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|saved prompt directory waits silently at boot and reacquires permission on the start gesture|FAIL|TimeoutError: page.waitForFunction; 30s (parallel baseline; isolated rerun passed)|N/A (audio-folder boot/permission test)|N/A|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|session-options submit requests saved-folder permission before its deferred session launch|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|denied saved permission keeps the handle and starts with audio fallback|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|saved denied handle is reused if permission is later restored outside the app|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|no saved directory boots without picker or permission request|PASS|—|—|—|PASS|
|`tests/audioFolderRestore.browser.test.mjs`|explicit selection refreshes current audio and explicit clear removes the saved handle|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|fresh install opens home without questionnaire/permissions and starts adaptive learning|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|existing migration preserves progress/method/speed/goals without replaying old onboarding or GAS|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|normal session options create actual QUEUE of 12|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|normal session options create actual QUEUE of 17|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|normal session options create actual QUEUE of 5|PASS|—|—|—|PASS|
|`tests/zeroSetup.browser.test.mjs`|normal session options create actual QUEUE of 8|PASS|—|—|—|PASS|

## Root-cause classification

|Category|Count|Evidence|
|---|---:|---|
|A — Mock lifecycle incomplete|41 observed baseline failures|Result delivery did not complete a recognition attempt with terminal `onend`; stop behavior differed across the two mocks.|
|B — Event ordering mismatch|1 latent case, overlapping A|A repeated correction test attempted the next recording during the production 800 ms microphone release state; the fixture now waits for `micStatus=off` before starting another attempt.|
|C — Test assertion drift|4 latent cases, overlapping A|Two Cloze cases assumed rank-zero-only scoring; one case expected an extra debounce after terminal; one case expected a TARGET from a non-final segment to rescue an answer.|
|D — Production defect|0|The production recognition, scoring, and SRS code remained unchanged; all 85 browser cases and full repository tests passed.|
|Other|1 observed baseline failure|Parallel audio-folder restore timeout; standalone rerun passed before edits.|

Categories B and C were additional issues revealed once terminal events allowed the affected flows to complete; they overlap the 41 initial ASR timeouts and do not add to the 42 observed baseline failures.

## Mock contract and lifecycle validation

`tests/helpers/mockSpeechRecognition.mjs` supplies attempt IDs and per-attempt event records. `start()` enters active state; `inject()` / `emitFinal()` / `emitInterim()` deliver result evidence but never end recognition. Normal `stop()` requests terminal completion; `stopPlan` can hold terminal, deliver a final after the stop request, or delay terminal delivery. `emitEnd()` tracks duplicate terminal notifications. `emitError()` and `abort()` use separate error/cancel paths. Alternatives are exactly those supplied by each test; the mock does not synthesize candidates. Each Playwright page context receives a fresh recognizer and fixture state.

|Lifecycle case|Result|
|---|---|
|manual stop → final result → `onend`|PASS|
|final result → manual stop → `onend`|PASS|
|final result → `onend` auto-stop|PASS|
|delayed final after stop request; no grade before terminal|PASS|
|duplicate `onend`; maximum one grade/SRS write|PASS|
|interim-only then terminal; no partial grade|PASS|
|finalized result preserves raw primary separately from selected N-best score|PASS|
|error/cancel and stale callbacks|PASS|

Representative event traces asserted in Chromium include `start → result → end` for auto-stop, `start → result → stop-request → end` for manual stop, and `start → stop-request → result → end` for a delayed final. A duplicate terminal event leaves the observed SRS write count at one. The 1,200 ms preview test now asserts no grade before terminal and grade after the terminal event; it no longer imposes a debounce after valid terminal evidence. A lower candidate from an interim segment cannot be promoted as finalized N-best evidence.

## Validation

- Focused Reordering Production: 18/18 PASS.
- Focused Vocabulary Mode: 43/43 PASS.
- All 85 Chromium cases: 85/85 PASS, 0 FAIL, 0 SKIP on each of 3 consecutive serial runs.
- `npm test`: 527 PASS, 0 FAIL, 0 SKIP.
- `npm run speech:validate-td-cluster-before-to`: PASS.
- `npm run vocab:check-derived`: PASS.
- `npm run vocab:validate`: PASS.
- Added/changed JavaScript syntax: PASS; `git diff --check`: PASS.
- Production files and APP_VERSION unchanged; Vocabulary data and semantic authorities changed: 0.

## Change scope

Changed files are test-only: `tests/helpers/mockSpeechRecognition.mjs`, `tests/recognitionContext.test.mjs`, `tests/reorderProduction.browser.test.mjs`, and `tests/vocabularyMode.browser.test.mjs`, plus this report. No test was removed or skipped, no timeout was extended, and no production or Vocabulary data files were modified.

Unresolved blockers: none observed. The 800 ms UI release wait and the four assertion updates are documented above and covered by the passing browser suite.
