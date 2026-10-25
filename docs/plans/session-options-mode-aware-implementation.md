# English PWA — Mode-Aware Session Options UI Implementation

## Handoff status

Design audit completed on main **447063b6160ce3919a369dd7136512d41fafd6ce** (**APP_VERSION v5.110**). This is an implementation instruction only. It does not authorize changes to SRS, scoring, ASR, vocabulary data or localStorage schema.

## Approved UX

- Details has a three-mode selector: **穴あき / 並べ替え / 単語**.
- It opens with the method selected in the chooser; methods can be changed inside details.
- Show only settings that affect the selected mode.
- Read/Cloze and Compose use sentence-planner options.
- Vocabulary uses its own card kind and Vocabulary plan.
- Sentence count is **おまかせ / 5 / 8 / 12 / 20 / 30 / 50**. Remove freeform input.
- おまかせ keeps adaptive 6–8 sentence behavior.
- Fixed counts are targets. Show actual plan size/shortage; never invent prompts.
- Cancel/Close returns to chooser, discards setup edits and starts nothing.
- Read/Compose setting persists only on confirmed Start. Vocabulary does not write appConfigV3.studyMode.
- Keep Read/Compose reload boundary with a validated one-shot handoff.

See [session-options-mode-aware-design-audit.md](../validation/session-options-mode-aware-design-audit.md) for findings and rationale.

## Confirm before coding

At implementation start:

1. Fetch/rebase latest main and record its SHA.
2. Check #210, #323, #344, #345 and version reservations. #344 owns hidden-page finalization E2E work; #345 owns ASR dyed/died remediation. Do not branch from either.
3. Create a new implementation branch from main, e.g. **feat/mode-aware-session-options**.
4. Confirm current APP_VERSION and release/precache/native-web workflow. Do not assume v5.111 is available.
5. Keep scope: no SRS, study-log, vocabulary scoring/data, relationship, speech-finality, ASR equivalence, localStorage schema, or unrelated session algorithm changes.

## Expected files

Production:

- **scripts/app/learningMenu.js** — pass pending game method and character to details; keep draft unpersisted.
- **scripts/app/sessionShell.js** — mode selector, mode-specific sheet, draft lifecycle, preview/start labels, cancel and handoff restoration.
- **scripts/app/sessionOptionsCore.js** — fixed sentence choices, plan-size/shortfall support and legacy custom read compatibility.
- **scripts/app/vocabularyMode.js** — narrow preview/start bridge and card-kind draft ownership.
- **scripts/app/vocabularyLearningCore.js** — only if a separate decision expands Vocabulary beyond its current 12-card request / 30-card core cap.
- Current stylesheet that owns the options sheet; identify it from latest main before editing.

Tests:

- Update **tests/sessionOptionsCore.test.mjs**
- Update **tests/sessionShell.test.mjs**
- Update **tests/learningMenu.test.mjs**
- Add **tests/modeAwareSessionOptions.test.mjs**
- Add **tests/modeAwareSessionOptions.browser.test.mjs**
- Extend Vocabulary tests if the bridge changes.

Do not edit tests/issue210RealSession.browser.test.mjs or other #344 files, or any #345 files.

## State ownership

Keep these concepts separate, even if implementation wire fields retain current names:

- **gameMethod**: read / compose / vocabulary. Draft belongs to chooser/details. Confirmed Read/Compose is appConfigV3.studyMode. Vocabulary remains separately owned and never writes that key.
- **selectionMode**: auto / review / new / manual. Sentence planner choice; existing option property is mode.
- **trainingMode**: standard / continuous_shadowing.
- **questionCount**: auto or fixed choice; retain count/customCount compatibility while migrating.
- **characterId, skillId, section, manualItemIds**: sentence setup only.
- Vocabulary **kind**: all / word / expression, owned by vocabularyMode.js and its planner.

Do not put gameMethod inside normalizeSessionOptions() to force a single authority. The detail UI may have a combined view model but must pass sentence-only options to sessionOptionsCore.js.

## Mode-specific behavior

### Read/Cloze

Show character, theme/skill, section, count, selection mode, manual sentence picker and training mode. Shadowing is available only here in the first implementation. Preserve current eligibility and non-scored behavior.

### Compose

Show character, theme/skill, section, count, selection mode and manual sentence picker. Hide shadowing and force standard when entering Compose. Read/Compose may reuse the current sentence draft while switching between them; do not carry sentence filters or IDs into Vocabulary.

### Vocabulary

Show all / word / expression and preview from buildVocabularySession(). Hide sentence character/theme/section, selection mode, manual IDs and shadowing. Keep current size request at 12 unless scope separately approves Vocabulary size selection. Any future 20/30/50 Vocabulary selector requires a separate decision on the core cap, fresh-card cap, shortage display and tests.

Use a narrow bridge for preview/start. vocabularyMode.js and vocabularyLearningCore.js remain Vocabulary authorities. Do not open a second lobby after setup in shared details.

## Method switching and persistence

1. On details entry, initialize gameMethodDraft from pendingMethod(dialog); if missing/invalid, use confirmed sentence method.
2. Method buttons change draft/view only; they do not write appConfigV3.studyMode, SRS, Study log or session history.
3. Recompute eligible candidates, planned count, zero-candidate diagnosis and Start label on each method/settings change.
4. Cancel/Back/Close returns to chooser, discards detail edits, clears unconsumed setup handoff and starts nothing.
5. On explicit Start, validate the current method and plan immediately:
   - Read/Compose commits appConfigV3.studyMode. If method differs from module-load BOOT_METHOD, use existing reload boundary.
   - Store a versioned one-shot payload with gameMethod, sentence options, character, explicit start intent, nonce and creation time.
   - After reload validate version/method/nonce/age/current setting, consume before dispatch, recompute plan, and launch at most once.
   - Method-only reload has no explicit Start intent and never auto-starts. Expired/malformed/mismatched payload opens details safely or returns to chooser.
   - Ensure englishPwaPendingGameAction cannot run on top of a custom session.
   - Vocabulary starts through its independent owner and never changes sentence mode storage.
6. On normal completion/home return, preserve existing reset behavior, clear temporary filters/manual IDs and pending actions.

If exactly-once replay cannot be proved, restore setup after reload and require a second explicit Start rather than auto-launch.

## Question-count behavior

Use exactly: **おまかせ / 5 / 8 / 12 / 20 / 30 / 50**.

Keep 5/8/12; do not add 10 in this change. Remove custom input. おまかせ remains adaptive 6–8, not fixed 8.

- Automatic/review/new: preview actual size, eligible count and shortfall. For target 50 with 49 eligible, label a 49-question start and one-question shortage.
- Manual: actual size is min(valid ordered selected IDs, chosen count). No backfill. Preview/Start use this actual size; zero valid IDs disables Start.
- Keep existing SRS ordering; no synthetic entries.

### Legacy custom draft

No durable session-options localStorage schema was found. Do not add one.

- Read count:custom for one migration release if a legacy draft/handoff arrives.
- Map exact customCount matches to a fixed choice.
- For nonmatching/malformed values choose auto, show a one-time restoration notice and clear custom state.
- Never silently round to another fixed choice.

## Responsive and accessibility acceptance

Test **360×844**, **390×844**, and **430×844**:

- No horizontal scroll.
- All 3 methods recognizable, selection announced via aria-pressed or equivalent.
- Only selected method’s controls appear.
- Seven count options fit in 4+3 grid at 360 px; each tap target at least 44 px high.
- Dialog body scrolls vertically; footer and Start remain visible or reachable with safe-area padding.
- Summary, candidates, actual plan and shortage update with controls.
- No numeric keyboard.
- Focus order: method → active settings → summary/diagnosis → Start → Close/Cancel.
- Method changes announced to assistive technology.
- Back/Close/Cancel returns safely.
- Preserve home’s three-action rule.

Skipped Chromium tests do not count as acceptance.

## Regression test requirements

### Unit/module tests

- Propagate all three methods from chooser to details.
- Keep gameMethod, selectionMode and trainingMode distinct.
- Read/Compose planner receives correct filters/count/manual IDs.
- Vocabulary uses own kind/plan; sentence options do not leak.
- Count enum exactly auto/5/8/12/20/30/50; no custom UI.
- Auto remains 6–8; 20/30/50 reach sentence planner.
- Shortage/zero candidates show actual counts; no synthetic fill.
- Manual order/limit/invalid IDs/no-backfill.
- Legacy exact-match and explicit nonmatch fallback.
- Reset clears filters/manual IDs and preserves character contract.
- Shadowing remains Read-only initially and non-scored.
- Cancel/method change does not persist or write learning data.

### Browser/integration tests

- NAV-01–NAV-10 using isolated fixtures.
- Switching among all methods updates visible options and preview counts.
- Cancel/Back never starts; method-only reload never auto-starts.
- Explicit Read↔Compose Start through reload retains draft/count and launches once.
- Stale/malformed/duplicate/expired handoffs cannot launch.
- Vocabulary shared details uses own preview/start.
- Fixed counts including 50 with fewer candidates.
- Manual selection/count UI equals actual plan.
- Normal start after custom setup has no old filters/manual IDs.
- Storage snapshot confirms no pre-Start item-level/SRS, Study log, relationship, score or history write.
- Mobile Chromium passes all three viewports.

Run focused Node suites, browser tests, Vocabulary and shadowing suites, and the repository’s required Android/build/lint gates. Do not change CI or scoring logic to force a pass. Keep #344/#345 files untouched.

## Release/version and PR closure

- Re-read main and select APP_VERSION against then-current main and parallel PR outcomes.
- Update versioned assets/service worker/native web packaging only per current workflow.
- Open implementation PR from the fresh branch with source/test and mobile evidence.
- Do not merge before independent review and required CI.
- Reconcile with #344/#345 by rebasing on then-current main; do not merge another workstream branch as a shortcut.
- Link the audit report and this instruction from the implementation PR.

## Completion definition

Implementation is ready for independent review when all three modes show the correct setup and preview; in-sheet switching/cancel have no persistence leaks; Read/Compose reload handoff is validated and exactly-once; count UI works at required mobile sizes; actual/shortfall and manual semantics match the plan; legacy custom handling is explicit; and tests pass without touching protected data, SRS, Vocabulary scoring, shadowing contract, speech finality or ASR equivalence.
