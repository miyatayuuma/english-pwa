# English PWA — Mode-Aware Session Options UX Design Audit

**Status:** MODE-AWARE SESSION OPTIONS UX DESIGN AUDIT CLOSED / IMPLEMENTATION READY
**Audit type:** Design-only; no production implementation
**Date:** 2026-10-15

## 1. Latest main authority

- Repository: [miyatayuuma/english-pwa](https://github.com/miyatayuuma/english-pwa)
- Audit baseline and initial main SHA: **447063b6160ce3919a369dd7136512d41fafd6ce**
- Audit branch: **audit/session-options-mode-aware-ux**, created from that SHA
- APP_VERSION: **v5.110**
- Issue #210: OPEN at audit time
- PR #323: DRAFT / Pixel device acceptance pending at audit time
- PR #344: OPEN; hidden-page session-finalization E2E work. Its files and branch were not changed.
- PR #345: OPEN; ASR dyed/died remediation work. Its files and branch were not changed.
- Audit PR: [#346](https://github.com/miyatayuuma/english-pwa/pull/346), OPEN and not merged; documentation-only and based on main.

Local HEAD and origin/main both matched the confirmed SHA before documentation changes. Browser reproduction used the published PWA after applying its available update; the visible footer showed v5.110. The deployed page did not expose a commit SHA, so the exact deployed-source commit was not independently verified.

## 2. Existing UI architecture

| Layer | Current responsibility and authority |
|---|---|
| **scripts/app/learningMenu.js** | Home chooser, draft pendingMethod/pendingCourse, persistence of sentence method to appConfigV3.studyMode, Read/Compose reload handling. BOOT_METHOD is captured at module load. |
| **scripts/app/sessionShell.js** | Generic sentence-session options dialog, draft, filters, selection/training choices, manual sentence selection, plan preview and session start. |
| **scripts/app/sessionOptionsCore.js** | Sentence option normalization, eligibility filtering, zero-candidate diagnosis, session-plan creation and temporary reset. It has no game-method field. |
| **scripts/app/vocabularyMode.js** | Independent Vocabulary dialog/lobby, card-kind selection, Vocabulary preview and launch. |
| **scripts/app/vocabularyLearningCore.js** | Independent Vocabulary candidate ordering and session plan. |
| **scripts/app/continuousShadowing.js** | Shadowing mode, eligibility rule and exposure object; eligible sentences have best or last level at least 2. |

The sentence options dialog is not mode-aware. It is a generic Read/Compose sentence setup sheet. Vocabulary opens its own lobby from the home chooser, while “詳細な条件を設定” from Vocabulary also reaches the sentence options dialog.

## 3. Three-mode ownership mapping

Keep the three meanings of “mode” separate:

| State concept | Values / meaning | Authority |
|---|---|---|
| **gameMethod** | read, compose, vocabulary | Draft in chooser/details. Confirmed Read/Compose value remains appConfigV3.studyMode. Vocabulary is independently owned and must not write this sentence-game key. |
| **selectionMode** | auto, review, new, manual | Sentence planner. Existing option field is named mode; treat it as selection mode. |
| **trainingMode** | standard, continuous_shadowing | Sentence options/planner. Preserve shadowing’s non-scored contract. |
| **questionCount** | Adaptive or selected fixed target | Sentence options/planner. Preserve legacy count/customCount read compatibility during transition. Vocabulary has its separate fixed size:12 contract. |
| **characterId** | Character filter | Sentence options/planner; preserve current active-character entry/reset behavior. |
| **skillId** | Theme/skill filter | Sentence options/planner. |
| **section** | Section filter | Sentence options/planner. |
| **manualItemIds** | Explicit sentence IDs | Sentence planner only; validate against the eligible set; never carry IDs into a different method or later normal start. |
| Vocabulary card kind | all, word, expression | Vocabulary lobby/planner; mode-specific alternative to sentence theme, section and selection controls. |

Do not add gameMethod to the object normalized by sessionOptionsCore.js merely to make the sheet mode-aware. The sheet should own a separate method draft; the sentence planner should continue to receive sentence-only options.

## 4. Reproduction evidence

### Navigation cases

| Case | Result |
|---|---|
| NAV-01 Read → details | Reproduced. No method selector; sentence settings are shown. |
| NAV-02 Compose → details | Reproduced. Chooser says Compose is selected; details still show the same generic sentence settings and no Compose state. |
| NAV-03 Vocabulary → details | Reproduced. Details show sentence settings. Separately, “単語チャレンジを開く” opens the independent Vocabulary lobby. |
| NAV-04 Read → Compose inside details | Not possible in current UI; method control is absent. |
| NAV-05 Compose → Vocabulary inside details | Not possible in current UI; method control is absent. |
| NAV-06 Close details | Reproduced: returns to home. |
| NAV-07 Start after changing method | Not run. No live session was launched, to avoid changing SRS or study-log state. |
| NAV-08 Cancel after changing method | Reproduced at chooser level: unconfirmed method draft does not persist; reopening chooser returned to stored Read. Source review also shows the options draft stays in memory when the sheet is closed/reopened in the same page, so stale options can survive a cancellation path. |
| NAV-09 Reload after unconfirmed method change | Reproduced: chooser returned to Read. A chooser-only draft does not survive reload. Source review shows session options are initialized again on page load. |
| NAV-10 Session end → normal start | Not run live. Source review shows options reset on return; related reset behavior has existing tests. |

**Pending-method root cause:** openSessionOptionsFromMenu() closes the chooser and calls the options opener with characterId only. It omits dialog.dataset.pendingMethod and pendingCourse. The sheet itself has no game-method field/control, and normalizeSessionOptions() only handles sentence options. The selected pending method is therefore not handed to the sheet. The browser reproduced the observable mismatch for all three selections. The dialog does not expose enough state to prove which hidden planner would run for an unstarted submission; source authority is appConfigV3.studyMode plus module-load BOOT_METHOD for Read/Compose, with Vocabulary separate.

The current chooser persists Read/Compose when its start action is confirmed. A method selected in the details sheet should remain draft until Start.

### Count cases

| Case | Result |
|---|---|
| COUNT-01 Select custom | Reproduced: “任意” opens a numeric input, initially 7. |
| COUNT-02 Clear entire input | Reproduced: immediately becomes 1; summary/start label also change to 1. |
| COUNT-03 Enter 20 | Reproduced: input and summary show 20. |
| COUNT-04 Enter 30 | Reproduced: input and summary show 30. |
| COUNT-05 Enter 50 | Reproduced by select-all, clear, and sequential typing; displayed value jumped to 50. |
| COUNT-06 Enter above max | Not run in browser. Source clamps to 1–50. |
| COUNT-07 Select another count | Supported by current source; fixed choices remove the input state. |
| COUNT-08 Request more than candidates | Browser showed 49 eligible sentences while dialog said “今回は50問” / “50問を始める”. A unit test confirms a target of 12 with 3 candidates yields 3 items and shortfall 9. No live session was launched to inspect the final queue. |
| COUNT-09 Manual selection/count mismatch | Source review: preview says “最大 N 問,” but Start label uses selected ID count, not min(selected IDs, count); planner slices IDs at count and does not backfill. |
| COUNT-10 Reload restoration | Not separately browser-verified. Source initializes the options draft on page load; no durable session-options setting was found. |

**Count root cause:** each numeric input event stores the raw value then calls updateOptionsSheet(). That normalizes the draft; clampCount() converts empty string to Number("") = 0, then clamps to 1. The renderer writes the normalized value back into the same input. This matches the empty→1 browser reproduction. Re-rendering on every keystroke also resets the field and can disrupt caret/input behavior, explaining difficulty entering two digits.

Browser evidence was gathered at desktop size on the updated v5.110 page. No live session was started. Mobile viewports were not verified; local browser tests could not provide mobile evidence because Chromium was unavailable and relevant tests skipped. No screenshot artifact is included.

## 5. Detailed settings capability matrix

Classifications: **Supported** = current planner consumes it; **Unsupported** = no contract; **Mode-specific alternative** = use the mode’s native equivalent; **Requires implementation** = usable UI/bridge or behavior must be added.

| Setting | Read/Cloze | Compose | Vocabulary |
|---|---|---|---|
| Game method selector in details | Requires implementation | Requires implementation | Requires implementation |
| Character | Supported | Supported; shared sentence scope | Unsupported; hide |
| Grammar/theme | Supported as skill/theme filter | Supported as skill/theme filter | Mode-specific alternative: card kind |
| Section | Supported | Supported | Unsupported; hide |
| Question count | Supported by sentence planner | Supported by sentence planner | Mode-specific alternative: fixed current size 12; adjustable sizes require Vocabulary planner work |
| Auto/review/new/manual | Supported | Supported by shared sentence planner | Unsupported as shared controls; Vocabulary has separate due/fresh/early/stable ordering |
| Continuous shadowing | Supported; pass-level eligibility/non-scored behavior | Requires compatibility decision; hide in first release and force standard | Unsupported; keep separate |
| Manual item selection | Supported | Supported by same sentence planner | Unsupported; no entry-ID selector exists |

Read and Compose share the sentence option planner, so character/theme/section/count/selection/manual choices are supported for both at planner level. This does not establish browser acceptance for every Compose combination.

Shadowing eligibility and non-scored exposure rules exist, but the current sheet does not gate it by game method. There is no confirmed Compose-specific guard or test proving continuous shadowing is meaningful for the reorder game. First implementation should expose shadowing only for Read/Cloze; switching to Compose resets to standard. Vocabulary stays separate.

## 6. Pending-method propagation analysis

Confirmed source chain:

1. Chooser stores uncommitted selection in dialog.dataset.pendingMethod.
2. Details navigation calls openSessionOptionsFromMenu().
3. That opener passes only characterId.
4. The details opener normalizes sentence-only options.
5. Read/Compose otherwise come from appConfigV3.studyMode at boot; Vocabulary uses __OPEN_VOCABULARY_MODE__.

Implementation requirement: pass gameMethod: pendingMethod(dialog) separately into details, plus valid character. Pass course intent only if required by the new launch flow; do not accidentally auto-run the old pending course. The details header must show current method with accessible selected state.

## 7. Mode-switching lifecycle

Recommended lifecycle:

1. **Draft selection:** chooser and details update local gameMethod only. Opening details writes no configuration or learning data.
2. **Confirmed selection:** method buttons change the view and mode-specific draft. Read/Compose options may be cached only within the current setup draft. On switching to an unsupported mode, clear incompatible state. Do not carry sentence manual IDs, training mode or filters into Vocabulary.
3. **Session launch:** validate the current method and target, then commit. Read/Compose writes appConfigV3.studyMode at this point. Vocabulary never writes the sentence key.
4. **Return home:** preserve committed Read/Compose behavior; preserve existing character/session reset contract; clear temporary filters/manual IDs; do not persist Vocabulary card kind unless separately approved.
5. **Next launch:** initialize from committed sentence mode with clean temporary filters and no stale handoff/manual IDs.

**Read/Compose reload handoff:** retain the current reload boundary because sentence mode is selected through module-load BOOT_METHOD. When Start is pressed for a different sentence method, store a versioned, one-shot sessionStorage payload with method, options, character, explicit start intent, nonce and creation time; write appConfigV3.studyMode and reload. After reload, validate, consume/remove before dispatch, recompute the preview/plan, and allow one start only when explicit Start intent is present. A method-only draft reload restores draft without starting. Expire invalid/stale payloads and avoid replaying the chooser’s old pending-course action on top of a custom session. If exactly-once dispatch cannot be guaranteed, restore details and require a second explicit Start.

## 8. Vocabulary-specific constraints

vocabularyMode.js previews and starts with size:12 and a selected card kind. buildVocabularySession() independently caps requested size at 30, defaults to 12, applies a default fresh-card cap of min(8, requested), then fills from its own due/fresh/learning/stable buckets. Its contract is separate from sessionOptionsCore.js.

Initial implementation decision:

- Include Vocabulary in the shared details method header.
- Hide character/theme/section, sentence selection mode, shadowing and manual sentence controls.
- Show all / word / expression as the mode-specific alternative.
- Preview from Vocabulary’s own builder and show the actual plan, currently capped by the existing 12-card launch request.
- Route Start through a narrow Vocabulary preview/start bridge; vocabularyMode.js and vocabularyLearningCore.js remain authorities. Do not open a second lobby after configuration.

If product scope requires 20/30/50 Vocabulary cards, separately decide the core size cap, fresh-card cap at larger sizes, shortage display and card-kind candidate shortages. Do not imply sentence count buttons affect Vocabulary.

## 9. Question-count input root cause

The input event → updateOptionsSheet() → normalization → write-back path is confirmed. Empty input becomes zero and clamps to one. Removing the custom input and the custom UI choice resolves the failure path. Do not leave a hidden input or selectable custom enum in the UI.

## 10. Proposed fixed count choices

Recommended for sentence modes: **おまかせ / 5 / 8 / 12 / 20 / 30 / 50**.

- Keep 5/8/12: existing presets/tests and familiar small-session values; no evidence supports removing them.
- Add 20/30/50 for long practice without typing.
- Do not add 10 in this change: it is close to 8 and 12, with no evidenced need.
- Keep おまかせ adaptive; existing planner/tests use 6–8, not fixed 8.
- Fixed count is a target. Actual queue is bounded by eligible candidates; show requested target, candidate count, actual planned count and shortfall before Start. Never fabricate items.
- Manual actual count is min(valid selected IDs, fixed count); no backfill. Show the limit and actual count; disable Start with zero valid IDs. Preserve order and deduplicate.
- Preserve SRS ordering and scheduling; only target size changes.
- Vocabulary remains on its independent current 12-card policy.
- In the first implementation, show shadowing only for Read/Cloze, with its actual eligible count and non-scored description.

Example: for 50 requested and 49 eligible, show a 49-question start and a one-question shortage, never “50問を始める.” For 3 valid manual IDs and count 5, start 3. For 12 selected IDs and count 5, start the first 5 and say so.

## 11. Legacy customCount compatibility

Source review and storage-key search found no durable session-options/customCount localStorage setting. appConfigV3.studyMode is durable for sentence method; current sessionStorage carries the legacy pending course across method reload. No localStorage migration is justified.

- Remove custom from visible choices and stop generating custom input events.
- Keep a compatibility reader for one release if a legacy draft/handoff can arrive.
- If count:custom has customCount exactly matching a fixed value, map to that choice.
- If nonmatching/malformed, use auto and show an explicit one-time message when restoring the legacy draft.
- Clear custom field from normalized draft and consumed handoff.
- Do not add persistent session-options storage or change localStorage schema without verified need.

## 12. Mobile layout proposal

Acceptance viewports: **360×844**, **390×844**, **430×844**.

- Three-segment method selector at top: 穴あき / 並べ替え / 単語. Short labels, clear selected styling, accessible pressed/selected state.
- Stack only selected method’s controls vertically.
- Put seven sentence-count options in compact 4+3 grid at narrowest width; 44–48 px minimum control height. No horizontal scrolling.
- Vertically scrollable dialog body; footer/Start visible or reachable with safe-area padding.
- Keep method, eligible/actual counts, zero-candidate diagnosis and Start label synchronized.
- Remove numeric keyboard.
- Focus order: method selector → active settings → summary/diagnosis → Start → Close/Cancel. Use aria-pressed or equivalent and announce method changes.
- Back/Close/Cancel return to chooser and discard edits.
- Keep home’s existing three-action rule; detail controls do not change it.

No mobile layout result is claimed from this audit.

## 13. Storage and SRS protection

- Opening/editing/switching/closing/cancelling details does not update SRS, Study log, relationship, speech outcomes or session history.
- Only explicit Start enters launch.
- Method switch alone does not persist studyMode.
- Commit Read/Compose at Start; Vocabulary never writes it.
- Validate eligible candidates and current method immediately before launch.
- Show zero candidates and diagnosis; never start an empty/stale plan.
- Clear temporary filters/manual IDs on existing reset boundary.
- Do not reuse manual IDs across modes or launches.
- Never merge Vocabulary into sentence queue.
- Preserve shadowing’s non-scored contract.
- Do not alter speech-finality, ASR equivalence, session/vocabulary scoring, protected data, SRS algorithm, relationships or localStorage schema.

No session was started; audit actions intentionally wrote no study results.

## 14. Implementation architecture comparison

| Option | Advantages | Risks / cost |
|---|---|---|
| **A. Extend existing modules (recommended)** | Smallest change; respects current authorities; reuses sheet/planner and independent Vocabulary engine; preserves reload boundary. | Requires clear separation of gameMethod draft from sentence settings; mode branches in sheet; narrow Vocabulary bridge needed. |
| **B. New shared Game Setup Controller** | Central draft authority; clean conceptual mode switch. | Duplicates state owned by chooser, sentence shell and Vocabulary lobby; larger transition surface; more risk of competing persistence/launch authority. |

Choose Option A. Add only a small explicit draft/handoff helper if needed; do not create a second durable mode owner.

## 15. Recommended implementation design

1. learningMenu.js passes pending gameMethod and character into details without persisting it.
2. sessionShell.js owns separate gameMethod draft, mode selector, visibility and switch handling. Keep selectionMode/trainingMode distinct.
3. sessionOptionsCore.js remains the sentence planner; update fixed count choices; remove custom UI; report actual plan/shortfall.
4. vocabularyMode.js exposes a narrow preview/start bridge and keeps card-kind ownership and Vocabulary authority.
5. Preserve Read/Compose reload boundary with versioned, one-shot, validated, explicit-intent, exactly-once handoff. Do not reuse pending-course action for session launch.
6. Cancel closes details, returns to chooser, discards edits, and starts nothing.
7. Preserve current home-navigation ownership and three-action presentation.

## 16. Required code changes for implementation

Production files:

- scripts/app/learningMenu.js
- scripts/app/sessionShell.js
- scripts/app/sessionOptionsCore.js
- scripts/app/vocabularyMode.js
- scripts/app/vocabularyLearningCore.js only if Vocabulary size contract expands
- Current stylesheet owning session options/responsive dialog rules; identify from latest main before editing

Tests:

- Update tests/sessionOptionsCore.test.mjs
- Update tests/sessionShell.test.mjs
- Update tests/learningMenu.test.mjs
- Add tests/modeAwareSessionOptions.test.mjs
- Add tests/modeAwareSessionOptions.browser.test.mjs
- Extend Vocabulary tests if bridge/preview changes.

Do not edit tests/issue210RealSession.browser.test.mjs or other PR #344 files, nor PR #345 files. Do not edit data/vocabulary-v3.json, data/items.json, data/characters.json, scoring/SRS/relationship code, speech finality/ASR equivalence, or localStorage schema.

For implementation, reread main first. Choose APP_VERSION from then-current main and resolve version reservations; do not assume v5.111. Update service worker/precache/native assets only if required by current workflow.

## 17. Regression test matrix

| Area | Positive coverage | Negative / safety coverage |
|---|---|---|
| Method propagation | Read/Compose/Vocabulary arrive in details unchanged | Invalid method default is explicit; course action does not auto-run |
| Mode switching | Correct settings/preview appear for all modes | Unsupported controls hidden; stale values cleared |
| Read/Compose planning | Correct filters/count/manual IDs reach shared planner | No cross-method queue; switch alone writes no learning data |
| Vocabulary | Own kind and plan drive preview/start | Sentence filters, IDs, shadowing and counts do not leak |
| Cancel/Back | Returns to chooser and discards draft | No start or persistent method write |
| Reload handoff | Explicit switch-and-start restores target and launches at most once | Draft-only reload cannot auto-start; stale/duplicate/expired payload rejected |
| Fixed counts | Exactly auto/5/8/12/20/30/50; auto remains 6–8 | No custom input, no unsupported 10, no synthetic fill |
| Legacy custom | Exact matches map; nonmatching shows notice and selects auto | No silent nearest-value rounding; legacy field cleared |
| Shortfall | 50 with 49 candidates shows actual 49 and one short | Start never promises 50; zero candidates disables Start |
| Manual | Count cap/order/valid IDs match actual plan | No stale IDs/backfill; no start with zero valid selections |
| Reset | Normal start/return clears temporary settings as specified | Filters/manual IDs do not leak to next normal start |
| Storage/SRS | Open/edit/cancel produce no learning writes | Assert no item-level, Study log, relationship, score or history changes pre-Start |
| Accessibility/mobile | 360×844, 390×844, 430×844; state announced | No horizontal scroll, keyboard, hidden footer or unreachable Start |
| Parallel work | New tests avoid other workstream files | No edits to #344 E2E or #345 ASR scope |

Run focused Node suites, Chromium browser tests at all three sizes, Vocabulary/shadowing suites, and current Android/build/lint gates required by implementation CI. A skipped browser test is not mobile acceptance. Do not change CI or scoring to make tests pass.

## 18. Risks and unresolved decisions

- Visible method mismatch is confirmed; exact hidden planner path for an unstarted detail submission was not exercised.
- No live session was started. Actual browser queue size under 49 candidates / target 50 remains unverified; source and unit test establish planner shortfall.
- Mobile acceptance remains unverified until implementation; local browser suite skipped because Chromium was unavailable.
- Fixed choices in this design apply to sentence modes. Vocabulary sizes above current 12-card launch policy need a separate planner/product decision.
- Compose + continuous shadowing has no confirmed compatibility contract; hide until a focused test establishes support.
- Reload handoff must prevent duplicate starts and stale course dispatch; release-blocking test area.
- Implementation APP_VERSION must be checked against latest main and parallel PR outcomes at that time.

## Evidence and validation record

- Source authority: main **447063b6160ce3919a369dd7136512d41fafd6ce**; APP_VERSION **v5.110**.
- Current UI reproduced in browser after available update showed v5.110.
- Focused relevant Node baseline: **36 passed**.
- Browser baseline: **10 skipped** because local Playwright Chromium was unavailable. Skips are not passes.
- Protected-file status and final audit diff were checked; audit branch is documentation-only.
- No production source/CSS/tests, APP_VERSION, assets, protected data, PR #344 files, or ASR implementation files were changed.
